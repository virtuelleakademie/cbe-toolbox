/**
 * Wiring test for the Response-Cut-Off State, main-process half (capability
 * `desktop-app`, Requirement: Response-Cut-Off State with One-Click Continue
 * and Retry — Scenario: Surface verdicts reach the renderer, continue verdicts
 * stay host-side).
 *
 * Drives the SAME pieces the IPC subscribe closure drives — the pure
 * `TruncationDetector` fed via `completionEndSignalOf` plus
 * `applyTruncationVerdict` — over synthetic normalized `message_end` summaries
 * (the CBE-owned runtime event, `@cbe/pi-bridge/runtime`), against a
 * fake session spy and a renderer-event spy standing in for
 * `win.webContents.send`.
 */
import { describe, it, expect, vi } from "vitest";
import {
  TruncationDetector,
  applyTruncationVerdict,
  TRUNCATION_CONTINUE_MAX,
  type CbeMessageSummary,
} from "@cbe/pi-bridge";
import { completionEndSignalOf, CutOffSettlement } from "../src/main/truncation-remediation.js";

/** A normalized `message_end` summary, as the IPC bridge receives it. */
type EndMessage = CbeMessageSummary;

function harness() {
  const detector = new TruncationDetector();
  const steer = vi.fn().mockResolvedValue(undefined);
  const cutoffEvents: Array<{ type: "truncation_cutoff"; note: string }> = [];

  // Mirrors the ipc.ts message_end branch.
  function feed(message: EndMessage) {
    const verdict = detector.record(completionEndSignalOf(message));
    applyTruncationVerdict(verdict, {
      session: { steer },
      notifyCutOff: (note) => cutoffEvents.push({ type: "truncation_cutoff", note }),
    });
  }

  return { feed, reset: () => detector.reset(), steer, cutoffEvents };
}

/** A length-capped assistant message with a mid-sentence text tail. */
const truncated: EndMessage = {
  role: "assistant",
  stopReason: "length",
  text: "The challenge design should therefore start with the",
  toolCallCount: 0,
};

describe("Response-Cut-Off wiring (main process)", () => {
  // Scenario: Surface verdicts reach the renderer, continue verdicts stay host-side.
  it("continue verdicts steer the running session and emit no renderer event", () => {
    const h = harness();
    for (let i = 0; i < TRUNCATION_CONTINUE_MAX; i++) h.feed(truncated);

    expect(h.steer).toHaveBeenCalledTimes(TRUNCATION_CONTINUE_MAX);
    // The steering text asks the model to complete, not restart.
    expect(h.steer.mock.calls[0][0]).toMatch(/cut off|continue/i);
    expect(h.cutoffEvents).toEqual([]);
  });

  it("a surface verdict past the continue budget emits the cut-off event with the note", () => {
    const h = harness();
    for (let i = 0; i < TRUNCATION_CONTINUE_MAX + 1; i++) h.feed(truncated);

    expect(h.steer).toHaveBeenCalledTimes(TRUNCATION_CONTINUE_MAX); // no further steer
    expect(h.cutoffEvents).toHaveLength(1);
    expect(h.cutoffEvents[0]!.note).toMatch(/cut off/i);
  });

  it("resets at the run boundary so the continue budget does not leak across runs", () => {
    const h = harness();
    for (let i = 0; i < TRUNCATION_CONTINUE_MAX + 1; i++) h.feed(truncated); // budget spent → surface
    h.reset(); // next agent run (agent_start)
    h.feed(truncated);

    // The fresh run steers again instead of re-surfacing immediately.
    expect(h.steer).toHaveBeenCalledTimes(TRUNCATION_CONTINUE_MAX + 1);
    expect(h.cutoffEvents).toHaveLength(1);
  });

  it("a cleanly finished completion triggers neither steer nor event", () => {
    const h = harness();
    h.feed({ role: "assistant", stopReason: "stop", text: "All done.", toolCallCount: 0 });
    expect(h.steer).not.toHaveBeenCalled();
    expect(h.cutoffEvents).toEqual([]);
  });

  // Change `adopt-settled-pi-runtime-lifecycle`: the cut-off is settled at the
  // run's END, because Pi 1.x may still recover the answer after CBE's continue
  // budget is spent (omit the truncated attempt, compact, retry once).
  it("announces a surfaced cut-off at the settled end when the run settles truncated", () => {
    const settlement = new CutOffSettlement();
    settlement.reset();
    settlement.surface("cut off");
    expect(settlement.settle(false)).toBe("cut off");
    // Consumed: the next settle without a new surface announces nothing.
    expect(settlement.settle(false)).toBeNull();
  });

  it("drops a surfaced cut-off once a later completed answer in the same run recovers it", () => {
    const settlement = new CutOffSettlement();
    settlement.surface("cut off");
    // A tool call is not a finished answer...
    settlement.observeUntruncated({ role: "assistant", stopReason: "toolUse", text: "", toolCallCount: 1 });
    expect(settlement.settle(false)).toBe("cut off");
    settlement.surface("cut off");
    // ...Pi's recovered, untruncated answer is.
    settlement.observeUntruncated({
      role: "assistant",
      stopReason: "stop",
      text: "Complete answer.",
      toolCallCount: 0,
    });
    expect(settlement.settle(false)).toBeNull();
  });

  it("never announces a cut-off for a run the lecturer stopped", () => {
    const settlement = new CutOffSettlement();
    settlement.surface("cut off");
    expect(settlement.settle(true)).toBeNull();
  });

  it("completionEndSignalOf maps role, stopReason, text, and toolCallCount", () => {
    const signal = completionEndSignalOf({
      role: "assistant",
      stopReason: "length",
      text: "part one part two",
      toolCallCount: 1,
    });
    expect(signal).toEqual({
      role: "assistant",
      stopReason: "length",
      text: "part one part two",
      toolCallCount: 1,
    });
    // The same boundary owns completed-message inspection: protocol framing
    // cannot turn an otherwise complete answer into a false truncation signal.
    expect(
      completionEndSignalOf({ role: "assistant", stopReason: "stop", text: "All done.<turn|>", toolCallCount: 0 }).text
    ).toBe("All done.");
    // A degenerate summary (no role, no stop reason, no content) maps to a safe
    // empty signal.
    expect(completionEndSignalOf({ role: "", text: "", toolCallCount: 0 })).toEqual({
      role: "",
      stopReason: "",
      text: "",
      toolCallCount: 0,
    });
  });
});
