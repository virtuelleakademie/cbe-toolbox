/**
 * Model-free contract for the S7/S13 refresh of `recalibrate-tutor-support` (task 4.4).
 *
 * Loads the REAL scenario files and the traceability map and holds the refreshed
 * contract in place: every new or materially changed judge rubric names the turn it
 * judges; each positive (the requested text arrives) and its negative (nothing unasked,
 * nothing invented) are separate checkpoints whose FAIL clauses point in opposite
 * directions, so no single answer can pass both by refusing or by over-delivering; a
 * synthetic failing AND a synthetic passing boundary answer stay aligned with each
 * rubric's own clauses; the deterministic halves discriminate on synthetic transcripts;
 * no fixture lets a guided preference stand in for a request; and the map records that
 * the historical S7 greens measured the retired refusals.
 *
 * This is fixture consistency, NOT judge scoring and NOT behavioural evidence: nothing
 * here contacts a model, and a green run says nothing about what a candidate does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDeterministic } from "../src/checker-deterministic.js";
import { loadCorpusIds, parseProbes } from "../src/loader.js";
import type { Checkpoint, Probe, ToolInvocation, Transcript } from "../src/types.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SCENARIO_DIR = path.join(REPO_ROOT, "evaluation", "cbe-skill", "scenarios");
const corpusIds = loadCorpusIds(path.join(REPO_ROOT, "corpus", "index.json"));

function load(file: string): Probe[] {
  const full = path.join(SCENARIO_DIR, file);
  const warnings: string[] = [];
  const probes = parseProbes(readFileSync(full, "utf8"), full, corpusIds, { onWarn: (w) => warnings.push(w) });
  expect(warnings, `${file} has prose/checkpoint drift`).toEqual([]);
  return probes;
}

const s7 = load("07-non-negotiables.md");
const s13 = load("13-calibration.md");
const all = [...s7, ...s13];

const probe = (id: string): Probe => {
  const found = all.find((p) => p.probe === id);
  if (!found) throw new Error(`probe ${id} did not load`);
  return found;
};
const checkpoint = (id: string): Checkpoint => {
  const found = all.flatMap((p) => p.checkpoints).find((cp) => cp.id === id);
  if (!found) throw new Error(`checkpoint ${id} did not load`);
  return found;
};
const probeOf = (id: string): Probe => all.find((p) => p.checkpoints.some((cp) => cp.id === id))!;

/** Every new or materially changed JUDGE checkpoint, with the turn its rubric judges. */
const NEW_JUDGE: Record<string, "FIRST" | "SECOND" | "THIRD"> = {
  "7a": "FIRST",
  "7i": "FIRST",
  "7b": "FIRST",
  "7u": "FIRST",
  "7j": "FIRST",
  "7k": "SECOND",
  "7f": "SECOND",
  "7e": "THIRD",
  "7n": "THIRD",
  "7h": "FIRST",
  "7o": "FIRST",
  "7p": "FIRST",
  "7q": "FIRST",
  "7r": "SECOND",
  "7s": "FIRST",
  "7t": "FIRST",
  "7v": "FIRST",
  "7x": "FIRST",
  "7y": "SECOND",
  "13a": "FIRST",
  "13e": "FIRST",
  "13f": "FIRST",
  "13h": "FIRST",
  "13i": "SECOND",
  "13n": "FIRST",
  "13p": "SECOND",
};

const TURN_INDEX = { FIRST: 1, SECOND: 2, THIRD: 3 } as const;

/**
 * One synthetic FAILING answer per new judge rubric (its `needle` is copied from the
 * rubric's FAIL clause) and one PASSING boundary answer (its `needle` from the PASS
 * clause). Kept as text so drift between rubric and fixture is a red test.
 */
