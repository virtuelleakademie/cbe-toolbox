/**
 * Tests for the payload-hardening Pi extension.
 *
 * Covers `specs/agent-harness/spec.md`, Requirement: Parallel-Tool-Call Hardening
 * Against Empty-Named Phantom Calls. The pure `hardenProviderPayload` is exercised
 * directly; the factory is driven with a minimal mock ExtensionAPI that captures
 * the `before_provider_request` handler — no live Pi runtime needed.
 */
import { describe, it, expect } from "vitest";
import {
  hardenProviderPayload,
  createPayloadHardeningExtension,
  PAYLOAD_HARDENING_HOOK,
} from "../src/payload-hardening-extension.js";

describe("hardenProviderPayload", () => {
  // Scenario: Parallel tool calls are disabled when tools are present.
  it("sets parallel_tool_calls=false when a non-empty tools array is present and preserves other fields", () => {
    const payload = { model: "m", messages: [{ role: "user" }], tools: [{ type: "function" }], temperature: 0.7 };
    const result = hardenProviderPayload(payload) as Record<string, unknown>;
    expect(result.parallel_tool_calls).toBe(false);
    // Every other field is preserved unchanged.
    expect(result.model).toBe("m");
    expect(result.temperature).toBe(0.7);
    expect(result.messages).toBe(payload.messages);
  });

  // Scenario: The param is omitted when no tools are present.
  it("does NOT add parallel_tool_calls when there is no tools array", () => {
    const result = hardenProviderPayload({ model: "m", messages: [] });
    // Undefined return = keep the current payload untouched.
    expect(result).toBeUndefined();
  });

  it("does NOT add parallel_tool_calls when tools is an empty array", () => {
    const result = hardenProviderPayload({ model: "m", tools: [] });
    expect(result).toBeUndefined();
  });

  it("returns undefined for a non-object payload (never throws)", () => {
    expect(hardenProviderPayload(null)).toBeUndefined();
    expect(hardenProviderPayload(undefined)).toBeUndefined();
    expect(hardenProviderPayload("nope")).toBeUndefined();
  });
});

describe("createPayloadHardeningExtension", () => {
  it("registers exactly one before_provider_request handler and no commands", () => {
    const handlers = new Map<string, (event: { type: string; payload: unknown }) => unknown>();
    let commandCount = 0;
    const pi = {
      on: (event: string, handler: (e: { type: string; payload: unknown }) => unknown) => handlers.set(event, handler),
      registerCommand: () => {
        commandCount++;
      },
    };
    createPayloadHardeningExtension()(pi as never);

    expect(commandCount).toBe(0);
    expect([...handlers.keys()]).toEqual([PAYLOAD_HARDENING_HOOK]);

    // The registered handler applies the hardening transform.
    const handler = handlers.get(PAYLOAD_HARDENING_HOOK)!;
    const out = handler({ type: "before_provider_request", payload: { tools: [{ type: "function" }] } }) as Record<
      string,
      unknown
    >;
    expect(out.parallel_tool_calls).toBe(false);
  });
});
