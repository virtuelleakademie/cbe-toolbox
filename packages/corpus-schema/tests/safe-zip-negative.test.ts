import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractSafeZip, SafeZipError, type ContentPackEntry } from "../src/index.js";

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
function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}
function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function rawZip(
  options: {
    localName?: string;
    centralName?: string;
    data?: Uint8Array;
    flags?: number;
    method?: number;
    externalAttributes?: number;
    disk?: number;
    localOffset?: number;
    localExtra?: Uint8Array;
    centralExtra?: Uint8Array;
    declaredCompressed?: number;
    declaredExpanded?: number;
  } = {}
): Uint8Array {
  const localName = Buffer.from(options.localName ?? "SKILL.md");
  const centralName = Buffer.from(options.centralName ?? options.localName ?? "SKILL.md");
  const data = Buffer.from(options.data ?? Buffer.from("body"));
  const flags = options.flags ?? 0;
  const method = options.method ?? 0;
  const compressed = options.declaredCompressed ?? data.byteLength;
  const expanded = options.declaredExpanded ?? data.byteLength;
  const crc = crc32(data);
  const localExtra = Buffer.from(options.localExtra ?? []);
  const centralExtra = Buffer.from(options.centralExtra ?? []);
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(flags),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed),
    u32(expanded),
    u16(localName.byteLength),
    u16(localExtra.byteLength),
    localName,
    localExtra,
    data,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(0x0314),
    u16(20),
    u16(flags),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(compressed),
    u32(expanded),
    u16(centralName.byteLength),
    u16(centralExtra.byteLength),
    u16(0),
    u16(0),
    u16(0),
    u32(options.externalAttributes ?? 0x81a40000),
    u32(options.localOffset ?? 0),
    centralName,
    centralExtra,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(options.disk ?? 0),
    u16(options.disk ?? 0),
    u16(1),
    u16(1),
    u32(central.byteLength),
    u32(local.byteLength),
    u16(0),
  ]);
  return Buffer.concat([local, central, eocd]);
}

const limits = {
  maxCompressedBytes: 256 * 1024,
  maxEntries: 1,
  maxFileBytes: 64 * 1024,
  maxExpandedBytes: 64 * 1024,
  maxExpansionRatio: 20,
};
function declared(path: string, bytes = Buffer.from("body")): ContentPackEntry[] {
  return [{ path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }];
}

describe("safe ZIP validation", () => {
  it("accepts the exact regular file control", () => {
    expect(extractSafeZip(rawZip(), declared("SKILL.md"), limits).get("SKILL.md")).toEqual(Buffer.from("body"));
  });

  it.each([
    ["traversal", rawZip({ localName: "../SKILL.md" })],
    ["absolute", rawZip({ localName: "/SKILL.md" })],
    ["backslash", rawZip({ localName: "dir\\SKILL.md" })],
    ["directory", rawZip({ localName: "SKILL.md/", externalAttributes: 0x41ed0010 })],
    ["symlink", rawZip({ externalAttributes: 0xa1ff0000 })],
    ["encrypted", rawZip({ flags: 1 })],
    ["data descriptor", rawZip({ flags: 8 })],
    ["unsupported compression", rawZip({ method: 99 })],
    ["local/central disagreement", rawZip({ localName: "SKILL.md", centralName: "skill.md" })],
    ["multi-disk", rawZip({ disk: 1 })],
    ["local extra field", rawZip({ localExtra: Buffer.from([1]) })],
    ["central extra field", rawZip({ centralExtra: Buffer.from([1]) })],
    ["overlapping local offset", rawZip({ localOffset: 1 })],
  ])("ZIP attacks are refused before activation: %s", (_name, archive) => {
    expect(() => extractSafeZip(archive, declared("SKILL.md"), limits)).toThrow(SafeZipError);
  });

  it("refuses duplicate and case-colliding central records", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "body");
    zip.file("skill.md", "body");
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE", createFolders: false });
    expect(() =>
      extractSafeZip(archive, [...declared("SKILL.md"), ...declared("skill.md")], { ...limits, maxEntries: 2 })
    ).toThrow(/duplicate-entry/);
  });

  it("refuses ZIP64 sentinels and trailing undeclared bytes", () => {
    const zip64 = Buffer.from(rawZip());
    zip64.writeUInt16LE(0xffff, zip64.length - 14);
    zip64.writeUInt16LE(0xffff, zip64.length - 12);
    expect(() => extractSafeZip(zip64, declared("SKILL.md"), limits)).toThrow(/zip64/);
    expect(() =>
      extractSafeZip(Buffer.concat([Buffer.from(rawZip()), Buffer.from("trailing")]), declared("SKILL.md"), limits)
    ).toThrow(/malformed-archive/);
  });

  it("enforces compressed, entry, per-file, total-expanded and ratio limits at one byte over", async () => {
    const control = rawZip();
    expect(() =>
      extractSafeZip(control, declared("SKILL.md"), { ...limits, maxCompressedBytes: control.byteLength - 1 })
    ).toThrow(/archive-too-large/);
    expect(() => extractSafeZip(control, declared("SKILL.md"), { ...limits, maxFileBytes: 3 })).toThrow(
      /entry-too-large/
    );
    expect(() => extractSafeZip(control, declared("SKILL.md"), { ...limits, maxExpandedBytes: 3 })).toThrow(
      /archive-expanded-too-large/
    );

    const zip = new JSZip();
    const expanded = Buffer.alloc(4096, 0x41);
    zip.file("SKILL.md", expanded, { createFolders: false });
    const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", createFolders: false });
    expect(() => extractSafeZip(bomb, declared("SKILL.md", expanded), { ...limits, maxExpansionRatio: 2 })).toThrow(
      /expansion-ratio/
    );

    const two = new JSZip();
    two.file("a.md", "a", { createFolders: false });
    two.file("b.md", "b", { createFolders: false });
    const twoBytes = await two.generateAsync({ type: "nodebuffer", compression: "STORE", createFolders: false });
    expect(() =>
      extractSafeZip(twoBytes, [...declared("a.md", Buffer.from("a")), ...declared("b.md", Buffer.from("b"))], {
        ...limits,
        maxEntries: 1,
      })
    ).toThrow(/malformed-archive/);
  });

  it("refuses CRC, declared size, inventory and content hash disagreement", () => {
    const crc = Buffer.from(rawZip());
    crc.writeUInt32LE(0, 14);
    crc.writeUInt32LE(0, 30 + Buffer.byteLength("SKILL.md") + Buffer.byteLength("body") + 16);
    expect(() => extractSafeZip(crc, declared("SKILL.md"), limits)).toThrow(/crc-mismatch/);
    expect(() => extractSafeZip(rawZip({ declaredExpanded: 5 }), declared("SKILL.md"), limits)).toThrow(
      /header-mismatch/
    );
    expect(() => extractSafeZip(rawZip(), declared("OTHER.md"), limits)).toThrow(/inventory-mismatch/);
    expect(() => extractSafeZip(rawZip(), [{ ...declared("SKILL.md")[0]!, sha256: "0".repeat(64) }], limits)).toThrow(
      /content-mismatch/
    );
  });
});
