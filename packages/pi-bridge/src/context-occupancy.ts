/**
 * Context occupancy, reported to the host (capability `agent-harness`,
 * Requirement: Context Occupancy Reported to the Host).
 *
 * **The figure is the runtime's own, not a second one.** Pi already computes
 * context occupancy through its public `AgentSession.getContextUsage()`, and
 * that figure is the last usage record plus an estimate of the messages after
 * it — built on the same helpers that decide when to compact. This module
 * reports THAT figure and derives nothing: no sum over `input` / `output` /
 * `cacheRead` / `cacheWrite`, no estimate, no reconstruction. A separately
 * derived number would be a second answer to "how full is the context" that
 * disagrees with the one that actually triggers the compaction the report
 * exists to explain.
 */

/** The runtime's own context-usage figure, as the CBE session port reports it
 * (`runtime/contracts.ts` re-exports it as part of the port contract). */
export interface CbeContextUsage {
  /** Estimated context tokens, or `null` where the occupancy is not knowable. */
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** The minimum of the CBE session port this module needs — so a test can supply
 * it without standing up a session. */
export interface ContextUsageSource {
  getContextUsage(): CbeContextUsage | undefined;
}

/**
 * One occupancy report. `used: null` means **unknown**, never zero: the figure
 * is not knowable, which is a different statement from "the context is empty".
 * `window` is present ONLY where the lecturer configured `contextLength` — the
 * provider's high default for an unset value is a safety assumption about an
 * unknown model, not a measurement of it, and is never reported here.
 */
export interface ContextOccupancy {
  used: number | null;
  window?: number;
}

/**
 * Tracks whether the runtime's occupancy figure is MEASURED for the current
 * leg of the session, so the three unknown states the requirement enumerates
 * are all answered `unknown` rather than `0`.
 *
 * The distinction is a lifecycle fact the host owns, not a turn count and not a
 * peek inside the usage records: an occupancy is measured once an assistant
 * message has COMPLETED since the last boundary. Before that there is either
 * nothing at all (a fresh session), or only the resume seed's synthesised
 * zeroed usage object (a resumed session — whose historical figures are not
 * recoverable, so an occupancy derived from those zeros would report a nearly
 * full context as empty), or a newest record that still describes the
 * PRE-compaction context (immediately after a compaction, where pi itself
 * returns `tokens: null`).
 */
export class ContextOccupancyTracker {
  /** Has an assistant message completed since the last boundary? */
  private measured = false;

  /** A completed assistant message: from here the runtime's figure describes
   * this leg of the conversation. */
  noteAssistantMessageCompleted(): void {
    this.measured = true;
  }

  /** A compaction boundary — completed, failed or aborted. The newest usage
   * record still describes the pre-compaction context, so the occupancy is not
   * knowable again until the next assistant message completes. */
  noteCompactionBoundary(): void {
    this.measured = false;
  }

  /** Read the current occupancy. `configuredContextLength` is the lecturer's
   * own value; pass `undefined` where they have not set one. */
  read(source: ContextUsageSource | undefined, configuredContextLength: number | undefined): ContextOccupancy {
    let used: number | null = null;
    if (this.measured && source) {
      // Pi's own accessor; `undefined` (no usage yet) and `null` (not knowable)
      // both mean unknown.
      const usage = source.getContextUsage();
      used = usage?.tokens ?? null;
    }
    const window =
      typeof configuredContextLength === "number" &&
      Number.isFinite(configuredContextLength) &&
      configuredContextLength > 0
        ? configuredContextLength
        : undefined;
    return window === undefined ? { used } : { used, window };
  }
}

/** Do two reports differ? Used to emit only when the occupancy actually moved. */
export function occupancyChanged(a: ContextOccupancy | null, b: ContextOccupancy): boolean {
  if (!a) return true;
  return a.used !== b.used || a.window !== b.window;
}
