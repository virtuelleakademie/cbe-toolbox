/**
 * Tests for the Design-Flow Canvas (Artifacts tab) after the ten-step restructure.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement: Design-Flow Canvas + Artifacts Tab /
 * Canvas: the ten design-step groups, Step 4 challenge ladder, Step 6 four-element
 * learning journey, cold seed, live coverage headers, exclusive focus, and host-channel
 * step selection — the click calls `window.cbe.focusStep`, dispatches no prompt and appends
 * no user turn, and the retired `[step select · …]` token appears nowhere; the step chrome
 * is always active (no mode state).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { StepMirror } from "@cbe/pi-bridge";
import type { StartSessionResult } from "../src/shared/ipc-contract.js";

const FAKE_SESSION = {
  sessionId: "s-1",
  mode: "design",
  environmentProfile: "app",
  affordances: {},
  paths: { workspace: "", corpus: "", wiki: undefined },
  courseId: "",
} as unknown as StartSessionResult;

function stepHead(container: HTMLElement, step: number): HTMLElement {
  return container.querySelector(`[data-step="${step}"] .step-head`) as HTMLElement;
}
function expandStep(container: HTMLElement, step: number) {
  fireEvent.click(stepHead(container, step));
}
function stepBody(container: HTMLElement, step: number): HTMLElement {
  const b = container.querySelector(`[data-step="${step}"] .step-body`);
  if (!b) throw new Error(`step ${step} body not open`);
  return b as HTMLElement;
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ activeCourseId: "water-systems", annotations: [], session: FAKE_SESSION });
});
afterEach(() => {
  cleanup();
  useCbe.setState({ session: null });
});

describe("Design-Flow Canvas — ten design steps", () => {
  it("A fresh canvas renders step 1 in focus in its first hydrated frame", () => {
    expect(useCbe.getState().steps).toHaveLength(10);
    expect(useCbe.getState().steps.every((step) => step.depth === "open" && !step.focus)).toBe(true);
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    const session = { ...FAKE_SESSION, courseId: "water-systems" };
    useCbe.getState().hydrateConversation({
      session,
      turns: [],
      agentRunning: false,
      canvas: [],
      steps: mirror.list(),
      maturity: {},
    });
    const { container } = render(<ArtifactsPanel />);
    expect(container.querySelectorAll('[data-focus="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-step="1"] .step-focus')).not.toBeNull();
    expect(container.querySelectorAll('.step-coverage[data-depth="open"]')).toHaveLength(10);
    expect(useCbe.getState().turns).toHaveLength(0);
  });

  // Scenario: Canvas is organized along the ten design steps / Ten-step groups visible
  it("renders the ten design-step groups in flow order", () => {
    const { container } = render(<ArtifactsPanel />);
    const groups = container.querySelectorAll(".step-group");
    expect(groups.length).toBe(10);
    const steps = Array.from(groups).map((g) => g.getAttribute("data-step"));
    expect(steps).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    for (const name of ["Set the Frame", "Challenge", "Learning Journey", "Prepare"]) {
      expect(screen.getAllByText(new RegExp(name)).length).toBeGreaterThan(0);
    }
  });

  // Scenario: Step 4 carries the challenge ladder
  it("Step 4 carries the challenge ladder (canonical ids)", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 4);
    const body = stepBody(container, 4);
    expect(body.querySelector('[data-artifact-id="bigidea"]')).toBeTruthy();
    expect(body.querySelector('[data-artifact-id="eq"]')).toBeTruthy();
    expect(body.querySelector('[data-artifact-id="challenge"]')).toBeTruthy();
    for (const label of ["Big Idea", "Essential Question", "Challenge Statement"]) {
      expect(within(body).getByText(label)).toBeTruthy();
    }
  });

  // Scenario: Step 6 hosts the four-element learning journey (Reflect renders even empty)
  it("Step 6 shows the four journey elements incl. an empty Reflect and present", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 6);
    const body = stepBody(container, 6);
    const elements = body.querySelectorAll(".journey-element");
    expect(Array.from(elements).map((el) => el.getAttribute("data-journey-phase"))).toEqual([
      "engage",
      "investigate",
      "act",
      "reflect",
    ]);
    // Reflect and present renders its name even while empty.
    expect(within(body).getByText("Reflect and present")).toBeTruthy();
    // Journey artefacts are present under their elements.
    expect(body.querySelector('[data-artifact-id="is"]')).toBeTruthy();
    expect(body.querySelector('[data-artifact-id="as"]')).toBeTruthy();
  });

  // Scenario: Each journey element renders exactly one seeded row (capability `desktop-app`,
  // Requirement: Artifacts Tab / Canvas (Phase 1 mock); change
  // `harmonise-canvas-slots-with-the-ten-step-outputs`). §4.6 gives step 6 ONE named output,
  // so each element carries one row holding its slice of the phase plan — never a card for a
  // `methodology-001` learner-time activity.
  it("Each journey element renders exactly one seeded row", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 6);
    const body = stepBody(container, 6);

    const expected: Record<string, [string, string]> = {
      engage: ["es", "Engage Sequence"],
      investigate: ["is", "Investigate Sequence"],
      act: ["as", "Act Sequence"],
      reflect: ["rs", "Reflect Sequence"],
    };
    for (const el of Array.from(body.querySelectorAll(".journey-element"))) {
      const phase = el.getAttribute("data-journey-phase")!;
      const rows = Array.from(el.querySelectorAll("[data-artifact-id]"));
      expect(
        rows.map((r) => r.getAttribute("data-artifact-id")),
        phase
      ).toEqual([expected[phase][0]]);
      expect(within(el as HTMLElement).getByText(expected[phase][1])).toBeTruthy();
      // Cold session: empty and `open`.
      expect(rows[0].getAttribute("data-state"), phase).toBe("open");
      expect(within(rows[0] as HTMLElement).getByText("—"), phase).toBeTruthy();
    }

    // No CBL learner-time label anywhere under step 6.
    for (const label of [
      "Guiding Questions",
      "Activities & Resources",
      "Analysis",
      "Solution Concepts",
      "Solution Development",
      "Implementation & Evaluation",
    ]) {
      expect(within(body).queryByText(label), label).toBeNull();
    }
  });

  // Scenario: Cold session shows the ten-step seed
  it("cold seed: every artefact starts open with a placeholder value", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 4);
    const rows = stepBody(container, 4).querySelectorAll(".artifact");
    expect(rows.length).toBe(3);
    for (const row of Array.from(rows)) {
      expect(row.getAttribute("data-state")).toBe("open");
      expect(row.querySelector(".st-dot")).toBeTruthy();
      expect(row.querySelector(".artifact-empty")?.textContent).toBe("—");
    }
  });

  it("expands one step group at a time (step 1 open by default)", () => {
    const { container } = render(<ArtifactsPanel />);
    expect(stepHead(container, 1).getAttribute("aria-expanded")).toBe("true");
    expandStep(container, 3);
    expect(container.querySelectorAll(".step-body").length).toBe(1);
    expect(stepHead(container, 3).getAttribute("aria-expanded")).toBe("true");
    expect(stepHead(container, 1).getAttribute("aria-expanded")).toBe("false");
  });

  // Scenario: Settled step deliverable appears in its step group
  it("a settled step deliverable appears in its step group", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() =>
      useCbe
        .getState()
        .applyCanvasUpdate(3, undefined, "assessmentblueprint", { value: "Evidence map.", state: "active" })
    );
    expandStep(container, 3);
    const row = stepBody(container, 3).querySelector('[data-artifact-id="assessmentblueprint"]') as HTMLElement;
    expect(row.getAttribute("data-state")).toBe("active");
    expect(within(row).getByText("Evidence map.")).toBeTruthy();
  });

  // Scenario: Artefact states are visible
  it("a populated artefact shows its value and advanced state", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" }));
    expandStep(container, 4);
    const bigIdea = stepBody(container, 4).querySelector('[data-artifact-id="bigidea"]') as HTMLElement;
    expect(bigIdea.getAttribute("data-state")).toBe("done");
    expect(within(bigIdea).getByText("done")).toBeTruthy();
    expect(within(bigIdea).getByText("Resilience")).toBeTruthy();
  });
});

describe("Design-Flow Canvas — coverage headers and step selection", () => {
  // Scenario: Step coverage depth renders live on the group header
  it("renders the coverage depth on the step header", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(3, { depth: "rough" }));
    const head = stepHead(container, 3);
    expect(within(head).getByText("rough")).toBeTruthy();
  });

  // Scenario: Focus is exclusive (render)
  it("renders the in-focus marker on exactly one step at a time", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(2, { focus: true }));
    expect(container.querySelector('[data-step="2"]')?.getAttribute("data-focus")).toBe("true");
    act(() => useCbe.getState().applyStepUpdate(4, { focus: true }));
    expect(container.querySelector('[data-step="4"]')?.getAttribute("data-focus")).toBe("true");
    expect(container.querySelector('[data-step="2"]')?.getAttribute("data-focus")).toBeNull();
  });

  // Scenario: Selecting a step moves the focus marker and adds nothing to the chat
  it("selecting a step moves the focus marker and adds nothing to the chat", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const focusSpy = vi.spyOn(window.cbe, "focusStep").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(2, { focus: true }));
    // The step-5 select affordance.
    const select = within(container.querySelector('[data-step="5"]') as HTMLElement).getByRole("button", {
      name: /Focus on step 5: Stakeholder/i,
    });
    await act(async () => {
      fireEvent.click(select);
    });

    // The marker moved in this frame, exclusively.
    expect(container.querySelector('[data-step="5"]')?.getAttribute("data-focus")).toBe("true");
    expect(container.querySelector('[data-step="2"]')?.getAttribute("data-focus")).toBeNull();
    // Routed to the host on the dedicated channel, with the label.
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s-1", step: 5, label: "Stakeholder" }));
    // NOTHING in the chat: no prompt dispatched, no user turn of any kind.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user")).toHaveLength(0);
  });

  // Scenario: The retired step-select machine token appears nowhere
  it("emits no [step select · …] token anywhere", async () => {
    vi.spyOn(window.cbe, "focusStep").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    const select = within(container.querySelector('[data-step="5"]') as HTMLElement).getByRole("button", {
      name: /Focus on step 5: Stakeholder/i,
    });
    await act(async () => {
      fireEvent.click(select);
    });
    const everything = JSON.stringify(useCbe.getState().turns);
    expect(everything).not.toContain("[step select");
    expect(everything).not.toContain("Focus on step 5: Stakeholder");
  });

  // Scenario: The step-select affordance stays active during a run
  it("keeps the step-select affordance active during a run", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const focusSpy = vi.spyOn(window.cbe, "focusStep").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.setState({ agentRunning: true }));

    const select = within(container.querySelector('[data-step="5"]') as HTMLElement).getByRole("button", {
      name: /Focus on step 5: Stakeholder/i,
    });
    // It dispatches no prompt, so the run lock does not apply to it.
    expect((select as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(select);
    });

    expect(container.querySelector('[data-step="5"]')?.getAttribute("data-focus")).toBe("true");
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
    act(() => useCbe.setState({ agentRunning: false }));
  });
});

describe("Design-Flow Canvas — step chrome is always active", () => {
  // The de-emphasis existed only against a visible non-design mode; with the
  // mode model retired the chrome is simply always on (change
  // internalize-operation-modes, Requirement: Design-Flow Canvas).
  it("renders coverage chrome and enabled step-select without any mode state", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyStepUpdate(3, { depth: "rough", focus: true }));
    // Coverage chrome renders; no de-emphasis note exists anywhere.
    expect(container.querySelector(".step-coverage")).not.toBeNull();
    expect(screen.queryByText(/Step progress is tracked in Design mode/i)).toBeNull();
    const select = within(container.querySelector('[data-step="5"]') as HTMLElement).getByRole("button", {
      name: /Focus on step 5/i,
    });
    expect((select as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelectorAll(".step-group").length).toBe(10);
  });
});
