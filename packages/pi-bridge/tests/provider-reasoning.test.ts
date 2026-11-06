/**
 * Provider reasoning wiring (capability `agent-harness`, Requirement:
 * Bring-Your-Own-LLM Configuration — the reasoning setting).
 *
 * `registerProvider` is the seam where reasoning becomes a request-surface fact:
 * a reasoning-enabled config registers the model with
 * `compat.supportsReasoningEffort = true` (the flag the openai-completions
 * provider checks before emitting `reasoning_effort`); a disabled/unset config
 * leaves the flag off so the request surface is identical to a pre-reasoning
 * configuration.
 */
import { describe, it, expect } from "vitest";
import { registerProvider, type ProviderConfig } from "../src/provider.js";

/** Minimal ModelRegistry stub capturing the registerProvider input. */
function fakeRegistry() {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const registry = {
    registerProvider(name: string, input: Record<string, unknown>) {
      calls.push({ name, input });
    },
    find() {
      return undefined;
    },
  };
  return { registry, calls };
}

const base: ProviderConfig = { baseURL: "http://x/v1", apiKey: "k", modelId: "qwen-a3b" };

function registeredModel(calls: ReturnType<typeof fakeRegistry>["calls"]) {
  const models = calls[0]!.input.models as Array<Record<string, unknown>>;
  return models[0]!;
}

describe("registerProvider — reasoning setting", () => {
  // Scenario: Reasoning effort is sent for a reasoning-configured model — the
  // registered model carries supportsReasoningEffort so the request includes it.
  it("registers the model with compat.supportsReasoningEffort when reasoning is enabled", () => {
    const { registry, calls } = fakeRegistry();
    registerProvider(registry as never, { ...base, reasoning: true, reasoningEffort: "medium" });
    const model = registeredModel(calls);
    expect(model.reasoning).toBe(true);
    expect(model.compat).toEqual({ supportsReasoningEffort: true });
  });

  // Scenario: Reasoning disabled sends no effort and preserves prior behaviour —
  // no supportsReasoningEffort flag, identical request surface.
  it("does NOT set supportsReasoningEffort when reasoning is disabled", () => {
    const { registry, calls } = fakeRegistry();
    registerProvider(registry as never, { ...base, reasoning: false });
    const model = registeredModel(calls);
    expect(model.reasoning).toBe(false);
    expect(model.compat).toBeUndefined();
  });

  it("does NOT set supportsReasoningEffort when reasoning is unset (pre-reasoning config)", () => {
    const { registry, calls } = fakeRegistry();
    registerProvider(registry as never, { ...base });
    const model = registeredModel(calls);
    expect(model.reasoning).toBe(false);
    expect(model.compat).toBeUndefined();
  });
});
