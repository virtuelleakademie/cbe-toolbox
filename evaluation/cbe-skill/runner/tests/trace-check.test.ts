import { describe, it, expect } from "vitest";
import {
  checkTraceability,
  extractHeadings,
  extractIdentityPromptSource,
  extractToolBindingSource,
  fullCheckpointId,
  resolveAnchor,
  routeFix,
  type SkillTree,
  type TraceEntry,
} from "../src/trace-check.js";

const SKILL_CONTENT = `# Kompetenz Check — active sharpness interrogation

## The three axes

Body text with the marker: Required citations when flagging a domain-general goal.

\`\`\`text
## Heading inside a fence — must not count
\`\`\`
`;

function skillTree(): SkillTree {
  return new Map([
    ["references/checks/kompetenz-check.md", { headings: extractHeadings(SKILL_CONTENT), content: SKILL_CONTENT }],
  ]);
}

function entry(overrides: Partial<TraceEntry>): TraceEntry {
  return {
    checkpoint: "07.7a.1",
    anchors: [{ file: "references/checks/kompetenz-check.md", heading: "The three axes" }],
    requirement: "cbe-skill / Kompetenz Check",
    classification: "satisfied",
    ...overrides,
  };
}

describe("trace-check", () => {
  // spec: Every checkpoint has a map entry
  // spec: Adding a checkpoint without a map entry is caught
  it("reports a scenario checkpoint with no map entry, naming the unmapped id", () => {
    const report = checkTraceability([entry({})], new Set(["07.7a.1", "07.7a.2"]), skillTree());
    expect(report.unmappedCheckpoints).toEqual(["07.7a.2"]);
    expect(report.ok).toBe(false);
  });

  it("passes when every suite checkpoint has exactly one entry with a live anchor", () => {
    const report = checkTraceability([entry({})], new Set(["07.7a.1"]), skillTree());
    expect(report.unmappedCheckpoints).toEqual([]);
    expect(report.staleCheckpoints).toEqual([]);
    expect(report.staleAnchors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("allows unmeasured before measurement but rejects it at the archive gate", () => {
    const pending = entry({ classification: "unmeasured" });

    const preMeasurement = checkTraceability([pending], new Set(["07.7a.1"]), skillTree());
    expect(preMeasurement.unmeasured).toEqual(["07.7a.1"]);
    expect(preMeasurement.ok).toBe(true);

    const archiveGate = checkTraceability([pending], new Set(["07.7a.1"]), skillTree(), {
      requireClassified: true,
    });
    expect(archiveGate.unmeasured).toEqual(["07.7a.1"]);
    expect(archiveGate.ok).toBe(false);
  });

  it("rejects the retired unclassified state and a missing owning requirement", () => {
    const retired = entry({ classification: "unclassified" as TraceEntry["classification"] });
    const missingRequirement = entry({ checkpoint: "07.7a.2", requirement: "" });
    const report = checkTraceability([retired, missingRequirement], new Set(["07.7a.1", "07.7a.2"]), skillTree());
    expect(report.invalidEntries).toEqual([
      '07.7a.1: invalid classification "unclassified"',
      "07.7a.2: requirement must be a non-empty string",
    ]);
    expect(report.ok).toBe(false);
  });

  it("reports a checkpoint id appearing in more than one map entry", () => {
    const report = checkTraceability([entry({}), entry({})], new Set(["07.7a.1"]), skillTree());
    expect(report.duplicateEntries).toEqual(["07.7a.1"]);
    expect(report.ok).toBe(false);
  });

  // Requirement: *Coverage is checkable*, Scenario: *An unanchored checkpoint fails the
  // check*. It was report-only before, and the report was ignored for 234 of 296
  // entries — so the finding is no longer downgradable to a warning.
  it("FAILS the check on an unanchored entry", () => {
    const report = checkTraceability(
      [entry({ anchors: [], classification: "unmeasured" })],
      new Set(["07.7a.1"]),
      skillTree()
    );
    expect(report.unanchored).toEqual(["07.7a.1"]);
    expect(report.ok).toBe(false);
  });

  it("fails an unanchored entry regardless of its classification", () => {
    // `scenario-flaw` used to be the escape hatch. It is not one any more: a checkpoint
    // whose governing passage cannot be named is not ready to ship either way.
    const report = checkTraceability(
      [entry({ anchors: [], classification: "scenario-flaw" })],
      new Set(["07.7a.1"]),
      skillTree()
    );
    expect(report.unanchored).toEqual(["07.7a.1"]);
    expect(report.ok).toBe(false);
  });

  // spec: Stale anchor is flagged
  it("flags an entry referencing a missing skill file or heading as stale", () => {
    const report = checkTraceability(
      [
        entry({
          checkpoint: "07.7a.1",
          anchors: [{ file: "references/checks/gone.md", heading: "The three axes" }],
        }),
        entry({
          checkpoint: "07.7a.2",
          anchors: [{ file: "references/checks/kompetenz-check.md", heading: "No such heading" }],
        }),
      ],
      new Set(["07.7a.1", "07.7a.2"]),
      skillTree()
    );
    expect(report.staleAnchors).toHaveLength(2);
    expect(report.staleAnchors[0]).toMatchObject({ checkpoint: "07.7a.1", reason: "missing-file" });
    expect(report.staleAnchors[1]).toMatchObject({ checkpoint: "07.7a.2", reason: "missing-heading" });
    expect(report.ok).toBe(false);
  });

  // spec: Stale anchor is flagged (checkpoint-id side)
  it("flags an entry whose checkpoint id no longer exists in the suite as stale", () => {
    const report = checkTraceability([entry({ checkpoint: "07.7z.9" })], new Set(["07.7a.1"]), skillTree());
    expect(report.staleCheckpoints).toEqual(["07.7z.9"]);
    expect(report.unmappedCheckpoints).toEqual(["07.7a.1"]);
    expect(report.ok).toBe(false);
  });

  it("resolves an anchor by markdown heading or by unique marker string, ignoring fenced code", () => {
    const tree = skillTree();
    expect(resolveAnchor({ file: "references/checks/kompetenz-check.md", heading: "The three axes" }, tree)).toBeNull();
    expect(
      resolveAnchor(
        {
          file: "references/checks/kompetenz-check.md",
          heading: "Required citations when flagging a domain-general goal",
        },
        tree
      )
    ).toBeNull();
    // Fenced lines are not headings (only the marker fallback can match them)…
    expect(extractHeadings(SKILL_CONTENT)).not.toContain("Heading inside a fence — must not count");
    // …and a string absent from the file resolves to a stale anchor.
    expect(
      resolveAnchor({ file: "references/checks/kompetenz-check.md", heading: "Entirely absent heading" }, tree)
    ).toBe("missing-heading");
  });

  it("reports a skill section that no checkpoint maps to as untested", () => {
    const report = checkTraceability(
      [entry({})], // anchors only "The three axes"
      new Set(["07.7a.1"]),
      skillTree()
    );
    expect(report.untestedSections).toContainEqual({
      file: "references/checks/kompetenz-check.md",
      heading: "Kompetenz Check — active sharpness interrogation",
    });
    expect(report.untestedSections).not.toContainEqual({
      file: "references/checks/kompetenz-check.md",
      heading: "The three axes",
    });
  });

  // spec: An entry routes a failing checkpoint to its fix
  it("routes a failing checkpoint to its fix target by classification", () => {
    const scenarioFiles = new Map([["07.7a.1", "07-kompetenz-check.md"]]);

    const realGap = routeFix(entry({ classification: "real-gap" }), scenarioFiles);
    expect(realGap).toEqual({
      kind: "skill-anchor",
      targets: [{ file: "references/checks/kompetenz-check.md", heading: "The three axes" }],
    });

    const suspect = routeFix(entry({ classification: "suspect-check" }), scenarioFiles);
    expect(suspect).toEqual({ kind: "requirement", target: "cbe-skill / Kompetenz Check" });

    const flaw = routeFix(entry({ classification: "scenario-flaw" }), scenarioFiles);
    expect(flaw).toEqual({ kind: "scenario", target: "07-kompetenz-check.md" });

    expect(routeFix(entry({ classification: "satisfied" }), scenarioFiles)).toEqual({ kind: "none" });
    expect(routeFix(entry({ classification: "unmeasured" }), scenarioFiles)).toEqual({ kind: "none" });
  });

  it("extracts only text that reaches the prompt and tool binding channels", () => {
    const promptSource = `
      // Retired marker
      export const cbeIdentityPrompt = \`# Live prompt\\nBinding marker\`;
      const discarded = \`# Retired prompt\`;
    `;
    expect(extractIdentityPromptSource(promptSource)).toBe("# Live prompt\nBinding marker");

    const toolSource = `
      const KEYS = ["first", "second"] as const;
      const SCALES = { first: ["low", "high"], second: ["open", "closed"] } as const;
      const Params = Type.Object({
        id: Type.String({ description: "Bound parameter " + "marker" }),
        criterion: Type.String({ description: \`Allowed: (${'${KEYS.join(" | ")}'})\` }),
        value: Type.String({
          description: "Scales: " + KEYS.map((key) => \`${"${key}"}: ${'${SCALES[key].join("|")}'}\`).join("; ")
        }),
        unsupported: Type.String({
          description: KEYS.map(([key]) => key).join(",")
        })
      });
      defineTool({
        name: "cbe_live",
        description: "Bound tool marker",
        promptSnippet: "Discarded snippet marker",
        promptGuidelines: ["Discarded guideline marker"],
        parameters: Params
      });
      // Comment-only marker
    `;
    const binding = extractToolBindingSource(toolSource, "cbe_live");
    expect(binding).toContain("Bound tool marker");
    expect(binding).toContain("Bound parameter marker");
    expect(binding).toContain("Allowed: (first | second)");
    expect(binding).toContain("Scales: first: low|high; second: open|closed");
    expect(binding).not.toContain("unsupported");
    expect(binding).not.toContain("Discarded snippet marker");
    expect(binding).not.toContain("Discarded guideline marker");
    expect(binding).not.toContain("Comment-only marker");
  });

  it("derives suite-unique checkpoint ids, probe-qualifying only when needed", () => {
    expect(fullCheckpointId("07", "7a", "7a.1")).toBe("07.7a.1");
    expect(fullCheckpointId("31", "31b", "bigidea")).toBe("31.31b.bigidea");
  });
});
