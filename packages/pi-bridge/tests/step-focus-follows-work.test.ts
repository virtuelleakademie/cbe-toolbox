/**
 * Step focus follows the work (change `fix-ux3-wave2-orientation`, Finding 1 of the
 * UX-3 test run 2026-08-05: "er hat die Fokus Pille nicht auf dem neuen Step aktiviert.
 * Sie läuft immer noch auf dem alten").
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces — Scenarios:
 * - A depth push without an explicit focus moves the focus to that step
 * - An explicit focus in the payload wins over the derivation
 * - A refused but ladder-legal depth still moves the focus to the addressed step
 * - A refused depth of more than one rung leaves the focus where it was
 * - An explicit focus travels through a multi-rung refusal
 * - A structurally invalid step payload changes nothing at all
 */
import { describe, it, expect } from "vitest";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";
import { createStepTool } from "../src/step-tool.js";
import { PendingAnswerGate } from "../src/pending-answer-gate.js";
import { createPickerTool } from "../src/picker-tool.js";

function kindOf(r: { details?: unknown }): string | undefined {
  return (r.details as { kind?: string } | undefined)?.kind;
}
function focusStepOf(r: { details?: unknown }): number | undefined {
  return (r.details as { focusStep?: number } | undefined)?.focusStep;
}
function detailFocusOf(r: { details?: unknown }): boolean | undefined {
  return (r.details as { focus?: boolean } | undefined)?.focus;
}
function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content.map((c) => c.text ?? "").join("");
}

function harness() {
  const canvasMirror = new CanvasMirror();
  const stepMirror = new StepMirror();
  const gate = new PendingAnswerGate();
  return {
    canvasMirror,
    stepMirror,
    gate,
    picker: createPickerTool(gate),
    step: createStepTool(stepMirror, gate, undefined, canvasMirror),
  };
}

/** Fill one canonical slot directly through the mirror (as an accepted write would),
 * so the slot guards do not refuse a depth we are not testing. */
function fill(m: CanvasMirror, step: number, id: string, value = "content") {
  m.applySet({ step, id, value, state: "draft" });
}

// Scenario: A depth push without an explicit focus moves the focus to that step
describe("A depth push without an explicit focus moves the focus to that step", () => {
  it("derives focus onto the pushed step and takes it off the previous one", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 1, focus: true });
    fill(h.canvasMirror, 5, "stakeholderplan");

    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(5)).toBe("rough");
    expect(h.stepMirror.focused()).toBe(5);
  });

  it("reports the derived focus in the result details so the renderer applies it", async () => {
    const h = harness();
    fill(h.canvasMirror, 5, "stakeholderplan");

    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(detailFocusOf(res)).toBe(true);
    expect(textOf(res)).toContain("focus true");
  });

  it("keeps focus exclusive — at most one step is focused afterwards", async () => {
    const h = harness();
    fill(h.canvasMirror, 5, "stakeholderplan");
    fill(h.canvasMirror, 7, "activityplan");

    await h.step.execute("s1", { step: 5, depth: "rough" });
    await h.step.execute("s2", { step: 7, depth: "rough" });

    expect(h.stepMirror.list().filter((e) => e.focus)).toHaveLength(1);
    expect(h.stepMirror.focused()).toBe(7);
  });

  it("derives focus on a depth REGRESSION too — reopening an output is also working there", async () => {
    const h = harness();
    fill(h.canvasMirror, 3, "assessmentblueprint");
    await h.step.execute("s1", { step: 3, depth: "rough" });
    await h.step.execute("s2", { step: 1, focus: true });

    const res = await h.step.execute("s3", { step: 3, depth: "open" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.focused()).toBe(3);
  });
});

