/**
 * The embedded runtime is one reviewed, exactly pinned set, and one public
 * `ModelRuntime` owns model/auth per session (capability `agent-harness`,
 * Requirement: *Embedded Pi Runtime Configuration Is Explicit and Versioned*;
 * change `adopt-settled-pi-runtime-lifecycle`, tasks 1.2 and 2.1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const REPO = path.resolve(__dirname, "..", "..", "..");
const manifest = JSON.parse(readFileSync(path.join(REPO, "packages/pi-bridge/package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
// The reviewed version is the one the manifest declares (change
// `guard-pi-upgrades-with-contract-tests`): this file pins the SET's shape —
// exact, aligned, one copy — not a literal, so the candidate-upgrade gate runs
// it unchanged against a candidate set.
const PI_VERSION = manifest.dependencies["@earendil-works/pi-coding-agent"]!;
const lock = JSON.parse(readFileSync(path.join(REPO, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Bare package specifiers imported by the files under `dir`. */
function importedPackages(dir: string): Set<string> {
  const found = new Set<string>();
  for (const file of sources(dir)) {
    for (const m of readFileSync(file, "utf8").matchAll(
      /from\s+"((?:@earendil-works\/[a-z-]+)|typebox)(?:\/[^"]*)?"/g
    )) {
      found.add(m[1]!);
    }
  }
  return found;
}

describe("Scenario: Runtime packages resolve as one reviewed set", () => {
  it("declares every directly imported Pi/schema package directly, at the exact reviewed version", () => {
    const production = importedPackages(path.join(REPO, "packages/pi-bridge/src"));
    const tests = importedPackages(path.join(REPO, "packages/pi-bridge/tests"));
    expect([...production].sort()).toEqual(["@earendil-works/pi-coding-agent", "typebox"]);
    for (const pkg of production) expect(manifest.dependencies[pkg], pkg).toMatch(/^\d+\.\d+\.\d+$/);
    for (const pkg of tests) {
      if (production.has(pkg)) continue;
      // Test-only imports (the public provider harness) are dev dependencies.
      expect(manifest.devDependencies[pkg], pkg).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(PI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.devDependencies["@earendil-works/pi-ai"]).toBe(PI_VERSION);
  });

  it("resolves every installed Pi package to the one reviewed release and typebox to one copy", () => {
    const piEntries = Object.entries(lock.packages).filter(([key]) =>
      /(^|\/)node_modules\/@earendil-works\/pi-[a-z-]+$/.test(key)
    );
    expect(piEntries.length).toBeGreaterThan(0);
    for (const [key, entry] of piEntries) expect(entry.version, key).toBe(PI_VERSION);
    const typebox = Object.entries(lock.packages).filter(([key]) => /(^|\/)node_modules\/typebox$/.test(key));
    expect(typebox.map(([, e]) => e.version)).toEqual([manifest.dependencies.typebox]);
  });
});

describe("Scenario: Main session uses ModelRuntime end to end", () => {
  let tmp: string | undefined;
  let started: StartCbeSessionResult | undefined;
  afterEach(() => {
    started?.session.dispose();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    started = undefined;
    tmp = undefined;
  });

  it("registers, resolves and re-binds the BYO model on the session's own runtime", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-model-runtime-"));
    started = await startCbeSession({
      profile: "app",
      skillDir: path.join(REPO, "skills", "cbe"),
      sessionsDir: path.join(tmp, "sessions"),
      agentDir: path.join(tmp, "agent"),
      cwd: path.join(tmp, "workspace"),
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k1", modelId: "model-a", contextLength: 65_536 },
    });
    const pi = piSessionOf(started.session);
    const runtime = pi.modelRuntime;
    expect(pi.model).toMatchObject({ provider: "byo-llm", id: "model-a", contextWindow: 65_536 });
    expect(runtime.getModel("byo-llm", "model-a")).toBeDefined();
    // No models.json is read or written: the catalog is the runtime's own registration.
    expect(runtime.getRegisteredProviderIds()).toContain("byo-llm");

    await started.session.updateProvider({ baseURL: "http://127.0.0.1:0/v2", apiKey: "k2", modelId: "model-b" });

    expect(pi.modelRuntime).toBe(runtime);
    expect(pi.model).toMatchObject({ provider: "byo-llm", id: "model-b" });
    expect(runtime.getModel("byo-llm", "model-b")).toBeDefined();
  });

  it("rejects an invalid re-bind and keeps the session on its previous model", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-model-runtime-"));
    started = await startCbeSession({
      profile: "app",
      skillDir: path.join(REPO, "skills", "cbe"),
      sessionsDir: path.join(tmp, "sessions"),
      agentDir: path.join(tmp, "agent"),
      cwd: path.join(tmp, "workspace"),
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k1", modelId: "model-a" },
    });
    await expect(started.session.updateProvider({ baseURL: "", apiKey: "", modelId: "" })).rejects.toThrow();
    expect(piSessionOf(started.session).model).toMatchObject({ provider: "byo-llm", id: "model-a" });
  });
});
