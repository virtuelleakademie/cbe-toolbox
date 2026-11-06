/**
 * Live agent-activity reducer for the assistant's CURRENT RUN — the whole
 * `agent_start` → `agent_end` window, which may contain multiple sub-turns when
 * the model calls tools and gets the results back.
 *
 * Extracted from `ChatPanel.tsx` so it can be unit-tested without mounting React.
 * The component imports `liveReducer`, `INITIAL_LIVE`, `LiveAction`, and
 * `LiveTurnState` from here.
 *
 * Single source of truth: `items` — a chronological list of TextItem / ToolItem
 * / ThinkingItem. A `text_delta` either extends the trailing text item or — when
 * interrupted by a tool/thinking event — starts a new text segment. That produces
 * the lecturer-visible flow "intro → tool → narration → tool → answer" in the
 * order pi emitted it.
 *
 * `thinkingSeq` / `textSeq` are monotonic id sources because the SDK's
 * `contentIndex` is only unique within a single message — we mint our own ids
 * at every `_start`-equivalent event so React keys never collide across
 * sub-turn boundaries.
 */
import { type ActivityItem, lastOpenTextIndex, lastOpenThinkingIndex } from "./activity.js";
import { toolCardErrorMessage } from "../../shared/design-cards.js";
import { chrome } from "../chrome.js";

export interface LiveTurnState {
  items: ActivityItem[];
  thinkingSeq: number;
  textSeq: number;
  streaming: boolean;
  compactionReason: string | null;
  /**
   * Companion sequence phase (capability `desktop-app`, Requirement: Compaction
   * Visibility in the Renderer): "consolidating" | "compacting" while the
   * compaction companion sequence runs, null otherwise. Deliberately SEPARATE
   * from `compactionReason` (which tracks Pi's `compaction_start`/`_end` pair):
   * a steered cycle emits `compaction_end(aborted)` before its re-triggered
   * `compaction_start`, and the phase signal is what keeps the working state
   * continuous across that gap. An "idle" or "error" phase clears it.
   */
  companionPhase: "consolidating" | "compacting" | null;
  retryAttempt: { attempt: number; maxAttempts: number } | null;
}

export type LiveAction =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "text_delta"; data: { delta: string } }
  | { type: "tool_start"; data: { toolCallId: string; toolName: string; args: unknown } }
  | { type: "tool_update"; data: { toolCallId: string; partialResult: unknown } }
  | {
      type: "tool_end";
      data: { toolCallId: string; result: unknown; isError: boolean };
    }
  | { type: "thinking_start"; data: { contentIndex: number } }
  | { type: "thinking_delta"; data: { contentIndex: number; delta: string } }
  | { type: "thinking_end"; data: { contentIndex: number } }
  | { type: "compaction_start"; data: { reason: string } }
  | { type: "compaction_end" }
  | { type: "compaction_phase"; data: { phase: "consolidating" | "compacting" | "idle" | "error" } }
  | { type: "retry_start"; data: { attempt: number; maxAttempts: number } }
  | { type: "retry_end" }
  | { type: "reset" };

export const INITIAL_LIVE: LiveTurnState = {
  items: [],
  thinkingSeq: 0,
  textSeq: 0,
  streaming: false,
  compactionReason: null,
  companionPhase: null,
  retryAttempt: null,
};

function updateItemAt<T extends ActivityItem>(
  items: ActivityItem[],
  index: number,
  updater: (item: T) => T
): ActivityItem[] {
  return items.map((it, i) => (i === index ? updater(it as T) : it));
}

export function liveReducer(state: LiveTurnState, a: LiveAction): LiveTurnState {
  switch (a.type) {
    case "agent_start":
      // Top of a run. We don't wipe items here — `reset` (driven by the user
      // sending a new prompt) is the sole authoritative wipe point.
      return { ...state, streaming: true };
    case "agent_end":
      return { ...state, streaming: false };
    case "turn_start":
      // Sub-turn inside an active run. DO NOT touch items; they accumulate
      // across the whole run.
      return state;
    case "turn_end":
      return state;
    case "text_delta": {
      // Extend the trailing text item if the previous activity was also text,
      // otherwise start a NEW text segment after the most recent tool/thinking
      // item. This is what produces the chronological "text → tool → text →
      // tool → text" sequence in the chat.
      const idx = lastOpenTextIndex(state.items);
      if (idx === -1) {
        return {
          ...state,
          items: [...state.items, { kind: "text", id: `t-${state.textSeq}`, text: a.data.delta }],
          textSeq: state.textSeq + 1,
        };
      }
      return {
        ...state,
        items: updateItemAt(state.items, idx, (it) =>
          it.kind === "text" ? { ...it, text: it.text + a.data.delta } : it
        ),
      };
    }
    case "tool_start":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "tool",
            id: a.data.toolCallId,
            data: {
              toolCallId: a.data.toolCallId,
              toolName: a.data.toolName,
              args: a.data.args,
              status: "running",
            },
          },
        ],
      };
    case "tool_update":
      return {
        ...state,
        items: state.items.map((it) =>
          it.kind === "tool" && it.id === a.data.toolCallId
            ? { ...it, data: { ...it.data, result: a.data.partialResult } }
            : it
        ),
      };
    case "tool_end":
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.kind !== "tool" || it.id !== a.data.toolCallId) return it;
          return {
            ...it,
            data: {
              ...it.data,
              status: a.data.isError ? "error" : "done",
              result: a.data.result,
              // Shared with the host's card recorder (`shared/design-cards.ts`),
              // so a restored design-record card carries the same message the
              // lecturer read live.
              errorMessage: a.data.isError
                ? toolCardErrorMessage(a.data.result, chrome().toolExecutionFailed)
                : undefined,
            },
          };
        }),
      };
    case "thinking_start": {
      const id = state.thinkingSeq;
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "thinking",
            id,
            data: { id, contentIndex: a.data.contentIndex, text: "", done: false },
          },
        ],
        thinkingSeq: state.thinkingSeq + 1,
      };
    }
    case "thinking_delta": {
      const idx = lastOpenThinkingIndex(state.items);
      if (idx === -1) return state;
      return {
        ...state,
        items: state.items.map((it, i) => {
          if (i !== idx || it.kind !== "thinking") return it;
          return { ...it, data: { ...it.data, text: it.data.text + a.data.delta } };
        }),
      };
    }
    case "thinking_end": {
      const idx = lastOpenThinkingIndex(state.items);
      if (idx === -1) return state;
      return {
        ...state,
        items: state.items.map((it, i) => {
          if (i !== idx || it.kind !== "thinking") return it;
          return { ...it, data: { ...it.data, done: true } };
        }),
      };
    }
    case "compaction_start":
      return { ...state, compactionReason: a.data.reason };
    case "compaction_end":
      return { ...state, compactionReason: null };
    case "compaction_phase":
      // "consolidating"/"compacting" arm (or relabel) the continuous working
      // state; "idle" ends the sequence, "error" ends it into the error surface
      // (the notice itself is the conversation reducer's concern) — either way
      // the status NEVER stays stuck (Requirement: Compaction Visibility in the
      // Renderer, failure path).
      return {
        ...state,
        companionPhase: a.data.phase === "consolidating" || a.data.phase === "compacting" ? a.data.phase : null,
      };
    case "retry_start":
      return { ...state, retryAttempt: a.data };
    case "retry_end":
      return { ...state, retryAttempt: null };
    case "reset":
      return INITIAL_LIVE;
  }
}
