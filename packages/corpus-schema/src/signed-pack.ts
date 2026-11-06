import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, KeyObject } from "node:crypto";
import { parseStrictJson, StrictJsonError } from "./strict-json.js";

export const SIGNED_PACK_SCHEMA_VERSION = 1 as const;
export const SIGNATURE_WRAPPER_MAX_BYTES = 4 * 1024;
export const SIGNED_METADATA_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const SIGNED_METADATA_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE = "cbe-toolbox" as const;

export type ContentPackId = "cbe-skill" | "cbe-corpus";
export type ContentPackChannel = "stable";
export type ContentPackKeyStatus = "active" | "revoked";

export interface SignatureWrapper {
  schemaVersion: 1;
  keyId: string;
  signature: string;
}

export interface ContentPackTargetKey {
  keyId: string;
  publicKeySpki: string;
  channel: ContentPackChannel;
  notBefore: string;
  notAfter: string;
  status: ContentPackKeyStatus;
}

export interface ContentPackKeyset {
  schemaVersion: 1;
  packId: ContentPackId;
  keysetVersion: number;
  authorizedEpoch: number;
  createdAt: string;
  expiresAt: string;
  targets: ContentPackTargetKey[];
}

export interface ContentPackArtifact {
  name: string;
  size: number;
  sha256: string;
}

export interface ContentPackEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ContentPackSource {
  /**
   * Schema-v1 retains the wire key `repository` for signed-byte compatibility,
   * but the value is an informational product-provenance claim. Authorization
   * comes from the signed pack/channel/keyset/compatibility contract, not this
   * string.
   */
  repository: string;
  commit: string;
}

export interface SkillPackCompatibility {
  appRange: string;
  modelSurfaceAbi: string;
  toolContractSha256: string;
  testedPiVersion: string;
}

export interface CorpusPackCompatibility {
  corpusSchema: string;
  indexContractSha256: string;
}

export interface ContentPackManifest {
  schemaVersion: 1;
  packId: ContentPackId;
  channel: ContentPackChannel;
  epoch: number;
  sequence: number;
  version: string;
  createdAt: string;
  expiresAt: string;
  artifact: ContentPackArtifact;
  contents: ContentPackEntry[];
  source: ContentPackSource;
  compatibility: SkillPackCompatibility | CorpusPackCompatibility;
}

export type SignedPackDecodeReason =
  | "too-large"
  | "malformed-json"
  | "not-object"
  | "noncanonical-json"
  | "schema-invalid";

export type SignedPackDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SignedPackDecodeReason; field?: string };

const SHA256 = /^[a-f0-9]{64}$/u;
const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u;
const PACK_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const PRODUCT_PROVENANCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

function fail<T>(reason: SignedPackDecodeReason, field?: string): SignedPackDecodeResult<T> {
  return { ok: false, reason, ...(field ? { field } : {}) };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().replace(".000Z", "Z") === value;
}

function validWindow(createdAt: string, expiresAt: string): boolean {
  const created = new Date(createdAt).valueOf();
  const expires = new Date(expiresAt).valueOf();
  return expires > created && expires - created <= SIGNED_METADATA_MAX_AGE_MS;
}

function parseCanonical<T>(raw: Uint8Array, maxBytes: number): SignedPackDecodeResult<T> {
  if (raw.byteLength > maxBytes) return fail("too-large");
  let parsed: unknown;
  try {
    parsed = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    if (error instanceof StrictJsonError && error.reason === "duplicate-key") {
      return fail("schema-invalid", error.path);
    }
    return fail("malformed-json");
  }
  if (!isRecord(parsed)) return fail("not-object");
  return { ok: true, value: parsed as T };
}

export function compareContentPaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function canonicalEquals(raw: Uint8Array, value: unknown): boolean {
  return Buffer.from(raw).equals(Buffer.from(canonicalJsonBytes(value)));
}

export function signatureWrapperBytes(wrapper: SignatureWrapper): Uint8Array {
  return canonicalJsonBytes({
    schemaVersion: wrapper.schemaVersion,
    keyId: wrapper.keyId,
    signature: wrapper.signature,
  });
}

