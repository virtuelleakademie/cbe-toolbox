/**
 * The alignment re-check, surfaced from canvas state (capability `agent-harness`,
 * Requirement: *The Alignment Re-Check Is Surfaced From Canvas State*).
 *
 * The alignment check runs unprompted whenever a goal, activity or assessment changes
 * (capability `cbe-skill`, Requirement: *Alignment Check — Active Constructive-Alignment
 * Audit of Goals × Activities × Assessment*). All three corners of that triad are canvas
 * artefacts the host mirrors, so the host KNOWS when the trigger fires — and knows it
 * before the model composes the answer the check belongs in, because a tool result feeds
 * back into the same run.
 *
 * ## Why this exists at all
 *
 * The check has two directions — a goal no assessment evidences, and an assessment no goal
 * asks for — and the measurement says the model reaches the first and not the second. The
 * cause is not a missing rule: `methodology-003` carries the six-pattern catalogue (orphan
 * assessment among them, which IS the reverse direction) and the skill is obliged to read
 * it before using the method. What the run shows is that the read does not happen on the
 * turn the check runs: `12d` scored 0/3 on probe S12, `methodology-003` was opened in one
 * repeat of three, and no corpus token appears in any S12 transcript. The catalogue was
 * never in the session, so the check ran on what "per goal: where practised, where shown"
 * alone yields.
 *
 * The repair is NOT an enumeration in the skill body: the canonical requirement forbids one
 * ("a partial copy silently narrows the check, which is how it came to test two of the
 * six") and `govern-the-flow-by-canvas-state-and-profile` task 2.2 removed exactly that
 * inlined pair on purpose. The repair is to make the read happen, on the channel the host
 * already has: `outstandingSlotEcho` / `outstandingSurfaceNotice` (`pending-answer-gate.ts`)
 * are host-derived lines appended to accepted mirroring results, and cost no eager-body
 * characters and no reference file.
 *
 * ## Two variants deliberately NOT taken
 *
 * 1. **Inlining the document body into the result.** The host could read `methodology-003`
 *    (2.9 KB) at call time and paste the catalogue. Rejected because only a `read` grounds a
 *    citation (product decision 2026-08-06) — a model citing host-pasted material would emit
 *    a token with no read behind it, which the identity prompt calls a fabrication — and
 *    because a per-write channel is no place for a bulk load when two-stage retrieval exists
 *    precisely to keep context from growing with the corpus.
 * 2. **A tool that performs the check and requires the catalogue as an input.** There is no
 *    such tool, the check is conversational by design, and `TOOL_PROSE_BUDGET` had twelve
 *    characters of room on 2026-08-17 — a seventh tool arrives bundled with a re-cut of the
 *    other six.
 *
 * So the notice names the document and stops. It enumerates no pattern and paraphrases none:
 * the prohibition that binds the skill body binds the host for the same reason.
 */
import {
  canonicalSlots,
  emptySeededSlots,
  type CanvasFillLookup,
  type ResolvedCanvasAddress,
} from "./canvas-addressing.js";

/**
 * The triad's three corners, as STEP GROUPS. The artefact id per corner is NOT restated
 * here — it is read from `CANONICAL_SLOTS` through `canonicalSlots()`, so the host's triad
 * and the canvas's canonical slots cannot drift (`alignment-recheck.test.ts` asserts each
 * corner step seeds exactly one canonical artefact).
 *
 * Steps 6 and 8 are deliberately NOT corners: `methodology-003`'s triad is Goals ×
 * Activities × Assessment, and the learner-time journey (6) and the deliverables map (8)
 * elaborate the activity plan rather than being a fourth corner. Treating them as corners
 * would fire the notice across most of the flow.
 */
export const ALIGNMENT_TRIAD_CORNER_STEPS = {
  goals: 2,
  assessment: 3,
  activities: 7,
} as const;

/** A corner's step group, in the canonical order goals → assessment → activities. */
export const ALIGNMENT_TRIAD_STEPS: readonly number[] = [
  ALIGNMENT_TRIAD_CORNER_STEPS.goals,
  ALIGNMENT_TRIAD_CORNER_STEPS.assessment,
  ALIGNMENT_TRIAD_CORNER_STEPS.activities,
];

/** The canonical artefact id of a corner step, or null where that step seeds anything
 * other than exactly one slot (which would mean the slot table moved under us). */
export function alignmentCornerArtefact(step: number): string | null {
  if (!ALIGNMENT_TRIAD_STEPS.includes(step)) return null;
  const slots = canonicalSlots({ step });
  return slots.length === 1 ? (slots[0] as string) : null;
}

