import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { satisfies, valid } from "semver";
import {
  CORPUS_COMPATIBILITY_CONTRACT,
  validateCorpusInventory,
  type ContentPackManifest,
  type SafeZipLimits,
} from "@cbe/corpus-schema";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import type { ContentPackPaths } from "./content-pack-store.js";

export const CONTENT_PACK_ROOT_KEY_ID = "cbe-content-root-v1";

/**
 * Release provisioning replaces this null with the reviewed offline root SPKI
 * and embeds matching root-signed keysets/baselines. A null value is fail-closed:
 * remote signed refresh reports `not-provisioned`; local bundled content remains
 * immediately usable. Test keys are injected and never compiled here.
 */
export const CONTENT_PACK_ROOT_PUBLIC_KEY_SPKI: string | null = null;

export const CONTENT_PACK_ORIGIN = "https://cbe-stories.pages.dev";
export const CONTENT_PACK_CHANNEL = "stable" as const;

export interface ContentPackPolicy {
  packId: "cbe-skill" | "cbe-corpus";
  channel: "stable";
  baseUrl: string;
  rootKeyId: string;
  rootPublicKeySpki: string | null;
  markerFile: string;
  metadataMaxBytes: number;
  zipLimits: SafeZipLimits;
  compatibility: (
    manifest: ContentPackManifest,
    installedAppVersion: string
  ) => { ok: true } | { ok: false; field: string };
  validateFiles: (
    files: ReadonlyMap<string, Uint8Array>,
    manifest: ContentPackManifest,
    paths: ContentPackPaths
  ) => Promise<void>;
}

function skillCompatibility(
  manifest: ContentPackManifest,
  installedAppVersion: string
): { ok: true } | { ok: false; field: string } {
  if (manifest.packId !== "cbe-skill") return { ok: false, field: "packId" };
  const compatibility = manifest.compatibility as Record<string, string>;
  if (valid(installedAppVersion, { loose: false }) !== installedAppVersion) return { ok: false, field: "appRange" };
  if (!satisfies(installedAppVersion, compatibility.appRange ?? "", { loose: false, includePrerelease: false })) {
    return { ok: false, field: "appRange" };
  }
  for (const field of ["modelSurfaceAbi", "toolContractSha256", "testedPiVersion"] as const) {
    if (compatibility[field] !== SKILL_COMPATIBILITY_CONTRACT[field]) return { ok: false, field };
  }
  return { ok: true };
}

async function validateSkillFiles(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: ContentPackManifest
): Promise<void> {
  if (files.size !== 1 || !files.has("SKILL.md")) throw new Error("skill-inventory");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(files.get("SKILL.md")!);
  } catch {
    throw new Error("skill-utf8");
  }
  if (raw.charCodeAt(0) === 0xfeff || raw.includes("\0")) throw new Error("skill-encoding");
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    throw new Error("skill-frontmatter");
  }
  if (parsed.data.name !== "cbe" || parsed.data.version !== manifest.version || parsed.content.trim().length === 0) {
    throw new Error("skill-frontmatter");
  }
  if (parsed.content.length >= SKILL_BODY_BUDGET) throw new Error("skill-budget");
}

async function validateCorpusFiles(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: ContentPackManifest,
  paths: ContentPackPaths
): Promise<void> {
  await mkdir(paths.packsDir, { recursive: true });
  const root = await mkdtemp(path.join(paths.packsDir, ".corpus-validation-"));
  try {
    for (const [relative, bytes] of files) {
      const file = path.join(root, ...relative.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
    }
    await validateCorpusInventory(root, { expectedVersion: manifest.version, expectedContents: manifest.contents });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function skillContentPackPolicy(overrides?: Partial<ContentPackPolicy>): ContentPackPolicy {
  return {
    packId: "cbe-skill",
    channel: CONTENT_PACK_CHANNEL,
    baseUrl: `${CONTENT_PACK_ORIGIN}/delivery/v2/skill/${CONTENT_PACK_CHANNEL}/`,
    rootKeyId: CONTENT_PACK_ROOT_KEY_ID,
    rootPublicKeySpki: CONTENT_PACK_ROOT_PUBLIC_KEY_SPKI,
    markerFile: "SKILL.md",
    metadataMaxBytes: 64 * 1024,
    zipLimits: {
      maxCompressedBytes: 256 * 1024,
      maxEntries: 1,
      maxFileBytes: 64 * 1024,
      maxExpandedBytes: 64 * 1024,
      maxExpansionRatio: 20,
    },
    compatibility: skillCompatibility,
    validateFiles: validateSkillFiles,
    ...overrides,
  };
}

export function corpusContentPackPolicy(overrides?: Partial<ContentPackPolicy>): ContentPackPolicy {
  return {
    packId: "cbe-corpus",
    channel: CONTENT_PACK_CHANNEL,
    baseUrl: `${CONTENT_PACK_ORIGIN}/delivery/v2/corpus/${CONTENT_PACK_CHANNEL}/`,
    rootKeyId: CONTENT_PACK_ROOT_KEY_ID,
    rootPublicKeySpki: CONTENT_PACK_ROOT_PUBLIC_KEY_SPKI,
    markerFile: "index.json",
    metadataMaxBytes: 256 * 1024,
    zipLimits: {
      maxCompressedBytes: 1024 * 1024,
      maxEntries: 256,
      maxFileBytes: 512 * 1024,
      maxExpandedBytes: 4 * 1024 * 1024,
      maxExpansionRatio: 50,
    },
    compatibility: (manifest) => {
      if (manifest.packId !== "cbe-corpus") return { ok: false, field: "packId" };
      const compatibility = manifest.compatibility as Record<string, string>;
      for (const field of ["corpusSchema", "indexContractSha256"] as const) {
        if (compatibility[field] !== CORPUS_COMPATIBILITY_CONTRACT[field]) return { ok: false, field };
      }
      return { ok: true };
    },
    validateFiles: validateCorpusFiles,
    ...overrides,
  };
}
