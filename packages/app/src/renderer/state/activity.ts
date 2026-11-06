import type { ToolCardData } from "../components/ToolCard.js";
import type { ThinkingBlockData } from "../components/ThinkingBlock.js";
import type { PersistedToolCard } from "../../shared/design-cards.js";
import { chrome } from "../chrome.js";

/**
 * Chronological activity stream for an assistant run.
 *
 * Pi-Coding-Agent interleaves text deltas, tool calls and reasoning blocks within
 * a single run. To stay faithful to that order in the UI, we model the assistant
 * turn as a single ordered list of items — text segments, tool activity and
 * thinking — instead of three parallel arrays. The store snapshots that stream
 * on finalization for state/diagnostic compatibility; normal chat projects only
 * prose and valid interactions after terminal completion.
 *
 * A text segment is implicitly "closed" the moment a non-text event arrives:
 * the next `text_delta` after a tool or thinking event starts a new segment.
 * Deliberately opened current-turn detail can therefore show the real order
 * without requiring completed chat to retain the technical trace.
 */

export interface TextItem {
  kind: "text";
  /** Stable client-side id used as React key. */
  id: string;
  text: string;
}

export interface ToolItem {
  kind: "tool";
  /** pi's toolCallId — guaranteed unique within a run. */
  id: string;
  data: ToolCardData;
}

export interface ThinkingItem {
  kind: "thinking";
  /** Monotonic counter id. The SDK's `contentIndex` is not unique across
   * sub-turn boundaries, so we mint our own id at `thinking_start`. */
  id: number;
  data: ThinkingBlockData;
}

export type ActivityItem = TextItem | ToolItem | ThinkingItem;

/** Return the index of the last text item if it's still the most recent activity
 * (i.e. the next text_delta should EXTEND it rather than start a new segment).
 * Returns -1 if the last item is non-text or there are no items. */
export function lastOpenTextIndex(items: ActivityItem[]): number {
  if (items.length === 0) return -1;
  const last = items[items.length - 1]!;
  return last.kind === "text" ? items.length - 1 : -1;
}

/** Return the index of the last not-done thinking item, or -1. */
export function lastOpenThinkingIndex(items: ActivityItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "thinking" && !it.data.done) return i;
  }
  return -1;
}

/** A phantom tool item: a tool call with an empty (or whitespace-only) tool name.
 *  A backend may emit a tool call with a valid id but an empty `function.name`
 *  inside a parallel batch; Pi dispatches it and returns a `Tool not found` error,
 *  which reaches the renderer as an empty-named tool item. It is not a real
 *  lecturer-visible action and is suppressed at render time (capability
 *  `desktop-app`, Requirement: Suppression of Empty-Named Phantom Tool Calls; the
 *  request-side fix lives in agent-harness Requirement: Parallel-Tool-Call
 *  Hardening Against Empty-Named Phantom Calls). */
export function isPhantomToolItem(item: ActivityItem): boolean {
  return item.kind === "tool" && item.data.toolName.trim() === "";
}

/** Tool names whose cards are interactive generative-UI calls-to-action: the
 * lecturer answers them, and the answer flows back as the next user turn. */
const INTERACTIVE_TOOLS = new Set(["cbe_picker", "cbe_decision_checklist"]);

/** True for an interactive generative-UI card (picker / decision checklist). */
export function isInteractiveCard(item: ActivityItem): boolean {
  return item.kind === "tool" && INTERACTIVE_TOOLS.has(item.data.toolName);
}

/**
 * Render-order view of the chronological activity stream. Passive items (text,
 * reasoning, `read`/`grep` tool cards, tool-result narration) keep their
 * chronological position; interactive generative-UI cards (`cbe_picker`,
 * `cbe_decision_checklist`) are pinned to the END of the turn — they are
 * calls-to-action the lecturer answers, so they belong below the explanation
 * regardless of where the model emitted the tool call. Relative order within
 * each group is preserved (stable partition).
 *
 * This is presentation-only: the STORED stream stays chronological. The normal-
 * chat projection subsequently removes passive items, while valid interactions
 * remain pinned after the explanation. When the turn holds no interactive card
 * the input array is returned unchanged (referential stability).
 */
export function orderItemsForRender(items: ActivityItem[]): ActivityItem[] {
  // Drop empty-named phantom tool items first (see isPhantomToolItem). When none are
  // present the original array is kept so the no-op path stays referentially stable.
  const base = items.some(isPhantomToolItem) ? items.filter((it) => !isPhantomToolItem(it)) : items;
  const passive: ActivityItem[] = [];
  const interactive: ActivityItem[] = [];
  for (const it of base) (isInteractiveCard(it) ? interactive : passive).push(it);
  return interactive.length === 0 ? base : [...passive, ...interactive];
}

/**
 * Rebuild a re-entered assistant turn's INTERNAL chronological stream from the
 * turn text and compatible design-call records. The normal-chat projection does
 * not render these passive cards, but retaining their offsets and call order
 * keeps existing sidecars readable without migration and preserves downstream
 * diagnostic/state assumptions.
 *
 * Empty text segments are never emitted. A passive-only stored turn therefore
 * remains internally represented by its cards and is omitted by normal chat.
 */
export function activityFromStoredTurn(
  text: string,
  cards: readonly PersistedToolCard[] | undefined,
  mintTextId: () => string
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const pushText = (slice: string) => {
    if (slice.length > 0) items.push({ kind: "text", id: mintTextId(), text: slice });
  };
  if (!cards || cards.length === 0) {
    pushText(text);
    return items;
  }
  const positioned = cards
    .map((card, order) => ({
      card,
      order,
      at: typeof card.at === "number" && card.at >= 0 && card.at <= text.length ? card.at : text.length,
    }))
    .sort((a, b) => a.at - b.at || a.order - b.order);

  let cursor = 0;
  for (const { card, at } of positioned) {
    pushText(text.slice(cursor, at));
    cursor = at;
    items.push({ kind: "tool", id: card.toolCallId, data: toolCardDataFromStored(card) });
  }
  pushText(text.slice(cursor));
  return items;
}

/** Internal activity shape rebuilt from a compatible persisted call. It is not
 * a promise that normal chat will render the reconstructed technical card. */
export function toolCardDataFromStored(card: PersistedToolCard): ToolCardData {
  return {
    toolCallId: card.toolCallId,
    toolName: card.toolName,
    args: card.args,
    status: card.status,
    ...(card.resultText !== undefined ? { result: card.resultText } : {}),
    ...(card.status === "error" ? { errorMessage: card.resultText ?? chrome().toolExecutionFailed } : {}),
  };
}
