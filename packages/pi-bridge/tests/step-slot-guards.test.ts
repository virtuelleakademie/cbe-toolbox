/**
 * Slot-based step guards and the outstanding-slot echo (change
 * `harden-canvas-determinism-and-ux2-fixes`, wave B, tasks B1.3/B1.4/B1.5 — the three
 * that needed wave A's canonical slot table).
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces — Scenarios:
 * - A depth above open is refused while the step's seeded slots are all empty
 * - A step close is refused while a seeded slot of that step is still empty
 * - An accepted step or canvas result reports the addressed step's outstanding slots
 * - A refusal leaves host and renderer state untouched
 */
import { describe, it, expect } from "vitest";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";
import { createStepTool } from "../src/step-tool.js";
import { createCanvasTool } from "../src/canvas-tool.js";
import { stepCanonicalSlots } from "../src/canvas-addressing.js";

function kindOf(r: { details?: unknown }): string | undefined {
  return (r.details as { kind?: string } | undefined)?.kind;
}
function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content.map((c) => c.text ?? "").join("");
}

function harness() {
  const canvasMirror = new CanvasMirror();
  const stepMirror = new StepMirror();
  return {
    canvasMirror,
    stepMirror,
    step: createStepTool(stepMirror, undefined, undefined, canvasMirror),
    canvas: createCanvasTool(canvasMirror, stepMirror),
  };
}

/** Fill one canonical slot directly through the mirror (as an accepted write would). */
function fill(m: CanvasMirror, step: number, id: string, value = "content") {
  m.applySet({ step, id, value, state: "draft" });
}

/** Fill one canonical slot of a step-6 journey element. */
function fillJourney(m: CanvasMirror, phase: "engage" | "investigate" | "act" | "reflect", id: string) {
  m.applySet({ step: 6, phase, id, value: "content", state: "draft" });
}

