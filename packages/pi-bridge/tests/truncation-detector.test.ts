/**
 * Tests for Truncated-Completion Detection and Remediation (capability
 * `agent-harness`, Requirement: Truncated-Completion Detection and Remediation).
 * One describe block per spec Scenario.
 *
 * Reproduction ground truth (2026-07-21, OpenRouter): with a small `max_tokens`,
 * `google/gemma-3-27b-it` and `mistralai/mistral-large-2512` both end the
 * completion with `finish_reason: "length"` (streaming: the final chunk carries
 * `finish_reason: "length"` with an empty delta) and a mid-sentence text tail,
 * e.g. "Instead of passively receiving". Pi's openai-completions provider maps
 * that to `stopReason: "length"` on the assistant message (`mapStopReason`),
 * surfaced to the host on `message_end` — the structural signal keyed on here.
 */
import { describe, it, expect } from "vitest";
import {
  TruncationDetector,
  isTruncatedCompletion,
  looksEvidentlyUnfinished,
  applyTruncationVerdict,
  TRUNCATION_CONTINUE_MAX,
  TRUNCATION_CONTINUE_PROMPT,
  TRUNCATION_CUTOFF_NOTE,
  type CompletionEndSignal,
} from "../src/truncation-detector.js";

/** The exact truncated tail observed in the gemma-3-27b-it reproduction. */
const truncatedGemma: CompletionEndSignal = {
  role: "assistant",
  stopReason: "length",
  text: "\nChallenge-based learning (CBL) is an engaging teaching approach where students learn by actively working on real-world problems. Instead of passively receiving",
  toolCallCount: 0,
};

const finishedAnswer: CompletionEndSignal = {
  role: "assistant",
  stopReason: "stop",
  text: "Challenge-based education organises a module around a real, open-ended societal challenge that students work on in teams.",
  toolCallCount: 0,
};

describe("Truncation — Scenario: Truncated completion is detected and not presented as final", () => {
  it('recognises finish_reason "length" (stopReason length) as a truncated completion', () => {
    expect(isTruncatedCompletion(truncatedGemma)).toBe(true);
  });

  it("recognises an evidently unfinished final message on a premature provider stop", () => {
    expect(
      isTruncatedCompletion({
        ...truncatedGemma,
        stopReason: "stop", // premature stop: provider said "stop" but the text is mid-sentence
      })
    ).toBe(true);
  });

  it("does not flag a cleanly finished completion", () => {
    expect(isTruncatedCompletion(finishedAnswer)).toBe(false);
  });

  it("ignores non-assistant messages and error/aborted stops (those have their own handling)", () => {
    expect(isTruncatedCompletion({ ...truncatedGemma, role: "user" })).toBe(false);
    expect(isTruncatedCompletion({ ...truncatedGemma, stopReason: "error" })).toBe(false);
    expect(isTruncatedCompletion({ ...truncatedGemma, stopReason: "aborted" })).toBe(false);
  });

  it("does not remediate a length-capped message that still carries tool calls (the run loop continues on its own)", () => {
    const d = new TruncationDetector();
    const verdict = d.record({ ...truncatedGemma, toolCallCount: 2 });
    expect(verdict.action).toBe("none");
  });

  it("detection is purely structural — the signal shape carries no model id to key on", () => {
    // Compile-time guarantee made explicit: the signal has exactly the four
    // structural fields; a model id is not part of the shape.
    const keys = Object.keys(truncatedGemma).sort();
    expect(keys).toEqual(["role", "stopReason", "text", "toolCallCount"]);
  });

  it("does not finalise silently: a truncated final message yields a non-none verdict", () => {
    const d = new TruncationDetector();
    const verdict = d.record(truncatedGemma);
    expect(verdict.action).not.toBe("none");
  });
});

