import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  keysetBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  type ContentPackKeyset,
  type ContentPackManifest,
} from "@cbe/corpus-schema";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import { checkPublicationOrder } from "../../../scripts/content-pack-preflight.mjs";
import {
  INVENTORY_NAME,
  assertPreserved,
  channelDir,
  inventoryBytes,
  pullChannel,
  readChannel,
  writeChannel,
  writeInventory,
} from "../../../scripts/content-pack-mirror.mjs";

const origin = "https://portal.example";
const root = generateKeyPairSync("ed25519");
const target = generateKeyPairSync("ed25519");
const rootPublicKeySpki = publicKeySpkiBase64(root.publicKey);

function manifest(overrides: Partial<ContentPackManifest>): ContentPackManifest {
  return {
    schemaVersion: 1,
    packId: "cbe-skill",
    channel: "stable",
    epoch: 1,
    sequence: 2,
    version: "0.4.2",
    createdAt: "2026-10-18T12:00:00Z",
    expiresAt: "2027-01-16T12:00:00Z",
    source: { commit: "a".repeat(40), path: "skills/cbe" },
    compatibility: SKILL_COMPATIBILITY_CONTRACT,
    artifact: { name: "x.zip", size: 1, sha256: "0".repeat(64) },
    contents: [{ path: "SKILL.md", size: 1, sha256: "1".repeat(64) }],
    ...overrides,
  } as ContentPackManifest;
}

async function channelFiles(skillDir: string, sequence: number): Promise<Map<string, Uint8Array>> {
  const pack = await createUnsignedContentPack({
    packId: "cbe-skill",
    channel: "stable",
    epoch: 1,
    sequence,
    sourceDir: skillDir,
    sourceCommit: "a".repeat(40),
    sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
    createdAt: new Date("2026-10-18T12:00:00Z"),
    expiresAt: new Date("2027-01-16T12:00:00Z"),
    compatibility: SKILL_COMPATIBILITY_CONTRACT,
    skillBodyBudget: SKILL_BODY_BUDGET,
  });
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
  const signature = signatureWrapperBytes(signedWrapper(pack.manifestRaw, "skill-stable-1", target.privateKey));
  const versioned = `e1-s${sequence}-${createHash("sha256").update(pack.manifestRaw).digest("hex")}`;
  const files = new Map<string, Uint8Array>([
    ["keyset.json", keysetRaw],
    ["keyset.sig", signatureWrapperBytes(signedWrapper(keysetRaw, "root-v1", root.privateKey))],
    ["latest.json", pack.manifestRaw],
    ["latest.sig", signature],
    [`${versioned}.json`, pack.manifestRaw],
    [`${versioned}.sig`, signature],
    [pack.manifest.artifact.name, pack.artifactBytes],
  ]);
  files.set(INVENTORY_NAME, inventoryBytes(files));
  return files;
}

