/**
 * Tests for the fire-and-forget `cbe_maturity` generative-UI tool.
 *
 * Capability `agent-harness`, Requirement: cbe_maturity Generative-UI Tool.
 * Test names mirror the spec scenarios.
 */
import { describe, it, expect } from "vitest";
import { Value } from "typebox/value";
import {
  createMaturityTool,
  maturityTool,
  MaturityParamsSchema,
  validateMaturityParams,
  MATURITY_FREETEXT_MAX,
} from "../src/maturity-tool.js";
import { MaturityMirror, MATURITY_CRITERIA } from "../src/maturity-mirror.js";

type MaturityResult = Awaited<ReturnType<typeof maturityTool.execute>>;

async function run(tool: typeof maturityTool, params: unknown): Promise<MaturityResult> {
  return tool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

function details(r: MaturityResult): Record<string, unknown> {
  return r.details as Record<string, unknown>;
}

function ackText(r: MaturityResult): string {
  return (r.content[0] as { text: string }).text;
}

/** A full establishment batch: three assessed criteria, four unassessed, one overall. */
function establishmentBatch(): Record<string, unknown> {
  return {
    readings: [
      { criterion: "societal-challenge", current: 2, target: 2 },
      {
        criterion: "stakeholder-involvement",
        current: 1,
        target: 2,
        hint: "Add a defined stakeholder feedback moment.",
      },
      { criterion: "interdisciplinarity", current: 1, uncertain: true },
      { criterion: "student-agency", current: "unassessed" },
      { criterion: "iterative-process", current: "unassessed" },
      { criterion: "value-reflection", current: "unassessed" },
      { criterion: "societal-impact", current: "unassessed" },
      { criterion: "overall", current: 1, target: 2, note: "Only 3 of 7 criteria assessed." },
    ],
  };
}

describe("cbe_maturity — fire-and-forget maturity mirroring", () => {
  it("is named cbe_maturity", () => {
    expect(maturityTool.name).toBe("cbe_maturity");
  });

  // Scenario: cbe_maturity is fire-and-forget and does not over-claim persistence
  it("cbe_maturity is fire-and-forget and does not over-claim persistence", async () => {
    const r = await run(maturityTool, {
      criterion: "stakeholder-involvement",
      current: 1,
      target: 2,
      hint: "Add a defined stakeholder feedback moment.",
    });
    expect(details(r)).toMatchObject({
      kind: "maturity-update",
      criterion: "stakeholder-involvement",
      current: 1,
      target: 2,
      hint: "Add a defined stakeholder feedback moment.",
    });
    const text = ackText(r);
    // Synchronous acknowledgement, no deferred lecturer answer.
    expect(text).not.toMatch(/next user|wait for|will answer/i);
    // Recorded for display — never a beyond-session persistence claim.
    expect(text).toMatch(/recorded/i);
    expect(text).not.toMatch(/saved|persist|stored|profile store|across sessions|next session|beyond/i);
  });

  // Scenario: Batched establishment raster is validated atomically (accept side)
  it("accepts a batched raster covering all seven criteria plus one overall", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, establishmentBatch());
    const d = details(r);
    expect(d.kind).toBe("maturity-update");
    expect((d.readings as unknown[]).length).toBe(8);
    const snap = mirror.snapshot();
    expect(snap["stakeholder-involvement"]).toEqual({
      current: 1,
      target: 2,
      hint: "Add a defined stakeholder feedback moment.",
    });
    expect(snap["student-agency"]).toEqual({ current: "unassessed" });
    // The batch's `overall.current` is dropped — the aggregate is host-derived
    // (Requirement: *Host-Derived Overall Maturity Level*) — while the target
    // and the limitation note it carried are recorded unchanged.
    expect(snap.overall).toEqual({ target: 2, note: "Only 3 of 7 criteria assessed." });
  });

  // Scenario: Batched establishment raster is validated atomically (reject side)
  it("rejects a batch with one bad record as a whole — nothing applied", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const batch = establishmentBatch();
    (batch.readings as Record<string, unknown>[])[2] = { criterion: "team-teaching", current: 1 }; // unknown key
    const r = await run(tool, batch);
    expect(details(r).kind).toBe("maturity-refusal");
    expect(ackText(r)).toMatch(/invalid/i);
    expect(mirror.isEmpty()).toBe(true); // no record of the invalid batch is applied
  });

  // Scenario: A degenerate cbe_maturity payload is a safe no-op
  it("A degenerate cbe_maturity payload is a safe no-op", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const missingKeyBatch = establishmentBatch();
    (missingKeyBatch.readings as unknown[]).splice(0, 1); // drops societal-challenge
    const duplicateKeyBatch = establishmentBatch();
    (duplicateKeyBatch.readings as Record<string, unknown>[])[3] = { criterion: "societal-challenge", current: 1 };
    const degenerate: unknown[] = [
      { criterion: "team-teaching", current: 1 }, // unknown criterion
      { criterion: "student-agency", current: 5 }, // out-of-range level
      { criterion: "student-agency", target: 0 }, // out-of-range target
      { criterion: "overall", current: "unassessed" }, // "unassessed" on overall
      { criterion: "overall", current: 1, uncertain: true }, // uncertain on overall
      { criterion: "overall", current: 1, hint: "x" }, // hint on overall
      { criterion: "student-agency", current: "unassessed", uncertain: true }, // uncertain without numeric current
      { criterion: "student-agency", target: 2, uncertain: true }, // uncertain on a target-only payload
      { criterion: "student-agency", current: 1, note: "x" }, // note off the overall record
      { criterion: "student-agency", current: 1, hint: "bad\u0000control" }, // C0 control character
      { criterion: "student-agency", current: 1, hint: "bidi \u202E attack" }, // bidi override
      { criterion: "student-agency", current: 1, hint: "zero\u200Bwidth" }, // zero-width
      { criterion: "student-agency", current: 1, hint: "x".repeat(MATURITY_FREETEXT_MAX + 1) }, // over-long
      { criterion: "student-agency" }, // no updatable field
      { criterion: "student-agency", uncertain: true, hint: "x" }, // still no updatable field
      missingKeyBatch, // batch missing a criterion key
      duplicateKeyBatch, // batch duplicating a criterion key
      { ...establishmentBatch(), criterion: "student-agency", current: 1 }, // batch mixed with top-level fields
      { readings: "not-an-array" },
      {},
      null,
      undefined,
    ];
    for (const bad of degenerate) {
      const r = await run(tool, bad);
      expect(details(r).kind, JSON.stringify(bad)?.slice(0, 80)).toBe("maturity-refusal");
      expect(ackText(r)).toMatch(/no maturity reading recorded/i);
    }
    expect(mirror.isEmpty()).toBe(true); // no partial state, nothing corrupted
  });

  // Scenario: Single updates merge per-field; hint and uncertainty do not go stale
  it("Single updates merge per-field; hint and uncertainty do not go stale", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    await run(tool, {
      criterion: "stakeholder-involvement",
      current: 1,
      target: 2,
      uncertain: true,
      hint: "Add a defined stakeholder feedback moment.",
    });
    await run(tool, { criterion: "stakeholder-involvement", current: 2 });
    // target persists (absent from the call); hint/uncertain cleared (absent means cleared)
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
    await run(tool, { criterion: "stakeholder-involvement", target: null });
    // target: null clears without touching current
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2 });
  });

  // Scenario: Downward transitions are accepted (no ratchet)
  it("Downward transitions are accepted (no ratchet)", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    await run(tool, { criterion: "stakeholder-involvement", current: 2, target: 2 });
    const down = await run(tool, { criterion: "stakeholder-involvement", current: "unassessed" });
    expect(details(down).kind).toBe("maturity-update");
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: "unassessed", target: 2 });
    const targetDown = await run(tool, { criterion: "stakeholder-involvement", current: 1, target: 1 });
    expect(details(targetDown).kind).toBe("maturity-update");
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 1, target: 1 });
  });

  // Scenario: Validated result details reach the host per conversation (tool half:
  // the synchronous result carries exactly the validated params as details — the
  // per-session attribution of the tool_execution event is asserted renderer-side).
  it("returns the validated params as structured details, synchronously", async () => {
    const r = await run(maturityTool, { criterion: "value-reflection", current: 1, target: 2, uncertain: true });
    expect(details(r)).toEqual({
      kind: "maturity-update",
      criterion: "value-reflection",
      current: 1,
      target: 2,
      uncertain: true,
    });
  });

  it("works without a bound mirror (headless / unit-test instance)", async () => {
    const r = await run(maturityTool, { criterion: "societal-impact", current: 1 });
    expect(details(r).kind).toBe("maturity-update");
  });
});

