import { describe, it, expect } from "vitest";
import {
  summarize,
  renderReportJson,
  renderFindingsMd,
  buildMatrix,
  type ProbeReport,
  type ReportMeta,
} from "../src/reporter.js";
import type { CheckResult } from "../src/types.js";

const META: ReportMeta = { model: "qwen", skillVersion: "v0.1", date: "2026-05-29", iteration: 1 };

const results: CheckResult[] = [
  { id: "7a.1", type: "deterministic", verdict: "pass", evidence: "(corpus:vocabulary-001 ...)" },
  { id: "7a.2", type: "judge", verdict: "fail", reasoning: "did not frame competences" },
  { id: "7a.3", type: "deterministic", verdict: "not-assessable", reasoning: "picker off in headless" },
  { id: "7a.4", type: "judge", verdict: "error", reasoning: "judge_error" },
];

describe("reporter", () => {
  it("summarize counts verdicts and excludes not-assessable from the rate", () => {
    const s = summarize(results);
    expect(s.total).toBe(4);
    expect(s.pass).toBe(1);
    expect(s.notAssessable).toBe(1);
    expect(s.assessable).toBe(3); // total - not-assessable
    expect(s.passRate).toBeCloseTo(1 / 3);
  });

  // spec: Single-model run reports per-checkpoint results
  it("findings.md carries date, runner and a per-criterion verdict for each checkpoint", () => {
    const md = renderFindingsMd({ probe: "7a", model: "qwen", results }, META);
    expect(md).toContain("2026-05-29");
    expect(md).toContain("Runner:");
    for (const r of results) expect(md).toContain(r.id);
    expect(md).toContain("FAIL");
    expect(md).toContain("Failure modes seen");
  });

  // spec: An unreachable judge is reported as unreachable, not as miscalibrated
  it("findings.md names the unscored triples and their cause, even on an OK calibration", () => {
    const calibration = {
      judgeModel: "sonnet",
      threshold: 0.8,
      passRate: 1,
      failRate: 0.875,
      borderlineRate: 1,
      unscored: 1,
      unscoredCauses: { unreachable: 1, unusableReply: 0, unclassified: 0 },
      status: "ok" as const,
    };
    const md = renderFindingsMd({ probe: "7a", model: "qwen", results }, { ...META, calibration });
    expect(md).toContain("Judge calibration:** OK");
    expect(md).toContain("Unscored gold triples:");
    expect(md).toContain("1 judge unreachable");
    expect(md).toContain("the gold set is not the problem");
  });

  it("findings.md omits the unscored line when the judge scored every triple", () => {
    const calibration = {
      judgeModel: "sonnet",
      threshold: 0.8,
      passRate: 1,
      failRate: 1,
      borderlineRate: 1,
      unscored: 0,
      unscoredCauses: { unreachable: 0, unusableReply: 0, unclassified: 0 },
      status: "ok" as const,
    };
    const md = renderFindingsMd({ probe: "7a", model: "qwen", results }, { ...META, calibration });
    expect(md).not.toContain("Unscored gold triples:");
  });

  // spec: JSON report carries structured scores
  it("report.json has meta, items and summary", () => {
    const json = renderReportJson({ probe: "7a", model: "qwen", results }, META) as {
      meta: { probe: string; model: string };
      items: unknown[];
      summary: { total: number };
    };
    expect(json.meta.probe).toBe("7a");
    expect(json.meta.model).toBe("qwen");
    expect(json.items).toHaveLength(4);
    expect(json.summary.total).toBe(4);
  });

  // spec: Comparison run recommends the highest-passing model
  it("buildMatrix names the highest-passing model across the same probe set", () => {
    const shared = ["S3", "S6", "S7", "S8"].map((probe) => ({
      probe,
      model: "m",
      results: [{ id: "c", type: "judge" as const, verdict: "pass" as const }],
    }));
    const a: ProbeReport[] = [
      ...shared,
      { probe: "S1", model: "A", results: [{ id: "x", type: "judge", verdict: "pass" }] },
    ];
    const b: ProbeReport[] = [
      ...shared,
      { probe: "S1", model: "B", results: [{ id: "x", type: "judge", verdict: "fail" }] },
    ];
    const matrix = buildMatrix({ A: a, B: b });
    expect(matrix.recommendation).toBe("A");
    expect(matrix.cells.A!.passRate).toBe(1);
    expect(matrix.cells.B!.passRate).toBe(0.8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Equal-ranked scenarios (product decision 2026-08-07 — the gate is gone)
// ─────────────────────────────────────────────────────────────────────────────

import { runMetrics, renderRunSummaryMd, renderMatrixMd } from "../src/reporter.js";
import type { Transcript } from "../src/types.js";

const R = (probe: string, verdicts: Array<"pass" | "fail" | "not-assessable">) => ({
  probe,
  model: "m",
  results: verdicts.map((v, i) => ({ id: `${i}`, type: "judge" as const, verdict: v })),
});
const SUITE = [R("S3", ["pass"]), R("S6", ["pass"]), R("S7", ["pass"]), R("S8", ["pass"])];

describe("the run summary measures, it does not gate", () => {
  // The suite exists to MEASURE. No scenario outranks another, nothing is "green", and
  // no verdict fails the process — what a reader gets is a per-probe table plus the
  // explicit list of what did not pass, to route through `traceability.json`.
  it("lists EVERY probe in one equal-ranked table, with no gate/trend split", () => {
    const md = renderRunSummaryMd(
      [...SUITE, R("S1", ["fail"])],
      { sessions: 2, sessionsThatReadACorpusDocument: 1, corpusReadShare: 0.5, unprovenancedTokens: 0 },
      { skillVersion: "0.3.0", date: "2026-08-06", iteration: 1 }
    );
    for (const probe of ["S1", "S3", "S6", "S7", "S8"]) expect(md).toContain(`| ${probe} |`);
    expect(md).not.toMatch(/## Gate|## Trend|GREEN|equal-ranked model/i);
    expect(md).toMatch(/Every scenario is equal-ranked/);
    expect(md).toMatch(/No baseline/);
  });

  it("carries NO aggregate percentage across checkpoints that differ in kind", () => {
    // A flat rate over checkpoints that differ in kind is the number that let 234
    // untraceable checkpoints look like coverage. Removing the gate does not bring it back.
    const md = renderRunSummaryMd(
      [...SUITE, R("S1", ["fail"])],
      { sessions: 2, sessionsThatReadACorpusDocument: 1, corpusReadShare: 0.5, unprovenancedTokens: 0 },
      { skillVersion: "0.3.0", date: "2026-08-06", iteration: 1 }
    );
    expect(md).not.toMatch(/overall|Gesamt|total pass rate/i);
  });

  it("names every non-passing checkpoint, whichever scenario carries it", () => {
    const md = renderRunSummaryMd(
      [R("S1", ["fail"]), R("S7", ["fail"])],
      { sessions: 1, sessionsThatReadACorpusDocument: 0, corpusReadShare: 0, unprovenancedTokens: 2 },
      { skillVersion: "0.3.0", date: "2026-08-06", iteration: 1 }
    );
    expect(md).toMatch(/## Non-passing checkpoints/);
    expect(md).toMatch(/- S1\.0 \(fail\)/);
    expect(md).toMatch(/- S7\.0 \(fail\)/);
  });

  it("says so plainly when nothing is non-passing", () => {
    const md = renderRunSummaryMd(
      SUITE,
      { sessions: 1, sessionsThatReadACorpusDocument: 1, corpusReadShare: 1, unprovenancedTokens: 0 },
      { skillVersion: "0.3.0", date: "2026-08-06", iteration: 1 }
    );
    expect(md).toMatch(/## Non-passing checkpoints\n\n- none/);
  });

  it("carries both run-level metrics on every run", () => {
    const md = renderRunSummaryMd(
      [R("S1", ["pass"])],
      { sessions: 4, sessionsThatReadACorpusDocument: 3, corpusReadShare: 0.75, unprovenancedTokens: 1 },
      { skillVersion: "0.3.0", date: "2026-08-06", iteration: 1 }
    );
    expect(md).toMatch(/Corpus-document reads:\*\* 3\/4 sessions \(75 %\)/);
    expect(md).toMatch(/Unprovenanced .* tokens:\*\* 1 \(target 0\)/);
  });
});

describe("run metrics", () => {
  const corpusPaths = new Map([["methodology-001", "/corpus/content/methodology-001.md"]]);
  const t = (tools: Array<{ name: string; args?: unknown }>, assistant = ""): Transcript => ({
    probe: "S6",
    model: "m",
    turns: [{ user: "q", assistant, tools }],
  });

  it("counts the share of sessions that read a corpus DOCUMENT (not the index)", () => {
    const m = runMetrics(
      [
        t([{ name: "read", args: { path: "/corpus/content/methodology-001.md" }, isError: false }]),
        t([{ name: "read", args: { path: "/corpus/index.json" }, isError: false }]),
      ],
      corpusPaths
    );
    expect(m.sessionsThatReadACorpusDocument).toBe(1);
    expect(m.corpusReadShare).toBe(0.5);
  });

  it("counts unprovenanced tokens across the run", () => {
    const m = runMetrics([t([], "(corpus:methodology-001 § A, X 2018)")], corpusPaths);
    expect(m.unprovenancedTokens).toBe(1);
  });
});

describe("model recommendation ranks candidates, it does not disqualify them", () => {
  it("names the highest-scoring candidate, whichever scenario its misses fall in", () => {
    // Under the gate this recommended `lower` instead: a miss in S3/S6/S7/S8 disqualified
    // a model outright. Every scenario is equal-ranked now, so the count decides.
    const matrix = buildMatrix({
      higher: [
        R("S3", ["pass"]),
        R("S6", ["fail"]),
        R("S7", ["pass"]),
        R("S8", ["pass"]),
        R("S1", ["pass", "pass", "pass"]),
      ],
      lower: [...SUITE, R("S1", ["pass", "fail", "fail"])],
    });
    expect(matrix.recommendation).toBe("higher");
    expect(matrix.cells.higher!.pass).toBe(6);
    expect(matrix.cells.lower!.pass).toBe(5);
    const md = renderMatrixMd(matrix);
    expect(md).toMatch(/Highest on this probe set:\*\* higher/);
    expect(md).not.toMatch(/gate/i);
    expect(md).not.toMatch(/Disqualified by/i);
    expect(md).toMatch(/measurement, not a bar/);
  });

  it("still names a candidate whose every checkpoint failed — the number is a ranking", () => {
    const matrix = buildMatrix({ a: [R("S6", ["fail"])] });
    expect(matrix.recommendation).toBe("a");
    expect(matrix.cells.a!.passRate).toBe(0);
  });

  it("names nothing when nothing was scored at all", () => {
    expect(buildMatrix({}).recommendation).toBeNull();
    expect(renderMatrixMd(buildMatrix({}))).toMatch(/nothing scored/);
  });

  it("does not name a candidate whose every checkpoint was not-assessable", () => {
    // The shape a model emitting no tool calls produces: its rate is 0 by convention,
    // not by observation, so ranking it would recommend a candidate nothing measured.
    const matrix = buildMatrix({ mute: [R("S6", ["not-assessable", "not-assessable"])] });
    expect(matrix.cells.mute!.assessable).toBe(0);
    expect(matrix.recommendation).toBeNull();
    expect(renderMatrixMd(matrix)).toMatch(/nothing scored/);
  });

  it("ranks the candidate that measured something over one that measured nothing", () => {
    const matrix = buildMatrix({
      mute: [R("S6", ["not-assessable"])],
      scored: [R("S6", ["fail"])],
    });
    expect(matrix.recommendation).toBe("scored");
  });
});