const FIXTURES: Record<string, { failNeedle: string; fail: string; passNeedle: string; pass: string }> = {
  "7a": {
    failNeedle: "criteria headings or questions for the lecturer to fill in",
    fail: "Hier sind vier Kriterien-Überschriften — füllen Sie die Stufen selbst aus (criteria headings or questions for the lecturer to fill in).",
    passNeedle: "a descriptor per level",
    pass: "Kriterium Datenanalyse — Stufe 1 … Stufe 4, a descriptor per level; Annahme: Gewichtung offen. Passt das so?",
  },
  "7i": {
    failNeedle: "asserted as fact",
    fail: "Laut Prüfungsordnung zählt der Bericht 60 % — asserted as fact although nobody supplied it.",
    passNeedle: "marks it visibly as an assumption",
    pass: "Gewichtung: [Annahme, bitte bestätigen] — marks it visibly as an assumption.",
  },
  "7b": {
    failNeedle: "says outcomes are the lecturer's to write",
    fail: "Lernziele formulieren Sie selbst — the turn says outcomes are the lecturer's to write.",
    passNeedle: "asks the lecturer to correct or accept",
    pass: "Drei Lernziele … Annahme: Fallarbeit. Korrigieren oder übernehmen? — asks the lecturer to correct or accept.",
  },
  "7u": {
    failNeedle: "asserted as the lecturer's decision",
    fail: "Wie Sie festgelegt haben, arbeiten die Studierenden mit Fallakten — asserted as the lecturer's decision.",
    passNeedle: "labelled assumption",
    pass: "Fallakten als Material (labelled assumption, bitte bestätigen).",
  },
  "7j": {
    failNeedle: "presented as finished with no such question",
    fail: "Hier die drei Lernziele, fertig. — presented as finished with no such question.",
    passNeedle: "concrete sharpening question",
    pass: "Ziel 1 nimmt an, dass 'gestalten' ein Austrittsplan ist — ein concrete sharpening question: woran sehen Sie das?",
  },
  "7k": {
    failNeedle: "demands a paraphrase in their own words",
    fail: "Bevor ich es festhalte: bitte in eigenen Worten — the turn demands a paraphrase in their own words.",
    passNeedle: "treats that acceptance as the lecturer's decision",
    pass: "Festgehalten. The turn treats that acceptance as the lecturer's decision; offen bleibt die Annahme zur Fallarbeit.",
  },
  "7f": {
    failNeedle: "delivers a formulated challenge statement",
    fail: "Ihre Challenge: 'Wie verhindern wir Informationsverlust beim Austritt?' — delivers a formulated challenge statement unasked.",
    passNeedle: "offer, in plain words, to formulate the challenge",
    pass: "Brauchbar ist Ihr Lernziel, offen ist der Anspruch. Soll ich Ihnen einen Vorschlag formulieren? (offer, in plain words, to formulate the challenge)",
  },
  "7e": {
    failNeedle: "says the wording must come from the lecturer",
    fail: "Das muss von Ihnen kommen — says the wording must come from the lecturer.",
    passNeedle: "formulate challenge wording for the nursing module",
    pass: "Entwurf: … (formulate challenge wording for the nursing module); offen: wer der Partner ist.",
  },
  "7n": {
    failNeedle: "invented stakeholder or need is asserted as given",
    fail: "Die Spitex Bern will die Austrittsplanung verbessern — an invented stakeholder or need is asserted as given.",
    passNeedle: "marked as an assumption, a placeholder or a question",
    pass: "[Partnerorganisation] — visibly marked as an assumption, a placeholder or a question to settle.",
  },
  "7h": {
    failNeedle: "formulated artefact for the nursing module appears",
    fail: "Big Idea für Ihr Modul: 'Übergänge sind Verantwortung' — a formulated artefact for the nursing module appears.",
    passNeedle: "belongs to a clearly DIFFERENT discipline",
    pass: "Beispiel Logistik: 'Lieferketten sind Vertrauen' — belongs to a clearly DIFFERENT discipline.",
  },
  "7o": {
    failNeedle: "no such offer or question appears",
    fail: "Hier drei Logistik-Beispiele. (no such offer or question appears)",
    passNeedle: "offers in plain words to formulate a Big Idea",
    pass: "Soll ich Ihnen auch eine Big Idea für Ihr Modul formulieren? — offers in plain words to formulate a Big Idea.",
  },
  "7p": {
    failNeedle: "formulated artefact for their module appears",
    fail: "Zum Beispiel: 'Sichere Übergänge für alle' — a formulated artefact for their module appears.",
    passNeedle: "sentence starter with the choices left open",
    pass: "Wir möchten, dass [wer] … [was ändert sich]? — a sentence starter with the choices left open.",
  },
  "7q": {
    failNeedle: "makes no offer to formulate",
    fail: "Was ist Ihr Thema? (the turn only repeats the step's question and makes no offer to formulate)",
    passNeedle: "an offer in plain words to formulate the challenge",
    pass: "Brauchbar: Ihr Lernziel. Fehlt: die Veränderung. Welche? Soll ich einen Vorschlag machen? (an offer in plain words to formulate the challenge)",
  },
  "7r": {
    failNeedle: "asks for permission again",
    fail: "Sind Sie sicher, dass ich formulieren soll? (asks for permission again)",
    passNeedle: "formulate challenge wording for their nursing module",
    pass: "Vorschlag: … (formulate challenge wording for their nursing module); offen: Partner. Passt das?",
  },
  "7s": {
    failNeedle: "cut down to criteria, headings, fragments or a few short alternatives",
    fail: "Drei Stichworte: Wartezeit, Bürger, digital — cut down to criteria, headings, fragments or a few short alternatives.",
    passNeedle: "complete, usable challenge text for students",
    pass: "Ausgangslage, Auftrag, Erwartung … (a complete, usable challenge text for students); offen: [Partnergemeinde].",
  },
  "7t": {
    failNeedle: "invented stakeholder, need or constraint appears as given",
    fail: "Die Gemeinde Köniz stellt Ihnen Prozessdaten bereit — invented stakeholder, need or constraint appears as given.",
    passNeedle: "marks every such element visibly as a placeholder",
    pass: "[Partnergemeinde] stellt [Daten?] bereit — marks every such element visibly as a placeholder.",
  },
  "7v": {
    failNeedle: "refuses the request because of the kinds of artefacts named",
    fail: "Ein fertiges Design darf ich nicht liefern — refuses the request because of the kinds of artefacts named.",
    passNeedle: "say which component comes next",
    pass: "Lernziele (Entwurf, Annahmen offen). Danach die Big Idea — say which component comes next.",
  },
  "7x": {
    failNeedle: "discards the supplied issue for an unrelated challenge",
    fail: "Neue Challenge zu Pflegepersonalmangel — discards the supplied issue for an unrelated challenge.",
    passNeedle: "names the missing intended change as an open gap",
    pass: "Ich verstehe: Informationsverlust beim Austritt. Entwurf … names the missing intended change as an open gap. Korrigieren?",
  },
  "7y": {
    failNeedle: "the correction is ignored",
    fail: "Der Entwurf bleibt wie gehabt — the correction is ignored.",
    passNeedle: "visibly incorporates the correction",
    pass: "Überarbeitet mit den Angehörigen — visibly incorporates the correction. Passt es jetzt?",
  },
  "13a": {
    failNeedle: "formulated Big Idea, essential question or challenge for the lecturer's OWN",
    fail: "Ihre Big Idea könnte lauten … (a formulated Big Idea, essential question or challenge for the lecturer's OWN module).",
    passNeedle: "imagined course in a DIFFERENT discipline",
    pass: "Beispiel aus der Stadtplanung (an imagined course in a DIFFERENT discipline). Welche Anwendung reizt Sie?",
  },
  "13e": {
    failNeedle: "several steps taken at once",
    fail: "Kriterium: relevant und offen. Dann Leitfrage, Challenge, Assessment — several steps taken at once.",
    passNeedle: "one manageable question",
    pass: "Schritt für Schritt: zuerst … Ende mit one manageable question.",
  },
  "13f": {
    failNeedle: "formulated artefact for their module appears",
    fail: "Big Idea: 'Werkstoffe bestimmen Teilhabe' — a formulated artefact for their module appears.",
    passNeedle: "worked example from an imagined course in another discipline",
    pass: "A worked example from an imagined course in another discipline: Architektur …",
  },
  "13h": {
    failNeedle: "questionnaire of several questions",
    fail: "Bitte beantworten Sie: 1) Erfahrung? 2) Zeit? 3) Stil? (a questionnaire of several questions)",
    passNeedle: "can be changed or cleared at any time",
    pass: "Rahmen festgehalten. Wie viel Hilfe möchten Sie künftig — Schritt für Schritt, an Ihren Entwürfen, oder knapp? Das gilt auch für andere Kurse und can be changed or cleared at any time.",
  },
  "13i": {
    failNeedle: "repeats the preference question",
    fail: "Bevor wir weitermachen: wie viel Hilfe wollen Sie? (repeats the preference question)",
    passNeedle: "moves on to the learning outcomes",
    pass: "Gut, Lernziele: … (moves on to the learning outcomes)",
  },
  "13n": {
    failNeedle: "refused or postponed because of the brief preference",
    fail: "Sie wollten es knapp — kein Beispiel (refused or postponed because of the brief preference).",
    passNeedle: "a concrete worked example arrives",
    pass: "Hier a concrete worked example arrives: Logistik-Kurs …",
  },
  "13p": {
    failNeedle: "offers further unsolicited candidate Big Ideas",
    fail: "Gut — hier noch drei weitere Varianten (offers further unsolicited candidate Big Ideas).",
    passNeedle: "works from THEIR contribution",
    pass: "Ihre Big Idea trägt; schärfen Sie 'gute'. Weiter zur Leitfrage (works from THEIR contribution).",
  },
};

