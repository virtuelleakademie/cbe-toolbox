import { describe, it, expect } from "vitest";
import { UI_AFFORDANCE_KEYS, uiElementRegistryEntrySchema } from "../src/ui-registry.js";

// ui-reference-generation spec, Requirement: UI Element Registry.

const validEntry = {
  id: "sample-control",
  area: "Composer",
  label: "Sample control",
  description: "A sample lecturer-facing control.",
  howToUse: "Click it.",
};

describe("UI element registry entry schema", () => {
  it("accepts a complete entry without an affordance", () => {
    expect(uiElementRegistryEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  // Scenario: An affordance-gated control declares its affordance — the
  // affordance field only accepts known environment-descriptor keys.
  // Scenario: Every descriptor affordance key is declarable — the list is the
  // FULL descriptor key set, not a subset. Parity with the descriptor itself is
  // asserted in pi-bridge (which can import both sides); here the frozen list
  // documents what the validator accepts.
  it("accepts every known environment-descriptor affordance key", () => {
    expect(UI_AFFORDANCE_KEYS).toEqual([
      "canvas",
      "profilePanel",
      "courseWorkspace",
      "ingestion",
      "picker",
      "step",
      "maturity",
    ]);
    for (const affordance of UI_AFFORDANCE_KEYS) {
      const res = uiElementRegistryEntrySchema.safeParse({ ...validEntry, affordance });
      expect(res.success, `known affordance key "${affordance}" must be accepted`).toBe(true);
    }
  });

  // The Maturity panel is the concrete control this unblocked: while the list
  // stopped at `ingestion` its entry could not declare its gate at all.
  it("accepts an entry gated on the maturity affordance", () => {
    const res = uiElementRegistryEntrySchema.safeParse({ ...validEntry, affordance: "maturity" });
    expect(res.success).toBe(true);
  });

  it("rejects an affordance value that is not an environment-descriptor key", () => {
    for (const affordance of ["wiki", "profile", "shell", "Canvas", ""]) {
      const res = uiElementRegistryEntrySchema.safeParse({ ...validEntry, affordance });
      expect(res.success, `unknown affordance "${affordance}" must be rejected`).toBe(false);
    }
  });

  it("rejects entries with missing required fields or unknown extra fields", () => {
    for (const field of ["id", "area", "label", "description", "howToUse"] as const) {
      const { [field]: _omitted, ...partial } = validEntry;
      expect(uiElementRegistryEntrySchema.safeParse(partial).success, `missing "${field}" must be rejected`).toBe(
        false
      );
    }
    // .strict(): a typo'd field fails loudly instead of silently dropping out.
    expect(uiElementRegistryEntrySchema.safeParse({ ...validEntry, howToUseIt: "typo" }).success).toBe(false);
  });

  it("rejects a non-kebab-case id", () => {
    for (const id of ["Sample", "sample_control", "sample control", "-sample", "sample-"]) {
      expect(uiElementRegistryEntrySchema.safeParse({ ...validEntry, id }).success, `id "${id}"`).toBe(false);
    }
  });
});
