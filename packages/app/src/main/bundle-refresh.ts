import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { CorpusRefreshResult, CorpusRefreshUnavailableReason } from "../shared/ipc-contract.js";

/**
 * Generic versioned-bundle refresh cycle (capability `distribution`). Both
 * delivery channels — the corpus bundle (Requirement: Corpus Distribution as
 * Downloadable Bundle) and the skill bundle (Requirement: Skill Distribution
 * as Versioned Bundle) — share the same mechanics by spec: fetch the cheap
 * `latest.json` pointer first, download the versioned ZIP only when the
 * pointer advertises a version NEWER than the local state, verify its SHA256
 * against the pointer BEFORE unpacking, and swap the unpacked tree into the
 * user-data cache. A failed download or integrity mismatch never touches the
 * currently active state.
 *
 * `corpus-updater.ts` and `skill-updater.ts` are thin wrappers over this core;
 * what differs between them (marker file, cache subdirectory, how the local
 * version is read, how two versions of that kind are ordered) is injected via
 * `BundleKind`.
 *
 * Deliberately Electron-free: all paths and the fetch implementation are
 * injected, so the module is fully testable outside the app shell.
 */

export interface BundlePointer {
  version: string;
  file: string;
  sha256: string;
}

export interface BundlePaths {
  /** User-writable cache root, e.g. `<userData>/corpus-cache`. */
  cacheRoot: string;
  /** Read-only copy shipped with the app (extraResources / repo checkout). */
  bundledDir: string;
}

/** What distinguishes one bundle channel from another. */
export interface BundleKind {
  /** Top-level file every valid bundle must carry (`index.json` / `SKILL.md`);
   * also the completeness marker for the unpacked cache. */
  markerFile: string;
  /** Subdirectory of `cacheRoot` the unpacked tree lives in. */
  contentDirName: string;
  /** Ordering over this channel's version strings (see `version-order.ts`):
   * > 0 when `a` is newer than `b`, < 0 when older, 0 when equal. The refresh
   * downloads only on a strictly newer pointer, so an older pointer can never
   * displace the state the app already runs on. */
  compareVersions: (a: string, b: string) => number;
}

export interface BundleCacheMeta {
  version: string;
  fetchedAt: string;
  sha256: string;
}

export function bundleContentDir(paths: BundlePaths, kind: BundleKind): string {
  return path.join(paths.cacheRoot, kind.contentDirName);
}

function metaPath(paths: BundlePaths): string {
  return path.join(paths.cacheRoot, "meta.json");
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * The directory the app should load the channel's content from: the downloaded
 * cache when it holds a complete unpacked bundle, otherwise the read-only
 * bundled copy — a verified downloaded state takes precedence over the copy
 * shipped with the app.
 *
 * KNOWN LIMITATION, deliberately left open as a follow-up: that precedence is
 * unconditional, so the cache also wins over a NEWER copy shipped in a later
 * app release. Reachable sequence — the cache holds 0.4.0, a new release
 * bundles 0.5.0, the portal still advertises 0.4.0: `localVersion()` reads the
 * cache, the refresh answers `up-to-date`, and the 0.5.0 body the release
 * actually shipped never runs while About reports 0.4.0. The version ordering
 * in `refreshBundle` closes only the DOWNLOAD direction (an older pointer can
 * no longer displace a newer local state); comparing the bundled copy against
 * the cache here is a separate decision and is not made in this change.
 */
export function activeBundleDir(paths: BundlePaths, kind: BundleKind): string {
  const dl = bundleContentDir(paths, kind);
  if (existsSync(path.join(dl, kind.markerFile)) && existsSync(metaPath(paths))) return dl;
  return paths.bundledDir;
}

export async function readBundleCacheMeta(paths: BundlePaths): Promise<BundleCacheMeta | null> {
  return readJson<BundleCacheMeta>(metaPath(paths));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ClassifiedUnpackReason = Extract<CorpusRefreshUnavailableReason, { code: "missing-marker" | "unsafe-entry" }>;

class ClassifiedUnpackError extends Error {
  readonly reason: ClassifiedUnpackReason;

  constructor(reason: ClassifiedUnpackReason) {
    super(reason.code);
    this.name = "ClassifiedUnpackError";
    this.reason = reason;
  }
}

/**
 * Operator-facing diagnostics for a refusal the lecturer only ever sees as a
 * typed reason. The surfaced outcome stays a `CorpusRefreshUnavailableReason`
 * the renderer resolves through its catalogue; the underlying OS/network/library
 * error would otherwise exist nowhere, leaving a failing refresh undiagnosable
 * from a support report.
 */
function logRefreshFailure(kind: BundleKind, stage: string, err: unknown): void {
  console.error(`${kind.contentDirName} bundle refresh failed during ${stage}:`, err);
}

/** Unpack the verified archive into `target`, refusing entries that would
 * escape it (zip-slip). The archive must carry the channel's top-level marker
 * file. */
async function unpackZip(bytes: Uint8Array, target: string, kind: BundleKind): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (!entries.some((f) => f.name === kind.markerFile)) {
    throw new ClassifiedUnpackError({ code: "missing-marker", markerFile: kind.markerFile });
  }
  for (const entry of entries) {
    // JSZip sanitises relative components in `name`; retain its original name
    // for the containment decision so a refused entry remains distinguishable.
    const entryName = entry.unsafeOriginalName ?? entry.name;
    const dest = path.join(target, ...entryName.split("/"));
    const rel = path.relative(target, dest);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new ClassifiedUnpackError({ code: "unsafe-entry", entryName });
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await entry.async("nodebuffer"));
  }
}

