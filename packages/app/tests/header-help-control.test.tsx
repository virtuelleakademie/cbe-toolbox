/**
 * The header strip's help control (change `reach-help-from-the-app-header`;
 * capability `desktop-app`, Requirements: *Help-Me Button Dispatches a Structured
 * Help Request*, *App Header Strip*). One test per Scenario of the delta.
 *
 * From *Help-Me Button Dispatches a Structured Help Request*:
 *
 * - "The header's question mark dispatches the same help request"
 * - "Both entry points dispatch through one implementation"
 * - "The header control is unavailable during an agent run, with its reason"
 * - "The header control is not offered before the provider is configured"
 * - "The conversation header is untouched"
 *
 * From *App Header Strip*:
 *
 * - "The header's help control dispatches help rather than opening a surface" —
 *   the negative half is the point of it: a question mark in a header strip reads
 *   as "open a help panel", and this control does not open one.
 *
 * The point of the change is that there is exactly ONE dispatch with two entry
 * points, so these tests deliberately assert on the DISPATCH (payload, display
 * projection, optimistic turn, rollback) reached from the header — the same
 * assertions `help-me-control.test.tsx` makes from the "+" menu. A second
 * implementation would pass one file and fail the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { ChatPanel, HELP_TOKEN } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import { entryDisabled, helpEntry } from "./helpers/composer.js";

/** The header's help control. Named by its own owner constant, never by a
 * literal copy of the label — the string has one home (`AppHeader.tsx`). */
const headerHelp = (): HTMLButtonElement =>
  screen.getByRole("button", { name: en.headerHelpLabel }) as HTMLButtonElement;

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

describe("Scenario: The header's question mark dispatches the same help request", () => {
  it("sends exactly the token line with the display projection and appends the optimistic turn", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<AppHeader workspaceVisible configured />);

    await act(async () => {
      fireEvent.click(headerHelp());
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [sessionId, payload, display] = sendSpy.mock.calls[0]!;
    expect(sessionId).toBe("test-session");
    // Renderer-authored payload: exactly the machine token, nothing else — no
    // natural-language scaffold, no language pin.
    expect(payload).toBe(HELP_TOKEN);
    expect(payload).not.toMatch(/language|help me with/i);
    expect(display).toEqual({ text: en.chatHelpDisplayText });

    const lastUser = useCbe
      .getState()
      .turns.filter((t) => t.role === "user")
      .at(-1) as { text: string };
    expect(lastUser.text).toBe(en.chatHelpDisplayText);
    expect(lastUser.text).not.toContain("[help");
  });

  // Scenario (Requirement: App Header Strip): "The header's help control
  // dispatches help rather than opening a surface". The negative half is the
  // one worth asserting — a question mark in a header strip reads as "opens a
  // help panel", and the gear and the user affordance beside it DO open the
  // Profile-and-Settings overlay.
  it("opens no overlay, menu or panel — the dispatch is the whole action", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<AppHeader workspaceVisible configured />);
    expect(useCbe.getState().overlaySection).toBeNull();

    await act(async () => {
      fireEvent.click(headerHelp());
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(useCbe.getState().overlaySection).toBeNull();
  });

  it("announces the dispatch to assistive technology from the header's own live region", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const { container } = render(<AppHeader workspaceVisible configured />);
    const live = () => container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live().textContent).toBe("");

    await act(async () => {
      fireEvent.click(headerHelp());
    });

    expect(live().textContent).toBe(en.chatHelpAnnouncement);
  });

  it("rolls the optimistic turn back on a rejected dispatch and shows the soft notice", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(
      new Error("Error invoking remote method 'cbe:prompt': Error: Agent is already processing.")
    );
    render(<AppHeader workspaceVisible configured />);

    await act(async () => {
      fireEvent.click(headerHelp());
    });

    const state = useCbe.getState();
    expect(state.turns.filter((t) => t.role === "user").length).toBe(0);
    expect(state.chatNotice?.text).toBe(en.errorBusyNoticeText);
    expect(state.error).toBeNull();
  });
});

describe("Scenario: Both entry points dispatch through one implementation", () => {
  it("produces byte-identical dispatch arguments from the header and from the composer's menu", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );

    await act(async () => {
      fireEvent.click(headerHelp());
    });
    const fromHeader = sendSpy.mock.calls[0]!;

    // Second dispatch, this time from the "+" menu's entry. The first one
    // resolved, so nothing is locked. The menu is opened OUTSIDE `act` — a
    // nested `act` would not have flushed the open state before the query.
    const menuEntry = helpEntry();
    await act(async () => {
      fireEvent.click(menuEntry);
    });
    const fromMenu = sendSpy.mock.calls[1]!;

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(fromHeader).toEqual(fromMenu);
  });

  it("leaves the composer draft and the pending attachments untouched from the header too", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    const field = screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Mein halbfertiger Entwurf" } });

    await act(async () => {
      fireEvent.click(headerHelp());
    });

    expect(field.value).toBe("Mein halbfertiger Entwurf");
  });
});

