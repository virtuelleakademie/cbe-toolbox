/**
 * Tests for the citation remark plugin.
 *
 * The plugin rewrites inline `(corpus:<id> ...)` tokens to mdast `link` nodes
 * with a custom `cbe-citation://<id>` URL — see spec scenario *Citation token
 * renders as clickable link* in `specs/desktop-app/spec.md`. The renderer's
 * `components.a` override in MarkdownView then swaps these for the existing
 * `CitationLink` component (tested separately in MarkdownView integration tests).
 *
 * Tested here at the mdast layer, BEFORE HTML/JSX generation, so the assertions
 * are about tree structure — not rendered output. That way edge cases (token at
 * line-start, inside a list item, surrounded by emphasis, etc.) are visible at
 * the same level of abstraction where the plugin operates.
 */
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Link, Paragraph, ListItem, Text } from "mdast";
import { CITATION_URL_PREFIX, citationRemarkPlugin, sectionFromToken } from "../src/renderer/util/citation-plugin.js";

function parse(md: string): Root {
  return unified().use(remarkParse).use(citationRemarkPlugin).parse(md) as Root;
}

function transform(md: string): Root {
  const tree = parse(md);
  // remarkParse + plugin both run via .parse + .runSync — but `parse` alone does
  // not invoke transformers. Use `run` to apply our plugin to the tree.
  return unified().use(citationRemarkPlugin).runSync(tree) as Root;
}

/** Collect all link nodes anywhere in the tree. */
function collectLinks(tree: Root): Link[] {
  const out: Link[] = [];
  function walk(node: { type: string; children?: unknown[] } | undefined): void {
    if (!node) return;
    if (node.type === "link") out.push(node as unknown as Link);
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c as { type: string; children?: unknown[] });
    }
  }
  walk(tree);
  return out;
}

