/**
 * Loads the candidate model from the CBE Toolbox app's persisted configuration
 * (`cbe-config.json` under the app's userData dir). This makes `npm run eval`
 * evaluate exactly the LLM the lecturer has configured in the app — no separate
 * candidate config needed.
 *
 * Key caveat: the app stores the API key with Electron `safeStorage`
 * (Keychain-encrypted `apiKeyCipher`), which a standalone Node CLI cannot
 * decrypt. So the key is taken from `apiKeyPlain` (only present when safeStorage
 * was unavailable) or from the `CBE_LLM_API_KEY` env var as a fallback.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError, configuredSecretVarNames, type RawConfig, type ResolvedModel } from "./config.js";

const PRODUCT_NAME = "CBE Toolbox";

/**
 * The only environment variable this path reads. Named here so the secrets
 * loader can whitelist it without hardcoding the string a second time.
 */
export const APP_CONFIG_KEY_ENV = "CBE_LLM_API_KEY";

/**
 * Exactly the environment variables one run may import from a secrets file.
 *
 * The two candidate paths are mutually exclusive, and so are their variable
 * sets: with a board config (`--model` / `--compare` / `--panel`) the app config
 * is never read, so `APP_CONFIG_KEY_ENV` must NOT be whitelisted alongside it.
 * Seeding it unconditionally would import one variable more than the resolved
 * configuration references — and every imported variable is inherited by the
 * processes a run spawns (the Claude CLI judge, the pi eval session).
 */
export function secretVarNamesForRun(rawConfig: RawConfig | undefined): string[] {
  return rawConfig ? configuredSecretVarNames(rawConfig) : [APP_CONFIG_KEY_ENV];
}

/** Default `cbe-config.json` path for the current platform's userData dir. */
export function defaultAppConfigPath(home = os.homedir(), platform = process.platform): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", PRODUCT_NAME, "cbe-config.json");
  if (platform === "win32")
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), PRODUCT_NAME, "cbe-config.json");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), PRODUCT_NAME, "cbe-config.json");
}

interface PersistedConfig {
  baseURL?: string;
  modelId?: string;
  apiKeyCipher?: string;
  apiKeyPlain?: string;
  contextLength?: number;
  /** Persisted by the app's Settings; inherited so the live eval sends reasoning_effort exactly as the app would. */
  reasoning?: boolean;
  reasoningEffort?: string;
}

/** Resolve the candidate model from the app's persisted config. */
export function loadAppCandidate(
  configPath = defaultAppConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
  /** Appended to a missing-key error — tells the operator WHERE a secrets file would be picked up. */
  secretsHint?: string
): ResolvedModel {
  let raw: PersistedConfig;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8")) as PersistedConfig;
  } catch {
    throw new ConfigError(
      `cannot read the app config at ${configPath}. Configure the LLM in the CBE Toolbox app first, ` +
        `or run with --model against an eval.config.json candidate.`
    );
  }
  if (!raw.baseURL || !raw.modelId) {
    throw new ConfigError(`app config ${configPath} is missing baseURL or modelId`);
  }
  const apiKey = raw.apiKeyPlain ?? env[APP_CONFIG_KEY_ENV];
  if (!apiKey) {
    const where = secretsHint ? `\n${secretsHint}` : "";
    throw new ConfigError(
      `the app config's API key is Keychain-encrypted (apiKeyCipher) and a standalone CLI cannot decrypt it. ` +
        `Set ${APP_CONFIG_KEY_ENV} to the same key you entered in the app, then re-run.${where}`
    );
  }
  return {
    name: "app-settings",
    modelId: raw.modelId,
    baseURL: raw.baseURL,
    apiKey,
    contextLength: raw.contextLength,
    // Inherit the app's reasoning setting so a default `npm run eval` (no --compare /
    // --model) evaluates the model with reasoning_effort sent exactly as the app
    // would (capability `cbe-skill-eval-harness`, Requirement: Candidate reasoning
    // configuration). Absent fields → undefined → no reasoning_effort (unchanged).
    reasoning: raw.reasoning,
    reasoningEffort: raw.reasoningEffort,
  };
}
