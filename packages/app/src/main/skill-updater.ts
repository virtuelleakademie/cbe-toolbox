import path from "node:path";
import { skillContentPackPolicy, type ContentPackPolicy } from "./content-pack-policy.js";
import {
  readEmbeddedContentIdentitySync,
  selectContentPackSync,
  type ContentPackPaths,
  type SelectedContentPack,
} from "./content-pack-store.js";
import { refreshContentPack, type ContentPackUpdateResult } from "./content-pack-updater.js";
import type { ContentPackIdentity, CorpusRefreshResult, SkillUpdateStatus } from "../shared/ipc-contract.js";
import {
  activeBundleDir,
  readBundleCacheMeta,
  refreshBundle,
  type BundleKind,
  type BundlePaths,
} from "./bundle-refresh.js";
import { readSkillIdentity } from "./skill-meta.js";
import {
  decodeSkillPointer,
  verifySkillCompatibility,
  type SkillCompatibilityMismatch,
  type SkillMetadataInvalid,
} from "./skill-pointer.js";
import { compareSemverVersions } from "./version-order.js";

export type SkillRefreshResult = CorpusRefreshResult | SkillMetadataInvalid | SkillCompatibilityMismatch;

let lastSkillUpdateStatus: SkillUpdateStatus = { status: "not-checked" };

/** Read-only last background/manual outcome for the localized Settings surface. */
export function skillUpdateStatus(): SkillUpdateStatus {
  return lastSkillUpdateStatus;
}

/** Test seam; production only moves this through `refreshSkill`. */
export function resetSkillUpdateStatus(): void {
  lastSkillUpdateStatus = { status: "not-checked" };
}

function remember(result: SkillRefreshResult): SkillRefreshResult {
  if (result.status === "integrity-mismatch") lastSkillUpdateStatus = { status: "integrity-mismatch" };
  else if (result.status === "unavailable") lastSkillUpdateStatus = { status: "unavailable" };
  else lastSkillUpdateStatus = result;
  return result;
}

/** Version + cache facts of the active skill state. */
export interface SkillInfo {
  version: string | null;
  cacheDate: string | null;
  source: "bundled" | "downloaded";
  pack?: ContentPackIdentity;
}

export interface SkillUpdaterPaths extends BundlePaths {
  trustDir?: string;
  packsDir?: string;
  signedOnly?: boolean;
  installedAppVersion?: string;
}

function signedPaths(paths: SkillUpdaterPaths): ContentPackPaths {
  const userData = path.dirname(paths.cacheRoot);
  return {
    trustDir: paths.trustDir ?? path.join(userData, "content-pack-trust"),
    packsDir: paths.packsDir ?? path.join(userData, "content-packs"),
    bundledDir: paths.bundledDir,
  };
}

function selectSigned(paths: SkillUpdaterPaths): SelectedContentPack {
  const policy = skillContentPackPolicy();
  const installedAppVersion = paths.installedAppVersion;
  return selectContentPackSync({
    paths: signedPaths(paths),
    packId: "cbe-skill",
    channel: policy.channel,
    markerFile: "SKILL.md",
    embeddedIdentity: readEmbeddedContentIdentitySync(paths.bundledDir, "cbe-skill", policy.channel),
    ...(installedAppVersion !== undefined
      ? { compatible: (manifest) => policy.compatibility(manifest, installedAppVersion).ok }
      : {}),
  });
}

const SKILL_KIND: BundleKind = {
  markerFile: "SKILL.md",
  contentDirName: "skill",
  compareVersions: compareSemverVersions,
};

/** Directory new sessions load: signed active/previous slot, otherwise bundled fallback. */
export function activeSkillDir(paths: SkillUpdaterPaths): string {
  if (!paths.signedOnly) {
    const legacy = activeBundleDir(paths, SKILL_KIND);
    if (legacy !== paths.bundledDir) return legacy;
  }
  return selectSigned(paths).dir;
}

