import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { compareContentPaths, type ContentPackEntry } from "./signed-pack.js";

export interface SafeZipLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxFileBytes: number;
  maxExpandedBytes: number;
  maxExpansionRatio: number;
}

export class SafeZipError extends Error {
  constructor(
    readonly code:
      | "archive-too-large"
      | "malformed-archive"
      | "zip64"
      | "multi-disk"
      | "unsupported-compression"
      | "encrypted"
      | "unsafe-entry"
      | "duplicate-entry"
      | "header-mismatch"
      | "entry-too-large"
      | "archive-expanded-too-large"
      | "expansion-ratio"
      | "crc-mismatch"
      | "inventory-mismatch"
      | "content-mismatch",
    readonly entry?: string
  ) {
    super(entry ? `${code}:${entry}` : code);
    this.name = "SafeZipError";
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function u16(bytes: Uint8Array, at: number): number {
  if (at + 2 > bytes.byteLength) throw new SafeZipError("malformed-archive");
  return bytes[at]! | (bytes[at + 1]! << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.byteLength) throw new SafeZipError("malformed-archive");
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeName(raw: Uint8Array): string {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new SafeZipError("unsafe-entry");
  }
  if (
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/u.test(name) ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    /[^\x20-\x7e]/u.test(name)
  ) {
    throw new SafeZipError("unsafe-entry", name);
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new SafeZipError("unsafe-entry", name);
  }
  return name;
}

interface CentralEntry {
  name: string;
  nameRaw: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  expandedSize: number;
  localOffset: number;
  externalAttributes: number;
}

function parseCentral(bytes: Uint8Array, limits: SafeZipLimits): { entries: CentralEntry[]; centralOffset: number } {
  if (bytes.byteLength > limits.maxCompressedBytes) throw new SafeZipError("archive-too-large");
  if (bytes.byteLength < 22 || u32(bytes, bytes.byteLength - 22) !== EOCD) throw new SafeZipError("malformed-archive");
  const eocd = bytes.byteLength - 22;
  const disk = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const diskEntries = u16(bytes, eocd + 8);
  const totalEntries = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  const commentLength = u16(bytes, eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new SafeZipError("multi-disk");
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SafeZipError("zip64");
  }
  if (
    commentLength !== 0 ||
    centralOffset + centralSize !== eocd ||
    totalEntries === 0 ||
    totalEntries > limits.maxEntries
  ) {
    throw new SafeZipError("malformed-archive");
  }
  const entries: CentralEntry[] = [];
  let at = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (u32(bytes, at) !== CENTRAL || at + 46 > eocd) throw new SafeZipError("malformed-archive");
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const crc = u32(bytes, at + 16);
    const compressedSize = u32(bytes, at + 20);
    const expandedSize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const entryCommentLength = u16(bytes, at + 32);
    const diskStart = u16(bytes, at + 34);
    const externalAttributes = u32(bytes, at + 38);
    const localOffset = u32(bytes, at + 42);
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new SafeZipError("zip64");
    }
    if (diskStart !== 0) throw new SafeZipError("multi-disk");
    if ((flags & 0x1) !== 0) throw new SafeZipError("encrypted");
    if ((flags & 0x8) !== 0) throw new SafeZipError("header-mismatch");
    if (method !== 0 && method !== 8) throw new SafeZipError("unsupported-compression");
    if (extraLength !== 0 || entryCommentLength !== 0) throw new SafeZipError("malformed-archive");
    const nameStart = at + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > eocd) throw new SafeZipError("malformed-archive");
    const nameRaw = bytes.slice(nameStart, nameEnd);
    const name = decodeName(nameRaw);
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const type = unixMode & 0xf000;
    if (name.endsWith("/") || (type !== 0 && type !== 0x8000)) throw new SafeZipError("unsafe-entry", name);
    if (expandedSize > limits.maxFileBytes) throw new SafeZipError("entry-too-large", name);
    entries.push({ name, nameRaw, flags, method, crc, compressedSize, expandedSize, localOffset, externalAttributes });
    at = nameEnd;
  }
  if (at !== eocd) throw new SafeZipError("malformed-archive");
  const names = new Set<string>();
  const folded = new Set<string>();
  for (const entry of entries) {
    const fold = entry.name.toLowerCase();
    if (names.has(entry.name) || folded.has(fold)) throw new SafeZipError("duplicate-entry", entry.name);
    names.add(entry.name);
    folded.add(fold);
  }
  return { entries, centralOffset };
}

