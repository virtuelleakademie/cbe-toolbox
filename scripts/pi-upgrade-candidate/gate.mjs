/**
 * The Pi candidate-upgrade gate (capability `agent-harness`, Requirement: *Pi
 * Upgrades Are Proven Through a Public Contract Harness*, Scenario: *Candidate
 * upgrade runs in isolation*; change `guard-pi-upgrades-with-contract-tests`,
 * task 4.1).
 *
 * Given ONE intentionally selected, exact Pi version set, it
 *
 *   1. refuses anything floating (`latest`, a tag, a range) and any set that
 *      does not name every Pi package the repository declares — before it
 *      touches anything;
 *   2. fingerprints the caller's worktree (HEAD, branch, index, status and the
 *      bytes of every manifest, the lockfile and every dirty path);
 *   3. exports the committed tree at `ref` with `git archive` into a fresh
 *      temporary directory — no worktree, no branch, no shared `.git` state;
 *   4. writes the candidate versions into that copy's manifests, installs with
 *      lifecycle scripts off (so no hook installer can reach a git config),
 *      and checks that npm resolved exactly the requested set;
 *   5. builds the affected workspaces in dependency order;
 *   6. runs the named contract groups there (`scripts/pi-contracts/run.mjs`);
 *   7. removes the temporary directory and re-checks the caller's fingerprint.
 *
 * Each phase reports separately, so an unsupported API (a build failure) and a
 * changed behaviour (a contract failure) are never confused. Accepting a green
 * candidate is an ordinary project change afterwards: update the manifests and
 * the lockfile, then run the repository's full validation. docs/pi-upgrades.md
 * is the operator's guide.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NOT_PROVEN } from "../pi-contracts/run.mjs";

export const EXIT = {
  ok: 0,
  contract: 1,
  usage: 2,
  install: 3,
  build: 4,
  callerChanged: 5,
  checkout: 6,
};

/** Workspaces in dependency order; only those present at `ref` are built. */
export const BUILD_ORDER = [
  "packages/corpus-schema",
  "packages/pi-bridge",
  "evaluation/cbe-skill/runner",
  "packages/app",
];

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PI_PACKAGE = /^@earendil-works\/pi-[a-z-]+$/;
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export class UsageError extends Error {}

function git(repo, args, opts = {}) {
  const res = spawnSync("git", ["--no-optional-locks", "-C", repo, ...args], { encoding: "buffer", ...opts });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr?.toString() || res.error?.message}`);
  }
  return res.stdout;
}

/** Workspace manifest paths a root manifest names (simple `dir/*` globs only). */
export function workspaceManifests(readRootManifest, dirExists, listDir) {
  const out = ["package.json"];
  for (const pattern of readRootManifest().workspaces ?? []) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      for (const name of listDir(base)) {
        if (dirExists(`${base}/${name}/package.json`)) out.push(`${base}/${name}/package.json`);
      }
    } else if (dirExists(`${pattern}/package.json`)) out.push(`${pattern}/package.json`);
  }
  return out;
}

/** The runtime-family packages the manifests at `ref` declare, with their declared specs. */
export function declaredRuntime(manifests) {
  const declared = new Map();
  for (const manifest of Object.values(manifests)) {
    for (const field of DEP_FIELDS) {
      for (const [pkg, spec] of Object.entries(manifest[field] ?? {})) {
        if (PI_PACKAGE.test(pkg) || pkg === "typebox") declared.set(pkg, spec);
      }
    }
  }
  return declared;
}

/**
 * Parse the requested version set. `--pi <v>` sets every declared Pi package to
 * `v`; `--set <pkg>@<v>` names one package (repeatable; also `typebox`). The
 * result must be exact for every entry and cover every declared Pi package.
 */
