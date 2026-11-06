import { stepCanonicalSlots, stepEmptySlots, type CanvasFillLookup } from "./canvas-addressing.js";
import type { StepDepth } from "./step-mirror.js";
/**
 * Per-run outstanding-question gate (capability `agent-harness`, Requirement:
 * *Deterministic Tool-Boundary Enforcement for Canvas Ids, Step Coverage and Unfed
 * Surfaces*, Scenario: *Mirroring writes are refused while a picker emitted in the
 * same run is unanswered*).
 *
 * `cbe_picker` uses the deferred-answer architecture: the tool returns immediately
 * and the lecturer's answer arrives as the NEXT user turn,
 * which necessarily starts a NEW agent run. Therefore any mirroring write issued after
 * a picker emission *within the same run* cannot be grounded in that answer — not as a
 * matter of judgement, but by construction.
 *
 * That is exactly what happened on 2026-08-03: at log line 75 the stakeholder picker
 * was rendered, and at line 77 — same run, no lecturer turn in between — the model
 * asserted the selection "lecturer", wrote the canvas artefact and set the step depth.
 * The real answer arrived at line 82 and was different.
 *
 * The gate is deliberately tiny and run-scoped: it is reset at the `agent_start`
 * boundary alongside the existing per-run observers (tool-loop and truncation
 * detectors), so it can never leak across turns and can never wedge a session.
 *
 * ## The other half of the same contract: the run ENDS on a deferred-answer call
 *
 * The gate refuses work that cannot be grounded yet. The complementary rule is that
 * there is no work left at all: a deferred-answer tool returns `terminate: true`
 * (capability `agent-harness`, Requirement: *The Agent Run Ends on a Deferred-Answer
 * Tool Call*), so pi's loop stops after the tool batch instead of re-invoking the
 * model on a placeholder that carries no information. Each tool sets the field in its
 * own `execute()` — the family lives here as documentation, not as a registry, so no
 * indirection sits between a tool and its own result. The family is a PROPERTY, not a
 * list: today `cbe_picker` is its only registered member (`cbe_decision_checklist` is
 * de-registered but keeps the field), and a tool registered later inherits the rule
 * without amendment.
 *
 * The MIRRORING tools (`cbe_canvas`, `cbe_step`, `cbe_maturity`) are deliberately NOT
 * in this family. They wait for no lecturer answer, but they accompany substantive
 * work in the same response, and a refusal from them must be corrected and re-issued
 * in that same turn. That rule lives in EACH REFUSABLE TOOL'S OWN `description` — the
 * channel the refusal itself arrives in — and no longer in the skill body, which
 * carries no tool mechanics at all (capability `agent-harness`, Requirement:
 * *Instruction Channel Boundary*). Stated once in the body it lost 12:1 against the
 * fire-and-forget wording in the tool descriptions, and it sat behind the 50 KB `read`
 * truncation besides. Terminating on them would cut the response off mid-work.
 */
export class PendingAnswerGate {
  private outstanding: { toolName: string; question: string } | null = null;

  /** Record that a deferred-answer tool rendered a question in the current run. */
  registerEmission(toolName: string, question: string): void {
    this.outstanding = { toolName, question: question.trim().slice(0, 160) };
  }

  /** True while this run has rendered a question whose answer cannot have arrived. */
  hasOutstanding(): boolean {
    return this.outstanding !== null;
  }

  /** The outstanding question, for the refusal text. */
  outstandingQuestion(): string | null {
    return this.outstanding?.question ?? null;
  }

  /** Reset at the run boundary — a new run means the lecturer's turn has landed. */
  reset(): void {
    this.outstanding = null;
  }
}

/** Shared refusal wording, so the canvas and step tools speak with one voice. */
export function pendingAnswerRefusalText(tool: "cbe_canvas" | "cbe_step", question: string | null): string {
  const q = question ? ` ("${question}")` : "";
  return (
    `${tool}: refused — you rendered a question to the lecturer in this turn${q} and their answer has not arrived yet. ` +
    `It reaches you as the NEXT lecturer message, so nothing recorded now can be grounded in it. ` +
    `Wait for the answer, then record what they actually chose. No update applied.`
  );
}

/**
 * Outstanding-surface notice (capability `agent-harness`, Requirement:
 * *The Maturity Demands Are Staged Across the Session*, Scenarios: *No achieved
 * reading is demanded before the coherence gate* / *The reading is demanded once the
 * gate is passed* / *Progress does not repeat the demand*; and Requirement:
 * *Deterministic Tool-Boundary Enforcement…*).
 *
 * Derived from host state and appended to accepted `cbe_canvas` / `cbe_step` results,
 * so the obligation reaches the model on a channel it already reads — no eager-body
 * characters spent and no reference file to open. In the 2026-08-03 session
 * `cbe_maturity` was called ZERO times across 147 entries although the affordance was
 * `true` and the target ambition had been settled at log line 14.
 *
 * TWO THINGS CHANGED with `stage-the-maturity-reading-behind-the-coherence-gate`, and
 * both are about WHEN a demand is legitimate rather than about what it says:
 *
 * 1. **The TARGET demand left this channel entirely.** It now reaches the model
 *    through the environment descriptor, from the session's first turn and before
 *    anything has been mirrored (`environment.ts`, `maturityTargetDemandLines`). Riding
 *    the per-write channel made it fire only as a by-product of a mirror call, and then
 *    on EVERY accepted write — so a cold session was never asked at all while a diligent
 *    one was asked twenty times. The target is not about any step; the slot echo is, and
 *    that one stays exactly as it was.
 * 2. **The achieved-reading demand is staged behind the coherence gate after step 3.**
 *    Before the gate the seven criteria have no subject to be read against — the frame,
 *    the outcomes and the assessment blueprint are what the gate first holds against
 *    each other — so an unread raster is the EXPECTED state there and reporting it as
 *    outstanding is a demand nobody can satisfy. The skill states the same starting
 *    point in § Maturity; the host only enforces it.
 *
 * **What "unfed" means, corrected 2026-08-10.** The notice asked `isEmpty()`, which is
 * true only for a mirror holding NO record at all. But change 1 above puts the target
 * demand at the session's start, and the target is recorded through `cbe_maturity` —
 * so the moment a session answers it, the mirror is non-empty and the post-gate branch
 * became unreachable for precisely the sessions the staging describes. The first live
 * run (2026-08-10, S14b: `overall.target: 2` on record, step 3 settled) got a bare
 * "Step 3 updated: depth refined, focus true." and no notice. The predicate is
 * `hasAchievedReading()` — the same one `governingStaleness` moved to for the same
 * reason (`design-substance.ts`): an ambition is not a reading.
 */
