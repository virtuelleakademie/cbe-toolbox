/**
 * Renderer tests for the course delete control (capability `desktop-app`,
 * Requirement: Course Management in the UI — the deletion clauses; capability
 * `course-workspace`, Requirement: Course Deletion from the Detail View,
 * Reversible via the OS Trash — the surface halves).
 *
 * Scenarios covered:
 *  - The course list carries no delete affordance
 *  - The delete control arms a confirmation instead of deleting
 *  - The deletion outcome is announced through a live region that SURVIVES the
 *    detail → list transition (a remounted region would stay silent)
 *  - The deleted course's conversation state does not survive it
 *  - Deleting the active course swaps into the new active course; deleting a
 *    non-active course leaves the workspace untouched
 *  - A refused or failed deletion is readable on the surface, and a repeated
 *    identical outcome is announced again rather than silently re-rendered
 *  - A failing follow-up hydration still leaves the deleted course's detail view
 *
 * The main-process guards live in course-delete.test.ts, the store-level
 * behaviour in courses.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import type { CourseDeleteResult, CourseSummary } from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

function deleteResult(overrides: Partial<CourseDeleteResult> = {}): CourseDeleteResult {
  return {
    courses: [COURSES[1]!],
    activeCourseId: "datenbanken",
    trashed: true,
    ...overrides,
  };
}

function openDetails(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
}

/** Arm the confirmation and return the confirm/cancel controls. */
function armDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Delete course" }));
  const group = screen.getByRole("group", { name: "Confirm course deletion" });
  return {
    group,
    confirm: within(group).getByRole("button", { name: "Move to trash" }),
    cancel: within(group).getByRole("button", { name: "Cancel" }),
  };
}

