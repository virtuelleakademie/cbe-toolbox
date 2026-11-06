/**
 * Course-scoped isolation of the canvas panel's design state (change
 * `isolate-decision-artefacts-per-course`).
 *
 * - desktop-app spec, Requirement: Decision Artefacts Are Per-Conversation State —
 *   Scenarios: Switching to a course without decision state clears the panel;
 *   Cold start shows the empty state, not demo content; A background course's
 *   decision state stays with its course.
 * - course-workspace spec, Requirement: Course-Scoped Isolation of Canvas, Step,
 *   Maturity and Decision State — Scenarios: No design state crosses a course
 *   switch; Returning to a course restores exactly its own state; A background
 *   course's design state is not presented for the active course.
 *
 * The persistence half of the guarantee (restart round-trip, sidecar validation,
 * re-attach, New Session carry-over, "a course folder carries the state it
 * presents") is covered main-side in `conversation-open.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import { SAMPLE_DIDACTIC_CHECKS } from "./fixtures/decisions.js";
import { emptyDidacticChecks, type DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import type { ConversationOpenResult, CourseSummary } from "../src/shared/ipc-contract.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";

const COURSES: CourseSummary[] = [
  { id: "course-a", title: "Kurs A", path: "/space/courses/course-a" },
  { id: "course-b", title: "Kurs B", path: "/space/courses/course-b" },
];

/** Course A's decision state — distinctive enough to spot if it leaks. */
const A_CHECKS: DidacticChecks = {
  kompetenz: {
    status: "completed",
    goals: [{ id: "a-goal", text: "Course A operative goal", sharpness: "sharp" }],
  },
  alignment: { status: "completed", findings: [{ goalId: "a-goal", status: "aligned" }] },
  delegation: { status: "not-started", decisions: [] },
};

const A_MATURITY: MaturitySnapshot = {
  challenge: { current: "good-practice", target: "full-fledged" },
} as MaturitySnapshot;

function openDecisions() {
  fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));
}

function decisionsText(container: HTMLElement): string {
  return (container.querySelector(".decisions-body") as HTMLElement | null)?.textContent ?? "";
}

/** A main-process `conversationOpen` payload for a course with no stored state. */
function emptyOpenResult(sessionId: string, courseId: string): ConversationOpenResult {
  return {
    session: testSession(sessionId, courseId),
    turns: [],
    agentRunning: false,
    canvas: [],
    maturity: {},
  } as ConversationOpenResult;
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ courses: COURSES, hydration: "ready" });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle" });
});

// Scenario: Cold start shows the empty state, not demo content
describe("Cold start shows the empty state, not demo content", () => {
  it("renders no fixture entries before any conversation is hydrated", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();

    expect(useCbe.getState().didacticChecks).toEqual(emptyDidacticChecks());
    const body = decisionsText(container);
    // The retired dev mock described an unrelated `water-systems` course.
    expect(body).not.toContain("water flows");
    expect(body).not.toContain("Essential Question formulation");
    expect(container.querySelector('[data-entry="heterogeneity-notes"]')).toBeNull();
    expect(container.querySelector('[data-entry="soft-skill-anchors"]')).toBeNull();
    // The empty state itself is rendered, not a blank panel and not a scaffold of
    // "not-started" rows (task B3.2 — honest empty state).
    expect(container.querySelector(".decisions-empty")).toBeTruthy();
    expect(container.querySelector('[data-entry="module-goals"]')).toBeNull();
    expect(body).toContain("No decisions have been recorded in this conversation yet");
  });

  it("keeps the demo sample out of every renderer entry point", async () => {
    // Regression guard for the root cause: the fixture used to BE the store's
    // initial value, so it reached every lecturer in every course. It must not be
    // importable from renderer source any more.
    const store = await import("../src/renderer/state/store.js");
    expect(JSON.stringify(store.useCbe.getState().didacticChecks)).not.toContain("water flows");
    // Sanity: the fixture itself still carries the sample the guard looks for.
    expect(JSON.stringify(SAMPLE_DIDACTIC_CHECKS)).toContain("water flows");
  });
});

// Scenario: Switching to a course without decision state clears the panel
// Scenario: No design state crosses a course switch
describe("No design state crosses a course switch", () => {
  it("clears the Decisions panel when the target course has no decision state", () => {
    seedConversation({ session: testSession("sess-a", "course-a"), didacticChecks: A_CHECKS });
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    expect(decisionsText(container)).toContain("Course A operative goal");

    // Switch to course B and hydrate ITS conversation — no stored decision state.
    act(() => {
      useCbe.getState().setActiveCourse("course-b");
      useCbe.getState().hydrateConversation(emptyOpenResult("sess-b", "course-b"));
    });

    expect(useCbe.getState().didacticChecks).toEqual(emptyDidacticChecks());
    expect(decisionsText(container)).not.toContain("Course A operative goal");
  });

  it("clears canvas, step coverage and maturity alongside the decisions", () => {
    // Regression guard for all FOUR states the course-workspace requirement names,
    // not only the one that was broken.
    seedConversation({
      session: testSession("sess-a", "course-a"),
      didacticChecks: A_CHECKS,
      maturity: A_MATURITY,
    });
    act(() => {
      useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Course A big idea" });
      useCbe.getState().applyStepUpdate(4, { depth: "refined", focus: true });
    });
    expect(useCbe.getState().steps.find((s) => s.step === 4)!.depth).toBe("refined");

    act(() => {
      useCbe.getState().setActiveCourse("course-b");
      useCbe.getState().hydrateConversation(emptyOpenResult("sess-b", "course-b"));
    });

    const s = useCbe.getState();
    expect(s.didacticChecks).toEqual(emptyDidacticChecks());
    expect(s.maturity).toEqual({});
    expect(s.steps.find((st) => st.step === 4)!.depth).toBe("open");
    expect(s.steps.some((st) => st.focus)).toBe(false);
    const bigidea = s.artifacts.find((g) => g.step === 4)!.items.find((i) => i.id === "bigidea")!;
    expect(bigidea.value).toBe("");
  });
});