export interface MaturityFeedState {
  /** True when no reading has been recorded at all. */
  isEmpty(): boolean;
  /** True when at least one record carries a numeric target level. Read by the
   *  descriptor's target demand, no longer by this notice. */
  hasTarget?(): boolean;
  /**
   * True when at least one record carries an ACHIEVED level. This — not `isEmpty()`
   * — is what the notice below asks about, and the distinction is the whole point of
   * the staging: the TARGET is settled in the opening, through the same tool, so a
   * session that has answered the descriptor's target demand carries a NON-EMPTY
   * mirror with no reading in it. Measured against `isEmpty()`, the post-gate branch
   * was unreachable for exactly the sessions the staging was written for.
   *
   * Optional so a fixture predating the correction keeps its behaviour (the same
   * shape `MaturityProvenanceSource` in `design-substance.ts` uses); the real
   * `MaturityMirror` always implements it.
   */
  hasAchievedReading?(): boolean;
}

/**
 * The steps the coherence gate after step 3 holds against each other: the frame with
 * its initial challenge idea (1), the stated outcomes (2), the assessment blueprint
 * (3). Named once here so the host's gate and the skill's § Maturity cannot drift.
 */
export const COHERENCE_GATE_STEPS: readonly number[] = [1, 2, 3];

/** The minimal step-mirror surface the gate is derived from. */
export interface StepDepthLookup {
  depthOf(step: number): StepDepth;
}

/**
 * Is the coherence gate after step 3 passed? (capability `agent-harness`, Requirement:
 * *The Maturity Demands Are Staged Across the Session*.)
 *
 * "Settled" is deliberately NOT a second notion of coverage: it is the existing step
 * depth, read off the existing step mirror, and it means *off `open`* — the step has a
 * recorded output, which the depth guards already make impossible to claim for a step
 * whose canonical slots are empty (`step-tool.ts`). Requiring `refined` or `detailed`
 * instead would invent a threshold the ladder does not carry and would stage the
 * reading behind a rung the flow's first round (`rough`) never reaches.
 *
 * Without a step mirror the gate is NOT passed: an unknown design state is the
 * pre-gate state, so the quiet option is the default.
 */
export function coherenceGatePassed(steps: StepDepthLookup | undefined): boolean {
  if (!steps) return false;
  return COHERENCE_GATE_STEPS.every((step) => steps.depthOf(step) !== "open");
}

export function outstandingSurfaceNotice(
  maturity: MaturityFeedState | undefined,
  affordance: boolean,
  gatePassed: boolean
): string | null {
  if (!maturity || !affordance) return null;
  // Before the gate the unread panel is the truth, not a debt.
  if (!gatePassed) return null;
  // The demand keys on the absence of an ACHIEVED READING, not on an empty mirror:
  // a recorded target ambition makes the mirror non-empty while leaving the raster
  // unread, and that is the ordinary state of every session that answered the
  // descriptor's target demand in its opening.
  const noReading = maturity.hasAchievedReading ? !maturity.hasAchievedReading() : maturity.isEmpty();
  if (noReading) {
    return (
      "[outstanding] Steps 1 to 3 are settled and no achieved maturity reading has been recorded yet " +
      "(a recorded target ambition is not a reading). " +
      "Establish the reading now with ONE batched cbe_maturity readings call (all seven criteria plus the overall record). " +
      "Describing a reading in your answer does not fill the panel."
    );
  }
  return null;
}

/**
 * The start half of the step ritual (capability `agent-harness`, Requirement:
 * *Deterministic Tool-Boundary Enforcement…*, Scenario: *An accepted step or canvas
 * result reports the addressed step's outstanding slots*).
 *
 * Appended to every ACCEPTED `cbe_canvas` / `cbe_step` result: what the addressed step
 * still owes, derived from host state. This is the channel that costs no eager-body
 * characters and needs no reference file to be opened — the decisive failure of the
 * 2026-08-03 session was that `references/modes/design-flow.md`, which holds exactly
 * this information, was never read.
 *
 * Returns null when the step owes nothing (or seeds nothing), so a completed step's
 * results stay quiet.
 */
export function outstandingSlotEcho(step: number, canvas: CanvasFillLookup): string | null {
  // Aggregated over ALL of the step's containers — step 6's slots sit under its four
  // journey elements, so the flat container key this used to build made the echo silent
  // for exactly the step with the most structure. Step-6 ids carry their element.
  const slots = stepCanonicalSlots(step);
  if (slots.length === 0) return null;
  const empty = stepEmptySlots(step, canvas);
  if (empty.length === 0) return null;
  return `[step ${step}] still open: ${empty.join(", ")} (of ${slots.join(", ")}).`;
}
