/**
 * Truncated-Completion Detection and Remediation (capability `agent-harness`).
 *
 * Deterministic, model-agnostic backstop against completions that end
 * mid-sentence. Reproduction ground truth (2026-07-21, OpenRouter, small
 * `max_tokens`): `google/gemma-3-27b-it` and `mistralai/mistral-large-2512`
 * both end with `finish_reason: "length"` (streaming: the final chunk carries
 * `finish_reason: "length"` with an empty delta) and a mid-sentence text tail.
 * Pi's openai-completions provider maps that finish reason to
 * `stopReason: "length"` on the assistant message (`mapStopReason` in
 * `@earendil-works/pi-ai`), surfaced to the host on `message_end` — the
 * structural signal this module keys on. A premature provider stop instead
 * arrives as `stopReason: "stop"` with an evidently unfinished text tail; a
 * conservative heuristic covers that variant.
 *
 * Split of responsibility (mirrors the Tool-Call Loop Remediation):
 *  - the pure detector decides WHAT to do (`continue` | `surface` | `none`);
 *  - the host applies the verdict via Pi's PUBLIC surface only
 *    (`applyTruncationVerdict`: `session.steer` to continue, or a
 *    "response was cut off" notice for the surface path). No Pi source patch.
 *
 * Why `steer` continues the run: Pi's agent loop polls its steering queue after
 * every turn (`runLoop` in pi-agent-core); a steer enqueued synchronously from
 * a `message_end` subscriber therefore lands BEFORE the run would end, the
 * queued text is injected as the next user message, and the model finishes the
 * answer in the same run. Past `TRUNCATION_CONTINUE_MAX` continues in one run
 * the verdict degrades to `surface` so a hard output cap can never produce an
 * endless continue loop.
 *
 * Detection NEVER inspects the model id or name — only the structural signal
 * (role, stopReason, text, toolCallCount). The detector is pure (no I/O, no
 * time, no randomness); per-run state is cleared at the run boundary via
 * `reset()`.
 */

/** Auto-continues allowed per agent run before degrading to the cut-off state. */
export const TRUNCATION_CONTINUE_MAX = 2;

/** Steering text injected to continue a truncated generation in the same run. */
export const TRUNCATION_CONTINUE_PROMPT =
  "Your previous message was cut off mid-generation before it was finished. " +
  "Continue the answer exactly where it stopped — do not repeat what you already wrote, do not apologise, just complete the remaining part.";

/** Clear cut-off state surfaced to the lecturer when continuing is not possible. */
export const TRUNCATION_CUTOFF_NOTE =
  "The response was cut off before it was finished. Use continue to let the model complete the answer, or retry the last prompt.";

/**
 * The minimal observed shape of a completed assistant message (`message_end`).
 * Carries ONLY structural facts — deliberately no model id/name field, so
 * detection can never key on the model (the rule is general; the Zlín report
 * merely happened to observe gemma-3-27b-it and mistral-large-2512).
 */
export interface CompletionEndSignal {
  /** The message role; only `"assistant"` messages are considered. */
  role: string;
  /** Pi's stop reason for the message (`"length"` = provider finish_reason length). */
  stopReason: string;
  /** The concatenated text content of the message. */
  text: string;
  /** Number of tool calls the message carries (the run loop continues on its own when > 0). */
  toolCallCount: number;
}

export type TruncationAction = "none" | "continue" | "surface";

export interface TruncationVerdict {
  action: TruncationAction;
  /** Diagnostic reason; present for continue/surface. */
  reason?: string;
  /** The steering text to continue with; present only when action === "continue". */
  continuePrompt?: string;
}

/**
 * Conservative heuristic for an evidently unfinished final message. Triggers
 * only on unambiguous mid-flight tails: an unclosed code fence, a dangling
 * connective (comma / colon / semicolon / open bracket / dash), or a
 * sufficiently long text that stops on a bare word with no terminal
 * punctuation. Anything short or cleanly terminated is treated as finished —
 * false negatives are acceptable, false positives are not.
 */
