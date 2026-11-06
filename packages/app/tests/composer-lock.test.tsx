/**
 * Tests for the composer's lock behaviour.
 *
 * The composer must be locked for the WHOLE agent run — gated by `agent_start` /
 * `agent_end`, NOT `turn_start` / `turn_end`. Sub-turn boundaries inside a
 * tool-using run MUST NOT briefly unlock the composer (Spec scenario *Composer
 * locks for the whole agent run, not per sub-turn*). The local `submitting`
 * flag covers the small window between the user clicking send and `agent_start`
 * arriving (Spec scenario *Lock engages before `agent_start` arrives*). The
 * locked state must be visually distinct — accent-tinted background + pulsing
 * dot + status label (Spec scenario *Locked composer is visually distinct,
 * not just disabled*).
 *
 * These tests drive the panel with a fake `window.cbe` so the `agent_*` and
 * `turn_*` event streams can be simulated deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import { querySendButton, queryStopButton, sendSlotState, stopButton } from "./helpers/composer.js";

function seedSession() {
  // Conversation state is per-session (slice + visible mirror); events routed
  // by the app-level demux only land in an existing slice.
  seedConversation();
}

function getComposer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
}

function getSend(): HTMLButtonElement {
  return screen.getByRole("button", { name: en.chatSendLabel }) as HTMLButtonElement;
}

/**
 * The lock's effect on the send slot, since `reshape-the-composer` gave that
 * slot a second state (Requirement: *Composer Control Row*): while the run lock
 * is engaged the slot is the STOP control, not a disabled send. "Send is
 * disabled" was the pre-stop way of saying the same thing, and asserting it
 * would now fail on an absent element rather than on the lock.
 */
function expectLockedSlot(): void {
  expect(sendSlotState()).toBe("stop");
}

function getComposerEl(): HTMLElement {
  // The locked-class wrapper is the .composer container — find via its child textarea.
  const ta = getComposer();
  let el: HTMLElement | null = ta;
  while (el && !el.classList.contains("composer")) el = el.parentElement;
  if (!el) throw new Error("composer wrapper not found");
  return el;
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  useCbe.getState().reset();
});

describe("composer lock — bound to agent_start / agent_end lifecycle", () => {
  it("send transitions to disabled on agent_start", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    fireEvent.change(ta, { target: { value: "hello" } });
    expect(getSend().disabled).toBe(false);

    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    expectLockedSlot();
  });

  it("composer wrapper gains the composer-locked class on agent_start", () => {
    render(<ChatPanel />);
    expect(getComposerEl().className).not.toContain("composer-locked");
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    expect(getComposerEl().className).toContain("composer-locked");
  });

  it("agent_end releases the lock — send re-enables and the locked class drops", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    fireEvent.change(ta, { target: { value: "hello" } });
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    expectLockedSlot();

    emitAgentEvent({ type: "agent_end", data: { sessionId: "test-session" } });
    expect(sendSlotState()).toBe("send");
    expect(getSend().disabled).toBe(false);
    expect(getComposerEl().className).not.toContain("composer-locked");
  });
});

describe("composer lock — sub-turn boundaries must NOT unlock", () => {
  it("turn_start arriving inside an active agent run does NOT release the lock", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    emitAgentEvent({ type: "turn_start", data: { sessionId: "test-session", messageIndex: 0 } });
    expect(getComposerEl().className).toContain("composer-locked");
    expectLockedSlot();
  });

  it("turn_end arriving inside an active agent run does NOT release the lock", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    emitAgentEvent({ type: "turn_start", data: { sessionId: "test-session", messageIndex: 0 } });
    emitAgentEvent({
      type: "turn_end",
      data: { sessionId: "test-session", messageIndex: 0, finishReason: "tool_use" },
    });
    expect(getComposerEl().className).toContain("composer-locked");
    expectLockedSlot();
  });

  it("a full sub-turn cycle (turn_start → turn_end → turn_start → turn_end) keeps the lock until agent_end", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    for (let i = 0; i < 2; i++) {
      emitAgentEvent({
        type: "turn_start",
        data: { sessionId: "test-session", messageIndex: i },
      });
      emitAgentEvent({
        type: "turn_end",
        data: { sessionId: "test-session", messageIndex: i, finishReason: "tool_use" },
      });
      expect(getComposerEl().className).toContain("composer-locked");
      expectLockedSlot();
    }
    emitAgentEvent({ type: "agent_end", data: { sessionId: "test-session" } });
    expect(getComposerEl().className).not.toContain("composer-locked");
    expect(sendSlotState()).toBe("send");
    expect(getSend().disabled).toBe(true); // empty input → still disabled, but not via lock
  });
});

describe("composer lock — submitting flag covers the click→agent_start race", () => {
  it("a click on send locks the composer IMMEDIATELY, before any agent event arrives", async () => {
    // Pi takes time to ack the prompt. The submit handler awaits sendPrompt; the
    // local `submitting` flag must lock the composer for that whole await,
    // independently of agent_start. We simulate a never-resolving sendPrompt to
    // pin the lock to the submitting flag alone.
    vi.spyOn(window.cbe, "sendPrompt").mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<ChatPanel />);
    const ta = getComposer();
    fireEvent.change(ta, { target: { value: "hello" } });
    fireEvent.click(getSend());

    // No agent_start emitted yet — but the local submitting flag should have
    // already engaged the visual lock.
    expect(getComposerEl().className).toContain("composer-locked");
    expectLockedSlot();
  });
});

describe("composer lock — visual cue (beyond the disabled state)", () => {
  it("the Working disclosure states the run in words through one polite status", () => {
    const { container } = render(<ChatPanel />);
    expect(container.querySelector(".working-disclosure")).toBeNull();
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    const disclosure = container.querySelector(".working-disclosure") as HTMLElement;
    expect(disclosure).toBeTruthy();
    expect(disclosure.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Working…" })).toBeTruthy();
  });

  it("the send slot becomes the stop control, which names what it stops", () => {
    render(<ChatPanel />);
    expect(queryStopButton()).toBeNull();
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    // CARRIER 1: a different control, with its own accessible name — not a
    // re-tinted send, and not a signal a lecturer has to read off a hue.
    expect(querySendButton()).toBeNull();
    expect(stopButton().getAttribute("aria-label")).toBe(en.chatStopLabel);
  });

  it("the retired cues are gone in both states — no status line, no dot, no placeholder", () => {
    const { container } = render(<ChatPanel />);
    expect(getComposer().getAttribute("placeholder")).toBeNull();
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    expect(getComposer().getAttribute("placeholder")).toBeNull();
    expect(container.querySelector(".composer-hint, .composer-status, .composer-status-dot")).toBeNull();
  });
});
