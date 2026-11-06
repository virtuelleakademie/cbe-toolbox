/**
 * Build-time default connection — first-run seed of the provider record
 * (capability `desktop-app`, Requirement: Build-Time Default Connection
 * Configuration).
 *
 * Endpoint and model are the configuration the product is developed and
 * measured against (mirrors the `gemma4-31b` entry of the eval board by value,
 * deliberately not by import). The key alone comes from the bundled
 * `resources/defaults/default-llm.json`, written only when a controlled
 * packaging process explicitly supplies `CBE_DEFAULT_LLM_API_KEY`
 * (`scripts/default-llm-config.mjs`); the public release workflow never does.
 * The base URL is the public OpenRouter endpoint and not a secret (product authority
 * decision 2026-08-20).
 *
 * Seed rule: write `cbe-config.json` ONLY when no record exists at all. A
 * record with other values, or one whose key the lecturer erased, is never
 * touched — so an update never overwrites, and an erasure stays erased.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReasoningEffort } from "../shared/ipc-contract.js";

export const DEFAULT_CONNECTION = {
  baseURL: "https://openrouter.ai/api/v1",
  modelId: "google/gemma-4-31b-it",
  contextLength: 131072,
  reasoning: true,
  reasoningEffort: "medium" as ReasoningEffort,
} as const;

/** The bundled file's shape — the key only. */
export interface BundledDefaults {
  apiKey: string;
}

/** Encrypts the key into the persisted record's credential field — the same
 * `apiKeyCipher` / `apiKeyPlain` pair `saveConfig` writes. Injected so the seed
 * is testable without Electron's `safeStorage`. */
export type KeyEncryptor = (apiKey: string) => { apiKeyCipher: string } | { apiKeyPlain: string };

export type SeedOutcome = "seeded" | "kept" | "no-defaults";

/** `null` for a missing, unreadable or malformed file, or a blank key. */
export async function readBundledDefaults(defaultsPath: string): Promise<BundledDefaults | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(defaultsPath, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const apiKey = (raw as { apiKey?: unknown }).apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") return null;
  return { apiKey: apiKey.trim() };
}

async function recordExists(configPath: string): Promise<boolean> {
  try {
    await readFile(configPath);
    return true;
  } catch {
    return false;
  }
}

export async function seedDefaultConnectionConfig(opts: {
  configPath: string;
  defaultsPath: string;
  encryptKey: KeyEncryptor;
}): Promise<SeedOutcome> {
  // Order matters for the user-wins rule: an existing record short-circuits
  // before the defaults are even read.
  if (await recordExists(opts.configPath)) return "kept";
  const defaults = await readBundledDefaults(opts.defaultsPath);
  if (!defaults) return "no-defaults";
  const record = {
    baseURL: DEFAULT_CONNECTION.baseURL,
    modelId: DEFAULT_CONNECTION.modelId,
    ...opts.encryptKey(defaults.apiKey),
    contextLength: DEFAULT_CONNECTION.contextLength,
    reasoning: DEFAULT_CONNECTION.reasoning,
    reasoningEffort: DEFAULT_CONNECTION.reasoningEffort,
  };
  await mkdir(path.dirname(opts.configPath), { recursive: true });
  // `wx`: never clobber a record that appeared between the check and the write.
  try {
    await writeFile(opts.configPath, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return "kept";
    throw err;
  }
  return "seeded";
}
