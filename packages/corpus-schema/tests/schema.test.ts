import { describe, it, expect } from "vitest";
import { CorpusDocumentSchema } from "../src/schema.js";

describe("CorpusDocumentSchema", () => {
  it("accepts a minimal valid document", () => {
    const doc = {
      id: "methodology-001",
      title: "CBL Three-Phase Framework",
      category: "methodology",
      version: "0.1.0",
      sources: [
        {
          author: "Nichols, M., Cator, K., and Torres, M.",
          year: 2016,
          title: "Challenge Based Learner User Guide",
          url: "https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf",
          license: "CC BY",
        },
      ],
      license: "CC-BY-4.0",
      updated: "2026-05-21",
      tags: ["engage", "investigate", "act"],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).not.toThrow();
  });

  it("rejects an unknown category", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "wrong-category",
      version: "0.1.0",
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow(/category/);
  });

  // The two-track model and per-document review state are removed: the corpus is
  // purely versioned content. A `.strict()` schema rejects the removed fields so a
  // stale frontmatter fails loudly rather than being silently ignored.
  it("rejects a document carrying the removed corpus-track field", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "methodology",
      version: "0.1.0",
      "corpus-track": "dev",
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow();
  });

  it("rejects a document carrying the removed review-status field", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "methodology",
      version: "0.1.0",
      "review-status": "draft",
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow();
  });

  it("rejects a document carrying the removed reviewers field", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "methodology",
      version: "0.1.0",
      reviewers: [],
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow();
  });

  it("requires sources entries to carry url and license", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "foundations",
      version: "0.1.0",
      sources: [{ author: "X", year: 2020, title: "Y" }],
      license: "CC-BY-4.0",
      updated: "2026-05-21",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow(/url|license/);
  });

  it("rejects an invalid ISO date in updated", () => {
    const doc = {
      id: "x",
      title: "x",
      category: "foundations",
      version: "0.1.0",
      sources: [],
      license: "MIT",
      updated: "yesterday",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow();
  });

  // Scenario: Source entry with pages passes validation — capability
  // `corpus-curation`, Requirement: Unified Markdown schema for all corpus documents.
  it("accepts a source entry carrying a pages string", () => {
    const doc = {
      id: "methodology-001",
      title: "CBL Three-Phase Framework",
      category: "methodology",
      version: "0.1.0",
      sources: [
        {
          author: "Nichols, M., Cator, K., and Torres, M.",
          year: 2016,
          title: "Challenge Based Learner User Guide",
          url: "https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf",
          license: "CC BY",
          pages: "11-13",
        },
      ],
      license: "CC-BY-4.0",
      updated: "2026-07-09",
      tags: ["engage", "investigate", "act"],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).not.toThrow();
    const parsed = CorpusDocumentSchema.parse(doc);
    expect(parsed.sources[0]?.pages).toBe("11-13");
  });

  it("stays valid when a source entry omits pages (field is optional)", () => {
    const doc = {
      id: "methodology-001",
      title: "x",
      category: "methodology",
      version: "0.1.0",
      sources: [
        {
          author: "X",
          year: 2016,
          title: "Y",
          url: "https://example.org/y",
          license: "CC BY",
        },
      ],
      license: "CC-BY-4.0",
      updated: "2026-07-09",
      tags: [],
    };
    expect(() => CorpusDocumentSchema.parse(doc)).not.toThrow();
    expect(CorpusDocumentSchema.parse(doc).sources[0]?.pages).toBeUndefined();
  });

  it("accepts an optional short-description override in frontmatter", () => {
    const doc = {
      id: "foundations-x",
      title: "x",
      category: "foundations",
      version: "0.1.0",
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
      "short-description": "Lecturer-side override that surfaces situational trigger language for Stage-1 retrieval.",
    };
    expect(() => CorpusDocumentSchema.parse(doc)).not.toThrow();
  });

  it("rejects a short-description longer than 200 characters", () => {
    const doc = {
      id: "foundations-x",
      title: "x",
      category: "foundations",
      version: "0.1.0",
      sources: [],
      license: "MIT",
      updated: "2026-05-21",
      tags: [],
      "short-description": "x".repeat(201),
    };
    expect(() => CorpusDocumentSchema.parse(doc)).toThrow(/short-description/);
  });
});
