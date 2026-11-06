import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateCliOptions,
  validateNumericOptions,
  selectScenarios,
  dryRunPlan,
  runModel,
  CliOptionError,
  type RunDeps,
} from "../src/orchestrator.js";
import { mockSessionFactory } from "../src/session-eval.js";
import type { Probe } from "../src/types.js";
import type { ResolvedModel } from "../src/config.js";

const MODEL: ResolvedModel = { name: "qwen", modelId: "q", baseURL: "x", apiKey: "y" };
const FILES = ["01-a.md", "06-b.md", "07-kompetenz.md", "08-align.md", "12-soft.md"];

function probe(id: string): Probe {
  return {
    probe: id,
    scenarioFile: `${id}.md`,
    setup: { profile: "app" },
    turns: ["t"],
    checkpoints: [{ id: `${id}.1`, type: "deterministic", check: { kind: "contains", pattern: "ok" } }],
  };
}

describe("a plain run does not gate", () => {
  // Every scenario is equal-ranked (product decision 2026-08-07): the suite MEASURES.
  // `singleRunExitCode` is gone with the gate — a red checkpoint is a finding routed
  // through `traceability.json`, not a reason to fail the process. The exit codes that
  // survive signal a failed RUN (2 CLI/config, 3 provider) or a failed INSTRUMENT
  // (4 judge calibration), and the improvement loop keeps its own convergence verdict.
  //
  // What these two assertions catch is the HELPER RETURNING, not that a run exits 0: the
  // exit path itself is decided in `main()` in `cli.ts`, which is module-private, and
  // extracting it for a test was ruled out. Re-introducing a verdict helper is the
  // realistic regression, and that is what fails here.
  it("exports no per-run pass/fail verdict helper", async () => {
    const orchestrator = await import("../src/orchestrator.js");
    for (const gone of ["singleRunExitCode", "gateVerdict", "isGateProbe", "GATE_SCENARIOS"]) {
      expect(gone in orchestrator, `${gone} still exported — the gate is meant to be gone`).toBe(false);
    }
  });

  it("exports no gate machinery from the reporter either", async () => {
    const reporter = await import("../src/reporter.js");
    for (const gone of ["gateVerdict", "isGateProbe", "GATE_SCENARIOS"]) {
      expect(gone in reporter, `${gone} still exported — the gate is meant to be gone`).toBe(false);
    }
  });
});

describe("CLI option validation", () => {
  // spec: CLI rejects invalid flag combinations
  it("rejects --compare together with --model", () => {
    expect(() => validateCliOptions({ compare: true, model: "qwen" }, ["qwen"])).toThrow(CliOptionError);
  });

  // spec: Unknown model name exits with an error
  it("rejects an unknown --model and lists candidates", () => {
    expect(() => validateCliOptions({ model: "gpt" }, ["qwen", "llama"])).toThrow(/qwen, llama/);
  });

  it("accepts a valid single model", () => {
    expect(() => validateCliOptions({ model: "qwen" }, ["qwen"])).not.toThrow();
  });
});

// spec: A non-integer repetition count is rejected before the run starts
describe("numeric flag validation", () => {
  it("rejects a non-numeric --judge-repeat instead of silently scoring nothing", () => {
    // Commander's Number(v) turns "x" into NaN; Math.max(1, NaN) stays NaN, so every
    // scoring loop would be skipped and its checkpoints reported as ordinary failures.
    expect(() => validateNumericOptions({ judgeRepeat: Number("x") })).toThrow(
      /--judge-repeat must be a positive integer/
    );
  });

  it("rejects a non-numeric --repeat", () => {
    expect(() => validateNumericOptions({ repeat: Number("nope") })).toThrow(/--repeat must be a positive integer/);
  });

  it("rejects a fractional or non-positive count", () => {
    expect(() => validateNumericOptions({ judgeRepeat: 2.5 })).toThrow(CliOptionError);
    expect(() => validateNumericOptions({ repeat: 0 })).toThrow(CliOptionError);
    expect(() => validateNumericOptions({ parallel: -1 })).toThrow(CliOptionError);
    expect(() => validateNumericOptions({ maxIterations: Number.NaN })).toThrow(CliOptionError);
  });

  it("accepts the defaults and an omitted optional budget", () => {
    expect(() =>
      validateNumericOptions({ repeat: 1, judgeRepeat: 1, maxIterations: 1, maxAttempts: 3, parallel: 2 })
    ).not.toThrow();
  });

  it("is enforced through validateCliOptions as well", () => {
    expect(() => validateCliOptions({ model: "qwen", repeat: Number("x") }, ["qwen"])).toThrow(CliOptionError);
  });
});

