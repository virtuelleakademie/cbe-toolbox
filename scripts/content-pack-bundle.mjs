#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  CORPUS_COMPATIBILITY_CONTRACT,
  DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createUnsignedContentPack,
  writeUnsignedContentPack,
} from "@cbe/corpus-schema";
import { SKILL_BODY_BUDGET, SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";

function args(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    out.set(key.slice(2), value);
  }
  return out;
}

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function cleanSource(sourceDir) {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", sourceDir], {
    encoding: "utf8",
  });
  if (status.trim()) throw new Error(`${sourceDir} is not clean at the reviewed commit`);
}

const values = args(process.argv.slice(2));
const packArg = required(values, "pack");
if (packArg !== "skill" && packArg !== "corpus") throw new Error("--pack must be skill or corpus");
const channel = required(values, "channel");
if (channel !== "stable") throw new Error("--channel must be stable");
const sourceDir = path.resolve(values.get("source") ?? (packArg === "skill" ? "skills/cbe" : "corpus"));
const outDir = path.resolve(required(values, "out"));
const createdAt = new Date(required(values, "created-at"));
const expiresAt = new Date(required(values, "expires-at"));
const epoch = Number(required(values, "epoch"));
const sequence = Number(required(values, "sequence"));
if (Number.isNaN(createdAt.valueOf()) || Number.isNaN(expiresAt.valueOf()))
  throw new Error("timestamps must be valid UTC dates");
cleanSource(path.relative(process.cwd(), sourceDir));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const pack = await createUnsignedContentPack({
  packId: packArg === "skill" ? "cbe-skill" : "cbe-corpus",
  channel,
  epoch,
  sequence,
  sourceDir,
  sourceCommit,
  sourceProvenance: values.get("source-provenance") ?? DEFAULT_CONTENT_PACK_PRODUCT_PROVENANCE,
  createdAt,
  expiresAt,
  compatibility: packArg === "skill" ? SKILL_COMPATIBILITY_CONTRACT : CORPUS_COMPATIBILITY_CONTRACT,
  ...(packArg === "skill" ? { skillBodyBudget: SKILL_BODY_BUDGET } : {}),
});
await writeUnsignedContentPack(pack, outDir);
process.stdout.write(
  `${pack.manifest.packId} ${pack.manifest.channel} e${pack.manifest.epoch}-s${pack.manifest.sequence} ` +
    `${pack.manifest.version} ${pack.manifest.artifact.sha256}\n`
);
