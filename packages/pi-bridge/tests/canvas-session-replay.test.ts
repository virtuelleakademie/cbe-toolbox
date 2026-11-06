/**
 * End-to-end replay of the 2026-08-03 session's REAL `cbe_canvas` payloads through the
 * hardened tool (change `harden-canvas-determinism-and-ux2-fixes`, task A2.4 — the
 * id half of the replay regression guard; the step half lives in `step-mirror.test.ts`).
 *
 * capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement for
 * Canvas Ids, Step Coverage and Unfed Surfaces.
 *
 * `canvas-canonical-ids.test.ts` proves each rule in isolation. This proves the rules
 * together against the actual traffic: 12 of the 14 ids the model sent were
 * non-canonical, and the visible consequence was the duplicated "Essential Question" and
 * "Assessment Blueprint" cards the lecturer photographed — a seeded slot left empty
 * ("open, —") next to a second field carrying the content.
 *
 * The invariant asserted here is exactly that photographed defect, stated generally:
 * **no container ends the replay with an empty seeded slot beside a non-canonical
 * artefact holding content.**
 */
import { describe, it, expect } from "vitest";
import { createCanvasTool } from "../src/canvas-tool.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { canonicalSlots, emptySeededSlots, type ResolvedCanvasAddress } from "../src/canvas-addressing.js";

/** The session's canvas calls in emission order, with the log line each came from. */
const SESSION_CALLS: Array<{ line: number; params: Record<string, unknown> }> = [
  { line: 23, params: { step: 1, id: "module-meta-info", value: "Level BA, ein Semester" } },
  { line: 30, params: { step: 1, id: "module-meta-info", value: "BA, one full semester" } },
  { line: 40, params: { step: 2, id: "learning-outcomes", value: "Phase A: TUI. Phase B: scenario." } },
  { line: 51, params: { step: 3, id: "assessment-blueprint", value: "Formative TUI, summative scenario." } },
  { line: 65, params: { step: 4, id: "bigidea", value: "Git in the times of AI." } },
  { line: 65, params: { step: 4, id: "essentialquestion", value: "How can I apply git structures?" } },
  { line: 71, params: { step: 4, id: "challenge", value: "Inherit a messy repository." } },
  { line: 77, params: { step: 5, id: "stakeholder-plan", value: "Lecturer as Product Owner." } },
  { line: 83, params: { step: 5, id: "stakeholder-plan", value: "Product Owner within the group." } },
  { line: 89, params: { step: 6, id: "phase-plan", value: "Engage weeks 1-3 …" } },
  { line: 91, params: { step: 6, id: "phase-plan", value: "Weeks 1-3 Engage …" } },
  { line: 93, params: { step: 6, id: "learning-journey-timeline", value: "Weeks 1-3 Engage …" } },
  { line: 95, params: { step: 6, phase: "engage", id: "learning-journey", value: "Weeks 1-3: onboarding." } },
  { line: 102, params: { step: 6, phase: "investigate", id: "phase-investigate", value: "Weeks 4-6: strategy." } },
  { line: 102, params: { step: 6, phase: "act", id: "phase-act", value: "Weeks 7-26: sprints." } },
  { line: 102, params: { step: 6, phase: "reflect", id: "phase-reflect", value: "Weeks 27-30: audit." } },
  { line: 110, params: { step: 7, id: "activity-plan", value: "Research labs, sprints, audit." } },
  { line: 110, params: { step: 8, id: "deliverables-map", value: "Repo audit wk3 … final wk30." } },
  { line: 121, params: { step: 9, id: "alignment-matrix", value: "Basics practised in Phase A …" } },
  { line: 126, params: { step: 10, id: "readiness-checklist", value: "Build the messy repo …" } },
];

/** The seven ids that are separator variants of a canonical id, and their slot. */
const KEBAB_VARIANTS: Array<{ sent: string; canonical: string; step: number }> = [
  { sent: "learning-outcomes", canonical: "learningoutcomes", step: 2 },
  { sent: "assessment-blueprint", canonical: "assessmentblueprint", step: 3 },
  { sent: "stakeholder-plan", canonical: "stakeholderplan", step: 5 },
  { sent: "activity-plan", canonical: "activityplan", step: 7 },
  { sent: "deliverables-map", canonical: "deliverablesmap", step: 8 },
  { sent: "alignment-matrix", canonical: "alignmentmatrix", step: 9 },
  { sent: "readiness-checklist", canonical: "readinesschecklist", step: 10 },
];

async function replay() {
  const mirror = new CanvasMirror();
  const canvas = createCanvasTool(mirror);
  const results: Array<{ line: number; sent: string; kind: string; text: string }> = [];
  for (const [i, call] of SESSION_CALLS.entries()) {
    const res = await canvas.execute(`c${i}`, call.params as never);
    results.push({
      line: call.line,
      sent: String(call.params.id),
      kind: (res.details as { kind?: string })?.kind ?? "",
      text: res.content.map((c) => c.text ?? "").join(""),
    });
  }
  return { mirror, results };
}

