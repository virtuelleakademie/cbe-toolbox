/**
 * Scenario: Direct Pi dependencies are mechanically confined (capability
 * `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*).
 *
 * A structural guard over the repository's TypeScript sources and over the
 * declarations pi-bridge exports. It reads the syntax tree (TypeScript's own
 * parser), so a Pi name in a comment or a string never trips it, and a Pi import
 * hidden in a dynamic `import()` or a re-export does.
 *
 * Three rules:
 *  1. A module specifier `@earendil-works/pi-*` appears only in the approved
 *     ADAPTER modules of pi-bridge and in the approved adapter-level tests.
 *  2. Pi-named runtime identifiers (`AgentSession`, `ModelRegistry`,
 *     `ExtensionContext`, …) appear only in those same files.
 *  3. The adapter-test access to the Pi session behind a port (`piSessionOf`)
 *     and the Pi adapter modules themselves are imported only by adapter
 *     modules and pi-bridge tests — never by app, renderer, CLI, eval or
 *     domain code.
 * Plus the exported-declaration check: the declarations pi-bridge emits for
 * its runtime contracts and session entry points name no Pi type.
 *
 * Adding a file to an allowlist below is a deliberate act that states why the
 * file is adapter code. Every allowlist entry must exist, so the list cannot rot.
 * The scanner itself lives in `helpers/pi-upgrade-guards.ts`, beside the
 * private-access, patch, version and declaration guards (change
 * `guard-pi-upgrades-with-contract-tests`).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { scanBoundary as scanText, type BoundaryFinding } from "./helpers/pi-upgrade-guards.js";

const REPO = path.resolve(__dirname, "..", "..", "..");
const BRIDGE = path.join(REPO, "packages", "pi-bridge");

/** Source roots the guard scans. */
const SCAN_ROOTS = [
  "packages/app/src",
  "packages/app/tests",
  "packages/pi-bridge/src",
  "packages/pi-bridge/tests",
  "packages/corpus-schema/src",
  "evaluation/cbe-skill/runner/src",
  "evaluation/cbe-skill/runner/tests",
];

/** pi-bridge ADAPTER modules: the only production code that may touch Pi. */
const ADAPTER_MODULES = [
  // Session construction for the two policies, and the shared primitives.
  "packages/pi-bridge/src/session.ts",
  "packages/pi-bridge/src/atomization-session.ts",
  "packages/pi-bridge/src/provider.ts",
  "packages/pi-bridge/src/runtime/pi-events.ts",
  "packages/pi-bridge/src/runtime/pi-model.ts",
  "packages/pi-bridge/src/runtime/pi-session-port.ts",
  // Explicit runtime configuration (settings, resource policy, ModelRuntime) and
  // the request-parity extension (change `adopt-settled-pi-runtime-lifecycle`).
  "packages/pi-bridge/src/runtime/pi-config.ts",
  "packages/pi-bridge/src/runtime/request-parity-extension.ts",
  // Tool registration: each CBE tool is a Pi tool definition.
  "packages/pi-bridge/src/canvas-tool.ts",
  "packages/pi-bridge/src/cite-tool.ts",
  "packages/pi-bridge/src/decision-checklist-tool.ts",
  "packages/pi-bridge/src/maturity-tool.ts",
  "packages/pi-bridge/src/picker-tool.ts",
  "packages/pi-bridge/src/profile-tool.ts",
  "packages/pi-bridge/src/step-tool.ts",
  "packages/pi-bridge/src/support-tool.ts",
  "packages/pi-bridge/src/wiki-tool.ts",
  // Compiled Skill compatibility inventory reads Pi's public built-in tool
  // definitions so the hash covers the exact file-tool input schemas.
  "packages/pi-bridge/src/skill-compatibility.ts",
  // App-authored Pi extensions and the path fence (Pi tool replacement).
  "packages/pi-bridge/src/cbe-commands-extension.ts",
  "packages/pi-bridge/src/compaction-companion-extension.ts",
  "packages/pi-bridge/src/payload-hardening-extension.ts",
  "packages/pi-bridge/src/write-fence.ts",
];

/** Adapter-level tests: they prove the adapter itself and may see Pi. */
const ADAPTER_TESTS = [
  "packages/pi-bridge/tests/helpers/scripted-provider.ts",
  "packages/pi-bridge/tests/provider.test.ts",
  "packages/pi-bridge/tests/write-fence.test.ts",
  "packages/pi-bridge/tests/atomization-write-fence.test.ts",
  "packages/pi-bridge/tests/pi-events.test.ts",
  "packages/pi-bridge/tests/pi-runtime-port.test.ts",
  // Drives real Pi sessions through a public settle hook (change
  // `adopt-settled-pi-runtime-lifecycle`).
  "packages/pi-bridge/tests/settled-lifecycle.test.ts",
  // This guard names the Pi identifiers it forbids.
  "packages/pi-bridge/tests/pi-boundary.test.ts",
];

const PI_ALLOWED = new Set([...ADAPTER_MODULES, ...ADAPTER_TESTS]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "out" || entry.startsWith(".")) continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

function scan(file: string): BoundaryFinding[] {
  return scanText(path.relative(REPO, file).split(path.sep).join("/"), readFileSync(file, "utf8"));
}

const FILES = SCAN_ROOTS.flatMap((root) => walk(path.join(REPO, root)));
const FINDINGS = FILES.flatMap(scan);