export function parseVersionSet(argv, declared) {
  const set = new Map();
  let allPi;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pi") {
      allPi = argv[++i];
      if (!allPi) throw new UsageError("--pi needs an exact version");
    } else if (arg === "--set") {
      const value = argv[++i] ?? "";
      const at = value.lastIndexOf("@");
      if (at <= 0) throw new UsageError(`--set expects <package>@<exact version>, got "${value}"`);
      set.set(value.slice(0, at), value.slice(at + 1));
    }
  }
  if (allPi !== undefined) {
    for (const pkg of declared.keys()) if (PI_PACKAGE.test(pkg) && !set.has(pkg)) set.set(pkg, allPi);
  }
  if (set.size === 0)
    throw new UsageError("name a candidate set: --pi <exact version> or --set <package>@<exact version>");
  for (const [pkg, version] of set) {
    if (!EXACT.test(version)) {
      throw new UsageError(
        `${pkg}@${version} is not an exact version — the gate never floats (no "latest", tag or range)`
      );
    }
    if (!declared.has(pkg))
      throw new UsageError(`${pkg} is not declared by any workspace; the gate does not add dependencies`);
  }
  for (const pkg of declared.keys()) {
    if (PI_PACKAGE.test(pkg) && !set.has(pkg)) {
      throw new UsageError(`the candidate set does not name ${pkg}: every declared Pi package moves together`);
    }
  }
  return set;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** Everything about the caller's checkout the gate promises not to touch. */
export function callerFingerprint(repo) {
  const status = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const paths = new Set(["package.json", "package-lock.json"]);
  for (const record of status.toString("utf8").split("\0")) {
    if (record.length > 3) paths.add(record.slice(3));
  }
  for (const rel of workspaceManifests(
    () => JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")),
    (p) => existsSync(path.join(repo, p)),
    (d) => (existsSync(path.join(repo, d)) ? readdirSync(path.join(repo, d)) : [])
  )) {
    paths.add(rel);
  }
  const files = {};
  for (const rel of [...paths].sort()) {
    const abs = path.join(repo, rel);
    files[rel] = existsSync(abs) && statSync(abs).isFile() ? sha(readFileSync(abs)) : "absent";
  }
  const indexPath = path.resolve(repo, git(repo, ["rev-parse", "--git-path", "index"]).toString().trim());
  const symbolic = spawnSync("git", ["-C", repo, "symbolic-ref", "-q", "HEAD"], { encoding: "utf8" });
  return {
    head: git(repo, ["rev-parse", "HEAD"]).toString().trim(),
    branch: symbolic.status === 0 ? symbolic.stdout.trim() : "(detached)",
    index: existsSync(indexPath) ? sha(readFileSync(indexPath)) : "absent",
    status: sha(status),
    worktrees: sha(git(repo, ["worktree", "list", "--porcelain"])),
    stash: sha(git(repo, ["stash", "list"])),
    files,
  };
}

export function fingerprintDiff(before, after) {
  const diffs = [];
  for (const key of ["head", "branch", "index", "status", "worktrees", "stash"]) {
    if (before[key] !== after[key]) diffs.push(key);
  }
  for (const rel of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
    if (before.files[rel] !== after.files[rel]) diffs.push(rel);
  }
  return diffs;
}

function npmCommand() {
  const override = process.env.CBE_PI_CANDIDATE_NPM;
  if (!override) return { cmd: process.platform === "win32" ? "npm.cmd" : "npm", pre: [] };
  return /\.(mjs|cjs|js)$/.test(override) ? { cmd: process.execPath, pre: [override] } : { cmd: override, pre: [] };
}

function step(label, cwd, cmd, args, log, env = {}) {
  log(`\n--- ${label}: ${[path.basename(cmd), ...args].join(" ")}`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      HUSKY: "0",
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
      ...env,
    },
  });
  return res.status === 0;
}

/** The version of `pkg` that Node resolves from workspace `ws` (walking up `node_modules`). */
export function resolveInstalledVersion(root, ws, pkg) {
  let dir = path.join(root, ws);
  for (;;) {
    const manifest = path.join(dir, "node_modules", pkg, "package.json");
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, "utf8")).version;
    if (path.resolve(dir) === path.resolve(root)) return "missing";
    dir = path.dirname(dir);
  }
}

function readManifests(root) {
  const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  const rels = workspaceManifests(
    () => read("package.json"),
    (p) => existsSync(path.join(root, p)),
    (d) => (existsSync(path.join(root, d)) ? readdirSync(path.join(root, d)) : [])
  );
  return Object.fromEntries(rels.map((rel) => [rel, read(rel)]));
}