// Scenario: An explicit focus in the payload wins over the derivation
describe("An explicit focus in the payload wins over the derivation", () => {
  it("does not steal focus when the payload says focus: false", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 1, focus: true });
    fill(h.canvasMirror, 5, "stakeholderplan");

    const res = await h.step.execute("s1", { step: 5, depth: "rough", focus: false });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(5)).toBe("rough");
    expect(h.stepMirror.focused()).toBe(1);
  });

  it("still honours an explicit focus: true alongside a depth", async () => {
    const h = harness();
    fill(h.canvasMirror, 5, "stakeholderplan");

    await h.step.execute("s1", { step: 5, depth: "rough", focus: true });

    expect(h.stepMirror.focused()).toBe(5);
  });

  it("leaves a focus-only call working exactly as before", async () => {
    const h = harness();

    const res = await h.step.execute("s1", { step: 8, focus: true });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.focused()).toBe(8);
    expect(h.stepMirror.depthOf(8)).toBe("open");
  });
});

// Scenario: A refused but ladder-legal depth still moves the focus to the addressed step
describe("A refused but ladder-legal depth still moves the focus to the addressed step", () => {
  it("moves focus to the skipped-to step when the empty-slot guard refuses the depth", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 2, focus: true });

    // The lecturer skips ahead to step 5; its canonical slots are still empty.
    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(5)).toBe("open");
    expect(h.stepMirror.focused()).toBe(5);
  });

  it("names both the refused depth and the applied focus in the refusal text", async () => {
    const h = harness();

    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(textOf(res)).toContain("no recorded output yet");
    expect(textOf(res)).toContain("Step 5 is now the step in focus");
  });

  it("carries the focused step in the refusal details so the renderer applies it", async () => {
    const h = harness();

    const res = await h.step.execute("s1", { step: 5, depth: "rough", focus: true });

    expect(kindOf(res)).toBe("step-refusal");
    expect(focusStepOf(res)).toBe(5);
  });

  it("applies the focus when the empty-slot guard refuses a one-rung request", async () => {
    // The 2026-08-04 session: step 2 sits at `open` with no canvas output; the model
    // pushes the legal next rung, the slot guard refuses it — and the work IS there.
    const h = harness();
    await h.step.execute("s0", { step: 7, focus: true });

    const res = await h.step.execute("s1", { step: 2, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(2)).toBe("open");
    expect(h.stepMirror.focused()).toBe(2);
    expect(focusStepOf(res)).toBe(2);
  });

  it("applies the focus when the close gate refuses the depth", async () => {
    const h = harness();
    fill(h.canvasMirror, 4, "bigidea");
    await h.step.execute("s1", { step: 4, depth: "rough" });
    await h.step.execute("s2", { step: 4, depth: "refined" });
    await h.step.execute("s3", { step: 1, focus: true });

    // `eq` and `challenge` are still empty, so the close is refused.
    const res = await h.step.execute("s4", { step: 4, depth: "detailed" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(4)).toBe("refined");
    expect(h.stepMirror.focused()).toBe(4);
  });

  it("applies the focus when the pending-answer gate refuses the depth advance", async () => {
    const h = harness();
    fill(h.canvasMirror, 5, "stakeholderplan");
    await h.step.execute("s0", { step: 1, focus: true });
    await h.picker.execute("p1", {
      question: "Who represents the stakeholder?",
      options: [
        { id: "lecturer", label: "Lecturer" },
        { id: "simulated", label: "Simulated persona" },
      ],
    });

    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(5)).toBe("open");
    expect(h.stepMirror.focused()).toBe(5);
  });

  it("drops an explicit focus: false with the refused depth — nothing to preserve", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 2, focus: true });

    const res = await h.step.execute("s1", { step: 5, depth: "rough", focus: false });

    expect(kindOf(res)).toBe("step-refusal");
    expect(focusStepOf(res)).toBeUndefined();
    expect(h.stepMirror.focused()).toBe(2);
  });

  it("leaves the canvas mirror untouched — only the step focus travels", async () => {
    const h = harness();

    await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(h.canvasMirror.list()).toHaveLength(0);
  });
});

