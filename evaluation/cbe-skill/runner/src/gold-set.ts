/**
 * Gold set — calibration of the judge, the harness's measuring instrument.
 *
 * Every pass rate this harness has produced was read off an instrument that was
 * never itself measured: a failing checkpoint could be the candidate model, the
 * judge misreading a correct answer, or a broken checkpoint. The gold set closes
 * the middle one. It is a set of hand-labelled triples — rubric, synthetic answer,
 * expected verdict — scored by the real judge BEFORE any candidate token is spent.
 *
 * Two design points that decide whether the number means anything (design.md § 2):
 *
 *  - **Agreement is measured per direction.** A judge that answers `pass` to
 *    everything scores 100% on a pass-heavy set; overall agreement measures the
 *    set's composition, not the judge. Both directions must clear the threshold.
 *  - **Borderline triples are reported, not gated.** Gating on triples where a
 *    careful human could argue either way would gate on our own label quality.
 *
 * Loading, validation, agreement, thresholding and reporting are pure and run in
 * `npm test` against a stubbed client. Only the live calibration needs a model.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import pLimit from "p-limit";
import {
  JUDGE_VERDICTS,
  majorityVerdict,
  type CheckResult,
  type Probe,
  type Transcript,
  type Verdict,
} from "./types.js";
import { checkJudge, type JudgeDeps } from "./checker-judge.js";

/** How a triple participates in the gate. */
export type GoldLabel = "clear-pass" | "clear-fail" | "borderline";

/** Fallback when `eval.config.json` names none — see design.md § 2 for the reasoning. */
export const DEFAULT_CALIBRATION_THRESHOLD = 0.8;
/** A direction below this many triples cannot carry a rate worth thresholding. */
export const MIN_TRIPLES_PER_DIRECTION = 5;

export interface GoldTriple {
  id: string;
  /** The pass criterion put to the judge — same shape a scenario checkpoint uses. */
  rubric: string;
  /** The synthetic assistant answer under judgement. */
  answer: string;
  /** Optional lecturer turn, when the rubric refers to what was asked. */
  user?: string;
  /** Tool names the synthetic turn recorded, for rubrics about tool-mediated behaviour. */
  tools?: string[];
  expected: Verdict;
  label: GoldLabel;
  /** Why a human labelled it this way. Read when the judge disagrees. */
  note: string;
  file?: string;
}