/** Manifests as committed at `ref`, read without extracting anything. */
function manifestsAtRef(repo, ref) {
  const show = (rel) => JSON.parse(git(repo, ["show", `${ref}:${rel}`]).toString("utf8"));
  const tree = (dir) =>
    git(repo, ["ls-tree", "--name-only", `${ref}:${dir}`])
      .toString("utf8")
      .split("\n")
      .filter(Boolean);
  const has = (rel) => spawnSync("git", ["-C", repo, "cat-file", "-e", `${ref}:${rel}`]).status === 0;
  const rels = workspaceManifests(
    () => show("package.json"),
    has,
    (d) => (has(d) ? tree(d) : [])
  );
  return Object.fromEntries(rels.map((rel) => [rel, show(rel)]));
}

/**
 * Run the gate. Returns `{ exitCode, phases, report }`; never throws for a
 * candidate failure, only for a usage error before anything was touched.
 */
export function runCandidate({ repo, argv, log = console.log }) {
  const opts = { ref: "HEAD", tmpRoot: tmpdir(), keep: false, groups: [], report: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref") opts.ref = argv[++i];
    else if (arg === "--tmp-root") opts.tmpRoot = path.resolve(argv[++i]);
    else if (arg === "--keep") opts.keep = true;
    else if (arg === "--group") opts.groups.push(argv[++i]);
    else if (arg === "--report") opts.report = path.resolve(argv[++i]);
    else if (arg === "--pi" || arg === "--set") i += 1;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  const inside = (p) => !path.relative(repo, p).startsWith("..") && !path.isAbsolute(path.relative(repo, p));
  if (opts.report && inside(opts.report))
    throw new UsageError("--report must point outside the repository: the gate leaves the caller untouched");
  if (inside(opts.tmpRoot)) throw new UsageError("--tmp-root must be outside the repository");

  const refCommit = git(repo, ["rev-parse", "--verify", `${opts.ref}^{commit}`])
    .toString()
    .trim();
  const declared = declaredRuntime(manifestsAtRef(repo, refCommit));
  const set = parseVersionSet(argv, declared);

  const before = callerFingerprint(repo);
  const phases = [];
  const record = (phase, ok, detail) => {
    phases.push({ phase, ok, ...(detail ? { detail } : {}) });
    log(`[pi-candidate] ${ok ? "PASS" : "FAIL"} ${phase}${detail ? ` — ${detail}` : ""}`);
    return ok;
  };
  let contractReport;
  const tmp = mkdtempSync(path.join(opts.tmpRoot, "cbe-pi-candidate-"));
  const checkout = path.join(tmp, "checkout");
  log(`[pi-candidate] candidate set: ${[...set].map(([p, v]) => `${p}@${v}`).join(", ")}`);
  log(`[pi-candidate] ref ${opts.ref} (${refCommit.slice(0, 12)}), isolated checkout ${checkout}`);
  // Phases 3–6; returns the exit code of the first failing phase.
  const attempt = () => {
    // 3. An isolated copy of the committed tree.
    const tar = path.join(tmp, "source.tar");
    git(repo, ["archive", "--format=tar", "-o", tar, refCommit]);
    mkdirSync(checkout, { recursive: true });
    const untar = spawnSync("tar", ["-xf", tar, "-C", checkout]);
    rmSync(tar, { force: true });
    if (untar.status !== 0) {
      record("checkout", false, "could not extract the committed tree");
      return EXIT.checkout;
    }
    record("checkout", true);

    // 4. Candidate manifests, install, resolution check.
    const manifests = readManifests(checkout);
    for (const [rel, manifest] of Object.entries(manifests)) {
      let changed = false;
      for (const field of DEP_FIELDS) {
        for (const pkg of Object.keys(manifest[field] ?? {})) {
          if (set.has(pkg) && manifest[field][pkg] !== set.get(pkg)) {
            manifest[field][pkg] = set.get(pkg);
            changed = true;
          }
        }
      }
      if (changed) writeFileSync(path.join(checkout, rel), JSON.stringify(manifest, null, 2) + "\n");
    }
    // Let npm re-resolve the whole Pi family for the candidate: an entry kept
    // from the reviewed lockfile would pin a stale transitive Pi package beside
    // the candidate (what `npm install` does with an existing lock). Everything
    // else stays exactly as locked.
    const lockFile = path.join(checkout, "package-lock.json");
    if (existsSync(lockFile)) {
      const lock = JSON.parse(readFileSync(lockFile, "utf8"));
      const family = /(^|\/)node_modules\/@earendil-works\/pi-[a-z-]+(\/|$)/;
      const dropped = Object.keys(lock.packages ?? {}).filter((key) => family.test(key));
      for (const key of dropped) delete lock.packages[key];
      writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
      log(`[pi-candidate] re-resolving ${dropped.length} Pi lockfile entr${dropped.length === 1 ? "y" : "ies"}`);
    }
    const npm = npmCommand();
    if (
      !step("install", checkout, npm.cmd, [...npm.pre, "install", "--ignore-scripts", "--no-audit", "--no-fund"], log)
    ) {
      record("install", false, "npm install failed for the candidate set");
      return EXIT.install;
    }
    // What each DECLARING workspace resolves, by Node's own lookup (npm may
    // install a workspace's copy under that workspace rather than at the root).
    const resolved = [];
    for (const [rel, manifest] of Object.entries(manifests)) {
      const ws = path.dirname(rel);
      for (const field of DEP_FIELDS) {
        for (const pkg of Object.keys(manifest[field] ?? {})) {
          if (!set.has(pkg)) continue;
          const actual = resolveInstalledVersion(checkout, ws, pkg);
          if (actual !== set.get(pkg)) resolved.push(`${pkg} resolves to ${actual} from ${rel}, not ${set.get(pkg)}`);
        }
      }
    }
    if (!record("install", resolved.length === 0, resolved.join("; ") || undefined)) {
      return EXIT.install;
    }

    // 5. Build in dependency order.
    for (const ws of BUILD_ORDER) {
      if (!existsSync(path.join(checkout, ws, "package.json"))) continue;
      const ok = step(
        `build ${ws}`,
        checkout,
        npm.cmd,
        [...npm.pre, "run", "build", "--workspace", ws, "--if-present"],
        log
      );
      if (!record(`build ${ws}`, ok)) {
        return EXIT.build;
      }
    }

    // 6. The named contract groups.
    const reportFile = path.join(tmp, "contracts.json");
    const groupArgs = opts.groups.flatMap((g) => ["--group", g]);
    step(
      "contracts",
      checkout,
      process.execPath,
      ["scripts/pi-contracts/run.mjs", ...groupArgs, "--report", reportFile],
      log
    );
    contractReport = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : undefined;
    if (!contractReport) {
      record("contracts", false, "the contract runner produced no report");
      return EXIT.contract;
    }
    for (const group of contractReport.results)
      record(`contract ${group.group}`, group.ok, group.ok ? undefined : `owner: ${group.owner}`);
    return contractReport.green ? EXIT.ok : EXIT.contract;
  };

  let exitCode = EXIT.checkout;
  try {
    exitCode = attempt();
  } finally {
    if (opts.keep) log(`[pi-candidate] --keep: leaving ${tmp} for inspection (remove it yourself)`);
    else rmSync(tmp, { recursive: true, force: true });
    const changed = fingerprintDiff(before, callerFingerprint(repo));
    if (changed.length) {
      record("caller untouched", false, `the caller's checkout changed: ${changed.join(", ")}`);
      exitCode = EXIT.callerChanged;
    } else record("caller untouched", true);
    const report = {
      candidate: Object.fromEntries(set),
      ref: refCommit,
      exitCode,
      green: exitCode === EXIT.ok,
      phases,
      contracts: contractReport?.results?.map((r) => ({ group: r.group, ok: r.ok, owner: r.owner })),
      notProven: NOT_PROVEN,
    };
    log(
      exitCode === EXIT.ok
        ? `\n[pi-candidate] GREEN: the candidate set passed install, build and the contract groups.\n` +
            `To accept it, make an ordinary change: set the same exact versions in the manifests, run \`npm install\`, ` +
            `commit manifests and lockfile together, then run the full validation below.\n\n${NOT_PROVEN}`
        : `\n[pi-candidate] RED (exit ${exitCode}). Do not update the manifests or the lockfile.\n\n${NOT_PROVEN}`
    );
    if (opts.report) writeFileSync(opts.report, JSON.stringify(report, null, 2) + "\n");
  }
  return { exitCode, phases };
}
