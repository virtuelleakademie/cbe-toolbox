/**
 * Build-time default LLM key (capability `desktop-app`, Requirement: Build-Time
 * Default Connection Configuration).
 *
 * Reads `CBE_DEFAULT_LLM_API_KEY` from the packaging step's environment and
 * writes `build-defaults/default-llm.json` (git-ignored), which electron-builder
 * bundles as `resources/defaults/default-llm.json`. The main process seeds the
 * lecturer's provider record from it on first run only
 * (`src/main/default-connection.ts` — endpoint and model defaults live THERE,
 * the file carries the key alone).
 *
 * Absent or blank variable → any stale file is removed and the build packages
 * an unconfigured app. Removing the secret is the whole off-switch. The key is
 * never printed.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LLM_KEY_ENV = "CBE_DEFAULT_LLM_API_KEY";
export const DEFAULT_LLM_FILE = "default-llm.json";

/** `{ apiKey }` when the variable carries a non-blank value, otherwise `null`. */
export function defaultLlmConfigFromEnv(env) {
  const raw = env[DEFAULT_LLM_KEY_ENV];
  if (typeof raw !== "string") return null;
  const apiKey = raw.trim();
  return apiKey === "" ? null : { apiKey };
}

/**
 * Writes or removes `<outDir>/default-llm.json`. The directory always exists
 * afterwards so electron-builder's `extraResources` entry has a source to copy
 * (an empty one bundles nothing). Returns whether defaults were embedded.
 */
export function writeDefaultLlmFile(outDir, env) {
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, DEFAULT_LLM_FILE);
  const cfg = defaultLlmConfigFromEnv(env);
  if (!cfg) {
    rmSync(target, { force: true });
    return false;
  }
  writeFileSync(target, JSON.stringify(cfg), { encoding: "utf8", mode: 0o600 });
  return true;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = argv[0] ?? path.resolve(here, "..", "build-defaults");
  const embedded = writeDefaultLlmFile(outDir, env);
  console.log(embedded ? "default LLM key: embedded" : `default LLM key: not embedded (${DEFAULT_LLM_KEY_ENV} unset)`);
}

// Same CLI guard shape as checksums.mjs — decode before comparing so a path
// with spaces still matches.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
