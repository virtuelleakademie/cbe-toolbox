/**
 * The per-lecturer identity record (capability `agent-harness`, Requirement:
 * *Per-Lecturer Identity Record*). One test per spec scenario; the `describe`/`it`
 * names mirror the scenario headings.
 *
 * The load-bearing assertion is the LAST one: nothing about this record may leak
 * into the lecturer-state profile, because that record is typed and rendered as a
 * map of the five dimensions and would emit an identity value as a dimension line
 * complete with a confidence it does not have.
 */
import { describe, it, expect } from "vitest";
import {
  hasRecordedIdentity,
  isLecturerIdentity,
  isWithinIdentityLimit,
  LECTURER_IDENTITY_FIELDS,
  LECTURER_IDENTITY_MAX_LENGTH,
  normaliseIdentityValue,
  normaliseLecturerIdentity,
  type LecturerIdentity,
  type LecturerIdentityStore,
} from "../src/lecturer-identity.js";
import { isLecturerProfile } from "../src/lecturer-profile.js";
import { buildEnvironmentDescriptor } from "../src/environment.js";

/** The in-memory store a headless host may pass (Requirement: "Headless hosts MAY
 *  pass an in-memory or no-op store"), used here to exercise the round-trip without
 *  a filesystem. The app's file-backed implementation is covered in
 *  `packages/app/tests/lecturer-identity-store.test.ts`. */
class MemoryIdentityStore implements LecturerIdentityStore {
  private record: LecturerIdentity | null = null;
  async load(): Promise<LecturerIdentity | null> {
    return this.record;
  }
  async save(identity: LecturerIdentity): Promise<void> {
    this.record = normaliseLecturerIdentity(identity);
  }
}

