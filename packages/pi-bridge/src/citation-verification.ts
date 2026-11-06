/**
 * Citation-token verification — the SINGLE implementation of "does this `§` section
 * name a real heading in this corpus document".
 *
 * Three consumers must agree, and they are in three different processes:
 *
 *   1. `cbe_cite`'s section gate (`cite-tool.ts`), which refuses a section it cannot
 *      match and returns the document's real headings;
 *   2. the app's main process, which verifies an emitted `(corpus:…)` token before the
 *      renderer links it (capability `desktop-app`, Requirement: *A Citation Token Is
 *      Verified Against the Corpus Before It Is Linked*);
 *   3. the evaluation runner's `cite_section_resolves` check.
 *
 * Two implementations of this question would drift, and the drift would be invisible:
 * the tool would accept a section the host rejects, or the reverse, and the lecturer
 * would see a citation the product cannot agree with itself about. Capability
 * `citation-tool`, Requirement: *The Section Gate Is a Shared, Separately-Importable
 * Verifier*.
 *
 * DELIBERATELY PURE AND LEAF. No filesystem access, no `async`, and — the load-bearing
 * constraint — NO import of the Pi runtime, so the evaluation runner's deterministic
 * checker and the renderer's type layer can import it without pulling
 * `@earendil-works/pi-coding-agent` into their process. That is why it is reachable as
 * its own package subpath (`@cbe/pi-bridge/citation-verification`) and not only through
 * the package root: `runner/src/{editor,trace-check,session-eval}.ts` all carry standing
 * notes that importing the root pulls the runtime.
 *
 * WHERE A TOKEN COMES FROM (product decision 2026-08-18, superseding the ruling of
 * 2026-08-10). The identity prompt routes every token through `cbe_cite` and licenses no
 * self-written one — capability `agent-harness`, Requirement: *Mandatory Corpus-Grounding
 * Opening Protocol in the Identity Prompt*, which owns that rule. This module is the
 * BACKSTOP, not the route: the renderer linkifies any well-formed token, so one the model
 * emits with no call behind it would otherwise reach the lecturer as a working,
 * precise-looking link whose section nothing has checked.
 */

/** The document is known and the section names one of its headings. */
export interface CitationVerified {
  status: "verified";
  id: string;
  /** The section as written in the token. */
  section: string;
  /** The document's heading it matched, verbatim from the body. */
  heading: string;
}

/** The id names no document in the loaded corpus. */
export interface CitationUnknownId {
  status: "unknown-id";
  id: string;
}

/** The document is known, but the token carries no `§` element at all. */
export interface CitationMissingSection {
  status: "missing-section";
  id: string;
}

/** The document is known, but no heading matches the section. */
export interface CitationUnknownSection {
  status: "unknown-section";
  id: string;
  section: string;
  /** The document's actual headings, so a caller can correct or explain. */
  headings: string[];
}

export type CitationVerification =
  | CitationVerified
  | CitationUnknownId
  | CitationMissingSection
  | CitationUnknownSection;

/** A raw `(corpus:…)` token split into the two elements verification needs. */
export interface ParsedCitationToken {
  id: string;
  /** `null` when the token carries no `§` element (or an empty one). */
  section: string | null;
}

/**
 * Normalise a section string for comparison against a heading: strip a leading
 * `§`/`#` run and any leading section numbering (`1.`, `1.2`, `3)`), trim, fold case.
 *
 * Conservative on purpose — an exact match after normalisation, else no match. A fuzzy
 * matcher would let an invented section resolve against a superficially similar heading,
 * which is the failure this whole module exists to catch.
 */
export function normaliseSection(s: string): string {
  return s
    .replace(/^[\s§#]+/, "")
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .trim()
    .toLowerCase();
}

/**
 * The ATX headings (`#`..`######`) of a Markdown document BODY, heading text trimmed.
 *
 * The caller strips the frontmatter first — a `#`-prefixed line inside frontmatter is
 * not a heading. Mirrors the `/^#{1,6}\s+/` rule in
 * `packages/corpus-schema/src/validate.ts`.
 */
export function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (m) headings.push(m[1]!.trim());
  }
  return headings;
}