// Scenario: A refused depth of more than one rung leaves the focus where it was
//
// The REAL bookkeeping sweep from `materialien/Chat_log.jsonl` (2026-08-03): after focus
// was explicitly set to step 9, the model closes out six steps it is not working on, in
// one turn, with depth-only pushes. Every one is a multi-rung claim the host refuses —
// so none of them may drag the lecturer's pill along.
describe("A refused depth of more than one rung leaves the focus where it was", () => {
  /** The state the recorded session had reached when the sweep starts. */
  function sweepHarness() {
    const h = harness();
    h.stepMirror.seed([
      { step: 1, depth: "rough", focus: false },
      { step: 2, depth: "rough", focus: false },
      { step: 3, depth: "rough", focus: false },
      { step: 5, depth: "rough", focus: false },
      { step: 6, depth: "rough", focus: false },
      { step: 9, depth: "detailed", focus: true },
      { step: 10, depth: "open", focus: false },
    ]);
    // Steps 1, 2, 3, 5 had produced their named output by then — the sweep is refused on
    // the LADDER, not for want of content, which is the case the narrowing must catch.
    fill(h.canvasMirror, 1, "moduleframe");
    fill(h.canvasMirror, 2, "learningoutcomes");
    fill(h.canvasMirror, 3, "assessmentblueprint");
    fill(h.canvasMirror, 5, "stakeholderplan");
    return h;
  }

  const SWEEP: readonly number[] = [1, 2, 3, 5, 6, 10];

  it("refuses every call of the recorded sweep and leaves the focus on step 9", async () => {
    const h = sweepHarness();

    const results = [];
    for (const step of SWEEP) {
      results.push(await h.step.execute(`sweep-${step}`, { step, depth: "detailed" }));
    }

    expect(results.map(kindOf)).toEqual(SWEEP.map(() => "step-refusal"));
    expect(results.map(focusStepOf)).toEqual(SWEEP.map(() => undefined));
    // No depth moved…
    expect(SWEEP.map((s) => h.stepMirror.depthOf(s))).toEqual(["rough", "rough", "rough", "rough", "rough", "open"]);
    // …and the pill neither walked through 1,2,3,5,6 nor landed on 10.
    expect(h.stepMirror.focused()).toBe(9);
  });

  it("does not report an applied focus in the refusal text of a swept step", async () => {
    const h = sweepHarness();

    const res = await h.step.execute("sweep-10", { step: 10, depth: "detailed" });

    expect(textOf(res)).not.toContain("is now the step in focus");
  });

  it("drops the derived focus of a multi-rung request refused by the empty-slot guard", async () => {
    // Step 10 goes `open` → `detailed`: the empty-slot guard fires BEFORE the ladder
    // guard, so the plausibility test must be the rung distance, not the firing guard.
    const h = harness();
    await h.step.execute("s0", { step: 9, focus: true });

    const res = await h.step.execute("s1", { step: 10, depth: "detailed" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain("no recorded output yet");
    expect(h.stepMirror.focused()).toBe(9);
  });
});

// Scenario: An explicit focus travels through a multi-rung refusal
describe("An explicit focus travels through a multi-rung refusal", () => {
  it("moves the focus when the model states it alongside a refused multi-rung depth", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 9, focus: true });

    const res = await h.step.execute("s1", { step: 10, depth: "detailed", focus: true });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(10)).toBe("open");
    expect(h.stepMirror.focused()).toBe(10);
    expect(focusStepOf(res)).toBe(10);
  });
});

// Scenario: A structurally invalid step payload changes nothing at all
describe("A structurally invalid step payload changes nothing at all", () => {
  it("changes nothing for an out-of-range step", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 2, focus: true });

    const res = await h.step.execute("s1", { step: 14, depth: "rough" } as never);

    expect(kindOf(res)).toBe("step-refusal");
    expect(focusStepOf(res)).toBeUndefined();
    expect(h.stepMirror.focused()).toBe(2);
  });

  it("changes nothing when neither depth nor focus is present", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 2, focus: true });

    const res = await h.step.execute("s1", { step: 5 } as never);

    expect(kindOf(res)).toBe("step-refusal");
    expect(focusStepOf(res)).toBeUndefined();
    expect(h.stepMirror.focused()).toBe(2);
    expect(h.stepMirror.depthOf(5)).toBe("open");
  });

  it("changes nothing for an unknown depth value", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 2, focus: true });

    const res = await h.step.execute("s1", { step: 5, depth: "polished" } as never);

    expect(kindOf(res)).toBe("step-refusal");
    expect(focusStepOf(res)).toBeUndefined();
    expect(h.stepMirror.focused()).toBe(2);
  });
});
