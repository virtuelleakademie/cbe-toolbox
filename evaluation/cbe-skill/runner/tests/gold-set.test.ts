/**
 * Judge calibration — the gold set. Every test here uses a stubbed judge client;
 * no model is contacted.
 *
 * spec: cbe-skill-eval-harness, Requirement "Judge calibration against a hand-labelled gold set"
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CALIBRATION_THRESHOLD,
  GoldSetError,
  MIN_TRIPLES_PER_DIRECTION,
  calibrationStamp,
  classifyUnscored,
  loadGoldSet,
  parseGoldTriple,
  renderCalibrationMd,
  runGoldSet,
  stampUnscoredSummary,
  validateGoldSetBalance,
  type GoldTriple,
} from "../src/gold-set.js";
import {
  calibrationGateFor,
  runWithCalibration,
  EXIT_UNRELIABLE_JUDGE,
  LOOP_REQUIRES_CALIBRATED_JUDGE,
} from "../src/orchestrator.js";
import { runImprovementLoop } from "../src/loop.js";
import { MemorySkillIO } from "../src/skill-io.js";
import type { CheckResult } from "../src/types.js";
import type { LlmClient, LlmCompletion } from "../src/judge-client.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const goldDir = path.join(repoRoot, "evaluation", "cbe-skill", "fixtures", "gold");
const TEMPLATE = "rubric:{{rubric}} transcript:{{transcript}}";

/** A judge that answers from a verdict-by-triple map, defaulting to `verdict`. */
function stubJudge(verdict: string, byId: Record<string, string> = {}): LlmClient & { calls: number } {
  const stub = {
    modelId: "stub-judge",
    tokensUsed: 0,
    calls: 0,
    async complete(_system: string, user: string): Promise<LlmCompletion> {
      stub.calls += 1;
      const hit = Object.keys(byId).find((k) => user.includes(k));
      return { text: JSON.stringify({ verdict: hit ? byId[hit] : verdict, reasoning: "stub" }) };
    },
  };
  return stub;
}

/** A judge that reproduces the labelled expectation of each triple. */
function perfectJudge(triples: GoldTriple[]): LlmClient {
  const byAnswer = new Map(triples.map((t) => [t.answer.slice(0, 40), t.expected]));
  return {
    modelId: "perfect-judge",
    tokensUsed: 0,
    async complete(_system: string, user: string): Promise<LlmCompletion> {
      for (const [needle, verdict] of byAnswer) {
        if (user.includes(needle)) return { text: JSON.stringify({ verdict, reasoning: "stub" }) };
      }
      return { text: JSON.stringify({ verdict: "not-assessable", reasoning: "unmatched" }) };
    },
  };
}

function triple(over: Partial<GoldTriple> = {}): GoldTriple {
  return {
    id: "t",
    rubric: "r",
    answer: "a",
    expected: "pass",
    label: "clear-pass",
    note: "n",
    ...over,
  };
}

function balancedSet(): GoldTriple[] {
  const passes = Array.from({ length: MIN_TRIPLES_PER_DIRECTION }, (_, i) =>
    triple({ id: `p${i}`, answer: `pass-answer-${i}`, expected: "pass", label: "clear-pass" })
  );
  const fails = Array.from({ length: MIN_TRIPLES_PER_DIRECTION }, (_, i) =>
    triple({ id: `f${i}`, answer: `fail-answer-${i}`, expected: "fail", label: "clear-fail" })
  );
  return [
    ...passes,
    ...fails,
    triple({ id: "b0", answer: "borderline-answer", expected: "partial", label: "borderline" }),
  ];
}

