/**
 * Tests for capability `agent-harness`, Requirement: Session-Start Profile
 * Injection — the prior block rendered into the environment descriptor — and
 * the allowlist half of Requirement: cbe_profile Generative-UI Tool.
 * Test names mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { buildEnvironmentDescriptor } from "../src/environment.js";
import { CBE_TOOL_ALLOWLIST } from "../src/session.js";
import { profileTool } from "../src/profile-tool.js";
import type { LecturerProfile } from "../src/lecturer-profile.js";

const profile: LecturerProfile = {
  "pbl-prior-knowledge": {
    value: "pronounced",
    confidence: "high",
    evidence: "described a complete PBL sequence they ran",
    provenance: "estimate",
    lastRevised: "2026-06-10T09:00:00.000Z",
  },
  capacity: {
    value: "limited",
    confidence: "medium",
    evidence: "lecturer set this manually",
    provenance: "override",
    lastRevised: "2026-06-10T09:05:00.000Z",
  },
};

describe("session-start profile injection", () => {
  // Scenario: Stored profile is injected as a prior
  it("renders the lecturer-profile prior block with value, confidence, provenance, last-revised", () => {
    const env = buildEnvironmentDescriptor({ profile: "app", lecturerProfile: profile });
    const block = env.toSystemPromptBlock();
    expect(block).toContain("lecturer-profile prior:");
    expect(block).toContain("pbl-prior-knowledge: pronounced");
    expect(block).toContain("confidence: high");
    expect(block).toContain("provenance: estimate");
    expect(block).toContain("last revised: 2026-06-10T09:00:00.000Z");
    // The prior-not-truth instruction is part of the block.
    expect(block).toMatch(/PRIOR, not truth/);
    expect(block).toMatch(/record every revision via cbe_profile/);
    // The block sits inside the descriptor, before the END marker.
    expect(block.indexOf("lecturer-profile prior:")).toBeLessThan(block.indexOf("--- END ---"));
  });

  // Scenario: No profile, no block
  it("omits the block entirely when no profile is provided or the record is empty", () => {
    const without = buildEnvironmentDescriptor({ profile: "app" }).toSystemPromptBlock();
    expect(without).not.toContain("lecturer-profile prior:");
    const empty = buildEnvironmentDescriptor({ profile: "app", lecturerProfile: {} }).toSystemPromptBlock();
    expect(empty).toBe(without);
  });

  // Scenario: Override provenance is carried into the prior
  it("marks lecturer-overridden dimensions so the skill applies ask-before-revising", () => {
    const block = buildEnvironmentDescriptor({ profile: "app", lecturerProfile: profile }).toSystemPromptBlock();
    expect(block).toContain("capacity: limited");
    expect(block).toContain("[LECTURER OVERRIDE]");
    expect(block).toMatch(/never revise them on your own initiative/);
    // The estimate-provenance dimension is NOT marked as an override.
    const pblLine = block.split("\n").find((l) => l.includes("pbl-prior-knowledge: pronounced"));
    expect(pblLine).toBeDefined();
    expect(pblLine).not.toContain("[LECTURER OVERRIDE]");
  });
});

describe("cbe_profile registration surface", () => {
  // Scenario: Tool is registered in both profiles — the allowlist is one
  // profile-independent constant fed to createAgentSession, so presence in the
  // constant guarantees presence in app AND headless.
  it("cbe_profile is in the profile-independent allowlist and registered as a customTool", () => {
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).toContain("cbe_profile");
    expect(profileTool.name).toBe("cbe_profile");
  });
});
