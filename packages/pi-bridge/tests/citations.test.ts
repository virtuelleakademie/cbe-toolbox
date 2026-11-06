import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCitationResolver } from "../src/citations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(__dirname, "../../../corpus");

/** Build a throwaway corpus root containing an index.json with the given document path. */
async function makeCorpusFixture(docPath: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cbe-citations-test-"));
  const body = "---\nsources: []\n---\n# Fixture Doc\n\nBody text.\n";
  await mkdir(path.join(root, "content"), { recursive: true });
  await writeFile(path.join(root, "content", "fixture-doc.md"), body, "utf8");
  const index = {
    "corpus-version": "2026-06",
    documents: [{ id: "fixture-001", title: "Fixture Doc", path: docPath, tags: [] }],
  };
  await writeFile(path.join(root, "index.json"), JSON.stringify(index), "utf8");
  return root;
}

describe("citation resolver", () => {
  it("resolves a known corpus id to its file path and frontmatter", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const hit = resolver.resolve("methodology-001");
    expect(hit).not.toBeNull();
    expect(hit?.title).toBe("The Challenge Based Learning Three-Phase Framework");
    expect(hit?.path).toMatch(/methodology\/.*\.md$/);
    expect(resolver.getVersion()).toBe("2026-11");
  });

  it("returns null for an unknown id", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    expect(resolver.resolve("does-not-exist")).toBeNull();
  });

  it("lists all corpus ids (used to source /cite completions)", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const ids = resolver.listIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("methodology-001");
    // every listed id resolves
    expect(ids.every((id) => resolver.resolve(id) !== null)).toBe(true);
  });

  it("parses inline citation tokens out of a response", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const tokens = resolver.parseCitations(
      "Per (corpus:methodology-001 § 1, …) and also (corpus:foundations-002 § 3, X 2018)"
    );
    expect(tokens.map((t) => t.id)).toEqual(["methodology-001", "foundations-002"]);
  });

  it("resolves the structured sources[] of a multi-source document", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const sources = await resolver.resolveSources("methodology-001");
    // `url` is the stable source identifier the wiki-wins precedence rule
    // matches on (change add-lecturer-wiki-and-course-workspace, Task 1.7).
    expect(sources).toEqual([
      {
        author: "Nichols, M., Cator, K., and Torres, M.",
        year: 2016,
        title: "Challenge Based Learner User Guide",
        url: "https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf",
      },
    ]);
  });

  it("returns [] sources for an unknown id", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    expect(await resolver.resolveSources("does-not-exist")).toEqual([]);
  });

  it("resolves the body headings of a document", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const headings = await resolver.resolveHeadings("methodology-001");
    // The H1 title plus the section headings, heading markers stripped.
    expect(headings).toContain("The Challenge Based Learning Three-Phase Framework");
    expect(headings).toContain("Phase 1: Engage");
    expect(headings).toContain("Phase 2: Investigate");
    expect(headings).toContain("Phase 3: Act");
    // No `#` markers leak into the returned text.
    expect(headings.every((h) => !h.startsWith("#"))).toBe(true);
  });

  it("returns [] headings for an unknown id", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    expect(await resolver.resolveHeadings("does-not-exist")).toEqual([]);
  });
});

// Scenario: Manifest paths resolve against the corpus root (resolver half) —
// capability `corpus-curation`, Requirement: Index manifest with retrieval-ready
// metadata (change fix-corpus-index-path-semantics).
describe("citation resolver — corpus-root-relative path resolution", () => {
  it("loads a document body from a corpus-root-relative path", async () => {
    const root = await makeCorpusFixture("content/fixture-doc.md");
    try {
      const resolver = await createCitationResolver(root);
      const body = await resolver.loadBody("fixture-001");
      expect(body).toContain("# Fixture Doc");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails loudly on a legacy corpus/-prefixed path (no parent-directory compensation)", async () => {
    // A stale repo-root-relative index must not be silently compensated —
    // resolution is strictly <corpusRoot>/<path>, so the legacy form errors.
    const root = await makeCorpusFixture(`${path.basename(corpusRoot)}/content/fixture-doc.md`);
    try {
      const resolver = await createCitationResolver(root);
      await expect(resolver.loadBody("fixture-001")).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
