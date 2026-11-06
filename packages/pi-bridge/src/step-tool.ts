/**
 * `cbe_step` — a fire-and-forget generative-UI tool the skill calls to mirror the
 * design-flow STEP COVERAGE state onto the Artifacts/Canvas step-group headers. See
 * capability `agent-harness`, Requirement *cbe_step Generative-UI Tool*, and capability
 * `desktop-app`, Requirement *Design-Flow Canvas*.
 *
 * Its step numbers align 1:1 with the canvas step groups. Unlike the picker
 * this tool is NOT deferred: the skill pushes ONE step-state transition and continues —
 * there is no next-user-turn roundtrip (the lecturer's step SELECTION travels the other
 * way, through the HOST channel: the renderer calls `window.cbe.focusStep`,
 * `StepMirror.recordUiFocus` moves the exclusive focus at once, and the model learns of
 * it on the NEXT lecturer turn as a machine-readable prefix notice — nothing is
 * dispatched into the chat). `execute` returns a small
 * synchronous acknowledgement with `details.kind: "step-update"`; the renderer reacts to
 * the tool CALL (its validated result details) and applies it to the `steps` store slice.
 *
 * **The depth ladder is the method's three rounds, not a host convention.**
 * `open → rough → refined → detailed` IS §4.6's iterative use
 * (`corpus/content/methodology/methodology-012-ten-step-module-design-flow.md`,
 * § *Iterative use — three rounds*): "a first pass sets rough shapes for all ten, a
 * second pass refines them once their interactions are visible, and a third pass fills
 * in detail", and "later steps routinely send the team back to revise earlier ones".
 * The tool prose has to SAY that, because a bare ladder of four ascending values plus a
 * one-rung-per-call rule reads as "finish step N before touching step N+1, and never go
 * back" — the opposite of the method. So the `depth` description names the rounds and
 * the broad first pass, and both `depth` and `focus` state that going back is expected
 * work rather than an error being undone. Nothing here is a new guard: the host has
 * always accepted a downward move and never refused a focus change.
 *
 * Payload: `{ step: 1..10, depth?: "open"|"rough"|"refined"|"detailed", focus?: boolean,
 * note?: string }`, with at least one of `depth`/`focus` present. `focus: true` implies
 * every other step loses focus (exclusivity is enforced renderer-side). `note` is
 * transport-and-validation only in this change — the renderer does NOT render it.
 *
 * **Depth is a coverage claim; focus is navigation** (capability `agent-harness`,
 * Requirement: *Deterministic Tool-Boundary Enforcement…*, change `fix-ux3-wave2-orientation`).
 * The two halves of a payload do NOT share a fate:
 *
 *   - a `depth` asserts that a step's named output exists — it can be fabricated, and every
 *     guard below exists to stop that;
 *   - a `focus` says only where the work is — it cannot be fabricated, nothing downstream
 *     reads it as design substance, and the lecturer's orientation depends on it being right.
 *
 * So focus is DERIVED when the model omits it (pushing coverage for a step IS working on
 * that step — the same inference `cbe_canvas` already makes), and it SURVIVES a depth
 * refusal. Both defects were live: across the 2026-08-03 and 2026-08-04 sessions 17 of 25
 * `cbe_step` calls carried no `focus` at all, and where the depth was refused the focus
 * intent died with it, leaving the in-focus pill on the step the lecturer had left.
 *
 * The derivation is only as good as the arrival claim it rests on: a DERIVED focus travels
 * through a refusal only when the requested depth was ladder-legal (at most one rung above
 * the recorded depth). A multi-rung request is a coverage claim the host has already judged
 * implausible, and no navigation may be derived from an implausible claim — the same
 * 2026-08-03 session ends with a six-call bookkeeping sweep (`{1|2|3|5|6, "detailed"}` from
 * `rough`, then `{10, "detailed"}` from `open`) that would otherwise have dragged the pill
 * off step 9 and onto step 10, a step never worked on. An EXPLICIT `focus: true` is not a
 * derivation and still travels through any refusal.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { depthRung, nextDepthAbove, type StepDepth, type StepMirror } from "./step-mirror.js";
import { stepCanonicalSlots, stepEmptySlots, type CanvasFillLookup } from "./canvas-addressing.js";
import {
  outstandingSlotEcho,
  outstandingSurfaceNotice,
  pendingAnswerRefusalText,
  type MaturityFeedState,
  type PendingAnswerGate,
} from "./pending-answer-gate.js";

// The depth ladder is owned by `step-mirror.ts` (single definition, two consumers).
export type { StepDepth };

const StepParamsSchema = Type.Object({
  step: Type.Integer({
    minimum: 1,
    maximum: 10,
    description: "Which design-flow step (1..10) this transition concerns. Aligns 1:1 with the canvas step groups.",
  }),
  depth: Type.Optional(
    Type.Union([Type.Literal("open"), Type.Literal("rough"), Type.Literal("refined"), Type.Literal("detailed")], {
      description:
        "Coverage depth of the step's named output: open (untouched) → rough → refined → detailed — PIONEER's three design rounds: a first pass sets rough shapes across ALL ten steps before any deepens. Advance only when the named output exists in a correspondingly grounded form, and only one rung per call — a bookkeeping sweep that jumps several rungs is refused. MAY move down freely when the lecturer discards or reopens the output: the flow is iterative, so revisiting an earlier step is expected work, not a correction of an error — a regression removes coverage rather than asserting it and is never refused.",
    })
  ),
  focus: Type.Optional(
    Type.Boolean({
      description:
        "Set true to mark THIS step as the one currently in focus; every other step loses focus (at most one in focus). Omit it on a depth-carrying call and the host derives it onto this step. Never refused, and a return to an earlier step is normal.",
    })
  ),
  note: Type.Optional(
    Type.String({
      description: "Optional short note on the transition. Transport/validation only — not rendered.",
    })
  ),
});

export type StepToolParams = Static<typeof StepParamsSchema>;

/** Tool-result details: a step-update carries the validated transition params (its
 * `focus` may be the host-DERIVED one, so the renderer applies exactly what the host
 * recorded). A refusal carries the kind, plus — when the refusal concerned only the
 * DEPTH and the call's navigation half was applied anyway — the step that took focus. A
 * structurally-invalid payload carries the bare kind and nothing else. */
