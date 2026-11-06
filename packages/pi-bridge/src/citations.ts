import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { extractHeadings } from "./citation-verification.js";

export interface CitationHit {
  id: string;
  title: string;
  path: string;
  category?: string;
  version?: string;
  tags: string[];
}

/** A structured source entry from a corpus document's `sources[]` frontmatter.
 * `year` is `null` when the frontmatter omits a year, so the citation tool can
 * emit the explicit `n.d.` marker rather than a fabricated placeholder. */
export interface CitationSource {
  author: string;
  year: number | null;
  title: string;
  /** Stable source identifier — the wiki-wins precedence rule (capability
   * `cbe-skill`, Requirement: Citation Grounding) matches wiki atoms and corpus
   * documents on this URL. Null when the corpus source carries none. */
  url: string | null;
}

export interface CitationResolver {
  /** The loaded corpus version (`YYYY-MM`) from the manifest's `corpus-version`.
   * The corpus is purely versioned content; this is the authoritative currency
   * the skill surfaces once per session and the app shows in the citation detail. */
  getVersion(): string;
  resolve(id: string): CitationHit | null;
  parseCitations(text: string): Array<{ id: string; raw: string }>;
  /** The document's RAW file text, frontmatter included — this is a faithful loader, not
   * a display accessor. `resolveSources` and `resolveHeadings` both need the
   * frontmatter, so it stays in. A consumer that renders the document for a human
   * strips it on its own side of the boundary (the app does so in
   * `main/citation-body.ts`). */
  loadBody(id: string): Promise<string | null>;
  /** The document's `sources[]` frontmatter entries (author/year/title). Used by
   * the `cbe_cite` tool's source gate. Returns `[]` for an unknown id. */
  resolveSources(id: string): Promise<CitationSource[]>;
  /** The document body's Markdown headings (`#`..`######`), heading text trimmed.
   * Used by the `cbe_cite` tool's section gate. Returns `[]` for an unknown id. */
  resolveHeadings(id: string): Promise<string[]>;
  /** All corpus ids in the loaded index, in manifest order. Used to source
   * `/cite` argument completions (capability `desktop-app`, Slash Commands). */
  listIds(): string[];
}

/** The raw `documents[]` entry shape in the index manifest. */
interface IndexDoc {
  id: string;
  title: string;
  path: string;
  category?: string;
  version?: string;
  tags: string[];
}

interface IndexShape {
  "corpus-version"?: string;
  documents: IndexDoc[];
}

// Matches tokens like (corpus:methodology-001 § 1, …) — captures the id
const CITATION_RE = /\(corpus:([a-z0-9]+(?:-[a-z0-9]+)*)(?:[^)]*)\)/g;

/**
 * The bundled corpus source provider: reads the corpus from a filesystem base
 * path (the packaged app's resource directory / the environment descriptor's
 * `paths.corpus`) with no network access. A future CDN provider satisfies the
 * same `CitationResolver` shape over `fetch()` + cache. See `corpus-curation`
 * Requirement: Swappable corpus source provider.
 */
export async function createCitationResolver(corpusRoot: string): Promise<CitationResolver> {
  const indexPath = path.join(corpusRoot, "index.json");
  const idx = JSON.parse(await readFile(indexPath, "utf8")) as IndexShape;
  const byId = new Map(idx.documents.map((d) => [d.id, d] as const));
  const corpusVersion = idx["corpus-version"] ?? "unknown";

  // Shared by loadBody / resolveSources / resolveHeadings — declared as a local
  // so the resolver methods don't depend on `this` (which typebox/TS widens to
  // the not-yet-constructed resolver type inside the object literal).
  async function readBody(id: string): Promise<string | null> {
    const hit = byId.get(id);
    if (!hit) return null;
    // hit.path is corpus-root-relative (e.g. "dev/methodology/cbl-three-phase-framework.md");
    // resolution is strictly <corpusRoot>/<hit.path> — no legacy fallback, so a stale
    // repo-root-relative index fails loudly instead of being silently compensated.
    // See corpus-curation, Scenario: Manifest paths resolve against the corpus root.
    return readFile(path.join(corpusRoot, hit.path), "utf8");
  }

  return {
    getVersion() {
      return corpusVersion;
    },

    resolve(id) {
      const doc = byId.get(id);
      if (!doc) return null;
      return { ...doc };
    },

    listIds() {
      return idx.documents.map((d) => d.id);
    },

    parseCitations(text) {
      const out: Array<{ id: string; raw: string }> = [];
      for (const m of text.matchAll(CITATION_RE)) {
        out.push({ id: m[1]!, raw: m[0]! });
      }
      return out;
    },

    async loadBody(id) {
      return readBody(id);
    },

    async resolveSources(id) {
      const raw = await readBody(id);
      if (raw == null) return [];
      // Reuse gray-matter (the same YAML dependency the corpus-schema validator
      // uses) rather than introducing a second parser. The schema guarantees
      // `sources[]` exists with author/year/title, but we stay defensive here.
      const data = matter(raw).data as { sources?: unknown };
      const list = Array.isArray(data.sources) ? data.sources : [];
      return list.map((s) => {
        const src = (s ?? {}) as { author?: unknown; year?: unknown; title?: unknown; url?: unknown };
        return {
          author: typeof src.author === "string" ? src.author : "",
          year: typeof src.year === "number" ? src.year : null,
          title: typeof src.title === "string" ? src.title : "",
          url: typeof src.url === "string" && src.url.length > 0 ? src.url : null,
        };
      });
    },

    async resolveHeadings(id) {
      const raw = await readBody(id);
      if (raw == null) return [];
      // Strip the frontmatter so a `#`-prefixed line inside it can't be mistaken
      // for a heading, then delegate to the SHARED extractor — the same one the
      // host's token verification uses, so the two can never diverge (capability
      // `citation-tool`, Requirement: *The Section Gate Is a Shared,
      // Separately-Importable Verifier*).
      return extractHeadings(matter(raw).content);
    },
  };
}
