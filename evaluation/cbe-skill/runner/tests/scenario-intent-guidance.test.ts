/**
 * Model-free contract for `guide-the-work-by-lecturer-intent`.
 *
 * The tests load the real S1/S4 scenario files, verify that each contrastive probe
 * exerts the pressure its rubric claims, and keep synthetic failing answers aligned
 * with explicit FAIL clauses. They do not score a model or claim adherence.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIngestEnvelope } from "@cbe/pi-bridge/ingest-envelope";
import { checkDeterministic } from "../src/checker-deterministic.js";
import { loadCorpusIds, parseProbes } from "../src/loader.js";
import type { Checkpoint, Probe, Transcript } from "../src/types.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SCENARIO_DIR = path.join(REPO_ROOT, "evaluation", "cbe-skill", "scenarios");
const corpusIds = loadCorpusIds(path.join(REPO_ROOT, "corpus", "index.json"));

function load(file: string): Probe[] {
  const full = path.join(SCENARIO_DIR, file);
  const warnings: string[] = [];
  const probes = parseProbes(readFileSync(full, "utf8"), full, corpusIds, {
    onWarn: (warning) => warnings.push(warning),
  });
  expect(warnings, `${file} has prose/checkpoint drift`).toEqual([]);
  return probes;
}

const s1 = load("01-opening.md");
const s4 = load("04-challenging.md");
const affected = [...s1, ...s4];

function probe(id: string): Probe {
  const found = affected.find((candidate) => candidate.probe === id);
  if (!found) throw new Error(`probe ${id} did not load`);
  return found;
}

function checkpoint(id: string): Checkpoint {
  const found = affected.flatMap((candidate) => candidate.checkpoints).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`checkpoint ${id} did not load`);
  return found;
}

const NEW_JUDGE_IDS = [
  "1a",
  "1j",
  "1k",
  "1l",
  "1m",
  "1n",
  "1o",
  "1p",
  "1q",
  "1r",
  "1s",
  "1t",
  "1u",
  "4g",
  "4h",
  "4i",
  "4j",
  "4k",
  "4l",
  "4n",
] as const;

/**
 * One deliberately failing synthetic answer per new/materially changed judge
 * checkpoint. `needle` is copied from the rubric's explicit FAIL clause and the
 * answer instantiates it. This is fixture consistency, not fake judge scoring.
 */
const FAILING_ANSWERS: Record<(typeof NEW_JUDGE_IDS)[number], { needle: string; answer: string }> = {
  "1a": { needle: "Design, Transfer or Review", answer: "Choose Design, Transfer or Review before we continue." },
  "1j": { needle: "blank-module interview", answer: "I will start a blank-module interview instead." },
  "1k": { needle: "Design/Transfer/Review selector", answer: "Here is a Design/Transfer/Review selector." },
  "1l": { needle: "asks for the work category again", answer: "This asks for the work category again." },
  "1m": { needle: "asks which category applies", answer: "Before assessment, this asks which category applies." },
  "1n": { needle: "summarises", answer: "This summarises the unsolicited document now." },
  "1o": {
    needle: "adversarial student-perspective review",
    answer: "I will launch an adversarial student-perspective review of the word challenge.",
  },
  "1p": { needle: "imposes adaptation", answer: "This imposes adaptation of the old structure." },
  "1q": { needle: "invents the current teaching", answer: "This invents the current teaching without a source." },
  "1r": { needle: "restarts a blank-module opening", answer: "This restarts a blank-module opening." },
  "1s": { needle: "Design/Transfer/Review menu", answer: "Here is a Design/Transfer/Review menu." },
  "1t": { needle: "full transfer analysis already", answer: "This performs a full transfer analysis already." },
  "1u": { needle: "requires a full course rebuild", answer: "This requires a full course rebuild." },
  "4g": { needle: "choose or confirm a mode", answer: "First choose or confirm a mode." },
  "4h": { needle: "invents an interrupted step", answer: "This invents an interrupted step after the review." },
  "4i": { needle: "invents findings", answer: "This invents findings without a draft." },
  "4j": { needle: "starts revising before examining", answer: "This starts revising before examining." },
  "4k": { needle: "asks for a mode/category", answer: "This asks for a mode/category again." },
  "4l": { needle: "insists on finishing transfer", answer: "This insists on finishing transfer first." },
  "4n": { needle: "stays in a permanent Review mode", answer: "The assistant stays in a permanent Review mode." },
};

