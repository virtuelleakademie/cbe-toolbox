/**
 * Tests for the deterministic `cbe_cite` tool.
 *
 * Capability `citation-tool`. Test names mirror the spec scenario headings.
 *
 * The corpus is purely versioned content: `cbe_cite` emits a bare canonical token
 * `(corpus:<id> § <section>, <author year>)` with no suffix or status marker.
 * Valid-intent / multi-source cases run against the real dev corpus (ground
 * truth); the missing-year and source-less cases use a synthetic in-memory resolver.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCitationResolver,
  type CitationResolver,
  type CitationHit,
  type CitationSource,
} from "../src/citations.js";
import { createCiteTool, CiteParamsSchema } from "../src/cite-tool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(__dirname, "../../../corpus");

type CiteResult = Awaited<ReturnType<ReturnType<typeof createCiteTool>["execute"]>>;

async function run(resolver: CitationResolver | null, params: Record<string, unknown>): Promise<CiteResult> {
  const tool = createCiteTool(resolver);
  return tool.execute("call-1", params as never, undefined, undefined, {} as never);
}

function text(result: CiteResult): string {
  return (result.content[0] as { text: string }).text;
}

function details(result: CiteResult): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

/** A minimal in-memory resolver for synthetic fixtures. */
function fakeResolver(fixture: { hit: CitationHit; headings: string[]; sources: CitationSource[] }): CitationResolver {
  return {
    getVersion: () => "2026-06",
    resolve: (id) => (id === fixture.hit.id ? fixture.hit : null),
    listIds: () => [fixture.hit.id],
    parseCitations: () => [],
    loadBody: async () => null,
    resolveSources: async (id) => (id === fixture.hit.id ? fixture.sources : []),
    resolveHeadings: async (id) => (id === fixture.hit.id ? fixture.headings : []),
  };
}

const devHit: CitationHit = {
  id: "dev-001",
  title: "Dev",
  path: "x.md",
  tags: [],
};

describe("cbe_cite — Deterministic Citation Tool Emits the Canonical Token", () => {
  it("returns the bare canonical token for valid intent", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, {
      id: "methodology-001",
      section: "Phase 1: Engage",
      author: "Nichols, M., Cator, K., and Torres, M.",
      year: 2016,
    });
    expect(text(result)).toBe(
      "(corpus:methodology-001 § Phase 1: Engage, Nichols, M., Cator, K., and Torres, M. 2016)"
    );
    expect(text(result)).not.toContain("[dev-corpus");
    expect(details(result)).toMatchObject({
      kind: "citation",
      id: "methodology-001",
      section: "Phase 1: Engage",
      author: "Nichols, M., Cator, K., and Torres, M.",
      year: 2016,
    });
    expect(details(result)).not.toHaveProperty("corpus-track");
    expect(details(result)).not.toHaveProperty("review-status");
  });

  it("emits no suffix or status marker of any kind", async () => {
    const resolver = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [{ author: "Smith", year: 2020, title: "T" }],
    });
    const result = await run(resolver, { id: "dev-001", section: "Intro" });
    expect(text(result)).toBe("(corpus:dev-001 § Intro, Smith 2020)");
    expect(text(result)).not.toMatch(/\[.*\]/);
  });

  it("emits one single-section token per call (two sections need two calls)", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const a = await run(resolver, {
      id: "methodology-001",
      section: "Phase 1: Engage",
      author: "Nichols, M., Cator, K., and Torres, M.",
      year: 2016,
    });
    const b = await run(resolver, {
      id: "methodology-001",
      section: "Phase 2: Investigate",
      author: "Nichols, M., Cator, K., and Torres, M.",
      year: 2016,
    });
    expect(text(a)).toContain("§ Phase 1: Engage,");
    expect(text(b)).toContain("§ Phase 2: Investigate,");
    for (const t of [text(a), text(b)]) {
      const sectionPart = t.slice(t.indexOf("§") + 1, t.indexOf(","));
      expect(sectionPart).not.toMatch(/ \/ | AND | & | \+ /);
    }
  });
});

