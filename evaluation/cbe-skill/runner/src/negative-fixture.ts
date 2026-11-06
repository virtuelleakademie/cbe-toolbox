/**
 * Negative fixtures — the discrimination proof for deterministic checkpoints.
 *
 * A checkpoint that cannot fail is a placebo, and a green run cannot tell it apart
 * from a working one. A negative fixture is a synthetic answer written to FAIL its
 * checkpoint; if the checker returns anything other than `fail`, the checkpoint does
 * not discriminate (or was never exercised) and the test suite says so.
 *
 * Every fixture is self-contained: it carries its own checkpoint definition, probe
 * setup and transcript, so it references no scenario file and survives a rewrite of
 * the scenario suite (spec: "Negative fixtures prove checkpoint discrimination").
 *
 * Pure code, no LLM, no network — this module runs inside `npm test`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Checkpoint, DeterministicKind, Probe, ProbeSetup, Transcript, Verdict } from "./types.js";
import { checkDeterministic } from "./checker-deterministic.js";

/**
 * Deterministic kinds the checker supports, derived exhaustively from the union.
 *
 * `satisfies Record<DeterministicKind, true>` is what makes the coverage gate bind:
 * a kind added to `DeterministicKind` (and to the checker's switch) without an entry
 * here is a COMPILE error, so it can never reach the fixture set unnoticed. A
 * hand-maintained copy of the union would let a new kind ship with no discrimination
 * proof and a green suite.
 */
const DETERMINISTIC_KIND_GATE = {
  cite_all: true,
  cite_none_outside_corpus: true,
  tool_called: true,
  tool_not_called: true,
  tool_arg_matches: true,
  contains: true,
  not_contains: true,
  cite_provenance: true,
  reply_language: true,
  no_trailing_menu: true,
  cite_no_sham_attribution: true,
  cite_section_resolves: true,
  maturity_no_pushed_aggregate: true,
  maturity_cap_marked: true,
} satisfies Record<DeterministicKind, true>;

/** A kind in this list without a fixture fails the suite. */
export const SUPPORTED_DETERMINISTIC_KINDS: readonly DeterministicKind[] = Object.keys(
  DETERMINISTIC_KIND_GATE
) as DeterministicKind[];

/**
 * A tool call in a fixture turn: a bare NAME where the checkpoint only asks whether the
 * tool ran, or `{ name, args }` where it reads an argument off the call
 * (`tool_arg_matches`). Both forms coexist so the fixtures that predate arguments stay
 * untouched.
 */
export type NegativeFixtureTool = string | { name: string; args?: Record<string, unknown> };

export interface NegativeFixtureTurn {
  user: string;
  assistant: string;
  tools?: NegativeFixtureTool[];
}

export interface NegativeFixture {
  /** Unique fixture id, e.g. "cite_all-missing-second-id". */
  id: string;
  /** Why this answer must fail — read by whoever has to debug a flipped fixture. */
  note: string;
  /** Self-contained checkpoint under proof. */
  checkpoint: Checkpoint;
  /** Probe setup the checkpoint is evaluated against. */
  setup: ProbeSetup;
  /** The synthetic answer that must not pass. */
  turns: NegativeFixtureTurn[];
  /** Source file, filled in by the loader. */
  file?: string;
}

