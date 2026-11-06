/**
 * Canonical-citation regexes + pure helpers — the SINGLE source of truth.
 *
 * Consumed by two callers, neither of which may diverge:
 *   - the runner-level CLI wrapper `check-canonical-citations.mjs` (run build-free
 *     as a node subprocess, incl. by packages/pi-bridge/tests/canonical-citations-check.test.ts)
 *   - the harness checker `runner/src/check-canonical.ts` (typed re-export)
 *
 * Plain ESM (no build step) so the CLI keeps working without compiling the
 * harness. A hand-written `canonical-citations-core.d.mts` gives the TS side types.
 *
 * Corpus versioning model (change `version-corpus-replace-dev-track`): the corpus
 * is purely versioned content. Authority is established per corpus VERSION (a
 * version is signed off as a whole), not per document. There is therefore NO
 * per-citation status marker: the retired `[dev-corpus, non-final]` suffix and
 * the `non-authoritative dev-draft, …` marker are gone. A canonical token is the
 * bare form the `cbe_cite` tool emits, `[draft]`-free.
 */

/**
 * Canonical pattern (bare token, no suffix):
 *   (corpus:<id> § <section>, <author year>)   ← document WITH sources[]
 *   (corpus:<id> § <section>)                   ← source-less document (methodology-002…006)
 *
 * - id is kebab-case
 * - one citation = one section (no ` / `, ` AND `, ` & `, ` + ` separators before the comma)
 * - the author/year element is OPTIONAL (absent for source-less documents);
 *   when present it ends in a four-digit year or the literal `n.d.`
 * - NO trailing suffix or status marker of any kind
 *
 * `CANONICAL` is unanchored (it matches a well-formed token appearing anywhere in
 * a string); `isWellFormedToken` uses the anchored variant so a captured token
 * carrying trailing junk (e.g. a retired `[dev-corpus, non-final]` suffix) fails.
 */
const CANONICAL_BODY = String.raw`\(corpus:[a-z0-9]+(?:-[a-z0-9]+)*\s+§\s+(?:(?!\s\/\s|\sAND\s|\s&\s|\s\+\s)[^,)])+(?:,\s+[^)]+?\s(?:\d{4}|n\.d\.))?\)`;

export const CANONICAL = new RegExp(CANONICAL_BODY);
const CANONICAL_ANCHORED = new RegExp(`^${CANONICAL_BODY}$`);

/** A corpus token is well-formed iff the WHOLE token matches the bare canonical
 * pattern (author/year form OR source-less form) with no trailing marker. */
export function isWellFormedToken(token) {
  return CANONICAL_ANCHORED.test(token);
}

/** Any token starting `(corpus:` up to `)`, plus an optional trailing bracketed
 * suffix so a retired `… ) [dev-corpus, non-final]` token is captured WHOLE and
 * then rejected by the anchored well-formedness test. Used to enumerate. */
export const ANY_CORPUS_TOKEN = /\(corpus:[a-z0-9-]+(?:[^()\n]*)\)(?:\s*\[[^\]\n]*\])?/g;

const ID_IN_TOKEN = /\(corpus:([a-z0-9]+(?:-[a-z0-9]+)*)/;

/** Every non-canonical corpus token in the text, with 1-based line numbers. */
export function findNonCanonicalCitations(text) {
  const violations = [];
  for (const match of text.matchAll(ANY_CORPUS_TOKEN)) {
    const token = match[0];
    if (!isWellFormedToken(token)) {
      const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
      violations.push({ token, line });
    }
  }
  return violations;
}

/** All cited corpus ids (canonical or not). */
export function allCitedIds(text) {
  const ids = [];
  for (const match of text.matchAll(ANY_CORPUS_TOKEN)) {
    const m = ID_IN_TOKEN.exec(match[0]);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** Corpus ids cited in a well-formed (bare canonical) token. */
export function canonicalCitedIds(text) {
  const ids = [];
  for (const match of text.matchAll(ANY_CORPUS_TOKEN)) {
    const token = match[0];
    if (isWellFormedToken(token)) {
      const m = ID_IN_TOKEN.exec(token);
      if (m) ids.push(m[1]);
    }
  }
  return ids;
}
