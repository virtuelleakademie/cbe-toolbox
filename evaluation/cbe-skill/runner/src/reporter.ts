/**
 * Reporter: turns CheckResult[] into a human-readable findings.md and a
 * machine-readable report.json, plus a cross-model pass-rate matrix and
 * recommendation. Pure render functions (tested) + a thin FS writer that takes an
 * injected timestamp so output is deterministic under test.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CheckResult, Transcript, Verdict } from "./types.js";
import { passCount } from "./types.js";
import { countFlips, isStable, type FlipCounts, type StabilityReport } from "./stability.js";
import { stampUnscoredSummary, type CalibrationStamp } from "./gold-set.js";
import { readACorpusDocument, unprovenancedTokenCount } from "./checker-deterministic.js";

/**
 * EVERY SCENARIO IS EQUAL-RANKED (product decision 2026-08-07). The suite exists to
 * MEASURE, not to be passed: there is no gate subset, no per-scenario bar to clear, and
 * no verdict that fails the process. What replaced the split is `summarize` below, rendered
 * by `renderRunSummaryMd` as one equal-ranked per-probe table plus the explicit list of
 * non-passing checkpoints the reader interprets, alongside the two run-level metrics.
 *
 * The one thing that still ABORTS a run is the judge calibration (`calibrationGateFor`
 * in `orchestrator.ts`). Despite the name it is not a bar on the skill: it establishes
 * that the measuring instrument holds before the first candidate token, and numbers off
 * an uncalibrated instrument cannot be read in either direction.
 */

/**
 * The two RUN-LEVEL metrics, reported for every run, scoped or full.
 *
 * `corpusReadShare` exists because eager skill inclusion removes the model's main reason
 * to touch the filesystem — the regression that would cause is invisible per-checkpoint
 * and obvious here. If it collapses, the answer is a prompt fix (strengthen the corpus
 * half of the opening protocol), NOT a return to lazy load: lazy load costs 38 % of the
 * body.
 */
export interface RunMetrics {
  sessions: number;
  sessionsThatReadACorpusDocument: number;
  corpusReadShare: number;
  unprovenancedTokens: number;
}

export function runMetrics(transcripts: Transcript[], corpusPaths: Map<string, string>): RunMetrics {
  const sessions = transcripts.length;
  const read = transcripts.filter((transcript) => readACorpusDocument(transcript, corpusPaths)).length;
  return {
    sessions,
    sessionsThatReadACorpusDocument: read,
    corpusReadShare: sessions === 0 ? 0 : read / sessions,
    unprovenancedTokens: transcripts.reduce((n, t) => n + unprovenancedTokenCount(t, corpusPaths), 0),
  };
}

export interface ProbeReport {
  probe: string;
  model: string;
  results: CheckResult[];
  /** Present when the run repeated anything; names which flips were whose. */
  stability?: StabilityReport;
}

export interface Summary {
  total: number;
  pass: number;
  fail: number;
  partial: number;
  notAssessable: number;
  error: number;
  /** Items that count toward scoring (total minus not-assessable). */
  assessable: number;
  passRate: number;
}

/**
 * Per-probe verdict counts. NOTE: `passRate` is retained for the per-probe view and for
 * the cross-model matrix, and MUST NOT be aggregated into a single figure across the
 * whole suite — a flat rate over checkpoints that differ in kind is the number that let
 * 234 untraceable checkpoints look like coverage.
 */
export function summarize(results: CheckResult[]): Summary {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const notAssessable = count("not-assessable");
  const assessable = results.length - notAssessable;
  const pass = passCount(results);
  return {
    total: results.length,
    pass,
    fail: count("fail"),
    partial: count("partial"),
    notAssessable,
    error: count("error"),
    assessable,
    passRate: assessable === 0 ? 0 : pass / assessable,
  };
}

export interface ReportMeta {
  model: string;
  skillVersion: string;
  date: string;
  iteration: number;
  /**
   * Judge-calibration verdict for the run. Stamped into every artifact so a later
   * reader can see which instrument produced the numbers — an `unreliable` run is
   * never readable as an acceptance signal.
   */
  calibration?: CalibrationStamp;
}

export function renderReportJson(report: ProbeReport, meta: ReportMeta): object {
  return {
    meta: { probe: report.probe, ...meta },
    items: report.results,
    summary: summarize(report.results),
    ...(report.stability ? { stability: report.stability } : {}),
  };
}

