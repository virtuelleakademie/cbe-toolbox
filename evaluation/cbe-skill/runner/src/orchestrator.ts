/**
 * Orchestrator: selects scenarios, runs probes (parallel, capped, isolated),
 * scores them, and writes reports. Pure validators (CLI flag checks, scenario
 * selection) are exported for unit testing. Live wiring (Pi sessions, judge
 * client) is injected via RunDeps so the whole orchestration path is testable
 * with mocks and no network.
 */

import path from "node:path";
import pLimit from "p-limit";
import { majorityVerdict, type Probe, type CheckResult } from "./types.js";
import type { EvalSessionFactory } from "./session-eval.js";
import type { JudgeDeps } from "./checker-judge.js";
import type { ResolvedModel } from "./config.js";
import { runProbe } from "./runner.js";
import { scoreProbeRepeated } from "./scorer.js";
import { attributeStability, type ScoredTranscript } from "./stability.js";
import { calibrationStamp, type CalibrationReport, type CalibrationStamp } from "./gold-set.js";
import {
  buildMatrix,
  renderMatrixMd,
  runMetrics,
  writeIndex,
  writeProbeReport,
  writeTranscript,
  type ModelMatrix,
  type ProbeReport,
  type ReportMeta,
} from "./reporter.js";
import type { Transcript } from "./types.js";

export class CliOptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliOptionError";
  }
}

export interface CliOptions {
  model?: string;
  compare?: boolean;
  scenarios?: string;
  repeat?: number;
  judgeRepeat?: number;
  maxIterations?: number;
  maxAttempts?: number;
  parallel?: number;
  maxTokens?: number;
}

/** Every numeric flag, with the spelling to name back to the operator. */
const POSITIVE_INT_FLAGS: ReadonlyArray<readonly [keyof CliOptions, string]> = [
  ["repeat", "--repeat"],
  ["judgeRepeat", "--judge-repeat"],
  ["maxIterations", "--max-iterations"],
  ["maxAttempts", "--max-attempts"],
  ["parallel", "--parallel"],
  ["maxTokens", "--max-tokens"],
];

/**
 * Reject a numeric flag that is not a positive integer. Throws CliOptionError.
 *
 * Commander parses these with `Number()`, so a typo becomes `NaN` and survives every
 * clamp: `Math.max(1, NaN)` is `NaN`, so `for (let i = 0; i < NaN; i++)` never runs a
 * single iteration. `--judge-repeat x` would therefore leave every judge checkpoint
 * unscored and report the fallback verdicts as ordinary failures — a silent
 * corruption of exactly the numbers this harness exists to make trustworthy. A
 * fractional value is rejected for the same reason: nothing downstream can honour it.
 */
export function validateNumericOptions(opts: CliOptions): void {
  for (const [key, flag] of POSITIVE_INT_FLAGS) {
    const value = opts[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new CliOptionError(`${flag} must be a positive integer, got "${String(value)}"`);
    }
  }
}

/** Validate mutually-exclusive / referential flags. Throws CliOptionError. */
export function validateCliOptions(opts: CliOptions, candidateNames: string[]): void {
  if (opts.compare && opts.model) {
    throw new CliOptionError("--compare runs all configured candidates; --model selects one. Use one, not both.");
  }
  if (opts.model && !candidateNames.includes(opts.model)) {
    throw new CliOptionError(`unknown model "${opts.model}". Available candidates: ${candidateNames.join(", ")}`);
  }
  validateNumericOptions(opts);
}

/**
 * Select scenario files by a single id ("03"), a range ("01-04"), or a comma-separated
 * list of either ("03,06,07,08"). The `S` prefix is accepted so a selection can be named
 * the way the scenarios are: `--scenarios S3,S6,S7,S8`.
 */
export function selectScenarios(files: string[], range?: string): string[] {
  if (!range) return files;
  const fileNum = (f: string): number | null => {
    const m = /(\d{1,2})/.exec(path.basename(f));
    return m ? Number(m[1]) : null;
  };
  const wanted = new Set<number>();
  /** Ids the caller named EXPLICITLY. A range is a span, not an enumeration: `01-04`
   *  legitimately covers gaps, so only explicit singles are checked for existence. */
  const namedSingles: number[] = [];
  const namedRanges: Array<{ lo: number; hi: number; raw: string }> = [];
  for (const raw of range.split(",")) {
    const part = raw.trim().replace(/S/gi, "");
    if (part.length === 0) continue;
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
    if (!m) {
      throw new CliOptionError(
        `invalid --scenarios selector "${raw.trim()}" (expected e.g. "03", "01-04", or "S3,S6,S7,S8")`
      );
    }
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    if (m[2]) namedRanges.push({ lo, hi, raw: raw.trim() });
    else namedSingles.push(lo);
    for (let n = lo; n <= hi; n++) wanted.add(n);
  }
  if (wanted.size === 0) throw new CliOptionError(`invalid --scenarios value "${range}"`);

  // NEVER an empty (or silently short) selection reported as a clean run: a command
  // naming a scenario that does not exist must fail loudly, not pass by running nothing.
  const available = new Set(files.map(fileNum).filter((n): n is number => n !== null));
  const pad = (n: number): string => String(n).padStart(2, "0");
  const availableList = (): string =>
    [...available]
      .sort((a, b) => a - b)
      .map(pad)
      .join(", ");

  const missing = namedSingles.filter((n) => !available.has(n)).sort((a, b) => a - b);
  if (missing.length > 0) {
    throw new CliOptionError(
      `--scenarios names ${missing.length === 1 ? "an id" : "ids"} no scenario file carries: ` +
        `${missing.map(pad).join(", ")}. Available: ${availableList()}.`
    );
  }
  for (const r of namedRanges) {
    if (![...available].some((n) => n >= r.lo && n <= r.hi)) {
      throw new CliOptionError(`--scenarios range "${r.raw}" matches no scenario file. Available: ${availableList()}.`);
    }
  }
  return files.filter((f) => {
    const n = fileNum(f);
    return n !== null && wanted.has(n);
  });
}

