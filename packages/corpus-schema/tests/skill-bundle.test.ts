import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import { createSkillBundle, type SkillPointer } from "../src/skill-bundle.js";

function bundleOptions(now?: Date) {
  return { compatibility: SKILL_COMPATIBILITY_CONTRACT, ...(now ? { now } : {}) };
}

// Distribution spec, Requirement: Skill Distribution as Versioned Bundle —
// the portal serves `v<version>.zip` plus a `latest.json` pointer with the
// latest skill version and its SHA256, same mechanics as the corpus bundle.
describe("createSkillBundle", () => {
  let skillRoot: string;
  let outDir: string;

  beforeAll(async () => {
    skillRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-skill-bundle-"));
    outDir = path.join(skillRoot, "out");
    const skillDir = path.join(skillRoot, "skill");
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.0\n---\n\n## Purpose\n\nBody\n");
    await fs.writeFile(path.join(skillDir, "references", "ui-guide.md"), "Guide\n");
  });

  afterAll(async () => {
    await fs.rm(skillRoot, { recursive: true, force: true });
  });

  it("writes v<version>.zip from the frontmatter version, containing the skill tree", async () => {
    const res = await createSkillBundle(path.join(skillRoot, "skill"), outDir, bundleOptions());
    expect(res.file).toBe("v0.4.0.zip");
    expect(res.version).toBe("0.4.0");

    const zipBytes = await fs.readFile(path.join(outDir, res.file));
    const zip = await JSZip.loadAsync(zipBytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain("SKILL.md");
    expect(names).toContain("references/ui-guide.md");
    expect(res.fileCount).toBe(2);
  });

  it("publishes a latest.json pointer whose SHA256 matches the zip bytes", async () => {
    const res = await createSkillBundle(path.join(skillRoot, "skill"), outDir, bundleOptions());
    const pointer = JSON.parse(await fs.readFile(path.join(outDir, "latest.json"), "utf8")) as SkillPointer;
    expect(pointer.version).toBe("0.4.0");
    expect(pointer.file).toBe(res.file);
    const zipBytes = await fs.readFile(path.join(outDir, res.file));
    expect(pointer.sha256).toBe(createHash("sha256").update(zipBytes).digest("hex"));
    expect(pointer.size).toBe(zipBytes.length);
    expect({
      appRange: pointer.appRange,
      modelSurfaceAbi: pointer.modelSurfaceAbi,
      toolContractSha256: pointer.toolContractSha256,
      testedPiVersion: pointer.testedPiVersion,
    }).toEqual(SKILL_COMPATIBILITY_CONTRACT);
  });

  it("produces byte-identical archives across runs (reproducible SHA256)", async () => {
    const first = await createSkillBundle(path.join(skillRoot, "skill"), outDir, bundleOptions());
    // Touch mtimes; the fixed ZIP epoch keeps the bytes stable regardless.
    const now = new Date();
    await fs.utimes(path.join(skillRoot, "skill", "SKILL.md"), now, now);
    const second = await createSkillBundle(path.join(skillRoot, "skill"), outDir, bundleOptions());
    expect(second.sha256).toBe(first.sha256);
  });

  // Reproducibility is across TIME, not merely across two calls in the same
  // second: no entry may carry a wall-clock timestamp. JSZip synthesises the
  // implicit directory entries (`references/`) with the current time unless
  // folder creation is switched off, which silently made the archive depend on
  // when it was generated.
  it("writes no wall-clock timestamp into the archive", async () => {
    const res = await createSkillBundle(path.join(skillRoot, "skill"), outDir, bundleOptions());
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(outDir, res.file)));
    const entries = Object.values(zip.files);
    expect(entries.some((e) => e.dir)).toBe(false);
    for (const entry of entries) {
      expect(entry.date.getUTCFullYear()).toBe(2000);
    }
  });

  it("refuses a skill tree without a frontmatter version", async () => {
    const bare = path.join(skillRoot, "bare");
    await fs.mkdir(bare, { recursive: true });
    await fs.writeFile(path.join(bare, "SKILL.md"), "## Purpose\n\nNo frontmatter\n");
    await expect(createSkillBundle(bare, outDir, bundleOptions())).rejects.toThrow(/version/);
  });
});

describe("repository skill bundle consistency", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const realSkillDir = path.join(repoRoot, "skills", "cbe");
  let realOutDir: string;

  beforeAll(async () => {
    realOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-real-skill-bundle-"));
  });

  afterAll(async () => {
    await fs.rm(realOutDir, { recursive: true, force: true });
  });

  it("carries the exact source SKILL.md with matching version and checksum", async () => {
    const source = await fs.readFile(path.join(realSkillDir, "SKILL.md"), "utf8");
    const sourceVersion = source.match(/^version:\s*(\S+)$/m)?.[1];
    expect(sourceVersion).toBeDefined();

    const result = await createSkillBundle(realSkillDir, realOutDir, bundleOptions(new Date("2026-09-30T00:00:00Z")));
    const zipBytes = await fs.readFile(path.join(realOutDir, result.file));
    const zip = await JSZip.loadAsync(zipBytes);
    const bundledSkill = await zip.file("SKILL.md")?.async("string");
    const pointer = JSON.parse(await fs.readFile(path.join(realOutDir, "latest.json"), "utf8")) as SkillPointer;

    expect(bundledSkill).toBe(source);
    expect(result.version).toBe(sourceVersion);
    expect(pointer.version).toBe(sourceVersion);
    expect(pointer.file).toBe(`v${sourceVersion}.zip`);
    expect(pointer.sha256).toBe(createHash("sha256").update(zipBytes).digest("hex"));
    expect(pointer.sha256).toBe(result.sha256);
  });
});
