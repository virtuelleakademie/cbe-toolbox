import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";
import {
  CORPUS_COMPATIBILITY_CONTRACT,
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  decodeManifest,
  extractSafeZip,
  validateCorpusInventory,
  writeUnsignedContentPack,
} from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const createdAt = new Date("2026-10-18T12:00:00Z");
const expiresAt = new Date("2027-01-16T12:00:00Z");
const sourceCommit = "a".repeat(40);

describe("signed content pack producer", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-signed-bundle-"));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("produces a reproducible one-file Skill pack and excludes references", async () => {
    const skillDir = path.join(root, "skill");
    await fs.mkdir(path.join(skillDir, "references"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
    await fs.writeFile(path.join(skillDir, "references", "ui-guide.md"), "must not ship\n");
    const options = {
      packId: "cbe-skill" as const,
      channel: "stable" as const,
      epoch: 1,
      sequence: 1,
      sourceDir: skillDir,
      sourceCommit,
      sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
      createdAt,
      expiresAt,
      compatibility: SKILL_COMPATIBILITY_CONTRACT,
      skillBodyBudget: SKILL_BODY_BUDGET,
    };
    const first = await createUnsignedContentPack(options);
    const second = await createUnsignedContentPack(options);
    expect(Buffer.from(first.artifactBytes)).toEqual(Buffer.from(second.artifactBytes));
    expect(Buffer.from(first.manifestRaw)).toEqual(Buffer.from(second.manifestRaw));
    expect(first.manifest.version).toBe("0.4.2");
    expect(first.manifest.source.repository).toBe(DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE);
    expect(first.manifest.contents.map((entry) => entry.path)).toEqual(["SKILL.md"]);
    const zip = await JSZip.loadAsync(first.artifactBytes);
    expect(Object.keys(zip.files)).toEqual(["SKILL.md"]);
    expect([
      ...extractSafeZip(first.artifactBytes, first.manifest.contents, {
        maxCompressedBytes: 256 * 1024,
        maxEntries: 1,
        maxFileBytes: 64 * 1024,
        maxExpandedBytes: 64 * 1024,
        maxExpansionRatio: 20,
      }).keys(),
    ]).toEqual(["SKILL.md"]);
    expect(first.manifest.artifact.name).toBe(
      `cbe-skill-e1-s1-${createHash("sha256").update(first.artifactBytes).digest("hex")}.zip`
    );
    expect(decodeManifest(first.manifestRaw, 64 * 1024)).toMatchObject({ ok: true });
  });

  it("New pack does not compile the old repository identity", async () => {
    const legacyClaim = `${["phy", "laxe"].join("")}/${["cbe", "toolbox"].join("-")}`;
    const implementation = await Promise.all([
      fs.readFile(path.join(repoRoot, "packages/corpus-schema/src/signed-pack.ts"), "utf8"),
      fs.readFile(path.join(repoRoot, "packages/corpus-schema/src/signed-bundle.ts"), "utf8"),
    ]);
    expect(implementation.join("\n")).not.toContain(legacyClaim);
  });

  it("produces exactly index.json plus indexed Markdown for corpus 2026-12", async () => {
    const options = {
      packId: "cbe-corpus" as const,
      channel: "stable" as const,
      epoch: 1,
      sequence: 1,
      sourceDir: path.join(repoRoot, "corpus"),
      sourceCommit,
      sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
      createdAt,
      expiresAt,
      compatibility: CORPUS_COMPATIBILITY_CONTRACT,
    };
    const first = await createUnsignedContentPack(options);
    const second = await createUnsignedContentPack(options);
    expect(first.manifest.version).toBe("2026-12");
    expect(Buffer.from(first.artifactBytes)).toEqual(Buffer.from(second.artifactBytes));
    expect(Buffer.from(first.manifestRaw)).toEqual(Buffer.from(second.manifestRaw));
    expect(first.manifest.contents).toHaveLength(26);
    expect(first.manifest.contents.filter((entry) => entry.path.startsWith("content/case-study/"))).toHaveLength(11);
    expect(first.manifest.contents[0]?.path.startsWith("content/")).toBe(true);
    expect(first.manifest.contents.at(-1)?.path).toBe("index.json");
    const zip = await JSZip.loadAsync(first.artifactBytes);
    expect(Object.keys(zip.files).sort()).toEqual(first.manifest.contents.map((entry) => entry.path).sort());
    expect(
      extractSafeZip(first.artifactBytes, first.manifest.contents, {
        maxCompressedBytes: 1024 * 1024,
        maxEntries: 256,
        maxFileBytes: 512 * 1024,
        maxExpandedBytes: 4 * 1024 * 1024,
        maxExpansionRatio: 50,
      }).size
    ).toBe(26);
    expect(Object.keys(zip.files)).not.toContain("CHANGELOG.md");
  });

  it("Producer refuses stale dirty or incomplete release input", async () => {
    const skillDir = path.join(root, "refusal-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
    const options = {
      packId: "cbe-skill" as const,
      channel: "stable" as const,
      epoch: 1,
      sequence: 3,
      sourceDir: skillDir,
      sourceCommit,
      sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
      createdAt,
      expiresAt,
      compatibility: SKILL_COMPATIBILITY_CONTRACT,
      skillBodyBudget: SKILL_BODY_BUDGET,
    };
    const pack = await createUnsignedContentPack(options);
    const out = path.join(root, "immutable-output");
    await writeUnsignedContentPack(pack, out);
    await expect(writeUnsignedContentPack(pack, out)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(createUnsignedContentPack({ ...options, sourceCommit: "not-a-commit" })).rejects.toThrow(/commit/);
    await expect(
      createUnsignedContentPack({ ...options, sourceProvenance: "https://example.org/product" })
    ).rejects.toThrow(/provenance/);
    await expect(
      createUnsignedContentPack({ ...options, expiresAt: new Date("2028-01-01T00:00:00Z") })
    ).rejects.toThrow(/90 days/);
  });

  it("refuses wrong compatibility, over-budget Skill and inconsistent corpus inventory", async () => {
    await expect(
      createUnsignedContentPack({
        packId: "cbe-corpus",
        channel: "stable",
        epoch: 1,
        sequence: 1,
        sourceDir: path.join(repoRoot, "corpus"),
        sourceCommit,
        sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
        createdAt,
        expiresAt,
        compatibility: { corpusSchema: "wrong", indexContractSha256: "0".repeat(64) },
      })
    ).rejects.toThrow(/compatibility/);

    const skillDir = path.join(root, "over-budget");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: cbe\nversion: 0.4.2\n---\n\nBody\n");
    await expect(
      createUnsignedContentPack({
        packId: "cbe-skill",
        channel: "stable",
        epoch: 1,
        sequence: 1,
        sourceDir: skillDir,
        sourceCommit,
        createdAt,
        expiresAt,
        compatibility: SKILL_COMPATIBILITY_CONTRACT,
        sourceProvenance: DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
        skillBodyBudget: 4,
      })
    ).rejects.toThrow(/budget/);

    const corpusCopy = path.join(root, "corpus-copy");
    await fs.cp(path.join(repoRoot, "corpus"), corpusCopy, { recursive: true });
    await fs.writeFile(path.join(corpusCopy, "content", "extra.md"), "unexpected\n");
    await expect(validateCorpusInventory(corpusCopy, { allowSourceDocumentation: true })).rejects.toThrow(
      /unsafe-entry|inventory/
    );
  });
});
