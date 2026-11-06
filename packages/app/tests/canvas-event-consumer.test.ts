/**
 * Tests for the cbe_canvas / cbe_step tool-event consumers (`applyCanvasFromToolResult`,
 * `applyStepFromToolResult`), which the ChatPanel calls on `tool_execution_end`. They read
 * the VALIDATED tool result `details` (not raw call args), so the live Canvas / step headers
 * mirror exactly what Pi accepted.
 *
 * Capability `desktop-app`, Requirement: Live Canvas Population from Skill Tool-Calls /
 * Design-Flow Canvas.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyCanvasFromToolResult, applyStepFromToolResult } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import type { StepId } from "../src/renderer/mocks/artifacts.js";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";

function canvasResult(details: Record<string, unknown>) {
  return { content: [{ type: "text", text: "ok" }], details };
}
function findAt(step: StepId, id: string, phase?: JourneyPhase) {
  const g = useCbe.getState().artifacts.find((sg) => sg.step === step)!;
  const container = phase ? g.journey!.find((el) => el.phase === phase)!.items : g.items;
  return container.find((it) => it.id === id);
}
function snapshot() {
  return JSON.stringify(useCbe.getState().artifacts);
}

beforeEach(() => useCbe.getState().reset());

describe("applyCanvasFromToolResult", () => {
  it("applies a valid step-keyed canvas-update result to the store", () => {
    applyCanvasFromToolResult(
      canvasResult({
        kind: "canvas-update",
        action: "set",
        step: 4,
        id: "bigidea",
        value: "Water resilience",
        state: "done",
      }),
      false
    );
    expect(findAt(4, "bigidea")?.value).toBe("Water resilience");
    expect(findAt(4, "bigidea")?.state).toBe("done");
  });

  it("applies a resolved Step-6 journey result", () => {
    applyCanvasFromToolResult(
      canvasResult({
        kind: "canvas-update",
        action: "set",
        step: 6,
        phase: "reflect",
        id: "showcase",
        value: "Pitch.",
      }),
      false
    );
    expect(findAt(6, "showcase", "reflect")?.value).toBe("Pitch.");
  });

  it("is a no-op when the call errored (isError)", () => {
    const before = snapshot();
    applyCanvasFromToolResult(canvasResult({ kind: "canvas-update", step: 4, id: "bigidea", value: "X" }), true);
    expect(snapshot()).toBe(before);
  });

  it("ignores a non-canvas-update result (e.g. a canvas-refusal)", () => {
    const before = snapshot();
    applyCanvasFromToolResult(canvasResult({ kind: "canvas-refusal" }), false);
    expect(snapshot()).toBe(before);
  });

  it("drops an out-of-union state instead of corrupting the row", () => {
    applyCanvasFromToolResult(
      canvasResult({ kind: "canvas-update", step: 4, id: "bigidea", value: "X", state: "complete" }),
      false
    );
    expect(findAt(4, "bigidea")?.value).toBe("X");
    expect(["done", "active", "draft", "open"]).toContain(findAt(4, "bigidea")?.state);
  });

  it("is a no-op for a whitespace-only value (matches the tool's own trim guard)", () => {
    const before = snapshot();
    applyCanvasFromToolResult(canvasResult({ kind: "canvas-update", step: 4, id: "bigidea", value: "   " }), false);
    expect(snapshot()).toBe(before);
  });

  it("ignores malformed payloads and missing step without crashing", () => {
    const before = snapshot();
    applyCanvasFromToolResult(null, false);
    applyCanvasFromToolResult({}, false);
    applyCanvasFromToolResult(canvasResult({ kind: "canvas-update", id: "x", value: "v" }), false); // no step
    expect(snapshot()).toBe(before);
  });

  it("applies a clear-action result by reverting the seeded artefact (no value required)", () => {
    applyCanvasFromToolResult(
      canvasResult({ kind: "canvas-update", action: "set", step: 4, id: "bigidea", value: "Resilience" }),
      false
    );
    expect(findAt(4, "bigidea")?.value).toBe("Resilience");
    applyCanvasFromToolResult(canvasResult({ kind: "canvas-update", action: "clear", step: 4, id: "bigidea" }), false);
    expect(findAt(4, "bigidea")?.value).toBe("");
    expect(findAt(4, "bigidea")?.state).toBe("open");
  });
});

describe("applyStepFromToolResult", () => {
  function cov(step: StepId) {
    return useCbe.getState().steps.find((s) => s.step === step)!;
  }
  function stepResult(details: Record<string, unknown>) {
    return { content: [{ type: "text", text: "ok" }], details };
  }

  it("applies a valid step-update (depth) to the store", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 3, depth: "rough" }), false);
    expect(cov(3).depth).toBe("rough");
  });

  it("applies an exclusive focus transition", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 2, focus: true }), false);
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 5, focus: true }), false);
    expect(cov(5).focus).toBe(true);
    expect(cov(2).focus).toBe(false);
  });

  it("does NOT render the note field (transport-only)", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 3, depth: "rough", note: "secret" }), false);
    // The note is not stored on the coverage slice — only depth/focus.
    expect(JSON.stringify(cov(3))).not.toContain("secret");
  });

  it("is a no-op on error / refusal / missing step / unknown depth", () => {
    const before = JSON.stringify(useCbe.getState().steps);
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 3, depth: "rough" }), true); // error
    applyStepFromToolResult(stepResult({ kind: "step-refusal" }), false);
    applyStepFromToolResult(stepResult({ kind: "step-update", depth: "rough" }), false); // no step
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 3, depth: "deep" }), false); // unknown depth, no focus
    expect(JSON.stringify(useCbe.getState().steps)).toBe(before);
  });

  /**
   * A DEPTH refusal still carries the navigation half (change
   * `fix-ux3-wave2-orientation`). capability `agent-harness`, Requirement:
   * Deterministic Tool-Boundary Enforcement… — Scenarios: *A refused depth still
   * moves the focus to the addressed step*, *A structurally invalid step payload
   * changes nothing at all*.
   */
  it("applies the focus a refused depth carried, and nothing else", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 2, focus: true }), false);

    applyStepFromToolResult(stepResult({ kind: "step-refusal", focusStep: 5 }), false);

    expect(cov(5).focus).toBe(true);
    expect(cov(2).focus).toBe(false);
    expect(cov(5).depth).toBe("open"); // the refused depth did NOT travel
  });

  it("ignores a focus-carrying refusal that arrives as an error", () => {
    const before = JSON.stringify(useCbe.getState().steps);
    applyStepFromToolResult(stepResult({ kind: "step-refusal", focusStep: 5 }), true);
    expect(JSON.stringify(useCbe.getState().steps)).toBe(before);
  });

  it("ignores a refusal whose focusStep is out of range or malformed", () => {
    const before = JSON.stringify(useCbe.getState().steps);
    applyStepFromToolResult(stepResult({ kind: "step-refusal", focusStep: 14 }), false);
    applyStepFromToolResult(stepResult({ kind: "step-refusal", focusStep: "5" }), false);
    expect(JSON.stringify(useCbe.getState().steps)).toBe(before);
  });
});

