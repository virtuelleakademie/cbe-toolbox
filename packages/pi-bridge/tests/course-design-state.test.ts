/**
 * Tests for change `carry-over-all-state-per-course` (capability `agent-harness`,
 * Requirement: Course Design-State Store) — the mirror-side restore seams.
 *
 * The product rule (2026-08-04): a new session carries over everything, scoped
 * per course. These cover the half that lives in pi-bridge: restoring a stored
 * record into the host mirrors WITHOUT materialising anything the record does not
 * carry. The sidecar write/read half is covered in the app workspace.
 */
import { describe, it, expect } from "vitest";
import { CanvasMirror, type CanvasArtefactEntry } from "../src/canvas-mirror.js";
import { StepMirror, STEP_DEPTH_LADDER, type StepCoverageEntry } from "../src/step-mirror.js";
import { MaturityMirror, type MaturitySnapshot } from "../src/maturity-mirror.js";

describe("carry-over-all-state-per-course — mirrors restore a course record", () => {
  // Scenario: A course's design state survives an app restart (mirror half)
  it("restores canvas artefacts exactly as stored", () => {
    const m = new CanvasMirror();
    m.restore([
      { step: 4, id: "bigidea", label: "Big Idea", value: "Urban mobility", state: "done" },
      { step: 6, phase: "engage", id: "kickoff", label: "Kickoff", value: "Site walk", state: "draft" },
    ]);
    const list = m.list();
    expect(list).toHaveLength(2);
    expect(m.get({ step: 4 }, "bigidea")?.value).toBe("Urban mobility");
    expect(m.get({ step: 6, phase: "engage" }, "kickoff")?.value).toBe("Site walk");
  });

  // Scenario: A course with no record opens empty, not inheriting
  it("replaces prior contents so a course never inherits the previous one's artefacts", () => {
    const m = new CanvasMirror();
    m.restore([{ step: 4, id: "bigidea", label: "Big Idea", value: "Course A", state: "done" }]);
    m.restore([]); // switching to a course with no stored artefacts
    expect(m.list()).toEqual([]);
    expect(m.size()).toBe(0);
  });

  // Scenario: Loading materialises nothing that was never established
  it("keeps a step stored at open at open, and invents no depth or focus", () => {
    const m = new StepMirror();
    m.restore([
      { step: 2, depth: "open", focus: false },
      { step: 3, depth: "rough", focus: false },
    ]);
    expect(m.depthOf(2)).toBe("open");
    expect(m.depthOf(3)).toBe("rough");
    // A step absent from the record reads as open — not promoted, not recorded.
    expect(m.depthOf(7)).toBe("open");
    expect(m.focused()).toBeNull();
  });

  it("reduces a record carrying multiple focused steps to one rather than trusting it", () => {
    // Focus exclusivity is an invariant of the live mirror; a hand-edited or
    // corrupted record must not be able to violate it through the restore path.
    const m = new StepMirror();
    m.restore([
      { step: 1, depth: "rough", focus: true },
      { step: 5, depth: "rough", focus: true },
    ]);
    expect(m.list().filter((e) => e.focus)).toHaveLength(1);
    expect(m.focused()).toBe(1);
  });

  // Scenario: A malformed record opens the course empty rather than failing
  it("drops a canvas entry without a value instead of mirroring it", () => {
    const m = new CanvasMirror();
    m.restore([
      { step: 4, id: "bigidea", label: "Big Idea" } as unknown as CanvasArtefactEntry,
      { step: 4, id: "eq", label: "Essential Question", value: "Whose city?", state: "draft" },
      { step: 99, id: "nowhere", value: "off the canvas", state: "draft" },
    ]);
    expect(m.list().map((e) => e.id)).toEqual(["eq"]);
    // Every surviving entry carries the shape the renderer reads unconditionally.
    for (const e of m.list()) expect(typeof e.value).toBe("string");
  });

  it("drops a step entry whose depth is off the ladder rather than storing a bogus rung", () => {
    const m = new StepMirror();
    m.restore([
      { step: 4, depth: "deep", focus: false } as unknown as StepCoverageEntry,
      { step: 5, depth: "refined", focus: false },
    ]);
    expect(m.list().map((e) => e.step)).toEqual([5]);
    // `depthOf` never returns a value outside the ladder, so the one-rung guard of
    // cbe_step can never compute against rung -1.
    expect(STEP_DEPTH_LADDER).toContain(m.depthOf(4));
    expect(m.depthOf(4)).toBe("open");
  });

  it("drops an unknown maturity key and an out-of-range level", () => {
    const m = new MaturityMirror();
    m.seed({
      "societal-challenge": { current: 2, target: 3 },
      "made-up-criterion": { current: 1 },
      interdisciplinarity: { current: 7 },
    } as unknown as MaturitySnapshot);
    expect(Object.keys(m.snapshot()).sort()).toEqual(["societal-challenge"]);
  });

  it("skips out-of-range steps instead of storing them", () => {
    const m = new StepMirror();
    m.restore([
      { step: 0, depth: "rough", focus: false },
      { step: 11, depth: "rough", focus: false },
      { step: 4, depth: "refined", focus: false },
    ]);
    expect(m.list().map((e) => e.step)).toEqual([4]);
  });

  // Scenario: Loading materialises nothing that was never established (maturity)
  it("restores an unassessed criterion as unassessed and invents no aggregate", () => {
    const m = new MaturityMirror();
    m.seed({
      "societal-challenge": { current: 2, target: 3 },
      "stakeholder-involvement": { current: "unassessed" },
    });
    const snap = m.snapshot();
    expect(snap["stakeholder-involvement"]).toEqual({ current: "unassessed" });
    expect(snap["societal-challenge"]).toEqual({ current: 2, target: 3 });
    // No `overall` was stored, so none may appear.
    expect(snap.overall).toBeUndefined();
  });

  it("opens empty when the course has no stored reading", () => {
    const m = new MaturityMirror();
    m.seed({ "societal-challenge": { current: 2 } });
    m.seed(undefined); // course with no recorded reading
    expect(m.snapshot()).toEqual({});
    expect(m.isEmpty()).toBe(true);
  });

  // Scenario: A refused call leaves the record untouched — the mirrors are the
  // source the record is written from, so a refusal that moved a mirror would
  // silently reach disk on the next flush.
  it("leaves the mirrors untouched on a refused or foreign tool result", () => {
    const canvas = new CanvasMirror();
    canvas.restore([{ step: 4, id: "bigidea", label: "Big Idea", value: "kept", state: "done" }]);
    canvas.applyToolResult({ kind: "canvas-refusal" });
    expect(canvas.list()).toHaveLength(1);
    expect(canvas.get({ step: 4 }, "bigidea")?.value).toBe("kept");

    const maturity = new MaturityMirror();
    maturity.seed({ "societal-challenge": { current: 2 } });
    maturity.applyToolResult({ kind: "maturity-refusal" });
    expect(maturity.snapshot()["societal-challenge"]).toEqual({ current: 2 });
  });
});
