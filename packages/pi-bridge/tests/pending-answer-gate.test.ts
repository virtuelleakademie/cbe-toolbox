/**
 * Pending-answer gate (change `harden-canvas-determinism-and-ux2-fixes`, wave B, B2.1).
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces — Scenarios:
 * - Mirroring writes are refused while a picker emitted in the same run is unanswered
 * - The same writes are accepted once the picker answer has arrived
 * - A refusal leaves host and renderer state untouched
 */
import { describe, it, expect } from "vitest";
import { PendingAnswerGate, coherenceGatePassed } from "../src/pending-answer-gate.js";
import { createPickerTool } from "../src/picker-tool.js";
import { createDecisionChecklistTool } from "../src/decision-checklist-tool.js";
import { createCanvasTool } from "../src/canvas-tool.js";
import { createStepTool } from "../src/step-tool.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";

function kindOf(r: { details?: unknown }): string | undefined {
  return (r.details as { kind?: string } | undefined)?.kind;
}
function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content.map((c) => c.text ?? "").join("");
}

function harness() {
  const gate = new PendingAnswerGate();
  const canvasMirror = new CanvasMirror();
  const stepMirror = new StepMirror();
  return {
    gate,
    canvasMirror,
    stepMirror,
    picker: createPickerTool(gate),
    checklist: createDecisionChecklistTool(gate),
    canvas: createCanvasTool(canvasMirror, stepMirror, gate),
    step: createStepTool(stepMirror, gate),
  };
}

const PICKER = {
  question: 'Who represents the "Stakeholder" in your course?',
  options: [
    { id: "lecturer", label: "Lecturer (Product Owner)" },
    { id: "simulated", label: "Simulated persona" },
  ],
};

// Scenario: Mirroring writes are refused while a picker emitted in the same run is unanswered
describe("Mirroring writes are refused while a picker emitted in the same run is unanswered", () => {
  it("refuses a canvas set issued after the picker in the same run", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);

    const res = await h.canvas.execute("c1", { step: 5, id: "stakeholderplan", value: "Lecturer as PO" });

    expect(kindOf(res)).toBe("canvas-refusal");
    expect(textOf(res)).toContain("has not arrived yet");
    expect(h.canvasMirror.list()).toHaveLength(0);
  });

  it("names the outstanding question so the model knows what it is waiting on", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);
    const res = await h.canvas.execute("c1", { step: 5, id: "stakeholderplan", value: "x" });
    expect(textOf(res)).toContain("Stakeholder");
  });

  it("refuses a step depth ADVANCE issued after the picker", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);

    const res = await h.step.execute("s1", { step: 5, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(h.stepMirror.depthOf(5)).toBe("open");
  });

  it("still allows a focus change — navigation asserts no lecturer decision", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);

    const res = await h.step.execute("s1", { step: 6, focus: true });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.focused()).toBe(6);
  });

  it("still allows a depth regression — it removes coverage rather than asserting it", async () => {
    const h = harness();
    await h.step.execute("s0", { step: 4, depth: "rough" });
    await h.picker.execute("p1", PICKER);

    const res = await h.step.execute("s1", { step: 4, depth: "open" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(4)).toBe("open");
  });

  it("the decision checklist opens the same gate", async () => {
    const h = harness();
    await h.checklist.execute("k1", {
      presentation: "checklist",
      items: [
        { id: "a", label: "Item A" },
        { id: "b", label: "Item B" },
      ],
    });

    const res = await h.canvas.execute("c1", { step: 3, id: "assessmentblueprint", value: "x" });

    expect(kindOf(res)).toBe("canvas-refusal");
  });

  it("a canvas clear is NOT gated — it runs on explicit lecturer instruction", async () => {
    const h = harness();
    await h.canvas.execute("c0", { step: 4, id: "bigidea", value: "seeded" });
    await h.picker.execute("p1", PICKER);

    const res = await h.canvas.execute("c1", { step: 4, id: "bigidea", action: "clear" });

    expect(kindOf(res)).toBe("canvas-update");
  });
});

// Scenario: The same writes are accepted once the picker answer has arrived
describe("The same writes are accepted once the picker answer has arrived", () => {
  it("accepts the write in the following run", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);
    await h.canvas.execute("c1", { step: 5, id: "stakeholderplan", value: "premature" });
    expect(h.canvasMirror.list()).toHaveLength(0);

    // The lecturer's answer arrives as the next user turn, which starts a new run.
    h.gate.reset();
    const res = await h.canvas.execute("c2", { step: 5, id: "stakeholderplan", value: "Product Owner in the group" });

    expect(kindOf(res)).toBe("canvas-update");
    expect(h.canvasMirror.list()).toHaveLength(1);
  });

  it("evaluates the other guards normally after the reset", async () => {
    const h = harness();
    await h.picker.execute("p1", PICKER);
    h.gate.reset();

    // The ladder guard still applies — the gate is not a bypass.
    const res = await h.step.execute("s1", { step: 2, depth: "detailed" });
    expect(kindOf(res)).toBe("step-refusal");
  });
});

