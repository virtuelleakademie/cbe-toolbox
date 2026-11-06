import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// The provider configuration is a CBE-owned construction input; it lives with the
// runtime contracts and is re-exported here for the existing import sites.
import type { ProviderConfig } from "./runtime/contracts.js";
export type { ProviderConfig, ReasoningEffort } from "./runtime/contracts.js";

/**
 * Registers a BYO (bring-your-own) OpenAI-compatible LLM endpoint as a custom
 * model on the session's Pi `ModelRuntime`. Works against any OpenAI
 * `/chat/completions`-compatible server (local llama.cpp / vLLM / LM Studio /
 * Ollama, or a hosted endpoint).
 *
 * VERIFIED against @earendil-works/pi-coding-agent 1.3.0 (core/model-runtime.ts):
 * - The runtime registration method is `ModelRuntime.registerProvider(name, ProviderConfigInput)`;
 *   re-registration merges defined values over the previous registration.
 * - `ProviderConfigInput.api` must be one of the `Api` type values from @earendil-works/pi-ai.
 *   For OpenAI-compatible endpoints the correct value is `"openai-completions"`.
 * - The provider requires `baseUrl`, `apiKey`, and at least one model with `api` set.
 * - `authHeader: true` makes the registry inject the apiKey as `Authorization: Bearer <key>`.
 *
 * `contextLength` MUST reflect the real context window of the configured model.
 * A value smaller than the model's true window makes pi misread normal usage as
 * a context overflow and trigger auto-compaction prematurely — which, with the
 * Picker's answer-as-user-turn flow, can surface as a "Cannot continue from
 * message role: assistant" error. When omitted it defaults high (see below) so
 * a sane large window is assumed rather than a small one.
 *
 * After calling this, use `modelRuntime.getModel("byo-llm", cfg.modelId)` to retrieve the model.
 */

// Default context window when the caller does not configure one. Set high
// (128k) so an unconfigured provider assumes a large window rather than a small
// 32k one — a too-small window causes premature overflow/compaction. Users
// SHOULD set the real value for their model in Settings.
export const DEFAULT_CONTEXT_LENGTH = 131_072;
// Model metadata only: Pi derives the compaction summary budget from it. It is
// NOT an answer cap — Pi 1.x would send it as `max_completion_tokens` on every
// agent request, and the request-parity extension keeps it off the wire
// (runtime/request-parity-extension.ts), exactly as 0.75.5 never sent one.
const DEFAULT_MAX_TOKENS = 4_096;

export function registerProvider(registry: ModelRuntime, cfg: ProviderConfig): { provider: string; modelId: string } {
  const providerName = "byo-llm";
  const contextWindow = cfg.contextLength ?? DEFAULT_CONTEXT_LENGTH;
  const maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reasoning = cfg.reasoning ?? false;

  // The pi `Model` type carries `reasoning: boolean` and no `reasoningEffort`
  // field. The openai-completions provider emits `reasoning_effort` only when
  // BOTH (a) the model's `compat.supportsReasoningEffort` is true AND (b) a
  // non-"off" thinking level is passed as the per-call stream option. We set the
  // compat flag here when reasoning is enabled; the thinking level (= effort) is
  // applied at the session level in startCbeSession. When reasoning is disabled we
  // leave compat unset so URL-based auto-detection keeps the previous behaviour.
  registry.registerProvider(providerName, {
    name: "BYO LLM (OpenAI-compatible)",
    baseUrl: cfg.baseURL,
    apiKey: cfg.apiKey,
    // "openai-completions" is the Api discriminant for OpenAI-compatible /chat/completions endpoints.
    // Verified in packages/ai/src/types.ts: KnownApi includes "openai-completions".
    api: "openai-completions" as Parameters<typeof registry.registerProvider>[1]["api"],
    authHeader: true,
    models: [
      {
        id: cfg.modelId,
        name: cfg.modelName ?? cfg.modelId,
        reasoning,
        ...(reasoning ? { compat: { supportsReasoningEffort: true } } : {}),
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      },
    ],
  });

  return { provider: providerName, modelId: cfg.modelId };
}
