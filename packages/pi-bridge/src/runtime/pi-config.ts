/**
 * Explicit embedded-runtime configuration — ADAPTER module (capability
 * `agent-harness`, Requirement: *Embedded Pi Runtime Configuration Is Explicit
 * and Versioned*).
 *
 * Every session policy (main conversation, headless, eval, atomization) builds
 * its runtime from THIS module, so correctness never depends on a process-global
 * environment variable having been set by another module first:
 *
 *  - settings are an in-memory `SettingsManager` seeded with the values below —
 *    no `settings.json` is read or written, neither the app's own nor the user's;
 *  - resource discovery is switched off (`CBE_RESOURCE_POLICY`): the host supplies
 *    its prompt, skill and inline extensions explicitly, and no disk-discovered
 *    extension, skill, prompt template, theme or context file can join them;
 *  - model/auth ownership is one public `ModelRuntime` per session, with its
 *    auth file under the host-supplied agent home and no `models.json`.
 *
 * The settings values characterise what the 0.75.5 runtime did with the seeded
 * `{ packages: [], extensions: [], skills: [] }` file and its built-in defaults,
 * and state the two values Pi 1.x changed on purpose:
 *  - `cacheWarming: "off"` — 1.x warms the prompt cache with extra background
 *    provider requests by default; 0.75.5 sent none.
 *  - `retry.provider` — 0.75.5 handed provider requests to the OpenAI client
 *    with no retry/timeout options, so the client's own defaults applied
 *    (2 retries, 10-minute request timeout). 1.x defaults to 0 retries and the
 *    5-minute HTTP idle timeout; both are restored explicitly here.
 */
import path from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

type CbeSettings = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>;

/** The OpenAI client defaults 0.75.5 inherited for every provider request. */
export const LEGACY_PROVIDER_MAX_RETRIES = 2;
export const LEGACY_PROVIDER_TIMEOUT_MS = 600_000;

/** The CBE runtime settings, applied to every session policy. */
export const CBE_PI_SETTINGS: CbeSettings = {
  packages: [],
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  transport: "auto",
  compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2_000,
    provider: {
      maxRetries: LEGACY_PROVIDER_MAX_RETRIES,
      timeoutMs: LEGACY_PROVIDER_TIMEOUT_MS,
      maxRetryDelayMs: 60_000,
    },
  },
  httpIdleTimeoutMs: 300_000,
  cacheWarming: "off",
  enableSkillCommands: true,
  enableInstallTelemetry: false,
  enableAnalytics: false,
};

/** A fresh in-memory settings manager carrying `CBE_PI_SETTINGS`. */
export function createCbeSettingsManager(): SettingsManager {
  return SettingsManager.inMemory(structuredClone(CBE_PI_SETTINGS));
}

/**
 * Resource-discovery policy for `DefaultResourceLoader`: nothing is discovered
 * from disk. Inline extension factories still load; the host's system prompt,
 * skill override and append override are the only resources.
 */
export const CBE_RESOURCE_POLICY = {
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
} as const;

/**
 * One public `ModelRuntime` for a session: auth file under the supplied agent
 * home, no `models.json`, no catalog refresh and no model network access.
 */
export async function createPiModelRuntime(agentDir: string): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
}
