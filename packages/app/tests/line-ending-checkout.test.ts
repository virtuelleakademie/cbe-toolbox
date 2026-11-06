import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPECTED_SOURCE_BYTES, EXPECTED_SOURCE_SHA256, sha256 } from "../scripts/icon-pipeline.mjs";

// The repository's `.gitattributes` must keep every text file LF on a Git for
// Windows checkout (core.autocrlf=true by default). A CRLF checkout broke the
// user-documentation frontmatter check, Vite's hashbang handling of imported
// scripts, multi-line CSS selector lookups and the icon manifest's recipe hash.
// Each case below builds a disposable repository from the real bytes, clones it
// with the Git-for-Windows setting and compares what lands on disk.

const repoRoot = path.resolve(__dirname, "../../..");
const ICON_SOURCE = "packages/app/icon-source/cbe-toolbox-icon.svg";
const ICON_RECIPE = "packages/app/scripts/icon-pipeline.mjs";
const LEGACY_ATTRIBUTES = `${ICON_SOURCE} -text\n`;

/** Text files whose LF bytes a test, a tool or a pinned hash depends on. */
const TEXT_SAMPLES = [
  "scripts/content-pack-mirror.mjs",
  "scripts/content-pack-preflight.mjs",
  ICON_RECIPE,
  "docs/user/en/README.md",
  "packages/app/src/renderer/styles.css",
  "packages/app/src/main/content-pack-store.ts",
];
/** Committed binaries that must stay byte-opaque. */
const BINARY_SAMPLES = ["packages/app/buildResources/icon.png", "packages/app/buildResources/icon.ico"];

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Commit the samples under the given attributes, then clone them the way a
 * default Git for Windows install does. Returns the clone's root.
 */
function windowsStyleClone(attributes: string): { clone: string; env: NodeJS.ProcessEnv } {
  const scratch = temp("cbe-eol-");
  const emptyConfig = path.join(scratch, "empty.gitconfig");
  writeFileSync(emptyConfig, "");
  // Isolate from the machine's own Git configuration, so the checkout setting
  // is exactly the one this test passes.
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig };
  const source = path.join(scratch, "source");
  mkdirSync(source);
  writeFileSync(path.join(source, ".gitattributes"), attributes);
  for (const relative of [...TEXT_SAMPLES, ...BINARY_SAMPLES, ICON_SOURCE]) {
    mkdirSync(path.join(source, path.dirname(relative)), { recursive: true });
    copyFileSync(path.join(repoRoot, relative), path.join(source, relative));
  }
  git(source, ["init", "-q"], env);
  git(source, ["add", "-A"], env);
  git(
    source,
    [
      "-c",
      "user.name=eol",
      "-c",
      "user.email=eol@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "x",
    ],
    env
  );
  const clone = path.join(scratch, "clone");
  git(scratch, ["clone", "-q", "-c", "core.autocrlf=true", "source", "clone"], env);
  return { clone, env };
}

const committed = (relative: string): Buffer => readFileSync(path.join(repoRoot, relative));
const checkedOut = (clone: string, relative: string): Buffer => readFileSync(path.join(clone, relative));

describe("Scenario: A Git for Windows checkout keeps repository text as LF", () => {
  it("declares LF for text, keeps the icon master unconverted and marks binaries -text", () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    expect(attributes).toMatch(/^\* text=auto eol=lf$/m);
    expect(attributes).toContain(`${ICON_SOURCE} -text`);
    for (const pattern of ["*.png", "*.ico", "*.icns", "*.woff2", "*.zip", "*.pdf", "*.jpg", "*.docx"]) {
      expect(attributes).toContain(`${pattern} -text`);
    }
  });

  it("checks out scripts, Markdown, CSS and TypeScript byte-identical with LF", { timeout: 30_000 }, () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    const { clone } = windowsStyleClone(attributes);
    for (const relative of TEXT_SAMPLES) {
      const bytes = checkedOut(clone, relative);
      expect(bytes.includes("\r"), `${relative} carries CR`).toBe(false);
      expect(bytes.equals(committed(relative)), `${relative} changed on checkout`).toBe(true);
    }
    // The specific mechanisms the CRLF checkout used to break.
    const readme = checkedOut(clone, "docs/user/en/README.md").toString("utf8");
    expect(readme.startsWith("---\n")).toBe(true);
    for (const script of ["scripts/content-pack-mirror.mjs", "scripts/content-pack-preflight.mjs"]) {
      // Vite 5's SSR transform recognises a hashbang only with /^#!.*\n/.
      const text = checkedOut(clone, script).toString("utf8");
      expect(/^#!.*\n/.exec(text)?.[0]).toBe(text.slice(0, text.indexOf("\n") + 1));
      expect(text.slice(0, text.indexOf("\n"))).not.toContain("\r");
    }
    const styles = checkedOut(clone, "packages/app/src/renderer/styles.css").toString("utf8");
    expect(styles).toContain("\n.composer,\n.conv-header,");
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "packages/app/buildResources/icon-manifest.json"), "utf8")
    ) as { recipe: { path: string; sha256: string } };
    expect(manifest.recipe.path).toBe(ICON_RECIPE);
    expect(sha256(checkedOut(clone, ICON_RECIPE))).toBe(manifest.recipe.sha256);
  });

  it("keeps the approved icon master and committed binaries byte-exact", { timeout: 30_000 }, () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    const { clone, env } = windowsStyleClone(attributes);
    const icon = checkedOut(clone, ICON_SOURCE);
    expect(icon.length).toBe(EXPECTED_SOURCE_BYTES);
    expect(sha256(icon)).toBe(EXPECTED_SOURCE_SHA256);
    expect(git(clone, ["check-attr", "text", "--", ICON_SOURCE], env).trim()).toBe(`${ICON_SOURCE}: text: unset`);
    for (const relative of BINARY_SAMPLES) {
      expect(checkedOut(clone, relative).equals(committed(relative)), `${relative} changed on checkout`).toBe(true);
      expect(git(clone, ["check-attr", "text", "--", relative], env).trim()).toBe(`${relative}: text: unset`);
    }
  });

  it("negative control: without the LF rule the same clone produces CRLF", { timeout: 30_000 }, () => {
    const { clone } = windowsStyleClone(LEGACY_ATTRIBUTES);
    const readme = checkedOut(clone, "docs/user/en/README.md").toString("utf8");
    expect(readme.startsWith("---\r\n")).toBe(true);
    const recipe = checkedOut(clone, ICON_RECIPE);
    expect(recipe.includes("\r\n")).toBe(true);
    expect(recipe.equals(committed(ICON_RECIPE))).toBe(false);
    // The icon master was already protected before the LF rule existed.
    expect(sha256(checkedOut(clone, ICON_SOURCE))).toBe(EXPECTED_SOURCE_SHA256);
  });
});
