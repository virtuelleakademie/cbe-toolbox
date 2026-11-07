import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { CORPUS_COMPATIBILITY_CONTRACT, validateCorpusInventory } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const corpusRoot = path.join(repoRoot, "corpus");
const index = JSON.parse(await fs.readFile(path.join(corpusRoot, "index.json"), "utf8")) as {
  "corpus-version": string;
  "document-count": number;
  categories: Record<string, number>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    path: string;
    tags: string[];
    "short-description": string;
  }>;
};

const selected = [
  ["case-study-003", "ewb-challenge-innovation-and-society"],
  ["case-study-004", "going-global-international-live-case"],
  ["case-study-005", "final-dissertations-on-local-challenges"],
  ["case-study-006", "innobiodiv-plant-climate-research"],
  ["case-study-007", "food-system-campus-catering"],
  ["case-study-008", "ux-infovis-social-partner-challenges"],
  ["case-study-009", "integrated-design-laboratories"],
  ["case-study-010", "smart-road-management-special-week"],
  ["case-study-011", "wave-architecture-summer-workshop"],
  ["case-study-012", "model-united-nations-simulation"],
  ["case-study-013", "civil-engineering-project-work"],
] as const;

const requiredH2 = [
  "Summary",
  "Module Identity",
  "Delivery Architecture",
  "Challenge & Stakeholders",
  "Constructive Alignment",
  "Phase-by-Phase Walkthrough",
  "Instructor Perspective",
  "Outcomes & Transferability",
  "PIONEER Maturity Assessment",
  "Gaps in the Supplied Material",
];

const requiredH3 = [
  "Module Title",
  "Short Description",
  "University / Institution",
  "Program Level",
  "Program / Discipline",
  "ECTS Credits",
  "Duration",
  "Cohort Size",
  "Delivery Form",
  "Delivery Format",
  "Institutional Constraints",
  "Design Constraints",
  "Challenge Topic",
  "Challenge Formulation",
  "Challenge Authenticity / Origin",
  "Challenge Owner / Stakeholders",
  "Stakeholder Involvement Moments",
  "Intended Learning Outcomes",
  "Key Learning Activities",
  "Assessment Criteria / Rubrics",
  "Assessment Evidence & Feedback",
  "Reflection Design",
  "Phase 1 – Engage",
  "Phase 2 – Investigate",
  "Phase 3 – Act / Prototype",
  "Phase 4 – Reflect & Present",
  "Preparation Required",
  "Instructor Role During Module",
  "Challenges & Tips",
  "Variations / Adaptations",
  "Student Experience",
  "Transferability",
];

const primaryLevel: Record<string, number> = {
  "case-study-003": 3,
  "case-study-004": 2,
  "case-study-005": 2,
  "case-study-006": 2,
  "case-study-007": 2,
  "case-study-008": 2,
  "case-study-009": 2,
  "case-study-010": 2,
  "case-study-011": 1,
  "case-study-012": 1,
  "case-study-013": 1,
};

const byId = (id: string) => index.documents.find((document) => document.id === id);

async function textOf(id: string): Promise<string> {
  const entry = byId(id);
  if (!entry) throw new Error(`missing index entry ${id}`);
  return fs.readFile(path.join(corpusRoot, entry.path), "utf8");
}

function headings(text: string, level: number): string[] {
  const marker = "#".repeat(level);
  return text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${marker} `) && !line.startsWith(`${marker}#`))
    .map((line) => line.slice(level + 1).trim());
}

