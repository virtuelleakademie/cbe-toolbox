/**
 * The three deterministic kinds added by `rebuild-skill-prompt-and-eval`, each against a
 * fixture transcript.
 *
 * Each exists because a JUDGE CANNOT MAKE THE CALL:
 *   - `cite_provenance` — a judge sees only the emitted text, and the emitted text of a
 *     fabricated token is indistinguishable from a grounded one. That is exactly how the
 *     previous suite came to reward the fabrication path: its citation checks inspected
 *     token strings only, so pasting a well-formed token from the skill body passed every
 *     one of them.
 *   - `reply_language`  — deterministic, and untested before this change: a refusal
 *     copied verbatim from the skill's English string passed every previous checkpoint.
 *   - `no_trailing_menu`— a structural property of the last paragraph, not a quality
 *     judgement.
 */
import { describe, it, expect } from "vitest";
import { checkDeterministic, detectLanguage, trailingMenu, readACorpusDocument } from "../src/checker-deterministic.js";
import type { Checkpoint, Probe, Transcript, TurnTranscript } from "../src/types.js";

const CORPUS = new Set(["methodology-001", "foundations-002"]);
const CORPUS_PATHS = new Map([
  ["methodology-001", "/corpus/content/methodology-001.md"],
  ["foundations-002", "/corpus/content/foundations-002.md"],
]);

function probe(): Probe {
  return {
    probe: "S6",
    scenarioFile: "06-citing.md",
    setup: { profile: "app" },
    turns: ["q"],
    checkpoints: [],
  };
}

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "6a",
    type: "deterministic",
    anchors: [{ channel: "prompt", file: "identity-prompt", heading: "Corpus grounding" }],
    check: { kind: "cite_provenance" },
    ...over,
  };
}

function turn(over: Partial<TurnTranscript> = {}): TurnTranscript {
  return { user: "q", assistant: "", tools: [], ...over };
}

function transcript(turns: TurnTranscript[]): Transcript {
  return { probe: "S6", model: "test", turns };
}

