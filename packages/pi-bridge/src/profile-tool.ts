/**
 * `cbe_profile` — a fire-and-forget generative-UI tool the skill calls to record
 * lecturer-state estimate updates as structured data. See capability
 * `agent-harness`, Requirement *cbe_profile Generative-UI Tool*, and capability
 * `cbe-skill`, Requirement *Tool-Mediated Profile Estimate Recording*.
 *
 * Like `cbe_canvas` this tool is NOT deferred: the skill pushes ONE dimension
 * update and continues — the lecturer does not answer a profile update.
 * `execute` returns a small synchronous acknowledgement; the host reacts to the
 * tool CALL (its args, surfaced via the `tool_execution` event): the renderer
 * updates the Profile Panel, the main process persists the record to the
 * per-lecturer store. Emission is independent of the `profilePanel` affordance —
 * the record persists in headless hosts too; only the panel POINTER in the
 * skill's prose is affordance-gated.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  CONFIDENCE_LEVELS,
  DIMENSION_SCALES,
  PROFILE_DIMENSIONS,
  isProfileDimension,
  isValidDimensionValue,
} from "./lecturer-profile.js";

const ProfileParamsSchema = Type.Object({
  dimension: Type.Union(
    [
      Type.Literal("pbl-prior-knowledge"),
      Type.Literal("cbe-prior-knowledge"),
      Type.Literal("didactic-stance"),
      Type.Literal("attitude"),
      Type.Literal("capacity"),
    ],
    { description: "Which lecturer-state dimension this update concerns." }
  ),
  value: Type.String({
    minLength: 1,
    description:
      "The dimension's new value, on its scale: " +
      PROFILE_DIMENSIONS.map((d) => `${d}: ${DIMENSION_SCALES[d].join("|")}`).join("; "),
  }),
  confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], {
    description: "How reliable this estimate is. Be honest; a single signal is low|medium.",
  }),
  evidence: Type.String({
    minLength: 1,
    description:
      'Short pointer to the concrete observation grounding the value (e.g. "turn 3: described a complete PBL sequence they ran"). Never invented.',
  }),
  lecturerConfirmed: Type.Optional(
    Type.Boolean({
      description:
        "Set true ONLY when the lecturer explicitly confirmed this dimension's change in the conversation after you asked (ask-before-revising on a panel-overridden dimension). Setting it without that confirmation is as forbidden as invented evidence.",
    })
  ),
});

export type ProfileToolParams = Static<typeof ProfileParamsSchema>;

/** Tool-result details: a refusal carries only the kind; an update carries the full record. */
export interface ProfileToolDetails {
  kind: "profile-refusal" | "profile-update";
  dimension?: ProfileToolParams["dimension"];
  value?: string;
  confidence?: ProfileToolParams["confidence"];
  evidence?: string;
  lecturerConfirmed?: boolean;
}

// Exported for the schema-contract unit tests.
export { ProfileParamsSchema };

