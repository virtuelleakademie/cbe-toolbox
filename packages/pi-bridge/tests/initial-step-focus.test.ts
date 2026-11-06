import { describe, expect, it, vi } from "vitest";
import { StepMirror, composePayloadWithFocusNotice } from "../src/step-mirror.js";
import { buildEnvironmentDescriptor } from "../src/environment.js";
import { RetainedStateHandover } from "../src/retained-state-handover.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { createStepTool } from "../src/step-tool.js";

describe("Host-Set Initial Step Focus", () => {
  it("A fresh session opens focused on step 1", () => {
    const mirror = new StepMirror();
    expect(mirror.isEmpty()).toBe(true);
    mirror.seedInitialFocus();
    expect(mirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
    mirror.seedInitialFocus();
    expect(mirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
  });

  for (const path of ["restore", "carry-over", "replay"] as const) {
    it.each([true, false])(`A course with recorded work keeps its own focus (${path}, focus=%s)`, (focus) => {
      const mirror = new StepMirror();
      const entry = { step: 5, depth: "refined" as const, focus };
      if (path === "restore") mirror.restore([entry]);
      else if (path === "carry-over") mirror.seed([entry]);
      else mirror.applyToolResult({ kind: "step-update", ...entry });
      const before = mirror.list();
      mirror.seedInitialFocus();
      expect(mirror.list()).toEqual(before);
      expect(mirror.focused()).toBe(focus ? 5 : null);
    });
  }

  it("preserves an existing focus even at open depth", () => {
    const mirror = new StepMirror();
    mirror.recordUiFocus(8);
    mirror.seedInitialFocus();
    expect(mirror.focused()).toBe(8);
    expect(mirror.pendingFocus()).toEqual({ step: 8 });
  });

  it("The seed touches no depth", () => {
    const mirror = new StepMirror();
    const observer = vi.fn();
    mirror.observe(observer);
    mirror.seedInitialFocus();
    for (let step = 1; step <= 10; step++) expect(mirror.depthOf(step)).toBe("open");
    expect(observer).not.toHaveBeenCalled();
  });

  it("The seed announces nothing to the model", () => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    expect(mirror.hasPendingFocus()).toBe(false);
    expect(mirror.pendingFocus()).toBeNull();
    expect(composePayloadWithFocusNotice(mirror.drainFocusNotice(), "My module")).toBe("My module");
    const env = buildEnvironmentDescriptor({ profile: "app", stepCoverage: mirror.list() });
    expect(env.toSystemPromptBlock()).toContain('step 1: "open" (in focus)');
  });

  it("The seed is not a coverage claim, so nothing that means recorded work sees it", () => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    expect(mirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
    expect(mirror.holdsOnlySeededFocus()).toBe(true);
    expect(mirror.recordedList()).toEqual([]);
    // Post-compaction handover: a session that established nothing produces none.
    const handover = new RetainedStateHandover({
      getMaturity: () => null,
      getStepCoverage: () => mirror.recordedList(),
    });
    handover.markCompacted();
    expect(handover.drain()).toBeNull();
    // The first real transition makes the mirror recorded state again.
    mirror.applyToolResult({ kind: "step-update", step: 2, depth: "rough", focus: true });
    expect(mirror.holdsOnlySeededFocus()).toBe(false);
    expect(mirror.recordedList()).toEqual(mirror.list());
    handover.markCompacted();
    expect(handover.drain()).toContain('step 2: "rough" (in focus)');
  });

  it.each(["carry-over", "restore", "ui-focus", "canvas-write", "step-tool"] as const)(
    "recorded work is never mistaken for the seed (%s)",
    (path) => {
      const mirror = new StepMirror();
      if (path === "carry-over") mirror.seed([{ step: 1, depth: "open", focus: true }]);
      else if (path === "restore") mirror.restore([{ step: 1, depth: "open", focus: true }]);
      else if (path === "ui-focus") mirror.recordUiFocus(1);
      else if (path === "canvas-write") mirror.applyCanvasWrite(1);
      else mirror.applyToolResult({ kind: "step-update", step: 1, focus: true });
      expect(mirror.holdsOnlySeededFocus()).toBe(false);
      expect(mirror.recordedList()).toEqual([{ step: 1, depth: "open", focus: true }]);
    }
  );

  // Regression: every feeder that can fire WITHOUT changing an entry must still
  // clear the provenance. `applyCanvasWrite` returns early when the written step is
  // already focused — which with the seed standing is exactly step 1, the step the
  // first turn of a new course fills — so the flag used to survive a real write and
  // the course record was persisted with no step state at all.
  it.each([
    ["canvas-write", (m: StepMirror) => m.applyCanvasWrite(1)],
    ["ui-focus", (m: StepMirror) => m.recordUiFocus(1)],
    ["step-tool", (m: StepMirror) => m.applyToolResult({ kind: "step-update", step: 1, focus: true })],
  ] as const)("work on the already-seeded step 1 becomes recorded coverage (%s)", (_name, feed) => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    expect(mirror.holdsOnlySeededFocus()).toBe(true);
    feed(mirror);
    expect(mirror.focused()).toBe(1);
    expect(mirror.depthOf(1)).toBe("open");
    expect(mirror.holdsOnlySeededFocus()).toBe(false);
    expect(mirror.recordedList()).toEqual([{ step: 1, depth: "open", focus: true }]);
  });

  it.each([
    ["out-of-range canvas write", (m: StepMirror) => m.applyCanvasWrite(0)],
    ["out-of-range selection", (m: StepMirror) => m.recordUiFocus(11)],
    ["foreign tool result", (m: StepMirror) => m.applyToolResult({ kind: "maturity-update" })],
    ["degenerate step result", (m: StepMirror) => m.applyToolResult({ kind: "step-update", step: 2 })],
  ] as const)("a refused or degenerate call leaves the seed standing (%s)", (_name, feed) => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    feed(mirror);
    expect(mirror.holdsOnlySeededFocus()).toBe(true);
    expect(mirror.recordedList()).toEqual([]);
    expect(mirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
  });

  // The mirror's own guards are structural. A DEPTH refused at the tool boundary is a
  // different thing: `cbe_step` keeps the never-refused navigation half, so a
  // ladder-legal focus still reaches `applyUpdate` and the seed stops standing. Pinned
  // in both directions so the split stays visible rather than being read as a leak.
  describe("a depth the tool boundary refuses still carries its navigation half", () => {
    const harness = () => {
      const stepMirror = new StepMirror();
      stepMirror.seedInitialFocus();
      return {
        stepMirror,
        step: createStepTool(stepMirror, undefined, undefined, new CanvasMirror()),
      };
    };

    it("a ladder-legal derived focus consumes the seed provenance", async () => {
      const h = harness();
      const res = await h.step.execute("s1", { step: 2, depth: "rough" });

      expect((res.details as { kind?: string; focusStep?: number }).kind).toBe("step-refusal");
      expect((res.details as { focusStep?: number }).focusStep).toBe(2);
      expect(h.stepMirror.depthOf(2)).toBe("open");
      expect(h.stepMirror.focused()).toBe(2);
      expect(h.stepMirror.holdsOnlySeededFocus()).toBe(false);
      expect(h.stepMirror.recordedList()).toEqual([
        { step: 1, depth: "open", focus: false },
        { step: 2, depth: "open", focus: true },
      ]);
    });

    it("a multi-rung claim loses its navigation half and leaves the seed standing", async () => {
      const h = harness();
      const res = await h.step.execute("s1", { step: 2, depth: "detailed" });

      expect((res.details as { kind?: string; focusStep?: number }).kind).toBe("step-refusal");
      expect((res.details as { focusStep?: number }).focusStep).toBeUndefined();
      expect(h.stepMirror.focused()).toBe(1);
      expect(h.stepMirror.holdsOnlySeededFocus()).toBe(true);
      expect(h.stepMirror.recordedList()).toEqual([]);
    });
  });

  it("The prior reports a starting point rather than carried-over work", () => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    const seeded = buildEnvironmentDescriptor({
      profile: "app",
      stepCoverage: mirror.list(),
    }).toSystemPromptBlock();
    expect(seeded).toContain("step-coverage prior (design-flow starting point — no coverage recorded yet):");
    expect(seeded).not.toContain("carried over from the previous conversation");
    expect(seeded).not.toContain("RECORDED coverage");
    expect(seeded).not.toContain("Work continues on step");
    // A depth above `open` is recorded coverage and keeps the carry-over wording.
    const carried = buildEnvironmentDescriptor({
      profile: "app",
      stepCoverage: [{ step: 1, depth: "rough", focus: true }],
    }).toSystemPromptBlock();
    expect(carried).toContain("carried over from the previous conversation");
    expect(carried).toContain("Work continues on step 1.");
    expect(carried).not.toContain("no coverage recorded yet");
  });

  it.each(["step", "canvas"])("The seeded focus moves like any other (%s)", (tool) => {
    const mirror = new StepMirror();
    mirror.seedInitialFocus();
    if (tool === "step") mirror.applyToolResult({ kind: "step-update", step: 3, focus: true });
    else mirror.applyCanvasWrite(3);
    mirror.seedInitialFocus();
    expect(mirror.focused()).toBe(3);
    mirror.applyUpdate(3, { focus: false });
    expect(mirror.isEmpty()).toBe(true);
    mirror.seedInitialFocus();
    expect(mirror.focused()).toBeNull();
  });

  it("does not turn empty restored or carried state into a new design", () => {
    for (const restore of [false, true]) {
      const mirror = new StepMirror();
      if (restore) mirror.restore([]);
      else mirror.seed([]);
      mirror.seedInitialFocus();
      expect(mirror.list()).toEqual([]);
    }
  });
});