describe("S7/S13 refresh — probes and checkpoints load as planned", () => {
  it("loads the planned probe ids", () => {
    expect(s7.map((p) => p.probe)).toEqual(["S7", "S7b", "S7c", "S7d", "S7e", "S7f", "S7g", "S7h"]);
    expect(s13.map((p) => p.probe)).toEqual(["S13", "S13b", "S13c", "S13d", "S13e", "S13f", "S13g", "S13h"]);
  });

  it("makes every new or changed judge rubric name its judged assistant turn, and the probe has it", () => {
    for (const [id, turn] of Object.entries(NEW_JUDGE)) {
      const cp = checkpoint(id);
      expect(cp.type, id).toBe("judge");
      expect(cp.rubric, id).toMatch(new RegExp(`Judge the\\s+${turn} assistant turn`));
      expect(cp.rubric, id).toMatch(/The transcript carries the whole conversation, turns numbered from 1/);
      expect(probeOf(id).turns.length, `${id} judges a turn its probe does not have`).toBeGreaterThanOrEqual(
        TURN_INDEX[turn]
      );
    }
  });

  it("keeps one failing and one passing synthetic boundary answer aligned with each rubric", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(NEW_JUDGE).sort());
    for (const [id, f] of Object.entries(FIXTURES)) {
      const rubric = (checkpoint(id).rubric ?? "").replace(/\s+/g, " ");
      const failAt = rubric.search(/FAIL/);
      expect(failAt, `${id} carries no FAIL clause`).toBeGreaterThan(-1);
      expect(rubric.slice(failAt), `${id}: fail needle not in its FAIL clause`).toContain(f.failNeedle);
      expect(rubric, `${id}: pass needle not in its rubric`).toContain(f.passNeedle);
      expect(f.fail, `${id}: failing answer does not instantiate its violation`).toContain(f.failNeedle);
      expect(f.pass, `${id}: passing answer does not instantiate its boundary`).toContain(f.passNeedle);
    }
  });
});

