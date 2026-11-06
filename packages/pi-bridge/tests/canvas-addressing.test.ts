/**
 * Tests for the shared canvas ADDRESSING resolution (capability `agent-harness`,
 * Requirement: cbe_canvas Generative-UI Tool — the one rule applied by both the mirror
 * and the renderer). Exercises the addressing rules in isolation so both consumers can
 * rely on a single verified mapping.
 */
import { describe, it, expect } from "vitest";
import {
  resolveCanvasAddress,
  canvasEntryKey,
  isJourneyPhase,
  isValidStep,
  stepContainers,
  stepCanonicalSlots,
  stepEmptySlots,
} from "../src/canvas-addressing.js";
import { CanvasMirror } from "../src/canvas-mirror.js";

describe("resolveCanvasAddress", () => {
  it("a valid step (not 6) selects the step group and ignores any phase", () => {
    expect(resolveCanvasAddress({ step: 3, id: "assessmentblueprint" })).toEqual({ step: 3 });
    expect(resolveCanvasAddress({ step: 3, phase: "investigate", id: "x" })).toEqual({ step: 3 });
    expect(resolveCanvasAddress({ step: 1, id: "moduleframe" })).toEqual({ step: 1 });
    expect(resolveCanvasAddress({ step: 10, id: "x" })).toEqual({ step: 10 });
  });

  it("step 6 requires a valid journey phase; without one it is unresolvable", () => {
    expect(resolveCanvasAddress({ step: 6, phase: "engage", id: "x" })).toEqual({ step: 6, phase: "engage" });
    expect(resolveCanvasAddress({ step: 6, phase: "reflect", id: "x" })).toEqual({ step: 6, phase: "reflect" });
    expect(resolveCanvasAddress({ step: 6, id: "x" })).toBeNull();
    expect(resolveCanvasAddress({ step: 6, phase: "nope", id: "x" })).toBeNull();
  });

  it("legacy phase-only: a seeded id resolves to its fixed home (ladder → Step 4)", () => {
    expect(resolveCanvasAddress({ phase: "engage", id: "bigidea" })).toEqual({ step: 4 });
    expect(resolveCanvasAddress({ phase: "engage", id: "eq" })).toEqual({ step: 4 });
    expect(resolveCanvasAddress({ phase: "engage", id: "challenge" })).toEqual({ step: 4 });
    // A seeded journey id resolves to its Step-6 journey home regardless of the phase given.
    expect(resolveCanvasAddress({ phase: "engage", id: "as" })).toEqual({ step: 6, phase: "act" });
    expect(resolveCanvasAddress({ phase: "investigate", id: "rs" })).toEqual({ step: 6, phase: "reflect" });
    // A RETIRED learner-time id is no longer seeded, so the home table no longer wins over the
    // declared phase: `gq` is now just an unknown id, and an unknown id follows its phase.
    expect(resolveCanvasAddress({ phase: "engage", id: "gq" })).toEqual({ step: 6, phase: "engage" });
    expect(resolveCanvasAddress({ phase: "investigate", id: "sc" })).toEqual({ step: 6, phase: "investigate" });
  });

  it("legacy phase-only: an unknown id lands under Step 6's matching journey element", () => {
    expect(resolveCanvasAddress({ phase: "investigate", id: "newthing" })).toEqual({ step: 6, phase: "investigate" });
    expect(resolveCanvasAddress({ phase: "reflect", id: "showcase" })).toEqual({ step: 6, phase: "reflect" });
  });

  it("unresolvable addresses return null (no-op)", () => {
    expect(resolveCanvasAddress({ step: 11, id: "x" })).toBeNull();
    expect(resolveCanvasAddress({ step: 0, id: "x" })).toBeNull();
    expect(resolveCanvasAddress({ step: 3.5, id: "x" })).toBeNull();
    expect(resolveCanvasAddress({ id: "x" })).toBeNull(); // neither step nor phase
    expect(resolveCanvasAddress({ phase: "nope", id: "x" })).toBeNull();
  });

  it("canvasEntryKey collapses a step-keyed and its legacy equivalent onto one key", () => {
    const a = resolveCanvasAddress({ step: 4, id: "bigidea" })!;
    const b = resolveCanvasAddress({ phase: "engage", id: "bigidea" })!;
    expect(canvasEntryKey(a, "bigidea")).toBe(canvasEntryKey(b, "bigidea"));
    // A Step-6 journey key carries the phase.
    const j = resolveCanvasAddress({ step: 6, phase: "reflect", id: "showcase" })!;
    expect(canvasEntryKey(j, "showcase")).toBe("6/reflect/showcase");
  });

  it("aggregates a step's containers — step 6 over its four journey elements", () => {
    expect(stepContainers(4)).toEqual([{ step: 4 }]);
    expect(stepContainers(6)).toEqual([
      { step: 6, phase: "engage" },
      { step: 6, phase: "investigate" },
      { step: 6, phase: "act" },
      { step: 6, phase: "reflect" },
    ]);

    // A single-container step's ids stay bare; step 6's carry their journey element,
    // because step 6 cannot be addressed without a `phase`.
    expect(stepCanonicalSlots(4)).toEqual(["bigidea", "eq", "challenge"]);
    expect(stepCanonicalSlots(6)).toEqual(["engage/es", "investigate/is", "act/as", "reflect/rs"]);
    // A step the table knows nothing about yields nothing (the helper stays total).
    expect(stepCanonicalSlots(11)).toEqual([]);
  });

  it("reports a step's empty slots across all of its containers", () => {
    const mirror = new CanvasMirror();
    expect(stepEmptySlots(6, mirror)).toEqual(stepCanonicalSlots(6));

    mirror.applySet({ step: 6, phase: "engage", id: "es", value: "Two lectures.", state: "draft" });
    mirror.applySet({ step: 6, phase: "reflect", id: "rs", value: "Showcase week 14.", state: "draft" });

    const empty = stepEmptySlots(6, mirror);
    expect(empty).not.toContain("engage/es");
    expect(empty).not.toContain("reflect/rs");
    expect(empty).toContain("investigate/is");
    expect(empty).toContain("act/as");
    expect(empty).toHaveLength(2);
  });

  it("type guards", () => {
    expect(isValidStep(1)).toBe(true);
    expect(isValidStep(10)).toBe(true);
    expect(isValidStep(0)).toBe(false);
    expect(isValidStep(11)).toBe(false);
    expect(isValidStep(3.5)).toBe(false);
    expect(isJourneyPhase("reflect")).toBe(true);
    expect(isJourneyPhase("engage")).toBe(true);
    expect(isJourneyPhase("nope")).toBe(false);
  });
});
