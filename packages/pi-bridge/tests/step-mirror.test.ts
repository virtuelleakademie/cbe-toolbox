/**
 * Host-side step-coverage mirror, the derived focus and the depth-ladder guard
 * (change `harden-canvas-determinism-and-ux2-fixes`, wave B).
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces — Scenarios:
 * - An accepted canvas write moves the step focus to that step
 * - A depth advance of more than one rung is refused
 * - A depth regression is accepted without ladder restriction
 * - A refusal leaves host and renderer state untouched
 *
 * The session-replay test at the bottom is the regression guard for the real
 * 2026-08-03 payloads (task B1.6).
 */
import { describe, it, expect } from "vitest";
import { StepMirror, depthRung, nextDepthAbove, type StepCoverageEntry } from "../src/step-mirror.js";
import { createStepTool } from "../src/step-tool.js";
import { createCanvasTool } from "../src/canvas-tool.js";
import { CanvasMirror } from "../src/canvas-mirror.js";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("");
}
function kindOf(result: { details?: unknown }): string | undefined {
  return (result.details as { kind?: string } | undefined)?.kind;
}

describe("StepMirror", () => {
  it("reads open for a step never touched", () => {
    const m = new StepMirror();
    expect(m.depthOf(3)).toBe("open");
    expect(m.focused()).toBeNull();
    expect(m.isEmpty()).toBe(true);
  });

  it("keeps focus exclusive", () => {
    const m = new StepMirror();
    m.applyUpdate(2, { focus: true });
    m.applyUpdate(5, { focus: true });
    expect(m.focused()).toBe(5);
    expect(m.list().filter((e) => e.focus)).toHaveLength(1);
  });

  it("keeps depth and focus independent", () => {
    const m = new StepMirror();
    m.applyUpdate(1, { depth: "rough", focus: true });
    m.applyUpdate(2, { focus: true });
    // Focus moved away, but step 1 keeps its depth — the exact property the
    // 2026-08-03 investigation proved the renderer already had.
    expect(m.depthOf(1)).toBe("rough");
    expect(m.focused()).toBe(2);
  });

  it("ignores degenerate payloads", () => {
    const m = new StepMirror();
    m.applyUpdate(0, { depth: "rough" });
    m.applyUpdate(11, { depth: "rough" });
    m.applyUpdate(3, {});
    expect(m.isEmpty()).toBe(true);
  });

  it("seeds from a carry-over and never yields two focused steps", () => {
    const m = new StepMirror();
    const carried: StepCoverageEntry[] = [
      { step: 1, depth: "detailed", focus: true },
      { step: 2, depth: "rough", focus: true },
    ];
    m.seed(carried);
    expect(m.depthOf(1)).toBe("detailed");
    expect(m.depthOf(2)).toBe("rough");
    expect(m.list().filter((e) => e.focus)).toHaveLength(1);
  });

  it("exposes the ladder helpers", () => {
    expect(depthRung("open")).toBe(0);
    expect(depthRung("detailed")).toBe(3);
    expect(nextDepthAbove("rough")).toBe("refined");
    expect(nextDepthAbove("detailed")).toBeNull();
  });
});

// Scenario: An accepted canvas write moves the step focus to that step
describe("An accepted canvas write moves the step focus to that step", () => {
  it("moves focus to the written step and reports it back for the renderer", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    stepMirror.applyUpdate(1, { focus: true });

    const res = await canvas.execute("c1", { step: 4, id: "bigidea", value: "Git in the times of AI" });

    expect(stepMirror.focused()).toBe(4);
    expect(stepMirror.list().filter((e) => e.focus)).toHaveLength(1);
    expect((res.details as { focusStep?: number }).focusStep).toBe(4);
  });

  it("does not re-report focus when the written step is already focused", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    await canvas.execute("c1", { step: 4, id: "bigidea", value: "x" });
    const second = await canvas.execute("c2", { step: 4, id: "challenge", value: "y" });
    expect((second.details as { focusStep?: number }).focusStep).toBeUndefined();
    expect(stepMirror.focused()).toBe(4);
  });

  it("does not touch the written step's depth", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    await canvas.execute("c1", { step: 7, id: "activityplan", value: "x" });
    // Writing content is not a claim about coverage depth — that stays a deliberate
    // cbe_step call, subject to the ladder guard.
    expect(stepMirror.depthOf(7)).toBe("open");
  });

  it("a refused canvas call moves no focus", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    await canvas.execute("c1", { step: 6, id: "is", value: "x" }); // step 6 without phase → unresolvable
    expect(stepMirror.focused()).toBeNull();
  });
});

