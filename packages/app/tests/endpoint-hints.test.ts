/**
 * Unit tests for the pure endpoint-hint heuristics (no network, no DOM).
 * Covers desktop-app spec, Requirement: Provider Configuration Input Hygiene —
 * the Azure shape hint and the plain-http cleartext warning.
 */
import { describe, expect, it } from "vitest";
import { deriveEndpointHints } from "../src/renderer/util/endpoint-hints.js";

describe("deriveEndpointHints — Azure shape hint", () => {
  it("proposes the /openai/v1 surface for a bare Azure resource URL", () => {
    const h = deriveEndpointHints("https://myresource.openai.azure.com");
    expect(h.azureSuggestion).toBe("https://myresource.openai.azure.com/openai/v1");
  });

  it("does not hint when the Azure URL already targets /openai/v1", () => {
    const h = deriveEndpointHints("https://myresource.openai.azure.com/openai/v1");
    expect(h.azureSuggestion).toBeUndefined();
  });

  it("does not hint for a non-Azure gateway-style https URL", () => {
    const h = deriveEndpointHints("https://gateway.example.org/azure/openai");
    expect(h.azureSuggestion).toBeUndefined();
    expect(h.cleartextWarning).toBe(false);
  });
});

describe("deriveEndpointHints — cleartext warning", () => {
  it("warns for plain http to a non-loopback host", () => {
    expect(deriveEndpointHints("http://llm.example.org/v1").cleartextWarning).toBe(true);
  });

  it("does not warn for http loopback (localhost / 127.x / ::1)", () => {
    expect(deriveEndpointHints("http://localhost:11434/v1").cleartextWarning).toBe(false);
    expect(deriveEndpointHints("http://127.0.0.1:8000/v1").cleartextWarning).toBe(false);
    expect(deriveEndpointHints("http://[::1]:8080/v1").cleartextWarning).toBe(false);
  });

  it("does not warn for https", () => {
    expect(deriveEndpointHints("https://llm.example.org/v1").cleartextWarning).toBe(false);
  });
});

describe("deriveEndpointHints — empty / unparseable input", () => {
  it("returns no hints for an empty or malformed URL", () => {
    expect(deriveEndpointHints("")).toEqual({ cleartextWarning: false });
    expect(deriveEndpointHints("not a url")).toEqual({ cleartextWarning: false });
  });
});
