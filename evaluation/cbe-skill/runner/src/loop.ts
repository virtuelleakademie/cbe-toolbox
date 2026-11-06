/**
 * Improvement-loop orchestrator: per-checkpoint fix-retry loop over a model PANEL.
 *
 * For each checkpoint that fails on at least one panel model, in order, an inner loop
 * proposes a surgical edit targeting ONLY that checkpoint, re-evaluates ONLY that
 * checkpoint's probe across EVERY panel model (scoped), and keeps the edit iff it is a
 * Pareto improvement: it moves the checkpoint up on at least one panel model and down
 * on none (no in-probe regression on any model). Otherwise it reverts and retries the
 * same checkpoint with the failure reason fed back to the editor, up to a per-checkpoint
 * attempt budget. An optional held-out model (not optimized against) catches overfitting:
 * an otherwise-kept edit is reverted if it regresses the held-out model.
 *
 * Bounded by --max-attempts and --max-tokens; recovers from a mid-loop crash via a
 * marker; supports operator override in --interactive mode. --max-iterations 1 keeps the
 * eval-only mode (no editor). A single-element panel reproduces single-model behaviour.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CheckResult } from "./types.js";
import { isFailing, passCount, classifyVerdictDelta } from "./types.js";
import { ProviderError } from "./judge-client.js";
import { proposeEdit, applyEdit, type EditorDeps } from "./editor.js";
import type { CalibrationStamp } from "./gold-set.js";
import type { SkillIO } from "./skill-io.js";
import type { ProbeReport } from "./reporter.js";

export type ExitCode = 0 | 1 | 3;

export interface MarkerIO {
  exists(): boolean;
  read(): { iteration: number; snapshot: Map<string, string> } | null;
  write(iteration: number, snapshot: Map<string, string>): void;
  clear(): void;
}

export interface LoopOptions {
  /** >1 enables the editor; 1 = eval-only. */
  maxIterations: number;
  /** Per-checkpoint attempt budget (default 3). */
  maxAttempts?: number;
  maxTokens?: number;
  interactive?: boolean;
  /** Model names to optimize against (the board). Must have >= 1 entry. */
  panel: string[];
  /** Optional model NOT optimized against; an edit that regresses it is reverted (overfit guard). */
  holdout?: string;
}

export type EvalResult = {
  results: CheckResult[];
  reports: ProbeReport[];
  /** Candidate output per probe id, surfaced so the editor can see what failed. */
  transcripts?: Record<string, string>;
};

export interface LoopDeps {
  io: SkillIO;
  /**
   * Which instrument produced these verdicts, stamped into every iteration artifact.
   * The loop only ever runs on a calibrated judge, so this reads `ok` — and that is
   * the point: the artifact states positively what graded it, instead of leaving a
   * later reader to assume it.
   */
  calibration?: CalibrationStamp;
  /** Evaluate one model. With probeIds, evaluate only those probes (scoped). */
  evaluate: (probeIds: string[] | undefined, model: string) => Promise<EvalResult>;
  editor: EditorDeps;
  marker: MarkerIO;
  runDir: string;
  tokensUsed: () => number;
  promptOperator?: (diff: string, reasoning: string) => Promise<"keep" | "revert" | "abort">;
  log?: (msg: string) => void;
}

export interface LoopResult {
  exitCode: ExitCode;
  /** Total editor attempts made + 1 (the baseline). */
  cycles: number;
  /** Highest total pass count across the panel seen during the run. */
  bestPassCount: number;
}

const RANK: Record<string, number> = { fail: 0, partial: 1, pass: 2 };

function writeIterationHistory(
  runDir: string,
  n: number,
  io: SkillIO,
  verdictsByModel: Record<string, CheckResult[]>,
  reasoning: string,
  calibration?: CalibrationStamp
): void {
  const dir = path.join(runDir, `iteration-${n}`);
  mkdirSync(dir, { recursive: true });
  const verdicts = {
    ...(calibration ? { judgeCalibration: calibration } : {}),
    verdicts: verdictsByModel,
  };
  writeFileSync(path.join(dir, "verdicts.json"), JSON.stringify(verdicts, null, 2), "utf8");
  writeFileSync(path.join(dir, "editor-reasoning.txt"), reasoning, "utf8");
  const snap: Record<string, string> = {};
  for (const rel of io.list()) snap[rel] = io.read(rel);
  writeFileSync(path.join(dir, "skill-snapshot.json"), JSON.stringify(snap, null, 2), "utf8");
}