export function looksEvidentlyUnfinished(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;

  // Unclosed code fence: an odd number of ``` markers means we are inside one.
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) return true;

  // Too short to judge — a terse answer ("yes") is not evidence of truncation.
  if (trimmed.length < 80) return false;

  const last = trimmed.charAt(trimmed.length - 1);
  // Cleanly terminated: sentence-final punctuation or closing delimiters.
  if (/[.!?…"'’”)\]}`]/.test(last)) return false;
  // Dangling connective or a bare word/number tail — evidently mid-sentence.
  return /[,;:\-–—(\[{]/.test(last) || /[\p{L}\p{N}]/u.test(last);
}

/**
 * Pure predicate: is this completed assistant message a truncated completion?
 *
 * True iff the message is an assistant message AND either
 *  - `stopReason === "length"` (the provider hit the output-token cap), or
 *  - `stopReason === "stop"` but the text is evidently unfinished (premature
 *    provider stop).
 *
 * `error` / `aborted` stops are excluded — they have their own handling paths.
 * Tool-call gating happens in the detector, not here: a length-capped message
 * that still carries tool calls keeps the run loop going on its own.
 */
export function isTruncatedCompletion(signal: CompletionEndSignal): boolean {
  if (signal.role !== "assistant") return false;
  if (signal.stopReason === "length") return true;
  if (signal.stopReason === "stop") return looksEvidentlyUnfinished(signal.text);
  return false;
}

/**
 * Incremental per-run truncation detector. The host calls `record()` once per
 * completed assistant message (`message_end`) and acts on the returned verdict,
 * and calls `reset()` at each run boundary (`agent_start`).
 */
export class TruncationDetector {
  private continuesUsed = 0;

  /** Clears per-run state so the continue budget never leaks across runs. */
  reset(): void {
    this.continuesUsed = 0;
  }

  /**
   * Feed one completed assistant message. Returns the action the host should take:
   *  - `continue` (with `continuePrompt`) while the per-run continue budget lasts —
   *    the host steers the running session so the answer finishes;
   *  - `surface` once the budget is exhausted — the host surfaces the clear
   *    "response was cut off" state with a continue/retry affordance;
   *  - `none` when the completion is not truncated, or when it still carries
   *    tool calls (the run loop continues by itself; steering would only
   *    interleave noise).
   */
  record(signal: CompletionEndSignal): TruncationVerdict {
    if (!isTruncatedCompletion(signal)) return { action: "none" };
    if (signal.toolCallCount > 0) return { action: "none" };

    const reasonBase =
      signal.stopReason === "length"
        ? 'stopReason "length" (provider output-token cap)'
        : 'stopReason "stop" with an evidently unfinished final message';

    if (this.continuesUsed < TRUNCATION_CONTINUE_MAX) {
      this.continuesUsed += 1;
      return {
        action: "continue",
        reason: `${reasonBase} — auto-continue ${this.continuesUsed}/${TRUNCATION_CONTINUE_MAX}`,
        continuePrompt: TRUNCATION_CONTINUE_PROMPT,
      };
    }
    return {
      action: "surface",
      reason: `${reasonBase} — continue budget (${TRUNCATION_CONTINUE_MAX}) exhausted, surfacing cut-off state`,
    };
  }
}

export interface TruncationRemediationDeps {
  /** The running Pi session (public steering surface only). */
  session: { steer(text: string): Promise<void> };
  /**
   * Surface the "response was cut off" state to the lecturer, with a one-click
   * continue/retry affordance. The host owns the rendering; headless hosts
   * print the note.
   */
  notifyCutOff: (note: string) => void;
}

/**
 * Applies a detector verdict to the running session via Pi's public surface.
 *
 *  - `continue` → enqueue the continuation steer (fire-and-forget; the enqueue
 *    itself is synchronous, so it lands before the run loop's steering poll).
 *  - `surface` → emit the clear cut-off state so the partial answer is never
 *    presented as final. Returns `true` so the caller knows the run ends in the
 *    cut-off state (session stays open and continuable).
 *  - `none` → no-op.
 *
 * @returns `true` iff the cut-off state was surfaced.
 */
export function applyTruncationVerdict(verdict: TruncationVerdict, deps: TruncationRemediationDeps): boolean {
  if (verdict.action === "continue" && verdict.continuePrompt) {
    void deps.session
      .steer(verdict.continuePrompt)
      .catch((err) => console.error("[truncation-remediation] steer failed:", err));
    return false;
  }
  if (verdict.action === "surface") {
    deps.notifyCutOff(TRUNCATION_CUTOFF_NOTE);
    return true;
  }
  return false;
}