describe("cite_provenance", () => {
  const score = (t: Transcript) => checkDeterministic(cp(), t, probe(), CORPUS, CORPUS_PATHS);

  it("passes a token backed by a prior read AND a cbe_cite call in that turn", () => {
    const t = transcript([
      turn({
        assistant: "Assessment in CBE rests on process evidence (corpus:methodology-001 § Phase 1: Engage, X 2018).",
        tools: [
          { name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" }, isError: false },
          {
            name: "cbe_cite",
            callId: "c1",
            args: { id: "methodology-001", section: "Phase 1: Engage" },
            result: { content: [{ type: "text", text: "(corpus:methodology-001 § Phase 1: Engage, X 2018)" }] },
            isError: false,
          },
        ],
        events: [
          { type: "tool_start", name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" } },
          { type: "tool_end", name: "read", callId: "r1", result: "body", isError: false },
          {
            type: "tool_start",
            name: "cbe_cite",
            callId: "c1",
            args: { id: "methodology-001", section: "Phase 1: Engage" },
          },
          {
            type: "tool_end",
            name: "cbe_cite",
            callId: "c1",
            result: "(corpus:methodology-001 § Phase 1: Engage, X 2018)",
            isError: false,
          },
          {
            type: "text",
            text: "Assessment in CBE rests on process evidence (corpus:methodology-001 § Phase 1: Engage, X 2018).",
          },
        ],
      }),
    ]);
    const r = score(t);
    expect(r.verdict).toBe("pass");
  });

  it("FAILS a token with no prior read of that document", () => {
    // The fabrication path: canonically formed, plausible, and never grounded.
    const t = transcript([
      turn({
        assistant: "(corpus:methodology-001 § Phase 1: Engage, X 2018)",
        tools: [
          {
            name: "cbe_cite",
            callId: "c1",
            args: { id: "methodology-001" },
            result: { content: [{ type: "text", text: "(corpus:methodology-001 § Phase 1: Engage, X 2018)" }] },
            isError: false,
          },
        ],
        events: [
          { type: "tool_start", name: "cbe_cite", callId: "c1", args: { id: "methodology-001" } },
          {
            type: "tool_end",
            name: "cbe_cite",
            callId: "c1",
            result: "(corpus:methodology-001 § Phase 1: Engage, X 2018)",
            isError: false,
          },
          { type: "text", text: "(corpus:methodology-001 § Phase 1: Engage, X 2018)" },
        ],
      }),
    ]);
    const r = score(t);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/methodology-001/);
    expect(r.reasoning).toMatch(/without a prior read/);
  });

  // Product decision, 2026-08-07: writing the well-formed token yourself is a legitimate
  // route. The lecturer gets the same working link either way, so what is graded is the
  // result — real document, actually read — not which route produced it.
  it("PASSES a hand-written token when it is well-formed and the document WAS read", () => {
    const t = transcript([
      turn({
        assistant: "(corpus:methodology-001 § Phase 1: Engage, X 2018)",
        tools: [{ name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" }, isError: false }],
        events: [
          { type: "tool_start", name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" } },
          { type: "tool_end", name: "read", callId: "r1", result: "body", isError: false },
          { type: "text", text: "(corpus:methodology-001 § Phase 1: Engage, X 2018)" },
        ],
      }),
    ]);
    const r = score(t);
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toMatch(/was read in this session/);
  });

  it("rejects a similarly named file that is not the indexed corpus document", () => {
    const t = transcript([
      turn({
        assistant: "(corpus:methodology-001 § Phase 1: Engage, X 2018)",
        tools: [
          { name: "read", args: { path: "/corpus/content/methodology-001-notes.md" } },
          {
            name: "cbe_cite",
            args: { id: "methodology-001" },
            result: { content: [{ type: "text", text: "(corpus:methodology-001 § Phase 1: Engage, X 2018)" }] },
            isError: false,
          },
        ],
      }),
    ]);
    expect(score(t).verdict).toBe("fail");
  });

  it("counts a read from an EARLIER turn as grounding a later citation", () => {
    const t = transcript([
      turn({
        assistant: "Let me look.",
        tools: [{ name: "read", args: { path: "/corpus/content/foundations-002.md" }, isError: false }],
      }),
      turn({
        assistant: "(corpus:foundations-002 § 2. Moving Beyond the Four Walls, Y 2018)",
        tools: [
          {
            name: "cbe_cite",
            callId: "c2",
            args: { id: "foundations-002" },
            result: {
              content: [{ type: "text", text: "(corpus:foundations-002 § 2. Moving Beyond the Four Walls, Y 2018)" }],
            },
            isError: false,
          },
        ],
        events: [
          { type: "tool_start", name: "cbe_cite", callId: "c2", args: { id: "foundations-002" } },
          {
            type: "tool_end",
            name: "cbe_cite",
            callId: "c2",
            result: "(corpus:foundations-002 § 2. Moving Beyond the Four Walls, Y 2018)",
            isError: false,
          },
          { type: "text", text: "(corpus:foundations-002 § 2. Moving Beyond the Four Walls, Y 2018)" },
        ],
      }),
    ]);
    expect(score(t).verdict).toBe("pass");
  });

  it("FAILS when the canonical read errored", () => {
    const token = "(corpus:methodology-001 § Phase 1: Engage, X 2018)";
    const t = transcript([
      turn({
        assistant: token,
        tools: [
          { name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" }, isError: true },
          { name: "cbe_cite", callId: "c1", args: { id: "methodology-001" }, result: token, isError: false },
        ],
        events: [
          { type: "tool_start", name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" } },
          { type: "tool_end", name: "read", callId: "r1", result: "not found", isError: true },
          { type: "tool_start", name: "cbe_cite", callId: "c1", args: { id: "methodology-001" } },
          { type: "tool_end", name: "cbe_cite", callId: "c1", result: token, isError: false },
          { type: "text", text: token },
        ],
      }),
    ]);
    expect(score(t).verdict).toBe("fail");
  });

  it("FAILS when the token is emitted before successful read and cbe_cite calls", () => {
    const token = "(corpus:methodology-001 § Phase 1: Engage, X 2018)";
    const t = transcript([
      turn({
        assistant: token,
        tools: [
          { name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" }, isError: false },
          { name: "cbe_cite", callId: "c1", args: { id: "methodology-001" }, result: token, isError: false },
        ],
        events: [
          { type: "text", text: token },
          { type: "tool_start", name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" } },
          { type: "tool_end", name: "read", callId: "r1", result: "body", isError: false },
          { type: "tool_start", name: "cbe_cite", callId: "c1", args: { id: "methodology-001" } },
          { type: "tool_end", name: "cbe_cite", callId: "c1", result: token, isError: false },
        ],
      }),
    ]);
    expect(score(t).verdict).toBe("fail");
  });

  // KNOWN GAP, accepted with the 2026-08-07 criteria: the section behind `§` is not a pass
  // criterion, so a token naming a real, read document survives even when its section was
  // invented — here, after cbe_cite refused that very section. The renderer links on the id
  // alone, so the lecturer still reaches the right document; what she cannot trust is the
  // section label. Measured as an insight, not scored.
  it("PASSES a token with an invented section when the document is real and was read", () => {
    const t = transcript([
      turn({
        assistant: "(corpus:methodology-001 § Invented section, X 2018)",
        tools: [
          { name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" }, isError: false },
          {
            name: "cbe_cite",
            callId: "c1",
            args: { id: "methodology-001", section: "Invented section" },
            result: { details: { kind: "citation-refusal", error: "unknown-section" } },
            isError: false,
          },
        ],
        events: [
          { type: "tool_start", name: "read", callId: "r1", args: { path: "/corpus/content/methodology-001.md" } },
          { type: "tool_end", name: "read", callId: "r1", result: "body", isError: false },
          {
            type: "tool_start",
            name: "cbe_cite",
            callId: "c1",
            args: { id: "methodology-001", section: "Invented section" },
          },
          {
            type: "tool_end",
            name: "cbe_cite",
            callId: "c1",
            result: { details: { kind: "citation-refusal" } },
            isError: false,
          },
          { type: "text", text: "(corpus:methodology-001 § Invented section, X 2018)" },
        ],
      }),
    ]);
    const r = score(t);
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toMatch(/was read in this session/);
  });

  it("passes a transcript with no token at all — this checkpoint governs the tokens emitted", () => {
    const t = transcript([turn({ assistant: "The corpus does not cover that; treat this as practice observation." })]);
    const r = score(t);
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toMatch(/no \(corpus:…\) token/);
  });

  it("names every unprovenanced id, not just the first", () => {
    const t = transcript([
      turn({ assistant: "(corpus:methodology-001 § A, X 2018) and (corpus:foundations-002 § B, Y 2018)" }),
    ]);
    const r = score(t);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/methodology-001/);
    expect(r.reasoning).toMatch(/foundations-002/);
  });
});

describe("readACorpusDocument (run-level metric)", () => {
  // Eager skill inclusion removes the model's main reason to touch the filesystem. The
  // regression that would cause is invisible per-checkpoint and obvious in this metric.
  it("is true when a corpus document body was read", () => {
    expect(
      readACorpusDocument(
        transcript([
          turn({ tools: [{ name: "read", args: { path: "/corpus/content/methodology-001.md" }, isError: false }] }),
        ]),
        CORPUS_PATHS
      )
    ).toBe(true);
  });

  it("is false when only the corpus INDEX was read", () => {
    expect(
      readACorpusDocument(
        transcript([turn({ tools: [{ name: "read", args: { path: "/corpus/index.json" }, isError: false }] })]),
        CORPUS_PATHS
      )
    ).toBe(false);
  });

  it("is false for a non-corpus path containing a corpus id", () => {
    expect(
      readACorpusDocument(
        transcript([turn({ tools: [{ name: "read", args: { path: "/notes/methodology-001.md" }, isError: false }] })]),
        CORPUS_PATHS
      )
    ).toBe(false);
  });

  it("is false for failed or incomplete reads", () => {
    const failed = turn({
      tools: [{ name: "read", args: { path: "/corpus/content/methodology-001.md" }, isError: true }],
    });
    const incomplete = turn({ tools: [{ name: "read", args: { path: "/corpus/content/methodology-001.md" } }] });
    expect(readACorpusDocument(transcript([failed, incomplete]), CORPUS_PATHS)).toBe(false);
  });

  it("is false when nothing was read", () => {
    expect(readACorpusDocument(transcript([turn({ assistant: "here you go" })]), CORPUS_PATHS)).toBe(false);
  });
});

describe("reply_language", () => {
  it("detects German and English from function words", () => {
    expect(detectLanguage("Das ist ein Entwurf und die Studierenden sollen ihn nicht einfach übernehmen.")).toBe("de");
    expect(detectLanguage("This is a draft and the students should not simply adopt it for the module.")).toBe("en");
  });

  it("reports unknown below the evidence floor rather than guessing", () => {
    expect(detectLanguage("Ok.")).toBe("unknown");
  });

  const langCp = (pattern?: string, t?: number): Checkpoint =>
    cp({
      id: "9a",
      check: { kind: "reply_language", ...(pattern ? { pattern } : {}) },
      ...(t === undefined ? {} : { turn: t }),
    });

  it("passes when the reply matches the expected language", () => {
    const t = transcript([
      turn({
        user: "Machen wir auf Deutsch weiter.",
        assistant: "Gerne. Das ist ein guter Ausgangspunkt und wir sollten die Lernziele nicht überspringen.",
      }),
    ]);
    expect(checkDeterministic(langCp("de"), t, probe(), CORPUS).verdict).toBe("pass");
  });

  it("FAILS when the reply is in the other language", () => {
    const t = transcript([
      turn({
        user: "Machen wir auf Deutsch weiter.",
        assistant: "Sure. This is a good starting point and we should not skip the learning outcomes for the module.",
      }),
    ]);
    const r = checkDeterministic(langCp("de"), t, probe(), CORPUS);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/reply is en, expected de/);
  });

  it("mirrors the user turn when no expected language is given", () => {
    const t = transcript([
      turn({
        user: "Ich möchte das Modul umbauen und die Studierenden sollen mehr Verantwortung tragen.",
        assistant: "Gut. Dann ist die erste Frage, wie weit Sie das Modul treiben wollen und was schon steht.",
      }),
    ]);
    expect(checkDeterministic(langCp(), t, probe(), CORPUS).verdict).toBe("pass");
  });

  it("is not-assessable when the reply carries too little text to judge", () => {
    const t = transcript([turn({ user: "Weiter?", assistant: "Ok." })]);
    expect(checkDeterministic(langCp("de"), t, probe(), CORPUS).verdict).toBe("not-assessable");
  });
});

describe("no_trailing_menu", () => {
  it("flags a closing question that hands the ordering back", () => {
    expect(
      trailingMenu("Here is the analysis.\n\nWhere would you like to start — outcomes, assessment, or the challenge?")
    ).toMatch(/Where would you like to start/);
  });

  it("flags the German form", () => {
    expect(
      trailingMenu("Soweit der Stand.\n\nWomit möchten Sie weitermachen — Lernzielen oder Assessment?")
    ).toBeTruthy();
  });

  it("does NOT flag a proposed next step that asks for confirmation", () => {
    // This is exactly what the backbone rule ASKS for; flagging it would invert the rule.
    expect(
      trailingMenu("Sie stehen bei Schritt 2.\n\nIch schlage vor, als Nächstes das Assessment zu klären — passt das?")
    ).toBeNull();
  });

  it("does NOT flag a turn that does not end on a question", () => {
    expect(trailingMenu("Der nächste Schritt ist das Assessment. Ich fange damit an.")).toBeNull();
  });

  it("scores through checkDeterministic", () => {
    const menuCp = cp({ id: "2c", check: { kind: "no_trailing_menu" } });
    const bad = transcript([turn({ assistant: "Done.\n\nWhat would you like to do next — outcomes or assessment?" })]);
    const good = transcript([
      turn({ assistant: "Sie stehen bei Schritt 3. Ich schlage vor, wir klären zuerst die Nachweisform." }),
    ]);
    expect(checkDeterministic(menuCp, bad, probe(), CORPUS).verdict).toBe("fail");
    expect(checkDeterministic(menuCp, good, probe(), CORPUS).verdict).toBe("pass");
  });
});

/**
 * `tool_arg_matches`, added by `format-canvas-artefacts-in-markdown`.
 *
 * The fourth kind a judge cannot make the call on, and for the bluntest reason:
 * `judgeTranscriptText` renders tool NAMES only, so what a mirroring tool actually WROTE
 * is invisible to it, while `tool_called` sees only THAT the tool ran. A rule about the
 * FORM of a canvas value therefore had no instrument at all until this kind.
 */
describe("tool_arg_matches", () => {
  // The structured-Markdown pattern: a list item, a table row or a heading at the start
  // of a line. Kept identical to the one scenario 10 carries.
  const STRUCTURE = "/(^|\\n)[ \\t]*(?:[-*+][ \\t]+\\S|\\d+[.)][ \\t]+\\S|\\|[^\\n]*\\||#{1,6}[ \\t]+\\S)/";
  const structured = cp({
    id: "10e",
    anchors: [{ channel: "tool", file: "cbe_canvas", heading: "WRITE IT AS MARKDOWN" }],
    check: { kind: "tool_arg_matches", tool: "cbe_canvas", arg: "value", pattern: STRUCTURE },
  });
  const canvasWith = (value: string): TurnTranscript =>
    turn({
      assistant: "Festgehalten.",
      tools: [{ name: "cbe_canvas", callId: "c1", args: { step: 2, id: "learningoutcomes", value }, isError: false }],
    });
  const score = (t: Transcript) => checkDeterministic(structured, t, probe(), CORPUS);

  it("passes a value carrying a bullet list", () => {
    const r = score(transcript([canvasWith("Drei Lernergebnisse:\n\n- analysieren\n- bewerten\n- entwerfen")]));
    expect(r.verdict).toBe("pass");
    expect(r.evidence).toContain("- analysieren");
  });

  it("passes a value carrying a table", () => {
    const table = "| Lernergebnis | Nachweis |\n| --- | --- |\n| analysieren | Bericht |";
    expect(score(transcript([canvasWith(table)])).verdict).toBe("pass");
  });

  it("fails a value that is one undifferentiated prose block", () => {
    const r = score(transcript([canvasWith("Die Studierenden analysieren, bewerten und entwerfen, alles in Prosa.")]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/1 call\(s\) inspected/);
  });

  it("fails when the tool never ran, and says so rather than reporting a mismatch", () => {
    const r = score(transcript([turn({ assistant: "Ich halte das gerne fest." })]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/was not invoked/);
  });

  it("scores the checkpoint's own turn, not the whole conversation", () => {
    const t = transcript([canvasWith("- analysieren\n- bewerten"), canvasWith("Alles in einem Satz zusammengefasst.")]);
    const twoTurns: Probe = { ...probe(), turns: ["q1", "q2"] };
    expect(checkDeterministic({ ...structured, turn: 1 }, t, twoTurns, CORPUS).verdict).toBe("fail");
    expect(checkDeterministic({ ...structured, turn: 0 }, t, twoTurns, CORPUS).verdict).toBe("pass");
  });

  it("is not-assessable where the canvas affordance is off", () => {
    const headless: Probe = { ...probe(), setup: { profile: "headless" } };
    expect(checkDeterministic(structured, transcript([turn()]), headless, CORPUS).verdict).toBe("not-assessable");
  });
});
