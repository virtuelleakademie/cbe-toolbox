import { createHash } from "node:crypto";
import {
  decodeKeyset,
  decodeManifest,
  decodeSignatureWrapper,
  verifyEd25519,
  type ContentPackChannel,
  type ContentPackId,
  type ContentPackManifest,
} from "./signed-pack.js";
import { extractSafeZip, type SafeZipLimits } from "./safe-zip.js";

export interface PublicationSnapshotOptions {
  files: ReadonlyMap<string, Uint8Array>;
  packId: ContentPackId;
  channel: ContentPackChannel;
  rootKeyId: string;
  rootPublicKeySpki: string;
  compatibility: ContentPackManifest["compatibility"];
  limits: SafeZipLimits;
}

function required(files: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const value = files.get(name);
  if (!value) throw new Error(`missing:${name}`);
  return value;
}

export function verifyPublicationSnapshot(options: PublicationSnapshotOptions): ContentPackManifest {
  const keysetRaw = required(options.files, "keyset.json");
  const keysetSignatureRaw = required(options.files, "keyset.sig");
  const manifestRaw = required(options.files, "latest.json");
  const manifestSignatureRaw = required(options.files, "latest.sig");

  const rootWrapper = decodeSignatureWrapper(keysetSignatureRaw);
  if (!rootWrapper.ok || rootWrapper.value.keyId !== options.rootKeyId) throw new Error("root-wrapper");
  if (!verifyEd25519(keysetRaw, rootWrapper.value.signature, options.rootPublicKeySpki))
    throw new Error("root-signature");
  const keyset = decodeKeyset(keysetRaw, 256 * 1024);
  if (!keyset.ok || keyset.value.packId !== options.packId) throw new Error("keyset");

  const manifestWrapper = decodeSignatureWrapper(manifestSignatureRaw);
  if (!manifestWrapper.ok) throw new Error("manifest-wrapper");
  const target = keyset.value.targets.find(
    (candidate) =>
      candidate.keyId === manifestWrapper.value.keyId &&
      candidate.channel === options.channel &&
      candidate.status === "active"
  );
  if (!target || !verifyEd25519(manifestRaw, manifestWrapper.value.signature, target.publicKeySpki)) {
    throw new Error("manifest-signature");
  }
  const decoded = decodeManifest(manifestRaw, 256 * 1024);
  if (!decoded.ok || decoded.value.packId !== options.packId || decoded.value.channel !== options.channel) {
    throw new Error("manifest");
  }
  const manifest = decoded.value;
  if (manifest.epoch !== keyset.value.authorizedEpoch) throw new Error("epoch");
  if (JSON.stringify(manifest.compatibility) !== JSON.stringify(options.compatibility))
    throw new Error("compatibility");

  const manifestHash = createHash("sha256").update(manifestRaw).digest("hex");
  const versionedBase = `e${manifest.epoch}-s${manifest.sequence}-${manifestHash}`;
  if (!Buffer.from(required(options.files, `${versionedBase}.json`)).equals(Buffer.from(manifestRaw))) {
    throw new Error("mutable-manifest");
  }
  if (!Buffer.from(required(options.files, `${versionedBase}.sig`)).equals(Buffer.from(manifestSignatureRaw))) {
    throw new Error("mutable-signature");
  }
  const artifact = required(options.files, manifest.artifact.name);
  if (
    artifact.byteLength !== manifest.artifact.size ||
    createHash("sha256").update(artifact).digest("hex") !== manifest.artifact.sha256
  ) {
    throw new Error("artifact");
  }
  extractSafeZip(artifact, manifest.contents, options.limits);
  return manifest;
}
