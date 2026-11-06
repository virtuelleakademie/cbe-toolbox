import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { SKILL_BASE_APP_VERSION, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import { activeSkillDir, skillInfo, refreshSkill, type SkillUpdaterPaths } from "../src/main/skill-updater";

function skillMd(version: string): string {
  return `---\nname: cbe\nversion: ${version}\n---\n\n## Purpose\n\nBody for ${version}\n`;
}

async function makeSkillBundle(version: string, extra?: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("SKILL.md", skillMd(version));
  zip.file("references/ui-guide.md", `Guide for ${version}\n`);
  for (const [name, body] of Object.entries(extra ?? {})) zip.file(name, body);
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pointer(version: string, bundle: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    version,
    file: `v${version}.zip`,
    sha256: sha256(bundle),
    size: bundle.byteLength,
    generated: "2026-10-28",
    ...SKILL_COMPATIBILITY_CONTRACT,
    ...overrides,
  };
}

function fakeFetch(routes: Record<string, { status?: number; body: Uint8Array | object | string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return { ok: false, status: 404 } as Response;
    const body = route.body;
    return {
      ok: (route.status ?? 200) < 300,
      status: route.status ?? 200,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      arrayBuffer: async () => {
        const bytes = body as Uint8Array;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    } as Response;
  }) as typeof fetch;
}

const POINTER_URL = "https://portal.example/delivery/skill/latest.json";
const APP_VERSION = SKILL_BASE_APP_VERSION;

function refresh(paths: SkillUpdaterPaths, fetchImpl: typeof fetch, now?: () => Date) {
  return refreshSkill({ paths, pointerUrl: POINTER_URL, installedAppVersion: APP_VERSION, fetchImpl, now });
}

describe("skill bundle updater", () => {
  let root: string;
  let paths: SkillUpdaterPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cbe-skill-updater-"));
    const bundledDir = path.join(root, "bundled");
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, "SKILL.md"), skillMd("0.3.0"));
    paths = { cacheRoot: path.join(root, "cache"), bundledDir };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("adopts a verified compatible newer bundle for new sessions and leaves the bundled copy untouched", async () => {
    const bundle = await makeSkillBundle("0.4.0");
    const bundleUrl = new URL("v0.4.0.zip", POINTER_URL).toString();
    const before = activeSkillDir(paths);

    const result = await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.4.0", bundle) },
        [bundleUrl]: { body: bundle },
      }),
      () => new Date("2026-08-25T12:00:00Z")
    );

    expect(result).toEqual({ status: "updated", version: "0.4.0" });
    expect(await skillInfo(paths)).toEqual({
      version: "0.4.0",
      cacheDate: "2026-08-25T12:00:00.000Z",
      source: "downloaded",
    });
    expect(await readFile(path.join(before, "SKILL.md"), "utf8")).toContain("version: 0.3.0");
  });

  it("reports up-to-date without downloading when the pointer matches the active version", async () => {
    const bundle = await makeSkillBundle("0.3.0");
    let artifactRequests = 0;
    const result = await refresh(paths, (async (input: string | URL | Request) => {
      if (String(input) === POINTER_URL) {
        return { ok: true, status: 200, text: async () => JSON.stringify(pointer("0.3.0", bundle)) } as Response;
      }
      artifactRequests += 1;
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch);
    expect(result).toEqual({ status: "up-to-date", version: "0.3.0" });
    expect(artifactRequests).toBe(0);
  });

  it("refuses an older pointer version as up-to-date and never downloads it", async () => {
    const bundle = await makeSkillBundle("0.2.0");
    let artifactRequests = 0;
    const result = await refresh(paths, (async (input: string | URL | Request) => {
      if (String(input) === POINTER_URL) {
        return { ok: true, status: 200, text: async () => JSON.stringify(pointer("0.2.0", bundle)) } as Response;
      }
      artifactRequests += 1;
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch);
    expect(result).toEqual({ status: "up-to-date", version: "0.3.0" });
    expect(artifactRequests).toBe(0);
    expect(activeSkillDir(paths)).toBe(paths.bundledDir);
  });

  it("orders skill versions as semver rather than lexically", async () => {
    await writeFile(path.join(paths.bundledDir, "SKILL.md"), skillMd("0.9.0"));
    const bundle = await makeSkillBundle("0.10.0");
    const result = await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.10.0", bundle) },
        [new URL("v0.10.0.zip", POINTER_URL).toString()]: { body: bundle },
      })
    );
    expect(result).toEqual({ status: "updated", version: "0.10.0" });
  });

  it("rejects a bundle whose SHA256 does not match and keeps the active Skill", async () => {
    const bundle = await makeSkillBundle("0.4.0");
    const result = await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.4.0", bundle, { sha256: "0".repeat(64) }) },
        [new URL("v0.4.0.zip", POINTER_URL).toString()]: { body: bundle },
      })
    );

    expect(result.status).toBe("integrity-mismatch");
    expect(activeSkillDir(paths)).toBe(paths.bundledDir);
    expect(existsSync(path.join(paths.cacheRoot, "skill"))).toBe(false);
  });

  it("keeps a previously adopted Skill when a later archive is corrupt", async () => {
    const good = await makeSkillBundle("0.4.0");
    await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.4.0", good) },
        [new URL("v0.4.0.zip", POINTER_URL).toString()]: { body: good },
      })
    );

    const bad = await makeSkillBundle("0.5.0");
    const result = await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.5.0", bad, { sha256: "0".repeat(64) }) },
        [new URL("v0.5.0.zip", POINTER_URL).toString()]: { body: bad },
      })
    );

    expect(result.status).toBe("integrity-mismatch");
    expect(await skillInfo(paths)).toMatchObject({ version: "0.4.0", source: "downloaded" });
  });

  it("keeps the last adopted state when offline", async () => {
    const good = await makeSkillBundle("0.4.0");
    await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.4.0", good) },
        [new URL("v0.4.0.zip", POINTER_URL).toString()]: { body: good },
      })
    );
    const offline = (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;

    expect(await refresh(paths, offline)).toEqual({ status: "unavailable", reason: { code: "pointer-read" } });
    expect(await skillInfo(paths)).toMatchObject({ version: "0.4.0", source: "downloaded" });
  });

  it("refuses a verified bundle without top-level SKILL.md", async () => {
    const zip = new JSZip();
    zip.file("references/only.md", "no skill body");
    const broken = new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await refresh(
      paths,
      fakeFetch({
        [POINTER_URL]: { body: pointer("0.4.0", broken) },
        [new URL("v0.4.0.zip", POINTER_URL).toString()]: { body: broken },
      })
    );

    expect(result).toEqual({ status: "unavailable", reason: { code: "missing-marker", markerFile: "SKILL.md" } });
    expect(await skillInfo(paths)).toEqual({ version: "0.3.0", cacheDate: null, source: "bundled" });
  });
});