describe("the shipped gold set", () => {
  const triples = loadGoldSet(goldDir);

  it("carries at least 20 triples covering both directions plus borderline cases", () => {
    expect(triples.length).toBeGreaterThanOrEqual(20);
    expect(triples.filter((t) => t.label === "clear-pass").length).toBeGreaterThanOrEqual(MIN_TRIPLES_PER_DIRECTION);
    expect(triples.filter((t) => t.label === "clear-fail").length).toBeGreaterThanOrEqual(MIN_TRIPLES_PER_DIRECTION);
    expect(triples.filter((t) => t.label === "borderline").length).toBeGreaterThanOrEqual(1);
  });

  // spec: A passing calibration is recorded with the run
  it("a judge reproducing every label clears both directions", async () => {
    const report = await runGoldSet(triples, { client: perfectJudge(triples), template: TEMPLATE });
    expect(report.status).toBe("ok");
    expect(report.passDirection.rate).toBe(1);
    expect(report.failDirection.rate).toBe(1);
    const stamp = calibrationStamp(report);
    expect(stamp).toMatchObject({
      status: "ok",
      judgeModel: "perfect-judge",
      threshold: DEFAULT_CALIBRATION_THRESHOLD,
    });
  });

  it("every triple carries a note explaining its label", () => {
    expect(triples.every((t) => t.note.trim().length > 20)).toBe(true);
  });
});

describe("gold-set balance validation", () => {
  // spec: A gold set without both directions is rejected
  it("rejects a set with no clear-fail triples, naming the direction and the counts", () => {
    const passesOnly = balancedSet().filter((t) => t.label !== "clear-fail");
    expect(() => validateGoldSetBalance(passesOnly)).toThrow(/clear-fail/);
    expect(() => validateGoldSetBalance(passesOnly)).toThrow(/clear-fail=0/);
  });

  it("rejects a set with no clear-pass triples", () => {
    const failsOnly = balancedSet().filter((t) => t.label !== "clear-pass");
    expect(() => validateGoldSetBalance(failsOnly)).toThrow(/clear-pass/);
  });

  it("rejects a set with no borderline triple", () => {
    expect(() => validateGoldSetBalance(balancedSet().filter((t) => t.label !== "borderline"))).toThrow(/borderline/);
  });

  it("rejects a triple whose label contradicts its expected verdict", () => {
    expect(() =>
      parseGoldTriple({ id: "x", rubric: "r", answer: "a", note: "n", label: "clear-fail", expected: "pass" }, "g.yaml")
    ).toThrow(/labelled clear-fail but expects "pass"/);
    expect(() =>
      parseGoldTriple({ id: "x", rubric: "r", answer: "a", note: "n", label: "clear-pass", expected: "fail" }, "g.yaml")
    ).toThrow(/labelled clear-pass/);
  });
});

describe("agreement and thresholding", () => {
  // spec: A judge that passes everything fails the fail direction
  it("marks a judge that passes everything unreliable despite a perfect pass direction", async () => {
    const report = await runGoldSet(balancedSet(), { client: stubJudge("pass"), template: TEMPLATE });
    expect(report.passDirection.rate).toBe(1);
    expect(report.failDirection.rate).toBe(0);
    expect(report.status).toBe("unreliable");
    expect(report.banner).toMatch(/clear-fail 0%/);
  });

  // spec: Borderline triples are reported, not gated
  it("does not let a borderline disagreement mark the run unreliable", async () => {
    // Perfect on both gated directions, wrong on the borderline triple.
    const set = balancedSet();
    const byId: Record<string, string> = { "borderline-answer": "pass" };
    for (const t of set) if (t.label === "clear-fail") byId[t.answer] = "fail";
    const report = await runGoldSet(set, { client: stubJudge("pass", byId), template: TEMPLATE });
    expect(report.status).toBe("ok");
    expect(report.borderline.rate).toBe(0);
    expect(report.borderline.clears).toBe(true); // reported, never gated
    expect(renderCalibrationMd(report)).toMatch(/borderline \(drift signal\)/);
    expect(renderCalibrationMd(report)).toMatch(/b0/); // the disagreement is surfaced
  });

  it("gates each direction separately at the configured threshold", async () => {
    // One miss out of five clear-fails = 80%, exactly at the threshold: clears.
    const set = balancedSet();
    const byId: Record<string, string> = {};
    for (const t of set) if (t.label === "clear-fail") byId[t.answer] = "fail";
    byId["fail-answer-0"] = "pass"; // one miss
    const report = await runGoldSet(set, { client: stubJudge("pass", byId), template: TEMPLATE });
    expect(report.failDirection.rate).toBeCloseTo(0.8);
    expect(report.status).toBe("ok");

    // Two misses = 60%: below.
    byId["fail-answer-1"] = "pass";
    const worse = await runGoldSet(set, { client: stubJudge("pass", byId), template: TEMPLATE });
    expect(worse.failDirection.rate).toBeCloseTo(0.6);
    expect(worse.status).toBe("unreliable");
  });

  it("honours a judge repeat by majority-folding each triple", async () => {
    let call = 0;
    const flaky: LlmClient = {
      modelId: "flaky",
      tokensUsed: 0,
      async complete(): Promise<LlmCompletion> {
        call += 1;
        // pass, pass, fail per triple -> majority pass
        return { text: JSON.stringify({ verdict: call % 3 === 0 ? "fail" : "pass" }) };
      },
    };
    const set = [triple({ id: "one", answer: "only-answer" })];
    const report = await runGoldSet(set, { client: flaky, template: TEMPLATE }, { judgeRepeat: 3 });
    expect(report.items[0]!.actual).toBe("pass");
    expect(call).toBe(3);
  });

  it("keeps the reported order the file order when triples are scored concurrently", async () => {
    const set = balancedSet();
    const report = await runGoldSet(set, { client: stubJudge("pass"), template: TEMPLATE }, { parallel: 4 });
    expect(report.items.map((i) => i.id)).toEqual(set.map((t) => t.id));
  });
});

