/**
 * `cbe_cite` — a deterministic, read-only tool that returns the canonical citation
 * token from citation *intent*, for the corpus AND for the lecturer's own wiki. See
 * capability `citation-tool`.
 *
 * Unlike `cbe_picker`, this tool is NOT deferred: its
 * `execute()` returns the real result synchronously (the token, or a structured
 * refusal). There is no UI roundtrip — it is a pure lookup over the loaded corpus
 * through a `CitationResolver`.
 *
 * The model supplies only intent (id, section, optional author/year/claim); the
 * tool assembles the bare token `(corpus:<id> § <section>, <author year>)` from
 * corpus ground truth — no authority suffix or status marker of any kind, because
 * the corpus is purely versioned content (every document in the loaded version is
 * authoritative for that version). Three validation gates run before any token is
 * emitted (id existence, section-heading match, source author/year match); on any
 * failure the tool returns a structured refusal and NEVER a malformed or partial
 * token. This moves the canonical elements out of the model's recall and under
 * deterministic control.
 *
 * THE STORE RIDES ON THE `id` (capability `citation-tool`, Requirement: *Citation Tool
 * Produces a Wiki Citation Validated Against the Wiki Index*). A bare id names a corpus
 * document; an id prefixed `wiki:` names an atom of the active course's wiki and yields
 * `(wiki:<atomId> § <section>, <author year>)`, validated against the wiki index and the
 * atom's own headings and `sources[]`. The SAME gates run for both — only the ground
 * truth they consult differs — because a second citation tool, or a second section
 * matcher, is two places the two routes can drift apart. Before this route existed the
 * tool told the model to cite a wiki atom with the `wiki:` scheme and gave it no way to
 * produce that token; the only route left was writing it by hand, which is how the
 * lecturer gets a precise-looking reference that resolves to nothing.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { CitationResolver, CitationSource } from "./citations.js";
import type { WikiPrecedenceLookup } from "./wiki-retrieval.js";
import type { WikiCitationResolver } from "./wiki-citation.js";
// Gate 2 is expressed in terms of the SHARED verifier so the tool and the host can
// never disagree about whether a section names a real heading (capability
// `citation-tool`, Requirement: *The Section Gate Is a Shared, Separately-Importable
// Verifier*). The tool owns no normalisation of its own.
import { matchSectionHeading } from "./citation-verification.js";

const CiteParamsSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    description:
      "What the claim is grounded in: a corpus document id (e.g. `methodology-001`), checked against corpus/index.json — or, for the lecturer's own material, a wiki atom id prefixed `wiki:` (e.g. `wiki:concept/cognitive-load`), checked against the wiki index.",
  }),
  section: Type.String({
    minLength: 1,
    description:
      "The section heading the claim is grounded in (e.g. `Phase 1: Engage`). Must match a heading in the document body; the tool returns the document's actual headings if it does not.",
  }),
  author: Type.Optional(
    Type.String({
      description:
        "Which source within the document, by author (e.g. `Nichols, M., Cator, K., and Torres, M.`). Omit when the document has a single source; supply it to disambiguate a multi-source document.",
    })
  ),
  year: Type.Optional(
    Type.Number({
      description: "The source's publication year, used together with `author` to pick the right `sources[]` entry.",
    })
  ),
  claim: Type.Optional(
    Type.String({
      description:
        "Optional — the sentence being grounded, recorded in the session log for traceability. Does not affect the token.",
    })
  ),
});

export type CiteToolParams = Static<typeof CiteParamsSchema>;

// Exported for the schema-contract unit tests.
export { CiteParamsSchema };

function normaliseAuthor(a: string): string {
  return a.trim().toLowerCase();
}

/** `<author> <year>` element — the year is the four-digit number, or the literal
 * `n.d.` ONLY when the source frontmatter carries no year. Never a placeholder. */
function authorYear(src: CitationSource): string {
  return `${src.author} ${src.year ?? "n.d."}`;
}

