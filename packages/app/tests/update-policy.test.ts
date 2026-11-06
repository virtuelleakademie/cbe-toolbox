/**
 * Pure update-offer policy (capability `distribution`, Requirement:
 * Auto-update mechanism — Scenario: User can decline updates): a skipped
 * version is never offered again; skip persistence round-trips.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSkippedVersion, shouldOfferUpdate, writeSkippedVersion } from "../src/main/update-policy";

describe("shouldOfferUpdate", () => {
  it("offers a new version when nothing was skipped", () => {
    expect(shouldOfferUpdate("0.2.0", null)).toBe(true);
  });

  it("never re-offers the version the user skipped", () => {
    expect(shouldOfferUpdate("0.2.0", "0.2.0")).toBe(false);
  });

  it("offers a version newer than the skipped one", () => {
    expect(shouldOfferUpdate("0.3.0", "0.2.0")).toBe(true);
  });
});

describe("skip persistence", () => {
  it("round-trips the skipped version and defaults to null when absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-update-prefs-"));
    const prefsPath = path.join(dir, "update-prefs.json");
    try {
      expect(await readSkippedVersion(prefsPath)).toBeNull();
      await writeSkippedVersion(prefsPath, "0.2.0");
      expect(await readSkippedVersion(prefsPath)).toBe("0.2.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
