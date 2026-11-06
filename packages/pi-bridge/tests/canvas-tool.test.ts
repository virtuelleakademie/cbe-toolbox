/**
 * Tests for the fire-and-forget `cbe_canvas` generative-UI tool after the ten-step
 * restructure (change `add-ten-step-design-flow`).
 *
 * Capability `agent-harness`, Requirement: cbe_canvas Generative-UI Tool. Test names
 * mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import { canvasTool, CanvasParamsSchema } from "../src/canvas-tool.js";

type CanvasResult = Awaited<ReturnType<typeof canvasTool.execute>>;

async function run(params: Record<string, unknown>): Promise<CanvasResult> {
  return canvasTool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

function details(r: CanvasResult): Record<string, unknown> {
  return r.details as Record<string, unknown>;
}

describe("cbe_canvas — fire-and-forget canvas update", () => {
  // Scenario: cbe_canvas is fire-and-forget
  it("returns a synchronous canvas-update ack, not a deferred answer", async () => {
    const r = await run({ step: 4, id: "bigidea", label: "Big Idea", value: "Resilience", state: "active" });
    expect(details(r)).toMatchObject({
      kind: "canvas-update",
      action: "set",
      step: 4,
      id: "bigidea",
      label: "Big Idea",
      value: "Resilience",
      state: "active",
    });
    // It does NOT instruct the model to wait for a lecturer answer (unlike picker/checklist).
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toMatch(/next user|wait for/i);
  });

  it("defaults the state to draft when omitted", async () => {
    const r = await run({ step: 2, id: "learningoutcomes", value: "Three intended outcomes drafted." });
    expect(details(r)).toMatchObject({ kind: "canvas-update", state: "draft" });
  });

  // Scenario: A step-keyed set addresses its step group
  it("A step-keyed set addresses its step group", async () => {
    const r = await run({ step: 3, id: "assessmentblueprint", value: "Evidence per outcome." });
    expect(details(r)).toMatchObject({ kind: "canvas-update", action: "set", step: 3, id: "assessmentblueprint" });
    // A phase-less step-keyed set carries no journey phase.
    expect(details(r).phase).toBeUndefined();
  });

  // Scenario: Phase-only legacy calls remain valid and resolve per the legacy mapping
  it("Phase-only legacy calls remain valid and resolve per the legacy mapping", async () => {
    // Seeded challenge-ladder id → its Step-4 home (phase-only, no step).
    const ladder = await run({ phase: "engage", id: "bigidea", value: "Resilience" });
    expect(details(ladder)).toMatchObject({ kind: "canvas-update", step: 4, id: "bigidea" });
    expect(details(ladder).phase).toBeUndefined(); // Step 4 is non-journey — no phase carried
    // Non-ladder id → Step 6's matching journey element.
    const journey = await run({ phase: "investigate", id: "is", value: "Investigate runs weeks 4-7." });
    expect(details(journey)).toMatchObject({ kind: "canvas-update", step: 6, phase: "investigate", id: "is" });
  });

  // Scenario: Reflect is a valid journey phase
  it("Reflect is a valid journey phase", async () => {
    const withStep = await run({
      step: 6,
      phase: "reflect",
      id: "reflectionplan",
      value: "Final reflection + showcase.",
    });
    expect(details(withStep)).toMatchObject({ kind: "canvas-update", step: 6, phase: "reflect", id: "reflectionplan" });
    const legacyReflect = await run({ phase: "reflect", id: "reflectionplan", value: "Final reflection." });
    expect(details(legacyReflect)).toMatchObject({ kind: "canvas-update", step: 6, phase: "reflect" });
  });

  // Scenario: Omitted action defaults to set
  it("Omitted action defaults to set", async () => {
    const r = await run({ step: 4, id: "bigidea", value: "Resilience" });
    expect(details(r)).toMatchObject({ kind: "canvas-update", action: "set", value: "Resilience" });
    // Missing value on an action-less payload is still refused (set-validation).
    const refused = await run({ step: 4, id: "bigidea" });
    expect(details(refused).kind).toBe("canvas-refusal");
  });

  // Scenario: A clear call is acknowledged without a value
  it("A clear call is acknowledged without a value", async () => {
    const r = await run({ step: 4, id: "bigidea", action: "clear" });
    expect(details(r)).toMatchObject({ kind: "canvas-update", action: "clear", step: 4, id: "bigidea" });
    expect(details(r).value).toBeUndefined();
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toMatch(/next user|wait for/i);
    // The legacy phase-only clear still resolves.
    const legacy = await run({ phase: "engage", id: "bigidea", action: "clear" });
    expect(details(legacy)).toMatchObject({ kind: "canvas-update", action: "clear", step: 4, id: "bigidea" });
  });

  it("ignores a value present on a clear call", async () => {
    const r = await run({ step: 4, id: "bigidea", action: "clear", value: "should be ignored" });
    expect(details(r).action).toBe("clear");
    expect(details(r).value).toBeUndefined();
  });

  // Scenario: A degenerate step or phase value is a safe no-op
  it("A degenerate step or phase value is a safe no-op", async () => {
    for (const bad of [
      { step: 11, id: "x", value: "v" }, // out-of-range step
      { step: 0, id: "x", value: "v" }, // out-of-range step
      { phase: "nope", id: "x", value: "v" }, // unrecognised phase, no step
      { step: 6, id: "x", value: "v" }, // step-6 set WITHOUT a valid phase
      { id: "x", value: "v" }, // neither a valid step nor a known phase
    ]) {
      const r = await run(bad);
      expect(details(r).kind).toBe("canvas-refusal");
      expect((r.content[0] as { text: string }).text).not.toMatch(/^Canvas updated/);
    }
  });

  // Scenario: A degenerate cbe_canvas payload is a safe no-op
  it("A degenerate cbe_canvas payload is a safe no-op", async () => {
    for (const bad of [
      { step: 3, id: "x" }, // missing value on a set
      { step: 3, id: "", value: "v" }, // empty id
      { step: 3, id: "x", value: "   " }, // whitespace-only value
      { id: "x", value: "v" }, // unresolvable address
    ]) {
      const r = await run(bad);
      expect(details(r).kind).toBe("canvas-refusal");
    }
  });

  // Scenario: A degenerate clear payload is a safe no-op
  it("A degenerate clear payload is a safe no-op", async () => {
    for (const bad of [
      { step: 4, id: "", action: "clear" }, // empty id
      { phase: "nope", id: "x", action: "clear" }, // unresolvable address
      { step: 4, id: "x", action: "wipe" }, // unrecognised action string
      { step: 6, id: "x", action: "clear" }, // step-6 clear without a valid phase
    ]) {
      const r = await run(bad);
      expect(details(r).kind).toBe("canvas-refusal");
    }
  });
});

describe("cbe_canvas — schema contract", () => {
  it("admits value-less, phase-less and step-less payloads at the schema layer", () => {
    // The declared schema must NOT reject these before execute() runs — the load-bearing
    // checks (addressability, set-value) live in the defensive validator.
    expect(Value.Check(CanvasParamsSchema, { step: 4, id: "bigidea", action: "clear" })).toBe(true);
    expect(Value.Check(CanvasParamsSchema, { step: 3, id: "assessmentblueprint" })).toBe(true); // value-less set
    expect(Value.Check(CanvasParamsSchema, { phase: "engage", id: "bigidea" })).toBe(true); // legacy, no step
    expect(Value.Check(CanvasParamsSchema, { step: 6, phase: "reflect", id: "x", value: "v" })).toBe(true);
  });

  it("requires only id — step, phase and value are optional at the schema level", () => {
    const schema = CanvasParamsSchema as unknown as { required?: string[] };
    expect(schema.required).toContain("id");
    expect(schema.required ?? []).not.toContain("value");
    expect(schema.required ?? []).not.toContain("step");
    expect(schema.required ?? []).not.toContain("phase");
  });

  it("is named cbe_canvas", () => {
    expect(canvasTool.name).toBe("cbe_canvas");
  });
});

/**
 * Capability `agent-harness`, Requirement: *Canvas Artefact Values Are Structured
 * Markdown*. Test names mirror the spec scenarios.
 *
 * These are CONTENT assertions on the `value` parameter description, not a snapshot —
 * the wording may be re-cut, the rule may not disappear. The description is the ONE home
 * for it (Requirement: *Instruction Channel Boundary*): it is how this tool is operated,
 * so `skills/cbe/SKILL.md` may not restate it, and `tool-description-coverage.test.ts`
 * holds the whole-channel budget the addition had to fit inside.
 *
 * The requirement's fourth scenario — *A multi-part artefact reaches the card as
 * structured Markdown* — is about what a MODEL composes and cannot be decided by any
 * model-free test. It is measured by the eval instead: checkpoint `10e` in
 * `evaluation/cbe-skill/scenarios/10-canvas-recording.md`.
 */