/**
 * Dry-run: parse the selected scenarios and report what WOULD run, with zero
 * LLM calls and no files written.
 */
export async function dryRunPlan(
  scenarioFiles: string[],
  loadProbes: (file: string) => Promise<Probe[]>
): Promise<{ lines: string[]; probeCount: number }> {
  const lines: string[] = [];
  let probeCount = 0;
  for (const f of scenarioFiles) {
    const probes = await loadProbes(f);
    for (const p of probes) {
      probeCount += 1;
      const det = p.checkpoints.filter((c) => c.type === "deterministic").length;
      const judge = p.checkpoints.filter((c) => c.type === "judge").length;
      lines.push(
        `${path.basename(f)} :: probe ${p.probe} — ${p.turns.length} turn(s), ${det} deterministic + ${judge} judge checkpoint(s)`
      );
    }
  }
  lines.push(`Would run ${probeCount} probe(s). No LLM calls made (dry run).`);
  return { lines, probeCount };
}

export interface RunDeps {
  corpusIds: Set<string>;
  corpusPaths: Map<string, string>;
  /** id -> the document's ATX headings, for `cite_section_resolves`. */
  corpusHeadings: Map<string, string[]>;
  loadProbes: (file: string) => Promise<Probe[]>;
  sessionFactory: (model: ResolvedModel) => EvalSessionFactory;
  judgeDeps?: JudgeDeps;
  parallel: number;
  runDir: string;
  now: string;
  skillVersion: string;
  /** Runs per probe; >1 majority-votes the verdict and writes one transcript per run
   * (`<probe>.rN`). Default 1. Honoured by the plain eval path (not just the loop). */
  repeat?: number;
  /** Scorings per transcript; >1 makes judge dispersion separately visible. Default 1. */
  judgeRepeat?: number;
  /** Judge-calibration verdict, stamped into every artifact of the run. */
  calibration?: CalibrationStamp;
}

/** Run every probe in the selected scenarios against one model. */
export async function runModel(
  scenarioFiles: string[],
  model: ResolvedModel,
  deps: RunDeps,
  iteration = 1
): Promise<ProbeReport[]> {
  const nested = await Promise.all(scenarioFiles.map((f) => deps.loadProbes(f)));
  const probes: Probe[] = nested.flat();
  const factory = deps.sessionFactory(model);
  const limit = pLimit(deps.parallel);
  const meta: ReportMeta = {
    model: model.name,
    skillVersion: deps.skillVersion,
    date: deps.now,
    iteration,
    calibration: deps.calibration,
  };

  const repeat = Math.max(1, deps.repeat ?? 1);
  const judgeRepeat = Math.max(1, deps.judgeRepeat ?? 1);
  // Every transcript of the run, for the two run-level metrics (corpus-read share,
  // unprovenanced tokens) that accompany EVERY run, scoped or full.
  const allTranscripts: Transcript[] = [];
  const reports = await Promise.all(
    probes.map((p) =>
      limit(async (): Promise<ProbeReport> => {
        const scored: ScoredTranscript[] = [];
        for (let i = 0; i < repeat; i++) {
          const transcript = await runProbe(p, factory, model.name);
          allTranscripts.push(transcript);
          // Unique transcript name per run so repeats do NOT overwrite each other.
          writeTranscript(deps.runDir, repeat > 1 ? { ...transcript, probe: `${p.probe}.r${i + 1}` } : transcript);
          scored.push(
            await scoreProbeRepeated(
              p,
              transcript,
              {
                corpusIds: deps.corpusIds,
                corpusPaths: deps.corpusPaths,
                corpusHeadings: deps.corpusHeadings,
                judge: deps.judgeDeps,
              },
              judgeRepeat
            )
          );
        }
        // Fold bottom-up: judge repetitions are already folded per transcript by the
        // scorer; here the per-transcript verdicts fold into the reported verdict.
        const runs: CheckResult[][] = scored.map((s) => s.results);
        const results = repeat > 1 ? majorityVerdict(runs) : runs[0]!;
        const stability = attributeStability(scored, judgeRepeat);
        const report: ProbeReport = {
          probe: p.probe,
          model: model.name,
          results,
          ...(repeat > 1 || judgeRepeat > 1 ? { stability } : {}),
        };
        writeProbeReport(deps.runDir, report, meta);
        return report;
      })
    )
  );
  writeIndex(
    deps.runDir,
    reports,
    {
      skillVersion: deps.skillVersion,
      date: deps.now,
      iteration,
      calibration: deps.calibration,
    },
    runMetrics(allTranscripts, deps.corpusPaths)
  );
  return reports;
}