describe("replay of the 2026-08-03 canvas payloads through the hardened tool", () => {
  it("leaves no container with an empty seeded slot beside a non-canonical artefact", async () => {
    const { mirror } = await replay();

    // The photographed defect, stated generally. For every container the replay touched:
    // if a canonical slot is still empty, no OTHER artefact in that container may carry
    // content — that pairing IS the duplicate card.
    const containers = new Map<string, ResolvedCanvasAddress>();
    for (const e of mirror.list()) {
      const addr: ResolvedCanvasAddress = e.phase ? { step: e.step, phase: e.phase } : { step: e.step };
      containers.set(e.phase ? `${e.step}/${e.phase}` : `${e.step}`, addr);
    }

    for (const [key, addr] of containers) {
      const empty = emptySeededSlots(addr, mirror);
      if (empty.length === 0) continue;
      const nonCanonical = mirror
        .list()
        .filter((e) => (e.phase ? `${e.step}/${e.phase}` : `${e.step}`) === key)
        .filter((e) => !canonicalSlots(addr).includes(e.id))
        .filter((e) => e.value.trim().length > 0);
      expect(
        nonCanonical.map((e) => e.id),
        `container ${key} has empty slots ${empty.join(",")}`
      ).toEqual([]);
    }
  });

  it("lands the seven separator variants in their canonical slots", async () => {
    const { mirror, results } = await replay();

    for (const v of KEBAB_VARIANTS) {
      const entry = mirror.get({ step: v.step }, v.canonical);
      expect(entry?.value, `${v.sent} should fill ${v.canonical}`).toBeTruthy();
      // …and the id the model actually sent left no separate artefact behind.
      expect(mirror.get({ step: v.step }, v.sent)).toBeUndefined();
      // The rewrite is reported back so the model can self-correct.
      const accepted = results.find((r) => r.sent === v.sent && r.kind === "canvas-update");
      expect(accepted?.text).toContain(v.canonical);
    }
  });

  it("refuses `essentialquestion` instead of parking it beside an empty `eq`", async () => {
    const { mirror, results } = await replay();

    const eqAttempt = results.find((r) => r.sent === "essentialquestion");
    expect(eqAttempt?.kind).toBe("canvas-refusal");
    expect(eqAttempt?.text).toContain("eq");
    expect(mirror.get({ step: 4 }, "essentialquestion")).toBeUndefined();
    // The seeded slot stays empty — the point is that NOTHING duplicated it. The
    // lecturer's content reaches it once the model re-issues with the named id.
    expect(mirror.get({ step: 4 }, "eq")).toBeUndefined();
    // The two ids the model got right are unaffected.
    expect(mirror.get({ step: 4 }, "bigidea")?.value).toBeTruthy();
    expect(mirror.get({ step: 4 }, "challenge")?.value).toBeTruthy();
  });

  it("refuses `module-meta-info` — a different word, not a spelling of `moduleframe`", async () => {
    const { mirror, results } = await replay();

    expect(results.filter((r) => r.sent === "module-meta-info").every((r) => r.kind === "canvas-refusal")).toBe(true);
    expect(mirror.get({ step: 1 }, "module-meta-info")).toBeUndefined();
    expect(results.find((r) => r.sent === "module-meta-info")?.text).toContain("moduleframe");
  });

  it("forces the step-6 journey narratives into the seeded skeleton", async () => {
    const { mirror, results } = await replay();

    // ALL FOUR journey elements seed artefacts since `seed-step-6-journey-slots`, so every
    // phase-level narrative is refused with the skeleton named — the lecturer's complaint
    // was "Anstatt das Sekleton zu verwenden". Until then `engage` and `reflect` seeded
    // nothing and took the two narratives as minted ids, which is exactly the state the
    // rest of the canvas was hardened against.
    for (const id of ["phase-investigate", "phase-act", "phase-reflect", "learning-journey"]) {
      const r = results.find((x) => x.sent === id);
      expect(r?.kind, id).toBe("canvas-refusal");
    }
    expect(results.find((x) => x.sent === "phase-investigate")?.text).toContain("is");
    expect(results.find((x) => x.sent === "phase-act")?.text).toContain("as");
    expect(results.find((x) => x.sent === "phase-reflect")?.text).toContain("rs");
    expect(results.find((x) => x.sent === "learning-journey")?.text).toContain("es");

    // Nothing of the two narratives reached the mirror.
    expect(mirror.get({ step: 6, phase: "reflect" }, "phase-reflect")).toBeUndefined();
    expect(mirror.get({ step: 6, phase: "engage" }, "learning-journey")).toBeUndefined();
  });

  it("still refuses the three unresolvable step-6 addresses, as it did in the session", async () => {
    const { results } = await replay();
    // Log lines 89/91/93: step 6 without a journey phase. Already refused before this
    // change; the guard must not have regressed that.
    for (const line of [89, 91, 93]) {
      expect(
        results.filter((r) => r.line === line).every((r) => r.kind === "canvas-refusal"),
        `line ${line}`
      ).toBe(true);
    }
  });

  it("records an in-place revision rather than a second artefact", async () => {
    const { mirror } = await replay();
    // Step 1 was written twice and step 5 twice (a revision after the lecturer corrected
    // the stakeholder). Each container must hold at most one artefact per id.
    const perContainer = new Map<string, number>();
    for (const e of mirror.list()) {
      const key = `${e.phase ? `${e.step}/${e.phase}` : e.step}/${e.id}`;
      perContainer.set(key, (perContainer.get(key) ?? 0) + 1);
    }
    expect([...perContainer.values()].every((n) => n === 1)).toBe(true);
    // The step-5 revision won, in place.
    expect(mirror.get({ step: 5 }, "stakeholderplan")?.value).toContain("within the group");
  });
});
