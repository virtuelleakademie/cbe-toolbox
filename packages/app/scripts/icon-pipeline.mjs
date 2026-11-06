import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { format as formatWithPrettier } from "prettier";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../../..");
export const SOURCE_RELATIVE_PATH = "packages/app/icon-source/cbe-toolbox-icon.svg";
export const RECORD_RELATIVE_PATH = "packages/app/icon-source/provenance.json";
export const BUILD_RESOURCES_RELATIVE_PATH = "packages/app/buildResources";
export const RECIPE_RELATIVE_PATH = "packages/app/scripts/icon-pipeline.mjs";
export const MANIFEST_NAME = "icon-manifest.json";
export const EXPECTED_SOURCE_SHA256 = "7fd40de8311adba4d0259a0a53e99f9a212d982cfee1c2b3a1733456ac73911c";
export const EXPECTED_SOURCE_BYTES = 2785;
export const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
export const ICO_SIZES = [16, 32, 48, 64, 128, 256];
export const ICNS_REPRESENTATIONS = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
];
export const GENERATED_PATHS = [
  "icon.icns",
  "icon.ico",
  "icon.png",
  ...LINUX_SIZES.map((size) => `icons/${size}x${size}.png`),
  MANIFEST_NAME,
].sort();

const EXPECTED_PALETTE = ["#273171", "#cc3366", "#ff5e13", "#0087a9", "#4fb3cc", "#ffffff"];
const EXPECTED_RECORD_KEYS = [
  "approval",
  "byteSize",
  "dimensions",
  "license",
  "mediaType",
  "provenance",
  "renderedPalette",
  "sha256",
  "source",
  "useAuthorization",
].sort();

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function fail(message) {
  throw new Error(`Icon source intake failed: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail(`${label} keys differ (expected ${expected.join(", ")}; got ${actual.join(", ")})`);
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} is missing`);
}

