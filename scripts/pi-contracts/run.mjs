#!/usr/bin/env node
/**
 * Runs the Pi upgrade contract groups (capability `agent-harness`, Requirement:
 * *Pi Upgrades Are Proven Through a Public Contract Harness*; change
 * `guard-pi-upgrades-with-contract-tests`, task 1.2).
 *
 *   npm run pi:contracts                       # every group
 *   npm run pi:contracts -- --group lifecycle  # one group (repeatable, or a,b)
 *   npm run pi:contracts -- --list             # groups, owners and files
 *   npm run pi:contracts -- --report out.json  # machine-readable result
 *
 * The matrix is `packages/pi-bridge/tests/contracts/groups.json`. Each group
 * runs as its own vitest invocation per workspace, so a red group names its
 * failure domain and its owner, and the runner checks that vitest executed
 * EXACTLY the files the group lists — a filter that silently matched a sibling,
 * or a file that no longer loads, is a failure, not a smaller green run.
 *
 * Exit codes: 0 every selected group green · 1 a group red · 2 usage error.
 * A green run says what it did not prove (NOT_PROVEN, also printed by the
 * candidate-upgrade gate). docs/pi-upgrades.md is the reader's guide.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO = path.resolve(HERE, "..", "..");
export const GROUPS_FILE = "packages/pi-bridge/tests/contracts/groups.json";

export const NOT_PROVEN = [
  "A green contract run proves deterministic Pi SDK mechanics against the scripted",
  "provider, and nothing else. It does NOT prove, and these remain separate",
  "acceptance obligations before a dependency update is accepted:",
  "  - the full builds and suites: `npm run build`, `npm test`;",
  "  - the real Electron renderer: `npm run test:electron --workspace packages/app`;",
  "  - lint and formatting: `npm run lint`;",
  "  - specs and traceability: `openspec validate --all --strict`, `npm run trace:check`,",
  "    `npm run archive:check`;",
  "  - wire behaviour against a real provider endpoint, and model or skill behaviour:",
  "    a live-model `npm run eval` wherever an instruction or model-visible surface changed;",
  "  - the integrity of installed files beyond their version identity.",
].join("\n");

export function loadGroups(repo = DEFAULT_REPO) {
  return JSON.parse(readFileSync(path.join(repo, GROUPS_FILE), "utf8"));
}

/** The workspace directory (repo-relative) that owns a repo-relative file. */
export function workspaceOf(repo, file) {
  let dir = path.dirname(file);
  while (dir && dir !== ".") {
    if (existsSync(path.join(repo, dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`no workspace owns ${file}`);
}

/** Group a contract group's files by owning workspace, in listing order. */
export function planGroup(repo, group) {
  const byWorkspace = new Map();
  for (const file of group.files) {
    const ws = workspaceOf(repo, file);
    if (!byWorkspace.has(ws)) byWorkspace.set(ws, []);
    byWorkspace.get(ws).push(path.relative(ws, file).split(path.sep).join("/"));
  }
  return [...byWorkspace.entries()].map(([workspace, files]) => ({ workspace, files }));
}

function runVitest(repo, workspace, files, log) {
  const vitest = path.join(repo, "node_modules", "vitest", "vitest.mjs");
  const scratch = mkdtempSync(path.join(tmpdir(), "cbe-pi-contracts-"));
  const report = path.join(scratch, "report.json");
  try {
    const res = spawnSync(
      process.execPath,
      [vitest, "run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...files],
      { cwd: path.join(repo, workspace), stdio: ["ignore", "inherit", "inherit"], env: process.env }
    );
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(report, "utf8"));
    } catch {
      parsed = undefined;
    }
    const expected = new Set(files.map((f) => path.resolve(repo, workspace, f)));
    const executed = new Set((parsed?.testResults ?? []).map((r) => path.resolve(r.name)));
    const missing = [...expected].filter((f) => !executed.has(f)).map((f) => path.relative(repo, f));
    const unexpected = [...executed].filter((f) => !expected.has(f)).map((f) => path.relative(repo, f));
    const failedTests = parsed?.numFailedTests ?? 0;
    const ok = res.status === 0 && parsed !== undefined && missing.length === 0 && unexpected.length === 0;
    if (!ok) {
      if (missing.length) log(`  files the group lists but vitest did not run: ${missing.join(", ")}`);
      if (unexpected.length) log(`  files vitest ran that the group does not list: ${unexpected.join(", ")}`);
    }
    return {
      workspace,
      ok,
      exitCode: res.status,
      tests: parsed?.numTotalTests ?? 0,
      failedTests,
      missing,
      unexpected,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Run the named groups (all when `names` is empty). Returns one result per group. */
export function runGroups({ repo = DEFAULT_REPO, names = [], log = console.log } = {}) {
  const { groups } = loadGroups(repo);
  const selected = names.length ? names : Object.keys(groups);
  const unknown = selected.filter((n) => !(n in groups));
  if (unknown.length) throw new UsageError(`unknown contract group(s): ${unknown.join(", ")}`);
  const results = [];
  for (const name of selected) {
    log(`\n=== contract group: ${name}\n    owner: ${groups[name].owner}`);
    const runs = planGroup(repo, groups[name]).map((p) => runVitest(repo, p.workspace, p.files, log));
    results.push({ group: name, owner: groups[name].owner, ok: runs.every((r) => r.ok), runs });
  }
  return results;
}

export class UsageError extends Error {}

export function summarize(results) {
  const lines = ["", "Pi contract groups:"];
  for (const r of results) {
    const tests = r.runs.reduce((n, x) => n + x.tests, 0);
    const failed = r.runs.reduce((n, x) => n + x.failedTests, 0);
    lines.push(`  ${r.ok ? "PASS" : "FAIL"}  ${r.group.padEnd(16)} ${tests} tests, ${failed} failed`);
    if (!r.ok) lines.push(`        owner: ${r.owner}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { names: [], list: false, report: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") opts.list = true;
    else if (arg === "--group") {
      const value = argv[++i];
      if (!value) throw new UsageError("--group needs a name");
      opts.names.push(...value.split(",").filter(Boolean));
    } else if (arg.startsWith("--group=")) opts.names.push(...arg.slice(8).split(",").filter(Boolean));
    else if (arg === "--report") opts.report = argv[++i];
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), { repo = DEFAULT_REPO, log = console.log } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.list) {
      const { groups } = loadGroups(repo);
      for (const [name, group] of Object.entries(groups)) {
        log(`${name}\n  owner: ${group.owner}\n${group.files.map((f) => `  - ${f}`).join("\n")}`);
      }
      return 0;
    }
    const results = runGroups({ repo, names: opts.names, log });
    log(summarize(results));
    const green = results.every((r) => r.ok);
    log(`\n${green ? "All selected contract groups passed." : "Contract groups FAILED."}\n\n${NOT_PROVEN}`);
    if (opts.report) writeFileSync(opts.report, JSON.stringify({ green, results }, null, 2) + "\n");
    return green ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) {
      log(`pi:contracts: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
