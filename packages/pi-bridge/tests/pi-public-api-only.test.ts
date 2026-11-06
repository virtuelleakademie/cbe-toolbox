/**
 * Scenario: Fresh session uses Pi's public API only (capability `agent-harness`,
 * Requirement: Session-Start Canvas Artefact Injection; change
 * `add-new-session-keep-canvas`).
 *
 * Structural assertion on the call path: the New Session flow re-enters
 * `startCbeSession`, whose session construction goes through Pi's public
 * `createAgentSession` entry imported from the package — and the repo carries no
 * patch mechanism for Pi's sources (repo rule: Pi-Coding-Agent is the runtime —
 * do not patch it).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(here, "..");
const repoRoot = path.resolve(bridgeRoot, "..", "..");

describe("Scenario: Fresh session uses Pi's public API only", () => {
  it("startCbeSession constructs the session via createAgentSession imported from the Pi package", () => {
    const src = readFileSync(path.join(bridgeRoot, "src", "session.ts"), "utf8");
    // The public entry is imported from the package (not from a vendored/patched path) …
    const importBlock = src.match(/import\s*{[^}]*}\s*from\s*"@earendil-works\/pi-coding-agent";/s)?.[0] ?? "";
    expect(importBlock).toContain("createAgentSession");
    // … and the session is created through it.
    expect(src).toMatch(/await createAgentSession\(\{/);
    // No deep import reaches into Pi's internals.
    expect(src).not.toMatch(/@earendil-works\/pi-coding-agent\/dist/);
  });

  it("the repo carries no patch mechanism targeting Pi's sources", () => {
    // patch-package convention: a patches/ directory at the repo or package root.
    expect(existsSync(path.join(repoRoot, "patches"))).toBe(false);
    expect(existsSync(path.join(bridgeRoot, "patches"))).toBe(false);
    // No patch/postinstall hook in the workspace manifests.
    for (const manifest of [path.join(repoRoot, "package.json"), path.join(bridgeRoot, "package.json")]) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(pkg.scripts?.postinstall ?? "").not.toMatch(/patch/i);
      expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("patch-package");
    }
  });
});
