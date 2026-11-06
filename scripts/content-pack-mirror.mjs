#!/usr/bin/env node
/* global fetch */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";
import { decodeKeyset, decodeManifest, decodeSignatureWrapper, verifyEd25519 } from "@cbe/corpus-schema";

export const PACKS = ["skill", "corpus"];
export const CHANNELS = ["stable"];
export const INVENTORY_NAME = "objects.json";
const IMMUTABLE_NAME =
  /^(?:e[1-9]\d*-s[1-9]\d*-[a-f0-9]{64}\.(?:json|sig)|cbe-(?:skill|corpus)-e[1-9]\d*-s[1-9]\d*-[a-f0-9]{64}\.zip)$/u;
const MUTABLE_NAMES = ["keyset.json", "keyset.sig", "latest.json", "latest.sig"];
const MAX_OBJECT_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_INVENTORY_ENTRIES = 4096;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function channelDir(planDir, pack, channel) {
  return path.join(planDir, `${pack}-dist`, "v2", channel);
}

export function channelUrl(origin, pack, channel) {
  return new URL(`/delivery/v2/${pack}/${channel}/`, origin);
}

class NotFound extends Error {}

async function read(fetchImpl, url, max) {
  const response = await fetchImpl(url, { redirect: "manual", credentials: "omit", headers: {} });
  if (response.redirected || (response.status >= 300 && response.status < 400))
    throw new Error(`redirect refused: ${url}`);
  if (response.status === 404) throw new NotFound(String(url));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > max) throw new Error(`body too large: ${url}`);
  return bytes;
}

export function decodeInventory(raw) {
  const parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.objects)) throw new Error("inventory invalid");
  if (parsed.objects.length > MAX_INVENTORY_ENTRIES) throw new Error("inventory too large");
  const seen = new Set();
  for (const entry of parsed.objects) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      !IMMUTABLE_NAME.test(entry.name) ||
      seen.has(entry.name) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error("inventory entry invalid");
    }
    seen.add(entry.name);
  }
  return parsed.objects;
}

export function verifyChannelSnapshot(files, { pack, channel, rootKeyId, rootPublicKeySpki }) {
  if (!rootKeyId || !rootPublicKeySpki)
    throw new Error(`${pack}/${channel}: published, but no root trust was supplied`);
  const required = (name) => {
    const bytes = files.get(name);
    if (!bytes) throw new Error(`${pack}/${channel}: missing ${name}`);
    return bytes;
  };
  const keysetRaw = required("keyset.json");
  const rootWrapper = decodeSignatureWrapper(required("keyset.sig"));
  if (!rootWrapper.ok || rootWrapper.value.keyId !== rootKeyId) throw new Error(`${pack}/${channel}: root wrapper`);
  if (!verifyEd25519(keysetRaw, rootWrapper.value.signature, rootPublicKeySpki))
    throw new Error(`${pack}/${channel}: root signature`);
  const keyset = decodeKeyset(keysetRaw, MAX_METADATA_BYTES);
  if (!keyset.ok || keyset.value.packId !== `cbe-${pack}`) throw new Error(`${pack}/${channel}: keyset`);
  const manifestRaw = required("latest.json");
  const manifestSignatureRaw = required("latest.sig");
  const wrapper = decodeSignatureWrapper(manifestSignatureRaw);
  if (!wrapper.ok) throw new Error(`${pack}/${channel}: manifest wrapper`);
  const target = keyset.value.targets.find(
    (candidate) => candidate.keyId === wrapper.value.keyId && candidate.channel === channel
  );
  if (!target || !verifyEd25519(manifestRaw, wrapper.value.signature, target.publicKeySpki))
    throw new Error(`${pack}/${channel}: manifest signature`);
  const manifest = decodeManifest(manifestRaw, MAX_METADATA_BYTES);
  if (!manifest.ok || manifest.value.packId !== `cbe-${pack}` || manifest.value.channel !== channel)
    throw new Error(`${pack}/${channel}: manifest`);
  const versionedBase = `e${manifest.value.epoch}-s${manifest.value.sequence}-${sha256(manifestRaw)}`;
  if (!Buffer.from(required(`${versionedBase}.json`)).equals(Buffer.from(manifestRaw)))
    throw new Error(`${pack}/${channel}: latest differs from immutable manifest`);
  if (!Buffer.from(required(`${versionedBase}.sig`)).equals(Buffer.from(manifestSignatureRaw)))
    throw new Error(`${pack}/${channel}: latest signature differs from immutable copy`);
  const artifact = required(manifest.value.artifact.name);
  if (artifact.byteLength !== manifest.value.artifact.size || sha256(artifact) !== manifest.value.artifact.sha256)
    throw new Error(`${pack}/${channel}: artifact`);
  return manifest.value;
}

