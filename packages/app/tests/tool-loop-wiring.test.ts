/**
 * Wiring test for Tool-Call Loop Remediation (capability `agent-harness`).
 *
 * Drives the SAME pieces the IPC subscribe closure drives — the pure
 * `ToolLoopDetector` plus `applyLoopVerdict` and the `turnRemediating` guard — over
 * a synthetic tool-call stream, against a fake session spy. Covers the wiring
 * obligations of task 2.4 and Scenario _Aborted turn leaves the session continuable_.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolLoopDetector, type ToolCallRecord } from "@cbe/pi-bridge";
import { applyLoopVerdict } from "../src/main/tool-loop-remediation.js";
import { en } from "../src/shared/i18n/en.js";

function harness() {
  const detector = new ToolLoopDetector();
  const steer = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const transcript: Array<{ role: "user" | "assistant"; text: string }> = [];
  const errors: string[] = [];
  let draftCleared = 0;
  let remediating = false;
  let closed = false; // a real session is NOT closed by abort

  // Mirrors the ipc.ts tool_execution_end branch.
  function feed(rec: ToolCallRecord) {
    if (remediating) return;
    const verdict = detector.record(rec);
    remediating = applyLoopVerdict(verdict, {
      session: { steer, abort },
      transcript,
      emitError: (m) => errors.push(m),
      clearDraft: () => {
        draftCleared += 1;
      },
    });
  }

  return {
    feed,
    reset: () => detector.reset(),
    steer,
    abort,
    transcript,
    errors,
    get draftCleared() {
      return draftCleared;
    },
    get remediating() {
      return remediating;
    },
    get closed() {
      return closed;
    },
  };
}

const wrong: ToolCallRecord = { toolName: "read", args: { path: "/wrong/SKILL.md" }, isError: true };

describe("Tool-Call Loop Remediation wiring", () => {
  it("steers exactly once on the 3rd identical/failing call and aborts at the hard cap (6)", () => {
    const h = harness();
    for (let i = 0; i < 6; i++) h.feed(wrong);

    expect(h.steer).toHaveBeenCalledTimes(1);
    expect(h.abort).toHaveBeenCalledTimes(1);
    // The steering correction points the model back at the verbatim <location>.
    expect(h.steer.mock.calls[0][0]).toMatch(/EXACT `<location>`|verbatim/i);
  });

  it("after abort, further calls in the same run are ignored (guard holds)", () => {
    const h = harness();
    for (let i = 0; i < 8; i++) h.feed(wrong); // 2 extra calls past the cap
    expect(h.abort).toHaveBeenCalledTimes(1); // not re-aborted
  });

  // Scenario: Aborted turn leaves the session continuable.
  it("on abort keeps the session open, appends a neutral assistant note, clears the draft, and emits an error", () => {
    const h = harness();
    for (let i = 0; i < 6; i++) h.feed(wrong);

    expect(h.closed).toBe(false); // abort does not close the session
    expect(h.transcript).toEqual([{ role: "assistant", text: en.errorLoopAbortNote }]);
    expect(h.draftCleared).toBe(1);
    expect(h.errors).toEqual([en.errorLoopAbortNote]);
  });

  it("resets at the agent-run boundary so a loop does not leak across user prompts", () => {
    const h = harness();
    h.feed(wrong);
    h.feed(wrong); // 2 in this run — no steer yet
    expect(h.steer).not.toHaveBeenCalled();

    h.reset(); // new agent run (new user prompt)
    h.feed(wrong);
    h.feed(wrong);
    expect(h.steer).not.toHaveBeenCalled(); // only 2 in the new run
    h.feed(wrong); // 3rd in the new run → steer
    expect(h.steer).toHaveBeenCalledTimes(1);
  });
});
