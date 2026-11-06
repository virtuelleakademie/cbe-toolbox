/**
 * The alignment re-check surfaced from canvas state (change
 * `surface-the-alignment-recheck-from-canvas-state`).
 *
 * capability `agent-harness`, Requirement: The Alignment Re-Check Is Surfaced From Canvas
 * State. Test names mirror the spec scenarios.
 *
 * The finding behind it: the check has two directions and the model reaches one, because
 * `methodology-003` — which carries the six-pattern catalogue, orphan assessment among them
 * — was never in the session on the turn the check ran (`12d`, 0/3 on probe S12). The repair
 * may not enumerate the patterns anywhere, so the negative assertions below are as
 * load-bearing as the positive ones.
 */
import { describe, it, expect } from "vitest";
import {
  ALIGNMENT_CATALOGUE_DOCUMENT,
  ALIGNMENT_TRIAD_CORNER_STEPS,
  ALIGNMENT_TRIAD_STEPS,
  alignmentCornerArtefact,
  alignmentRecheckDue,
  alignmentRecheckNotice,
  isAlignmentCornerWrite,
} from "../src/alignment-recheck.js";
import { CANONICAL_SLOTS } from "../src/canvas-addressing.js";
import { createCanvasTool } from "../src/canvas-tool.js";
import { createStepTool } from "../src/step-tool.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";
import { PendingAnswerGate } from "../src/pending-answer-gate.js";
import { createPickerTool } from "../src/picker-tool.js";

function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content.map((c) => c.text ?? "").join("");
}
function kindOf(r: { details?: unknown }): string | undefined {
  return (r.details as { kind?: string } | undefined)?.kind;
}

/** A canvas tool over a fresh mirror, with the triad corners pre-filled as asked. */
function harness(prefilled: number[] = [], opts: { gate?: PendingAnswerGate } = {}) {
  const canvasMirror = new CanvasMirror();
  const stepMirror = new StepMirror();
  for (const step of prefilled) {
    const id = alignmentCornerArtefact(step) as string;
    canvasMirror.applySet({ step, id, value: `recorded content for step ${step}`, state: "done" });
  }
  return {
    canvasMirror,
    stepMirror,
    canvas: createCanvasTool(canvasMirror, stepMirror, opts.gate),
    step: createStepTool(stepMirror, opts.gate),
    picker: createPickerTool(opts.gate ?? new PendingAnswerGate()),
  };
}

const GOALS = ALIGNMENT_TRIAD_CORNER_STEPS.goals;
const ASSESSMENT = ALIGNMENT_TRIAD_CORNER_STEPS.assessment;
const ACTIVITIES = ALIGNMENT_TRIAD_CORNER_STEPS.activities;

describe("the triad corner table is derived, not restated", () => {
  // Task 3.2: the ids come from CANONICAL_SLOTS, so a change to the slot table fails
  // loudly here instead of silently retargeting the notice at nothing.
  it("names exactly three corners: goals, assessment, activities", () => {
    expect(ALIGNMENT_TRIAD_STEPS).toEqual([2, 3, 7]);
  });

  it("takes each corner's artefact id from the canonical slot table", () => {
    for (const step of ALIGNMENT_TRIAD_STEPS) {
      const slots = CANONICAL_SLOTS[String(step)] ?? [];
      expect(slots).toHaveLength(1);
      expect(alignmentCornerArtefact(step)).toBe(slots[0]);
    }
  });

  it("treats steps 6 and 8 as non-corners", () => {
    expect(alignmentCornerArtefact(6)).toBeNull();
    expect(alignmentCornerArtefact(8)).toBeNull();
    expect(isAlignmentCornerWrite({ step: 6, phase: "act" }, "as")).toBe(false);
    expect(isAlignmentCornerWrite({ step: 8 }, "deliverablesmap")).toBe(false);
  });
});

