import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  keysetBytes,
  publicKeySpkiBase64,
  signatureWrapperBytes,
  signedWrapper,
  type ContentPackKeyset,
} from "@cbe/corpus-schema";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import { skillContentPackPolicy } from "../src/main/content-pack-policy.js";
import { selectContentPackSync, type ContentPackPaths } from "../src/main/content-pack-store.js";
import { refreshContentPack } from "../src/main/content-pack-updater.js";
import { emulateWindowsFlush, resetFlushSemantics } from "./helpers/windows-flush-semantics.js";

vi.mock("node:fs/promises", async (importOriginal) =>
  (await import("./helpers/windows-flush-semantics.js")).mockFsPromises(
    await importOriginal<typeof import("node:fs/promises")>()
  )
);

const baseUrl = "https://portal.example/delivery/v2/skill/stable/";
const createdAt = new Date("2026-10-18T12:00:00Z");
const expiresAt = new Date("2027-01-16T12:00:00Z");
const now = new Date("2026-10-20T12:00:00Z");
const appBuildTime = new Date("2026-10-18T00:00:00Z");

async function signedFixture(
  skillDir: string,
  overrides?: { manifest?: (manifest: Awaited<ReturnType<typeof createUnsignedContentPack>>["manifest"]) => void }
) {
  const root = generateKeyPairSync("ed25519");
  const target = generateKeyPairSync("ed25519");
  const pack = await createUnsignedContentPack({
    packId: "cbe-skill",
    channel: "stable",
    epoch: 1,
    sequence: 1,
    sourceDir: skillDir,
    sourceCommit: "a".repeat(40),
    sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
    createdAt,
    expiresAt,
    compatibility: SKILL_COMPATIBILITY_CONTRACT,
    skillBodyBudget: SKILL_BODY_BUDGET,
  });
  overrides?.manifest?.(pack.manifest);
  // Re-encode after an intentional negative mutation.
  const { manifestBytes } = await import("@cbe/corpus-schema");
  pack.manifestRaw = manifestBytes(pack.manifest);
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
  return {
    rootPublicKeySpki: publicKeySpkiBase64(root.publicKey),
    pack,
    routes: {
      [`${baseUrl}keyset.json`]: keysetRaw,
      [`${baseUrl}keyset.sig`]: signatureWrapperBytes(signedWrapper(keysetRaw, "root-v1", root.privateKey)),
      [`${baseUrl}latest.json`]: pack.manifestRaw,
      [`${baseUrl}latest.sig`]: signatureWrapperBytes(
        signedWrapper(pack.manifestRaw, "skill-stable-1", target.privateKey)
      ),
      [`${baseUrl}${pack.manifest.artifact.name}`]: pack.artifactBytes,
    } satisfies Record<string, Uint8Array>,
  };
}

function fetchRoutes(
  routes: Record<string, Uint8Array>,
  requests: Array<{ url: string; init?: RequestInit }>,
  overrides?: Record<string, Response>
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (overrides?.[url]) return overrides[url];
    const body = routes[url];
    if (!body) return new Response("missing", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-length": String(body.byteLength) } });
  }) as typeof fetch;
}

