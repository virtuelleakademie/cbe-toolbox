import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { generateBrowseView, renderSource } from "../src/browse-gen.js";

// Distribution spec, Requirement: Corpus Browse View on the Landing Page.

const ATOM_MD = `---
id: foundations-x
title: "CBL <Foundations> Test Atom"
category: foundations
version: 0.1.0
updated: 2026-07-01
license: CC-BY-4.0
tags: [higher-education, cbl]
sources:
  - author: "Nichols & Cator"
    year: 2016
    title: "Challenge Based Learner User Guide"
    url: "https://example.org/cbl-guide"
    license: "CC-BY"
    pages: "11-13"
  - author: "Gallagher"
    year: 2022
    title: "Offline Companion Volume"
    license: "CC-BY"
---

## Body heading

Body paragraph with **markdown**.
`;

describe("generateBrowseView", () => {
  let corpusDir: string;
  let outDir: string;

  beforeAll(async () => {
    corpusDir = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-browse-"));
    outDir = path.join(corpusDir, "..", path.basename(corpusDir) + "-out");
    await fs.mkdir(path.join(corpusDir, "content", "foundations"), { recursive: true });
    await fs.writeFile(path.join(corpusDir, "content", "foundations", "atom.md"), ATOM_MD);
    await fs.writeFile(
      path.join(corpusDir, "index.json"),
      JSON.stringify({
        "corpus-version": "2026-07",
        documents: [
          {
            id: "foundations-x",
            title: "CBL <Foundations> Test Atom",
            category: "foundations",
            version: "0.1.0",
            path: "content/foundations/atom.md",
            tags: ["higher-education", "cbl"],
            "short-description": "A test atom.",
          },
        ],
      })
    );
    await generateBrowseView(corpusDir, outDir);
  });

  afterAll(async () => {
    await fs.rm(corpusDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("emits one page per atom plus a category-grouped index", async () => {
    const index = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).toContain("foundations-x.html");
    expect(index).toContain("2026-07");
    expect(index).toContain("A test atom.");
  });

  it("renders title, body and frontmatter metadata on the atom page", async () => {
    const atom = await fs.readFile(path.join(outDir, "foundations-x.html"), "utf8");
    // Title is HTML-escaped, body is rendered markdown, frontmatter is tabled.
    expect(atom).toContain("CBL &lt;Foundations&gt; Test Atom");
    expect(atom).toMatch(/<h2[^>]*>Body heading<\/h2>/);
    expect(atom).toContain("<strong>markdown</strong>");
    expect(atom).toContain("higher-education, cbl");
    expect(atom).toContain("2026-07-01");
  });

  // Scenario: Source-text links are clickable on each atom page — each
  // sources[] entry renders as a link to its url with "author year — title";
  // without a url the same fields render as plain text.
  it("renders sources[] as clickable links when a url exists", async () => {
    const atom = await fs.readFile(path.join(outDir, "foundations-x.html"), "utf8");
    expect(atom).toContain('<a href="https://example.org/cbl-guide"');
    expect(atom).toContain("Nichols &amp; Cator 2016 — Challenge Based Learner User Guide");
  });

  it("renders a url-less source as plain text with the same fields", async () => {
    const atom = await fs.readFile(path.join(outDir, "foundations-x.html"), "utf8");
    expect(atom).toContain("Gallagher 2022 — Offline Companion Volume");
    expect(atom).not.toMatch(/<a [^>]*>Gallagher 2022/);
  });
});

describe("renderSource", () => {
  it("links when url present, plain when absent", () => {
    expect(renderSource({ author: "A", year: 2020, title: "T", url: "https://x.example/" })).toContain("<a href=");
    expect(renderSource({ author: "A", year: 2020, title: "T" })).not.toContain("<a href=");
  });
});
