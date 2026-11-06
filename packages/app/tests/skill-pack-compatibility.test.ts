import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { SKILL_BASE_APP_VERSION, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import { refreshSkill, skillInfo, type SkillUpdaterPaths } from "../src/main/skill-updater.js";

const POINTER_URL = "https://portal.example/delivery/skill/latest.json";
const APP_VERSION = SKILL_BASE_APP_VERSION;

function skillMd(version: string): string {
  return `---\nname: cbe\nversion: ${version}\n---\n\nBody ${version}\n`;
}

async function bundle(version: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("SKILL.md", skillMd(version));
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pointer(version: string, bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    version,
    file: `v${version}.zip`,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    generated: "2026-10-28",
    ...SKILL_COMPATIBILITY_CONTRACT,
    ...overrides,
  };
}

function fetchFor(rawPointer: string, bytes: Uint8Array, onArtifact: () => void): typeof fetch {
  return (async (input: string | URL | Request) => {
    if (String(input) === POINTER_URL) {
      return { ok: true, status: 200, text: async () => rawPointer } as Response;
    }
    onArtifact();
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as Response;
  }) as typeof fetch;
}

describe("Hash-Era Skill Pointer Compatibility Gate", () => {
  let root: string;
  let paths: SkillUpdaterPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cbe-skill-compatibility-"));
    const bundledDir = path.join(root, "bundled");
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, "SKILL.md"), skillMd("0.4.1"));
    paths = { cacheRoot: path.join(root, "cache"), bundledDir };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("Compatible metadata permits the existing update path", async () => {
    const bytes = await bundle("0.4.2");
    let artifactRequests = 0;
    const result = await refreshSkill({
      paths,
      pointerUrl: POINTER_URL,
      installedAppVersion: APP_VERSION,
      fetchImpl: fetchFor(JSON.stringify(pointer("0.4.2", bytes)), bytes, () => (artifactRequests += 1)),
    });

    expect(result).toEqual({ status: "updated", version: "0.4.2" });
    expect(artifactRequests).toBe(1);
    expect(await skillInfo(paths)).toMatchObject({ version: "0.4.2", source: "downloaded" });
  });

  for (const testCase of [
    { name: "unsupported app range", field: "appRange", value: ">=0.2.0 <0.3.0" },
    { name: "ABI mismatch", field: "modelSurfaceAbi", value: "cbe-skill/999" },
    { name: "changed tool contract", field: "toolContractSha256", value: "0".repeat(64) },
    { name: "Pi mismatch", field: "testedPiVersion", value: "1.3.1" },
  ] as const) {
    it(`Each compatibility mismatch refuses before artifact request: ${testCase.name}`, async () => {
      const bytes = await bundle("0.4.2");
      let artifactRequests = 0;
      const result = await refreshSkill({
        paths,
        pointerUrl: POINTER_URL,
        installedAppVersion: APP_VERSION,
        fetchImpl: fetchFor(
          JSON.stringify(pointer("0.4.2", bytes, { [testCase.field]: testCase.value })),
          bytes,
          () => (artifactRequests += 1)
        ),
      });

      expect(result).toEqual({ status: "compatibility-mismatch", field: testCase.field });
      expect(artifactRequests).toBe(0);
      expect(await skillInfo(paths)).toEqual({ version: "0.4.1", cacheDate: null, source: "bundled" });
    });
  }

  const metadataCases: Array<{
    name: string;
    raw: (base: Record<string, unknown>) => string;
    expected: { reason: string; field?: string };
  }> = [
    {
      name: "missing field",
      raw: (base) => {
        delete base.appRange;
        return JSON.stringify(base);
      },
      expected: { reason: "missing-field", field: "appRange" },
    },
    {
      name: "unknown field",
      raw: (base) => JSON.stringify({ ...base, futureCompatibility: 1 }),
      expected: { reason: "unknown-field", field: "futureCompatibility" },
    },
    {
      name: "duplicate field",
      raw: (base) =>
        JSON.stringify(base).replace(
          `"appRange":"${SKILL_COMPATIBILITY_CONTRACT.appRange}"`,
          `"appRange":"${SKILL_COMPATIBILITY_CONTRACT.appRange}","appRange":"${SKILL_COMPATIBILITY_CONTRACT.appRange}"`
        ),
      expected: { reason: "duplicate-field", field: "appRange" },
    },
    {
      name: "malformed JSON",
      raw: (base) => JSON.stringify(base).slice(0, -1),
      expected: { reason: "malformed-json" },
    },
    {
      name: "wrong field type",
      raw: (base) => JSON.stringify({ ...base, size: "123" }),
      expected: { reason: "field-malformed", field: "size" },
    },
    {
      name: "malformed app range",
      raw: (base) => JSON.stringify({ ...base, appRange: " definitely 0.1.18 " }),
      expected: { reason: "field-malformed", field: "appRange" },
    },
    {
      name: "noncanonical app range",
      raw: (base) => JSON.stringify({ ...base, appRange: "^0.1.18" }),
      expected: { reason: "field-malformed", field: "appRange" },
    },
    {
      name: "malformed ABI",
      raw: (base) => JSON.stringify({ ...base, modelSurfaceAbi: "CBE skill ABI" }),
      expected: { reason: "field-malformed", field: "modelSurfaceAbi" },
    },
    {
      name: "malformed tool hash",
      raw: (base) => JSON.stringify({ ...base, toolContractSha256: "ABC" }),
      expected: { reason: "field-malformed", field: "toolContractSha256" },
    },
    {
      name: "malformed Pi version",
      raw: (base) => JSON.stringify({ ...base, testedPiVersion: "v1.3" }),
      expected: { reason: "field-malformed", field: "testedPiVersion" },
    },
    {
      name: "oversized pointer",
      raw: (base) => `${JSON.stringify(base)}${" ".repeat(20_000)}`,
      expected: { reason: "too-large" },
    },
  ];

  for (const testCase of metadataCases) {
    it(`Strict metadata rejects missing unknown duplicate or malformed fields: ${testCase.name}`, async () => {
      const bytes = await bundle("0.4.2");
      let artifactRequests = 0;
      const base = pointer("0.4.2", bytes) as Record<string, unknown>;
      const result = await refreshSkill({
        paths,
        pointerUrl: POINTER_URL,
        installedAppVersion: APP_VERSION,
        fetchImpl: fetchFor(testCase.raw(base), bytes, () => (artifactRequests += 1)),
      });

      expect(result).toMatchObject({ status: "metadata-invalid", ...testCase.expected });
      expect(artifactRequests).toBe(0);
      expect(await skillInfo(paths)).toEqual({ version: "0.4.1", cacheDate: null, source: "bundled" });
    });
  }

  it("Compatibility refusal keeps a previously downloaded active Skill", async () => {
    const accepted = await bundle("0.4.2");
    await refreshSkill({
      paths,
      pointerUrl: POINTER_URL,
      installedAppVersion: APP_VERSION,
      fetchImpl: fetchFor(JSON.stringify(pointer("0.4.2", accepted)), accepted, () => {}),
    });

    const refused = await bundle("0.4.3");
    let artifactRequests = 0;
    const result = await refreshSkill({
      paths,
      pointerUrl: POINTER_URL,
      installedAppVersion: APP_VERSION,
      fetchImpl: fetchFor(
        JSON.stringify(pointer("0.4.3", refused, { testedPiVersion: "1.4.0" })),
        refused,
        () => (artifactRequests += 1)
      ),
    });

    expect(result).toEqual({ status: "compatibility-mismatch", field: "testedPiVersion" });
    expect(artifactRequests).toBe(0);
    expect(await skillInfo(paths)).toMatchObject({ version: "0.4.2", source: "downloaded" });
  });
});
