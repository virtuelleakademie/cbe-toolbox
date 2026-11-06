/**
 * Wiki-wins precedence support (capability `cbe-skill`, Requirement: Citation
 * Grounding — Scenario: Wiki atom wins when both stores share the same source).
 *
 * The lecturer's own atomization of a source is higher-weighted than the
 * corpus's curated version of that source: when a wiki atom's `sources[]`
 * shares a `url` with a corpus document's `sources[]`, the wiki atom wins for
 * that retrieval step and the citation uses the `wiki:` scheme.
 *
 * This module is the deterministic retrieval-stage half: it scans the active
 * course's wiki for source URLs so the `cbe_cite` gate can refuse a
 * `(corpus:…)` token for a wiki-covered source and point the model at the
 * lecturer's atom instead. The stores stay isolated at the data layer — this
 * lookup reads both sides but writes no cross-references anywhere.
 */
import path from "node:path";
import { validateDirectory, type WikiAtom } from "@cbe/corpus-schema";
import { readWikiIndex } from "./wiki-index.js";

export interface WikiPrecedenceHit {
  /** Wiki-relative atom path, e.g. `concept/cognitive-load.md`. */
  atomRelPath: string;
  /**
   * The atom id used in the `wiki:` citation scheme — the WIKI-RELATIVE id the index
   * writes (`concept/cognitive-load`), not the bare filename.
   *
   * It was the bare stem until `cite-the-lecturers-wiki`, which is a form nothing else
   * in the product accepts: `cbe_wiki` selects by wiki-relative id and `cbe_cite`'s wiki
   * route resolves against the same index. A refusal that names an id the next call
   * refuses is an instruction the model cannot follow.
   */
  atomId: string;
  /** The shared source URL that triggered the precedence. */
  url: string;
}

/** Lookup the cite gate calls per corpus-citation attempt: given the corpus
 * document's source URLs, return the covering wiki atom (or null). */
export type WikiPrecedenceLookup = (corpusSourceUrls: readonly string[]) => Promise<WikiPrecedenceHit | null>;

function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Scan a course wiki for atoms and the source URLs they carry. Invalid files
 * are skipped — they are surfaced by the validator/lint elsewhere. */
export async function scanWikiSourceUrls(
  wikiDir: string
): Promise<Array<{ atomRelPath: string; atomId: string; urls: string[] }>> {
  let results;
  try {
    results = await validateDirectory(wikiDir, "wiki");
  } catch {
    return [];
  }
  const entries: Array<{ atomRelPath: string; atomId: string; urls: string[] }> = [];
  for (const r of results) {
    if (!r.ok) continue;
    const atom = r.doc as WikiAtom;
    const urls = atom.sources.map((s) => s.url).filter((u): u is string => typeof u === "string" && u.length > 0);
    if (urls.length === 0) continue;
    const atomRelPath = path.relative(wikiDir, r.path).split(path.sep).join("/");
    entries.push({
      atomRelPath,
      atomId: atomRelPath.replace(/\.md$/i, ""),
      urls: urls.map(normaliseUrl),
    });
  }
  return entries;
}

/**
 * Build the precedence lookup for one course wiki. The wiki is rescanned per
 * call (atoms may be ingested mid-session); course wikis are small Markdown
 * trees, so the rescan is cheap. Absent/empty wiki → never a hit.
 *
 * EXISTENCE IS OWNED BY THE INDEX, not by the directory walk. The scan finds atoms
 * on disk; `readWikiIndex` decides which of them the product accepts as citable, and
 * `cbe_cite`'s wiki route resolves against that same read. A disk-only atom — an
 * atomization run that wrote the file but not the index entry, or a hand-added file —
 * therefore produces NO hit: the corpus token is emitted normally, so the model always
 * has one route it can take. Filtering here rather than at the refusal is what keeps the
 * two sides from drifting: a hit named by this lookup is by construction an id
 * `resolveAtom` resolves through its exact-id branch. A missing index entry is
 * `wiki-lint`'s index-completeness concern, never a reason to strand the model with a
 * refused corpus token and a wiki id the next call also refuses.
 */
export function createWikiPrecedenceLookup(wikiDir: string | undefined): WikiPrecedenceLookup {
  return async (corpusSourceUrls) => {
    if (!wikiDir || corpusSourceUrls.length === 0) return null;
    const index = await readWikiIndex(wikiDir);
    if (!index.present || index.atomIds.length === 0) return null;
    const carried = new Set(index.atomIds);
    const wanted = new Set(corpusSourceUrls.map(normaliseUrl));
    const entries = await scanWikiSourceUrls(wikiDir);
    for (const entry of entries) {
      if (!carried.has(entry.atomId)) continue;
      const shared = entry.urls.find((u) => wanted.has(u));
      if (shared) return { atomRelPath: entry.atomRelPath, atomId: entry.atomId, url: shared };
    }
    return null;
  };
}
