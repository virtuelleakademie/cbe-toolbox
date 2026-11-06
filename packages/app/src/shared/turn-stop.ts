import { withoutPositions, type PersistedToolCard } from "./design-cards.js";

/**
 * Host-authored transcript content for a lecturer-stopped turn (capability
 * `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*).
 *
 * Lives in `shared/` — no Electron, no Node — because
 * both sides need it: the main process writes it into the transcript and the
 * Markdown archive, and the renderer projects the persisted turn back onto the
 * chat surface.
 *
 * The two host-authored notes stay DISTINGUISHABLE on purpose. A loop-broken run
 * keeps `errorLoopAbortNote` and must never read as something the lecturer
 * stopped; a lecturer-stopped run gets `chatStoppedTurnPlaceholder` plus the
 * additive `stopped` marker on its turn. Sharing one string would collapse the
 * very distinction the requirement is about.
 *
 * Both notes are chrome and are owned by the interface-language catalogue; the
 * caller passes the resolved wording in, so this module composes turns and names
 * no copy of its own. A turn already written keeps the wording it was written
 * with — a transcript records what was shown, and a later language change does
 * not rewrite it.
 */

/**
 * Promote a pending streamed draft to a COMPLETED assistant turn, carrying the
 * stopped marker when the run it belongs to was stopped by the lecturer.
 *
 * Shared because there are TWO promotions and they must agree: the ordinary one
 * at the turn boundary (the prompt resolved) and the closing flush's (the app is
 * quitting, or the timed-out stop's force-close is replacing the conversation
 * over a run the runtime never released). The closing one is the only path on
 * which a stopped run's partial answer is persisted while the prompt is still
 * pending — promoting it unmarked would archive the half answer the lecturer
 * watched arrive as a complete one, in both sidecars and in the Markdown
 * archive.
 *
 * A draft is only ever non-empty inside a run, and a run start spends the
 * previous run's stopped fact, so `stopped` here always describes the run the
 * draft came from.
 */
export function promotedDraftTurn(
  draft: string,
  stopped: boolean
): { role: "assistant"; text: string; stopped?: true } {
  return { role: "assistant", text: draft, ...(stopped ? { stopped: true as const } : {}) };
}

/**
 * The caller-specific half of the promotion below (design decision D5b).
 *
 * The two flush paths do NOT agree about a stop that streamed nothing, and only
 * the caller knows which case it is, so the difference is named here instead of
 * being duplicated as a second turn shape at the call sites:
 *
 *   - the prompt handler's TURN BOUNDARY passes the catalogue's `chatStoppedTurnPlaceholder` —
 *     that path appended the neutral message before this field existed and must
 *     keep appending it, because it is the assistant text a resumed model is
 *     seeded with (`seedableTurns` drops an empty-text turn, so a turn without it
 *     would silently shorten the seed);
 *   - the CLOSING flush passes nothing — it appended no turn at all there before
 *     this field existed, and synthesising one now would change stop semantics
 *     this change has no mandate for. Its cards-only turn is seed-neutral by the
 *     same filter.
 */
export interface AssistantTurnPromotionOptions {
  /** The neutral text a stop that streamed nothing leaves behind, for the ONE
   * path that appends it. Omitted by every other caller. */
  stoppedPlaceholder?: string;
  /**
   * The Markdown archive's note for a stopped turn, resolved NOW and frozen onto
   * the turn.
   *
   * The archive is regenerated in full on every turn-boundary flush, so a note
   * the writer resolved at write time would be re-rendered for turns recorded
   * long before — a turn stopped while the interface was English would grow a
   * German note under its English body after a language change. A transcript
   * records what was shown, so the note is captured with its turn exactly as the
   * placeholder text already is.
   */
  stoppedNote?: string;
}

/**
 * Promote a finished run to a COMPLETED assistant turn — the ONE place that
 * decides what the run's own output leaves behind, so the turn-boundary flush
 * and the closing flush cannot disagree about it.
 *
 * Three shapes (capability `agent-harness`, Requirement: *Sessions as Local
 * Markdown/JSON Files*):
 *
 *   - text was streamed → that text is the turn, with the run's recorded cards
 *     and their positions, marked stopped where the lecturer stopped it;
 *   - nothing streamed, the lecturer stopped the run, and the caller owns the
 *     placeholder → the neutral message is the turn, marked stopped, carrying
 *     the run's cards WITHOUT their positions: those offsets index the draft the
 *     run streamed, and the placeholder is host chrome, not that draft;
 *   - nothing streamed but design-record calls were made → an empty `text` (the
 *     truth about the model payload; nothing is invented to fill it) carrying
 *     those cards. This is the turn that used to vanish.
 *
 * Returns `null` when the run produced none of them — which is the SAME answer
 * this function's predecessor gave for a caller that owns no placeholder. The
 * renderer draws the same line: a stopped run with activity is finalised as that
 * activity, and the placeholder is reached only when there is no activity at all.
 */
export function promotedAssistantTurn(
  draft: string,
  stopped: boolean,
  cards: readonly PersistedToolCard[],
  options: AssistantTurnPromotionOptions = {}
): {
  role: "assistant";
  text: string;
  stopped?: true;
  stoppedNote?: string;
  cards?: PersistedToolCard[];
} | null {
  const withCards = cards.length > 0 ? { cards: [...cards] } : {};
  const stopMark =
    stopped && options.stoppedNote ? { stoppedNote: options.stoppedNote } : ({} as { stoppedNote?: string });
  if (draft) return { ...promotedDraftTurn(draft, stopped), ...stopMark, ...withCards };
  if (stopped && options.stoppedPlaceholder) {
    return {
      role: "assistant",
      text: options.stoppedPlaceholder,
      stopped: true as const,
      ...stopMark,
      ...(cards.length > 0 ? { cards: withoutPositions(cards) } : {}),
    };
  }
  if (cards.length > 0) {
    return {
      role: "assistant",
      text: "",
      ...(stopped ? { stopped: true as const } : {}),
      ...stopMark,
      cards: [...cards],
    };
  }
  return null;
}
