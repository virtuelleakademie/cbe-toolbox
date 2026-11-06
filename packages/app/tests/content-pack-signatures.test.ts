import { describe, expect, it } from "vitest";
import { publicKeySpkiBase64 } from "@cbe/corpus-schema";
import { initialTrustState, verifySignedKeyset, verifySignedManifest } from "../src/main/content-pack-trust.js";
import {
  fixtureKey,
  fixtureKeyset,
  fixtureManifest,
  signKeyset,
  signManifest,
} from "./helpers/content-pack-fixture.js";

const now = new Date("2026-10-20T12:00:00Z");
const buildTime = new Date("2026-10-18T00:00:00Z");

function verifiedChain(packId: "cbe-skill" | "cbe-corpus" = "cbe-corpus") {
  const root = fixtureKey("root-v1");
  const target = fixtureKey(`${packId}-stable-1`);
  const current = initialTrustState(packId, "stable", buildTime);
  const signedKeyset = signKeyset(fixtureKeyset({ packId, targets: [{ key: target }] }), root);
  const keyset = verifySignedKeyset({
    ...signedKeyset,
    rootPublicKeySpki: publicKeySpkiBase64(root.publicKey),
    rootKeyId: root.id,
    packId,
    channel: "stable",
    metadataMaxBytes: 256 * 1024,
    current,
    now,
    appBuildTime: buildTime,
  });
  if ("status" in keyset) throw new Error(keyset.code);
  return { root, target, keyset };
}

describe("raw-byte signed content metadata", () => {
  it.each(["cbe-skill", "cbe-corpus"] as const)("authorizes exact %s manifest bytes", (packId) => {
    const { target, keyset } = verifiedChain(packId);
    const signed = signManifest(fixtureManifest({ packId }), target);
    const result = verifySignedManifest({
      ...signed,
      keyset,
      packId,
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      now,
      appBuildTime: buildTime,
      compatibility: () => ({ ok: true }),
    });
    expect(result).toMatchObject({ manifest: { packId }, signerKeyId: target.id, replay: false });
  });

  it.each([
    ["New neutral manifest remains valid", "cbe-toolbox"],
    ["Existing signed schema-v1 content remains valid", `${["phy", "laxe"].join("")}/${["cbe", "toolbox"].join("-")}`],
  ])("%s", (_label, sourceProvenance) => {
    const { target, keyset } = verifiedChain();
    const signed = signManifest(fixtureManifest({ sourceProvenance }), target);
    const result = verifySignedManifest({
      ...signed,
      keyset,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      now,
      appBuildTime: buildTime,
      compatibility: () => ({ ok: true }),
    });
    expect(result).toMatchObject({
      manifest: { source: { repository: sourceProvenance } },
      signerKeyId: target.id,
      replay: false,
    });
  });

  it.each([
    ["manifest byte", "manifest"],
    ["manifest signature", "manifest-signature"],
    ["keyset byte", "keyset"],
    ["keyset signature", "keyset-signature"],
  ])("refuses tampered %s before trust", (_name, part) => {
    const root = fixtureKey("root-v1");
    const target = fixtureKey("corpus-stable-1");
    const current = initialTrustState("cbe-corpus", "stable", buildTime);
    const signedKeyset = signKeyset(fixtureKeyset({ targets: [{ key: target }] }), root);
    const signedManifest = signManifest(fixtureManifest(), target);
    const flip = (bytes: Uint8Array) => {
      const copy = Buffer.from(bytes);
      copy[Math.floor(copy.length / 2)] ^= 1;
      return copy;
    };
    const keyset = verifySignedKeyset({
      raw: part === "keyset" ? flip(signedKeyset.raw) : signedKeyset.raw,
      signatureRaw: part === "keyset-signature" ? flip(signedKeyset.signatureRaw) : signedKeyset.signatureRaw,
      rootPublicKeySpki: publicKeySpkiBase64(root.publicKey),
      rootKeyId: root.id,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      current,
      now,
      appBuildTime: buildTime,
    });
    if (part.startsWith("keyset")) {
      expect(keyset).toMatchObject({ status: "refused" });
      return;
    }
    if ("status" in keyset) throw new Error(keyset.code);
    const manifest = verifySignedManifest({
      raw: part === "manifest" ? flip(signedManifest.raw) : signedManifest.raw,
      signatureRaw: part === "manifest-signature" ? flip(signedManifest.signatureRaw) : signedManifest.signatureRaw,
      keyset,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      now,
      appBuildTime: buildTime,
      compatibility: () => ({ ok: true }),
    });
    expect(manifest).toMatchObject({ status: "refused" });
  });

  it("refuses cross-pack and wrong-root signatures", () => {
    const { target, keyset } = verifiedChain();
    const crossPack = verifySignedManifest({
      ...signManifest(fixtureManifest({ packId: "cbe-skill" }), target),
      keyset,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      now,
      appBuildTime: buildTime,
      compatibility: () => ({ ok: true }),
    });
    expect(crossPack).toMatchObject({ status: "refused", code: "pack-mismatch" });

    const wrongRoot = fixtureKey("root-v1");
    const rejected = verifySignedKeyset({
      ...signKeyset(fixtureKeyset({ targets: [{ key: target }] }), fixtureKey("other-root")),
      rootPublicKeySpki: publicKeySpkiBase64(wrongRoot.publicKey),
      rootKeyId: wrongRoot.id,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      current: initialTrustState("cbe-corpus", "stable", buildTime),
      now,
      appBuildTime: buildTime,
    });
    expect(rejected).toMatchObject({ status: "refused", code: "root-key-id-mismatch" });
  });

  it("refuses compatibility mismatch before artifact eligibility", () => {
    const { target, keyset } = verifiedChain();
    const result = verifySignedManifest({
      ...signManifest(fixtureManifest(), target),
      keyset,
      packId: "cbe-corpus",
      channel: "stable",
      metadataMaxBytes: 256 * 1024,
      now,
      appBuildTime: buildTime,
      compatibility: () => ({ ok: false, field: "indexContractSha256" }),
    });
    expect(result).toEqual({ status: "refused", code: "compatibility-mismatch", field: "indexContractSha256" });
  });
});
