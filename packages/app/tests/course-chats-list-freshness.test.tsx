/**
 * Chats-list freshness (change `keep-the-chats-list-current`; capability
 * `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki). One test per
 * Scenario:
 *
 * - "A fresh start while the Chats tab is visible lists the new conversation at once"
 * - "Switching the open conversation moves the open marker at once"
 * - "The open row follows the running conversation" (change
 *   `keep-the-open-chat-row-live`, hand test of main 9e03f33, 2026-08-20)
 *
 * Both reproduce the v0.1.12 hand-test finding (2026-08-20): the list read its
 * rows once per mount and marked the open row from that one read, so a fresh
 * start or a conversation switch that went through the store never reached it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import type {
  ConversationListEntry,
  ConversationListResult,
  ConversationOpenResult,
  CourseSummary,
} from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [{ id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" }];

const NEW: ConversationListEntry = {
  sessionId: "conv-new",
  createdAt: "2026-08-10T09:00:00.000Z",
  closedAt: "2026-08-18T09:00:00.000Z",
  resumable: true,
  turnCount: 6,
  snippet: "Wie baue ich Schritt 3 auf?",
};
const OLD: ConversationListEntry = {
  sessionId: "conv-old",
  createdAt: "2026-07-01T09:00:00.000Z",
  closedAt: "2026-07-02T09:00:00.000Z",
  resumable: true,
  turnCount: 12,
  snippet: "Erster Entwurf des Moduls",
};
const FRESH: ConversationListEntry = {
  sessionId: "conv-fresh",
  createdAt: "2026-08-20T09:00:00.000Z",
  closedAt: "2026-08-20T09:00:00.000Z",
  resumable: true,
  turnCount: 0,
};

function openResult(sessionId: string): ConversationOpenResult {
  return {
    session: testSession(sessionId, "algorithmen"),
    turns: [],
    agentRunning: false,
    canvas: [],
  } as unknown as ConversationOpenResult;
}

function openDetails(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
}

/** The main-side scan, mutable so a test can make a later read return more. */
let scan: ConversationListResult;

beforeEach(() => {
  scan = { conversations: [NEW, OLD], openSessionId: "conv-new" };
  seedConversation({ session: testSession("conv-new", "algorithmen") });
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen", hydration: "ready" });
  Object.assign(window.cbe, {
    listCourses: async () => ({ courses: COURSES, activeCourseId: "algorithmen" }),
    listConversations: vi.fn(async () => scan),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
});

describe("Scenario: A fresh start while the Chats tab is visible lists the new conversation at once", () => {
  it("shows the fresh conversation's row, marked open, without a tab switch or remount", async () => {
    render(<CoursesPanel />);
    openDetails("Algorithmen");
    const list = await screen.findByRole("list", { name: "Stored conversations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    // New Session elsewhere in the chrome: main started a fresh session (and
    // flushed its pair), the renderer hydrated the result into the store.
    scan = { conversations: [FRESH, NEW, OLD], openSessionId: "conv-fresh" };
    useCbe.getState().hydrateConversation(openResult("conv-fresh"));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("No messages yet");
    const buttons = rows.map((r) => within(r).getByRole("button"));
    expect(buttons[0]!.getAttribute("aria-current")).toBe("true");
    expect(buttons[1]!.getAttribute("aria-current")).toBeNull();
  });
});

describe("Scenario: Switching the open conversation moves the open marker at once", () => {
  it("marks the hydrated conversation as open as soon as the store holds it, ahead of any re-read", async () => {
    render(<CoursesPanel />);
    openDetails("Algorithmen");
    const list = await screen.findByRole("list", { name: "Stored conversations" });
    const buttonOf = (i: number) => within(within(list).getAllByRole("listitem")[i]!).getByRole("button");
    expect(buttonOf(0).getAttribute("aria-current")).toBe("true");

    // The open pipeline hydrated conv-old as the course's open conversation.
    // The scan deliberately still reports the OLD open id: the marker must
    // follow the hydrated identity, not wait for a later read to agree.
    useCbe.getState().hydrateConversation(openResult("conv-old"));

    await waitFor(() => expect(buttonOf(1).getAttribute("aria-current")).toBe("true"));
    expect(buttonOf(0).getAttribute("aria-current")).toBeNull();
    expect(within(buttonOf(1)).getByText("open")).toBeTruthy();
    expect(within(buttonOf(0)).queryByText("open")).toBeNull();
  });
});

describe("Scenario: The open row follows the running conversation", () => {
  it("shows the live turn count and first-message snippet of the open conversation while the list is mounted", async () => {
    render(<CoursesPanel />);
    openDetails("Algorithmen");
    const list = await screen.findByRole("list", { name: "Stored conversations" });

    // New Session: the scan reports the fresh pair empty, and stays that way.
    scan = { conversations: [FRESH, NEW, OLD], openSessionId: "conv-fresh" };
    useCbe.getState().hydrateConversation(openResult("conv-fresh"));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(within(list).getAllByRole("listitem")[0]!.textContent).toContain("No messages yet");
    const reads = (window.cbe.listConversations as ReturnType<typeof vi.fn>).mock.calls.length;

    // Turns land in the store through the real actions — no re-read follows.
    useCbe.getState().appendUserTurn("  \nWie baue ich den Kurs auf?\nZweite Zeile");
    useCbe.getState().appendAssistantTurn([{ kind: "text", text: "Gerne." } as never]);

    await waitFor(() => {
      const row = within(list).getAllByRole("listitem")[0]!;
      expect(row.textContent).toContain("Wie baue ich den Kurs auf?");
      expect(row.textContent).toContain("2 turns");
    });
    const row = within(list).getAllByRole("listitem")[0]!;
    expect(row.textContent).not.toContain("No messages yet");
    expect(row.textContent).not.toContain("Zweite Zeile");
    // Other rows keep the scan data.
    expect(within(list).getAllByRole("listitem")[1]!.textContent).toContain("6 turns");
    expect((window.cbe.listConversations as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads);
  });
});
