import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  changelogSections,
  composeReleaseBody,
  MAX_RELEASE_BODY,
  readProductMetadata,
  releaseMetadataProblems,
} from "../scripts/release-metadata.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

## [1.2.4] — 2026-10-18

### Fixed

- Something a lecturer can see.

## [1.2.3] — 2026-09-01

### Added

- Older entry.
`;

const ok = { appVersion: "1.2.4", lockVersion: "1.2.4", changelog: CHANGELOG };

describe("release metadata of the product tree", () => {
  it("names the app version in the lockfile and the top CHANGELOG section", async () => {
    const meta = await readProductMetadata(repoRoot);
    expect(releaseMetadataProblems(meta)).toEqual([]);
  });

  it("composes a release body that carries the section and the closed-testing note", async () => {
    const meta = await readProductMetadata(repoRoot);
    const body = composeReleaseBody({
      changelog: meta.changelog,
      version: meta.appVersion,
      testerNote: meta.testerNote,
    });
    expect(body.startsWith(`## CBE Toolbox ${meta.appVersion} — `)).toBe(true);
    expect(body).toContain("# Closed testing — installing a CBE Toolbox release build");
    expect(body).toMatch(/signed with an Apple\s+Developer ID and notarized by Apple/);
    expect(body).toContain("Windows remains unsigned");
    expect(body).not.toContain("xattr -dr com.apple.quarantine");
    expect(body).toContain("[English and German lecturer documentation](docs/user/README.md)");
    expect(body.length).toBeLessThan(MAX_RELEASE_BODY);
  });
});

describe("release metadata check", () => {
  it("accepts a released version during ordinary development, with Unreleased entries above it", () => {
    const dev = CHANGELOG.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Added\n\n- Work in progress.\n");
    expect(releaseMetadataProblems({ ...ok, changelog: dev })).toEqual([]);
  });

  it("refuses a version bump whose section is missing", () => {
    const problems = releaseMetadataProblems({ ...ok, appVersion: "1.2.5", lockVersion: "1.2.5" });
    expect(problems.join("\n")).toMatch(/newest CHANGELOG\.md section is 1\.2\.4, but the app version is 1\.2\.5/);
  });

  it("refuses a lockfile that names another version", () => {
    expect(releaseMetadataProblems({ ...ok, lockVersion: "1.2.3" }).join("\n")).toMatch(/package-lock\.json/);
  });

  it("refuses a tag that names another version", () => {
    expect(releaseMetadataProblems({ ...ok, tag: "v1.2.4" })).toEqual([]);
    expect(releaseMetadataProblems({ ...ok, tag: "v1.2.3" }).join("\n")).toMatch(/tag v1\.2\.3 does not match/);
  });

  it("refuses a section without entries or with an impossible date", () => {
    const empty = CHANGELOG.replace("### Fixed\n\n- Something a lecturer can see.\n", "");
    expect(releaseMetadataProblems({ ...ok, changelog: empty }).join("\n")).toMatch(/lists no entries/);
    const badDate = CHANGELOG.replace("2026-10-18", "2026-02-30");
    expect(releaseMetadataProblems({ ...ok, changelog: badDate }).join("\n")).toMatch(/invalid date/);
  });

  it("refuses a CHANGELOG that does not open with Unreleased", () => {
    const noUnreleased = CHANGELOG.replace("## [Unreleased]\n\n", "");
    expect(releaseMetadataProblems({ ...ok, changelog: noUnreleased }).join("\n")).toMatch(/Unreleased/);
  });

  it("refuses a malformed version heading and a duplicated version", () => {
    const malformed = CHANGELOG.replace("## [1.2.3] — 2026-09-01", "## 1.2.3 (2026-09-01)");
    expect(releaseMetadataProblems({ ...ok, changelog: malformed }).join("\n")).toMatch(/is not "## \[X\.Y\.Z\]/);
    const twice = CHANGELOG.replace("## [1.2.3]", "## [1.2.4]");
    expect(releaseMetadataProblems({ ...ok, changelog: twice }).join("\n")).toMatch(/carries 1\.2\.4 twice/);
  });

  it("splits sections in file order and refuses to compose a missing version", () => {
    expect(changelogSections(CHANGELOG).map((section) => section.version)).toEqual([null, "1.2.4", "1.2.3"]);
    expect(() => composeReleaseBody({ changelog: CHANGELOG, version: "9.9.9", testerNote: "x" })).toThrow(/9\.9\.9/);
  });

  it("keeps the fixed unsigned local packaging matrix", async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "packages/app/package.json"), "utf8"));
    expect(pkg.scripts["dist:mac"]).toMatch(/electron-builder --mac --arm64 --publish never$/);
    expect(pkg.scripts["dist:win"]).toMatch(/electron-builder --win --x64 --publish never$/);
    expect(pkg.scripts["dist:linux"]).toMatch(/electron-builder --linux --x64 --publish never$/);
    expect(pkg.build.mac.target).toEqual(["dmg", "zip"]);
    expect(pkg.build.win.target).toEqual(["nsis"]);
    expect(pkg.build.linux.target).toEqual(["AppImage"]);
  });
});
