/** Model-free regressions for the 2026-10-12 S1 audit; no live judge verdict is claimed. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGoldSet, runGoldSet, tripleAsTranscript } from "../src/gold-set.js";
import { loadCorpusIds, parseProbes } from "../src/loader.js";
import { scoreProbeRepeated } from "../src/scorer.js";
import { majorityVerdict, type CheckResult, type Verdict } from "../src/types.js";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../..");
const scenarioFile = path.join(root, "evaluation/cbe-skill/scenarios/01-opening.md");
const probes = parseProbes(
  readFileSync(scenarioFile, "utf8"),
  scenarioFile,
  loadCorpusIds(path.join(root, "corpus/index.json"))
);
const gold = loadGoldSet(path.join(root, "evaluation/cbe-skill/fixtures/gold"));
const opening = gold.filter((triple) => triple.id.startsWith("gold.opening."));
const checkpoint = (id: string) => probes.flatMap((p) => p.checkpoints).find((cp) => cp.id === id)!;
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function result(verdict: Verdict, reasoning: string): CheckResult {
  return { id: "1j", type: "judge", verdict, reasoning, evidence: reasoning, rubric: "transfer" };
}

const fail = result("fail", "No concrete syllabus element or grounded adaptation issue is named.");
const unavailable = result("not-assessable", "The required assistant turn is unavailable.");

describe("majority reports keep verdict and its own evidence together", () => {
  it("never attaches the first fail's reasoning to a later N/A majority", () => {
    expect(majorityVerdict([[fail], [unavailable], [unavailable]])).toEqual([unavailable]);
  });

  it("never attaches the first N/A reasoning to an ordinary fail majority", () => {
    expect(majorityVerdict([[unavailable], [fail], [fail]])).toEqual([fail]);
  });

  it("preserves the conservative N/A tie rule without borrowing fail evidence", () => {
    expect(majorityVerdict([[fail], [unavailable]])).toEqual([unavailable]);
  });

  it("retains the first representative of the winning verdict, not the last", () => {
    const laterFail = { ...fail, reasoning: "Another failure explanation" };
    expect(majorityVerdict([[unavailable], [fail], [laterFail]])).toEqual([fail]);
  });

  it("keeps evidence aligned through BOTH judge repetitions and model repetitions", async () => {
    const probe = { ...probes.find((p) => p.probe === "S1c")!, checkpoints: [checkpoint("1j")] };
    const triple = opening.find((t) => t.id === "gold.opening.1j.generic-announcement")!;
    const { transcript } = tripleAsTranscript(triple);
    const replies = [fail, unavailable, unavailable];
    const scored = await scoreProbeRepeated(
      probe,
      transcript,
      {
        corpusIds: new Set(),
        judge: {
          client: {
            modelId: "stub-only",
            tokensUsed: 0,
            complete: async () => ({ text: JSON.stringify(replies.shift()) }),
          },
        },
      },
      3
    );
    expect(scored.judgeRuns.map((run) => run[0]!.verdict)).toEqual(["fail", "not-assessable", "not-assessable"]);
    const expected = { ...unavailable, rubric: checkpoint("1j").rubric };
    expect(scored.results[0]).toEqual(expected);
    expect(majorityVerdict([[fail], scored.results, scored.results])[0]).toEqual(expected);
  });
});

// These are wording/fixture contracts, not a fake semantic classifier. Hand labels
// join the real calibration gate on the NEXT authorized run; stubs below test plumbing.
describe("S1 repaired rubric boundaries and their calibration cases", () => {
  it("loads exactly the three corrected gold families with pass AND fail directions", () => {
    expect(opening).toHaveLength(10);
    expect(new Set(opening.map((t) => t.id.split(".")[2]))).toEqual(new Set(["1h", "1j", "1m"]));
    for (const id of ["1h", "1j", "1m"]) {
      const triples = opening.filter((t) => t.id.startsWith(`gold.opening.${id}.`));
      expect(new Set(triples.map((t) => t.expected))).toEqual(new Set(["pass", "fail"]));
      const probe = probes.find((p) => p.checkpoints.some((cp) => cp.id === id))!;
      for (const triple of triples) {
        expect(flat(triple.rubric), triple.id).toBe(flat(checkpoint(id).rubric!));
        expect(triple.user, triple.id).toBe(probe.turns[0]);
      }
    }
  });

  it("1h permits silent compatible framing while keeping the four failure directions", () => {
    const rubric = flat(checkpoint("1h").rubric!);
    expect(probes.find((p) => p.probe === "S1b")!.setup.maturity).toMatchObject({ overall: { target: 3 } });
    expect(rubric).toContain("The target need not be restated");
    expect(rubric).toContain("without mentioning the target PASSES");
    expect(rubric).toContain("FAIL if it contradicts the target");
    expect(rubric).toContain("asks the target question again");
    expect(rubric).toContain("choose a maturity level");
    expect(rubric).toContain("re-derives the recorded target");
    const silent = opening.find((t) => t.id.endsWith("compatible-framing"))!;
    expect(silent.expected).toBe("pass");
    expect(silent.answer).not.toMatch(/Ziel|Reifegrad|target/i);
  });

  it("1j explicitly classifies readable process-only announcements as fail, never N/A", () => {
    const rubric = flat(checkpoint("1j").rubric!);
    expect(rubric).toContain("no concrete syllabus element and no grounded adaptation issue");
    expect(rubric).toContain("is FAIL, never partial or not-assessable");
    expect(rubric).toContain("Missing required content is observable failure, not unavailable evidence");
    expect(rubric).toContain("genuinely unreadable or unavailable evidence");
    const generic = opening.find((t) => t.id.endsWith("generic-announcement"))!;
    expect(generic.expected).toBe("fail");
    expect(generic.answer).toContain("Rahmung");
    expect(generic.answer).not.toMatch(/Labor|Rechenblätter|Klausur|Wärmeübertrager/);
  });

  it("1m accepts an outcome-specific decision frame without authoring an artefact", () => {
    const rubric = flat(checkpoint("1m").rubric!);
    expect(rubric).toContain("A bounded, outcome-specific assessment decision frame");
    expect(rubric).toContain("PASSES without a drafted blueprint, criteria list or finished evidence specification");
    expect(rubric).toContain("the lecturer authors the module");
    expect(rubric).toContain("empty/generic question");
    for (const retained of [
      "asks which category applies",
      "generic ambition interview",
      "refuses to work the named entry",
      "redirects to framing or outcomes as a prerequisite",
    ]) {
      expect(rubric).toContain(retained);
    }
    const frame = opening.find((t) => t.id.endsWith("product-process-decision"))!;
    expect(frame.expected).toBe("pass");
    for (const detail of [
      "Sanierungsvarianten",
      "Produkt",
      "Prozessnachweis",
      "formatives",
      "summative",
      "Welcher Nachweis",
    ]) {
      expect(frame.answer).toContain(detail);
    }
    expect(opening.find((t) => t.id.endsWith("empty-question"))!.expected).toBe("fail");
    expect(opening.find((t) => t.id.endsWith("outcome-echo-only"))!.expected).toBe("fail");
  });

  it("records the contradictory N/A plus failure reasoning as a gold disagreement, not an exemption", async () => {
    const triple = opening.find((t) => t.id.endsWith("generic-announcement"))!;
    const report = await runGoldSet([triple], {
      client: {
        modelId: "stub-only",
        tokensUsed: 0,
        complete: async () => ({ text: JSON.stringify({ ...fail, verdict: "not-assessable" }) }),
      },
    });
    expect(report.items[0]).toMatchObject({ expected: "fail", actual: "not-assessable", agrees: false });
    expect(report.failDirection).toMatchObject({ total: 1, agreed: 0, clears: false });
    // Do not rewrite semantic judge output globally: actual N/A remains distinguishable.
    expect(report.items[0]!.reasoning).toBe(fail.reasoning);
  });
});
