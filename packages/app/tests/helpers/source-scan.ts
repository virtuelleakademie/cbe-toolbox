import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Shared machinery for the source-file sweeps that guard chrome-wide rules
 * (capability `desktop-app`, Requirements: *Iconography Instead of Emojis*;
 * *Every String the App Renders Is English*).
 *
 * A sweep of this kind reads the real source trees rather than a rendered
 * surface, so it holds for chrome no test happens to render. Both consumers —
 * `chrome-no-emoji.test.ts` and `chrome-language-sweep.test.ts` — need the same
 * three things: locate the repo, walk a source root, and blank out comments so a
 * rule about RENDERED strings is never decided by a code comment.
 */

/** `packages/app`, found by walking up from wherever vitest was started. */
export function findAppRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(dir, "src", "renderer")) && existsSync(join(dir, "electron.vite.config.ts"))) return dir;
    const nested = join(dir, "packages", "app");
    if (existsSync(join(nested, "src", "renderer"))) return nested;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate packages/app from ${process.cwd()}`);
}

export const APP_ROOT = findAppRoot();
export const REPO_ROOT = dirname(dirname(APP_ROOT));

/**
 * Blanks out comments (line, block and JSX `{/* … *\/}`) while preserving offsets, so a
 * code comment can never decide a rule about rendered strings. String and template
 * literals are tracked so a `//` inside one is not mistaken for a comment.
 */
export function blankComments(source: string): string {
  const out = source.split("");
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") mode = c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === mode) mode = "code";
    else if (c === "\n" && mode !== "`") mode = "code";
    i += 1;
  }
  return out.join("");
}

/**
 * Every source file under `roots` (repo-relative directories) matching `pattern`,
 * sorted. Build output and installed packages are never walked; TESTS AND FIXTURES
 * are outside every root a sweep passes, deliberately — German fixture data is
 * lecturer CONTENT, not chrome.
 */
export function sourceFiles(roots: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (pattern.test(entry.name)) found.push(full);
    }
  };
  for (const root of roots) walk(join(REPO_ROOT, root));
  return found.sort();
}

/** A source file's path relative to the repo root — the form every failure message uses. */
export const repoPath = (file: string): string => relative(REPO_ROOT, file);

/** Read a source file with its comments blanked out. */
export const readCode = (file: string): string => blankComments(readFileSync(file, "utf8"));
