/**
 * `cbe_decision_checklist` — DE-REGISTERED (product decision, 2026-08-06;
 * capability `agent-harness`, Requirement: *Tool Descriptions Carry Their
 * Operating Rules*).
 *
 * It is absent from `CBE_TOOL_ALLOWLIST` and from the `customTools` array, so its
 * schema no longer travels on any request. Reason: it carried no trigger rule in
 * any instruction channel and appeared in no eval scenario — it cost schema on
 * every request for undefined behaviour, which the channel boundary does not
 * permit ("a tool without a trigger rule is de-registered, not left registered and
 * unruled").
 *
 * THIS MODULE AND THE RENDERER COMPONENT STAY IN THE TREE ON PURPOSE. A progress
 * surface for the ten-step flow may still want them, and deleting them would pull
 * `desktop-app` into that change. The `desktop-app` requirement describing the
 * Decision Checklist surface therefore keeps standing while nothing can call it —
 * a KNOWN, DELIBERATE divergence recorded in the change's `design.md` § Decided,
 * so a later agent does not "repair" it by re-registering the tool.
 *
 * Everything below describes how the tool behaved while registered and is kept
 * accurate for a future re-registration.
 *
 * A generative-UI tool the skill called to surface a set of items it was tracking,
 * either as a vertical Checklist (discrete decisions / heterogeneous tasks) or a
 * horizontal Progress Bar (sequential phases / homogeneous progress). See
 * `specs/desktop-app/spec.md`, Requirement *Generative UI — Decision Checklist
 * (dual presentation)*.
 *
 * Same deferred-answer architecture as `cbe_picker` (see picker-tool.ts): the
 * tool's `execute` returns a placeholder immediately; the lecturer's marked
 * state flows back as the NEXT user turn, not as the tool's result. The renderer
 * picks the spec up from the `tool_execution_start` event and swaps the standard
 * tool card for the DecisionChecklist React component. And for the same reason
 * the call ENDS THE RUN (`terminate: true`; capability `agent-harness`,
 * Requirement *The Agent Run Ends on a Deferred-Answer Tool Call*) — the
 * placeholder carries nothing the model could act on, so re-invoking it only buys
 * filler. Rationale, batch semantics and why not `session.abort()`: picker-tool.ts.
 *
 * Presentation is chosen by the SKILL at emission time (`presentation` field),
 * NOT toggled by the lecturer at view time — so the surface stays coherent (the
 * lecturer sees a Progress Bar only when the underlying work IS sequential).
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PendingAnswerGate } from "./pending-answer-gate.js";

const ChecklistItemSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    description: "Stable identifier echoed back in the lecturer's update. Short kebab-case.",
  }),
  label: Type.String({
    minLength: 1,
    description: "Visible item text. Plain text — keep it under ~80 chars.",
  }),
  description: Type.Optional(
    Type.String({
      description: "Optional detail shown on hover / as a tooltip. Keep it to one sentence.",
    })
  ),
  done: Type.Optional(
    Type.Boolean({
      description: "Initial completion state. Default false. The lecturer can toggle it.",
    })
  ),
});

const DecisionChecklistParamsSchema = Type.Object({
  title: Type.Optional(
    Type.String({
      description: "Optional heading shown above the items. Markdown supported; keep it short.",
    })
  ),
  presentation: Type.Union([Type.Literal("checklist"), Type.Literal("progress-bar")], {
    description:
      "How to render the items. 'checklist' for discrete decisions / heterogeneous tasks; 'progress-bar' for sequential phases / homogeneous progress. Choose based on whether the underlying work is sequential.",
  }),
  items: Type.Array(ChecklistItemSchema, {
    minItems: 2,
    maxItems: 12,
    description: "The items being tracked, in display order.",
  }),
});

export type DecisionChecklistToolParams = Static<typeof DecisionChecklistParamsSchema>;

// Exported for the schema-contract unit tests (minLength on rendered strings,
// minItems on items, presentation is a closed union).
export { DecisionChecklistParamsSchema };

/** Build the checklist tool. Same deferred-answer gate as `cbe_picker`. */
export function createDecisionChecklistTool(gate?: PendingAnswerGate) {
  return defineTool({
    name: "cbe_decision_checklist",
    label: "Decision Checklist",
    description:
      "Surface a set of items you are tracking as an interactive Checklist or Progress Bar. Use 'checklist' for discrete decisions / heterogeneous tasks and 'progress-bar' for sequential phases. The lecturer marks items done; their updated state arrives as the NEXT user turn. Choose the presentation deliberately — lecturers should only see a Progress Bar when the work is genuinely sequential. THE CHECKLIST IS THE ASK: never announce it, never list the items again in prose, and never describe what you will do once it comes back. Say whatever substance it rests on BEFORE the call; the call itself ends your turn and no text follows it.",
    promptSnippet:
      "Use cbe_decision_checklist(presentation, items[], title?) to show tracked items as a Checklist or Progress Bar; the lecturer's marks arrive as the next user turn.",
    // See picker-tool.ts: this channel is dropped whenever the host supplies its
    // own system prompt, which the CBE Toolbox always does. Binding rules go in
    // `description` or `skills/cbe/SKILL.md`.
    promptGuidelines: [
      "presentation: 'checklist' for discrete/heterogeneous decisions; 'progress-bar' for sequential/homogeneous phases.",
      "The checklist IS the ask: do not announce it, repeat its items in prose, or say what happens after. The call ends your turn.",
      "Set each item's `done` to reflect what you already know is complete; the lecturer corrects from there.",
      "The lecturer's updated state arrives as the next user message listing done vs open items; continue from there.",
      "Do not use this for a single yes/no — that is a cbe_picker. Use it when there are several items to track at once.",
    ],
    parameters: DecisionChecklistParamsSchema,
    async execute(_toolCallId, params) {
      gate?.registerEmission("cbe_decision_checklist", params.title ?? "tracked items");
      return {
        content: [
          {
            type: "text",
            text:
              `Decision checklist (${params.presentation}) rendered to the lecturer. Your turn ended here; their update ` +
              "arrives as the next user message listing which items are done and which remain open. Do not pre-empt it.",
          },
        ],
        details: { kind: "cbe_decision_checklist", spec: params },
        // Ends the agent run — see the file header.
        terminate: true,
      };
    },
  });
}

/** Default instance without a gate (schema-contract unit tests, headless). */
export const decisionChecklistTool = createDecisionChecklistTool();
