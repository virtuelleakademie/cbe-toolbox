import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_PACK_ROOT_PUBLIC_KEY_SPKI, skillContentPackPolicy } from "../src/main/content-pack-policy.js";
import { refreshContentPack } from "../src/main/content-pack-updater.js";
import { activeSkillDir, type SkillUpdaterPaths } from "../src/main/skill-updater.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("signed trust bootstrap", () => {
  it("Existing unsigned app cannot bootstrap the root remotely", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cbe-unprovisioned-"));
    roots.push(root);
    const fetchImpl = vi.fn();
    const result = await refreshContentPack({
      policy: skillContentPackPolicy(),
      paths: {
        trustDir: path.join(root, "trust"),
        packsDir: path.join(root, "packs"),
        bundledDir: path.join(repoRoot, "skills/cbe"),
      },
      installedAppVersion: "0.1.21",
      appBuildTime: new Date("2026-10-18T00:00:00Z"),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(CONTENT_PACK_ROOT_PUBLIC_KEY_SPKI).toBeNull();
    expect(result).toEqual({ status: "refused", code: "not-provisioned" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Legacy cache is never silently blessed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cbe-legacy-cache-"));
    roots.push(root);
    const bundledDir = path.join(root, "bundled");
    const cacheRoot = path.join(root, "skill-cache");
    await mkdir(path.join(cacheRoot, "skill"), { recursive: true });
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nEmbedded\n");
    await writeFile(path.join(cacheRoot, "skill", "SKILL.md"), "---\nname: cbe\nversion: 9.9.9\n---\n\nLegacy\n");
    await writeFile(path.join(cacheRoot, "meta.json"), '{"version":"9.9.9"}\n');
    const paths: SkillUpdaterPaths = {
      cacheRoot,
      trustDir: path.join(root, "trust"),
      packsDir: path.join(root, "packs"),
      bundledDir,
      signedOnly: true,
    };
    expect(activeSkillDir(paths)).toBe(bundledDir);
    expect(await readFile(path.join(activeSkillDir(paths), "SKILL.md"), "utf8")).toContain("Embedded");
  });
});
