import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

/**
 * Versioned skill bundle generator (capability `distribution`, Requirement:
 * Skill Distribution as Versioned Bundle). Packs the skill tree (`SKILL.md` +
 * references/**) into `v<version>.zip` and writes a `latest.json` pointer
 * carrying version, SHA256, and the compiled compatibility facts supplied by
 * the CBE runtime authority. The archive mechanics stay aligned with the corpus
 * bundle (`bundle.ts`), while Skill metadata is stricter because it must match
 * the app/model/tool/Pi surface before the archive is requested.
 */

export interface SkillCompatibilityPointer {
  appRange: string;
  modelSurfaceAbi: string;
  toolContractSha256: string;
  testedPiVersion: string;
}

export interface SkillPointer extends SkillCompatibilityPointer {
  version: string;
  file: string;
  sha256: string;
  size: number;
  generated: string;
}

export interface SkillBundleResult extends SkillPointer {
  outDir: string;
  fileCount: number;
}

// Fixed entry timestamp so the same skill content always zips to the same
// bytes (and the same SHA256) regardless of checkout mtimes. It only holds
// together with `createFolders: false` below: JSZip would otherwise synthesise
// the implicit directory entries (`references/`) with the WALL CLOCK, which
// puts the current time into the archive and breaks reproducibility across
// runs. The unpacker creates directories from the file paths anyway.
const ZIP_EPOCH = new Date(Date.UTC(2000, 0, 1));

async function collectTree(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectTree(root, full)));
    else if (entry.isFile()) out.push(path.relative(root, full));
  }
  return out.sort();
}

/** The skill's own frontmatter `version` — the same single source the app's
 * About group reads; a skill without one cannot be published. */
async function readSkillVersion(skillDir: string): Promise<string> {
  const raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const version = block?.match(/^version:\s*(\S+)/m)?.[1];
  if (!version) {
    throw new Error(`${skillDir}/SKILL.md carries no frontmatter "version" — set one before bundling`);
  }
  return version;
}

export async function createSkillBundle(
  skillDir: string,
  outDir: string,
  opts: { compatibility: SkillCompatibilityPointer; now?: Date }
): Promise<SkillBundleResult> {
  const version = await readSkillVersion(skillDir);

  const files = await collectTree(skillDir, skillDir);
  if (!files.includes("SKILL.md")) {
    throw new Error(`${skillDir} carries no top-level SKILL.md — nothing to bundle`);
  }
  const zip = new JSZip();
  for (const rel of files) {
    zip.file(rel.split(path.sep).join("/"), await readFile(path.join(skillDir, rel)), {
      date: ZIP_EPOCH,
      createFolders: false,
    });
  }
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    // Stable ordering + fixed platform metadata for reproducible archives.
    platform: "UNIX",
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const file = `v${version}.zip`;
  const pointer: SkillPointer = {
    version,
    file,
    sha256,
    size: buffer.length,
    generated: (opts.now ?? new Date()).toISOString().slice(0, 10),
    appRange: opts.compatibility.appRange,
    modelSurfaceAbi: opts.compatibility.modelSurfaceAbi,
    toolContractSha256: opts.compatibility.toolContractSha256,
    testedPiVersion: opts.compatibility.testedPiVersion,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, file), buffer);
  await writeFile(path.join(outDir, "latest.json"), JSON.stringify(pointer, null, 2) + "\n");
  return { ...pointer, outDir, fileCount: files.length };
}
