/**
 * The host-derived overall maturity level — capability `agent-harness`,
 * Requirement: *Host-Derived Overall Maturity Level*. One test per spec
 * scenario, named after it.
 *
 * What these guard, in one sentence: the aggregate is arithmetic the HOST owns
 * (mean of the assessed criteria, banded half down, capped by a standing
 * reservation), it is stored NOWHERE, and a `current` the model sends on the
 * `overall` record is dropped with a corrective notice while the rest of the
 * call applies.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MaturityMirror,
  deriveOverallMaturity,
  sanitizeMaturitySnapshot,
  withDerivedOverall,
  type MaturitySnapshot,
} from "../src/maturity-mirror.js";
import { replayMaturityMirror } from "../src/maturity-replay.js";
import { createMaturityTool, validateMaturityParams, OVERALL_CURRENT_NOTICE } from "../src/maturity-tool.js";

type ToolLike = { execute: (id: string, params: unknown) => Promise<unknown> };

async function run(tool: unknown, params: unknown) {
  return (await (tool as ToolLike).execute("call-1", params)) as {
    content: { type: string; text: string }[];
    details: { kind: string; readings?: unknown[] };
  };
}
const ackText = (r: Awaited<ReturnType<typeof run>>): string => r.content.map((c) => c.text).join(" ");

/** A raster of the seven criteria at the given levels (index order = the fixed
 *  criterion order); `null` leaves a criterion unassessed. */
function raster(levels: (1 | 2 | 3 | null)[], extra: Partial<Record<string, unknown>> = {}): MaturitySnapshot {
  const keys = [
    "societal-challenge",
    "stakeholder-involvement",
    "interdisciplinarity",
    "student-agency",
    "iterative-process",
    "value-reflection",
    "societal-impact",
  ] as const;
  const out: MaturitySnapshot = {};
  keys.forEach((key, i) => {
    const level = levels[i];
    if (level === null || level === undefined) return;
    out[key] = { current: level, ...((extra[key] as object) ?? {}) };
  });
  return out;
}

