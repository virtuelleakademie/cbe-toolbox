/**
 * CBE-owned runtime contracts (capability `agent-harness`, Requirement: *Pi
 * Runtime Is Hidden Behind a CBE-Owned Port*).
 *
 * Every product layer — Electron main, the headless CLI, the eval adapter —
 * talks to the embedded agent runtime through these types and nothing else.
 * This module imports NOTHING from Pi, by construction: the adapter
 * (`pi-session-port.ts`, `pi-events.ts`) is the one place a Pi value is turned
 * into one of these, and an upgrade of the pinned Pi release therefore changes
 * the adapter rather than every consumer.
 *
 * Two deliberate absences, and they are the point of the boundary:
 *  - no raw-session escape hatch and no generic method forwarding — the ports
 *    carry exactly the operations a product caller uses today;
 *  - no `unknown` event channel — every runtime event reaches a consumer as one
 *    member of the closed union below. Activity without product meaning arrives
 *    as a payload-free `runtime_activity`, so a consumer that only needs a sign
 *    of life (the atomization silence deadline) still sees every event without
 *    ever being handed an upstream shape to decode.
 *
 * Lifecycle semantics (capability `agent-harness`, Requirement: *Run Completion
 * Uses Pi Settled State*): one CBE run is one `agent_start` → one `agent_end`.
 * `agent_end` is the CBE-owned TERMINAL event and is emitted only when Pi
 * reports `agent_settled` — after retries, recovery, queued work and settle-hook
 * continuations. Pi's own low-level `agent_end` (and its `willRetry`) never
 * crosses this boundary: it reaches consumers as `runtime_activity`.
 */

// The runtime's own context-occupancy figure is owned by `context-occupancy.ts`,
// which reports it to the host and imports nothing itself.
import type { CbeContextUsage } from "../context-occupancy.js";
export type { CbeContextUsage };

/** How one completed message ended, reduced to what host consumers read. */
export interface CbeMessageSummary {
  /** `user`, `assistant`, `toolResult`, … — the runtime's own role name. */
  role: string;
  /** Present on assistant messages: `stop`, `length`, `toolUse`, `error`, `aborted`. */
  stopReason?: string;
  /** The provider's error text, when the message ended in an error. */
  errorMessage?: string;
  /** The message's text content blocks, concatenated in order, untransformed. */
  text: string;
  /** How many tool calls the message carries. */
  toolCallCount: number;
}

/** Why a compaction ran. */
export type CbeCompactionReason = "manual" | "threshold" | "overflow";

/**
 * The normalized runtime event union. Every runtime event is converted ONCE, at
 * the boundary, into exactly one of these — in the order the runtime emitted it.
 */
export type CbeRuntimeEvent =
  /** A CBE run starts: the first low-level start of one accepted prompt. A
   *  retry's or continuation's later low-level start is `runtime_activity`. */
  | { type: "agent_start" }
  /** The CBE run has SETTLED (sourced from Pi `agent_settled`): exactly one per
   *  `agent_start`, after every message/tool event of the run. `aborted`: the
   *  run ended because it was aborted (a lecturer stop or a loop-breaker abort). */
  | { type: "agent_end"; aborted: boolean }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start" }
  | { type: "message_end"; message: CbeMessageSummary }
  /** Streamed assistant answer text. */
  | { type: "text_delta"; delta: string }
  /** Streamed reasoning, keyed by its content block. */
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number }
  /** A provider stream terminated in error. `reason` is the runtime's own
   *  classification (`aborted` for an abort-originated end, `error` otherwise). */
  | { type: "stream_error"; reason: string; errorMessage?: string }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "compaction_start"; reason: CbeCompactionReason }
  | {
      type: "compaction_end";
      reason: CbeCompactionReason;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  /** Runtime activity with no product meaning (stream bookkeeping, queue
   *  updates, …). Payload-free on purpose: it is a sign of life, nothing more. */
  | { type: "runtime_activity" };

/** A listener for normalized runtime events. */
export type CbeRuntimeListener = (event: CbeRuntimeEvent) => void;

/** Ends a subscription: the listener receives no further events. */
export type CbeRuntimeSubscription = () => void;

/**
 * One agent run surface: what every session policy offers its host. The
 * atomization policy offers exactly this; the main conversation adds the
 * operations in `CbeSessionPort`.
 */
export interface CbeAgentRunPort {
  /** Send one prompt; resolves once the run has settled. */
  prompt(text: string): Promise<void>;
  /** Abort the running turn. */
  abort(): Promise<void>;
  /** Release the session. */
  dispose(): void;
  /** Receive every normalized runtime event of this session, in order. */
  subscribe(listener: CbeRuntimeListener): CbeRuntimeSubscription;
}

/** The main CBE conversation session, as every product layer sees it. */
export interface CbeSessionPort extends CbeAgentRunPort {
  /** Inject a steering message into the running turn. */
  steer(text: string): Promise<void>;
  /** The runtime's context occupancy, or `undefined` when it has none yet. */
  getContextUsage(): CbeContextUsage | undefined;
  /**
   * Re-bind this running session to a new provider, preserving the transcript
   * (capability `agent-harness`, Requirement: Bring-Your-Own-LLM Configuration —
   * runtime re-bind). Rejects — leaving the session on its previous provider —
   * if the config is invalid or the model cannot be resolved. Callers apply it
   * at an idle boundary.
   */
  updateProvider(provider: ProviderConfig): Promise<void>;
  /** The session's slash commands for the renderer's `/` autocomplete; `[]`
   *  when no command extension was wired. */
  getCommands(): CbeSlashCommand[];
}

/** Reasoning effort for models that support OpenAI-style `reasoning_effort`. */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Construction input: the BYO (OpenAI-compatible) provider a session routes to.
 * CBE-owned — the adapter (`provider.ts`) turns it into the runtime's own
 * provider registration.
 */
export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  modelId: string; // exact model name the endpoint expects, e.g. "gpt-oss-120b"
  modelName?: string; // Human-readable display name (defaults to modelId)
  contextLength?: number;
  maxTokens?: number;
  /**
   * Whether this model should run with reasoning enabled. When true, the model is
   * registered with `compat.supportsReasoningEffort = true` so the openai-completions
   * provider includes `reasoning_effort` in the request payload. The actual effort
   * value is taken from `reasoningEffort` (and applied at the session level as the
   * thinking level — see startCbeSession). Default: false (unchanged behaviour).
   */
  reasoning?: boolean;
  /**
   * Per-model reasoning effort. Only meaningful when `reasoning` is true.
   * Defaults to "medium" when reasoning is enabled but no effort is given.
   */
  reasoningEffort?: ReasoningEffort;
}

/** One slash command, as the renderer's `/` autocomplete lists it. */
export interface CbeSlashCommand {
  name: string;
  description?: string;
  /** "extension" (our /cite), "skill", or a runtime built-in ("prompt" etc.). */
  source: string;
}
