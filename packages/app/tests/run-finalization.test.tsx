/**
 * Run finalization is driven by `agent_end`, not by the chat composer's send
 * path. A run initiated by a generative-UI card submission (picker / decision
 * checklist) flows straight through `window.cbe.sendPrompt` in `ToolCard` —
 * it never goes through `ChatPanel.send()`, so it has no manual
 * `finishWithActivity` fallback. If finalization is not tied to the run
 * lifecycle, that run's assistant text stays unpersisted in the live bubble and
 * is wiped by the next user prompt's `reset` — the observed data-loss bug
 * (picker → text → chat reply → previous text gone).
 *
 * Covers desktop-app spec, Scenario "Assistant run is finalized on agent_end
 * regardless of what initiated it" and "Auto-retry agent_end does not finalize a
 * partial run".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import type { ActivityItem } from "../src/renderer/state/activity.js";

function seedSession() {
  // Conversation state is per-session (slice + visible mirror); events routed
  // by the app-level demux only land in an existing slice.
  seedConversation();
}

function turnText(activity: ActivityItem[]): string {
  return activity
    .filter((i): i is Extract<ActivityItem, { kind: "text" }> => i.kind === "text")
    .map((i) => i.text)
    .join("");
}

beforeEach(() => seedSession());
afterEach(() => useCbe.getState().reset());

describe("run finalization on agent_end", () => {
  it("persists a run that was not initiated via the composer", () => {
    render(<ChatPanel />);
    // Simulate the picker-initiated run: events arrive WITHOUT ChatPanel.send().
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "Antwort nach Picker-Wahl." } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    const turns = useCbe.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]!.role).toBe("assistant");
    expect(turnText((turns[0] as { activity: ActivityItem[] }).activity)).toBe("Antwort nach Picker-Wahl.");
  });

  it("keeps the picker-run text when a second run follows (no data loss)", () => {
    render(<ChatPanel />);
    // Run A (picker-initiated)
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "Text A" } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });
    // Run B (the next turn)
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "Text B" } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    const turns = useCbe.getState().turns;
    expect(turns).toHaveLength(2);
    expect(turnText((turns[0] as { activity: ActivityItem[] }).activity)).toBe("Text A");
    expect(turnText((turns[1] as { activity: ActivityItem[] }).activity)).toBe("Text B");
  });

  it("does NOT finalize before the settled agent_end — a retry inside the run keeps the buffer", () => {
    // Since `adopt-settled-pi-runtime-lifecycle` the host's `agent_end` is the
    // SETTLED end: a retry's low-level end never reaches the renderer, which sees
    // only the retry signals inside the one run.
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "partial" } });
    emitAgentEvent({
      type: "auto_retry_start",
      sessionId: "test-session",
      data: { attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "503" },
    });
    emitAgentEvent({ type: "auto_retry_end", sessionId: "test-session", data: { success: true, attempt: 1 } });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: " rest" } });
    expect(useCbe.getState().turns).toHaveLength(0);
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });
    const turns = useCbe.getState().turns;
    expect(turns).toHaveLength(1);
    expect(turnText((turns[0] as { activity: ActivityItem[] }).activity)).toBe("partial rest");
  });
});