describe("citationRemarkPlugin — basic rewrite", () => {
  it("converts a single citation token in a paragraph to a link", () => {
    const tree = transform("See (corpus:foundations-001 § Engage, Kolb 1984) for more.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}foundations-001`);
  });

  it("preserves the full raw token as the link's visible text", () => {
    const tree = transform("See (corpus:foundations-001 § Engage, Kolb 1984) for more.");
    const link = collectLinks(tree)[0]!;
    expect(link.children).toHaveLength(1);
    expect((link.children[0] as Text).value).toBe("(corpus:foundations-001 § Engage, Kolb 1984)");
  });

  it("extracts only the kebab-case id into the URL — surrounding metadata stays in the visible text", () => {
    const tree = transform("(corpus:methodology-001 § 4.2, Smith 2020)");
    const link = collectLinks(tree)[0]!;
    expect(link.url).toBe(`${CITATION_URL_PREFIX}methodology-001`);
    expect((link.children[0] as Text).value).toContain("§ 4.2, Smith 2020");
  });
});

describe("citationRemarkPlugin — placement edge cases", () => {
  it("rewrites a token at the start of a paragraph", () => {
    const tree = transform("(corpus:foundations-001) opens the section.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    // The first child of the paragraph should now be the link, not a text node.
    const para = tree.children[0] as Paragraph;
    expect(para.children[0]!.type).toBe("link");
  });

  it("rewrites a token at the end of a paragraph", () => {
    const tree = transform("Closing thought (corpus:foundations-002)");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    const para = tree.children[0] as Paragraph;
    expect(para.children.at(-1)!.type).toBe("link");
  });

  it("rewrites multiple tokens in the same paragraph independently", () => {
    const tree = transform("Compare (corpus:foundations-001) and (corpus:foundations-002) for context.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.url)).toEqual([
      `${CITATION_URL_PREFIX}foundations-001`,
      `${CITATION_URL_PREFIX}foundations-002`,
    ]);
  });

  it("rewrites tokens inside list items", () => {
    const tree = transform(
      ["- first point (corpus:foundations-001)", "- second point (corpus:foundations-002)"].join("\n")
    );
    const links = collectLinks(tree);
    expect(links).toHaveLength(2);
    // Verify each link sits inside a list item (not lifted out into the
    // surrounding root) so list structure stays intact.
    const items = (tree.children[0] as { children: ListItem[] }).children;
    expect(items).toHaveLength(2);
    for (const item of items) {
      const para = item.children[0] as Paragraph;
      expect(para.children.some((c) => c.type === "link")).toBe(true);
    }
  });

  it("rewrites tokens inside table cells (GFM not needed — citation lives in a text node either way)", () => {
    const tree = transform(
      ["before", "", "> Quoted text with (corpus:foundations-001 § 2) embedded", "", "after"].join("\n")
    );
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}foundations-001`);
  });
});

describe("citationRemarkPlugin — non-citation parentheses are left alone", () => {
  it("plain parentheses do not produce links", () => {
    const tree = transform("This (is) just (regular text in parens).");
    expect(collectLinks(tree)).toHaveLength(0);
  });

  it("a parens block that looks similar but lacks the corpus: prefix is left alone", () => {
    const tree = transform("Reference (Source 2020, p. 12) inline.");
    expect(collectLinks(tree)).toHaveLength(0);
  });

  it("a URL containing the corpus token in a markdown link is not touched", () => {
    // A normal markdown link `[text](https://example.com/corpus:foo)` already
    // becomes a link via remark-parse — the plugin should not see it as a text
    // node and double-process it.
    const tree = transform("See [docs](https://example.com/corpus:foo) for the source.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://example.com/corpus:foo");
  });

  it("an id that is not kebab-case is rejected (no false matches on `corpus:Foo` or `corpus:foo_bar`)", () => {
    const tree1 = transform("Reference (corpus:Foo) sample.");
    const tree2 = transform("Reference (corpus:foo_bar) sample.");
    expect(collectLinks(tree1)).toHaveLength(0);
    expect(collectLinks(tree2)).toHaveLength(0);
  });
});

describe("citationRemarkPlugin — text is preserved around the rewrite", () => {
  it("text before and after the token survives as adjacent text nodes", () => {
    const tree = transform("PRE (corpus:foundations-001) POST.");
    const para = tree.children[0] as Paragraph;
    expect(para.children).toHaveLength(3);
    expect(para.children[0]!.type).toBe("text");
    expect((para.children[0] as Text).value).toBe("PRE ");
    expect(para.children[1]!.type).toBe("link");
    expect(para.children[2]!.type).toBe("text");
    expect((para.children[2] as Text).value).toBe(" POST.");
  });

  it("two tokens separated by text keep that text as a middle node", () => {
    const tree = transform("(corpus:foundations-001) AND (corpus:foundations-002)");
    const para = tree.children[0] as Paragraph;
    const middle = para.children.find((c) => c.type === "text" && (c as Text).value === " AND ");
    expect(middle).toBeDefined();
  });
});

/** Collect all inlineCode values anywhere in the tree. */
function collectInlineCode(tree: Root): string[] {
  const out: string[] = [];
  function walk(node: { type: string; value?: string; children?: unknown[] } | undefined): void {
    if (!node) return;
    if (node.type === "inlineCode" && typeof node.value === "string") out.push(node.value);
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c as { type: string; value?: string; children?: unknown[] });
    }
  }
  walk(tree);
  return out;
}

