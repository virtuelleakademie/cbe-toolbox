/**
 * Always-on Pi extension that hardens the outgoing provider request against a
 * backend defect.
 *
 * Some OpenAI-compatible serving backends (observed: qwen3-A3B class) inject an
 * extra tool call with a valid `chatcmpl-tool-*` id but an EMPTY `function.name`
 * inside a PARALLEL tool-call batch. Pi dispatches the empty name and correctly
 * returns a `Tool  not found` error; the model then wastes reasoning turns trying
 * to explain the phantom. The empty call never appears outside a parallel batch.
 *
 * Neither the backend nor Pi/pi-ai may be patched (Pi is the runtime — adapt only
 * via its public configuration). The leverage point we own is Pi's public
 * `before_provider_request` hook, which can replace the outgoing request payload.
 * The OpenAI-compatible providers in pi-ai never set `parallel_tool_calls`, so the
 * server defaults to parallel. Setting it to `false` removes the batch — and with
 * it the phantom — while leaving single tool calls and everything else unchanged.
 *
 * See agent-harness spec, Requirement: Parallel-Tool-Call Hardening Against
 * Empty-Named Phantom Calls.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Hook name this extension registers — used by the host's `extensionsOverride`
 *  filter to retain a handler-only (command-less) extension. */
export const PAYLOAD_HARDENING_HOOK = "before_provider_request" as const;

/**
 * Pure payload transform: set `parallel_tool_calls: false` ONLY when the payload
 * carries a non-empty `tools` array. Returning the (mutated) payload when a change
 * was made, or `undefined` when nothing should change (the hook treats `undefined`
 * as "keep the current payload").
 *
 * The tools-gate matters: the OpenAI Chat Completions API rejects
 * `parallel_tool_calls` when no `tools` are present, so a toolless request (e.g. a
 * plain completion or a compaction summary call) must stay untouched. Every other
 * field is preserved by mutating in place and returning the same object.
 */
export function hardenProviderPayload(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const tools = p.tools;
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  p.parallel_tool_calls = false;
  return p;
}

/**
 * Build the always-on payload-hardening extension. It registers a single
 * `before_provider_request` handler that applies {@link hardenProviderPayload}.
 * It registers NO commands, so the host's defensive `extensionsOverride` filter
 * must retain it via `handlers.has("before_provider_request")`.
 */
export function createPayloadHardeningExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event) => hardenProviderPayload(event.payload));
  };
}