export class GoldSetError extends Error {
  constructor(
    message: string,
    readonly file: string
  ) {
    super(`${file}: ${message}`);
    this.name = "GoldSetError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(raw: Record<string, unknown>, field: string, file: string, id?: string): string {
  const v = raw[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new GoldSetError(`${id ? `triple "${id}"` : "triple"} is missing required string field "${field}"`, file);
  }
  return v;
}

const LABELS: readonly GoldLabel[] = ["clear-pass", "clear-fail", "borderline"];

export function parseGoldTriple(raw: unknown, file: string): GoldTriple {
  if (!isObject(raw)) throw new GoldSetError("gold triple document is not a mapping", file);
  const id = requireString(raw, "id", file);
  const rubric = requireString(raw, "rubric", file, id);
  const answer = requireString(raw, "answer", file, id);
  const note = requireString(raw, "note", file, id);
  const label = raw.label;
  if (typeof label !== "string" || !(LABELS as readonly string[]).includes(label)) {
    throw new GoldSetError(
      `triple "${id}" has invalid label "${String(label)}" (expected ${LABELS.join(" | ")})`,
      file
    );
  }
  const expected = raw.expected;
  if (typeof expected !== "string" || !(JUDGE_VERDICTS as readonly string[]).includes(expected)) {
    throw new GoldSetError(
      `triple "${id}" has invalid expected verdict "${String(expected)}" (expected ${JUDGE_VERDICTS.join(" | ")})`,
      file
    );
  }
  // A label and an expectation that contradict each other would make the gate
  // meaningless in exactly the direction it is supposed to protect.
  if (label === "clear-pass" && expected !== "pass") {
    throw new GoldSetError(`triple "${id}" is labelled clear-pass but expects "${expected}"`, file);
  }
  if (label === "clear-fail" && expected === "pass") {
    throw new GoldSetError(`triple "${id}" is labelled clear-fail but expects "pass"`, file);
  }
  return {
    id,
    rubric,
    answer,
    user: typeof raw.user === "string" ? raw.user : undefined,
    tools: Array.isArray(raw.tools) ? (raw.tools as string[]) : undefined,
    expected: expected as Verdict,
    label: label as GoldLabel,
    note,
    file,
  };
}

/**
 * A gold set built only of passing cases measures nothing, so balance is enforced
 * at load time rather than discovered when a run goes green for the wrong reason.
 */
export function validateGoldSetBalance(triples: GoldTriple[], file = "(gold set)"): void {
  const count = (l: GoldLabel) => triples.filter((t) => t.label === l).length;
  const passes = count("clear-pass");
  const fails = count("clear-fail");
  const borderline = count("borderline");
  const found = `found clear-pass=${passes}, clear-fail=${fails}, borderline=${borderline}`;
  if (passes < MIN_TRIPLES_PER_DIRECTION) {
    throw new GoldSetError(
      `gold set needs at least ${MIN_TRIPLES_PER_DIRECTION} clear-pass triples — ${found}. ` +
        `A set missing a direction cannot detect a judge that is biased toward it.`,
      file
    );
  }
  if (fails < MIN_TRIPLES_PER_DIRECTION) {
    throw new GoldSetError(
      `gold set needs at least ${MIN_TRIPLES_PER_DIRECTION} clear-fail triples — ${found}. ` +
        `A set of passing cases only would score 100% against a judge that passes everything.`,
      file
    );
  }
  if (borderline < 1) {
    throw new GoldSetError(`gold set needs at least one borderline triple — ${found}`, file);
  }
}

/**
 * Load and balance-validate every `*.yaml` gold file in a directory.
 *
 * Every failure leaves here as a `GoldSetError`, including a missing directory and
 * unparseable YAML: the caller maps that onto the CLI/config exit code, and an
 * unmapped `ENOENT` would surface as the exit code reserved for failing checkpoints.
 */
export function loadGoldSet(dir: string): GoldTriple[] {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new GoldSetError(
      e.code === "ENOENT"
        ? "gold set directory does not exist — the judge cannot be calibrated without it"
        : `gold set directory could not be read: ${e.message}`,
      dir
    );
  }
  const out: GoldTriple[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const full = path.join(dir, f);
    let docs: unknown[];
    try {
      docs = yaml.loadAll(readFileSync(full, "utf8")).filter((d) => d !== null && d !== undefined);
    } catch (err) {
      throw new GoldSetError(`gold file could not be parsed: ${(err as Error).message}`, full);
    }
    for (const doc of docs) {
      const triple = parseGoldTriple(doc, full);
      if (seen.has(triple.id)) throw new GoldSetError(`duplicate gold triple id "${triple.id}"`, full);
      seen.add(triple.id);
      out.push(triple);
    }
  }
  validateGoldSetBalance(out, dir);
  return out;
}

/** The triple rendered as the transcript + probe the judge path expects. */
export function tripleAsTranscript(triple: GoldTriple): { transcript: Transcript; probe: Probe } {
  const user = triple.user ?? "(gold-set prompt)";
  const transcript: Transcript = {
    probe: triple.id,
    model: "gold-set",
    turns: [{ user, assistant: triple.answer, tools: (triple.tools ?? []).map((name) => ({ name })) }],
  };
  const probe: Probe = {
    probe: triple.id,
    scenarioFile: triple.file ?? "(gold set)",
    setup: { profile: "app" },
    turns: [user],
    checkpoints: [],
  };
  return { transcript, probe };
}

export interface GoldItemResult {
  id: string;
  label: GoldLabel;
  expected: Verdict;
  actual: Verdict;
  agrees: boolean;
  note: string;
  reasoning?: string;
}

export interface DirectionAgreement {
  total: number;
  agreed: number;
  rate: number;
  clears: boolean;
}

/**
 * Why a triple carries no verdict. `checkJudge` folds two unrelated faults into the
 * same `error` verdict, and they have opposite remedies — naming both "the judge
 * could not be reached" would send the operator to an intact backend.
 */
