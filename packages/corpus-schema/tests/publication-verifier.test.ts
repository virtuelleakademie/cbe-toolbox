import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import {
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  keysetBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  verifyPublicationSnapshot,
  type ContentPackKeyset,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cbe-publication-"));
  roots.push(dir);
  const skill = path.join(dir, "skill");
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
  const pack = await createUnsignedContentPack({
    packId: "cbe-skill",
    channel: "stable",
    epoch: 1,
    sequence: 1,
    sourceDir: skill,
    sourceCommit: "a".repeat(40),
    sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
    createdAt: new Date("2026-10-18T12:00:00Z"),
    expiresAt: new Date("2027-01-16T12:00:00Z"),
    compatibility: SKILL_COMPATIBILITY_CONTRACT,
    skillBodyBudget: SKILL_BODY_BUDGET,
  });
  const root = generateKeyPairSync("ed25519");
  const target = generateKeyPairSync("ed25519");
  const keyset: ContentPackKeyset = {
    schemaVersion: 1,
    packId: "cbe-skill",
    keysetVersion: 1,
    authorizedEpoch: 1,
    createdAt: "2026-10-18T12:00:00Z",
    expiresAt: "2027-01-16T12:00:00Z",
    targets: [
      {
        keyId: "skill-stable-1",
        publicKeySpki: publicKeySpkiBase64(target.publicKey),
        channel: "stable",
        notBefore: "2026-10-18T12:00:00Z",
        notAfter: "2027-01-16T12:00:00Z",
        status: "active",
      },
    ],
  };
  const keysetRaw = keysetBytes(keyset);
  const latestSignature = signatureWrapperBytes(signedWrapper(pack.manifestRaw, "skill-stable-1", target.privateKey));
  const manifestHash = (await import("node:crypto")).createHash("sha256").update(pack.manifestRaw).digest("hex");
  const versionedBase = `e1-s1-${manifestHash}`;
  const files = new Map<string, Uint8Array>([
    ["keyset.json", keysetRaw],
    ["keyset.sig", signatureWrapperBytes(signedWrapper(keysetRaw, "root-v1", root.privateKey))],
    ["latest.json", pack.manifestRaw],
    ["latest.sig", latestSignature],
    [`${versionedBase}.json`, pack.manifestRaw],
    [`${versionedBase}.sig`, latestSignature],
    [pack.manifest.artifact.name, pack.artifactBytes],
  ]);
  return { files, root: publicKeySpkiBase64(root.publicKey), artifactName: pack.manifest.artifact.name, versionedBase };
}

const limits = {
  maxCompressedBytes: 256 * 1024,
  maxEntries: 1,
  maxFileBytes: 64 * 1024,
  maxExpandedBytes: 64 * 1024,
  maxExpansionRatio: 20,
};

describe("post-deploy publication verifier", () => {
  it("accepts complete immutable-first publication", async () => {
    const value = await fixture();
    expect(
      verifyPublicationSnapshot({
        files: value.files,
        packId: "cbe-skill",
        channel: "stable",
        rootKeyId: "root-v1",
        rootPublicKeySpki: value.root,
        compatibility: SKILL_COMPATIBILITY_CONTRACT,
        limits,
      }).version
    ).toBe("0.4.2");
  });

  it.each([
    [
      "latest advanced before immutable manifest",
      (value: Awaited<ReturnType<typeof fixture>>) => value.files.delete(`${value.versionedBase}.json`),
    ],
    [
      "missing immutable signature",
      (value: Awaited<ReturnType<typeof fixture>>) => value.files.delete(`${value.versionedBase}.sig`),
    ],
    ["missing artifact", (value: Awaited<ReturnType<typeof fixture>>) => value.files.delete(value.artifactName)],
    [
      "mutated latest",
      (value: Awaited<ReturnType<typeof fixture>>) => value.files.set("latest.json", Buffer.from("{}\n")),
    ],
    [
      "mutated immutable copy",
      (value: Awaited<ReturnType<typeof fixture>>) =>
        value.files.set(`${value.versionedBase}.json`, Buffer.from("{}\n")),
    ],
    [
      "bad signature",
      (value: Awaited<ReturnType<typeof fixture>>) => value.files.set("latest.sig", Buffer.from("{}\n")),
    ],
    [
      "bad artifact hash",
      (value: Awaited<ReturnType<typeof fixture>>) => value.files.set(value.artifactName, Buffer.from("changed")),
    ],
  ])("Post-deploy verification catches partial or mutable publication: %s", async (_name, mutate) => {
    const value = await fixture();
    mutate(value);
    expect(() =>
      verifyPublicationSnapshot({
        files: value.files,
        packId: "cbe-skill",
        channel: "stable",
        rootKeyId: "root-v1",
        rootPublicKeySpki: value.root,
        compatibility: SKILL_COMPATIBILITY_CONTRACT,
        limits,
      })
    ).toThrow();
  });
});