describe("deriveOverallMaturity — the derivation", () => {
  // Scenario: The overall level is the mean of the assessed criteria
  it("The overall level is the mean of the assessed criteria", () => {
    const derived = deriveOverallMaturity(raster([2, 2, 3, 1, null, null, null]));
    // (2 + 2 + 3 + 1) / 4 = 2.0 → L2, over FOUR contributors.
    expect(derived).toEqual({ level: 2, mean: 2, contributing: 4 });
    // The three unassessed criteria were not counted as any level: counting them
    // as 0 or 1 would have pulled the mean below 2.
    expect(derived!.contributing).toBe(4);
  });

  it('an explicit "unassessed" contributes nothing either', () => {
    const state: MaturitySnapshot = {
      ...raster([3, 3, null, null, null, null, null]),
      "student-agency": { current: "unassessed" },
      "value-reflection": { target: 3 }, // target-only: an ambition, not a reading
    };
    expect(deriveOverallMaturity(state)).toEqual({ level: 3, mean: 3, contributing: 2 });
  });

  // Scenario: The band rounds half down
  it("The band rounds half down", () => {
    // 2 + 3 → exactly 2.5.
    const derived = deriveOverallMaturity(raster([2, 3, null, null, null, null, null]));
    expect(derived!.level).toBe(2);
    // …and the unrounded mean travels alongside it, so the rounding is visible
    // rather than hidden.
    expect(derived!.mean).toBe(2.5);
    // The other side of the boundary is unaffected: 2.75 bands up.
    expect(deriveOverallMaturity(raster([3, 3, 3, 2, null, null, null])!)!.level).toBe(3);
    expect(deriveOverallMaturity(raster([1, 2, null, null, null, null, null]))).toEqual({
      level: 1,
      mean: 1.5,
      contributing: 2,
    });
  });

  // Scenario: A standing reservation caps the aggregate
  it("A standing reservation caps the aggregate", () => {
    const state = raster([3, 3, 3, 1, 3, 3, 3], { "student-agency": { capped: true } });
    const derived = deriveOverallMaturity(state);
    // Mean 2.71 would band to L3 — three levels above the criterion the open
    // finding holds down.
    expect(derived!.mean).toBeCloseTo(2.714, 3);
    expect(derived!.level).toBe(1);
    // …and the derivation reports WHICH criterion applied the cap.
    expect(derived!.cappedBy).toBe("student-agency");
  });

  it("reports no cap where the band already sits at or below it", () => {
    // A capped criterion at L3 while the mean bands to L2 caps nothing.
    const state = raster([1, 2, 3, null, null, null, null], { interdisciplinarity: { capped: true } });
    const derived = deriveOverallMaturity(state);
    expect(derived!.level).toBe(2);
    expect(derived!.cappedBy).toBeUndefined();
  });

  it("takes the LOWEST capping criterion when several stand", () => {
    const state = raster([3, 3, 2, 1, 3, 3, 3], {
      interdisciplinarity: { capped: true },
      "student-agency": { capped: true },
    });
    expect(deriveOverallMaturity(state)).toMatchObject({ level: 1, cappedBy: "student-agency" });
  });

  // Scenario: The capping marker is not the uncertainty flag
  it("The capping marker is not the uncertainty flag", () => {
    const state = raster([3, 3, 3, 1, 3, 3, 3], { "student-agency": { uncertain: true } });
    const derived = deriveOverallMaturity(state);
    // The uncertain criterion contributes to the mean like any other assessed
    // one and applies NO cap — weak evidence is not a standing finding.
    expect(derived!.contributing).toBe(7);
    expect(derived!.level).toBe(3);
    expect(derived!.cappedBy).toBeUndefined();
  });

  // Scenario: No assessed criterion yields no aggregate
  it("No assessed criterion yields no aggregate", () => {
    expect(deriveOverallMaturity({})).toBeUndefined();
    // A target and a limitation note on record are not a reading.
    expect(deriveOverallMaturity({ overall: { target: 3, note: "nothing assessed yet" } })).toBeUndefined();
    // Neither are seven explicitly unassessed criteria.
    const zero: MaturitySnapshot = {};
    for (const key of Object.keys(raster([1, 1, 1, 1, 1, 1, 1]))) {
      zero[key as keyof MaturitySnapshot] = { current: "unassessed" };
    }
    expect(deriveOverallMaturity(zero)).toBeUndefined();
    // Not L1, not zero, not an empty record — literally nothing.
    expect(deriveOverallMaturity(zero)).not.toEqual({});
  });

  it("the overall record itself never contributes to its own derivation", () => {
    // Even a raster whose `overall` record somehow carried a level (it cannot
    // through the tool) derives from the CRITERIA alone.
    const state = {
      ...raster([1, 1, null, null, null, null, null]),
      overall: { current: 3, target: 3 },
    } as MaturitySnapshot;
    expect(deriveOverallMaturity(state)).toEqual({ level: 1, mean: 1, contributing: 2 });
  });
});