const benignConversation = async () => ({
  session: {
    sessionId: "conv-after-delete",
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

beforeEach(() => {
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen", agentRunning: false });
  Object.assign(window.cbe, {
    listCourses: async () => ({ courses: COURSES, activeCourseId: "algorithmen" }),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
});

describe("Deletion lives in the detail view only", () => {
  it("offers no delete affordance on a course card in the list", async () => {
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");

    // Nothing on the list level deletes — neither a labelled control nor a
    // stray one hiding on a card. The path runs through the detail view.
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /trash/i })).toBeNull();
    for (const title of ["Algorithmen", "Datenbanken"]) {
      const card = screen.getByText(title).closest(".proj") as HTMLElement;
      const labels = within(card)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
      expect(labels.some((l) => /delete|remove|trash/i.test(l))).toBe(false);
    }
  });

  it("shows the delete control once the detail view is open", async () => {
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    expect(screen.getByRole("button", { name: "Delete course" })).toBeTruthy();
  });
});

describe("A single click never deletes a course", () => {
  it("arms a confirmation instead of deleting on a single click", async () => {
    const deleteCourse = vi.fn();
    Object.assign(window.cbe, { deleteCourse });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    // The trigger is an icon button in the title row, beside the rename control
    // (change `resume-course-conversations`, Requirement: Course Management in
    // the UI) — moving it there changed nothing about the two-step confirmation.
    const trigger = screen.getByRole("button", { name: "Delete course" });
    expect(trigger.closest(".pp-title-row")).not.toBeNull();

    const { group, cancel } = armDelete();

    // Nothing left the renderer on the arming click.
    expect(deleteCourse).not.toHaveBeenCalled();
    // The confirmation names what travels with the folder — the four nouns are
    // jointly governed by `course-workspace`, Requirement: Course Deletion from
    // the Detail View and `desktop-app`, Requirement: Course Management in the
    // UI — and says what actually happens: "trash", not "delete for ever". The
    // module design is named by the surface it lives on, never by the retired
    // "Artefacts" category label.
    const text = group.textContent ?? "";
    expect(text).toContain("Algorithmen");
    expect(text).toMatch(/conversations/i);
    expect(text).toMatch(/module design on the CBE Process Canvas/i);
    expect(text).toMatch(/wiki/i);
    expect(text).toMatch(/materials/i);
    expect(text).toMatch(/system trash/i);
    expect(text).not.toMatch(/Artefakte|Artefacts|Artifacts/);
    // Cancel is the default answer: it holds focus, so a stray Enter cancels.
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it("cancelling leaves the course alone", async () => {
    const deleteCourse = vi.fn();
    Object.assign(window.cbe, { deleteCourse });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    const { cancel } = armDelete();
    fireEvent.click(cancel);

    expect(deleteCourse).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm course deletion" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete course" })).toBeTruthy();
  });

  it("Escape dismisses the confirmation without deleting", async () => {
    const deleteCourse = vi.fn();
    Object.assign(window.cbe, { deleteCourse });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    const { group } = armDelete();
    fireEvent.keyDown(group, { key: "Escape" });

    expect(deleteCourse).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm course deletion" })).toBeNull();
  });
});

describe("After a confirmed deletion", () => {
  it("returns to the course list and announces the outcome", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => deleteResult()),
      openConversation: benignConversation,
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    // The live region must be the SAME node before and after the transition. A
    // remounted region carries its text already when it is inserted, and a live
    // region inserted with content is generally not announced — which would
    // silence exactly the successful deletion this announcement exists for.
    const before = document.querySelector('[aria-live="polite"]');
    expect(before).toBeTruthy();

    fireEvent.click(armDelete().confirm);

    // Back on the list — never a detail view for a course that is gone.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete course" })).toBeNull());
    expect(screen.getByText("Datenbanken")).toBeTruthy();
    expect(screen.queryByText("Algorithmen")).toBeNull();

    // The outcome reaches assistive technology through the live region.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBe(before);
    expect(live?.textContent).toMatch(/Algorithmen/);
    expect(live?.textContent).toMatch(/moved to your system trash/i);
  });

  it("announces an already-gone course honestly rather than claiming a trash move", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => deleteResult({ trashed: false })),
      openConversation: benignConversation,
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete course" })).toBeNull());
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/no longer on disk/i);
    expect(live?.textContent).not.toMatch(/moved to your system trash/i);
  });

  it("swaps into the new active course when the deleted course was active", async () => {
    const openConversation = vi.fn(benignConversation);
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => deleteResult()),
      openConversation,
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    // The active course changed (main re-resolved it), so the renderer enters
    // the new active course's canonical conversation — the same swap a switch
    // performs.
    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("datenbanken"));
    expect(openConversation).toHaveBeenCalledTimes(1);
    expect(useCbe.getState().hydration).toBe("ready");
  });

  it("drops the deleted course's conversation state so a same-titled course cannot inherit it", async () => {
    // The deleted course's slice, as a hydration would have left it.
    useCbe.getState().hydrateConversation({
      session: {
        sessionId: "conv-algorithmen",
        environmentProfile: "app" as const,
        affordances: {},
        paths: { workspace: "/w", corpus: "/c" },
        courseId: "algorithmen",
      },
      turns: [{ role: "user" as const, text: "Meine Challenge fuer Algorithmen" }],
      agentRunning: false,
      canvas: [],
      maturity: {},
    });
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => deleteResult()),
      openConversation: benignConversation,
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    await waitFor(() => expect(screen.queryByText("Algorithmen")).toBeNull());
    // A course id is derived from the title, so a course later created under the
    // same title would otherwise be projected with these turns.
    expect(useCbe.getState().conversations["conv-algorithmen"]).toBeUndefined();
    expect(Object.values(useCbe.getState().conversations).some((c) => c.session.courseId === "algorithmen")).toBe(
      false
    );
    // The surviving course's own slice is untouched — the drop is scoped to
    // courses that left the scanned list.
    expect(Object.values(useCbe.getState().conversations).every((c) => c.session.courseId === "datenbanken")).toBe(
      true
    );
  });

  it("leaves the workspace untouched when the deleted course was not active", async () => {
    const openConversation = vi.fn(benignConversation);
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () =>
        deleteResult({ courses: [COURSES[0]!], activeCourseId: "algorithmen", trashed: true })
      ),
      openConversation,
    });
    render(<CoursesPanel />);
    await screen.findByText("Datenbanken");
    openDetails("Datenbanken");
    fireEvent.click(armDelete().confirm);

    await waitFor(() => expect(screen.queryByText("Datenbanken")).toBeNull());
    // No hydration at all — the visible conversation never moved.
    expect(openConversation).not.toHaveBeenCalled();
    expect(useCbe.getState().activeCourseId).toBe("algorithmen");
  });
});