export async function runImprovementLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopResult> {
  const log = deps.log ?? (() => {});
  const maxAttempts = opts.maxAttempts ?? 3;
  const panel = opts.panel.length ? opts.panel : [];
  if (!panel.length) throw new Error("runImprovementLoop: panel must have at least one model");

  // Crash recovery.
  if (deps.marker.exists()) {
    const m = deps.marker.read();
    if (m) {
      deps.io.restore(m.snapshot);
      log(`crash recovery: reverted skill to the in-progress snapshot`);
    }
    deps.marker.clear();
  }

  try {
    // Baseline across the panel.
    const current = new Map<string, CheckResult[]>();
    const transcriptsByModel = new Map<string, Record<string, string>>();
    let refReports: ProbeReport[] = [];
    for (const m of panel) {
      const ev = await deps.evaluate(undefined, m);
      current.set(m, ev.results);
      transcriptsByModel.set(m, ev.transcripts ?? {});
      if (!refReports.length) refReports = ev.reports;
    }
    let holdoutCurrent: CheckResult[] | undefined;
    if (opts.holdout) holdoutCurrent = (await deps.evaluate(undefined, opts.holdout)).results;

    const verdictsRecord = (): Record<string, CheckResult[]> => {
      const r: Record<string, CheckResult[]> = {};
      for (const m of panel) r[m] = current.get(m)!;
      if (opts.holdout && holdoutCurrent) r[`holdout:${opts.holdout}`] = holdoutCurrent;
      return r;
    };
    const passTotal = () => [...current.values()].reduce((s, rs) => s + passCount(rs), 0);
    const failsAnywhere = (cid: string) =>
      panel.some((m) => {
        const r = current.get(m)!.find((x) => x.id === cid);
        return !!r && isFailing(r.verdict);
      });
    const anyFailing = () => refReports.flatMap((r) => r.results).some((x) => failsAnywhere(x.id));

    let bestPass = passTotal();
    writeIterationHistory(deps.runDir, 0, deps.io, verdictsRecord(), "(baseline, no edit)", deps.calibration);

    if (opts.maxIterations <= 1) {
      return { exitCode: anyFailing() ? 1 : 0, cycles: 1, bestPassCount: bestPass };
    }

    const probeOf = (cid: string) => refReports.find((r) => r.results.some((x) => x.id === cid))?.probe;
    const idsInProbe = (probe: string) => refReports.find((r) => r.probe === probe)?.results.map((x) => x.id) ?? [];
    const overBudget = () => !!opts.maxTokens && deps.tokensUsed() > opts.maxTokens;

    // Checkpoints failing on at least one panel model, in reference order.
    const failingOrder = refReports
      .flatMap((r) => r.results)
      .map((x) => x.id)
      .filter(failsAnywhere);
    let attempts = 0;

    for (const cid of failingOrder) {
      const probe = probeOf(cid);
      if (!probe) continue;
      const inScope = new Set(idsInProbe(probe));
      let feedback: string | undefined;

      for (let a = 0; a < maxAttempts; a++) {
        if (!failsAnywhere(cid)) break; // fixed on every model

        attempts++;
        const snapshot = deps.io.snapshot();
        deps.marker.write(attempts, snapshot);

        // Show the editor a representative failing instance of this checkpoint:
        // its verdict/reasoning, its rubric, and the candidate output that failed.
        const repModel = panel.find((m) => {
          const r = current.get(m)!.find((x) => x.id === cid);
          return !!r && isFailing(r.verdict);
        })!;
        const repC = current.get(repModel)!.find((x) => x.id === cid)!;
        const transcript = transcriptsByModel.get(repModel)?.[probe];

        const outcome = await proposeEdit(deps.io, [repC], deps.editor, {
          priorRejection: feedback,
          rubric: repC.rubric,
          transcript,
        });
        feedback = undefined;
        if (!outcome.ok) {
          deps.marker.clear();
          log(`checkpoint ${cid}: editor produced no usable change (${outcome.reason}); moving on`);
          break;
        }

        const applied = applyEdit(deps.io, outcome.proposal);
        if (!applied.ok) {
          deps.io.restore(snapshot);
          deps.marker.clear();
          feedback = applied.reason;
          log(`checkpoint ${cid} attempt ${a + 1}/${maxAttempts}: edit rejected (${applied.reason}); retrying smaller`);
          if (overBudget()) return { exitCode: 1, cycles: attempts + 1, bestPassCount: bestPass };
          continue;
        }

        // Scoped re-eval of the checkpoint's probe across the whole panel.
        const scopedByModel = new Map<string, CheckResult[]>();
        let improved = false;
        let regressed = false;
        for (const m of panel) {
          const scoped = await deps.evaluate([probe], m);
          scopedByModel.set(m, scoped.results);
          const before = current.get(m)!.filter((r) => inScope.has(r.id));
          const delta = classifyVerdictDelta(before, scoped.results, { targeted: new Set([cid]), inScope });
          if (delta.improved.length) improved = true;
          if (delta.regressed.length) regressed = true;
        }

        // Held-out overfit guard: an otherwise-kept edit must not regress the held-out model.
        let holdoutScoped: CheckResult[] | undefined;
        if (opts.holdout && improved && !regressed) {
          holdoutScoped = (await deps.evaluate([probe], opts.holdout)).results;
          const before = (holdoutCurrent ?? []).filter((r) => inScope.has(r.id));
          const d = classifyVerdictDelta(before, holdoutScoped, { targeted: new Set([cid]), inScope });
          if (d.regressed.length) regressed = true;
        }

        let keep = improved && !regressed; // Pareto: up on >=1, down on none
        if (opts.interactive && deps.promptOperator) {
          const op = await deps.promptOperator(outcome.proposal.change, outcome.proposal.editor_reasoning);
          if (op === "abort") {
            deps.io.restore(snapshot);
            deps.marker.clear();
            log(`checkpoint ${cid}: operator aborted`);
            return { exitCode: anyFailing() ? 1 : 0, cycles: attempts + 1, bestPassCount: bestPass };
          }
          keep = op === "keep";
        }

        if (keep) {
          for (const m of panel) {
            const byId = new Map(scopedByModel.get(m)!.map((r) => [r.id, r]));
            current.set(
              m,
              current.get(m)!.map((r) => byId.get(r.id) ?? r)
            );
          }
          if (opts.holdout && holdoutScoped) {
            const byId = new Map(holdoutScoped.map((r) => [r.id, r]));
            holdoutCurrent = (holdoutCurrent ?? []).map((r) => byId.get(r.id) ?? r);
          }
          bestPass = Math.max(bestPass, passTotal());
          writeIterationHistory(
            deps.runDir,
            attempts,
            deps.io,
            verdictsRecord(),
            outcome.proposal.editor_reasoning,
            deps.calibration
          );
          deps.marker.clear();
          log(`checkpoint ${cid} attempt ${a + 1}/${maxAttempts}: kept (panel improved, no regression)`);
        } else {
          deps.io.restore(snapshot);
          deps.marker.clear();
          feedback = regressed
            ? `Your edit regressed a checkpoint for at least one model. Fix ONLY ${cid} without breaking any model.`
            : `Your edit did not improve ${cid} for any model. Try a different, still strictly surgical fix.`;
          log(
            `checkpoint ${cid} attempt ${a + 1}/${maxAttempts}: reverted (${regressed ? "regression" : "no improvement"})`
          );
        }

        if (overBudget()) return { exitCode: 1, cycles: attempts + 1, bestPassCount: bestPass };
      }
    }

    return { exitCode: anyFailing() ? 1 : 0, cycles: attempts + 1, bestPassCount: bestPass };
  } catch (err) {
    if (err instanceof ProviderError) {
      log(`provider error aborted the run: ${err.message}`);
      return { exitCode: 3, cycles: 0, bestPassCount: 0 };
    }
    throw err;
  }
}