export function extractSafeZip(
  bytes: Uint8Array,
  expectedContents: readonly ContentPackEntry[],
  limits: SafeZipLimits
): Map<string, Uint8Array> {
  const { entries, centralOffset } = parseCentral(bytes, limits);
  const expected = [...expectedContents].sort((a, b) => compareContentPaths(a.path, b.path));
  const actualNames = entries.map((entry) => entry.name).sort(compareContentPaths);
  if (JSON.stringify(actualNames) !== JSON.stringify(expected.map((entry) => entry.path))) {
    throw new SafeZipError("inventory-mismatch");
  }

  const ranges: Array<{ start: number; end: number; entry: CentralEntry; dataStart: number }> = [];
  for (const entry of entries) {
    const at = entry.localOffset;
    if (u32(bytes, at) !== LOCAL || at + 30 > centralOffset) throw new SafeZipError("malformed-archive", entry.name);
    const flags = u16(bytes, at + 6);
    const method = u16(bytes, at + 8);
    const crc = u32(bytes, at + 14);
    const compressedSize = u32(bytes, at + 18);
    const expandedSize = u32(bytes, at + 22);
    const nameLength = u16(bytes, at + 26);
    const extraLength = u16(bytes, at + 28);
    const nameStart = at + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (extraLength !== 0 || dataEnd > centralOffset) throw new SafeZipError("malformed-archive", entry.name);
    if (
      flags !== entry.flags ||
      method !== entry.method ||
      crc !== entry.crc ||
      compressedSize !== entry.compressedSize ||
      expandedSize !== entry.expandedSize ||
      !Buffer.from(bytes.slice(nameStart, nameEnd)).equals(Buffer.from(entry.nameRaw))
    ) {
      throw new SafeZipError("header-mismatch", entry.name);
    }
    ranges.push({ start: at, end: dataEnd, entry, dataStart });
  }
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const range of ranges) {
    if (range.start !== cursor) throw new SafeZipError("malformed-archive", range.entry.name);
    cursor = range.end;
  }
  if (cursor !== centralOffset) throw new SafeZipError("malformed-archive");

  let totalExpanded = 0;
  let totalCompressed = 0;
  const output = new Map<string, Uint8Array>();
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  for (const range of ranges) {
    const { entry } = range;
    const compressed = bytes.slice(range.dataStart, range.end);
    let expanded: Uint8Array;
    try {
      expanded =
        entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: limits.maxFileBytes + 1 });
    } catch {
      throw new SafeZipError("malformed-archive", entry.name);
    }
    if (expanded.byteLength !== entry.expandedSize) throw new SafeZipError("header-mismatch", entry.name);
    if (expanded.byteLength > limits.maxFileBytes) throw new SafeZipError("entry-too-large", entry.name);
    if (entry.compressedSize === 0 && entry.expandedSize > 0) throw new SafeZipError("expansion-ratio", entry.name);
    if (entry.compressedSize > 0 && entry.expandedSize / entry.compressedSize > limits.maxExpansionRatio) {
      throw new SafeZipError("expansion-ratio", entry.name);
    }
    totalExpanded += expanded.byteLength;
    totalCompressed += compressed.byteLength;
    if (totalExpanded > limits.maxExpandedBytes) throw new SafeZipError("archive-expanded-too-large");
    if (crc32(expanded) !== entry.crc) throw new SafeZipError("crc-mismatch", entry.name);
    const declared = expectedByPath.get(entry.name)!;
    if (declared.size !== expanded.byteLength || declared.sha256 !== sha256(expanded)) {
      throw new SafeZipError("content-mismatch", entry.name);
    }
    output.set(entry.name, expanded);
  }
  if (totalCompressed === 0 && totalExpanded > 0) throw new SafeZipError("expansion-ratio");
  if (totalCompressed > 0 && totalExpanded / totalCompressed > limits.maxExpansionRatio) {
    throw new SafeZipError("expansion-ratio");
  }
  return output;
}
