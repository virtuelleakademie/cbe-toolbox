import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runImprovementLoop, type LoopDeps, type MarkerIO, type EvalResult } from "../src/loop.js";
import { MemorySkillIO } from "../src/skill-io.js";
import { ProviderError } from "../src/judge-client.js";
import type { LlmClient } from "../src/judge-client.js";
import type { CheckResult, Verdict } from "../src/types.js";
import { SKILL_OK } from "./editor.test.js";

function memMarker(initial?: { iteration: number; snapshot: Map<string, string> }): MarkerIO {
  let state = initial ?? null;
  return {
    exists: () => state !== null,
    read: () => state,
    write: (iteration, snapshot) => {
      state = { iteration, snapshot };
    },
    clear: () => {
      state = null;
    },
  };
}

/**
 * Per-model world: a checkpoint's verdict for a model is derived from markers in
 * SKILL.md, else its per-model baseline. Markers (model-scoped so board scenarios are
 * expressible): `OK:<model>:<id>` or `OK:*:<id>` -> pass; `BAD:<model>:<id>` -> fail.
 */
function world(probes: Record<string, string[]>, baseline: Record<string, Record<string, Verdict>>, io: MemorySkillIO) {
  const verdictOf = (model: string, id: string): Verdict => {
    const sk = io.read("SKILL.md");
    if (sk.includes(`BAD:${model}:${id}`)) return "fail";
    if (sk.includes(`OK:${model}:${id}`) || sk.includes(`OK:*:${id}`)) return "pass";
    if (sk.includes(`PARTIAL:${model}:${id}`) || sk.includes(`PARTIAL:*:${id}`)) return "partial";
    return baseline[model]?.[id] ?? "fail";
  };
  const evaluate = vi.fn(async (probeIds: string[] | undefined, model: string): Promise<EvalResult> => {
    const sel = probeIds ?? Object.keys(probes);
    const reports = sel.map((p) => ({
      probe: p,
      model,
      results: probes[p]!.map((id) => ({ id, type: "judge", verdict: verdictOf(model, id) }) as CheckResult),
    }));
    return { results: reports.flatMap((r) => r.results), reports };
  });
  return { evaluate, verdictOf };
}

/** Editor that appends `mutate(id, nthAttemptForId)` to the current SKILL.md. */
function editor(io: MemorySkillIO, mutate: (id: string, n: number) => string): { client: LlmClient } {
  const seen = new Map<string, number>();
  const client: LlmClient = {
    modelId: "ed",
    tokensUsed: 0,
    async complete(_sys: string, user: string) {
      const m = /- (\S+) \(/.exec(user);
      const id = m?.[1] ?? "??";
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      const change = io.read("SKILL.md") + mutate(id, n);
      return {
        text: `TARGET_FILE: SKILL.md\nEDITOR_REASONING: fix ${id}\n---BEGIN FILE CONTENT---\n${change}\n---END FILE CONTENT---\n`,
      };
    },
  };
  return { client };
}

function deps(io: MemorySkillIO, evaluate: LoopDeps["evaluate"], over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    io,
    evaluate,
    editor: editor(io, () => "\nNOTE:noop"),
    marker: memMarker(),
    runDir: mkdtempSync(path.join(tmpdir(), "cbe-loop-")),
    tokensUsed: () => 0,
    ...over,
  };
}

const PANEL = ["mistral", "qwen", "gemma"];