describe("cbe_maturity — an overall current level is dropped, not refused", () => {
  // Scenario: An overall current level in a call is dropped with a notice
  it("An overall current level in a call is dropped with a notice", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, {
      readings: [
        { criterion: "societal-challenge", current: 2, target: 2 },
        { criterion: "stakeholder-involvement", current: 1, target: 2 },
        { criterion: "interdisciplinarity", current: 2 },
        { criterion: "student-agency", current: 1 },
        { criterion: "iterative-process", current: 2 },
        { criterion: "value-reflection", current: 2 },
        { criterion: "societal-impact", current: 3 },
        { criterion: "overall", current: 3, target: 2, note: "Read from a partial draft." },
      ],
    });
    // The call is NOT refused: the seven criterion records applied unchanged.
    expect(r.details.kind).toBe("maturity-update");
    const snap = mirror.snapshot();
    expect(snap["societal-challenge"]).toEqual({ current: 2, target: 2 });
    expect(snap["societal-impact"]).toEqual({ current: 3 });
    // The overall current level is not stored; its target and note are.
    expect(snap.overall).toEqual({ target: 2, note: "Read from a partial draft." });
    // …and the result carries the corrective notice naming what overall accepts.
    expect(ackText(r)).toContain(OVERALL_CURRENT_NOTICE);
    expect(ackText(r)).toMatch(/`overall` accepts `target` and `note` only/);
    // The host's own derivation is what the panel then shows: (2+1+2+1+2+2+3)/7
    // = 1.857 → L2, never the pushed L3.
    expect(mirror.derivedOverall()).toMatchObject({ level: 2, contributing: 7 });
  });

  it("drops it on a single-record call too, and applies the rest", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, { criterion: "overall", current: 3, target: 2, note: "still provisional" });
    expect(mirror.snapshot().overall).toEqual({ target: 2, note: "still provisional" });
    expect(ackText(r)).toContain(OVERALL_CURRENT_NOTICE);
  });

  it("a call carrying nothing BUT the overall current level records nothing and says so", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, { criterion: "overall", current: 3 });
    expect(r.details.kind).toBe("maturity-refusal");
    expect(mirror.isEmpty()).toBe(true);
    expect(ackText(r)).toMatch(/no maturity reading recorded/i);
    expect(ackText(r)).toContain(OVERALL_CURRENT_NOTICE);
  });

  it("a clean call carries no notice", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    const r = await run(tool, { criterion: "student-agency", current: 2, capped: true });
    expect(ackText(r)).not.toContain(OVERALL_CURRENT_NOTICE);
    expect(mirror.snapshot()["student-agency"]).toEqual({ current: 2, capped: true });
  });

  // Scenario: The overall target and note remain model-recorded
  it("The overall target and note remain model-recorded", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    await run(tool, { criterion: "overall", target: 3, note: "Only 3 of 7 criteria assessed." });
    expect(mirror.snapshot().overall).toEqual({ target: 3, note: "Only 3 of 7 criteria assessed." });
    // …and a later `target: null` clears the target exactly as before.
    await run(tool, { criterion: "overall", target: null });
    expect(mirror.snapshot().overall).toEqual({});
  });

  it("the capping marker is validated like uncertain, and is invalid on overall", () => {
    expect(validateMaturityParams({ criterion: "student-agency", current: 2, capped: true }).ok).toBe(true);
    // No numeric current to cap.
    expect(validateMaturityParams({ criterion: "student-agency", target: 2, capped: true })).toMatchObject({
      ok: false,
    });
    expect(validateMaturityParams({ criterion: "student-agency", current: "unassessed", capped: true })).toMatchObject({
      ok: false,
    });
    // The aggregate is not a criterion a finding can hold down.
    expect(validateMaturityParams({ criterion: "overall", target: 2, capped: true })).toMatchObject({ ok: false });
    expect(validateMaturityParams({ criterion: "student-agency", current: 2, capped: "yes" })).toMatchObject({
      ok: false,
    });
  });

  it("an absent capping marker CLEARS a recorded one (per-field record semantics)", async () => {
    const mirror = new MaturityMirror();
    const tool = createMaturityTool(mirror);
    await run(tool, { criterion: "societal-challenge", current: 3 });
    await run(tool, { criterion: "interdisciplinarity", current: 3 });
    await run(tool, { criterion: "student-agency", current: 1, capped: true });
    // Mean (3 + 3 + 1) / 3 = 2.33 → L2, held down to L1 by the standing finding.
    expect(mirror.derivedOverall()).toMatchObject({ level: 1, cappedBy: "student-agency" });
    // A revision that omits `capped` clears it, exactly like `uncertain`…
    await run(tool, { criterion: "student-agency", current: 1 });
    expect(mirror.snapshot()["student-agency"]).toEqual({ current: 1 });
    // …and the aggregate rises to the band the criteria actually support.
    expect(mirror.derivedOverall()).toMatchObject({ level: 2, contributing: 3 });
    expect(mirror.derivedOverall()).not.toHaveProperty("cappedBy");
  });
});