/** Candidate rendering for refusals/disambiguation: `<author year> — <title>`. The
 * title is the ONLY field that distinguishes sources sharing an author+year, so it MUST
 * be shown in the prose the model reads (the canonical token itself never carries it). */
function authorYearTitle(src: CitationSource): string {
  return src.title ? `${authorYear(src)} — ${src.title}` : authorYear(src);
}

/** The atom ids the index carries, rendered for a refusal. Bounded so a large wiki does
 * not turn one mistyped id into a wall of text; the full list stays in `details`. */
function knownAtomsLine(atomIds: readonly string[]): string {
  if (atomIds.length === 0) return "The index carries no atoms.";
  const shown = atomIds.slice(0, 20);
  const rest = atomIds.length - shown.length;
  return `The index carries: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

function textResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

/**
 * Build the `cbe_cite` tool bound to a corpus resolver, the wiki-precedence lookup and
 * the wiki citation resolver. A `null` corpus resolver means no corpus is loaded in this
 * profile; every bare-id call then refuses with `unknown-id`. An absent
 * `wikiCitations` (or a course with no wiki) means every `wiki:` call refuses with
 * `no-wiki`. Either way the tool stays REGISTERED, so the prompt surface is uniform
 * across profiles — capability `agent-harness`, Requirement: Tool Allowlist Excluding
 * Shell Execution.
 */
export function createCiteTool(
  resolver: CitationResolver | null,
  wikiPrecedence?: WikiPrecedenceLookup,
  wikiCitations?: WikiCitationResolver
) {
  return defineTool({
    name: "cbe_cite",
    label: "Cite",
    description:
      "Return the canonical citation token for a claim you have grounded in a document or wiki atom you READ this session — CHECKED against that document, which is what this call buys you. Supply the id, the section the claim sits in, and (for a multi-source document) the source author/year. WHAT THE CHECK COVERS: the section is matched against the document's REAL headings, so a heading you half-remember is caught before the lecturer sees it; and the <author year> element is taken from the document's own sources, so it is never yours to supply from memory — pass `year` only together with `author` to pick one source of a multi-source document, never to assert a year or as a placeholder. Paste the returned token verbatim. ONE SECTION PER TOKEN: a claim resting on two sections needs two calls and yields two tokens. The token carries no suffix and no status marker; do not add one. A REFUSAL IS AN INSTRUCTION, NOT AN ERROR MESSAGE: it returns the document's real headings or sources — CORRECT YOUR INTENT from them and re-call, and never present a claim as corpus-grounded whose token the tool declined.",
    promptSnippet:
      "Use cbe_cite(id, section, author?, year?, claim?) to obtain a citation token — corpus, or a `wiki:` atom of the lecturer's own wiki — checked against the real headings and sources; paste the returned token verbatim.",
    // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app — pi's
    // `buildSystemPrompt` returns early on its `customPrompt` branch, which
    // `startCbeSession` always takes. Kept accurate for hosts on pi's default
    // prompt; every binding rule lives in `description` / parameter descriptions.
    promptGuidelines: [
      "Call cbe_cite to have a citation checked against the document's real headings and sources, and use the token it returns verbatim.",
      "Call cbe_cite once per section: a claim grounded in two sections needs two calls and yields two tokens.",
      "Omit author/year for a single-source document; supply them only to pick one source of a multi-source document.",
      "If cbe_cite refuses (unknown id / section / source), correct your intent from the headings, sources or atom ids it returns — do not emit an unverified token.",
    ],
    parameters: CiteParamsSchema,
    async execute(_toolCallId, params: CiteToolParams) {
      const { id, section, author, year, claim } = params;

      // WHICH STORE. The prefix is part of the id the model writes and part of the token
      // it gets back, so one vocabulary covers the parameter and the output. A bare id
      // stays corpus, which is why every call site written before the wiki route is
      // unaffected.
      const trimmedId = id.trim();
      const isWiki = /^wiki:/i.test(trimmedId);
      const ref = isWiki ? trimmedId.slice("wiki:".length).trim() : trimmedId;

      // Gate 1 — id existence, in whichever store the id names. Both branches resolve to
      // the SAME store-neutral shape, so gates 2 and 3 below are written once.
      let store: "corpus" | "wiki";
      let resolvedId: string;
      let headings: string[];
      let sources: CitationSource[];

      if (isWiki) {
        const lookup = (await wikiCitations?.resolveAtom(ref)) ?? { ok: false as const, reason: "no-wiki" as const };
        if (!lookup.ok) {
          if (lookup.reason === "no-wiki") {
            return textResult(
              `This course has no wiki index, so it carries no atom to cite. Say that the lecturer's own material does not cover this, rather than citing it.`,
              { kind: "citation-refusal", error: "no-wiki", id: trimmedId }
            );
          }
          if (lookup.reason === "ambiguous") {
            return textResult(
              `Several wiki atoms are named "${ref}": ${lookup.candidates.join(", ")}. Re-call cbe_cite with the full wiki-relative id of the one you read.`,
              { kind: "citation-refusal", error: "ambiguous-atom", id: trimmedId, candidates: lookup.candidates }
            );
          }
          return textResult(
            `No wiki atom with id "${ref}". A citation cannot be produced for an id the wiki index does not carry. ${knownAtomsLine(lookup.candidates)} Re-call cbe_cite with an id from the index.`,
            { kind: "citation-refusal", error: "unknown-atom", id: trimmedId, candidates: lookup.candidates }
          );
        }
        store = "wiki";
        // The INDEX's spelling, never the model's — the same principle that puts the
        // document's own heading into the token rather than the section as typed.
        resolvedId = lookup.atom.id;
        headings = lookup.atom.headings;
        sources = lookup.atom.sources;
      } else {
        const hit = resolver?.resolve(ref) ?? null;
        if (!hit) {
          const candidates = resolver?.listIds() ?? [];
          return textResult(
            `No corpus document with id "${ref}". A citation cannot be produced for an id that is not in corpus/index.json. Closest known ids: ${candidates.slice(0, 8).join(", ") || "(none)"}. Re-call cbe_cite with a real id.`,
            { kind: "citation-refusal", error: "unknown-id", id: ref, candidates }
          );
        }
        store = "corpus";
        resolvedId = hit.id;
        headings = await resolver!.resolveHeadings(hit.id);
        sources = await resolver!.resolveSources(hit.id);
      }

      /** How the store's material is named back to the model — and exactly the token's
       * leading element, so a refusal and the token it eventually replaces agree. */
      const label = `${store}:${resolvedId}`;

      // Gate 2 — section-heading match (normalised). One matcher for both stores; a
      // second one is the drift capability `citation-tool` forbids.
      const matchedHeading = matchSectionHeading(section, headings);
      if (!matchedHeading) {
        return textResult(
          `Section "${section}" matches no heading in ${label}. Actual headings: ${headings.join(" | ") || "(none)"}. Re-call cbe_cite with one of these section headings.`,
          { kind: "citation-refusal", error: "unknown-section", store, id: resolvedId, headings }
        );
      }

      // WIKI-WINS PRECEDENCE (capability `cbe-skill`, Requirement: Citation
      // Grounding): when the lecturer's wiki carries an atom whose sources[]
      // shares a URL with this corpus document, the wiki atom wins — the tool
      // refuses the corpus token and points at the `wiki:` route instead, so
      // the lecturer sees their own material being referenced. Corpus-side only:
      // a wiki citation cannot be outranked by the store it already names.
      if (store === "corpus" && wikiPrecedence) {
        const urls = sources.map((s) => s.url).filter((u): u is string => typeof u === "string" && u.length > 0);
        const hit = await wikiPrecedence(urls).catch(() => null);
        if (hit) {
          // The refusal names the CALL, not only the token's shape: an instruction to
          // produce a token with no route behind it leaves hand-writing as the only
          // way to obey it, which is the failure this route exists to remove. The id
          // named here is one `cbe_cite` resolves BY CONSTRUCTION, not by convention:
          // the lookup and the wiki route derive existence from the same
          // `readWikiIndex` read, so an atom the index does not carry never becomes a
          // hit at all and this branch cannot name it (capability `citation-tool`,
          // Requirement: *Citation Tool Produces a Wiki Citation Validated Against the
          // Wiki Index*).
          return textResult(
            `Wiki-wins precedence: the lecturer's own wiki atom \`${hit.atomRelPath}\` covers the same source ` +
              `(${hit.url}) as corpus:${resolvedId}. Read that atom for this retrieval step instead of the corpus ` +
              `document, ground the claim in it, and call cbe_cite again with \`id: "wiki:${hit.atomId}"\` and the ` +
              `section it is grounded in — the token it returns is \`(wiki:${hit.atomId} § <section>, <author year>)\`, ` +
              `so the lecturer can recognise their own material. Do not emit a (corpus:${resolvedId} …) token for this source.`,
            { kind: "wiki-precedence", id: resolvedId, atomRelPath: hit.atomRelPath, atomId: hit.atomId, url: hit.url }
          );
        }
      }
      const authorGiven = typeof author === "string" && author.trim().length > 0;
      const yearGiven = typeof year === "number";

      // Source-less tolerance — material with no citable source is still citable; the
      // token simply omits the <author year> element. No marker is appended. On the wiki
      // side this also covers an atom whose sources carry no `author` at all, which is
      // what an ordinary ingestion produces (see `wiki-citation.ts`).
      if (sources.length === 0) {
        const token = `(${label} § ${matchedHeading})`;
        return textResult(token, {
          kind: "citation",
          store,
          id: resolvedId,
          section: matchedHeading,
          ...(typeof claim === "string" && claim.length > 0 ? { claim } : {}),
        });
      }

      // Filter to the source pool the model named (or all sources when none named).
      const pool =
        authorGiven || yearGiven
          ? sources.filter(
              (s) =>
                (!authorGiven || normaliseAuthor(s.author) === normaliseAuthor(author!)) &&
                (!yearGiven || s.year === year)
            )
          : sources;

      if (pool.length === 0) {
        return textResult(
          `No source in ${label} matches author="${author ?? ""}"${yearGiven ? ` year=${year}` : ""}. Candidate sources: ${sources.map(authorYearTitle).join(" | ") || "(none)"}. Re-call cbe_cite with an author/year drawn from these.`,
          { kind: "citation-refusal", error: "unknown-source", store, id: resolvedId, candidates: sources }
        );
      }

      // The canonical token encodes only `<author year>`, so sources sharing an author+year
      // are citation-equivalent — every token they could produce is byte-identical. Resolve
      // such a pool directly (the output is determined, not a guess). Ask for disambiguation
      // ONLY when the pool would yield genuinely different tokens.
      const distinctTokens = new Set(pool.map(authorYear));
      if (distinctTokens.size > 1) {
        const underSpecified = !authorGiven && !yearGiven;
        return textResult(
          underSpecified
            ? `${label} has multiple sources; cbe_cite needs to know which one grounds this claim. Candidate sources: ${pool.map(authorYearTitle).join(" | ")}. Re-call cbe_cite supplying the chosen author/year.`
            : `Several sources in ${label} match the supplied author/year and would produce different citations. Candidate sources: ${pool.map(authorYearTitle).join(" | ")}. Re-call cbe_cite with the distinguishing author/year.`,
          { kind: "needs-disambiguation", store, id: resolvedId, candidates: pool }
        );
      }
      const chosen: CitationSource = pool[0]!;

      // Bare canonical token — no suffix, no status marker (versioned content).
      const token = `(${label} § ${matchedHeading}, ${authorYear(chosen)})`;
      return textResult(token, {
        kind: "citation",
        store,
        id: resolvedId,
        section: matchedHeading,
        author: chosen.author,
        year: chosen.year,
        ...(typeof claim === "string" && claim.length > 0 ? { claim } : {}),
      });
    },
  });
}
