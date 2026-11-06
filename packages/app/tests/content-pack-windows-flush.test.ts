// The slot-file flush in `writeSlotFiles` must work under Windows flush
// semantics (`FlushFileBuffers` refuses a read-only handle with EPERM) without
// weakening the POSIX durability contract. The emulation lives in
// `helpers/windows-flush-semantics.ts`, so this file proves the Windows
// behaviour from any host.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicKeySpkiBase64 } from "@cbe/corpus-schema";
import {
  activateContentPack,
  recoverContentPackTransaction,
  selectContentPackSync,
  type ContentPackPaths,
  type StorageFaultPoint,
} from "../src/main/content-pack-store.js";
import { initialTrustState, verifySignedKeyset, verifySignedManifest } from "../src/main/content-pack-trust.js";
import {
  fixtureKey,
  fixtureKeyset,
  fixtureManifest,
  signKeyset,
  signManifest,
} from "./helpers/content-pack-fixture.js";
import {
  emulateWindowsFlush,
  flushCalls,
  injectWritableFlushFailure,
  resetFlushSemantics,
} from "./helpers/windows-flush-semantics.js";

vi.mock("node:fs/promises", async (importOriginal) =>
  (await import("./helpers/windows-flush-semantics.js")).mockFsPromises(
    await importOriginal<typeof import("node:fs/promises")>()
  )
);

const appBuildTime = new Date("2026-10-18T00:00:00Z");
const now = new Date("2026-10-20T12:00:00Z");

function verified(sequence: number) {
  const root = fixtureKey("root-v1");
  const target = fixtureKey("corpus-stable-1");
  const keyset = verifySignedKeyset({
    ...signKeyset(fixtureKeyset({ targets: [{ key: target }] }), root),
    rootPublicKeySpki: publicKeySpkiBase64(root.publicKey),
    rootKeyId: root.id,
    packId: "cbe-corpus",
    channel: "stable",
    metadataMaxBytes: 256 * 1024,
    current: initialTrustState("cbe-corpus", "stable", appBuildTime),
    now,
    appBuildTime,
  });
  if ("status" in keyset) throw new Error(keyset.code);
  const fileBytes = Buffer.from(`{"corpus-version":"2026-${String(7 + sequence).padStart(2, "0")}"}\n`);
  const fixture = fixtureManifest({ sequence, artifactSha256: `${sequence}`.padStart(64, "0") });
  fixture.contents = [
    { path: "index.json", size: fileBytes.byteLength, sha256: createHash("sha256").update(fileBytes).digest("hex") },
  ];
  const signed = signManifest(fixture, target);
  const manifest = verifySignedManifest({
    ...signed,
    keyset,
    packId: "cbe-corpus",
    channel: "stable",
    metadataMaxBytes: 256 * 1024,
    now,
    appBuildTime,
    compatibility: () => ({ ok: true }),
  });
  if ("status" in manifest) throw new Error(manifest.code);
  return {
    verified: manifest,
    manifestRaw: signed.raw,
    signatureRaw: signed.signatureRaw,
    files: new Map([["index.json", fileBytes]]),
  };
}

const SLOT_FILES = ["manifest.json", "manifest.sig", "index.json"];
const FAULT_POINTS: StorageFaultPoint[] = [
  "slot-files-written",
  "slot-files-flushed",
  "slot-renamed",
  "journal-written",
  "trust-written",
  "previous-written",
  "active-written",
  "journal-cleared",
];

function isStagedSlotFile(file: string): boolean {
  return file.includes(`${path.sep}.staging-`) && SLOT_FILES.includes(path.basename(file));
}