describe("PendingAnswerGate", () => {
  it("starts closed and reopens on reset", () => {
    const g = new PendingAnswerGate();
    expect(g.hasOutstanding()).toBe(false);
    g.registerEmission("cbe_picker", "Which direction?");
    expect(g.hasOutstanding()).toBe(true);
    expect(g.outstandingQuestion()).toBe("Which direction?");
    g.reset();
    expect(g.hasOutstanding()).toBe(false);
    expect(g.outstandingQuestion()).toBeNull();
  });

  it("bounds the remembered question text", () => {
    const g = new PendingAnswerGate();
    g.registerEmission("cbe_picker", "x".repeat(500));
    expect(g.outstandingQuestion()!.length).toBeLessThanOrEqual(160);
  });
});

/**
 * Outstanding-surface notice (tasks B3.1 and B6.5), as STAGED by the change
 * `stage-the-maturity-reading-behind-the-coherence-gate`.
 *
 * capability `agent-harness`, Requirement: The Maturity Demands Are Staged Across the
 * Session — Scenarios: *No achieved reading is demanded before the coherence gate*;
 * *The reading is demanded once the gate is passed*; *Progress does not repeat the
 * demand*.
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement…
 * — Scenarios: *An unfed host surface is named back on every accepted mirroring result*
 * (now: once the gate is passed); *The notice disappears once the surface is fed*.
 *
 * The TARGET half of this notice is gone: the demand reaches a session through the
 * environment descriptor from turn 1 instead (see `retained-state-injection.test.ts`,
 * *A cold session carries the target demand before anything is mirrored*). Riding the
 * per-write channel meant it never fired in the session that settles the target and
 * fired on every write in the sessions that do not.
 */
