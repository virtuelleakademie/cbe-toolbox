/**
 * Host-set step focus from the canvas UI — the mirror half.
 *
 * capability `agent-harness`, Requirement: *Host-Set Step Focus from the Canvas UI*.
 * Test names mirror the spec scenarios. The end-to-end chain (click → mirror mutated →
 * notice queued → drained into the next turn) is guarded in
 * `packages/app/tests/step-focus-host-channel.test.ts`, where the prompt handler lives.
 */
import { describe, it, expect } from "vitest";
import { StepMirror, composePayloadWithFocusNotice, stepFocusNoticeLine, type StepDepth } from "../src/step-mirror.js";

describe("Host-Set Step Focus from the Canvas UI", () => {
  // Scenario: A UI step selection moves the focus in the host mirror at once
  it("moves the focus in the host mirror at once and keeps it exclusive", () => {
    const m = new StepMirror();
    m.applyUpdate(2, { focus: true });
    expect(m.focused()).toBe(2);

    m.recordUiFocus(7, "Activities");

    expect(m.focused()).toBe(7);
    expect(m.list().filter((e) => e.focus)).toHaveLength(1);
  });

  // Scenario: A UI step selection leaves every coverage depth untouched
  it("leaves every coverage depth untouched and reports no depth transition", () => {
    const m = new StepMirror();
    const transitions: Array<{ step: number; from: StepDepth; to: StepDepth }> = [];
    m.applyUpdate(2, { depth: "refined", focus: true });
    m.observe((c) => transitions.push(c));

    m.recordUiFocus(7, "Activities");

    expect(m.depthOf(7)).toBe("open");
    expect(m.depthOf(2)).toBe("refined");
    // Moving attention is not a settled design change.
    expect(transitions).toEqual([]);
  });

  // Scenario: The next lecturer turn discloses the selection to the model
  it("discloses the selection as a machine-readable line ahead of the lecturer's text", () => {
    const m = new StepMirror();
    m.recordUiFocus(7, "Activities");

    const composed = composePayloadWithFocusNotice(m.drainFocusNotice(), "Und wie fange ich da an?");

    expect(composed.startsWith("[step-focus]")).toBe(true);
    expect(composed).toContain("step 7");
    expect(composed).toContain("Activities");
    expect(composed).toContain("do NOT emit a cbe_step call");
    expect(composed.endsWith("Und wie fange ich da an?")).toBe(true);
  });

  it("leaves the payload unchanged when nothing is pending", () => {
    expect(composePayloadWithFocusNotice(null, "Guten Morgen.")).toBe("Guten Morgen.");
  });

  it("names the bare step number when no label was supplied", () => {
    expect(stepFocusNoticeLine({ step: 3 })).toContain("selected step 3 in the canvas UI");
  });

  // Scenario: The notice is drained exactly once
  it("drains the notice exactly once", () => {
    const m = new StepMirror();
    m.recordUiFocus(7, "Activities");

    expect(m.drainFocusNotice()).toEqual({ step: 7, label: "Activities" });
    expect(m.drainFocusNotice()).toBeNull();
    expect(m.hasPendingFocus()).toBe(false);
  });

  // Scenario: A second selection supersedes the pending notice
  it("supersedes the pending notice with a second selection", () => {
    const m = new StepMirror();
    m.recordUiFocus(7, "Activities");
    m.recordUiFocus(4, "Challenge");

    expect(m.focused()).toBe(4);
    // Exactly ONE notice, naming the current step — not an accumulating queue.
    expect(m.drainFocusNotice()).toEqual({ step: 4, label: "Challenge" });
    expect(m.drainFocusNotice()).toBeNull();
  });

  // Scenario: An undelivered notice returns for the retry
  it("returns an undelivered notice for the retry", () => {
    const m = new StepMirror();
    m.recordUiFocus(7, "Activities");

    const held = m.pendingFocus();
    m.drainFocusNotice(); // composed into a payload the model never received
    m.requeueFocusNotice(held);

    expect(m.hasPendingFocus()).toBe(true);
    expect(m.drainFocusNotice()).toEqual({ step: 7, label: "Activities" });
    // Exactly once — the requeue does not duplicate it.
    expect(m.drainFocusNotice()).toBeNull();
  });

  // Scenario: A newer selection is not overwritten by a requeued one
  it("does not overwrite a newer selection with a requeued one", () => {
    const m = new StepMirror();
    m.recordUiFocus(7, "Activities");
    const held = m.pendingFocus();
    m.drainFocusNotice();

    m.recordUiFocus(4, "Challenge"); // the lecturer clicked again before the requeue
    m.requeueFocusNotice(held);

    expect(m.drainFocusNotice()).toEqual({ step: 4, label: "Challenge" });
  });

  // Scenario: A selection outside the step range is a safe no-op
  it("is a safe no-op for a step outside the range", () => {
    const m = new StepMirror();
    m.applyUpdate(2, { depth: "rough", focus: true });

    m.recordUiFocus(14, "Nowhere");
    m.recordUiFocus(0);
    m.recordUiFocus(3.5 as number);

    expect(m.focused()).toBe(2);
    expect(m.hasPendingFocus()).toBe(false);
    expect(composePayloadWithFocusNotice(m.drainFocusNotice(), "Weiter.")).toBe("Weiter.");
  });
});
