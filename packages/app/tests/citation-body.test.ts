/**
 * Preparation of a cited corpus document for the citation detail (capability
 * `desktop-app`, Requirement: *The Citation Detail Renders the Cited Source as
 * Markdown*).
 *
 * One test per Scenario. The function is pure and lives in its own module precisely so
 * these tests do not have to import `main/ipc.ts` and its whole module graph.
 */
import { describe, expect, it } from "vitest";
import { citationMarkdownBody } from "../src/main/citation-body.js";

const TITLE = "The Challenge Based Learning Three-Phase Framework";

const RAW = `---
id: methodology-001
title: "${TITLE}"
category: methodology
sources:
  - author: "Nichols, M., Cator, K., and Torres, M."
    year: 2016
    title: "Challenge Based Learner User Guide"
tags: [engage, investigate, act]
---

# ${TITLE}

## Summary

The framework connects Engage, Investigate, and Act.
`;

describe("The frontmatter block does not reach the rendered body", () => {
  it("starts the body at the first Markdown block and keeps no fence or frontmatter key", () => {
    const body = citationMarkdownBody(RAW, TITLE);

    expect(body).not.toContain("---");
    for (const key of ["id:", "title:", "category:", "sources:", "tags:", "author:", "year:"]) {
      expect(body, `frontmatter key "${key}" survived`).not.toContain(key);
    }
    // What is left starts at the document's own first Markdown block.
    expect(body.trimStart().startsWith("## Summary")).toBe(true);
    expect(body).toContain("The framework connects Engage, Investigate, and Act.");
  });

  it("returns a document without frontmatter unchanged", () => {
    const plain = "## Summary\n\nNo frontmatter here.\n";
    expect(citationMarkdownBody(plain, TITLE)).toBe(plain);
  });
});

describe("A malformed frontmatter block still yields a readable document", () => {
  // Unbalanced flow sequence plus an unterminated quoted scalar: `gray-matter` hands this
  // to js-yaml, which throws. A throw escapes into the `loadCitation` IPC handler and
  // leaves the detail on "Loading…" forever, so the lecturer loses a readable document.
  const MALFORMED = `---\nid: methodology-001\ntitle: "${TITLE}\ntags: [engage, investigate, act\n---\n\n# ${TITLE}\n\n## Summary\n\nThe framework connects Engage, Investigate, and Act.\n`;

  it("does not throw and delivers the document body with the fenced block removed", () => {
    let body = "";
    expect(() => {
      body = citationMarkdownBody(MALFORMED, TITLE);
    }).not.toThrow();

    expect(body).not.toContain("---");
    expect(body).not.toContain("tags:");
    expect(body).toContain("## Summary");
    expect(body).toContain("The framework connects Engage, Investigate, and Act.");
  });

  it("still drops the leading title heading of a document it could not parse", () => {
    expect(citationMarkdownBody(MALFORMED, TITLE).trimStart().startsWith("## Summary")).toBe(true);
  });

  it("prepares the same document identically on a second opening", () => {
    // `gray-matter` caches the file object it was handed before it parses, so a failed
    // parse leaves an unstripped entry behind that a later call would return verbatim.
    expect(citationMarkdownBody(MALFORMED, TITLE)).toBe(citationMarkdownBody(MALFORMED, TITLE));
    expect(citationMarkdownBody(RAW, TITLE)).toBe(citationMarkdownBody(RAW, TITLE));
  });

  it("returns a document whose opening fence is never closed whole rather than swallowing it", () => {
    const unclosed = `---\ntitle: "${TITLE}\n\n## Summary\n\nText.\n`;
    const body = citationMarkdownBody(unclosed, TITLE);
    expect(body).toContain("## Summary");
    expect(body).toContain("Text.");
  });
});

describe("The document title is not shown twice", () => {
  it("drops a leading level-1 heading identical to the title and keeps the rest in full", () => {
    const body = citationMarkdownBody(RAW, TITLE);

    expect(body).not.toContain(`# ${TITLE}`);
    expect(body).not.toContain(TITLE);
    expect(body).toContain("## Summary");
    expect(body).toContain("The framework connects Engage, Investigate, and Act.");
  });

  it("matches the heading despite differing whitespace, and keeps the following blank-line structure clean", () => {
    const raw = `---\nid: x\n---\n\n#    ${TITLE}   \n\n\n## Summary\n\nText.\n`;
    const body = citationMarkdownBody(raw, TITLE);
    expect(body.startsWith("## Summary")).toBe(true);
  });

  it("drops the heading when it carries the closing-hash ATX form", () => {
    const raw = `# ${TITLE} #\n\n## Summary\n\nText.\n`;
    expect(citationMarkdownBody(raw, TITLE).startsWith("## Summary")).toBe(true);
  });
});

describe("A different opening heading is kept", () => {
  it("keeps a leading level-1 heading whose text differs from the title", () => {
    const raw = `---\nid: x\n---\n\n# Executive Summary\n\nText.\n`;
    const body = citationMarkdownBody(raw, TITLE);
    expect(body.trimStart().startsWith("# Executive Summary")).toBe(true);
  });

  it("keeps a level-2 heading that repeats the title — only the level-1 duplication is suppressed", () => {
    const raw = `## ${TITLE}\n\nText.\n`;
    expect(citationMarkdownBody(raw, TITLE)).toContain(`## ${TITLE}`);
  });

  it("keeps an opening block that is not a heading at all", () => {
    const raw = `A lead paragraph.\n\n# ${TITLE}\n`;
    const body = citationMarkdownBody(raw, TITLE);
    expect(body.trimStart().startsWith("A lead paragraph.")).toBe(true);
    expect(body).toContain(`# ${TITLE}`);
  });

  it("leaves the body alone when the resolved title is empty", () => {
    const raw = `# ${TITLE}\n\nText.\n`;
    expect(citationMarkdownBody(raw, "")).toContain(`# ${TITLE}`);
  });
});