describe("cbe_canvas — the value is structured Markdown", () => {
  const valueDescription = (CanvasParamsSchema as unknown as { properties: { value: { description: string } } })
    .properties.value.description;

  // Scenario: The value parameter description names the form obligation
  it("The value parameter description names the form obligation", () => {
    expect(valueDescription).toMatch(/WRITE IT AS MARKDOWN/);
    // The palette the renderer actually supports, named element by element rather than
    // left to "use Markdown" — a lead line, lists, tables, emphasis.
    expect(valueDescription).toMatch(/lead line/i);
    expect(valueDescription).toMatch(/bullet list for an enumeration/i);
    expect(valueDescription).toMatch(/table where the artefact is a mapping/i);
    expect(valueDescription).toMatch(/emphasis on the term that carries the decision/i);
    // …and it still says what the content IS, which the form half only supplements.
    expect(valueDescription).toMatch(/what the lecturer actually decided/i);
  });

  // Scenario: The supported palette and the HTML bound are named
  it("The supported palette and the HTML bound are named", () => {
    expect(valueDescription).toMatch(/GitHub-flavoured Markdown/i);
    // `MarkdownView` runs with `skipHtml`: an HTML element is dropped WITH its content
    // and without an error, so the loss has to be named, not merely discouraged.
    expect(valueDescription).toMatch(/DROPS raw HTML with its content/i);
    expect(valueDescription).toMatch(/<br>/);
    expect(valueDescription).toMatch(/<table>/);
  });

  // Scenario: Structure never licenses invented content
  it("Structure never licenses invented content", () => {
    expect(valueDescription).toMatch(/FORM SERVES SUBSTANCE, never the reverse/i);
    expect(valueDescription).toMatch(/a one-line decision stays one line/i);
    expect(valueDescription).toMatch(/no bullet or table row is ever invented to complete a structure/i);
    // The unsettled-content bound predates the Markdown re-cut and must survive it.
    // Reworded by `settle-only-on-a-lecturer-decision` (2026-08-18): it used to read
    // "never a proposal the lecturer has not accepted", whose converse reads as a licence
    // for an accepted one. It now names the value's SOURCE, so acceptance changes nothing.
    expect(valueDescription).toMatch(/NEVER MIRROR WHAT THE LECTURER HAS NOT SETTLED/);
    expect(valueDescription).toMatch(/never your own formulation, accepted or not/i);
    expect(valueDescription).not.toMatch(/proposal the lecturer has not accepted/i);
  });

  // Scenario: The rule does not add a validation gate
  it("The rule does not add a validation gate", async () => {
    // A single undifferentiated prose block — exactly what the description now steers
    // away from — is still accepted, so the change is provably instruction-only.
    const prose = await run({
      step: 2,
      id: "learningoutcomes",
      value: "Die Studierenden analysieren Lieferketten und bewerten Massnahmen zur Emissionsreduktion.",
    });
    expect(details(prose)).toMatchObject({
      kind: "canvas-update",
      action: "set",
      step: 2,
      id: "learningoutcomes",
    });
    expect((prose.content[0] as { text: string }).text).toMatch(/^Canvas updated/);

    // …and a structured value is accepted on exactly the same path — no branch on form.
    const structured = await run({
      step: 2,
      id: "learningoutcomes",
      value: "Drei Lernergebnisse:\n\n- analysieren\n- bewerten\n- entwerfen",
    });
    expect(details(structured).kind).toBe("canvas-update");
    expect(details(structured).value).toContain("- analysieren");
  });
});