/** A backend that is down: checkJudge turns the throw into verdict "error". */
const deadJudge: LlmClient = {
  modelId: "dead-judge",
  tokensUsed: 0,
  async complete(): Promise<LlmCompletion> {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  },
};

/** A judge that IS reached but never honours the JSON contract — the model is at fault. */
const mumblingJudge: LlmClient = {
  modelId: "mumbling-judge",
  tokensUsed: 0,
  async complete(): Promise<LlmCompletion> {
    return { text: "Sure! Here is my assessment: the answer looks broadly reasonable to me." };
  },
};

describe("an unreachable judge is not a miscalibrated one", () => {
  it("counts the triples the judge never scored instead of reading them as disagreement", async () => {
    const set = balancedSet();
    const report = await runGoldSet(set, { client: deadJudge, template: TEMPLATE });
    expect(report.unscored).toBe(set.length);
    expect(report.unscoredCauses.unreachable).toBe(set.length);
    expect(report.unscoredCauses.unusableReply).toBe(0);
    expect(report.items.every((i) => i.actual === "error")).toBe(true);
    expect(report.status).toBe("unreliable");
  });

  it("names the outage in the banner, ahead of the rates, so nobody re-labels the gold set", async () => {
    const set = balancedSet();
    const report = await runGoldSet(set, { client: deadJudge, template: TEMPLATE });
    expect(report.banner).toMatch(/were not scored/);
    expect(report.banner).toMatch(/could not be reached/);
    expect(report.banner).toMatch(/not a miscalibrated instrument and not a stale gold set/);
    // The reachability clause precedes the rate clause.
    expect(report.banner.indexOf("not be reached")).toBeLessThan(report.banner.indexOf("clear-pass"));
  });

  it("names it in gold-set.md above the disagreement list", async () => {
    const md = renderCalibrationMd(await runGoldSet(balancedSet(), { client: deadJudge, template: TEMPLATE }));
    expect(md).toMatch(/triples were not scored/);
    expect(md).toMatch(/the labels are not the problem/);
    expect(md.indexOf("were not scored")).toBeLessThan(md.indexOf("## Disagreements"));
  });

  it("carries the count into the artifact stamp", async () => {
    const stamp = calibrationStamp(await runGoldSet(balancedSet(), { client: deadJudge, template: TEMPLATE }));
    expect(stamp.unscored).toBe(balancedSet().length);
    expect(stamp.status).toBe("unreliable");
  });

  it("reports zero unscored when the judge answered every triple", async () => {
    const set = balancedSet();
    const report = await runGoldSet(set, { client: stubJudge("pass"), template: TEMPLATE });
    expect(report.unscored).toBe(0);
    expect(report.unscoredCauses).toEqual({ unreachable: 0, unusableReply: 0, unclassified: 0 });
    expect(report.banner).not.toMatch(/were not scored/);
    expect(renderCalibrationMd(report)).not.toMatch(/were not scored/);
  });
});

