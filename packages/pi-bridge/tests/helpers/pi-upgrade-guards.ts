/**
 * Pure repository guards for the Pi runtime (capability `agent-harness`,
 * Requirements: *Pi Runtime Is Hidden Behind a CBE-Owned Port*, *Embedded Pi
 * Runtime Configuration Is Explicit and Versioned* and *Pi Upgrades Are Proven
 * Through a Public Contract Harness*, Scenario: *Private Pi access is rejected
 * mechanically*; change `guard-pi-upgrades-with-contract-tests`, task 4.2).
 *
 * Every guard is a pure function of text or parsed manifests, so the same code
 * runs against the real repository (`pi-boundary.test.ts`,
 * `pi-upgrade-guards.test.ts`) and against the negative fixtures under
 * `tests/fixtures/pi-upgrade-guards/`, each of which MUST be reported. A guard
 * nobody has seen fail is not evidence.
 *
 * Source guards read TypeScript's syntax tree, so a name in a comment or a
 * string never trips them and an import hidden in `import()` / `require` /
 * `import type` / a re-export does.
 */
import { builtinModules } from "node:module";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Boundary: which files may import Pi or name its runtime types
// ---------------------------------------------------------------------------

/** Pi runtime names that only adapter code may mention. The app's own IPC
 * `AgentEvent` is deliberately absent: that name is CBE's, not Pi's. */
export const PI_RUNTIME_NAMES = new Set([
  "AgentSession",
  "AgentSessionEvent",
  "AgentSessionEventListener",
  "AgentSessionConfig",
  "AssistantMessageEvent",
  "AssistantMessageEventStream",
  "AuthStorage",
  "ModelRegistry",
  "ModelRuntime",
  "SessionManager",
  "SettingsManager",
  "DefaultResourceLoader",
  "ExtensionAPI",
  "ExtensionContext",
  "ExtensionFactory",
  "ExtensionRunner",
  "createAgentSession",
  "defineTool",
  // The upstream stream-event field: a consumer reading it is decoding a Pi
  // event shape again instead of the normalized union.
  "assistantMessageEvent",
]);

/** Modules that lead back to a raw Pi session or Pi event shape. */
export const ADAPTER_INTERNALS = [/\/runtime\/pi-[a-z-]+(\.js)?$/, /helpers\/pi-adapter-access(\.js)?$/];

const PI_PACKAGE = /^@earendil-works\/pi-[a-z-]+/;

export interface BoundaryFinding {
  file: string;
  kind: "pi-import" | "pi-name" | "adapter-internal-import";
  detail: string;
}

// Several guards read the same file in a row; parse it once.
let lastParsed: { rel: string; text: string; sf: ts.SourceFile } | undefined;

function parse(rel: string, text: string): ts.SourceFile {
  if (lastParsed && lastParsed.rel === rel && lastParsed.text === text) return lastParsed.sf;
  const kind = rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  lastParsed = { rel, text, sf };
  return sf;
}

/** Every module specifier a source file depends on, however it is written. */
export function moduleSpecifiers(rel: string, text: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const arg = node.arguments[0];
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) out.push(arg.text);
    } else if (ts.isImportTypeNode(node)) {
      const lit = node.argument;
      if (ts.isLiteralTypeNode(lit) && ts.isStringLiteral(lit.literal)) out.push(lit.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(rel, text));
  return out;
}

