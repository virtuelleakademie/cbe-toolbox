/**
 * Reading the harness's context-occupancy report (capability `desktop-app`,
 * Requirement: Context-Usage Ring in the Composer Control Row).
 *
 * The `used` / `window` figures come from the harness and from nowhere else
 * (capability `agent-harness`, Requirement: Context Occupancy Reported to the
 * Host); nothing here computes or estimates either. What this module owns is
 * the reading of them: which of the ring's states a report is in, and where the
 * near-full band begins.
 */

/**
 * The runtime's own compaction reserve, in tokens: it compacts once the context
 * exceeds `window − reserve`. Declared ONCE, here — measured from pi's
 * `settings-manager` default (`compaction?.reserveTokens ?? 16384`), which the
 * app never overrides.
 */
export const COMPACTION_RESERVE_TOKENS = 16384;

/**
 * The degenerate branch's fallback, as a fraction of the window. Declared ONCE,
 * here, and used ONLY where the compaction point is zero or negative. It is a
 * judgement rather than a derivation — high enough not to fire on a fresh
 * conversation, and the same fraction a 32k window happens to produce under the
 * ordinary branch, so the degenerate presentation is one a lecturer may already
 * have seen.
 */
export const DEGENERATE_NEAR_FULL_FRACTION = 0.5;

/** One occupancy report as it crosses the process boundary. `used: null` means
 * unknown — never zero. `window` absent means the lecturer configured no
 * `contextLength`, so there is no denominator. */
export interface ContextUsageReport {
  used: number | null;
  window?: number;
}

/** The ring's five states. */
export type RingState =
  /** A new conversation with no completed assistant message. */
  | "fresh"
  /** A resumed or just-compacted conversation whose occupancy is unknown. */
  | "carried"
  /** An occupancy is known but no `contextLength` is configured. */
  | "window-unknown"
  /** Both figures known. */
  | "measured"
  /** A compaction companion sequence is running for this conversation. */
  | "pending";

/**
 * Where the near-full band begins, in tokens, for a given window — exactly as
 * Requirement: *Context-Usage Ring in the Composer Control Row*, § _The near-full
 * threshold is derived from the compaction trigger_ states it, in its two
 * branches.
 *
 * Ordinary branch (`window − reserve > 0`): the band engages as the occupancy
 * approaches the configured model's ACTUAL compaction point, and nothing floors,
 * caps or rounds that point up. A floor applied to every window would place the
 * band above the point at which the conversation has already been summarised
 * wherever the compaction point sits low in the window.
 *
 * Degenerate branch (`window − reserve <= 0`): the compaction point carries no
 * information, because the runtime is at or past its trigger from the first
 * turn. Taken literally the derivation would show the near-full presentation on
 * an opening message. There, and only there, the threshold falls back to
 * `DEGENERATE_NEAR_FULL_FRACTION` of the window.
 */
export function nearFullThreshold(window: number): number {
  const compactionPoint = window - COMPACTION_RESERVE_TOKENS;
  return compactionPoint > 0 ? compactionPoint : window * DEGENERATE_NEAR_FULL_FRACTION;
}

/** Is this occupancy in the near-full band? Only ever answerable with both
 * figures known. */
export function isNearFull(used: number, window: number): boolean {
  return used >= nearFullThreshold(window);
}

/** Classify a report (plus the compaction-pending signal) into a ring state.
 * `everMeasured` distinguishes a conversation that has never had a measurement
 * from one that carries context whose figure is not knowable right now. */
export function ringState(
  report: ContextUsageReport | null,
  opts: { pending: boolean; everMeasured: boolean }
): RingState {
  if (opts.pending) return "pending";
  if (!report || report.used === null) return opts.everMeasured ? "carried" : "fresh";
  if (report.window === undefined) return "window-unknown";
  return "measured";
}

/** The filled fraction, 0..1, for the measured state. Any NON-ZERO occupancy
 * gets a minimum visible fill, so a genuinely low reading is never
 * indistinguishable from an unfilled track. */
export const MIN_VISIBLE_FILL = 0.04;

export function fillFraction(used: number, window: number): number {
  if (used <= 0) return 0;
  const raw = window > 0 ? used / window : 0;
  return Math.min(1, Math.max(MIN_VISIBLE_FILL, raw));
}

/** The percentage the text alternative reports. */
export function occupancyPercent(used: number, window: number): number {
  return window > 0 ? Math.round((used / window) * 100) : 0;
}
