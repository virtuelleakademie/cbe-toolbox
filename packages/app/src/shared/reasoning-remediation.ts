/**
 * Runtime detection of the no-tool-call failure signature of a reasoning-hybrid
 * model run WITHOUT `reasoning_effort` (capability `agent-harness`, Requirement:
 * Reasoning Remediation for Tool-Call-Gated Models).
 *
 * The signature, observed on the OPENING exchange of a session:
 * - the tool allowlist is non-empty, AND
 * - the mandatory-read protocol is in force (the opening protocol REQUIRES the
 *   model to call `read` before answering), AND
 * - the assistant turn produced ZERO `tool_use` parts (only thinking / text), AND
 * - `stopReason === "stop"`.
 *
 * When all four hold, the model narrated the action but executed nothing — the
 * session is silently inert. The harness surfaces a one-click remediation.
 *
 * HARD CONSTRAINT: the decision is purely structural. There is deliberately NO
 * model-id / model-name field on the input shape, so detection can NEVER key on a
 * substring or pattern match against the model id (Scenario: *Detection never keys
 * on the model name*). This makes the predicate a pure, unit-testable function of
 * the observed turn — independent of any naming or metadata scheme.
 */

/**
 * The minimal observed shape of an assistant opening turn. Carries ONLY the four
 * structural facts the signature needs — never the model id.
 */
export interface OpeningTurnSignal {
  /** The session's tool allowlist is non-empty (tools were available to call). */
  toolAllowlistNonEmpty: boolean;
  /**
   * The mandatory-read protocol is in force for this exchange — the opening
   * protocol required the model to call `read` before answering. Gating on this
   * is what makes a tool-free turn genuinely anomalous rather than a legitimately
   * tool-free reply.
   */
  mandatoryReadProtocolInForce: boolean;
  /** Number of `tool_use` parts the assistant turn produced. */
  toolUseCount: number;
  /** The turn's stop reason as reported by the provider. */
  stopReason: string;
}

/**
 * Pure predicate: does the observed opening turn match the no-tool-call signature?
 *
 * True iff tools were available AND the mandatory-read protocol was in force AND
 * the assistant produced zero tool calls AND the turn ended with `stopReason:
 * "stop"`. Any other combination → false.
 */
export function isNoToolCallSignature(signal: OpeningTurnSignal): boolean {
  return (
    signal.toolAllowlistNonEmpty &&
    signal.mandatoryReadProtocolInForce &&
    signal.toolUseCount === 0 &&
    signal.stopReason === "stop"
  );
}

/** Default effort applied when the remediation enables reasoning on confirmation. */
export const REMEDIATION_DEFAULT_EFFORT = "medium" as const;
