/**
 * Tests for the BYO-LLM provider registration.
 *
 * The context window the provider registers is load-bearing: pi treats a model
 * whose reported usage exceeds `contextWindow` as a context overflow and
 * triggers auto-compaction. A too-small window therefore causes PREMATURE
 * overflow/compaction on normal-length sessions — the mechanism behind the
 * reported picker "Cannot continue from message role: assistant" failure. These
 * tests pin that an unconfigured provider assumes a high default window, and
 * that an explicit context length is honoured verbatim.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerProvider, DEFAULT_CONTEXT_LENGTH } from "../src/provider.js";
import { createPiModelRuntime } from "../src/runtime/pi-config.js";

/** A fresh session runtime, exactly as every session policy builds one. */
function freshRegistry(): Promise<ModelRuntime> {
  return createPiModelRuntime(mkdtempSync(path.join(tmpdir(), "cbe-provider-")));
}

describe("registerProvider — context window", () => {
  it("defaults the context window to a high value (128k) when contextLength is omitted", async () => {
    const registry = await freshRegistry();
    const { provider, modelId } = registerProvider(registry, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "local-model",
    });
    const model = registry.getModel(provider, modelId);
    expect(model?.contextWindow).toBe(DEFAULT_CONTEXT_LENGTH);
    expect(DEFAULT_CONTEXT_LENGTH).toBeGreaterThanOrEqual(131_072);
  });

  it("uses the configured contextLength verbatim when provided (e.g. a 64k local model)", async () => {
    const registry = await freshRegistry();
    const { provider, modelId } = registerProvider(registry, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "local-64k",
      contextLength: 65_536,
    });
    expect(registry.getModel(provider, modelId)?.contextWindow).toBe(65_536);
  });

  it("does NOT register the old hard-coded 32k window for an unconfigured provider", async () => {
    const registry = await freshRegistry();
    const { provider, modelId } = registerProvider(registry, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "local-model",
    });
    expect(registry.getModel(provider, modelId)?.contextWindow).not.toBe(32_000);
  });
});

describe("registerProvider — generic OpenAI-compatible endpoint (BYO-LLM)", () => {
  // Scenario: Endpoint switch at runtime. startCbeSession reads the saved config at each
  // session start (a fresh ModelRuntime per session), so editing baseURL/modelId in Settings
  // routes the next session to the new endpoint/model without an app restart. Named
  // providers (Anthropic, OpenAI, Gemini, Mistral, Ollama) are reached by pointing the
  // base URL at them directly or at an OpenAI-compatible aggregator like OpenRouter.
  it("routes a new session to the edited endpoint + model without an app restart", async () => {
    // Session 1: a local OpenAI-compatible endpoint.
    const r1 = await freshRegistry();
    const a = registerProvider(r1, { baseURL: "http://127.0.0.1:8000/v1", apiKey: "k1", modelId: "local-model" });
    expect(r1.getModel(a.provider, a.modelId)?.id).toBe("local-model");

    // Lecturer edits Settings to an OpenRouter endpoint + a hosted model; the next session
    // re-reads the config into a fresh registry.
    const r2 = await freshRegistry();
    const b = registerProvider(r2, {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "k2",
      modelId: "anthropic/claude-3.5-sonnet",
    });
    expect(r2.getModel(b.provider, b.modelId)?.id).toBe("anthropic/claude-3.5-sonnet");
    // The previous session's model is not present in the new session's registry.
    expect(r2.getModel(a.provider, "local-model")).toBeFalsy();
  });

  it("registers any OpenAI-compatible base URL as a single generic provider (no per-vendor branching)", async () => {
    const registry = await freshRegistry();
    const { provider } = registerProvider(registry, {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "k",
      modelId: "mistralai/mistral-large",
    });
    // One generic provider id, regardless of which vendor's model is reached through it.
    expect(provider).toBe("byo-llm");
  });
});
