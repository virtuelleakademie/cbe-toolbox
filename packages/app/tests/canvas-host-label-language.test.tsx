/**
 * What the lecturer READS follows the interface language; what the MODEL reads
 * stays the reference language (capability `desktop-app`, Requirement: *Every
 * String the App Renders Is English*, Scenario *The agent's reply language is
 * untouched* — "no chrome string is added to the model payload").
 *
 * Two canvas actions hand the host a LABEL, and the host quotes it verbatim into
 * a payload-prefix notice the model reads on the next turn: the step-focus click
 * (`stepFocusNoticeLine`) and the artefact deletion (`canvasDeletionNoticeLine`).
 * A seeded label follows the interface language on screen, so with German active
 * those notices would carry German inside an otherwise-English machine line —
 * which is an implicit reply-language signal, exactly what the maturity Discuss
 * token is pinned to the reference language to avoid.
 *
 * Each case is asserted in BOTH directions in one test: the canvas really is
 * rendering German, and the label travelling to the host really is English.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { __resetActiveLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { seedConversation, TEST_COURSE_ID } from "./helpers/conversation.js";

/** Adopt a language the way `wireInterfaceLanguage` does — the seeded canvas
 * labels are per-conversation DATA and only move when they are re-derived. */
function useGerman(): void {
  act(() => {
    setActiveLanguage("de");
    useCbe.getState().relabelSeededChrome();
  });
}

function stepSelect(container: HTMLElement, step: number, name: string): HTMLButtonElement {
  return within(container.querySelector(`[data-step="${step}"]`) as HTMLElement).getByRole("button", {
    name,
  }) as HTMLButtonElement;
}

function card(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-artifact-id="${id}"]`) as HTMLElement;
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
  useCbe.setState({ activeCourseId: TEST_COURSE_ID, annotations: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetActiveLanguage();
});

describe("a canvas label the host quotes to the model stays in the reference language", () => {
  it("shows the German step name but hands the host the English one", () => {
    const focusSpy = vi.spyOn(window.cbe, "focusStep").mockResolvedValue(undefined as never);
    const { container } = render(<ArtifactsPanel />);
    useGerman();

    // The lecturer's half: the canvas really is German. Step 3, because steps 4
    // and 5 are proper names that read the same in both catalogues by design and
    // would prove nothing here.
    const head = container.querySelector('[data-step="3"] .step-head') as HTMLElement;
    expect(head.textContent).toContain(de.canvasStep3Name);
    expect(de.canvasStep3Name).not.toBe(en.canvasStep3Name);

    fireEvent.click(stepSelect(container, 3, de.canvasStepFocusLabel({ step: 3, name: de.canvasStep3Name })));

    // The model's half: the label on the wire is the reference language's.
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy.mock.calls[0]![0]).toMatchObject({ step: 3, label: en.canvasStep3Name });
  });

  it("shows the German artefact label but hands the host the English one on delete", () => {
    const deleteSpy = vi.spyOn(window.cbe, "deleteCanvasArtefact").mockResolvedValue(undefined as never);
    const { container } = render(<ArtifactsPanel />);
    act(() =>
      useCbe.getState().applyCanvasUpdate(2, undefined, "learningoutcomes", { value: "Resilienz", state: "done" })
    );
    useGerman();
    fireEvent.click(container.querySelector('[data-step="2"] .step-head') as HTMLElement);

    const row = card(container, "learningoutcomes");
    expect(row.textContent).toContain(de.canvasArtefactLearningoutcomes);
    expect(de.canvasArtefactLearningoutcomes).not.toBe(en.canvasArtefactLearningoutcomes);

    fireEvent.click(
      within(row).getByRole("button", {
        name: de.canvasDeleteArtefactLabel({ label: de.canvasArtefactLearningoutcomes }),
      })
    );
    fireEvent.click(within(row).getByRole("button", { name: de.canvasDeleteAction }));

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0]![0]).toMatchObject({
      id: "learningoutcomes",
      label: en.canvasArtefactLearningoutcomes,
    });
  });

  it("passes a label the SKILL supplied through untouched — it is lecturer content, not chrome", () => {
    const deleteSpy = vi.spyOn(window.cbe, "deleteCanvasArtefact").mockResolvedValue(undefined as never);
    const { container } = render(<ArtifactsPanel />);
    act(() =>
      useCbe.getState().applyCanvasUpdate(2, undefined, "learningoutcomes", {
        value: "Resilienz",
        state: "done",
        label: "Lernziele des Moduls",
      })
    );
    useGerman();
    fireEvent.click(container.querySelector('[data-step="2"] .step-head') as HTMLElement);

    const row = card(container, "learningoutcomes");
    fireEvent.click(
      within(row).getByRole("button", { name: de.canvasDeleteArtefactLabel({ label: "Lernziele des Moduls" }) })
    );
    fireEvent.click(within(row).getByRole("button", { name: de.canvasDeleteAction }));

    expect(deleteSpy.mock.calls[0]![0]).toMatchObject({ label: "Lernziele des Moduls" });
  });
});