/**
 * The document heading a section string names, verbatim, or `null` when none does.
 * Returning the heading (rather than a boolean) is what lets `cbe_cite` put the
 * document's own spelling into the token instead of the model's.
 */
export function matchSectionHeading(section: string, headings: readonly string[]): string | null {
  const wanted = normaliseSection(section);
  if (wanted === "") return null;
  return headings.find((h) => normaliseSection(h) === wanted) ?? null;
}

/** `(corpus:<id>` — kebab-case id, at the very start of the token. */
const TOKEN_HEAD = /^\(corpus:([a-z0-9]+(?:-[a-z0-9]+)*)\b/;

const PERSON = String.raw`\p{Lu}[\p{L}'’-]*, \p{Lu}\.(?: ?\p{Lu}\.)*`;
const PERSON_LIST = String.raw`${PERSON}(?:, ${PERSON})*(?:,? (?:and|&) ${PERSON})?`;

/**
 * A trailing `, <author> <year|n.d.>` element. Anchored at the end so a comma inside a
 * section label cannot be mistaken for the source separator. The author is either
 * comma-free (`Nichols et al.`, `PIONEER Project Team`) or a list of `Surname, I.`
 * names (`Nichols, M., Cator, K., and Torres, M.`), whose own commas are part of it.
 */
export const SOURCE_TAIL = new RegExp(String.raw`,\s*(?:${PERSON_LIST}|[^,]+)\s(?:\d{4}|n\.d\.)$`, "u");

/**
 * Split a raw `(corpus:…)` token into its id and its `§` section.
 *
 * DELIBERATELY MORE TOLERANT THAN `CANONICAL_BODY`
 * (`evaluation/cbe-skill/canonical-citations-core.mjs`), which excludes `)` from
 * the section class. `cbe_cite` itself emits a token whose section carries parentheses
 * when the document's heading has them (`§ Phase 1 (Engage)`), and `desktop-app`
 * Requirement *Citation Tokens Linkify Inside Inline Code and Tolerate Section
 * Parentheses* supports exactly that form. Verification must never fail a section the
 * tool produced, so parsing for verification is a separate, more generous reader; the
 * canonical regex keeps its own job (well-formedness) untouched.
 *
 * Returns `null` when the string is not a corpus token at all.
 */
export function parseCitationToken(raw: string): ParsedCitationToken | null {
  const head = TOKEN_HEAD.exec(raw);
  if (!head) return null;
  const id = head[1]!;

  let rest = raw.slice(head[0].length).trim();
  // An unterminated occurrence (no closing paren on the line) carries no readable
  // section; treat it as section-less rather than guessing where it ended.
  if (!rest.endsWith(")")) return { id, section: null };
  rest = rest.slice(0, -1).trim();
  if (!rest.startsWith("§")) return { id, section: null };

  let section = rest.slice(1).trim();
  const tail = SOURCE_TAIL.exec(section);
  if (tail) section = section.slice(0, tail.index).trim();
  return { id, section: section.length > 0 ? section : null };
}

/**
 * Verify an (id, section) pair against a document's headings.
 *
 * `headings === null` means the id names no document in the loaded corpus — the caller
 * distinguishes "unknown document" from "document with no headings" by passing `null`
 * rather than an empty array.
 */
export function verifyCitation(
  id: string,
  section: string | null,
  headings: readonly string[] | null
): CitationVerification {
  if (headings === null) return { status: "unknown-id", id };
  if (section === null || section.trim() === "") return { status: "missing-section", id };
  const heading = matchSectionHeading(section, headings);
  if (heading === null) return { status: "unknown-section", id, section, headings: [...headings] };
  return { status: "verified", id, section, heading };
}

/**
 * Convenience: parse a raw token and verify it in one step. Returns `null` when the
 * string is not a corpus token.
 */
export function verifyCitationToken(raw: string, headings: readonly string[] | null): CitationVerification | null {
  const parsed = parseCitationToken(raw);
  if (!parsed) return null;
  return verifyCitation(parsed.id, parsed.section, headings);
}
