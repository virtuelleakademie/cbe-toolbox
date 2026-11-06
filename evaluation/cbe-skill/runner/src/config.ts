/**
 * eval.config.json loading + env-var resolution. The config file holds NO
 * secrets: base URL and API key are referenced by environment-variable NAME and
 * resolved here at runtime. A missing variable fails fast, before any model call.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface RawModel {
  name: string;
  modelId: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  contextLength?: number;
  /** Enable reasoning for this candidate (sends reasoning_effort). Default: false. */
  reasoning?: boolean;
  /** Reasoning effort when reasoning is enabled: "low" | "medium" | "high". */
  reasoningEffort?: string;
}

export interface RawConfig {
  candidates: RawModel[];
  /** Optional: only needed for an API-model judge. The default judge is the local Claude CLI. */
  judge?: RawModel;
  /** Gold-set calibration of the judge. Absent = the built-in default threshold. */
  judgeCalibration?: { threshold?: number };
}

export interface ResolvedModel {
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  contextLength?: number;
  /** Enable reasoning for this candidate (sends reasoning_effort). Default: false. */
  reasoning?: boolean;
  /** Reasoning effort when reasoning is enabled: "low" | "medium" | "high". */
  reasoningEffort?: string;
}

export interface ResolvedConfig {
  candidates: ResolvedModel[];
  /** Present only when an API-model judge is configured; otherwise the Claude CLI judge is used. */
  judge?: ResolvedModel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseRawConfig(json: string, file = "eval.config.json"): RawConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) throw new ConfigError(`${file} must be an object`);
  const cfg = raw as Partial<RawConfig>;
  if (!Array.isArray(cfg.candidates) || cfg.candidates.length === 0) {
    throw new ConfigError(`${file} must declare a non-empty "candidates" array`);
  }
  // `judge` is optional: the default judge backend is the local Claude CLI.
  const cal = cfg.judgeCalibration;
  if (cal !== undefined) {
    if (typeof cal !== "object" || cal === null || Array.isArray(cal)) {
      throw new ConfigError(`${file}: "judgeCalibration" must be an object`);
    }
    const t = cal.threshold;
    if (t !== undefined && (typeof t !== "number" || !(t > 0) || t > 1)) {
      throw new ConfigError(`${file}: "judgeCalibration.threshold" must be a number in (0, 1], got ${String(t)}`);
    }
  }
  return cfg as RawConfig;
}

export function loadRawConfig(file: string): RawConfig {
  let body: string;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(`cannot read config file: ${file}`);
  }
  return parseRawConfig(body, file);
}

/**
 * Where the candidate configuration is read from, in order:
 *
 *   1. $CBE_EVAL_CONFIG                                   (explicit override)
 *   2. evaluation/cbe-skill/eval.config.json              (the spec's path; versioned)
 *   3. evaluation/cbe-skill/runner/eval.config.json       (legacy slot, still honoured)
 *
 * There is no example fallback: the real config is versioned, so every genuine
 * checkout carries it, and a second near-identical file kept in step by hand is
 * a drift trap rather than a safety net.
 */
export function configSearchPaths(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const evalDir = path.join(repoRoot, "evaluation", "cbe-skill");
  const paths: string[] = [];
  const explicit = env.CBE_EVAL_CONFIG?.trim();
  if (explicit) paths.push(path.resolve(explicit));
  paths.push(path.join(evalDir, "eval.config.json"));
  paths.push(path.join(evalDir, "runner", "eval.config.json"));
  return paths;
}

/**
 * First existing candidate-config path; throws naming every path it tried.
 *
 * An explicit `$CBE_EVAL_CONFIG` that points at nothing aborts instead of
 * degrading to the default board — a typo'd override must never let a run
 * silently measure a candidate set the operator did not choose.
 */
export function resolveConfigPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const searched = configSearchPaths(repoRoot, env);
  const explicit = env.CBE_EVAL_CONFIG?.trim();
  if (explicit && !existsSync(path.resolve(explicit))) {
    throw new ConfigError(`$CBE_EVAL_CONFIG points at a file that does not exist: ${path.resolve(explicit)}`);
  }
  const found = searched.find((p) => existsSync(p));
  if (found) return found;
  throw new ConfigError(
    `no candidate configuration found. Searched, in order:\n` + searched.map((p) => `  - ${p}`).join("\n")
  );
}

/**
 * The judge-calibration threshold, on EVERY candidate path.
 *
 * The board config is loaded only when `--compare` / `--model` / `--panel` name a
 * candidate from it; the default path resolves the app-configured LLM instead. The
 * threshold, however, is a property of the harness's instrument, not of the candidate
 * source — reading it only on the board path silently discarded a tightened value on
 * the most common invocation (`npm run eval -- --scenarios 04`).
 *
 * `preloaded` is the already-read board config, so the file is not parsed twice. When
 * no configuration file exists at all the built-in fallback stays in charge; a file
 * that exists but is malformed still raises `ConfigError`.
 *
 * The fallback is narrow on purpose. An explicit `$CBE_EVAL_CONFIG` that points at
 * nothing must still abort here, exactly as it does on the board path — swallowing it
 * would let a typo'd override run against the built-in threshold with no message,
 * which is the silent-default class this harness exists to remove.
 */
export function resolveCalibrationThreshold(
  repoRoot: string,
  preloaded: RawConfig | undefined,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  if (preloaded) return preloaded.judgeCalibration?.threshold ?? fallback;
  let file: string;
  try {
    file = resolveConfigPath(repoRoot, env);
  } catch (err) {
    // Only "no configuration anywhere" is a fallback case. A deliberate abort —
    // an explicit override pointing at a missing file — propagates.
    if (env.CBE_EVAL_CONFIG?.trim()) throw err;
    return fallback;
  }
  return loadRawConfig(file).judgeCalibration?.threshold ?? fallback;
}

/**
 * The environment-variable names a configuration references — the exact set a
 * secrets file is allowed to fill. Nothing else may enter the environment.
 */
export function configuredSecretVarNames(raw: RawConfig): string[] {
  const models = [...raw.candidates, ...(raw.judge ? [raw.judge] : [])];
  const names = models.flatMap((m) => [m.baseUrlEnv, m.apiKeyEnv]);
  return [...new Set(names.filter((n) => typeof n === "string" && n.length > 0))];
}

export function resolveModel(
  m: RawModel,
  env: NodeJS.ProcessEnv = process.env,
  /** Appended to a missing-variable error — tells the operator WHERE a file would be picked up. */
  secretsHint?: string
): ResolvedModel {
  const baseURL = env[m.baseUrlEnv];
  const apiKey = env[m.apiKeyEnv];
  const where = secretsHint ? `\n${secretsHint}` : "";
  if (!baseURL) {
    throw new ConfigError(`model "${m.name}": environment variable ${m.baseUrlEnv} is not set${where}`);
  }
  if (!apiKey) {
    throw new ConfigError(`model "${m.name}": environment variable ${m.apiKeyEnv} is not set${where}`);
  }
  return {
    name: m.name,
    modelId: m.modelId,
    baseURL,
    apiKey,
    contextLength: m.contextLength,
    reasoning: m.reasoning,
    reasoningEffort: m.reasoningEffort,
  };
}

export function resolveConfig(
  raw: RawConfig,
  env: NodeJS.ProcessEnv = process.env,
  secretsHint?: string
): ResolvedConfig {
  return {
    candidates: raw.candidates.map((c) => resolveModel(c, env, secretsHint)),
    judge: raw.judge ? resolveModel(raw.judge, env, secretsHint) : undefined,
  };
}
