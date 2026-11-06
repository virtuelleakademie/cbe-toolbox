/**
 * Host-side half of the Truncated-Completion Detection and Remediation wiring
 * (capability `agent-harness`; renderer surface: capability `desktop-app`,
 * Requirement: Response-Cut-Off State with One-Click Continue and Retry).
 *
 * The pure detector (`@cbe/pi-bridge` `TruncationDetector`) decides WHAT to do
 * and `applyTruncationVerdict` applies it via Pi's public steer surface; this
 * module contributes only the mapping from a normalized `message_end` summary
 * (the CBE-owned runtime event, see `@cbe/pi-bridge/runtime`) to the detector's
 * `CompletionEndSignal`. Kept as a standalone
 * function (not inline in the IPC subscribe closure, mirroring
 * `tool-loop-remediation.ts`) so the wiring is unit-testable without Electron.
 */
import type { CbeMessageSummary, CompletionEndSignal } from "@cbe/pi-bridge";
import { stripTerminalAssistantControlTokens } from "./assistant-text-boundary.js";

/**
 * Map a completed message (`message_end`) to the detector's structural signal:
 * role, stop reason, text content, and the number of tool calls the message
 * carries. Deliberately carries NO model id/name — detection never keys on the
 * model. A degenerate summary maps to a safe empty signal the detector treats as
 * not truncated.
 */
export function completionEndSignalOf(message: CbeMessageSummary): CompletionEndSignal {
  return {
    role: message.role,
    stopReason: message.stopReason ?? "",
    text: stripTerminalAssistantControlTokens(message.text),
    toolCallCount: message.toolCallCount,
  };
}

/**
 * The cut-off state, settled at the run's END rather than at the message that
 * spent the continue budget (capability `agent-harness`, Requirement: *Accepted
 * Pi 1.3 Runtime Semantics Are Explicit Contracts* — truncation).
 *
 * Once CBE's continue budget is spent, Pi 1.x may still recover the answer on
 * its own: it omits the truncated attempt from the model context, compacts and
 * retries once. A completed, untruncated answer later in the same run therefore
 * supersedes a surfaced cut-off, and the lecturer is told the answer was cut off
 * only if the run SETTLES that way. A lecturer-stopped run never carries one.
 */
export class CutOffSettlement {
  private pending: string | null = null;

  /** Run boundary (`agent_start`). */
  reset(): void {
    this.pending = null;
  }

  /** The detector surfaced the cut-off state for this run. */
  surface(note: string): void {
    this.pending = note;
  }

  /** A completed assistant message whose verdict was `none`: a tool-free one is
   *  a finished answer and recovers any pending cut-off. */
  observeUntruncated(message: CbeMessageSummary): void {
    if (message.toolCallCount === 0) this.pending = null;
  }

  /** At the settled end: the note to announce, or `null`. Clears the state. */
  settle(stoppedByLecturer: boolean): string | null {
    const note = stoppedByLecturer ? null : this.pending;
    this.pending = null;
    return note;
  }
}
