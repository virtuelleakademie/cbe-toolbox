import { createHash } from "node:crypto";
import {
  SIGNED_METADATA_MAX_FUTURE_MS,
  decodeKeyset,
  decodeManifest,
  decodeSignatureWrapper,
  verifyEd25519,
  type ContentPackChannel,
  type ContentPackId,
  type ContentPackKeyset,
  type ContentPackManifest,
  type ContentPackTargetKey,
} from "@cbe/corpus-schema";

export interface ContentPackTrustState {
  schemaVersion: 1;
  packId: ContentPackId;
  channel: ContentPackChannel;
  keysetVersion: number;
  keysetSha256: string;
  authorizedEpoch: number;
  epoch: number;
  sequence: number;
  manifestSha256: string | null;
  greatestCreatedAt: string;
  revokedKeyIds: string[];
}

export type ContentPackRefusalCode =
  | "not-provisioned"
  | "metadata-too-large"
  | "signature-wrapper-invalid"
  | "signature-invalid"
  | "root-key-id-mismatch"
  | "metadata-schema-invalid"
  | "pack-mismatch"
  | "channel-mismatch"
  | "keyset-rollback"
  | "keyset-equivocation"
  | "key-revoked"
  | "key-not-authorized"
  | "metadata-expired"
  | "metadata-from-future"
  | "epoch-not-authorized"
  | "rollback"
  | "equivocation"
  | "compatibility-mismatch";

export interface ContentPackRefusal {
  status: "refused";
  code: ContentPackRefusalCode;
  field?: string;
}

export interface VerifiedKeyset {
  keyset: ContentPackKeyset;
  keysetSha256: string;
  trust: ContentPackTrustState;
}

export interface VerifiedManifest {
  manifest: ContentPackManifest;
  manifestSha256: string;
  signerKeyId: string;
  trust: ContentPackTrustState;
  replay: boolean;
}

export interface VerifyKeysetOptions {
  raw: Uint8Array;
  signatureRaw: Uint8Array;
  rootPublicKeySpki: string | null;
  rootKeyId: string;
  packId: ContentPackId;
  channel: ContentPackChannel;
  metadataMaxBytes: number;
  current: ContentPackTrustState;
  now: Date;
  appBuildTime: Date;
}

