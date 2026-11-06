/**
 * Tests for the Tool-Call Loop Remediation detector (capability `agent-harness`,
 * Requirement: Tool-Call Loop Remediation). One test per Scenario.
 */
import { describe, it, expect } from "vitest";
import { ToolLoopDetector, LOOP_STEER_AT, LOOP_ABORT_AT, type ToolCallRecord } from "../src/tool-loop-detector.js";

/** Feed a sequence, return the verdict for each record. */
function run(records: ToolCallRecord[]) {
  const d = new ToolLoopDetector();
  return records.map((r) => d.record(r));
}

const readWrong: ToolCallRecord = { toolName: "read", args: { path: "/wrong/SKILL.md" }, isError: true };
const readSame: ToolCallRecord = { toolName: "read", args: { path: "/x/SKILL.md" } }; // success, identical args

describe("ToolLoopDetector — Scenario: K identical tool calls in a turn trigger a steering correction", () => {
  it("steers on the 3rd identical successful call and includes a correction", () => {
    const verdicts = run([readSame, readSame, readSame]);
    expect(verdicts[0].action).toBe("none");
    expect(verdicts[1].action).toBe("none");
    expect(verdicts[2].action).toBe("steer");
    expect(LOOP_STEER_AT).toBe(3);
    expect(verdicts[2].correction).toMatch(/already have the result|proceed to the next step/i);
  });

  it("steers at most once per signature (the 4th and 5th identical call do not re-steer)", () => {
    const verdicts = run([readSame, readSame, readSame, readSame, readSame]);
    expect(verdicts[2].action).toBe("steer");
    expect(verdicts[3].action).toBe("none");
    expect(verdicts[4].action).toBe("none");
  });
});

describe("ToolLoopDetector — Scenario: Repeated same-path failing reads trigger remediation", () => {
  it("steers on the 3rd consecutive same-path ENOENT and the correction points at the verbatim <location>", () => {
    const verdicts = run([readWrong, readWrong, readWrong]);
    expect(verdicts[2].action).toBe("steer");
    expect(verdicts[2].correction).toMatch(/EXACT `<location>`|verbatim/i);
    expect(verdicts[2].correction).toMatch(/do not shorten|reconstruct/i);
  });

  it("coalesces same-path failures even when other args differ (signature keys on path)", () => {
    const a: ToolCallRecord = { toolName: "read", args: { path: "/wrong", extra: 1 }, isError: true };
    const b: ToolCallRecord = { toolName: "read", args: { path: "/wrong", extra: 2 }, isError: true };
    const verdicts = run([a, b, a]);
    expect(verdicts[2].action).toBe("steer");
  });
});

describe("ToolLoopDetector — Scenario: A persisting loop after steering aborts the turn", () => {
  it("steers at 3 then aborts at the hard cap (6) for the same signature", () => {
    const verdicts = run(Array.from({ length: 6 }, () => readWrong));
    expect(verdicts[2].action).toBe("steer");
    expect(verdicts[3].action).toBe("none");
    expect(verdicts[4].action).toBe("none");
    expect(verdicts[5].action).toBe("abort");
    expect(LOOP_ABORT_AT).toBe(6);
  });

  it("a successful different call breaks the run so the counter restarts", () => {
    // wrong, wrong, (success elsewhere resets run), wrong, wrong → no steer yet.
    const other: ToolCallRecord = { toolName: "read", args: { path: "/different/ok" } };
    const verdicts = run([readWrong, readWrong, other, readWrong, readWrong]);
    expect(verdicts.every((v) => v.action !== "abort")).toBe(true);
    expect(verdicts[4].action).toBe("none"); // run restarted at the `other` call
  });
});

describe("ToolLoopDetector — Scenario: Detection never keys on the model name", () => {
  it("decides purely from the tool-call stream — record() takes no model input and identical streams yield identical verdicts", () => {
    // Structural: the only inputs are toolName/args/isError. Two runs with the same
    // tool stream (any notion of 'model' is irrelevant because it cannot be passed)
    // produce identical verdicts.
    const seq = [readWrong, readWrong, readWrong];
    expect(run(seq).map((v) => v.action)).toEqual(run(seq).map((v) => v.action));
  });
});

describe("ToolLoopDetector — Scenario: Detection state resets at the agent-run boundary", () => {
  it("identical calls across a reset() do not accumulate toward the threshold", () => {
    const d = new ToolLoopDetector();
    expect(d.record(readWrong).action).toBe("none");
    expect(d.record(readWrong).action).toBe("none");
    d.reset(); // agent-run boundary (new user prompt)
    expect(d.record(readWrong).action).toBe("none"); // counter restarted, only 1 in this turn
    expect(d.record(readWrong).action).toBe("none"); // 2
    expect(d.record(readWrong).action).toBe("steer"); // 3rd in the new turn
  });
});
