/**
 * Course switching from the LEFT panel (capability `desktop-app`, Requirement:
 * Course Management in the UI; capability `course-workspace`, Requirement: Active
 * Course and Course Switching).
 *
 * These assertions used to run through the header's switcher dropdown
 * (`header-course-switcher.test.tsx`, removed with the dropdown). The dropdown is
 * gone — a second course list that could drift from the panel's — so the same
 * mechanics are exercised where switching actually happens now: a one-click
 * activation on a card in the left panel's list level.
 *
 * Scenarios covered:
 *  - One-click activation from the course list
 *  - Course switch in the UI
 *  - Switching during a running turn keeps it running in the background
 *  - Switch re-enters the target course's canonical conversation
 *  - Switch to a course without a conversation starts a fresh one in the chat
 *  - A new course is created from the left panel
 *  - A switch is refused only while hydration is still resolving
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import type {
  ConversationOpenResult,
  CourseListResult,
  CourseSummary,
  StartSessionResult,
} from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

function listResult(activeCourseId: string, courses: CourseSummary[] = COURSES): CourseListResult {
  return { courses, activeCourseId };
}

function runningSession(sessionId: string): StartSessionResult {
  return {
    sessionId,
    environmentProfile: "app",
    affordances: {},
    paths: { workspace: "/w", corpus: "/c" },
    courseId: "algorithmen",
  };
}

function conversation(overrides?: Partial<ConversationOpenResult>): ConversationOpenResult {
  return {
    session: { ...runningSession("conv-1"), courseId: "datenbanken" },
    turns: [{ role: "user", text: "Weiter" }],
    agentRunning: false,
    canvas: [],
    ...overrides,
  };
}

/** The card's MAIN SURFACE is the activation control — one click on the list
 * level performs the whole workspace swap, with no detail level in between. */
function activate(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(card.querySelector(".proj-open") as HTMLElement);
}

beforeEach(() => {
  useCbe.setState({
    courses: COURSES,
    activeCourseId: "algorithmen",
    session: null,
    turns: [],
    agentRunning: false,
    error: null,
  });
  Object.assign(window.cbe, { listCourses: async () => listResult("algorithmen") });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
});

describe("Scenario: One-click activation from the course list", () => {
  it("a click on the card's main surface swaps the workspace and marks the course active", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    const openConversation = vi.fn(async () => conversation());
    Object.assign(window.cbe, { setActiveCourse, openConversation });

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("datenbanken"));
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("datenbanken"));
    // The active card carries the accented frame plus the badge.
    const card = screen.getByText("Datenbanken").closest(".proj") as HTMLElement;
    await waitFor(() => expect(card.className).toContain("proj-active"));
    expect(card.textContent).toContain("active");
  });
});

describe("Scenario: Switching during a running turn keeps it running in the background", () => {
  it("performs the swap without closing the outgoing session; the outgoing slice keeps streaming", async () => {
    const closeSession = vi.fn(async () => ({ ok: true as const }));
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    const openConversation = vi.fn(async () => conversation());
    Object.assign(window.cbe, { closeSession, setActiveCourse, openConversation });

    seedConversation({ session: testSession("sess-run", "algorithmen") });
    useCbe.setState({ courses: COURSES });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-run", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-run", data: { delta: "streaming…" } });
    expect(useCbe.getState().agentRunning).toBe(true);

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-1"));
    expect(useCbe.getState().error).toBeNull();
    expect(closeSession).not.toHaveBeenCalled();

    emitAgentEvent({ type: "text_delta", sessionId: "sess-run", data: { delta: " more" } });
    const background = useCbe.getState().conversations["sess-run"]!;
    expect(background.live.streaming).toBe(true);
    expect(background.live.items).toHaveLength(1);
    expect(useCbe.getState().live.items).toHaveLength(0);
    expect(useCbe.getState().agentRunning).toBe(false);
  });
});

describe("Scenario: Switch re-enters the target course's canonical conversation", () => {
  it("hydrates the conversation the main process resolved (re-attach / resume / fresh is main's decision)", async () => {
    const openConversation = vi.fn(async () =>
      conversation({ session: { ...runningSession("conv-canonical"), courseId: "datenbanken" } })
    );
    Object.assign(window.cbe, { setActiveCourse: async (id: string) => listResult(id), openConversation });

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(openConversation).toHaveBeenCalled());
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-canonical"));
    expect(useCbe.getState().turns.length).toBe(1);
    expect(useCbe.getState().hydration).toBe("ready");
  });
});

