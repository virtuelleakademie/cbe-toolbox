import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// Covers change `ingest-pioneer-foundations-and-maturity`, capability
// `corpus-curation`:
//   - Scenario: foundations-005 is present and indexed
//   - Scenario: methodology-007 is present and indexed
//   - Scenario: Maturity model carries exactly three levels with the synonym
//     mapping documented
// Asserts against the built repo corpus (corpus/index.json + the document
// bodies) so a regression that drops or malforms either document fails here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INDEX = path.join(REPO_ROOT, "corpus", "index.json");

interface IndexEntry {
  id: string;
  title: string;
  category: string;
  version: string;
  path: string;
  tags: string[];
  "short-description"?: string;
}
interface Manifest {
  "corpus-version": string;
  "document-count": number;
  documents: IndexEntry[];
}

const manifest = JSON.parse(readFileSync(INDEX, "utf-8")) as Manifest;
const byId = (id: string) => manifest.documents.find((d) => d.id === id);
const bodyOf = (entry: IndexEntry) => readFileSync(path.join(REPO_ROOT, "corpus", entry.path), "utf-8");

describe("PIONEER foundations ingestion (Phase A)", () => {
  it("keeps the PIONEER atoms in the current 2026-11 corpus", () => {
    expect(manifest["corpus-version"]).toBe("2026-11");
  });

  describe("Scenario: foundations-005 is present and indexed", () => {
    const entry = byId("foundations-005");

    it("lists foundations-005 with valid metadata and a non-empty short-description ≤ 200 chars", () => {
      expect(entry, "foundations-005 missing from index.json").toBeDefined();
      expect(entry!.category).toBe("foundations");
      expect(entry!.title.length).toBeGreaterThan(0);
      expect(entry!.tags.length).toBeGreaterThan(0);
      expect(entry!.path).toMatch(/^content\/foundations\//);
      const sd = entry!["short-description"] ?? "";
      expect(sd.length).toBeGreaterThan(0);
      expect(sd.length).toBeLessThanOrEqual(200);
    });

    it("body carries the CBE vs PBL/PjBL distinction, the 7 criteria, the multi-actor ecosystem, and SDG11", () => {
      const body = bodyOf(entry!);
      // CBE vs PBL/PjBL distinction
      expect(body).toMatch(/problem-based learning/i);
      expect(body).toMatch(/project-based learning/i);
      expect(body).toMatch(/stakeholder co-creation, societal contribution, and real-world implementation/i);
      // the seven operationalised criteria
      expect(body).toMatch(/seven operationalised PIONEER criteria/i);
      for (const criterion of [
        /Societal, real-world challenge/i,
        /External stakeholder involvement/i,
        /Inter-\/transdisciplinary collaboration/i,
        /Student agency/i,
        /Value-orientation and reflection/i,
        /Societal impact and transferability/i,
        /Iterative learning process/i,
      ]) {
        expect(body, `criterion missing: ${criterion}`).toMatch(criterion);
      }
      // three-stage maturity cue present
      expect(body).toMatch(/Maturity cue/i);
      // multi-actor ecosystem
      expect(body).toMatch(/multi-actor ecosystem/i);
      expect(body).toMatch(/problem owners/i);
      expect(body).toMatch(/co-creators/i);
      // SDG11 impact orientation
      expect(body).toMatch(/SDG\s?11/i);
      expect(body).toMatch(/inclusive, safe, resilient and sustainable cities/i);
    });

    it("records the validated PIONEER WP4 4.2.1 document as its provenance", () => {
      const body = bodyOf(entry!);
      expect(body).toMatch(/PIONEER Project Team WP4/);
      expect(body).toMatch(/4\.2\.1/);
    });
  });

  describe("Scenario: methodology-007 is present and indexed", () => {
    const entry = byId("methodology-007");

    it("lists methodology-007 with valid metadata and a non-empty short-description ≤ 200 chars", () => {
      expect(entry, "methodology-007 missing from index.json").toBeDefined();
      expect(entry!.category).toBe("methodology");
      expect(entry!.title.length).toBeGreaterThan(0);
      expect(entry!.tags.length).toBeGreaterThan(0);
      expect(entry!.path).toMatch(/^content\/methodology\//);
      const sd = entry!["short-description"] ?? "";
      expect(sd.length).toBeGreaterThan(0);
      expect(sd.length).toBeLessThanOrEqual(200);
    });

    it("body carries the 3×7 raster, developmental-continuum framing, toolbox mandate, and min/max vocabulary", () => {
      const body = bodyOf(entry!);
      // 3x7 raster + the seven criteria as rows
      expect(body).toMatch(/3×7 raster/);
      expect(body).toMatch(/Stakeholder [Ii]nvolvement/);
      expect(body).toMatch(/Iterative [Ll]earning [Pp]rocess/);
      // developmental-continuum framing
      expect(body).toMatch(/developmental (and flexible model|continuum)/i);
      expect(body).toMatch(/analytical framework/i);
      // toolbox mandate (verbatim phrase)
      expect(body).toMatch(/inform the AI-based didactical toolbox/i);
      // minimum-standards vs excellence-criteria vocabulary
      expect(body).toMatch(/minimum standards and excellence criteria/i);
    });
  });

  describe("Scenario: Maturity model carries exactly three levels with the synonym mapping documented", () => {
    const entry = byId("methodology-007");

    it("names exactly three maturity levels — no five-label scale", () => {
      const body = bodyOf(entry!);
      // The three level headings (Level 1/2/3) are present, and there is no
      // "Level 4"/"Level 5".
      expect(body).toMatch(/Level 1/);
      expect(body).toMatch(/Level 2/);
      expect(body).toMatch(/Level 3/);
      expect(body).not.toMatch(/Level 4/);
      expect(body).not.toMatch(/Level 5/);
      expect(body).toMatch(/three levels of maturity|exactly three levels/i);
    });

    it("documents the synonym mapping incl. the student-perspective framings", () => {
      const body = bodyOf(entry!);
      // Framework synonyms across the three levels
      for (const label of [
        /emerging/i,
        /good-practice/i,
        /fully-developed|fully developed/i,
        /Strong CBE/i,
        /CBE Light/i,
        /transformative/i,
      ]) {
        expect(body, `synonym missing: ${label}`).toMatch(label);
      }
      // Student-perspective framings (challenge inspired / oriented / based)
      expect(body).toMatch(/[Cc]hallenge \*\*inspired\*\* learning|[Cc]hallenge inspired learning/);
      expect(body).toMatch(/[Cc]hallenge \*\*oriented\*\* learning|[Cc]hallenge oriented learning/);
      expect(body).toMatch(/[Cc]hallenge \*\*based\*\* learning|[Cc]hallenge based learning/);
      // Explicit "one level, multiple names" resolution
      expect(body).toMatch(/synonym/i);
    });
  });
});
