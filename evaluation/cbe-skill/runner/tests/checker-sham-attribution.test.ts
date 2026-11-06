/**
 * `cite_no_sham_attribution` — the two reproduced citation failure modes, scored against
 * REAL CAPTURED TRANSCRIPTS in both directions. No model is contacted in this file.
 *
 * spec: cbe-skill-eval-harness, Requirement "A Sham Citation Is Caught Deterministically"
 *       cbe-skill-eval-harness, Requirement "Invented Bibliographic Detail for a
 *       Non-Corpus Source Is Caught by a Judge Checkpoint" (rubric ↔ gold-set coupling only;
 *       the verdict itself is calibrated by the gold set, never by a stub)
 *
 * The fixtures under `tests/fixtures/` are trimmed copies of transcripts this suite really
 * produced — each file records its own provenance in `_source`. Two carry the behaviour,
 * one does not, and the one that does not is the transcript in which the model cited
 * CORRECTLY while still naming document ids in prose. That is the false positive the check
 * is designed around, so it is asserted here rather than argued in a comment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { checkDeterministic, corpusTokenOccurrences } from "../src/checker-deterministic.js";
import { loadCorpusIds, loadCorpusPaths, parseProbes } from "../src/loader.js";
import type { Checkpoint, Probe, Transcript, TurnTranscript } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const fixtureDir = path.join(here, "fixtures");
const corpusIds = loadCorpusIds(path.join(repoRoot, "corpus", "index.json"));
const corpusPaths = loadCorpusPaths(path.join(repoRoot, "corpus", "index.json"));

function captured(name: string): Transcript {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Transcript;
}

function probe(): Probe {
  return { probe: "S6", scenarioFile: "06-citing.md", setup: { profile: "app" }, turns: ["q", "q"], checkpoints: [] };
}

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "6d",
    type: "deterministic",
    anchors: [{ channel: "tool", file: "cbe_cite", heading: "NEVER HAND-WRITE A (corpus:…) TOKEN" }],
    check: { kind: "cite_no_sham_attribution" },
    ...over,
  };
}

const score = (t: Transcript, over: Partial<Checkpoint> = {}) =>
  checkDeterministic(cp(over), t, probe(), corpusIds, corpusPaths);

function transcript(turns: Array<Partial<TurnTranscript>>): Transcript {
  return { probe: "S6", model: "test", turns: turns.map((t) => ({ user: "u", assistant: "", tools: [], ...t })) };
}

/** A successful `cbe_cite` result carrying `token`, in the shape the runner records. */
function citeCall(id: string, token: string): TurnTranscript["tools"][number] {
  return { name: "cbe_cite", args: { id }, isError: false, result: { content: [{ type: "text", text: token }] } };
}

describe("cite_no_sham_attribution — real captured transcripts", () => {
  // spec scenario: A hand-written token-shaped string fails
  it("fails the captured session that hand-wrote token-shaped strings", () => {
    const t = captured("s6-fabricated-tokens.json");
    const r = score(t);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("malformed citation token");
    expect(r.reasoning).toContain("corpus:methodology-003,");
  });

  // spec scenario: A document id attributed in a parenthetical without a token fails
  it("fails the captured run that attributed document ids in prose", () => {
    const t = captured("s6-prose-attribution.json");
    const r = score(t);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("methodology-003: attributed in (methodology-003)");
    expect(r.reasoning).toContain("methodology-005");
  });

  // spec scenario: A tool-produced token exempts later mentions of the same id
  // spec scenario: A tool-produced token whose section heading contains parentheses is not a sham
  it("passes the captured run that cited properly, although it also names ids in prose", () => {
    const t = captured("s6-provenanced.json");
    // The transcript really does carry both shapes the check reasons about.
    const text = t.turns.map((x) => x.assistant).join("\n");
    expect(text).toContain("(methodology-003, methodology-005)");
    expect(text).toContain("(corpus:methodology-012 § Step 3 — Decide how you will assess learning (evidence first)");

    const r = score(t);
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toContain("methodology-012");
  });

  it("is the only citation check that sees either failure — 6a and 6b pass both", () => {
    for (const name of ["s6-fabricated-tokens.json", "s6-prose-attribution.json"]) {
      const t = captured(name);
      const provenance = checkDeterministic(
        cp({ id: "6a", check: { kind: "cite_provenance" } }),
        t,
        probe(),
        corpusIds,
        corpusPaths
      );
      const outside = checkDeterministic(
        cp({ id: "6b", check: { kind: "cite_none_outside_corpus" } }),
        t,
        probe(),
        corpusIds,
        corpusPaths
      );
      expect(provenance.verdict, `${name} / 6a`).toBe("pass");
      expect(outside.verdict, `${name} / 6b`).toBe("pass");
      expect(score(t).verdict, `${name} / 6d`).toBe("fail");
    }
  });
});