describe("intent-guidance probes load with the planned contrasts", () => {
  it("loads every planned S1 and S4 probe id", () => {
    expect(s1.map((item) => item.probe)).toEqual([
      "S1",
      "S1b",
      "S1c",
      "S1d",
      "S1e",
      "S1f",
      "S1g",
      "S1h",
      "S1i",
      "S1j",
      "S1k",
      "S1l",
      "S1m",
    ]);
    expect(s4.map((item) => item.probe)).toEqual(["S4", "S4b", "S4c", "S4d", "S4e", "S4f"]);
  });

  it("uses the exact production orientation envelope for real material and the attachment-only control", () => {
    const transfer = buildIngestEnvelope(
      "thermodynamik-syllabus.txt",
      "Woche 1–4: Vorlesung Thermodynamik, wöchentliche Rechenblätter. Woche 5–8: Wärmeübertrager und Laborversuch nach Anleitung. Prüfung: 90-minütige Einzelklausur; Lernziel: Standardaufgaben sicher berechnen."
    );
    expect(probe("S1c").turns[0]).toBe(
      `Ich möchte diesen bestehenden Vorlesungsplan vollständig in ein CBE-Modul umbauen.\n\n${transfer}`
    );

    const ambiguous = buildIngestEnvelope(
      "statistik-syllabus.txt",
      "Statistik II: wöchentliche Vorlesung, Übungsblatt, Abschlussprüfung. Die Studierenden interpretieren Regressionsmodelle."
    );
    // The app composes instruction FIRST, then one envelope per attachment
    // (`ChatPanel.tsx`), so the ambiguous probe must not invert that order.
    expect(probe("S1d").turns[0]).toBe(`Hilf mir, das zu verbessern.\n\n${ambiguous}`);

    const unsolicited = buildIngestEnvelope(
      "modulhandbuch.pdf",
      "Modul Umweltrecht, 3 ECTS, schriftliche Prüfung. Inhalte: Bewilligungsverfahren, Haftung, Vollzug."
    );
    expect(probe("S1f").turns).toEqual([unsolicited]);

    const background = buildIngestEnvelope(
      "alter-syllabus.txt",
      "Acht Vorlesungen, zwei Übungen, schriftliche Abschlussprüfung."
    );
    expect(probe("S1h").turns[0]).toBe(
      `Ich nutze den alten Syllabus nur als Hintergrund. Bitte entwirf mit mir ein neues CBE-Modul; wir übertragen den alten Kurs ausdrücklich nicht. Eine substanzielle Neugestaltung ist mein Ziel.\n\n${background}`
    );

    const transferAmbition = buildIngestEnvelope(
      "baustatik-ablauf.txt",
      "Sechs Vorlesungen zur Tragwerkslehre, wöchentliche Rechenübungen, eine benotete Einzelklausur. Im dritten Termin bearbeiten die Studierenden eine vorgegebene Brückenskizze nach einem festen Rechenweg."
    );
    expect(probe("S1l").turns[0]).toBe(`Ich möchte diesen bestehenden Kurs in CBE übertragen.\n\n${transferAmbition}`);

    const coldReview = buildIngestEnvelope(
      "entwurf-energielabor.txt",
      "Modul Energielabor, 4. Semester, 24 Studierende. Lernziel: Energiedaten eines Gebäudes auswerten und Massnahmen begründen. Assessment: benoteter Gruppenbericht am Ende; keine Zwischenprodukte und keine Einzelleistung. Challenge: Energieverbrauch des Campus senken. Lernweg: zwei Vorlesungen, danach vier Wochen Gruppenarbeit."
    );
    expect(probe("S4b").turns[0]).toBe(
      `Prüfe diesen Entwurf jetzt kritisch aus Sicht der Studierenden. Mein Ziel ist eine vollständige, umsetzbare Neugestaltung.\n\n${coldReview}`
    );
  });

  it("keeps ambiguity, answer, explicit entry and help in separate observable turns", () => {
    expect(probe("S1d").turns).toHaveLength(2);
    expect(probe("S1d").turns[0]).toMatch(/Hilf mir, das zu verbessern/i);
    expect(probe("S1d").turns[1]).toMatch(/übertragen, nicht zuerst eine kritische Prüfung/i);
    expect(probe("S1e").turns[0]).toMatch(/Arbeiten wir jetzt am Assessment/i);
    expect(probe("S1k").turns[0]).toMatch(/Wo fange ich an/i);
  });

  it("uses retained course state for return instead of a resume fixture", () => {
    const returning = probe("S1j");
    expect(returning.setup.courseContext).toMatch(/Nachhaltige Logistik/);
    // `courseContext` reaches the model as raw course.md, so a narrating sentence in it
    // would HAND the model the premise 1r measures it inferring from the priors.
    expect(returning.setup.courseContext).not.toMatch(/fresh conversation|continuing the same/i);
    expect(returning.setup.courseContext?.trim().split("\n").at(-1)).toBe("---");
    expect(returning.setup.canvasArtefacts).toHaveLength(3);
    expect(returning.setup.stepCoverage).toEqual([
      { step: 1, depth: "refined", focus: false },
      { step: 2, depth: "rough", focus: false },
      { step: 3, depth: "rough", focus: true },
    ]);
    expect(returning.setup.maturity).toEqual({ overall: { target: 2 } });
    expect(returning.setup).not.toHaveProperty("resume");
  });

  it("carries ordered work, same-turn redirect and both handback directions", () => {
    expect(probe("S4d").turns).toHaveLength(2);
    expect(probe("S4d").turns[0]).toMatch(/zuerst kritisch.*Danach/s);
    expect(probe("S4e").turns[1]).toMatch(/Statt die Übertragung fortzusetzen.*jetzt kritisch/s);
    expect(probe("S4b").turns[1]).toMatch(/nächste konkrete Entscheidung/i);
    expect(probe("S4f").turns[1]).toMatch(/wo wir sie unterbrochen haben/i);
  });

  it("makes every new judge rubric name its judged assistant turn", () => {
    for (const id of NEW_JUDGE_IDS) {
      const cp = checkpoint(id);
      expect(cp.type, id).toBe("judge");
      expect(cp.rubric, id).toMatch(/Judge (?:the\s+)?(?:FIRST|SECOND) assistant turn ONLY/i);
    }
  });

  /**
   * `judgeTranscriptText` renders tool NAMES without their arguments, and the identity
   * prompt tells the model to reach for `cbe_picker` where a question has a small set of
   * distinct answers — first step / substantial revision / full rebuild is exactly that.
   * A rubric demanding a question therefore has to accept the picker as that question, or
   * it fails a compliant candidate for prose the picker's own description forbids.
   */
  const PICKER_QUESTION_IDS = ["1a", "1k", "1t"] as const;
  const NO_QUESTION_IDS = ["1j", "1m", "1r", "4l", "4n"] as const;

  it("accepts a cbe_picker call as the question in every rubric that requires one", () => {
    for (const id of PICKER_QUESTION_IDS) {
      const rubric = checkpoint(id).rubric ?? "";
      expect(rubric, `${id} must name the picker as a way of putting its question`).toMatch(/`cbe_picker`/);
      expect(rubric, `${id} must forbid failing the picker for prose the picker replaces`).toMatch(
        /must not be failed for the question's absence from the prose/i
      );
    }
  });

  it("does not carve the picker out of rubrics that require no question", () => {
    for (const id of NO_QUESTION_IDS) {
      expect(checkpoint(id).rubric ?? "", `${id} requires no question, so the carve-out would be noise`).not.toMatch(
        /cbe_picker/
      );
    }
  });

  it("keeps the restored brief orientation measured on the design opening", () => {
    expect(checkpoint("1a").rubric ?? "").toMatch(/orient briefly/i);
  });

  it("keeps one explicit failing synthetic answer aligned with every new judge rubric", () => {
    expect(Object.keys(FAILING_ANSWERS).sort()).toEqual([...NEW_JUDGE_IDS].sort());
    for (const [id, fixture] of Object.entries(FAILING_ANSWERS)) {
      const rubric = checkpoint(id).rubric ?? "";
      expect(rubric.toLowerCase(), `${id} rubric no longer names its synthetic violation`).toContain(
        fixture.needle.toLowerCase()
      );
      expect(fixture.answer.toLowerCase(), `${id} synthetic answer does not instantiate its violation`).toContain(
        fixture.needle.toLowerCase()
      );
    }
  });
});