function section(text: string, heading: string, level = 3): string {
  const lines = text.split(/\r?\n/u);
  const marker = `${"#".repeat(level)} ${heading}`;
  const start = lines.findIndex((line) => line === marker);
  if (start === -1) return "";
  const next = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `, "u").test(line));
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join("\n")
    .trim();
}

function protectedGapProblems(wave: string, pa1: string, profiles: string): string[] {
  const problems: string[] = [];
  const waveIlo = section(wave, "Intended Learning Outcomes");
  if (waveIlo !== "Not supplied.") problems.push("W.A.Ve. ILO gap was completed");
  if (/List 3–5 ILOs/iu.test(waveIlo)) problems.push("W.A.Ve. template prompt became content");
  const reflection = section(pa1, "Reflection Design");
  if (/When, how, and in what format/iu.test(reflection)) problems.push("PA1 reflection prompt became content");
  if (!reflection.includes("personal online journal")) problems.push("PA1 substantive reflection was lost");
  const transfer = section(profiles, "Level 2 — Transferability", 4);
  if (transfer !== "Not supplied.") problems.push("fictional Level 2 transferability was completed");
  return problems;
}

describe("CBE best-practice corpus integration", () => {
  it("Selected modules have stable flat identities", async () => {
    expect(index.categories["case-study"]).toBe(11);
    for (const [id, slug] of selected) {
      const entry = byId(id);
      expect(entry, id).toBeDefined();
      expect(entry!.path).toBe(`content/case-study/${id}-${slug}.md`);
      expect(entry!.category).toBe("case-study");
      const text = await textOf(id);
      for (const heading of requiredH2) expect(headings(text, 2), `${id}: ${heading}`).toContain(heading);
      for (const heading of requiredH3) expect(headings(text, 3), `${id}: ${heading}`).toContain(heading);
    }
    const retiredIds = [1, 2].map((number) => `case-study-${String(number).padStart(3, "0")}`);
    expect(index.documents.some((document) => retiredIds.includes(document.id))).toBe(false);
    expect(index.documents.filter((document) => document.id.startsWith("case-study-"))).toHaveLength(11);
  });

  it("Template gaps are not completed imaginatively", async () => {
    const wave = await textOf("case-study-011");
    const pa1 = await textOf("case-study-013");
    const profiles = await textOf("methodology-013");
    expect(protectedGapProblems(wave, pa1, profiles)).toEqual([]);
    const invented = wave.replace(
      "### Intended Learning Outcomes\n\nNot supplied.",
      "### Intended Learning Outcomes\n\nDesign resilient buildings."
    );
    expect(protectedGapProblems(invented, pa1, profiles)).toContain("W.A.Ve. ILO gap was completed");
  });

  it("Appendices and PDF fields retain their meaning", async () => {
    const pa1 = await textOf("case-study-013");
    expect(pa1).toContain("### Structural engineering challenge");
    expect(pa1).toContain("### Urban drainage and rainwater-management challenge");
    expect(pa1).toContain("Construction plans — structural plans and details");
    expect(pa1).toContain("0 / 12 / 25 / 30 / 42 points");
    expect(pa1).toContain("no separate rubric for the interim review was supplied");

    const ewb = await textOf("case-study-003");
    expect(section(ewb, "Intended Learning Outcomes")).toContain(
      "Analyse open-ended socio-technical engineering challenges"
    );
    expect(section(ewb, "Intended Learning Outcomes")).not.toContain("Introductory sessions");
    expect(section(ewb, "Key Learning Activities")).toContain("Introductory sessions");
    expect(ewb).toContain("Unsupported claim in the supplied account");
    expect(ewb).not.toMatch(/systematic reviews? \[[0-9]+\]/iu);

    const broken = ewb.replace("### Intended Learning Outcomes", "### Invented Combined Field");
    expect(section(broken, "Intended Learning Outcomes")).toBe("");
  });

  it("A directional label does not change the primary level", async () => {
    for (const [id] of selected) {
      const entry = byId(id)!;
      const level = primaryLevel[id]!;
      expect(entry.tags.filter((tag) => /^maturity-level-[123]$/u.test(tag))).toEqual([`maturity-level-${level}`]);
      expect(entry["short-description"]).toContain(`Level ${level}`);
      const text = await textOf(id);
      expect(text).toContain(`**Primary level:** Level ${level}`);
      expect(text).toContain("It is not computed from per-criterion scores");
    }
    const smartRoad = await textOf("case-study-010");
    expect(smartRoad).toContain("**Supplied PIONEER label:** Good Practice (Richtung Emerging)");
    expect(smartRoad).toContain("**Primary level:** Level 2 — Good Practice");
    expect(smartRoad).toContain("**Directional qualifier:** Toward Level 1 — Emerging / CBE Light");
  });

  it("Three fictional profiles are discoverable without masquerading as cases", async () => {
    const entry = byId("methodology-013");
    expect(entry).toMatchObject({ category: "methodology" });
    expect(entry!["short-description"].toLowerCase()).toContain("fictional");
    const text = await textOf("methodology-013");
    const profileHeadings = headings(text, 2).filter((heading) => heading.startsWith("Level "));
    expect(profileHeadings).toEqual([
      "Level 1 — Fictional minimal profile",
      "Level 2 — Fictional developed profile",
      "Level 3 — Fictional vision profile",
    ]);
    expect(text).toContain("`minimal` is Level 1");
    expect(text).toContain("`fully` is Level 2");
    expect(text).toContain("`good_practice` / `VISION not real` is Level 3");
    expect(
      index.documents.some((document) => document.category === "case-study" && /fictional/iu.test(document.title))
    ).toBe(false);
  });

  it("Empty Source survives the normal corpus path", async () => {
    for (const id of [...selected.map(([caseId]) => caseId), "methodology-013"]) {
      const parsed = matter(await textOf(id));
      expect(parsed.data.sources, id).toEqual([]);
    }
    const innobiodiv = await textOf("case-study-006");
    expect(innobiodiv).toContain("## References");
    expect(innobiodiv).toContain("10.57684/COS-1314");
    expect((matter(innobiodiv).data as { sources: unknown[] }).sources).toEqual([]);
    const profiles = await textOf("methodology-013");
    expect(profiles).toContain("https://aim2flourish.com/about-us");
    expect((matter(profiles).data as { sources: unknown[] }).sources).toEqual([]);
    await expect(validateCorpusInventory(corpusRoot, { allowSourceDocumentation: true })).resolves.toMatchObject({
      version: "2026-12",
    });
  });

  it("The included index and compatibility contract carry the collection", () => {
    expect(index["corpus-version"]).toBe("2026-12");
    expect(index["document-count"]).toBe(25);
    expect(index.documents.length).toBeLessThanOrEqual(255);
    expect(CORPUS_COMPATIBILITY_CONTRACT).toEqual({
      corpusSchema: "cbe-corpus/1",
      indexContractSha256: "21203162d33e0b2bf39cfe928024a77ca48a73e11ed1019961060ca611be6faa",
    });
  });
});