describe("Scenario: Direct Pi dependencies are mechanically confined", () => {
  it("scans the product, CLI, eval and domain sources it claims to scan", () => {
    const rel = FILES.map((f) => path.relative(REPO, f).split(path.sep).join("/"));
    for (const expected of [
      "packages/app/src/main/ipc.ts",
      "packages/app/src/main/agent.ts",
      "packages/pi-bridge/src/cli.ts",
      "evaluation/cbe-skill/runner/src/session-pi.ts",
      "packages/pi-bridge/src/step-mirror.ts",
    ]) {
      expect(rel).toContain(expected);
    }
  });

  it("every allowlist entry exists, so the allowlist cannot rot", () => {
    for (const entry of PI_ALLOWED) expect(existsSync(path.join(REPO, entry)), entry).toBe(true);
  });

  it("imports `@earendil-works/pi-*` only from approved adapter modules and adapter-level tests", () => {
    const offenders = FINDINGS.filter((f) => f.kind === "pi-import" && !PI_ALLOWED.has(f.file));
    expect(offenders).toEqual([]);
  });

  it("mentions Pi runtime types only in approved adapter modules and adapter-level tests", () => {
    const offenders = FINDINGS.filter((f) => f.kind === "pi-name" && !PI_ALLOWED.has(f.file));
    expect(offenders).toEqual([]);
  });

  it("keeps the Pi adapter internals and the adapter-test access out of product code", () => {
    const offenders = FINDINGS.filter(
      (f) =>
        f.kind === "adapter-internal-import" &&
        !ADAPTER_MODULES.includes(f.file) &&
        !f.file.startsWith("packages/pi-bridge/tests/")
    );
    expect(offenders).toEqual([]);
  });

  it("does not publish the Pi adapter through a package entry point", () => {
    const pkg = JSON.parse(readFileSync(path.join(BRIDGE, "package.json"), "utf8")) as {
      exports: Record<string, { default: string }>;
    };
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(target.default, subpath).not.toMatch(/runtime\/pi-/);
    }
    const index = readFileSync(path.join(BRIDGE, "src", "index.ts"), "utf8");
    expect(index).not.toMatch(/runtime\/pi-/);
    const runtimeIndex = readFileSync(path.join(BRIDGE, "src", "runtime", "index.ts"), "utf8");
    expect(runtimeIndex).not.toMatch(/pi-session-port|pi-events|pi-model/);
  });

  it("the guard itself is able to fail: a product file importing Pi or naming its session is reported", () => {
    const probe = "packages/app/src/main/__probe__.ts";
    const kinds = (text: string) => scanText(probe, text).map((f) => `${f.kind}:${f.detail}`);
    expect(kinds('import type { AgentSession } from "@earendil-works/pi-coding-agent";')).toEqual([
      "pi-import:@earendil-works/pi-coding-agent",
      "pi-name:AgentSession",
    ]);
    expect(kinds("const s = x as unknown as AgentSession;")).toEqual(["pi-name:AgentSession"]);
    expect(kinds('const m = await import("@earendil-works/pi-ai");')).toEqual(["pi-import:@earendil-works/pi-ai"]);
    expect(kinds('export { piSessionOf } from "../../src/runtime/pi-session-port.js";')).toEqual([
      "adapter-internal-import:../../src/runtime/pi-session-port.js",
    ]);
    // A comment or a string naming Pi is not a dependency.
    expect(kinds('// AgentSession from "@earendil-works/pi-coding-agent"\nconst t = "ModelRegistry";')).toEqual([]);
  });
});

describe("Scenario: Direct Pi dependencies are mechanically confined — exported declarations", () => {
  it("the declarations of the runtime contracts and the session entry points name no Pi type", () => {
    const configPath = path.join(BRIDGE, "tsconfig.json");
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        },
      }
    )!;
    const emitted = new Map<string, string>();
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: { ...parsed.options, declaration: true, emitDeclarationOnly: true, noEmit: false, outDir: "/virtual" },
    });
    program.emit(undefined, (fileName, data) => {
      if (fileName.endsWith(".d.ts")) emitted.set(path.relative("/virtual", fileName).split(path.sep).join("/"), data);
    });

    // Pi-free by contract: what the host, the CLI and the eval consume.
    for (const decl of [
      "runtime/contracts.d.ts",
      "runtime/index.d.ts",
      "session.d.ts",
      "atomization-session.d.ts",
      "ingestion-runner.d.ts",
      "context-occupancy.d.ts",
      "index.d.ts",
    ]) {
      const text = emitted.get(decl);
      expect(text, `${decl} was not emitted`).toBeDefined();
      // Syntax, not text: a declaration keeps its doc comments, and a comment
      // naming Pi is not a dependency.
      expect(scanText(decl, text!), decl).toEqual([]);
    }

    // Every emitted declaration that DOES reference Pi belongs to an approved adapter module.
    const piDecls = [...emitted.entries()]
      .filter(([decl, text]) => scanText(decl, text).some((f) => f.kind === "pi-import"))
      .map(([decl]) => `packages/pi-bridge/src/${decl.replace(/\.d\.ts$/, ".ts")}`);
    expect(piDecls.length).toBeGreaterThan(0);
    expect(piDecls.filter((m) => !ADAPTER_MODULES.includes(m))).toEqual([]);
  }, 120_000);
});