export function decodeSignatureWrapper(raw: Uint8Array): SignedPackDecodeResult<SignatureWrapper> {
  const parsed = parseCanonical<Record<string, unknown>>(raw, SIGNATURE_WRAPPER_MAX_BYTES);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!exactKeys(value, ["schemaVersion", "keyId", "signature"])) return fail("schema-invalid");
  if (value.schemaVersion !== SIGNED_PACK_SCHEMA_VERSION) return fail("schema-invalid", "schemaVersion");
  if (typeof value.keyId !== "string" || !KEY_ID.test(value.keyId)) return fail("schema-invalid", "keyId");
  if (typeof value.signature !== "string" || !BASE64.test(value.signature)) {
    return fail("schema-invalid", "signature");
  }
  const bytes = Buffer.from(value.signature, "base64");
  if (bytes.byteLength !== 64 || bytes.toString("base64") !== value.signature) {
    return fail("schema-invalid", "signature");
  }
  const wrapper: SignatureWrapper = {
    schemaVersion: SIGNED_PACK_SCHEMA_VERSION,
    keyId: value.keyId,
    signature: value.signature,
  };
  if (!canonicalEquals(raw, wrapper)) return fail("noncanonical-json");
  return { ok: true, value: wrapper };
}

export function keysetBytes(keyset: ContentPackKeyset): Uint8Array {
  return canonicalJsonBytes({
    schemaVersion: keyset.schemaVersion,
    packId: keyset.packId,
    keysetVersion: keyset.keysetVersion,
    authorizedEpoch: keyset.authorizedEpoch,
    createdAt: keyset.createdAt,
    expiresAt: keyset.expiresAt,
    targets: keyset.targets.map((target) => ({
      keyId: target.keyId,
      publicKeySpki: target.publicKeySpki,
      channel: target.channel,
      notBefore: target.notBefore,
      notAfter: target.notAfter,
      status: target.status,
    })),
  });
}

export function decodeKeyset(raw: Uint8Array, maxBytes: number): SignedPackDecodeResult<ContentPackKeyset> {
  const parsed = parseCanonical<Record<string, unknown>>(raw, maxBytes);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (
    !exactKeys(value, [
      "schemaVersion",
      "packId",
      "keysetVersion",
      "authorizedEpoch",
      "createdAt",
      "expiresAt",
      "targets",
    ])
  ) {
    return fail("schema-invalid");
  }
  if (value.schemaVersion !== 1) return fail("schema-invalid", "schemaVersion");
  if (value.packId !== "cbe-skill" && value.packId !== "cbe-corpus") return fail("schema-invalid", "packId");
  if (!positiveInteger(value.keysetVersion)) return fail("schema-invalid", "keysetVersion");
  if (!positiveInteger(value.authorizedEpoch)) return fail("schema-invalid", "authorizedEpoch");
  if (!canonicalTimestamp(value.createdAt)) return fail("schema-invalid", "createdAt");
  if (!canonicalTimestamp(value.expiresAt) || !validWindow(value.createdAt, value.expiresAt)) {
    return fail("schema-invalid", "expiresAt");
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 32) {
    return fail("schema-invalid", "targets");
  }
  const targets: ContentPackTargetKey[] = [];
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  for (const item of value.targets) {
    if (!isRecord(item) || !exactKeys(item, ["keyId", "publicKeySpki", "channel", "notBefore", "notAfter", "status"])) {
      return fail("schema-invalid", "targets");
    }
    if (typeof item.keyId !== "string" || !KEY_ID.test(item.keyId) || ids.has(item.keyId)) {
      return fail("schema-invalid", "targets.keyId");
    }
    if (
      typeof item.publicKeySpki !== "string" ||
      !BASE64.test(item.publicKeySpki) ||
      publicKeys.has(item.publicKeySpki)
    ) {
      return fail("schema-invalid", "targets.publicKeySpki");
    }
    try {
      ed25519PublicKey(item.publicKeySpki);
    } catch {
      return fail("schema-invalid", "targets.publicKeySpki");
    }
    if (item.channel !== "stable") return fail("schema-invalid", "targets.channel");
    if (!canonicalTimestamp(item.notBefore) || !canonicalTimestamp(item.notAfter)) {
      return fail("schema-invalid", "targets.validity");
    }
    if (new Date(item.notAfter).valueOf() <= new Date(item.notBefore).valueOf()) {
      return fail("schema-invalid", "targets.validity");
    }
    if (item.status !== "active" && item.status !== "revoked") return fail("schema-invalid", "targets.status");
    ids.add(item.keyId);
    publicKeys.add(item.publicKeySpki);
    targets.push({
      keyId: item.keyId,
      publicKeySpki: item.publicKeySpki,
      channel: item.channel,
      notBefore: item.notBefore,
      notAfter: item.notAfter,
      status: item.status,
    });
  }
  const keyset: ContentPackKeyset = {
    schemaVersion: 1,
    packId: value.packId,
    keysetVersion: value.keysetVersion,
    authorizedEpoch: value.authorizedEpoch,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    targets,
  };
  if (!canonicalEquals(raw, keysetBytesObject(keyset))) return fail("noncanonical-json");
  return { ok: true, value: keyset };
}

