/**
 * Deterministic canonical-id enforcement at the `cbe_canvas` tool boundary
 * (change `harden-canvas-determinism-and-ux2-fixes`, capability `agent-harness`,
 * Requirement: Deterministic Tool-Boundary Enforcement for Canvas Ids, Step Coverage
 * and Unfed Surfaces). Test names mirror the spec scenarios.
 *
 * Background: in the 2026-08-03 session 12 of 14 canvas ids were non-canonical, and a
 * wrong id for a SEEDED slot was accepted silently — the renderer then inserted it as a
 * second artefact (the duplicated "Essential Question" / "Assessment Blueprint" cards).
 */
import { describe, it, expect } from "vitest";
import {
  CANONICAL_SLOTS,
  SEEDED_ARTEFACT_HOME,
  canonicalSlots,
  canvasContainerKey,
  emptySeededSlots,
  normaliseArtefactId,
  stepCanonicalSlots,
} from "../src/canvas-addressing.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { createCanvasTool } from "../src/canvas-tool.js";

type Tool = ReturnType<typeof createCanvasTool>;
type CanvasResult = Awaited<ReturnType<Tool["execute"]>>;

function runner(tool: Tool) {
  return (params: Record<string, unknown>): Promise<CanvasResult> =>
    tool.execute("call-1", params as never, undefined as never, undefined as never, {} as never);
}

function details(r: CanvasResult): Record<string, unknown> {
  return r.details as Record<string, unknown>;
}
function text(r: CanvasResult): string {
  return (r.content[0] as { text: string }).text;
}

/** The twelve non-canonical ids the model actually sent on 2026-08-03, with the
 * container they were addressed to and the canonical id they should have used. */
const SESSION_2026_08_03: ReadonlyArray<{
  sent: string;
  addr: { step: number; phase?: "engage" | "investigate" | "act" | "reflect" };
  canonical: string | null;
}> = [
  { sent: "module-meta-info", addr: { step: 1 }, canonical: null },
  { sent: "learning-outcomes", addr: { step: 2 }, canonical: "learningoutcomes" },
  { sent: "assessment-blueprint", addr: { step: 3 }, canonical: "assessmentblueprint" },
  { sent: "essentialquestion", addr: { step: 4 }, canonical: null },
  { sent: "stakeholder-plan", addr: { step: 5 }, canonical: "stakeholderplan" },
  { sent: "phase-investigate", addr: { step: 6, phase: "investigate" }, canonical: null },
  { sent: "phase-act", addr: { step: 6, phase: "act" }, canonical: null },
  { sent: "phase-reflect", addr: { step: 6, phase: "reflect" }, canonical: null },
  { sent: "activity-plan", addr: { step: 7 }, canonical: "activityplan" },
  { sent: "deliverables-map", addr: { step: 8 }, canonical: "deliverablesmap" },
  { sent: "alignment-matrix", addr: { step: 9 }, canonical: "alignmentmatrix" },
  { sent: "readiness-checklist", addr: { step: 10 }, canonical: "readinesschecklist" },
];

