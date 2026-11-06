/**
 * The shared citation verifier (capability `citation-tool`, Requirement: *The Section
 * Gate Is a Shared, Separately-Importable Verifier*).
 *
 * The load-bearing assertions are the two that would let the product disagree with
 * itself: that `cbe_cite`'s gate 2 and the verifier accept exactly the same strings,
 * and that the module can be imported without pulling the Pi runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractHeadings,
  matchSectionHeading,
  normaliseSection,
  parseCitationToken,
  verifyCitation,
  verifyCitationToken,
} from "../src/citation-verification.js";
import { createCiteTool } from "../src/cite-tool.js";
import { createCitationResolver, type CitationResolver } from "../src/citations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");

const HEADINGS = ["Phase 1: Engage", "Phase 2 (Investigate)", "The triad", "Mis-alignment-pattern catalogue"];

/** A resolver over one synthetic document, so the tool's gate 2 is exercised directly. */
function resolverWith(headings: string[]): CitationResolver {
  return {
    getVersion: () => "2026-08",
    resolve: (id) => (id === "doc-001" ? { id, title: "Doc", path: "d.md", tags: [] } : null),
    parseCitations: () => [],
    loadBody: async () => "",
    resolveSources: async () => [],
    resolveHeadings: async (id) => (id === "doc-001" ? headings : []),
    listIds: () => ["doc-001"],
  };
}

async function citeSection(section: string): Promise<{ refused: boolean; text: string }> {
  const tool = createCiteTool(resolverWith(HEADINGS));
  const res = (await tool.execute("call-1", { id: "doc-001", section })) as {
    content: Array<{ text: string }>;
    details: { kind?: string };
  };
  return { refused: res.details.kind === "citation-refusal", text: res.content[0]!.text };
}

describe("normalisation and heading extraction", () => {
  it("strips a leading section marker, numbering and case", () => {
    expect(normaliseSection("§ Phase 1: Engage")).toBe("phase 1: engage");
    expect(normaliseSection("## 3.1 The triad")).toBe("the triad");
    expect(normaliseSection("  The Triad  ")).toBe("the triad");
  });

  it("reads ATX headings from a body and ignores non-heading lines", () => {
    const body = ["# Title", "some prose", "## The triad", "#not-a-heading", "###### Deep"].join("\n");
    expect(extractHeadings(body)).toEqual(["Title", "The triad", "Deep"]);
  });

  it("matches conservatively — a near miss is not a match", () => {
    expect(matchSectionHeading("the triad", HEADINGS)).toBe("The triad");
    expect(matchSectionHeading("The Triads", HEADINGS)).toBeNull();
    expect(matchSectionHeading("", HEADINGS)).toBeNull();
  });
});

// Scenario: The tool's section gate and the shared verifier agree
describe("the tool's section gate and the shared verifier agree", () => {
  const cases = ["Phase 1: Engage", "§ phase 1: engage", "1. The triad", "Phase 2 (Investigate)", "Engage", "", "   "];

  it("accepts exactly the same strings and resolves them to the same heading", async () => {
    for (const section of cases) {
      const viaVerifier = matchSectionHeading(section, HEADINGS);
      // An empty `section` is rejected by the tool's schema (minLength: 1) before the
      // gate runs, so only non-empty strings are comparable end to end.
      if (section.trim() === "") {
        expect(viaVerifier).toBeNull();
        continue;
      }
      const viaTool = await citeSection(section);
      if (viaVerifier === null) {
        expect(viaTool.refused, `expected the tool to refuse "${section}"`).toBe(true);
      } else {
        expect(viaTool.refused, `expected the tool to accept "${section}"`).toBe(false);
        expect(viaTool.text).toBe(`(corpus:doc-001 § ${viaVerifier})`);
      }
    }
  });

  it("the tool carries no section normalisation of its own", () => {
    const src = readFileSync(path.join(srcDir, "cite-tool.ts"), "utf8");
    expect(src).not.toMatch(/function normaliseSection/);
    expect(src).toMatch(/matchSectionHeading/);
  });
});

// Scenario: The verifier imports without the Pi runtime
describe("the verifier imports without the Pi runtime", () => {
  it("is reachable as its own package subpath", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(srcDir, "../package.json"), "utf8")) as {
      exports: Record<string, { types: string; default: string }>;
    };
    expect(pkg.exports["./citation-verification"]).toEqual({
      types: "./dist/citation-verification.d.ts",
      default: "./dist/citation-verification.js",
    });
  });

  it("its module graph contains no Pi import", () => {
    // A leaf module: it must import nothing at all, so there is no graph to walk.
    // Asserted on the SOURCE's import statements (the module is types + pure functions,
    // so `import type` counts too) — the prose above may name the runtime it avoids.
    const src = readFileSync(path.join(srcDir, "citation-verification.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(imports).toEqual([]);
  });
});

