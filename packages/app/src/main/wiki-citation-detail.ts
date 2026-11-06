import { normaliseAtomId, readAtomBody, readWikiIndex, resolveAtomPath } from "@cbe/pi-bridge/wiki-index";
import { citationMarkdownBody } from "./citation-body.js";
import { WIKI_CITATION_PREFIX, type WikiCitationDetail } from "../shared/ipc-contract.js";

/**
 * The wiki branch of the `loadCitation` channel (capability `desktop-app`, Requirement:
 * *A Wiki Citation Token Renders as the Same Citation Link and Opens the Shared Overlay
 * Unverified*): resolve a store-qualified `wiki:<atomId>` id against one course wiki and
 * hand back the overlay payload — the atom's title plus its frontmatter-stripped
 * Markdown body. `null` for anything that cannot be served (unknown atom, absent or
 * empty index, unreadable file); the overlay's existing not-found state covers it.
 *
 * Resolution mirrors the citation store everywhere else, deliberately:
 *
 *  - Existence comes from `readWikiIndex` — only ids the index carries are citable,
 *    the same authority `cbe_cite` and `cbe_wiki` resolve against.
 *  - An exact wiki-relative id wins first; only then a UNIQUE basename resolves (the
 *    form a model-authored `[label](wiki:cognitive-load)` link carries), exactly as
 *    `wiki-citation.ts` resolves the tool's own `id` parameter. An ambiguous basename
 *    serves nothing — guessing between atoms is worse than the not-found state.
 *  - The path goes through `resolveAtomPath`'s containment policy, so an id escaping
 *    the wiki or naming the `raw/` / `inbox/` layers is refused here too.
 *
 * Kept as a pure function in its own module (the `citation-body.ts` precedent) so it is
 * testable without importing `main/ipc.ts`, which pulls the whole main module graph.
 */
export async function loadWikiCitationDetail(
  wikiDir: string | undefined,
  storeQualifiedId: string
): Promise<WikiCitationDetail | null> {
  const wanted = normaliseAtomId(storeQualifiedId.slice(WIKI_CITATION_PREFIX.length));
  if (!wanted || !wikiDir) return null;

  const index = await readWikiIndex(wikiDir);
  if (!index.present || index.atomIds.length === 0) return null;

  let resolvedId = index.atomIds.find((id) => id === wanted) ?? null;
  if (!resolvedId) {
    const byBase = index.atomIds.filter((id) => basename(id) === wanted);
    if (byBase.length === 1) resolvedId = byBase[0]!;
  }
  if (!resolvedId) return null;

  const target = resolveAtomPath(wikiDir, resolvedId);
  if (!target.ok) return null;

  const raw = await readAtomBody(target.path);
  if (raw === null) return null;

  // The title is the id's basename, exactly as the wiki browser derives it — an atom
  // has no `title` frontmatter field, the filename IS its name.
  const title = basename(resolvedId);
  return {
    store: "wiki",
    hit: { id: resolvedId, title, path: `${resolvedId}.md` },
    body: citationMarkdownBody(raw, title),
  };
}

/** The last path segment of a wiki-relative id — `concept/cognitive-load` → `cognitive-load`. */
function basename(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}