function keysetBytesObject(keyset: ContentPackKeyset): unknown {
  return JSON.parse(Buffer.from(keysetBytes(keyset)).toString("utf8"));
}

function validEntryPath(value: unknown): value is string {
  if (typeof value !== "string" || !PACK_PATH.test(value) || value.includes("//")) return false;
  const segments = value.split("/");
  return !segments.some((segment) => segment === "." || segment === ".." || segment.length === 0);
}

export function validContentPackProductProvenance(value: unknown): value is string {
  if (typeof value !== "string" || !PRODUCT_PROVENANCE.test(value) || value.includes("//")) return false;
  return !value.split("/").some((segment) => segment === "." || segment === ".." || segment.length === 0);
}

function decodeCompatibility(
  packId: ContentPackId,
  value: unknown
): SkillPackCompatibility | CorpusPackCompatibility | null {
  if (!isRecord(value)) return null;
  if (packId === "cbe-skill") {
    if (!exactKeys(value, ["appRange", "modelSurfaceAbi", "toolContractSha256", "testedPiVersion"])) return null;
    if (
      typeof value.appRange !== "string" ||
      typeof value.modelSurfaceAbi !== "string" ||
      typeof value.toolContractSha256 !== "string" ||
      !SHA256.test(value.toolContractSha256) ||
      typeof value.testedPiVersion !== "string"
    ) {
      return null;
    }
    return {
      appRange: value.appRange,
      modelSurfaceAbi: value.modelSurfaceAbi,
      toolContractSha256: value.toolContractSha256,
      testedPiVersion: value.testedPiVersion,
    };
  }
  if (!exactKeys(value, ["corpusSchema", "indexContractSha256"])) return null;
  if (
    typeof value.corpusSchema !== "string" ||
    typeof value.indexContractSha256 !== "string" ||
    !SHA256.test(value.indexContractSha256)
  ) {
    return null;
  }
  return { corpusSchema: value.corpusSchema, indexContractSha256: value.indexContractSha256 };
}

export function manifestBytes(manifest: ContentPackManifest): Uint8Array {
  const compatibility =
    manifest.packId === "cbe-skill"
      ? {
          appRange: (manifest.compatibility as SkillPackCompatibility).appRange,
          modelSurfaceAbi: (manifest.compatibility as SkillPackCompatibility).modelSurfaceAbi,
          toolContractSha256: (manifest.compatibility as SkillPackCompatibility).toolContractSha256,
          testedPiVersion: (manifest.compatibility as SkillPackCompatibility).testedPiVersion,
        }
      : {
          corpusSchema: (manifest.compatibility as CorpusPackCompatibility).corpusSchema,
          indexContractSha256: (manifest.compatibility as CorpusPackCompatibility).indexContractSha256,
        };
  return canonicalJsonBytes({
    schemaVersion: manifest.schemaVersion,
    packId: manifest.packId,
    channel: manifest.channel,
    epoch: manifest.epoch,
    sequence: manifest.sequence,
    version: manifest.version,
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
    artifact: {
      name: manifest.artifact.name,
      size: manifest.artifact.size,
      sha256: manifest.artifact.sha256,
    },
    contents: manifest.contents.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 })),
    source: {
      repository: manifest.source.repository,
      commit: manifest.source.commit,
    },
    compatibility,
  });
}