describe("board improvement loop", () => {
  it("max-iterations 1 runs eval only and never calls the editor", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const { evaluate } = world(
      { p1: ["c1"] },
      { mistral: { c1: "fail" }, qwen: { c1: "fail" }, gemma: { c1: "fail" } },
      io
    );
    const ed = editor(io, () => "\nOK:*:c1");
    const spy = vi.spyOn(ed.client, "complete");
    const r = await runImprovementLoop({ maxIterations: 1, panel: PANEL }, deps(io, evaluate, { editor: ed }));
    expect(spy).not.toHaveBeenCalled();
    expect(r.exitCode).toBe(1);
  });

  // spec: Pareto improvement is kept (including lifting only the weakest model)
  it("keeps an edit that lifts only the weakest model (others already pass) and advances", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    // c1 fails only on gemma; mistral+qwen already pass it.
    const base = { mistral: { c1: "pass" }, qwen: { c1: "pass" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    const ed = editor(io, (id) => `\nOK:gemma:${id}`); // lift only gemma, no regression
    const r = await runImprovementLoop({ maxIterations: 2, panel: PANEL }, deps(io, evaluate, { editor: ed }));
    expect(io.read("SKILL.md")).toContain("OK:gemma:c1"); // kept
    expect(r.exitCode).toBe(0);
  });

  // spec: An edit that regresses any model is reverted
  it("reverts an edit that lifts one model but regresses another, then retries", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = {
      mistral: { c1: "pass", c2: "pass" },
      qwen: { c1: "fail", c2: "pass" },
      gemma: { c1: "fail", c2: "pass" },
    };
    const { evaluate } = world({ p1: ["c1", "c2"] }, base, io);
    // attempt 1: fix c1 for qwen but break c2 for mistral -> revert; attempt 2: clean
    const ed = editor(io, (id, n) =>
      n === 1 ? `\nOK:qwen:${id} OK:gemma:${id} BAD:mistral:c2` : `\nOK:qwen:${id} OK:gemma:${id}`
    );
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 3, panel: PANEL },
      deps(io, evaluate, { editor: ed })
    );
    expect(io.read("SKILL.md")).not.toContain("BAD:mistral:c2"); // regressing edit reverted
    expect(io.read("SKILL.md")).toContain("OK:qwen:c1");
    expect(r.exitCode).toBe(0);
  });

  // spec: An edit that improves no model is reverted
  it("reverts an edit that improves no panel model", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = { mistral: { c1: "fail" }, qwen: { c1: "fail" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    const ed = editor(io, () => "\nNOTE:useless"); // changes file, fixes nothing
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 2, panel: PANEL },
      deps(io, evaluate, { editor: ed })
    );
    expect(io.read("SKILL.md")).toBe(SKILL_OK); // reverted to baseline
    expect(r.exitCode).toBe(1);
  });

  // spec: Re-evaluation is scoped to the checkpoint's probe (per panel model)
  it("re-evaluates only the targeted probe, once per panel model", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = {
      mistral: { c1: "fail", x: "pass" },
      qwen: { c1: "fail", x: "pass" },
      gemma: { c1: "fail", x: "pass" },
    };
    const { evaluate } = world({ p1: ["c1"], p2: ["x"] }, base, io);
    const ed = editor(io, (id) => `\nOK:*:${id}`);
    await runImprovementLoop({ maxIterations: 2, maxAttempts: 1, panel: PANEL }, deps(io, evaluate, { editor: ed }));
    const calls = (evaluate as ReturnType<typeof vi.fn>).mock.calls;
    // first 3 calls = baseline (probeIds undefined), one per panel model
    expect(calls.slice(0, 3).every((c: unknown[]) => c[0] === undefined)).toBe(true);
    // scoped re-eval calls target ["p1"] only (never p2)
    const scoped = calls.filter((c: unknown[]) => Array.isArray(c[0]));
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((c: unknown[]) => JSON.stringify(c[0]) === JSON.stringify(["p1"]))).toBe(true);
  });

  // spec: partial counts as forward progress
  it("keeps a fail->partial step then partial->pass on retry (weakest model)", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = { mistral: { c1: "pass" }, qwen: { c1: "pass" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    const ed = editor(io, (id, n) => (n === 1 ? `\nPARTIAL:gemma:${id}` : `\nOK:gemma:${id}`));
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 3, panel: PANEL },
      deps(io, evaluate, { editor: ed })
    );
    expect(io.read("SKILL.md")).toContain("OK:gemma:c1");
    expect(r.exitCode).toBe(0);
  });

  // spec (ADDED): bloated attempt rejected, retried smaller
  it("rejects a bloated attempt and retries smaller", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = { mistral: { c1: "fail" }, qwen: { c1: "fail" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    const ed = editor(io, (id, n) => (n === 1 ? "x".repeat(2000) : `\nOK:*:${id}`));
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 3, panel: PANEL },
      deps(io, evaluate, { editor: ed })
    );
    expect(io.read("SKILL.md")).toContain("OK:*:c1");
    expect(io.read("SKILL.md")).not.toContain("xxxxxxxxxx");
    expect(r.exitCode).toBe(0);
  });

  // spec: Overfit edit is caught by the held-out model
  it("reverts an edit that improves the panel but regresses the held-out model", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = {
      mistral: { c1: "fail" },
      qwen: { c1: "fail" },
      hideaway: { c1: "pass" }, // held-out, currently passing
    };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    // attempt 1: fix panel but break held-out; attempt 2: clean fix
    const ed = editor(io, (id, n) =>
      n === 1 ? `\nOK:mistral:${id} OK:qwen:${id} BAD:hideaway:${id}` : `\nOK:mistral:${id} OK:qwen:${id}`
    );
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 3, panel: ["mistral", "qwen"], holdout: "hideaway" },
      deps(io, evaluate, { editor: ed })
    );
    expect(io.read("SKILL.md")).not.toContain("BAD:hideaway"); // overfit attempt reverted
    expect(io.read("SKILL.md")).toContain("OK:mistral:c1");
    expect(r.exitCode).toBe(0);
  });

  it("interactive: operator 'abort' stops and reverts", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = { mistral: { c1: "fail" }, qwen: { c1: "fail" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    const ed = editor(io, (id) => `\nOK:*:${id}`);
    const promptOperator = vi.fn(async () => "abort" as const);
    const r = await runImprovementLoop(
      { maxIterations: 2, panel: PANEL, interactive: true },
      deps(io, evaluate, { editor: ed, promptOperator })
    );
    expect(promptOperator).toHaveBeenCalled();
    expect(io.read("SKILL.md")).toBe(SKILL_OK);
    expect(r.exitCode).toBe(1);
  });

  it("exits 3 on a provider error", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const evaluate = async () => {
      throw new ProviderError("429 rate limited", 429);
    };
    const r = await runImprovementLoop({ maxIterations: 2, panel: PANEL }, deps(io, evaluate));
    expect(r.exitCode).toBe(3);
  });

  it("stops and exits 1 when the token budget is exceeded", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", SKILL_OK]]));
    const base = { mistral: { c1: "fail" }, qwen: { c1: "fail" }, gemma: { c1: "fail" } };
    const { evaluate } = world({ p1: ["c1"] }, base, io);
    let tokens = 0;
    const ed = editor(io, () => "\nNOTE:never");
    const r = await runImprovementLoop(
      { maxIterations: 2, maxAttempts: 9, maxTokens: 500, panel: PANEL },
      deps(io, evaluate, { editor: ed, tokensUsed: () => (tokens += 1000) })
    );
    expect(r.exitCode).toBe(1);
  });

  it("crash recovery: reverts to the marker snapshot on start", async () => {
    const io = new MemorySkillIO(new Map([["SKILL.md", "MODIFIED MID-CRASH"]]));
    const { evaluate } = world(
      { p1: ["c1"] },
      { mistral: { c1: "pass" }, qwen: { c1: "pass" }, gemma: { c1: "pass" } },
      io
    );
    const marker = memMarker({ iteration: 2, snapshot: new Map([["SKILL.md", SKILL_OK]]) });
    const r = await runImprovementLoop({ maxIterations: 1, panel: PANEL }, deps(io, evaluate, { marker }));
    expect(io.read("SKILL.md")).toBe(SKILL_OK);
    expect(r.exitCode).toBe(0);
  });
});
