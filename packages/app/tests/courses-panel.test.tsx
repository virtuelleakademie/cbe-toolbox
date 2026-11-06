/**
 * Tests for the LEFT panel's course surface — the real course workspace
 * (capability
 * `course-workspace` + `desktop-app`, Requirement: Course Management in the UI).
 * Supersedes the Phase-1 mock tests (the mock requirement's own text: "Phase 3
 * wires the actual course-workspace capability"; REMOVED-delta in change
 * add-lecturer-wiki-and-course-workspace).
 *
 * Scenarios covered:
 *  - Course switch in the UI (desktop-app) / Switching course loads the
 *    course-specific state (course-workspace, renderer side)
 *  - Active course is identifiable at all times (header strip agreement)
 *  - The detail level carries no filesystem affordance (change
 *    `resume-course-conversations`, Requirement: Course Management in the UI —
 *    course-workspace's Local Location rule stays conditional and unexercised here)
 *  - App surface uses the term Course, not Project (course-workspace,
 *    Requirement: Course as a Local Folder)
 *  - Switching during a running turn keeps it running in the background
 *    (course-workspace, Requirement: Active Course and Course Switching —
 *    change add-background-course-sessions)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import { RightPanel } from "../src/renderer/components/RightPanel.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import type { CourseListResult, CourseSummary } from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

function listResult(activeCourseId: string, courses: CourseSummary[] = COURSES): CourseListResult {
  return { courses, activeCourseId };
}

// The card's main surface activates the course; the detail view opens via the
// explicit chevron affordance ("Course details") on the card.
function openDetails(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
}

beforeEach(() => {
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen", agentRunning: false });
  Object.assign(window.cbe, {
    listCourses: async () => listResult("algorithmen"),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({
    courses: [],
    activeCourseId: "",
    hydration: "idle",
    hydrationError: null,
  });
});

const benignConversation = async () => ({
  session: {
    sessionId: "conv-t",
    mode: "design" as const,
    environmentProfile: "app" as const,
    affordances: {},
    paths: { workspace: "/w", corpus: "/c" },
    courseId: "datenbanken",
  },
  turns: [],
  agentRunning: false,
  canvas: [],
});

describe("Course Management in the UI — list + active state", () => {
  it("lists the scanned courses and marks exactly one as active", async () => {
    const { container } = render(<CoursesPanel />);
    // 2 course cards + the create plus-card share the .proj card geometry.
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));
    expect(screen.getByText("Algorithmen")).toBeTruthy();
    expect(screen.getByText("Datenbanken")).toBeTruthy();
    const badges = container.querySelectorAll(".proj-badge");
    expect(badges.length).toBe(1);
    expect(badges[0]!.closest(".proj")!.textContent).toContain("Algorithmen");
  });

  // Scenario (course-workspace): Legacy sidecar pairs stay on disk and out of
  // the UI — the card meta shows NO per-course session count (a course IS one
  // conversation; counting sidecar files would surface unlisted legacy pairs).
  it("card shows content meta without a session count; the slug stays as tooltip", async () => {
    useCbe.setState({
      courses: [{ ...COURSES[0]!, sessionCount: 3, atomCount: 12 }],
      activeCourseId: "algorithmen",
    });
    Object.assign(window.cbe, {
      listCourses: async () => listResult("algorithmen", [{ ...COURSES[0]!, sessionCount: 3, atomCount: 12 }]),
    });
    render(<CoursesPanel />);
    const card = (await screen.findByRole("button", { name: /Algorithmen/ })) as HTMLElement;
    expect(card.textContent).toContain("12 wiki atoms");
    // No session count derived from sidecar files — even though the scan
    // reported sessionCount: 3 (legacy pairs), the card does not surface it.
    expect(card.textContent).not.toMatch(/session/i);
    // The raw folder slug is not part of the visible card text…
    expect(card.textContent).not.toContain("algorithmen");
    // …it remains available as secondary detail via the tooltip.
    expect(card.getAttribute("title")).toBe("algorithmen");
  });

  it("the active course name matches the header strip value at all times", () => {
    render(
      <>
        <AppHeader />
        <CoursesPanel />
      </>
    );
    expect(document.querySelector(".app-header-course")!.textContent).toBe("Algorithmen");
    const badge = document.querySelector(".proj-badge")!;
    expect(within(badge.closest(".proj") as HTMLElement).getByText("Algorithmen")).toBeTruthy();
  });

  it("one-click activation from the course list: clicking the card's main surface switches without opening the detail", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    Object.assign(window.cbe, { setActiveCourse, openConversation: benignConversation });
    const { container } = render(<CoursesPanel />);
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));

    // The main surface of the non-active card performs the switch directly.
    fireEvent.click(screen.getByRole("button", { name: /Datenbanken/ }));
    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("datenbanken"));

    // Still on the list — no detail view was opened along the way…
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    // …and the active marking follows: accented frame + badge move to the card.
    await waitFor(() => {
      const active = container.querySelector(".proj-active");
      expect(active?.textContent).toContain("Datenbanken");
      expect(active?.querySelector(".proj-badge")).toBeTruthy();
    });
    expect(container.querySelectorAll(".proj-active").length).toBe(1);

    // Clicking the already-active card is a no-op — no second IPC round-trip.
    fireEvent.click(screen.getByRole("button", { name: /Datenbanken/ }));
    expect(setActiveCourse).toHaveBeenCalledTimes(1);
  });

  // course-workspace spec, Scenario: Switching during a running turn keeps it
  // running in the background — no refusal notice, the swap happens, and the
  // outgoing session is not closed.
  it("switching during a running turn is NOT refused: card click swaps and leaves the run undisturbed", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    const closeSession = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { setActiveCourse, closeSession, openConversation: benignConversation });
    seedConversation({ session: testSession("sess-run", "algorithmen") });
    useCbe.setState({ courses: COURSES });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-run", data: {} });
    const { container } = render(<CoursesPanel />);
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: /Datenbanken/ }));

    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("datenbanken"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(closeSession).not.toHaveBeenCalled();
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("datenbanken"));
    // The outgoing course's run continues in its background slice.
    expect(useCbe.getState().conversations["sess-run"]!.live.streaming).toBe(true);
  });

  it("course details open via the explicit details affordance without changing the active course", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    Object.assign(window.cbe, { setActiveCourse, openConversation: benignConversation });
    const { container } = render(<CoursesPanel />);
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));

    openDetails("Datenbanken");
    expect(await screen.findByRole("button", { name: /Back/ })).toBeTruthy();
    expect(setActiveCourse).not.toHaveBeenCalled();
    expect(useCbe.getState().activeCourseId).toBe("algorithmen");
  });

  it("course switch in the UI: 'Set active' round-trips through IPC and moves the badge + header", async () => {
    const setActiveCourse = vi.fn(async (id: string) => listResult(id));
    Object.assign(window.cbe, { setActiveCourse, openConversation: benignConversation });
    render(
      <>
        <AppHeader />
        <CoursesPanel />
      </>
    );
    // Open the non-active course's detail and activate it there (the detail
    // view repeats the activation affordance).
    openDetails("Datenbanken");
    fireEvent.click(screen.getByRole("button", { name: /Set active/ }));
    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("datenbanken"));
    await waitFor(() => expect(document.querySelector(".app-header-course")!.textContent).toBe("Datenbanken"));
    // Back on the list, the badge follows the new active course.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    const badge = document.querySelector(".proj-badge")!;
    expect(badge.closest(".proj")!.textContent).toContain("Datenbanken");
  });

  it("creating a course via the plus-card calls the IPC pair (create + set-active) and activates the new course", async () => {
    const created: CourseSummary = { id: "neuer-kurs", title: "Neuer Kurs", path: "/space/courses/neuer-kurs" };
    const createCourse = vi.fn(async () => created);
    const setActiveCourse = vi.fn(async (id: string) => listResult(id, [...COURSES, created]));
    Object.assign(window.cbe, { createCourse, setActiveCourse, openConversation: benignConversation });
    render(<CoursesPanel />);
    // The dashed plus-card reveals the inline title field on click.
    fireEvent.click(screen.getByRole("button", { name: /New course/ }));
    fireEvent.change(screen.getByLabelText("New course title"), { target: { value: "Neuer Kurs" } });
    fireEvent.click(screen.getByRole("button", { name: /Create course/ }));
    await waitFor(() => expect(createCourse).toHaveBeenCalledWith("Neuer Kurs"));
    await waitFor(() => expect(setActiveCourse).toHaveBeenCalledWith("neuer-kurs"));
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("neuer-kurs"));
  });

  it("renaming a course round-trips through IPC and refreshes the list", async () => {
    const renameCourse = vi.fn(async (id: string, title: string) => ({
      id,
      title,
      path: `/space/courses/${id}`,
    }));
    const listCourses = vi.fn(async () =>
      listResult("algorithmen", [
        { id: "algorithmen", title: "Algorithmen II", path: "/space/courses/algorithmen" },
        COURSES[1]!,
      ])
    );
    Object.assign(window.cbe, { renameCourse, listCourses });
    render(<CoursesPanel />);
    openDetails("Algorithmen");
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    fireEvent.change(screen.getByLabelText("Course title"), { target: { value: "Algorithmen II" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(renameCourse).toHaveBeenCalledWith("algorithmen", "Algorithmen II"));
    await waitFor(() => expect(useCbe.getState().courses[0]!.title).toBe("Algorithmen II"));
  });
});

// Scenario: Course management lives in the left panel and is labelled Courses
describe("Course management lives in the left panel and is labelled Courses", () => {
  it("is the left panel's surface, labelled Courses, with no course-management tab in the right panel", async () => {
    const { container } = render(<LeftPanel />);
    // The collapsed rail names the surface it opens…
    expect(screen.getByRole("button", { name: "Open Courses" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Courses" }));
    // …and the expanded panel is the course surface, headed Courses.
    expect(container.querySelector(".courses-panel")).not.toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("Courses");
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBeGreaterThan(0));
    expect(container.textContent).not.toMatch(/project/i);

    // The right panel offers no course-management tab.
    cleanup();
    render(<RightPanel />);
    expect(screen.queryByRole("tab", { name: /^Courses$/ })).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["CBE Process Canvas", "CBE Maturity"]);
  });
});

// Scenario: The course list does not expand a course in place
describe("The course list does not expand a course in place", () => {
  it("a card offers activation and a details affordance — and no disclosure control", async () => {
    const { container } = render(<CoursesPanel />);
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));
    const card = screen.getByText("Datenbanken").closest(".proj") as HTMLElement;

    // Exactly two controls: the main surface (activation) and the details
    // affordance. Going INTO a course is the drill-down to its detail level,
    // never a triangle that promises contents the list cannot fill.
    const buttons = [...card.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.className).toContain("proj-open");
    expect(buttons[1]!.getAttribute("aria-label")).toBe("Course details");
    expect(card.querySelector("details, summary, [aria-expanded]")).toBeNull();

    // And the card does not grow a session / material / wiki tree when clicked.
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(card.querySelector("details, summary, [aria-expanded]")).toBeNull());
  });
});

describe("Course as a Local Folder — surface terminology", () => {
  it("app surface uses the term Course, not Project", async () => {
    const revealCourse = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { revealCourse });
    const { container } = render(<CoursesPanel />);
    await waitFor(() => expect(container.querySelectorAll(".proj").length).toBe(3));
    // List view carries no "Project" wording…
    expect(container.textContent).not.toMatch(/project/i);
    // …and neither does the detail view (kicker, actions, sessions, wiki).
    openDetails("Datenbanken");
    expect(container.textContent).not.toMatch(/project/i);
  });
});

describe("The detail level carries no filesystem affordance", () => {
  // Scenario (change `resume-course-conversations`, Requirement: Course
  // Management in the UI): no reveal control for the course folder or the wiki
  // folder, and no raw path anywhere on the detail surface. Stored
  // conversations are reached through the Chats tab instead.
  it("offers no reveal control and renders no raw path in the detail view", async () => {
    const revealCourse = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { revealCourse });
    const { container } = render(<CoursesPanel />);
    openDetails("Datenbanken");

    expect(screen.queryByRole("button", { name: /Reveal in folder/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open wiki folder/ })).toBeNull();
    // The raw path appears nowhere — not as text, not as a tooltip.
    expect(screen.queryByText("/space/courses/datenbanken")).toBeNull();
    expect(container.querySelector('[title="/space/courses/datenbanken"]')).toBeNull();
    expect(revealCourse).not.toHaveBeenCalled();
  });
});
