import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  canonicalJsonBytes,
  compareContentPaths,
  decodeKeyset,
  decodeManifest,
  decodeSignatureWrapper,
  keysetBytes,
  manifestBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  verifyEd25519,
  type ContentPackKeyset,
  type ContentPackManifest,
} from "../src/signed-pack.js";

function fixture() {
  const root = generateKeyPairSync("ed25519");
  const target = generateKeyPairSync("ed25519");
  const keyset: ContentPackKeyset = {
    schemaVersion: 1,
    packId: "cbe-corpus",
    keysetVersion: 1,
    authorizedEpoch: 1,
    createdAt: "2026-10-18T12:00:00Z",
    expiresAt: "2027-01-16T12:00:00Z",
    targets: [
      {
        keyId: "corpus-stable-1",
        publicKeySpki: publicKeySpkiBase64(target.publicKey),
        channel: "stable",
        notBefore: "2026-10-18T12:00:00Z",
        notAfter: "2027-01-16T12:00:00Z",
        status: "active",
      },
    ],
  };
  const manifest: ContentPackManifest = {
    schemaVersion: 1,
    packId: "cbe-corpus",
    channel: "stable",
    epoch: 1,
    sequence: 1,
    version: "2026-07",
    createdAt: "2026-10-18T12:00:00Z",
    expiresAt: "2027-01-16T12:00:00Z",
    artifact: {
      name: `cbe-corpus-e1-s1-${"a".repeat(64)}.zip`,
      size: 123,
      sha256: "a".repeat(64),
    },
    contents: [
      { path: "content/foundations/a.md", size: 12, sha256: "b".repeat(64) },
      { path: "index.json", size: 22, sha256: "c".repeat(64) },
    ],
    source: { repository: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE, commit: "d".repeat(40) },
    compatibility: { corpusSchema: "cbe-corpus/1", indexContractSha256: "e".repeat(64) },
  };
  return { root, target, keyset, manifest };
}

