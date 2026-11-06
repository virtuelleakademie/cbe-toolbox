/**
 * Course detail Chats | Wiki tabs (change `resume-course-conversations`;
 * capability `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki).
 * One test per Scenario:
 *
 * - "Chats tab lists stored conversations newest-first with the open one marked"
 * - "Selecting a stored conversation dispatches the resume through the open pipeline"
 * - "Selecting a conversation of a non-active course switches the course first"
 * - "Conversation rows are disabled while a turn is in flight"
 * - "A non-resumable pair is listed with the reason, resume disabled"
 * - "The Wiki tab renders the wiki browser"
 *
 * The main-process half (list contents, resume semantics, guards) lives in
 * tests/conversation-resume.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { newConversation } from "../src/renderer/state/conversationReducer.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import { testSession } from "./helpers/conversation.js";
import type {
  ConversationListResult,
  ConversationOpenResult,
  CourseListResult,
  CourseSummary,
} from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

const LIST: ConversationListResult = {
  conversations: [
    {
      sessionId: "conv-new",
      createdAt: "2026-08-10T09:00:00.000Z",
      closedAt: "2026-08-18T09:00:00.000Z",
      resumable: true,
      turnCount: 6,
      snippet: "Wie baue ich Schritt 3 auf?",
    },
    {
      sessionId: "conv-old",
      createdAt: "2026-07-01T09:00:00.000Z",
      closedAt: "2026-07-02T09:00:00.000Z",
      resumable: true,
      turnCount: 12,
      snippet: "Erster Entwurf des Moduls",
    },
  ],
  openSessionId: "conv-new",
};

function openResult(sessionId: string, courseId: string): ConversationOpenResult {
  return {
    session: testSession(sessionId, courseId),
    turns: [{ role: "user", text: "resumed" }],
    agentRunning: false,
    canvas: [],
  } as unknown as ConversationOpenResult;
}

function openDetails(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
}

function listResult(activeCourseId: string): CourseListResult {
  return { courses: COURSES, activeCourseId };
}

beforeEach(() => {
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen", hydration: "ready" });
  Object.assign(window.cbe, {
    listCourses: async () => listResult("algorithmen"),
    listConversations: vi.fn(async () => LIST),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
});

describe("Scenario: Chats tab lists stored conversations newest-first with the open one marked", () => {
  it("defaults to the Chats tab and renders date, snippet, turn count; the open row is marked", async () => {
    render(<CoursesPanel />);
    openDetails("Algorithmen");

    // The tab bar exists, Chats is the default selection.
    const tablist = screen.getByRole("tablist", { name: "Course content" });
    const chatsTab = within(tablist).getByRole("tab", { name: "Chats" });
    expect(chatsTab.getAttribute("aria-selected")).toBe("true");

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    const rows = within(list).getAllByRole("listitem");
    // Main-side order preserved: newest first.
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Wie baue ich Schritt 3 auf?"),
      expect.stringContaining("Erster Entwurf des Moduls"),
    ]);
    // Human row content: turn count present.
    expect(rows[0]!.textContent).toContain("6 turns");
    expect(rows[1]!.textContent).toContain("12 turns");
    // Each list item WRAPS an actionable button — both roles are kept for
    // assistive technology (a role="listitem" on the button itself would
    // override the button role and announce a static item).
    const buttons = rows.map((r) => within(r).getByRole("button"));
    // The open conversation is marked — driven by openSessionId, not guessed.
    expect(buttons[0]!.getAttribute("aria-current")).toBe("true");
    expect(within(buttons[0]!).getByText("open")).toBeTruthy();
    expect(buttons[1]!.getAttribute("aria-current")).toBeNull();
  });
});

describe("Scenario: Selecting a stored conversation dispatches the resume through the open pipeline", () => {
  it("calls resumeConversation with the chosen id and hydrates the returned snapshot", async () => {
    const resumeConversation = vi.fn(async () => openResult("conv-old", "algorithmen"));
    Object.assign(window.cbe, { resumeConversation });
    render(<CoursesPanel />);
    openDetails("Algorithmen");

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    fireEvent.click(within(within(list).getAllByRole("listitem")[1]!).getByRole("button"));

    await waitFor(() => expect(resumeConversation).toHaveBeenCalledWith("algorithmen", "conv-old"));
    // The snapshot went through the same hydration path a conversation open uses.
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-old"));
    expect(useCbe.getState().turns).toEqual([{ role: "user", text: "resumed" }]);
  });

  it("selecting the open conversation of the active course dispatches nothing", async () => {
    const resumeConversation = vi.fn();
    Object.assign(window.cbe, { resumeConversation });
    render(<CoursesPanel />);
    openDetails("Algorithmen");

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    // The marked open row's button.
    fireEvent.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button"));
    expect(resumeConversation).not.toHaveBeenCalled();
  });
});

describe("Scenario: Selecting a conversation of a non-active course switches the course first", () => {
  it("activates the course, then resumes, leaving it active with the chosen conversation open", async () => {
    const calls: string[] = [];
    const setActiveCourse = vi.fn(async (id: string) => {
      calls.push(`activate:${id}`);
      return listResult(id);
    });
    const resumeConversation = vi.fn(async (courseId: string, sessionId: string) => {
      calls.push(`resume:${sessionId}`);
      return openResult(sessionId, courseId);
    });
    Object.assign(window.cbe, { setActiveCourse, resumeConversation });
    render(<CoursesPanel />);
    openDetails("Datenbanken"); // NOT the active course

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    fireEvent.click(within(within(list).getAllByRole("listitem")[1]!).getByRole("button"));
    // Pending goes up BEFORE the first await (like the swap tail), so a second
    // click during the activation round-trip hits the switch guard instead of
    // starting a second resolution.
    expect(useCbe.getState().hydration).toBe("pending");

    await waitFor(() => expect(resumeConversation).toHaveBeenCalledWith("datenbanken", "conv-old"));
    // The regular course switch ran FIRST, then the resume.
    expect(calls).toEqual(["activate:datenbanken", "resume:conv-old"]);
    expect(useCbe.getState().activeCourseId).toBe("datenbanken");
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-old"));
  });
});

describe("Scenario: Conversation rows are disabled while a turn is in flight", () => {
  it("disables the rows with a readable reason and dispatches nothing on click", async () => {
    // A running conversation slice for the course (live.streaming = true).
    const session = testSession("conv-new", "algorithmen");
    const slice = newConversation(session);
    useCbe.setState({
      conversations: { [session.sessionId]: { ...slice, live: { ...slice.live, streaming: true } } },
    });
    const resumeConversation = vi.fn();
    Object.assign(window.cbe, { resumeConversation });
    render(<CoursesPanel />);
    openDetails("Algorithmen");

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    const buttons = within(list)
      .getAllByRole("listitem")
      .map((r) => within(r).getByRole("button") as HTMLButtonElement);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBe(en.coursesChatsLockedReason);
    }
    fireEvent.click(buttons[1]!);
    expect(resumeConversation).not.toHaveBeenCalled();
  });
});

describe("Scenario: A non-resumable pair is listed with the reason, resume disabled", () => {
  it("renders the row disabled with the main-process-supplied reason and dispatches nothing", async () => {
    const reason = "JSON sidecar missing or unreadable — open the .md file in an editor to review";
    Object.assign(window.cbe, {
      listConversations: vi.fn(async () => ({
        conversations: [
          {
            sessionId: "torn-pair",
            createdAt: "2026-07-01T09:00:00.000Z",
            closedAt: "2026-07-01T10:00:00.000Z",
            resumable: false,
            reason,
          },
        ],
      })),
      resumeConversation: vi.fn(),
    });
    render(<CoursesPanel />);
    openDetails("Algorithmen");

    const list = await screen.findByRole("list", { name: "Stored conversations" });
    const row = within(list).getByRole("listitem");
    const button = within(row).getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(reason);
    expect(row.textContent).toContain(reason);
    fireEvent.click(button);
    expect(window.cbe.resumeConversation).not.toHaveBeenCalled();
  });
});

describe("Scenario: The Wiki tab renders the wiki browser", () => {
  it("switches to the wiki browser and back to the conversation list", async () => {
    const { container } = render(<CoursesPanel />);
    openDetails("Algorithmen");
    await screen.findByRole("list", { name: "Stored conversations" });
    expect(container.querySelector(".wiki-browser")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Wiki" }));
    // The same browser surface as before — search box and all — now under the tab.
    await waitFor(() => expect(container.querySelector(".wiki-browser")).not.toBeNull());
    expect(screen.getByLabelText("Search wiki atoms")).toBeTruthy();
    // The former sub-heading is gone; the tab label carries the surface name.
    expect(container.textContent).not.toContain("Lecturer's Wiki");
    expect(screen.queryByRole("list", { name: "Stored conversations" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Chats" }));
    await screen.findByRole("list", { name: "Stored conversations" });
    expect(container.querySelector(".wiki-browser")).toBeNull();
  });
});

describe("Scenario: The tab choice survives a collapse cycle", () => {
  it("re-expands on the Wiki tab, while another course's detail starts on Chats", async () => {
    useCbe.setState({ leftPanelCollapsed: false });
    const { container } = render(<LeftPanel />);
    openDetails("Algorithmen");
    fireEvent.click(screen.getByRole("tab", { name: "Wiki" }));
    await waitFor(() => expect(container.querySelector(".wiki-browser")).not.toBeNull());

    // Collapse unmounts the body; re-expanding restores the SAME tab (the parity
    // of the right panel's tab-selection preservation — and what keeps the
    // lecturer-wiki run rows visible again after the cycle).
    fireEvent.click(screen.getByRole("button", { name: "Collapse left panel" }));
    expect(container.querySelector(".wiki-browser")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand left panel" }));
    expect(screen.getByRole("tab", { name: "Wiki" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(container.querySelector(".wiki-browser")).not.toBeNull());

    // A DIFFERENT course's detail starts on the Chats default.
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    openDetails("Datenbanken");
    expect(screen.getByRole("tab", { name: "Chats" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByRole("list", { name: "Stored conversations" });
  });
});