// The switch happens BEFORE the target course's conversation is hydrated —
// `openConversation` can take a while on a first start, and it may fail outright.
// The panel is rendered throughout that window, so the outgoing course's state
// must not remain visible in it.
describe("No design state crosses a course switch before hydration completes", () => {
  it("shows the empty state for all four states while the target course has no slice", () => {
    seedConversation({
      session: testSession("sess-a", "course-a"),
      didacticChecks: A_CHECKS,
      maturity: A_MATURITY,
    });
    act(() => {
      useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Course A big idea" });
      useCbe.getState().applyStepUpdate(4, { depth: "refined", focus: true });
    });
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    expect(decisionsText(container)).toContain("Course A operative goal");

    // Switch only — no hydration yet (course B's conversation is still opening).
    act(() => useCbe.getState().setActiveCourse("course-b"));

    const s = useCbe.getState();
    expect(s.didacticChecks).toEqual(emptyDidacticChecks());
    expect(s.invalidatedChecks).toEqual([]);
    expect(s.maturity).toEqual({});
    expect(s.steps.find((st) => st.step === 4)!.depth).toBe("open");
    expect(s.steps.some((st) => st.focus)).toBe(false);
    expect(s.artifacts.find((g) => g.step === 4)!.items.find((i) => i.id === "bigidea")!.value).toBe("");
    expect(decisionsText(container)).not.toContain("Course A operative goal");
  });

  it("clears the same four states when the switch arrives via setCourses", () => {
    seedConversation({
      session: testSession("sess-a", "course-a"),
      didacticChecks: A_CHECKS,
      maturity: A_MATURITY,
    });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Course A big idea" }));

    act(() => useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" }));

    const s = useCbe.getState();
    expect(s.didacticChecks).toEqual(emptyDidacticChecks());
    expect(s.maturity).toEqual({});
    expect(s.artifacts.find((g) => g.step === 4)!.items.find((i) => i.id === "bigidea")!.value).toBe("");
  });

  it("restores the loaded course's own values on the way back", () => {
    seedConversation({
      session: testSession("sess-a", "course-a"),
      didacticChecks: A_CHECKS,
      maturity: A_MATURITY,
    });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Course A big idea" }));

    act(() => useCbe.getState().setActiveCourse("course-b"));
    act(() => useCbe.getState().setActiveCourse("course-a"));

    const s = useCbe.getState();
    expect(s.didacticChecks).toEqual(A_CHECKS);
    expect(s.maturity).toEqual(A_MATURITY);
    expect(s.artifacts.find((g) => g.step === 4)!.items.find((i) => i.id === "bigidea")!.value).toBe(
      "Course A big idea"
    );
  });
});

// Scenario: Returning to a course restores exactly its own state
describe("Returning to a course restores exactly its own state", () => {
  it("shows A's decisions again after a round trip through B", () => {
    seedConversation({ session: testSession("sess-a", "course-a"), didacticChecks: A_CHECKS });
    const { container } = render(<ArtifactsPanel />);

    act(() => {
      useCbe.getState().setActiveCourse("course-b");
      useCbe.getState().hydrateConversation(emptyOpenResult("sess-b", "course-b"));
    });
    openDecisions();
    expect(decisionsText(container)).not.toContain("Course A operative goal");

    // Back to A: its slice is still held, so its own state returns unchanged.
    act(() => useCbe.getState().setActiveCourse("course-a"));

    expect(useCbe.getState().didacticChecks).toEqual(A_CHECKS);
    expect(decisionsText(container)).toContain("Course A operative goal");
  });
});

// Scenario: A background course's decision state stays with its course
// Scenario: A background course's design state is not presented for the active course
describe("A background course's decision state stays with its course", () => {
  it("never presents the background slice's decisions for the visible course", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b", { didacticChecks: A_CHECKS });
    const { container } = render(<ArtifactsPanel />);
    openDecisions();

    expect(useCbe.getState().didacticChecks).toEqual(emptyDidacticChecks());
    expect(decisionsText(container)).not.toContain("Course A operative goal");
    // …and the background slice kept its own value for its own re-entry.
    expect(useCbe.getState().conversations["sess-b"]!.didacticChecks).toEqual(A_CHECKS);
  });

  it("a goal revision in the visible course leaves the background course untouched", () => {
    seedConversation({ session: testSession("sess-a", "course-a"), didacticChecks: A_CHECKS });
    seedBackgroundConversation("sess-b", "course-b", { didacticChecks: A_CHECKS });

    act(() => useCbe.getState().reviseGoal("kompetenz"));

    // Visible slice: downstream checks reset and flagged as invalidated.
    expect(useCbe.getState().invalidatedChecks).toContain("alignment");
    expect(useCbe.getState().conversations["sess-a"]!.didacticChecks.alignment.status).toBe("not-started");
    // Background slice: completely unchanged.
    expect(useCbe.getState().conversations["sess-b"]!.didacticChecks).toEqual(A_CHECKS);
    expect(useCbe.getState().conversations["sess-b"]!.invalidatedChecks).toEqual([]);
  });
});
