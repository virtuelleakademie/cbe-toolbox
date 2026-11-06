import { afterAll, describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPiEvalSessionFactory,
  evalWorkspaceRoot,
  type StartSessionLike,
  type StartSessionResultLike,
} from "../src/session-pi.js";
import { ProviderError } from "../src/judge-client.js";
import type { CbeRuntimeEvent } from "@cbe/pi-bridge/runtime";

/** A throwaway workspace root; the factory mkdirs a `workspace-<n>` under it. */
const tmpRoots: string[] = [];
function scratchWorkspaceRoot(): string {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "cbe-eval-ws-test-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function makeFakeStart(calls: Parameters<StartSessionLike>[0][]): StartSessionLike {
  return async (opts) => {
    calls.push(opts);
    return {
      session: { subscribe: () => () => {}, prompt: async () => {}, dispose() {} },
      env: { profile: opts.profile, affordances: {} },
    } satisfies StartSessionResultLike;
  };
}

describe("createPiEvalSessionFactory reasoning forwarding", () => {
  it("forwards reasoning and reasoningEffort to startCbeSession when set", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m", reasoning: true, reasoningEffort: "low" },
      startSession: makeFakeStart(calls),
    });
    await factory({ probe: "p", profile: "headless" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.provider.reasoning).toBe(true);
    expect(calls[0]!.provider.reasoningEffort).toBe("low");
  });

  it("omits reasoning fields when the provider does not configure them", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeFakeStart(calls),
    });
    await factory({ probe: "p", profile: "headless" });
    expect(calls[0]!.provider.reasoning).toBeUndefined();
    expect(calls[0]!.provider.reasoningEffort).toBeUndefined();
  });
});

// change add-lecturer-wiki-and-course-workspace (Task 1.21 eval-sync): wiki
// fixture provisioning + course-context passthrough for scenario 20.
describe("createPiEvalSessionFactory wiki fixture + course context", () => {
  it("provisions the wiki fixture on disk and passes paths.wiki + courseContext", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "cbe-eval-wiki-"));
    try {
      const calls: Parameters<StartSessionLike>[0][] = [];
      const factory = createPiEvalSessionFactory({
        skillDir: "/s",
        sessionsDir,
        agentDir: "/agent",
        workspaceRoot: scratchWorkspaceRoot(),
        provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
        startSession: makeFakeStart(calls),
      });
      await factory({
        probe: "20b",
        profile: "app",
        wikiFixture: {
          "index.md": "# Wiki index\n",
          "concept/cbl-framework-notes.md": "---\ntype: concept\n---\nbody",
        },
        courseContext: "---\ntitle: X\n---\n",
      });
      const wikiDir = calls[0]!.paths?.wiki;
      expect(wikiDir).toBeTruthy();
      expect(await readFile(path.join(wikiDir!, "index.md"), "utf8")).toContain("Wiki index");
      expect(await readFile(path.join(wikiDir!, "concept/cbl-framework-notes.md"), "utf8")).toContain("body");
      expect(calls[0]!.courseContext).toContain("title: X");
    } finally {
      await rm(sessionsDir, { recursive: true, force: true });
    }
  });

  it("passes no wiki path when the probe has no fixture", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeFakeStart(calls),
    });
    await factory({ probe: "p", profile: "headless" });
    expect(calls[0]!.paths?.wiki).toBeUndefined();
    expect(calls[0]!.courseContext).toBeUndefined();
  });
});

// Change `express-app-priors-in-probe-setup` (capability `cbe-skill-eval-harness`,
// Requirement: *A Probe Reproduces the App's Session Priors, and Every Divergence Is
// Declared*): the two priors travel to `startCbeSession` through the SAME opts the
// app uses — and an undeclared prior is not forwarded AT ALL, so a probe that
// declares neither keeps today's descriptor byte-identical (an `undefined`-valued
// key would already be a difference in the opts surface this test pins).
describe("createPiEvalSessionFactory — lecturerState and decisionsSummary priors", () => {
  const LECTURER_STATE = {
    globalPath: "/data/lecturer-state/global.md",
    globalContent: "CBE fluency: proven across two courses.",
    overlayPath: "/data/courses/algo/lecturer-state.md",
    overlayContent: "Cohort: 2nd-semester CS.",
  };

  // Scenario: *A probe expresses the lecturer state and the recorded decisions*.
  it("forwards a declared lecturerState and decisionsSummary to startCbeSession", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeFakeStart(calls),
    });
    await factory({
      probe: "p",
      profile: "app",
      lecturerState: LECTURER_STATE,
      decisionsSummary: "Kompetenz-Check: bestanden (2 Runden)",
    });
    expect(calls[0]!.lecturerState).toEqual(LECTURER_STATE);
    expect(calls[0]!.decisionsSummary).toBe("Kompetenz-Check: bestanden (2 Runden)");
  });

  // Scenario: *A probe that declares neither prior is unchanged*.
  it("forwards NEITHER key when the probe declares neither — not even as undefined", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeFakeStart(calls),
    });
    await factory({ probe: "p", profile: "headless" });
    expect("lecturerState" in calls[0]!).toBe(false);
    expect("decisionsSummary" in calls[0]!).toBe(false);
  });
});

