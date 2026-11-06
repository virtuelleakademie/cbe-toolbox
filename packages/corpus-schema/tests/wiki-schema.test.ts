/**
 * Wiki schema variant + shared-engine alignment + isolation invariant
 * (capability `lecturer-wiki`, Requirements: Atom Frontmatter Schema, Validator
 * Alignment with the Corpus Schema Discipline, Wiki-Corpus Isolation Invariant;
 * capability `corpus-curation`, Requirement: Wiki-Corpus Isolation Invariant).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { WikiAtomSchema } from "../src/schema.js";
import { validateFile, validateDirectory } from "../src/validate.js";
import { lintWikiDirectory } from "../src/wiki-lint.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "cbe-wiki-schema-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const VALID_ATOM = `---
type: concept
aliases:
  - kognitive Belastung
sources:
  - title: "skript.pdf"
    ingested: "2026-07-07"
    author: "Sweller"
    year: 1988
    url: "https://example.org/sweller-1988"
raw:
  - raw/skript.md
related:
  - "[[constructive-alignment]]"
confidence: high
updated: 2026-07-07
---

Cognitive load is the working-memory demand of a task.
`;

async function writeAtom(rel: string, content: string): Promise<string> {
  const file = path.join(tmp, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

describe("Atom Frontmatter Schema", () => {
  it("accepts a fully specified ingested atom", async () => {
    const file = await writeAtom("wiki/concepts/cognitive-load.md", VALID_ATOM);
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
  });

  // Scenario: Self-authored atom carries explicit empty provenance
  it("accepts explicit empty sources/raw arrays on a self-authored atom", async () => {
    const file = await writeAtom(
      "wiki/concepts/own-idea.md",
      `---
type: concept
aliases: []
sources: []
raw: []
related: []
confidence: medium
updated: 2026-07-07
---

My own framing of the topic.
`
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
  });

  it("rejects omitted sources/raw fields — empty must be explicit, not absent", async () => {
    const file = await writeAtom(
      "wiki/concepts/forgot-fields.md",
      `---
type: concept
aliases: []
related: []
confidence: low
updated: 2026-07-07
---

Body.
`
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/sources/);
      expect(result.errors.join("\n")).toMatch(/raw/);
    }
  });

  // Scenario: Wiki atom with missing mandatory frontmatter is rejected —
  // same engine, analogous error shape as a corpus rejection.
  it("wiki atom with missing mandatory frontmatter is rejected by the same engine as corpus documents", async () => {
    const wikiFile = await writeAtom(
      "wiki/concepts/broken.md",
      `---
type: concept
---

Body.
`
    );
    const corpusFile = await writeAtom(
      "corpus/broken.md",
      `---
id: broken
---

Body.
`
    );
    const wikiResult = await validateFile(wikiFile, "wiki");
    const corpusResult = await validateFile(corpusFile, "corpus");
    expect(wikiResult.ok).toBe(false);
    expect(corpusResult.ok).toBe(false);
    // Identical rejection path: same error format `<field>: <message>`.
    if (!wikiResult.ok && !corpusResult.ok) {
      expect(wikiResult.errors[0]).toMatch(/^[a-z-]+: /i);
      expect(corpusResult.errors[0]).toMatch(/^[a-z-]+: /i);
    }
  });

  it("schema variant is enforced by ONE engine — validateFile is the same function for both stores", () => {
    // The engine is parameterized by variant, not duplicated: this test simply
    // locks that both calls above went through the identical implementation.
    expect(validateFile.length).toBeGreaterThanOrEqual(1);
    expect(WikiAtomSchema.safeParse({}).success).toBe(false);
  });
});

describe("Wiki-Corpus Isolation Invariant", () => {
  // Scenario: Wiki atom carries no corpus references (body token)
  it("rejects a (corpus:…) token inside a wiki atom body, pointing at the isolation invariant", async () => {
    const file = await writeAtom(
      "wiki/concepts/leaky.md",
      VALID_ATOM.replace(
        "Cognitive load is",
        "As shown in (corpus:foundations-001 § Basics, Sweller 1988), cognitive load is"
      )
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/isolation invariant/i);
  });

  it("rejects corpus-related/corpus-refs frontmatter keys on a wiki atom", async () => {
    for (const key of ["corpus-related", "corpus-refs", "corpus_links"]) {
      const file = await writeAtom(
        `wiki/concepts/leaky-${key}.md`,
        VALID_ATOM.replace("confidence: high", `confidence: high\n${key}: []`)
      );
      const result = await validateFile(file, "wiki");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join("\n")).toMatch(/isolation invariant/i);
    }
  });

  // Scenario (corpus-curation): Corpus document carries no wiki references
  it("rejects a (wiki:…) token inside a corpus document body", async () => {
    const file = await writeAtom(
      "corpus/leaky.md",
      `---
id: leaky-doc
title: "Leaky"
category: foundations
version: 1.0.0
sources: []
license: CC-BY-4.0
updated: 2026-07-07
tags: []
---

See (wiki:cognitive-load § Basics) for the lecturer's own notes.
`
    );
    const result = await validateFile(file, "corpus");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/isolation invariant/i);
  });

  it("rejects wiki-related/wiki-refs frontmatter keys on a corpus document", async () => {
    const file = await writeAtom(
      "corpus/leaky-keys.md",
      `---
id: leaky-keys
title: "Leaky keys"
category: foundations
version: 1.0.0
sources: []
license: CC-BY-4.0
updated: 2026-07-07
tags: []
wiki-related:
  - cognitive-load
---

Body.
`
    );
    const result = await validateFile(file, "corpus");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/isolation invariant/i);
  });

  // Scenario: Cross-course wikilink is not an isolation violation
  it("accepts cross-course wiki-internal [[wikilinks]]", async () => {
    const file = await writeAtom(
      "wiki/concepts/cross-course.md",
      VALID_ATOM.replace(
        "Cognitive load is the working-memory demand of a task.",
        "See also [[../../physik-hs26/wiki/concepts/mechanik]] for the physics framing."
      )
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
  });
});

describe("wiki lint layer", () => {
  // Scenario: Dangling raw provenance is flagged
  it("flags a raw provenance target that no longer exists (source integrity)", async () => {
    await writeAtom("course/wiki/concepts/cognitive-load.md", VALID_ATOM);
    await writeAtom("course/wiki/index.md", "# Index\n\n## concepts\n- [[concepts/cognitive-load]]\n");
    // raw/skript.md deliberately NOT created.
    const { findings } = await lintWikiDirectory(path.join(tmp, "course/wiki"));
    expect(findings.some((f) => f.finding === "dangling-raw" && /raw\/skript\.md/.test(f.message))).toBe(true);
  });

  it("does not flag an atom whose raw target exists", async () => {
    await writeAtom("course/raw/skript.md", "---\nsource: s\nextracted_from: inbox/s\nstatus: compiled\n---\nx");
    await writeAtom("course/wiki/concepts/cognitive-load.md", VALID_ATOM);
    await writeAtom("course/wiki/index.md", "# Index\n\n## concepts\n- [[concepts/cognitive-load]]\n");
    const { findings } = await lintWikiDirectory(path.join(tmp, "course/wiki"));
    expect(findings.filter((f) => f.finding === "dangling-raw")).toEqual([]);
  });

  // lecturer-wiki, Requirement: Wiki Index for Stage-1 Retrieval — orphan flagging
  it("flags on-disk atoms missing from wiki/index.md (orphans)", async () => {
    await writeAtom("course/raw/skript.md", "---\nsource: s\nextracted_from: inbox/s\nstatus: compiled\n---\nx");
    await writeAtom("course/wiki/concepts/cognitive-load.md", VALID_ATOM);
    await writeAtom("course/wiki/index.md", "# Index\n\n(empty)\n");
    const { findings } = await lintWikiDirectory(path.join(tmp, "course/wiki"));
    expect(findings.some((f) => f.finding === "unindexed-atom")).toBe(true);
  });

  it("index.md itself is not treated as an atom", async () => {
    await writeAtom("course/wiki/index.md", "# Index\n");
    const results = await validateDirectory(path.join(tmp, "course/wiki"), "wiki");
    expect(results).toEqual([]);
  });
});

// lecturer-wiki, Requirement: Merge-on-Reingest Instead of Duplicate Atoms —
// deterministic halves of the merge and conflict paths: a merged atom
// (## From sections, extended sources/raw) and a conflicted atom
// (## Conflicts + confidence: low) are valid wiki atoms; the behavioural
// halves live in the skill bundle instructions + the skill eval.
describe("merge-on-reingest atom shapes", () => {
  it("re-ingesting a topic merges into the existing atom: merged shape validates", async () => {
    const file = await writeAtom(
      "wiki/concepts/merged.md",
      `---
type: concept
aliases:
  - cognitive load
sources:
  - title: "skript.pdf"
    ingested: "2026-07-01"
  - title: "paper.pdf"
    ingested: "2026-07-07"
    author: "Sweller"
    year: 1988
raw:
  - raw/skript.md
  - raw/paper.md
related: []
confidence: high
updated: 2026-07-07
---

Base content.

## From paper.pdf

Additional evidence from the second source.
`
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const doc = result.doc as { sources: unknown[]; raw: string[] };
      expect(doc.sources.length).toBe(2); // sources[] extended, no duplicate atom
      expect(doc.raw).toEqual(["raw/skript.md", "raw/paper.md"]);
      expect(result.body).toContain("## From paper.pdf");
    }
  });

  it("conflicting sources produce a Conflicts section with confidence low: conflicted shape validates", async () => {
    const file = await writeAtom(
      "wiki/concepts/conflicted.md",
      VALID_ATOM.replace("confidence: high", "confidence: low").replace(
        "Cognitive load is the working-memory demand of a task.",
        "Cognitive load is the working-memory demand of a task.\n\n## Conflicts\n\n- skript.pdf claims X; paper.pdf claims not-X. Both retained for the lecturer to resolve."
      )
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.doc as { confidence: string }).confidence).toBe("low");
      expect(result.body).toContain("## Conflicts");
    }
  });
});

/**
 * Atom Source Year Normalisation (capability `lecturer-wiki`) — the ingestion
 * blocker of UX run 2: the atomization subagent wrote `year: "2023"` and the
 * strict `z.number()` rejected the atom, which the ingestion runner then rolled
 * back entirely.
 */
