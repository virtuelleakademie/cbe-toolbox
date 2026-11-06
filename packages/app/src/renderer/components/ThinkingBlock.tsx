import { useState } from "react";
import { useChrome } from "../chrome.js";

export interface ThinkingBlockData {
  /** Monotonic client-side id — survives `contentIndex` collisions across the
   * multiple sub-turns of a single agent run (each SDK message restarts the
   * content index at 0). Use this as the React key, not contentIndex. */
  id: number;
  /** SDK-reported index into the assistant message's content array — kept for
   * traceability against pi-agent-core's event stream. */
  contentIndex: number;
  text: string;
  done: boolean;
}

export function ThinkingBlock({ block, initiallyOpen = false }: { block: ThinkingBlockData; initiallyOpen?: boolean }) {
  const t = useChrome();
  // Collapsed by default both while streaming and after `done` — the reasoning
  // is available for transparency but MUST NOT dominate the chat surface. The
  // lecturer reads the assistant's actual answer first; the reasoning is a click
  // away. Deltas still accumulate in `block.text` even while collapsed, so
  // expanding at any moment reveals the complete reasoning up to that point.
  const [forceOpen, setForceOpen] = useState<boolean | null>(null);
  const expanded = forceOpen ?? initiallyOpen;

  return (
    <div className={`thinking ${block.done ? "thinking-done" : "thinking-live"}`}>
      <button
        type="button"
        className="thinking-head mono"
        onClick={() => setForceOpen(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-label">{block.done ? t.chatThinkingHeadDone : t.chatThinkingHeadLive}</span>
        <span className="thinking-chev" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && <div className="thinking-body">{block.text || t.chatThinkingEmptyBody}</div>}
    </div>
  );
}
