import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureManifest } from "./helpers/content-pack-fixture.js";
import { skillContentPackPolicy } from "../src/main/content-pack-policy.js";
import type { ContentPackPaths } from "../src/main/content-pack-store.js";

const roots: string[] = [];
async function paths(): Promise<ContentPackPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cbe-skill-content-"));
  roots.push(root);
  return {
    trustDir: path.join(root, "trust"),
    packsDir: path.join(root, "packs"),
    bundledDir: path.join(root, "embedded"),
  };
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function bytes(body: string): Uint8Array {
  return Buffer.from(body, "utf8");
}

describe("signed Skill content validation", () => {
  it.each([
    ["invalid UTF-8", new Uint8Array([0xff, 0xfe])],
    ["BOM", bytes("\ufeff---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n")],
    ["NUL", bytes("---\nname: cbe\nversion: 0.4.2\n---\n\nBody\0\n")],
    ["missing frontmatter", bytes("## Body\n")],
    ["wrong name", bytes("---\nname: other\nversion: 0.4.2\n---\n\nBody\n")],
    ["wrong version", bytes("---\nname: cbe\nversion: 0.4.1\n---\n\nBody\n")],
    ["blank body", bytes("---\nname: cbe\nversion: 0.4.2\n---\n")],
    ["exact budget", bytes(`---\nname: cbe\nversion: 0.4.2\n---\n\n${"x".repeat(19000)}`)],
  ])("Invalid Skill encoding frontmatter version or budget is refused: %s", async (_name, content) => {
    await expect(
      skillContentPackPolicy().validateFiles(
        new Map([["SKILL.md", content]]),
        fixtureManifest({ packId: "cbe-skill" }),
        await paths()
      )
    ).rejects.toThrow();
  });

  it("accepts one valid UTF-8 SKILL.md below the compiled budget", async () => {
    await expect(
      skillContentPackPolicy().validateFiles(
        new Map([["SKILL.md", bytes("---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n")]]),
        fixtureManifest({ packId: "cbe-skill" }),
        await paths()
      )
    ).resolves.toBeUndefined();
  });

  it("Executable behavior remains app-update-only", async () => {
    const policy = skillContentPackPolicy();
    await expect(
      policy.validateFiles(
        new Map([
          ["SKILL.md", bytes("---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n")],
          ["plugin.js", bytes("export default () => process.exit()")],
        ]),
        fixtureManifest({ packId: "cbe-skill" }),
        await paths()
      )
    ).rejects.toThrow(/inventory/);
  });
});
