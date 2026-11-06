/**
 * Wiki-side citation ground truth — what `cbe_cite` validates a `wiki:` citation
 * against (capability `citation-tool`, Requirement: *Citation Tool Produces a Wiki
 * Citation Validated Against the Wiki Index*).
 *
 * Deliberately a sibling of `wiki-retrieval.ts` rather than part of it: that module
 * scans the whole wiki for source URLs to answer the precedence question, this one
 * answers a different question about ONE atom — does the index carry it, what are its
 * headings, what are its sources. Same store, different shape.
 *
 * Two reuses carry the invariants that matter:
 *
 *   - Atom existence is read from `readWikiIndex` (`wiki-index.ts`), the same index
 *     `cbe_wiki` serves and selects against, so the set a citation may name and the set
 *     a retrieval may fetch are derived from one place and cannot drift apart.
 *   - The atom is parsed with the SHARED validator (`validateFile(path, "wiki")`), one
 *     engine for both stores (capability `lecturer-wiki`, Requirement: Validator
 *     Alignment with the Corpus Schema Discipline), which yields the frontmatter
 *     `sources[]` and the body the headings come out of in one pass.
 */
import { validateFile } from "@cbe/corpus-schema";
import type { CitationSource } from "./citations.js";
import { extractHeadings } from "./citation-verification.js";
import { normaliseAtomId, readWikiIndex, resolveAtomPath } from "./wiki-index.js";

/** One atom, resolved: the id the INDEX writes (never the model's spelling), plus the
 * two things the citation gates need. */
export interface WikiCitationAtom {
  id: string;
  headings: string[];
  sources: CitationSource[];
}

/** Why an atom reference produced no citation. `no-wiki` is a different answer from
 * `unknown` and must stay distinguishable: listing candidate ids for a course that has
 * no wiki at all would invite the model to keep guessing at an empty set. */
export type WikiCitationLookup =
  | { ok: true; atom: WikiCitationAtom }
  | { ok: false; reason: "no-wiki" }
  | { ok: false; reason: "unknown"; candidates: string[] }
  | { ok: false; reason: "ambiguous"; candidates: string[] };

export interface WikiCitationResolver {
  /** Every atom id the course's index carries, as the index writes them. */
  listAtomIds(): Promise<string[]>;
  /** Resolve one `wiki:` id to its atom, or say why it could not be resolved. */
  resolveAtom(atomId: string): Promise<WikiCitationLookup>;
}

/** The last path segment of a wiki-relative id — `concept/cognitive-load` → `cognitive-load`. */
function basename(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/**
 * A wiki source rendered as the citation model's source entry. `author` is OPTIONAL on
 * a wiki atom (capability `lecturer-wiki`, Requirement: Atom Frontmatter Schema) — an
 * ordinary ingestion registers a source with its filename as `title` and nothing else —
 * so a source without one cannot populate the `<author year>` element and is dropped
 * here. The tool then emits the element-less token, exactly as it does for a corpus
 * document with no `sources[]` at all: a missing field is a first-class state in this
 * store, never a reason to make the lecturer's own material uncitable.
 */
function citableSources(sources: ReadonlyArray<{ author?: string; year?: number; title: string; url?: string }>) {
  const out: CitationSource[] = [];
  for (const s of sources) {
    if (typeof s.author !== "string" || s.author.trim().length === 0) continue;
    out.push({
      author: s.author,
      year: typeof s.year === "number" ? s.year : null,
      title: s.title,
      url: typeof s.url === "string" ? s.url : null,
    });
  }
  return out;
}

/**
 * Build the citation resolver for one course wiki. The index is re-read per call (an
 * ingestion may land atoms mid-session, and the gate that forces a re-read of the index
 * for RETRIEVAL does not run here); course wikis are small Markdown trees.
 *
 * An undefined `wikiDir` yields a resolver that always answers `no-wiki`, so the tool
 * stays registered and uniform across profiles and the refusal says what is actually
 * the case.
 */
export function createWikiCitationResolver(wikiDir: string | undefined): WikiCitationResolver {
  return {
    async listAtomIds() {
      const index = await readWikiIndex(wikiDir);
      return index.atomIds;
    },

    async resolveAtom(atomId) {
      const index = await readWikiIndex(wikiDir);
      if (!wikiDir || !index.present || index.atomIds.length === 0) return { ok: false, reason: "no-wiki" };

      const wanted = normaliseAtomId(atomId);
      // Exact wiki-relative id first — the form the index writes and `cbe_wiki` takes.
      // Only when that misses does the basename fallback run, so an id that is BOTH a
      // full id and another atom's basename resolves to itself rather than to an
      // ambiguity.
      let resolvedId = index.atomIds.find((id) => id === wanted) ?? null;
      if (!resolvedId) {
        // A bare filename is what the wiki skill's own `[[wikilinks]]` use and what every
        // `(wiki:…)` token emitted before this route existed carried. One match is
        // determined, not guessed; several is a real ambiguity the model must settle.
        const byBase = index.atomIds.filter((id) => basename(id) === wanted);
        if (byBase.length === 1) resolvedId = byBase[0]!;
        else if (byBase.length > 1) return { ok: false, reason: "ambiguous", candidates: byBase };
      }
      if (!resolvedId) return { ok: false, reason: "unknown", candidates: index.atomIds };

      const target = resolveAtomPath(wikiDir, resolvedId);
      // Unreachable: `atomIdsFromIndex` only advertises ids that pass the same policy.
      if (!target.ok) return { ok: false, reason: "unknown", candidates: index.atomIds };

      const parsed = await validateFile(target.path, "wiki");
      // An unreadable or invalid atom is reported as an unresolvable id rather than as a
      // schema error: the model can only act on the id list, and the validator/lint layer
      // is where an invalid atom is surfaced to the lecturer.
      if (!parsed.ok) return { ok: false, reason: "unknown", candidates: index.atomIds };

      return {
        ok: true,
        atom: {
          id: resolvedId,
          headings: extractHeadings(parsed.body ?? ""),
          sources: citableSources(parsed.doc.sources),
        },
      };
    },
  };
}
