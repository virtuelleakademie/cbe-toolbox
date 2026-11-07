import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  keysetBytes,
  manifestBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  type ContentPackChannel,
  type ContentPackId,
  type ContentPackKeyset,
  type ContentPackManifest,
} from "@cbe/corpus-schema";

export interface FixtureKey {
  id: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export function fixtureKey(id: string): FixtureKey {
  const pair = generateKeyPairSync("ed25519");
  return { id, publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export function fixtureKeyset(options: {
  packId?: ContentPackId;
  channel?: ContentPackChannel;
  keysetVersion?: number;
  epoch?: number;
  createdAt?: string;
  expiresAt?: string;
  targets: Array<{ key: FixtureKey; status?: "active" | "revoked"; channel?: ContentPackChannel }>;
}): ContentPackKeyset {
  const createdAt = options.createdAt ?? "2026-10-18T12:00:00Z";
  const expiresAt = options.expiresAt ?? "2027-01-16T12:00:00Z";
  return {
    schemaVersion: 1,
    packId: options.packId ?? "cbe-corpus",
    keysetVersion: options.keysetVersion ?? 1,
    authorizedEpoch: options.epoch ?? 1,
    createdAt,
    expiresAt,
    targets: options.targets.map(({ key, status = "active", channel = options.channel ?? "stable" }) => ({
      keyId: key.id,
      publicKeySpki: publicKeySpkiBase64(key.publicKey),
      channel,
      notBefore: createdAt,
      notAfter: expiresAt,
      status,
    })),
  };
}

export function fixtureManifest(options?: {
  packId?: ContentPackId;
  channel?: ContentPackChannel;
  epoch?: number;
  sequence?: number;
  version?: string;
  createdAt?: string;
  expiresAt?: string;
  artifactSha256?: string;
  compatibility?: ContentPackManifest["compatibility"];
  sourceProvenance?: string;
}): ContentPackManifest {
  const packId = options?.packId ?? "cbe-corpus";
  const epoch = options?.epoch ?? 1;
  const sequence = options?.sequence ?? 1;
  const artifactSha256 = options?.artifactSha256 ?? "a".repeat(64);
  return {
    schemaVersion: 1,
    packId,
    channel: options?.channel ?? "stable",
    epoch,
    sequence,
    version: options?.version ?? (packId === "cbe-skill" ? "0.4.2" : "2026-07"),
    createdAt: options?.createdAt ?? "2026-10-18T12:00:00Z",
    expiresAt: options?.expiresAt ?? "2027-01-16T12:00:00Z",
    artifact: {
      name: `${packId}-e${epoch}-s${sequence}-${artifactSha256}.zip`,
      size: 123,
      sha256: artifactSha256,
    },
    contents:
      packId === "cbe-skill"
        ? [{ path: "SKILL.md", size: 12, sha256: "b".repeat(64) }]
        : [
            { path: "content/foundations/a.md", size: 12, sha256: "b".repeat(64) },
            { path: "index.json", size: 22, sha256: "c".repeat(64) },
          ],
    source: {
      repository: options?.sourceProvenance ?? DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
      commit: "d".repeat(40),
    },
    compatibility:
      options?.compatibility ??
      (packId === "cbe-skill"
        ? {
            appRange: ">=0.1.23 <0.2.0",
            modelSurfaceAbi: "cbe-skill/1",
            toolContractSha256: "e".repeat(64),
            testedPiVersion: "1.3.0",
          }
        : { corpusSchema: "cbe-corpus/1", indexContractSha256: "e".repeat(64) }),
  };
}

export function signKeyset(keyset: ContentPackKeyset, root: FixtureKey) {
  const raw = keysetBytes(keyset);
  return { raw, signatureRaw: signatureWrapperBytes(signedWrapper(raw, root.id, root.privateKey)) };
}

export function signManifest(manifest: ContentPackManifest, target: FixtureKey) {
  const raw = manifestBytes(manifest);
  return { raw, signatureRaw: signatureWrapperBytes(signedWrapper(raw, target.id, target.privateKey)) };
}
