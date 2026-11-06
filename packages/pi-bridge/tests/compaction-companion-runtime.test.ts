/**
 * The compaction companion on the REAL Pi 1.3 runtime (capability
 * `agent-harness`, Requirement: *Compaction Companion — Artefact Consolidation
 * Before Context Compaction*; change `adopt-settled-pi-runtime-lifecycle`,
 * task 3.3).
 *
 * `compaction-companion-extension.test.ts` proves the extension against a hook
 * harness; this file drives `startCbeSession` through the public provider seam
 * so Pi itself fires `session_before_compact`, runs the steered re-trigger,
 * reports a failed summary and — Pi 1.x's mid-run compaction — compacts
 * repeatedly inside ONE run, where only the settled-state reset keeps the
 * small-context bound meaningful.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import type { CbeRuntimeEvent } from "../src/runtime/contracts.js";
import type { CompanionPhase } from "../src/compaction-companion-extension.js";
import { installScriptedProvider, type ScriptedProvider } from "./helpers/scripted-provider.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const SMALL_WINDOW = { compaction: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1 } };
const UNMIRRORED_DECISION = "We decided the Big Idea is circular urban food systems.";

let tmp: string;
let script: ScriptedProvider;
let started: StartCbeSessionResult | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-companion-rt-"));
  script = installScriptedProvider();
});

afterEach(() => {
  started?.session.dispose();
  started = undefined;
  script.uninstall();
  rmSync(tmp, { recursive: true, force: true });
});

async function start(maxConsecutiveCompactions?: number) {
  const cwd = path.join(tmp, "workspace");
  mkdirSync(cwd, { recursive: true });
  const phases: CompanionPhase[] = [];
  const tooSmall: string[] = [];
  started = await startCbeSession({
    profile: "app",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    sessionId: "companion",
    agentDir: path.join(tmp, "agent"),
    cwd,
    compaction: {
      onPhase: (p) => phases.push(p),
      onContextWindowTooSmall: (m) => tooSmall.push(m),
      ...(maxConsecutiveCompactions !== undefined ? { maxConsecutiveCompactions } : {}),
    },
    provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "m", contextLength: 20_000 },
  });
  piSessionOf(started.session).settingsManager.applyOverrides(SMALL_WINDOW as never);
  const events: CbeRuntimeEvent[] = [];
  started.session.subscribe((e) => events.push(e));
  return { result: started, events, phases, tooSmall };
}

const compactionEvents = (events: CbeRuntimeEvent[]) => events.filter((e) => e.type.startsWith("compaction_"));
const runBracket = (events: CbeRuntimeEvent[]) =>
  events.filter((e) => e.type === "agent_start" || e.type === "agent_end");

describe("Scenario: Consolidation check runs before compaction executes — real runtime", () => {
  it("direct: with nothing unmirrored the compaction proceeds unsteered and arms the handover", async () => {
    const { result, events, phases } = await start();
    script.push({ blocks: [{ kind: "text", text: "Erste Antwort." }] });
    await result.session.prompt("erste Frage");
    script.push(
      { blocks: [{ kind: "text", text: "Zweite Antwort." }], inputTokens: 19_000 },
      { blocks: [{ kind: "text", text: "## Zusammenfassung" }] },
      { blocks: [{ kind: "text", text: "## Präfix" }] }
    );

    await result.session.prompt("zweite Frage");

    expect(compactionEvents(events)).toEqual([
      { type: "compaction_start", reason: "threshold" },
      { type: "compaction_end", reason: "threshold", aborted: false, willRetry: false },
    ]);
    expect(phases).toEqual(["consolidating", "compacting", "idle"]);
    expect(result.retainedStateHandover.isPending()).toBe(true);
  });

  it("steered: an unmirrored decision cancels once and re-triggers Pi's compaction with the fenced excerpt", async () => {
    const { result, events, phases } = await start();
    script.push({ blocks: [{ kind: "text", text: "Notiert." }] });
    await result.session.prompt(UNMIRRORED_DECISION);
    script.push(
      { blocks: [{ kind: "text", text: "Zweite Antwort." }], inputTokens: 19_000 },
      { blocks: [{ kind: "text", text: "## Zusammenfassung" }] },
      { blocks: [{ kind: "text", text: "## Präfix" }] },
      { blocks: [{ kind: "text", text: "## Zusammenfassung 2" }] },
      { blocks: [{ kind: "text", text: "## Präfix 2" }] }
    );

    await result.session.prompt("zweite Frage");
    await expect.poll(() => phases.at(-1)).toBe("idle");

    // One completed compaction for the cycle, and the re-triggered summary
    // request carried the decision inside the data fence.
    expect(
      compactionEvents(events).filter((e) => e.type === "compaction_end" && !e.aborted && !e.errorMessage)
    ).toHaveLength(1);
    const steeredRequest = script.requests.find((r) =>
      r.userTexts.some((t) => t.includes("conversation-excerpts") && t.includes("circular urban food systems"))
    );
    expect(steeredRequest).toBeDefined();
    expect(phases).toEqual(expect.arrayContaining(["consolidating", "compacting", "idle"]));
    expect(result.retainedStateHandover.isPending()).toBe(true);
  });

  it("failed: a summary that cannot be produced leaves no handover and the run still settles once", async () => {
    const { result, events } = await start();
    script.push({ blocks: [{ kind: "text", text: "Erste Antwort." }] });
    await result.session.prompt("erste Frage");
    events.length = 0;
    script.push(
      { blocks: [{ kind: "text", text: "Zweite Antwort." }], inputTokens: 19_000 },
      { blocks: [], stopReason: "error", errorMessage: "summary endpoint failed" },
      { blocks: [], stopReason: "error", errorMessage: "summary endpoint failed" },
      { blocks: [], stopReason: "error", errorMessage: "summary endpoint failed" },
      { blocks: [], stopReason: "error", errorMessage: "summary endpoint failed" }
    );

    await result.session.prompt("zweite Frage");

    const end = compactionEvents(events).find((e) => e.type === "compaction_end");
    expect(end && end.type === "compaction_end" ? end.errorMessage : undefined).toBeTruthy();
    expect(result.retainedStateHandover.isPending()).toBe(false);
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
  });
});

describe("Scenario: Small-context loop is not re-triggered by the companion — real runtime", () => {
  it("trips the bound on repeated mid-run compactions inside ONE run (no settled reset between them)", async () => {
    const { result, events, tooSmall } = await start(2);
    script.push({ blocks: [{ kind: "text", text: "Erste." }] });
    await result.session.prompt("erste");
    events.length = 0;
    // Summary requests (tool-free) are answered by route, however many a
    // compaction makes; every agent tool turn pushes the context over the
    // threshold again.
    for (let i = 0; i < 12; i += 1) {
      script.routeWhen((r) => r.toolNames.length === 0, {
        blocks: [{ kind: "text", text: `## Zusammenfassung ${i}` }],
      });
    }
    for (let i = 0; i < 4; i += 1) {
      script.push({
        blocks: [{ kind: "toolCall", id: `c${i}`, name: "ls", args: { path: "." } }],
        inputTokens: 19_500,
      });
    }
    script.push({ blocks: [{ kind: "text", text: "Ende." }] });

    await result.session.prompt("zweite");

    // Two completed compactions; from then on the bound refuses every further
    // compaction of the run with the documented error (one per refusal) — all
    // inside one CBE run, because only a SETTLED run resets the counter.
    const completed = compactionEvents(events).filter(
      (e) => e.type === "compaction_end" && !e.aborted && !e.errorMessage
    );
    expect(completed).toHaveLength(2);
    expect(tooSmall.length).toBeGreaterThanOrEqual(1);
    for (const message of tooSmall) expect(message).toContain("contextLength");
    expect(result.retainedStateHandover.isPending()).toBe(false);
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
  });
});
