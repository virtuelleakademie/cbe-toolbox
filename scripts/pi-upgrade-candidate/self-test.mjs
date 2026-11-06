#!/usr/bin/env node
/**
 * Self-test of the Pi candidate-upgrade gate (capability `agent-harness`,
 * Requirement: *Pi Upgrades Are Proven Through a Public Contract Harness*,
 * Scenarios: *Candidate upgrade runs in isolation* and *Contract success does
 * not replace release evidence*; change `guard-pi-upgrades-with-contract-tests`,
 * tasks 4.1 and 5.2).
 *
 * Deterministic and offline: every case runs the REAL gate against a throwaway
 * git repository shaped like this one, with `fixtures/fake-npm.mjs` standing in
 * for npm and a fake contract runner inside the fixture tree. The fixture's
 * WHOLE directory — `.git` included — is hashed before and after each run, so
 * "the caller is untouched" is checked byte for byte by the test, independently
 * of the gate's own fingerprint. The last case proves that fingerprint can fail.
 *
 * Run with `npm run pi:candidate:self-test` (part of the root `npm test`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, runCandidate, UsageError } from "./gate.mjs";
import { NOT_PROVEN } from "../pi-contracts/run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_NPM = path.join(HERE, "fixtures", "fake-npm.mjs");

const FAKE_CONTRACT_RUNNER = `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const report = args[args.indexOf("--report") + 1];
const failing = process.env.FAKE_CONTRACT_FAIL ?? "";
const results = ["lifecycle", "provider"].map((group) => ({ group, owner: group + "-owner", ok: group !== failing, runs: [] }));
const green = results.every((r) => r.ok);
writeFileSync(report, JSON.stringify({ green, results }));
process.exit(green ? 0 : 1);
`;

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

function git(root, ...args) {
  const res = spawnSync(
    "git",
    ["-C", root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
    {
      encoding: "utf8",
    }
  );
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** A miniature repository with the manifest shape the gate reads. */
function makeCaller() {
  const root = mkdtempSync(path.join(tmpdir(), "cbe-pi-candidate-caller-"));
  write(root, "package.json", { name: "fixture-repo", private: true, workspaces: ["packages/*"] });
  write(root, "packages/corpus-schema/package.json", { name: "@cbe/corpus-schema", scripts: { build: "x" } });
  write(root, "packages/pi-bridge/package.json", {
    name: "@cbe/pi-bridge",
    scripts: { build: "x" },
    dependencies: { "@earendil-works/pi-coding-agent": "1.3.0", typebox: "1.3.27" },
    devDependencies: { "@earendil-works/pi-ai": "1.3.0" },
  });
  write(root, "packages/app/package.json", { name: "@cbe/app", scripts: { build: "x" } });
  write(root, "package-lock.json", {
    name: "fixture-repo",
    lockfileVersion: 3,
    packages: {
      "node_modules/@earendil-works/pi-ai": { version: "1.3.0" },
      "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui": { version: "1.3.0" },
      "node_modules/left-pad": { version: "1.3.0" },
    },
  });
  write(root, "scripts/pi-contracts/run.mjs", FAKE_CONTRACT_RUNNER);
  write(root, "README.md", "fixture\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

/** Hash of every file under `root`, `.git` included, with its path and mode. */
function snapshot(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = path.join(dir, entry);
      const st = statSync(abs);
      hash.update(`${path.relative(root, abs)}\0${st.mode}\0`);
      if (st.isDirectory()) walk(abs);
      else hash.update(readFileSync(abs));
    }
  };
  walk(root);
  return hash.digest("hex");
}