describe("Truncation — looksEvidentlyUnfinished heuristic (conservative)", () => {
  it("flags a mid-sentence tail (ends on a bare word, no terminal punctuation)", () => {
    expect(looksEvidentlyUnfinished(truncatedGemma.text)).toBe(true);
  });

  it("flags a dangling connective tail (comma / colon / open bracket)", () => {
    const base = "The module is organised in three phases which build on each other over the semester";
    expect(looksEvidentlyUnfinished(`${base},`)).toBe(true);
    expect(looksEvidentlyUnfinished(`${base}: (`)).toBe(true);
  });

  it("flags an unclosed code fence", () => {
    expect(looksEvidentlyUnfinished("Here is the rubric skeleton you asked for:\n\n```markdown\n| Criterion |")).toBe(
      true
    );
  });

  it("does not flag finished sentences, closed fences, or text too short to judge", () => {
    expect(looksEvidentlyUnfinished(finishedAnswer.text)).toBe(false);
    expect(looksEvidentlyUnfinished("Done.\n\n```md\n| a |\n```")).toBe(false);
    expect(looksEvidentlyUnfinished("yes")).toBe(false);
    expect(looksEvidentlyUnfinished("")).toBe(false);
  });
});

describe("Truncation — Scenario: Truncated completion is remediated", () => {
  it("first truncation yields a continue verdict carrying the continuation steer prompt", () => {
    const d = new TruncationDetector();
    const verdict = d.record(truncatedGemma);
    expect(verdict.action).toBe("continue");
    expect(verdict.continuePrompt).toBe(TRUNCATION_CONTINUE_PROMPT);
    expect(TRUNCATION_CONTINUE_PROMPT).toMatch(/cut off|continue/i);
  });

  it(`after ${TRUNCATION_CONTINUE_MAX} auto-continues in one run the verdict becomes surface (cut-off state), never none`, () => {
    const d = new TruncationDetector();
    const verdicts = Array.from({ length: TRUNCATION_CONTINUE_MAX + 2 }, () => d.record(truncatedGemma));
    for (let i = 0; i < TRUNCATION_CONTINUE_MAX; i++) expect(verdicts[i].action).toBe("continue");
    for (let i = TRUNCATION_CONTINUE_MAX; i < verdicts.length; i++) expect(verdicts[i].action).toBe("surface");
  });

  it("reset() restores the continue budget at the next run boundary", () => {
    const d = new TruncationDetector();
    for (let i = 0; i < TRUNCATION_CONTINUE_MAX; i++) d.record(truncatedGemma);
    expect(d.record(truncatedGemma).action).toBe("surface");
    d.reset();
    expect(d.record(truncatedGemma).action).toBe("continue");
  });

  it("applyTruncationVerdict: continue → steers the session via the public surface, run keeps going", () => {
    const steered: string[] = [];
    const notices: string[] = [];
    const surfaced = applyTruncationVerdict(
      { action: "continue", continuePrompt: TRUNCATION_CONTINUE_PROMPT },
      {
        session: {
          steer: (text: string) => {
            steered.push(text);
            return Promise.resolve();
          },
        },
        notifyCutOff: (note: string) => notices.push(note),
      }
    );
    expect(surfaced).toBe(false);
    expect(steered).toEqual([TRUNCATION_CONTINUE_PROMPT]);
    expect(notices).toEqual([]);
  });

  it('applyTruncationVerdict: surface → emits the clear "response was cut off" state instead of finalising silently', () => {
    const steered: string[] = [];
    const notices: string[] = [];
    const surfaced = applyTruncationVerdict(
      { action: "surface", reason: "stopReason length after exhausted continue budget" },
      {
        session: {
          steer: (text: string) => {
            steered.push(text);
            return Promise.resolve();
          },
        },
        notifyCutOff: (note: string) => notices.push(note),
      }
    );
    expect(surfaced).toBe(true);
    expect(steered).toEqual([]);
    expect(notices).toEqual([TRUNCATION_CUTOFF_NOTE]);
    expect(TRUNCATION_CUTOFF_NOTE).toMatch(/cut off/i);
    expect(TRUNCATION_CUTOFF_NOTE).toMatch(/continue|retry/i);
  });

  it("applyTruncationVerdict: none → no side effects", () => {
    const steered: string[] = [];
    const notices: string[] = [];
    const surfaced = applyTruncationVerdict(
      { action: "none" },
      {
        session: {
          steer: (text: string) => {
            steered.push(text);
            return Promise.resolve();
          },
        },
        notifyCutOff: (note: string) => notices.push(note),
      }
    );
    expect(surfaced).toBe(false);
    expect(steered).toEqual([]);
    expect(notices).toEqual([]);
  });
});
