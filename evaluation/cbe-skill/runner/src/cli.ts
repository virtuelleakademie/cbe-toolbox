#!/usr/bin/env node
/**
 * cbe-eval CLI — the on-demand live evaluation harness. Never run by `npm test`.
 *
 *   npm run eval -- --model <name> [--scenarios 07-12] [--parallel 2]
 *   npm run eval -- --compare
 *   npm run eval -- --max-iterations 3 [--max-tokens N] [--interactive]
 *   npm run eval -- --dry-run --scenarios 07
 *
 * Exit codes: 0 the run completed · 1 the improvement loop (`--max-iterations > 1`) still
 * has failing items after its budget · 2 CLI/config · 3 provider · 4 judge calibration
 * below threshold (the instrument failed, not the skill).
 *
 * A plain eval run does NOT exit non-zero because checkpoints are red: every scenario is
 * equal-ranked and the suite measures rather than gates (product decision 2026-08-07).
 * Read the per-probe table in `run-summary.md` and route what is red.
 */

import { Command } from "commander";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  loadRawConfig,
  resolveCalibrationThreshold,
  resolveConfig,
  resolveConfigPath,
  ConfigError,
  type ResolvedModel,
} from "./config.js";
import { loadSecretsIntoEnv, describeSecretsSearch } from "./secrets.js";
import { loadAppCandidate, defaultAppConfigPath, secretVarNamesForRun } from "./app-config.js";
import { loadCorpusHeadings, loadCorpusIds, loadCorpusPaths, loadProbesFromFile } from "./loader.js";
import { createPiEvalSessionFactory, evalWorkspaceRoot } from "./session-pi.js";
import { ProviderError } from "./judge-client.js";
import { createClaudeCliClient } from "./judge-claude-cli.js";
import { runProbe, fullAssistantText } from "./runner.js";
import { scoreProbeRepeated } from "./scorer.js";
import {
  attributeStability,
  renderStabilityLine,
  JUDGE_REPEAT_HELP,
  REPEAT_HELP,
  type ScoredTranscript,
} from "./stability.js";
import {
  calibrationGateFor,
  dryRunPlan,
  runComparison,
  runModel,
  runWithCalibration,
  selectScenarios,
  validateCliOptions,
  validateNumericOptions,
  CliOptionError,
  LOOP_REQUIRES_CALIBRATED_JUDGE,
  type CalibrationGate,
  type RunMode,
} from "./orchestrator.js";
import { aggregateStability, writeCalibration, writeTranscript, type ProbeReport } from "./reporter.js";
import { loadSkillTree, resolveAnchor } from "./trace-check.js";
import {
  DEFAULT_CALIBRATION_THRESHOLD,
  GoldSetError,
  loadGoldSet,
  renderCalibrationMd,
  runGoldSet,
  unscoredSummary,
  type CalibrationStamp,
} from "./gold-set.js";
import { runImprovementLoop } from "./loop.js";
import { FsSkillIO } from "./skill-io.js";
import { FsMarkerIO } from "./marker-fs.js";
import type { CheckResult } from "./types.js";
import { majorityVerdict } from "./types.js";

