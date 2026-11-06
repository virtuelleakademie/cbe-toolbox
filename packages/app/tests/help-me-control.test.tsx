/**
 * The help dispatch, now the composer's "+" menu help entry (changes
 * `ground-help-me-in-skill` and `reshape-the-composer-in-the-llama-cpp-look`;
 * capability `desktop-app`, Requirement: Help-Me Button Dispatches a Structured
 * Help Request). One test per Scenario:
 *
 * - "Help entry dispatches the bare token and leaves the composer alone"
 * - "Payload carries no language pin"
 * - "Raw token does not resurface after re-entry" (renderer contribution: the
 *   display projection travels with the dispatch)
 * - "Entry is disabled during an agent run, with its reason"
 * - "Rejected help dispatch leaves no phantom turn"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatPanel, HELP_TOKEN } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import { entryDisabled, helpEntry } from "./helpers/composer.js";

function getComposer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
}

function getHelpMe(): HTMLButtonElement {
  return helpEntry();
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
  useCbe.setState({ hydration: "ready" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCbe.getState().reset();
});

describe("Scenario: Help entry dispatches the bare token and leaves the composer alone", () => {
  it("dispatches exactly the token line, closes the menu, keeps the draft, and shows the English chrome turn", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    // A half-finished draft sits in the composer — it must survive untouched.
    fireEvent.change(getComposer(), { target: { value: "Mein halbfertiger Entwurf" } });
    const entry = getHelpMe();
    await act(async () => {
      fireEvent.click(entry);
    });
    // Activating an entry closes the menu (one of the three lecturer-initiated
    // close paths) and returns focus to the "+".
    expect(screen.queryByRole("menu")).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, payload] = sendSpy.mock.calls[0]!;
    // Renderer-authored payload is exactly the token — no scaffold, no draft.
    expect(payload).toBe(HELP_TOKEN);
    // Composer content stays untouched (no consume, no clear, no confirm).
    expect(getComposer().value).toBe("Mein halbfertiger Entwurf");
    // The visible turn renders the English chrome label, never the raw token.
    const lastUser = useCbe
      .getState()
      .turns.filter((t) => t.role === "user")
      .at(-1) as { text: string };
    expect(lastUser.text).toBe(en.chatHelpDisplayText);
    expect(lastUser.text).not.toContain("[help");
  });
});

describe("Scenario: Payload carries no language pin", () => {
  it("the dispatched payload contains only the machine token — no English sentence, no language instruction", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    const entry = getHelpMe();
    await act(async () => {
      fireEvent.click(entry);
    });
    const [, payload] = sendSpy.mock.calls[0]!;
    expect(payload).toBe("[help · app]");
    expect(payload).not.toMatch(/language|answer|help me with/i);
  });
});

describe("Scenario: Raw token does not resurface after re-entry", () => {
  it("passes the display projection alongside the payload so hydration renders the chrome label", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    const entry = getHelpMe();
    await act(async () => {
      fireEvent.click(entry);
    });
    const [, , display] = sendSpy.mock.calls[0]!;
    expect(display).toEqual({ text: en.chatHelpDisplayText });
  });
});

describe("Scenario: Entry is disabled during an agent run, with its reason", () => {
  it("is aria-disabled while streaming, still focusable, carries its reason, and dispatches nothing", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start" });
    const btn = getHelpMe();
    expect(entryDisabled(btn)).toBe(true);
    // `aria-disabled`, not the `disabled` attribute: it stays focusable and its
    // reason is the accessible DESCRIPTION, not a pointer-only tooltip.
    expect(btn.hasAttribute("disabled")).toBe(false);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.chatComposerLockedReason);
    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
    expect(getComposer().value).toBe("");
  });
});

describe("Scenario: Rejected help dispatch leaves no phantom turn", () => {
  it("rolls the optimistic turn back, keeps the composer untouched, and shows the soft notice", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(
      new Error("Error invoking remote method 'cbe:prompt': Error: Agent is already processing.")
    );
    render(<ChatPanel />);
    fireEvent.change(getComposer(), { target: { value: "draft bleibt" } });
    const entry = getHelpMe();
    await act(async () => {
      fireEvent.click(entry);
    });
    const state = useCbe.getState();
    expect(state.turns.filter((t) => t.role === "user").length).toBe(0);
    expect(state.chatNotice?.text).toBe(en.errorBusyNoticeText);
    expect(state.error).toBeNull();
    expect(getComposer().value).toBe("draft bleibt");
  });
});