describe("Atom Source Year Normalisation", () => {
  function atomWithYear(spelling: string): string {
    return VALID_ATOM.replace("    year: 1988\n", spelling ? `    year: ${spelling}\n` : "");
  }

  async function yearOf(spelling: string, name: string): Promise<{ ok: boolean; year?: unknown }> {
    const file = await writeAtom(`wiki/concepts/${name}.md`, atomWithYear(spelling));
    const result = await validateFile(file, "wiki");
    if (!result.ok) return { ok: false };
    return { ok: true, year: (result.doc.sources[0] as { year?: unknown }).year };
  }

  // Scenario: A four-digit year in text form validates as a year
  it("accepts a quoted four-digit year and normalises it to a number", async () => {
    expect(await yearOf('"2023"', "quoted")).toEqual({ ok: true, year: 2023 });
  });

  it("accepts a four-digit year with surrounding whitespace", async () => {
    expect(await yearOf('"  2023  "', "padded")).toEqual({ ok: true, year: 2023 });
  });

  it("keeps a numeric year a number", async () => {
    expect(await yearOf("1988", "numeric")).toEqual({ ok: true, year: 1988 });
  });

  // Scenario: A year that is not a clean four-digit year counts as no year
  it.each([
    ['""', "empty"],
    ['"n.d."', "nd"],
    ['"circa 2020"', "circa"],
    ['"2023-04"', "partial"],
    ['"20233"', "fivedigit"],
    ["1899", "toolow"],
    ["3025", "toohigh"],
  ])("treats %s as no year instead of rejecting the atom", async (spelling, name) => {
    expect(await yearOf(spelling, name)).toEqual({ ok: true, year: undefined });
  });

  it("an omitted year stays absent", async () => {
    expect(await yearOf("", "omitted")).toEqual({ ok: true, year: undefined });
  });
});

