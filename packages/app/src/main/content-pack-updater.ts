import { createHash } from "node:crypto";
import { extractSafeZip } from "@cbe/corpus-schema";
import type { ContentPackPolicy } from "./content-pack-policy.js";
import { appendContentPackAudit } from "./content-pack-audit.js";
import {
  activateContentPack,
  readContentPackTrustFloor,
  recoverContentPackTransaction,
  repairContentPackSelection,
  writeContentPackTrust,
  type ContentPackPaths,
  type ContentPackSlotIdentity,
} from "./content-pack-store.js";
import {
  revalidateManifestFreshness,
  verifySignedKeyset,
  verifySignedManifest,
  type ContentPackRefusal,
} from "./content-pack-trust.js";

export type ContentPackTransportCode =
  | "metadata-http"
  | "metadata-read"
  | "metadata-too-large"
  | "redirect-refused"
  | "artifact-http"
  | "artifact-read"
  | "artifact-too-large"
  | "artifact-size-mismatch"
  | "artifact-hash-mismatch"
  | "artifact-path-invalid"
  | "archive-invalid"
  | "content-invalid"
  | "install-failed";

export type ContentPackUpdateResult =
  | { status: "updated"; identity: ContentPackSlotIdentity }
  | { status: "up-to-date"; version: string; epoch: number; sequence: number }
  | ContentPackRefusal
  | { status: "unavailable"; code: ContentPackTransportCode; httpStatus?: number };

export interface RefreshContentPackOptions {
  policy: ContentPackPolicy;
  paths: ContentPackPaths;
  installedAppVersion: string;
  appBuildTime: Date;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

class FetchFailure extends Error {
  constructor(
    readonly code: ContentPackTransportCode,
    readonly httpStatus?: number
  ) {
    super(code);
    this.name = "FetchFailure";
  }
}

async function boundedBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
  tooLargeCode: "metadata-too-large" | "artifact-too-large"
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) {
    controller.abort();
    throw new FetchFailure(tooLargeCode);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        throw new FetchFailure(tooLargeCode);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  url: string,
  maxBytes: number,
  stage: "metadata" | "artifact"
): Promise<Uint8Array> {
  const controller = new AbortController();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
      headers: {},
    });
  } catch {
    throw new FetchFailure(stage === "metadata" ? "metadata-read" : "artifact-read");
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    controller.abort();
    throw new FetchFailure("redirect-refused", response.status);
  }
  if (!response.ok) {
    throw new FetchFailure(stage === "metadata" ? "metadata-http" : "artifact-http", response.status);
  }
  try {
    return await boundedBody(
      response,
      maxBytes,
      controller,
      stage === "metadata" ? "metadata-too-large" : "artifact-too-large"
    );
  } catch (error) {
    if (error instanceof FetchFailure) throw error;
    throw new FetchFailure(stage === "metadata" ? "metadata-read" : "artifact-read");
  }
}

function unavailable(error: unknown): ContentPackUpdateResult {
  if (error instanceof FetchFailure) {
    return {
      status: "unavailable",
      code: error.code,
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    };
  }
  return { status: "unavailable", code: "install-failed" };
}

