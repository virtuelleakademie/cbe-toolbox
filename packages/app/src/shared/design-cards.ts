/**
 * Design-record tool cards on a persisted assistant turn (capability
 * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files* —
 * "Design-record tool cards on an assistant turn"). The field is compatibility
 * data; normal chat no longer reconstructs passive technical cards from it.
 *
 * Lives in `shared/` beside `turn-stop.ts` — no Electron, no Node — because all
 * three sides need it: the main process RECORDS a run's calls here, the sidecar
 * read path validates them here, and the renderer projects them back onto the
 * chat surface from here.
 *
 * The scope is the three tools whose calls change state the COURSE keeps
 * (`cbe_canvas`, `cbe_step`, `cbe_maturity`). Those are the calls the transcript
 * has a job beside: the design state itself survives in the host mirrors and the
 * course design-state record, and what the transcript adds is when and how the
 * panels came to hold what they hold. The file tools are unbounded working
 * traces; the deferred-answer tools already ride the answer envelope (capability
 * `desktop-app`, Requirement: *A Turn Ending on a Generative-UI Question Is a
 * Complete Turn*), and a second carrier would duplicate their question on
 * re-entry.
 *
 * A card is a projection of the CALL, never of its rendering. It carries no
 * chrome and remains readable without a data migration. The tool result's
 * `details` payload — which DRIVES canvas,
 * step and maturity state on the live path — is deliberately absent, so a
 * reopened conversation is structurally incapable of re-driving design state
 * from its own transcript.
 */
import { REFERENCE_LANGUAGE, stringsFor } from "./i18n/index.js";

/** The tools whose calls the transcript records (see the module comment). */
export const DESIGN_RECORD_TOOLS = ["cbe_canvas", "cbe_step", "cbe_maturity"] as const;

export type DesignRecordTool = (typeof DESIGN_RECORD_TOOLS)[number];

export function isDesignRecordTool(name: unknown): name is DesignRecordTool {
  return typeof name === "string" && (DESIGN_RECORD_TOOLS as readonly string[]).includes(name);
}

/**
 * Backstop on the persisted result text.
 *
 * The three tools acknowledge in one or two sentences; the longest shapes are a
 * refusal plus the outstanding question, which the pending-answer gate already
 * bounds at 160 characters. So this cap is a genuine backstop against a future
 * verbose ack, not a routine event, and it is deliberately far above the sizes
 * observed today rather than tuned to them. The card body is clamped again at
 * render time by the renderer's own `TOOL_BODY_MAX_CHARS`.
 */
export const CARD_RESULT_MAX_CHARS = 2000;

/** Marker appended when the cap above actually bites, so a truncated body reads
 * as truncated rather than as a tool that stopped mid-sentence. */
export const CARD_RESULT_TRUNCATION_MARKER = "… (truncated)";

/**
 * One recorded design-record call on a persisted assistant turn.
 *
 * Optional and additive on exactly the terms the `display` projection and the
 * `stopped` marker establish: an older sidecar without it stays fully readable,
 * absence means the turn recorded no such call, and a malformed value is treated
 * as absent rather than invalidating the sidecar.
 */
export interface PersistedToolCard {
  /** pi's `toolCallId` — the correlation id, and the renderer's React key. */
  toolCallId: string;
  toolName: DesignRecordTool;
  /** The call arguments, verbatim. Model-authored content of the same class as
   * the turn's own text (a canvas `value` is a paragraph, a step call a handful
   * of numbers), so it is persisted like `text` rather than summarised. Absent
   * where the call carried none. */
  args?: unknown;
  /** Terminal only. A call still running when the turn is promoted is not
   * persisted — a completed turn must not claim a call was in flight. */
  status: "done" | "error";
  /** The text the card's body shows, bounded by `CARD_RESULT_MAX_CHARS`. */
  resultText?: string;
  /** Character offset into the turn's `text` at which this call STARTED, so
   * re-entry can put the card back between the right two text segments. Absent
   * where the turn's text is not the draft the offsets were measured against
   * (the stopped-with-nothing-streamed placeholder), and on legacy records. */
  at?: number;
}

/**
 * The bounded text stored for a design-call result and shown only in deliberately
 * opened current-turn detail. Normal chat does not replay it after completion;
 * the recorder still uses the same extraction rule for compatibility.
 */
export function toolResultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.summary === "string") return r.summary;
    if (typeof r.message === "string") return r.message;
    if (Array.isArray(r.content)) {
      const first = r.content[0];
      if (first && typeof first === "object" && typeof (first as { text?: unknown }).text === "string") {
        return (first as { text: string }).text;
      }
    }
  }
  return "";
}

/**
 * The message an ERRORED tool card shows. Deliberately the same rule the live
 * reducer has always applied: a string result is the message, anything else is
 * the generic one. Restoring a card must reproduce what the lecturer saw, not
 * improve on it.
 *
 * The generic message is CHROME and is therefore passed in: this module is shared
 * by both processes and can reach neither one's active language, while each
 * caller can (capability `desktop-app`, Requirement: *Each Rendered Chrome String
 * Has Exactly One Owner*).
 */