describe("content pack slot flush under Windows and POSIX semantics", () => {
  let rootDir: string;
  let paths: ContentPackPaths;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "cbe-pack-flush-"));
    paths = {
      trustDir: path.join(rootDir, "trust"),
      packsDir: path.join(rootDir, "packs"),
      bundledDir: path.join(rootDir, "embedded"),
    };
    await mkdir(paths.bundledDir, { recursive: true });
    await writeFile(path.join(paths.bundledDir, "index.json"), '{"corpus-version":"2026-07"}\n');
  });

  afterEach(async () => {
    resetFlushSemantics();
    await rm(rootDir, { recursive: true, force: true });
  });

  describe("Windows flush semantics", () => {
    beforeEach(() => emulateWindowsFlush(true));

    it("activates a signed slot and flushes every slot file through a write-capable handle", async () => {
      const candidate = verified(1);
      await activateContentPack({ paths, ...candidate, now });

      const selected = selectContentPackSync({
        paths,
        packId: "cbe-corpus",
        channel: "stable",
        markerFile: "index.json",
      });
      expect(selected.source).toBe("downloaded");
      expect(await readFile(path.join(selected.dir, "index.json"), "utf8")).toContain("2026-08");

      const slotFlushes = flushCalls().filter((call) => isStagedSlotFile(call.path));
      expect(slotFlushes.map((call) => path.basename(call.path)).sort()).toEqual([...SLOT_FILES].sort());
      for (const call of slotFlushes) {
        expect(call).toMatchObject({ writable: true, outcome: "flushed" });
      }
    });

    it.each(FAULT_POINTS)("recovers a complete candidate after crash at %s", async (point) => {
      const candidate = verified(1);
      await expect(
        activateContentPack({
          paths,
          ...candidate,
          now,
          fault: (seen) => {
            if (seen === point) throw new Error(`crash:${point}`);
          },
        })
      ).rejects.toThrow(`crash:${point}`);

      await recoverContentPackTransaction(paths, "cbe-corpus", "stable", "index.json");
      const selected = selectContentPackSync({
        paths,
        packId: "cbe-corpus",
        channel: "stable",
        markerFile: "index.json",
      });
      expect(["embedded", "downloaded"]).toContain(selected.source);
      expect(await readFile(path.join(selected.dir, "index.json"), "utf8")).toMatch(/2026-0[78]/u);
    });
  });

  describe.each([
    ["POSIX", false, "EIO"],
    ["Windows", true, "EPERM"],
  ] as const)("%s durability is not weakened", (_label, windows, code) => {
    beforeEach(() => emulateWindowsFlush(windows));

    it("flushes every slot file after they are written and before the flush fault point", async () => {
      const candidate = verified(1);
      let writtenAt = -1;
      let flushedAt = -1;
      await activateContentPack({
        paths,
        ...candidate,
        now,
        fault: (seen) => {
          if (seen === "slot-files-written") writtenAt = flushCalls().length;
          if (seen === "slot-files-flushed") flushedAt = flushCalls().length;
        },
      });
      const slotFlushes = flushCalls()
        .map((call, index) => ({ call, index }))
        .filter(({ call }) => isStagedSlotFile(call.path));
      expect(slotFlushes).toHaveLength(SLOT_FILES.length);
      for (const { call, index } of slotFlushes) {
        expect(index).toBeGreaterThanOrEqual(writtenAt);
        expect(index).toBeLessThan(flushedAt);
        expect(call).toMatchObject({ writable: true, outcome: "flushed" });
      }
    });

    it(`propagates a ${code} from a slot file flush instead of swallowing it`, async () => {
      injectWritableFlushFailure((file) => {
        if (!isStagedSlotFile(file) || path.basename(file) !== "index.json") return null;
        const error = new Error(`${code}: flush failed, fsync`) as NodeJS.ErrnoException;
        error.code = code;
        return error;
      });
      const candidate = verified(1);
      const faults: StorageFaultPoint[] = [];
      await expect(
        activateContentPack({ paths, ...candidate, now, fault: (seen) => void faults.push(seen) })
      ).rejects.toMatchObject({ code });

      expect(faults).toEqual(["slot-files-written"]);
      const root = path.join(paths.packsDir, "cbe-corpus", "stable");
      expect((await readdir(root)).filter((entry) => entry.startsWith(".staging-"))).toEqual([]);
      expect(await readdir(path.join(root, "slots"))).toEqual([]);
      expect(existsSync(path.join(root, "active.json"))).toBe(false);
      expect(existsSync(path.join(root, "transaction.json"))).toBe(false);
      expect(
        selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).source
      ).toBe("embedded");
    });
  });
});