describe("canvas-addressing — the shared canonical slot table", () => {
  it("is the single authority the legacy seeded-home table agrees with", () => {
    // Every legacy-reachable seeded id is a canonical slot of the container it homes to.
    for (const [id, home] of Object.entries(SEEDED_ARTEFACT_HOME)) {
      expect(canonicalSlots(home), `${id} → ${canvasContainerKey(home)}`).toContain(id);
    }
    // Every container of the ten steps (and the four journey elements) is declared AND
    // seeds at least one canonical id — an empty container exempts its step from the
    // guards and pushes the rule into skill prose (`seed-step-6-journey-slots`).
    for (const step of [1, 2, 3, 4, 5, 7, 8, 9, 10]) {
      expect(CANONICAL_SLOTS[String(step)]?.length, `step ${step}`).toBeGreaterThan(0);
    }
    for (const phase of ["engage", "investigate", "act", "reflect"]) {
      expect(CANONICAL_SLOTS[`6/${phase}`]?.length, `6/${phase}`).toBeGreaterThan(0);
    }
    // Step 6 seeds nothing at the group level — only its journey elements do.
    expect(CANONICAL_SLOTS["6"]).toBeUndefined();
  });

  it("normalises separator/case variants and refuses to invent a match for a different word", () => {
    for (const { sent, addr, canonical } of SESSION_2026_08_03) {
      expect(normaliseArtefactId(addr, sent), `sent "${sent}"`).toBe(canonical);
    }
    // Case and underscore variants fold too.
    expect(normaliseArtefactId({ step: 3 }, "Assessment_Blueprint")).toBe("assessmentblueprint");
    // An already-canonical id needs no rewrite.
    expect(normaliseArtefactId({ step: 4 }, "eq")).toBeNull();
    // A word that is not a spelling of any canonical id never normalises — the id of the
    // reflect element is `rs`, and `showcase-plan` is a different word, not a separator
    // variant of it.
    expect(normaliseArtefactId({ step: 6, phase: "reflect" }, "showcase-plan")).toBeNull();
  });

  it("reports a container's empty seeded slots from the mirror's fill state", () => {
    const mirror = new CanvasMirror();
    expect(emptySeededSlots({ step: 4 }, mirror)).toEqual(["bigidea", "eq", "challenge"]);
    mirror.applySet({ step: 4, id: "bigidea", value: "Resilience", state: "draft" });
    // A blank value does not count as filled.
    mirror.applySet({ step: 4, id: "eq", value: "   ", state: "draft" });
    expect(emptySeededSlots({ step: 4 }, mirror)).toEqual(["eq", "challenge"]);
    mirror.applySet({ step: 4, id: "eq", value: "How might we…", state: "draft" });
    mirror.applySet({ step: 4, id: "challenge", value: "Design a…", state: "draft" });
    expect(emptySeededSlots({ step: 4 }, mirror)).toEqual([]);
    // Each step-6 journey element reports its own container's fill state.
    expect(emptySeededSlots({ step: 6, phase: "engage" }, mirror)).toEqual(["es"]);
    mirror.applySet({ step: 6, phase: "engage", id: "es", value: "Kick-off briefing", state: "draft" });
    expect(emptySeededSlots({ step: 6, phase: "engage" }, mirror)).toEqual([]);
    expect(emptySeededSlots({ step: 6, phase: "investigate" }, mirror)).toEqual(["is"]);
    expect(emptySeededSlots({ step: 6, phase: "act" }, mirror)).toEqual(["as"]);
    expect(emptySeededSlots({ step: 6, phase: "reflect" }, mirror)).toEqual(["rs"]);
  });
});

