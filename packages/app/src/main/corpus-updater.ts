import path from "node:path";
import { corpusContentPackPolicy, type ContentPackPolicy } from "./content-pack-policy.js";
import {
  readEmbeddedContentIdentitySync,
  selectContentPackSync,
  type ContentPackPaths,
  type SelectedContentPack,
} from "./content-pack-store.js";
import { refreshContentPack, type ContentPackUpdateResult } from "./content-pack-updater.js";
import type { ContentPackIdentity, CorpusInfo, CorpusRefreshResult } from "../shared/ipc-contract.js";
import {
  activeBundleDir,
  readBundleCacheMeta,
  readJson,
  refreshBundle,
  type BundleKind,
  type BundlePaths,
  type BundlePointer,
} from "./bundle-refresh.js";
import { compareLexicalVersions } from "./version-order.js";

export type { CorpusInfo, CorpusRefreshResult };

/**
 * Corpus bundle updater (capability `distribution`, Requirement: Corpus
 * Distribution as Downloadable Bundle) — the corpus channel of the generic
 * versioned-bundle mechanics in `bundle-refresh.ts`: pointer first, SHA256
 * verified BEFORE unpacking, staged swap into the user-data corpus cache. A
 * failed download or integrity mismatch never touches the currently loaded
 * corpus. What is corpus-specific here: the bundle marker is the manifest
 * `index.json`, the local version is its top-level `corpus-version`, and those
 * date-style versions (`2026-07`) are ordered lexically.
 */

export type CorpusPointer = BundlePointer;

export interface CorpusUpdaterPaths extends BundlePaths {
  trustDir?: string;
  packsDir?: string;
  signedOnly?: boolean;
  installedAppVersion?: string;
}

function signedPaths(paths: CorpusUpdaterPaths): ContentPackPaths {
  const userData = path.dirname(paths.cacheRoot);
  return {
    trustDir: paths.trustDir ?? path.join(userData, "content-pack-trust"),
    packsDir: paths.packsDir ?? path.join(userData, "content-packs"),
    bundledDir: paths.bundledDir,
  };
}

function selectSigned(paths: CorpusUpdaterPaths): SelectedContentPack {
  const policy = corpusContentPackPolicy();
  const installedAppVersion = paths.installedAppVersion ?? "";
  return selectContentPackSync({
    paths: signedPaths(paths),
    packId: "cbe-corpus",
    channel: policy.channel,
    markerFile: "index.json",
    embeddedIdentity: readEmbeddedContentIdentitySync(paths.bundledDir, "cbe-corpus", policy.channel),
    compatible: (manifest) => policy.compatibility(manifest, installedAppVersion).ok,
  });
}

const CORPUS_KIND: BundleKind = {
  markerFile: "index.json",
  contentDirName: "corpus",
  compareVersions: compareLexicalVersions,
};

/**
 * The directory the app should load the corpus from: the downloaded cache when
 * it holds a complete unpacked bundle, otherwise the read-only bundled copy.
 */
export function activeCorpusDir(paths: CorpusUpdaterPaths): string {
  if (!paths.signedOnly) {
    const legacy = activeBundleDir(paths, CORPUS_KIND);
    if (legacy !== paths.bundledDir) return legacy;
  }
  return selectSigned(paths).dir;
}

/** Version + cache date of the loaded corpus (distribution spec, Scenario:
 * Corpus version auditable from the app). */
export async function corpusInfo(paths: CorpusUpdaterPaths): Promise<CorpusInfo> {
  const selected = paths.signedOnly ? selectSigned(paths) : null;
  const dir = selected?.dir ?? activeCorpusDir(paths);
  const source = dir === paths.bundledDir ? "bundled" : "downloaded";
  const index = await readJson<{ "corpus-version"?: string }>(path.join(dir, "index.json"));
  const meta = source === "downloaded" && !selected ? await readBundleCacheMeta(paths) : null;
  const pack: ContentPackIdentity | undefined = selected?.identity
    ? {
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
      }
    : undefined;
  return {
    version: index?.["corpus-version"] ?? null,
    cacheDate: selected?.identity?.installedAt ?? meta?.fetchedAt ?? null,
    source,
    ...(pack ? { pack } : {}),
  };
}

export interface SignedCorpusRefreshOptions {
  paths: CorpusUpdaterPaths;
  installedAppVersion: string;
  appBuildTime: Date;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  policy?: ContentPackPolicy;
}

export async function refreshSignedCorpus(options: SignedCorpusRefreshOptions): Promise<CorpusRefreshResult> {
  const result: ContentPackUpdateResult = await refreshContentPack({
    policy: options.policy ?? corpusContentPackPolicy(),
    paths: signedPaths(options.paths),
    installedAppVersion: options.installedAppVersion,
    appBuildTime: options.appBuildTime,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  if (result.status === "updated") {
    const identity = result.identity;
    return {
      status: "updated",
      version: identity.version,
      pack: {
        packId: identity.packId,
        channel: identity.channel,
        epoch: identity.epoch,
        sequence: identity.sequence,
        version: identity.version,
        source: "downloaded",
        sourceCommit: identity.sourceCommit,
        manifestSha256: identity.manifestSha256,
        signerKeyId: identity.signerKeyId,
        installedAt: identity.installedAt,
      },
    };
  }
  if (result.status === "up-to-date") return { status: "up-to-date", version: result.version };
  if (result.status === "refused") {
    return {
      status: "signed-refused",
      code: result.code,
      ...(result.field ? { field: result.field } : {}),
    };
  }
  return {
    status: "signed-unavailable",
    code: result.code,
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
  };
}

/** Legacy hash-era test seam; production uses `refreshSignedCorpus`. */
export interface RefreshOptions {
  paths: CorpusUpdaterPaths;
  /** URL of the `latest.json` pointer; undefined → channel not configured. */
  pointerUrl: string | undefined;
  fetchImpl?: typeof fetch;
  /** Extra request headers (the portal delivery key, or Basic Auth for a dev
   * override channel). */
  requestHeaders?: Record<string, string>;
  /** Clock injection for tests. */
  now?: () => Date;
}

/**
 * Pointer-first refresh cycle. Returns a value in every case — callers decide
 * what to surface; the previous corpus stays loaded unless the new bundle
 * verified and unpacked completely.
 */
export async function refreshCorpus(opts: RefreshOptions): Promise<CorpusRefreshResult> {
  return refreshBundle({
    paths: opts.paths,
    kind: CORPUS_KIND,
    pointerUrl: opts.pointerUrl,
    localVersion: async () => (await corpusInfo(opts.paths)).version,
    fetchImpl: opts.fetchImpl,
    requestHeaders: opts.requestHeaders,
    now: opts.now,
  });
}
