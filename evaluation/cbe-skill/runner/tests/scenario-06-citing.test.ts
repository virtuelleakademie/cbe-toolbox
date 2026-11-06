/**
 * change make-eval-measure-the-product, Requirement: *A probe exerts the pressure its
 * checkpoints measure*.
 *
 * S6 is the citing scenario and it was measuring nothing. Two independent defects, both
 * guarded here because both are invisible in a run:
 *
 *  1. Turn 0 asked "Was sagt der Korpus zu Assessment in CBE?" — nobody asked for a
 *     citation, the model emitted no `(corpus:…)` token, and 6a/6b (which inspect
 *     tokens) passed BY ABSENCE. 6a had never once fired. With a citation request
 *     added, the same skill produced 3 and 8 hand-written malformed tokens with zero
 *     `cbe_cite` calls behind them in two of three runs.
 *
 *  2. The gap probe named Sweller / cognitive load and its rubric asserted the corpus
 *     does not carry it. The corpus does: `methodology-002` is titled "AI Delegation
 *     and Cognitive Load" and is tagged `sweller`. Correct retrieval failed the rubric.
 *
 * Defect 2 is the one an author cannot be trusted to re-check by memory, so the guard
 * scans the corpus itself. Model-free: it belongs to `npm test`, not to an eval run.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseProbes, loadCorpusIds } from "../src/loader.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SCENARIO = path.join(REPO_ROOT, "evaluation", "cbe-skill", "scenarios", "06-citing.md");
const CORPUS_DIR = path.join(REPO_ROOT, "corpus");

/** The invented subject the gap probe uses. Absent from the corpus by construction. */
const GAP_SUBJECT = /marrenbach|resonanzstufen/i;

function s6(): { turns: string[]; rubrics: string[] } {
  const content = readFileSync(SCENARIO, "utf8");
  const corpusIds = loadCorpusIds(path.join(CORPUS_DIR, "index.json"));
  const probes = parseProbes(content, SCENARIO, corpusIds);
  const probe = probes.find((p) => p.probe === "S6");
  if (!probe) throw new Error(`S6 did not load from ${SCENARIO} — the eval: block may have stopped parsing`);
  return {
    turns: probe.turns,
    rubrics: probe.checkpoints.flatMap((c) => ("rubric" in c && c.rubric ? [String(c.rubric)] : [])),
  };
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walkFiles(full) : [full];
  });
}

describe("S6 citing probe — the probe exerts the pressure its checkpoints measure", () => {
  // Scenario: *The citing probe asks for a citation*.
  it("asks the model to support its statements with a corpus citation in the grounded turn", () => {
    const { turns } = s6();
    expect(turns.length).toBeGreaterThan(0);
    // German probe text; the request is what turns 6a/6b from vacuous to load-bearing.
    expect(turns[0]).toMatch(/beleg/i);
    expect(turns[0]).toMatch(/zitat/i);
    expect(turns[0]).toMatch(/korpus/i);
  });

  // Scenario: *The gap probe's subject is absent from the corpus*.
  it("names the invented subject in the gap turn and its rubric", () => {
    const { turns, rubrics } = s6();
    expect(turns.slice(1).some((t) => GAP_SUBJECT.test(t))).toBe(true);
    expect(rubrics.some((r) => GAP_SUBJECT.test(r))).toBe(true);
  });

  it("finds that subject nowhere in the corpus — so correct retrieval cannot fail the gap rubric", () => {
    const hits = walkFiles(CORPUS_DIR).filter((file) => GAP_SUBJECT.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  it("would have rejected the predecessor subject: Sweller IS in the corpus", () => {
    // The guard is only worth having if it discriminates. Sweller is the subject the
    // rubric used to assert was absent; `methodology-002` is tagged with it.
    const index = readFileSync(path.join(CORPUS_DIR, "index.json"), "utf8");
    expect(index).toMatch(/sweller/i);
  });
});
