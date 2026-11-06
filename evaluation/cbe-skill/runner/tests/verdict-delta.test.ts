import { describe, it, expect } from "vitest";
import { classifyVerdictDelta, majorityVerdict } from "../src/types.js";
import type { CheckResult, Verdict } from "../src/types.js";

const r = (id: string, verdict: Verdict): CheckResult => ({ id, type: "judge", verdict });

describe("classifyVerdictDelta", () => {
  it("counts fail->partial and partial->pass on targeted ids as improvements", () => {
    const prev = [r("a", "fail"), r("b", "partial")];
    const next = [r("a", "partial"), r("b", "pass")];
    const d = classifyVerdictDelta(prev, next, {
      targeted: new Set(["a", "b"]),
      inScope: new Set(["a", "b"]),
    });
    expect(d.improved.sort()).toEqual(["a", "b"]);
    expect(d.regressed).toEqual([]);
  });

  it("counts pass->fail and pass->partial on in-scope ids as regressions", () => {
    const prev = [r("a", "pass"), r("b", "pass")];
    const next = [r("a", "fail"), r("b", "partial")];
    const d = classifyVerdictDelta(prev, next, {
      targeted: new Set(),
      inScope: new Set(["a", "b"]),
    });
    expect(d.improved).toEqual([]);
    expect(d.regressed.sort()).toEqual(["a", "b"]);
  });

  it("does not credit improvement on a non-targeted id", () => {
    const prev = [r("a", "fail")];
    const next = [r("a", "pass")];
    const d = classifyVerdictDelta(prev, next, { targeted: new Set(), inScope: new Set(["a"]) });
    expect(d.improved).toEqual([]);
  });

  it("ignores ids outside the in-scope set entirely (regression side)", () => {
    const prev = [r("noise", "pass")];
    const next = [r("noise", "fail")];
    const d = classifyVerdictDelta(prev, next, { targeted: new Set(), inScope: new Set() });
    expect(d.regressed).toEqual([]);
  });

  it("treats transitions touching not-assessable/error as neither", () => {
    const prev = [r("a", "fail"), r("b", "pass")];
    const next = [r("a", "not-assessable"), r("b", "error")];
    const d = classifyVerdictDelta(prev, next, {
      targeted: new Set(["a"]),
      inScope: new Set(["a", "b"]),
    });
    expect(d.improved).toEqual([]);
    expect(d.regressed).toEqual([]);
  });

  it("ignores an id present in prev but absent in next", () => {
    const prev = [r("a", "fail"), r("gone", "pass")];
    const next = [r("a", "pass")]; // 'gone' missing
    const d = classifyVerdictDelta(prev, next, {
      targeted: new Set(["a"]),
      inScope: new Set(["a", "gone"]),
    });
    expect(d.improved).toEqual(["a"]);
    expect(d.regressed).toEqual([]); // missing id is not a regression
  });

  it("yields no improvement when the targeted set is empty", () => {
    const prev = [r("a", "fail")];
    const next = [r("a", "pass")];
    const d = classifyVerdictDelta(prev, next, { targeted: new Set(), inScope: new Set(["a"]) });
    expect(d.improved).toEqual([]);
    expect(d.regressed).toEqual([]);
  });
});

describe("majorityVerdict", () => {
  it("keeps the majority verdict per checkpoint across runs", () => {
    const runs = [[r("a", "pass")], [r("a", "fail")], [r("a", "pass")]];
    expect(majorityVerdict(runs)).toEqual([r("a", "pass")]);
  });

  it("a single minority flip does not change the reduced verdict", () => {
    const prevReduced = majorityVerdict([[r("a", "pass")], [r("a", "pass")], [r("a", "fail")]]);
    const nextReduced = majorityVerdict([[r("a", "pass")], [r("a", "fail")], [r("a", "pass")]]);
    // both reduce to pass -> classifyVerdictDelta sees no change
    const d = classifyVerdictDelta(prevReduced, nextReduced, {
      targeted: new Set(["a"]),
      inScope: new Set(["a"]),
    });
    expect(d.improved).toEqual([]);
    expect(d.regressed).toEqual([]);
  });

  it("breaks ties toward the more conservative (lower-ranked) verdict", () => {
    const runs = [[r("a", "pass")], [r("a", "fail")]];
    expect(majorityVerdict(runs)[0]!.verdict).toBe("fail");
  });

  it("preserves the id set, first-seen order, and template fields across multiple ids", () => {
    const runs = [
      [
        { id: "x", type: "judge", verdict: "pass", reasoning: "keep me" } as CheckResult,
        { id: "y", type: "deterministic", verdict: "fail" } as CheckResult,
      ],
      [r("x", "pass"), r("y", "pass")],
    ];
    const out = majorityVerdict(runs);
    expect(out.map((c) => c.id)).toEqual(["x", "y"]); // order preserved
    expect(out[0]).toEqual({ id: "x", type: "judge", verdict: "pass", reasoning: "keep me" });
    expect(out[1]!.type).toBe("deterministic"); // template carried from first occurrence
    expect(out[1]!.verdict).toBe("fail"); // 1-1 tie -> conservative (fail)
  });
});