/**
 * Host-derived step focus riding on the canvas result (change
 * `harden-canvas-determinism-and-ux2-fixes`, wave B, task B1.1).
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces — Scenario: *An accepted canvas write
 * moves the step focus to that step*. The derivation itself lives host-side; the
 * renderer applies exactly the transition the host reported rather than re-deriving it.
 */
describe("An accepted canvas write moves the step focus to that step (renderer half)", () => {
  const stepResult = (details: Record<string, unknown>) => ({ content: [{ type: "text", text: "ok" }], details });

  it("applies the host-derived focus and keeps it exclusive", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 1, focus: true }), false);
    expect(useCbe.getState().steps.find((s) => s.step === 1)?.focus).toBe(true);

    applyCanvasFromToolResult(
      canvasResult({ kind: "canvas-update", action: "set", step: 4, id: "bigidea", value: "X", focusStep: 4 }),
      false
    );

    const steps = useCbe.getState().steps;
    expect(steps.find((s) => s.step === 4)?.focus).toBe(true);
    expect(steps.find((s) => s.step === 1)?.focus).toBe(false);
    expect(steps.filter((s) => s.focus)).toHaveLength(1);
  });

  it("does not touch step depths", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 2, depth: "rough" }), false);

    applyCanvasFromToolResult(
      canvasResult({ kind: "canvas-update", action: "set", step: 4, id: "bigidea", value: "X", focusStep: 4 }),
      false
    );

    // The 2026-08-03 investigation proved focus changes never clear an earlier
    // depth; deriving focus must not regress that property.
    expect(useCbe.getState().steps.find((s) => s.step === 2)?.depth).toBe("rough");
    expect(useCbe.getState().steps.find((s) => s.step === 4)?.depth).toBe("open");
  });

  it("a canvas result without focusStep leaves focus alone", () => {
    applyStepFromToolResult(stepResult({ kind: "step-update", step: 3, focus: true }), false);

    applyCanvasFromToolResult(
      canvasResult({ kind: "canvas-update", action: "set", step: 4, id: "bigidea", value: "X" }),
      false
    );

    expect(useCbe.getState().steps.find((s) => s.step === 3)?.focus).toBe(true);
  });
});
