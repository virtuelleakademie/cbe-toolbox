/**
 * Unit tests for the best-effort `/models` reasoning-capability probe
 * (capability `desktop-app`, Requirement: Provider Reasoning Configuration).
 *
 * The probe MUST: read only the structured `supported_parameters` array (never
 * the model name), be non-fatal on any failure, and cache per `(baseURL, modelId)`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeReasoningSupport, __clearProbeCache } from "../src/main/model-metadata.js";

afterEach(() => {
  __clearProbeCache();
  vi.restoreAllMocks();
});

function okFetch(rows: Array<{ id: string; supported_parameters?: string[] }>) {
  return vi.fn(async (_url: string) => ({
    ok: true,
    json: async () => ({ data: rows }),
  })) as unknown as typeof fetch;
}

describe("probeReasoningSupport", () => {
  it("returns true when the matching model lists 'reasoning' in supported_parameters", async () => {
    const f = okFetch([{ id: "qwen/qwen3.6-35b-a3b", supported_parameters: ["tools", "reasoning"] }]);
    expect(await probeReasoningSupport("https://openrouter.ai/api/v1", "qwen/qwen3.6-35b-a3b", "k", f)).toBe(true);
  });

  it("returns false when the matching model has no supported_parameters (minimal OpenAI shape)", async () => {
    const f = okFetch([{ id: "local-model" }]);
    expect(await probeReasoningSupport("http://127.0.0.1:11434/v1", "local-model", "k", f)).toBe(false);
  });

  it("returns false when the model id is not present in /models", async () => {
    const f = okFetch([{ id: "other", supported_parameters: ["reasoning"] }]);
    expect(await probeReasoningSupport("https://x/v1", "missing", "k", f)).toBe(false);
  });

  // The decision MUST be structural, never name-based: a model whose NAME screams
  // "reasoning/a3b/gpt-oss" but does NOT declare the parameter is reported false.
  it("never infers support from the model NAME — only from supported_parameters", async () => {
    const f = okFetch([{ id: "qwen3-a3b-gpt-oss-reasoning-thinking" /* no supported_parameters */ }]);
    expect(await probeReasoningSupport("https://x/v1", "qwen3-a3b-gpt-oss-reasoning-thinking", "k", f)).toBe(false);
  });

  it("is non-fatal: a thrown fetch resolves to false", async () => {
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await probeReasoningSupport("https://x/v1", "m", "k", f)).toBe(false);
  });

  it("is non-fatal: a non-2xx response resolves to false", async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await probeReasoningSupport("https://x/v1", "m", "k", f)).toBe(false);
  });

  it("caches the result per (baseURL, modelId) — a second call does not re-fetch", async () => {
    const f = okFetch([{ id: "m", supported_parameters: ["reasoning"] }]);
    expect(await probeReasoningSupport("https://x/v1", "m", "k", f)).toBe(true);
    expect(await probeReasoningSupport("https://x/v1", "m", "k", f)).toBe(true);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("targets {baseURL}/models without doubling the slash", async () => {
    const f = okFetch([{ id: "m", supported_parameters: ["reasoning"] }]);
    await probeReasoningSupport("https://x/v1/", "m", "k", f);
    const url = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("https://x/v1/models");
  });
});
