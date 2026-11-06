/**
 * Tests for the host-side session maturity mirror and its same-session replay.
 *
 * Capability `agent-harness`, Requirement: Host-Side Session Maturity Mirror
 * (plus the record semantics of Requirement: cbe_maturity Generative-UI Tool).
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MaturityMirror,
  applyMaturityDetails,
  computeMaturityDivergence,
  formatMaturityDivergence,
  parseMaturityDetails,
  type MaturitySnapshot,
} from "../src/maturity-mirror.js";
import { replayMaturityMirror } from "../src/maturity-replay.js";

const ESTABLISHMENT = {
  kind: "maturity-update",
  readings: [
    { criterion: "societal-challenge", current: 2, target: 2 },
    { criterion: "stakeholder-involvement", current: 1, target: 2, hint: "Add a stakeholder feedback moment." },
    { criterion: "interdisciplinarity", current: "unassessed" },
    { criterion: "student-agency", current: "unassessed" },
    { criterion: "iterative-process", current: "unassessed" },
    { criterion: "value-reflection", current: "unassessed" },
    { criterion: "societal-impact", current: "unassessed" },
    { criterion: "overall", current: 1, target: 2, note: "Only 2 of 7 criteria assessed." },
  ],
};

const REVISION = { kind: "maturity-update", criterion: "stakeholder-involvement", current: 2 };

describe("MaturityMirror — record semantics", () => {
  it("a batched readings call replaces the whole recorded raster", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 3, target: 3 });
    mirror.applyToolResult(ESTABLISHMENT);
    // The pre-batch student-agency reading is gone — replaced, not merged.
    expect(mirror.snapshot()["student-agency"]).toEqual({ current: "unassessed" });
    expect(mirror.snapshot()["societal-challenge"]).toEqual({ current: 2, target: 2 });
  });

  it("later calls win within a turn (event order)", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult({ kind: "maturity-update", criterion: "societal-impact", current: 1 });
    mirror.applyToolResult({ kind: "maturity-update", criterion: "societal-impact", current: 2 });
    expect(mirror.snapshot()["societal-impact"]).toEqual({ current: 2 });
  });

  it("refusals, foreign tool results, and malformed payloads leave the mirror untouched", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult(ESTABLISHMENT);
    const before = mirror.snapshot();
    mirror.applyToolResult({ kind: "maturity-refusal" });
    mirror.applyToolResult({ kind: "canvas-update", step: 3, id: "x", action: "set", value: "y" });
    mirror.applyToolResult({ kind: "maturity-update", criterion: "not-a-criterion", current: 1 });
    mirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 9 });
    mirror.applyToolResult("garbage");
    mirror.applyToolResult(null);
    expect(mirror.snapshot()).toEqual(before);
  });

  it("a torn batch inside the details is not applied partially", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult({
      kind: "maturity-update",
      readings: [
        { criterion: "societal-challenge", current: 2 },
        { criterion: "nonsense-key", current: 1 },
      ],
    });
    expect(mirror.isEmpty()).toBe(true);
  });

  // Scenario: A reloaded renderer repopulates the panel from the mirror (host-side
  // half — the snapshot carries the recorded raster for the hydration payload).
  it("snapshot() carries the recorded raster and is a defensive copy", () => {
    const mirror = new MaturityMirror();
    mirror.applyToolResult(ESTABLISHMENT);
    mirror.applyToolResult(REVISION);
    const snap = mirror.snapshot();
    // Post-revision state: current 2, target preserved, stale hint cleared.
    expect(snap["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
    // The aggregate record keeps the target and the note only — the achieved
    // level travelling in the establishment batch is host-derived and dropped
    // (Requirement: *Host-Derived Overall Maturity Level*).
    expect(snap.overall).toEqual({ target: 2, note: "Only 2 of 7 criteria assessed." });
    // Mutating the snapshot must not reach back into the mirror.
    snap["stakeholder-involvement"]!.current = 1;
    delete snap.overall;
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
    expect(mirror.snapshot().overall).toBeDefined();
  });
});

describe("applyMaturityDetails — pure shared record semantics", () => {
  it("is pure: never mutates the input snapshot", () => {
    const state: MaturitySnapshot = { "societal-impact": { current: 1, hint: "old hint" } };
    const next = applyMaturityDetails(state, {
      kind: "maturity-update",
      criterion: "societal-impact",
      current: 2,
    });
    expect(state["societal-impact"]).toEqual({ current: 1, hint: "old hint" });
    expect(next["societal-impact"]).toEqual({ current: 2 });
  });

  it("parseMaturityDetails accepts only maturity-update details", () => {
    expect(parseMaturityDetails({ kind: "maturity-refusal" })).toBeNull();
    expect(parseMaturityDetails({ kind: "step-update", step: 1 })).toBeNull();
    expect(parseMaturityDetails(undefined)).toBeNull();
    expect(parseMaturityDetails({ kind: "maturity-update", criterion: "student-agency" })).toBeNull(); // no field
    expect(parseMaturityDetails({ kind: "maturity-update", criterion: "student-agency", current: 1 })).toMatchObject({
      criterion: "student-agency",
      current: 1,
    });
  });
});

describe("replayMaturityMirror — same-session rebuild from the session record", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function sessionsDir(): string {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-maturity-replay-"));
    const dir = path.join(tmp, "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function entryLine(message: unknown): string {
    return JSON.stringify({ type: "message", id: "e", parentId: null, timestamp: "t", message });
  }

  function toolResultLine(details: unknown, over: Record<string, unknown> = {}): string {
    return entryLine({
      role: "toolResult",
      toolCallId: "c1",
      toolName: "cbe_maturity",
      content: [{ type: "text", text: "ack" }],
      details,
      isError: false,
      timestamp: 1,
      ...over,
    });
  }

  function headerLine(id: string): string {
    return JSON.stringify({ type: "session", version: 3, id, timestamp: "t", cwd: "/" });
  }

  // Scenario: Resuming a persisted session rebuilds the mirror from its own record
  it("replays establishment batch + one revision to the post-revision state, in order", async () => {
    const dir = sessionsDir();
    writeFileSync(
      path.join(dir, "2026-07-01T10-00-00-000Z_session-a.jsonl"),
      [
        headerLine("session-a"),
        entryLine({ role: "user", content: "hello", timestamp: 1 }),
        toolResultLine(ESTABLISHMENT),
        "not json at all {{{", // torn line — skipped
        entryLine({ role: "assistant", content: [{ type: "text", text: "…" }] }),
        toolResultLine({ kind: "canvas-update", step: 1, id: "x" }, { toolName: "cbe_canvas" }), // foreign tool
        toolResultLine({ kind: "maturity-refusal" }), // refusal — skipped
        toolResultLine(REVISION),
      ].join("\n") + "\n"
    );
    const mirror = new MaturityMirror();
    await replayMaturityMirror({ sessionsDir: dir, sessionId: "session-a", mirror });
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
    expect(mirror.snapshot()["societal-challenge"]).toEqual({ current: 2, target: 2 });
  });

  it("replays earlier resume legs before later ones (timestamp-prefix order)", async () => {
    const dir = sessionsDir();
    // Later leg: revision. Earlier leg: establishment. Written out of order on disk.
    writeFileSync(
      path.join(dir, "2026-07-02T09-00-00-000Z_session-a.jsonl"),
      [headerLine("session-a"), toolResultLine(REVISION)].join("\n") + "\n"
    );
    writeFileSync(
      path.join(dir, "2026-07-01T10-00-00-000Z_session-a.jsonl"),
      [headerLine("session-a"), toolResultLine(ESTABLISHMENT)].join("\n") + "\n"
    );
    const mirror = new MaturityMirror();
    await replayMaturityMirror({ sessionsDir: dir, sessionId: "session-a", mirror });
    expect(mirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
  });

  // Scenario: The mirror never crosses sessions (replay half)
  it("reads ONLY files carrying the session's own id", async () => {
    const dir = sessionsDir();
    writeFileSync(
      path.join(dir, "2026-07-01T10-00-00-000Z_session-other.jsonl"),
      [headerLine("session-other"), toolResultLine(ESTABLISHMENT)].join("\n") + "\n"
    );
    const mirror = new MaturityMirror();
    await replayMaturityMirror({ sessionsDir: dir, sessionId: "session-a", mirror });
    expect(mirror.isEmpty()).toBe(true);
  });

  it("excludes the current leg's own file and tolerates a missing directory", async () => {
    const dir = sessionsDir();
    const current = path.join(dir, "2026-07-03T08-00-00-000Z_session-a.jsonl");
    writeFileSync(current, [headerLine("session-a"), toolResultLine(ESTABLISHMENT)].join("\n") + "\n");
    const mirror = new MaturityMirror();
    await replayMaturityMirror({ sessionsDir: dir, sessionId: "session-a", mirror, excludeFile: current });
    expect(mirror.isEmpty()).toBe(true);
    // Missing directory: a no-op, never a throw.
    await expect(
      replayMaturityMirror({ sessionsDir: path.join(dir, "nope"), sessionId: "session-a", mirror })
    ).resolves.toBeUndefined();
  });
});

// Change `confront-ambition-maturity-divergence` — the pure classifier the
// `cbe_maturity` acknowledgement renders (capability `agent-harness`,
// Requirement: cbe_maturity Generative-UI Tool).
describe("computeMaturityDivergence — pure classification over the recorded raster", () => {
  it("classifies every recorded key into exactly one state, with the counts", () => {
    const snapshot: MaturitySnapshot = {
      "societal-challenge": { current: 2, target: 2 },
      "stakeholder-involvement": { current: 1, target: 2, hint: "Add a feedback moment." },
      interdisciplinarity: { current: 3, target: 2 },
      "student-agency": { current: "unassessed", target: 2 },
      "iterative-process": { current: 1 },
      overall: { target: 2 },
    };
    const summary = computeMaturityDivergence(snapshot);
    expect(summary.counts).toEqual({ below: 1, at: 1, above: 1, unassessed: 1, "no-target": 1 });
    expect(summary.entries).toEqual([
      { key: "societal-challenge", state: "at" },
      { key: "stakeholder-involvement", state: "below" },
      { key: "interdisciplinarity", state: "above" },
      { key: "student-agency", state: "unassessed" },
      { key: "iterative-process", state: "no-target" },
    ]);
    // The aggregate is classified by the same rules but reported apart — it is
    // never an eighth criterion in the entries or the counts. Its `current` is
    // the DERIVED level, not a stored one: the four assessed criteria (2, 1, 3,
    // 1) average 1.75 → band L2, which sits AT the recorded target 2.
    expect(summary.overall).toBe("at");
    expect(summary.entries.some((e) => (e.key as string) === "overall")).toBe(false);
  });

  it("keeps the aggregate out of the per-criterion shortfall tally", () => {
    // The establishment shape: one genuinely-below criterion plus the conservative
    // `overall` aggregate carrying the same below-target reading. Counting the
    // aggregate as a criterion would report two shortfalls where there is one.
    const summary = computeMaturityDivergence({
      "stakeholder-involvement": { current: 1, target: 2 },
      overall: { current: 1, target: 2 },
    });
    expect(summary.counts.below).toBe(1);
    expect(summary.entries).toEqual([{ key: "stakeholder-involvement", state: "below" }]);
    expect(summary.overall).toBe("below");
  });

  it("omits the aggregate field when no overall record is recorded", () => {
    const summary = computeMaturityDivergence({ "stakeholder-involvement": { current: 1, target: 2 } });
    expect(summary.overall).toBeUndefined();
  });

  it("never converts absent evidence into a gap", () => {
    // An `"unassessed"` current and a target-only record are both absences: they
    // are named as such, never counted as `below` and never read as Level 1.
    const summary = computeMaturityDivergence({
      "student-agency": { current: "unassessed", target: 3 },
      "value-reflection": { target: 3 },
    });
    expect(summary.counts.below).toBe(0);
    expect(summary.counts.unassessed).toBe(2);
  });

  it("is empty for an empty raster", () => {
    const summary = computeMaturityDivergence({});
    expect(summary.entries).toEqual([]);
    expect(summary.counts).toEqual({ below: 0, at: 0, above: 0, unassessed: 0, "no-target": 0 });
    expect(summary.overall).toBeUndefined();
  });

  it("renders a session-scoped line that restates no model free text", () => {
    const line = formatMaturityDivergence(
      computeMaturityDivergence({
        "stakeholder-involvement": { current: 1, target: 2, hint: "Add a defined feedback moment." },
        "societal-impact": { current: "unassessed" },
      })
    );
    expect(line).toContain("below 1 (stakeholder-involvement)");
    expect(line).toContain("unassessed 1 (societal-impact)");
    expect(line).toContain("at 0");
    expect(line).toContain("above 0");
    expect(line).toContain("no-target 0");
    expect(line).not.toContain("Add a defined feedback moment.");
    expect(line).toMatch(/this session's recorded raster/i);
    expect(line, "no overall record recorded — no aggregate clause").not.toMatch(/aggregate/i);
  });

  it("renders the aggregate as its own clause, outside the per-criterion buckets", () => {
    const line = formatMaturityDivergence(
      computeMaturityDivergence({
        "stakeholder-involvement": { current: 1, target: 2 },
        overall: { current: 1, target: 2 },
      })
    );
    expect(line).toContain("below 1 (stakeholder-involvement)");
    expect(line).toMatch(/aggregate `overall` record is classified separately[^.]*: below\./i);
    // The bucket half of the line never mentions the aggregate.
    expect(line.slice(0, line.indexOf("The aggregate"))).not.toContain("overall");
  });
});