describe("cbe_cite — Validates Against Corpus Ground Truth", () => {
  it("refuses a fabricated id and emits no token", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, { id: "totally-made-up-999", section: "Intro" });
    expect(details(result).error).toBe("unknown-id");
    expect(text(result)).not.toMatch(/^\(corpus:/);
  });

  it("refuses an unknown section with the real headings", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, { id: "methodology-001", section: "Nonexistent Heading" });
    expect(details(result).error).toBe("unknown-section");
    expect(details(result).headings).toContain("Phase 1: Engage");
    expect(text(result)).not.toMatch(/^\(corpus:/);
  });

  it("refuses an author/year mismatch with candidate sources", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, {
      id: "methodology-001",
      section: "Phase 1: Engage",
      author: "Nobody In Particular",
      year: 1999,
    });
    expect(details(result).error).toBe("unknown-source");
    const candidates = details(result).candidates as CitationSource[];
    expect(candidates.map((c) => c.author)).toContain("Nichols, M., Cator, K., and Torres, M.");
    expect(text(result)).not.toMatch(/^\(corpus:/);
  });

  it("yields the explicit n.d. marker when the source has no year, never a placeholder", async () => {
    const noYear = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [{ author: "Anon", year: null, title: "T" }],
    });
    const result = await run(noYear, { id: "dev-001", section: "Intro" });
    expect(text(result)).toBe("(corpus:dev-001 § Intro, Anon n.d.)");

    const withYear = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [{ author: "Anon", year: 2021, title: "T" }],
    });
    const yr = await run(withYear, { id: "dev-001", section: "Intro" });
    expect(text(yr)).toContain("Anon 2021");
    expect(text(yr)).not.toContain("n.d.");
  });

  it("emits a token without an author element for a source-less document", async () => {
    const resolver = fakeResolver({ hit: devHit, headings: ["Intro"], sources: [] });
    const result = await run(resolver, { id: "dev-001", section: "Intro" });
    expect(text(result)).toBe("(corpus:dev-001 § Intro)");
    expect(details(result).kind).toBe("citation");
    expect(details(result).error).toBeUndefined();
  });
});

describe("cbe_cite — Disambiguates Under-Specified Source Intent", () => {
  it("resolves a single-source document without an author argument", async () => {
    const resolver = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [{ author: "Solo Author", year: 2019, title: "T" }],
    });
    const result = await run(resolver, { id: "dev-001", section: "Intro" });
    expect(text(result)).toBe("(corpus:dev-001 § Intro, Solo Author 2019)");
  });

  it("requests disambiguation for a multi-source document and emits no token", async () => {
    // methodology-012 carries the PIONEER document and the CBL Guide as its two sources.
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, { id: "methodology-012", section: "Summary" });
    expect(details(result).kind).toBe("needs-disambiguation");
    const candidates = details(result).candidates as CitationSource[];
    expect(candidates.map((c) => c.author)).toEqual(["PIONEER Project Team", "Nichols, M., Cator, K., and Torres, M."]);
    expect(text(result)).not.toMatch(/^\(corpus:/);

    const chosen = await run(resolver, {
      id: "methodology-012",
      section: "Summary",
      author: "Nichols, M., Cator, K., and Torres, M.",
    });
    expect(text(chosen)).toBe("(corpus:methodology-012 § Summary, Nichols, M., Cator, K., and Torres, M. 2016)");
  });

  it("resolves foundations-001 to its single source; works it only discusses are references", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, { id: "foundations-001", section: "The Acknowledged Lineage" });
    expect(text(result)).toBe(
      "(corpus:foundations-001 § The Acknowledged Lineage, Nichols, M., Cator, K., and Torres, M. 2016)"
    );
    const refused = await run(resolver, {
      id: "foundations-001",
      section: "Kolb's Learning Cycle",
      author: "Dewey, J.",
    });
    expect(details(refused).kind).not.toBe("citation");
    expect(text(refused)).not.toMatch(/^\(corpus:/);
  });
});

