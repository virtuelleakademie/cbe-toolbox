/**
 * Packaging half of capability `desktop-app`, Requirement: Build-Time Default
 * Connection Configuration — the script the release workflow runs before
 * electron-builder. Scenario: Secret absent produces an unconfigured build.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultLlmConfigFromEnv, writeDefaultLlmFile, DEFAULT_LLM_FILE } from "../scripts/default-llm-config.mjs";

const SCRIPT = path.resolve(__dirname, "../scripts/default-llm-config.mjs");

describe("default LLM key from the packaging environment", () => {
  it("embeds the key when CBE_DEFAULT_LLM_API_KEY is set", () => {
    expect(defaultLlmConfigFromEnv({ CBE_DEFAULT_LLM_API_KEY: " sk-or-test " })).toEqual({ apiKey: "sk-or-test" });
  });

  it("produces no defaults when the variable is absent or blank", () => {
    expect(defaultLlmConfigFromEnv({})).toBeNull();
    expect(defaultLlmConfigFromEnv({ CBE_DEFAULT_LLM_API_KEY: "" })).toBeNull();
    expect(defaultLlmConfigFromEnv({ CBE_DEFAULT_LLM_API_KEY: "   " })).toBeNull();
  });

  it("writes the file with the key only and removes a stale one when the secret is gone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cbe defaults "));
    try {
      expect(writeDefaultLlmFile(dir, { CBE_DEFAULT_LLM_API_KEY: "sk-or-test" })).toBe(true);
      const file = path.join(dir, DEFAULT_LLM_FILE);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ apiKey: "sk-or-test" });
      // Off-switch: the next packaging without the secret must not ship the old key.
      expect(writeDefaultLlmFile(dir, {})).toBe(false);
      expect(existsSync(file)).toBe(false);
      // The directory survives so electron-builder's extraResources source exists.
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("as a CLI never prints the key and removes a stale file when unset", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cbe defaults cli "));
    try {
      const env = { PATH: process.env.PATH ?? "", CBE_DEFAULT_LLM_API_KEY: "sk-or-secret-value" };
      const out = execFileSync(process.execPath, [SCRIPT, dir], { env, encoding: "utf8" });
      expect(out).toContain("embedded");
      expect(out).not.toContain("sk-or-secret-value");
      expect(existsSync(path.join(dir, DEFAULT_LLM_FILE))).toBe(true);

      writeFileSync(path.join(dir, DEFAULT_LLM_FILE), '{"apiKey":"stale"}');
      const out2 = execFileSync(process.execPath, [SCRIPT, dir], {
        env: { PATH: process.env.PATH ?? "" },
        encoding: "utf8",
      });
      expect(out2).toContain("not embedded");
      expect(existsSync(path.join(dir, DEFAULT_LLM_FILE))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
