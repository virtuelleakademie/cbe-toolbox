/**
 * Contract group `guards` — Scenario: *Private Pi access is rejected
 * mechanically* (capability `agent-harness`, Requirement: *Pi Upgrades Are
 * Proven Through a Public Contract Harness*; change
 * `guard-pi-upgrades-with-contract-tests`, task 4.2).
 *
 * The boundary half (raw Pi imports confined to the adapter) is
 * `pi-boundary.test.ts`. This file runs the other four guards of
 * `helpers/pi-upgrade-guards.ts` over the real repository, and then over the
 * negative fixtures in `fixtures/pi-upgrade-guards/`, each of which must be
 * reported with the detail it was built to carry.
 *
 * Nothing here pins a Pi VERSION: the reviewed version is whatever the
 * manifests declare, and the guards assert the set is exact and aligned. That
 * is what lets the candidate-upgrade gate run this file unchanged against a
 * candidate set.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  findDeepPiImports,
  findInstalledPatches,
  findPrivatePiAccess,
  findUndeclaredImports,
  findVersionMisalignment,
  scanBoundary,
  type LockFile,
  type Manifest,
  type PatchInput,
} from "./helpers/pi-upgrade-guards.js";

const REPO = path.resolve(__dirname, "..", "..", "..");
const FIXTURES = path.join(__dirname, "fixtures", "pi-upgrade-guards");

const SCAN_ROOTS = [
  "packages/app/src",
  "packages/app/tests",
  "packages/pi-bridge/src",
  "packages/pi-bridge/tests",
  "packages/corpus-schema/src",
  "packages/corpus-schema/tests",
  "evaluation/cbe-skill/runner/src",
  "evaluation/cbe-skill/runner/tests",
  "scripts",
];

const WORKSPACES = ["packages/app", "packages/pi-bridge", "packages/corpus-schema", "evaluation/cbe-skill/runner"];

const rel = (abs: string) => path.relative(REPO, abs).split(path.sep).join("/");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "out" || entry.startsWith(".")) continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) {
      // Fixture trees hold deliberate violations; their own tests read them.
      if (entry === "fixtures") continue;
      out.push(...walk(abs));
    } else if (/\.(ts|tsx|mts|cts|mjs|js)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

const sourcesUnder = (root: string) => walk(path.join(REPO, root));
const FILES = SCAN_ROOTS.flatMap(sourcesUnder);

/** The installed manifest of `pkg` as Node resolves it from pi-bridge (npm may
 * place a workspace's copy under the workspace rather than at the root). */
function resolvedManifest(pkg: string): string | undefined {
  for (const dir of [path.join(REPO, "packages", "pi-bridge"), REPO]) {
    const manifest = path.join(dir, "node_modules", pkg, "package.json");
    if (existsSync(manifest)) return manifest;
  }
  return undefined;
}

/** The `exports` subpaths an INSTALLED Pi package publishes. */
function installedExports(pkg: string): string[] | undefined {
  const manifest = resolvedManifest(pkg);
  if (!manifest) return undefined;
  const { exports } = readJson<{ exports?: string | Record<string, unknown> }>(manifest);
  if (exports === undefined) return ["."];
  return typeof exports === "string" ? ["."] : Object.keys(exports);
}

function manifests(): Record<string, Manifest> {
  const out: Record<string, Manifest> = { "package.json": readJson(path.join(REPO, "package.json")) };
  for (const ws of WORKSPACES) out[`${ws}/package.json`] = readJson(path.join(REPO, ws, "package.json"));
  return out;
}

const lock = () => readJson<LockFile>(path.join(REPO, "package-lock.json"));

const declaredIn = (m: Manifest, withDev: boolean) =>
  new Set([
    ...Object.keys(m.dependencies ?? {}),
    ...Object.keys(m.peerDependencies ?? {}),
    ...Object.keys(m.optionalDependencies ?? {}),
    ...(withDev ? Object.keys(m.devDependencies ?? {}) : []),
  ]);

