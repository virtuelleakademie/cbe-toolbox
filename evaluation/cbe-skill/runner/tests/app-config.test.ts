import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAppCandidate, defaultAppConfigPath, secretVarNamesForRun } from "../src/app-config.js";
import { ConfigError } from "../src/config.js";
import { loadSecretsIntoEnv, describeSecretsSearch } from "../src/secrets.js";

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cbe-appcfg-"));
  const p = path.join(dir, "cbe-config.json");
  writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

describe("app-config candidate loader", () => {
  it("reads baseURL/modelId/contextLength and the plaintext key", () => {
    const p = writeConfig({
      baseURL: "https://llm/v1",
      modelId: "qwen3-31b-a3b",
      apiKeyPlain: "k-123",
      contextLength: 131072,
    });
    const m = loadAppCandidate(p, {} as NodeJS.ProcessEnv);
    expect(m).toMatchObject({
      name: "app-settings",
      baseURL: "https://llm/v1",
      modelId: "qwen3-31b-a3b",
      apiKey: "k-123",
      contextLength: 131072,
    });
  });

  it("falls back to CBE_LLM_API_KEY when the key is Keychain-encrypted", () => {
    const p = writeConfig({ baseURL: "https://llm/v1", modelId: "qwen", apiKeyCipher: "base64cipher" });
    const m = loadAppCandidate(p, { CBE_LLM_API_KEY: "env-key" } as NodeJS.ProcessEnv);
    expect(m.apiKey).toBe("env-key");
  });

  it("throws a clear ConfigError when the key is encrypted and no env fallback is set", () => {
    const p = writeConfig({ baseURL: "https://llm/v1", modelId: "qwen", apiKeyCipher: "base64cipher" });
    expect(() => loadAppCandidate(p, {} as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadAppCandidate(p, {} as NodeJS.ProcessEnv)).toThrow(/CBE_LLM_API_KEY/);
  });

  // Scenario: Missing secrets file names the expected path — on the DEFAULT candidate
  // path too (plain `npm run eval --scenarios NN`, no --model / --compare / --panel),
  // not only on the board path.
  it("names the missing variable and every searched secrets path on the default path", () => {
    const p = writeConfig({ baseURL: "https://llm/v1", modelId: "qwen", apiKeyCipher: "not-a-real-cipher" });
    const repoRoot = mkdtempSync(path.join(tmpdir(), "cbe-repo-"));
    const configHome = mkdtempSync(path.join(tmpdir(), "cbe-xdg-"));
    // No CBE_LLM_API_KEY, no $CBE_EVAL_SECRETS, and no file at either remaining slot.
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;

    const secrets = loadSecretsIntoEnv(repoRoot, secretVarNamesForRun(undefined), env, () => {});
    expect(secrets.loaded).toEqual([]);
    const hint = describeSecretsSearch(secrets);

    expect(() => loadAppCandidate(p, env, hint)).toThrow(ConfigError);
    let message = "";
    try {
      loadAppCandidate(p, env, hint);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("CBE_LLM_API_KEY");
    expect(message).toContain("the same key you entered in the app");
    for (const searched of secrets.searched) expect(message).toContain(searched);
    expect(secrets.searched).toEqual([
      path.join(repoRoot, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      path.join(configHome, "cbe-eval", "secrets"),
    ]);
  });

  it("throws when the config file is missing", () => {
    expect(() => loadAppCandidate("/no/such/cbe-config.json", {} as NodeJS.ProcessEnv)).toThrow(
      /cannot read the app config/
    );
  });

  it("throws when baseURL or modelId is absent", () => {
    const p = writeConfig({ apiKeyPlain: "k" });
    expect(() => loadAppCandidate(p, {} as NodeJS.ProcessEnv)).toThrow(/baseURL or modelId/);
  });

  it("computes the macOS Application Support path", () => {
    const p = defaultAppConfigPath("/Users/x", "darwin");
    expect(p).toBe("/Users/x/Library/Application Support/CBE Toolbox/cbe-config.json");
  });

  // Scenario: No-flag candidate inherits reasoning from cbe-config.json — the
  // default `npm run eval` (no --compare / --model) candidate must send
  // reasoning_effort exactly as the app would.
  it("inherits reasoning / reasoningEffort persisted by the app", () => {
    const p = writeConfig({
      baseURL: "https://llm/v1",
      modelId: "qwen3-a3b",
      apiKeyPlain: "k",
      reasoning: true,
      reasoningEffort: "medium",
    });
    const m = loadAppCandidate(p, {} as NodeJS.ProcessEnv);
    expect(m.reasoning).toBe(true);
    expect(m.reasoningEffort).toBe("medium");
  });

  // Scenario: Candidate without reasoning fields is unchanged — an app config that
  // predates the reasoning setting yields a candidate with no reasoning_effort.
  it("leaves reasoning fields undefined when the app config omits them", () => {
    const p = writeConfig({ baseURL: "https://llm/v1", modelId: "m", apiKeyPlain: "k" });
    const m = loadAppCandidate(p, {} as NodeJS.ProcessEnv);
    expect(m.reasoning).toBeUndefined();
    expect(m.reasoningEffort).toBeUndefined();
  });
});