describe("Scenario: Switch to a course without a conversation starts a fresh one in the chat", () => {
  it("hydrates the fresh conversation main reports — no selection screen of any kind", async () => {
    const openConversation = vi.fn(async () =>
      conversation({ session: { ...runningSession("fresh-1"), courseId: "datenbanken" }, turns: [] })
    );
    Object.assign(window.cbe, { setActiveCourse: async (id: string) => listResult(id), openConversation });

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("datenbanken"));
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("fresh-1"));
    expect(useCbe.getState().turns).toEqual([]);
    expect(useCbe.getState().hydration).toBe("ready");
  });

  it("an unreadable canonical archive surfaces the notice main sent — never a silent older resume", async () => {
    const openConversation = vi.fn(async () =>
      conversation({
        session: { ...runningSession("fresh-2"), courseId: "datenbanken" },
        turns: [],
        notice: "The previous conversation's archive could not be read — starting a fresh conversation.",
      })
    );
    Object.assign(window.cbe, { setActiveCourse: async (id: string) => listResult(id), openConversation });

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("fresh-2"));
    expect(useCbe.getState().notice).toMatch(/could not be read/);
  });
});

describe("Scenario: A new course is created from the left panel", () => {
  it("the plus card creates the course and it becomes the active one", async () => {
    const created: CourseSummary = { id: "neuer-kurs", title: "Neuer Kurs", path: "/space/courses/neuer-kurs" };
    const createCourse = vi.fn(async () => created);
    const setActiveCourse = vi.fn(async (id: string) => listResult(id, [...COURSES, created]));
    const openConversation = vi.fn(async () =>
      conversation({ session: { ...runningSession("fresh-new"), courseId: "neuer-kurs" }, turns: [] })
    );
    Object.assign(window.cbe, { createCourse, setActiveCourse, openConversation });

    render(<CoursesPanel />);
    fireEvent.click(screen.getByRole("button", { name: /New course/ }));
    fireEvent.change(screen.getByLabelText("New course title"), { target: { value: "Neuer Kurs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create course" }));

    await waitFor(() => expect(createCourse).toHaveBeenCalledWith("Neuer Kurs"));
    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("neuer-kurs"));
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("neuer-kurs"));
  });
});

describe("Scenario: A switch is refused only while hydration is still resolving", () => {
  it("activating a card during pending hydration surfaces the notice and performs no swap", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    Object.assign(window.cbe, { setActiveCourse });
    useCbe.setState({ hydration: "pending", session: runningSession("sess-run") });

    render(<CoursesPanel />);
    activate("Datenbanken");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(en.coursesHydrationInFlightSwitchNotice));
    expect(setActiveCourse).not.toHaveBeenCalled();
    expect(useCbe.getState().activeCourseId).toBe("algorithmen");
  });

  it("creating a course mid-turn is NOT refused (creation implies a switch, switching is allowed)", async () => {
    const created: CourseSummary = { id: "x", title: "X", path: "/space/courses/x" };
    const createCourse = vi.fn(async () => created);
    const setActiveCourse = vi.fn(async (id: string) => listResult(id, [...COURSES, created]));
    const openConversation = vi.fn(async () =>
      conversation({ session: { ...runningSession("fresh-x"), courseId: "x" }, turns: [] })
    );
    Object.assign(window.cbe, { createCourse, setActiveCourse, openConversation });
    seedConversation({ session: testSession("sess-run", "algorithmen") });
    useCbe.setState({ courses: COURSES });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-run", data: {} });

    render(<CoursesPanel />);
    fireEvent.click(screen.getByRole("button", { name: /New course/ }));
    fireEvent.change(screen.getByLabelText("New course title"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create course" }));

    await waitFor(() => expect(createCourse).toHaveBeenCalledWith("X"));
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("x"));
    expect(useCbe.getState().error).toBeNull();
    expect(useCbe.getState().conversations["sess-run"]!.live.streaming).toBe(true);
  });
});
