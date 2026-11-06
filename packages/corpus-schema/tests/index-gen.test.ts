import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateIndex, deriveShortDescription } from "../src/index-gen.js";
import os from "node:os";
import fs from "node:fs/promises";
import type { CorpusDocument } from "../src/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesIndex = path.join(__dirname, "fixtures-index");
const fixturesMissingSummary = path.join(__dirname, "fixtures-missing-summary");

const baseDoc: CorpusDocument = {
  id: "foundations-x",
  title: "x",
  category: "foundations",
  version: "0.1.0",
  sources: [],
  license: "MIT",
  updated: "2026-05-21",
  tags: [],
};

describe("generateIndex", () => {
  it("produces repo-root-relative paths when pathsRelativeTo is set", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-${Date.now()}.json`);
    // Use the tests dir as a fake "repo root" — the fixture is at
    // tests/fixtures-index/foundations/foundations-index-test-001-doc.md, so the expected
    // path relative to __dirname is "fixtures-index/foundations/foundations-index-test-001-doc.md".
    const idx = await generateIndex(fixturesIndex, outFile, {
      pathsRelativeTo: __dirname,
    });

    expect(idx.documents.length).toBe(2);
    const paths = idx.documents.map((d) => d.path).sort();
    expect(paths).toContain("fixtures-index/foundations/foundations-index-test-001-doc.md");

    // Clean up
    await fs.unlink(outFile);
  });

  // Scenario: Manifest paths resolve against the corpus root (generator half) —
  // capability `corpus-curation`, Requirement: Index manifest with retrieval-ready metadata.
  it("defaults to the manifest's own directory when pathsRelativeTo is omitted", async () => {
    // Mirror the real layout: the document directory (corpus/content) is scanned,
    // the manifest is written one level up (corpus/index.json).
    const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-index-gen-default-"));
    try {
      await fs.cp(fixturesIndex, path.join(corpusRoot, "content"), { recursive: true });
      const outFile = path.join(corpusRoot, "index.json");
      const idx = await generateIndex(path.join(corpusRoot, "content"), outFile);

      expect(idx.documents.length).toBe(2);
      for (const doc of idx.documents) {
        // Corpus-root-relative: no leading corpus-directory segment, and the plain
        // concatenation <corpus base>/<path> locates the file.
        expect(doc.path.startsWith("content/")).toBe(true);
        expect(doc.path).not.toContain("..");
        await expect(fs.access(path.join(corpusRoot, doc.path))).resolves.toBeUndefined();
      }
    } finally {
      await fs.rm(corpusRoot, { recursive: true, force: true });
    }
  });

  it("writes corpus-root-relative paths when pathsRelativeTo is the corpus dir", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-root-${Date.now()}.json`);
    const idx = await generateIndex(fixturesIndex, outFile, { pathsRelativeTo: fixturesIndex });

    const paths = idx.documents.map((d) => d.path).sort();
    expect(paths).toContain("foundations/foundations-index-test-001-doc.md");

    await fs.unlink(outFile);
  });

  it("stamps the corpus-version from the option and validates the YYYY-MM shape", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-version-${Date.now()}.json`);
    const idx = await generateIndex(fixturesIndex, outFile, { pathsRelativeTo: __dirname, corpusVersion: "2026-06" });
    expect(idx["corpus-version"]).toBe("2026-06");
    await fs.unlink(outFile);
    await expect(
      generateIndex(fixturesIndex, outFile, { pathsRelativeTo: __dirname, corpusVersion: "2026/06" })
    ).rejects.toThrow(/YYYY-MM/);
  });

  it("falls back to the newest document updated month when no version is supplied", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-version-fallback-${Date.now()}.json`);
    const idx = await generateIndex(fixturesIndex, outFile, { pathsRelativeTo: __dirname });
    expect(idx["corpus-version"]).toBe("2026-05");
    await fs.unlink(outFile);
  });

  it("generated equals the maximum updated date across all documents", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-generated-${Date.now()}.json`);
    const idx = await generateIndex(fixturesIndex, outFile, { pathsRelativeTo: __dirname });
    expect(idx.generated).toBe("2026-05-21");
    await fs.unlink(outFile);
  });

  it("manifest entries carry a non-empty short-description", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-short-desc-${Date.now()}.json`);
    const idx = await generateIndex(fixturesIndex, outFile, { pathsRelativeTo: __dirname });
    for (const doc of idx.documents) {
      expect(doc["short-description"]).toBeTruthy();
      expect(doc["short-description"].length).toBeGreaterThan(0);
      expect(doc["short-description"].length).toBeLessThanOrEqual(200);
    }
    await fs.unlink(outFile);
  });

  it("fails when a document has neither a Summary block nor a frontmatter override", async () => {
    const outFile = path.join(os.tmpdir(), `cbe-index-gen-test-missing-summary-${Date.now()}.json`);
    await expect(generateIndex(fixturesMissingSummary, outFile)).rejects.toThrow(/short-description/);
  });

  // Scenario: Source entry with pages passes validation (generator half) —
  // capability `corpus-curation`, Requirement: Unified Markdown schema for all
  // corpus documents.
  it("regenerates the index without error when a source entry carries pages", async () => {
    const corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-index-gen-pages-"));
    try {
      const docDir = path.join(corpusRoot, "content", "methodology");
      await fs.mkdir(docDir, { recursive: true });
      await fs.writeFile(
        path.join(docDir, "methodology-pages-test-001-pages-doc.md"),
        [
          "---",
          "id: methodology-pages-test-001",
          'title: "Pages anchor test document"',
          "category: methodology",
          'version: "0.1.0"',
          "sources:",
          '  - author: "Nichols, M., Cator, K., and Torres, M."',
          "    year: 2016",
          '    title: "Challenge Based Learning Guide"',
          '    url: "https://example.org/cbl-guide-2016"',
          '    license: "CC BY"',
          '    pages: "11-13"',
          'license: "CC-BY-4.0"',
          'updated: "2026-07-09"',
          "tags: [test, pages]",
          "---",
          "",
          "# Pages anchor test document",
          "",
          "## Summary",
          "",
          "A fixture exercising the optional per-source pages field through index generation.",
          "",
        ].join("\n"),
        "utf8"
      );
      const outFile = path.join(corpusRoot, "index.json");
      const idx = await generateIndex(path.join(corpusRoot, "content"), outFile);
      expect(idx.documents.length).toBe(1);
      expect(idx.documents[0]?.id).toBe("methodology-pages-test-001");
    } finally {
      await fs.rm(corpusRoot, { recursive: true, force: true });
    }
  });
});

