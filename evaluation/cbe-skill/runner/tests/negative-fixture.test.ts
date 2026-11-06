/**
 * Negative fixtures — the discrimination proof. No model is contacted anywhere in
 * this file; the fixtures are scored by the real deterministic checker.
 *
 * spec: cbe-skill-eval-harness, Requirement "Negative fixtures prove checkpoint discrimination"
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_DETERMINISTIC_KINDS,
  coverageAgainstProbes,
  kindCoverage,
  loadNegativeFixtures,
  parseNegativeFixture,
  scoreNegativeFixture,
  type NegativeFixture,
} from "../src/negative-fixture.js";
import { checkDeterministic } from "../src/checker-deterministic.js";
import { loadCorpusHeadings, loadCorpusIds } from "../src/loader.js";
import type { Probe } from "../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const fixtureDir = path.join(repoRoot, "evaluation", "cbe-skill", "fixtures", "negative");
const corpusIds = loadCorpusIds(path.join(repoRoot, "corpus", "index.json"));
// `cite_section_resolves` resolves a token's § against the REAL corpus headings; without
// them it reports `not-assessable`, which the fixture gate treats as "the check never ran".
const corpusHeadings = loadCorpusHeadings(path.join(repoRoot, "corpus", "index.json"));

const fixtures = loadNegativeFixtures(fixtureDir);

function fixtureFrom(overrides: Partial<NegativeFixture>): NegativeFixture {
  return {
    id: "f",
    note: "n",
    checkpoint: { id: "cp", type: "deterministic", anchors: [], check: { kind: "contains", pattern: "needle" } },
    setup: { profile: "app" },
    turns: [{ user: "u", assistant: "no match here", tools: [] }],
    ...overrides,
  };
}

describe("negative fixture set", () => {
  it("loads at least one fixture per file without error", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(SUPPORTED_DETERMINISTIC_KINDS.length);
  });

  // spec: A checkpoint that cannot fail is reported as a placebo
  // spec: A negative fixture that never exercises the check is rejected
  // spec: Negative fixtures run without a model
  it("every fixture makes its checkpoint fail", () => {
    const results = fixtures.map((f) => scoreNegativeFixture(f, corpusIds, corpusHeadings));
    const broken = results.filter((r) => !r.discriminates);
    expect(
      broken.map((r) => `${r.fixture} [${r.kind}] -> ${r.verdict}: ${r.problem}`),
      "a fixture that does not produce `fail` proves no discrimination"
    ).toEqual([]);
    expect(results.every((r) => r.verdict === "fail")).toBe(true);
  });

  // spec: Every supported deterministic check kind carries a negative fixture
  it("covers every supported deterministic check kind", () => {
    const { missing } = kindCoverage(fixtures);
    expect(missing, "a check kind without a negative fixture is unproven").toEqual([]);
  });

  // The gate is only binding if its kind list IS the checker's. The union direction
  // ("no kind is missing from the list") is a compile error via
  // `satisfies Record<DeterministicKind, true>`; this covers the other direction —
  // no listed kind is one the checker does not actually handle.
  it("lists only kinds the deterministic checker implements", () => {
    const probe: Probe = {
      probe: "kinds",
      scenarioFile: "(test)",
      setup: { profile: "app" },
      turns: ["u"],
      checkpoints: [],
    };
    const transcript = { probe: "kinds", model: "test", turns: [{ user: "u", assistant: "a", tools: [] }] };
    const unhandled = SUPPORTED_DETERMINISTIC_KINDS.filter((kind) => {
      const r = checkDeterministic(
        { id: "cp", type: "deterministic", anchors: [], check: { kind } },
        transcript,
        probe,
        corpusIds
      );
      return /unknown deterministic kind/.test(r.reasoning ?? "");
    });
    expect(unhandled, "a listed kind the checker's switch does not handle").toEqual([]);
  });

  it("keeps a fixture's note, so a flipped fixture can be debugged", () => {
    expect(fixtures.every((f) => f.note.trim().length > 20)).toBe(true);
  });
});

describe("scoreNegativeFixture", () => {
  // spec: A checkpoint that cannot fail is reported as a placebo
  it("reports a placebo when the checkpoint passes its own negative answer", () => {
    // The pattern IS in the answer, so `contains` passes — the fixture is not discriminating.
    const f = fixtureFrom({
      id: "placebo",
      turns: [{ user: "u", assistant: "the needle is right here", tools: [] }],
    });
    const r = scoreNegativeFixture(f, corpusIds, corpusHeadings);
    expect(r.verdict).toBe("pass");
    expect(r.discriminates).toBe(false);
    expect(r.problem).toMatch(/does not\s+discriminate/);
    expect(r.problem).toContain("cp");
  });

  // spec: A negative fixture that never exercises the check is rejected
  it("rejects a fixture whose checkpoint comes back not-assessable", () => {
    const f = fixtureFrom({
      id: "unexercised",
      // `cbe_picker` needs the picker affordance, which the headless profile disables.
      checkpoint: { id: "cp", type: "deterministic", check: { kind: "tool_called", tool: "cbe_picker" } },
      setup: { profile: "headless" },
    });
    const r = scoreNegativeFixture(f, corpusIds, corpusHeadings);
    expect(r.verdict).toBe("not-assessable");
    expect(r.discriminates).toBe(false);
    expect(r.problem).toMatch(/never ran/);
  });

  it("rejects a fixture whose checkpoint errors out", () => {
    const f = fixtureFrom({
      id: "errored",
      checkpoint: { id: "cp", type: "deterministic" },
    });
    const r = scoreNegativeFixture(f, corpusIds, corpusHeadings);
    expect(r.verdict).toBe("error");
    expect(r.discriminates).toBe(false);
    expect(r.problem).toMatch(/never ran/);
  });
});

describe("negative fixture loader", () => {
  // spec: A judge checkpoint may not be given a negative fixture
  it("rejects a judge checkpoint and points at the gold set", () => {
    expect(() =>
      parseNegativeFixture(
        {
          id: "judgey",
          note: "a rubric cannot be graded without a model",
          checkpoint: { id: "cp", type: "judge", rubric: "Does it name a mechanism?" },
          setup: { profile: "app" },
          turns: [{ user: "u", assistant: "a" }],
        },
        "f.yaml"
      )
    ).toThrow(/gold set/);
  });

  it("rejects an unsupported check kind", () => {
    expect(() =>
      parseNegativeFixture(
        {
          id: "bogus",
          note: "kind does not exist",
          checkpoint: { id: "cp", type: "deterministic", check: { kind: "vibes" } },
          setup: { profile: "app" },
          turns: [{ user: "u", assistant: "a" }],
        },
        "f.yaml"
      )
    ).toThrow(/unsupported check kind/);
  });

  it("requires a note", () => {
    expect(() =>
      parseNegativeFixture(
        {
          id: "unnoted",
          checkpoint: { id: "cp", type: "deterministic", check: { kind: "contains", pattern: "x" } },
          setup: { profile: "app" },
          turns: [{ user: "u", assistant: "a" }],
        },
        "f.yaml"
      )
    ).toThrow(/"note"/);
  });
});

describe("coverageAgainstProbes", () => {
  // spec: Fixture coverage over a probe set is reportable
  it("reports per-checkpoint coverage without any fixture referencing a scenario", () => {
    const probes: Probe[] = [
      {
        probe: "9a",
        scenarioFile: "09.md",
        setup: { profile: "app" },
        turns: ["t"],
        checkpoints: [
          { id: "neg.contains.1", type: "deterministic", check: { kind: "contains", pattern: "x" } },
          { id: "9a.7", type: "deterministic", check: { kind: "tool_called", tool: "cbe_cite" } },
          { id: "9a.8", type: "judge", rubric: "quality" },
        ],
      },
    ];
    const coverage = coverageAgainstProbes(probes, fixtures);
    expect(coverage.map((c) => c.checkpoint)).toEqual(["neg.contains.1", "9a.7"]); // judge excluded
    expect(coverage.find((c) => c.checkpoint === "neg.contains.1")!.covered).toBe(true);
    expect(coverage.find((c) => c.checkpoint === "9a.7")!.covered).toBe(false);
    // The fixtures themselves name no scenario file.
    expect(fixtures.every((f) => !/scenarios/.test(f.file ?? ""))).toBe(true);
  });
});
