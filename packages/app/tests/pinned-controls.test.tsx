/**
 * The conversation header (changes `add-ux-polish-2026-07-09` and
 * `reshape-the-composer-in-the-llama-cpp-look`; capability `desktop-app`,
 * Requirement: Pinned Session Controls) — Scenarios: The header carries New
 * Session alone; The header stays visible when the transcript is scrolled; The
 * header does not overlay content, even when a confirm state expands; New
 * Session survives the move intact.
 *
 * jsdom performs no layout, so the placement scenarios are asserted
 * structurally: the header is a sibling ABOVE the transcript scroll container
 * (its own grid row — scrolling the transcript cannot move it), and it uses no
 * overlay positioning that could cover content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, TEST_COURSE_ID } from "./helpers/conversation.js";

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
  useCbe.setState({ activeCourseId: TEST_COURSE_ID, hydration: "ready" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Pinned Session Controls", () => {
  // Scenario: The header carries New Session alone
  it("hosts New Session and NO help control, in a row OUTSIDE the transcript scroll container", () => {
    const { container } = render(<ChatPanel />);
    const header = container.querySelector(".conv-header") as HTMLElement;
    const scroll = container.querySelector(".chat-scroll") as HTMLElement;
    expect(header).toBeTruthy();
    expect(scroll).toBeTruthy();
    // Not inside the scrollable content…
    expect(scroll.contains(header)).toBe(false);
    // …but a preceding sibling in the chat column's grid (own row above the viewport).
    expect(header.parentElement).toBe(scroll.parentElement);
    expect(header.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // New Session is its ONLY control.
    expect(within(header).getByRole("button", { name: "New Session" })).toBeTruthy();
    expect(within(header).getAllByRole("button")).toHaveLength(1);
    // In particular no help control — that now lives in the composer's "+" menu.
    expect(
      within(header).queryByRole("button", { name: new RegExp(`Help me|${en.chatHelpEntryLabel}`, "i") })
    ).toBeNull();
  });

  // Scenario: The header stays visible when the transcript is scrolled
  it("is not part of the transcript's scrollable content at any scroll position", () => {
    const { container } = render(<ChatPanel />);
    const header = container.querySelector(".conv-header") as HTMLElement;
    const scroll = container.querySelector(".chat-scroll") as HTMLElement;
    fireEvent.scroll(scroll, { target: { scrollTop: 4000 } });
    expect(scroll.contains(header)).toBe(false);
    expect(within(header).getByRole("button", { name: "New Session" })).toBeTruthy();
  });

  // Scenario: The header does not overlay content, even when a confirm state expands
  it("keeps layout (no overlay positioning) when the New Session confirm state expands inline", () => {
    const { container } = render(<ChatPanel />);
    const header = container.querySelector(".conv-header") as HTMLElement;
    fireEvent.click(within(header).getByRole("button", { name: "New Session" }));
    // Confirm state expands INSIDE the header (grows the row, no overlay).
    const dialog = within(header).getByRole("alertdialog");
    expect(dialog).toBeTruthy();
    // Structural no-overlay guarantee: neither the row nor the confirm uses
    // absolute/fixed positioning (layout yields instead).
    for (const el of [header, dialog as HTMLElement]) {
      const pos = el.style.position;
      expect(pos === "" || pos === "relative" || pos === "static").toBe(true);
    }
    // The transcript scroller is still a following sibling — not covered, displaced.
    const scroll = container.querySelector(".chat-scroll") as HTMLElement;
    expect(scroll.contains(header)).toBe(false);
  });

  // Scenario: New Session survives the move intact — the seven things the
  // requirement names, each checked rather than assumed.
  describe("New Session survives the move intact", () => {
    it("presents the confirmation step with the short copy (panels + Courses, no file name)", () => {
      const { container } = render(<ChatPanel />);
      const header = container.querySelector(".conv-header") as HTMLElement;
      // 1. A confirmation step, never a one-click reset.
      fireEvent.click(within(header).getByRole("button", { name: "New Session" }));
      const dialog = within(header).getByRole("alertdialog");
      // 2. The short copy (change `resume-course-conversations`): the two kept
      // panel surfaces plus the resume route via Courses — no file name, no path.
      const text = (dialog.textContent ?? "").replace(/\s+/g, " ");
      expect(text).toContain("Start a new session?");
      expect(text).toContain("CBE Process Canvas and CBE Maturity entries are preserved");
      expect(text).toContain("resume this conversation anytime from Courses");
      expect(text).not.toContain(".md");
      // 7. Its chrome is English, as every string the app renders is.
      expect(dialog.textContent).not.toMatch(/[äöüß]/);
    });

    it("keeps the initializing state and the recoverable error state with retry", async () => {
      vi.spyOn(window.cbe, "freshConversation").mockImplementation(
        () => new Promise(() => {}) as ReturnType<typeof window.cbe.freshConversation>
      );
      const { container, unmount } = render(<ChatPanel />);
      const header = container.querySelector(".conv-header") as HTMLElement;
      fireEvent.click(within(header).getByRole("button", { name: "New Session" }));
      fireEvent.click(within(header).getByRole("button", { name: "Start new session" }));
      // 3. The initializing state bridges the reset gap.
      expect((await within(header).findByRole("status")).textContent).toContain("Starting new session…");
      unmount();

      // 4. The recoverable error state with retry.
      vi.spyOn(window.cbe, "freshConversation").mockRejectedValue(new Error(en.mainFreshStartFailedNotice));
      const second = render(<ChatPanel />);
      const header2 = second.container.querySelector(".conv-header") as HTMLElement;
      fireEvent.click(within(header2).getByRole("button", { name: "New Session" }));
      fireEvent.click(within(header2).getByRole("button", { name: "Start new session" }));
      const alert = await within(header2).findByRole("alert");
      expect(alert.textContent).toContain("The new session could not be started");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("keeps its locked reason while an agent run is in flight and dispatches nothing", () => {
      const fresh = vi.spyOn(window.cbe, "freshConversation");
      const { container } = render(<ChatPanel />);
      emitAgentEvent({ type: "agent_start" });
      const header = container.querySelector(".conv-header") as HTMLElement;
      const btn = within(header).getByRole("button", { name: "New Session" }) as HTMLButtonElement;
      // 5. The locked reason, bound to the agent_start / agent_end lifecycle.
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe(en.chatNewSessionLockedReason);
      fireEvent.click(btn);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(fresh).not.toHaveBeenCalled();
      emitAgentEvent({ type: "agent_end" });
      expect((within(header).getByRole("button", { name: "New Session" }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
