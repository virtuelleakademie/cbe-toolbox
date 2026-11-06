/**
 * The panel follows the agent's artefact work (change `fix-ux3-wave2-orientation`,
 * Finding 2 of the UX-3 test run 2026-08-05: "Müsste man auch zwingend ins Pannel
 * wechseln und die Artefacte öffnen durch den Agent sobald da was gemacht wird.
 * Ansonsten ist es sehr verwirrend für den User").
 *
 * capability `desktop-app`, Requirement: Panel Follows the Agent's Artefact Work —
 * Scenarios:
 * - The first artefact write reveals the canvas
 * - A later artefact write does not move the panel again
 * - The lecturer's own navigation disarms the reveal
 * - A new session or a course switch does not re-arm the reveal
 * - An artefact write marks the CBE Process Canvas tab while another surface is visible
 * - Opening the CBE Process Canvas tab clears the marker
 * - A write into the visible canvas raises no marker
 * - The accordion opens the focused step group
 * - Repeated writes into one step group do not flicker the accordion
 * - A manually opened step group survives until the focus moves
 * - A step regaining the focus re-opens its group
 * - Switching courses re-derives the open step group
 * - The switch re-derives the group before the incoming conversation is hydrated
 * - A background conversation's write does not disturb the visible one
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { RightPanel } from "../src/renderer/components/RightPanel.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { applyStepPatch, seedSteps } from "../src/renderer/state/conversationReducer.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import type { AgentEvent } from "../src/shared/ipc-contract.js";

/** One accepted `cbe_canvas` set, delivered the way the main process forwards it. */
function emitCanvasWrite(sessionId = "test-session", step = 4, id = "bigidea", value = "Water resilience") {
  act(() => {
    useCbe.getState().ingestAgentEvent({
      type: "tool_execution_end",
      sessionId,
      data: {
        toolCallId: `c-${step}-${id}`,
        toolName: "cbe_canvas",
        result: {
          content: [{ type: "text", text: "ok" }],
          details: { kind: "canvas-update", action: "set", step, id, value },
        },
        isError: false,
      },
    } as unknown as AgentEvent);
  });
}

function panelState() {
  const s = useCbe.getState();
  return { tab: s.panelTab, collapsed: s.panelCollapsed, attention: s.artifactsAttention };
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
});
afterEach(cleanup);

// Scenario: The first artefact write reveals the canvas
describe("The first artefact write reveals the canvas", () => {
  it("expands the collapsed panel onto the CBE Process Canvas tab", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "artifacts" });

    emitCanvasWrite();

    expect(panelState()).toMatchObject({ collapsed: false, tab: "artifacts" });
  });

  it("switches to the CBE Process Canvas when the panel is expanded on another tab", () => {
    useCbe.setState({ panelCollapsed: false, panelTab: "maturity" });

    emitCanvasWrite();

    expect(panelState()).toMatchObject({ collapsed: false, tab: "artifacts" });
  });

  it("does not move DOM focus away from the composer", () => {
    useCbe.setState({ panelCollapsed: true });
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();

    emitCanvasWrite();

    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

// Scenario: A later artefact write does not move the panel again
describe("A later artefact write does not move the panel again", () => {
  it("leaves the panel exactly where the lecturer put it after the reveal is spent", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "artifacts" });
    emitCanvasWrite(); // the one-time reveal

    // The lecturer collapses the panel again and moves to CBE Maturity.
    act(() => {
      useCbe.getState().setPanelCollapsed(true);
      useCbe.getState().setPanelTab("maturity");
    });

    emitCanvasWrite("test-session", 5, "stakeholderplan", "Kanton");

    expect(panelState()).toMatchObject({ collapsed: true, tab: "maturity", attention: true });
  });

  it("reveals at most once even across a burst of writes", () => {
    useCbe.setState({ panelCollapsed: true });
    emitCanvasWrite();
    act(() => useCbe.getState().setPanelCollapsed(true));

    emitCanvasWrite("test-session", 5, "stakeholderplan", "a");
    emitCanvasWrite("test-session", 7, "activityplan", "b");

    expect(useCbe.getState().panelCollapsed).toBe(true);
  });
});

// Scenario: The lecturer's own navigation disarms the reveal
describe("The lecturer's own navigation disarms the reveal", () => {
  it("does not move the panel when the lecturer navigated before the first write", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "artifacts" });
    render(<RightPanel />);
    // A deliberate navigation: the lecturer opens CBE Maturity from the rail.
    fireEvent.click(screen.getByRole("button", { name: /Open CBE Maturity/ }));
    act(() => useCbe.getState().setPanelCollapsed(true));

    emitCanvasWrite();

    expect(panelState()).toMatchObject({ collapsed: true, tab: "maturity", attention: true });
  });

  it("the mount-time default-tab hydration is NOT such a navigation", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "maturity" });
    render(<RightPanel defaultTab="artifacts" />);

    emitCanvasWrite();

    expect(useCbe.getState().panelCollapsed).toBe(false);
  });
});