// spec: An unusable judge reply is reported as a judge-MODEL fault, not as a backend outage
describe("an unusable judge reply is not a backend outage", () => {
  it("counts a judge that was reached but never produced a parseable verdict under its own cause", async () => {
    const set = balancedSet();
    const report = await runGoldSet(set, { client: mumblingJudge, template: TEMPLATE });
    expect(report.unscored).toBe(set.length);
    expect(report.unscoredCauses.unusableReply).toBe(set.length);
    expect(report.unscoredCauses.unreachable).toBe(0);
    expect(report.status).toBe("unreliable");
  });

  it("names the judge model as the fault and never sends the operator to the backend", async () => {
    const report = await runGoldSet(balancedSet(), { client: mumblingJudge, template: TEMPLATE });
    expect(report.banner).toMatch(/could not produce a parseable verdict/);
    expect(report.banner).toMatch(/fault in the judge MODEL/);
    expect(report.banner).not.toMatch(/could not be reached/);
    expect(report.banner).not.toMatch(/check the backend/);
    // Still the one shared instruction: the labels are never the problem.
    expect(report.banner).toMatch(/change no label/);
    // The cause clause precedes the rate clause.
    expect(report.banner.indexOf("parseable verdict")).toBeLessThan(report.banner.indexOf("clear-pass"));
  });

  it("names it in gold-set.md above the disagreement list, without blaming the backend", async () => {
    const md = renderCalibrationMd(await runGoldSet(balancedSet(), { client: mumblingJudge, template: TEMPLATE }));
    expect(md).toMatch(/could not produce a parseable verdict/);
    expect(md).toMatch(/The judge MODEL is at fault, not the backend/);
    expect(md).not.toMatch(/Fix the judge backend/);
    expect(md.indexOf("were not scored")).toBeLessThan(md.indexOf("## Disagreements"));
  });

  it("carries the split into the artifact stamp", async () => {
    const stamp = calibrationStamp(await runGoldSet(balancedSet(), { client: mumblingJudge, template: TEMPLATE }));
    expect(stamp.unscoredCauses).toEqual({
      unreachable: 0,
      unusableReply: balancedSet().length,
      unclassified: 0,
    });
    expect(stampUnscoredSummary(stamp)).toMatch(/unusable judge reply/);
    expect(stampUnscoredSummary(stamp)).not.toMatch(/unreachable/);
  });
});

