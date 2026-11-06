import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publicKeySpkiBase64 } from "@cbe/corpus-schema";
import {
  activateContentPack,
  quarantineContentPack,
  readContentPackTrust,
  readContentPackTrustFloor,
  readEmbeddedContentIdentitySync,
  writeContentPackTrust,
  recoverContentPackTransaction,
  repairContentPackSelection,
  resetContentPackTrust,
  selectContentPackSync,
  type ContentPackPaths,
  type StorageFaultPoint,
} from "../src/main/content-pack-store.js";
import {
  activatedTrust,
  initialTrustState,
  verifySignedKeyset,
  verifySignedManifest,
} from "../src/main/content-pack-trust.js";
import {
  fixtureKey,
  fixtureKeyset,
  fixtureManifest,
  signKeyset,
  signManifest,
} from "./helpers/content-pack-fixture.js";

const appBuildTime = new Date("2026-10-18T00:00:00Z");
const now = new Date("2026-10-20T12:00:00Z");

function verified(sequence: number, root: ReturnType<typeof fixtureKey>, target: ReturnType<typeof fixtureKey>) {
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
  const fileBytes = Buffer.from(`{\"corpus-version\":\"2026-${String(7 + sequence).padStart(2, "0")}\"}\n`);
  const fixture = fixtureManifest({ sequence, artifactSha256: `${sequence}`.padStart(64, "0") });
  fixture.contents = [
    {
      path: "index.json",
      size: fileBytes.byteLength,
      sha256: createHash("sha256").update(fileBytes).digest("hex"),
    },
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

describe("crash-consistent content pack slots", () => {
  let rootDir: string;
  let paths: ContentPackPaths;
  let rootKey: ReturnType<typeof fixtureKey>;
  let target: ReturnType<typeof fixtureKey>;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "cbe-pack-state-"));
    paths = {
      trustDir: path.join(rootDir, "trust"),
      packsDir: path.join(rootDir, "packs"),
      bundledDir: path.join(rootDir, "embedded"),
    };
    await mkdir(paths.bundledDir, { recursive: true });
    await writeFile(path.join(paths.bundledDir, "index.json"), '{"corpus-version":"2026-07"}\n');
    rootKey = fixtureKey("root-v1");
    target = fixtureKey("corpus-stable-1");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("activates immutable slots and retains previous", async () => {
    const first = verified(1, rootKey, target);
    await activateContentPack({
      paths,
      ...first,
      files: first.files,
      now,
    });
    const firstSelected = selectContentPackSync({
      paths,
      packId: "cbe-corpus",
      channel: "stable",
      markerFile: "index.json",
    });
    expect(firstSelected.source).toBe("downloaded");
    expect(firstSelected.identity?.sequence).toBe(1);

    const second = verified(2, rootKey, target);
    await activateContentPack({
      paths,
      ...second,
      files: second.files,
      now,
    });
    const selected = selectContentPackSync({
      paths,
      packId: "cbe-corpus",
      channel: "stable",
      markerFile: "index.json",
    });
    expect(selected.identity?.sequence).toBe(2);
    expect(await readFile(path.join(selected.dir, "index.json"), "utf8")).toContain("2026-09");
    expect(await readFile(path.join(firstSelected.dir, "index.json"), "utf8")).toContain("2026-08");
    const previous = JSON.parse(
      await readFile(path.join(paths.packsDir, "cbe-corpus", "stable", "previous.json"), "utf8")
    ) as { sequence: number };
    expect(previous.sequence).toBe(1);
  });

  it.each([
    "slot-files-written",
    "slot-files-flushed",
    "slot-renamed",
    "journal-written",
    "trust-written",
    "previous-written",
    "active-written",
    "journal-cleared",
  ] as StorageFaultPoint[])("recovers a complete candidate after crash at %s", async (point) => {
    const candidate = verified(1, rootKey, target);
    await expect(
      activateContentPack({
        paths,
        ...candidate,
        files: candidate.files,
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

  it("Artifact or extracted-file tampering is refused and quarantined", async () => {
    const first = verified(1, rootKey, target);
    await activateContentPack({ paths, ...first, files: first.files, now });
    const second = verified(2, rootKey, target);
    await activateContentPack({ paths, ...second, files: second.files, now });
    const active = selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" });
    await writeFile(path.join(active.dir, "index.json"), "tampered\n");
    await repairContentPackSelection(paths, "cbe-corpus", "stable", "index.json", now);
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).identity
        ?.sequence
    ).toBe(1);
  });

  it("quarantines a bad active slot and selects previous then embedded", async () => {
    const first = verified(1, rootKey, target);
    const firstIdentity = await activateContentPack({
      paths,
      ...first,
      files: first.files,
      now,
    });
    const second = verified(2, rootKey, target);
    const secondIdentity = await activateContentPack({
      paths,
      ...second,
      files: second.files,
      now,
    });
    await quarantineContentPack(paths, secondIdentity, "read-failed", now);
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).identity
        ?.sequence
    ).toBe(firstIdentity.sequence);
    await quarantineContentPack(paths, firstIdentity, "read-failed", now);
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).source
    ).toBe("embedded");
  });

  it("Cache cleanup preserves replay protection", async () => {
    const second = verified(2, rootKey, target);
    await activateContentPack({ paths, ...second, files: second.files, now });
    await rm(paths.packsDir, { recursive: true, force: true });
    expect(
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json" }).source
    ).toBe("embedded");
    expect((await readContentPackTrust(paths, "cbe-corpus", "stable"))?.sequence).toBe(2);
  });

  it("trust reset is a separately confirmed and audited support operation", async () => {
    const first = verified(1, rootKey, target);
    await activateContentPack({ paths, ...first, files: first.files, now });
    await expect(resetContentPackTrust(paths, "cbe-corpus", "stable", "yes", now)).rejects.toThrow(
      /exact confirmation/
    );
    expect(await readContentPackTrust(paths, "cbe-corpus", "stable")).not.toBeNull();
    await resetContentPackTrust(paths, "cbe-corpus", "stable", "RESET cbe-corpus stable TRUST", now);
    expect(await readContentPackTrust(paths, "cbe-corpus", "stable")).toBeNull();
    expect(await readFile(path.join(paths.packsDir, "cbe-corpus", "stable", "audit.jsonl"), "utf8")).toContain(
      '"status":"trust-reset"'
    );
  });

  it("selects a newer embedded identity over stale downloaded cache", async () => {
    const first = verified(1, rootKey, target);
    await activateContentPack({
      paths,
      ...first,
      files: first.files,
      now,
    });
    expect(
      selectContentPackSync({
        paths,
        packId: "cbe-corpus",
        channel: "stable",
        markerFile: "index.json",
        embeddedIdentity: { epoch: 1, sequence: 2, manifestSha256: "f".repeat(64) },
      }).source
    ).toBe("embedded");
  });
  it("never lowers the durable trust floor when a stale run writes after a newer one", async () => {
    const second = verified(2, rootKey, target);
    await activateContentPack({ paths, ...second, files: second.files, now });
    const stale = { ...activatedTrust(verified(1, rootKey, target).verified), revokedKeyIds: ["old-key"] };
    await writeContentPackTrust(paths, stale);
    const trust = await readContentPackTrust(paths, "cbe-corpus", "stable");
    expect(trust?.sequence).toBe(2);
    expect(trust?.manifestSha256).toBe(second.verified.manifestSha256);
    expect(trust?.revokedKeyIds).toEqual(["old-key"]);
  });

  it("raises a corrupt trust file's floor from the active slot instead of resetting it", async () => {
    const second = verified(2, rootKey, target);
    await activateContentPack({ paths, ...second, files: second.files, now });
    await writeFile(path.join(paths.trustDir, "cbe-corpus-stable.json"), "{not json");
    const floor = await readContentPackTrustFloor(paths, "cbe-corpus", "stable", appBuildTime);
    expect(floor.sequence).toBe(2);
    expect(floor.manifestSha256).toBe(second.verified.manifestSha256);
    await rm(path.join(paths.trustDir, "cbe-corpus-stable.json"));
    expect((await readContentPackTrustFloor(paths, "cbe-corpus", "stable", appBuildTime)).sequence).toBe(0);
  });

  it("does not select a downloaded slot the running app no longer accepts", async () => {
    const first = verified(1, rootKey, target);
    await activateContentPack({ paths, ...first, files: first.files, now });
    const select = (compatible: () => boolean) =>
      selectContentPackSync({ paths, packId: "cbe-corpus", channel: "stable", markerFile: "index.json", compatible })
        .source;
    expect(select(() => true)).toBe("downloaded");
    expect(select(() => false)).toBe("embedded");
  });

  it("reads the embedded identity from a signed baseline manifest beside the bundled content", async () => {
    expect(readEmbeddedContentIdentitySync(paths.bundledDir, "cbe-corpus", "stable")).toBeUndefined();
    const baseline = verified(3, rootKey, target);
    await writeFile(path.join(paths.bundledDir, "manifest.json"), baseline.manifestRaw);
    expect(readEmbeddedContentIdentitySync(paths.bundledDir, "cbe-corpus", "stable")).toEqual({
      epoch: baseline.verified.manifest.epoch,
      sequence: 3,
      manifestSha256: baseline.verified.manifestSha256,
    });
    expect(readEmbeddedContentIdentitySync(paths.bundledDir, "cbe-skill", "stable")).toBeUndefined();
  });
});