/**
 * Is this write a change to a triad corner? A corner is the CANONICAL artefact of its step
 * group — an extra minted artefact in step 3 is not the assessment blueprint. The
 * canonical-id guard in `canvas-tool.ts` already refuses a minted id while a seeded slot is
 * empty, so this narrowing only ever excludes a genuinely additional card.
 *
 * A phase-carrying address is never a corner: none of the three corners lives under a
 * step-6 journey element.
 */
export function isAlignmentCornerWrite(addr: ResolvedCanvasAddress, id: string): boolean {
  if (addr.phase) return false;
  return alignmentCornerArtefact(addr.step) === id;
}

/** Does the corner's canonical artefact carry content in the mirror? Answered through
 * `emptySeededSlots`, the same fill authority the slot echo reads, so "filled" is
 * decided in ONE place — a second emptiness test here would let the echo and this
 * notice silently disagree about whether a corner is on record. */
function cornerOnRecord(step: number, canvas: CanvasFillLookup): boolean {
  const id = alignmentCornerArtefact(step);
  return !!id && !emptySeededSlots({ step }, canvas).includes(id);
}

/**
 * Does the recorded design give the check something to work against? The goals corner on
 * record AND at least one other corner on record.
 *
 * Both halves come from existing decisions rather than from taste. The check has an
 * upstream: "Where alignment is requested before the outcomes it would align to are sharp,
 * the skill MUST name the missing upstream check and take that first" — so a notice
 * demanding the audit over a design with no stated outcomes would contradict the rule it is
 * meant to support. And a demand nobody can satisfy is this channel's known failure mode:
 * the maturity TARGET demand fired on every accepted write of the sessions that had already
 * answered it and never reached the cold session that had not, and the repair was to stage
 * it behind a state the host can actually read (Requirement: *The Maturity Demands Are
 * Staged Across the Session*).
 */
export function alignmentRecheckDue(canvas: CanvasFillLookup): boolean {
  if (!cornerOnRecord(ALIGNMENT_TRIAD_CORNER_STEPS.goals, canvas)) return false;
  return (
    cornerOnRecord(ALIGNMENT_TRIAD_CORNER_STEPS.assessment, canvas) ||
    cornerOnRecord(ALIGNMENT_TRIAD_CORNER_STEPS.activities, canvas)
  );
}

/** The corpus document that defines the catalogue. Named, never inlined. */
export const ALIGNMENT_CATALOGUE_DOCUMENT = "methodology-003";

/**
 * The notice, or null when this write did not CHANGE a corner, or the check has nothing to
 * work against yet.
 *
 * `cornerChanged` is the mirror's own answer to "would this write change the stored entry",
 * obtained from `CanvasMirror.wouldChange` BEFORE the write — after it the stored entry is
 * already the new one and the comparison is meaningless. It matters because the canonical
 * trigger is a corner that CHANGES: a model re-pushing an unchanged card as bookkeeping (a
 * re-mirror, a set replaying the injected canvas prior) would otherwise collect a demand per
 * card in a single mirroring sweep — the demand-on-every-accepted-write shape this channel
 * already learned from with the maturity target demand.
 *
 * Call it AFTER the mirror write for the on-record predicate, exactly like
 * `outstandingSlotEcho`: the write that puts the second corner on record is itself the moment
 * the check becomes possible, and it carries the notice.
 *
 * The text names four things and nothing else — the corner that moved, that the re-check is
 * due in THIS response, that the audit covers the whole triad on record rather than only the
 * corner that moved, and the catalogue document with the read due in this session. It names
 * no pattern from the catalogue and paraphrases none; see the module comment.
 *
 * The one hedge is deliberate. The canonical rule reads "Where alignment is requested before
 * the outcomes it would align to are sharp, the skill MUST name the missing upstream check
 * and take that first" — and SHARPNESS is not computable from canvas state, only presence is.
 * The host must not overrule a canonical rule it cannot itself compute, so the demand is
 * stated with that condition on it rather than as an unconditional order. The wording costs
 * nothing: this channel is outside the three budgeted instruction channels.
 */
export function alignmentRecheckNotice(
  addr: ResolvedCanvasAddress,
  id: string,
  canvas: CanvasFillLookup | undefined,
  cornerChanged: boolean
): string | null {
  if (!canvas) return null;
  if (!cornerChanged) return null;
  if (!isAlignmentCornerWrite(addr, id)) return null;
  if (!alignmentRecheckDue(canvas)) return null;
  return (
    `[alignment] Step ${addr.step} (${id}) just changed, and the stated outcomes are on record to hold it ` +
    `against — the alignment re-check is due in THIS response, over the whole triad on record ` +
    `(steps ${ALIGNMENT_TRIAD_STEPS.join(", ")}) and not only the corner that moved, unless those outcomes ` +
    `are not yet sharp enough to align to — then that sharpening comes first. Its pattern catalogue ` +
    `is \`${ALIGNMENT_CATALOGUE_DOCUMENT}\`: read that document in this session before you name a finding.`
  );
}
