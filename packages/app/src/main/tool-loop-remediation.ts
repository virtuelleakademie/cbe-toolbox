/**
 * Host-side application of a Tool-Call Loop Remediation verdict (capability
 * `agent-harness`). The pure detector (`@cbe/pi-bridge` `ToolLoopDetector`) decides
 * WHAT to do; this applies it to the running Pi session via the public steering /
 * abort surface, with the Variant-B post-abort recovery (keep the session open,
 * append a neutral assistant note so the next prompt continues cleanly).
 *
 * Kept as a standalone function (not inline in the IPC subscribe closure) so the
 * wiring is unit-testable with a fake session spy.
 */
import type { LoopVerdict } from "@cbe/pi-bridge";
import { chrome } from "./interface-language.js";

export interface LoopRemediationDeps {
  /** The running Pi session (public steering/abort surface only). */
  session: { steer(text: string): Promise<void>; abort(): Promise<void> };
  /** Host transcript to keep continuable (Variant B appends the note here). */
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  /** Surface an error note to the renderer. */
  emitError: (message: string) => void;
  /** Clear the partial streaming draft so the aborted turn does not double-push. */
  clearDraft: () => void;
  /**
   * Claim this run's end for the loop breaker (capability `agent-harness`,
   * Requirement: *A Lecturer Can Stop a Running Turn*). The lecturer's stop
   * claims the SAME run end, and the two want opposite things from the one
   * runtime call: this path clears the draft and appends a neutral note, the
   * lecturer's keeps the text and marks it.
   *
   * The first claim wins. A refused claim means the lecturer already stopped
   * this run, and the whole abort branch below is then a no-op: no second
   * abort, no second recovery note, no cleared draft — one run end, one
   * recovery. Absent (older callers, tests that do not exercise the race) reads
   * as "the claim succeeded", which is today's behaviour unchanged.
   */
  claimRunEnd?: () => boolean;
}

/**
 * Applies a detector verdict to the running session.
 *
 * - `steer` → inject the correction mid-run (fire-and-forget).
 * - `abort` → abort the runaway run, append the neutral recovery note to the
 *   transcript, clear the draft, and emit an error note. Returns `true` so the
 *   caller stops feeding further calls for this run.
 * - `none` → no-op.
 *
 * @returns `true` iff the run was aborted (the caller should stop remediating).
 */
export function applyLoopVerdict(verdict: LoopVerdict, deps: LoopRemediationDeps): boolean {
  if (verdict.action === "steer" && verdict.correction) {
    void deps.session.steer(verdict.correction).catch((err) => console.error("[loop-breaker] steer failed:", err));
    return false;
  }
  if (verdict.action === "abort") {
    // The lecturer may have stopped this very run in the same tick. Whoever
    // claimed the run's end first owns the recovery; a refused claim makes this
    // branch a complete no-op — but it still returns `true`, because the run IS
    // ending and the caller must stop feeding further calls for it.
    if (deps.claimRunEnd && !deps.claimRunEnd()) return true;
    void deps.session.abort().catch((err) => console.error("[loop-breaker] abort failed:", err));
    const note = chrome().errorLoopAbortNote;
    deps.transcript.push({ role: "assistant", text: note });
    deps.clearDraft();
    deps.emitError(note);
    return true;
  }
  return false;
}