export function renderFindingsMd(report: ProbeReport, meta: ReportMeta): string {
  const s = summarize(report.results);
  const icon: Record<Verdict, string> = {
    pass: "PASS",
    fail: "FAIL",
    partial: "PARTIAL",
    "not-assessable": "N/A",
    error: "ERROR",
  };
  const rows = report.results
    .map(
      (r) => `| ${r.id} | ${icon[r.verdict]} | ${(r.evidence ?? r.reasoning ?? "").replace(/\n/g, " ").slice(0, 200)} |`
    )
    .join("\n");
  const failures = report.results.filter((r) => r.verdict === "fail" || r.verdict === "partial");
  const failureModes = failures.length
    ? failures.map((r) => `- **${r.id}** (${r.verdict}): ${r.reasoning ?? "—"}`).join("\n")
    : "- none";
  // The unscored split rides along even on an OK calibration: a partial judge outage
  // that still clears the threshold is otherwise invisible outside gold-set.md.
  const unscored = meta.calibration ? stampUnscoredSummary(meta.calibration) : "";
  const calibrationLine = meta.calibration
    ? `- **Judge calibration:** ${meta.calibration.status.toUpperCase()} — clear-pass ` +
      `${(meta.calibration.passRate * 100).toFixed(0)}%, clear-fail ${(meta.calibration.failRate * 100).toFixed(0)}% ` +
      `against a ${(meta.calibration.threshold * 100).toFixed(0)}% threshold (judge: ${meta.calibration.judgeModel})` +
      (unscored ? `\n- **Unscored gold triples:** ${unscored}.` : "") +
      (meta.calibration.status === "unreliable"
        ? "\n- **WARNING:** the judge failed its calibration; these verdicts are not readable as an eval result."
        : "")
    : "";
  const stabilitySection =
    report.stability && !isStable(report.stability)
      ? [
          "## Verdict stability",
          "",
          `- **Judge-attributable flips** (moved on a fixed transcript): ${report.stability.judgeUnstable.join(", ") || "none"}`,
          `- **Model-attributable flips** (moved only between transcripts): ${report.stability.modelUnstable.join(", ") || "none"}`,
          `- Repetition: ${report.stability.repeat} probe run(s) x ${report.stability.judgeRepeat} scoring(s)`,
          "",
        ]
      : [];
  return [
    `# Findings — probe ${report.probe}`,
    "",
    `- **Date:** ${meta.date}`,
    `- **Runner:** cbe-eval (model: ${meta.model}, skill: ${meta.skillVersion}, iteration ${meta.iteration})`,
    `- **Result:** ${s.pass}/${s.assessable} assessable checkpoints passed` +
      (s.notAssessable ? ` (${s.notAssessable} not-assessable)` : ""),
    ...(calibrationLine ? [calibrationLine] : []),
    "",
    "## Per-criterion verdict",
    "",
    "| Checkpoint | Verdict | Evidence / Reason |",
    "| --- | --- | --- |",
    rows,
    "",
    ...stabilitySection,
    "## Failure modes seen",
    "",
    failureModes,
    "",
  ].join("\n");
}

export interface MatrixCell {
  passRate: number;
  pass: number;
  assessable: number;
}

export interface ModelMatrix {
  /** model name -> aggregate cell across all its probes. */
  cells: Record<string, MatrixCell>;
  /** Highest-scoring candidate across the same probe set; null when nothing was scored. */
  recommendation: string | null;
}

/**
 * Cross-model matrix. Every scenario counts the same, so the recommendation is simply the
 * candidate that passed the most of the same assessable checkpoints — there is no subset
 * that disqualifies a model outright. The number compares candidates against EACH OTHER
 * on one probe set; it is not a bar, and it is not comparable across probe sets.
 *
 * A candidate with ZERO assessable checkpoints measured nothing and is not ranked: its
 * rate is 0 by convention, not by observation, and naming it would report a candidate the
 * run never scored (the shape a model emitting no tool calls produces). Ranking otherwise
 * stays untouched — a candidate that failed every assessable checkpoint IS ranked.
 */
export function buildMatrix(reportsByModel: Record<string, ProbeReport[]>): ModelMatrix {
  const cells: Record<string, MatrixCell> = {};
  for (const [model, reports] of Object.entries(reportsByModel)) {
    let pass = 0;
    let assessable = 0;
    for (const r of reports) {
      const s = summarize(r.results);
      pass += s.pass;
      assessable += s.assessable;
    }
    cells[model] = { pass, assessable, passRate: assessable === 0 ? 0 : pass / assessable };
  }
  let recommendation: string | null = null;
  let best = -1;
  for (const [model, cell] of Object.entries(cells)) {
    if (cell.assessable === 0) continue;
    if (cell.passRate > best) {
      best = cell.passRate;
      recommendation = model;
    }
  }
  return { cells, recommendation };
}

export function renderMatrixMd(matrix: ModelMatrix): string {
  const rows = Object.entries(matrix.cells)
    .map(([m, c]) => `| ${m} | ${c.pass}/${c.assessable} | ${(c.passRate * 100).toFixed(0)}% |`)
    .join("\n");
  return [
    "# Model comparison",
    "",
    "Every scenario is equal-ranked: this ranks candidates against each other on one probe",
    "set. It is a measurement, not a bar — no scenario disqualifies a model.",
    "",
    "| Model | Pass / Assessable | Rate |",
    "| --- | --- | --- |",
    rows,
    "",
    `**Highest on this probe set:** ${matrix.recommendation ?? "(none — nothing scored)"}`,
    "",
  ].join("\n");
}

