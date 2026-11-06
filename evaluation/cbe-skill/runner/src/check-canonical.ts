/**
 * Typed re-export of the shared canonical-citation core. The actual regexes and
 * helpers live in `evaluation/cbe-skill/canonical-citations-core.mjs` (a
 * plain-ESM module so the CLI wrapper runs without a build); this file gives the
 * harness a typed, in-package import surface.
 */
export {
  CANONICAL,
  ANY_CORPUS_TOKEN,
  isWellFormedToken,
  findNonCanonicalCitations,
  allCitedIds,
  canonicalCitedIds,
} from "../../canonical-citations-core.mjs";