describe("Scenario: Private Pi access is rejected mechanically", () => {
  it("scans the adapter, its tests, the scripts and every product source", () => {
    const scanned = FILES.map(rel);
    for (const expected of [
      "packages/pi-bridge/src/session.ts",
      "packages/pi-bridge/tests/helpers/scripted-provider.ts",
      "packages/pi-bridge/tests/helpers/request-capture.mjs",
      "packages/app/src/main/ipc.ts",
      "evaluation/cbe-skill/runner/src/session-pi.ts",
    ]) {
      expect(scanned).toContain(expected);
    }
  });

  it("finds no private session-agent access, deep Pi import or adapter-internal reach in the repository", () => {
    const findings = FILES.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...findPrivatePiAccess(rel(file), text), ...findDeepPiImports(rel(file), text, installedExports)];
    });
    expect(findings).toEqual([]);
  }, 60_000);

  it("finds no installed-package patch mechanism and no drift in the installed Pi packages", () => {
    const candidates = ["patches", ".yarn/patches", ...WORKSPACES.map((ws) => `${ws}/patches`)];
    // Every installed Pi package, at the root and under each workspace.
    const installed: Record<string, string> = {};
    for (const base of ["", ...WORKSPACES.map((ws) => `${ws}/`)]) {
      const piDir = path.join(REPO, base, "node_modules", "@earendil-works");
      if (!existsSync(piDir)) continue;
      for (const name of readdirSync(piDir)) {
        installed[`${base}node_modules/@earendil-works/${name}`] = readJson<{ version: string }>(
          path.join(piDir, name, "package.json")
        ).version;
      }
    }
    expect(resolvedManifest("@earendil-works/pi-coding-agent")).toBeDefined();
    const input: PatchInput = {
      manifests: manifests(),
      patchDirs: candidates.filter((dir) => existsSync(path.join(REPO, dir))),
      installed,
      lock: lock(),
    };
    expect(findInstalledPatches(input)).toEqual([]);
  });

  it("finds the Pi runtime set exactly pinned and aligned in manifests and lockfile", () => {
    expect(findVersionMisalignment(manifests(), lock())).toEqual([]);
  });

  it("finds every imported runtime/schema package declared directly", () => {
    const all = manifests();
    const bridge = all["packages/pi-bridge/package.json"]!;
    const findings = [
      // The adapter package: every bare import, production against `dependencies` …
      ...sourcesUnder("packages/pi-bridge/src").flatMap((f) =>
        findUndeclaredImports(rel(f), readFileSync(f, "utf8"), declaredIn(bridge, false))
      ),
      // … and its tests against dependencies + devDependencies.
      ...sourcesUnder("packages/pi-bridge/tests").flatMap((f) =>
        findUndeclaredImports(rel(f), readFileSync(f, "utf8"), declaredIn(bridge, true))
      ),
      // Every other workspace: the runtime family must never arrive transitively.
      ...WORKSPACES.filter((ws) => ws !== "packages/pi-bridge").flatMap((ws) =>
        [...sourcesUnder(`${ws}/src`), ...sourcesUnder(`${ws}/tests`)].flatMap((f) =>
          findUndeclaredImports(rel(f), readFileSync(f, "utf8"), declaredIn(all[`${ws}/package.json`]!, true), {
            familyOnly: true,
          })
        )
      ),
    ];
    expect(findings).toEqual([]);
  }, 60_000);

  it("every guard fails on its negative fixture", () => {
    const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
    const details = (findings: Array<{ detail: string }>) => findings.map((f) => f.detail);

    // private-access: the agent, its stream function and the extension runner.
    expect(
      details(
        findPrivatePiAccess("packages/pi-bridge/tests/probe.test.ts", fixture("private-agent-mutation.ts.fixture"))
      )
    ).toEqual(["streamFn", "agent", "_extensionRunner"]);

    // deep-import: a dist/ subpath Pi does not export, and a node_modules path.
    expect(
      details(findDeepPiImports("packages/pi-bridge/src/probe.ts", fixture("deep-import.ts.fixture"), installedExports))
    ).toEqual([
      "@earendil-works/pi-coding-agent/dist/core/agent-session.js",
      "../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/index.js",
    ]);
    // An exported subpath is NOT deep: the guard does not over-report.
    expect(findDeepPiImports("x.ts", 'import "@earendil-works/pi-ai/compat";', installedExports)).toEqual([]);

    // boundary: product code importing Pi and naming its session.
    expect(
      scanBoundary("packages/app/src/main/probe.ts", fixture("boundary-import.ts.fixture")).map(
        (f) => `${f.kind}:${f.detail}`
      )
    ).toEqual([
      "pi-import:@earendil-works/pi-coding-agent",
      "pi-name:AgentSession",
      "pi-name:AgentSession",
      "pi-name:AgentSession",
    ]);

    // installed-patch: every mechanism the fixture carries.
    expect(details(findInstalledPatches(readJson<PatchInput>(path.join(FIXTURES, "installed-patch.json"))))).toEqual([
      "patch directory",
      "depends on patch-package",
      "postinstall: patch-package",
      "override/patch entry @earendil-works/pi-coding-agent",
      "prepare: sed -i s/a/b/ node_modules/@earendil-works/pi-coding-agent/dist/index.js",
      "installed 1.3.1 but the lockfile installed 1.3.0",
    ]);

    // version-alignment: a range, two Pi versions, a stray nested copy, two typebox copies.
    const misaligned = readJson<{ manifests: Record<string, Manifest>; lock: LockFile }>(
      path.join(FIXTURES, "version-misaligned.json")
    );
    const alignment = details(findVersionMisalignment(misaligned.manifests, misaligned.lock));
    expect(alignment).toContain("@earendil-works/pi-coding-agent@^1.3.0 is not an exact version");
    expect(alignment).toContain("Pi packages are declared at ^1.3.0, 1.2.0");
    expect(alignment.some((d) => d.startsWith("typebox resolves to [1.3.27, 1.3.26]"))).toBe(true);

    // undeclared-dependency: typebox and pi-ai, but not the builtins.
    const manifest = readJson<Manifest>(path.join(FIXTURES, "undeclared-import.package.json"));
    expect(
      details(
        findUndeclaredImports(
          "packages/pi-bridge/src/probe.ts",
          fixture("undeclared-import.ts.fixture"),
          declaredIn(manifest, false)
        )
      )
    ).toEqual(["typebox", "@earendil-works/pi-ai"]);
  });
});