export interface StepToolDetails {
  kind: "step-refusal" | "step-update";
  step?: number;
  depth?: StepDepth;
  focus?: boolean;
  note?: string;
  /** Step whose focus a DEPTH refusal still applied (refusals only; named like the
   * `cbe_canvas` derived-focus field so the renderer handles one idiom, not two). */
  focusStep?: number;
}

// Exported for the schema-contract unit tests.
export { StepParamsSchema };

const STEP_DEPTHS: readonly StepDepth[] = ["open", "rough", "refined", "detailed"];

/**
 * Build the `cbe_step` tool. With a `StepMirror` bound the host GUARDS the depth
 * ladder instead of accepting whatever the model asserts (capability `agent-harness`,
 * Requirement: *Deterministic Tool-Boundary Enforcement for Canvas Ids, Step Coverage
 * and Unfed Surfaces*): an upward move advances at most one rung, and the refusal
 * names the next legal value so the model can correct itself — the same teaching shape
 * as the existing unresolvable-address refusal. Downward moves stay unrestricted,
 * because a regression is an explicitly allowed, lecturer-driven move.
 *
 * Without a mirror (headless / schema unit tests) the tool behaves exactly as before.
 */
export function createStepTool(
  mirror?: StepMirror,
  gate?: PendingAnswerGate,
  surfaces?: { maturity?: MaturityFeedState; maturityAffordance?: boolean; coherenceGate?: boolean },
  /** Canvas fill state — the host's evidence for whether a step's named output exists.
   * Structurally satisfied by `CanvasMirror`. Without it the slot-based guards are
   * skipped (headless / schema tests behave exactly as before). */
  canvas?: CanvasFillLookup
) {
  return defineTool({
    name: "cbe_step",
    label: "Step",
    description:
      "Mirror one design-flow step-coverage transition onto the Design-Flow Canvas step-group headers. Call it on TRANSITIONS ONLY — when a step's coverage depth actually changed or the work moved to another step — never every turn. A DEPTH IS A CLAIM that the step's named output exists, checked against what the canvas holds: the host may REFUSE a depth (nothing above `open` with no filled canonical slot, no `detailed` close while one is still empty, and at most one rung up per call). FOCUS IS NAVIGATION and is never refused: it says only where the work is, so a depth-carrying call that omits it moves focus to that step, and an explicit `focus` wins over that derivation. A REFUSAL IS AN INSTRUCTION, NOT AN ERROR MESSAGE — fire-and-forget means there is no lecturer answer to wait for, not that you ignore the result. The refusal names the value that would be accepted: put the missing output on the canvas or re-issue at the named depth, in the SAME turn, never the refused depth unchanged. Only call this when the environment descriptor reports the `step` affordance.",
    promptSnippet:
      "Use cbe_step(step, depth?, focus?) to mirror a design-flow step-coverage transition (depth advance/regression, focus change) onto the canvas step headers. Transitions only, grounded states only, fire-and-forget. Only when the `step` affordance is present.",
    // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app — pi's
    // `buildSystemPrompt` returns early on its `customPrompt` branch, which
    // `startCbeSession` always takes. Kept accurate for hosts on pi's default
    // prompt; every binding rule lives in `description` / parameter descriptions.
    promptGuidelines: [
      "step is 1..10 and aligns 1:1 with the canvas step groups; at least one of depth/focus must be present.",
      "Emit ONLY on a step-state transition (depth change or focus shift) — never every turn.",
      "Advance depth (rough→refined→detailed) only when the step's named output exists in a correspondingly grounded form; depth MAY move DOWN when an output is discarded/reopened.",
      "focus: true marks this step as the one in focus; all other steps lose focus (at most one at a time).",
      "Only push states grounded in what actually happened in the conversation — no fabricated coverage.",
      "Do not call cbe_step when the environment descriptor does not report the `step` affordance.",
    ],
    parameters: StepParamsSchema,
    async execute(_toolCallId, params: StepToolParams) {
      // Defence in depth: Pi validates against the schema first, but a degenerate payload
      // MUST be a safe no-op, never a crash. Require a valid step and at least one of
      // depth/focus; a present depth must be on the scale; focus must be boolean.
      const stepOk =
        typeof params?.step === "number" && Number.isInteger(params.step) && params.step >= 1 && params.step <= 10;
      const depthPresent = params?.depth !== undefined;
      const focusPresent = params?.focus !== undefined;
      const depthOk = !depthPresent || (STEP_DEPTHS as readonly unknown[]).includes(params.depth);
      const focusOk = !focusPresent || typeof params.focus === "boolean";
      const hasTransition = depthPresent || focusPresent;

      if (!stepOk || !hasTransition || !depthOk || !focusOk) {
        // A payload the host cannot trust buys NO navigation either — this branch is
        // the one refusal that stays a total no-op.
        return {
          content: [
            {
              type: "text" as const,
              text: "cbe_step: invalid payload (need step ∈ 1..10 and at least one of depth ∈ open|rough|refined|detailed or focus:boolean). No step update applied.",
            },
          ],
          details: { kind: "step-refusal" } satisfies StepToolDetails as StepToolDetails,
        };
      }

      // The call's NAVIGATION half, decided once, before any depth guard runs. An
      // explicit `focus` wins (including `false`); a depth-carrying call that says
      // nothing about focus derives it onto the addressed step.
      const focusIntent: boolean | undefined = focusPresent
        ? (params.focus as boolean)
        : depthPresent
          ? true
          : undefined;

      /** How far above the step's RECORDED depth the requested one sits, regardless of
       * which guard refused it (the empty-slot guard runs before the ladder guard, so
       * keying the plausibility test on the firing guard would miss the `open` →
       * `detailed` jump entirely). Non-positive for a regression. */
      const requestedRungDistance = (): number => {
        if (!depthPresent) return 0;
        const current = mirror?.depthOf(params.step) ?? "open";
        return depthRung(params.depth as StepDepth) - depthRung(current);
      };

      /** Refuse the DEPTH while letting the navigation half through. Only a
       * `focus: true` travels: an explicit `focus: false` asserts no move to preserve,
       * and dropping it keeps host and renderer state identical (the renderer has no
       * way to express "clear the focus of step N" from a refusal). A DERIVED focus
       * additionally needs a plausible arrival claim — a request of two or more rungs
       * is bookkeeping about steps the model is not working on, and its navigation
       * half is dropped with the depth. An explicit `focus: true` is unaffected. */
      const refuseDepth = (text: string) => {
        const takesFocus = focusIntent === true && (focusPresent || requestedRungDistance() <= 1);
        if (takesFocus) mirror?.applyUpdate(params.step, { focus: true });
        return {
          content: [
            {
              type: "text" as const,
              text: takesFocus ? `${text} Step ${params.step} is now the step in focus.` : text,
            },
          ],
          details: {
            kind: "step-refusal",
            ...(takesFocus ? { focusStep: params.step } : {}),
          } satisfies StepToolDetails as StepToolDetails,
        };
      };

      // Pending-answer gate: only a depth ADVANCE is refused. A focus change is
      // navigation, not a claim about the lecturer's answer, and a regression removes
      // coverage rather than asserting it — neither can fabricate a decision.
      if (gate?.hasOutstanding() && depthPresent && mirror) {
        const requested = params.depth as StepDepth;
        if (depthRung(requested) > depthRung(mirror.depthOf(params.step))) {
          return refuseDepth(pendingAnswerRefusalText("cbe_step", gate.outstandingQuestion()));
        }
      }

      // Slot-based depth guards (host state, no judgement about quality). The canvas
      // fill state IS the evidence that a step's named output exists:
      //
      //   B1.3 — a depth above `open` needs at least ONE filled canonical slot. This
      //          catches fabricated coverage: on 2026-08-03 step 10 was pushed straight
      //          to `detailed` before its checklist artefact existed at all.
      //   B1.4 — the CLOSE (`detailed`) needs EVERY canonical slot filled. That is the
      //          handover half of the ritual: a step is not finished while its named
      //          output is still missing.
      //
      // A step whose containers seed nothing (nothing canonical to check) is exempt —
      // the guards must never block a step they cannot reason about.
      //
      // The slots are read per STEP, aggregated over ALL of its containers: step 6 keeps
      // its canonical ids one level deeper, under its four journey elements, so the flat
      // container key `"6"` this used to build finds nothing in the table and skipped the
      // whole guard — `cbe_step({ step: 6, depth: "detailed" })` was accepted on an empty
      // canvas. A step-6 slot is named with its journey element, since step 6 cannot be
      // written without a `phase`.
      if (canvas && depthPresent && params.depth !== "open") {
        const slots = stepCanonicalSlots(params.step);
        if (slots.length > 0) {
          const empty = stepEmptySlots(params.step, canvas);
          const filled = slots.length - empty.length;
          if (filled === 0) {
            return refuseDepth(
              `cbe_step: refused — step ${params.step} has no recorded output yet, so its coverage cannot ` +
                `be "${params.depth}". Put the step's named output on the canvas first: ${slots.join(", ")}. ` +
                `No depth update applied.`
            );
          }
          if (params.depth === "detailed" && empty.length > 0) {
            return refuseDepth(
              `cbe_step: refused — step ${params.step} cannot be closed as "detailed" while its named ` +
                `output is incomplete. Still empty: ${empty.join(", ")}. No depth update applied.`
            );
          }
        }
      }

      // Depth-ladder guard (host state, no judgement): an upward move advances at most
      // ONE rung. This is what refuses the 2026-08-03 inflation burst, where five steps
      // jumped `rough` → `detailed` in a single turn and step 10 went `open` →
      // `detailed`. Downward moves are unrestricted — regression is a legitimate,
      // lecturer-driven move. The refusal NAMES the next legal value so the model can
      // correct itself, the same teaching shape as the unresolvable-address refusal.
      if (mirror && depthPresent) {
        const current = mirror.depthOf(params.step);
        const requested = params.depth as StepDepth;
        if (depthRung(requested) > depthRung(current) + 1) {
          const next = nextDepthAbove(current);
          return refuseDepth(
            `cbe_step: refused — step ${params.step} is at depth "${current}"; ` +
              `depth advances one rung at a time, so the next legal value is "${next}", not "${requested}". ` +
              `No depth update applied.`
          );
        }
      }

      mirror?.applyUpdate(params.step, {
        ...(depthPresent ? { depth: params.depth as StepDepth } : {}),
        ...(focusIntent !== undefined ? { focus: focusIntent } : {}),
      });

      // Read AFTER the depth was applied above, like the slot echo: the call that
      // settles step 3 passes the coherence gate, and the reading is due from that
      // same receipt onwards. Before the gate no maturity demand rides this channel at
      // all — the target demand moved to the environment descriptor.
      const notice = outstandingSurfaceNotice(
        surfaces?.maturity,
        surfaces?.maturityAffordance === true,
        surfaces?.coherenceGate === true
      );
      const slotEcho = canvas ? outstandingSlotEcho(params.step, canvas) : null;
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Step ${params.step} updated` +
              (depthPresent ? `: depth ${params.depth}` : "") +
              (focusIntent !== undefined ? `${depthPresent ? "," : ":"} focus ${focusIntent}` : "") +
              "." +
              (slotEcho ? `\n${slotEcho}` : "") +
              (notice ? `\n${notice}` : ""),
          },
        ],
        details: {
          kind: "step-update",
          step: params.step,
          ...(depthPresent ? { depth: params.depth as StepDepth } : {}),
          ...(focusIntent !== undefined ? { focus: focusIntent } : {}),
          ...(typeof params.note === "string" ? { note: params.note } : {}),
        } satisfies StepToolDetails as StepToolDetails,
      };
    },
  });
}

/** Default instance without a mirror — schema-contract unit tests and any caller that
 * does not need host-side ladder guarding. */
export const stepTool = createStepTool();