/**
 * Atom Source URL Loss-Avoidance (capability `lecturer-wiki`) — the sibling
 * field of the year: `url` is written by the same atomization subagent under no
 * spelling constraint, so an unusable value must cost the field, never the atom
 * the ingestion runner would otherwise roll back.
 */
describe("Atom Source URL Loss-Avoidance", () => {
  async function urlOf(spelling: string, name: string): Promise<{ ok: boolean; url?: unknown; notices?: string[] }> {
    const file = await writeAtom(
      `wiki/concepts/${name}.md`,
      VALID_ATOM.replace('    url: "https://example.org/sweller-1988"\n', spelling ? `    url: ${spelling}\n` : "")
    );
    const result = await validateFile(file, "wiki");
    if (!result.ok) return { ok: false };
    return { ok: true, url: (result.doc.sources[0] as { url?: unknown }).url, notices: result.notices };
  }

  // Scenario: A usable source url is kept unchanged
  it("keeps a well-formed url and reports no loss", async () => {
    expect(await urlOf('"https://example.org/x"', "wellformed")).toEqual({
      ok: true,
      url: "https://example.org/x",
      notices: [],
    });
  });

  it("tolerates surrounding whitespace on a well-formed url", async () => {
    const out = await urlOf('"  https://example.org/x  "', "padded-url");
    expect(out.ok).toBe(true);
    expect(out.url).toBe("https://example.org/x");
  });

  // Scenario: A source url that is not a usable url counts as no url
  it.each([
    ['"n/a"', "na"],
    ['"www.example.com"', "schemeless"],
    ['"../raw/skript.md"', "relative"],
    ['""', "empty-url"],
    ["2023", "numeric-url"],
  ])("treats %s as no url instead of rejecting the atom", async (spelling, name) => {
    const out = await urlOf(spelling, name);
    expect(out.ok).toBe(true);
    expect(out.url).toBeUndefined();
  });

  // The atom survives, but the drop is not silent — the verdict names it and the
  // ingestion runner carries it into its per-run feedback.
  it("names the dropped url in the validator's notices", async () => {
    const out = await urlOf('"n/a"', "notice");
    expect(out.notices?.join("\n")).toMatch(/sources\.0\.url/);
  });

  it("an omitted url stays absent and raises no notice", async () => {
    expect(await urlOf("", "omitted-url")).toEqual({ ok: true, url: undefined, notices: [] });
  });

  it("the corpus schema stays strict — a malformed url is still a rejection there", async () => {
    const file = await writeAtom(
      "corpus/strict-url.md",
      `---
id: strict-url
title: "Strict"
category: foundations
version: 1.0.0
sources:
  - author: "Sweller"
    year: 1988
    title: "Cognitive Load"
    url: "n/a"
    license: CC-BY-4.0
license: CC-BY-4.0
updated: 2026-07-07
tags: []
---

Body.
`
    );
    const result = await validateFile(file, "corpus");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/url/);
  });
});

