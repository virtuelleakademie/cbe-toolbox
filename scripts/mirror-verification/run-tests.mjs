#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const selection = JSON.parse(
  await readFile(path.join(repoRoot, "scripts/mirror-verification/test-selection.json"), "utf8")
);

async function walk(relative) {
  const absolute = path.join(repoRoot, relative);
  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}

const discovered = (await Promise.all(selection.roots.map((root) => walk(root))))
  .flat()
  .filter((file) => selection.suffixes.some((suffix) => file.endsWith(suffix)))
  .sort();

let selected = discovered;
const canonicalManifestPath = path.join(repoRoot, "mirror/mirror-tests.json");
if (existsSync(canonicalManifestPath)) {
  const manifest = JSON.parse(await readFile(canonicalManifestPath, "utf8"));
  const canonicalOnly = new Set(manifest.canonicalOnly.map((entry) => entry.path));
  selected = discovered.filter((file) => !canonicalOnly.has(file));
}

const pathsSha256 = createHash("sha256").update(selected.join("\n")).digest("hex");
if (selected.length !== selection.mirrorSafeCount || pathsSha256 !== selection.pathsSha256) {
  throw new Error(
    `mirror-safe test selection drifted (count ${selected.length}, sha256 ${pathsSha256}); ` +
      "refresh mirror/mirror-tests.json and scripts/mirror-verification/test-selection.json"
  );
}

const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitest)) throw new Error("vitest is not installed; run npm ci first");

const electronLayout = "packages/app/tests/first-use-onboarding-layout.test.ts";
const groups = [
  {
    name: "app",
    root: "packages/app",
    files: selected.filter((file) => file.startsWith("packages/app/tests/") && file !== electronLayout),
  },
  {
    name: "corpus-schema",
    root: "packages/corpus-schema",
    files: selected.filter((file) => file.startsWith("packages/corpus-schema/tests/")),
  },
  {
    name: "pi-bridge",
    root: "packages/pi-bridge",
    files: selected.filter((file) => file.startsWith("packages/pi-bridge/tests/")),
  },
  {
    name: "eval-runner",
    root: "evaluation/cbe-skill/runner",
    files: selected.filter((file) => file.startsWith("evaluation/cbe-skill/runner/tests/")),
  },
];

function run(name, cwd, args, env = process.env) {
  process.stdout.write(`\n=== mirror-safe tests: ${name} ===\n`);
  const result = spawnSync(process.execPath, [vitest, ...args], {
    cwd: path.join(repoRoot, cwd),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const group of groups) {
  if (group.files.length === 0) throw new Error(`mirror-safe test group ${group.name} is empty`);
  const relativeFiles = group.files.map((file) => path.relative(group.root, file).split(path.sep).join("/"));
  run(group.name, group.root, ["run", ...relativeFiles]);
}

if (!selected.includes(electronLayout)) throw new Error(`${electronLayout} is missing from the mirror-safe selection`);
const electronEnv = process.platform === "linux" ? { ...process.env, CBE_ELECTRON_LAYOUT: "required" } : process.env;
run(
  "app real-renderer layout",
  "packages/app",
  ["run", "--config", "vitest.electron.config.ts", "tests/first-use-onboarding-layout.test.ts"],
  electronEnv
);

process.stdout.write(`\nMirror-safe test manifest passed: ${selected.length} files (${pathsSha256}).\n`);