function serve(channels: Record<string, Map<string, Uint8Array>>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/^\/delivery\/v2\/(\w+)\/(\w+)\/([^/]+)$/u);
    const body = match ? channels[`${match[1]}/${match[2]}`]?.get(match[3]!) : undefined;
    return body ? new Response(body, { status: 200 }) : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("content-pack publication ordering and persistence", () => {
  let dir: string;
  let skillDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "cbe-publication-order-"));
    skillDir = path.join(dir, "skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a sequence at or below the live stable channel", () => {
    const live = manifest({ sequence: 2 });
    expect(() => checkPublicationOrder({ candidate: manifest({ sequence: 2 }), live })).toThrow(/does not exceed/u);
    expect(() => checkPublicationOrder({ candidate: manifest({ sequence: 1 }), live })).toThrow(/does not exceed/u);
    expect(() => checkPublicationOrder({ candidate: manifest({ epoch: 0, sequence: 9 }), live })).toThrow(
      /does not exceed/u
    );
    expect(() => checkPublicationOrder({ candidate: manifest({ sequence: 3 }), live })).not.toThrow();
  });

  it("accepts the first stable publication and refuses any unsupported channel", () => {
    expect(() => checkPublicationOrder({ candidate: manifest({}), live: null })).not.toThrow();
    const unsupported = { ...manifest({}), channel: "preview" } as unknown as ContentPackManifest;
    expect(() => checkPublicationOrder({ candidate: unsupported, live: null })).toThrow(/only stable/u);
  });

  it("mirrors every listed immutable object and treats an all-404 channel as unpublished", async () => {
    const stable = await channelFiles(skillDir, 1);
    const fetchImpl = serve({ "skill/stable": stable });
    const pulled = await pullChannel({
      fetchImpl,
      origin,
      pack: "skill",
      channel: "stable",
      rootKeyId: "root-v1",
      rootPublicKeySpki,
    });
    expect([...pulled!.keys()].sort()).toEqual([...stable.keys()].sort());
    expect(
      await pullChannel({
        fetchImpl,
        origin,
        pack: "corpus",
        channel: "stable",
        rootKeyId: "root-v1",
        rootPublicKeySpki,
      })
    ).toBeNull();
  });

  it("refuses a mirror whose object differs from its inventory or whose metadata lacks an inventory", async () => {
    const stable = await channelFiles(skillDir, 1);
    const tampered = new Map(stable);
    const artifact = [...stable.keys()].find((name) => name.endsWith(".zip"))!;
    tampered.set(artifact, new Uint8Array([1, 2, 3]));
    await expect(
      pullChannel({
        fetchImpl: serve({ "skill/stable": tampered }),
        origin,
        pack: "skill",
        channel: "stable",
        rootKeyId: "root-v1",
        rootPublicKeySpki,
      })
    ).rejects.toThrow(/inventory entry/u);
    const noInventory = new Map(stable);
    noInventory.delete(INVENTORY_NAME);
    await expect(
      pullChannel({
        fetchImpl: serve({ "skill/stable": noInventory }),
        origin,
        pack: "skill",
        channel: "stable",
        rootKeyId: "root-v1",
        rootPublicKeySpki,
      })
    ).rejects.toThrow(/objects\.json is missing/u);
  });

  it("keeps earlier immutable objects across a publication and refuses a changed one", async () => {
    const first = await channelFiles(skillDir, 1);
    const target = channelDir(path.join(dir, "plan"), "skill", "stable");
    await writeChannel(target, first);
    const second = await channelFiles(skillDir, 2);
    for (const [name, bytes] of second) if (name !== INVENTORY_NAME) await writeFile(path.join(target, name), bytes);
    await writeInventory(target);
    const listed = JSON.parse(await readFile(path.join(target, INVENTORY_NAME), "utf8")).objects.map(
      (entry: { name: string }) => entry.name
    );
    for (const name of [...first.keys(), ...second.keys()].filter((name) => /^(?:e|cbe-)/u.test(name)))
      expect(listed).toContain(name);
    const firstArtifact = [...first.keys()].find((name) => name.endsWith(".zip"))!;
    await writeFile(path.join(target, firstArtifact), "changed");
    await expect(writeInventory(target)).rejects.toThrow(/missing or changed/u);
  });

  it("detects a deploy that dropped another channel's object", async () => {
    const stable = await channelFiles(skillDir, 1);
    const target = channelDir(path.join(dir, "plan"), "skill", "stable");
    await writeChannel(target, stable);
    const local = await readChannel(target);
    expect(() => assertPreserved(local!, stable, "skill/stable")).not.toThrow();
    const dropped = new Map(stable);
    dropped.delete("keyset.json");
    expect(() => assertPreserved(local!, dropped, "skill/stable")).toThrow(/keyset\.json not preserved/u);
    expect(() => assertPreserved(local!, null, "skill/stable")).toThrow(/not preserved/u);
  });
});
