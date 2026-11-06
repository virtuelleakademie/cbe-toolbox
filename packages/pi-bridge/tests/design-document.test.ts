/**
 * Deterministic design-document export (change `harden-canvas-determinism-and-ux2-fixes`,
 * wave B, group B4).
 *
 * capability `course-workspace`, Requirement: Deterministic Design-Document Export from
 * Host State — Scenarios:
 * - Export writes the design document from host state
 * - The same state always produces the same document
 * - Unfilled artefacts are shown as open, not invented
 * - An established maturity reading is included
 */
import { describe, it, expect } from "vitest";
import { buildDesignDocument, designDocumentFilename } from "../src/design-document.js";

const INPUT = {
  courseTitle: "Git in the times of AI",
  artefacts: [
    { step: 1, id: "moduleframe", label: "Module Frame", value: "BA, one semester", state: "draft" as const },
    { step: 4, id: "bigidea", label: "Big Idea", value: "Git in the times of AI.", state: "draft" as const },
    {
      step: 6,
      phase: "investigate" as const,
      id: "is",
      label: "Investigate Sequence",
      value: "Weeks 4-7: how do worktrees help?",
      state: "draft" as const,
    },
  ],
  stepCoverage: [
    { step: 1, depth: "detailed" as const, focus: false },
    { step: 4, depth: "refined" as const, focus: true },
  ],
};

// Scenario: Export writes the design document from host state
describe("Export writes the design document from host state", () => {
  it("renders all ten steps in flow order with their recorded coverage", () => {
    const md = buildDesignDocument(INPUT);
    for (let s = 1; s <= 10; s++) expect(md).toContain(`## Step ${s} —`);
    expect(md.indexOf("## Step 1")).toBeLessThan(md.indexOf("## Step 2"));
    expect(md).toContain("_Coverage: detailed_");
    expect(md).toContain("_Coverage: refined_");
    // A step never touched reads `open`, not blank.
    expect(md).toContain("_Coverage: open_");
    expect(md).toContain("BA, one semester");
    expect(md).toContain("Git in the times of AI.");
  });

  it("groups step 6 by journey element in engage → investigate → act → reflect order", () => {
    const md = buildDesignDocument(INPUT);
    const seg = md.slice(md.indexOf("## Step 6"), md.indexOf("## Step 7"));
    expect(seg.indexOf("### Engage")).toBeLessThan(seg.indexOf("### Investigate"));
    expect(seg.indexOf("### Investigate")).toBeLessThan(seg.indexOf("### Act / Prototype"));
    expect(seg.indexOf("### Act / Prototype")).toBeLessThan(seg.indexOf("### Reflect and present"));
    expect(seg).toContain("Weeks 4-7: how do worktrees help?");
  });

  it("includes the course context when the course records one", () => {
    const md = buildDesignDocument({ ...INPUT, courseContext: "Cohort: 24 BA students." });
    expect(md).toContain("## Course context");
    expect(md).toContain("Cohort: 24 BA students.");
  });
});

// Scenario: The same state always produces the same document
describe("The same state always produces the same document", () => {
  it("is byte-identical for identical state", () => {
    expect(buildDesignDocument(INPUT)).toBe(buildDesignDocument(INPUT));
  });

  it("differs only in the declared timestamp line", () => {
    const a = buildDesignDocument({ ...INPUT, generatedAt: "2026-08-03T10:00:00Z" });
    const b = buildDesignDocument({ ...INPUT, generatedAt: "2026-08-04T11:00:00Z" });
    const strip = (s: string) => s.replace(/^_Exported .*$/m, "");
    expect(strip(a)).toBe(strip(b));
    expect(a).toContain("2026-08-03T10:00:00Z");
  });
});

// Scenario: Unfilled artefacts are shown as open, not invented
describe("Unfilled artefacts are shown as open, not invented", () => {
  it("marks an empty-valued artefact explicitly open rather than omitting it", () => {
    const md = buildDesignDocument({
      ...INPUT,
      artefacts: [
        { step: 3, id: "assessmentblueprint", label: "Assessment Blueprint", value: "", state: "open" as const },
      ],
    });
    const seg = md.slice(md.indexOf("## Step 3"), md.indexOf("## Step 4"));
    expect(seg).toContain("Assessment Blueprint");
    expect(seg).toContain("_(open — not yet decided)_");
  });

  it("marks a step with no artefacts at all as open", () => {
    const md = buildDesignDocument({ ...INPUT, artefacts: [] });
    const seg = md.slice(md.indexOf("## Step 9"), md.indexOf("## Step 10"));
    expect(seg).toContain("_(open — not yet decided)_");
  });

  it("never generates content for an unfilled artefact", () => {
    const md = buildDesignDocument({ ...INPUT, artefacts: [] });
    expect(md).not.toMatch(/lorem|TODO|example|suggested/i);
  });
});

/** The overall row's Current cell, for assertions that must not be satisfied by
 *  text from a neighbouring cell or row. */
function overallCurrentCell(md: string): string {
  const row = md.split("\n").find((l) => l.startsWith("| overall |"));
  expect(row, "the export carries an overall row").toBeDefined();
  return row!.split("|")[2]!.trim();
}

// Scenario: An established maturity reading is included
describe("An established maturity reading is included", () => {
  it("renders per-criterion current and target plus the limitation note", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        challenge: { current: 2, target: 3 },
        assessment: { target: 2 },
        overall: { target: 3, note: "Assessed from the conversation only." },
      },
    });
    expect(md).toContain("## CBE Maturity");
    expect(md).toContain("| challenge | 2 | 3 |");
    // An unassessed criterion is marked as such rather than guessed.
    expect(md).toContain("| assessment | unassessed | 2 |");
    expect(md).toContain("**Limitation:** Assessed from the conversation only.");
  });

  it("omits the section entirely when no reading is established", () => {
    expect(buildDesignDocument(INPUT)).not.toContain("## CBE Maturity");
  });
});