describe("deriveShortDescription", () => {
  it("prefers the frontmatter override over the Summary block", () => {
    const body = "## Summary\n\nThis would be the Summary-derived sentence.\n";
    const result = deriveShortDescription({ ...baseDoc, "short-description": "Curator override wins." }, body);
    expect(result).toBe("Curator override wins.");
  });

  it("falls back to the first sentence of the Summary block", () => {
    const body = "## Summary\n\nThis is the first sentence. The second sentence is irrelevant.\n\n## Other\n\nIgnored.";
    const result = deriveShortDescription(baseDoc, body);
    expect(result).toBe("This is the first sentence.");
  });

  it("strips inline markdown emphasis from the derived sentence", () => {
    const body =
      "## Summary\n\nImplementation scales (*institutional* vs. **bounded**): Challenge events embedded in a wider curriculum.\n";
    const result = deriveShortDescription(baseDoc, body);
    expect(result).toBe(
      "Implementation scales (institutional vs. bounded): Challenge events embedded in a wider curriculum."
    );
  });

  it("returns null when neither override nor Summary block is present", () => {
    const body = "# Title\n\nNo summary heading here.\n";
    const result = deriveShortDescription(baseDoc, body);
    expect(result).toBeNull();
  });

  it("returns null on an empty Summary block", () => {
    const body = "## Summary\n\n## Next\n\nNothing in summary.";
    const result = deriveShortDescription(baseDoc, body);
    expect(result).toBeNull();
  });
});
