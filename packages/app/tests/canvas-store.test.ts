/**
 * Tests for the live Canvas + step-coverage store slices after the ten-step restructure
 * (Requirement: Design-Flow Canvas / Live Canvas Population from Skill Tool-Calls). The
 * `artifacts` slice is a StepGroup[] seeded from STEP_GROUPS; `applyCanvasUpdate` /
 * `clearCanvasArtefact` resolve addresses through the shared rule. The `steps` slice holds
 * per-step coverage, driven by `applyStepUpdate`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCbe } from "../src/renderer/state/store.js";
import type { StepId } from "../src/renderer/mocks/artifacts.js";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";

function group(step: StepId) {
  return useCbe.getState().artifacts.find((g) => g.step === step)!;
}
function findAt(step: StepId, id: string, phase?: JourneyPhase) {
  const g = group(step);
  const container = phase ? g.journey!.find((el) => el.phase === phase)!.items : g.items;
  return container.find((it) => it.id === id);
}
function cov(step: StepId) {
  return useCbe.getState().steps.find((s) => s.step === step)!;
}

beforeEach(() => {
  useCbe.getState().reset(); // re-seeds artifacts + steps
});

describe("artifacts store slice — applyCanvasUpdate", () => {
  // Scenario: Cold session shows the ten-step seed
  it("seeds the ten design-step groups empty/open on a cold store", () => {
    const a = useCbe.getState().artifacts;
    expect(a.map((g) => g.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Step 4 carries the challenge ladder; Step 6 the four journey elements.
    expect(group(4).items.map((it) => it.id)).toEqual(["bigidea", "eq", "challenge"]);
    expect(group(6).journey!.map((el) => el.phase)).toEqual(["engage", "investigate", "act", "reflect"]);
    // Labels survive; values blank, every artefact `open`.
    expect(findAt(4, "bigidea")?.label).toBe("Big Idea");
    const allItems = a.flatMap((g) => (g.journey ? g.journey.flatMap((el) => el.items) : g.items));
    expect(allItems.every((it) => it.value === "" && it.state === "open")).toBe(true);
  });

  // Scenario: Artefact updates live on a cbe_canvas call (step-keyed)
  it("a step-keyed set updates the artefact in its step group", () => {
    useCbe
      .getState()
      .applyCanvasUpdate(3, undefined, "assessmentblueprint", { value: "Evidence per outcome.", state: "active" });
    expect(findAt(3, "assessmentblueprint")).toMatchObject({ value: "Evidence per outcome.", state: "active" });
  });

  // Scenario: Legacy phase-only call resolves to its seeded home or Step 6
  it("a legacy phase-only call resolves the ladder to Step 4 and a journey id to Step 6", () => {
    useCbe.getState().applyCanvasUpdate(undefined, "engage", "bigidea", { value: "Water resilience", state: "done" });
    useCbe.getState().applyCanvasUpdate(undefined, "investigate", "is", { value: "Weeks 4-7: field study." });
    expect(findAt(4, "bigidea")).toMatchObject({ value: "Water resilience", state: "done" });
    expect(findAt(6, "is", "investigate")).toMatchObject({ value: "Weeks 4-7: field study." });
    // No duplicate rows appeared elsewhere.
    expect(group(4).items.filter((x) => x.id === "bigidea")).toHaveLength(1);
  });

  // Scenario: Reflect-and-present artefacts land under the fourth journey element
  it("a reflect-phase artefact lands under Step 6's Reflect-and-present element", () => {
    useCbe
      .getState()
      .applyCanvasUpdate(6, "reflect", "showcase", { label: "Showcase", value: "Final pitch + reflection." });
    expect(findAt(6, "showcase", "reflect")).toMatchObject({ label: "Showcase", value: "Final pitch + reflection." });
  });

  // Scenario (change reliable-in-place-canvas-profile-writes): Updating an artefact
  // edits the existing slot, not a duplicate — the same canonical id replaces in place.
  it("updating a seeded artefact with the same canonical id edits in place, no duplicate", () => {
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resource justice", state: "draft" });
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Water resilience", state: "active" });
    expect(findAt(4, "bigidea")).toMatchObject({ value: "Water resilience", state: "active" });
    // Exactly one Big Idea row survives — the revision did not spawn a second field.
    expect(group(4).items.filter((x) => x.id === "bigidea")).toHaveLength(1);
    // The seeded ladder is unchanged in shape (no id renamed to a long form like essentialquestion).
    expect(group(4).items.map((it) => it.id)).toEqual(["bigidea", "eq", "challenge"]);
  });

  // Scenario (change reliable-in-place-canvas-profile-writes): A skill-minted artefact
  // keeps its id across revisions — a seed-less Step-6 journey item edits in place.
  it("a skill-minted seed-less journey artefact keeps its id across revisions (no duplicate)", () => {
    useCbe.getState().applyCanvasUpdate(6, "engage", "hook", { label: "Engage hook", value: "Field visit" });
    useCbe
      .getState()
      .applyCanvasUpdate(6, "engage", "hook", { label: "Engage hook", value: "Guest lecture + site visit" });
    expect(findAt(6, "hook", "engage")).toMatchObject({ value: "Guest lecture + site visit" });
    const engage = group(6).journey!.find((el) => el.phase === "engage")!;
    expect(engage.items.filter((x) => x.id === "hook")).toHaveLength(1);
  });

  // Scenario (change reliable-in-place-canvas-profile-writes): Every settled artefact is
  // mirrored, not just some — each settled call lands in its own slot, none dropped.
  it("mirrors every settled artefact into its own slot", () => {
    useCbe.getState().applyCanvasUpdate(1, undefined, "moduleframe", { value: "12 ECTS, semester 4" });
    useCbe.getState().applyCanvasUpdate(2, undefined, "learningoutcomes", { value: "Three outcomes" });
    useCbe.getState().applyCanvasUpdate(3, undefined, "assessmentblueprint", { value: "Evidence per outcome" });
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resource justice" });
    expect(findAt(1, "moduleframe")?.value).toBe("12 ECTS, semester 4");
    expect(findAt(2, "learningoutcomes")?.value).toBe("Three outcomes");
    expect(findAt(3, "assessmentblueprint")?.value).toBe("Evidence per outcome");
    expect(findAt(4, "bigidea")?.value).toBe("Resource justice");
  });

  it("inserts a new artefact under a resolved group, defaulting state to draft", () => {
    const before = group(8).items.length;
    useCbe.getState().applyCanvasUpdate(8, undefined, "extra-deliverable", { label: "Extra", value: "v" });
    expect(group(8).items.length).toBe(before + 1);
    expect(findAt(8, "extra-deliverable")).toMatchObject({ label: "Extra", value: "v", state: "draft" });
  });

  // Scenario: Unknown step, phase, or id is handled gracefully
  it("ignores an unresolvable address without crashing", () => {
    const snap = JSON.stringify(useCbe.getState().artifacts);
    expect(() => useCbe.getState().applyCanvasUpdate(11, undefined, "x", { value: "v" })).not.toThrow();
    expect(() => useCbe.getState().applyCanvasUpdate(6, undefined, "x", { value: "v" })).not.toThrow(); // step 6, no phase
    expect(() => useCbe.getState().applyCanvasUpdate(undefined, "nope", "x", { value: "v" })).not.toThrow();
    expect(JSON.stringify(useCbe.getState().artifacts)).toBe(snap);
  });

  it("drops the artefact's stale annotations on replacement", () => {
    useCbe.getState().addAnnotation("bigidea", "Resilience", "too broad?");
    expect(useCbe.getState().annotations.some((a) => a.artifactId === "bigidea")).toBe(true);
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Water resilience" });
    expect(useCbe.getState().annotations.some((a) => a.artifactId === "bigidea")).toBe(false);
  });
});

describe("artifacts store slice — clearCanvasArtefact", () => {
  // Scenario: A clear call reverts a seeded artefact to its seed/open state
  it("reverts a seeded artefact to empty value + state open and drops its annotations", () => {
    useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Resilience", state: "done" });
    useCbe.getState().addAnnotation("bigidea", "Resilience", "reconsider");
    expect(findAt(4, "bigidea")?.value).toBe("Resilience");

    useCbe.getState().clearCanvasArtefact(4, undefined, "bigidea");
    const it = findAt(4, "bigidea");
    expect(it?.value).toBe("");
    expect(it?.state).toBe("open");
    expect(it?.label).toBe("Big Idea");
    expect(group(4).items.filter((x) => x.id === "bigidea")).toHaveLength(1);
    expect(useCbe.getState().annotations.some((a) => a.artifactId === "bigidea")).toBe(false);
  });

  it("a legacy phase-only clear reverts the ladder artefact in its Step-4 home", () => {
    useCbe.getState().applyCanvasUpdate(undefined, "engage", "bigidea", { value: "Resilience" });
    useCbe.getState().clearCanvasArtefact(undefined, "engage", "bigidea");
    expect(findAt(4, "bigidea")?.value).toBe("");
  });

  // Scenario: A clear call removes a previously inserted non-seed artefact
  it("removes a previously inserted non-seed artefact entirely", () => {
    useCbe.getState().applyCanvasUpdate(8, undefined, "extra", { label: "Extra", value: "v" });
    expect(findAt(8, "extra")).toBeTruthy();
    const seededCount = group(8).items.filter((x) => x.id !== "extra").length;
    useCbe.getState().clearCanvasArtefact(8, undefined, "extra");
    expect(findAt(8, "extra")).toBeUndefined();
    expect(group(8).items.filter((x) => x.id !== "extra").length).toBe(seededCount);
  });

  // Scenario: A clear for an absent artefact is ignored
  it("ignores a clear for an absent id / unresolvable address without crashing", () => {
    const snap = JSON.stringify(useCbe.getState().artifacts);
    expect(() => useCbe.getState().clearCanvasArtefact(4, undefined, "does-not-exist")).not.toThrow();
    expect(() => useCbe.getState().clearCanvasArtefact(11, undefined, "bigidea")).not.toThrow();
    expect(JSON.stringify(useCbe.getState().artifacts)).toBe(snap);
  });
});

describe("steps store slice — applyStepUpdate", () => {
  it("seeds all ten steps open, none in focus", () => {
    expect(useCbe.getState().steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(useCbe.getState().steps.every((s) => s.depth === "open" && !s.focus)).toBe(true);
  });

  // Scenario: Step coverage depth renders live on the group header
  it("applies a depth update to the named step", () => {
    useCbe.getState().applyStepUpdate(3, { depth: "rough" });
    expect(cov(3).depth).toBe("rough");
  });

  // Scenario: Coverage depth can move down when an output is reopened
  it("accepts a lower depth — depth is not a ratchet", () => {
    useCbe.getState().applyStepUpdate(3, { depth: "refined" });
    useCbe.getState().applyStepUpdate(3, { depth: "rough" });
    expect(cov(3).depth).toBe("rough");
  });

  // Scenario: Focus is exclusive
  it("focus is exclusive — a new focus clears the previous one, depth preserved", () => {
    useCbe.getState().applyStepUpdate(2, { depth: "rough", focus: true });
    expect(cov(2).focus).toBe(true);
    useCbe.getState().applyStepUpdate(4, { focus: true });
    expect(cov(4).focus).toBe(true);
    expect(cov(2).focus).toBe(false);
    expect(cov(2).depth).toBe("rough"); // depth kept when focus moved away
  });

  // Scenario: Degenerate step payload is handled gracefully
  it("ignores a degenerate step payload", () => {
    const snap = JSON.stringify(useCbe.getState().steps);
    useCbe.getState().applyStepUpdate(11, { depth: "rough" }); // out of range
    useCbe.getState().applyStepUpdate(3, {}); // neither depth nor focus
    useCbe.getState().applyStepUpdate(3, { depth: "deep" as never }); // unknown depth
    expect(JSON.stringify(useCbe.getState().steps)).toBe(snap);
  });
});