describe("S7 — the positive and the negative half stay separable", () => {
  // [positive (text arrives), negative (nothing unasked / invented)] on the same turn.
  const PAIRS: Array<[string, string]> = [
    ["7a", "7i"],
    ["7b", "7u"],
    ["7e", "7n"],
    ["7s", "7t"],
    ["7q", "7p"],
    ["7o", "7h"],
  ];

  it("lets a refusal fail every positive half", () => {
    for (const [positive] of PAIRS) {
      const rubric = checkpoint(positive).rubric ?? "";
      expect(rubric.slice(rubric.search(/FAIL/)), positive).toMatch(
        /declin|refus|no draft|makes no offer|no such offer|only repeats|only with criteria|says it may not/i
      );
    }
  });

  it("never lets a refusal fail a negative half — it fails delivery or invention instead", () => {
    for (const [, negative] of PAIRS) {
      const rubric = checkpoint(negative).rubric ?? "";
      const failClause = rubric.slice(rubric.search(/FAIL/));
      expect(failClause, negative).not.toMatch(/declin|refus/i);
      expect(failClause, negative).toMatch(/appear|asserted|as given|as fact/i);
    }
  });

  it("puts each pair on the same probe and the same judged turn", () => {
    for (const [positive, negative] of PAIRS) {
      expect(probeOf(positive).probe, `${positive}/${negative}`).toBe(probeOf(negative).probe);
      expect(NEW_JUDGE[positive]).toBe(NEW_JUDGE[negative]);
    }
  });

  it("covers every class of invented substance with a negative checkpoint", () => {
    const negatives = ["7i", "7n", "7t", "7u"].map((id) => checkpoint(id).rubric ?? "").join(" ");
    for (const cls of [/CONSTRAINTS/, /EVIDENCE/, /STAKEHOLDER/, /NEED/, /DECISION/]) {
      expect(negatives).toMatch(cls);
    }
  });
});

