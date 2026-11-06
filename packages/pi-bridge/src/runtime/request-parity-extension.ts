/**
 * Request-parity extension — ADAPTER module (capability `agent-harness`,
 * Requirement: *Accepted Pi 1.3 Runtime Semantics Are Explicit Contracts*).
 *
 * Two neutralizations, both through Pi's PUBLIC extension hooks, registered on
 * every session policy so the model sees the request shape CBE has always sent:
 *
 *  - `before_agent_start` returns the CBE system-prompt text
 *    (`legacy-system-prompt.ts`) as the run's forced `systemPrompt`. Pi keeps
 *    recording its structured sections in the transcript and projects the forced
 *    text onto the provider request.
 *  - `before_provider_request` removes the output-token cap Pi 1.x derives from
 *    the registered model's `maxTokens` for every agent request. 0.75.5 sent no
 *    cap on agent turns; with the bridge's 4096 default a cap would silently
 *    shorten answers. Compaction summaries do not pass through this hook, so
 *    their (unchanged) summary budget stays on their requests.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Hook the host's extension filter keys this handler-only extension on. */
export const REQUEST_PARITY_HOOK = "before_agent_start" as const;

/** The output-token cap fields an OpenAI-compatible payload may carry. */
const OUTPUT_CAP_FIELDS = ["max_completion_tokens", "max_tokens"] as const;

/**
 * Pure payload transform: drop the output-token cap. Returns the mutated payload
 * when a field was removed, `undefined` (keep the payload) when none was present.
 */
export function stripOutputTokenCap(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  let changed = false;
  for (const field of OUTPUT_CAP_FIELDS) {
    if (field in p) {
      delete p[field];
      changed = true;
    }
  }
  return changed ? p : undefined;
}

export interface RequestParityOptions {
  /** The session's system-prompt text, composed once by the host. */
  systemPrompt: () => string;
}

export function createRequestParityExtension(opts: RequestParityOptions): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", () => ({ systemPrompt: opts.systemPrompt() }));
    pi.on("before_provider_request", (event) => stripOutputTokenCap(event.payload));
  };
}
