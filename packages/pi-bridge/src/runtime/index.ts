/**
 * The CBE-owned runtime contracts, and nothing else (capability `agent-harness`,
 * Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*). Reachable as
 * `@cbe/pi-bridge/runtime`, a Pi-free entry point: a consumer that only needs the
 * port and event types — the eval adapter — gets them without the runtime.
 *
 * The Pi adapter modules beside this file are deliberately NOT re-exported.
 */
export type {
  CbeAgentRunPort,
  CbeCompactionReason,
  CbeContextUsage,
  CbeMessageSummary,
  CbeRuntimeEvent,
  CbeRuntimeListener,
  CbeRuntimeSubscription,
  CbeSessionPort,
  CbeSlashCommand,
  ProviderConfig,
  ReasoningEffort,
} from "./contracts.js";