describe("Per-Lecturer Identity Record", () => {
  // Scenario: Both fields survive across sessions
  it("keeps both values exactly as they were entered across a store round-trip", async () => {
    const store = new MemoryIdentityStore();
    await store.save({ name: "Anna Béringer-Oduya", formOfAddress: "Frau Prof. Béringer" });
    // A "later session" is a fresh load from the same store.
    const reloaded = await store.load();
    expect(reloaded).toEqual({ name: "Anna Béringer-Oduya", formOfAddress: "Frau Prof. Béringer" });
  });

  // Scenario: Each field can be recorded without the other
  it("accepts either field alone, with the other in the not-recorded state", async () => {
    const store = new MemoryIdentityStore();

    await store.save({ formOfAddress: "just Sam" });
    expect(await store.load()).toEqual({ formOfAddress: "just Sam" });
    expect((await store.load())?.name).toBeUndefined();

    await store.save({ name: "Sam Oyelaran" });
    expect(await store.load()).toEqual({ name: "Sam Oyelaran" });
    expect((await store.load())?.formOfAddress).toBeUndefined();

    // Neither field is required by the other, and both guards accept the one-field record.
    expect(isLecturerIdentity({ name: "Sam Oyelaran" })).toBe(true);
    expect(isLecturerIdentity({ formOfAddress: "just Sam" })).toBe(true);
  });

  // Scenario: Absent, empty and unreadable records all mean not recorded
  it("resolves absent, empty and whitespace-only fields to the one not-recorded state", () => {
    // The five inputs the requirement enumerates, all collapsing to the same outcome.
    expect(normaliseLecturerIdentity(undefined)).toEqual({});
    expect(normaliseLecturerIdentity(null)).toEqual({});
    expect(normaliseLecturerIdentity({})).toEqual({});
    expect(normaliseLecturerIdentity({ name: "" })).toEqual({});
    expect(normaliseLecturerIdentity({ name: "   \t\n " })).toEqual({});
    expect(normaliseLecturerIdentity({ name: "", formOfAddress: "  " })).toEqual({});

    // A guard-failing record is not silently repaired into a half-record either.
    expect(isLecturerIdentity({ name: 42 })).toBe(false);
    expect(isLecturerIdentity({ nickname: "Sam" })).toBe(false);
    expect(isLecturerIdentity([])).toBe(false);
    expect(isLecturerIdentity("Sam")).toBe(false);

    // Nothing empty survives to a consumer: no "", no placeholder, no present key.
    const normalised = normaliseLecturerIdentity({ name: "  ", formOfAddress: " Herr Doktor " });
    expect(Object.keys(normalised)).toEqual(["formOfAddress"]);
    expect(normalised.formOfAddress).toBe("Herr Doktor");
    expect(hasRecordedIdentity(normalised)).toBe(true);
    expect(hasRecordedIdentity({})).toBe(false);
    expect(hasRecordedIdentity(null)).toBe(false);
    expect(hasRecordedIdentity({ name: "   " })).toBe(false);
  });

  it("never throws on a malformed input, so a bad record cannot break session start", () => {
    // Same scenario, the "without throwing" half: every shape a corrupt file can
    // parse to has to come back as a decision, not an exception.
    for (const bad of [undefined, null, 0, "x", [], [{ name: "x" }], { name: {} }, { name: ["x"] }]) {
      expect(() => normaliseLecturerIdentity(bad)).not.toThrow();
      expect(() => isLecturerIdentity(bad)).not.toThrow();
      expect(() => hasRecordedIdentity(bad as LecturerIdentity)).not.toThrow();
    }
  });

  // Scenario: The record carries no estimate machinery
  it("carries the two fields and no confidence, evidence, provenance or override marking", () => {
    expect([...LECTURER_IDENTITY_FIELDS]).toEqual(["name", "formOfAddress"]);

    // The guard is the enforcement: every estimate-machinery key rejects, so no
    // record carrying one can round-trip through the store or the IPC boundary.
    for (const foreign of ["confidence", "evidence", "provenance", "lastRevised", "value"]) {
      expect(isLecturerIdentity({ name: "Sam", [foreign]: "high" })).toBe(false);
    }
    // And the normaliser drops them rather than passing them on.
    expect(normaliseLecturerIdentity({ name: "Sam", confidence: "high", provenance: "estimate" })).toEqual({
      name: "Sam",
    });
  });

  it("exposes no writer to any tool — the module offers a store and nothing that estimates", async () => {
    // Same scenario, the "no path exists by which cbe_profile or any other tool can
    // write it" half. `cbe_profile` writes through `applyProfileUpdate` on the
    // PROFILE record, whose guard rejects an identity key outright; there is no
    // identity counterpart of `applyEstimate` anywhere in the module surface.
    const surface = await import("../src/lecturer-identity.js");
    expect(Object.keys(surface).sort()).toEqual([
      "LECTURER_IDENTITY_FIELDS",
      "LECTURER_IDENTITY_MAX_LENGTH",
      "hasRecordedIdentity",
      "isLecturerIdentity",
      "isWithinIdentityLimit",
      "normaliseIdentityValue",
      "normaliseLecturerIdentity",
    ]);
  });

  // Scenario: The identity record is not part of the profile record
  it("cannot enter the profile record, and no identity value is emitted as a dimension line", () => {
    // The profile guard rejects a foreign key deliberately — that is what makes the
    // separate record a type-level invariant rather than something the descriptor
    // renderer has to remember.
    expect(isLecturerProfile({ name: "Sam" })).toBe(false);
    expect(isLecturerProfile({ formOfAddress: "just Sam" })).toBe(false);

    const block = buildEnvironmentDescriptor({
      profile: "app",
      paths: { corpus: "/c" },
      lecturerProfile: {
        capacity: {
          value: "limited",
          confidence: "medium",
          evidence: "said the semester is full",
          provenance: "estimate",
          lastRevised: "2026-08-17T09:00:00.000Z",
        },
      },
      lecturerIdentity: { name: "Sam Oyelaran", formOfAddress: "just Sam" },
    }).toSystemPromptBlock();

    // The profile prior contains ONLY the dimension line…
    const prior = block.slice(block.indexOf("lecturer-profile prior:"));
    const dimensionLines = prior.split("\n").filter((l) => /^ {2}[a-z-]+: /.test(l));
    expect(dimensionLines).toEqual([
      "  capacity: limited   # confidence: medium, provenance: estimate, last revised: 2026-08-17T09:00:00.000Z, evidence: said the semester is full",
    ]);
    // …and no identity value appears anywhere inside it.
    expect(prior).not.toContain("Sam Oyelaran");
    expect(prior).not.toContain("just Sam");
    // The identity block is a separate block, ahead of the profile prior.
    expect(block.indexOf("lecturer-identity")).toBeLessThan(block.indexOf("lecturer-profile prior:"));
  });

  // Scenario: The stored value is not normalised
  it("stores the lecturer's own capitalisation, diacritics, script and spacing untouched", async () => {
    const store = new MemoryIdentityStore();
    const entered = "  Frau Prof. Dr. İnci Öztürk-Ñuñez ／ 教授  ";
    await store.save({ formOfAddress: entered });
    const stored = (await store.load())?.formOfAddress;

    // Only surrounding whitespace is trimmed. Everything else is byte-identical.
    expect(stored).toBe(entered.trim());
    expect(stored).toBe("Frau Prof. Dr. İnci Öztürk-Ñuñez ／ 教授");
    // Explicitly NOT case-normalised, transliterated, expanded or reordered.
    expect(stored).not.toBe(entered.trim().toLowerCase());
    expect(stored).toContain("İ");
    expect(stored).toContain("教授");
    expect(stored).toContain("Prof."); // not expanded to "Professor"
    // Interior spacing survives too — only the surrounding kind is touched.
    expect(normaliseIdentityValue("  a   b  ")).toBe("a   b");
  });

  it("documents a maximum length and reports an over-long value rather than shortening it", () => {
    expect(LECTURER_IDENTITY_MAX_LENGTH).toBeGreaterThan(0);
    const overLong = "x".repeat(LECTURER_IDENTITY_MAX_LENGTH + 1);
    expect(isWithinIdentityLimit(overLong)).toBe(false);
    expect(isWithinIdentityLimit("x".repeat(LECTURER_IDENTITY_MAX_LENGTH))).toBe(true);
    expect(isWithinIdentityLimit(undefined)).toBe(true);
    // The normaliser is not a truncator: it hands the value on at full length so the
    // refusal happens at the editing surface with a visible reason.
    expect(normaliseLecturerIdentity({ name: overLong }).name).toHaveLength(overLong.length);
  });
});