describe("signed content pack updater", () => {
  let rootDir: string;
  let skillDir: string;
  let paths: ContentPackPaths;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "cbe-signed-updater-"));
    skillDir = path.join(rootDir, "skill-source");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
    paths = {
      trustDir: path.join(rootDir, "trust"),
      packsDir: path.join(rootDir, "packs"),
      bundledDir: skillDir,
    };
  });

  afterEach(async () => {
    resetFlushSemantics();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("activates the signed Skill under Windows flush semantics instead of reporting unavailable", async () => {
    // Windows `FlushFileBuffers` refuses a read-only handle with EPERM; before the
    // slot flush opened a write-capable handle this refresh reported
    // { status: "unavailable", code: "install-failed" } on Windows.
    emulateWindowsFlush(true);
    const fixture = await signedFixture(skillDir);
    const result = await refreshContentPack({
      policy: skillContentPackPolicy({
        baseUrl,
        rootKeyId: "root-v1",
        rootPublicKeySpki: fixture.rootPublicKeySpki,
      }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      now: () => now,
      fetchImpl: fetchRoutes(fixture.routes, []),
    });
    expect(result).toMatchObject({ status: "updated", identity: { version: "0.4.2", sequence: 1 } });
    expect(
      selectContentPackSync({ paths, packId: "cbe-skill", channel: "stable", markerFile: "SKILL.md" }).source
    ).toBe("downloaded");
  });

  it("verifies metadata before credential-free artifact fetch and activates an immutable slot", async () => {
    const fixture = await signedFixture(skillDir);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await refreshContentPack({
      policy: skillContentPackPolicy({
        baseUrl,
        rootKeyId: "root-v1",
        rootPublicKeySpki: fixture.rootPublicKeySpki,
      }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      now: () => now,
      fetchImpl: fetchRoutes(fixture.routes, requests),
    });
    expect(result).toMatchObject({ status: "updated", identity: { version: "0.4.2", sequence: 1 } });
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}keyset.json`,
      `${baseUrl}keyset.sig`,
      `${baseUrl}latest.json`,
      `${baseUrl}latest.sig`,
      `${baseUrl}${fixture.pack.manifest.artifact.name}`,
    ]);
    for (const request of requests) {
      expect(request.init).toMatchObject({ redirect: "manual", credentials: "omit", headers: {} });
    }
    expect(
      selectContentPackSync({ paths, packId: "cbe-skill", channel: "stable", markerFile: "SKILL.md" }).source
    ).toBe("downloaded");
  });

  it("serialises concurrent refreshes of one pack so the second sees the first's floor", async () => {
    const fixture = await signedFixture(skillDir);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const routes = fetchRoutes(fixture.routes, requests);
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await routes(input, init);
      } finally {
        inFlight -= 1;
      }
    }) as typeof fetch;
    const options = {
      policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      now: () => now,
      fetchImpl,
    };
    const [first, second] = await Promise.all([refreshContentPack(options), refreshContentPack(options)]);
    expect(first).toMatchObject({ status: "updated" });
    expect(second).toMatchObject({ status: "up-to-date", sequence: 1 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(requests.filter((request) => request.url.endsWith(".zip"))).toHaveLength(1);
  });

  it.each([
    ["appRange", ">=9.0.0 <10.0.0"],
    ["modelSurfaceAbi", "wrong/9"],
    ["toolContractSha256", "f".repeat(64)],
    ["testedPiVersion", "9.9.9"],
  ] as const)("Any compatibility mismatch refuses before artifact download: %s", async (field, value) => {
    const fixture = await signedFixture(skillDir, {
      manifest: (manifest) => {
        (manifest.compatibility as unknown as Record<string, string>)[field] = value;
      },
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await refreshContentPack({
      policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      now: () => now,
      fetchImpl: fetchRoutes(fixture.routes, requests),
    });
    expect(result).toEqual({ status: "refused", code: "compatibility-mismatch", field });
    expect(requests).toHaveLength(4);
  });

  it.each([
    "https://evil.example/payload.zip",
    "//evil.example/payload.zip",
    "../payload.zip",
    "payload.zip?x=1",
    "payload%2fchild.zip",
  ])("refuses ambiguous signed artifact name %s without requesting it", async (name) => {
    const fixture = await signedFixture(skillDir, {
      manifest: (manifest) => {
        manifest.artifact.name = name;
      },
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await refreshContentPack({
      policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      now: () => now,
      fetchImpl: fetchRoutes(fixture.routes, requests),
    });
    expect(result).toMatchObject({ status: "refused", code: "metadata-schema-invalid" });
    expect(requests).toHaveLength(4);
  });

  it("refuses redirects and one-byte-over bodies", async () => {
    const fixture = await signedFixture(skillDir);
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const redirect = new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    expect(
      await refreshContentPack({
        policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
        paths,
        installedAppVersion: "0.1.23",
        appBuildTime,
        now: () => now,
        fetchImpl: fetchRoutes(fixture.routes, requests, { [`${baseUrl}latest.json`]: redirect }),
      })
    ).toMatchObject({ status: "unavailable", code: "redirect-refused" });

    const exactBoundary = new Response(Buffer.alloc(64 * 1024, 0x20), { status: 200 });
    expect(
      await refreshContentPack({
        policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
        paths,
        installedAppVersion: "0.1.23",
        appBuildTime,
        now: () => now,
        fetchImpl: fetchRoutes(fixture.routes, [], { [`${baseUrl}latest.json`]: exactBoundary }),
      })
    ).toMatchObject({ status: "refused", code: "signature-invalid" });

    const oversized = new Response(Buffer.alloc(64 * 1024 + 1), { status: 200 });
    expect(
      await refreshContentPack({
        policy: skillContentPackPolicy({ baseUrl, rootKeyId: "root-v1", rootPublicKeySpki: fixture.rootPublicKeySpki }),
        paths,
        installedAppVersion: "0.1.23",
        appBuildTime,
        now: () => now,
        fetchImpl: fetchRoutes(fixture.routes, [], { [`${baseUrl}latest.json`]: oversized }),
      })
    ).toMatchObject({ status: "unavailable", code: "metadata-too-large" });
  });

  it("keeps local selection immediate while a startup refresh is unresolved", async () => {
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const update = refreshContentPack({
      policy: skillContentPackPolicy({
        baseUrl,
        rootKeyId: "root-v1",
        rootPublicKeySpki: publicKeySpkiBase64(generateKeyPairSync("ed25519").publicKey),
      }),
      paths,
      installedAppVersion: "0.1.23",
      appBuildTime,
      fetchImpl: (() => pending) as typeof fetch,
    });
    expect(selectContentPackSync({ paths, packId: "cbe-skill", channel: "stable", markerFile: "SKILL.md" }).dir).toBe(
      paths.bundledDir
    );
    resolveFetch(new Response("offline", { status: 503 }));
    await expect(update).resolves.toMatchObject({ status: "unavailable" });
  });
});
