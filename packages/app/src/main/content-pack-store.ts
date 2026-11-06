import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeManifest,
  type ContentPackChannel,
  type ContentPackId,
  type ContentPackManifest,
} from "@cbe/corpus-schema";
import {
  activatedTrust,
  initialTrustState,
  type ContentPackTrustState,
  type VerifiedManifest,
} from "./content-pack-trust.js";

export interface ContentPackPaths {
  trustDir: string;
  packsDir: string;
  bundledDir: string;
}

export interface ContentPackSlotIdentity {
  packId: ContentPackId;
  channel: ContentPackChannel;
  epoch: number;
  sequence: number;
  version: string;
  manifestSha256: string;
  signerKeyId: string;
  sourceCommit: string;
  installedAt: string;
  slotName: string;
}

interface ActivationJournal {
  schemaVersion: 1;
  oldActive: ContentPackSlotIdentity | null;
  candidate: ContentPackSlotIdentity;
  proposedTrust: ContentPackTrustState;
}

interface QuarantineState {
  schemaVersion: 1;
  entries: Array<ContentPackSlotIdentity & { reason: string; quarantinedAt: string }>;
}

export type StorageFaultPoint =
  | "slot-files-written"
  | "slot-files-flushed"
  | "slot-renamed"
  | "journal-written"
  | "trust-written"
  | "previous-written"
  | "active-written"
  | "journal-cleared";

export interface ActivationOptions {
  paths: ContentPackPaths;
  verified: VerifiedManifest;
  manifestRaw: Uint8Array;
  signatureRaw: Uint8Array;
  files: ReadonlyMap<string, Uint8Array>;
  now: Date;
  fault?: (point: StorageFaultPoint) => void | Promise<void>;
}

export interface SelectedContentPack {
  dir: string;
  source: "downloaded" | "previous" | "embedded";
  identity: ContentPackSlotIdentity | null;
}

export interface EmbeddedContentIdentity {
  epoch: number;
  sequence: number;
  manifestSha256: string;
}

function packRoot(paths: ContentPackPaths, packId: ContentPackId, channel: ContentPackChannel): string {
  return path.join(paths.packsDir, packId, channel);
}

function trustPath(paths: ContentPackPaths, packId: ContentPackId, channel: ContentPackChannel): string {
  return path.join(paths.trustDir, `${packId}-${channel}.json`);
}

function statePath(paths: ContentPackPaths, packId: ContentPackId, channel: ContentPackChannel, name: string): string {
  return path.join(packRoot(paths, packId, channel), name);
}

function slotDir(paths: ContentPackPaths, identity: ContentPackSlotIdentity): string {
  return path.join(packRoot(paths, identity.packId, identity.channel), "slots", identity.slotName);
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EINVAL" || code === "EPERM" || code === "EISDIR")) return;
    throw error;
  }
}

async function writeDurable(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  await syncDirectory(path.dirname(file));
}