// Change `confront-ambition-maturity-divergence` — the deterministic half: the
// acknowledgement carries the host-computed divergence summary so the review's
// ambition-vs-achievement confrontation quotes it instead of re-deriving the gap.
describe("cbe_maturity — host-computed divergence summary in the acknowledgement", () => {
  /** A raster with every divergence state represented exactly as the spec scenario
   * describes it: two below, one at, one above, three unassessed, and an `overall`
   * record carrying its limitation note but no target — so the host-derived
   * aggregate has nothing to be measured against. */
  function mixedRaster(): Record<string, unknown> {
    return {
      readings: [
        { criterion: "societal-challenge", current: 2, target: 2 }, // at
        { criterion: "stakeholder-involvement", current: 1, target: 2 }, // below
        { criterion: "interdisciplinarity", current: 1, target: 3 }, // below
        { criterion: "student-agency", current: 3, target: 2 }, // above
        { criterion: "iterative-process", current: "unassessed" },
        { criterion: "value-reflection", current: "unassessed" },
        { criterion: "societal-impact", current: "unassessed" },
        { criterion: "overall", note: "Only 4 of 7 criteria assessed." }, // no-target
      ],
    };
  }

  // Scenario: The acknowledgement carries the host-computed divergence summary
  it("carries the host-computed divergence summary in the acknowledgement", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, mixedRaster());
    const text = ackText(r);

    expect(text).toMatch(/divergence/i);
    // Per-state counts over the post-update raster, each key classified exactly once.
    expect(text).toContain("below 2 (stakeholder-involvement, interdisciplinarity)");
    expect(text).toContain("at 1 (societal-challenge)");
    expect(text).toContain("above 1 (student-agency)");
    expect(text).toContain("unassessed 3 (iterative-process, value-reflection, societal-impact)");
    expect(text).toContain("no-target 0");
    // The `overall` record is the raster's aggregate, not an eighth criterion: it
    // is classified by the same rules but reported in its own clause, so it can
    // never inflate the shortfall tally the confrontation quotes.
    expect(text).toMatch(/aggregate `overall` record is classified separately[^.]*: no-target\./i);
    expect(text.slice(0, text.indexOf("The aggregate"))).not.toContain("overall");
    // Exactly one state per recorded key: no key is listed twice, none is missing
    // (no criterion key is a substring of another, so a plain count is exact).
    for (const key of [...MATURITY_CRITERIA, "overall"]) {
      expect(text.split(key).length - 1, `${key} must be classified exactly once`).toBe(1);
    }
    // Pure arithmetic: no model-supplied free text is restated.
    expect(text).not.toContain("Only 4 of 7 criteria assessed.");
  });

  it("classifies from the post-update mirror, not from the triggering call's params", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    await run(tool, mixedRaster());
    // A single transition that closes one of the two gaps: the summary must report
    // the WHOLE raster after the update, not just the criterion this call carried.
    const r = await run(tool, { criterion: "stakeholder-involvement", current: 2 });
    const text = ackText(r);
    expect(text).toContain("below 1 (interdisciplinarity)");
    expect(text).toContain("at 2 (societal-challenge, stakeholder-involvement)");
    expect(text).toContain("unassessed 3");
  });

  it("still reports the aggregate when the raster holds only an overall record", async () => {
    // Separating the aggregate must not make an overall-only raster classify as
    // nothing at all — the summary is still carried, with empty criterion buckets.
    // With no criterion assessed there is no derived level, so the aggregate is
    // `unassessed`: an ambition on record without a reading yet, which is exactly
    // the state before the coherence gate.
    const tool = createMaturityTool(new MaturityMirror());
    const text = ackText(await run(tool, { criterion: "overall", target: 2 }));
    expect(text).toMatch(/divergence/i);
    expect(text).toContain("below 0");
    expect(text).toMatch(/aggregate `overall` record is classified separately[^.]*: unassessed\./i);
  });

  // Scenario: The divergence summary is omitted rather than faked without a mirror
  it("omits rather than fakes the divergence summary without a mirror", async () => {
    const r = await run(maturityTool, { criterion: "stakeholder-involvement", current: 1, target: 2 });
    const text = ackText(r);
    expect(details(r).kind).toBe("maturity-update"); // the call still succeeds
    expect(text).not.toMatch(/divergence/i);
    expect(text).not.toMatch(/\bbelow\b|\bno-target\b/i); // no empty or placeholder summary
  });

  // Scenario: The divergence summary does not over-claim persistence
  it("does not over-claim persistence in the divergence summary", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const text = ackText(await run(tool, mixedRaster()));
    expect(text).toMatch(/this session's recorded raster/i);
    expect(text).not.toMatch(/saved|persist|stored|profile store|across sessions|next session|beyond the session/i);
  });

  // Regression: the summary is acknowledgement TEXT only — the validated details
  // the renderer consumes must be byte-identical with and without a mirror.
  it("leaves the validated details payload unchanged", async () => {
    const params = { criterion: "stakeholder-involvement", current: 1, target: 2, hint: "Add a feedback moment." };
    const withMirror = await run(createMaturityTool(new MaturityMirror()), params);
    const withoutMirror = await run(maturityTool, params);
    expect(details(withMirror)).toEqual(details(withoutMirror));
    expect(details(withMirror)).toEqual({
      kind: "maturity-update",
      criterion: "stakeholder-involvement",
      current: 1,
      target: 2,
      hint: "Add a feedback moment.",
    });
  });
});

