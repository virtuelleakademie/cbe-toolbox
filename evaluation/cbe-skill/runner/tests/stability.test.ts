/**
 * Variance attribution across the two repetition levels. Pure functions plus the
 * judge-repeat aware scorer driven by a stubbed client — no model is contacted.
 *
 * spec: cbe-skill-eval-harness, Requirement
 * "Judge-only repetition separates judge variance from model variance"
 */

import { describe, it, expect } from "vitest";
import {
  JUDGE_REPEAT_HELP,
  REPEAT_HELP,
  attributeStability,
  countFlips,
  dispersedIds,
  foldJudgeRuns,
  isStable,
  renderStabilityLine,
  type ScoredTranscript,
} from "../src/stability.js";
import { scoreProbeRepeated } from "../src/scorer.js";
import { renderFindingsMd, renderReportJson, aggregateStability, type ReportMeta } from "../src/reporter.js";
import type { CheckResult, Probe, Transcript, Verdict } from "../src/types.js";
import type { LlmClient, LlmCompletion } from "../src/judge-client.js";

const META: ReportMeta = { model: "qwen", skillVersion: "v0.1", date: "2026-08-06", iteration: 1 };
const TEMPLATE = "rubric:{{rubric}} transcript:{{transcript}}";

const cr = (id: string, verdict: Verdict): CheckResult => ({ id, type: "judge", verdict });

/** One transcript scored N times, each scoring given verbatim. */
function scored(runs: Verdict[][], ids = ["c1"]): ScoredTranscript {
  const judgeRuns = runs.map((verdicts) => verdicts.map((v, i) => cr(ids[i]!, v)));
  return { results: foldJudgeRuns(judgeRuns), judgeRuns: judgeRuns.length > 1 ? judgeRuns : [] };
}

describe("foldJudgeRuns", () => {
  // spec: Judge repetitions fold through the majority rule
  it("folds pass/pass/fail on one transcript to pass", () => {
    const folded = foldJudgeRuns([[cr("c1", "pass")], [cr("c1", "pass")], [cr("c1", "fail")]]);
    expect(folded[0]!.verdict).toBe("pass");
  });

  // spec: An even-count tie resolves to the worse verdict
  it("resolves a pass/fail tie to fail", () => {
    expect(foldJudgeRuns([[cr("c1", "pass")], [cr("c1", "fail")]])[0]!.verdict).toBe("fail");
  });

  it("lets not-assessable win a tie against pass — the documented majorityVerdict edge", () => {
    expect(foldJudgeRuns([[cr("c1", "pass")], [cr("c1", "not-assessable")]])[0]!.verdict).toBe("not-assessable");
  });

  it("passes a single run through unchanged", () => {
    const runs = [[cr("c1", "partial")]];
    expect(foldJudgeRuns(runs)).toBe(runs[0]);
  });
});

describe("dispersedIds", () => {
  it("names only the ids whose verdict was not identical across runs", () => {
    const runs = [
      [cr("a", "pass"), cr("b", "fail")],
      [cr("a", "fail"), cr("b", "fail")],
    ];
    expect(dispersedIds(runs)).toEqual(["a"]);
  });

  it("reports nothing for a single run", () => {
    expect(dispersedIds([[cr("a", "pass")]])).toEqual([]);
  });
});

describe("attributeStability", () => {
  // spec: A verdict that flips on one fixed transcript is attributed to the judge
  it("attributes a flip within one transcript to the judge, not the model", () => {
    const report = attributeStability([scored([["pass"], ["fail"], ["pass"]])], 3);
    expect(report.judgeUnstable).toEqual(["c1"]);
    expect(report.modelUnstable).toEqual([]);
    expect(isStable(report)).toBe(false);
  });

  // spec: A verdict stable per transcript but different across transcripts is attributed to the model
  it("attributes a flip only between transcripts to the model, not the judge", () => {
    const report = attributeStability(
      [scored([["pass"], ["pass"], ["pass"]]), scored([["fail"], ["fail"], ["fail"]])],
      3
    );
    expect(report.judgeUnstable).toEqual([]);
    expect(report.modelUnstable).toEqual(["c1"]);
  });

  it("reports a stable checkpoint as stable at both levels", () => {
    const report = attributeStability([scored([["pass"], ["pass"]]), scored([["pass"], ["pass"]])], 2);
    expect(isStable(report)).toBe(true);
    expect(renderStabilityLine(countFlips([report]))).toMatch(/no checkpoint flipped/);
  });

  it("records both when a checkpoint moves at both levels", () => {
    const report = attributeStability(
      [scored([["pass"], ["fail"], ["pass"]]), scored([["fail"], ["fail"], ["fail"]])],
      3
    );
    expect(report.judgeUnstable).toEqual(["c1"]);
    expect(report.modelUnstable).toEqual(["c1"]);
    expect(renderStabilityLine(countFlips([report]))).toMatch(
      /1 judge-attributable flip\(s\), 1 model-attributable flip\(s\)/
    );
  });
});

