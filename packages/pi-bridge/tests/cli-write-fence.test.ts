/**
 * Headless profile: the CLI's writable area is an explicit scratch root under
 * its project-local agent home — the checkout it runs from is NOT writable
 * (capability `agent-harness`, Requirement: Path-Fenced File Mutation Tools;
 * change `fence-agent-file-writes`, tasks 5.1 / 5.2).
 *
 * With no shell registered, `write` and `edit` are the whole write surface, so
 * the assertion that they cannot reach `skills/`, `evaluation/`, `packages/` or
 * `openspec/` covers the profile.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveAgainstRoots } from "../src/write-fence.js";

const BRIDGE_ROOT = path.resolve(__dirname, "..");

describe("cbe-headless — scratch root instead of the checkout (task 5.1, structural)", () => {
  const src = readFileSync(path.join(BRIDGE_ROOT, "src", "cli.ts"), "utf8");

  it("derives the scratch dir under the project-local agent home and creates it", () => {
    expect(src).toMatch(/const scratchDir = path\.join\(agentDir, "workspace"\)/);
    expect(src).toMatch(/mkdirSync\(scratchDir, \{ recursive: true \}\)/);
  });

  it("passes the scratch dir as the session cwd AND as paths.workspace, with the fence rooted there", () => {
    // cwd and descriptor must agree: cli.ts never passed `cwd` before, so the
    // effective root of a relative path came from the `process.cwd()` default —
    // the checkout.
    expect(src).toMatch(/cwd: scratchDir/);
    expect(src).toMatch(/paths: \{ workspace: scratchDir \}/);
    expect(src).toMatch(/writableRoots: \{ dirs: \[scratchDir\] \}/);
    expect(src).not.toMatch(/cwd:\s*repoRoot/);
  });
});

describe("cbe-headless — the checkout is unreachable for write/edit (task 5.2)", () => {
  it("skills/, evaluation/, packages/ and openspec/ of the checkout all resolve outside the scratch root", () => {
    // Mirror the CLI's own derivation: repoRoot = the process cwd it is
    // started from, agentDir = <repoRoot>/.cbe-agent, scratch below it.
    const repoRoot = path.resolve(BRIDGE_ROOT, "..", "..");
    const scratchDir = path.join(repoRoot, ".cbe-agent", "workspace");
    const roots = { dirs: [scratchDir] };
    for (const denied of [
      path.join(repoRoot, "skills", "cbe", "SKILL.md"),
      path.join(repoRoot, "evaluation", "cbe-skill", "eval.config.json"),
      path.join(repoRoot, "packages", "pi-bridge", "src", "session.ts"),
      path.join(repoRoot, "openspec", "project.md"),
      // Relative escape from the scratch cwd back into the checkout:
      "../../skills/cbe/SKILL.md",
    ]) {
      const verdict = resolveAgainstRoots(denied, scratchDir, roots, { caseInsensitive: false });
      expect(verdict.allowed, denied).toBe(false);
    }
    // The scratch root itself stays writable — the CLI keeps a place to write.
    expect(resolveAgainstRoots("notes.md", scratchDir, roots, { caseInsensitive: false }).allowed).toBe(true);
  });
});