function approvedDate(value, label) {
  nonEmpty(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be YYYY-MM-DD`);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1] ?? null;
}

/** Validate geometry, structure, rendered palette and active-content boundaries. */
export function validateSvgStructure(source) {
  const xml = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  const svgTag = xml.match(/<svg\b[^>]*>/)?.[0];
  if (!svgTag) fail("SVG root is missing");
  if (attribute(svgTag, "width") !== "1024" || attribute(svgTag, "height") !== "1024") {
    fail("SVG root width and height must both be 1024");
  }
  if (attribute(svgTag, "viewBox") !== "0 0 1024 1024") fail('SVG viewBox must be "0 0 1024 1024"');

  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
  if (/<(?:script|image|style|use)\b/i.test(withoutComments)) fail("active or externally reusable SVG element found");
  if (/\b(?:href|xlink:href|style)\s*=/i.test(withoutComments) || /url\s*\(/i.test(withoutComments)) {
    fail("active, styled or external SVG reference found");
  }

  const count = (pattern) => (withoutComments.match(pattern) ?? []).length;
  if (count(/<g(?:\s|>)/g) !== 7) fail("SVG must contain exactly seven groups");
  if (count(/<rect(?:\s|>)/g) !== 1) fail("SVG must contain exactly one rectangle");
  if (count(/<path(?:\s|>)/g) !== 3) fail("SVG must contain exactly three paths");
  if (count(/<circle(?:\s|>)/g) !== 44) fail("SVG must contain exactly 44 circles");

  const rectTag = withoutComments.match(/<rect\b[^>]*>/)?.[0] ?? "";
  for (const [name, expected] of Object.entries({ x: "100", y: "100", width: "824", height: "824", rx: "186" })) {
    if (attribute(rectTag, name) !== expected) fail(`background rectangle ${name} must remain ${expected}`);
  }

  const renderedColours = new Set(
    [...withoutComments.matchAll(/\b(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((match) => match[1].toLowerCase())
  );
  const actualPalette = [...renderedColours];
  if (
    actualPalette.length !== EXPECTED_PALETTE.length ||
    EXPECTED_PALETTE.some((colour) => !renderedColours.has(colour)) ||
    renderedColours.has("#3e4d9c")
  ) {
    fail(`rendered palette differs from approved colours (got ${actualPalette.join(", ")})`);
  }
}

/**
 * Validate the immutable master and its singular evidence record. The caller may
 * point at another repository root for negative tests, but neither CLI accepts a
 * source path: the source path itself is a fixed contract.
 */
export async function validateIconSource(repoRoot = REPO_ROOT) {
  const sourcePath = path.join(repoRoot, SOURCE_RELATIVE_PATH);
  const recordPath = path.join(repoRoot, RECORD_RELATIVE_PATH);

  let sourceStat;
  try {
    sourceStat = await lstat(sourcePath);
  } catch {
    fail(`authoritative source is missing at ${SOURCE_RELATIVE_PATH}`);
  }
  if (sourceStat.isSymbolicLink()) fail("authoritative source must not be a symlink");
  if (!sourceStat.isFile()) fail("authoritative source is not a regular file");

  let recordStat;
  try {
    recordStat = await lstat(recordPath);
  } catch {
    fail(`source record is missing at ${RECORD_RELATIVE_PATH}`);
  }
  if (recordStat.isSymbolicLink() || !recordStat.isFile()) fail("source record must be a regular file, not a symlink");

  const [source, recordRaw] = await Promise.all([readFile(sourcePath), readFile(recordPath, "utf8")]);
  let record;
  try {
    record = JSON.parse(recordRaw);
  } catch {
    fail("source record is not valid JSON");
  }

  exactKeys(record, EXPECTED_RECORD_KEYS, "source record");
  if (record.source !== SOURCE_RELATIVE_PATH) fail(`source record must name exactly ${SOURCE_RELATIVE_PATH}`);
  if (record.mediaType !== "image/svg+xml") fail("media type must be image/svg+xml");
  if (record.byteSize !== EXPECTED_SOURCE_BYTES) fail(`recorded byte size must be ${EXPECTED_SOURCE_BYTES}`);
  if (record.sha256 !== EXPECTED_SOURCE_SHA256) fail("recorded SHA256 differs from the approved SHA256");
  exactKeys(record.dimensions, ["height", "viewBox", "width"], "dimensions");
  if (
    record.dimensions.width !== 1024 ||
    record.dimensions.height !== 1024 ||
    record.dimensions.viewBox !== "0 0 1024 1024"
  ) {
    fail("recorded dimensions/viewBox differ from 1024 × 1024 / 0 0 1024 1024");
  }
  if (JSON.stringify(record.renderedPalette) !== JSON.stringify(EXPECTED_PALETTE)) {
    fail("recorded rendered palette differs from the approved six colours");
  }

  exactKeys(record.provenance, ["authoritativeSince", "importMethod", "origin"], "provenance");
  nonEmpty(record.provenance.origin, "provenance.origin");
  nonEmpty(record.provenance.importMethod, "provenance.importMethod");
  approvedDate(record.provenance.authoritativeSince, "provenance.authoritativeSince");
  exactKeys(record.license, ["status", "terms"], "license");
  nonEmpty(record.license.status, "license.status");
  nonEmpty(record.license.terms, "license.terms");
  exactKeys(record.useAuthorization, ["grantedBy", "grantedOn", "scope"], "useAuthorization");
  nonEmpty(record.useAuthorization.grantedBy, "useAuthorization.grantedBy");
  approvedDate(record.useAuthorization.grantedOn, "useAuthorization.grantedOn");
  nonEmpty(record.useAuthorization.scope, "useAuthorization.scope");
  exactKeys(record.approval, ["approvedBy", "approvedOn", "decision"], "approval");
  nonEmpty(record.approval.approvedBy, "approval.approvedBy");
  approvedDate(record.approval.approvedOn, "approval.approvedOn");
  nonEmpty(record.approval.decision, "approval.decision");

  if (source.length !== EXPECTED_SOURCE_BYTES || source.length !== record.byteSize) {
    fail(`authoritative source must remain ${EXPECTED_SOURCE_BYTES} bytes`);
  }
  const sourceHash = sha256(source);
  if (sourceHash !== EXPECTED_SOURCE_SHA256 || sourceHash !== record.sha256) {
    fail("authoritative source bytes do not match the approved SHA256");
  }

  validateSvgStructure(source);

  return { source, sourceHash, record };
}

async function renderPng(source, size) {
  return sharp(source, { density: 72, limitInputPixels: false })
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
}

function icnsChunk(type, payload) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(payload.length + 8, 4);
  return Buffer.concat([header, payload]);
}

export function encodeIcns(pngBySize) {
  const chunks = ICNS_REPRESENTATIONS.map(({ type, size }) => icnsChunk(type, pngBySize.get(size)));
  const length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...chunks]);
}

export function encodeIco(pngBySize) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(ICO_SIZES.length, 4);
  const entries = [];
  const payloads = [];
  let offset = 6 + ICO_SIZES.length * 16;
  for (const size of ICO_SIZES) {
    const payload = pngBySize.get(size);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(payload.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    payloads.push(payload);
    offset += payload.length;
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

export function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG with an IHDR chunk");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function inspectIco(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error("invalid ICO header");
  }
  const count = buffer.readUInt16LE(4);
  const representations = [];
  for (let index = 0; index < count; index += 1) {
    const start = 6 + index * 16;
    if (start + 16 > buffer.length) throw new Error("truncated ICO directory");
    const width = buffer.readUInt8(start) || 256;
    const height = buffer.readUInt8(start + 1) || 256;
    const length = buffer.readUInt32LE(start + 8);
    const offset = buffer.readUInt32LE(start + 12);
    if (offset + length > buffer.length) throw new Error("truncated ICO representation");
    const png = buffer.subarray(offset, offset + length);
    const dimensions = pngDimensions(png);
    if (dimensions.width !== width || dimensions.height !== height)
      throw new Error("ICO directory/PNG dimensions differ");
    representations.push(width);
  }
  return representations;
}

export function inspectIcns(buffer) {
  if (buffer.length < 8 || buffer.toString("ascii", 0, 4) !== "icns" || buffer.readUInt32BE(4) !== buffer.length) {
    throw new Error("invalid ICNS header or length");
  }
  const representations = [];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error("truncated ICNS chunk header");
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) throw new Error("truncated ICNS chunk");
    const expected = ICNS_REPRESENTATIONS.find((entry) => entry.type === type);
    if (!expected) throw new Error(`unexpected ICNS representation ${type}`);
    const dimensions = pngDimensions(buffer.subarray(offset + 8, offset + length));
    if (dimensions.width !== expected.size || dimensions.height !== expected.size) {
      throw new Error(`ICNS ${type} dimensions differ from ${expected.size}`);
    }
    representations.push({ type, size: expected.size });
    offset += length;
  }
  if (offset !== buffer.length) throw new Error("ICNS chunk alignment is invalid");
  return representations;
}

async function toolRecord(repoRoot) {
  const packageLock = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
  const sharpEntry = packageLock.packages?.["node_modules/sharp"];
  if (!sharpEntry || sharpEntry.version !== "0.35.5" || typeof sharpEntry.integrity !== "string") {
    throw new Error("sharp must be pinned to exactly 0.35.5 in package-lock.json");
  }
  const prettierEntry = packageLock.packages?.["node_modules/prettier"];
  if (!prettierEntry || prettierEntry.version !== "3.8.3" || typeof prettierEntry.integrity !== "string") {
    throw new Error("prettier must be pinned to exactly 3.8.3 in package-lock.json");
  }
  return {
    sharp: { version: sharpEntry.version, integrity: sharpEntry.integrity },
    prettier: { version: prettierEntry.version, integrity: prettierEntry.integrity },
  };
}

function outputDescription(relativePath, buffer) {
  if (relativePath.endsWith(".png")) {
    const dimensions = pngDimensions(buffer);
    return { path: relativePath, format: "png", dimensions, sha256: sha256(buffer) };
  }
  if (relativePath.endsWith(".ico")) {
    return { path: relativePath, format: "ico", representations: inspectIco(buffer), sha256: sha256(buffer) };
  }
  if (relativePath.endsWith(".icns")) {
    return {
      path: relativePath,
      format: "icns",
      representations: inspectIcns(buffer),
      sha256: sha256(buffer),
    };
  }
  throw new Error(`unrecognised generated icon output ${relativePath}`);
}

async function buildGeneratedFiles(repoRoot) {
  const { source, sourceHash } = await validateIconSource(repoRoot);
  const pngBySize = new Map();
  for (const size of LINUX_SIZES) pngBySize.set(size, await renderPng(source, size));

  const files = new Map();
  files.set("icon.icns", encodeIcns(pngBySize));
  files.set("icon.ico", encodeIco(pngBySize));
  files.set("icon.png", pngBySize.get(1024));
  for (const size of LINUX_SIZES) files.set(`icons/${size}x${size}.png`, pngBySize.get(size));

  const recipe = await readFile(path.join(repoRoot, RECIPE_RELATIVE_PATH));
  const manifest = {
    schemaVersion: 1,
    source: { path: SOURCE_RELATIVE_PATH, sha256: sourceHash, byteSize: source.length },
    recipe: { path: RECIPE_RELATIVE_PATH, sha256: sha256(recipe) },
    tools: await toolRecord(repoRoot),
    outputs: [...files.entries()]
      .map(([relativePath, buffer]) => outputDescription(relativePath, buffer))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
  const manifestJson = await formatWithPrettier(JSON.stringify(manifest), {
    parser: "json",
    semi: true,
    singleQuote: false,
    trailingComma: "es5",
    printWidth: 120,
    tabWidth: 2,
    endOfLine: "lf",
  });
  files.set(MANIFEST_NAME, Buffer.from(manifestJson, "utf8"));
  return files;
}

async function writeAtomically(target, buffer) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, buffer);
  await rename(temporary, target);
}

/** Generate the declared set. Intake completes before any output is written. */
export async function generateIcons({ repoRoot = REPO_ROOT, outputDir } = {}) {
  const destination = outputDir ?? path.join(repoRoot, BUILD_RESOURCES_RELATIVE_PATH);
  const files = await buildGeneratedFiles(repoRoot);
  for (const relativePath of [...files.keys()].sort()) {
    await writeAtomically(path.join(destination, relativePath), files.get(relativePath));
  }
  return files;
}

async function discoverGeneratedIconPaths(root, prefix = "") {
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) found.push(...(await discoverGeneratedIconPaths(root, relativePath)));
    else if (/\.(?:png|ico|icns)$/i.test(entry.name) || entry.name === MANIFEST_NAME) found.push(relativePath);
  }
  return found.sort();
}

/** Regenerate outside the tree, then compare inventory, formats and every byte. */
export async function checkIcons({ repoRoot = REPO_ROOT, committedDir } = {}) {
  const destination = committedDir ?? path.join(repoRoot, BUILD_RESOURCES_RELATIVE_PATH);
  // Validate first so a changed source hash reports the intake gate even if the
  // committed outputs happen to be missing too.
  await validateIconSource(repoRoot);
  const temp = await mkdtemp(path.join(os.tmpdir(), "cbe-icons-check-"));
  try {
    const expected = await generateIcons({ repoRoot, outputDir: temp });
    const discovered = await discoverGeneratedIconPaths(destination);
    if (JSON.stringify(discovered) !== JSON.stringify(GENERATED_PATHS)) {
      throw new Error(
        `Generated icon inventory differs (expected ${GENERATED_PATHS.join(", ")}; got ${discovered.join(", ")})`
      );
    }
    for (const relativePath of GENERATED_PATHS) {
      const [committed, regenerated] = await Promise.all([
        readFile(path.join(destination, relativePath)),
        readFile(path.join(temp, relativePath)),
      ]);
      if (!committed.equals(regenerated)) throw new Error(`Generated icon is stale or malformed: ${relativePath}`);
      if (relativePath.endsWith(".png")) pngDimensions(committed);
      else if (relativePath.endsWith(".ico")) inspectIco(committed);
      else if (relativePath.endsWith(".icns")) inspectIcns(committed);
      if (!expected.get(relativePath)?.equals(regenerated))
        throw new Error(`Internal generation mismatch: ${relativePath}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
