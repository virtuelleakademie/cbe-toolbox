/**
 * The agent run ends on a deferred-answer tool call (capability `agent-harness`,
 * Requirement: *The Agent Run Ends on a Deferred-Answer Tool Call*).
 *
 * UX-3 run of 2026-08-05: after the picker was already on screen, the model was
 * invoked once more on a placeholder tool result and spent the round trip on
 * thinking that concluded "I will finish my turn and wait." The cause is pi's
 * loop, which re-invokes the model after every tool batch unless the batch asks
 * to stop — `terminate` on the tool result is the documented lever.
 *
 * Scenarios covered:
 * - A rendered picker ends the run
 * - A rendered decision checklist ends the run
 * - A mirroring tool does not end the run
 * - Termination does not abort the run
 */
import { describe, it, expect } from "vitest";
import { createPickerTool, pickerTool } from "../src/picker-tool.js";
import { createDecisionChecklistTool, decisionChecklistTool } from "../src/decision-checklist-tool.js";
import { createCanvasTool } from "../src/canvas-tool.js";
import { createStepTool } from "../src/step-tool.js";
import { createMaturityTool } from "../src/maturity-tool.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";
import { MaturityMirror } from "../src/maturity-mirror.js";
import { PendingAnswerGate } from "../src/pending-answer-gate.js";

type ToolResult = { content: Array<{ type: string; text?: string }>; details?: unknown; terminate?: boolean };

function kindOf(r: ToolResult): string | undefined {
  return (r.details as { kind?: string } | undefined)?.kind;
}

/** Mirrors pi's own batch predicate (`shouldTerminateToolBatch` in
 * `@earendil-works/pi-agent-core/dist/agent-loop.js`): the run stops only when
 * EVERY finalized result in the assistant message's tool batch asks for it. */
function batchTerminates(results: ToolResult[]): boolean {
  return results.length > 0 && results.every((r) => r.terminate === true);
}

const PICKER = {
  question: 'Who represents the "Stakeholder" in your course?',
  options: [
    { id: "lecturer", label: "Lecturer (Product Owner)" },
    { id: "simulated", label: "Simulated persona" },
  ],
};

const CHECKLIST = {
  presentation: "checklist" as const,
  items: [
    { id: "big-idea", label: "Big Idea settled" },
    { id: "eq", label: "Essential Question settled" },
  ],
};

function runMaturity(tool: ReturnType<typeof createMaturityTool>, params: unknown) {
  return tool.execute("m1", params as never, undefined as never, undefined as never, {} as never);
}

// Scenario: A rendered picker ends the run
describe("A rendered picker ends the run", () => {
  it("requests early termination on its placeholder result", async () => {
    const res = (await pickerTool.execute("p1", PICKER)) as ToolResult;
    expect(res.terminate).toBe(true);
  });

  it("terminates with the gate bound too — the gate and the termination are independent", async () => {
    const tool = createPickerTool(new PendingAnswerGate());
    const res = (await tool.execute("p1", PICKER)) as ToolResult;
    expect(res.terminate).toBe(true);
  });

  it("terminates a batch consisting of the picker alone", async () => {
    const res = (await pickerTool.execute("p1", PICKER)) as ToolResult;
    expect(batchTerminates([res])).toBe(true);
  });
});

// Scenario: A rendered decision checklist ends the run
describe("A rendered decision checklist ends the run", () => {
  it("requests early termination on its placeholder result", async () => {
    const res = (await decisionChecklistTool.execute("k1", CHECKLIST)) as ToolResult;
    expect(res.terminate).toBe(true);
  });

  it("terminates with the gate bound too", async () => {
    const tool = createDecisionChecklistTool(new PendingAnswerGate());
    const res = (await tool.execute("k1", CHECKLIST)) as ToolResult;
    expect(res.terminate).toBe(true);
  });
});

// Scenario: A mirroring tool does not end the run
describe("A mirroring tool does not end the run", () => {
  it("cbe_canvas does not terminate — accepted or refused", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    const accepted = (await canvas.execute("c1", {
      step: 4,
      id: "bigidea",
      value: "Git in the times of AI",
    })) as ToolResult;
    const refused = (await canvas.execute("c2", { step: 4, id: "bigidea", value: "" })) as ToolResult;

    expect(kindOf(accepted)).toBe("canvas-update");
    expect(kindOf(refused)).toBe("canvas-refusal");
    expect(accepted.terminate).toBeUndefined();
    expect(refused.terminate).toBeUndefined();
  });

  it("cbe_step does not terminate — accepted or refused", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    const step = createStepTool(stepMirror);
    await canvas.execute("c1", { step: 4, id: "bigidea", value: "Git in the times of AI" });

    const accepted = (await step.execute("s1", { step: 4, depth: "rough" })) as ToolResult;
    const refused = (await step.execute("s2", { step: 4, depth: "detailed" })) as ToolResult; // two-rung jump

    expect(kindOf(accepted)).toBe("step-update");
    expect(kindOf(refused)).toBe("step-refusal");
    expect(accepted.terminate).toBeUndefined();
    expect(refused.terminate).toBeUndefined();
  });

  it("cbe_maturity does not terminate", async () => {
    const tool = createMaturityTool(new MaturityMirror());
    const res = (await runMaturity(tool, { criterion: "stakeholder-involvement", current: 1 })) as ToolResult;
    expect(kindOf(res)).toBe("maturity-update");
    expect(res.terminate).toBeUndefined();
  });

  it("a refused mirroring call keeps the run alive so the model can re-issue in the same turn", async () => {
    const stepMirror = new StepMirror();
    const step = createStepTool(stepMirror);
    const refused = (await step.execute("s1", { step: 2, depth: "detailed" })) as ToolResult;
    expect(batchTerminates([refused])).toBe(false);
  });
});

// Scenario: Termination does not abort the run
describe("Termination does not abort the run", () => {
  it("rides the ordinary result — content and details are delivered unchanged", async () => {
    const res = (await pickerTool.execute("p1", PICKER)) as ToolResult;

    expect(res.content.length).toBeGreaterThan(0);
    expect((res.details as { kind?: string }).kind).toBe("cbe_picker");
    expect((res.details as { spec?: unknown }).spec).toBeTruthy();
    // No error flag, no abort signalling — the loop's ordinary exit, not the failure path.
    expect(res).not.toHaveProperty("isError");
  });

  it("tells the model in the transcript that the turn ended here, not that it should keep working", async () => {
    const res = (await pickerTool.execute("p1", PICKER)) as ToolResult;
    const text = res.content.map((c) => c.text ?? "").join("");
    expect(text).toMatch(/turn ended/i);
    expect(text).toMatch(/next user message/i);
  });

  it("a batch mixing the picker with a mirroring result does NOT terminate", async () => {
    const stepMirror = new StepMirror();
    const canvas = createCanvasTool(new CanvasMirror(), stepMirror);
    const picker = (await pickerTool.execute("p1", PICKER)) as ToolResult;
    const mirror = (await canvas.execute("c1", {
      step: 4,
      id: "bigidea",
      value: "Git in the times of AI",
    })) as ToolResult;

    expect(batchTerminates([picker, mirror])).toBe(false);
  });
});
