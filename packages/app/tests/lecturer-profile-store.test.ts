/**
 * Tests for capability `agent-harness`, Requirement: Per-Lecturer Profile
 * Store — the file-backed half. Test names mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileLecturerProfileStore,
  LecturerProfileService,
  composePromptWithProfileNotes,
  profileEstimateRejectedNote,
  profileOverrideNote,
} from "../src/main/lecturer-profile-store.js";
import type { LecturerProfile } from "@cbe/pi-bridge/lecturer-profile";

const profile: LecturerProfile = {
  "pbl-prior-knowledge": {
    value: "pronounced",
    confidence: "high",
    evidence: "described a complete PBL sequence they ran",
    provenance: "estimate",
    lastRevised: "2026-06-11T12:00:00.000Z",
  },
  capacity: {
    value: "limited",
    confidence: "medium",
    evidence: "lecturer set this manually",
    provenance: "override",
    lastRevised: "2026-06-11T12:05:00.000Z",
  },
};

async function freshStore(): Promise<FileLecturerProfileStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "cbe-profile-"));
  return new FileLecturerProfileStore(path.join(dir, "lecturer-profile.json"));
}

describe("FileLecturerProfileStore", () => {
  // Scenario: Profile survives across sessions — a second store instance on the
  // same path (≙ app restart) reads back exactly what the first one wrote.
  it("round-trips the profile across store instances", async () => {
    const store = await freshStore();
    await store.save(profile);
    const again = new FileLecturerProfileStore(store.location);
    const loaded = await again.load();
    expect(loaded).toEqual(profile);
    expect(loaded?.capacity?.provenance).toBe("override");
    expect(loaded?.capacity?.lastRevised).toBe("2026-06-11T12:05:00.000Z");
  });

  // Scenario: Absent record means cold start
  it("yields null when no record exists", async () => {
    const store = await freshStore();
    expect(await store.load()).toBeNull();
  });

  it("degrades a corrupted or foreign file to a cold start instead of throwing", async () => {
    const store = await freshStore();
    await writeFile(store.location, "{ not json", "utf8");
    expect(await store.load()).toBeNull();
    await writeFile(store.location, JSON.stringify({ turns: [{ user: "hi" }] }), "utf8");
    expect(await store.load()).toBeNull();
  });

  // Scenario: Record is human-readable and free of transcripts
  it("writes pretty-printed JSON a lecturer can read", async () => {
    const store = await freshStore();
    await store.save(profile);
    const raw = await readFile(store.location, "utf8");
    expect(raw).toContain('\n  "pbl-prior-knowledge"');
    expect(raw).toContain('"provenance": "override"');
    expect(raw).not.toMatch(/assistant|transcript|turns/);
  });
});

describe("LecturerProfileService", () => {
  it("persists a skill-emitted estimate with provenance estimate and a lastRevised stamp", async () => {
    const service = new LecturerProfileService(await freshStore(), () => "2026-06-11T13:00:00.000Z");
    const result = await service.applyEstimate({
      dimension: "cbe-prior-knowledge",
      value: "some",
      confidence: "low",
      evidence: "uses 'challenge' but not 'Big Idea'",
    });
    expect(result.outcome).toBe("applied");
    expect(result.profile["cbe-prior-knowledge"]).toEqual({
      value: "some",
      confidence: "low",
      evidence: "uses 'challenge' but not 'Big Idea'",
      provenance: "estimate",
      lastRevised: "2026-06-11T13:00:00.000Z",
    });
  });

  // Scenario: Unconfirmed estimate does not displace an override
  it("a lecturer override wins and an unconfirmed estimate reports the rejection", async () => {
    const service = new LecturerProfileService(await freshStore());
    await service.applyOverride("pbl-prior-knowledge", "pronounced");
    const result = await service.applyEstimate({
      dimension: "pbl-prior-knowledge",
      value: "none",
      confidence: "high",
      evidence: "flat module brief",
    });
    expect(result.outcome).toBe("rejected-override");
    expect(result.profile["pbl-prior-knowledge"]?.value).toBe("pronounced");
    expect(result.profile["pbl-prior-knowledge"]?.provenance).toBe("override");
  });

  // Scenario: Confirmed revision replaces the override
  it("a lecturer-confirmed revision replaces the override with a regular estimate", async () => {
    const service = new LecturerProfileService(await freshStore(), () => "2026-06-12T09:00:00.000Z");
    await service.applyOverride("cbe-prior-knowledge", "none");
    const result = await service.applyEstimate({
      dimension: "cbe-prior-knowledge",
      value: "some",
      confidence: "medium",
      evidence: "turn 7: lecturer confirmed the revision after the contradiction was named",
      lecturerConfirmed: true,
    });
    expect(result.outcome).toBe("applied");
    expect(result.profile["cbe-prior-knowledge"]).toEqual({
      value: "some",
      confidence: "medium",
      evidence: "turn 7: lecturer confirmed the revision after the contradiction was named",
      provenance: "estimate",
      lastRevised: "2026-06-12T09:00:00.000Z",
    });
  });

  // Scenario: Confirmed flag changes nothing on non-overridden dimensions
  it("the confirmed flag is a no-op on non-overridden and absent dimensions", async () => {
    const service = new LecturerProfileService(await freshStore(), () => "2026-06-12T09:00:00.000Z");
    const onAbsent = await service.applyEstimate({
      dimension: "attitude",
      value: "neutral",
      confidence: "low",
      evidence: "a",
      lecturerConfirmed: true,
    });
    expect(onAbsent.outcome).toBe("applied");
    expect(onAbsent.profile.attitude?.provenance).toBe("estimate");
    const onEstimate = await service.applyEstimate({
      dimension: "attitude",
      value: "sceptic",
      confidence: "low",
      evidence: "b",
      lecturerConfirmed: true,
    });
    expect(onEstimate.outcome).toBe("applied");
    expect(onEstimate.profile.attitude?.value).toBe("sceptic");
    expect(onEstimate.profile.attitude?.provenance).toBe("estimate");
  });

  it("ignores an off-scale update instead of corrupting the record", async () => {
    const service = new LecturerProfileService(await freshStore());
    const result = await service.applyEstimate({
      dimension: "capacity",
      value: "enormous",
      confidence: "high",
      evidence: "x",
    });
    expect(result.outcome).toBe("rejected-invalid");
    expect(result.profile).toEqual({});
  });

  // Scenario: Manual override is persisted and takes precedence — the
  // next-turn-boundary half: the override becomes a bracketed system note
  // prepended to the next prompt, so the running session calibrates on it.
  it("surfaces an override to the running session as a system note on the next prompt", () => {
    const note = profileOverrideNote("capacity", "headroom");
    expect(note).toContain('"capacity" to "headroom"');
    expect(note).toContain("provenance: override");
    const composed = composePromptWithProfileNotes([note], "Wie weiter mit der Act-Phase?");
    expect(composed.startsWith("[System note: ")).toBe(true);
    expect(composed).toContain("Wie weiter mit der Act-Phase?");
    // No notes → the prompt is passed through untouched.
    expect(composePromptWithProfileNotes([], "unverändert")).toBe("unverändert");
  });

  // Scenario: Rejected estimate is surfaced to the agent, panel unchanged — the
  // note half: the rejection becomes a bracketed system note prepended to the
  // next prompt, so the agent stops narrating a revision that never happened.
  it("surfaces a rejected estimate to the agent as a system note on the next prompt", () => {
    const note = profileEstimateRejectedNote("cbe-prior-knowledge", "some");
    expect(note).toContain('"cbe-prior-knowledge" to "some"');
    expect(note).toContain("NOT applied");
    expect(note).toContain("lecturerConfirmed: true");
    const composed = composePromptWithProfileNotes([note], "Weiter mit dem Lernziel.");
    expect(composed.startsWith("[System note: ")).toBe(true);
    expect(composed).toContain("NOT applied");
    expect(composed).toContain("Weiter mit dem Lernziel.");
  });

  it("serialises concurrent updates so no write is lost", async () => {
    const service = new LecturerProfileService(await freshStore());
    await Promise.all([
      service.applyEstimate({ dimension: "capacity", value: "limited", confidence: "low", evidence: "a" }),
      service.applyEstimate({ dimension: "attitude", value: "neutral", confidence: "low", evidence: "b" }),
      service.applyEstimate({ dimension: "cbe-prior-knowledge", value: "none", confidence: "low", evidence: "c" }),
    ]);
    const current = await service.current();
    expect(Object.keys(current ?? {}).sort()).toEqual(["attitude", "capacity", "cbe-prior-knowledge"]);
  });
});
