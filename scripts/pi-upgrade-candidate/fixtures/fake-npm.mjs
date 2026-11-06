#!/usr/bin/env node
/**
 * A stand-in for `npm` in the candidate gate's self-test (CBE_PI_CANDIDATE_NPM).
 * It never touches the network. `install` "resolves" every declared runtime
 * package to its declared version and rewrites the lockfile, as npm would;
 * `run build --workspace <ws>` records the build order. Failures and a
 * deliberate write into the caller are switched on by environment variables.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const cwd = process.cwd();
const log = (line) => process.env.FAKE_NPM_LOG && appendFileSync(process.env.FAKE_NPM_LOG, line + "\n");
const fail = process.env.FAKE_NPM_FAIL ?? "";

if (process.env.FAKE_NPM_TOUCH_CALLER) writeFileSync(process.env.FAKE_NPM_TOUCH_CALLER, "touched by the gate\n");

if (args[0] === "install") {
  log(`install ${args.slice(1).join(" ")}`);
  if (fail === "install") process.exit(1);
  const root = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  if (existsSync(path.join(cwd, "package-lock.json"))) {
    const before = JSON.parse(readFileSync(path.join(cwd, "package-lock.json"), "utf8"));
    log(
      `lock-before ${Object.keys(before.packages ?? {})
        .sort()
        .join(" ")}`
    );
  }
  const manifests = [{ ...root, __dir: "." }];
  for (const pattern of root.workspaces ?? []) {
    const base = pattern.replace(/\/\*$/, "");
    for (const name of existsSync(path.join(cwd, base)) ? readdirSync(path.join(cwd, base)) : []) {
      const file = path.join(cwd, base, name, "package.json");
      if (existsSync(file)) manifests.push({ ...JSON.parse(readFileSync(file, "utf8")), __dir: path.join(base, name) });
    }
  }
  const lock = { name: root.name, lockfileVersion: 3, packages: {} };
  for (const m of manifests) {
    for (const deps of [m.dependencies, m.devDependencies]) {
      for (const [pkg, version] of Object.entries(deps ?? {})) {
        if (!pkg.startsWith("@earendil-works/") && pkg !== "typebox") continue;
        const resolved = process.env.FAKE_NPM_RESOLVE_STALE === pkg ? "0.0.1" : version;
        // FAKE_NPM_WORKSPACE_LOCAL: install under the declaring workspace instead
        // of hoisting to the root — what npm does when the root slot is taken.
        const dir = process.env.FAKE_NPM_WORKSPACE_LOCAL === pkg ? m.__dir : ".";
        mkdirSync(path.join(cwd, dir, "node_modules", pkg), { recursive: true });
        writeFileSync(
          path.join(cwd, dir, "node_modules", pkg, "package.json"),
          JSON.stringify({ name: pkg, version: resolved })
        );
        lock.packages[path.posix.join(dir, "node_modules", pkg)] = { version: resolved };
        log(`resolved ${pkg}@${resolved}`);
      }
    }
  }
  writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  process.exit(0);
}

if (args[0] === "run" && args[1] === "build") {
  const ws = args[args.indexOf("--workspace") + 1];
  log(`build ${ws}`);
  process.exit(fail === `build:${ws}` ? 1 : 0);
}

process.exit(2);