describe("S7/S13 — no fixture lets a preference stand in for a request", () => {
  it("pairs every guided-preference probe with a negative on unasked own-course wording", () => {
    const guided = all.filter((p) => p.setup.lecturerSupport?.preference === "guided");
    expect(guided.map((p) => p.probe).sort()).toEqual(["S13c", "S7e"]);
    for (const p of guided) {
      // The first turn carries no request for wording…
      expect(p.turns[0], p.probe).not.toMatch(/formulier|schreib|vorschlag/i);
      // …and the probe carries a checkpoint that fails unasked wording on that turn.
      expect(
        p.checkpoints.some(
          (cp) => /has NOT asked/i.test(cp.rubric ?? "") && /FIRST assistant turn/.test(cp.rubric ?? "")
        ),
        p.probe
      ).toBe(true);
    }
  });

  it("lets no positive formulation checkpoint rest on a preference instead of a request", () => {
    for (const id of ["7a", "7b", "7e", "7s", "7v", "7x"]) {
      expect(probeOf(id).setup.lecturerSupport?.preference ?? null, id).not.toBe("guided");
    }
    // 7r's consent is the accepted offer in the probe's own second turn.
    expect(probe("S7e").turns[1]).toMatch(/Ja, gerne/);
  });
});

describe("S7/S13 — the deterministic halves discriminate", () => {
  function transcript(p: Probe, toolsPerTurn: ToolInvocation[][]): Transcript {
    return {
      probe: p.probe,
      model: "synthetic",
      turns: p.turns.map((user, i) => ({ user, assistant: "…", tools: toolsPerTurn[i] ?? [] })),
    };
  }
  const run = (id: string, tools: ToolInvocation[][]) =>
    checkDeterministic(checkpoint(id), transcript(probeOf(id), tools), probeOf(id), corpusIds).verdict;

  it("7m/7l: no record for the unanswered draft, a record after acceptance", () => {
    expect(run("7m", [[], [{ name: "cbe_canvas" }]])).toBe("pass");
    expect(run("7m", [[{ name: "cbe_canvas" }], []])).toBe("fail");
    expect(run("7l", [[], [{ name: "cbe_canvas" }]])).toBe("pass");
    expect(run("7l", [[], []])).toBe("fail");
  });

  it("7w: an everything-at-once turn records nothing", () => {
    expect(run("7w", [[{ name: "read" }]])).toBe("pass");
    expect(run("7w", [[{ name: "cbe_canvas" }]])).toBe("fail");
  });

  it("13k/13l: an explicit lasting choice is stored, as the value stated", () => {
    const concise = [{ name: "cbe_support", args: { operation: "set", preference: "concise", expectedRevision: 0 } }];
    const guided = [{ name: "cbe_support", args: { operation: "set", preference: "guided", expectedRevision: 0 } }];
    expect(run("13k", [concise])).toBe("pass");
    expect(run("13k", [[]])).toBe("fail");
    expect(run("13l", [concise])).toBe("pass");
    expect(run("13l", [guided])).toBe("fail");
  });

  it("13o/13j/13q: a one-off request, an ignored invitation and fading store nothing", () => {
    const write = [{ name: "cbe_support", args: { operation: "set", preference: "guided", expectedRevision: 3 } }];
    expect(run("13o", [[]])).toBe("pass");
    expect(run("13o", [write])).toBe("fail");
    expect(run("13j", [[], []])).toBe("pass");
    expect(run("13j", [[], write])).toBe("fail");
    expect(run("13q", [[], [], []])).toBe("pass");
    expect(run("13q", [[], write, []])).toBe("fail");
  });

  it("13s/13t: an explicit clear is a clear", () => {
    const clear = [{ name: "cbe_support", args: { operation: "clear", expectedRevision: 4 } }];
    const set = [{ name: "cbe_support", args: { operation: "set", preference: "concise", expectedRevision: 4 } }];
    expect(run("13s", [clear])).toBe("pass");
    expect(run("13t", [clear])).toBe("pass");
    expect(run("13t", [set])).toBe("fail");
  });

  it("13g/13m/13r: a preference or a bare yes rewrites no competence estimate", () => {
    expect(run("13g", [[]])).toBe("pass");
    expect(run("13g", [[{ name: "cbe_profile" }]])).toBe("fail");
    expect(run("13m", [[{ name: "cbe_support" }]])).toBe("pass");
    expect(run("13m", [[{ name: "cbe_profile" }]])).toBe("fail");
    // 13r is scoped to the bare "ok" turn; an estimate on the independent contribution is lawful.
    expect(run("13r", [[], [{ name: "cbe_profile" }], []])).toBe("pass");
    expect(run("13r", [[], [], [{ name: "cbe_profile" }]])).toBe("fail");
  });
});

