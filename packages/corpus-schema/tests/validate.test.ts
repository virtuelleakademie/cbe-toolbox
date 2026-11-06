import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateFile, validateDirectory } from "../src/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesBasic = path.join(__dirname, "fixtures", "basic");
const fixturesYaml = path.join(__dirname, "fixtures-yaml");

describe("validateFile", () => {
  it("passes on a good document", async () => {
    const result = await validateFile(path.join(fixturesBasic, "foundations-test-001-good.md"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.id).toBe("foundations-test-001");
  });

  it("returns a structured error on a bad document", async () => {
    const result = await validateFile(path.join(fixturesBasic, "foundations-test-002-bad.md"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns ok:false on malformed yaml frontmatter", async () => {
    const result = await validateFile(path.join(fixturesYaml, "malformed.md"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/<yaml>:/);
    }
  });
});

// Capability `corpus-curation`, Requirement: *Unified Markdown schema for all corpus
// documents* — Scenarios: *Every document is named after its id*; *A document whose
// filename does not carry its id fails validation*; *A renamed document keeps its id and
// its history*.
//
// Nothing RESOLVES a corpus document by filename, which is exactly why the names drifted
// into three conventions at once and why `methodology-007` could not be found on disk by
// the id everything else uses. The convention is therefore enforced here, in the gate the
// corpus PR workflow actually runs, rather than only written down in the guidelines.
describe("the filename carries the document id", () => {
  const write = async (dir: string, name: string, id: string): Promise<string> => {
    const file = path.join(dir, name);
    await writeFile(
      file,
      `---\nid: ${id}\ntitle: "Naming fixture"\ncategory: foundations\nversion: "0.1.0"\n` +
        `sources: []\nlicense: "CC-BY-4.0"\nupdated: "2026-08-10"\ntags: []\n---\n\n## Summary\n\nBody.\n`,
      "utf8"
    );
    return file;
  };
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "corpus-naming-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a document named <id>-<slug>.md", async () => {
    const file = await write(dir, "foundations-006-some-new-topic.md", "foundations-006");
    const result = await validateFile(file);
    expect(result.ok).toBe(true);
  });

  it("fails a document whose filename does not carry its id", async () => {
    const file = await write(dir, "some-new-topic.md", "foundations-007");
    const result = await validateFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/<filename>:/);
      // The message names the expected prefix — a curator must not have to guess it.
      expect(result.errors[0]).toContain("foundations-007-<slug>.md");
    }
  });

  it("fails a bare <id>.md — the id alone tells the reader nothing", async () => {
    const file = await write(dir, "foundations-008.md", "foundations-008");
    const result = await validateFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/<filename>:/);
  });

  it("every shipped corpus document satisfies the convention", async () => {
    const results = await validateDirectory(path.join(__dirname, "..", "..", "..", "corpus", "content"));
    const failed = results.filter((r) => !r.ok).map((r) => r.path);
    expect(failed, `corpus documents failing validation: ${failed.join(", ")}`).toEqual([]);
    // …and the id really is the prefix, not merely somewhere in the name.
    for (const r of results) {
      if (!r.ok) continue;
      expect(path.basename(r.path).startsWith(`${r.doc.id}-`), `${r.path} must start with ${r.doc.id}-`).toBe(true);
    }
  });
});

describe("validateDirectory", () => {
  it("walks .md files and reports per-file results", async () => {
    const results = await validateDirectory(fixturesBasic);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.find((r) => r.path.endsWith("foundations-test-001-good.md"))?.ok).toBe(true);
    expect(results.find((r) => r.path.endsWith("foundations-test-002-bad.md"))?.ok).toBe(false);
  });
});