function repoRoot(): string {
  // dist/cli.js -> evaluation/cbe-skill/runner/dist -> repo root is four up.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function skillVersionOf(skillRoot: string): string {
  try {
    const m = /## Skill version:\s*([^\s(]+)/.exec(readFileSync(path.join(skillRoot, "SKILL.md"), "utf8"));
    return m?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("cbe-eval")
    .option("--model <name>", "evaluate a single configured candidate")
    .option("--scenarios <range>", "scenario selection, e.g. 07 or 07-12")
    .option("--compare", "run all configured candidates and produce a comparison matrix")
    .option("--repeat <n>", REPEAT_HELP, (v) => Number(v), 1)
    .option("--judge-repeat <n>", JUDGE_REPEAT_HELP, (v) => Number(v), 1)
    .option(
      "--allow-unreliable-judge",
      "EVAL-ONLY: continue after a failed gold-set calibration for diagnosis. The run is completed and every artifact is stamped `unreliable`, and it still exits 4 — it is never reported as green. It does NOT apply to --max-iterations > 1: the improvement loop edits skills/cbe/ in place and always aborts on a failed calibration."
    )
    .option("--max-iterations <n>", "improvement-loop cycles (1 = eval only)", (v) => Number(v), 1)
    .option("--max-attempts <n>", "per-checkpoint attempt budget in the improvement loop", (v) => Number(v), 3)
    .option(
      "--panel <names>",
      "comma-separated candidate names to optimize the loop against (default: the single model)"
    )
    .option(
      "--holdout <name>",
      "candidate held out of optimization; an edit that regresses it is reverted (overfit guard)"
    )
    .option("--max-tokens <n>", "cumulative token budget across all LLM calls", (v) => Number(v))
    .option("--parallel <n>", "max probes in flight", (v) => Number(v), 2)
    .option("--interactive", "pause for operator keep/revert/abort after each edit")
    .option(
      "--dry-run",
      "structure green, behaviour unverified: parse scenarios and print the plan. No LLM call, no score — it proves the harness is wired, never that the skill behaves"
    )
    .option("--output-dir <path>", "where to write run artifacts")
    .option("--judge-model <name>", "Claude CLI model for the judge/editor (e.g. sonnet, opus)")
    .option("--app-config <path>", "override path to the app's cbe-config.json (candidate source)");
  program.parse(process.argv);
  const opts = program.opts();

  // Numeric flags are validated before anything else, on every path including
  // --dry-run: a NaN repeat count survives every downstream clamp and turns into
  // unscored checkpoints reported as ordinary failures.
  try {
    validateNumericOptions(opts);
  } catch (err) {
    if (err instanceof CliOptionError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const root = repoRoot();
  const scenariosDir = path.join(root, "evaluation", "cbe-skill", "scenarios");
  const corpusIndex = path.join(root, "corpus", "index.json");
  const skillRoot = path.join(root, "skills", "cbe");
  const runsBase = opts.outputDir ? path.resolve(opts.outputDir) : path.join(root, "evaluation", "cbe-skill", "runs");

  const allFiles = readdirSync(scenariosDir)
    .filter((f) => /^\d.*\.md$/.test(f))
    .sort();
  const selected = selectScenarios(allFiles, opts.scenarios).map((f) => path.join(scenariosDir, f));
  if (selected.length === 0) {
    console.error(`no scenarios matched ${opts.scenarios ?? "(all)"}`);
    return 2;
  }

  const corpusIds = loadCorpusIds(corpusIndex);
  const corpusPaths = loadCorpusPaths(corpusIndex);
  const corpusHeadings = loadCorpusHeadings(corpusIndex);
  const channelTree = await loadSkillTree(skillRoot);
  const loadProbes = (file: string) =>
    loadProbesFromFile(file, corpusIds, {
      onWarn: (m) => console.warn(`[warn] ${m}`),
      resolveAnchor: (anchor) => resolveAnchor(anchor, channelTree),
    });

  // Dry run: no config, no network. It exercises the real loader — so it catches a
  // scenario that silently stops parsing, an unmapped checkpoint, an invented corpus
  // id — but it contacts no model and therefore says NOTHING about model behaviour.
  if (opts.dryRun) {
    const plan = await dryRunPlan(selected, loadProbes);
    for (const line of plan.lines) console.log(line);
    console.log("Structure green, behaviour unverified — a dry run makes no LLM call and scores nothing.");
    return 0;
  }

  // Judge + editor default to the local Claude CLI — no judge endpoint or key needed.
  const judgeClient = createClaudeCliClient({ model: opts.judgeModel });
  const editorClient = judgeClient;

  // Candidate resolution:
  //  --compare / --model -> from eval.config.json candidates (multi-model)
  //  default             -> the LLM configured in the CBE Toolbox app (cbe-config.json)
  //
  // The configuration is read BEFORE the credentials, because it is what names the
  // environment variables a secrets file may fill — nothing outside that set is
  // imported. An already-set variable still wins and is never overwritten.
  let candidates: ResolvedModel[];
  let single: ResolvedModel;
  let calibrationThreshold = DEFAULT_CALIBRATION_THRESHOLD;
  try {
    const usesBoard = Boolean(opts.compare || opts.model || opts.panel);
    const rawConfig = usesBoard ? loadRawConfig(resolveConfigPath(root)) : undefined;

    // The calibration threshold belongs to the instrument, not to the candidate
    // source, so it is read from eval.config.json on the default path too — where
    // rawConfig stays undefined because the candidate comes from the app config.
    calibrationThreshold = resolveCalibrationThreshold(root, rawConfig, DEFAULT_CALIBRATION_THRESHOLD);

    // Each candidate path whitelists exactly the variables IT uses — see
    // secretVarNamesForRun for why the board path must not also pull in the
    // app-config key variable.
    const wanted = new Set<string>(secretVarNamesForRun(rawConfig));
    const secrets = loadSecretsIntoEnv(root, wanted, process.env, (m) => console.warn(m));
    const secretsHint = describeSecretsSearch(secrets);

    if (rawConfig) {
      const config = resolveConfig(rawConfig, process.env, secretsHint);
      validateCliOptions(
        opts,
        config.candidates.map((c) => c.name)
      );
      candidates = config.candidates;
      single = config.candidates.find((c) => c.name === opts.model) ?? config.candidates[0]!;
    } else {
      single = loadAppCandidate(opts.appConfig ?? defaultAppConfigPath(), process.env, secretsHint);
      candidates = [single];
      console.error(`[candidate] using the app-configured LLM: ${single.modelId} @ ${single.baseURL}`);
    }
  } catch (err) {
    if (err instanceof ConfigError || err instanceof CliOptionError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const now = timestamp();
  // The agent's workspace root lives OUTSIDE the checkout: inside it, pi's
  // context-file walk would inline the repo's own AGENTS.md into the system
  // prompt as project instructions, which the desktop app never does. See
  // `evalWorkspaceRoot`.
  const workspaceRoot = evalWorkspaceRoot(now, root);

  const sessionFactory = (model: ResolvedModel) =>
    createPiEvalSessionFactory({
      skillDir: skillRoot,
      sessionsDir: path.join(runsBase, "sessions"),
      agentDir: path.join(root, ".cbe-agent"),
      workspaceRoot,
      provider: {
        baseURL: model.baseURL,
        apiKey: model.apiKey,
        modelId: model.modelId,
        contextLength: model.contextLength,
        reasoning: model.reasoning,
        reasoningEffort: model.reasoningEffort,
      },
      corpus: path.join(root, "corpus"),
    });

  const runDir = path.join(runsBase, `run-${now}`);
  const skillVersion = skillVersionOf(skillRoot);
  const judgeRepeat = Math.max(1, opts.judgeRepeat ?? 1);
  const deps = {
    corpusIds,
    corpusPaths,
    corpusHeadings,
    loadProbes,
    sessionFactory,
    judgeDeps: { client: judgeClient },
    parallel: opts.parallel,
    runDir,
    now,
    skillVersion,
    // Honour --repeat in the plain eval + compare paths (not just the improvement loop):
    // runModel majority-votes the verdict across N runs and writes one transcript per run.
    repeat: Math.max(1, opts.repeat ?? 1),
    // --judge-repeat re-scores the SAME transcript, isolating judge variance.
    judgeRepeat,
  };

  // The judge is the measuring instrument: calibrate it against the hand-labelled
  // gold set BEFORE the first candidate token, because numbers produced by an
  // uncalibrated judge cannot be read either way.
  const goldDir = path.join(root, "evaluation", "cbe-skill", "fixtures", "gold");
  // The loop mutates skills/cbe/ in place and picks its keeps from the judge's own
  // verdicts, so diagnosis mode stops at the eval paths. calibrationGateFor makes
  // that mechanical: the loop gate cannot carry allowUnreliable, whatever was passed.
  // --compare takes the comparison branch below and never reaches the editor, so it
  // stays an eval path however --max-iterations was set.
  const mode: RunMode = !opts.compare && opts.maxIterations > 1 ? "loop" : "eval";
  const diagnosisMode = mode === "eval" && Boolean(opts.allowUnreliableJudge);
  if (mode === "loop" && opts.allowUnreliableJudge) {
    console.error(`[calibration] --allow-unreliable-judge is not honoured here. ${LOOP_REQUIRES_CALIBRATED_JUDGE}`);
  }
  const gate: CalibrationGate = calibrationGateFor(mode, {
    run: async () => {
      const triples = loadGoldSet(goldDir);
      console.error(`[calibration] scoring ${triples.length} gold triple(s) against the judge…`);
      return runGoldSet(
        triples,
        { client: judgeClient },
        { threshold: calibrationThreshold, judgeRepeat, parallel: opts.parallel }
      );
    },
    allowUnreliable: Boolean(opts.allowUnreliableJudge),
    onReport: (report) => {
      writeCalibration(runDir, report, renderCalibrationMd(report));
      if (report.status === "ok") {
        // The unscored split is printed on an OK calibration too: a partial judge
        // outage that still clears the threshold would otherwise be announced as a
        // clean OK on the operator's primary channel.
        const unscored = unscoredSummary(report.unscored, report.unscoredCauses);
        console.log(
          `[calibration] judge OK — clear-pass ${report.passDirection.agreed}/${report.passDirection.total}, ` +
            `clear-fail ${report.failDirection.agreed}/${report.failDirection.total} ` +
            `(threshold ${(report.threshold * 100).toFixed(0)}%)` +
            `${unscored ? `. ${unscored}` : ""}. Artifacts: ${runDir}/gold-set.md`
        );
      } else {
        console.error("=".repeat(78));
        console.error(report.banner);
        if (diagnosisMode) {
          console.error("Continuing for diagnosis (--allow-unreliable-judge). Every artifact is stamped `unreliable`.");
        } else if (mode === "loop") {
          console.error(`Aborting before any candidate token is spent. ${LOOP_REQUIRES_CALIBRATED_JUDGE}`);
        } else {
          console.error(
            "Aborting before any candidate token is spent. Re-run with --allow-unreliable-judge to diagnose."
          );
        }
        console.error(`Details: ${runDir}/gold-set.md`);
        console.error("=".repeat(78));
      }
    },
  });

  try {
    if (opts.compare) {
      const outcome = await runWithCalibration(gate, (calibration: CalibrationStamp | undefined) =>
        runComparison(selected, candidates, { ...deps, calibration })
      );
      if (!outcome.result) return outcome.exitCode;
      console.log(`Recommendation: ${outcome.result.recommendation ?? "(none)"}  (reports in ${runDir})`);
      return outcome.exitCode;
    }

    const model = single;

    if (opts.maxIterations > 1) {
      // Improvement loop: evaluate runs all selected probes for this model.
      // Panel = the candidate names the loop optimizes against (default: the single model).
      const byName = new Map(candidates.map((c) => [c.name, c] as const));
      const panel = opts.panel
        ? String(opts.panel)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [model.name];
      for (const name of [...panel, ...(opts.holdout ? [opts.holdout] : [])]) {
        if (!byName.has(name)) {
          console.error(`--panel/--holdout: unknown model "${name}". Known: ${[...byName.keys()].join(", ")}`);
          return 2;
        }
      }
      const factoryCache = new Map<string, ReturnType<typeof sessionFactory>>();
      const factoryFor = (name: string) => {
        let f = factoryCache.get(name);
        if (!f) {
          f = sessionFactory(byName.get(name)!);
          factoryCache.set(name, f);
        }
        return f;
      };
      const repeat = Math.max(1, opts.repeat ?? 1);
      // Evaluate one panel model; with probeIds, only those probes (scoped re-eval).
      const evaluate = async (
        probeIds: string[] | undefined,
        modelName: string
      ): Promise<{ results: CheckResult[]; reports: ProbeReport[]; transcripts: Record<string, string> }> => {
        const allProbes = (await Promise.all(selected.map(loadProbes))).flat();
        const probes = probeIds ? allProbes.filter((p) => probeIds.includes(p.probe)) : allProbes;
        const factory = factoryFor(modelName);
        const reports: ProbeReport[] = [];
        const results: CheckResult[] = [];
        const transcripts: Record<string, string> = {};
        for (const p of probes) {
          const scored: ScoredTranscript[] = [];
          let lastTranscript: Awaited<ReturnType<typeof runProbe>> | undefined;
          for (let i = 0; i < repeat; i++) {
            const transcript = await runProbe(p, factory, modelName);
            lastTranscript = transcript;
            // Prefix transcripts with the model so per-model re-evals do not overwrite.
            writeTranscript(runDir, {
              ...transcript,
              probe: `${modelName}-${p.probe}${repeat > 1 ? `.r${i + 1}` : ""}`,
            });
            scored.push(
              await scoreProbeRepeated(
                p,
                transcript,
                { corpusIds, corpusPaths, corpusHeadings, judge: { client: judgeClient } },
                judgeRepeat
              )
            );
          }
          if (lastTranscript) transcripts[p.probe] = fullAssistantText(lastTranscript);
          const runs: CheckResult[][] = scored.map((s) => s.results);
          const r = repeat > 1 ? majorityVerdict(runs) : runs[0]!;
          const stability = attributeStability(scored, judgeRepeat);
          reports.push({
            probe: p.probe,
            model: modelName,
            results: r,
            ...(repeat > 1 || judgeRepeat > 1 ? { stability } : {}),
          });
          results.push(...r);
        }
        return { results, reports, transcripts };
      };
      const loopOutcome = await runWithCalibration(gate, (calibration: CalibrationStamp | undefined) =>
        runImprovementLoop(
          {
            maxIterations: opts.maxIterations,
            maxAttempts: opts.maxAttempts,
            maxTokens: opts.maxTokens,
            interactive: opts.interactive,
            panel,
            holdout: opts.holdout,
          },
          {
            io: new FsSkillIO(skillRoot),
            calibration,
            evaluate,
            editor: { client: editorClient },
            marker: new FsMarkerIO(path.join(runsBase, ".eval-loop-in-progress.json")),
            runDir,
            tokensUsed: () => judgeClient.tokensUsed + editorClient.tokensUsed,
            log: (m) => console.log(`[loop] ${m}`),
          }
        )
      );
      if (!loopOutcome.result) return loopOutcome.exitCode;
      const result = loopOutcome.result;
      console.log(
        `Loop finished: exit ${result.exitCode}, ${result.cycles} cycle(s), best pass ${result.bestPassCount}. Artifacts: ${runDir}`
      );
      // A failed calibration outranks the loop's own verdict: its numbers came off
      // an instrument that did not hold.
      return loopOutcome.exitCode || result.exitCode;
    }

    // Single eval-only run.
    const outcome = await runWithCalibration(gate, (calibration: CalibrationStamp | undefined) =>
      runModel(selected, model, { ...deps, calibration })
    );
    if (!outcome.result) return outcome.exitCode;
    const reports = outcome.result;
    const nonpassing = reports.flatMap((r) => r.results).filter((r) => r.verdict !== "pass");
    console.log(
      `Done. ${reports.length} probe(s) scored. ${nonpassing.length} non-passing checkpoint(s). Reports: ${runDir}`
    );
    const flips = aggregateStability(reports);
    if (flips.judgeFlips || flips.modelFlips) console.log(renderStabilityLine(flips));
    // A red checkpoint is a finding, not a process failure: every scenario is
    // equal-ranked and the run reports rather than gates. The only non-zero code left
    // on this path is the judge calibration's.
    return outcome.exitCode;
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(`provider error: ${err.message}`);
      return 3;
    }
    // A gold set that cannot be loaded is an instrument/config failure, not a failing
    // checkpoint. Exit 1 would send the operator to the checkpoint numbers of a run
    // that never scored one — the exact conflation the dedicated codes remove.
    if (err instanceof GoldSetError) {
      console.error(`gold set: ${err.message}`);
      console.error(
        "The judge calibration gold set could not be loaded, so no checkpoint was scored. " +
          "Fix the gold set or its path; this is not a checkpoint failure."
      );
      return 2;
    }
    throw err;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
