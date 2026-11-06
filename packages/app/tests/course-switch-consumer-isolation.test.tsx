/**
 * No control acts on the course the lecturer has LEFT (capability `course-workspace`,
 * Requirement: Course-Scoped Isolation of Canvas, Step, Maturity and Decision State —
 * Scenarios: *A control rendered during that window cannot reach the outgoing course*;
 * *A switch whose conversation resolution fails does not fall back to the previous
 * course*; *A New Session keeps what a course switch clears*).
 *
 * These are the consumers that stay MOUNTED across a switch, which is what made the
 * defect reachable at all: `App.tsx` renders `ChatPanel` only while
 * `hydration === "ready"`, so the whole chat subtree is unmounted for the window (and
 * for the whole of a failed switch), while the right panel and the header are not.
 * Reproduced end to end in the running app on 2026-08-26 — the CBE Maturity panel's
 * dispatch ran a turn in the previous course's session, and a step-focus click wrote
 * into that course's host step mirror and was disclosed to its model on the next turn.
 *
 * The switch is driven the way the lecturer drives it: a click on a course card in the
 * left panel, through the real `switchCourse` pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../src/shared/i18n/en.js";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { testSession } from "./helpers/conversation.js";
import type { ConversationOpenResult, CourseListResult, CourseSummary } from "../src/shared/ipc-contract.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";

const COURSES: CourseSummary[] = [
  { id: "course-a", title: "Course A", path: "/space/courses/course-a" },
  { id: "course-b", title: "Course B", path: "/space/courses/course-b" },
];

const A_MATURITY: MaturitySnapshot = {
  "societal-challenge": { current: 2, target: 3 },
} as MaturitySnapshot;

function listResult(activeCourseId: string): CourseListResult {
  return { courses: COURSES, activeCourseId };
}

/** Course A's conversation, carrying design state in every panel. */
function courseAConversation(sessionId = "session-a"): ConversationOpenResult {
  return {
    session: testSession(sessionId, "course-a"),
    turns: [{ role: "user", text: "Course A question" }],
    agentRunning: false,
    canvas: [{ step: 1, id: "module-meta", label: "Module meta", value: "Course A frame", state: "draft" }],
    steps: [{ step: 2, depth: "rough" }],
    maturity: A_MATURITY,
  };
}

/** A never-settling `openConversation`: the switch window held open, which is what a
 * lecturer sees for as long as the target course's resolution takes. */
function pendingForever(): Promise<ConversationOpenResult> {
  return new Promise<ConversationOpenResult>(() => {});
}

function activate(title: string) {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(card.querySelector(".proj-open") as HTMLElement);
}

function assessButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: en.maturityAssessLabel }) as HTMLButtonElement;
}

function stepFocusButton(step: number, name: string): HTMLButtonElement {
  return screen.getByRole("button", { name: en.canvasStepFocusLabel({ step, name }) }) as HTMLButtonElement;
}

/** Everything the right panel and the header render during a switch. */
function renderSwitchSurfaces() {
  return render(
    <>
      <AppHeader workspaceVisible configured />
      <CoursesPanel />
      <ArtifactsPanel />
      <MaturityPanel />
    </>
  );
}

let sendPrompt: ReturnType<typeof vi.fn>;
let focusStep: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendPrompt = vi.fn(async () => ({ ok: true as const }));
  focusStep = vi.fn(async () => ({ ok: true as const }));
  Object.assign(window.cbe, {
    listCourses: async () => listResult("course-a"),
    setActiveCourse: async (id: string) => listResult(id),
    sendPrompt,
    focusStep,
  });
  useCbe.setState({ courses: COURSES, activeCourseId: "course-a" });
  useCbe.getState().hydrateConversation(courseAConversation());
  useCbe.getState().setHydration("ready");
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
});

