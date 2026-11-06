/**
 * Wiki-side citation ground truth (capability `citation-tool`, Requirement: *Citation
 * Tool Produces a Wiki Citation Validated Against the Wiki Index*).
 *
 * Two levels, one fixture: the RESOLVER (what the index carries, how an id is resolved
 * to an atom, what a refusal reports) and the TOOL calls that ride on it. Test names
 * mirror the spec scenario headings.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWikiCitationResolver } from "../src/wiki-citation.js";
import { createCiteTool } from "../src/cite-tool.js";

let tmp: string;
let wikiDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "cbe-wiki-cite-"));
  wikiDir = path.join(tmp, "wiki");
  await mkdir(path.join(wikiDir, "concept"), { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeAtom(relPath: string, opts: { sources: string; body: string }): Promise<void> {
  const full = path.join(wikiDir, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(
    full,
    `---
type: concept
aliases: []
sources:
${opts.sources}
raw: []
related: []
confidence: high
updated: 2026-08-19
---

${opts.body}
`,
    "utf8"
  );
}

const SWELLER_SOURCE = `  - title: "Cognitive load during problem solving"
    author: "Sweller"
    year: 1988`;

async function writeIndex(entries: string[]): Promise<void> {
  await writeFile(path.join(wikiDir, "index.md"), `# Wiki\n\n${entries.map((e) => `- [[${e}]]`).join("\n")}\n`, "utf8");
}

describe("wiki citation resolver — atom gate", () => {
  it("resolves an id the index carries and reports its headings and sources", async () => {
    await writeAtom("concept/cognitive-load.md", {
      sources: SWELLER_SOURCE,
      body: "## Working memory\n\nText.\n\n## Limits\n\nMore.",
    });
    await writeIndex(["concept/cognitive-load"]);

    const resolver = createWikiCitationResolver(wikiDir);
    expect(await resolver.listAtomIds()).toEqual(["concept/cognitive-load"]);
    const lookup = await resolver.resolveAtom("concept/cognitive-load");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.atom.id).toBe("concept/cognitive-load");
    expect(lookup.atom.headings).toEqual(["Working memory", "Limits"]);
    expect(lookup.atom.sources).toEqual([
      { author: "Sweller", year: 1988, title: "Cognitive load during problem solving", url: null },
    ]);
  });

  it("tolerates a .md suffix and a wikilink wrapper on the id", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);
    const resolver = createWikiCitationResolver(wikiDir);
    for (const ref of ["concept/cognitive-load.md", "[[concept/cognitive-load]]", "  concept/cognitive-load  "]) {
      const lookup = await resolver.resolveAtom(ref);
      expect(lookup.ok, ref).toBe(true);
    }
  });

  it("reports the index's actual entries for an id it does not carry", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("concept/invented");
    expect(lookup.ok).toBe(false);
    if (lookup.ok) return;
    expect(lookup.reason).toBe("unknown");
    expect(lookup.reason === "unknown" ? lookup.candidates : []).toEqual(["concept/cognitive-load"]);
  });

  it("resolves an unambiguous basename to the index's own id", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("cognitive-load");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.atom.id).toBe("concept/cognitive-load");
  });

  it("refuses an ambiguous basename with the matching full ids", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeAtom("method/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## B\n\ny" });
    await writeIndex(["concept/cognitive-load", "method/cognitive-load"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("cognitive-load");
    expect(lookup.ok).toBe(false);
    if (lookup.ok) return;
    expect(lookup.reason).toBe("ambiguous");
    expect(lookup.reason === "ambiguous" ? lookup.candidates : []).toEqual([
      "concept/cognitive-load",
      "method/cognitive-load",
    ]);
  });

  it("prefers an exact wiki-relative id over another atom's matching basename", async () => {
    // `concept/a` is both an index id and (as `a`) another atom's basename. The exact
    // match must win rather than reporting an ambiguity against itself.
    await writeAtom("concept/a.md", { sources: SWELLER_SOURCE, body: "## Exact\n\nx" });
    await writeAtom("method/a.md", { sources: SWELLER_SOURCE, body: "## Other\n\ny" });
    await writeIndex(["concept/a", "method/a"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("concept/a");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.atom.headings).toEqual(["Exact"]);
  });

  it("reports no-wiki for an unbound wiki, a missing index and an index with no atoms", async () => {
    expect((await createWikiCitationResolver(undefined).resolveAtom("x")).ok).toBe(false);
    const unbound = await createWikiCitationResolver(undefined).resolveAtom("x");
    expect(unbound.ok === false && unbound.reason).toBe("no-wiki");

    const noIndex = await createWikiCitationResolver(wikiDir).resolveAtom("concept/cognitive-load");
    expect(noIndex.ok === false && noIndex.reason).toBe("no-wiki");

    await writeIndex([]);
    const emptyIndex = await createWikiCitationResolver(wikiDir).resolveAtom("concept/cognitive-load");
    expect(emptyIndex.ok === false && emptyIndex.reason).toBe("no-wiki");
  });

  it("drops sources that carry no author, so they cannot populate <author year>", async () => {
    await writeAtom("concept/ingested.md", {
      sources: `  - title: "skript-woche-3.pdf"
    ingested: "2026-08-19"`,
      body: "## A\n\nx",
    });
    await writeIndex(["concept/ingested"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("concept/ingested");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.atom.sources).toEqual([]);
  });

  it("keeps an author-carrying source whose year is absent, as year null", async () => {
    await writeAtom("concept/undated.md", {
      sources: `  - title: "Notes"
    author: "Egli"`,
      body: "## A\n\nx",
    });
    await writeIndex(["concept/undated"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("concept/undated");
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.atom.sources).toEqual([{ author: "Egli", year: null, title: "Notes", url: null }]);
  });

  it("treats an atom the validator rejects as an unresolvable id, not as a crash", async () => {
    await writeFile(path.join(wikiDir, "concept", "broken.md"), "no frontmatter at all\n", "utf8");
    await writeIndex(["concept/broken"]);
    const lookup = await createWikiCitationResolver(wikiDir).resolveAtom("concept/broken");
    expect(lookup.ok).toBe(false);
    if (lookup.ok) return;
    expect(lookup.reason).toBe("unknown");
  });
});

type CiteResult = { content: Array<{ text: string }>; details: Record<string, unknown> };

/** `cbe_cite` bound to the fixture wiki and to NO corpus — the wiki route must stand on
 * its own, in a profile where a bare id would refuse. */