describe("signed pack canonical metadata", () => {
  it("signs and verifies exact raw Ed25519 bytes", () => {
    const { target, manifest } = fixture();
    const raw = manifestBytes(manifest);
    const wrapper = signedWrapper(raw, "corpus-stable-1", target.privateKey);
    expect(verifyEd25519(raw, wrapper.signature, publicKeySpkiBase64(target.publicKey))).toBe(true);
    const changed = Buffer.from(raw);
    changed[10] ^= 1;
    expect(verifyEd25519(changed, wrapper.signature, publicKeySpkiBase64(target.publicKey))).toBe(false);
  });

  it("accepts existing signed schema-v1 provenance claims without using them as authorization", () => {
    const { target, manifest } = fixture();
    const legacyClaim = `${["phy", "laxe"].join("")}/${["cbe", "toolbox"].join("-")}`;
    manifest.source.repository = legacyClaim;
    const raw = manifestBytes(manifest);
    const wrapper = signedWrapper(raw, "corpus-stable-1", target.privateKey);

    expect(decodeManifest(raw, 256 * 1024)).toEqual({ ok: true, value: manifest });
    expect(verifyEd25519(raw, wrapper.signature, publicKeySpkiBase64(target.publicKey))).toBe(true);
  });

  it("round-trips deterministic keyset, manifest and wrapper bytes", () => {
    const { root, keyset, manifest } = fixture();
    const keysetRaw = keysetBytes(keyset);
    const manifestRaw = manifestBytes(manifest);
    const wrapperRaw = signatureWrapperBytes(signedWrapper(keysetRaw, "root-v1", root.privateKey));
    expect(decodeKeyset(keysetRaw, 256 * 1024)).toEqual({ ok: true, value: keyset });
    expect(decodeManifest(manifestRaw, 256 * 1024)).toEqual({ ok: true, value: manifest });
    expect(decodeSignatureWrapper(wrapperRaw).ok).toBe(true);
    expect(Buffer.from(keysetBytes(keyset))).toEqual(Buffer.from(keysetRaw));
    expect(Buffer.from(manifestBytes(manifest))).toEqual(Buffer.from(manifestRaw));
  });

  it.each([
    ["whitespace", (raw: Uint8Array) => Buffer.from(` ${Buffer.from(raw).toString("utf8")}`)],
    ["reordered fields", () => canonicalJsonBytes({ packId: "cbe-corpus", schemaVersion: 1 })],
    [
      "duplicate fields",
      () =>
        Buffer.from('{"schemaVersion":1,"schemaVersion":1,"keyId":"root-v1","signature":"' + "A".repeat(86) + '=="}\n'),
    ],
  ])("refuses noncanonical or duplicate %s", (_name, mutate) => {
    const { root, keyset } = fixture();
    const raw = keysetBytes(keyset);
    const changed = mutate(raw);
    const result = decodeKeyset(changed, 256 * 1024);
    expect(result.ok).toBe(false);
    const wrapper = decodeSignatureWrapper(
      mutate(signatureWrapperBytes(signedWrapper(raw, "root-v1", root.privateKey)))
    );
    expect(wrapper.ok).toBe(false);
  });

  it.each([
    [
      "unknown manifest field",
      (raw: Uint8Array) =>
        Buffer.from(
          Buffer.from(raw).toString("utf8").replace('"schemaVersion":1,', '"schemaVersion":1,"algorithm":"Ed25519",')
        ),
    ],
    [
      "duplicate nested field",
      (raw: Uint8Array) =>
        Buffer.from(Buffer.from(raw).toString("utf8").replace('"size":123,', '"size":123,"size":123,')),
    ],
    [
      "non-integer sequence",
      (raw: Uint8Array) => Buffer.from(Buffer.from(raw).toString("utf8").replace('"sequence":1,', '"sequence":1.5,')),
    ],
    [
      "noncanonical timestamp",
      (raw: Uint8Array) =>
        Buffer.from(Buffer.from(raw).toString("utf8").replace("2026-10-18T12:00:00Z", "2026-10-18T12:00:00.000Z")),
    ],
  ])("rejects strict manifest schema violation: %s", (_name, mutate) => {
    const { manifest } = fixture();
    expect(decodeManifest(mutate(manifestBytes(manifest)), 256 * 1024)).toMatchObject({ ok: false });
  });

  it("rejects algorithm negotiation and noncanonical signature base64", () => {
    const { root, keyset } = fixture();
    const raw = keysetBytes(keyset);
    const wrapper = signedWrapper(raw, "root-v1", root.privateKey);
    expect(
      decodeSignatureWrapper(
        canonicalJsonBytes({
          schemaVersion: 1,
          keyId: wrapper.keyId,
          algorithm: "Ed25519",
          signature: wrapper.signature,
        })
      )
    ).toMatchObject({ ok: false });
    expect(
      decodeSignatureWrapper(canonicalJsonBytes({ ...wrapper, signature: wrapper.signature.replace(/=+$/u, "") }))
    ).toMatchObject({ ok: false });
  });

  it.each(["https://example.org/product", "../product", "product//stable", "product:stable", ""])(
    "rejects unbounded product provenance %s",
    (repository) => {
      const { manifest } = fixture();
      manifest.source.repository = repository;
      expect(decodeManifest(manifestBytes(manifest), 256 * 1024)).toMatchObject({
        ok: false,
        field: "source",
      });
    }
  );

  it("rejects every channel other than stable", () => {
    const { keyset, manifest } = fixture();
    const unsupportedManifest = Buffer.from(
      Buffer.from(manifestBytes(manifest)).toString("utf8").replace('"channel":"stable"', '"channel":"preview"')
    );
    const unsupportedKeyset = Buffer.from(
      Buffer.from(keysetBytes(keyset)).toString("utf8").replace('"channel":"stable"', '"channel":"preview"')
    );
    expect(decodeManifest(unsupportedManifest, 256 * 1024)).toMatchObject({
      ok: false,
      field: "channel",
    });
    expect(decodeKeyset(unsupportedKeyset, 256 * 1024)).toMatchObject({
      ok: false,
      field: "targets.channel",
    });
  });

  it("rejects oversized metadata before parsing", () => {
    const result = decodeManifest(Buffer.alloc(257 * 1024, 0x20), 256 * 1024);
    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects non-Ed25519 target keys", () => {
    const { keyset } = fixture();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keyset.targets[0]!.publicKeySpki = rsa.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(decodeKeyset(keysetBytes(keyset), 256 * 1024)).toMatchObject({ ok: false });
  });

  it("orders content paths by code unit, the order the manifest decoder requires", () => {
    const paths = ["content/b.md", "Content/a.md", "content/_x.md", "content/B.md", "index.json"];
    const sorted = [...paths].sort(compareContentPaths);
    expect(sorted).toEqual(["Content/a.md", "content/B.md", "content/_x.md", "content/b.md", "index.json"]);
    expect(sorted.every((item, index) => index === 0 || sorted[index - 1]! < item)).toBe(true);
  });
});