export async function pullChannel({ fetchImpl = fetch, origin, pack, channel, rootKeyId, rootPublicKeySpki }) {
  const base = channelUrl(origin, pack, channel);
  let inventoryRaw;
  try {
    inventoryRaw = await read(fetchImpl, new URL(INVENTORY_NAME, base), MAX_METADATA_BYTES);
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    for (const name of MUTABLE_NAMES) {
      try {
        await read(fetchImpl, new URL(name, base), MAX_METADATA_BYTES);
      } catch (inner) {
        if (inner instanceof NotFound) continue;
        throw inner;
      }
      throw new Error(`${pack}/${channel}: ${name} is published but ${INVENTORY_NAME} is missing`);
    }
    return null;
  }
  const inventory = decodeInventory(inventoryRaw);
  const files = new Map([[INVENTORY_NAME, inventoryRaw]]);
  for (const name of MUTABLE_NAMES) files.set(name, await read(fetchImpl, new URL(name, base), MAX_METADATA_BYTES));
  for (const entry of inventory) {
    const bytes = await read(fetchImpl, new URL(entry.name, base), MAX_OBJECT_BYTES);
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256)
      throw new Error(`${pack}/${channel}: ${entry.name} does not match its inventory entry`);
    files.set(entry.name, bytes);
  }
  verifyChannelSnapshot(files, { pack, channel, rootKeyId, rootPublicKeySpki });
  return files;
}

export async function writeChannel(dir, files) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const [name, bytes] of files) await fs.writeFile(path.join(dir, name), bytes, { flag: "wx" });
}

export async function readChannel(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const files = new Map();
  for (const name of names.sort()) files.set(name, new Uint8Array(await fs.readFile(path.join(dir, name))));
  return files;
}

export function inventoryBytes(files) {
  const objects = [...files.keys()]
    .filter((name) => IMMUTABLE_NAME.test(name))
    .sort()
    .map((name) => ({ name, size: files.get(name).byteLength, sha256: sha256(files.get(name)) }));
  return Buffer.from(`${JSON.stringify({ schemaVersion: 1, objects }, null, 2)}\n`, "utf8");
}

export async function writeInventory(dir) {
  const files = await readChannel(dir);
  if (!files) throw new Error(`${dir} does not exist`);
  files.delete(INVENTORY_NAME);
  const previous = await fs.readFile(path.join(dir, INVENTORY_NAME)).catch(() => null);
  if (previous) {
    for (const entry of decodeInventory(previous)) {
      const bytes = files.get(entry.name);
      if (!bytes || bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256)
        throw new Error(`${dir}: previously published ${entry.name} is missing or changed`);
    }
  }
  await fs.writeFile(path.join(dir, INVENTORY_NAME), inventoryBytes(files));
}

export function assertPreserved(expected, actual, label) {
  for (const [name, bytes] of expected) {
    const served = actual?.get(name);
    if (!served || !Buffer.from(served).equals(Buffer.from(bytes))) throw new Error(`${label}: ${name} not preserved`);
  }
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

function optional(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

async function main() {
  const mode = value("--mode");
  if (mode === "inventory") {
    await writeInventory(value("--dir"));
    return;
  }
  const origin = value("--origin");
  const planDir = value("--plan-dir");
  const rootKeyId = optional("--root-key-id");
  const rootPublicKeySpki = optional("--root-spki");
  for (const pack of PACKS) {
    for (const channel of CHANNELS) {
      const dir = channelDir(planDir, pack, channel);
      const live = await pullChannel({ origin, pack, channel, rootKeyId, rootPublicKeySpki });
      if (mode === "pull") {
        if (live) await writeChannel(dir, live);
        else await fs.rm(dir, { recursive: true, force: true });
        process.stdout.write(`${pack}/${channel}: ${live ? `${live.size} object(s) mirrored` : "not published"}\n`);
      } else if (mode === "check") {
        const local = await readChannel(dir);
        if (!local) {
          if (live) throw new Error(`${pack}/${channel}: served but absent from the deployed tree`);
          continue;
        }
        assertPreserved(local, live, `${pack}/${channel}`);
        process.stdout.write(`${pack}/${channel}: ${local.size} object(s) preserved\n`);
      } else {
        throw new Error("--mode must be pull, check or inventory");
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