async function removeDurable(file: string): Promise<void> {
  await unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await mkdir(path.dirname(file), { recursive: true });
  await syncDirectory(path.dirname(file));
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonSync<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function readContentPackTrust(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel
): Promise<ContentPackTrustState | null> {
  return readJson<ContentPackTrustState>(trustPath(paths, packId, channel));
}

function validTrustShape(
  value: ContentPackTrustState | null,
  packId: ContentPackId,
  channel: ContentPackChannel
): value is ContentPackTrustState {
  return Boolean(
    value &&
    value.schemaVersion === 1 &&
    value.packId === packId &&
    value.channel === channel &&
    [value.keysetVersion, value.authorizedEpoch, value.epoch, value.sequence].every(
      (item) => Number.isSafeInteger(item) && item >= 0
    ) &&
    typeof value.keysetSha256 === "string" &&
    (value.manifestSha256 === null || /^[a-f0-9]{64}$/u.test(value.manifestSha256)) &&
    typeof value.greatestCreatedAt === "string" &&
    Number.isFinite(new Date(value.greatestCreatedAt).valueOf()) &&
    Array.isArray(value.revokedKeyIds) &&
    value.revokedKeyIds.every((item) => typeof item === "string")
  );
}

export async function readContentPackTrustFloor(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel,
  appBuildTime: Date
): Promise<ContentPackTrustState> {
  const file = trustPath(paths, packId, channel);
  const stored = await readJson<ContentPackTrustState>(file);
  if (validTrustShape(stored, packId, channel)) return stored;
  const initial = initialTrustState(packId, channel, appBuildTime);
  if (!existsSync(file)) return initial;
  let floor = initial;
  for (const pointer of ["active.json", "previous.json"]) {
    const identity = await readJson<ContentPackSlotIdentity>(statePath(paths, packId, channel, pointer));
    if (!validPointer(identity, packId, channel)) continue;
    floor = mergeContentPackTrust(floor, {
      ...initial,
      authorizedEpoch: identity.epoch,
      epoch: identity.epoch,
      sequence: identity.sequence,
      manifestSha256: identity.manifestSha256,
    });
  }
  return floor;
}

function laterTimestamp(a: string, b: string): string {
  return new Date(b).valueOf() > new Date(a).valueOf() ? b : a;
}

export function mergeContentPackTrust(
  stored: ContentPackTrustState | null,
  proposed: ContentPackTrustState
): ContentPackTrustState {
  if (!stored || stored.packId !== proposed.packId || stored.channel !== proposed.channel) return proposed;
  const keyset =
    stored.keysetVersion > proposed.keysetVersion
      ? { keysetVersion: stored.keysetVersion, keysetSha256: stored.keysetSha256 }
      : { keysetVersion: proposed.keysetVersion, keysetSha256: proposed.keysetSha256 };
  const storedAhead =
    stored.epoch > proposed.epoch || (stored.epoch === proposed.epoch && stored.sequence > proposed.sequence);
  const position = storedAhead
    ? { epoch: stored.epoch, sequence: stored.sequence, manifestSha256: stored.manifestSha256 }
    : { epoch: proposed.epoch, sequence: proposed.sequence, manifestSha256: proposed.manifestSha256 };
  return {
    ...proposed,
    ...keyset,
    ...position,
    authorizedEpoch: Math.max(stored.authorizedEpoch, proposed.authorizedEpoch),
    greatestCreatedAt: laterTimestamp(stored.greatestCreatedAt, proposed.greatestCreatedAt),
    revokedKeyIds: [...new Set([...stored.revokedKeyIds, ...proposed.revokedKeyIds])].sort(),
  };
}

export async function writeContentPackTrust(paths: ContentPackPaths, trust: ContentPackTrustState): Promise<void> {
  const file = trustPath(paths, trust.packId, trust.channel);
  const stored = await readJson<ContentPackTrustState>(file);
  const merged = validTrustShape(stored, trust.packId, trust.channel) ? mergeContentPackTrust(stored, trust) : trust;
  await writeDurable(file, jsonBytes(merged));
}

function validPointer(
  value: ContentPackSlotIdentity | null,
  packId: ContentPackId,
  channel: ContentPackChannel
): value is ContentPackSlotIdentity {
  return Boolean(
    value &&
    value.packId === packId &&
    value.channel === channel &&
    Number.isSafeInteger(value.epoch) &&
    Number.isSafeInteger(value.sequence) &&
    /^[a-f0-9]{64}$/u.test(value.manifestSha256) &&
    /^e\d+-s\d+-[a-f0-9]{64}$/u.test(value.slotName)
  );
}

function markerExists(dir: string, markerFile: string): boolean {
  return existsSync(path.join(dir, markerFile));
}

export type ContentPackCompatibilityCheck = (manifest: ContentPackManifest) => boolean;

const STORED_MANIFEST_MAX_BYTES = 256 * 1024;

function slotValidSync(
  dir: string,
  identity: ContentPackSlotIdentity,
  markerFile: string,
  compatible?: ContentPackCompatibilityCheck
): boolean {
  try {
    const manifestRaw = readFileSync(path.join(dir, "manifest.json"));
    if (createHash("sha256").update(manifestRaw).digest("hex") !== identity.manifestSha256) return false;
    if (compatible) {
      const decoded = decodeManifest(manifestRaw, STORED_MANIFEST_MAX_BYTES);
      if (
        !decoded.ok ||
        decoded.value.packId !== identity.packId ||
        decoded.value.channel !== identity.channel ||
        decoded.value.epoch !== identity.epoch ||
        decoded.value.sequence !== identity.sequence ||
        !compatible(decoded.value)
      ) {
        return false;
      }
    }
    const manifest = JSON.parse(manifestRaw.toString("utf8")) as {
      contents?: Array<{ path: string; size: number; sha256: string }>;
    };
    if (!Array.isArray(manifest.contents) || !manifest.contents.some((entry) => entry.path === markerFile))
      return false;
    for (const entry of manifest.contents) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(entry.path) || entry.path.includes("..")) return false;
      const file = path.join(dir, ...entry.path.split("/"));
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) return false;
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== entry.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function pointerCandidate(
  paths: ContentPackPaths,
  identity: ContentPackSlotIdentity | null,
  packId: ContentPackId,
  channel: ContentPackChannel,
  markerFile: string,
  source: "downloaded" | "previous",
  compatible?: ContentPackCompatibilityCheck
): SelectedContentPack | null {
  if (!validPointer(identity, packId, channel)) return null;
  const dir = slotDir(paths, identity);
  return slotValidSync(dir, identity, markerFile, compatible) ? { dir, source, identity } : null;
}

export function readEmbeddedContentIdentitySync(
  bundledDir: string,
  packId: ContentPackId,
  channel: ContentPackChannel
): EmbeddedContentIdentity | undefined {
  let manifestRaw: Buffer;
  try {
    manifestRaw = readFileSync(path.join(bundledDir, "manifest.json"));
  } catch {
    return undefined;
  }
  const decoded = decodeManifest(manifestRaw, STORED_MANIFEST_MAX_BYTES);
  if (!decoded.ok || decoded.value.packId !== packId || decoded.value.channel !== channel) return undefined;
  return {
    epoch: decoded.value.epoch,
    sequence: decoded.value.sequence,
    manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
  };
}

export function selectContentPackSync(options: {
  paths: ContentPackPaths;
  packId: ContentPackId;
  channel: ContentPackChannel;
  markerFile: string;
  embeddedIdentity?: EmbeddedContentIdentity;
  compatible?: ContentPackCompatibilityCheck;
}): SelectedContentPack {
  const root = packRoot(options.paths, options.packId, options.channel);
  const active = readJsonSync<ContentPackSlotIdentity>(path.join(root, "active.json"));
  const previous = readJsonSync<ContentPackSlotIdentity>(path.join(root, "previous.json"));
  const quarantine = readJsonSync<QuarantineState>(path.join(root, "quarantine.json"));
  const quarantined = (identity: ContentPackSlotIdentity | null): boolean =>
    Boolean(
      identity &&
      quarantine?.entries.some(
        (entry) =>
          entry.epoch === identity.epoch &&
          entry.sequence === identity.sequence &&
          entry.manifestSha256 === identity.manifestSha256
      )
    );
  const activeCandidate = pointerCandidate(
    options.paths,
    quarantined(active) ? null : active,
    options.packId,
    options.channel,
    options.markerFile,
    "downloaded",
    options.compatible
  );
  const previousCandidate = pointerCandidate(
    options.paths,
    quarantined(previous) ? null : previous,
    options.packId,
    options.channel,
    options.markerFile,
    "previous",
    options.compatible
  );
  const downloaded = activeCandidate ?? previousCandidate;
  if (downloaded && options.embeddedIdentity) {
    const embedded = options.embeddedIdentity;
    const local = downloaded.identity!;
    if (embedded.epoch > local.epoch || (embedded.epoch === local.epoch && embedded.sequence > local.sequence)) {
      return { dir: options.paths.bundledDir, source: "embedded", identity: null };
    }
  }
  return downloaded ?? { dir: options.paths.bundledDir, source: "embedded", identity: null };
}

export async function repairContentPackSelection(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel,
  markerFile: string,
  now: Date
): Promise<void> {
  for (const pointer of ["active.json", "previous.json"]) {
    const identity = await readJson<ContentPackSlotIdentity>(statePath(paths, packId, channel, pointer));
    if (validPointer(identity, packId, channel) && !slotValidSync(slotDir(paths, identity), identity, markerFile)) {
      await quarantineContentPack(paths, identity, "slot-unreadable", now);
    }
  }
}

export async function quarantineContentPack(
  paths: ContentPackPaths,
  identity: ContentPackSlotIdentity,
  reason: string,
  now: Date
): Promise<void> {
  const file = statePath(paths, identity.packId, identity.channel, "quarantine.json");
  const current = (await readJson<QuarantineState>(file)) ?? { schemaVersion: 1, entries: [] };
  const without = current.entries.filter(
    (entry) =>
      !(
        entry.epoch === identity.epoch &&
        entry.sequence === identity.sequence &&
        entry.manifestSha256 === identity.manifestSha256
      )
  );
  without.push({ ...identity, reason: reason.slice(0, 80), quarantinedAt: now.toISOString() });
  await writeDurable(file, jsonBytes({ schemaVersion: 1, entries: without.slice(-64) }));
}

export async function recoverContentPackTransaction(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel,
  markerFile: string,
  fault?: (point: StorageFaultPoint) => void | Promise<void>
): Promise<void> {
  const journalFile = statePath(paths, packId, channel, "transaction.json");
  const journal = await readJson<ActivationJournal>(journalFile);
  if (!journal || journal.schemaVersion !== 1 || !validPointer(journal.candidate, packId, channel)) {
    if (journal) await removeDurable(journalFile);
    return;
  }
  const candidateDir = slotDir(paths, journal.candidate);
  if (!markerExists(candidateDir, markerFile)) {
    await removeDurable(journalFile);
    return;
  }
  await writeContentPackTrust(paths, journal.proposedTrust);
  await fault?.("trust-written");
  if (journal.oldActive)
    await writeDurable(statePath(paths, packId, channel, "previous.json"), jsonBytes(journal.oldActive));
  else await removeDurable(statePath(paths, packId, channel, "previous.json"));
  await fault?.("previous-written");
  await writeDurable(statePath(paths, packId, channel, "active.json"), jsonBytes(journal.candidate));
  await fault?.("active-written");
  await removeDurable(journalFile);
  await fault?.("journal-cleared");
}

async function writeSlotFiles(staging: string, options: ActivationOptions): Promise<void> {
  await mkdir(staging, { recursive: false });
  await writeFile(path.join(staging, "manifest.json"), options.manifestRaw, { flag: "wx" });
  await writeFile(path.join(staging, "manifest.sig"), options.signatureRaw, { flag: "wx" });
  for (const [relative, bytes] of options.files) {
    const file = path.join(staging, ...relative.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
  await options.fault?.("slot-files-written");
  const files = ["manifest.json", "manifest.sig", ...options.files.keys()];
  for (const relative of files) {
    const file = path.join(staging, ...relative.split("/"));
    // Write access is required: on Windows `sync()` is `FlushFileBuffers`, which
    // refuses a read-only handle with EPERM. "r+" neither creates nor truncates,
    // so the bytes just written stay untouched; POSIX fsync is unchanged.
    const handle = await open(file, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await syncDirectory(staging);
  await options.fault?.("slot-files-flushed");
}

function slotIdentity(verified: VerifiedManifest, now: Date): ContentPackSlotIdentity {
  const manifest = verified.manifest;
  return {
    packId: manifest.packId,
    channel: manifest.channel,
    epoch: manifest.epoch,
    sequence: manifest.sequence,
    version: manifest.version,
    manifestSha256: verified.manifestSha256,
    signerKeyId: verified.signerKeyId,
    sourceCommit: manifest.source.commit,
    installedAt: now.toISOString(),
    slotName: `e${manifest.epoch}-s${manifest.sequence}-${verified.manifestSha256}`,
  };
}

export async function activateContentPack(options: ActivationOptions): Promise<ContentPackSlotIdentity> {
  const identity = slotIdentity(options.verified, options.now);
  const root = packRoot(options.paths, identity.packId, identity.channel);
  const slots = path.join(root, "slots");
  await mkdir(slots, { recursive: true });
  const finalDir = slotDir(options.paths, identity);
  if (!existsSync(finalDir)) {
    const staging = path.join(root, `.staging-${randomBytes(12).toString("hex")}`);
    try {
      await writeSlotFiles(staging, options);
      for (const [relative, expected] of options.files) {
        const actual = await readFile(path.join(staging, ...relative.split("/")));
        if (createHash("sha256").update(actual).digest("hex") !== createHash("sha256").update(expected).digest("hex")) {
          throw new Error(`post-write hash mismatch for ${relative}`);
        }
      }
      await rename(staging, finalDir);
      await syncDirectory(slots);
      await options.fault?.("slot-renamed");
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  const activeFile = statePath(options.paths, identity.packId, identity.channel, "active.json");
  const oldActive = await readJson<ContentPackSlotIdentity>(activeFile);
  const journal: ActivationJournal = {
    schemaVersion: 1,
    oldActive: validPointer(oldActive, identity.packId, identity.channel) ? oldActive : null,
    candidate: identity,
    proposedTrust: activatedTrust(options.verified),
  };
  await writeDurable(
    statePath(options.paths, identity.packId, identity.channel, "transaction.json"),
    jsonBytes(journal)
  );
  await options.fault?.("journal-written");
  await recoverContentPackTransaction(
    options.paths,
    identity.packId,
    identity.channel,
    options.verified.manifest.packId === "cbe-skill" ? "SKILL.md" : "index.json",
    options.fault
  );
  return identity;
}

export async function resetContentPackTrust(
  paths: ContentPackPaths,
  packId: ContentPackId,
  channel: ContentPackChannel,
  confirmation: string,
  now: Date
): Promise<void> {
  const required = `RESET ${packId} ${channel} TRUST`;
  if (confirmation !== required) throw new Error(`trust reset requires exact confirmation: ${required}`);
  const auditFile = statePath(paths, packId, channel, "audit.jsonl");
  let lines: string[] = [];
  try {
    lines = (await readFile(auditFile, "utf8")).split("\n").filter(Boolean);
  } catch {
    // First support event.
  }
  lines.push(
    JSON.stringify({
      schemaVersion: 1,
      at: now.toISOString(),
      packId,
      channel,
      status: "trust-reset",
      code: "explicit-support-confirmation",
    })
  );
  await writeDurable(auditFile, Buffer.from(`${lines.slice(-200).join("\n")}\n`, "utf8"));
  await removeDurable(trustPath(paths, packId, channel));
}