// Scenario: The exported document uses the app's panel vocabulary
// (capability `course-workspace`, Requirement: Deterministic Design-Document
// Export from Host State). The export headings speak the app's surface names,
// so the file a lecturer opens matches the panels they exported it from.
describe("The exported document uses the app's panel vocabulary", () => {
  it("heads the maturity section CBE Maturity and no heading reads Artefacts", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: { challenge: { current: 2, target: 3 } },
    });
    const headings = md.split("\n").filter((l) => l.startsWith("#"));
    expect(headings).toContain("## CBE Maturity");
    for (const h of headings) expect(h).not.toMatch(/Artefacts|Artifacts/i);
  });
});

/**
 * The exported aggregate is the HOST-DERIVED reading, never a stored one — the
 * same pure function the panel derives from (capability `agent-harness`,
 * Requirement: Host-Derived Overall Maturity Level). Before this, the export
 * printed `unassessed` in the overall row for every course whose panel showed a
 * derived level: the panel-versus-artefact disagreement the derivation ends.
 */
describe("The exported overall row carries the derived aggregate with its qualifier", () => {
  it("renders the derived level with its contributing count and unrounded mean", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        "societal-challenge": { current: 2, target: 3 },
        "stakeholder-involvement": { current: 2 },
        interdisciplinarity: { current: 1 },
        "student-agency": { current: 2 },
        "iterative-process": { current: "unassessed" },
        overall: { target: 3 },
      },
    });
    // mean 1.75 over four contributing criteria, banded half DOWN → L2.
    expect(md).toContain("| overall | L2 (derived from 4 of 7 assessed criteria, mean 1.8) | 3 |");
  });

  it("renders the capped level and names the capping criterion where a reservation lowered the band", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        "societal-challenge": { current: 3 },
        "stakeholder-involvement": { current: 3 },
        interdisciplinarity: { current: 3 },
        "student-agency": { current: 1, capped: true },
        "iterative-process": { current: 3 },
        "value-reflection": { current: 3 },
        "societal-impact": { current: 3 },
        overall: { target: 3 },
      },
    });
    expect(md).toContain(
      "| overall | L1 (derived from 7 of 7 assessed criteria, mean 2.7; capped by the open finding on student-agency) | 3 |"
    );
  });

  it("names no capping criterion when the mean's band already sat at or below every cap", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        "societal-challenge": { current: 2, capped: true },
        "stakeholder-involvement": { current: 2 },
        overall: { target: 3 },
      },
    });
    expect(overallCurrentCell(md)).toBe("L2 (derived from 2 of 7 assessed criteria, mean 2.0)");
  });

  it("states the absence instead of a level, zero, dash or placeholder while nothing is assessed", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        "societal-challenge": { target: 3 },
        "student-agency": { current: "unassessed" },
        overall: { target: 3, note: "Assessed from the conversation only." },
      },
    });
    const cell = overallCurrentCell(md);
    expect(cell).toBe("The achieved reading is not yet due: no criterion has been assessed.");
    // No level token, band, zero, dash or placeholder may accompany the absence.
    expect(cell).not.toMatch(/L[123]|[0-9]|[-—–]|n\/a/i);
    // The recorded limitation note still renders — what is absent is the LEVEL.
    expect(md).toContain("**Limitation:** Assessed from the conversation only.");
  });

  it("never echoes a model-pushed aggregate back into the export", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: {
        "societal-challenge": { current: 1 },
        // A course record written before the derivation may still carry one.
        overall: { current: 3, target: 3 },
      },
    });
    expect(overallCurrentCell(md)).toBe("L1 (derived from 1 of 7 assessed criteria, mean 1.0)");
  });

  it("leaves the criterion rows untouched and keeps exactly one overall row", () => {
    const maturity = {
      "societal-challenge": { current: 2, target: 3 },
      "student-agency": { current: "unassessed" as const, target: 2 },
      overall: { target: 3 },
    };
    const md = buildDesignDocument({ ...INPUT, maturity });
    expect(md).toContain("| Criterion | Current | Target |");
    expect(md).toContain("| societal-challenge | 2 | 3 |");
    expect(md).toContain("| student-agency | unassessed | 2 |");
    expect(md.split("\n").filter((l) => l.startsWith("| overall |"))).toHaveLength(1);
    // Derivation reads the recorded criteria only — it stores nothing.
    expect(maturity).toEqual({
      "societal-challenge": { current: 2, target: 3 },
      "student-agency": { current: "unassessed", target: 2 },
      overall: { target: 3 },
    });
  });

  it("renders an em dash in the Target cell only, when no ambition is recorded", () => {
    const md = buildDesignDocument({
      ...INPUT,
      maturity: { "societal-challenge": { current: 2 }, overall: {} },
    });
    expect(md).toContain("| overall | L2 (derived from 1 of 7 assessed criteria, mean 2.0) | — |");
  });
});

describe("designDocumentFilename", () => {
  it("derives a stable slug from the course title", () => {
    expect(designDocumentFilename("Git in the times of AI")).toBe("git-in-the-times-of-ai-module-design.md");
    expect(designDocumentFilename("Git in the times of AI")).toBe(designDocumentFilename("Git in the times of AI"));
  });

  it("falls back for a title with no usable characters", () => {
    expect(designDocumentFilename("///")).toBe("course-module-design.md");
  });
});