describe("outstanding-surface notice", () => {
  /**
   * `achieved` defaults to "a non-empty mirror carries a reading", which is what every
   * fixture written before 2026-08-10 meant by it. The target-only mirror — non-empty,
   * no reading — is the case that defaulting cannot express, and it is the one the
   * notice was blind to; it is stated explicitly as `fed(false, true, false)`.
   */
  const fed = (empty: boolean, target: boolean, achieved = !empty) => ({
    isEmpty: () => empty,
    hasTarget: () => target,
    hasAchievedReading: () => achieved,
  });

  /** `settled` — the steps recorded off `open`, i.e. how far the gate is from passing. */
  function toolsWith(
    maturity: { isEmpty(): boolean; hasTarget(): boolean; hasAchievedReading(): boolean },
    affordance = true,
    settled: number[] = [1, 2, 3]
  ) {
    const stepMirror = new StepMirror();
    for (const step of settled) stepMirror.applyUpdate(step, { depth: "rough" });
    const surfaces = {
      maturity,
      maturityAffordance: affordance,
      get coherenceGate() {
        return coherenceGatePassed(stepMirror);
      },
    };
    return {
      stepMirror,
      canvas: createCanvasTool(new CanvasMirror(), stepMirror, undefined, surfaces),
      step: createStepTool(stepMirror, undefined, surfaces),
    };
  }

  // Scenario: The reading is demanded once the gate is passed
  it("names an unestablished maturity reading on an accepted canvas result", async () => {
    const t = toolsWith(fed(true, false));
    const res = await t.canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).toContain("[outstanding]");
    expect(textOf(res)).toContain("no achieved maturity reading has been recorded");
  });

  // Scenario: A recorded target does not pass for a reading.
  // REGRESSION 2026-08-10: the notice measured `isEmpty()`, so the one record the
  // opening puts there (the elicited target ambition) silenced it for good. The first
  // live run of the staging hit exactly this: S14b carries `overall.target: 2`, step 3
  // was settled, and the accepted result came back with no notice at all. An ambition
  // is not a reading — the same distinction `governingStaleness` already makes.
  it("does not let a recorded target pass for a reading", async () => {
    const t = toolsWith(fed(false, true, false));
    const res = await t.step.execute("s1", { step: 4, depth: "rough" });
    expect(kindOf(res)).toBe("step-update");
    expect(textOf(res)).toContain("[outstanding]");
    expect(textOf(res)).toContain("no achieved maturity reading has been recorded");
    // …and the notice says why the non-empty panel is still unread, so the model does
    // not answer it by re-recording the ambition.
    expect(textOf(res)).toContain("a recorded target ambition is not a reading");
  });

  it("repeats on every accepted mirroring result until fed", async () => {
    const t = toolsWith(fed(true, false));
    const a = await t.canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    const b = await t.step.execute("s1", { step: 4, depth: "rough" });
    expect(textOf(a)).toContain("[outstanding]");
    expect(textOf(b)).toContain("[outstanding]");
  });

  // Scenario: No achieved reading is demanded before the coherence gate
  it("reports no outstanding maturity reading while step 3 is not settled", async () => {
    const t = toolsWith(fed(true, false), true, [1, 2]);
    const a = await t.canvas.execute("c1", { step: 2, id: "learningoutcomes", value: "x" });
    const b = await t.step.execute("s1", { step: 2, depth: "refined" });
    expect(kindOf(a)).toBe("canvas-update");
    expect(textOf(a)).not.toContain("[outstanding]");
    expect(textOf(b)).not.toContain("[outstanding]");
  });

  // Scenario: The reading is demanded once the gate is passed — the very call that
  // settles step 3 already carries the demand, because the depth is applied first.
  it("starts demanding the reading with the call that settles step 3", async () => {
    const t = toolsWith(fed(true, false), true, [1, 2]);
    const res = await t.step.execute("s1", { step: 3, depth: "rough" });
    expect(kindOf(res)).toBe("step-update");
    expect(textOf(res)).toContain("[outstanding]");
    expect(textOf(res)).toContain("Steps 1 to 3 are settled");
  });

  // Scenario: Progress does not repeat the demand — a pre-gate session with the target
  // on record and no reading yet (the S14 fixture) accepts write after write and is
  // nudged by none of them.
  it("appends no maturity demand to accepted writes before the gate", async () => {
    const t = toolsWith(fed(false, true, false), true, [1]);
    const a = await t.canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    const b = await t.canvas.execute("c2", { step: 4, id: "eq", value: "y" });
    const c = await t.step.execute("s1", { step: 4, depth: "rough" });
    for (const res of [a, b, c]) expect(textOf(res)).not.toContain("[outstanding]");
    // …while the addressed step's own slot echo is untouched by any of this.
    expect(textOf(a)).toContain("[step 4] still open");
  });

  // Scenario: The notice disappears once the surface is fed
  it("carries no notice once a reading is recorded", async () => {
    const t = toolsWith(fed(false, true));
    const res = await t.canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    expect(textOf(res)).not.toContain("[outstanding]");
  });

  // The target demand left this channel: a raster without a target is no longer named
  // back on a write, because the descriptor asks for it at the session's start.
  it("does not name a missing target on an accepted write", async () => {
    const t = toolsWith(fed(false, false));
    const res = await t.step.execute("s1", { step: 4, depth: "rough" });
    expect(textOf(res)).not.toContain("[outstanding]");
    expect(textOf(res)).not.toContain("no target level");
  });

  it("stays silent when the maturity affordance is absent", async () => {
    const t = toolsWith(fed(true, false), false);
    const res = await t.canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    expect(textOf(res)).not.toContain("[outstanding]");
  });

  it("does not attach to a refusal", async () => {
    const t = toolsWith(fed(true, false));
    const res = await t.step.execute("s1", { step: 4, depth: "detailed" }); // two-rung jump
    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).not.toContain("[outstanding]");
  });
});

/**
 * The gate itself (capability `agent-harness`, Requirement: The Maturity Demands Are
 * Staged Across the Session). "Settled" is the EXISTING step depth read off the
 * EXISTING mirror — off `open` — and not a second notion of coverage.
 */
describe("coherence gate after step 3", () => {
  it("is not passed while any of steps 1 to 3 is still open", () => {
    const m = new StepMirror();
    expect(coherenceGatePassed(m)).toBe(false);
    m.applyUpdate(1, { depth: "detailed" });
    m.applyUpdate(2, { depth: "refined" });
    expect(coherenceGatePassed(m)).toBe(false);
  });

  it("is passed once each of steps 1 to 3 carries a depth off open", () => {
    const m = new StepMirror();
    for (const step of [1, 2, 3]) m.applyUpdate(step, { depth: "rough" });
    expect(coherenceGatePassed(m)).toBe(true);
  });

  it("closes again when a step regresses to open", () => {
    const m = new StepMirror();
    for (const step of [1, 2, 3]) m.applyUpdate(step, { depth: "rough" });
    m.applyUpdate(2, { depth: "open" });
    expect(coherenceGatePassed(m)).toBe(false);
  });

  it("is not passed by later steps alone, and not passed without a mirror", () => {
    const m = new StepMirror();
    for (const step of [4, 5, 9]) m.applyUpdate(step, { depth: "detailed" });
    expect(coherenceGatePassed(m)).toBe(false);
    expect(coherenceGatePassed(undefined)).toBe(false);
  });
});