export const profileTool = defineTool({
  name: "cbe_profile",
  label: "Profile",
  description:
    "Record a lecturer-state estimate as structured data. Call cbe_profile(dimension, value, confidence, evidence) whenever you FORM or REVISE a dimension estimate from a substantive signal — one call per revised dimension, keyed by the canonical dimension key and re-using that same key on every revision so an update edits the existing entry in place. NO SIGNAL, NO CALL: never emit an estimate you have not observed, and never fabricate confidence or evidence. A REVISION IS RECORDED, NOT MERELY NARRATED — if your reply leans on a changed estimate, the call happens in that same turn, so prose and panel cannot diverge. ONLY REFERENCE A RECORDED DIMENSION: never assert or calibrate on a position you have not recorded here; with no recorded value, fall back to the conservative default without narrating a position. Where the environment carries a lecturer-profile prior, ADOPT it as your starting estimate instead of re-eliciting from zero, and revise a dimension when later behaviour contradicts it. A dimension marked [LECTURER OVERRIDE] keeps the lecturer's value: re-emit it only after they explicitly confirmed the change in conversation, then with lecturerConfirmed: true and evidence naming the confirming turn — setting that flag without the confirmation is as forbidden as invented evidence. Fire-and-forget: there is NO lecturer answer — but read the result; a refusal names the scale or field that was wrong, and you correct and re-issue in the same turn.",
  promptSnippet:
    "Use cbe_profile(dimension, value, confidence, evidence) to record every lecturer-state estimate you form or revise; fire-and-forget, one dimension per call, evidence names the concrete signal.",
  // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app — pi's
  // `buildSystemPrompt` returns early on its `customPrompt` branch, which
  // `startCbeSession` always takes. Kept accurate for hosts on pi's default
  // prompt; every binding rule lives in `description` / parameter descriptions.
  promptGuidelines: [
    "dimension is one of pbl-prior-knowledge|cbe-prior-knowledge|didactic-stance|attitude|capacity; value must be on that dimension's scale.",
    "Call it when a substantive signal produces or changes an estimate — not every turn, and never without a signal.",
    "evidence is a short pointer to the observation (turn or material passage), not conversation content.",
    "The call records; your response still soft-surfaces the inference inline in one passing phrase.",
    "Lecturer overrides arrive via the Profile Panel, not via this tool — do not re-emit a dimension the lecturer overrode unless they explicitly confirm a change in the conversation.",
    "When the lecturer explicitly confirmed changing an overridden dimension, re-emit it with lecturerConfirmed: true and evidence pointing at the confirming turn. Setting lecturerConfirmed without that explicit confirmation is as forbidden as invented evidence; without the flag the host keeps the lecturer's panel value.",
  ],
  parameters: ProfileParamsSchema,
  async execute(_toolCallId, params: ProfileToolParams) {
    // Defence in depth: Pi validates against the schema before calling execute, but a
    // malformed payload MUST be a clean refusal that never corrupts stored state
    // (Requirement scenario: Malformed update is rejected without corrupting state).
    const dimensionOk = isProfileDimension(params?.dimension);
    const valueOk =
      dimensionOk && typeof params?.value === "string" && isValidDimensionValue(params.dimension, params.value);
    const confidenceOk = (CONFIDENCE_LEVELS as readonly unknown[]).includes(params?.confidence);
    const evidenceOk = typeof params?.evidence === "string" && params.evidence.trim().length > 0;
    if (!dimensionOk || !valueOk || !confidenceOk || !evidenceOk) {
      const scaleHint = dimensionOk
        ? `value must be one of ${DIMENSION_SCALES[params.dimension].join("|")}`
        : `dimension must be one of ${PROFILE_DIMENSIONS.join("|")}`;
      return {
        content: [
          {
            type: "text" as const,
            text: `cbe_profile: invalid payload (${scaleHint}; confidence ∈ ${CONFIDENCE_LEVELS.join("|")}; evidence non-empty). No profile update applied.`,
          },
        ],
        details: { kind: "profile-refusal" } satisfies ProfileToolDetails as ProfileToolDetails,
      };
    }
    // The ack must not over-claim: acceptance is decided host-side (override
    // precedence), so the text says "recorded", never "updated/applied" as fact
    // (Requirement scenario: Acknowledgement does not over-claim).
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Profile estimate recorded: ${params.dimension} = ${params.value} (${params.confidence}). ` +
            (params.lecturerConfirmed
              ? `Marked lecturer-confirmed; it replaces a manual Profile Panel setting.`
              : `If the lecturer set this dimension manually in the Profile Panel, their value stands and this estimate is not applied.`),
        },
      ],
      details: {
        kind: "profile-update",
        dimension: params.dimension,
        value: params.value,
        confidence: params.confidence,
        evidence: params.evidence,
        ...(params.lecturerConfirmed !== undefined && { lecturerConfirmed: params.lecturerConfirmed }),
      } satisfies ProfileToolDetails as ProfileToolDetails,
    };
  },
});