describe("cbe_cite — Resolves Citation-Equivalent Candidates", () => {
  it("resolves citation-equivalent candidates to a single token", async () => {
    const resolver = fakeResolver({
      hit: devHit,
      headings: ["Durable Skills"],
      sources: [
        { author: "Challenge Based Learning", year: 2018, title: "Framework" },
        { author: "Challenge Based Learning", year: 2018, title: "About" },
      ],
    });
    const result = await run(resolver, {
      id: "dev-001",
      section: "Durable Skills",
      author: "Challenge Based Learning",
      year: 2018,
    });
    expect(text(result)).toBe("(corpus:dev-001 § Durable Skills, Challenge Based Learning 2018)");
    expect(details(result).kind).toBe("citation");
  });

  it("still requests disambiguation for genuinely-distinct candidates, listing titles", async () => {
    const resolver = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [
        { author: "Acme", year: 2018, title: "First Edition" },
        { author: "Acme", year: 2021, title: "Second Edition" },
      ],
    });
    const result = await run(resolver, { id: "dev-001", section: "Intro", author: "Acme" });
    expect(details(result).kind).toBe("needs-disambiguation");
    expect(text(result)).toContain("First Edition");
    expect(text(result)).toContain("Second Edition");
    expect(text(result)).not.toMatch(/^\(corpus:/);
  });

  it("lists multi-source candidates as `author year — title`", async () => {
    const resolver = fakeResolver({
      hit: devHit,
      headings: ["Intro"],
      sources: [
        { author: "Acme, A.", year: 2001, title: "First Edition" },
        { author: "Example, B.", year: 2002, title: "Second Edition" },
      ],
    });
    const result = await run(resolver, { id: "dev-001", section: "Intro" });
    expect(details(result).kind).toBe("needs-disambiguation");
    expect(text(result)).toContain("Acme, A. 2001 — First Edition");
    expect(text(result)).toContain("Example, B. 2002 — Second Edition");
  });
});

describe("cbe_cite — source-less real corpus document", () => {
  // methodology-002..006 and the project-authored best-practice collection carry
  // no sources[]. They are still citable: the tool emits a token without the
  // author/year element.
  it("cites a real source-less document without an author element", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const headings = await resolver.resolveHeadings("methodology-002");
    const section = headings[1] ?? headings[0]!; // first body heading after the title
    const result = await run(resolver, { id: "methodology-002", section });
    expect(text(result)).toBe(`(corpus:methodology-002 § ${section})`);
    expect(details(result).kind).toBe("citation");
  });

  it("A case field is independently citable", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    for (const section of ["Stakeholder Involvement Moments", "PIONEER Maturity Assessment"]) {
      const result = await run(resolver, { id: "case-study-007", section });
      expect(text(result)).toBe(`(corpus:case-study-007 § ${section})`);
      expect(details(result)).toMatchObject({ kind: "citation", id: "case-study-007", section });
    }
    const refused = await run(resolver, { id: "case-study-007", section: "Invented Criterion Scores" });
    expect(details(refused).error).toBe("unknown-section");
    expect(text(refused)).not.toMatch(/^\(corpus:/u);
  });

  it("Empty Source survives citation without an author-year tail", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const result = await run(resolver, { id: "methodology-013", section: "Level 2 — Fictional developed profile" });
    expect(text(result)).toBe("(corpus:methodology-013 § Level 2 — Fictional developed profile)");
    expect(text(result)).not.toMatch(/, [^)]+ \d{4}\)$/u);
  });
});

describe("cbe_cite — schema contract", () => {
  const schema = CiteParamsSchema as unknown as {
    required?: string[];
    properties: { id: { minLength?: number }; section: { minLength?: number } };
  };

  it("requires id and section", () => {
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("section");
  });

  it("id and section carry minLength: 1", () => {
    expect(schema.properties.id.minLength).toBe(1);
    expect(schema.properties.section.minLength).toBe(1);
  });
});