// Scenario: A new session or a course switch does not re-arm the reveal
describe("A new session or a course switch does not re-arm the reveal", () => {
  it("holds the lecturer's disarming navigation across a New Session", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "artifacts" });
    render(<RightPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Open CBE Maturity/ }));
    act(() => useCbe.getState().setPanelCollapsed(true));

    // New Session: a fresh conversation slice under a new session id.
    seedConversation({ session: testSession("sess-new") });
    emitCanvasWrite("sess-new");

    expect(panelState()).toMatchObject({ collapsed: true, tab: "maturity", attention: true });
  });

  it("holds the spent reveal across a course switch", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    useCbe.setState({ panelCollapsed: true, panelTab: "artifacts" });
    emitCanvasWrite("sess-a"); // the one-time reveal
    act(() => useCbe.getState().setPanelCollapsed(true));

    act(() => useCbe.getState().setActiveCourse("course-b"));
    emitCanvasWrite("sess-b");

    expect(panelState()).toMatchObject({ collapsed: true, attention: true });
  });

  it("arms again only on a fresh renderer mount, never from persisted state", () => {
    useCbe.setState({ panelCollapsed: true });
    emitCanvasWrite();
    expect(useCbe.getState().panelRevealArmed).toBe(false);

    // A fresh mount starts from the store defaults (nothing is read back from
    // localStorage — same semantics as `panelCollapsed`).
    act(() => useCbe.getState().reset());

    expect(useCbe.getState().panelRevealArmed).toBe(true);
    expect(localStorage.getItem("cbe-panel-reveal-armed")).toBeNull();
  });
});

// Scenario: An artefact write marks the CBE Process Canvas tab while another surface is visible
describe("An artefact write marks the CBE Process Canvas tab while another surface is visible", () => {
  it("renders the marker on the tab button with an accessible name, not colour alone", () => {
    useCbe.setState({ panelCollapsed: false, panelTab: "maturity" });
    emitCanvasWrite(); // spends the reveal
    act(() => useCbe.getState().setPanelTab("maturity"));
    emitCanvasWrite("test-session", 5, "stakeholderplan", "x");

    render(<RightPanel defaultTab="maturity" />);

    const tab = screen.getByRole("tab", { name: /CBE Process Canvas \(unseen changes\)/ });
    expect(tab.querySelector(".panel-attention-dot")).not.toBeNull();
  });

  it("renders the marker on the collapsed rail icon so it survives a collapsed panel", () => {
    useCbe.setState({ panelCollapsed: true, panelTab: "maturity" });
    emitCanvasWrite();
    act(() => {
      useCbe.getState().setPanelCollapsed(true);
      useCbe.getState().setPanelTab("maturity");
    });
    emitCanvasWrite("test-session", 5, "stakeholderplan", "x");

    render(<RightPanel defaultTab="maturity" />);

    const rail = screen.getByRole("button", { name: /Open CBE Process Canvas \(unseen changes\)/ });
    expect(rail.querySelector(".panel-attention-dot")).not.toBeNull();
  });
});

// Scenario: Opening the CBE Process Canvas tab clears the marker
describe("Opening the CBE Process Canvas tab clears the marker", () => {
  it("clears when the lecturer opens the tab, and does not re-raise on its own", () => {
    useCbe.setState({ panelCollapsed: false, panelTab: "maturity" });
    emitCanvasWrite();
    act(() => useCbe.getState().setPanelTab("maturity"));
    emitCanvasWrite("test-session", 5, "stakeholderplan", "x");
    expect(useCbe.getState().artifactsAttention).toBe(true);

    render(<RightPanel defaultTab="maturity" />);
    fireEvent.click(screen.getByRole("tab", { name: /CBE Process Canvas/ }));

    expect(useCbe.getState().artifactsAttention).toBe(false);
    expect(screen.queryByRole("tab", { name: /unseen changes/ })).toBeNull();
  });
});

// Scenario: A write into the visible canvas raises no marker
describe("A write into the visible canvas raises no marker", () => {
  it("stays unmarked while the panel is expanded on the CBE Process Canvas", () => {
    useCbe.setState({ panelCollapsed: false, panelTab: "artifacts" });

    emitCanvasWrite();
    emitCanvasWrite("test-session", 5, "stakeholderplan", "x");

    expect(panelState()).toMatchObject({ collapsed: false, tab: "artifacts", attention: false });
  });
});

// Scenario: A background conversation's write does not disturb the visible one
describe("A background conversation's write does not disturb the visible one", () => {
  it("neither reveals nor marks the visible course's panel", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    useCbe.setState({ panelCollapsed: true, panelTab: "maturity" });

    emitCanvasWrite("sess-b");

    expect(panelState()).toMatchObject({ collapsed: true, tab: "maturity", attention: false });
    // The write DID land in its own slice's marker, for when that course is opened.
    expect(useCbe.getState().conversations["sess-b"]!.artifactsAttention).toBe(true);
    // …and it did not SPEND the reveal: work the lecturer cannot see never
    // consumes the panel's one move.
    expect(useCbe.getState().panelRevealArmed).toBe(true);
  });
});