export type UnscoredCause = "unreachable" | "unusable-reply" | "unclassified";

export interface UnscoredCauses {
  /** The backend call itself threw — down, refused, rate-limited. */
  unreachable: number;
  /** The judge answered twice and never honoured the JSON contract. The MODEL is at fault. */
  unusableReply: number;
  /** An `error` verdict matching neither known shape — named, never folded into one of the two. */
  unclassified: number;
}

/**
 * Classify an unscored triple from the reasoning `checkJudge` recorded. Tolerant by
 * design: an unrecognised shape is reported as such rather than attributed to a cause
 * it may not have, because the whole point of the split is that the two remedies differ.
 */
export function classifyUnscored(reasoning: string | undefined): UnscoredCause {
  if (typeof reasoning !== "string") return "unclassified";
  if (reasoning.includes("judge call failed:")) return "unreachable";
  if (reasoning.includes("judge_error:")) return "unusable-reply";
  return "unclassified";
}

const UNSCORED_ORDER: ReadonlyArray<readonly [UnscoredCause, keyof UnscoredCauses]> = [
  ["unreachable", "unreachable"],
  ["unusable-reply", "unusableReply"],
  ["unclassified", "unclassified"],
];

/** The sentence the banner uses per cause. Each names its OWN remedy; none blames the labels. */
function bannerClause(cause: UnscoredCause, n: number, total: number): string {
  const head = `${n} of ${total} triples were not scored`;
  switch (cause) {
    case "unreachable":
      return (
        `${head} — the judge could not be reached. That is a judge-backend failure, ` +
        `not a miscalibrated instrument and not a stale gold set: check the backend before changing a single label.`
      );
    case "unusable-reply":
      return (
        `${head} — the judge answered but could not produce a parseable verdict. That is a fault in the judge ` +
        `MODEL, not in the backend and not in the gold set: pick a judge model that honours the JSON contract, ` +
        `and change no label.`
      );
    default:
      return (
        `${head} — the judge failed in an unrecognised way. Read the per-triple reasoning in gold-set.json ` +
        `before acting; whatever it turns out to be, it is not a labelling problem.`
      );
  }
}

/** The same split as a Markdown paragraph for `gold-set.md`. */
function markdownClause(cause: UnscoredCause, n: number, total: number): string {
  const head = `**${n} of ${total} triples were not scored`;
  switch (cause) {
    case "unreachable":
      return `${head} — the judge could not be reached.** Fix the judge backend; the labels are not the problem.`;
    case "unusable-reply":
      return (
        `${head} — the judge answered but could not produce a parseable verdict.** ` +
        `The judge MODEL is at fault, not the backend; the labels are not the problem.`
      );
    default:
      return (
        `${head} — the judge failed in an unrecognised way.** ` +
        `Read the per-triple reasoning in \`gold-set.json\`; the labels are not the problem.`
      );
  }
}

/** Short per-cause wording for the console line and the findings header. */
const SHORT_CAUSE: Record<UnscoredCause, string> = {
  unreachable: "judge unreachable",
  "unusable-reply": "unusable judge reply",
  unclassified: "unclassified judge error",
};

function countUnscored(items: GoldItemResult[]): UnscoredCauses {
  const causes: UnscoredCauses = { unreachable: 0, unusableReply: 0, unclassified: 0 };
  for (const item of items) {
    if (item.actual !== "error") continue;
    const cause = classifyUnscored(item.reasoning);
    causes[UNSCORED_ORDER.find(([c]) => c === cause)![1]] += 1;
  }
  return causes;
}

/**
 * One line naming how many triples went unscored and why, for the channels that have
 * no room for the full clauses. Empty when every triple was scored.
 */
export function unscoredSummary(unscored: number, causes: UnscoredCauses): string {
  if (unscored === 0) return "";
  const parts = UNSCORED_ORDER.filter(([, key]) => causes[key] > 0).map(
    ([cause, key]) => `${causes[key]} ${SHORT_CAUSE[cause]}`
  );
  return `${unscored} triple(s) unscored (${parts.join(", ")}) — the gold set is not the problem`;
}

