/**
 * Tests for the per-artefact Canvas delete control after the ten-step restructure —
 * the deletion regression guard (task 6.7) that the control SURVIVES the restructure.
 *
 * Capability `desktop-app`, Requirement: Canvas Artefact Delete Control. Test names
 * mirror the spec scenarios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
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
function card(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-artifact-id="${id}"]`) as HTMLElement;
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ activeCourseId: "water-systems", annotations: [], session: FAKE_SESSION, mode: "design" });
});
afterEach(() => {
  cleanup();
  useCbe.setState({ session: null, mode: null });
});

describe("Canvas Artefact Delete Control", () => {
  // Scenario: Delete control appears only on artefacts with content
  it("renders the delete control on a card with a value but not on an empty seed card", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" }));
    expandStep(container, 4);
    expect(within(card(container, "bigidea")).getByRole("button", { name: /Delete Big Idea/i })).toBeTruthy();
    // The Essential Question is still an empty seed card — no delete control.
    expect(within(card(container, "eq")).queryByRole("button", { name: /Delete/i })).toBeNull();
  });

  // Scenario: Delete control renders on artefact cards within the step groups (Step 4 + Step 6)
  it("renders the delete control on a value-carrying Step-4 card AND a Step-6 journey card", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => {
      useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" });
      useCbe.getState().applyCanvasUpdate(6, "investigate", "is", { value: "Weeks 4-7: field study.", state: "draft" });
    });
    expandStep(container, 4);
    expect(within(card(container, "bigidea")).getByRole("button", { name: /Delete Big Idea/i })).toBeTruthy();
    expandStep(container, 6);
    expect(within(card(container, "is")).getByRole("button", { name: /Delete Investigate Sequence/i })).toBeTruthy();
  });

  // Scenario: The delete confirmation names the card, not a retired category
  it("names the card by its own label and says the content is cleared from the CBE Process Canvas", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" }));
    expandStep(container, 4);
    fireEvent.click(within(card(container, "bigidea")).getByRole("button", { name: /Delete Big Idea/i }));

    const confirm = card(container, "bigidea").querySelector(".artifact-delete-confirm") as HTMLElement;
    expect(confirm).toBeTruthy();
    const msg = confirm.querySelector(".artifact-delete-msg")?.textContent ?? "";
    // The card's OWN label, and where the content goes from.
    expect(msg).toContain('Delete "Big Idea"?');
    expect(msg).toMatch(/cleared from the CBE Process Canvas/);
    // Never the retired surface label.
    expect(msg).not.toMatch(/Artefacts|Artifacts|Artefakte/);
  });

  // Scenario: A confirmed UI deletion reverts the artefact like a skill clear
  it("reverts the artefact and dispatches the host IPC (with step) on a confirmed deletion", () => {
    const deleteSpy = vi.spyOn(window.cbe, "deleteCanvasArtefact").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    act(() => {
      useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" });
      useCbe.getState().addAnnotation("bigidea", "Resilience", "reconsider");
    });
    expandStep(container, 4);
    fireEvent.click(within(card(container, "bigidea")).getByRole("button", { name: /Delete Big Idea/i }));
    fireEvent.click(within(card(container, "bigidea")).getByRole("button", { name: /^Delete$/ }));

    const bigIdea = card(container, "bigidea");
    expect(bigIdea.getAttribute("data-state")).toBe("open");
    expect(bigIdea.querySelector(".artifact-empty")?.textContent).toBe("—");
    expect(useCbe.getState().annotations.some((a) => a.artifactId === "bigidea")).toBe(false);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s-1", step: 4, id: "bigidea", label: "Big Idea" })
    );
  });

  it("dispatches the host IPC with the journey phase for a Step-6 card", () => {
    const deleteSpy = vi.spyOn(window.cbe, "deleteCanvasArtefact").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    act(() =>
      useCbe.getState().applyCanvasUpdate(6, "investigate", "is", { value: "Weeks 4-7: field study.", state: "draft" })
    );
    expandStep(container, 6);
    fireEvent.click(within(card(container, "is")).getByRole("button", { name: /Delete Investigate Sequence/i }));
    fireEvent.click(within(card(container, "is")).getByRole("button", { name: /^Delete$/ }));
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s-1", step: 6, phase: "investigate", id: "is" })
    );
  });

  // Scenario: A dismissed confirmation leaves the artefact untouched
  it("leaves the artefact untouched and dispatches no IPC on a dismissed confirmation", () => {
    const deleteSpy = vi.spyOn(window.cbe, "deleteCanvasArtefact").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    act(() => {
      useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" });
      useCbe.getState().addAnnotation("bigidea", "Resilience", "keep");
    });
    expandStep(container, 4);
    fireEvent.click(within(card(container, "bigidea")).getByRole("button", { name: /Delete Big Idea/i }));
    fireEvent.click(within(card(container, "bigidea")).getByRole("button", { name: /Cancel/ }));

    const bigIdea = card(container, "bigidea");
    expect(within(bigIdea).getByText("Resilience")).toBeTruthy();
    expect(bigIdea.getAttribute("data-state")).toBe("done");
    expect(useCbe.getState().annotations.some((a) => a.artifactId === "bigidea")).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