describe("selectScenarios", () => {
  it("selects a range 07-12", () => {
    expect(selectScenarios(FILES, "07-12")).toEqual(["07-kompetenz.md", "08-align.md", "12-soft.md"]);
  });
  it("selects a single id 07", () => {
    expect(selectScenarios(FILES, "07")).toEqual(["07-kompetenz.md"]);
  });
  it("returns all when no range", () => {
    expect(selectScenarios(FILES)).toEqual(FILES);
  });

  // Requirement: *The Runner Selects Scenarios by the Suite's Own Ids* — the replacement
  // suite is named S1..S9, and a selection is frequently NON-CONTIGUOUS (S3, S6, S7, S8).
  // Neither an `S` prefix nor a comma-separated list parsed before this change, so a
  // documented multi-scenario command did not run at all.
  const SUITE = ["01-opening.md", "03-competency-check.md", "06-citing.md", "07-non-negotiables.md", "08-safety.md"];

  it("accepts an S-prefixed id, case-insensitively", () => {
    expect(selectScenarios(SUITE, "S3")).toEqual(["03-competency-check.md"]);
    expect(selectScenarios(SUITE, "s3")).toEqual(["03-competency-check.md"]);
  });

  it("accepts a non-contiguous set as a comma-separated list", () => {
    expect(selectScenarios(SUITE, "S3,S6,S7,S8")).toEqual([
      "03-competency-check.md",
      "06-citing.md",
      "07-non-negotiables.md",
      "08-safety.md",
    ]);
  });

  it("accepts a list mixing ids and ranges, and tolerates spaces", () => {
    expect(selectScenarios(SUITE, "01, 06-08")).toEqual([
      "01-opening.md",
      "06-citing.md",
      "07-non-negotiables.md",
      "08-safety.md",
    ]);
  });

  it("REJECTS an id no scenario file carries, naming it — never an empty selection reported as a clean run", () => {
    expect(() => selectScenarios(SUITE, "S3,S99")).toThrow(CliOptionError);
    expect(() => selectScenarios(SUITE, "S3,S99")).toThrow(/no scenario file carries: 99/);
    expect(() => selectScenarios(SUITE, "S3,S99")).toThrow(/Available: 01, 03, 06, 07, 08/);
  });

  it("rejects a malformed selector, naming the offending part", () => {
    expect(() => selectScenarios(SUITE, "S3,banana")).toThrow(/invalid --scenarios selector "banana"/);
  });
});

describe("dry run", () => {
  // spec: Dry run validates without LLM calls
  it("plans probes and reports zero LLM calls", async () => {
    const plan = await dryRunPlan(["07.md", "08.md"], async (f) => [probe(path.basename(f, ".md"))]);
    expect(plan.probeCount).toBe(2);
    expect(plan.lines.at(-1)).toMatch(/No LLM calls made/);
  });
});

describe("runModel (parallel, isolated reports)", () => {
  // spec: Single-model run reports per-checkpoint results + Multi-probe run completes without collisions
  it("writes a report per probe with no collisions under --parallel 2", async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "cbe-run-"));
    const factory = mockSessionFactory([{ assistant: "ok", tools: [] }]);
    const deps: RunDeps = {
      corpusIds: new Set(),
      corpusPaths: new Map(),
      loadProbes: async (f) => [probe(path.basename(f, ".md"))],
      sessionFactory: () => factory,
      parallel: 2,
      runDir,
      now: "2026-05-29",
      skillVersion: "v0.1",
    };
    const reports = await runModel(["07.md", "08.md", "09.md"], MODEL, deps);
    expect(reports).toHaveLength(3);
    for (const id of ["07", "08", "09"]) {
      expect(existsSync(path.join(runDir, `${id}-report.json`))).toBe(true);
      expect(existsSync(path.join(runDir, `${id}-findings.md`))).toBe(true);
      expect(existsSync(path.join(runDir, `${id}-transcript.json`))).toBe(true);
    }
    // each report records its single checkpoint result
    const r07 = JSON.parse(readFileSync(path.join(runDir, "07-report.json"), "utf8")) as { items: unknown[] };
    expect(r07.items).toHaveLength(1);
    expect(existsSync(path.join(runDir, "index.json"))).toBe(true);
  });

  // spec: --repeat is honoured in the plain eval path (majority verdict; one transcript per run)
  it("honours deps.repeat — N runs per probe, one transcript each (no overwrite), majority-voted report", async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "cbe-repeat-"));
    const factory = mockSessionFactory([{ assistant: "ok", tools: [] }]);
    const deps: RunDeps = {
      corpusIds: new Set(),
      corpusPaths: new Map(),
      loadProbes: async (f) => [probe(path.basename(f, ".md"))],
      sessionFactory: () => factory,
      parallel: 2,
      runDir,
      now: "2026-05-29",
      skillVersion: "v0.1",
      repeat: 3,
    };
    const reports = await runModel(["07.md"], MODEL, deps);
    expect(reports).toHaveLength(1);
    // One transcript PER run (`.r1/.r2/.r3`) — repeats do not overwrite each other.
    for (const r of ["r1", "r2", "r3"]) {
      expect(existsSync(path.join(runDir, `07.${r}-transcript.json`))).toBe(true);
    }
    // The bare (single-run) transcript name is NOT used when repeat > 1.
    expect(existsSync(path.join(runDir, "07-transcript.json"))).toBe(false);
    // A single majority-voted report is still written per probe.
    expect(existsSync(path.join(runDir, "07-report.json"))).toBe(true);
  });
});

describe("selectScenarios — a range is a span, not an enumeration", () => {
  const SPARSE = ["01-opening.md", "06-citing.md", "12-last.md"];

  it("accepts a range that spans gaps", () => {
    // `01-12` must not require 02..05 and 07..11 to exist.
    expect(selectScenarios(SPARSE, "01-12")).toEqual(SPARSE);
  });

  it("rejects a range that matches no file at all", () => {
    expect(() => selectScenarios(SPARSE, "20-30")).toThrow(/range "20-30" matches no scenario file/);
  });
});
