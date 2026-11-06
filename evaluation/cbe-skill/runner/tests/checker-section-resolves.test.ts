/**
 * `cite_section_resolves` — the deterministic check added by
 * `verify-hand-written-citation-tokens` (capability `cbe-skill-eval-harness`,
 * Requirement: *An Invented Citation Section Is Caught Deterministically*).
 *
 * WHY IT EXISTS. The product ruling of 2026-08-10 makes the hand-written token a
 * lawful route to a citation, so nothing grades the route any more. What the route
 * loses is the section check `cbe_cite` performs — and an invented `§` is worse than a
 * missing one, because it looks precise and the renderer links it.
 *
 * A judge cannot make this call: whether a heading exists in a corpus document is a
 * fact about the corpus, not about the emitted text.
 *
 * This file also covers the two SCENARIOS the same change added to the modified
 * requirements — that a hand-written token passes `cite_provenance` when the document
 * was read, and that a `read` exempts an attribution from `cite_no_sham_attribution`.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDeterministic } from "../src/checker-deterministic.js";
import { loadCorpusHeadings, loadCorpusIds, loadCorpusPaths } from "../src/loader.js";
import type { Checkpoint, Probe, Transcript, TurnTranscript } from "../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const corpusIndex = path.join(repoRoot, "corpus", "index.json");
const CORPUS_IDS = loadCorpusIds(corpusIndex);
const CORPUS_PATHS = loadCorpusPaths(corpusIndex);
const CORPUS_HEADINGS = loadCorpusHeadings(corpusIndex);

/** A real corpus document and one of its real headings — read from the tree, not
 * recalled, so a corpus edit fails the test loudly instead of silently. */
const DOC = "foundations-001";
const REAL_HEADING = CORPUS_HEADINGS.get(DOC)![2]!;

function probe(): Probe {
  return { probe: "S6", scenarioFile: "06-citing.md", setup: { profile: "app" }, turns: ["q"], checkpoints: [] };
}

function cp(kind: string, over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "6g",
    type: "deterministic",
    anchors: [{ channel: "prompt", file: "identity-prompt", heading: "Corpus grounding" }],
    check: { kind } as Checkpoint["check"],
    ...over,
  };
}

function transcript(turns: Array<Partial<TurnTranscript>>): Transcript {
  return { probe: "S6", model: "test", turns: turns.map((t) => ({ user: "q", assistant: "", tools: [], ...t })) };
}

const score = (t: Transcript, headings = CORPUS_HEADINGS) =>
  checkDeterministic(cp("cite_section_resolves"), t, probe(), CORPUS_IDS, CORPUS_PATHS, headings);