describe("cbe_maturity — validator unit surface", () => {
  it("validateMaturityParams distinguishes batch from single calls", () => {
    const batch = validateMaturityParams(establishmentBatch());
    expect(batch.ok && batch.batch).toBe(true);
    const single = validateMaturityParams({ criterion: "societal-challenge", current: 1 });
    expect(single.ok && !single.batch).toBe(true);
  });

  it("caps hint/note at MATURITY_FREETEXT_MAX and accepts text at the cap", () => {
    const atCap = validateMaturityParams({
      criterion: "societal-challenge",
      current: 1,
      target: 2,
      hint: "y".repeat(MATURITY_FREETEXT_MAX),
    });
    expect(atCap.ok).toBe(true);
  });
});

/**
 * capability `agent-harness`, Requirement: cbe_maturity Generative-UI Tool — Scenarios:
 * - A staleness notice is answered with a call, not with prose
 * - The transitions-only rule does not block the re-stamp
 *
 * The description used to end the staleness clause with "if nothing did [change],
 * mirror nothing and say so in your reply rather than leaving the notice open" — the
 * exact opposite of what the host does. The disclosure is STANDING and terminates only
 * on a recorded re-stamp (Requirement: *Stale-Maturity Disclosure on the Next Lecturer
 * Turn*), so the model obeyed the tool and the notice came back every turn, forever.
 */
