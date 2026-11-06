/**
 * The host's initial step focus through the REAL `startCbeSession` (capability
 * `agent-harness`, Requirement: *Host-Set Initial Step Focus*).
 *
 * `initial-step-focus.test.ts` covers the mirror and the descriptor renderer in
 * isolation; this file exists because the two lines that make the delta's
 * *The prior reports a starting point* and *The seeded focus arms no
 * post-compaction handover* scenarios true are WIRINGS, not logic — the seed's
 * route into the descriptor and the handover's `recordedList()` source. Both were
 * re-implemented by test doubles and nothing exercised the production path, so
 * reverting either to `list()` left every suite green. Session construction does
 * not call the model, so the real factory runs against an offline provider.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartSessionOptions } from "../src/session.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function baseOpts(): Omit<StartSessionOptions, "profile"> {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-initial-focus-session-"));
  return {
    skillDir: path.resolve(__dirname, "..", "..", "..", "skills", "cbe"),
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  };
}

describe("Host-Set Initial Step Focus — real startCbeSession wiring", () => {
  it("routes the seed into the descriptor's step prior as a starting point", async () => {
    const started = await startCbeSession({ profile: "app", ...baseOpts(), initialStepFocus: true });
    try {
      expect(started.stepMirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
      expect(started.stepMirror.holdsOnlySeededFocus()).toBe(true);
      const block = started.env.toSystemPromptBlock();
      expect(block).toContain("step-coverage prior (design-flow starting point — no coverage recorded yet):");
      expect(block).toContain('step 1: "open" (in focus)');
      expect(block).not.toContain("carried over from the previous conversation");
      expect(block).not.toContain("Work continues on step");
    } finally {
      started.session.dispose();
    }
  });

  it("arms no post-compaction handover while only the seed stands", async () => {
    const started = await startCbeSession({ profile: "app", ...baseOpts(), initialStepFocus: true });
    try {
      started.retainedStateHandover.markCompacted();
      expect(started.retainedStateHandover.drain()).toBeNull();
      // The first real transition is recorded work, and the handover carries it.
      started.stepMirror.applyToolResult({ kind: "step-update", step: 2, depth: "rough", focus: true });
      started.retainedStateHandover.markCompacted();
      expect(started.retainedStateHandover.drain()).toContain('step 2: "rough" (in focus)');
    } finally {
      started.session.dispose();
    }
  });

  it("hands over a canvas write that landed on the already-seeded step 1", async () => {
    const started = await startCbeSession({ profile: "app", ...baseOpts(), initialStepFocus: true });
    try {
      started.stepMirror.applyCanvasWrite(1);
      started.retainedStateHandover.markCompacted();
      expect(started.retainedStateHandover.drain()).toContain('step 1: "open" (in focus)');
    } finally {
      started.session.dispose();
    }
  });

  it("lets a carry-over win over the seed and keeps its recorded-coverage wording", async () => {
    const started = await startCbeSession({
      profile: "app",
      ...baseOpts(),
      initialStepFocus: true,
      stepCoverage: [{ step: 6, depth: "rough", focus: true }],
    });
    try {
      expect(started.stepMirror.list()).toEqual([{ step: 6, depth: "rough", focus: true }]);
      expect(started.stepMirror.holdsOnlySeededFocus()).toBe(false);
      const block = started.env.toSystemPromptBlock();
      expect(block).toContain("carried over from the previous conversation");
      expect(block).toContain("Work continues on step 6.");
      started.retainedStateHandover.markCompacted();
      expect(started.retainedStateHandover.drain()).toContain('step 6: "rough" (in focus)');
    } finally {
      started.session.dispose();
    }
  });

  it("renders no step prior and arms no handover without the seed", async () => {
    const started = await startCbeSession({ profile: "app", ...baseOpts() });
    try {
      expect(started.stepMirror.list()).toEqual([]);
      expect(started.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
      started.retainedStateHandover.markCompacted();
      expect(started.retainedStateHandover.drain()).toBeNull();
    } finally {
      started.session.dispose();
    }
  });
});