// Scenario: A depth above open is refused while the step's seeded slots are all empty
describe("A depth above open is refused while the step's seeded slots are all empty", () => {
  it("refuses `rough` on a step with no recorded output and names the slot", async () => {
    const h = harness();
    const res = await h.step.execute("s1", { step: 10, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain("no recorded output yet");
    expect(textOf(res)).toContain("readinesschecklist");
    expect(h.stepMirror.depthOf(10)).toBe("open");
  });

  it("accepts the same call once the step's output exists", async () => {
    const h = harness();
    fill(h.canvasMirror, 10, "readinesschecklist");

    const res = await h.step.execute("s1", { step: 10, depth: "rough" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(10)).toBe("rough");
  });

  it("never blocks a move back to open", async () => {
    const h = harness();
    fill(h.canvasMirror, 2, "learningoutcomes");
    await h.step.execute("s1", { step: 2, depth: "rough" });
    h.canvasMirror.applyClear({ step: 2 }, "learningoutcomes");

    const res = await h.step.execute("s2", { step: 2, depth: "open" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(2)).toBe("open");
  });

  it("has nothing to enforce for a step whose containers seed nothing", () => {
    // The guard's total-function property, kept after every step 1..10 gained slots: a
    // step the table knows nothing about yields no slots, so the `slots.length > 0`
    // branch stays inert instead of blocking a step it cannot reason about.
    expect(stepCanonicalSlots(99)).toEqual([]);
  });
});

// Scenario: A step-6 depth above open is refused while all four journey elements are empty
describe("A step-6 depth above open is refused while all four journey elements are empty", () => {
  it("refuses `rough` on an empty step 6 and names the slots with their journey element", async () => {
    const h = harness();

    const res = await h.step.execute("s1", { step: 6, depth: "rough" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain("no recorded output yet");
    expect(textOf(res)).toContain("engage/es");
    expect(textOf(res)).toContain("reflect/rs");
    expect(h.stepMirror.depthOf(6)).toBe("open");
  });
});

// Scenario: A step-6 depth advance is accepted once one journey slot is filled
describe("A step-6 depth advance is accepted once one journey slot is filled", () => {
  it("accepts `rough` on step 6 once an investigate slot carries content", async () => {
    const h = harness();
    fillJourney(h.canvasMirror, "investigate", "is");

    const res = await h.step.execute("s1", { step: 6, depth: "rough" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(6)).toBe("rough");
  });
});

// Scenario: A step-6 close is refused while another journey element's slot is still empty
describe("A step-6 close is refused while another journey element's slot is still empty", () => {
  it("refuses `detailed` while engage and reflect are empty, naming the blockers by element", async () => {
    const h = harness();
    fillJourney(h.canvasMirror, "investigate", "is");
    fillJourney(h.canvasMirror, "act", "as");
    await h.step.execute("s1", { step: 6, depth: "rough" });
    await h.step.execute("s2", { step: 6, depth: "refined" });

    const res = await h.step.execute("s3", { step: 6, depth: "detailed" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain("cannot be closed");
    expect(textOf(res)).toContain("engage/es");
    expect(textOf(res)).toContain("reflect/rs");
    expect(textOf(res)).not.toContain("investigate/is");
    expect(h.stepMirror.depthOf(6)).toBe("refined");
  });

  it("accepts the close once every slot of all four elements carries content", async () => {
    const h = harness();
    fillJourney(h.canvasMirror, "engage", "es");
    fillJourney(h.canvasMirror, "investigate", "is");
    fillJourney(h.canvasMirror, "act", "as");
    fillJourney(h.canvasMirror, "reflect", "rs");
    await h.step.execute("s1", { step: 6, depth: "rough" });
    await h.step.execute("s2", { step: 6, depth: "refined" });

    const res = await h.step.execute("s3", { step: 6, depth: "detailed" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(6)).toBe("detailed");
  });
});

// Scenario: A step close is refused while a seeded slot of that step is still empty
describe("A step close is refused while a seeded slot of that step is still empty", () => {
  it("refuses `detailed` on step 4 while the challenge slot is empty, naming the blocker", async () => {
    const h = harness();
    fill(h.canvasMirror, 4, "bigidea");
    fill(h.canvasMirror, 4, "eq");
    await h.step.execute("s1", { step: 4, depth: "rough" });
    await h.step.execute("s2", { step: 4, depth: "refined" });

    const res = await h.step.execute("s3", { step: 4, depth: "detailed" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain("cannot be closed");
    expect(textOf(res)).toContain("challenge");
    expect(h.stepMirror.depthOf(4)).toBe("refined");
  });

  it("accepts the close once every slot carries content", async () => {
    const h = harness();
    for (const id of ["bigidea", "eq", "challenge"]) fill(h.canvasMirror, 4, id);
    await h.step.execute("s1", { step: 4, depth: "rough" });
    await h.step.execute("s2", { step: 4, depth: "refined" });

    const res = await h.step.execute("s3", { step: 4, depth: "detailed" });

    expect(kindOf(res)).toBe("step-update");
    expect(h.stepMirror.depthOf(4)).toBe("detailed");
  });

  it("treats a blank value as an empty slot", async () => {
    const h = harness();
    fill(h.canvasMirror, 4, "bigidea");
    fill(h.canvasMirror, 4, "eq");
    fill(h.canvasMirror, 4, "challenge", "   ");
    await h.step.execute("s1", { step: 4, depth: "rough" });
    await h.step.execute("s2", { step: 4, depth: "refined" });

    const res = await h.step.execute("s3", { step: 4, depth: "detailed" });
    expect(kindOf(res)).toBe("step-refusal");
  });

  it("leaves the mirror untouched on a refused close", async () => {
    const h = harness();
    fill(h.canvasMirror, 4, "bigidea");
    await h.step.execute("s1", { step: 4, depth: "rough" });
    const before = JSON.stringify(h.stepMirror.list());

    await h.step.execute("s2", { step: 4, depth: "detailed" });

    expect(JSON.stringify(h.stepMirror.list())).toBe(before);
  });
});

// Scenario: An accepted step or canvas result reports the addressed step's outstanding slots
describe("An accepted step or canvas result reports the addressed step's outstanding slots", () => {
  it("echoes what step 4 still owes on an accepted canvas write", async () => {
    const h = harness();
    const res = await h.canvas.execute("c1", { step: 4, id: "bigidea", value: "Git in the times of AI" });

    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).toContain("[step 4] still open:");
    expect(textOf(res)).toContain("eq");
    expect(textOf(res)).toContain("challenge");
    // The slot just written is NOT listed as outstanding. (The trailing "(of …)"
    // deliberately names every canonical slot, so assert on the outstanding list only.)
    const outstanding = textOf(res).match(/still open: ([^(]+)\(of/)![1];
    expect(outstanding).not.toContain("bigidea");
  });

  it("echoes on an accepted step update too", async () => {
    const h = harness();
    fill(h.canvasMirror, 4, "bigidea");
    const res = await h.step.execute("s1", { step: 4, depth: "rough" });
    expect(textOf(res)).toContain("[step 4] still open:");
  });

  it("stays quiet once the step owes nothing", async () => {
    const h = harness();
    for (const id of ["bigidea", "eq"]) fill(h.canvasMirror, 4, id);
    const res = await h.canvas.execute("c1", { step: 4, id: "challenge", value: "Clean up the messy repo" });
    expect(textOf(res)).not.toContain("still open:");
  });

  it("aggregates step 6's echo over all four journey elements, each id named with its element", async () => {
    const h = harness();
    const res = await h.canvas.execute("c1", { step: 6, phase: "reflect", id: "rs", value: "Final pitch, week 14" });

    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).toContain("[step 6] still open:");
    const outstanding = textOf(res).match(/still open: ([^(]+)\(of/)![1];
    expect(outstanding).toContain("engage/es");
    expect(outstanding).toContain("investigate/is");
    expect(outstanding).toContain("act/as");
    // The slot just written is not outstanding any more.
    expect(outstanding).not.toContain("reflect/rs");
  });

  it("does not attach the echo to a refusal", async () => {
    const h = harness();
    const res = await h.step.execute("s1", { step: 4, depth: "rough" });
    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).not.toContain("still open:");
  });
});

describe("without a canvas lookup the tool behaves exactly as before", () => {
  it("skips the slot guards and the echo", async () => {
    const stepMirror = new StepMirror();
    const step = createStepTool(stepMirror);
    const res = await step.execute("s1", { step: 10, depth: "rough" });
    expect(kindOf(res)).toBe("step-update");
    expect(textOf(res)).not.toContain("still open:");
  });
});