/** Pi imports, Pi runtime names and adapter-internal imports in one file. */
export function scanBoundary(rel: string, text: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  for (const spec of moduleSpecifiers(rel, text)) {
    if (PI_PACKAGE.test(spec)) findings.push({ file: rel, kind: "pi-import", detail: spec });
    if (ADAPTER_INTERNALS.some((re) => re.test(spec)))
      findings.push({ file: rel, kind: "adapter-internal-import", detail: spec });
  }
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && PI_RUNTIME_NAMES.has(node.text)) {
      findings.push({ file: rel, kind: "pi-name", detail: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(rel, text));
  return findings;
}

// ---------------------------------------------------------------------------
// Private / deep Pi access
// ---------------------------------------------------------------------------

export interface GuardFinding {
  guard: "private-access" | "deep-import" | "installed-patch" | "version-alignment" | "undeclared-dependency";
  file: string;
  detail: string;
}

/** Members whose use means a test or module drives Pi's internals instead of
 * its public API: the agent behind a session (and the loop's stream function
 * on it) and the extension runner. Named anywhere, they are reported. */
const PRIVATE_MEMBERS = new Set(["streamFn", "extensionRunner", "_extensionRunner", "agent"]);

/** Does this file reach a Pi object at all (and so could reach its internals)? */
function reachesPi(specs: string[]): boolean {
  return specs.some((s) => PI_PACKAGE.test(s) || ADAPTER_INTERNALS.some((re) => re.test(s)));
}

/**
 * Private session-agent access: in a file that can reach a Pi object, any
 * property access or string-keyed element access to `agent`, `streamFn` or the
 * extension runner, or to an underscore-prefixed member. `streamFn` is reported
 * in every file — no CBE code has a reason to name the loop's stream seam.
 */
export function findPrivatePiAccess(rel: string, text: string): GuardFinding[] {
  const sf = parse(rel, text);
  const piReaching = reachesPi(moduleSpecifiers(rel, text));
  const findings: GuardFinding[] = [];
  const report = (name: string) => {
    if (name === "streamFn" || (piReaching && (PRIVATE_MEMBERS.has(name) || name.startsWith("_")))) {
      findings.push({ guard: "private-access", file: rel, detail: name });
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) report(node.name.text);
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      report(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** `exports` subpaths of an installed package (`"."`, `"./compat"`, `"./api/*"`). */
export type ExportsOf = (pkg: string) => string[] | undefined;

function subpathAllowed(subpath: string, exported: string[]): boolean {
  return exported.some((key) => {
    if (!key.includes("*")) return key === subpath;
    const [head, tail] = key.split("*") as [string, string];
    return subpath.startsWith(head) && subpath.endsWith(tail) && subpath.length > head.length + tail.length;
  });
}

/**
 * Deep Pi imports: a specifier into a Pi package that its `exports` map does
 * not publish (`.../dist/...`, `.../src/...`), or any path reaching into
 * `node_modules/@earendil-works`.
 */
export function findDeepPiImports(rel: string, text: string, exportsOf: ExportsOf): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const spec of moduleSpecifiers(rel, text)) {
    if (/node_modules\/@earendil-works\//.test(spec)) {
      findings.push({ guard: "deep-import", file: rel, detail: spec });
      continue;
    }
    const m = /^(@earendil-works\/pi-[a-z-]+)(\/.*)?$/.exec(spec);
    if (!m) continue;
    const exported = exportsOf(m[1]!);
    const subpath = m[2] ? `.${m[2]}` : ".";
    if (!exported || !subpathAllowed(subpath, exported)) {
      findings.push({ guard: "deep-import", file: rel, detail: spec });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Manifests: installed-package patches, version alignment, direct declaration
// ---------------------------------------------------------------------------

export interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
  resolutions?: Record<string, unknown>;
  patchedDependencies?: Record<string, unknown>;
  pnpm?: { overrides?: Record<string, unknown>; patchedDependencies?: Record<string, unknown> };
}

export interface LockFile {
  packages: Record<string, { version?: string }>;
}

/** The runtime/schema family the guards pin: every Pi package plus the schema library. */
export const RUNTIME_FAMILY = (name: string) => PI_PACKAGE.test(name) || name === "typebox";

const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepack"];

export interface PatchInput {
  /** Repo-relative manifest path → parsed manifest, root included. */
  manifests: Record<string, Manifest>;
  /** Repo-relative directories that exist and could carry patch files. */
  patchDirs: string[];
  /** Every installed Pi package's own `package.json` version, keyed by its
   * install path as the lockfile spells it (`node_modules/@earendil-works/pi-ai`,
   * `packages/pi-bridge/node_modules/@earendil-works/pi-coding-agent`). */
  installed: Record<string, string>;
  lock: LockFile;
}

/**
 * Installed-package patches: a patch directory, a patch tool, a lifecycle
 * script that edits installed packages, an override/patch entry aimed at the
 * runtime family, or an installed Pi package whose version is not the one the
 * lockfile installed (a hand-copied or hand-edited install).
 */
export function findInstalledPatches(input: PatchInput): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const add = (file: string, detail: string) => findings.push({ guard: "installed-patch", file, detail });
  for (const dir of input.patchDirs) add(dir, "patch directory");
  for (const [file, manifest] of Object.entries(input.manifests)) {
    const deps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    for (const tool of ["patch-package", "patch", "@pnpm/patching"]) if (tool in deps) add(file, `depends on ${tool}`);
    for (const script of LIFECYCLE_SCRIPTS) {
      const cmd = manifest.scripts?.[script];
      if (cmd && /patch|node_modules|@earendil-works/.test(cmd)) add(file, `${script}: ${cmd}`);
    }
    const overrideMaps = [
      manifest.overrides,
      manifest.resolutions,
      manifest.patchedDependencies,
      manifest.pnpm?.overrides,
      manifest.pnpm?.patchedDependencies,
    ];
    for (const map of overrideMaps) {
      for (const key of Object.keys(map ?? {})) {
        if (RUNTIME_FAMILY(key.replace(/@[^@/]*$/, "")) || /@earendil-works|typebox/.test(key)) {
          add(file, `override/patch entry ${key}`);
        }
      }
    }
  }
  for (const [installPath, version] of Object.entries(input.installed)) {
    const locked = input.lock.packages[installPath]?.version;
    if (locked !== version) add(installPath, `installed ${version} but the lockfile installed ${locked}`);
  }
  return findings;
}

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Version alignment: every declaration of a runtime-family package is an exact
 * version; all Pi packages are declared at ONE version; every Pi package in the
 * lockfile (nested copies included) resolves to it; the schema library resolves
 * to exactly one copy, the declared one.
 */
export function findVersionMisalignment(manifests: Record<string, Manifest>, lock: LockFile): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const add = (file: string, detail: string) => findings.push({ guard: "version-alignment", file, detail });
  const piVersions = new Set<string>();
  const typeboxVersions = new Set<string>();
  for (const [file, manifest] of Object.entries(manifests)) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
      for (const [pkg, spec] of Object.entries(manifest[field] ?? {})) {
        if (!RUNTIME_FAMILY(pkg)) continue;
        if (!EXACT.test(spec)) add(file, `${pkg}@${spec} is not an exact version`);
        if (pkg === "typebox") typeboxVersions.add(spec);
        else piVersions.add(spec);
      }
    }
  }
  if (piVersions.size !== 1)
    add("manifests", `Pi packages are declared at ${[...piVersions].join(", ") || "no version"}`);
  if (typeboxVersions.size > 1) add("manifests", `typebox is declared at ${[...typeboxVersions].join(", ")}`);
  const [pi] = [...piVersions];
  const typeboxCopies: string[] = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    const m = /(?:^|\/)node_modules\/(@earendil-works\/pi-[a-z-]+|typebox)$/.exec(key);
    if (!m) continue;
    if (m[1] === "typebox") typeboxCopies.push(entry.version ?? "?");
    else if (pi && entry.version !== pi) add("package-lock.json", `${key} resolves to ${entry.version}, not ${pi}`);
  }
  if (typeboxVersions.size === 1) {
    const [declared] = [...typeboxVersions];
    if (typeboxCopies.length !== 1 || typeboxCopies[0] !== declared) {
      add("package-lock.json", `typebox resolves to [${typeboxCopies.join(", ")}], not one copy of ${declared}`);
    }
  }
  return findings;
}

/** The package a bare specifier names (`@scope/pkg/sub` → `@scope/pkg`), or null. */
export function packageOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:") || spec.startsWith("virtual:"))
    return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  if (builtinModules.includes(name)) return null;
  return name;
}

/**
 * Direct declaration: every package `text` imports is declared in `declared`.
 * With `familyOnly`, only the runtime family is checked (for workspaces whose
 * other imports are another guard's business).
 */
export function findUndeclaredImports(
  rel: string,
  text: string,
  declared: Set<string>,
  opts: { familyOnly?: boolean } = {}
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const spec of moduleSpecifiers(rel, text)) {
    const pkg = packageOf(spec);
    if (!pkg || declared.has(pkg)) continue;
    if (opts.familyOnly && !RUNTIME_FAMILY(pkg)) continue;
    findings.push({ guard: "undeclared-dependency", file: rel, detail: pkg });
  }
  return findings;
}