// Scenario: A depth advance of more than one rung is refused
// Scenario: A depth regression is accepted without ladder restriction
describe("depth-ladder guard", () => {
  it("refuses a two-rung jump and names the next legal value", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    await step.execute("s1", { step: 3, depth: "rough" });

    const res = await step.execute("s2", { step: 3, depth: "detailed" });

    expect(kindOf(res)).toBe("step-refusal");
    expect(textOf(res)).toContain('next legal value is "refined"');
    expect(mirror.depthOf(3)).toBe("rough");
  });

  it("refuses open → detailed in one hop", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    const res = await step.execute("s1", { step: 10, depth: "detailed" });
    expect(kindOf(res)).toBe("step-refusal");
    expect(mirror.depthOf(10)).toBe("open");
  });

  it("accepts a one-rung advance", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    await step.execute("s1", { step: 3, depth: "rough" });
    const res = await step.execute("s2", { step: 3, depth: "refined" });
    expect(kindOf(res)).toBe("step-update");
    expect(mirror.depthOf(3)).toBe("refined");
  });

  it("accepts a regression of any distance", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    await step.execute("s1", { step: 7, depth: "rough" });
    await step.execute("s2", { step: 7, depth: "refined" });
    await step.execute("s3", { step: 7, depth: "detailed" });

    const res = await step.execute("s4", { step: 7, depth: "open" });

    expect(kindOf(res)).toBe("step-update");
    expect(mirror.depthOf(7)).toBe("open");
  });

  it("leaves the mirror untouched on a refusal", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    await step.execute("s1", { step: 2, depth: "rough", focus: true });
    const before = JSON.stringify(mirror.list());

    await step.execute("s2", { step: 2, depth: "detailed" });

    expect(JSON.stringify(mirror.list())).toBe(before);
  });

  it("without a mirror the tool behaves exactly as before", async () => {
    const step = createStepTool();
    const res = await step.execute("s1", { step: 10, depth: "detailed" });
    expect(kindOf(res)).toBe("step-update");
  });
});

// Task B1.6 — replay regression guard for the real session payloads.
describe("replay of the 2026-08-03 session through the hardened step tool", () => {
  it("refuses the six-step detailed burst of log line 126", async () => {
    const mirror = new StepMirror();
    const step = createStepTool(mirror);
    // Reach the state the session was in just before line 126.
    for (const s of [1, 2, 3, 5, 6]) await step.execute(`seed-${s}`, { step: s, depth: "rough" });

    // Log line 126: five steps at `rough` and step 10 at `open`, all pushed straight
    // to `detailed` in a single turn after the lecturer complained.
    const burst = [1, 2, 3, 5, 6, 10];
    const results = [];
    for (const s of burst) results.push(await step.execute(`burst-${s}`, { step: s, depth: "detailed" }));

    expect(results.every((r) => kindOf(r) === "step-refusal")).toBe(true);
    for (const s of [1, 2, 3, 5, 6]) expect(mirror.depthOf(s)).toBe("rough");
    expect(mirror.depthOf(10)).toBe("open");
  });

  it("focus tracks the written step across the session's canvas writes", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    // The three steps the session wrote content for but never sent focus for.
    await canvas.execute("w1", { step: 2, id: "learningoutcomes", value: "outcomes" });
    expect(stepMirror.focused()).toBe(2);
    await canvas.execute("w2", { step: 8, id: "deliverablesmap", value: "deliverables" });
    expect(stepMirror.focused()).toBe(8);
    await canvas.execute("w3", { step: 10, id: "readinesschecklist", value: "checklist" });
    expect(stepMirror.focused()).toBe(10);
  });
});