function artifactUrl(policy: ContentPackPolicy, name: string): string | null {
  try {
    const base = new URL(policy.baseUrl);
    if (!base.pathname.endsWith("/")) return null;
    const url = new URL(name, base);
    if (url.origin !== base.origin) return null;
    if (url.pathname !== `${base.pathname}${name}` || url.search || url.hash || url.username || url.password)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function refreshContentPackUnchecked(options: RefreshContentPackOptions): Promise<ContentPackUpdateResult> {
  const { policy, paths } = options;
  const now = options.now ?? (() => new Date());
  if (!policy.rootPublicKeySpki) return { status: "refused", code: "not-provisioned" };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await recoverContentPackTransaction(paths, policy.packId, policy.channel, policy.markerFile);
    await repairContentPackSelection(paths, policy.packId, policy.channel, policy.markerFile, now());
    const current = await readContentPackTrustFloor(paths, policy.packId, policy.channel, options.appBuildTime);

    const [keysetRaw, keysetSignatureRaw] = await Promise.all([
      fetchBytes(fetchImpl, new URL("keyset.json", policy.baseUrl).toString(), policy.metadataMaxBytes, "metadata"),
      fetchBytes(fetchImpl, new URL("keyset.sig", policy.baseUrl).toString(), 4 * 1024, "metadata"),
    ]);
    const keyset = verifySignedKeyset({
      raw: keysetRaw,
      signatureRaw: keysetSignatureRaw,
      rootPublicKeySpki: policy.rootPublicKeySpki,
      rootKeyId: policy.rootKeyId,
      packId: policy.packId,
      channel: policy.channel,
      metadataMaxBytes: policy.metadataMaxBytes,
      current,
      now: now(),
      appBuildTime: options.appBuildTime,
    });
    if ("status" in keyset) return keyset;
    // Root-authorized revocation and trusted-time state is durable even when a
    // later manifest/artifact fails; rollback cannot reopen it after restart.
    await writeContentPackTrust(paths, keyset.trust);

    const [manifestRaw, manifestSignatureRaw] = await Promise.all([
      fetchBytes(fetchImpl, new URL("latest.json", policy.baseUrl).toString(), policy.metadataMaxBytes, "metadata"),
      fetchBytes(fetchImpl, new URL("latest.sig", policy.baseUrl).toString(), 4 * 1024, "metadata"),
    ]);
    const verified = verifySignedManifest({
      raw: manifestRaw,
      signatureRaw: manifestSignatureRaw,
      keyset,
      packId: policy.packId,
      channel: policy.channel,
      metadataMaxBytes: policy.metadataMaxBytes,
      now: now(),
      appBuildTime: options.appBuildTime,
      compatibility: (manifest) => policy.compatibility(manifest, options.installedAppVersion),
    });
    if ("status" in verified) return verified;
    if (verified.replay) {
      return {
        status: "up-to-date",
        version: verified.manifest.version,
        epoch: verified.manifest.epoch,
        sequence: verified.manifest.sequence,
      };
    }
    if (verified.manifest.artifact.size > policy.zipLimits.maxCompressedBytes) {
      return { status: "unavailable", code: "artifact-too-large" };
    }
    const url = artifactUrl(policy, verified.manifest.artifact.name);
    if (!url) return { status: "unavailable", code: "artifact-path-invalid" };
    const artifact = await fetchBytes(fetchImpl, url, policy.zipLimits.maxCompressedBytes, "artifact");
    if (artifact.byteLength !== verified.manifest.artifact.size) {
      return { status: "unavailable", code: "artifact-size-mismatch" };
    }
    if (createHash("sha256").update(artifact).digest("hex") !== verified.manifest.artifact.sha256) {
      return { status: "unavailable", code: "artifact-hash-mismatch" };
    }

    let files: Map<string, Uint8Array>;
    try {
      files = extractSafeZip(artifact, verified.manifest.contents, policy.zipLimits);
    } catch {
      return { status: "unavailable", code: "archive-invalid" };
    }
    try {
      await policy.validateFiles(files, verified.manifest, paths);
    } catch {
      return { status: "unavailable", code: "content-invalid" };
    }
    const freshness = revalidateManifestFreshness(verified, now(), options.appBuildTime);
    if (freshness) return freshness;
    const identity = await activateContentPack({
      paths,
      verified,
      manifestRaw,
      signatureRaw: manifestSignatureRaw,
      files,
      now: now(),
    });
    return { status: "updated", identity };
  } catch (error) {
    return unavailable(error);
  }
}

const refreshQueues = new Map<string, Promise<unknown>>();

function serialised<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = refreshQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  const settled = next.catch(() => {});
  refreshQueues.set(key, settled);
  void settled.then(() => {
    if (refreshQueues.get(key) === settled) refreshQueues.delete(key);
  });
  return next;
}

export async function refreshContentPack(options: RefreshContentPackOptions): Promise<ContentPackUpdateResult> {
  const key = JSON.stringify([options.paths.trustDir, options.policy.packId, options.policy.channel]);
  return serialised(key, () => refreshContentPackAudited(options));
}

async function refreshContentPackAudited(options: RefreshContentPackOptions): Promise<ContentPackUpdateResult> {
  const result = await refreshContentPackUnchecked(options);
  await appendContentPackAudit(
    options.paths,
    options.policy.packId,
    options.policy.channel,
    result,
    options.now?.() ?? new Date()
  ).catch(() => {});
  return result;
}