export interface VerifyManifestOptions {
  raw: Uint8Array;
  signatureRaw: Uint8Array;
  keyset: VerifiedKeyset;
  packId: ContentPackId;
  channel: ContentPackChannel;
  metadataMaxBytes: number;
  now: Date;
  appBuildTime: Date;
  compatibility: (manifest: ContentPackManifest) => { ok: true } | { ok: false; field: string };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function initialTrustState(
  packId: ContentPackId,
  channel: ContentPackChannel,
  appBuildTime: Date
): ContentPackTrustState {
  return {
    schemaVersion: 1,
    packId,
    channel,
    keysetVersion: 0,
    keysetSha256: "",
    authorizedEpoch: 0,
    epoch: 0,
    sequence: 0,
    manifestSha256: null,
    greatestCreatedAt: canonicalSeconds(appBuildTime),
    revokedKeyIds: [],
  };
}

function canonicalSeconds(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function refusal(code: ContentPackRefusalCode, field?: string): ContentPackRefusal {
  return { status: "refused", code, ...(field ? { field } : {}) };
}

function metadataDecodeRefusal(reason: string): ContentPackRefusal {
  return refusal(reason === "too-large" ? "metadata-too-large" : "metadata-schema-invalid");
}

function trustedNow(current: ContentPackTrustState, now: Date, appBuildTime: Date): number {
  return Math.max(now.valueOf(), appBuildTime.valueOf(), new Date(current.greatestCreatedAt).valueOf());
}

function freshness(
  createdAt: string,
  expiresAt: string,
  current: ContentPackTrustState,
  now: Date,
  appBuildTime: Date
): ContentPackRefusal | null {
  const trusted = trustedNow(current, now, appBuildTime);
  const created = new Date(createdAt).valueOf();
  if (created > trusted + SIGNED_METADATA_MAX_FUTURE_MS) return refusal("metadata-from-future");
  if (new Date(expiresAt).valueOf() <= trusted) return refusal("metadata-expired");
  return null;
}

function greatestTimestamp(...values: string[]): string {
  return values.reduce((greatest, value) =>
    new Date(value).valueOf() > new Date(greatest).valueOf() ? value : greatest
  );
}

export function verifySignedKeyset(options: VerifyKeysetOptions): VerifiedKeyset | ContentPackRefusal {
  if (!options.rootPublicKeySpki) return refusal("not-provisioned");
  const wrapper = decodeSignatureWrapper(options.signatureRaw);
  if (!wrapper.ok) return refusal("signature-wrapper-invalid");
  if (wrapper.value.keyId !== options.rootKeyId) return refusal("root-key-id-mismatch");
  if (!verifyEd25519(options.raw, wrapper.value.signature, options.rootPublicKeySpki))
    return refusal("signature-invalid");

  const decoded = decodeKeyset(options.raw, options.metadataMaxBytes);
  if (!decoded.ok) return metadataDecodeRefusal(decoded.reason);
  const keyset = decoded.value;
  if (keyset.packId !== options.packId) return refusal("pack-mismatch");
  const freshnessFailure = freshness(
    keyset.createdAt,
    keyset.expiresAt,
    options.current,
    options.now,
    options.appBuildTime
  );
  if (freshnessFailure) return freshnessFailure;
  const keysetSha256 = sha256Hex(options.raw);
  if (keyset.keysetVersion < options.current.keysetVersion) return refusal("keyset-rollback");
  if (keyset.keysetVersion === options.current.keysetVersion && options.current.keysetVersion > 0) {
    if (keysetSha256 !== options.current.keysetSha256) return refusal("keyset-equivocation");
  }
  if (keyset.authorizedEpoch < options.current.authorizedEpoch) return refusal("keyset-rollback", "authorizedEpoch");

  const previouslyRevoked = new Set(options.current.revokedKeyIds);
  for (const target of keyset.targets) {
    if (target.status === "active" && previouslyRevoked.has(target.keyId)) return refusal("key-revoked", target.keyId);
  }
  const revokedKeyIds = [
    ...new Set([
      ...previouslyRevoked,
      ...keyset.targets.filter((key) => key.status === "revoked").map((key) => key.keyId),
    ]),
  ].sort();
  const trust: ContentPackTrustState = {
    ...options.current,
    keysetVersion: keyset.keysetVersion,
    keysetSha256,
    authorizedEpoch: keyset.authorizedEpoch,
    greatestCreatedAt: greatestTimestamp(options.current.greatestCreatedAt, keyset.createdAt),
    revokedKeyIds,
  };
  return { keyset, keysetSha256, trust };
}

function targetFor(
  keyset: ContentPackKeyset,
  keyId: string,
  channel: ContentPackChannel,
  revokedKeyIds: readonly string[],
  validationTime: number
): ContentPackTargetKey | ContentPackRefusal {
  const target = keyset.targets.find((candidate) => candidate.keyId === keyId);
  if (!target || target.channel !== channel) return refusal("key-not-authorized");
  if (target.status === "revoked" || revokedKeyIds.includes(target.keyId)) return refusal("key-revoked");
  if (new Date(target.notBefore).valueOf() > validationTime || new Date(target.notAfter).valueOf() <= validationTime) {
    return refusal("key-not-authorized");
  }
  return target;
}

export function verifySignedManifest(options: VerifyManifestOptions): VerifiedManifest | ContentPackRefusal {
  const wrapper = decodeSignatureWrapper(options.signatureRaw);
  if (!wrapper.ok) return refusal("signature-wrapper-invalid");
  const validationTime = trustedNow(options.keyset.trust, options.now, options.appBuildTime);
  const target = targetFor(
    options.keyset.keyset,
    wrapper.value.keyId,
    options.channel,
    options.keyset.trust.revokedKeyIds,
    validationTime
  );
  if (target.status === "refused") return target;
  if (!verifyEd25519(options.raw, wrapper.value.signature, target.publicKeySpki)) return refusal("signature-invalid");

  const decoded = decodeManifest(options.raw, options.metadataMaxBytes);
  if (!decoded.ok) return metadataDecodeRefusal(decoded.reason);
  const manifest = decoded.value;
  if (manifest.packId !== options.packId) return refusal("pack-mismatch");
  if (manifest.channel !== options.channel) return refusal("channel-mismatch");
  if (manifest.epoch !== options.keyset.keyset.authorizedEpoch) return refusal("epoch-not-authorized");
  const freshnessFailure = freshness(
    manifest.createdAt,
    manifest.expiresAt,
    options.keyset.trust,
    options.now,
    options.appBuildTime
  );
  if (freshnessFailure) return freshnessFailure;
  const compatible = options.compatibility(manifest);
  if (!compatible.ok) return refusal("compatibility-mismatch", compatible.field);

  const manifestSha256 = sha256Hex(options.raw);
  const current = options.keyset.trust;
  if (manifest.epoch < current.epoch) return refusal("rollback");
  if (manifest.epoch === current.epoch && manifest.sequence < current.sequence) return refusal("rollback");
  if (manifest.epoch === current.epoch && manifest.sequence === current.sequence && current.sequence > 0) {
    if (manifestSha256 !== current.manifestSha256) return refusal("equivocation");
    return { manifest, manifestSha256, signerKeyId: target.keyId, trust: current, replay: true };
  }
  if (manifest.epoch > current.epoch && manifest.epoch !== current.authorizedEpoch)
    return refusal("epoch-not-authorized");
  const trust: ContentPackTrustState = {
    ...current,
    greatestCreatedAt: greatestTimestamp(current.greatestCreatedAt, manifest.createdAt),
  };
  return { manifest, manifestSha256, signerKeyId: target.keyId, trust, replay: false };
}

export function activatedTrust(verified: VerifiedManifest): ContentPackTrustState {
  return {
    ...verified.trust,
    epoch: verified.manifest.epoch,
    sequence: verified.manifest.sequence,
    manifestSha256: verified.manifestSha256,
  };
}

export function revalidateManifestFreshness(
  verified: VerifiedManifest,
  now: Date,
  appBuildTime: Date
): ContentPackRefusal | null {
  return freshness(verified.manifest.createdAt, verified.manifest.expiresAt, verified.trust, now, appBuildTime);
}
