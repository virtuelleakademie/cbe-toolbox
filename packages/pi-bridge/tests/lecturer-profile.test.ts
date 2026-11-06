import { describe, it, expect } from "vitest";
import {
  PROFILE_DIMENSIONS,
  DIMENSION_SCALES,
  applyProfileUpdate,
  isLecturerProfile,
  isProfileDimension,
  isValidDimensionValue,
  type DimensionRecord,
  type LecturerProfile,
} from "../src/lecturer-profile.js";

/**
 * Tests for capability `agent-harness`, Requirement: Per-Lecturer Profile
 * Store — the shape/guard half. The file-backed store half lives in
 * packages/app (main process); this module owns schema and guards shared by
 * both ends.
 */

const record = (over: Partial<DimensionRecord> = {}): DimensionRecord => ({
  value: "pronounced",
  confidence: "medium",
  evidence: "turn 6: fluent use of 'Guiding Questions' and structured rubric",
  provenance: "estimate",
  lastRevised: "2026-06-11T12:00:00.000Z",
  ...over,
});

describe("lecturer-profile schema", () => {
  it("models exactly the five spec dimensions", () => {
    expect(PROFILE_DIMENSIONS).toEqual([
      "pbl-prior-knowledge",
      "cbe-prior-knowledge",
      "didactic-stance",
      "attitude",
      "capacity",
    ]);
    for (const d of PROFILE_DIMENSIONS) {
      expect(DIMENSION_SCALES[d].length).toBeGreaterThanOrEqual(3);
    }
  });

  it("validates values against the per-dimension scale", () => {
    expect(isValidDimensionValue("pbl-prior-knowledge", "pronounced")).toBe(true);
    expect(isValidDimensionValue("capacity", "saturated")).toBe(true);
    expect(isValidDimensionValue("capacity", "pronounced")).toBe(false);
    expect(isProfileDimension("attitude")).toBe(true);
    expect(isProfileDimension("teaching-style")).toBe(false);
  });
});

describe("isLecturerProfile guard", () => {
  // Scenario: Record is human-readable and free of transcripts — the shape
  // admits only structured dimension records, nothing transcript-like.
  it("accepts a valid record and the empty profile", () => {
    const profile: LecturerProfile = {
      "pbl-prior-knowledge": record(),
      capacity: record({ value: "limited", provenance: "override" }),
    };
    expect(isLecturerProfile(profile)).toBe(true);
    expect(isLecturerProfile({})).toBe(true);
  });

  it("rejects malformed records", () => {
    expect(isLecturerProfile(null)).toBe(false);
    expect(isLecturerProfile([])).toBe(false);
    // unknown dimension key
    expect(isLecturerProfile({ "teaching-style": record() })).toBe(false);
    // value off the dimension's scale
    expect(isLecturerProfile({ capacity: record({ value: "pronounced" }) })).toBe(false);
    // bad confidence / provenance / missing evidence
    expect(isLecturerProfile({ attitude: { ...record({ value: "neutral" }), confidence: "certain" } })).toBe(false);
    expect(isLecturerProfile({ attitude: { ...record({ value: "neutral" }), provenance: "system" } })).toBe(false);
    const noEvidence: Record<string, unknown> = { ...record({ value: "neutral" }) };
    delete noEvidence.evidence;
    expect(isLecturerProfile({ attitude: noEvidence })).toBe(false);
  });

  it("rejects transcript-shaped content (free-form keys, nested turns)", () => {
    expect(isLecturerProfile({ turns: [{ user: "...", assistant: "..." }] })).toBe(false);
  });
});

describe("applyProfileUpdate", () => {
  it("is pure and last-write-wins per dimension", () => {
    const before: LecturerProfile = { "cbe-prior-knowledge": record({ value: "none" }) };
    const after = applyProfileUpdate(before, "cbe-prior-knowledge", record({ value: "some" }));
    expect(after["cbe-prior-knowledge"]?.value).toBe("some");
    expect(before["cbe-prior-knowledge"]?.value).toBe("none");
  });

  // Scenario: Malformed update is rejected without corrupting state.
  it("throws on an off-scale value and leaves the input untouched", () => {
    const before: LecturerProfile = { capacity: record({ value: "limited" }) };
    expect(() => applyProfileUpdate(before, "capacity", record({ value: "enormous" }))).toThrow(
      /not on the capacity scale/
    );
    expect(before.capacity?.value).toBe("limited");
  });
});
