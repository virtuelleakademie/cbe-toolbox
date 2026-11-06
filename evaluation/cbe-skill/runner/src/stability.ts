/**
 * Variance attribution across the two repetition levels.
 *
 * `--repeat` re-runs the whole probe (new model output AND new scoring), so a
 * flipped verdict could come from either side. `--judge-repeat` re-scores the SAME
 * transcript, which pins the model output and leaves only the judge free to move.
 * Reading both together makes the two sources separable:
 *
 *   flips within one transcript          -> the judge
 *   flips between transcripts, not within -> the model
 *
 * Folding is bottom-up and both levels reuse `majorityVerdict`, inheriting its
 * documented tie behaviour: the ordering is `fail < partial < pass` with unranked
 * verdicts below all of them, so an even repeat count resolves a tie toward the
 * WORSE verdict and `not-assessable` wins a tie against everything else. For judge
 * repetition that bias is deliberate — a checkpoint whose judge cannot decide must
 * not be reported as a pass.
 *
 * Pure functions over verdict runs. No model, no I/O.
 */

import { majorityVerdict, type CheckResult, type Verdict } from "./types.js";

/**
 * CLI help for the two repetition levels. They live here, next to the mechanism
 * they describe, so the flag that isolates MODEL variance and the flag that
 * isolates JUDGE variance cannot drift into describing the same thing — the
 * conflation that made past runs unreadable.
 */
export const REPEAT_HELP =
  "MODEL variance: re-runs the whole probe n times — new model output AND new scoring — then majority-votes " +
  "the per-checkpoint verdict (one transcript per run). Honoured in the plain eval, --compare, and " +
  "improvement-loop paths.";
export const JUDGE_REPEAT_HELP =
  "JUDGE variance: re-scores the SAME transcript n times, so a verdict that flips on fixed model output is " +
  "attributed to the judge rather than the model. Combines with --repeat; deterministic checkpoints are scored " +
  "once, they cannot disperse.";

/** One transcript's scoring: the folded results plus the individual judge scorings. */
export interface ScoredTranscript {
  /** Per checkpoint, the verdict after folding this transcript's judge repetitions. */
  results: CheckResult[];
  /**
   * One entry per judge repetition, each carrying the JUDGE checkpoints only.
   * Empty when there was nothing to repeat (judge repeat of 1, or no judge checkpoint).
   */
  judgeRuns: CheckResult[][];
}

export interface StabilityReport {
  /** Repetitions of the whole probe that produced these transcripts. */
  repeat: number;
  /** Scorings per transcript. */
  judgeRepeat: number;
  /** Checkpoints whose verdict differed between scorings of ONE fixed transcript. */
  judgeUnstable: string[];
  /** Checkpoints whose folded verdict differed BETWEEN transcripts. */
  modelUnstable: string[];
}

/** Ids whose verdict is not identical across the given runs. */
export function dispersedIds(runs: CheckResult[][]): string[] {
  const seen = new Map<string, Set<Verdict>>();
  const order: string[] = [];
  for (const run of runs) {
    for (const r of run) {
      let set = seen.get(r.id);
      if (!set) {
        set = new Set();
        seen.set(r.id, set);
        order.push(r.id);
      }
      set.add(r.verdict);
    }
  }
  return order.filter((id) => (seen.get(id)?.size ?? 0) > 1);
}

/** Fold N scorings of one transcript into one verdict per checkpoint. */
export function foldJudgeRuns(runs: CheckResult[][]): CheckResult[] {
  if (runs.length === 0) return [];
  return runs.length === 1 ? runs[0]! : majorityVerdict(runs);
}

/**
 * Attribute each checkpoint's dispersion to the judge, the model, both, or neither.
 *
 * The two verdicts are independent by construction: judge instability is measured
 * WITHIN a transcript, model instability BETWEEN the already-folded transcripts. A
 * checkpoint the judge cannot decide therefore does not silently get counted as
 * model variance, which is the conflation this whole mechanism removes.
 */
export function attributeStability(scored: ScoredTranscript[], judgeRepeat: number): StabilityReport {
  const judgeUnstableSet = new Set<string>();
  for (const t of scored) {
    for (const id of dispersedIds(t.judgeRuns)) judgeUnstableSet.add(id);
  }
  const modelUnstable = dispersedIds(scored.map((t) => t.results));
  return {
    repeat: scored.length,
    judgeRepeat,
    judgeUnstable: [...judgeUnstableSet],
    modelUnstable,
  };
}

/** True when the run produced no instability at all — used to keep artifacts quiet. */
export function isStable(report: StabilityReport): boolean {
  return report.judgeUnstable.length === 0 && report.modelUnstable.length === 0;
}

/** Distinct flipped checkpoint ids across probes, by attribution. */
export interface FlipCounts {
  judgeFlips: number;
  modelFlips: number;
}

/**
 * Union the per-probe stability blocks into one flip count per attribution.
 *
 * Single source for the aggregation: `reporter.aggregateStability` (index.json) and
 * the CLI run summary both go through here, so the number written to the artifact
 * and the number printed to the operator cannot drift apart.
 */
export function countFlips(reports: StabilityReport[]): FlipCounts {
  const judge = new Set<string>();
  const model = new Set<string>();
  for (const r of reports) {
    for (const id of r.judgeUnstable) judge.add(id);
    for (const id of r.modelUnstable) model.add(id);
  }
  return { judgeFlips: judge.size, modelFlips: model.size };
}

/** One-line summary for the run output. */
export function renderStabilityLine(counts: FlipCounts): string {
  if (counts.judgeFlips === 0 && counts.modelFlips === 0) return "Verdict stability: no checkpoint flipped.";
  return (
    `Verdict stability: ${counts.judgeFlips} judge-attributable flip(s), ${counts.modelFlips} model-attributable flip(s). ` +
    `A judge-attributable flip moved on a fixed transcript; a model-attributable one only between transcripts.`
  );
}