describe("the new deterministic no-reset checkpoint discriminates", () => {
  const cp = checkpoint("4m");
  const p = probe("S4e");

  function transcript(secondTurnTools: Transcript["turns"][number]["tools"]): Transcript {
    return {
      probe: p.probe,
      model: "synthetic",
      turns: [
        { user: p.turns[0]!, assistant: "Wir arbeiten an der Übertragung.", tools: [] },
        {
          user: p.turns[1]!,
          assistant: "Die Prüfungslogik benachteiligt Studierende ohne Prüfungstraining.",
          tools: secondTurnTools,
        },
      ],
    };
  }

  it("passes a useful review turn that leaves the canvas untouched", () => {
    const verdict = checkDeterministic(cp, transcript([{ name: "cbe_maturity" }]), p, corpusIds);
    expect(verdict.verdict).toBe("pass");
    // Silence cannot pass the whole probe: the same probe carries positive judge 4l.
    expect(p.checkpoints.some((candidate) => candidate.id === "4l" && candidate.type === "judge")).toBe(true);
  });

  it("fails the synthetic reset attempt", () => {
    const resetArgs = { step: 1, id: "moduleframe", action: "clear" } as const;
    // Validate the synthetic call shape before using it as discrimination evidence.
    expect(Number.isInteger(resetArgs.step) && resetArgs.step >= 1 && resetArgs.step <= 10).toBe(true);
    expect(resetArgs.id.length).toBeGreaterThan(0);
    expect(resetArgs.action).toBe("clear");

    const verdict = checkDeterministic(cp, transcript([{ name: "cbe_canvas", args: resetArgs }]), p, corpusIds);
    expect(verdict.verdict).toBe("fail");
  });
});

describe("collateral scenario review stays explicit and bounded", () => {
  const cases: Array<[string, string[]]> = [
    ["02-ten-steps.md", ["2a", "2b", "2c", "2d", "2e", "2f", "2g", "2h", "2i", "2j", "2k", "2n", "2l", "2m"]],
    ["05-closing.md", ["5a", "5b", "5i", "5c", "5d", "5e", "5f", "5g", "5h"]],
    ["09-language-and-stance.md", ["9a", "9b", "9c", "9d", "9e", "9f", "9g"]],
    ["14-maturity-staging.md", ["14a", "14b", "14c", "14d", "14e", "14f", "14g"]],
  ];

  it.each(cases)("%s retains its existing checkpoint surface", (file, expected) => {
    const ids = load(file).flatMap((item) => item.checkpoints.map((cp) => cp.id));
    expect(ids).toEqual(expected);
  });
});
