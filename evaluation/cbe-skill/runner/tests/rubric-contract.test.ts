/**
 * The rubric contract — model-free assertions on the SHIPPED scenario files.
 *
 * spec: cbe-skill-eval-harness, Requirement "A Turn-Scoped Judge Rubric Is Decided and
 *       Evidenced Inside Its Turn"
 *       cbe-skill-eval-harness, Requirement "A Judge Rubric's PASS and FAIL Clauses Decide
 *       Every Answer It Grades"
 *
 * Why these live in code rather than in a reviewer's head: every rubric asserted here failed a
 * CORRECT answer in the n=3 gemma runs of 2026-08-10 / 08-11, and in each case the transcript
 * satisfied the criterion the rubric meant. Nothing in this file contacts a model or a judge —
 * a judge verdict cannot be asserted against a stub without proving that the stub obeyed its
 * script (the same reason `negative-fixture.ts` refuses judge fixtures). What IS mechanically
 * checkable is whether the rubric SAYS what it means, and that is what is checked.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpusIds, parseProbes } from "../src/loader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const scenarioDir = path.join(repoRoot, "evaluation", "cbe-skill", "scenarios");
const corpusIds = loadCorpusIds(path.join(repoRoot, "corpus", "index.json"));

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function rubric(file: string, id: string): string {
  const probes = parseProbes(readFileSync(path.join(scenarioDir, file), "utf8"), file, corpusIds, { onWarn: () => {} });
  const cp = probes.flatMap((p) => p.checkpoints).find((c) => c.id === id);
  if (!cp?.rubric) throw new Error(`no rubric for checkpoint ${id} in ${file}`);
  return flat(cp.rubric);
}

// ─────────────────────────────────────────────────────────────────────────────
// A FAIL trigger does not name what a later turn is required to do
// ─────────────────────────────────────────────────────────────────────────────

describe("2d — the FAIL trigger is turn-1-local", () => {
  const twoD = rubric("02-ten-steps.md", "2d");
  const twoE = rubric("02-ten-steps.md", "2e");

  // spec scenario: A FAIL trigger does not name what a later turn is required to do
  it("names the sibling that grades the later turn", () => {
    expect(twoD).toContain("graded by 2e");
    expect(twoD).toContain("MUST NOT influence the verdict");
  });

  it("declares the status list correct in turn 2 rather than a FAIL trigger", () => {
    // 2e requires the standing to follow the record, and step 5 is out of scope in it.
    expect(twoE).toContain("step 5 was declared out of scope in turn 1");
    // So 2d must say that naming the exclusion there is expected, not a managed item.
    expect(twoD).toContain("is REQUIRED there and is graded by 2e");
    expect(twoD).toContain("never evidence against turn 1");
  });

  it("scopes every FAIL trigger to what turn 1 itself contains", () => {
    expect(twoD).toContain("FAIL only on what turn 1 itself contains");
    expect(twoD).toContain("the evidence quote MUST come from turn 1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A framing sentence carries no ungraded requirement
// A rubric does not grade what the judge cannot see
// ─────────────────────────────────────────────────────────────────────────────

describe("10d — every condition sits in a deciding clause", () => {
  const tenD = rubric("10-canvas-recording.md", "10d");

  // spec scenario: A framing sentence carries no ungraded requirement
  it("does not make the reasoning-in-the-reply a requirement, since no clause decided on it", () => {
    // The pre-repair framing sentence is what the 0/3 verdict rested on.
    expect(tenD).not.toContain("The reply carries the reasoning — why the frame holds");
    expect(tenD).toContain("Whether the reply argues why the frame holds or what it constrains is not required");
  });

  it("states its PASS condition and enumerates its FAIL modes exhaustively", () => {
    expect(tenD).toContain("PASS requires BOTH");
    expect(tenD).toContain("FAIL on any ONE of three things, and on nothing else");
  });

  // spec scenario: A reproduced borderline answer is decided in one direction — the reply
  // that records and then never mentions the frame (S10 r2 of run-2026-08-11).
  it("decides the reply that never refers to the settled frame", () => {
    expect(tenD).toContain("the reply never refers to the settled frame in any form");
  });

  // spec scenario: A rubric does not grade what the judge cannot see
  it("forbids deciding on what the recording call wrote", () => {
    expect(tenD).toContain("the transcript carries tool names only, never their arguments");
    expect(tenD).toContain("never decide this checkpoint on the content of the card");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A rubric does not fail what its own PASS clause describes
// ─────────────────────────────────────────────────────────────────────────────

describe("12c — the FAIL list no longer contradicts the PASS clause", () => {
  const twelveC = rubric("12-alignment-check.md", "12c");

  // spec scenario: A rubric does not fail what its own PASS clause describes
  it("does not fail the depth/scope contrast its PASS clause requires", () => {
    expect(twelveC).toContain("coarse and early over challenge, outcomes and assessment");
    expect(twelveC).toContain("DESCRIBING THAT DIFFERENCE IS REQUIRED, NOT A FAILURE");
    // The contradicting trigger is gone: a label is not a failure condition.
    expect(twelveC).not.toContain("separate names");
  });

  it("permits the product's own labels while still failing two concepts", () => {
    expect(twelveC).toContain('"Coherence Gate" for the early one, "Alignment Check" for the late one');
    expect(twelveC).toContain("presents them as two different checks or two concepts");
  });

  it("keeps the bare 'we check again later' answer failing", () => {
    expect(twelveC).toContain('it says only "yes, at step 9 we check again"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A reproduced borderline answer is decided in one direction
// ─────────────────────────────────────────────────────────────────────────────

describe("7c — the role-as-authority boundary is decided", () => {
  const sevenC = rubric("07-non-negotiables.md", "7c");

  // spec scenario: A reproduced borderline answer is decided in one direction
  it("says outright that naming its own role is not the failure", () => {
    expect(sevenC).toContain("NAMING ITS OWN ROLE IS NOT THE FAILURE, and this is decided");
    expect(sevenC).toContain("stays a PASS as long as the substantive consideration follows");
  });

  it("keeps the two forms the canonical spec forbids, and adds the mandate-only answer", () => {
    expect(sevenC).toContain("a numbered non-negotiable or to an internal rule list");
    expect(sevenC).toContain("the assistant's own mandate is the WHOLE justification");
  });

  it("no longer carries the undecided 'cites its own rule set as the authority' phrase", () => {
    expect(sevenC).not.toContain("cites its own rule set as the authority");
  });
});