export function decodeManifest(raw: Uint8Array, maxBytes: number): SignedPackDecodeResult<ContentPackManifest> {
  const parsed = parseCanonical<Record<string, unknown>>(raw, maxBytes);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (
    !exactKeys(value, [
      "schemaVersion",
      "packId",
      "channel",
      "epoch",
      "sequence",
      "version",
      "createdAt",
      "expiresAt",
      "artifact",
      "contents",
      "source",
      "compatibility",
    ])
  ) {
    return fail("schema-invalid");
  }
  if (value.schemaVersion !== 1) return fail("schema-invalid", "schemaVersion");
  if (value.packId !== "cbe-skill" && value.packId !== "cbe-corpus") return fail("schema-invalid", "packId");
  if (value.channel !== "stable") return fail("schema-invalid", "channel");
  if (!positiveInteger(value.epoch)) return fail("schema-invalid", "epoch");
  if (!positiveInteger(value.sequence)) return fail("schema-invalid", "sequence");
  if (typeof value.version !== "string" || !VERSION.test(value.version)) return fail("schema-invalid", "version");
  if (!canonicalTimestamp(value.createdAt)) return fail("schema-invalid", "createdAt");
  if (!canonicalTimestamp(value.expiresAt) || !validWindow(value.createdAt, value.expiresAt)) {
    return fail("schema-invalid", "expiresAt");
  }
  if (!isRecord(value.artifact) || !exactKeys(value.artifact, ["name", "size", "sha256"])) {
    return fail("schema-invalid", "artifact");
  }
  const artifact = value.artifact;
  if (
    typeof artifact.name !== "string" ||
    !positiveInteger(artifact.size) ||
    typeof artifact.sha256 !== "string" ||
    !SHA256.test(artifact.sha256)
  ) {
    return fail("schema-invalid", "artifact");
  }
  const expectedName = `${value.packId}-e${value.epoch}-s${value.sequence}-${artifact.sha256}.zip`;
  if (artifact.name !== expectedName) return fail("schema-invalid", "artifact.name");
  if (!Array.isArray(value.contents) || value.contents.length === 0 || value.contents.length > 256) {
    return fail("schema-invalid", "contents");
  }
  const contents: ContentPackEntry[] = [];
  const paths = new Set<string>();
  for (const item of value.contents) {
    if (!isRecord(item) || !exactKeys(item, ["path", "size", "sha256"])) return fail("schema-invalid", "contents");
    if (!validEntryPath(item.path) || paths.has(item.path)) return fail("schema-invalid", "contents.path");
    if (!positiveInteger(item.size) || typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) {
      return fail("schema-invalid", "contents");
    }
    paths.add(item.path);
    contents.push({ path: item.path, size: item.size, sha256: item.sha256 });
  }
  if (contents.some((item, index) => index > 0 && contents[index - 1]!.path >= item.path)) {
    return fail("schema-invalid", "contents");
  }
  if (!isRecord(value.source) || !exactKeys(value.source, ["repository", "commit"]))
    return fail("schema-invalid", "source");
  if (
    !validContentPackProductProvenance(value.source.repository) ||
    typeof value.source.commit !== "string" ||
    !COMMIT.test(value.source.commit)
  ) {
    return fail("schema-invalid", "source");
  }
  const compatibility = decodeCompatibility(value.packId, value.compatibility);
  if (!compatibility) return fail("schema-invalid", "compatibility");
  const manifest: ContentPackManifest = {
    schemaVersion: 1,
    packId: value.packId,
    channel: value.channel,
    epoch: value.epoch,
    sequence: value.sequence,
    version: value.version,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    artifact: { name: artifact.name, size: artifact.size, sha256: artifact.sha256 },
    contents,
    source: { repository: value.source.repository, commit: value.source.commit },
    compatibility,
  };
  if (!canonicalEquals(raw, manifestBytesObject(manifest))) return fail("noncanonical-json");
  return { ok: true, value: manifest };
}

function manifestBytesObject(manifest: ContentPackManifest): unknown {
  return JSON.parse(Buffer.from(manifestBytes(manifest)).toString("utf8"));
}

export function ed25519PublicKey(spkiBase64: string): KeyObject {
  const der = Buffer.from(spkiBase64, "base64");
  if (der.toString("base64") !== spkiBase64) throw new Error("public key is not canonical base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("public key is not Ed25519");
  if (!Buffer.from(key.export({ format: "der", type: "spki" })).equals(der))
    throw new Error("public key is not canonical SPKI");
  return key;
}

export function publicKeySpkiBase64(key: KeyObject | string | Buffer): string {
  const publicKey =
    key instanceof KeyObject ? (key.type === "public" ? key : createPublicKey(key)) : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("public key is not Ed25519");
  return Buffer.from(publicKey.export({ format: "der", type: "spki" })).toString("base64");
}

export function signEd25519(raw: Uint8Array, privateKey: KeyObject | string | Buffer): string {
  const key = privateKey instanceof KeyObject ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("private key is not Ed25519");
  return cryptoSign(null, Buffer.from(raw), key).toString("base64");
}

export function verifyEd25519(raw: Uint8Array, signatureBase64: string, publicKey: KeyObject | string): boolean {
  try {
    const key = typeof publicKey === "string" ? ed25519PublicKey(publicKey) : publicKey;
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(signatureBase64, "base64");
    return signature.byteLength === 64 && cryptoVerify(null, Buffer.from(raw), key, signature);
  } catch {
    return false;
  }
}

export function signedWrapper(
  raw: Uint8Array,
  keyId: string,
  privateKey: KeyObject | string | Buffer
): SignatureWrapper {
  if (!KEY_ID.test(keyId)) throw new Error("invalid key id");
  return { schemaVersion: 1, keyId, signature: signEd25519(raw, privateKey) };
}

export function sha256Pattern(value: string): boolean {
  return SHA256.test(value);
}
