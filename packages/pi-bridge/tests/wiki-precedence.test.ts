/**
 * Wiki-wins precedence (capability `cbe-skill`, Requirement: Citation
 * Grounding — Scenario: Wiki atom wins when both stores share the same source).
 * Deterministic retrieval-stage half in pi-bridge: the cbe_cite gate refuses a
 * corpus token for a wiki-covered source and points at the wiki: scheme.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCiteTool } from "../src/cite-tool.js";
import { createWikiPrecedenceLookup, scanWikiSourceUrls } from "../src/wiki-retrieval.js";
import { createWikiCitationResolver } from "../src/wiki-citation.js";
import type { CitationResolver } from "../src/citations.js";

let tmp: string;
let wikiDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "cbe-precedence-"));
  wikiDir = path.join(tmp, "wiki");
  await mkdir(path.join(wikiDir, "concept"), { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const SWELLER_URL = "https://example.org/sweller-1988";

async function writeSwellerAtom(): Promise<void> {
  await writeFile(
    path.join(wikiDir, "concept", "cognitive-load.md"),
    `---
type: concept
aliases: []
sources:
  - title: "Cognitive load during problem solving"
    author: "Sweller"
    year: 1988
    url: "${SWELLER_URL}"
    ingested: "2026-07-07"
raw:
  - raw/sweller.md
related: []
confidence: high
updated: 2026-07-07
---

## Sweller

The lecturer's own atomization of Sweller 1988.
`,
    "utf8"
  );
}

/** The index entry that makes the atom on disk a citable atom. Precedence is
 * index-backed: without this line the atom exists as a file but not as a citable atom,
 * and the lookup must not name it (see the disk-present / index-absent case below). */
async function writeWikiIndex(): Promise<void> {
  await writeFile(path.join(wikiDir, "index.md"), "# Wiki\n\n- [[concept/cognitive-load]]\n", "utf8");
}

/** Corpus resolver stub: one document whose single source shares Sweller's URL. */
function resolverWithSwellerSource(): CitationResolver {
  return {
    getVersion: () => "2026-07",
    resolve: (id) =>
      id === "foundations-001" ? { id, title: "Foundations", path: "foundations-001.md", tags: [] } : null,
    listIds: () => ["foundations-001"],
    parseCitations: () => [],
    loadBody: async () => "# Basics\n\nBody.",
    resolveSources: async () => [
      { author: "Sweller", year: 1988, title: "Cognitive load during problem solving", url: SWELLER_URL },
    ],
    resolveHeadings: async () => ["Basics"],
  };
}

type CiteResult = { content: Array<{ text: string }>; details: Record<string, unknown> };