export function toolCardErrorMessage(result: unknown, fallback: string): string {
  return typeof result === "string" ? result : fallback;
}

function boundResultText(text: string): string {
  if (text.length <= CARD_RESULT_MAX_CHARS) return text;
  return text.slice(0, CARD_RESULT_MAX_CHARS - CARD_RESULT_TRUNCATION_MARKER.length) + CARD_RESULT_TRUNCATION_MARKER;
}

/**
 * Per-run buffer of design-record calls, filled from the tool events the host
 * already forwards to the renderer.
 *
 * Mirrors the live reducer's two-event shape: `start` opens the card with the
 * args and the position, `end` closes it with the status and the body. Cards are
 * taken in CALL order (`start` order), which is the order the lecturer saw them
 * begin.
 *
 * Its lifetime is one run: reset at dispatch, cleared with the draft when a
 * runaway run is aborted, emptied by `take()` at promotion.
 */
export class ToolCardRecorder {
  /** Cards whose call has begun and not yet ended, by correlation id. */
  private readonly open = new Map<string, PersistedToolCard>();
  /** Every card of the run, in call order. */
  private readonly order: PersistedToolCard[] = [];
  /** Correlation ids whose call reached a terminal status. */
  private readonly terminal = new Set<string>();

  /** A call began. Non-design-record tools are ignored — that is the scope
   * decision, applied at the single point where a card could be created. */
  start(toolCallId: string, toolName: string, args: unknown, at: number): void {
    if (!isDesignRecordTool(toolName)) return;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) return;
    const card: PersistedToolCard = {
      toolCallId,
      toolName,
      ...(args === undefined ? {} : { args }),
      // Overwritten by `end`; a card that never gets one is not taken.
      status: "done",
      ...(Number.isFinite(at) && at >= 0 ? { at: Math.floor(at) } : {}),
    };
    this.order.push(card);
    this.open.set(toolCallId, card);
  }

  /** A call finished. Unknown ids (a tool outside the scope) are a no-op.
   *
   * `errorFallback` is the host's generic error message in the language the
   * lecturer is reading, recorded at the moment the card is written — a card is a
   * record of what was shown, so it is never re-resolved later. A caller that
   * supplies none records the reference language. */
  end(toolCallId: string, result: unknown, isError: boolean, errorFallback?: string): void {
    const card = this.open.get(toolCallId);
    if (!card) return;
    this.open.delete(toolCallId);
    const text = isError
      ? toolCardErrorMessage(result, errorFallback ?? stringsFor(REFERENCE_LANGUAGE).toolExecutionFailed)
      : toolResultText(result);
    card.status = isError ? "error" : "done";
    if (text) card.resultText = boundResultText(text);
    this.terminal.add(toolCallId);
  }

  /** The run's terminal cards, in call order. Empties the buffer. */
  take(): PersistedToolCard[] {
    const cards = this.order.filter((c) => this.terminal.has(c.toolCallId));
    this.clear();
    return cards;
  }

  clear(): void {
    this.open.clear();
    this.terminal.clear();
    this.order.length = 0;
  }
}

/**
 * The same cards, with their recorded positions dropped.
 *
 * An `at` offset indexes the draft the run streamed. Where the turn's text is
 * NOT that draft — the lecturer-stopped turn whose text is the host's neutral
 * placeholder — keeping the offsets would place the cards inside a sentence they
 * were never measured against. Absent, they clamp to the end of the text, which
 * is the documented fallback (see `at` above).
 */
export function withoutPositions(cards: readonly PersistedToolCard[]): PersistedToolCard[] {
  return cards.map(({ at: _at, ...rest }) => ({ ...rest }));
}

/** Structural validation for the sidecar read path. */
export function isPersistedToolCard(value: unknown): value is PersistedToolCard {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.toolCallId !== "string" || v.toolCallId.length === 0) return false;
  if (!isDesignRecordTool(v.toolName)) return false;
  if (v.status !== "done" && v.status !== "error") return false;
  if (v.resultText !== undefined && typeof v.resultText !== "string") return false;
  if (v.at !== undefined && (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at < 0)) return false;
  return true;
}

/**
 * Make a sidecar's `cards` value safe to hand on: malformed entries are dropped,
 * a non-array is treated as no record at all. Never throws, never rejects the
 * turn — a corrupt card costs a turn its cards, not the lecturer their
 * transcript (the same terms `display` and the design-state fields already use).
 */
export function sanitizeToolCards(value: unknown): { cards: PersistedToolCard[]; dropped: number } {
  if (!Array.isArray(value)) return { cards: [], dropped: value === undefined ? 0 : 1 };
  const cards = value.filter(isPersistedToolCard);
  return { cards, dropped: value.length - cards.length };
}
