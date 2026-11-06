import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The closed-test channel now ships a signed/notarized macOS build while
// Windows and Linux remain unsigned. The tester note MUST keep those platform
// boundaries explicit and explain how to verify integrity.
// Spec: distribution — Code signing for macOS and Windows,
//   Scenario: macOS installer opens without a Gatekeeper bypass.
const note = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/closed-testing.md"),
  "utf8"
);

describe("Release-build installation documents each platform's trust state", () => {
  it("documents that macOS needs no Gatekeeper bypass", () => {
    expect(note).toMatch(/signed with an Apple\s+Developer ID and notarized by Apple/);
    expect(note).toMatch(/no Terminal[\s\S]*Gatekeeper bypass is required/);
    expect(note).not.toMatch(/xattr -dr com\.apple\.quarantine/);
  });

  // Since PR #95 the Windows route is: Edge download unblock, then the file's
  // Unblock checkbox, with the SmartScreen override as the fallback.
  it("documents the Windows SmartScreen bypass steps", () => {
    expect(note).toMatch(/SmartScreen/);
    expect(note).toMatch(/Edge/);
    expect(note).toMatch(/\*\*Unblock\*\*/);
    expect(note).toMatch(/More info[\s\S]*Run anyway/);
  });

  it("tells testers how to verify the SHA256 before running", () => {
    expect(note).toMatch(/SHA256SUMS\.txt/);
    expect(note).toMatch(/shasum -a 256|Get-FileHash/);
  });

  // Linux ships unsigned by design (spec: Code signing for macOS and Windows —
  // "Linux builds SHALL be distributed as an unsigned AppImage with a published
  // SHA256 hash"); the note must cover the download and how to run it.
  it("documents the Linux AppImage download and launch steps", () => {
    expect(note).toMatch(/\.AppImage/);
    expect(note).toMatch(/chmod \+x/);
  });
});