describe("cbe_canvas — canonical id enforcement", () => {
  // Scenario: A separator-or-case variant of a canonical id is normalised to the canonical id
  it("A separator-or-case variant of a canonical id is normalised to the canonical id", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 3, id: "assessment-blueprint", value: "Evidence per outcome." });

    expect(details(r)).toMatchObject({
      kind: "canvas-update",
      action: "set",
      step: 3,
      id: "assessmentblueprint",
      normalisedFrom: "assessment-blueprint",
    });
    expect(text(r)).toMatch(/normalised from "assessment-blueprint" to the canonical "assessmentblueprint"/);
    // The seeded row is filled IN PLACE — no second field is created.
    expect(mirror.size()).toBe(1);
    expect(mirror.get({ step: 3 }, "assessmentblueprint")?.value).toBe("Evidence per outcome.");
    expect(mirror.has({ step: 3 }, "assessment-blueprint")).toBe(false);

    // A second revision under the SAME variant spelling still edits the one slot.
    await run({ step: 3, id: "Assessment_Blueprint", value: "Revised evidence." });
    expect(mirror.size()).toBe(1);
    expect(mirror.get({ step: 3 }, "assessmentblueprint")?.value).toBe("Revised evidence.");
  });

  // Scenario: A non-canonical id is refused while the step still has an empty seeded slot
  it("A non-canonical id is refused while the step still has an empty seeded slot", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 4, id: "essentialquestion", value: "How might we cool the campus?" });

    expect(details(r)).toEqual({ kind: "canvas-refusal" });
    expect(mirror.size()).toBe(0);
    // The refusal TEACHES: it names the container's canonical ids and the empty ones.
    expect(text(r)).toContain("bigidea, eq, challenge");
    expect(text(r)).toMatch(/still empty: bigidea, eq, challenge/);
    // It states the RULE — it must not command a re-send of this content under a
    // canonical id, since the refused content may have no canonical slot at all.
    expect(text(r)).toMatch(/Fill this container's empty canonical slots/);
    expect(text(r)).not.toMatch(/Re-send this content/);
    expect(text(r)).toMatch(/no canvas update applied/i);
  });

  // The canonical spec's Scenario *Phase-only legacy calls remain valid and resolve per
  // the legacy mapping* — unchanged by this change, so the refusal must not reach them.
  it("Phase-only legacy calls remain valid and resolve per the legacy mapping", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const ladder = await run({ phase: "engage", id: "bigidea", value: "Resilience" });
    expect(details(ladder)).toMatchObject({ kind: "canvas-update", action: "set", step: 4, id: "bigidea" });

    const nonLadder = await run({ phase: "investigate", id: "guidingquestions", value: "Three questions." });
    expect(details(nonLadder)).toMatchObject({
      kind: "canvas-update",
      action: "set",
      step: 6,
      phase: "investigate",
      id: "guidingquestions",
    });
    expect(mirror.get({ step: 6, phase: "investigate" }, "guidingquestions")?.value).toBe("Three questions.");
  });

  it("still refuses the step-keyed equivalent of an exempted legacy call", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 6, phase: "investigate", id: "guidingquestions", value: "Three questions." });
    expect(details(r)).toEqual({ kind: "canvas-refusal" });
    expect(text(r)).toContain("step 6/investigate");
    expect(text(r)).toMatch(/still empty: is/);
    expect(mirror.size()).toBe(0);
  });

  it("refuses the step-6 journey narrative ids into their seeded slots", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 6, phase: "act", id: "phase-act", value: "Prototype sprint." });
    expect(details(r)).toEqual({ kind: "canvas-refusal" });
    expect(text(r)).toContain("step 6/act");
    expect(text(r)).toContain("as");
    expect(mirror.size()).toBe(0);
  });

  // Scenario: A minted id in a step-6 journey element is refused while that element has
  // an empty canonical slot. Until `seed-step-6-journey-slots` the `engage` / `reflect`
  // elements seeded nothing, so a minted id there was the documented path; they now carry
  // canonical ids and are guarded exactly like every other container.
  it("A minted id in a step-6 journey element is refused while that element has an empty canonical slot", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 6, phase: "reflect", id: "showcase-plan", value: "Public showcase in week 14." });

    expect(details(r)).toEqual({ kind: "canvas-refusal" });
    expect(mirror.size()).toBe(0);
    expect(text(r)).toContain("step 6/reflect");
    expect(text(r)).toMatch(/still empty: rs/);

    const engage = await run({ step: 6, phase: "engage", id: "learning-journey", value: "Weeks 1-3: onboarding." });
    expect(details(engage)).toEqual({ kind: "canvas-refusal" });
    expect(text(engage)).toMatch(/still empty: es/);
    expect(mirror.size()).toBe(0);
  });

  // Scenario: An artefact already recorded under a minted id stays editable
  it("An artefact already recorded under a minted id stays editable", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    // A session from before the elements were seeded: the artefact sits in the mirror
    // under a model-minted id, beside canonical slots that are all still empty.
    mirror.applySet({ step: 6, phase: "engage", id: "engage-vorlesungen", value: "Two lectures.", state: "draft" });

    const r = await run({ step: 6, phase: "engage", id: "engage-vorlesungen", value: "Three lectures." });

    expect(details(r)).toMatchObject({ kind: "canvas-update", action: "set", step: 6, phase: "engage" });
    expect(mirror.get({ step: 6, phase: "engage" }, "engage-vorlesungen")?.value).toBe("Three lectures.");
    // It survives as a non-canonical EXTRA — it is not folded onto a canonical slot and
    // does not count towards the element's fill state.
    expect(emptySeededSlots({ step: 6, phase: "engage" }, mirror)).toEqual(["es"]);
  });

  it("accepts the canonical ids of the step-6 engage and reflect elements", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const engage = await run({ step: 6, phase: "engage", id: "es", value: "Two lectures on energy balances." });
    expect(details(engage)).toMatchObject({ kind: "canvas-update", step: 6, phase: "engage", id: "es" });

    const reflect = await run({ step: 6, phase: "reflect", id: "rs", value: "Public showcase in week 14." });
    expect(details(reflect)).toMatchObject({ kind: "canvas-update", step: 6, phase: "reflect", id: "rs" });
    expect(mirror.size()).toBe(2);
  });

  // Scenario: An extra artefact is allowed once every seeded slot of the container is filled
  it("An extra artefact is allowed once every seeded slot of the container is filled", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    // While a slot is still empty the extra id is refused …
    const early = await run({ step: 4, id: "ladder-note", value: "A side note." });
    expect(details(early)).toEqual({ kind: "canvas-refusal" });

    await run({ step: 4, id: "bigidea", value: "Resilience" });
    await run({ step: 4, id: "eq", value: "How might we…" });
    await run({ step: 4, id: "challenge", value: "Design a…" });

    // … and accepted once every seeded slot carries content.
    const late = await run({ step: 4, id: "ladder-note", value: "A side note." });
    expect(details(late)).toMatchObject({ kind: "canvas-update", action: "set", step: 4, id: "ladder-note" });
    expect(mirror.size()).toBe(4);
  });

  it("keeps accepting an update to an accepted extra artefact after a seeded slot is emptied", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    await run({ step: 4, id: "bigidea", value: "Resilience" });
    await run({ step: 4, id: "eq", value: "How might we…" });
    await run({ step: 4, id: "challenge", value: "Design a…" });
    const extra = await run({ step: 4, id: "ladder-note", value: "A side note." });
    expect(details(extra)).toMatchObject({ kind: "canvas-update", id: "ladder-note" });

    // The lecturer deletes the challenge card in the canvas UI — the seeded slot is
    // empty again while `ladder-note` is still on the canvas.
    mirror.recordUiDeletion({ step: 4 }, "challenge");
    expect(emptySeededSlots({ step: 4 }, mirror)).toEqual(["challenge"]);

    // An UPDATE of the existing extra artefact edits it in place — never refused, since
    // an in-place edit cannot produce the duplicate the refusal exists to prevent.
    const revision = await run({ step: 4, id: "ladder-note", value: "A revised side note." });
    expect(details(revision)).toMatchObject({ kind: "canvas-update", action: "set", step: 4, id: "ladder-note" });
    expect(mirror.get({ step: 4 }, "ladder-note")?.value).toBe("A revised side note.");
    expect(mirror.size()).toBe(3);

    // A NEW non-canonical id in that same state is still refused.
    const fresh = await run({ step: 4, id: "ladder-note-2", value: "Another note." });
    expect(details(fresh)).toEqual({ kind: "canvas-refusal" });
    expect(text(fresh)).toMatch(/still empty: challenge/);
    expect(mirror.size()).toBe(3);
  });

  // Scenario: A refusal leaves host and renderer state untouched
  it("A refusal leaves host and renderer state untouched", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));
    await run({ step: 4, id: "bigidea", value: "Resilience" });
    const before = JSON.stringify(mirror.list());

    const r = await run({ step: 4, id: "essentialquestion", value: "How might we…" });

    // The mirror is byte-identical, and `details` carries the refusal kind so the
    // renderer's `parseCanvasDetails` applies nothing.
    expect(JSON.stringify(mirror.list())).toBe(before);
    expect(details(r).kind).toBe("canvas-refusal");
    expect(details(r).step).toBeUndefined();
  });

  it("normalises a clear onto the canonical slot the set landed in", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));
    await run({ step: 2, id: "learning-outcomes", value: "Three outcomes." });
    expect(mirror.size()).toBe(1);

    const r = await run({ step: 2, id: "learning-outcomes", action: "clear" });
    expect(details(r)).toMatchObject({ kind: "canvas-update", action: "clear", id: "learningoutcomes" });
    expect(mirror.size()).toBe(0);
  });

  it("keeps normalising without a bound mirror, where fill state cannot be established", async () => {
    const run = runner(createCanvasTool());
    const normalised = await run({ step: 9, id: "alignment-matrix", value: "Matrix." });
    expect(details(normalised)).toMatchObject({ id: "alignmentmatrix" });
    // No mirror → no fill state → the empty-slot refusal cannot fire (accept, as before).
    const minted = await run({ step: 9, id: "some-extra", value: "Extra." });
    expect(details(minted)).toMatchObject({ kind: "canvas-update", id: "some-extra" });
  });
});

