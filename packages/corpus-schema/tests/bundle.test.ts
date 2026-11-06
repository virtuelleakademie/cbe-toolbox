import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import JSZip from "jszip";
import { generateIndex } from "../src/index-gen.js";
import { createCorpusBundle, type CorpusPointer } from "../src/bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesIndex = path.join(__dirname, "fixtures-index");

// Distribution spec, Requirement: Corpus Distribution as Downloadable Bundle —
// the CDN serves `corpus/v<version>.zip` plus a `latest.json` pointer with the
// latest version and its SHA256.
describe("createCorpusBundle", () => {
  let corpusRoot: string;
  let outDir: string;
  let version: string;

  beforeAll(async () => {
    corpusRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-bundle-corpus-"));
    outDir = path.join(corpusRoot, "out");
    await fs.cp(fixturesIndex, path.join(corpusRoot, "content"), { recursive: true });
    const idx = await generateIndex(path.join(corpusRoot, "content"), path.join(corpusRoot, "index.json"));
    version = idx["corpus-version"];
  });

  afterAll(async () => {
    await fs.rm(corpusRoot, { recursive: true, force: true });
  });

  it("writes v<version>.zip containing the full corpus tree plus index.json", async () => {
    const res = await createCorpusBundle(corpusRoot, outDir);
    expect(res.file).toBe(`v${version}.zip`);

    const zipBytes = await fs.readFile(path.join(outDir, res.file));
    const zip = await JSZip.loadAsync(zipBytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain("index.json");
    expect(names.some((n) => n.startsWith("content/foundations/"))).toBe(true);
    // Everything the index references is inside the archive.
    const idx = JSON.parse(await zip.files["index.json"].async("string")) as {
      documents: Array<{ path: string }>;
    };
    for (const doc of idx.documents) expect(names).toContain(doc.path);
  });

  it("publishes a latest.json pointer whose SHA256 matches the zip bytes", async () => {
    const res = await createCorpusBundle(corpusRoot, outDir);
    const pointer = JSON.parse(await fs.readFile(path.join(outDir, "latest.json"), "utf8")) as CorpusPointer;
    expect(pointer.version).toBe(version);
    expect(pointer.file).toBe(res.file);
    const zipBytes = await fs.readFile(path.join(outDir, pointer.file));
    expect(createHash("sha256").update(zipBytes).digest("hex")).toBe(pointer.sha256);
    expect(pointer.size).toBe(zipBytes.length);
  });

  it("is reproducible — same content bundles to the same SHA256", async () => {
    const a = await createCorpusBundle(corpusRoot, outDir);
    const b = await createCorpusBundle(corpusRoot, outDir);
    expect(a.sha256).toBe(b.sha256);
  });

  it("refuses to bundle a corpus that fails schema validation", async () => {
    const broken = await fs.mkdtemp(path.join(os.tmpdir(), "cbe-bundle-broken-"));
    try {
      await fs.cp(corpusRoot, broken, { recursive: true, filter: (src) => !src.includes(`${path.sep}out`) });
      await fs.writeFile(path.join(broken, "content", "foundations", "invalid.md"), "---\nid: nope\n---\nbody\n");
      await expect(createCorpusBundle(broken, path.join(broken, "out"))).rejects.toThrow(/validation failed/);
    } finally {
      await fs.rm(broken, { recursive: true, force: true });
    }
  });
});
