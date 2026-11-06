import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORPUS_COMPATIBILITY_CONTRACT,
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  keysetBytes,
  manifestBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  type ContentPackKeyset,
} from "@cbe/corpus-schema";
import { corpusContentPackPolicy } from "../src/main/content-pack-policy.js";
import { selectContentPackSync, type ContentPackPaths } from "../src/main/content-pack-store.js";
import { refreshContentPack } from "../src/main/content-pack-updater.js";
import { emulateWindowsFlush, resetFlushSemantics } from "./helpers/windows-flush-semantics.js";

vi.mock("node:fs/promises", async (importOriginal) =>
  (await import("./helpers/windows-flush-semantics.js")).mockFsPromises(
    await importOriginal<typeof import("node:fs/promises")>()
  )
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baseUrl = "https://portal.example/delivery/v2/corpus/stable/";
const now = new Date("2026-10-20T12:00:00Z");
const buildTime = new Date("2026-10-18T00:00:00Z");

function responseFetch(routes: Record<string, Uint8Array>, requested: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = routes[url];
    return body
      ? new Response(body, { status: 200, headers: { "content-length": String(body.byteLength) } })
      : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

async function fixture(compatibilityOverride?: { corpusSchema: string; indexContractSha256: string }) {
  const root = generateKeyPairSync("ed25519");
  const target = generateKeyPairSync("ed25519");
  const pack = await createUnsignedContentPack({
    packId: "cbe-corpus",
    channel: "stable",
    epoch: 1,
    sequence: 1,
    sourceDir: path.join(repoRoot, "corpus"),
    sourceCommit: "a".repeat(40),
    sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
    createdAt: new Date("2026-10-18T12:00:00Z"),
    expiresAt: new Date("2027-01-16T12:00:00Z"),
    compatibility: CORPUS_COMPATIBILITY_CONTRACT,
  });
  if (compatibilityOverride) {
    pack.manifest.compatibility = compatibilityOverride;
    pack.manifestRaw = manifestBytes(pack.manifest);
  }
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
  const keysetRaw = keysetBytes(keyset);
  return {
    root: publicKeySpkiBase64(root.publicKey),
    artifactName: pack.manifest.artifact.name,
    routes: {
      [`${baseUrl}keyset.json`]: keysetRaw,
      [`${baseUrl}keyset.sig`]: signatureWrapperBytes(signedWrapper(keysetRaw, "root-v1", root.privateKey)),
      [`${baseUrl}latest.json`]: pack.manifestRaw,
      [`${baseUrl}latest.sig`]: signatureWrapperBytes(
        signedWrapper(pack.manifestRaw, "corpus-stable-1", target.privateKey)
      ),
      [`${baseUrl}${pack.manifest.artifact.name}`]: pack.artifactBytes,
    },
  };
}

describe("signed corpus updater", () => {
  let rootDir: string;
  let paths: ContentPackPaths;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "cbe-signed-corpus-"));
    paths = {
      trustDir: path.join(rootDir, "trust"),
      packsDir: path.join(rootDir, "packs"),
      bundledDir: path.join(repoRoot, "corpus"),
    };
  });

  afterEach(async () => {
    resetFlushSemantics();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("activates the signed corpus under Windows flush semantics instead of reporting unavailable", async () => {
    // Windows `FlushFileBuffers` refuses a read-only handle with EPERM; before the
    // slot flush opened a write-capable handle this refresh reported
    // { status: "unavailable", code: "install-failed" } on Windows.
    emulateWindowsFlush(true);
    const signed = await fixture();
    const result = await refreshContentPack({
      policy: corpusContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: signed.root }),
      paths,
      installedAppVersion: "0.1.18",
      appBuildTime: buildTime,
      now: () => now,
      fetchImpl: responseFetch(signed.routes, []),
    });
    expect(result).toMatchObject({ status: "updated", identity: { version: "2026-11" } });
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).source
    ).toBe("downloaded");
  });

  it("validates exact index inventory and activates corpus 2026-11", async () => {
    const signed = await fixture();
    const requested: string[] = [];
    const result = await refreshContentPack({
      policy: corpusContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: signed.root }),
      paths,
      installedAppVersion: "0.1.18",
      appBuildTime: buildTime,
      now: () => now,
      fetchImpl: responseFetch(signed.routes, requested),
    });
    expect(result).toMatchObject({ status: "updated", identity: { version: "2026-11" } });
    expect(requested.at(-1)).toBe(`${baseUrl}${signed.artifactName}`);
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).source
    ).toBe("downloaded");
  });

  it.each([
    [
      "corpusSchema",
      { corpusSchema: "cbe-corpus/2", indexContractSha256: CORPUS_COMPATIBILITY_CONTRACT.indexContractSha256 },
    ],
    [
      "indexContractSha256",
      { corpusSchema: CORPUS_COMPATIBILITY_CONTRACT.corpusSchema, indexContractSha256: "f".repeat(64) },
    ],
  ] as const)("Corpus compatibility is checked before artifact download: %s", async (field, compatibility) => {
    const signed = await fixture(compatibility);
    const requested: string[] = [];
    const result = await refreshContentPack({
      policy: corpusContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: signed.root }),
      paths,
      installedAppVersion: "0.1.18",
      appBuildTime: buildTime,
      now: () => now,
      fetchImpl: responseFetch(signed.routes, requested),
    });
    expect(result).toEqual({ status: "refused", code: "compatibility-mismatch", field });
    expect(requested).toHaveLength(4);
  });
});