describe("A refused or failed deletion is readable on the surface", () => {
  it("shows a readable message and keeps the course when the deletion is refused", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => {
        throw new Error("The agent is still working in this course — wait for the turn to finish.");
      }),
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    // The reason is visible on the detail surface …
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/still working in this course/i);
    // … and announced.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(/still working in this course/i);
    // The course survives, the surface stays usable, and the confirmation is
    // disarmed rather than left hanging.
    expect(screen.getByRole("button", { name: "Delete course" })).toBeTruthy();
    expect(useCbe.getState().courses.map((c) => c.id)).toContain("algorithmen");
  });

  it("announces a repeated identical outcome again instead of falling silent", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => {
        throw new Error("The agent is still working in this course — wait for the turn to finish.");
      }),
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");

    const spoken = () =>
      Array.from(document.querySelectorAll('[aria-live="polite"]')).filter((r) => (r.textContent ?? "") !== "");

    fireEvent.click(armDelete().confirm);
    await screen.findByRole("alert");
    await waitFor(() => expect(spoken()).toHaveLength(1));
    const first = spoken()[0]!;

    // The lecturer waits, re-arms, and confirms again while the same turn is
    // still running — verbatim the same message. (Same shape as two same-titled
    // courses deleted in a row: titles are not unique, only ids are, so the text
    // alone can never distinguish the two announcements.)
    fireEvent.click(armDelete().confirm);

    // Re-rendering identical text into the same node mutates nothing and is
    // never announced. The outcome must land in the OTHER region, so it is a
    // real "" → text change assistive technology can hear.
    await waitFor(() => {
      const now = spoken();
      expect(now).toHaveLength(1);
      expect(now[0]).not.toBe(first);
    });
    expect(spoken()[0]?.textContent).toMatch(/still working in this course/i);
    expect(first.textContent).toBe("");
  });

  it("leaves the deleted course's detail view even when the follow-up hydration fails", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => deleteResult()),
      openConversation: vi.fn(async () => {
        throw new Error("LLM provider not configured");
      }),
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    // The deletion happened on disk, so the panel leaves the detail view even
    // though entering the new active course's conversation failed …
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete course" })).toBeNull());
    // … and the hydration failure is still readable on the list it returned to.
    expect((await screen.findByRole("alert")).textContent).toMatch(/provider not configured/i);

    // A course created later under the SAME title carries the same id (ids are
    // title slugs) — it must not open straight into the deleted course's detail
    // view because a stale open id survived the failure.
    await act(async () => {
      useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "datenbanken" });
    });
    expect(screen.queryByRole("button", { name: "Delete course" })).toBeNull();
    expect(screen.getByText("Algorithmen")).toBeTruthy();
  });

  it("shows a readable message and keeps the course when the trash operation fails", async () => {
    Object.assign(window.cbe, {
      deleteCourse: vi.fn(async () => {
        throw new Error("Operation not permitted");
      }),
    });
    render(<CoursesPanel />);
    await screen.findByText("Algorithmen");
    openDetails("Algorithmen");
    fireEvent.click(armDelete().confirm);

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toMatch(/not permitted/i);
    expect(screen.getByRole("button", { name: "Delete course" })).toBeTruthy();
    expect(useCbe.getState().courses.map((c) => c.id)).toContain("algorithmen");
  });
});