/** Effective version + cache date shown beside the update outcome. */
export async function skillInfo(paths: SkillUpdaterPaths): Promise<SkillInfo> {
  const selected = paths.signedOnly ? selectSigned(paths) : null;
  const dir = selected?.dir ?? activeSkillDir(paths);
  const source = dir === paths.bundledDir ? "bundled" : "downloaded";
  const identity = await readSkillIdentity(path.join(dir, "SKILL.md"));
  const meta = source === "downloaded" && !selected ? await readBundleCacheMeta(paths) : null;
  return {
    version: identity.version,
    cacheDate: selected?.identity?.installedAt ?? meta?.fetchedAt ?? null,
    source,
    ...(selected?.identity
      ? {
          pack: {
            packId: selected.identity.packId,
            channel: selected.identity.channel,
            epoch: selected.identity.epoch,
            sequence: selected.identity.sequence,
            version: selected.identity.version,
            source: selected.source === "previous" ? "previous" : "downloaded",
            sourceCommit: selected.identity.sourceCommit,
            manifestSha256: selected.identity.manifestSha256,
            signerKeyId: selected.identity.signerKeyId,
            installedAt: selected.identity.installedAt,
          },
        }
      : {}),
  };
}

export interface SignedSkillRefreshOptions {
  paths: SkillUpdaterPaths;
  installedAppVersion: string;
  appBuildTime: Date;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  policy?: ContentPackPolicy;
}

export async function refreshSignedSkill(options: SignedSkillRefreshOptions): Promise<ContentPackUpdateResult> {
  const result = await refreshContentPack({
    policy: options.policy ?? skillContentPackPolicy(),
    paths: signedPaths(options.paths),
    installedAppVersion: options.installedAppVersion,
    appBuildTime: options.appBuildTime,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  if (result.status === "updated") lastSkillUpdateStatus = { status: "updated", version: result.identity.version };
  else if (result.status === "up-to-date") lastSkillUpdateStatus = { status: "up-to-date", version: result.version };
  else if (result.status === "refused") {
    lastSkillUpdateStatus = {
      status: "signed-refused",
      code: result.code,
      ...(result.field ? { field: result.field } : {}),
    };
  } else {
    lastSkillUpdateStatus = { status: "signed-unavailable", code: result.code };
  }
  return result;
}

/** Legacy hash-era test seam; production uses `refreshSignedSkill`. */
export interface SkillRefreshOptions {
  paths: SkillUpdaterPaths;
  /** URL of the skill `latest.json` pointer; undefined → channel not configured. */
  pointerUrl: string | undefined;
  /** Actual running app version (`app.getVersion()` in production). */
  installedAppVersion: string;
  fetchImpl?: typeof fetch;
  requestHeaders?: Record<string, string>;
  now?: () => Date;
}

/**
 * Strict pointer-first refresh. Metadata shape and all four compatibility facts
 * are decided before the artifact URL is constructed or requested. A refusal is
 * a typed value and never reaches the existing staged installer, so the active
 * Skill remains the bundled or previously downloaded known-good state.
 */
export async function refreshSkill(opts: SkillRefreshOptions): Promise<SkillRefreshResult> {
  if (!opts.pointerUrl) return remember({ status: "unavailable", reason: { code: "not-configured" } });
  const fetchImpl = opts.fetchImpl ?? fetch;

  let raw: string;
  try {
    const response = await fetchImpl(opts.pointerUrl, { headers: opts.requestHeaders });
    if (!response.ok) {
      return remember({ status: "unavailable", reason: { code: "pointer-http", httpStatus: response.status } });
    }
    raw = await response.text();
  } catch (err) {
    console.error("skill bundle refresh failed during the pointer read:", err);
    return remember({ status: "unavailable", reason: { code: "pointer-read" } });
  }

  const decoded = decodeSkillPointer(raw);
  if (!decoded.ok) return remember(decoded.outcome);
  const compatible = verifySkillCompatibility(decoded.pointer, opts.installedAppVersion);
  if (!compatible.ok) return remember(compatible.outcome);

  return remember(
    await refreshBundle({
      paths: opts.paths,
      kind: SKILL_KIND,
      pointerUrl: opts.pointerUrl,
      pointer: decoded.pointer,
      localVersion: async () => (await skillInfo(opts.paths)).version,
      fetchImpl,
      requestHeaders: opts.requestHeaders,
      now: opts.now,
    })
  );
}
