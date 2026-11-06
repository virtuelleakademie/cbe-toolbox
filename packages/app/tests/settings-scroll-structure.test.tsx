/**
 * Tests for change `add-ux-polish-collected-fixes` (capability `desktop-app`,
 * Requirement: Collected UX Polish) — Scenario: Context-length input sits
 * inside the panel's scrollable region.
 *
 * jsdom does not lay out pixels, so this asserts the DOM/containment STRUCTURE
 * (the field lives inside the settings surface's scroll region, no clipped
 * fixed-height container in between) plus the stylesheet source (the scroll
 * region scrolls, the containment chain neither clips nor fixes a height) — the
 * tiered-errors stylesheet-assertion precedent. The visual defect itself is
 * covered by the manual walkthrough note.
 *
 * The guarantee is layout-agnostic: it constrains the containment and scroll
 * structure, not where the surface sits. Settings left the right panel with the
 * chrome rebuild, so the scroll region under test is the settings surface's own —
 * the Settings section of the Profile-and-Settings overlay (`.overlay-body`).
 *
 * Since `split-llm-settings-into-standard-and-advanced` the field lives behind
 * the Model group's Advanced disclosure, so each case expands it first — and the
 * disclosure itself is now one of the containers the chain assertion covers: it
 * must not become a clipping box between the scroll region and the field.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";

const SCROLL_REGION = "#overlay-section-settings";

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.getState().showSettingsSurface("settings");
  // The context-length field lives in the Model group; the accordion opens on
  // Appearance, so open it (Requirement: Settings Panel (Phase 1 scaffold)).
  useCbe.getState().setSettingsOpenGroup("model");
  useCbe.setState({
    providerStatus: { baseURL: "http://127.0.0.1:8000/v1", modelId: "test-model", hasKey: true },
  });
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

/** Expand the Model group's Advanced disclosure, where the context-length field
 * lives since the group gained two levels (Requirement: Settings Panel (Phase 1
 * scaffold)). */
function expandAdvanced() {
  const header = screen.getByRole("button", { name: /^advanced$/i });
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
}

/** Extract a top-level CSS rule block for a selector from styles.css. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe("Context-length input sits inside the settings surface's scrollable region", () => {
  it("with the Model section and its Advanced disclosure expanded, the whole field lives inside the scroll region", () => {
    render(<ProfileSettingsOverlay />);
    expandAdvanced();
    const input = screen.getByPlaceholderText("e.g. 65536");
    const scrollRegion = document.querySelector(SCROLL_REGION);
    expect(scrollRegion).not.toBeNull();
    // Input, its label row, and the explanation/validation slot are all
    // descendants of the panel's ONE scrollable region.
    const row = input.closest(".set-field");
    expect(row).not.toBeNull();
    expect(scrollRegion!.contains(input)).toBe(true);
    expect(scrollRegion!.contains(row!)).toBe(true);
    const label = Array.from(row!.querySelectorAll(".rk")).find((el) => el.textContent?.includes("Context length"));
    expect(label).toBeTruthy();
    expect(scrollRegion!.contains(label!)).toBe(true);
  });

  it("no container between the scroll region and the field clips without a scroll affordance — the Advanced disclosure included", () => {
    render(<ProfileSettingsOverlay />);
    expandAdvanced();
    const input = screen.getByPlaceholderText("e.g. 65536");
    const scrollRegion = document.querySelector(SCROLL_REGION)!;
    // Walk the containment chain and collect every class that styles an
    // intermediate container; the stylesheet half below proves none of them
    // clips or fixes a height.
    const chainClasses = new Set<string>();
    for (let el = input.parentElement; el && el !== scrollRegion; el = el.parentElement) {
      el.classList.forEach((c) => chainClasses.add(`.${c}`));
    }
    // The Advanced disclosure IS on that chain — assert it explicitly, so the
    // walk below is not silently passing over a container it never saw.
    expect(chainClasses.has(".set-adv-body")).toBe(true);
    expect(chainClasses.has(".set-adv")).toBe(true);
    const css = readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
    for (const selector of chainClasses) {
      // Only inspect selectors that have a top-level rule of their own.
      if (!css.includes(`${selector} {`)) continue;
      const rule = cssRule(css, selector);
      expect(rule, `${selector} must not clip`).not.toMatch(/overflow(?:-y)?:\s*hidden/);
      expect(rule, `${selector} must not fix a height`).not.toMatch(/(?<!\w)(?<!(?:max|min)-)height:\s*\d/);
    }
  });

  it("stylesheet: the settings surface's scroll region is the affordance that reaches the field", () => {
    const css = readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(cssRule(css, ".overlay-body")).toMatch(/overflow-y:\s*auto/);
    // The settings panel itself inherits that scroll (no competing scroll trap
    // or clip of its own).
    const settingsRule = cssRule(css, ".settings-panel");
    expect(settingsRule).not.toMatch(/overflow(?:-y)?:\s*hidden/);
    expect(settingsRule).not.toMatch(/(?<!(?:max|min)-)height:\s*\d/);
  });
});