const cases = [];
const test = (title, fn) => cases.push({ title, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Run the gate in a fresh caller; returns everything a case asserts on. */
function gate(argv, { env = {}, prepare } = {}) {
  const caller = makeCaller();
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "cbe-pi-candidate-tmproot-"));
  const scratch = mkdtempSync(path.join(tmpdir(), "cbe-pi-candidate-scratch-"));
  const npmLog = path.join(scratch, "npm.log");
  writeFileSync(npmLog, "");
  prepare?.(caller);
  const before = snapshot(caller);
  const saved = { ...process.env };
  Object.assign(process.env, { CBE_PI_CANDIDATE_NPM: FAKE_NPM, FAKE_NPM_LOG: npmLog }, env);
  const lines = [];
  let result;
  let usage;
  try {
    result = runCandidate({ repo: caller, argv: [...argv, "--tmp-root", tmpRoot], log: (l) => lines.push(l) });
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    usage = err;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  const outcome = {
    caller,
    result,
    usage,
    log: lines.join("\n"),
    npm: readFileSync(npmLog, "utf8"),
    callerUnchanged: snapshot(caller) === before,
    tmpLeft: readdirSync(tmpRoot),
  };
  rmSync(caller, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  return outcome;
}

const phase = (outcome, name) => outcome.result?.phases.find((p) => p.phase === name);

test("refuses a floating or inexact version set before touching anything", () => {
  for (const argv of [
    ["--pi", "latest"],
    ["--pi", "1.4"],
    ["--pi", "^1.4.0"],
    ["--pi", "next"],
    ["--set", "@earendil-works/pi-coding-agent@1.4.0"],
    ["--set", "left-pad@1.0.0", "--pi", "1.4.0"],
    [],
  ]) {
    const out = gate(argv);
    assert(out.usage, `${argv.join(" ")} was not refused`);
    assert(out.callerUnchanged, `${argv.join(" ")} changed the caller`);
    assert(out.tmpLeft.length === 0, `${argv.join(" ")} created temporary state`);
    assert(out.npm === "", `${argv.join(" ")} ran npm`);
  }
});

test("a green candidate leaves a clean caller byte-identical and removes its temporary checkout", () => {
  const out = gate(["--pi", "1.4.0"]);
  assert(out.result?.exitCode === EXIT.ok, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(out.callerUnchanged, "the caller changed");
  assert(out.tmpLeft.length === 0, `temporary state left: ${out.tmpLeft}`);
  // The candidate set — and only it — was installed, with lifecycle scripts off …
  assert(out.npm.includes("install --ignore-scripts"), out.npm);
  for (const pkg of ["@earendil-works/pi-coding-agent@1.4.0", "@earendil-works/pi-ai@1.4.0", "typebox@1.3.27"]) {
    assert(out.npm.includes(`resolved ${pkg}`), `${pkg} not resolved:\n${out.npm}`);
  }
  // The reviewed Pi lock entries were dropped for re-resolution; the rest stayed locked.
  assert(out.npm.includes("lock-before node_modules/left-pad\n"), out.npm);
  // … and the workspaces were built in dependency order before the contracts ran.
  const builds = out.npm.split("\n").filter((l) => l.startsWith("build "));
  assert(
    JSON.stringify(builds) ===
      JSON.stringify(["build packages/corpus-schema", "build packages/pi-bridge", "build packages/app"]),
    `build order: ${builds}`
  );
  assert(phase(out, "contract lifecycle")?.ok && phase(out, "contract provider")?.ok, out.log);
});

test("a green candidate leaves a dirty caller and its lockfile byte-identical", () => {
  const out = gate(["--set", "@earendil-works/pi-coding-agent@1.4.0", "--set", "@earendil-works/pi-ai@1.4.0"], {
    prepare: (caller) => {
      writeFileSync(path.join(caller, "README.md"), "edited, not staged\n");
      writeFileSync(path.join(caller, "package-lock.json"), '{ "dirty": "lockfile" }\n');
      writeFileSync(path.join(caller, "notes.txt"), "untracked\n");
      writeFileSync(path.join(caller, "packages", "app", "staged.txt"), "staged\n");
      git(caller, "add", "packages/app/staged.txt");
    },
  });
  assert(out.result?.exitCode === EXIT.ok, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(out.callerUnchanged, "the dirty caller changed");
  assert(out.tmpLeft.length === 0, "temporary state left");
  // The candidate was built from the COMMITTED tree, not from the dirty lockfile.
  assert(out.npm.includes("resolved @earendil-works/pi-coding-agent@1.4.0"), out.npm);
});

test("an install failure is reported as install and still cleans up", () => {
  for (const env of [{ FAKE_NPM_FAIL: "install" }, { FAKE_NPM_RESOLVE_STALE: "@earendil-works/pi-ai" }]) {
    const out = gate(["--pi", "1.4.0"], { env });
    assert(out.result?.exitCode === EXIT.install, `exit ${out.result?.exitCode}\n${out.log}`);
    assert(phase(out, "install")?.ok === false, out.log);
    assert(!out.npm.includes("build "), "built after a failed install");
    assert(out.callerUnchanged && out.tmpLeft.length === 0, "not cleaned up");
  }
});

test("a candidate npm installs under its workspace still counts as resolved", () => {
  const out = gate(["--pi", "1.4.0"], { env: { FAKE_NPM_WORKSPACE_LOCAL: "@earendil-works/pi-coding-agent" } });
  assert(out.result?.exitCode === EXIT.ok, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(phase(out, "install")?.ok === true, out.log);
});

test("a build failure is reported as build, not contract, and still cleans up", () => {
  const out = gate(["--pi", "1.4.0"], { env: { FAKE_NPM_FAIL: "build:packages/pi-bridge" } });
  assert(out.result?.exitCode === EXIT.build, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(phase(out, "build packages/pi-bridge")?.ok === false, out.log);
  assert(!out.result.phases.some((p) => p.phase.startsWith("contract")), "contracts ran after a failed build");
  assert(!out.npm.includes("build packages/app"), "later workspaces built after a failure");
  assert(out.callerUnchanged && out.tmpLeft.length === 0, "not cleaned up");
});

test("a contract failure is reported per group and exits non-zero", () => {
  const out = gate(["--pi", "1.4.0"], { env: { FAKE_CONTRACT_FAIL: "lifecycle" } });
  assert(out.result?.exitCode === EXIT.contract, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(phase(out, "contract lifecycle")?.ok === false, out.log);
  assert(phase(out, "contract lifecycle")?.detail === "owner: lifecycle-owner", out.log);
  assert(phase(out, "contract provider")?.ok === true, out.log);
  assert(out.log.includes("Do not update the manifests or the lockfile."), out.log);
  assert(out.callerUnchanged && out.tmpLeft.length === 0, "not cleaned up");
});

test("a green report states what it did not prove", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "cbe-pi-candidate-report-"));
  const report = path.join(scratch, "report.json");
  try {
    const out = gate(["--pi", "1.4.0", "--report", report]);
    assert(out.result?.exitCode === EXIT.ok, out.log);
    assert(out.log.includes(NOT_PROVEN), "the green log does not state what it did not prove");
    assert(out.log.includes("To accept it, make an ordinary change"), out.log);
    const json = JSON.parse(readFileSync(report, "utf8"));
    assert(json.green === true && json.notProven === NOT_PROVEN, "the report does not carry notProven");
    assert(json.candidate["@earendil-works/pi-coding-agent"] === "1.4.0", "the report does not name the candidate");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a run that touches the caller is reported as such (the fingerprint can fail)", () => {
  // Negative control for the gate's own fingerprint: the fake npm writes into
  // the caller's working tree while the gate runs.
  let touched;
  const out = gate(["--pi", "1.4.0"], {
    prepare: (caller) => (touched = path.join(caller, "README.md")),
    env: {
      get FAKE_NPM_TOUCH_CALLER() {
        return touched;
      },
    },
  });
  assert(out.result?.exitCode === EXIT.callerChanged, `exit ${out.result?.exitCode}\n${out.log}`);
  assert(phase(out, "caller untouched")?.ok === false, out.log);
  assert(!out.callerUnchanged, "the control did not touch the caller");
});

let failed = 0;
for (const { title, fn } of cases) {
  try {
    fn();
    console.log(`  ok    ${title}`);
  } catch (err) {
    failed += 1;
    console.log(
      `  FAIL  ${title}\n        ${String(err instanceof Error ? err.message : err)
        .split("\n")
        .join("\n        ")}`
    );
  }
}
console.log(`\npi-candidate self-test: ${cases.length - failed}/${cases.length} cases passed`);
process.exitCode = failed ? 1 : 0;
