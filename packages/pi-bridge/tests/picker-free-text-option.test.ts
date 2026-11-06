/**
 * Exactly ONE free-text option, in the lecturer's language (capability
 * `desktop-app`, Requirement: Collected UX-3 Fixes (Wave 1), scenario *Exactly
 * one free-text option, in the lecturer's language*).
 *
 * UX run 2 showed two adjacent escape hatches in one picker: the model's own
 * "Andere — ich beschreibe es" pill plus the renderer's hardcoded English one.
 * The host collapses the model's pill into `otherLabel` instead of rendering
 * both — which also carries the model's language onto the app-provided pill.
 */
import { describe, it, expect } from "vitest";
import { isFreeTextOption, normalizePickerParams, type PickerToolParams } from "../src/picker-tool.js";

function params(overrides: Partial<PickerToolParams> = {}): PickerToolParams {
  return {
    question: "Welche Tiefe willst du?",
    options: [
      { id: "a", label: "Ein erster Schritt" },
      { id: "b", label: "Eine substanzielle Überarbeitung" },
      { id: "c", label: "Ein voller Neubau" },
    ],
    ...overrides,
  };
}

describe("free-text option detection", () => {
  it.each([
    ["Andere — ich beschreibe es", "andere"],
    ["Other — I'll describe it", "other"],
    ["Sonstiges", "sonstiges"],
    ["Etwas anderes: ich schreibe es auf", "etwas-anderes"],
    ["Autre chose", "autre"],
    ["Something else…", "else"],
    ["Anders, nämlich…", "anders"],
  ])("recognises %s as the free-text escape hatch", (label, id) => {
    expect(isFreeTextOption({ id, label })).toBe(true);
  });

  it.each([
    ["Andere Formate", "formats"],
    ["Otro modelo pedagógico", "modelo"],
    ["Ein erster Schritt", "first-step"],
    ["Alternative Prüfungsform", "alt"],
  ])("does not mistake the genuine option %s for the escape hatch", (label, id) => {
    expect(isFreeTextOption({ id, label })).toBe(false);
  });

  it("does not treat an id-only match as the escape hatch", () => {
    expect(isFreeTextOption({ id: "other", label: "…" })).toBe(false);
  });

  it("leaves a genuine choice whose id happens to be an other-word alone", () => {
    expect(isFreeTextOption({ id: "sonstiges", label: "Weitere Praxisbeispiele" })).toBe(false);
  });
});

describe("normalizePickerParams", () => {
  it("leaves a picker without a model-supplied free-text option untouched", () => {
    const p = params();
    expect(normalizePickerParams(p)).toEqual(p);
  });

  it("collapses the model's free-text option and adopts its label", () => {
    const out = normalizePickerParams(
      params({
        options: [...params().options, { id: "andere", label: "Andere — ich beschreibe es" }],
      })
    );
    expect(out.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(out.otherEnabled).toBe(true);
    expect(out.otherLabel).toBe("Andere — ich beschreibe es");
  });

  it("keeps an explicitly supplied otherLabel over the adopted one", () => {
    const out = normalizePickerParams(
      params({
        otherLabel: "Andere Antwort",
        options: [...params().options, { id: "andere", label: "Andere — ich beschreibe es" }],
      })
    );
    expect(out.otherLabel).toBe("Andere Antwort");
  });

  it("honours the escape-hatch intent even when otherEnabled was false", () => {
    const out = normalizePickerParams(
      params({
        otherEnabled: false,
        options: [...params().options, { id: "sonstiges", label: "Sonstiges" }],
      })
    );
    expect(out.otherEnabled).toBe(true);
    expect(out.otherLabel).toBe("Sonstiges");
  });

  it("removes several free-text options at once", () => {
    const out = normalizePickerParams(
      params({
        options: [...params().options, { id: "andere", label: "Andere" }, { id: "other", label: "Other" }],
      })
    );
    expect(out.options).toHaveLength(3);
  });

  it("suppresses the app's option instead of shrinking options[] below two entries", () => {
    // Removing the escape hatch here would leave a one-entry options[], which the
    // renderer's structural sanity check rejects outright — so the model's pill
    // stays and the app's is suppressed. Still exactly one free-text surface.
    const out = normalizePickerParams(
      params({
        options: [
          { id: "a", label: "Ja" },
          { id: "andere", label: "Andere" },
        ],
      })
    );
    expect(out.options).toHaveLength(2);
    expect(out.otherEnabled).toBe(false);
  });

  it("keeps a genuine option whose id happens to be an other-word in the pill set", () => {
    const p = params({
      options: [...params().options, { id: "sonstiges", label: "Weitere Praxisbeispiele" }],
    });
    const out = normalizePickerParams(p);
    expect(out).toEqual(p);
    expect(out.options.map((o) => o.id)).toContain("sonstiges");
    expect(out.otherLabel).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = normalizePickerParams(
      params({ options: [...params().options, { id: "andere", label: "Andere — ich beschreibe es" }] })
    );
    expect(normalizePickerParams(once)).toEqual(once);
  });
});