// Scenario: A token with no section is distinguished from a wrong section
describe("a token with no section is distinguished from a wrong section", () => {
  it("reports missing-section and unknown-section separately, with the headings", () => {
    expect(verifyCitationToken("(corpus:doc-001)", HEADINGS)).toEqual({
      status: "missing-section",
      id: "doc-001",
    });
    expect(verifyCitationToken("(corpus:doc-001 § Resonanzstufen)", HEADINGS)).toEqual({
      status: "unknown-section",
      id: "doc-001",
      section: "Resonanzstufen",
      headings: HEADINGS,
    });
  });

  it("reports an unknown id when no document backs it", () => {
    expect(verifyCitation("nope-001", "The triad", null)).toEqual({ status: "unknown-id", id: "nope-001" });
  });

  it("verifies the token cbe_cite emits for a source author containing commas", async () => {
    const resolver: CitationResolver = {
      ...resolverWith(HEADINGS),
      resolveSources: async () => [{ author: "Nichols, M., Cator, K., and Torres, M.", year: 2016, title: "Guide" }],
    };
    const res = (await createCiteTool(resolver).execute("call-1", { id: "doc-001", section: "Phase 1: Engage" })) as {
      content: Array<{ text: string }>;
    };
    const token = res.content[0]!.text;
    expect(token).toBe("(corpus:doc-001 § Phase 1: Engage, Nichols, M., Cator, K., and Torres, M. 2016)");
    expect(verifyCitationToken(token, HEADINGS)).toEqual({
      status: "verified",
      id: "doc-001",
      section: "Phase 1: Engage",
      heading: "Phase 1: Engage",
    });
    expect(verifyCitationToken("(corpus:doc-001 § Resonanzstufen, Nichols, M. 2016)", HEADINGS)?.status).toBe(
      "unknown-section"
    );
  });

  it("keeps an invented sub-section in front of the source element unverified", () => {
    for (const token of [
      "(corpus:doc-001 § Phase 1: Engage, Invented Sub, Nichols 2016)",
      "(corpus:doc-001 § Phase 1: Engage, Invented Sub, Nichols, M., Cator, K., and Torres, M. 2016)",
    ]) {
      expect(verifyCitationToken(token, HEADINGS), token).toMatchObject({
        status: "unknown-section",
        section: "Phase 1: Engage, Invented Sub",
      });
    }
  });

  it("verifies the token cbe_cite emits for every source of every corpus document", async () => {
    const resolver = await createCitationResolver(path.resolve(__dirname, "../../../corpus"));
    const tool = createCiteTool(resolver);
    let checked = 0;
    for (const id of resolver.listIds()) {
      const [section] = await resolver.resolveHeadings(id);
      if (!section) continue;
      for (const source of await resolver.resolveSources(id)) {
        const res = (await tool.execute("call-1", { id, section, author: source.author, year: source.year })) as {
          content: Array<{ text: string }>;
          details: { kind?: string };
        };
        if (res.details.kind !== "citation") continue;
        expect(
          verifyCitationToken(res.content[0]!.text, await resolver.resolveHeadings(id)),
          res.content[0]!.text
        ).toMatchObject({ status: "verified", section });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("verifies a well-formed token and reports the matched heading", () => {
    expect(verifyCitationToken("(corpus:doc-001 § the triad, Smith 2020)", HEADINGS)).toEqual({
      status: "verified",
      id: "doc-001",
      section: "the triad",
      heading: "The triad",
    });
  });
});

describe("token parsing", () => {
  it("keeps a section whose label carries parentheses", () => {
    // `cbe_cite` emits this form when the document's heading has parentheses, and the
    // canonical regex does not match it — verification must not fail what the tool produced.
    expect(parseCitationToken("(corpus:doc-001 § Phase 2 (Investigate), Smith 2020)")).toEqual({
      id: "doc-001",
      section: "Phase 2 (Investigate)",
    });
    expect(verifyCitationToken("(corpus:doc-001 § Phase 2 (Investigate), Smith 2020)", HEADINGS)?.status).toBe(
      "verified"
    );
  });

  it("strips the source element and not a comma inside the section", () => {
    expect(parseCitationToken("(corpus:doc-001 § Goals, Activities and Assessment, Smith 2020)")).toEqual({
      id: "doc-001",
      section: "Goals, Activities and Assessment",
    });
    expect(parseCitationToken("(corpus:doc-001 § The triad, Acme Institute n.d.)")?.section).toBe("The triad");
  });

  it("treats an unterminated occurrence as section-less rather than guessing", () => {
    expect(parseCitationToken("(corpus:doc-001 § The triad")).toEqual({ id: "doc-001", section: null });
  });

  it("returns null for a string that is not a corpus token", () => {
    expect(parseCitationToken("(see the corpus)")).toBeNull();
    expect(parseCitationToken("(wiki:atom-1 § A)")).toBeNull();
  });
});