export class NegativeFixtureError extends Error {
  constructor(
    message: string,
    readonly file: string
  ) {
    super(`${file}: ${message}`);
    this.name = "NegativeFixtureError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(raw: Record<string, unknown>, field: string, file: string): string {
  const v = raw[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new NegativeFixtureError(`fixture is missing required string field "${field}"`, file);
  }
  return v;
}

function parseCheckpoint(raw: unknown, fixtureId: string, file: string): Checkpoint {
  if (!isObject(raw)) throw new NegativeFixtureError(`fixture "${fixtureId}" has no checkpoint mapping`, file);
  const id = raw.id;
  const type = raw.type;
  if (typeof id !== "string" || id.trim() === "") {
    throw new NegativeFixtureError(`fixture "${fixtureId}" has no checkpoint.id`, file);
  }
  if (type === "judge") {
    // A judge rubric can only be graded by a model; grading it with a stub would
    // prove that the stub obeyed its script, which is the placebo this mechanism
    // exists to remove. Judge checkpoints are calibrated by the gold set instead.
    throw new NegativeFixtureError(
      `fixture "${fixtureId}" declares a judge checkpoint — judge rubrics are calibrated by the gold set ` +
        `(evaluation/cbe-skill/fixtures/gold/), not by negative fixtures`,
      file
    );
  }
  if (type !== "deterministic") {
    throw new NegativeFixtureError(
      `fixture "${fixtureId}" has invalid checkpoint.type "${String(type)}" (expected deterministic)`,
      file
    );
  }
  if (!isObject(raw.check)) {
    throw new NegativeFixtureError(`fixture "${fixtureId}" has no checkpoint.check descriptor`, file);
  }
  const kind = raw.check.kind;
  if (typeof kind !== "string" || !(SUPPORTED_DETERMINISTIC_KINDS as readonly string[]).includes(kind)) {
    throw new NegativeFixtureError(`fixture "${fixtureId}" has unsupported check kind "${String(kind)}"`, file);
  }
  const cp: Checkpoint = {
    id,
    type: "deterministic",
    anchors: [],
    check: {
      kind: kind as DeterministicKind,
      ids: Array.isArray(raw.check.ids) ? (raw.check.ids as string[]) : undefined,
      tool: typeof raw.check.tool === "string" ? raw.check.tool : undefined,
      pattern: typeof raw.check.pattern === "string" ? raw.check.pattern : undefined,
    },
  };
  if (typeof raw.turn === "number") cp.turn = raw.turn;
  return cp;
}

function parseSetup(raw: unknown, fixtureId: string, file: string): ProbeSetup {
  if (!isObject(raw)) throw new NegativeFixtureError(`fixture "${fixtureId}" has no setup mapping`, file);
  const profile = raw.profile;
  if (profile !== "app" && profile !== "headless") {
    throw new NegativeFixtureError(`fixture "${fixtureId}" has invalid setup.profile "${String(profile)}"`, file);
  }
  return {
    profile,
    affordances: isObject(raw.affordances) ? (raw.affordances as Record<string, boolean>) : undefined,
    corpus: Array.isArray(raw.corpus) ? (raw.corpus as string[]) : undefined,
  };
}

/** Parse one fixture document. */
export function parseNegativeFixture(raw: unknown, file: string): NegativeFixture {
  if (!isObject(raw)) throw new NegativeFixtureError("fixture document is not a mapping", file);
  const id = requireString(raw, "id", file);
  const note = requireString(raw, "note", file);
  const checkpoint = parseCheckpoint(raw.checkpoint, id, file);
  const setup = parseSetup(raw.setup, id, file);
  const turnsRaw = raw.turns;
  if (!Array.isArray(turnsRaw) || turnsRaw.length === 0) {
    throw new NegativeFixtureError(`fixture "${id}".turns must be a non-empty list`, file);
  }
  const turns: NegativeFixtureTurn[] = turnsRaw.map((t, i) => {
    if (!isObject(t) || typeof t.assistant !== "string") {
      throw new NegativeFixtureError(`fixture "${id}".turns[${i}] needs an "assistant" string`, file);
    }
    return {
      user: typeof t.user === "string" ? t.user : "",
      assistant: t.assistant,
      tools: Array.isArray(t.tools) ? (t.tools as NegativeFixtureTool[]) : [],
    };
  });
  return { id, note, checkpoint, setup, turns, file };
}

/** Load every `*.yaml` / `*.yml` fixture in a directory, sorted by file name. */
export function loadNegativeFixtures(dir: string): NegativeFixture[] {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  const out: NegativeFixture[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const full = path.join(dir, f);
    const docs = yaml.loadAll(readFileSync(full, "utf8")).filter((d) => d !== null && d !== undefined);
    for (const doc of docs) {
      const fixture = parseNegativeFixture(doc, full);
      if (seen.has(fixture.id)) throw new NegativeFixtureError(`duplicate fixture id "${fixture.id}"`, full);
      seen.add(fixture.id);
      out.push(fixture);
    }
  }
  return out;
}

/** Fixture rendered as the transcript + probe the checker expects. */
export function fixtureAsTranscript(fixture: NegativeFixture): { transcript: Transcript; probe: Probe } {
  const transcript: Transcript = {
    probe: fixture.id,
    model: "negative-fixture",
    turns: fixture.turns.map((t) => ({
      user: t.user,
      assistant: t.assistant,
      tools: (t.tools ?? []).map((tool) => (typeof tool === "string" ? { name: tool } : { ...tool })),
    })),
  };
  const probe: Probe = {
    probe: fixture.id,
    scenarioFile: fixture.file ?? "(fixture)",
    setup: fixture.setup,
    turns: fixture.turns.map((t) => t.user),
    checkpoints: [fixture.checkpoint],
  };
  return { transcript, probe };
}

export interface DiscriminationResult {
  fixture: string;
  checkpoint: string;
  /** Undefined only for a hand-built checkpoint without a check descriptor. */
  kind: DeterministicKind | undefined;
  verdict: Verdict;
  /** True only when the checker returned `fail` — anything else proves nothing. */
  discriminates: boolean;
  /** Human-readable explanation, empty when discriminating. */
  problem: string;
}

/**
 * Score one negative fixture with the REAL deterministic checker.
 *
 * `pass` means the checkpoint let its own negative answer through — a placebo.
 * `not-assessable` / `error` mean the check never ran, so the fixture proves
 * nothing either. All three are failures of the fixture set.
 */
export function scoreNegativeFixture(
  fixture: NegativeFixture,
  corpusIds: Set<string>,
  corpusHeadings: Map<string, string[]> = new Map()
): DiscriminationResult {
  const { transcript, probe } = fixtureAsTranscript(fixture);
  const result = checkDeterministic(fixture.checkpoint, transcript, probe, corpusIds, new Map(), corpusHeadings);
  const kind = fixture.checkpoint.check?.kind;
  const base = { fixture: fixture.id, checkpoint: fixture.checkpoint.id, kind, verdict: result.verdict };
  if (result.verdict === "fail") return { ...base, discriminates: true, problem: "" };
  if (result.verdict === "pass") {
    return {
      ...base,
      discriminates: false,
      problem:
        `checkpoint "${fixture.checkpoint.id}" PASSED the answer written to fail it — it does not ` +
        `discriminate and its green verdicts carry no information (${fixture.note})`,
    };
  }
  return {
    ...base,
    discriminates: false,
    problem:
      `checkpoint "${fixture.checkpoint.id}" returned "${result.verdict}" — the check never ran against the ` +
      `fixture, so it proves no discrimination (${result.reasoning ?? "no reason given"})`,
  };
}

/** Which supported check kinds have at least one discriminating fixture. */
export function kindCoverage(fixtures: NegativeFixture[]): {
  covered: DeterministicKind[];
  missing: DeterministicKind[];
} {
  const have = new Set(fixtures.map((f) => f.checkpoint.check?.kind));
  return {
    covered: SUPPORTED_DETERMINISTIC_KINDS.filter((k) => have.has(k)),
    missing: SUPPORTED_DETERMINISTIC_KINDS.filter((k) => !have.has(k)),
  };
}

export interface ProbeCoverageEntry {
  checkpoint: string;
  kind: DeterministicKind;
  probe: string;
  covered: boolean;
}

/**
 * Per deterministic checkpoint id of a probe set, whether a negative fixture exists
 * for it. Reporting only — the fixtures never reference a scenario file, so a
 * scenario rewrite changes this report without invalidating a single fixture.
 */
export function coverageAgainstProbes(probes: Probe[], fixtures: NegativeFixture[]): ProbeCoverageEntry[] {
  const byId = new Set(fixtures.map((f) => f.checkpoint.id));
  const out: ProbeCoverageEntry[] = [];
  for (const p of probes) {
    for (const cp of p.checkpoints) {
      if (cp.type !== "deterministic" || !cp.check) continue;
      out.push({ checkpoint: cp.id, kind: cp.check.kind, probe: p.probe, covered: byId.has(cp.id) });
    }
  }
  return out;
}