/** Write a probe's findings.md + report.json into a run directory. */
export function writeProbeReport(
  runDir: string,
  report: ProbeReport,
  meta: ReportMeta
): { findings: string; json: string } {
  mkdirSync(runDir, { recursive: true });
  const findings = path.join(runDir, `${report.probe}-findings.md`);
  const json = path.join(runDir, `${report.probe}-report.json`);
  writeFileSync(findings, renderFindingsMd(report, meta), "utf8");
  writeFileSync(json, JSON.stringify(renderReportJson(report, meta), null, 2), "utf8");
  return { findings, json };
}

/** Persist a probe's raw transcript (turns + tools) for verdict debugging. */
export function writeTranscript(runDir: string, transcript: Transcript): string {
  mkdirSync(runDir, { recursive: true });
  const p = path.join(runDir, `${transcript.probe}-transcript.json`);
  writeFileSync(p, JSON.stringify(transcript, null, 2), "utf8");
  return p;
}

/** Aggregate judge- vs model-attributable flips across a run's probes. */
export function aggregateStability(reports: ProbeReport[]): FlipCounts {
  return countFlips(reports.flatMap((r) => (r.stability ? [r.stability] : [])));
}

/** Render the run-level summary: every probe, equal-ranked — and NO flat pass rate. */
export function renderRunSummaryMd(
  reports: ProbeReport[],
  metrics: RunMetrics,
  meta: Omit<ReportMeta, "model">
): string {
  const rows = reports
    .map((r) => {
      const s = summarize(r.results);
      return `| ${r.probe} | ${s.pass}/${s.assessable} | ${s.fail} | ${s.partial} | ${s.notAssessable} |`;
    })
    .join("\n");
  const nonPassing = reports.flatMap((r) =>
    r.results.filter((item) => item.verdict !== "pass").map((item) => `${r.probe}.${item.id} (${item.verdict})`)
  );
  return [
    `# Run summary — ${meta.date}`,
    "",
    `- **Skill version:** ${meta.skillVersion}`,
    "",
    "## Per-probe results",
    "",
    "Every scenario is equal-ranked. This is a measurement, not a bar: a red checkpoint is",
    "a finding to route through `traceability.json`, and it does not fail the run.",
    "",
    "| Probe | Pass / Assessable | Fail | Partial | N/A |",
    "| --- | --- | --- | --- | --- |",
    rows || "| (none in this run) | | | | |",
    "",
    "## Non-passing checkpoints",
    "",
    nonPassing.length > 0 ? nonPassing.map((f) => `- ${f}`).join("\n") : "- none",
    "",
    "## Run-level metrics",
    "",
    `- **Corpus-document reads:** ${metrics.sessionsThatReadACorpusDocument}/${metrics.sessions} sessions ` +
      `(${(metrics.corpusReadShare * 100).toFixed(0)} %) read at least one corpus document body.`,
    `- **Unprovenanced \`(corpus:…)\` tokens:** ${metrics.unprovenancedTokens} (target 0).`,
    "",
    "## No baseline",
    "",
    "This suite establishes no baseline against the previous 36-scenario set, deliberately.",
    "Those numbers graded a skill body of which the model received 62.3 %, and 234 of their",
    "296 checkpoints carried no anchor — comparing against them would import that noise.",
    "Read the table above at n=3 (`--repeat 3`) and route what is red, rather than",
    "looking for a number that clears.",
    "",
  ].join("\n");
}

/** Update the aggregate index.json across all probes in a run. */
export function writeIndex(
  runDir: string,
  reports: ProbeReport[],
  meta: Omit<ReportMeta, "model">,
  metrics?: RunMetrics
): string {
  mkdirSync(runDir, { recursive: true });
  const indexPath = path.join(runDir, "index.json");
  const index = {
    date: meta.date,
    skillVersion: meta.skillVersion,
    iteration: meta.iteration,
    // Which instrument produced these numbers. An `unreliable` stamp means the run
    // is not readable in either direction, however green the per-probe rates are.
    ...(meta.calibration ? { judgeCalibration: meta.calibration } : {}),
    // No `gate` object and no per-probe `role`: every scenario is equal-ranked, and the
    // report must never present one aggregate percentage across all checkpoints either.
    ...(metrics ? { metrics } : {}),
    stability: aggregateStability(reports),
    probes: reports.map((r) => ({
      probe: r.probe,
      model: r.model,
      summary: summarize(r.results),
      ...(r.stability ? { stability: r.stability } : {}),
    })),
    baseline: null,
    baselineNote:
      "No baseline comparison exists, by decision: the previous suite graded a body the model received 62.3 % of, with 234 of 296 checkpoints unanchored.",
  };
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  if (metrics) {
    writeFileSync(path.join(runDir, "run-summary.md"), renderRunSummaryMd(reports, metrics, meta), "utf8");
  }
  return indexPath;
}

/** Persist the judge-calibration artifacts alongside the run. */
export function writeCalibration(runDir: string, json: object, markdown: string): { json: string; md: string } {
  mkdirSync(runDir, { recursive: true });
  const jsonPath = path.join(runDir, "gold-set.json");
  const mdPath = path.join(runDir, "gold-set.md");
  writeFileSync(jsonPath, JSON.stringify(json, null, 2), "utf8");
  writeFileSync(mdPath, markdown, "utf8");
  return { json: jsonPath, md: mdPath };
}
