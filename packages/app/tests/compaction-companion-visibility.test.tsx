import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent, TEST_SESSION_ID } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import type { Turn } from "../src/renderer/state/store.js";
import { composerField, sendSlotState } from "./helpers/composer.js";

function workingDisclosure(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Working…" });
}

beforeEach(() => seedConversation());
afterEach(() => useCbe.getState().reset());

describe("ChatPanel compaction companion visibility", () => {
  it("uses one continuous disclosure from consolidation start until compaction ends", () => {
    render(<ChatPanel />);

    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "threshold" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "consolidating" } });
    expect(workingDisclosure()).toBeTruthy();
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(1);
    expect(document.querySelector(".chat-banners")).toBeNull();

    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "compacting" } });
    expect(workingDisclosure()).toBeTruthy();
    emitAgentEvent({
      type: "compaction_end",
      sessionId: TEST_SESSION_ID,
      data: { reason: "threshold", aborted: true, willRetry: false },
    });
    expect(workingDisclosure()).toBeTruthy();

    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "manual" } });
    expect(workingDisclosure()).toBeTruthy();
    emitAgentEvent({
      type: "compaction_end",
      sessionId: TEST_SESSION_ID,
      data: { reason: "manual", aborted: false, willRetry: false },
    });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "idle" } });
    expect(workingDisclosure()).toBeNull();
  });

  it("does not restore the default disclosure when prompt-run compaction follows visible prose", () => {
    render(<ChatPanel />);

    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "Visible answer." } });
    expect(workingDisclosure()).toBeNull();
    expect(sendSlotState()).toBe("stop");

    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "threshold" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "consolidating" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "compacting" } });

    expect(screen.getByText("Visible answer.")).toBeTruthy();
    expect(workingDisclosure()).toBeNull();
    expect(document.querySelector(".chat-banners")).toBeNull();
    expect(sendSlotState()).toBe("stop");
  });

  it("keeps a deliberately opened disclosure pinned through prompt-run compaction", () => {
    render(<ChatPanel />);

    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "Visible answer." } });
    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "threshold" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "compacting" } });

    expect(workingDisclosure()).toBeTruthy();
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(1);
    expect(screen.getByText("Visible answer.")).toBeTruthy();
  });

  it("dismisses the disclosure on completion, keeps chat intact and leaves the composer usable", () => {
    seedConversation({
      turns: [
        { role: "user", text: "Please refine the Big Idea" },
        { role: "assistant", activity: [{ kind: "text", id: "t-0", text: "Here is a refined Big Idea." }] },
      ],
    });
    render(<ChatPanel />);

    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "threshold" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "consolidating" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "compacting" } });
    emitAgentEvent({
      type: "compaction_end",
      sessionId: TEST_SESSION_ID,
      data: { reason: "threshold", aborted: false, willRetry: false },
    });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "idle" } });

    expect(workingDisclosure()).toBeNull();
    expect(screen.getByText("Please refine the Big Idea")).toBeTruthy();
    expect(screen.getByText("Here is a refined Big Idea.")).toBeTruthy();
    expect((useCbe.getState().turns as Turn[]).length).toBe(2);
    expect(composerField()).toBeTruthy();
    expect(sendSlotState()).toBe("send");
  });

  it("clears working state on failure and keeps safe recovery without raw detail", () => {
    seedConversation({ turns: [{ role: "user", text: "Please refine the Big Idea" }] });
    render(<ChatPanel />);

    emitAgentEvent({ type: "compaction_start", sessionId: TEST_SESSION_ID, data: { reason: "RAW_REASON" } });
    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "consolidating" } });
    expect(workingDisclosure()).toBeTruthy();

    emitAgentEvent({ type: "compaction_phase", sessionId: TEST_SESSION_ID, data: { phase: "error" } });
    emitAgentEvent({
      type: "compaction_end",
      sessionId: TEST_SESSION_ID,
      data: { reason: "RAW_REASON", aborted: true, willRetry: false, errorMessage: "RAW_COMPACTION_ERROR" },
    });

    expect(workingDisclosure()).toBeNull();
    expect(screen.getByText(/Context compaction failed/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW_COMPACTION_ERROR");
    expect(document.body.textContent).not.toContain("RAW_REASON");
    expect(useCbe.getState().chatNotice).not.toBeNull();
    expect(screen.getByText("Please refine the Big Idea")).toBeTruthy();
  });
});