async function cite(params: Record<string, unknown>, wiki: string | undefined = wikiDir): Promise<CiteResult> {
  const tool = createCiteTool(null, undefined, createWikiCitationResolver(wiki));
  return (await tool.execute("call-1", params as never, undefined, undefined, {} as never)) as unknown as CiteResult;
}

describe("cbe_cite — Citation Tool Produces a Wiki Citation Validated Against the Wiki Index", () => {
  it("produces a wiki citation validated against the wiki index", async () => {
    await writeAtom("concept/cognitive-load.md", {
      sources: SWELLER_SOURCE,
      body: "## Working memory\n\nText.",
    });
    await writeIndex(["concept/cognitive-load"]);

    const result = await cite({ id: "wiki:concept/cognitive-load", section: "working memory" });
    expect(result.content[0]!.text).toBe("(wiki:concept/cognitive-load § Working memory, Sweller 1988)");
    expect(result.details.kind).toBe("citation");
    expect(result.details.store).toBe("wiki");
    expect(result.details.id).toBe("concept/cognitive-load");
    expect(result.details.section).toBe("Working memory");
  });

  it("refuses an unknown atom id with the index's actual entries", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);

    const result = await cite({ id: "wiki:concept/invented", section: "A" });
    expect(result.details.error).toBe("unknown-atom");
    expect(result.content[0]!.text).not.toContain("(wiki:");
    expect(result.content[0]!.text).toContain("concept/cognitive-load");
    expect(result.details.candidates).toEqual(["concept/cognitive-load"]);
  });

  it("resolves an unambiguous basename and refuses an ambiguous one", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);
    const resolved = await cite({ id: "wiki:cognitive-load", section: "A" });
    // The token carries the INDEX's id, not the basename the model wrote.
    expect(resolved.content[0]!.text).toBe("(wiki:concept/cognitive-load § A, Sweller 1988)");

    await writeAtom("method/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\ny" });
    await writeIndex(["concept/cognitive-load", "method/cognitive-load"]);
    const ambiguous = await cite({ id: "wiki:cognitive-load", section: "A" });
    expect(ambiguous.details.error).toBe("ambiguous-atom");
    expect(ambiguous.content[0]!.text).not.toContain("(wiki:");
    expect(ambiguous.details.candidates).toEqual(["concept/cognitive-load", "method/cognitive-load"]);
  });

  it("keeps the section mandatory for a wiki citation", async () => {
    await writeAtom("concept/cognitive-load.md", {
      sources: SWELLER_SOURCE,
      body: "## Working memory\n\nText.\n\n## Limits\n\nMore.",
    });
    await writeIndex(["concept/cognitive-load"]);

    const result = await cite({ id: "wiki:concept/cognitive-load", section: "Half-remembered heading" });
    expect(result.details.error).toBe("unknown-section");
    expect(result.details.headings).toEqual(["Working memory", "Limits"]);
    // No sectionless fallback: nothing resembling a token is emitted.
    expect(result.content[0]!.text).not.toContain("(wiki:concept/cognitive-load)");
    expect(result.content[0]!.text).toContain("Working memory | Limits");
  });

  it("cites an atom whose sources carry no author without the author element", async () => {
    await writeAtom("concept/ingested.md", {
      sources: `  - title: "skript-woche-3.pdf"
    ingested: "2026-08-19"`,
      body: "## Overview\n\nx",
    });
    await writeIndex(["concept/ingested"]);

    const result = await cite({ id: "wiki:concept/ingested", section: "Overview" });
    expect(result.content[0]!.text).toBe("(wiki:concept/ingested § Overview)");
    expect(result.details.kind).toBe("citation");
  });

  it("yields the explicit n.d. marker for a wiki source without a year", async () => {
    await writeAtom("concept/undated.md", {
      sources: `  - title: "Notes"
    author: "Egli"`,
      body: "## Overview\n\nx",
    });
    await writeIndex(["concept/undated"]);

    const result = await cite({ id: "wiki:concept/undated", section: "Overview" });
    expect(result.content[0]!.text).toBe("(wiki:concept/undated § Overview, Egli n.d.)");
  });

  it("tells a course with no wiki so, rather than refusing as an unknown atom", async () => {
    const unbound = await cite({ id: "wiki:concept/cognitive-load", section: "A" }, undefined);
    expect(unbound.details.error).toBe("no-wiki");
    expect(unbound.content[0]!.text).toMatch(/no wiki index/i);
    expect(unbound.details.candidates).toBeUndefined();

    // A bound wiki directory that carries no index is the same answer.
    const noIndex = await cite({ id: "wiki:concept/cognitive-load", section: "A" });
    expect(noIndex.details.error).toBe("no-wiki");
  });

  it("asks for disambiguation across an atom's genuinely-distinct sources", async () => {
    await writeAtom("concept/multi.md", {
      sources: `  - title: "First"
    author: "Sweller"
    year: 1988
  - title: "Second"
    author: "Sweller"
    year: 1994`,
      body: "## Overview\n\nx",
    });
    await writeIndex(["concept/multi"]);

    const under = await cite({ id: "wiki:concept/multi", section: "Overview" });
    expect(under.details.kind).toBe("needs-disambiguation");
    expect(under.content[0]!.text).toContain("wiki:concept/multi");
    expect(under.content[0]!.text).toContain("Sweller 1988 — First");

    const chosen = await cite({ id: "wiki:concept/multi", section: "Overview", author: "Sweller", year: 1994 });
    expect(chosen.content[0]!.text).toBe("(wiki:concept/multi § Overview, Sweller 1994)");

    const mismatch = await cite({ id: "wiki:concept/multi", section: "Overview", author: "Nobody" });
    expect(mismatch.details.error).toBe("unknown-source");
  });

  it("leaves a bare id on the corpus route", async () => {
    await writeAtom("concept/cognitive-load.md", { sources: SWELLER_SOURCE, body: "## A\n\nx" });
    await writeIndex(["concept/cognitive-load"]);
    // No corpus resolver is bound here, so the corpus route must refuse rather than
    // silently falling through to the wiki.
    const result = await cite({ id: "concept/cognitive-load", section: "A" });
    expect(result.details.error).toBe("unknown-id");
  });
});
