import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { validateDirectory } from "./validate.js";

/**
 * Versioned corpus bundle generator (capability `distribution`, Requirement:
 * Corpus Distribution as Downloadable Bundle). Packs the full corpus tree
 * (index.json + content/**) into `v<corpus-version>.zip` and writes a
 * `latest.json` pointer carrying version + SHA256, so the app can check for
 * updates cheaply and verify integrity before unpacking.
 */

export interface CorpusPointer {
  version: string;
  file: string;
  sha256: string;
  size: number;
  generated: string;
}

export interface BundleResult extends CorpusPointer {
  outDir: string;
  fileCount: number;
}

// Fixed entry timestamp so the same corpus content always zips to the same
// bytes (and the same SHA256) regardless of checkout mtimes.
const ZIP_EPOCH = new Date(Date.UTC(2000, 0, 1));

async function collectTree(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectTree(root, full)));
    else if (entry.isFile()) out.push(path.relative(root, full));
  }
  return out;
}

// The bundle carries exactly what the app consumes: the manifest, the atom
// tree, and top-level docs (CHANGELOG, curation guidelines). Sibling build
// output or stray directories in the corpus root never leak into the archive.
async function collectFiles(corpusDir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(corpusDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile()) out.push(entry.name);
    else if (entry.isDirectory() && entry.name === "content") {
      out.push(...(await collectTree(corpusDir, path.join(corpusDir, entry.name))));
    }
  }
  return out.sort();
}

export async function createCorpusBundle(
  corpusDir: string,
  outDir: string,
  opts?: { now?: Date }
): Promise<BundleResult> {
  const indexRaw = await readFile(path.join(corpusDir, "index.json"), "utf8");
  const version = (JSON.parse(indexRaw) as { "corpus-version"?: string })["corpus-version"];
  if (!version) throw new Error(`${corpusDir}/index.json carries no "corpus-version" — regenerate the index first`);

  // Never publish an invalid corpus: the bundle is what the app unpacks and
  // feeds the skill's retrieval pipeline.
  const results = await validateDirectory(path.join(corpusDir, "content"), "corpus");
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    throw new Error(`corpus validation failed for ${failures.length} file(s) — fix before bundling`);
  }

  const files = await collectFiles(corpusDir);
  const zip = new JSZip();
  for (const rel of files) {
    zip.file(rel.split(path.sep).join("/"), await readFile(path.join(corpusDir, rel)), { date: ZIP_EPOCH });
  }
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    // Stable ordering + fixed platform metadata for reproducible archives.
    platform: "UNIX",
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const file = `v${version}.zip`;
  const pointer: CorpusPointer = {
    version,
    file,
    sha256,
    size: buffer.length,
    generated: (opts?.now ?? new Date()).toISOString().slice(0, 10),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, file), buffer);
  await writeFile(path.join(outDir, "latest.json"), JSON.stringify(pointer, null, 2) + "\n");
  return { ...pointer, outDir, fileCount: files.length };
}