describe("the derived level is never persisted", () => {
  // Scenario: The derived level is never persisted as a stored value
  it("The derived level is never persisted as a stored value", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult({
      kind: "maturity-update",
      readings: [
        { criterion: "societal-challenge", current: 3 },
        { criterion: "stakeholder-involvement", current: 3 },
        { criterion: "interdisciplinarity", current: 1, capped: true },
        { criterion: "student-agency", current: "unassessed" },
        { criterion: "iterative-process", current: "unassessed" },
        { criterion: "value-reflection", current: "unassessed" },
        { criterion: "societal-impact", current: "unassessed" },
        { criterion: "overall", current: 3, target: 3, note: "One finding still open." },
      ],
    });
    // What a course design-state record persists is `snapshot()`.
    const persisted = mirror.snapshot();
    expect(persisted.overall).toEqual({ target: 3, note: "One finding still open." });
    expect(persisted.overall).not.toHaveProperty("current");
    // The criterion readings and their capping markers ARE stored…
    expect(persisted.interdisciplinarity).toEqual({ current: 1, capped: true });
    // …and the aggregate is re-derived on restore from exactly what is stored.
    const live = mirror.derivedOverall();
    const restored = new MaturityMirror();
    restored.seed(JSON.parse(JSON.stringify(persisted)) as MaturitySnapshot);
    expect(restored.derivedOverall()).toEqual(live);
    expect(live).toMatchObject({ level: 1, contributing: 3, cappedBy: "interdisciplinarity" });
  });

  it("a legacy record carrying a stored aggregate has it dropped on restore", () => {
    // Course records written before the derivation may still carry one. It is
    // dropped rather than restored: a stale model-pushed aggregate must never
    // resurface beside the criteria it disagrees with.
    const legacy = sanitizeMaturitySnapshot({
      "societal-challenge": { current: 1 },
      overall: { current: 3, target: 3, note: "from an older session" },
    });
    expect(legacy.overall).toEqual({ target: 3, note: "from an older session" });
    const mirror = new MaturityMirror();
    mirror.seed(legacy);
    expect(mirror.derivedOverall()).toEqual({ level: 1, mean: 1, contributing: 1 });
  });

  it("withDerivedOverall carries the aggregate outward without storing it", () => {
    const stored: MaturitySnapshot = { ...raster([2, 3, null, null, null, null, null]), overall: { target: 3 } };
    const outward = withDerivedOverall(stored);
    // The model-facing copy carries the derived level…
    expect(outward.overall).toEqual({ target: 3, current: 2 });
    // …while the stored raster it was derived from is untouched.
    expect(stored.overall).toEqual({ target: 3 });
    // With nothing assessed, nothing is invented.
    expect(withDerivedOverall({ overall: { target: 3 } }).overall).toEqual({ target: 3 });
  });
});

describe("replay derives the same aggregate the live session had", () => {
  /** One persisted `cbe_maturity` tool-result line, as Pi writes it. */
  function toolResultLine(details: unknown): string {
    return JSON.stringify({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "t",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "cbe_maturity",
        content: [{ type: "text", text: "ack" }],
        details,
        isError: false,
        timestamp: 1,
      },
    });
  }

  it("a session rebuilt through maturity-replay derives the aggregate it had live", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "cbe-maturity-derivation-"));
    try {
      const sessionsDir = path.join(tmp, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const establishment = {
        kind: "maturity-update",
        readings: [
          { criterion: "societal-challenge", current: 3 },
          { criterion: "stakeholder-involvement", current: 2 },
          { criterion: "interdisciplinarity", current: 2 },
          { criterion: "student-agency", current: 1, capped: true },
          { criterion: "iterative-process", current: "unassessed" },
          { criterion: "value-reflection", current: "unassessed" },
          { criterion: "societal-impact", current: "unassessed" },
          { criterion: "overall", current: 3, target: 3, note: "Alignment finding left standing." },
        ],
      };
      const revision = { kind: "maturity-update", criterion: "stakeholder-involvement", current: 3 };

      // The LIVE mirror: the same two calls through the ordinary tool path.
      const live = new MaturityMirror();
      live.applyToolResult(establishment);
      live.applyToolResult(revision);

      writeFileSync(
        path.join(sessionsDir, "2026-07-01T10-00-00-000Z_replayed.jsonl"),
        [
          JSON.stringify({ type: "session", version: 3, id: "replayed", timestamp: "t", cwd: "/" }),
          toolResultLine(establishment),
          toolResultLine(revision),
        ].join("\n") + "\n"
      );

      const rebuilt = new MaturityMirror();
      await replayMaturityMirror({ sessionsDir, sessionId: "replayed", mirror: rebuilt });

      expect(rebuilt.snapshot()).toEqual(live.snapshot());
      expect(rebuilt.derivedOverall()).toEqual(live.derivedOverall());
      // The cap survived the replay and still holds the aggregate down: the
      // mean of 3, 3, 2, 1 is 2.25 → L2, capped to L1 by student-agency.
      expect(rebuilt.derivedOverall()).toEqual({
        level: 1,
        mean: 2.25,
        contributing: 4,
        cappedBy: "student-agency",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
