/**
 * Pi event normalization — ADAPTER module (capability `agent-harness`,
 * Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port* — Scenario:
 * *Runtime events are normalized once at the boundary*).
 *
 * The one place an upstream Pi session event is decoded. Every Pi event maps to
 * EXACTLY ONE `CbeRuntimeEvent`, in emission order, so a consumer that counts
 * events as signs of life (the atomization silence deadline) observes the same
 * cadence as before, and nothing is dropped or reordered on the way.
 *
 * Only the fields a host consumer reads cross the boundary. Notably a completed
 * message is reduced to its role, stop reason, error text, concatenated text and
 * tool-call count; the full runtime message never leaves the adapter.
 *
 * Lifecycle (capability `agent-harness`, Requirement: *Run Completion Uses Pi
 * Settled State*): Pi's low-level `agent_end` — one low-level run, possibly
 * followed by a retry, recovery, queued work or a settle-hook continuation —
 * stays inside the adapter as `runtime_activity`. The CBE-owned terminal
 * `agent_end` is emitted from Pi `agent_settled`. `createPiEventNormalizer`
 * additionally collapses the low-level starts of one run into ONE `agent_start`,
 * so every consumer sees exactly one start and one terminal end per CBE run.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { CbeMessageSummary, CbeRuntimeEvent } from "./contracts.js";

const RUNTIME_ACTIVITY: CbeRuntimeEvent = { type: "runtime_activity" };

/**
 * Pi 1.x records its system prompt and tool loadout as transcript `system`
 * messages and announces them with `message_start` / `message_end`. They carry
 * no product meaning — CBE composes the prompt itself — so they cross the
 * boundary as `runtime_activity`, keeping the host's message stream what it
 * was: user, assistant and tool-result messages only.
 */
function isTranscriptSystemMessage(message: unknown): boolean {
  return (message as { role?: unknown } | null | undefined)?.role === "system";
}

/** Reduce a completed runtime message to what host consumers read. */
function summarizeMessage(message: unknown): CbeMessageSummary {
  const m = (message ?? {}) as { role?: unknown; stopReason?: unknown; errorMessage?: unknown; content?: unknown };
  const content = Array.isArray(m.content) ? (m.content as Array<{ type?: unknown; text?: unknown }>) : [];
  return {
    role: typeof m.role === "string" ? m.role : "",
    ...(typeof m.stopReason === "string" ? { stopReason: m.stopReason } : {}),
    ...(typeof m.errorMessage === "string" ? { errorMessage: m.errorMessage } : {}),
    text: content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join(""),
    toolCallCount: content.filter((c) => c.type === "toolCall").length,
  };
}

/** Convert one Pi session event into its normalized CBE counterpart. */
export function normalizePiEvent(event: AgentSessionEvent): CbeRuntimeEvent {
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start" };
    case "agent_end":
      // Low-level end: never terminal at the CBE boundary.
      return RUNTIME_ACTIVITY;
    case "agent_settled":
      return { type: "agent_end", aborted: event.aborted };
    case "turn_start":
    case "turn_end":
      return { type: event.type };
    case "message_start":
      return isTranscriptSystemMessage(event.message) ? RUNTIME_ACTIVITY : { type: "message_start" };
    case "message_end":
      return isTranscriptSystemMessage(event.message)
        ? RUNTIME_ACTIVITY
        : { type: "message_end", message: summarizeMessage(event.message) };
    case "message_update": {
      const ame = event.assistantMessageEvent;
      switch (ame.type) {
        case "text_delta":
          return { type: "text_delta", delta: ame.delta };
        case "thinking_start":
          return { type: "thinking_start", contentIndex: ame.contentIndex };
        case "thinking_delta":
          return { type: "thinking_delta", contentIndex: ame.contentIndex, delta: ame.delta };
        case "thinking_end":
          return { type: "thinking_end", contentIndex: ame.contentIndex };
        case "error": {
          const errorMessage = ame.error?.errorMessage;
          return {
            type: "stream_error",
            reason: ame.reason,
            ...(typeof errorMessage === "string" ? { errorMessage } : {}),
          };
        }
        default:
          return RUNTIME_ACTIVITY;
      }
    }
    case "tool_execution_start":
      return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
    case "tool_execution_update":
      return {
        type: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
      };
    case "tool_execution_end":
      return {
        type: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case "compaction_start":
      return { type: event.type, reason: event.reason };
    case "compaction_end":
      return {
        type: event.type,
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
      };
    case "auto_retry_start":
      return {
        type: event.type,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      };
    case "auto_retry_end":
      return {
        type: event.type,
        success: event.success,
        attempt: event.attempt,
        ...(event.finalError !== undefined ? { finalError: event.finalError } : {}),
      };
    default:
      return RUNTIME_ACTIVITY;
  }
}

/**
 * A stateful normalizer for ONE session: per-event mapping as above, plus the
 * run bracket. The first low-level `agent_start` after idle opens the CBE run;
 * later low-level starts of the same run (retry, recovery, continuation) are
 * `runtime_activity`. `agent_settled` closes the run with the terminal
 * `agent_end`; a settle with no open run (nothing reached `agent_start`) is
 * `runtime_activity`, so no consumer ever sees an end without a start. Still
 * exactly one normalized event per Pi event.
 */
export function createPiEventNormalizer(): (event: AgentSessionEvent) => CbeRuntimeEvent {
  let runOpen = false;
  return (event) => {
    if (event.type === "agent_start") {
      if (runOpen) return RUNTIME_ACTIVITY;
      runOpen = true;
      return { type: "agent_start" };
    }
    if (event.type === "agent_settled") {
      if (!runOpen) return RUNTIME_ACTIVITY;
      runOpen = false;
      return { type: "agent_end", aborted: event.aborted };
    }
    return normalizePiEvent(event);
  };
}