describe("cite_no_sham_attribution — rule boundaries", () => {
  // spec scenario: A transcript that attributes nothing passes
  it("passes a transcript that attributes nothing", () => {
    const r = score(transcript([{ assistant: "Assessment folgt den Zielen, nicht umgekehrt." }]));
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toContain("no corpus document id was attributed");
  });

  it("does not flag a document id in running prose outside a parenthetical", () => {
    const r = score(transcript([{ assistant: "Die Prozessartefakte aus methodology-005 tragen das Prozessziel." }]));
    expect(r.verdict).toBe("pass");
  });

  it("flags a backticked id inside a parenthetical", () => {
    const r = score(
      transcript([{ assistant: "Ein Granularitäts-Mismatch (aus `methodology-003`) ist der Normalfall." }])
    );
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("methodology-003");
  });

  it("does not flag a kebab-case word that is not a corpus id", () => {
    const r = score(transcript([{ assistant: "Die Rubrik folgt einem Muster (siehe process-artefact catalogue)." }]));
    expect(r.verdict).toBe("pass");
  });

  it("exempts a prose mention when an EARLIER turn produced the token", () => {
    const token = "(corpus:methodology-003 § The triad)";
    const t = transcript([
      { assistant: `Die Triade muss zusammenpassen ${token}.`, tools: [citeCall("methodology-003", token)] },
      { assistant: "Das ist strukturell verwandt mit dem Verb-Deliverable-Mismatch (methodology-003)." },
    ]);
    expect(score(t).verdict).toBe("pass");
  });

  it("still fails when the token for a DIFFERENT id was produced", () => {
    const token = "(corpus:methodology-003 § The triad)";
    const t = transcript([
      { assistant: `Die Triade muss zusammenpassen ${token}.`, tools: [citeCall("methodology-003", token)] },
      { assistant: "Prozessartefakte (methodology-005) belegen Prozessziele." },
    ]);
    const r = score(t);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("methodology-005");
    expect(r.reasoning).not.toContain("methodology-003:");
  });

  it("scores only the graded turn's text when the checkpoint names a turn", () => {
    const t = transcript([
      { assistant: "Konstruktive Ausrichtung (methodology-003)." },
      { assistant: "Dazu trägt der Korpus nichts bei." },
    ]);
    expect(score(t, { turn: 1 }).verdict).toBe("pass");
    expect(score(t, { turn: 0 }).verdict).toBe("fail");
  });
});

