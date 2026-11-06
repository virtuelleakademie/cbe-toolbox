/**
 * remark plugin: rewrite `(corpus:<id> ...)` and `(wiki:<atomId> ...)` inline citation
 * tokens to mdast `link` nodes with a custom URL scheme `cbe-citation://<id>` — where
 * `<id>` keeps the `wiki:` store prefix for an atom, so the click path knows which store
 * it holds without a second scheme. The renderer's <a>-override in MarkdownView swaps
 * these for the existing CitationLink component.
 *
 * Implementing this as a remark plugin (rather than post-processing the rendered React
 * tree) lets the citation play nicely with surrounding markdown — including links,
 * lists, table cells, and emphasis — because the substitution happens before HTML/JSX
 * is generated.
 *
 * The plugin visits both `text` nodes (bare tokens) AND `inlineCode` nodes: models — and
 * the skill's own worked examples — sometimes wrap a citation token in backticks, which
 * Markdown parses as `inlineCode`; a text-only visitor would leave that token as
 * unclickable code (capability `desktop-app`, Requirement: Citation Tokens Linkify
 * Inside Inline Code and Tolerate Section Parentheses).
 */
import type { Plugin } from "unified";
import type { Root, Text, InlineCode, Link, PhrasingContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { SOURCE_TAIL } from "@cbe/pi-bridge/citation-verification";

// Identifier pattern, one alternative per store so neither grammar bleeds into the
// other. Corpus ids are lowercase alphanumeric tokens joined by hyphens; wiki atom ids
// are wiki-relative and `/`-segmented (`concept/cognitive-load`), each segment in the
// `[A-Za-z0-9._-]` grammar the wiki index itself advertises (`atomIdsFromIndex` in
// pi-bridge's `wiki-index.ts`). The capture keeps the `wiki:` store prefix for an atom
// and stays bare for a corpus document — the id vocabulary `cbe_cite` uses. Everything
// else inside the parens is passed through as link text so the visual presentation
// (e.g. "§ 4.2, Smith 2020") is preserved.
// The trailing `\b` enforces a word boundary right after the captured id so an
// underscore-prefixed suffix (e.g. `foo_bar`) does NOT silently match as corpus id `foo`.
// The metadata segment `(?:[^()]|\([^()]*\))*` tolerates ONE level of nested parentheses
// (e.g. a section label `Phase 1 (Engage)`) so an inner `)` does not truncate the token
// at a premature close-paren. The two alternatives are mutually exclusive on their first
// character, so there is no catastrophic backtracking.
const CITATION_RE =
  /\((corpus:[a-z0-9]+(?:-[a-z0-9]+)*|wiki:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\b(?:[^()]|\([^()]*\))*\)/g;

export const CITATION_URL_PREFIX = "cbe-citation://";

/**
 * The `§` section a raw token carries, or `null` when it carries none.
 *
 * Needed because the host verifies (id, section) against the corpus before the token is
 * presented as a checked citation (capability `desktop-app`, Requirement: *A Citation
 * Token Is Verified Against the Corpus Before It Is Linked*) — and the id alone cannot
 * answer that question. Deliberately tolerant of parentheses inside the section label,
 * which `cbe_cite` itself emits when the document's heading has them; the trailing
 * `, <author year>` element is stripped so only the section remains.
 */

export function sectionFromToken(raw: string): string | null {
  const marker = raw.indexOf("§");
  if (marker === -1) return null;
  let section = raw.slice(marker + 1).trim();
  if (section.endsWith(")")) section = section.slice(0, -1).trim();
  const tail = SOURCE_TAIL.exec(section);
  if (tail) section = section.slice(0, tail.index).trim();
  return section.length > 0 ? section : null;
}

/**
 * Split a string into text + citation `link` nodes. Returns `null` when the string
 * carries no citation token (so the caller leaves the original node untouched).
 */
function splitCitations(value: string): PhrasingContent[] | null {
  if (!value.includes("(corpus:") && !value.includes("(wiki:")) return null;

  const replacements: PhrasingContent[] = [];
  let lastIndex = 0;
  let matched = false;
  CITATION_RE.lastIndex = 0;
  for (const m of value.matchAll(CITATION_RE)) {
    matched = true;
    const start = m.index!;
    if (start > lastIndex) {
      replacements.push({ type: "text", value: value.slice(lastIndex, start) });
    }
    // A corpus id travels bare (the URL scheme predates the wiki store and every
    // consumer expects it); a wiki id KEEPS its store prefix — that prefix is the one
    // fact the click path needs to skip verification and route the load to the wiki.
    const qualified = m[1]!;
    const id = qualified.startsWith("corpus:") ? qualified.slice("corpus:".length) : qualified;
    const raw = m[0]!;
    const link: Link = {
      type: "link",
      url: `${CITATION_URL_PREFIX}${id}`,
      title: null,
      children: [{ type: "text", value: raw }],
    };
    replacements.push(link);
    lastIndex = start + raw.length;
  }
  if (!matched) return null;
  if (lastIndex < value.length) {
    replacements.push({ type: "text", value: value.slice(lastIndex) });
  }
  return replacements;
}

export const citationRemarkPlugin: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      // Never lift a citation into a link that already sits inside a link — `link > link`
      // is invalid mdast and renders a <button> inside an <a>. Leave the token as text.
      if (parent.type === "link") return;
      const replacements = splitCitations(node.value);
      if (!replacements) return;
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });

    // Lift a citation token out of inline code (backtick-wrapped) into a link so it
    // renders as a clickable CitationLink instead of literal code.
    visit(tree, "inlineCode", (node: InlineCode, index, parent) => {
      if (!parent || typeof index !== "number") return;
      if (parent.type === "link") return;
      const replacements = splitCitations(node.value);
      if (!replacements) return;
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
};
