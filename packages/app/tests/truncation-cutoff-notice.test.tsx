/**
 * ChatPanel-level tests for the Response-Cut-Off State (capability
 * `desktop-app`, Requirement: Response-Cut-Off State with One-Click Continue
 * and Retry). Covers the renderer Scenarios end-to-end through the app-level
 * event demux:
 *
 * - Surfaced cut-off renders a clear state at the affected turn (and clears on
 *   the next agent run).
 * - One-click Continue asks the model to finish the answer.
 * - One-click Retry re-requests the answer in full.
 * - Continue and Retry respect the run lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent, TEST_SESSION_ID } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import { TRUNCATION_CONTINUE_PAYLOAD, TRUNCATION_RETRY_PAYLOAD } from "../src/shared/truncation-cutoff.js";
import { en } from "../src/shared/i18n/en.js";
import type { Turn } from "../src/renderer/state/store.js";

const CUTOFF_NOTE =
  "The response was cut off before it was finished. Use continue to let the model complete the answer, or retry the last prompt.";

/** Drive a run that ends in the surfaced cut-off state. */
function runEndsCutOff() {
  emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
  emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "The design should start with" } });
  emitAgentEvent({ type: "truncation_cutoff", sessionId: TEST_SESSION_ID, data: { note: CUTOFF_NOTE } });
  emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });
}

beforeEach(() => seedConversation());
afterEach(() => useCbe.getState().reset());

describe("ChatPanel response-cut-off state", () => {
  // Scenario: Surfaced cut-off renders a clear state at the affected turn.
  it("renders the cut-off notice with Continue and Retry after a surfaced verdict", () => {
    render(<ChatPanel />);
    runEndsCutOff();

    expect(screen.getByText(/cut off/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeTruthy();
    // The partial answer was still finalized as a turn — but never without the
    // cut-off state standing beside it.
    expect((useCbe.getState().turns as Turn[]).length).toBe(1);
  });

  it("clears the cut-off state when the next agent run starts", () => {
    render(<ChatPanel />);
    runEndsCutOff();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();

    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByText(/cut off/i)).toBeNull();
  });

  // Scenario: One-click Continue asks the model to finish the answer.
  it("continue dispatches exactly one prompt with the continuation payload and chrome display text", async () => {
    const sendPromptSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { sendPrompt: sendPromptSpy });

    render(<ChatPanel />);
    runEndsCutOff();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendPromptSpy).toHaveBeenCalledTimes(1);
    expect(sendPromptSpy).toHaveBeenCalledWith(TEST_SESSION_ID, TRUNCATION_CONTINUE_PAYLOAD, {
      text: en.chatContinueLabel,
    });
    // Display/payload split: the transcript shows the chrome text, not the payload.
    const turns = useCbe.getState().turns as Turn[];
    const last = turns[turns.length - 1]!;
    expect(last.role).toBe("user");
    expect((last as { role: "user"; text: string }).text).toBe(en.chatContinueLabel);
  });

  // Scenario: One-click Retry re-requests the answer in full.
  it("retry dispatches exactly one prompt with the retry payload and chrome display text", async () => {
    const sendPromptSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { sendPrompt: sendPromptSpy });

    render(<ChatPanel />);
    runEndsCutOff();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendPromptSpy).toHaveBeenCalledTimes(1);
    expect(sendPromptSpy).toHaveBeenCalledWith(TEST_SESSION_ID, TRUNCATION_RETRY_PAYLOAD, {
      text: en.chatRetryLabel,
    });
    const turns = useCbe.getState().turns as Turn[];
    const last = turns[turns.length - 1]!;
    expect(last.role).toBe("user");
    expect((last as { role: "user"; text: string }).text).toBe(en.chatRetryLabel);
  });

  // Scenario: Continue and Retry respect the run lock.
  it("disables Continue and Retry and dispatches nothing while a run is in flight", () => {
    const sendPromptSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { sendPrompt: sendPromptSpy });

    render(<ChatPanel />);
    runEndsCutOff();
    // A dispatch is pending (click-to-agent_start window) — the shared run lock.
    act(() => useCbe.getState().setDispatchPending(true));

    const continueBtn = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    const retryBtn = screen.getByRole("button", { name: /^retry$/i }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);
    expect(retryBtn.disabled).toBe(true);

    fireEvent.click(continueBtn);
    fireEvent.click(retryBtn);
    expect(sendPromptSpy).not.toHaveBeenCalled();
  });

  it("a rejected dispatch rolls the optimistic turn back and surfaces the soft chat notice", async () => {
    const sendPromptSpy = vi.fn().mockRejectedValue(new Error("Agent is already processing — wait"));
    Object.assign(window.cbe, { sendPrompt: sendPromptSpy });

    render(<ChatPanel />);
    runEndsCutOff();
    const turnsBefore = (useCbe.getState().turns as Turn[]).length;
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((useCbe.getState().turns as Turn[]).length).toBe(turnsBefore); // rolled back
    expect(useCbe.getState().chatNotice).not.toBeNull();
  });
});