describe("corpusTokenOccurrences", () => {
  it("closes on the balanced paren, so a parenthesised section heading stays whole", () => {
    const token = "(corpus:methodology-012 § Step 3 — Decide how you will assess learning (evidence first), X 2026)";
    expect(corpusTokenOccurrences(`Blueprint ${token}.`)).toEqual([token]);
  });

  it("captures a hand-written token-shaped string whole", () => {
    const sham = '(corpus:methodology-003, "Triad", "The triad" / "Catalogue")';
    expect(corpusTokenOccurrences(`Muster ${sham}`)).toEqual([sham]);
  });

  it("does not run past a line break, and still reports the unclosed opening", () => {
    expect(corpusTokenOccurrences("(corpus:methodology-003 § The\ntriad)")).toEqual(["(corpus:methodology-003 § The"]);
  });

  it("fails an unclosed token — nothing can back a claim of provenance that has no end", () => {
    const r = score(transcript([{ assistant: "Die Triade (corpus:methodology-003 § The triad\nsteht fest." }]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("malformed citation token");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6e — the judge checkpoint's rubric and its calibration must not drift apart.
// A judge verdict is never asserted here: scoring a rubric with a stub would prove
// the stub obeyed its script (negative-fixture.ts refuses judge fixtures for the
// same reason). What IS mechanically checkable is that the gold triples calibrate
// the rubric the scenario actually ships.
// ─────────────────────────────────────────────────────────────────────────────

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Strip a rubric's TRANSCRIPT NAVIGATION preamble, leaving the criterion.
 *
 * A scenario rubric may open with "The transcript carries the whole conversation, turns
 * numbered from 1. Judge the Nth assistant turn; the others are context only." That
 * sentence exists because `turn:` is inert on a judge checkpoint — `judgeTranscriptText`
 * always renders the WHOLE conversation, so a rubric meaning "in the second reply" has to
 * say so itself. A gold triple, by contrast, is a single answer and not a conversation:
 * the sentence would point at nothing there, so the fixtures deliberately omit it.
 *
 * What must not drift apart is the CRITERION — the part that decides pass from fail. That
 * is what this comparison covers, and adding the preamble to the fixtures instead would
 * calibrate the judge against an instruction it cannot follow.
 */
const criterion = (s: string) =>
  flat(s).replace(/^The transcript carries the whole conversation[^.]*\.\s*Judge the [^.]*\.\s*/i, "");

function goldTriples(): Array<{ id: string; label: string; expected: string; rubric: string; answer: string }> {
  const dir = path.join(repoRoot, "evaluation", "cbe-skill", "fixtures", "gold");
  return ["clear-fail.yaml", "clear-pass.yaml"].flatMap(
    (f) => yaml.loadAll(readFileSync(path.join(dir, f), "utf8")) as Array<Record<string, string>>
  ) as Array<{ id: string; label: string; expected: string; rubric: string; answer: string }>;
}

describe("6e — substituted source", () => {
  const scenario = readFileSync(path.join(repoRoot, "evaluation", "cbe-skill", "scenarios", "06-citing.md"), "utf8");
  const probes = parseProbes(scenario, "06-citing.md", corpusIds, { onWarn: () => {} });
  const rubric = probes[0]!.checkpoints.find((c) => c.id === "6e")!.rubric!;

  // The scope is carried by the RUBRIC, not by `turn:`. Until 2026-08-08 this checkpoint
  // declared `turn: 1` and the assertion below demanded it — but the runner honours `turn:`
  // only on deterministic checks (`scopedText` / `scopedTools`), while a judge is handed the
  // whole conversation by `judgeTranscriptText`. The field therefore promised a narrowing
  // that never happened, which is exactly how S11's `11a` came to pass on a turn that never
  // contained the behaviour. Carrying it here would re-state that false promise.
  it("is a judge checkpoint that binds its turn in the rubric, not in an inert `turn:`", () => {
    const checkpoint = probes[0]!.checkpoints.find((c) => c.id === "6e")!;
    expect(checkpoint.type).toBe("judge");
    expect(checkpoint.turn).toBeUndefined();
    expect(flat(checkpoint.rubric!)).toContain("Judge the second assistant turn");
  });

  // spec scenario: Invented bibliographic detail fails
  // spec scenario: Naming an outside thinker without bibliographic detail passes
  it("is calibrated in both directions by gold triples carrying the same criterion", () => {
    const mine = goldTriples().filter((t) => criterion(t.rubric) === criterion(rubric));
    expect(mine.map((t) => t.expected).sort()).toEqual(["fail", "pass"]);
    const fail = mine.find((t) => t.expected === "fail")!;
    const pass = mine.find((t) => t.expected === "pass")!;
    // The reproduced answer, verbatim in the part that matters.
    expect(fail.answer).toContain("Resonanz: Eine Kritik der Verzeitlichung");
    expect(fail.answer).toContain("2019");
    // The pass triple names the theory and supplies no bibliography at all.
    expect(pass.answer).toContain("Resonanztheorie");
    expect(pass.answer).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it("does not fail an outside thinker merely for being named", () => {
    expect(flat(rubric)).toContain("Naming a thinker or a body of theory from outside the corpus");
    expect(flat(rubric)).toContain("legitimate and PASSES");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6c — the gap rubric, coupled to its gold triples for the same reason as 6e.
//
// REPAIRED 2026-08-11. The old FAIL clause read "FAIL if it cites any corpus document for
// the Resonanzstufen-Modell", which a judge cannot separate from a token grounding the CBE
// concept the outside model is mapped onto — and the sixth non-negotiable REQUIRES that
// second token. At n=3 it failed the answer that did both halves correctly, saying so in its
// own reasoning. The distinction is now stated in the rubric and calibrated in BOTH
// directions before any candidate token, which is the only way to find out whether a judge
// can actually draw a line a rubric asks it to draw.
// ─────────────────────────────────────────────────────────────────────────────

describe("6c — corpus gap", () => {
  const scenario = readFileSync(path.join(repoRoot, "evaluation", "cbe-skill", "scenarios", "06-citing.md"), "utf8");
  const probes = parseProbes(scenario, "06-citing.md", corpusIds, { onWarn: () => {} });
  const rubric = probes[0]!.checkpoints.find((c) => c.id === "6c")!.rubric!;

  it("states which citation fails and which is required", () => {
    expect(flat(rubric)).toContain("offered as a SOURCE FOR the Resonanzstufen model fails");
    expect(flat(rubric)).toContain("grounding the CBE-side concept the model is being mapped ONTO does not fail");
  });

  it("is calibrated in both directions by gold triples carrying the same criterion", () => {
    const mine = goldTriples().filter((t) => criterion(t.rubric) === criterion(rubric));
    expect(mine.map((t) => t.expected).sort()).toEqual(["fail", "pass"]);
    const pass = mine.find((t) => t.expected === "pass")!;
    const fail = mine.find((t) => t.expected === "fail")!;
    // The pass triple carries BOTH shapes: the ungrounded marking and a corpus token.
    expect(pass.answer).toContain("ungrundierte Praxisbeobachtung");
    expect(pass.answer).toContain("(corpus:methodology-005 § Process-artefact catalogue)");
    // The fail triple attributes the outside model's own content to a corpus document.
    expect(fail.answer).toContain("Die vier Resonanzstufen werden dort aber beschrieben");
    expect(fail.answer).toContain("dass die Stufen des Modells direkt als Rubrik-Kriterien");
  });
});
