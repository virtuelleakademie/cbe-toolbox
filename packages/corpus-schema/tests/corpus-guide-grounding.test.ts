import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const corpusRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "corpus");
const prescribedCitation =
  "Nichols, M., Cator, K., and Torres, M. (2016) Challenge Based Learner User Guide. Redwood City, CA: Digital Promise.";

describe("governed corpus grounding", () => {
  it("cites the Guide in the prescribed form and allows zero case-study atoms", async () => {
    for (const relative of [
      "content/foundations/foundations-001-experiential-learning-roots.md",
      "content/foundations/foundations-002-foundational-ideas-design-principles.md",
      "content/foundations/foundations-003-implementation-scales.md",
      "content/methodology/methodology-001-cbl-three-phase-framework.md",
      "content/vocabulary/vocabulary-001-cbl-core-vocabulary.md",
      "CURATION_GUIDELINES.md",
    ]) {
      expect(await fs.readFile(path.join(corpusRoot, relative), "utf8"), relative).toContain(prescribedCitation);
    }

    const index = JSON.parse(await fs.readFile(path.join(corpusRoot, "index.json"), "utf8")) as {
      "corpus-version": string;
      categories: Record<string, number>;
      documents: Array<{ id: string; category: string; path: string }>;
    };
    expect(index["corpus-version"]).toBe("2026-11");
    expect(index.categories).not.toHaveProperty("case-study");
    expect(index.documents.some((document) => document.category === "case-study")).toBe(false);
  });
});