/**
 * Requirement: Atom Related-Wikilink Spelling Normalisation (capability
 * `lecturer-wiki`).
 *
 * The fixtures under `tests/fixtures-wikilinks/` are the guard against a
 * placebo: they carry `related:` exactly as `skills/wiki/SKILL.md` instructs it,
 * unquoted, and they FAIL against the pre-change schema — YAML delivers each
 * entry as a nested sequence, and `z.array(z.string())` rejects the atom, which
 * the ingestion runner then rolls back.
 */
describe("Atom Related-Wikilink Spelling Normalisation", () => {
  const fixture = (name: string) => path.join(__dirname, "fixtures-wikilinks", name);

  // The parse itself is what the instruction walked into — recorded so the
  // premise of the whole requirement stays visible if YAML ever changes.
  it("YAML delivers an unquoted wikilink as a nested sequence, not a string", async () => {
    const file = await writeAtom("wiki/concepts/parse.md", await readFile(fixture("block-form.md"), "utf8"));
    const raw = matter(await readFile(file, "utf8")).data as { related: unknown };
    // `[[x]]` is a sequence holding a sequence holding the link target — which
    // is exactly why `z.array(z.string())` rejected the atom.
    expect(raw.related).toEqual([[["concept/cognitive-load"]], [["method/think-pair-share"]]]);
  });

  // Scenario: A wikilink written as the instructions ask validates as a wikilink
  it("normalises the block spelling to the wikilink strings it was written as", async () => {
    const result = await validateFile(fixture("block-form.md"), "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.related).toEqual(["[[concept/cognitive-load]]", "[[method/think-pair-share]]"]);
      expect(result.notices).toEqual([]);
    }
  });

  it("normalises the flow spelling identically — same parse, same result", async () => {
    const result = await validateFile(fixture("flow-form.md"), "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.related).toEqual(["[[concept/cognitive-load]]", "[[method/think-pair-share]]"]);
    }
  });

  // Scenario: A wikilink written as the instructions ask validates as a wikilink
  // — the shallower parse. ONE link in flow form nests one level, not two,
  // because the outer sequence IS the value of the field. Recovery must not
  // depend on layout and link count.
  it("normalises a single flow-form wikilink, whose parse nests one level less", async () => {
    const raw = matter(await readFile(fixture("single-link-flow.md"), "utf8")).data as { related: unknown };
    expect(raw.related).toEqual([["concept/cognitive-load"]]);

    const result = await validateFile(fixture("single-link-flow.md"), "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.related).toEqual(["[[concept/cognitive-load]]"]);
      expect(result.notices).toEqual([]);
    }
  });

  it("normalises a single block-form wikilink, the same link written the other way", async () => {
    const file = await writeAtom(
      "wiki/concepts/single-block.md",
      `---
type: concept
aliases: []
sources: []
raw: []
related:
  - [[concept/cognitive-load]]
confidence: medium
updated: 2026-07-07
---

One unquoted wikilink in block form.
`
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.related).toEqual(["[[concept/cognitive-load]]"]);
  });

  // The trade the one-level rule accepts, pinned rather than hidden: a block
  // item written with ONE bracket pair has the SAME parse as a single unquoted
  // `[[x]]` in flow form, so recovery cannot tell them apart and adds a bracket
  // pair its author did not write. Dropping it instead would drop the flow form
  // with it.
  it("a single-bracket block item collides with the flow form and is recovered as a wikilink", async () => {
    const raw = matter(await readFile(fixture("single-bracket-block.md"), "utf8")).data as { related: unknown };
    const flow = matter(await readFile(fixture("single-link-flow.md"), "utf8")).data as { related: unknown };
    expect(raw.related).toEqual(flow.related); // the collision itself

    const result = await validateFile(fixture("single-bracket-block.md"), "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.related).toEqual(["[[concept/cognitive-load]]"]);
      expect(result.notices).toEqual([]);
    }
  });

  // Scenario: An entry that is not a recoverable wikilink counts as no relation
  it("drops an entry no parse recovers, keeps the atom, and names the loss", async () => {
    const result = await validateFile(fixture("unrecoverable.md"), "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The quoted wikilink survives untouched; the two unrecoverable entries are gone.
      expect(result.doc.related).toEqual(["[[concept/cognitive-load]]"]);
      expect(result.notices.join("\n")).toMatch(/related\.1/);
      expect(result.notices.join("\n")).toMatch(/related\.2/);
    }
  });

  it("leaves an already-quoted wikilink string exactly as written", async () => {
    const file = await writeAtom(
      "wiki/concepts/quoted.md",
      VALID_ATOM.replace('  - "[[constructive-alignment]]"', '  - "[[method/think-pair-share]]"')
    );
    const result = await validateFile(file, "wiki");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.related).toEqual(["[[method/think-pair-share]]"]);
      expect(result.notices).toEqual([]);
    }
  });

  // The instruction is the defect's origin: an atom written exactly as
  // `skills/wiki/SKILL.md` shows must parse as a list of strings on its own,
  // without leaning on the normalisation above.
  it("the wiki skill instructs a spelling YAML delivers as strings", async () => {
    const skill = await readFile(path.join(__dirname, "..", "..", "..", "skills", "wiki", "SKILL.md"), "utf8");
    const templateLines = [...skill.matchAll(/^\s*related:.*$/gm)].map((m) => m[0].trim());
    expect(templateLines.length).toBeGreaterThan(0);
    for (const line of templateLines) {
      // The template's field is empty and carries its EXAMPLE in the trailing
      // YAML comment, so the value and the example are parsed separately —
      // stripping the comment and parsing `related: []` guards nothing.
      const split = /^(related:[^#]*?)\s*#\s*(.*)$/.exec(line);
      expect(split, line).not.toBeNull();
      const [, value, comment] = split!;
      const parsedValue = matter(`---\n${value}\n---\n`).data as { related: unknown };
      expect(Array.isArray(parsedValue.related)).toBe(true);
      for (const entry of parsedValue.related as unknown[]) expect(typeof entry).toBe("string");

      // Every wikilink the comment shows must be shown quoted, and must parse
      // as the string it is written as.
      const shownLinks = [...comment!.matchAll(/"?\[\[[^\]]+\]\]"?/g)].map((m) => m[0]);
      expect(shownLinks.length, comment).toBeGreaterThan(0);
      for (const shown of shownLinks) {
        expect(shown.startsWith('"') && shown.endsWith('"'), shown).toBe(true);
        const parsed = matter(`---\nrelated: [${shown}]\n---\n`).data as { related: unknown };
        expect(parsed.related).toEqual([shown.slice(1, -1)]);
      }
    }
    // and the prose shows the same quoted form in both spellings it asks for —
    // the flow sequence and the block item of the cross-referencing step
    expect(skill).toMatch(/related: \["\[\[[^"]+\]\]"\]/);
    expect(skill).toMatch(/- "\[\[[^"]+\]\]"/);
  });
});
