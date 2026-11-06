/**
 * `cbe_support` — records the lecturer's lasting support preference (capability
 * `agent-harness`, Requirement: *Separate Lecturer-Wide Support Preference*).
 *
 * Unlike `cbe_profile`, whose acknowledgement is synchronous and whose persistence the
 * host does afterwards from the tool CALL, this tool is BOUND to the host's support
 * service and writes through it inside `execute`: the result reports durable truth, so
 * an "accepted" result exists only after the save resolved, and a refused or failed one
 * carries the snapshot that still holds. It does NOT terminate the run — a preference
 * change accompanies the work of the same turn, like the mirroring tools.
 *
 * The operating rules — explicit-instruction-only writes, the one-off/lasting
 * distinction, revision handling, stale reconciliation and no retry loop after a failed
 * save — live in `description` and the parameter descriptions and nowhere else; the
 * identity prompt names only the trigger, and what the values MEAN is the skill's.
 *
 * The schema is a FLAT object rather than a discriminated union, because a top-level
 * `anyOf` is what several OpenAI-compatible providers reject; `execute` enforces the
 * set/clear pairing itself and refuses a mismatched call without writing.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  SUPPORT_PREFERENCES,
  isSupportPreference,
  type LecturerSupportHost,
  type LecturerSupportSnapshot,
  type SupportChange,
} from "./lecturer-support.js";

const SupportParamsSchema = Type.Object({
  operation: Type.Union([Type.Literal("set"), Type.Literal("clear")], {
    description: "set records a preference; clear removes it and returns to the default.",
  }),
  preference: Type.Optional(
    Type.Union(
      SUPPORT_PREFERENCES.map((p) => Type.Literal(p)),
      {
        description:
          "set only, omitted for clear: guided = step by step, one question at a time; collaborative = help with their draft; concise = brief criteria and feedback.",
      }
    )
  ),
  expectedRevision: Type.Integer({
    minimum: 0,
    description: "The revision of the latest lecturer-support snapshot you were given.",
  }),
});

export type SupportToolParams = Static<typeof SupportParamsSchema>;

/** Tool-result details. Every kind carries the snapshot that holds after the call. */
export interface SupportToolDetails {
  kind: "support-accepted" | "support-refused" | "support-failed";
  snapshot: LecturerSupportSnapshot;
  reason?: "malformed" | "stale" | "save-failed";
}

// Exported for the schema-contract unit tests.
export { SupportParamsSchema };

function describe(snapshot: LecturerSupportSnapshot): string {
  const preference = snapshot.preference ?? "none recorded";
  return `preference: ${preference}; revision: ${snapshot.revision}; storage: ${snapshot.scope}`;
}

/**
 * Build the tool for one session over the host's service. `onSnapshotSeen` lets the
 * session's next-prompt disclosure know the model has just read a snapshot in the
 * result, so the same revision is not disclosed to it a second time.
 */
export function createSupportTool(
  host: LecturerSupportHost,
  onSnapshotSeen?: (snapshot: LecturerSupportSnapshot) => void
) {
  const result = (text: string, details: SupportToolDetails) => {
    onSnapshotSeen?.(details.snapshot);
    return { content: [{ type: "text" as const, text }], details };
  };

  return defineTool({
    name: "cbe_support",
    label: "Support",
    description:
      "Record how much help the lecturer wants from now on — lasting, unlike help with the task in hand. Call it ONLY on their explicit instruction: a stated preference, their answer to your question about it, or a request to change or clear it. Never for a one-off request such as one example now, and never inferred from their competence, silence or difficulty. Pass expectedRevision from the latest lecturer-support snapshot. Read the result before saying anything was saved: only an accepted result is saved, and its storage line says how long it lasts. A stale refusal carries the current snapshot — reconcile it with what the lecturer now asks; never replay the older choice. A failed save changed nothing: say so and do not retry on your own.",
    promptSnippet:
      "Use cbe_support(operation, preference?, expectedRevision) only when the lecturer explicitly states, changes or clears a lasting support preference.",
    // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app (pi's
    // `buildSystemPrompt` returns early on its `customPrompt` branch). Kept accurate for
    // hosts on pi's default prompt; every binding rule lives in `description`.
    promptGuidelines: [
      "Only on an explicit lecturer instruction about lasting support; a one-off help request is not one.",
      "set takes exactly one of guided|collaborative|concise; clear takes none.",
      "Claim nothing was saved until the result is accepted; reconcile a stale refusal with the current snapshot.",
    ],
    parameters: SupportParamsSchema,
    async execute(_toolCallId, params: SupportToolParams) {
      const operation = params?.operation;
      const preference = params?.preference;
      const expectedRevision = params?.expectedRevision;
      const revisionOk =
        typeof expectedRevision === "number" && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0;
      let change: SupportChange | null = null;
      if (operation === "set" && isSupportPreference(preference)) change = { operation: "set", preference };
      else if (operation === "clear" && preference === undefined) change = { operation: "clear" };

      if (!change || !revisionOk) {
        // Malformed: no write. The current snapshot rides the refusal so the next call
        // can be built against the truth.
        const snapshot = await host.current();
        return result(
          `cbe_support refused: invalid call (set takes exactly one preference of ${SUPPORT_PREFERENCES.join("|")}; clear takes none; expectedRevision is a non-negative integer). Nothing was saved. Current: ${describe(snapshot)}.`,
          { kind: "support-refused", reason: "malformed", snapshot }
        );
      }

      const outcome = await host.change(change, expectedRevision);
      if (outcome.outcome === "accepted") {
        return result(`Support preference saved. Now: ${describe(outcome.snapshot)}.`, {
          kind: "support-accepted",
          snapshot: outcome.snapshot,
        });
      }
      if (outcome.outcome === "refused-stale") {
        return result(
          `cbe_support refused: expectedRevision ${expectedRevision} is stale. Nothing was saved. Current: ${describe(outcome.snapshot)}.`,
          { kind: "support-refused", reason: "stale", snapshot: outcome.snapshot }
        );
      }
      return result(
        `cbe_support failed: the preference could not be saved. Nothing changed. Still: ${describe(outcome.snapshot)}.`,
        { kind: "support-failed", reason: "save-failed", snapshot: outcome.snapshot }
      );
    },
  });
}