describe("cite_section_resolves", () => {
  it("sanity: the corpus really carries the heading this file tests against", () => {
    expect(CORPUS_HEADINGS.get(DOC)!.length).toBeGreaterThan(2);
    expect(REAL_HEADING.length).toBeGreaterThan(0);
  });

  // Scenario: A token with no section fails
  it("fails a token with no section and names the id", () => {
    const r = score(transcript([{ assistant: `CBL rests on experience (corpus:${DOC}).` }]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain(DOC);
    expect(r.reasoning).toContain("no § section");
  });

  // Scenario: A section that matches no heading fails
  it("fails a section that matches no heading and reports the document's actual headings", () => {
    const r = score(transcript([{ assistant: `See (corpus:${DOC} § Resonanzstufen-Modell, Kolb 1984).` }]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("Resonanzstufen-Modell");
    expect(r.reasoning).toContain("matches no heading");
    expect(r.reasoning).toContain(REAL_HEADING);
  });

  // Scenario: A section matching a heading passes regardless of how the token was produced
  it("passes a matching section with no cbe_cite call anywhere in the transcript", () => {
    const t = transcript([{ assistant: `See (corpus:${DOC} § ${REAL_HEADING}, Kolb 1984).`, tools: [] }]);
    expect(t.turns[0]!.tools).toHaveLength(0);
    const r = score(t);
    expect(r.verdict).toBe("pass");
  });

  it("matches a section the tool would also accept — case-folded, §-prefixed, numbered", () => {
    for (const written of [REAL_HEADING.toLowerCase(), `§ ${REAL_HEADING}`, `2. ${REAL_HEADING}`]) {
      const r = score(transcript([{ assistant: `See (corpus:${DOC} § ${written}).` }]));
      expect(r.verdict, `expected "${written}" to resolve`).toBe("pass");
    }
  });

  // Scenario: An id outside the corpus is left to the id check
  it("ignores a token whose id is absent from the corpus", () => {
    const r = score(transcript([{ assistant: "See (corpus:assessment-991 § Rubric construction)." }]));
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).toContain("no token naming a corpus document");
    // …and the id failure is reported by the check that owns it.
    const idCheck = checkDeterministic(
      cp("cite_none_outside_corpus"),
      transcript([{ assistant: "See (corpus:assessment-991 § Rubric construction)." }]),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(idCheck.verdict).toBe("fail");
    expect(idCheck.reasoning).toContain("assessment-991");
  });

  it("passes a transcript that emits no token at all", () => {
    const r = score(transcript([{ assistant: "The corpus does not carry that." }]));
    expect(r.verdict).toBe("pass");
  });

  it("is not-assessable rather than vacuously green when no headings were loaded", () => {
    // A check that passes every token by ignoring it is a placebo; say so instead.
    const r = score(transcript([{ assistant: `See (corpus:${DOC}).` }]), new Map());
    expect(r.verdict).toBe("not-assessable");
  });

  it("reads a section whose label carries parentheses without truncating at the inner paren", () => {
    // `cbe_cite` emits this form when the document's heading has parentheses; the
    // canonical regex does not match it, so a check reusing that regex would misread it.
    const heading = CORPUS_HEADINGS.get(DOC)!.find((h) => h.includes("(")) ?? null;
    if (heading === null) {
      // No such heading in the current corpus — assert the negative direction instead,
      // which is the one that would silently pass on a truncated read.
      const r = score(transcript([{ assistant: `See (corpus:${DOC} § Made Up (Nonsense)).` }]));
      expect(r.verdict).toBe("fail");
      expect(r.reasoning).toContain("Made Up (Nonsense)");
      return;
    }
    expect(score(transcript([{ assistant: `See (corpus:${DOC} § ${heading}).` }])).verdict).toBe("pass");
  });
});

describe("the modified citation requirements — the route is not graded", () => {
  const readOf = (id: string) => ({
    name: "read",
    callId: "r1",
    args: { path: CORPUS_PATHS.get(id)! },
    isError: false as const,
  });

  // cbe-skill-eval-harness, *Citation Provenance Is Checked Deterministically*,
  // Scenario: A hand-written token passes when the document was read
  it("cite_provenance passes a hand-written token whose document was read", () => {
    const t = transcript([
      {
        assistant: `Grounded here (corpus:${DOC} § ${REAL_HEADING}, Kolb 1984).`,
        tools: [readOf(DOC)],
        events: [
          { type: "tool_start", name: "read", callId: "r1", args: { path: CORPUS_PATHS.get(DOC)! } },
          { type: "tool_end", name: "read", callId: "r1", result: "body", isError: false },
          { type: "text", text: `Grounded here (corpus:${DOC} § ${REAL_HEADING}, Kolb 1984).` },
        ],
      },
    ]);
    expect(t.turns[0]!.tools.some((x) => x.name === "cbe_cite")).toBe(false);
    const r = checkDeterministic(cp("cite_provenance"), t, probe(), CORPUS_IDS, CORPUS_PATHS, CORPUS_HEADINGS);
    expect(r.verdict).toBe("pass");
  });

  // cbe-skill-eval-harness, *A Sham Citation Is Caught Deterministically*,
  // Scenario: A read of the document exempts an attribution
  it("cite_no_sham_attribution passes an attribution the session read", () => {
    const t = transcript([
      {
        assistant: `Die Herleitung steht dort (${DOC}).`,
        tools: [readOf(DOC)],
      },
    ]);
    const r = checkDeterministic(cp("cite_no_sham_attribution"), t, probe(), CORPUS_IDS, CORPUS_PATHS, CORPUS_HEADINGS);
    expect(r.verdict).toBe("pass");
  });

  it("cite_no_sham_attribution still fails an attribution with neither a token nor a read", () => {
    const t = transcript([{ assistant: `Die Herleitung steht dort (${DOC}).` }]);
    const r = checkDeterministic(cp("cite_no_sham_attribution"), t, probe(), CORPUS_IDS, CORPUS_PATHS, CORPUS_HEADINGS);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain(DOC);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The BOUNDARY between the two checks — one behaviour, one finding.
//
// In the n=3 run of 2026-08-10 `6d` and `6g` both fired on the same two tokens,
// `(corpus:methodology-005)` and `(corpus:methodology-003)`, while `6a` passed 12/12: the
// documents HAD been read and nothing was shammed. The sham check's two stated reasons for
// owning a malformed token are both false for the bare form — the renderer linkifies it and
// `cite_provenance` matches it — so the bare token is a MISSING SECTION and belongs here.
//
// spec: cbe-skill-eval-harness, *A Sham Citation Is Caught Deterministically*,
//       Scenario: A bare section-less token is left to the section check
// ─────────────────────────────────────────────────────────────────────────────

describe("the bare token belongs to cite_section_resolves, not to cite_no_sham_attribution", () => {
  const readOf = (id: string) => ({
    name: "read",
    callId: "r1",
    args: { path: CORPUS_PATHS.get(id)! },
    isError: false as const,
  });
  const BARE = `(corpus:${DOC})`;
  const bareTranscript = (tools: TurnTranscript["tools"] = []) =>
    transcript([{ assistant: `CBL trennt Engage, Investigate und Act ${BARE}.`, tools }]);

  it("is failed by cite_section_resolves, naming the missing section", () => {
    const r = score(bareTranscript([readOf(DOC)]));
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("cited with no § section");
  });

  it("is ignored by cite_no_sham_attribution when the document was read", () => {
    const r = checkDeterministic(
      cp("cite_no_sham_attribution"),
      bareTranscript([readOf(DOC)]),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(r.verdict).toBe("pass");
    expect(r.reasoning).not.toContain("malformed citation token");
  });

  it("is ignored by cite_no_sham_attribution even without a read — cite_provenance owns that", () => {
    const sham = checkDeterministic(
      cp("cite_no_sham_attribution"),
      bareTranscript(),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(sham.verdict).toBe("pass");
    const provenance = checkDeterministic(
      cp("cite_provenance"),
      bareTranscript(),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(provenance.verdict).toBe("fail");
    expect(provenance.reasoning).toContain("cited without a prior read");
  });

  it("keeps failing the comma-form hand-written string, which is not bare", () => {
    const handWritten = `(corpus:${DOC}, "Was CBE ausmacht" / "Abgrenzung")`;
    const r = checkDeterministic(
      cp("cite_no_sham_attribution"),
      transcript([{ assistant: `Die Abgrenzung steht dort ${handWritten}.`, tools: [readOf(DOC)] }]),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("malformed citation token");
  });

  it("keeps failing a bare token whose id is NOT in the corpus — that is a fabricated id", () => {
    const r = checkDeterministic(
      cp("cite_no_sham_attribution"),
      transcript([{ assistant: "Belegt in (corpus:assessment-991)." }]),
      probe(),
      CORPUS_IDS,
      CORPUS_PATHS,
      CORPUS_HEADINGS
    );
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("malformed citation token");
  });
});