describe("the controls that stay mounted across a switch", () => {
  it("are live for the course the lecturer is actually in", () => {
    renderSwitchSurfaces();
    expect(assessButton().disabled).toBe(false);
    expect(stepFocusButton(2, "Learning Outcomes").disabled).toBe(false);
  });

  it("the CBE Maturity dispatch goes dead instead of into the previous course", async () => {
    Object.assign(window.cbe, { openConversation: pendingForever });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("course-b"));
    await waitFor(() => expect(assessButton().disabled).toBe(true));
    // The reason names the real situation, not a run lock and not "nothing to assess".
    expect(screen.getByText(en.maturityAssessNoSession)).toBeTruthy();

    fireEvent.click(assessButton());
    expect(sendPrompt).not.toHaveBeenCalled();
    // ... and no phantom user turn was appended to a mirror nobody can see.
    expect(useCbe.getState().turns).toEqual([]);
  });

  it("the canvas step-focus cannot write into the previous course's host mirror", async () => {
    Object.assign(window.cbe, { openConversation: pendingForever });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("course-b"));
    const focus = stepFocusButton(7, "Activities");
    await waitFor(() => expect(focus.disabled).toBe(true));

    fireEvent.click(focus);
    expect(focusStep).not.toHaveBeenCalled();
  });

  it("the export control names the missing conversation, not a missing canvas", async () => {
    Object.assign(window.cbe, { openConversation: pendingForever });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("course-b"));
    await waitFor(() => expect(screen.getByText(en.canvasExportNoSession)).toBeTruthy());
  });

  it("the header's help control dispatches nothing and discards no background output", async () => {
    Object.assign(window.cbe, { openConversation: pendingForever });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().activeCourseId).toBe("course-b"));
    fireEvent.click(screen.getByRole("button", { name: en.headerHelpLabel }));
    expect(sendPrompt).not.toHaveBeenCalled();
    // Course A's slice — including anything still streaming there — is untouched.
    expect(useCbe.getState().conversations["session-a"]).toBeTruthy();
  });

  it("stay dead after a switch whose resolution FAILS, which is the permanent case", async () => {
    Object.assign(window.cbe, {
      openConversation: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().hydration).toBe("error"));
    expect(useCbe.getState().session).toBeNull();
    expect(assessButton().disabled).toBe(true);
    expect(stepFocusButton(7, "Activities").disabled).toBe(true);

    fireEvent.click(assessButton());
    fireEvent.click(stepFocusButton(7, "Activities"));
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(focusStep).not.toHaveBeenCalled();
  });

  it("come back live for the target course once its conversation resolves", async () => {
    Object.assign(window.cbe, {
      openConversation: async (): Promise<ConversationOpenResult> => ({
        session: testSession("session-b", "course-b"),
        turns: [],
        agentRunning: false,
        canvas: [],
        maturity: {},
      }),
    });
    renderSwitchSurfaces();
    activate("Course B");

    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("session-b"));
    await waitFor(() => expect(assessButton().disabled).toBe(false));

    fireEvent.click(assessButton());
    await waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    expect(sendPrompt.mock.calls[0]![0]).toBe("session-b");
  });
});

describe("a New Session is not a switch", () => {
  it("keeps the canvas, the step coverage and the maturity reading the switch would clear", async () => {
    renderSwitchSurfaces();
    expect(screen.getByText("Course A frame")).toBeTruthy();

    // What the New Session control does: a fresh conversation for the SAME course,
    // carrying the state the main process snapshotted.
    useCbe.getState().hydrateConversation({
      ...courseAConversation("session-a-fresh"),
      turns: [],
    });

    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("session-a-fresh"));
    expect(useCbe.getState().turns).toEqual([]);
    expect(screen.getByText("Course A frame")).toBeTruthy();
    expect(useCbe.getState().steps.find((s) => s.step === 2)?.depth).toBe("rough");
    expect(useCbe.getState().maturity["societal-challenge"]?.current).toBe(2);
    expect(assessButton().disabled).toBe(false);
  });
});