// Scenario: The accordion opens the focused step group
describe("The accordion opens the focused step group", () => {
  function openStepNumbers(): string[] {
    return [...document.querySelectorAll(".step-group")]
      .filter((g) => g.querySelector(".step-body") !== null)
      .map((g) => (g as HTMLElement).dataset.step ?? "");
  }

  it("opens the group of the focused step instead of staying on step 1", () => {
    render(<ArtifactsPanel />);
    expect(openStepNumbers()).toEqual(["1"]);

    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));

    expect(openStepNumbers()).toEqual(["6"]);
  });

  it("follows a later focus move too", () => {
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));
    act(() => useCbe.getState().applyStepUpdate(9, { focus: true }));

    expect(openStepNumbers()).toEqual(["9"]);
  });

  // Scenario: Repeated writes into one step group do not flicker the accordion
  it("does not re-drive the accordion while the focused step is unchanged", () => {
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(4, { focus: true }));
    // The lecturer looks at another group while the agent keeps writing into step 4.
    fireEvent.click(screen.getByRole("button", { name: /^2\s*Learning Outcomes/ }));
    expect(openStepNumbers()).toEqual(["2"]);

    emitCanvasWrite("test-session", 4, "bigidea", "a");
    emitCanvasWrite("test-session", 4, "eq", "b");

    expect(openStepNumbers()).toEqual(["2"]);
  });

  // Scenario: A manually opened step group survives until the focus moves
  it("keeps a manually opened group until the focused step actually moves", () => {
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(4, { focus: true }));
    fireEvent.click(screen.getByRole("button", { name: /^9\s*Alignment Check/ }));
    expect(openStepNumbers()).toEqual(["9"]);

    // Re-asserting the SAME focus changes nothing…
    act(() => useCbe.getState().applyStepUpdate(4, { focus: true }));
    expect(openStepNumbers()).toEqual(["9"]);

    // …but a real focus move is followed again.
    act(() => useCbe.getState().applyStepUpdate(7, { focus: true }));
    expect(openStepNumbers()).toEqual(["7"]);
  });

  // Scenario: A step regaining the focus re-opens its group
  it("re-opens a step's group when it regains the focus after the conversation had none", () => {
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));
    expect(openStepNumbers()).toEqual(["6"]);

    act(() => useCbe.getState().applyStepUpdate(6, { focus: false }));
    fireEvent.click(screen.getByRole("button", { name: /^2\s*Learning Outcomes/ }));
    expect(openStepNumbers()).toEqual(["2"]);

    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));

    expect(openStepNumbers()).toEqual(["6"]);
  });

  // Scenario: Switching courses re-derives the open step group
  it("shows the incoming course's focused group, not the outgoing course's open one", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b", {
      steps: applyStepPatch(seedSteps(), 6, { focus: true }),
    });
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));
    // The lecturer hand-opens another group in course A.
    fireEvent.click(screen.getByRole("button", { name: /^2\s*Learning Outcomes/ }));
    expect(openStepNumbers()).toEqual(["2"]);

    // Course B's focus happens to be the SAME step 6 — the switch must still re-derive.
    act(() => useCbe.getState().setActiveCourse("course-b"));

    expect(openStepNumbers()).toEqual(["6"]);
  });

  it("falls back to the default group when the incoming course has no focused step", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));
    expect(openStepNumbers()).toEqual(["6"]);

    act(() => useCbe.getState().setActiveCourse("course-b"));

    expect(openStepNumbers()).toEqual(["1"]);
  });

  // The switch window itself: the incoming course has NO conversation slice yet, so
  // there is no session to key the memory to at all. These two cases used to assert
  // that `session` still held the OUTGOING course's id — that was the defect change
  // `clear-the-session-mirror-on-a-course-switch` fixed at the cause, and the
  // assertion is inverted here rather than deleted, so the file keeps saying what the
  // accordion's course component is for (capability `course-workspace`, Requirement:
  // Course-Scoped Isolation of Canvas, Step, Maturity and Decision State).
  it("re-derives the group while the incoming course is not hydrated yet", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));
    expect(openStepNumbers()).toEqual(["6"]);

    act(() => {
      useCbe.getState().setHydration("pending");
      useCbe.getState().setActiveCourse("course-b");
    });

    expect(useCbe.getState().session).toBeNull();
    expect(openStepNumbers()).toEqual(["1"]);
  });

  it("keeps the default group when the switch hydration fails and no session ever arrives", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(6, { focus: true }));

    act(() => {
      useCbe.getState().setActiveCourse("course-b");
      useCbe.getState().setHydration("error", "session start failed");
    });

    expect(useCbe.getState().session).toBeNull();
    expect(openStepNumbers()).toEqual(["1"]);
  });
});