describe("harmonise-canvas-slots-with-the-ten-step-outputs — step 6 carries one slot per journey element", () => {
  const RETIRED = ["gq", "ar", "syn", "sc", "sd", "ie"] as const;

  // Scenario: Each step-6 journey element seeds exactly one phase-plan slot
  it("Each step-6 journey element seeds exactly one phase-plan slot", () => {
    expect(canonicalSlots({ step: 6, phase: "engage" })).toEqual(["es"]);
    expect(canonicalSlots({ step: 6, phase: "investigate" })).toEqual(["is"]);
    expect(canonicalSlots({ step: 6, phase: "act" })).toEqual(["as"]);
    expect(canonicalSlots({ step: 6, phase: "reflect" })).toEqual(["rs"]);
    // §4.6 gives step 6 ONE named output, so the four containers are symmetric and the
    // step-level aggregate — which every depth guard, the close gate and the outstanding-slot
    // echo read — is exactly four qualified ids.
    expect(stepCanonicalSlots(6)).toEqual(["engage/es", "investigate/is", "act/as", "reflect/rs"]);
  });

  // Scenario: A retired learner-time id is no longer canonical anywhere
  it("A retired learner-time id is no longer canonical anywhere", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    const r = await run({ step: 6, phase: "investigate", id: "gq", value: "Three guiding questions." });
    expect(details(r)).toEqual({ kind: "canvas-refusal" });
    expect(text(r)).toContain("step 6/investigate");
    expect(text(r)).toMatch(/still empty: is/);
    expect(mirror.size()).toBe(0);

    // Nowhere in the shared authority: not a seeded home, not a canonical slot of any
    // container. They are `methodology-001`'s learner-time activities and stay in the corpus.
    for (const id of RETIRED) {
      expect(SEEDED_ARTEFACT_HOME[id], `${id} still resolves to a seeded home`).toBeUndefined();
      for (const ids of Object.values(CANONICAL_SLOTS)) {
        expect(ids, `${id} is still a canonical slot`).not.toContain(id);
      }
    }
  });

  // Scenario: A minted id is accepted once the container's one slot is filled
  it("A minted id is accepted once the container's one slot is filled", async () => {
    const mirror = new CanvasMirror();
    const run = runner(createCanvasTool(mirror));

    await run({ step: 6, phase: "reflect", id: "rs", value: "Showcase in week 14." });
    const minted = await run({ step: 6, phase: "reflect", id: "showcase-plan", value: "Invite the partner." });

    expect(details(minted)).toMatchObject({
      kind: "canvas-update",
      action: "set",
      step: 6,
      phase: "reflect",
      id: "showcase-plan",
    });
    expect(mirror.get({ step: 6, phase: "reflect" }, "rs")?.value).toBe("Showcase in week 14.");
    expect(mirror.get({ step: 6, phase: "reflect" }, "showcase-plan")?.value).toBe("Invite the partner.");
  });
});
