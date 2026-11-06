/**
 * Bundle-content contract for `guide-the-work-by-lecturer-intent`.
 *
 * These tests prove only that the eager skill carries each OpenSpec scenario's
 * instruction. They do not claim that a model follows it; the eval instrument
 * measures adherence separately; a source edit remains unmeasured until an
 * authorised live run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cbeIdentityPrompt, stripFrontmatter } from "../src/cbe-system-prompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const body = stripFrontmatter(readFileSync(path.resolve(__dirname, "../../../skills/cbe/SKILL.md"), "utf8"));

function section(start: string, end?: string): string {
  const from = body.indexOf(start);
  expect(from, `missing start marker: ${start}`).toBeGreaterThan(-1);
  const to = end ? body.indexOf(end, from + start.length) : body.length;
  expect(to, `missing end marker: ${end ?? "EOF"}`).toBeGreaterThan(from);
  return body.slice(from, to);
}

const opening = section("**1. Opening.**", "**2. The ten steps.**");
const review = section("## Critical review", "## Delegation check");
const maturity = section("## Maturity", "## Critical review");

// Scenario names mirror the OpenSpec delta. Each assertion pins an instruction,
// never a lecturer-facing script or a semantic keyword classifier.
describe("Intent-Sensitive Work Guidance — bundle content", () => {
  it("Clear design intent gets a design start", () => {
    expect(opening).toMatch(/design makes or revises CBE decisions/i);
    expect(opening).toMatch(/absent ambition gets one material-bound question/i);
    expect(opening).toMatch(/chosen or recorded start, otherwise framing/i);
    expect(opening).toMatch(/name the next move, not its full output/i);
  });

  it("Clear transfer intent starts from the existing teaching", () => {
    expect(opening).toMatch(/transfer adapts existing teaching/i);
    expect(opening).toMatch(/transfer uses the teaching element and immediate adaptation issue/i);
    expect(opening).toMatch(/not a blank interview or finished conversion/i);
  });

  it("Explicit review intent is served immediately", () => {
    expect(opening).toMatch(/Explicit review starts weakness-first/i);
    expect(review).toMatch(/whenever the lecturer asks or accepts your offer/i);
    expect(review).toMatch(/at least three student perspectives/i);
  });

  it("Genuinely ambiguous intent gets one focused clarification", () => {
    expect(opening).toMatch(/plausible readings would change that action materially/i);
    expect(opening).toMatch(/ask one focused intended-result question/i);
    expect(opening).toMatch(/do neither reading's work yet/i);
  });

  it("Inconsequential ambiguity does not become a category question", () => {
    expect(opening).toMatch(/If the next move is shared, take it/i);
    expect(opening).toMatch(/Work a named design or transfer entry immediately/i);
  });

  it("Supplied material alone does not select a route", () => {
    expect(opening).toMatch(/Unsolicited material selects no work/i);
    // The generic conduct floor keeps its existing prompt-channel owner.
    expect(cbeIdentityPrompt).toMatch(
      /Material arriving without an instruction:[^\n]*ask what to do with it\. Do not process it/i
    );
  });

  it("A challenge topic is not a review request", () => {
    expect(opening).toMatch(/A challenge, file, full canvas or satisfaction alone requests no review/i);
  });

  it("Explicit intent overrides the material's apparent route", () => {
    expect(opening).toMatch(/Latest request outranks prior readings and material shape/i);
  });

  it("A requested sequence is not treated as ambiguous", () => {
    expect(opening).toMatch(/work an ordered combination in order/i);
  });

  it("Missing material prompts for the work's subject, not its mode", () => {
    expect(opening).toMatch(/if its design is absent, ask for the relevant part/i);
    expect(opening).toMatch(/asking for a missing source/i);
    expect(opening).toMatch(/No modes/i);
  });

  it("An intent change mid-session redirects the work without resetting it", () => {
    expect(opening).toMatch(/When the request changes, acknowledge it and act in that turn/i);
    expect(opening).toMatch(/no reset, repeated target or forced finish/i);
  });

  it("A returning course continues from its recorded state", () => {
    expect(opening).toMatch(/On return, continue from the cards and step coverage/i);
    expect(opening).toMatch(/Recorded state sets the start, never consent to transfer or review/i);
  });

  it("Review completion hands back without imposing redesign", () => {
    expect(review).toMatch(/hand back to the work it interrupted/i);
    expect(review).toMatch(/if there was none, name the next concrete decision/i);
    expect(review).toMatch(/without starting a redesign/i);
  });

  it("The selected work is legible through its substance", () => {
    // Canonical MUST: connect what is worked on to the immediate action, "not a separate
    // announcement or three-way agenda". Only the skill body instructs the second half.
    expect(opening).toMatch(/Join object to immediate action; announce no category or agenda/i);
  });

  it("exposes no selector, fixed route script or persistent mode", () => {
    expect(opening).not.toMatch(/Design\s*[\/]\s*Transfer\s*[\/]\s*Review/i);
    expect(opening).not.toMatch(/choose (a|your) mode|select (a|your) mode/i);
    expect(body).not.toContain("cbe_set_mode");
    expect(body).not.toMatch(/persist(ed|ent)? (mode|route)|restore(d)? (mode|route)/i);
  });
});

describe("Opening precedence and target ambition — bundle content", () => {
  it("The ambition question opens the session", () => {
    expect(opening).toMatch(/One thing owns the first substantive turn/i);
    expect(opening).toMatch(/Otherwise, absent ambition gets one material-bound question/i);
  });

  it("A recorded intent is adopted, not re-elicited", () => {
    expect(opening).toMatch(/What is already on record you adopt, never re-ask/i);
  });

  it("Recommendations do not escalate beyond the target", () => {
    expect(maturity).toMatch(/Recommendations stay within the declared target/i);
    expect(maturity).toMatch(/a shortfall named against it is no escalation/i);
  });

  it("A supplied ambition is an answer, not a reason to ask again", () => {
    expect(opening).toMatch(/Supplied intent, ambition and source availability are inputs, not questions/i);
    expect(opening).toMatch(/consume them before intake/i);
    expect(opening).toMatch(/Design takes the next missing decision from its chosen or recorded start/i);
  });

  it("The ambition question owns the first substantive turn", () => {
    expect(opening).toMatch(/One thing owns the first substantive turn/i);
    expect(opening).toMatch(/not its full output/i);
    expect(opening).toMatch(/Profile in passing, never as a questionnaire/i);
    // Canonical `cbe-skill` Scenario *The ambition question owns the first substantive
    // turn* keeps its THEN clause "orients briefly AND asks for the intended
    // implementation depth", so the brief orientation has to stay instructed beside the
    // ambition question rather than only in § Help.
    expect(opening).toMatch(/full rebuild\. Orient briefly; name the next move/i);
  });

  it("A review opening is served as a review", () => {
    expect(opening).toMatch(/Explicit review starts weakness-first/i);
    expect(opening).not.toMatch(/offer (a|the) review before/i);
  });

  it("Nothing is gated behind a missing reading", () => {
    expect(opening).toMatch(/Nothing is a gate/i);
    expect(maturity).toMatch(/an empty raster is expected, not a gap/i);
  });

  it("Necessary intent clarification does not stack opening questions", () => {
    expect(opening).toMatch(/add no target or profile question/i);
  });

  it("An explicit working entry point is not displaced by the opening", () => {
    expect(opening).toMatch(/Work a named design or transfer entry immediately/i);
    expect(opening).toMatch(/ambition only in passing if it changes the work, never as a gate/i);
  });

  it("A help opening retains one compact orientation", () => {
    expect(opening).toMatch(/Help gets compact orientation and at most that intent question/i);
    expect(section("## Help")).toMatch(/one compact turn/i);
  });
});
