#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { decodeManifest } from "@cbe/corpus-schema";

const MAX_METADATA_BYTES = 256 * 1024;

function decoded(raw, label) {
  const result = decodeManifest(raw, MAX_METADATA_BYTES);
  if (!result.ok) throw new Error(`${label} manifest refused`);
  return result.value;
}

async function readOptional(file) {
  try {
    return new Uint8Array(await fs.readFile(file));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function checkPublicationOrder({ candidate, live }) {
  if (candidate.channel !== "stable") throw new Error("only stable publication is supported");
  if (!live) return;
  if (live.packId !== candidate.packId || live.channel !== "stable")
    throw new Error("live channel belongs to another pack or channel");
  if (candidate.epoch < live.epoch || (candidate.epoch === live.epoch && candidate.sequence <= live.sequence)) {
    throw new Error(
      `e${candidate.epoch}-s${candidate.sequence} does not exceed the live e${live.epoch}-s${live.sequence}`
    );
  }
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

async function main() {
  const candidate = decoded(await fs.readFile(value("--manifest")), "candidate");
  const liveRaw = await readOptional(path.join(value("--live-dir"), "latest.json"));
  checkPublicationOrder({ candidate, live: liveRaw ? decoded(liveRaw, "live") : null });
  process.stdout.write(`${candidate.packId} ${candidate.channel} e${candidate.epoch}-s${candidate.sequence} ordered\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