/**
 * Exit code reserved for "the instrument failed".
 *
 * Since the gate was removed (product decision 2026-08-07) it is the ONLY code a run can
 * exit non-zero on for a reason that lies in the measurement rather than the invocation:
 * a red checkpoint is a finding, not a process failure. `1` survives for the improvement
 * loop's own convergence verdict, `2` for CLI/config and `3` for the provider.
 */
export const EXIT_UNRELIABLE_JUDGE = 4;

export interface CalibrationGate {
  /** Score the gold set. Injected, so this path is testable with no model. */
  run: () => Promise<CalibrationReport>;
  /** Complete the run for diagnosis instead of aborting. Never makes it green. */
  allowUnreliable?: boolean;
  /** Called with the report as soon as it exists — banner printing, artifact writing. */
  onReport?: (report: CalibrationReport) => void;
}

/** What a run does with the judge's verdicts — and therefore what it may risk on them. */
export type RunMode = "eval" | "loop";

/**
 * Why diagnosis mode stops at the eval paths. Printed by the CLI, so the refusal
 * states its own reason instead of leaving it in a doc.
 */
export const LOOP_REQUIRES_CALIBRATED_JUDGE =
  "The improvement loop runs on a calibrated judge only: it edits skills/cbe/ IN PLACE and decides " +
  "keep-or-revert from that judge's own verdicts, so an uncalibrated one would leave permanent edits " +
  "selected by an instrument that did not hold — strictly worse than not running the loop at all. " +
  "--allow-unreliable-judge therefore covers eval-only runs (including --compare) and never --max-iterations > 1.";

/**
 * The gate for a run mode. Diagnosis mode is an EVAL-ONLY affordance: the loop path
 * is constructed with `allowUnreliable: false` whatever the flag said, so the refusal
 * is mechanical rather than a rule someone has to remember.
 */
export function calibrationGateFor(mode: RunMode, gate: CalibrationGate): CalibrationGate {
  return mode === "loop" ? { ...gate, allowUnreliable: false } : gate;
}

export interface CalibratedRunOutcome<T> {
  calibration?: CalibrationReport;
  /** Undefined when the gate aborted before the probes ran. */
  result?: T;
  /** `EXIT_UNRELIABLE_JUDGE` when the judge failed calibration, else 0. */
  exitCode: number;
}

/**
 * Run the judge calibration first, then the probes — and only then.
 *
 * The ordering is the point: a failed instrument is known before the first
 * candidate token is spent, because every number produced after that point would be
 * unreadable. With `allowUnreliable` the probes still run for diagnosis, but the
 * outcome carries exit code 4 either way — a run with an uncalibrated judge is never
 * reported as green.
 */
export async function runWithCalibration<T>(
  gate: CalibrationGate | undefined,
  probes: (stamp: CalibrationStamp | undefined) => Promise<T>
): Promise<CalibratedRunOutcome<T>> {
  if (!gate) return { result: await probes(undefined), exitCode: 0 };
  const calibration = await gate.run();
  gate.onReport?.(calibration);
  const stamp = calibrationStamp(calibration);
  if (calibration.status === "ok") return { calibration, result: await probes(stamp), exitCode: 0 };
  if (gate.allowUnreliable) {
    return { calibration, result: await probes(stamp), exitCode: EXIT_UNRELIABLE_JUDGE };
  }
  return { calibration, exitCode: EXIT_UNRELIABLE_JUDGE };
}

/** Run all candidates and produce a comparison matrix + recommendation. */
export async function runComparison(
  scenarioFiles: string[],
  candidates: ResolvedModel[],
  deps: RunDeps
): Promise<ModelMatrix> {
  const reportsByModel: Record<string, ProbeReport[]> = {};
  for (const model of candidates) {
    const modelDir = path.join(deps.runDir, model.name);
    reportsByModel[model.name] = await runModel(scenarioFiles, model, { ...deps, runDir: modelDir });
  }
  const matrix = buildMatrix(reportsByModel);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(deps.runDir, { recursive: true });
  writeFileSync(path.join(deps.runDir, "comparison.md"), renderMatrixMd(matrix), "utf8");
  return matrix;
}
