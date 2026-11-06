/**
 * Tests for the host-side canvas artefact mirror after the ten-step restructure
 * (change `add-ten-step-design-flow`).
 *
 * Capability `agent-harness`, Requirement: Host-Side Canvas Artefact Mirror. Test
 * names mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { CanvasMirror, canvasDeletionNoticeLine, composePayloadWithDeletionNotices } from "../src/canvas-mirror.js";
import { createCanvasTool } from "../src/canvas-tool.js";

async function callTool(tool: ReturnType<typeof createCanvasTool>, params: Record<string, unknown>) {
  return tool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

describe("CanvasMirror — fed by valid cbe_canvas calls", () => {
  // Scenario: A set call upserts the mirror
  it("A set call upserts the mirror, replacing a prior entry for the same address/id", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 4, id: "bigidea", label: "Big Idea", value: "Resilience", state: "active" });
    expect(mirror.get({ step: 4 }, "bigidea")).toMatchObject({
      step: 4,
      id: "bigidea",
      label: "Big Idea",
      value: "Resilience",
      state: "active",
    });
    // A second set for the same address/id replaces the entry.
    await callTool(tool, { step: 4, id: "bigidea", value: "Water resilience", state: "done" });
    expect(mirror.get({ step: 4 }, "bigidea")).toMatchObject({ value: "Water resilience", state: "done" });
    expect(mirror.list().filter((e) => e.id === "bigidea")).toHaveLength(1);
  });

  // Scenario: Mirror entries carry the resolved step group
  it("Mirror entries carry the resolved step group (step-keyed and legacy phase-only)", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 3, id: "assessmentblueprint", value: "Evidence per outcome." });
    await callTool(tool, { phase: "engage", id: "bigidea", value: "Resilience" });
    await callTool(tool, { phase: "investigate", id: "is", value: "The investigate phase runs weeks 4-7." });
    // The step-keyed set records step 3; the legacy ladder set records its Step-4 home;
    // the legacy journey set records Step 6 + the resolved journey phase.
    expect(mirror.get({ step: 3 }, "assessmentblueprint")).toMatchObject({ step: 3 });
    expect(mirror.get({ step: 4 }, "bigidea")).toMatchObject({ step: 4, id: "bigidea" });
    expect(mirror.get({ step: 4 }, "bigidea")!.phase).toBeUndefined();
    expect(mirror.get({ step: 6, phase: "investigate" }, "is")).toMatchObject({ step: 6, phase: "investigate" });
  });

  // Scenario: A clear call removes the mirror entry
  it("A clear call removes the mirror entry, leaving transcript/sidecar state untouched", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 4, id: "bigidea", value: "Resilience" });
    expect(mirror.has({ step: 4 }, "bigidea")).toBe(true);
    // A legacy phase-only clear resolves to the same Step-4 home.
    await callTool(tool, { phase: "engage", id: "bigidea", action: "clear" });
    expect(mirror.has({ step: 4 }, "bigidea")).toBe(false);
    expect(mirror.size()).toBe(0);
  });

  // Scenario: Degenerate calls leave the mirror untouched
  it("Degenerate calls leave the mirror untouched", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 4, id: "bigidea", value: "Resilience" });
    const before = JSON.stringify(mirror.list());
    for (const bad of [
      { step: 4, id: "", value: "v" }, // empty id
      { step: 11, id: "x", value: "v" }, // out-of-range step
      { id: "x", value: "v" }, // unresolvable address
      { step: 3, id: "eq" }, // value-less set
      { step: 4, id: "eq", action: "wipe" }, // unrecognised action
      { step: 6, id: "x", value: "v" }, // step-6 set without a journey phase
    ]) {
      await callTool(tool, bad);
    }
    expect(JSON.stringify(mirror.list())).toBe(before);
  });
});

describe("CanvasMirror — UI-initiated deletion", () => {
  // Scenario: A UI-initiated deletion removes the mirror entry (also task 6.7)
  it("A UI-initiated deletion removes the mirror entry (incl. its resolved step group)", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 4, id: "bigidea", label: "Big Idea", value: "Resilience" });
    expect(mirror.has({ step: 4 }, "bigidea")).toBe(true);
    mirror.recordUiDeletion({ step: 4 }, "bigidea");
    expect(mirror.has({ step: 4 }, "bigidea")).toBe(false);
  });

  // Scenario: A UI-initiated deletion is disclosed to the agent on the next lecturer turn (task 6.7)
  it("A UI-initiated deletion is disclosed to the agent on the next lecturer turn", async () => {
    const mirror = new CanvasMirror();
    const tool = createCanvasTool(mirror);
    await callTool(tool, { step: 4, id: "bigidea", label: "Big Idea", value: "Resilience" });
    await callTool(tool, { step: 6, phase: "investigate", id: "is", label: "Investigate Sequence", value: "…" });

    mirror.recordUiDeletion({ step: 4 }, "bigidea");
    mirror.recordUiDeletion({ step: 6, phase: "investigate" }, "is");
    expect(mirror.hasPendingDeletions()).toBe(true);

    const lecturerText = "Let's rethink the framing.";
    const notices = mirror.drainDeletionNotices();
    expect(notices).toHaveLength(2);

    const payload = composePayloadWithDeletionNotices(notices, lecturerText);
    const lines = payload.split("\n");
    // One notice line per deleted artefact, naming step / phase / id / label.
    expect(lines[0]).toContain("[canvas-deletion]");
    expect(lines[0]).toContain("bigidea");
    expect(lines[0]).toContain("Big Idea");
    expect(lines[0]).toContain("step: 4");
    expect(lines[1]).toContain("is");
    expect(lines[1]).toContain("phase: investigate");
    // The lecturer's text is present, AFTER the notices (display/payload split, lossless).
    expect(payload.endsWith(lecturerText)).toBe(true);
    expect(payload.indexOf("[canvas-deletion]")).toBeLessThan(payload.indexOf(lecturerText));

    // The pending queue is drained — a subsequent turn carries no stale notice.
    expect(mirror.hasPendingDeletions()).toBe(false);
    expect(composePayloadWithDeletionNotices(mirror.drainDeletionNotices(), "next turn")).toBe("next turn");
  });

  it("uses the mirrored label in the notice when the caller omits one", () => {
    const mirror = new CanvasMirror();
    mirror.applySet({
      step: 6,
      phase: "investigate",
      id: "is",
      label: "Guiding Questions",
      value: "…",
      state: "draft",
    });
    mirror.recordUiDeletion({ step: 6, phase: "investigate" }, "is");
    const [notice] = mirror.drainDeletionNotices();
    expect(canvasDeletionNoticeLine(notice!)).toContain("Guiding Questions");
  });

  it("requeues notices drained for a payload the model never received, in order and ahead of newer ones", () => {
    const mirror = new CanvasMirror();
    mirror.recordUiDeletion({ step: 4 }, "erste");
    mirror.recordUiDeletion({ step: 5 }, "zweite");

    // Peek does not drain, so the prompt handler can hold what it is about to drain.
    expect(mirror.listPendingDeletions().map((n) => n.id)).toEqual(["erste", "zweite"]);
    expect(mirror.hasPendingDeletions()).toBe(true);

    const drained = mirror.drainDeletionNotices();
    expect(mirror.hasPendingDeletions()).toBe(false);

    mirror.requeueDeletionNotices(drained);
    mirror.recordUiDeletion({ step: 6 }, "dritte");
    expect(mirror.drainDeletionNotices().map((n) => n.id)).toEqual(["erste", "zweite", "dritte"]);
  });

  it("requeueing an empty batch is a no-op", () => {
    const mirror = new CanvasMirror();
    mirror.recordUiDeletion({ step: 4 }, "erste");
    mirror.requeueDeletionNotices([]);
    expect(mirror.drainDeletionNotices().map((n) => n.id)).toEqual(["erste"]);
  });

  it("empty queue leaves the payload unchanged", () => {
    expect(composePayloadWithDeletionNotices([], "just the lecturer text")).toBe("just the lecturer text");
  });
});

describe("CanvasMirror — wouldChange, the idempotence notion exposed before the write", () => {
  const entry = {
    step: 3,
    id: "assessmentblueprint",
    label: "Assessment Blueprint",
    value: "Portfolio plus Kolloquium",
    state: "draft",
  } as const;

  it("is true for an address the mirror does not hold yet", () => {
    expect(new CanvasMirror().wouldChange({ ...entry })).toBe(true);
  });

  it("is false for a re-push of an identical entry", () => {
    const mirror = new CanvasMirror();
    mirror.applySet({ ...entry });
    expect(mirror.wouldChange({ ...entry })).toBe(false);
  });

  it("is true when any compared field moves — value, label or state", () => {
    const mirror = new CanvasMirror();
    mirror.applySet({ ...entry });
    expect(mirror.wouldChange({ ...entry, value: "Portfolio" })).toBe(true);
    expect(mirror.wouldChange({ ...entry, label: "Pruefungsplan" })).toBe(true);
    expect(mirror.wouldChange({ ...entry, state: "done" })).toBe(true);
  });

  it("keys by the same resolved address applySet uses, journey phase included", () => {
    const mirror = new CanvasMirror();
    const is = { step: 6, phase: "investigate", id: "is", value: "Weeks 4-7.", state: "draft" } as const;
    mirror.applySet({ ...is });
    expect(mirror.wouldChange({ ...is })).toBe(false);
    expect(mirror.wouldChange({ ...is, phase: "act" })).toBe(true);
  });

  it("agrees with the settled-change observer applySet drives", () => {
    const mirror = new CanvasMirror();
    const reported: string[] = [];
    mirror.observe((c) => reported.push(c.kind));
    for (const candidate of [{ ...entry }, { ...entry }, { ...entry, value: "Kolloquium" }]) {
      const predicted = mirror.wouldChange(candidate);
      const before = reported.length;
      mirror.applySet(candidate);
      expect(reported.length > before).toBe(predicted);
    }
    expect(reported).toEqual(["canvas-set", "canvas-set"]);
  });
});
