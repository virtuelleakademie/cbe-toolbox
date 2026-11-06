/**
 * Tests for the fire-and-forget `cbe_profile` generative-UI tool.
 *
 * Capability `agent-harness`, Requirement: cbe_profile Generative-UI Tool.
 * Test names mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { profileTool, ProfileParamsSchema } from "../src/profile-tool.js";

type ProfileResult = Awaited<ReturnType<typeof profileTool.execute>>;

async function run(params: Record<string, unknown>): Promise<ProfileResult> {
  return profileTool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

function details(r: ProfileResult): Record<string, unknown> {
  return r.details as Record<string, unknown>;
}

const valid = {
  dimension: "pbl-prior-knowledge",
  value: "pronounced",
  confidence: "medium",
  evidence: "turn 3: described a complete PBL sequence they ran",
};

describe("cbe_profile — fire-and-forget profile update", () => {
  // Scenario: Profile update flows through the tool to the host
  it("returns a synchronous profile-update ack carrying the full structured args", async () => {
    const r = await run(valid);
    expect(details(r)).toMatchObject({
      kind: "profile-update",
      dimension: "pbl-prior-knowledge",
      value: "pronounced",
      confidence: "medium",
      evidence: valid.evidence,
    });
    const text = (r.content[0] as { text: string }).text;
    expect(text).toMatch(/Profile estimate recorded/);
    // Fire-and-forget: no instruction to wait for a lecturer answer.
    expect(text).not.toMatch(/next user|wait for/i);
  });

  // Scenario: Acknowledgement does not over-claim
  it("acknowledges 'recorded' with the override-precedence caveat, never 'updated' as fact", async () => {
    const r = await run(valid);
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toMatch(/profile (updated|applied)/i);
    expect(text).toMatch(/their value stands and this estimate is not applied/);
  });

  // Scenario: Confirmed-revision flag is carried and surfaced
  it("carries lecturerConfirmed into the profile-update details and the ack", async () => {
    const r = await run({ ...valid, lecturerConfirmed: true });
    expect(details(r)).toMatchObject({ kind: "profile-update", lecturerConfirmed: true });
    const text = (r.content[0] as { text: string }).text;
    expect(text).toMatch(/lecturer-confirmed/);
  });

  it("omits lecturerConfirmed from the details when the call does not set it", async () => {
    const r = await run(valid);
    expect("lecturerConfirmed" in details(r)).toBe(false);
  });

  // Scenario: Malformed update is rejected without corrupting state
  it("rejects an unknown dimension or a value off the dimension's scale with a corrective error", async () => {
    for (const bad of [
      { ...valid, dimension: "teaching-style" }, // unknown dimension
      { ...valid, value: "expert" }, // off the pbl scale
      { ...valid, dimension: "capacity", value: "pronounced" }, // valid elsewhere, off THIS scale
      { ...valid, confidence: "certain" }, // unknown confidence
      { ...valid, evidence: "  " }, // empty evidence
    ]) {
      const r = await run(bad);
      expect(details(r).kind).toBe("profile-refusal");
      const text = (r.content[0] as { text: string }).text;
      expect(text).toMatch(/invalid payload/);
      expect(text).toMatch(/No profile update applied/);
    }
  });

  it("names the offending scale in the corrective error", async () => {
    const r = await run({ ...valid, dimension: "capacity", value: "pronounced" });
    const text = (r.content[0] as { text: string }).text;
    expect(text).toMatch(/saturated\|limited\|headroom/);
  });

  it("exposes the five dimensions, the evidence requirement, and the optional confirmation flag in its schema", () => {
    const schema = ProfileParamsSchema as unknown as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties)).toEqual([
      "dimension",
      "value",
      "confidence",
      "evidence",
      "lecturerConfirmed",
    ]);
    expect(schema.required).not.toContain("lecturerConfirmed");
  });
});