export interface BundleRefreshOptions {
  paths: BundlePaths;
  kind: BundleKind;
  /** URL of the `latest.json` pointer; undefined → channel not configured. */
  pointerUrl: string | undefined;
  /** Already decoded and validated pointer. Skill uses this after its strict
   * compatibility preflight so the generic installer does not re-fetch or
   * permissively re-parse the metadata. */
  pointer?: BundlePointer;
  /** The version currently active locally (cache, or bundled fallback). */
  localVersion: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Extra request headers (the portal delivery key, or Basic Auth for a dev
   * override channel). */
  requestHeaders?: Record<string, string>;
  /** Clock injection for tests. */
  now?: () => Date;
}

/**
 * Pointer-first refresh cycle. Returns a value in every case — callers decide
 * what to surface; the previous state stays active unless the new bundle
 * verified and unpacked completely.
 */
export async function refreshBundle(opts: BundleRefreshOptions): Promise<CorpusRefreshResult> {
  const { paths, kind, pointerUrl } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!pointerUrl) {
    return { status: "unavailable", reason: { code: "not-configured" } };
  }

  let pointer: BundlePointer;
  if (opts.pointer) {
    pointer = opts.pointer;
  } else {
    try {
      const res = await fetchImpl(pointerUrl, { headers: opts.requestHeaders });
      if (!res.ok) {
        return { status: "unavailable", reason: { code: "pointer-http", httpStatus: res.status } };
      }
      pointer = (await res.json()) as BundlePointer;
    } catch (err) {
      logRefreshFailure(kind, "the pointer read", err);
      return { status: "unavailable", reason: { code: "pointer-read" } };
    }
  }
  if (!pointer?.version || !pointer.file || !pointer.sha256) {
    return { status: "unavailable", reason: { code: "pointer-invalid" } };
  }

  // Adopt only what is strictly newer. A pointer at or behind the active
  // version is up to date as far as this app is concerned — downloading it
  // would replace the running state with an older one and then report that
  // older version as the truth.
  const local = await opts.localVersion();
  if (local !== null && kind.compareVersions(pointer.version, local) <= 0) {
    return { status: "up-to-date", version: local };
  }

  let bytes: Uint8Array;
  try {
    const bundleUrl = new URL(pointer.file, pointerUrl).toString();
    const res = await fetchImpl(bundleUrl, { headers: opts.requestHeaders });
    if (!res.ok) {
      return { status: "unavailable", reason: { code: "download-http", httpStatus: res.status } };
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    logRefreshFailure(kind, "the bundle download", err);
    return { status: "unavailable", reason: { code: "download-read" } };
  }

  // Integrity gate: verify BEFORE unpacking; a mismatching bundle is discarded
  // and the existing state stays active (Scenarios: Corrupt or tampered bundle
  // is rejected / Corrupt or tampered skill bundle is rejected).
  const actual = sha256Hex(bytes);
  if (actual !== pointer.sha256.toLowerCase()) {
    return { status: "integrity-mismatch", expected: pointer.sha256.toLowerCase(), actual };
  }

  const staging = path.join(paths.cacheRoot, ".staging");
  const previous = path.join(paths.cacheRoot, ".previous");
  const target = bundleContentDir(paths, kind);
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await unpackZip(bytes, staging, kind);

    // Swap: keep the old tree until the new one is fully in place.
    await rm(previous, { recursive: true, force: true });
    if (existsSync(target)) await rename(target, previous);
    await rename(staging, target);
    await rm(previous, { recursive: true, force: true });

    const meta: BundleCacheMeta = {
      version: pointer.version,
      fetchedAt: (opts.now?.() ?? new Date()).toISOString(),
      sha256: pointer.sha256,
    };
    await writeFile(metaPath(paths), JSON.stringify(meta, null, 2) + "\n");
    return { status: "updated", version: pointer.version };
  } catch (err) {
    logRefreshFailure(kind, "unpacking and installation", err);
    // Roll back a half-finished swap so activeBundleDir never points at a torso.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (!existsSync(target) && existsSync(previous)) {
      await rename(previous, target).catch(() => {});
    }
    return {
      status: "unavailable",
      reason: err instanceof ClassifiedUnpackError ? err.reason : { code: "install-failed" },
    };
  }
}