describe("the have-something-to-check-against predicate", () => {
  it("is false with nothing on record", () => {
    expect(alignmentRecheckDue(new CanvasMirror())).toBe(false);
  });

  it("is false with only the goals corner on record", () => {
    expect(alignmentRecheckDue(harness([GOALS]).canvasMirror)).toBe(false);
  });

  it("is false while the goals corner is empty, however much else is recorded", () => {
    expect(alignmentRecheckDue(harness([ASSESSMENT, ACTIVITIES]).canvasMirror)).toBe(false);
  });

  it("is true once the goals corner and one other corner are on record", () => {
    expect(alignmentRecheckDue(harness([GOALS, ASSESSMENT]).canvasMirror)).toBe(true);
    expect(alignmentRecheckDue(harness([GOALS, ACTIVITIES]).canvasMirror)).toBe(true);
  });
});

describe("cbe_canvas surfaces the alignment re-check", () => {
  // Scenario: An accepted write to a triad corner names the re-check and the catalogue
  it("names the re-check and the catalogue on an accepted write to a triad corner", async () => {
    const t = harness([GOALS, ASSESSMENT]);
    const res = await t.canvas.execute("c1", { step: ACTIVITIES, id: "activityplan", value: "Exkursion" });
    expect(kindOf(res)).toBe("canvas-update");
    const text = textOf(res);
    expect(text).toContain("[alignment]");
    expect(text).toContain(`Step ${ACTIVITIES} (activityplan)`);
    expect(text).toContain("due in THIS response");
    expect(text).toContain("over the whole triad on record");
    expect(text).toContain("not only the corner that moved");
    expect(text).toContain(ALIGNMENT_CATALOGUE_DOCUMENT);
    expect(text).toContain("read that document in this session");
  });

  // Scenario: The first corner on record carries no notice
  it("carries no notice for the first corner on record", async () => {
    const t = harness();
    const res = await t.canvas.execute("c1", { step: GOALS, id: "learningoutcomes", value: "1) …" });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  // Scenario: A corner written while the goals corner is empty carries no notice
  it("carries no notice while the goals corner is empty", async () => {
    const t = harness([ACTIVITIES]);
    const res = await t.canvas.execute("c1", { step: ASSESSMENT, id: "assessmentblueprint", value: "Klausur" });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  // Scenario: The reverse of the above — the write that makes the check possible carries
  // the notice itself, because the predicate is evaluated AFTER the mirror write.
  it("carries the notice on the write that puts the second corner on record", async () => {
    const t = harness([ASSESSMENT]);
    const res = await t.canvas.execute("c1", { step: GOALS, id: "learningoutcomes", value: "1) …" });
    expect(textOf(res)).toContain("[alignment]");
  });

  // Scenario: A write outside the triad carries no notice
  it("carries no notice for a write outside the triad", async () => {
    const t = harness([GOALS, ASSESSMENT]);
    const a = await t.canvas.execute("c1", { step: 4, id: "challenge", value: "Sanierungsempfehlung" });
    const b = await t.canvas.execute("c2", { step: 6, phase: "act", id: "as", value: "Entwicklung" });
    expect(textOf(a)).not.toContain("[alignment]");
    expect(textOf(b)).not.toContain("[alignment]");
  });

  it("carries no notice for an additional non-canonical artefact of a corner's step", async () => {
    // Step 3's seeded slot is filled, so a minted id there is accepted rather than refused
    // — and it is still not the assessment blueprint.
    const t = harness([GOALS, ASSESSMENT]);
    const res = await t.canvas.execute("c1", { step: ASSESSMENT, id: "gradingnotes", value: "Notenschluessel" });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  // Scenario: The notice repeats on every accepted corner write that changes the corner
  it("repeats on every accepted corner write that changes the corner", async () => {
    const t = harness([GOALS, ASSESSMENT]);
    const a = await t.canvas.execute("c1", { step: ACTIVITIES, id: "activityplan", value: "Exkursion" });
    const b = await t.canvas.execute("c2", { step: ASSESSMENT, id: "assessmentblueprint", value: "Protokoll" });
    expect(textOf(a)).toContain("[alignment]");
    expect(textOf(b)).toContain("[alignment]");
  });

  // Scenario: A re-push that changes nothing carries no notice
  it("carries no notice for a re-push that leaves the corner unchanged", async () => {
    const t = harness([GOALS, ASSESSMENT, ACTIVITIES]);
    const res = await t.canvas.execute("c1", {
      step: ACTIVITIES,
      id: "activityplan",
      value: `recorded content for step ${ACTIVITIES}`,
      state: "done",
    });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  // Scenario: An edit to a corner's label or state alone still carries the notice.
  // The comparison is the MIRROR's (`sameEntry` covers step, phase, id, label, value and
  // state), not a value-only test invented here.
  it("carries the notice for a label-only edit of a corner", async () => {
    const t = harness([GOALS, ASSESSMENT, ACTIVITIES]);
    const res = await t.canvas.execute("c1", {
      step: ACTIVITIES,
      id: "activityplan",
      label: "Aktivitaetenplan",
      value: `recorded content for step ${ACTIVITIES}`,
      state: "done",
    });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).toContain("[alignment]");
  });

  it("carries the notice for a state-only edit of a corner", async () => {
    const t = harness([GOALS, ASSESSMENT, ACTIVITIES]);
    const res = await t.canvas.execute("c1", {
      step: ACTIVITIES,
      id: "activityplan",
      value: `recorded content for step ${ACTIVITIES}`,
      state: "draft",
    });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).toContain("[alignment]");
  });

  // Scenario: A refused write carries no notice
  it("does not attach to a refused write", async () => {
    const t = harness([GOALS, ASSESSMENT]);
    // Degenerate payload: a set with no value.
    const degenerate = await t.canvas.execute("c1", { step: ACTIVITIES, id: "activityplan" });
    expect(kindOf(degenerate)).toBe("canvas-refusal");
    expect(textOf(degenerate)).not.toContain("[alignment]");
    // Non-canonical id while the container's seeded slot is still empty.
    const minted = await t.canvas.execute("c2", { step: ACTIVITIES, id: "lessonlist", value: "x" });
    expect(kindOf(minted)).toBe("canvas-refusal");
    expect(textOf(minted)).not.toContain("[alignment]");
  });

  it("does not attach while a rendered question is unanswered", async () => {
    const gate = new PendingAnswerGate();
    const t = harness([GOALS, ASSESSMENT], { gate });
    await t.picker.execute("p1", { question: "Welche Anspruchsgruppe?", options: [{ id: "a", label: "A" }] });
    const res = await t.canvas.execute("c1", { step: ACTIVITIES, id: "activityplan", value: "Exkursion" });
    expect(kindOf(res)).toBe("canvas-refusal");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  it("carries no notice on a clear", async () => {
    const t = harness([GOALS, ASSESSMENT, ACTIVITIES]);
    const res = await t.canvas.execute("c1", {
      step: ACTIVITIES,
      id: "activityplan",
      action: "clear",
    });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  it("stays silent without a bound mirror", async () => {
    const bare = createCanvasTool();
    const res = await bare.execute("c1", { step: ACTIVITIES, id: "activityplan", value: "Exkursion" });
    expect(kindOf(res)).toBe("canvas-update");
    expect(textOf(res)).not.toContain("[alignment]");
  });

  // Scenario: The other accepted-write notices are unaffected
  it("leaves the slot echo and the outstanding-surface notice intact", async () => {
    const canvasMirror = new CanvasMirror();
    const stepMirror = new StepMirror();
    for (const step of [GOALS, ASSESSMENT]) {
      canvasMirror.applySet({
        step,
        id: alignmentCornerArtefact(step) as string,
        value: "recorded",
        state: "done",
      });
      stepMirror.applyUpdate(step, { depth: "rough" });
    }
    // Step 1 settled too, so the coherence gate is passed and the maturity notice is due.
    stepMirror.applyUpdate(1, { depth: "rough" });
    const surfaces = {
      maturity: { isEmpty: () => true, hasTarget: () => false, hasAchievedReading: () => false },
      maturityAffordance: true,
      coherenceGate: true,
    };
    const canvas = createCanvasTool(canvasMirror, stepMirror, undefined, surfaces);
    // Step 2 seeds exactly one slot and it is already filled, so this corner write owes no
    // echo of its own; the echo case is the step-4 write below, where two slots stay open.
    const res = await canvas.execute("c1", { step: GOALS, id: "learningoutcomes", value: "1) neu" });
    const text = textOf(res);
    expect(text).toContain("[outstanding]");
    expect(text).toContain("no achieved maturity reading has been recorded");
    expect(text).toContain("[alignment]");
    const withEcho = await canvas.execute("c2", { step: 4, id: "bigidea", value: "Resilienz" });
    expect(textOf(withEcho)).toContain("[step 4] still open");
    expect(textOf(withEcho)).not.toContain("[alignment]");
  });
});

describe("the notice enumerates no mis-alignment pattern", () => {
  /**
   * Scenario: The notice enumerates no mis-alignment pattern.
   *
   * The catalogue's six patterns, from `corpus/content/methodology/methodology-003-…`. The
   * canonical requirement forbids a partial copy because it silently narrows the check —
   * "which is how it came to test two of the six" — and that prohibition binds the host
   * notice for the same reason.
   */
  const CATALOGUE_PATTERNS = [
    "process goal",
    "product assessment",
    "verb–deliverable",
    "verb-deliverable",
    "unassessed goal",
    "orphan assessment",
    "activity without assessment",
    "granularity mismatch",
  ];

  const notice = alignmentRecheckNotice(
    { step: ALIGNMENT_TRIAD_CORNER_STEPS.activities },
    "activityplan",
    harness([GOALS, ASSESSMENT]).canvasMirror,
    true
  ) as string;

  it("emits a notice for this fixture at all", () => {
    expect(notice).toBeTruthy();
  });

  // Scenario: The notice does not foreclose the sharp-outcomes deferral.
  // Sharpness is not computable from canvas state — only presence is — so the host states
  // the demand with that condition on it rather than overruling a canonical rule it cannot
  // itself compute.
  it("states the demand as conditional on the outcomes being sharp", () => {
    expect(notice).toContain("unless those outcomes are not yet sharp enough to align to");
    expect(notice).toContain("then that sharpening comes first");
    // The condition points at the sharpening, so it cannot be read as the re-check
    // deferring to itself.
    expect(notice).not.toContain("that check comes first");
    // The ordinary case still gets the push the change exists for.
    expect(notice).toContain("due in THIS response");
  });

  for (const pattern of CATALOGUE_PATTERNS) {
    it(`does not name "${pattern}"`, () => {
      expect(notice.toLowerCase()).not.toContain(pattern.toLowerCase());
    });
  }

  it("does not restate the retired inlined pair", () => {
    // `govern-the-flow-by-canvas-state-and-profile` task 2.2 removed "a goal with no
    // assessment is a finding; so is an assessment with no goal" from the skill body. The
    // notice must not bring it back on another channel.
    expect(notice.toLowerCase()).not.toMatch(/goal with no assessment/);
    expect(notice.toLowerCase()).not.toMatch(/assessment with no goal/);
  });

  it("names the document and does not carry its body", () => {
    expect(notice).toContain(ALIGNMENT_CATALOGUE_DOCUMENT);
    expect(notice).not.toContain("Constructive alignment");
    expect(notice).not.toContain("Biggs");
    // A notice long enough to hold the catalogue would be a bulk load on a per-write
    // channel; the document is 2.9 KB.
    expect(notice.length).toBeLessThan(600);
  });
});