// spec: The two unscored causes are counted and named separately
describe("the two unscored causes are never conflated", () => {
  it("counts a mixed outage under both causes and names both remedies", async () => {
    const set = balancedSet();
    // The clear-pass triples reach a mumbling judge; the clear-fail ones reach nothing.
    const mixed: LlmClient = {
      modelId: "mixed-judge",
      tokensUsed: 0,
      async complete(_system: string, user: string): Promise<LlmCompletion> {
        if (user.includes("fail-answer")) throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
        return { text: "no JSON here at all" };
      },
    };
    const report = await runGoldSet(set, { client: mixed, template: TEMPLATE });
    expect(report.unscoredCauses.unreachable).toBe(MIN_TRIPLES_PER_DIRECTION);
    expect(report.unscoredCauses.unusableReply).toBe(MIN_TRIPLES_PER_DIRECTION + 1); // + the borderline triple
    expect(report.unscored).toBe(set.length);
    expect(report.banner).toMatch(/could not be reached/);
    expect(report.banner).toMatch(/could not produce a parseable verdict/);
    const md = renderCalibrationMd(report);
    expect(md).toMatch(/Fix the judge backend/);
    expect(md).toMatch(/The judge MODEL is at fault/);
  });

  it("classifies an error of an unrecognised shape as unclassified rather than as either cause", () => {
    expect(classifyUnscored("judge call failed: socket hang up")).toBe("unreachable");
    expect(classifyUnscored("judge_error: unparseable reply (no JSON object found)")).toBe("unusable-reply");
    expect(classifyUnscored("something nobody wrote a branch for")).toBe("unclassified");
    expect(classifyUnscored(undefined)).toBe("unclassified");
  });

  it("attributes a folded error to its winning run rather than a losing scored run", async () => {
    // --judge-repeat must keep the winning error's own cause. Previously the FIRST
    // run's successful reasoning was carried into the error majority, hiding the outage.
    let call = 0;
    const intermittent: LlmClient = {
      modelId: "intermittent-judge",
      tokensUsed: 0,
      async complete(): Promise<LlmCompletion> {
        call += 1;
        if (call === 1) return { text: JSON.stringify({ verdict: "pass", reasoning: "stub" }) };
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    };
    const report = await runGoldSet(
      [triple({ id: "one", answer: "only-answer" })],
      { client: intermittent, template: TEMPLATE },
      { judgeRepeat: 3 }
    );
    expect(report.items[0]!.actual).toBe("error");
    expect(report.items[0]!.reasoning).toBe("judge call failed: connect ECONNREFUSED 127.0.0.1:11434");
    expect(report.unscoredCauses).toEqual({ unreachable: 1, unusableReply: 0, unclassified: 0 });
    expect(report.banner).toMatch(/could not be reached/);
    expect(report.banner).not.toMatch(/failed in an unrecognised way/);
    expect(renderCalibrationMd(report)).toMatch(/could not be reached/);
  });
});

// spec: A gold set that cannot be loaded is a config failure, not a checkpoint failure
describe("loadGoldSet reports its own failures as gold-set failures", () => {
  it("raises a GoldSetError naming the directory when the fixtures directory is missing", () => {
    const missing = path.join(mkdtempSync(path.join(tmpdir(), "gold-missing-")), "nope");
    expect(() => loadGoldSet(missing)).toThrow(GoldSetError);
    expect(() => loadGoldSet(missing)).toThrow(/does not exist/);
    expect(() => loadGoldSet(missing)).toThrow(new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("raises a GoldSetError naming the file when a gold file is not parseable YAML", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gold-broken-"));
    writeFileSync(path.join(dir, "broken.yaml"), "id: x\n  bad: [unclosed\n", "utf8");
    expect(() => loadGoldSet(dir)).toThrow(GoldSetError);
    expect(() => loadGoldSet(dir)).toThrow(/broken\.yaml/);
    expect(() => loadGoldSet(dir)).toThrow(/could not be parsed/);
  });
});

// The calibration artifact is what the operator reads; a table that does not render
// as a table is the one number in this change nobody would see.
describe("renderCalibrationMd", () => {
  const withBanner = async () => runGoldSet(balancedSet(), { client: stubJudge("pass"), template: TEMPLATE });

  it("separates the direction table from the preceding list with a blank line", async () => {
    const md = renderCalibrationMd(await withBanner());
    const lines = md.split("\n");
    const header = lines.indexOf("| Direction | Agreed | Rate | Gate |");
    expect(header).toBeGreaterThan(0);
    expect(lines[header - 1]).toBe("");
    expect(lines[header + 1]).toBe("| --- | --- | --- | --- |");
  });

  it("keeps the blank lines around every block, with and without a banner", async () => {
    const failing = renderCalibrationMd(await withBanner());
    expect(failing).toMatch(/JUDGE CALIBRATION FAILED/);
    const passing = renderCalibrationMd(
      await runGoldSet(balancedSet(), { client: perfectJudge(balancedSet()), template: TEMPLATE })
    );
    expect(passing).not.toMatch(/JUDGE CALIBRATION FAILED/);
    for (const md of [failing, passing]) {
      const lines = md.split("\n");
      expect(lines[lines.indexOf("## Disagreements") - 1]).toBe("");
      expect(lines[lines.indexOf("## Disagreements") + 1]).toBe("");
    }
  });
});

describe("calibration gate ordering and exit code", () => {
  const okReport = async () =>
    runGoldSet(balancedSet(), {
      client: stubJudge("pass", Object.fromEntries(balancedSet().map((t) => [t.answer, t.expected]))),
      template: TEMPLATE,
    });
  const badReport = async () => runGoldSet(balancedSet(), { client: stubJudge("pass"), template: TEMPLATE });

  // spec: Gold set runs before any candidate token is spent
  it("scores the gold set before the probes run", async () => {
    const order: string[] = [];
    const outcome = await runWithCalibration(
      {
        run: async () => {
          order.push("calibration");
          return okReport();
        },
        onReport: () => order.push("report"),
      },
      async () => {
        order.push("probes");
        return "reports";
      }
    );
    expect(order).toEqual(["calibration", "report", "probes"]);
    expect(outcome.result).toBe("reports");
    expect(outcome.exitCode).toBe(0);
  });

  // spec: A judge below the threshold makes the run not green
  it("aborts before the probes and exits 4 when the judge fails calibration", async () => {
    let probesRan = false;
    const outcome = await runWithCalibration({ run: badReport }, async () => {
      probesRan = true;
      return "reports";
    });
    expect(probesRan).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.exitCode).toBe(EXIT_UNRELIABLE_JUDGE);
    expect(outcome.calibration!.banner).toMatch(/JUDGE CALIBRATION FAILED/);
  });

  // spec: Diagnosis mode completes the run but never reports it green
  it("completes the run under --allow-unreliable-judge and still exits 4", async () => {
    let stamped: unknown;
    const outcome = await runWithCalibration({ run: badReport, allowUnreliable: true }, async (stamp) => {
      stamped = stamp;
      return "reports";
    });
    expect(outcome.result).toBe("reports");
    expect(outcome.exitCode).toBe(EXIT_UNRELIABLE_JUDGE);
    expect(stamped).toMatchObject({ status: "unreliable" });
  });

  // spec: The improvement loop never runs on an uncalibrated judge
  it("refuses diagnosis mode on the improvement-loop path and aborts with exit 4", async () => {
    let loopRan = false;
    const outcome = await runWithCalibration(
      calibrationGateFor("loop", { run: badReport, allowUnreliable: true }),
      async () => {
        loopRan = true;
        return "loop";
      }
    );
    expect(loopRan).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.exitCode).toBe(EXIT_UNRELIABLE_JUDGE);
  });

  it("names the in-place skill edits as the reason the loop cannot opt in", () => {
    expect(calibrationGateFor("loop", { run: badReport, allowUnreliable: true }).allowUnreliable).toBe(false);
    expect(calibrationGateFor("eval", { run: badReport, allowUnreliable: true }).allowUnreliable).toBe(true);
    expect(LOOP_REQUIRES_CALIBRATED_JUDGE).toMatch(/skills\/cbe\/ IN PLACE/);
  });

  // The loop's artifacts state which instrument graded them, positively.
  it("stamps the calibration into the improvement loop's iteration artifacts", async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "cbe-loop-cal-"));
    const results: CheckResult[] = [{ id: "c1", type: "judge", verdict: "pass" }];
    const outcome = await runWithCalibration(calibrationGateFor("loop", { run: okReport }), (stamp) =>
      runImprovementLoop(
        { maxIterations: 1, panel: ["qwen"] },
        {
          io: new MemorySkillIO(new Map([["SKILL.md", "body"]])),
          calibration: stamp,
          evaluate: async () => ({ results, reports: [{ probe: "p", model: "qwen", results }] }),
          editor: { client: stubJudge("pass") },
          marker: { exists: () => false, read: () => null, write: () => {}, clear: () => {} },
          runDir,
          tokensUsed: () => 0,
        }
      )
    );
    expect(outcome.exitCode).toBe(0);
    const written = JSON.parse(readFileSync(path.join(runDir, "iteration-0", "verdicts.json"), "utf8"));
    expect(written.judgeCalibration).toMatchObject({ status: "ok" });
    expect(written.verdicts.qwen).toHaveLength(1);
  });

  it("runs the probes untouched when no gate is configured", async () => {
    const outcome = await runWithCalibration(undefined, async (stamp) => {
      expect(stamp).toBeUndefined();
      return "reports";
    });
    expect(outcome.result).toBe("reports");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.calibration).toBeUndefined();
  });
});

// spec: Calibration machinery is exercised without a model
describe("no model is contacted", () => {
  it("uses only the injected client for every judge call", async () => {
    const client = stubJudge("pass");
    await runGoldSet(balancedSet(), { client, template: TEMPLATE });
    expect(client.calls).toBe(balancedSet().length);
  });
});
