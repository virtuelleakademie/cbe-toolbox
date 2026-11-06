/**
 * Pure-predicate tests for the no-tool-call reasoning signature (capability
 * `agent-harness`, Requirement: Reasoning Remediation for Tool-Call-Gated Models).
 *
 * Mirrors the three Scenarios:
 * - No-tool-call opening turn surfaces a reasoning remediation (positive).
 * - Detection never keys on the model name (there is no model field to key on).
 * - Negatives: a turn that DID call a tool; a turn with no protocol in force.
 */
import { describe, expect, it } from "vitest";
import { isNoToolCallSignature, type OpeningTurnSignal } from "../src/shared/reasoning-remediation.js";

const base: OpeningTurnSignal = {
  toolAllowlistNonEmpty: true,
  mandatoryReadProtocolInForce: true,
  toolUseCount: 0,
  stopReason: "stop",
};

describe("isNoToolCallSignature", () => {
  // Scenario: No-tool-call opening turn surfaces a reasoning remediation.
  it("is true when tools are available, protocol in force, zero tool_use, stopReason stop", () => {
    expect(isNoToolCallSignature(base)).toBe(true);
  });

  // Negative: a turn that DID call a tool is normal — no remediation.
  it("is false when the assistant called at least one tool", () => {
    expect(isNoToolCallSignature({ ...base, toolUseCount: 1 })).toBe(false);
  });

  // Negative: no mandatory-read protocol in force → a tool-free turn is legitimate.
  it("is false when the mandatory-read protocol is not in force", () => {
    expect(isNoToolCallSignature({ ...base, mandatoryReadProtocolInForce: false })).toBe(false);
  });

  // Negative: empty tool allowlist → there was nothing to call.
  it("is false when the tool allowlist is empty", () => {
    expect(isNoToolCallSignature({ ...base, toolAllowlistNonEmpty: false })).toBe(false);
  });

  // Negative: a non-stop stop reason (error / length / tool_use) is not the signature.
  it("is false when stopReason is not 'stop'", () => {
    expect(isNoToolCallSignature({ ...base, stopReason: "error" })).toBe(false);
    expect(isNoToolCallSignature({ ...base, stopReason: "length" })).toBe(false);
  });

  // Scenario: Detection never keys on the model name. The input shape has NO model
  // field — there is structurally no name to key on. Identical structural inputs
  // yield identical decisions regardless of any (absent) model identity.
  it("decides purely from the turn shape — the input carries no model id to key on", () => {
    const keys = Object.keys(base);
    expect(keys).not.toContain("modelId");
    expect(keys).not.toContain("modelName");
    expect(keys).not.toContain("model");
    // Two evaluations of the same structural shape are identical.
    expect(isNoToolCallSignature({ ...base })).toBe(isNoToolCallSignature({ ...base }));
  });
});