describe("cbe_maturity — the staleness notice has a permitted exit", () => {
  const description = maturityTool.description ?? "";

  it("A staleness notice is answered with a call, not with prose", () => {
    expect(description).toMatch(/GONE STALE, answer it in the SAME turn WITH A CALL/);
    expect(description).toMatch(/where nothing changed re-emit the reading unchanged/i);
    expect(description).toMatch(/only the recorded re-stamp ends the notice, never prose/i);
  });

  it("carries no instruction to answer the notice in prose alone", () => {
    // Asserted by ABSENCE so the retired half-sentence cannot come back unnoticed.
    expect(description).not.toMatch(/mirror nothing/i);
    expect(description).not.toMatch(/rather than leaving the notice open/i);
    expect(description).not.toMatch(/say so in your reply/i);
  });

  it("The transitions-only rule does not block the re-stamp", () => {
    // The carve-out sits ON the transitions-only sentence, not in a later paragraph a
    // model may never reach: "never re-emit an unchanged reading" is the sentence that
    // would otherwise forbid exactly the call the host is waiting for.
    const transitions = /never re-emit an unchanged reading[^.]*staleness notice[^.]*due even when nothing moved/i;
    expect(description).toMatch(transitions);
  });

  it("keeps the guidelines saying the same thing as the description", () => {
    // Never reaches the model in THIS app (pi's `customPrompt` branch drops it), but a
    // host on pi's default prompt reads it, and two channels must not disagree.
    const guidelines = (maturityTool.promptGuidelines ?? []).join("\n");
    expect(guidelines).toMatch(/except under a staleness notice, where a call is due even when nothing moved/i);
    expect(guidelines).not.toMatch(/mirror nothing/i);
  });
});

describe("cbe_maturity — schema contract", () => {
  it("keeps every field optional at the schema level (load-bearing checks live in execute)", () => {
    const schema = MaturityParamsSchema as unknown as { required?: string[] };
    expect(schema.required ?? []).toEqual([]);
  });

  it("admits all three call shapes at the schema layer", () => {
    expect(Value.Check(MaturityParamsSchema, { criterion: "stakeholder-involvement", current: 1, target: 2 })).toBe(
      true
    );
    expect(Value.Check(MaturityParamsSchema, { criterion: "overall", current: 1, note: "n" })).toBe(true);
    expect(Value.Check(MaturityParamsSchema, establishmentBatch())).toBe(true);
    // target: null is a legal schema value (explicit clear)
    expect(Value.Check(MaturityParamsSchema, { criterion: "stakeholder-involvement", target: null })).toBe(true);
  });

  it("the seven criterion keys are the fixed PIONEER set", () => {
    expect(MATURITY_CRITERIA).toEqual([
      "societal-challenge",
      "stakeholder-involvement",
      "interdisciplinarity",
      "student-agency",
      "iterative-process",
      "value-reflection",
      "societal-impact",
    ]);
  });
});