describe("scoreProbeRepeated", () => {
  const transcript: Transcript = {
    probe: "p",
    model: "m",
    turns: [{ user: "u", assistant: "the needle is here", tools: [{ name: "cbe_cite" }] }],
  };
  const probe: Probe = {
    probe: "p",
    scenarioFile: "f.md",
    setup: { profile: "app" },
    turns: ["u"],
    checkpoints: [
      { id: "d1", type: "deterministic", check: { kind: "contains", pattern: "needle" } },
      { id: "j1", type: "judge", rubric: "does it answer?" },
    ],
  };

  function judge(verdicts: Verdict[]): LlmClient & { calls: number } {
    const c = {
      modelId: "stub",
      tokensUsed: 0,
      calls: 0,
      async complete(): Promise<LlmCompletion> {
        const v = verdicts[c.calls] ?? verdicts[verdicts.length - 1]!;
        c.calls += 1;
        return { text: JSON.stringify({ verdict: v }) };
      },
    };
    return c;
  }

  // spec: Deterministic checkpoints are scored once per transcript
  it("scores the deterministic checkpoint once and the judge checkpoint N times", async () => {
    const client = judge(["pass", "pass", "fail"]);
    const result = await scoreProbeRepeated(
      probe,
      transcript,
      { corpusIds: new Set(), judge: { client, template: TEMPLATE } },
      3
    );
    expect(client.calls).toBe(3); // three judge calls, not six — the deterministic check is not repeated
    expect(result.judgeRuns.every((run) => run.map((r) => r.id))).toBeTruthy();
    expect(result.judgeRuns.flat().map((r) => r.id)).toEqual(["j1", "j1", "j1"]);
    // Order and both checkpoints are preserved in the folded result.
    expect(result.results.map((r) => r.id)).toEqual(["d1", "j1"]);
    expect(result.results[0]!.verdict).toBe("pass");
    expect(result.results[1]!.verdict).toBe("pass"); // majority of pass/pass/fail
  });

  it("never marks a deterministic checkpoint judge-unstable", async () => {
    const client = judge(["pass", "fail"]);
    const s = await scoreProbeRepeated(
      probe,
      transcript,
      { corpusIds: new Set(), judge: { client, template: TEMPLATE } },
      2
    );
    const report = attributeStability([s], 2);
    expect(report.judgeUnstable).toEqual(["j1"]);
    expect(report.judgeUnstable).not.toContain("d1");
  });

  it("carries no dispersion information at a judge repeat of 1", async () => {
    const client = judge(["pass"]);
    const s = await scoreProbeRepeated(
      probe,
      transcript,
      { corpusIds: new Set(), judge: { client, template: TEMPLATE } },
      1
    );
    expect(s.judgeRuns).toEqual([]);
    expect(attributeStability([s], 1).judgeUnstable).toEqual([]);
  });
});

describe("stability in the run artifacts", () => {
  // spec: Instability is visible in the run artifacts
  it("names judge- and model-attributable ids in findings.md and report.json", () => {
    const stability = attributeStability(
      [scored([["pass"], ["fail"]], ["c1"]), scored([["fail"], ["fail"]], ["c1"])],
      2
    );
    const report = { probe: "7a", model: "qwen", results: [cr("c1", "fail")], stability };
    const md = renderFindingsMd(report, META);
    expect(md).toContain("Verdict stability");
    expect(md).toMatch(/Judge-attributable flips.*c1/);
    const json = renderReportJson(report, META) as { stability?: { judgeUnstable: string[] } };
    expect(json.stability!.judgeUnstable).toEqual(["c1"]);
  });

  it("omits the stability section when nothing flipped", () => {
    const stability = attributeStability([scored([["pass"], ["pass"]])], 2);
    const md = renderFindingsMd({ probe: "7a", model: "qwen", results: [cr("c1", "pass")], stability }, META);
    expect(md).not.toContain("Verdict stability");
  });

  it("aggregates distinct flip ids across probes", () => {
    const a = attributeStability([scored([["pass"], ["fail"]], ["c1"])], 2);
    const b = attributeStability([scored([["pass"], ["fail"]], ["c2"])], 2);
    expect(
      aggregateStability([
        { probe: "1", model: "m", results: [], stability: a },
        { probe: "2", model: "m", results: [], stability: b },
      ])
    ).toEqual({ judgeFlips: 2, modelFlips: 0 });
  });

  it("counts the index.json aggregate and the printed summary from one source", () => {
    const a = attributeStability([scored([["pass"], ["fail"]], ["c1"])], 2);
    const b = attributeStability([scored([["pass"], ["fail"]], ["c2"])], 2);
    const reports = [
      { probe: "1", model: "m", results: [], stability: a },
      { probe: "2", model: "m", results: [], stability: b },
      // A probe without a stability block must not disturb the union.
      { probe: "3", model: "m", results: [] },
    ];
    expect(aggregateStability(reports)).toEqual(countFlips([a, b]));
    expect(renderStabilityLine(aggregateStability(reports))).toMatch(/2 judge-attributable flip\(s\)/);
  });
});

// spec: The two repeat flags are documented as distinct
describe("CLI help for the two repeat flags", () => {
  it("describes --repeat as a full probe re-run and --judge-repeat as a re-scoring", () => {
    expect(REPEAT_HELP).toMatch(/MODEL variance/);
    expect(REPEAT_HELP).toMatch(/re-runs the whole probe/);
    expect(JUDGE_REPEAT_HELP).toMatch(/JUDGE variance/);
    expect(JUDGE_REPEAT_HELP).toMatch(/re-scores the SAME transcript/);
    expect(REPEAT_HELP).not.toBe(JUDGE_REPEAT_HELP);
  });
});
