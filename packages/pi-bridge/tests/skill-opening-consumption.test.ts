/**
 * Instruction-surface regressions for consume-opening-inputs-before-intake.
 * These tests check the actual eager bundle, not a test-only intent classifier.
 * They cannot establish model adherence; the live S1 probes remain the instrument.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "../src/cbe-system-prompt.js";

const body = stripFrontmatter(
  readFileSync(fileURLToPath(new URL("../../../skills/cbe/SKILL.md", import.meta.url)), "utf8")
);
function between(start: string, end: string): string {
  const from = body.indexOf(start);
  const to = body.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing section: ${start} / ${end}`);
  return body.slice(from, to);
}
const opening = between("**1. Opening.**", "**2. The ten steps.**");
const maturity = between("## Maturity", "## Critical review");
const help = body.slice(body.indexOf("## Help"));

describe("opening inputs are consumed before intake — bundle contract, not model behaviour", () => {
  it("records a settled overall target in the settling turn, not merely in prose (1f)", () => {
    expect(maturity).toMatch(
      /^## Maturity\s+Record settled ambition with `cbe_maturity` in that turn as the overall target/
    );
    expect(maturity).toContain("Prose alone does not record it");
    expect(maturity).toContain("before any achieved reading exists");
    expect(maturity).toContain("achieved reading starts at the coherence gate after step 3");
  });

  it("Supplied transfer ambition and missing source are consumed together (1q)", () => {
    const consumption = opening.indexOf(
      "Supplied intent, ambition and source availability are inputs, not questions: consume them before intake"
    );
    expect(consumption).toBeGreaterThan(-1);
    const absent = opening.indexOf("Otherwise, absent ambition gets one material-bound question");
    expect(absent).toBeGreaterThan(consumption);
    expect(opening).toContain("asking for a missing source or concise description");
    expect(opening).toContain("not a blank interview or finished conversion");
  });

  it("consequential ambiguity owns exactly one question and no guessed output (1k)", () => {
    const ambiguity = opening.slice(
      opening.indexOf("If plausible readings"),
      opening.indexOf("If the next move is shared")
    );
    expect(ambiguity).toContain("ask one focused intended-result question naming the uncertainty");
    expect(ambiguity).toContain("do neither reading's work yet and add no target or profile question");
  });

  it("Answered ambiguity advances the supplied material (1l)", () => {
    expect(opening).toContain("An answer advances the material-based work, never restarts intake");
    expect(opening).toContain(
      "After clarification or a named entry, ambition only in passing if it changes the work, never as a gate"
    );
    expect(opening).toContain("transfer uses the teaching element and immediate adaptation issue");
  });

  it("help supplies a next move rather than a capability manual or mode menu (1s)", () => {
    expect(opening).toContain("Help gets compact orientation and at most that intent question");
    expect(help).toContain("one compact turn");
    expect(help).toContain("No manual, mode menu or questionnaire");
    expect(help).toContain("at most one follow-up question about intended work, ending in a concrete next step");
  });

  it("A first-step transfer starts with a bounded adaptation decision (1u)", () => {
    expect(opening).toContain(
      "First-step ambition means one smallest qualifying adaptation move, no larger-scope offer or scope gate"
    );
    // An adaptation move is a decision frame, not a ready-made bridge exercise: since
    // `recalibrate-tutor-support` that rests on the consent gate (nothing formulated for
    // their course unasked) rather than on the retired criteria-only ceiling.
    expect(body).toContain("Nothing formulated for their course unasked");
    expect(body).toContain("Their explicit request, or their yes to your offer, is consent");
  });

  it("joins the work's object to the immediate action instead of announcing a category", () => {
    // Canonical `cbe-skill` Requirement *Intent-Sensitive Work Guidance*: the skill MUST
    // connect what it will work on to the immediate action, "not a separate announcement
    // or three-way agenda". The opening-input re-cut must not trade this away — no other
    // instruction channel carries the anti-announcement half.
    expect(opening).toContain("Join object to immediate action; announce no category or agenda");
    expect(opening).not.toMatch(/announce (the|a) (selected )?(route|category|mode)\b/i);
  });

  it("recognises an orientation-shaped opening as help (1s)", () => {
    // S1k's probe opens with "Wo fange ich an, und wobei kannst du mir überhaupt helfen?",
    // so the compact-orientation rule has to name the orientation-shaped question too.
    expect(help).toMatch(/^## Help\s+Help or orientation gets one compact turn/);
  });

  it("keeps genuinely absent ambition distinct from a clarification answer (green 1t)", () => {
    expect(opening).toContain(
      "Otherwise, absent ambition gets one material-bound question: first step, substantial revision or full rebuild"
    );
    expect(opening).toContain("Orient briefly; name the next move, not its full output");
    expect(opening).toContain("What is already on record you adopt");
    expect(opening).toContain("After clarification or a named entry, ambition only in passing");
  });
});