describe("citationRemarkPlugin — tokens wrapped in inline code", () => {
  // Scenario: Backtick-wrapped citation token renders as a clickable link
  it("lifts a backtick-wrapped citation token out of inline code into a link", () => {
    const tree = transform(
      "See `(corpus:methodology-001 § Engage, Nichols et al. 2016) [dev-corpus, non-final]` here."
    );
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}methodology-001`);
    // The token must NOT survive as an unclickable inlineCode node.
    expect(collectInlineCode(tree).join("")).not.toContain("(corpus:");
  });

  it("leaves inline code that carries no citation token untouched", () => {
    const tree = transform("Run `npm test` to verify.");
    expect(collectLinks(tree)).toHaveLength(0);
    expect(collectInlineCode(tree)).toContain("npm test");
  });
});

describe("citationRemarkPlugin — citation token inside a Markdown link label", () => {
  it("does not nest a citation link inside an existing link", () => {
    const tree = transform("[see (corpus:foundations-001) here](https://example.com)");
    const links = collectLinks(tree);
    // Only the outer Markdown link survives; the citation stays as text inside it
    // (link > link is invalid mdast / a <button> inside an <a>).
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://example.com");
  });
});

describe("citationRemarkPlugin — wiki citation tokens", () => {
  // Scenario: Bare wiki token linkifies to the citation link component
  it("converts a wiki token with a slash-segmented atom id to a link that keeps the store prefix", () => {
    const tree = transform("Grounded in (wiki:concept/cognitive-load § Germane load, Sweller 1988) here.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    // The `wiki:` prefix survives INTO the URL — it is the one fact the click path
    // needs to skip verification and route the load to the wiki store.
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}wiki:concept/cognitive-load`);
    expect((links[0]!.children[0] as Text).value).toBe("(wiki:concept/cognitive-load § Germane load, Sweller 1988)");
  });

  it("linkifies a single-segment atom id too", () => {
    const tree = transform("See (wiki:cognitive-load § Sources).");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}wiki:cognitive-load`);
  });

  it("lifts a backtick-wrapped wiki token out of inline code into a link", () => {
    const tree = transform("See `(wiki:concept/cognitive-load § Germane load, Sweller 1988)` here.");
    const links = collectLinks(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe(`${CITATION_URL_PREFIX}wiki:concept/cognitive-load`);
    expect(collectInlineCode(tree).join("")).not.toContain("(wiki:");
  });

  it("keeps corpus URLs bare when both stores appear in one paragraph", () => {
    const tree = transform("Compare (corpus:methodology-001 § 4.2) and (wiki:concept/cognitive-load § Sources).");
    const links = collectLinks(tree);
    expect(links.map((l) => l.url)).toEqual([
      `${CITATION_URL_PREFIX}methodology-001`,
      `${CITATION_URL_PREFIX}wiki:concept/cognitive-load`,
    ]);
  });

  it("a parens block with a wiki-like prefix but an empty id is left alone", () => {
    const tree = transform("Reference (wiki: something) inline.");
    expect(collectLinks(tree)).toHaveLength(0);
  });
});

describe("citationRemarkPlugin — nested parentheses in the section label", () => {
  // Scenario: Section label with parentheses does not truncate the link
  it("does not truncate the link at an inner close-paren", () => {
    const tree = transform("(corpus:methodology-001 § Phase 1 (Engage), Nichols et al. 2016)");
    const link = collectLinks(tree)[0]!;
    expect(link).toBeDefined();
    expect(link.url).toBe(`${CITATION_URL_PREFIX}methodology-001`);
    // The whole token — including the author/year AFTER the inner parens — is the label.
    expect((link.children[0] as Text).value).toBe("(corpus:methodology-001 § Phase 1 (Engage), Nichols et al. 2016)");
  });
});

describe("sectionFromToken — the source element is stripped, nothing more", () => {
  it("strips a comma-separated author list emitted by cbe_cite", () => {
    expect(
      sectionFromToken("(corpus:methodology-001 § Phase 1: Engage, Nichols, M., Cator, K., and Torres, M. 2016)")
    ).toBe("Phase 1: Engage");
  });

  it("keeps an invented sub-section in front of the source element", () => {
    expect(sectionFromToken("(corpus:methodology-001 § Investigate, Invented Sub, Nichols 2016)")).toBe(
      "Investigate, Invented Sub"
    );
  });
});
