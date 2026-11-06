/**
 * Tests for the fire-and-forget `cbe_step` generative-UI tool.
 *
 * Capability `agent-harness`, Requirement: cbe_step Generative-UI Tool. Test names
 * mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { stepTool, StepParamsSchema } from "../src/step-tool.js";

type StepResult = Awaited<ReturnType<typeof stepTool.execute>>;

async function run(params: Record<string, unknown>): Promise<StepResult> {
  return stepTool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

function details(r: StepResult): Record<string, unknown> {
  return r.details as Record<string, unknown>;
}

describe("cbe_step — fire-and-forget step-coverage update", () => {
  it("is named cbe_step", () => {
    expect(stepTool.name).toBe("cbe_step");
  });

  // Scenario: cbe_step is fire-and-forget
  it("cbe_step is fire-and-forget", async () => {
    const r = await run({ step: 2, depth: "rough" });
    expect(details(r)).toMatchObject({ kind: "step-update", step: 2, depth: "rough" });
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toMatch(/next user|wait for/i);
  });

  it("carries a focus transition", async () => {
    const r = await run({ step: 4, focus: true });
    expect(details(r)).toMatchObject({ kind: "step-update", step: 4, focus: true });
  });

  it("carries both depth and focus when present, and transports (but keeps) the note", async () => {
    const r = await run({ step: 5, depth: "refined", focus: true, note: "long free text" });
    expect(details(r)).toMatchObject({
      kind: "step-update",
      step: 5,
      depth: "refined",
      focus: true,
      note: "long free text",
    });
  });

  // Scenario: A degenerate cbe_step payload is a safe no-op
  it("A degenerate cbe_step payload is a safe no-op", async () => {
    for (const bad of [
      { step: 11, depth: "rough" }, // step outside 1..10
      { step: 0, focus: true }, // step outside 1..10
      { step: 3, depth: "deep" }, // unknown depth value
      { step: 3 }, // neither depth nor focus present
      { depth: "rough" }, // missing step
    ]) {
      const r = await run(bad);
      expect(details(r).kind).toBe("step-refusal");
      expect((r.content[0] as { text: string }).text).not.toMatch(/^Step \d+ updated/);
    }
  });

  it("depth may move DOWN (not a ratchet) — the tool accepts a lower depth", async () => {
    const r = await run({ step: 3, depth: "rough" }); // e.g. refined → rough after a reopen
    expect(details(r)).toMatchObject({ kind: "step-update", step: 3, depth: "rough" });
  });
});

describe("cbe_step — schema contract", () => {
  it("requires step; depth/focus/note are optional at the schema level", () => {
    const schema = StepParamsSchema as unknown as { required?: string[] };
    expect(schema.required).toContain("step");
    expect(schema.required ?? []).not.toContain("depth");
    expect(schema.required ?? []).not.toContain("focus");
    expect(schema.required ?? []).not.toContain("note");
  });

  it("admits a depth-only and a focus-only payload at the schema layer", () => {
    expect(Value.Check(StepParamsSchema, { step: 2, depth: "rough" })).toBe(true);
    expect(Value.Check(StepParamsSchema, { step: 2, focus: true })).toBe(true);
    // step out of range is rejected by the schema's integer bounds.
    expect(Value.Check(StepParamsSchema, { step: 11, depth: "rough" })).toBe(false);
  });
});
