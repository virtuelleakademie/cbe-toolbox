/**
 * Tests for the Canvas "Decisions" section.
 *
 * Covers `specs/desktop-app/spec.md` (change add-kompetenz-alignment-delegation-checks):
 * - Requirement: Decision Artifacts — Population of the Canvas from Didactic-Check
 *   Outcomes (six scenarios)
 * - Requirement: Decisions Section Visible Across the Three CBL Phase Views
 *   (independent expansion + one-phase-among-three invariant)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { SAMPLE_DIDACTIC_CHECKS } from "./fixtures/decisions.js";
import type { DidacticChecks } from "@cbe/pi-bridge/didactic-checks";

function openDecisions() {
  fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));
}

beforeEach(() => {
  // Deep-clone the mock so reviseGoal()/hydrate in one test cannot leak into another.
  useCbe.setState({
    didacticChecks: structuredClone(SAMPLE_DIDACTIC_CHECKS),
    invalidatedChecks: [],
  });
});

afterEach(() => cleanup());

describe("Decisions section visibility across the step-group views", () => {
  const stepHead = (container: HTMLElement, step: number) =>
    container.querySelector(`[data-step="${step}"] .step-head`) as HTMLElement;

  it("opens independently — expanding Decisions does not collapse the active step group", () => {
    const { container } = render(<ArtifactsPanel />);
    // Step 4 (challenge ladder) — expand it so Big Idea is visible.
    fireEvent.click(stepHead(container, 4));
    expect(screen.getByText("Big Idea")).toBeTruthy();

    openDecisions();

    // Decisions body is now open AND the Step-4 artifact is still visible.
    expect(container.querySelector(".decisions-body")).toBeTruthy();
    expect(screen.getByText("Big Idea")).toBeTruthy();
  });

  it("preserves one-step-at-a-time among the ten step groups", () => {
    const { container } = render(<ArtifactsPanel />);
    // Open Step 4; only one step body is open at a time.
    fireEvent.click(stepHead(container, 4));
    const stepBodies = container.querySelectorAll(".step-group .step-body");
    expect(stepBodies.length).toBe(1);
  });

  it("expanding a step group does not collapse the Decisions section", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    expect(container.querySelector(".decisions-body")).toBeTruthy();
    fireEvent.click(stepHead(container, 4));
    // Decisions stays open after switching step groups.
    expect(container.querySelector(".decisions-body")).toBeTruthy();
  });
});

describe("Decision artifact population", () => {
  it("Kompetenz Check populates Module Goals with sharpness flags and citations", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    const entry = container.querySelector('[data-entry="module-goals"]')!;
    expect(entry).toBeTruthy();
    const scoped = within(entry as HTMLElement);
    expect(scoped.getByText(/systems-thinking on water flows/)).toBeTruthy();
    // sharp + pending-sharpening flags both present
    expect(entry.querySelector(".sharpness-sharp")).toBeTruthy();
    expect(entry.querySelector(".sharpness-pending-sharpening")).toBeTruthy();
    // citations rendered as tokens
    expect(scoped.getByText(/corpus:foundations-005/)).toBeTruthy();
  });

  it("Alignment Check populates Alignment Status with per-goal flags and a deep-link", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    const entry = container.querySelector('[data-entry="alignment-status"]')!;
    expect(entry.querySelector(".alignment-aligned")).toBeTruthy();
    expect(entry.querySelector(".alignment-flagged")).toBeTruthy();
    // deep-link into the affected phase-side artifact
    const link = entry.querySelector(".decision-deeplink") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("data-target")).toBe("investigate:ar");
  });

  it("Delegation Check populates per-component decisions with reasoning and an inconsistency flag", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    const entry = container.querySelector('[data-entry="delegation-decisions"]')!;
    const scoped = within(entry as HTMLElement);
    expect(scoped.getByText("Essential Question formulation")).toBeTruthy();
    expect(scoped.getByText(/AI may cluster sources/)).toBeTruthy();
    // germane/extraneous inconsistency flag rendered
    expect(entry.querySelector(".decision-flag")).toBeTruthy();
  });

  it("renders corpus citations as bare tokens with no per-citation authority marker", () => {
    // The corpus is purely versioned content: citations carry no `[dev-corpus,
    // non-final]` suffix and no dev-draft marker. The Decisions panel renders the
    // token verbatim and never attaches an authority marker.
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    const moduleGoals = container.querySelector('[data-entry="module-goals"]') as HTMLElement;
    expect(within(moduleGoals).getByText(/corpus:foundations-005/)).toBeTruthy();
    expect(container.querySelectorAll(".dev-draft-marker").length).toBe(0);
  });

  it("Heterogeneity Notes and Soft-Skill Anchors appear when those behaviours fired", () => {
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    const het = container.querySelector('[data-entry="heterogeneity-notes"]')!;
    const soft = container.querySelector('[data-entry="soft-skill-anchors"]')!;
    expect(het).toBeTruthy();
    expect(soft).toBeTruthy();
    // a soft-skill goal without an anchor shows the missing-anchor signal
    expect(soft.querySelector(".anchor-missing")).toBeTruthy();
  });

  it("does NOT render Heterogeneity / Soft-Skill entries when the behaviours did not fire", () => {
    useCbe.setState({
      didacticChecks: {
        ...structuredClone(SAMPLE_DIDACTIC_CHECKS),
        heterogeneity: { fired: false },
        softSkill: { fired: false },
      },
    });
    const { container } = render(<ArtifactsPanel />);
    openDecisions();
    expect(container.querySelector('[data-entry="heterogeneity-notes"]')).toBeNull();
    expect(container.querySelector('[data-entry="soft-skill-anchors"]')).toBeNull();
  });

  it("rehydrates from a sidecar state on resume without recomputing", () => {
    const resumed: DidacticChecks = {
      kompetenz: { status: "completed", goals: [{ id: "rg", text: "Resumed goal", sharpness: "sharp" }] },
      alignment: { status: "completed", findings: [{ goalId: "rg", status: "aligned" }] },
      delegation: { status: "not-started", decisions: [] },
    };
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().hydrateDidacticChecks(resumed));
    openDecisions();
    expect(
      within(container.querySelector('[data-entry="module-goals"]') as HTMLElement).getByText("Resumed goal")
    ).toBeTruthy();
    // prior dev-marked entries are gone because the resumed state did not include them
    expect(container.querySelector('[data-entry="heterogeneity-notes"]')).toBeNull();
  });

  it("goal revision resets downstream entries and signals the invalidation", () => {
    const { container } = render(<ArtifactsPanel />);
    act(() => useCbe.getState().reviseGoal("kompetenz"));
    openDecisions();
    const alignment = container.querySelector('[data-entry="alignment-status"]')!;
    const delegation = container.querySelector('[data-entry="delegation-decisions"]')!;
    // both downstream entries carry the reset badge
    expect(alignment.querySelector(".decision-reset")).toBeTruthy();
    expect(delegation.querySelector(".decision-reset")).toBeTruthy();
    // and their findings/decisions cleared to the reset (not-started) state
    expect(alignment.querySelector(".alignment-flagged")).toBeNull();
  });
});
