import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import JSZip from "jszip";
import { CORPUS_COMPATIBILITY_CONTRACT, validateCorpusInventory } from "./corpus-compatibility.js";
import {
  compareContentPaths,
  manifestBytes,
  validContentPackProductProvenance,
  signatureWrapperBytes,
  type ContentPackChannel,
  type ContentPackEntry,
  type ContentPackId,
  type ContentPackManifest,
  type CorpusPackCompatibility,
  type SignatureWrapper,
  type SkillPackCompatibility,
} from "./signed-pack.js";

const ZIP_EPOCH = new Date(Date.UTC(2000, 0, 1));
const SHA256 = /^[a-f0-9]{40}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export interface UnsignedContentPack {
  manifest: ContentPackManifest;
  manifestRaw: Uint8Array;
  artifactBytes: Uint8Array;
  files: Array<{ path: string; bytes: Uint8Array }>;
}

export interface ContentPackProducerOptions {
  packId: ContentPackId;
  channel: ContentPackChannel;
  epoch: number;
  sequence: number;
  sourceDir: string;
  sourceCommit: string;
  sourceProvenance: string;
  createdAt: Date;
  expiresAt: Date;
  compatibility: SkillPackCompatibility | CorpusPackCompatibility;
  skillBodyBudget?: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function timestamp(value: Date): string {
  const canonical = value.toISOString().replace(/\.\d{3}Z$/u, "Z");
  if (new Date(canonical).valueOf() !== value.valueOf()) throw new Error("timestamps must use whole UTC seconds");
  return canonical;
}

function assertProducerOptions(options: ContentPackProducerOptions): void {
  if (!Number.isSafeInteger(options.epoch) || options.epoch <= 0) throw new Error("epoch must be a positive integer");
  if (!Number.isSafeInteger(options.sequence) || options.sequence <= 0)
    throw new Error("sequence must be a positive integer");
  if (!SHA256.test(options.sourceCommit)) throw new Error("source commit must be 40 lowercase hex characters");
  if (!validContentPackProductProvenance(options.sourceProvenance)) {
    throw new Error("source provenance must be a bounded product identifier");
  }
  const age = options.expiresAt.valueOf() - options.createdAt.valueOf();
  if (age <= 0 || age > 90 * 24 * 60 * 60 * 1000) throw new Error("metadata lifetime must be within 90 days");
}

async function skillFiles(
  options: ContentPackProducerOptions
): Promise<{ version: string; files: UnsignedContentPack["files"] }> {
  const file = path.join(options.sourceDir, "SKILL.md");
  const bytes = await readFile(file);
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (raw.charCodeAt(0) === 0xfeff || raw.includes("\0")) throw new Error("SKILL.md must be UTF-8 without BOM or NUL");
  const parsed = matter(raw);
  if (parsed.data.name !== "cbe" || typeof parsed.data.version !== "string" || !SEMVER.test(parsed.data.version)) {
    throw new Error("SKILL.md must carry name cbe and a strict semantic version");
  }
  if (parsed.content.trim().length === 0) throw new Error("SKILL.md body must not be empty");
  if (options.skillBodyBudget === undefined || parsed.content.length >= options.skillBodyBudget) {
    throw new Error("SKILL.md body exceeds the compiled budget");
  }
  return { version: parsed.data.version, files: [{ path: "SKILL.md", bytes }] };
}

async function corpusFiles(
  options: ContentPackProducerOptions
): Promise<{ version: string; files: UnsignedContentPack["files"] }> {
  if (JSON.stringify(options.compatibility) !== JSON.stringify(CORPUS_COMPATIBILITY_CONTRACT)) {
    throw new Error("corpus compatibility must equal the compiled contract");
  }
  const inventory = await validateCorpusInventory(options.sourceDir, { allowSourceDocumentation: true });
  const files = await Promise.all(
    inventory.contents.map(async (entry) => ({
      path: entry.path,
      bytes: await readFile(path.join(options.sourceDir, entry.path)),
    }))
  );
  return { version: inventory.version, files };
}

export async function createUnsignedContentPack(options: ContentPackProducerOptions): Promise<UnsignedContentPack> {
  assertProducerOptions(options);
  const selected = options.packId === "cbe-skill" ? await skillFiles(options) : await corpusFiles(options);
  const files = [...selected.files].sort((a, b) => compareContentPaths(a.path, b.path));
  const contents: ContentPackEntry[] = files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    sha256: sha256(file.bytes),
  }));
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.bytes, { date: ZIP_EPOCH, createFolders: false });
  }
  const artifactBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
  const artifactSha256 = sha256(artifactBytes);
  const manifest: ContentPackManifest = {
    schemaVersion: 1,
    packId: options.packId,
    channel: options.channel,
    epoch: options.epoch,
    sequence: options.sequence,
    version: selected.version,
    createdAt: timestamp(options.createdAt),
    expiresAt: timestamp(options.expiresAt),
    artifact: {
      name: `${options.packId}-e${options.epoch}-s${options.sequence}-${artifactSha256}.zip`,
      size: artifactBytes.byteLength,
      sha256: artifactSha256,
    },
    contents,
    source: { repository: options.sourceProvenance, commit: options.sourceCommit },
    compatibility: { ...options.compatibility },
  };
  return { manifest, manifestRaw: manifestBytes(manifest), artifactBytes, files };
}

export async function writeUnsignedContentPack(pack: UnsignedContentPack, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, pack.manifest.artifact.name), pack.artifactBytes, { flag: "wx" });
  await writeFile(
    path.join(outDir, `e${pack.manifest.epoch}-s${pack.manifest.sequence}-${sha256(pack.manifestRaw)}.json`),
    pack.manifestRaw,
    { flag: "wx" }
  );
}

export interface SignedPublicationInput {
  pack: UnsignedContentPack;
  manifestSignature: SignatureWrapper;
  keysetRaw: Uint8Array;
  keysetSignatureRaw: Uint8Array;
  outDir: string;
}

export async function writeSignedPublication(input: SignedPublicationInput): Promise<void> {
  const { pack, outDir } = input;
  const versionedBase = `e${pack.manifest.epoch}-s${pack.manifest.sequence}-${sha256(pack.manifestRaw)}`;
  const manifestSignatureRaw = signatureWrapperBytes(input.manifestSignature);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, pack.manifest.artifact.name), pack.artifactBytes, { flag: "wx" });
  await writeFile(path.join(outDir, `${versionedBase}.json`), pack.manifestRaw, { flag: "wx" });
  await writeFile(path.join(outDir, `${versionedBase}.sig`), manifestSignatureRaw, { flag: "wx" });
  await writeFile(path.join(outDir, "keyset.json"), input.keysetRaw);
  await writeFile(path.join(outDir, "keyset.sig"), input.keysetSignatureRaw);
  // Discoverable metadata moves last. Callers deploy immutable/versioned files
  // before these two files and the post-deploy verifier proves that ordering.
  await writeFile(path.join(outDir, "latest.json"), pack.manifestRaw);
  await writeFile(path.join(outDir, "latest.sig"), manifestSignatureRaw);
}