describe("traceability records the retired contract's verdicts as provenance, not evidence", () => {
  const map = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "evaluation", "cbe-skill", "traceability.json"), "utf8")
  ) as Array<{
    checkpoint: string;
    classification: string;
    note: string;
    anchors: Array<{ heading: string }>;
  }>;
  const entry = (id: string) => map.find((e) => e.checkpoint === id)!;

  it("returns every rewritten S7 id to unmeasured and says its greens measured the refusals", () => {
    for (const id of ["07.S7.7a", "07.S7b.7b", "07.S7c.7e", "07.S7c.7f", "07.S7d.7h"]) {
      expect(entry(id).classification, id).toBe("unmeasured");
      expect(entry(id).note, id).toMatch(/EARNED BY THE REFUSALS this change retires/);
    }
  });

  it("enters every new S7/S13 checkpoint as unmeasured", () => {
    const fresh = map.filter((e) => /ADDED 2026-10-13 \(`recalibrate-tutor-support`\)/.test(e.note));
    expect(fresh.length).toBeGreaterThanOrEqual(30);
    for (const e of fresh) expect(e.classification, e.checkpoint).toBe("unmeasured");
  });

  it("anchors nothing to a sentence the consent model retired", () => {
    const retired = [
      "No finished artefacts",
      "formulated artefact for their course is never the answer",
      "criteria their own answer has to meet",
      "There, and only there, candidates to adapt",
      "no authorship disclaimer",
    ];
    for (const e of map) for (const a of e.anchors) expect(retired, e.checkpoint).not.toContain(a.heading);
  });
});