describe("wiki atom wins when both stores share the same source", () => {
  it("cbe_cite refuses the corpus token and points at the wiki: scheme", async () => {
    await writeSwellerAtom();
    await writeWikiIndex();
    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir));
    const result = (await tool.execute("t1", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;

    expect(result.details.kind).toBe("wiki-precedence");
    // change `cite-the-lecturers-wiki`: the WIKI-RELATIVE id the index writes, not the
    // bare stem — the id form `cbe_wiki` selects by and `cbe_cite`'s wiki route resolves.
    expect(result.details.atomId).toBe("concept/cognitive-load");
    const text = result.content[0]!.text;
    // The refusal suppresses the corpus document for this retrieval step …
    expect(text).toMatch(/Do not emit a \(corpus:foundations-001/);
    // … and instructs the wiki: scheme so the lecturer recognises their material.
    expect(text).toContain("(wiki:concept/cognitive-load § <section>, <author year>)");
    expect(text).toContain("concept/cognitive-load.md");
  });

  // capability `citation-tool`, Requirement: *Citation Tool Produces a Wiki Citation
  // Validated Against the Wiki Index*, Scenario: *The precedence refusal points at the
  // route the tool offers*. Before this change the refusal named a token shape with no
  // route behind it AND named the atom by a stem nothing else in the product accepts,
  // so obeying it meant hand-writing a token — the failure mode the corpus route had
  // already been rebuilt to remove.
  it("the precedence refusal names the cbe_cite call, and the id it names resolves", async () => {
    await writeSwellerAtom();
    await writeWikiIndex();
    const wikiCitations = createWikiCitationResolver(wikiDir);
    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir), wikiCitations);
    const refusal = (await tool.execute("t4", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;

    const text = refusal.content[0]!.text;
    expect(text).toContain('call cbe_cite again with `id: "wiki:concept/cognitive-load"`');

    // The named id is one the wiki route actually resolves — refusal and route agree.
    const namedId = refusal.details.atomId as string;
    const token = (await tool.execute("t5", {
      id: `wiki:${namedId}`,
      section: "Sweller",
    })) as unknown as CiteResult;
    expect(token.details.kind).toBe("citation");
    expect(token.content[0]!.text).toBe("(wiki:concept/cognitive-load § Sweller, Sweller 1988)");
  });

  it("without a covering wiki atom the corpus token is emitted normally", async () => {
    // No atom written — same corpus source, empty wiki.
    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir));
    const result = (await tool.execute("t2", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;
    expect(result.details.kind).toBe("citation");
    expect(result.content[0]!.text).toBe("(corpus:foundations-001 § Basics, Sweller 1988)");
  });

  // capability `citation-tool`, Requirement: *Citation Tool Produces a Wiki Citation
  // Validated Against the Wiki Index*, Scenario: *An atom the index does not carry
  // raises no precedence*. The atom is on disk with the shared source, but the index
  // does not reference it — so `cbe_cite`'s wiki route would refuse it. Suppressing the
  // corpus token here would leave the model with no citable route at all, which is worse
  // than the hand-written token this route exists to remove.
  it("an atom on disk that the index does not carry raises no precedence", async () => {
    await writeSwellerAtom();
    await writeFile(path.join(wikiDir, "index.md"), "# Wiki\n\nNo atoms referenced yet.\n", "utf8");
    const wikiCitations = createWikiCitationResolver(wikiDir);
    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir), wikiCitations);

    const result = (await tool.execute("t6", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;
    expect(result.details.kind).toBe("citation");
    expect(result.content[0]!.text).toBe("(corpus:foundations-001 § Basics, Sweller 1988)");

    // And the wiki route agrees with the lookup: the same atom is not citable either.
    const refused = (await tool.execute("t7", {
      id: "wiki:concept/cognitive-load",
      section: "Sweller",
    })) as unknown as CiteResult;
    expect(refused.details.kind).toBe("citation-refusal");
  });

  it("a missing wiki index raises no precedence even when the atom is on disk", async () => {
    await writeSwellerAtom();
    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir));
    const result = (await tool.execute("t8", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;
    expect(result.details.kind).toBe("citation");
  });

  it("a wiki atom with a DIFFERENT source url does not suppress the corpus document", async () => {
    await writeSwellerAtom();
    await writeWikiIndex();
    // Rewrite the atom's url to another paper.
    const atomFile = path.join(wikiDir, "concept", "cognitive-load.md");
    const { readFile } = await import("node:fs/promises");
    const original = await readFile(atomFile, "utf8");
    await writeFile(atomFile, original.replace(SWELLER_URL, "https://example.org/other-paper"), "utf8");

    const tool = createCiteTool(resolverWithSwellerSource(), createWikiPrecedenceLookup(wikiDir));
    const result = (await tool.execute("t3", {
      id: "foundations-001",
      section: "Basics",
    })) as unknown as CiteResult;
    expect(result.details.kind).toBe("citation");
  });

  it("url matching is trailing-slash and case tolerant", async () => {
    await writeSwellerAtom();
    await writeWikiIndex();
    const lookup = createWikiPrecedenceLookup(wikiDir);
    const hit = await lookup([`${SWELLER_URL.toUpperCase()}/`]);
    expect(hit?.atomId).toBe("concept/cognitive-load");
  });

  it("scanWikiSourceUrls skips atoms without source urls", async () => {
    await writeFile(
      path.join(wikiDir, "concept", "self-authored.md"),
      `---
type: concept
aliases: []
sources: []
raw: []
related: []
confidence: medium
updated: 2026-07-07
---

Own idea.
`,
      "utf8"
    );
    const entries = await scanWikiSourceUrls(wikiDir);
    expect(entries).toEqual([]);
  });
});
