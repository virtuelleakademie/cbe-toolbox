import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256Hex, isDistributable, formatChecksumFile } from "../scripts/checksums.mjs";

describe("SHA256 hashes published alongside platform builds", () => {
  it("computes a stable SHA256 hex digest for installer bytes", () => {
    const bytes = Buffer.from("CBE Toolbox installer");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(sha256Hex(bytes)).toBe(expected);
  });

  it("selects only distributable installer artifacts", () => {
    expect(isDistributable("CBE-Toolbox-0.1.0-arm64.dmg")).toBe(true);
    expect(isDistributable("CBE-Toolbox-0.1.0-x64.exe")).toBe(true);
    expect(isDistributable("CBE-Toolbox-0.1.0-arm64-mac.zip")).toBe(true);
    expect(isDistributable("App-0.1.0.AppImage")).toBe(true);
    // Build metadata and blockmaps are not published as downloads.
    expect(isDistributable("latest-mac.yml")).toBe(false);
    expect(isDistributable("CBE-Toolbox-0.1.0-arm64.dmg.blockmap")).toBe(false);
  });

  it("renders sha256sum format sorted by name for reproducible output", () => {
    const out = formatChecksumFile([
      { name: "b.exe", sha256: "bbbb" },
      { name: "a.dmg", sha256: "aaaa" },
    ]);
    expect(out).toBe("aaaa  a.dmg\nbbbb  b.exe\n");
  });

  // Regression: the CLI guard must fire even when the repo path contains spaces
  // (`import.meta.url` percent-encodes them) — otherwise main() silently no-ops
  // and SHA256SUMS.txt is never written.
  it("writes SHA256SUMS.txt for installers when run as a CLI", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cbe checksums "));
    try {
      writeFileSync(path.join(dir, "CBE-Toolbox-0.1.0-arm64.dmg"), "dmg-bytes");
      writeFileSync(path.join(dir, "CBE-Toolbox-0.1.0-x64.exe"), "exe-bytes");
      writeFileSync(path.join(dir, "notes.txt"), "ignored");

      const script = path.resolve(process.cwd(), "scripts/checksums.mjs");
      execFileSync("node", [script, dir]);

      const manifest = readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8");
      expect(manifest).toContain(`${sha256Hex(Buffer.from("dmg-bytes"))}  CBE-Toolbox-0.1.0-arm64.dmg`);
      expect(manifest).toContain(`${sha256Hex(Buffer.from("exe-bytes"))}  CBE-Toolbox-0.1.0-x64.exe`);
      expect(manifest).not.toContain("notes.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