describe("Scenario: The header control is unavailable during an agent run, with its reason", () => {
  it("is aria-disabled while a run is in flight, stays focusable, carries its reason, and dispatches nothing", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<AppHeader workspaceVisible configured />);
    act(() => emitAgentEvent({ type: "agent_start" }));

    const btn = headerHelp();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // The same `aria-disabled`-over-`disabled` discipline the gear and the "+"
    // menu entries keep: focusable, and the reason is the accessible
    // DESCRIPTION rather than a pointer-only tooltip.
    expect(btn.hasAttribute("disabled")).toBe(false);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.chatComposerLockedReason);

    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
  });

  it("covers the dispatch-in-flight window, the same shared lock the composer uses", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<AppHeader workspaceVisible configured />);
    act(() => useCbe.getState().setDispatchPending(true));

    expect(headerHelp().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(headerHelp());
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("says so while the conversation is still starting — there is no session to dispatch into", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.getState().reset();
    useCbe.setState({ hydration: "pending" });
    render(<AppHeader workspaceVisible configured />);

    const btn = headerHelp();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.headerHelpStartingReason);
    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // The window is not only the cold start, and `!session` alone does not describe
  // "no conversation is resolved". A switch into a course with NO slice no longer
  // leaves the outgoing course's session mirrored — `setCourses` / `setActiveCourse`
  // clear the whole mirror (`state/store.ts`, `emptyConversationMirror`; capability
  // `course-workspace`, Requirement: Course-Scoped Isolation of Canvas, Step,
  // Maturity and Decision State). What these two cases seed is the case that
  // remains, and the one the hydration gate is kept for: a mirror that is CORRECT
  // while its resolution is still in flight — a return visit into a course whose
  // slice is already held, or `resumeStoredConversation`, which can close the held
  // session and start another — with that resolution still pending / already failed.
  it("refuses while a course switch is still hydrating, even with a session still mirrored", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({ hydration: "pending" });
    expect(useCbe.getState().session).not.toBeNull();
    render(<AppHeader workspaceVisible configured />);

    const btn = headerHelp();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.headerHelpStartingReason);

    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
  });

  it("keeps refusing after a failed course switch — that state is permanent, not a transient window", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({ hydration: "error", hydrationError: "boom" });
    expect(useCbe.getState().session).not.toBeNull();
    render(<AppHeader workspaceVisible configured />);

    const btn = headerHelp();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(en.headerHelpStartingReason);

    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
  });

  it("presents the two entry points as unavailable together, never one of them only", () => {
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    expect(headerHelp().getAttribute("aria-disabled")).toBeNull();
    expect(entryDisabled(helpEntry())).toBe(false);

    act(() => emitAgentEvent({ type: "agent_start" }));

    expect(headerHelp().getAttribute("aria-disabled")).toBe("true");
    expect(entryDisabled(helpEntry())).toBe(true);
  });
});

describe("Scenario: The header control is not offered before the provider is configured", () => {
  it("renders no help control on the onboarding config dialog — the gate the gear and the profile icon keep", () => {
    const { container } = render(<AppHeader />);
    expect(screen.queryByRole("button", { name: en.headerHelpLabel })).toBeNull();
    expect(container.querySelectorAll(".app-header-right button")).toHaveLength(1);
  });
});

describe("Scenario: The conversation header is untouched", () => {
  it("still carries New Session alone — the help control is in the app header strip, not this row", () => {
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    const conversationHeader = document.querySelector(".conv-header") as HTMLElement;
    expect(conversationHeader).not.toBeNull();
    // Exactly one control, and it is the one that was already there — asserted
    // by count and by identity rather than by its label, which has no owning
    // constant and belongs to another requirement anyway.
    const controls = [...conversationHeader.querySelectorAll("button")];
    expect(controls.length).toBe(1);
    expect(controls[0]!.getAttribute("aria-label")).not.toBe(en.headerHelpLabel);
    // …and the help control is a child of the app header strip instead.
    expect(headerHelp().closest(".app-header")).not.toBeNull();
    expect(headerHelp().closest(".conv-header")).toBeNull();
  });
});
