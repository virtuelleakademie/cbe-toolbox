/**
 * Application-level agent-event wiring (capability `desktop-app`, Requirement:
 * Background Conversations and Per-Session Event Demultiplexing).
 *
 * The renderer subscribes to `window.cbe.onAgentEvent` EXACTLY ONCE — here, at
 * store-wiring level, not in a component effect. Every event is routed into the
 * conversation slice owning `event.sessionId` via the store's
 * `ingestAgentEvent`; events for unknown session ids are dropped there. A
 * component-level subscription would die with the component (losing a
 * background session's stream on a course switch) and would double-subscribe
 * under React StrictMode.
 *
 * `cbe_profile` results update the GLOBAL lecturer profile regardless of which
 * session emitted them (the profile is lecturer-scoped, not course-scoped) —
 * that side effect lives here, next to the subscription, so the pure per-slice
 * reducer stays free of global writes.
 */
import type { AgentEvent } from "../../shared/ipc-contract.js";
import { CONFIDENCE_LEVELS, isProfileDimension, type Confidence } from "@cbe/pi-bridge/lecturer-profile";
import { useCbe } from "./store.js";

/** Apply a finished `cbe_profile` tool call to the live profile slice (capability
 * `desktop-app`, Requirement: Profile Panel — "panel updates live"). Reads the
 * VALIDATED result details, skips errors/refusals; a malformed payload is a safe
 * no-op. Override precedence is enforced in the store action. Exported for testing. */
export function applyProfileFromToolResult(result: unknown, isError: boolean): void {
  if (isError || !result || typeof result !== "object") return;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return;
  const d = details as Record<string, unknown>;
  if (d.kind !== "profile-update") return; // ignore refusals and other tools' results
  if (!isProfileDimension(d.dimension)) return;
  if (typeof d.value !== "string" || d.value.trim().length === 0) return;
  if (!(CONFIDENCE_LEVELS as readonly unknown[]).includes(d.confidence)) return;
  if (typeof d.evidence !== "string") return;
  useCbe.getState().applyLecturerProfileUpdate(
    d.dimension,
    {
      value: d.value,
      confidence: d.confidence as Confidence,
      evidence: d.evidence,
      provenance: "estimate",
      lastRevised: new Date().toISOString(),
    },
    d.lecturerConfirmed === true
  );
}

/** The one demux point: slice routing + the global profile side effect. */
export function routeAgentEvent(evt: AgentEvent): void {
  if (evt.type === "tool_execution_end") {
    applyProfileFromToolResult(evt.data.result, evt.data.isError);
  }
  useCbe.getState().ingestAgentEvent(evt);
}

let unsubscribe: (() => void) | null = null;

/**
 * Subscribe the demux to the agent-event channel. Idempotent: a repeated call
 * replaces the previous subscription, so at most ONE live subscription exists
 * (StrictMode-safe by construction). Call once at renderer entry.
 */
export function wireAgentEvents(): void {
  unsubscribe?.();
  unsubscribe = window.cbe.onAgentEvent(routeAgentEvent);
}