export interface CalibrationReport {
  judgeModel: string;
  threshold: number;
  /** Agreement over the `clear-pass` triples. Gates the run. */
  passDirection: DirectionAgreement;
  /** Agreement over the `clear-fail` triples. Gates the run. */
  failDirection: DirectionAgreement;
  /** Reported as a drift signal; never gates. */
  borderline: DirectionAgreement;
  /**
   * Triples the judge never scored — `checkJudge` returns `error` instead of
   * throwing. Counted separately because such a triple disagrees with every hand
   * label and would otherwise read as a miscalibrated instrument, sending the
   * operator to re-label a gold set that is fine. Since the improvement loop now
   * aborts hard on a failed calibration, an instrument fault must not be mistaken
   * for a broken gold set.
   */
  unscored: number;
  /** The same total split by cause — the two faults have opposite remedies. */
  unscoredCauses: UnscoredCauses;
  status: "ok" | "unreliable";
  /** One line naming what failed, empty when ok. */
  banner: string;
  items: GoldItemResult[];
}

export interface GoldRunOptions {
  threshold?: number;
  /** Re-score each triple N times and majority-fold, mirroring `--judge-repeat`. */
  judgeRepeat?: number;
  /**
   * Max triples scored concurrently, same cap the probe path uses. Calibration
   * precedes EVERY scoring run, so a strictly serial gold set would add a fixed
   * cost to the tight iteration loop. Default 1 (serial).
   */
  parallel?: number;
}

function direction(items: GoldItemResult[], threshold: number, gated: boolean): DirectionAgreement {
  const total = items.length;
  const agreed = items.filter((i) => i.agrees).length;
  const rate = total === 0 ? 0 : agreed / total;
  return { total, agreed, rate, clears: gated ? rate >= threshold : true };
}

const pct = (r: number) => `${(r * 100).toFixed(0)}%`;

/**
 * Score the gold set with the configured judge and decide whether the instrument
 * is reliable enough for the run's numbers to mean anything.
 */
export async function runGoldSet(
  triples: GoldTriple[],
  deps: JudgeDeps,
  opts: GoldRunOptions = {}
): Promise<CalibrationReport> {
  const threshold = opts.threshold ?? DEFAULT_CALIBRATION_THRESHOLD;
  const repeat = Math.max(1, opts.judgeRepeat ?? 1);
  const limit = pLimit(Math.max(1, opts.parallel ?? 1));
  // Promise.all over map keeps the reported order the file order, whatever the
  // completion order was — a calibration artifact must be diffable between runs.
  const items: GoldItemResult[] = await Promise.all(
    triples.map((triple) =>
      limit(async (): Promise<GoldItemResult> => {
        const { transcript, probe } = tripleAsTranscript(triple);
        const cp = { id: triple.id, type: "judge" as const, anchors: [], rubric: triple.rubric };
        const runs: CheckResult[][] = [];
        for (let i = 0; i < repeat; i++) {
          runs.push([await checkJudge(cp, transcript, probe, deps)]);
        }
        const folded = (repeat > 1 ? majorityVerdict(runs) : runs[0]!)[0]!;
        return {
          id: triple.id,
          label: triple.label,
          expected: triple.expected,
          actual: folded.verdict,
          agrees: folded.verdict === triple.expected,
          note: triple.note,
          reasoning: folded.reasoning,
        };
      })
    )
  );

  const passDirection = direction(
    items.filter((i) => i.label === "clear-pass"),
    threshold,
    true
  );
  const failDirection = direction(
    items.filter((i) => i.label === "clear-fail"),
    threshold,
    true
  );
  const borderline = direction(
    items.filter((i) => i.label === "borderline"),
    threshold,
    false
  );

  const failed: string[] = [];
  if (!passDirection.clears) {
    failed.push(`clear-pass ${pct(passDirection.rate)} (${passDirection.agreed}/${passDirection.total})`);
  }
  if (!failDirection.clears) {
    failed.push(`clear-fail ${pct(failDirection.rate)} (${failDirection.agreed}/${failDirection.total})`);
  }
  const status = failed.length === 0 ? "ok" : "unreliable";
  // A triple the judge never scored disagrees with every label, so the rates alone
  // would read as "the instrument is broken" when in fact it was never answered.
  // Name it first, before the rates — and name WHICH fault it was, because "check
  // the backend" is the wrong advice for a judge that replied with unusable JSON.
  const unscoredCauses = countUnscored(items);
  const unscored = unscoredCauses.unreachable + unscoredCauses.unusableReply + unscoredCauses.unclassified;
  const clauses = UNSCORED_ORDER.filter(([, key]) => unscoredCauses[key] > 0).map(([cause, key]) =>
    bannerClause(cause, unscoredCauses[key], items.length)
  );
  const reachability = clauses.length ? `${clauses.join(" ")} ` : "";
  const banner =
    status === "ok"
      ? ""
      : `JUDGE CALIBRATION FAILED — ${reachability}${failed.join("; ")} below the ${pct(threshold)} threshold. ` +
        `Verdicts produced by this judge are not readable as an eval result.`;

  return {
    judgeModel: deps.client.modelId,
    threshold,
    passDirection,
    failDirection,
    borderline,
    unscored,
    unscoredCauses,
    status,
    banner,
    items,
  };
}

