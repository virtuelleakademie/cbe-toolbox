import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ipcSource = readFileSync(path.resolve(__dirname, "../src/main/ipc.ts"), "utf8");
const statusSource = readFileSync(path.resolve(__dirname, "../src/renderer/components/CorpusStatus.tsx"), "utf8");
const promptSource = readFileSync(path.resolve(__dirname, "../../pi-bridge/src/cbe-system-prompt.ts"), "utf8");

/**
 * The body of the named function, delimited by its own braces rather than by
 * whatever text happens to follow it — an unrelated import block or a reflowed
 * comment must not decide what this guard reads. String and comment content is
 * skipped so a brace inside either cannot close the body early.
 */
function functionBody(source: string, signature: string): string {
  const from = source.indexOf(signature);
  expect(from, `${signature} is present`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", from + signature.length);
  expect(open, `${signature} has a body`).toBeGreaterThan(from);

  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", i);
      if (eol < 0) break;
      i = eol + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) break;
      i = close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        i += source[i] === "\\" ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
    i += 1;
  }
  throw new Error(`${signature} has no balanced body`);
}

describe("the corpus-refresh host and model boundaries stay unchanged", () => {
  it("invalidates corpus caches only after an adopted update", () => {
    const body = functionBody(ipcSource, "async function runCorpusRefresh()");
    expect(body).toContain('if (result.status === "updated")');
    expect(body).toContain("resolverCache = null");
    expect(body).toContain("resetCorpusCaches()");
    expect(body.indexOf("resetCorpusCaches()")).toBeLessThan(body.indexOf("return result"));
  });

  it.each([
    ["corpus", "export async function corpusStartupRefresh"],
    ["skill", "export async function skillStartupRefresh"],
  ])("keeps the %s startup refresh silent", (_channel, signature) => {
    const body = functionBody(ipcSource, signature);
    expect(body).not.toMatch(/webContents|\.send\(|sendPrompt|runPrompt|notice|BrowserWindow/);
    expect(body).toMatch(/refresh(?:Signed)?(?:Corpus|Skill)|runCorpusRefresh/);
  });

  it("does not put interface language, catalogue copy or notices into updater requests", () => {
    const body = functionBody(ipcSource, "async function runCorpusRefresh()");
    expect(body).not.toMatch(/language|chrome\(|catalogue|notice|prompt/i);
    expect(body).toContain("paths: CORPUS_UPDATER_PATHS");
    expect(body).toContain("installedAppVersion: app.getVersion()");
    expect(body).toContain("appBuildTime: appBuildTime()");
    expect(body).not.toMatch(/pointerUrl|requestHeaders|delivery key/i);
  });

  it("has no legacy free-form result-message sink or model dispatch in the renderer", () => {
    expect(statusSource).not.toMatch(/result\.message|err instanceof Error|String\(err\)/);
    expect(statusSource).not.toMatch(/sendPrompt|agent|systemPrompt|ui-reference/i);
  });

  it("leaves the identity prompt free of corpus-refresh presentation", () => {
    expect(promptSource).not.toMatch(/corpus refresh|refresh corpus|interface language/i);
  });
});
