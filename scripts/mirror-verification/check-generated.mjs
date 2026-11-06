#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "packages/corpus-schema/dist/cli.js");
const scratch = await mkdtemp(path.join(os.tmpdir(), "cbe-mirror-freshness-"));

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function assertSame(actual, expected, label) {
  const [actualBytes, expectedBytes] = await Promise.all([readFile(actual), readFile(expected)]);
  if (!actualBytes.equals(expectedBytes)) throw new Error(`${label} is stale`);
}

try {
  const corpusRoot = path.join(scratch, "corpus");
  await cp(path.join(repoRoot, "corpus/content"), path.join(corpusRoot, "content"), { recursive: true });
  const generatedIndex = path.join(corpusRoot, "index.json");
  run(["index", path.join(corpusRoot, "content"), generatedIndex]);
  await assertSame(generatedIndex, path.join(repoRoot, "corpus/index.json"), "corpus/index.json");

  const generatedGuide = path.join(scratch, "ui-guide.md");
  run(["ui-reference", path.join(repoRoot, "packages/app/src/renderer"), generatedGuide]);
  await assertSame(
    generatedGuide,
    path.join(repoRoot, "skills/cbe/references/ui-guide.md"),
    "skills/cbe/references/ui-guide.md"
  );
  process.stdout.write("Included generated files are fresh: corpus index and UI reference.\n");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
