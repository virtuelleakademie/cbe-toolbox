/**
 * Scorer glue: evaluates every checkpoint of a probe against its transcript,
 * dispatching deterministic checkpoints to the code checker and judge
 * checkpoints to the LLM judge. Returns one CheckResult per checkpoint.
 */

import type { CheckResult, Probe, Transcript } from "./types.js";
import { checkDeterministic } from "./checker-deterministic.js";
import { checkJudge, type JudgeDeps } from "./checker-judge.js";
import { foldJudgeRuns, type ScoredTranscript } from "./stability.js";

export interface ScoreDeps {
  corpusIds: Set<string>;
  corpusPaths?: Map<string, string>;
  /** id -> the document's ATX headings. Required by `cite_section_resolves`; without
   * it that check reports `not-assessable` rather than passing every token silently. */
  corpusHeadings?: Map<string, string[]>;
  /** Required to score `judge` checkpoints. Omit for deterministic-only runs. */
  judge?: JudgeDeps;
}

/**
 * Reason attached when a transcript reaches scoring although no turn produced any
 * assistant output. The session layer fails fast on provider errors (exit 3), so
 * this is defense-in-depth: if an empty transcript slips through anyway, the report
 * marks it as a suspected provider failure instead of a content-level FAIL, and no
 * judge tokens are spent on it.
 */
export const EMPTY_COMPLETION_REASON = "empty completion — possible provider failure";

/** True when every turn produced neither assistant text nor tool calls. */
function isEmptyCompletionTranscript(t: Transcript): boolean {
  return t.turns.length > 0 && t.turns.every((x) => x.assistant.trim() === "" && x.tools.length === 0);
}

export async function scoreProbe(probe: Probe, transcript: Transcript, deps: ScoreDeps): Promise<CheckResult[]> {
  return (await scoreProbeRepeated(probe, transcript, deps, 1)).results;
}

async function scoreJudgeCheckpoint(
  cp: Probe["checkpoints"][number],
  transcript: Transcript,
  probe: Probe,
  deps: ScoreDeps
): Promise<CheckResult> {
  if (!deps.judge) {
    return { id: cp.id, type: "judge", verdict: "error", reasoning: "no judge configured for a judge checkpoint" };
  }
  return checkJudge(cp, transcript, probe, deps.judge);
}

/**
 * Score a probe against ONE transcript, re-scoring the judge checkpoints
 * `judgeRepeat` times so judge dispersion becomes visible.
 *
 * Deterministic checkpoints are evaluated exactly ONCE regardless of the repeat
 * count: pure code over a fixed transcript cannot disperse, and scoring it again
 * would put a fabricated zero in the judge-dispersion column (and burn nothing but
 * wall-clock). They can still disperse at the model level, and do.
 */
export async function scoreProbeRepeated(
  probe: Probe,
  transcript: Transcript,
  deps: ScoreDeps,
  judgeRepeat = 1
): Promise<ScoredTranscript> {
  if (isEmptyCompletionTranscript(transcript)) {
    return {
      results: probe.checkpoints.map((cp) => ({
        id: cp.id,
        type: cp.type,
        verdict: "error" as const,
        reasoning: EMPTY_COMPLETION_REASON,
      })),
      judgeRuns: [],
    };
  }

  const repeat = Math.max(1, judgeRepeat);
  const deterministic = new Map<string, CheckResult>();
  for (const cp of probe.checkpoints) {
    if (cp.type === "deterministic") {
      deterministic.set(
        cp.id,
        checkDeterministic(cp, transcript, probe, deps.corpusIds, deps.corpusPaths, deps.corpusHeadings)
      );
    }
  }

  const judgeCheckpoints = probe.checkpoints.filter((cp) => cp.type !== "deterministic");
  const judgeRuns: CheckResult[][] = [];
  for (let i = 0; i < repeat; i++) {
    const run: CheckResult[] = [];
    for (const cp of judgeCheckpoints) run.push(await scoreJudgeCheckpoint(cp, transcript, probe, deps));
    judgeRuns.push(run);
  }
  const foldedJudge = new Map(foldJudgeRuns(judgeRuns).map((r) => [r.id, r]));

  const results = probe.checkpoints.map(
    (cp) =>
      deterministic.get(cp.id) ??
      foldedJudge.get(cp.id) ?? {
        id: cp.id,
        type: cp.type,
        verdict: "error" as const,
        reasoning: "checkpoint not scored",
      }
  );
  // Only a genuine repetition carries dispersion information; a single scoring does not.
  return { results, judgeRuns: repeat > 1 ? judgeRuns : [] };
}