// fix/eval-runner-provider-errors: a provider/auth failure on the candidate call
// surfaces as error events on the (normalized) subscribe stream while `prompt()` resolves
// normally. Left undecoded, the turn drained to `assistant: ""` and the judge
// seriously scored the empty transcript (observed live: OpenRouter answered every
// call with HTTP 401 "User not found." and the run exited 1 instead of 3).
describe("PiEvalSession provider-error fail fast", () => {
  /** Fake start whose session replays one canned normalized-event batch per prompt() call. */
  function makeStartEmitting(eventsPerPrompt: CbeRuntimeEvent[][]): StartSessionLike {
    return async (opts) => {
      let cb: ((e: CbeRuntimeEvent) => void) | undefined;
      let call = 0;
      return {
        session: {
          subscribe(fn: (e: CbeRuntimeEvent) => void) {
            cb = fn;
            return () => {
              cb = undefined;
            };
          },
          async prompt() {
            for (const e of eventsPerPrompt[call] ?? []) cb?.(e);
            call += 1;
          },
          dispose() {},
        },
        env: { profile: opts.profile, affordances: {} },
      } satisfies StartSessionResultLike;
    };
  }

  function factoryWith(eventsPerPrompt: CbeRuntimeEvent[][]) {
    return createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot: scratchWorkspaceRoot(),
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeStartEmitting(eventsPerPrompt),
    });
  }

  const auth401: CbeRuntimeEvent = {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: '401 {"error":{"message":"User not found.","code":401}}',
      text: "",
      toolCallCount: 0,
    },
  };

  it("rejects with a ProviderError naming HTTP status and provider message when the turn ends in an error with no output", async () => {
    const factory = factoryWith([[auth401]]);
    const session = await factory({ probe: "p", profile: "headless" });
    const err = await session.sendTurn("hello").then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(401);
    expect((err as ProviderError).message).toMatch(/401/);
    expect((err as ProviderError).message).toMatch(/User not found/);
  });

  it("rejects on the stream_error event that kills a stream before any text", async () => {
    const factory = factoryWith([
      [{ type: "stream_error", reason: "aborted", errorMessage: "502 upstream unavailable" }],
    ]);
    const session = await factory({ probe: "p", profile: "headless" });
    await expect(session.sendTurn("hello")).rejects.toBeInstanceOf(ProviderError);
  });

  it("does not reject when a mid-turn error is recovered and assistant text still arrives (runtime auto-retry)", async () => {
    const factory = factoryWith([
      [
        { type: "stream_error", reason: "aborted", errorMessage: "429 rate limited" },
        { type: "text_delta", delta: "recovered reply" },
      ],
    ]);
    const session = await factory({ probe: "p", profile: "headless" });
    const r = await session.sendTurn("hello");
    expect(r.assistant).toBe("recovered reply");
  });

  it("does not leak a previous turn's error into the next turn", async () => {
    const factory = factoryWith([[auth401], [{ type: "text_delta", delta: "second turn ok" }]]);
    const session = await factory({ probe: "p", profile: "headless" });
    await expect(session.sendTurn("first")).rejects.toBeInstanceOf(ProviderError);
    const r = await session.sendTurn("second");
    expect(r.assistant).toBe("second turn ok");
  });
});

// change make-eval-measure-the-product, Requirement: *The eval session runs in an
// isolated workspace outside the repository*.
//
// The bug this guards: `startCbeSession` defaults `cwd` to `process.cwd()` and the
// runner passed none, so an eval session's cwd was the repo root — and pi's
// `loadProjectContextFiles` walks cwd AND EVERY ANCESTOR for `AGENTS.md`, inlining
// the repo's engineering handbook into the system prompt as `<project_instructions>`
// (measured: 41,936 chars, 73.1 % of a 57,214-char prompt). The desktop app never
// loads it. The consequence half — the composed prompt itself — is asserted in
// `packages/pi-bridge/tests/eval-workspace-prompt.test.ts`; here we assert the
// wiring that produces it.
describe("createPiEvalSessionFactory — the agent's cwd is an isolated workspace", () => {
  const REPO_ROOT = nodePath.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");

  // Scenario: *Each eval session gets its own workspace as the agent's cwd*.
  it("gives each session a distinct, existing cwd under the workspace root, never the repo root", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const workspaceRoot = scratchWorkspaceRoot();
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot,
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: makeFakeStart(calls),
    });
    await factory({ probe: "a", profile: "app" });
    await factory({ probe: "b", profile: "app" });

    const cwds = calls.map((c) => c.cwd);
    expect(cwds.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(cwds).size).toBe(2);
    for (const cwd of cwds as string[]) {
      expect(existsSync(cwd)).toBe(true);
      expect(nodePath.dirname(cwd)).toBe(workspaceRoot);
      expect(nodePath.resolve(cwd)).not.toBe(nodePath.resolve(REPO_ROOT));
    }
  });

  // Scenario: *A workspace root inside the repository is refused*. The ancestor walk
  // is why a path under `evaluation/cbe-skill/runs/` would not have been a fix.
  it("refuses a workspace root that resolves inside the repository", () => {
    // Passing the temp dir itself as the "repo root" makes the derived workspace a
    // descendant of it — the exact geometry the guard exists to reject.
    expect(() => evalWorkspaceRoot("2026-01-01T00-00-00-000Z", tmpdir())).toThrow(/inside the repository/i);
  });

  it("derives a per-run root outside the repository for the real repo root", () => {
    const a = evalWorkspaceRoot("run-A", REPO_ROOT);
    const b = evalWorkspaceRoot("run-B", REPO_ROOT);
    expect(a).not.toBe(b);
    for (const root of [a, b]) {
      const rel = nodePath.relative(REPO_ROOT, root);
      expect(rel.startsWith("..") || nodePath.isAbsolute(rel)).toBe(true);
    }
  });
});