/** Human-readable calibration artifact. */
export function renderCalibrationMd(report: CalibrationReport): string {
  const row = (name: string, d: DirectionAgreement, gated: boolean) =>
    `| ${name} | ${d.agreed}/${d.total} | ${pct(d.rate)} | ${gated ? (d.clears ? "clears" : "BELOW THRESHOLD") : "not gated"} |`;
  const disagreements = report.items.filter((i) => !i.agrees);
  // The blank lines are load-bearing: without one before the table header, the
  // delimiter row is a lazy continuation of the preceding list item and the table
  // renders as literal pipe-text. So the optional banner is spread in conditionally
  // rather than filtered out afterwards.
  return [
    "# Judge calibration — gold set",
    "",
    `- **Judge:** ${report.judgeModel}`,
    `- **Threshold:** ${pct(report.threshold)} per gated direction`,
    `- **Status:** ${report.status.toUpperCase()}`,
    ...(report.banner ? [`- **${report.banner}**`] : []),
    "",
    "| Direction | Agreed | Rate | Gate |",
    "| --- | --- | --- | --- |",
    row("clear-pass", report.passDirection, true),
    row("clear-fail", report.failDirection, true),
    row("borderline (drift signal)", report.borderline, false),
    "",
    // Read this BEFORE the disagreement list: a triple the judge never scored is
    // not a disagreement, and no amount of re-labelling will move it. One paragraph
    // per cause — an unreachable backend and an unusable reply need opposite fixes.
    ...UNSCORED_ORDER.filter(([, key]) => report.unscoredCauses[key] > 0).flatMap(([cause, key]) => [
      markdownClause(cause, report.unscoredCauses[key], report.items.length),
      "",
    ]),
    "## Disagreements",
    "",
    disagreements.length
      ? disagreements
          .map((i) => `- **${i.id}** (${i.label}): expected \`${i.expected}\`, judge said \`${i.actual}\` — ${i.note}`)
          .join("\n")
      : "- none",
    "",
  ].join("\n");
}

/** The compact block stamped into `index.json` and every findings file. */
export interface CalibrationStamp {
  judgeModel: string;
  threshold: number;
  passRate: number;
  failRate: number;
  borderlineRate: number;
  /** Triples the judge never scored — distinguishes an instrument fault from a bad instrument. */
  unscored: number;
  /** Which fault, so the stamp names a remedy rather than only a count. */
  unscoredCauses: UnscoredCauses;
  status: "ok" | "unreliable";
}

export function calibrationStamp(report: CalibrationReport): CalibrationStamp {
  return {
    judgeModel: report.judgeModel,
    threshold: report.threshold,
    passRate: report.passDirection.rate,
    failRate: report.failDirection.rate,
    borderlineRate: report.borderline.rate,
    unscored: report.unscored,
    unscoredCauses: report.unscoredCauses,
    status: report.status,
  };
}

/** The stamp's unscored split, rendered for a one-line channel. Empty when none. */
export function stampUnscoredSummary(stamp: CalibrationStamp): string {
  return unscoredSummary(stamp.unscored, stamp.unscoredCauses);
}
