/**
 * Tests for `specs/desktop-app/spec.md`, Requirement *Iconography Instead of Emojis*
 * — Scenarios *No emojis in app chrome by Phase 2*, *Icons inherit theme colour* and
 * *Every emoji placeholder in chrome is replaced library-agnostically*, whose
 * chrome-wide half is frozen in the sibling `chrome-no-emoji.test.ts`.
 *
 * The two surfaces that still carried a literal glyph after the rollout are the
 * Decisions section's inconsistency warning (a `⚠`) and the Decision Checklist's
 * done marker (a `✓`). Both now render the app's own inline-SVG `ActionIcon`, bound
 * to `currentColor` — no icon-library dependency.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { DecisionChecklist, type DecisionChecklistSpec } from "../src/renderer/components/DecisionChecklist.js";
import { ActionIcon } from "../src/renderer/components/ActionIcon.js";
import { SAMPLE_DIDACTIC_CHECKS } from "./fixtures/decisions.js";

/** Emoji, dingbat, geometric-shape and arrow ranges — the placeholder classes the requirement forbids. */
const GLYPH_RE = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{25A0}-\u{25FF}]/u;

afterEach(() => cleanup());

describe("Decisions section — inconsistency warning", () => {
  beforeEach(() => {
    useCbe.setState({
      didacticChecks: structuredClone(SAMPLE_DIDACTIC_CHECKS),
      invalidatedChecks: [],
    });
  });

  function flag(container: HTMLElement): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));
    const el = container.querySelector(".decision-flag");
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  it("renders no literal glyph in front of the inconsistency flag", () => {
    const { container } = render(<ArtifactsPanel />);
    const el = flag(container);
    const icon = el.firstElementChild;
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("data-kind")).toBe("warning");

    const iconSlot = Array.from(el.childNodes)
      .slice(0, Array.from(el.childNodes).indexOf(icon as ChildNode) + 1)
      .map((node) => node.textContent ?? "")
      .join("");
    expect(iconSlot).not.toMatch(GLYPH_RE);
  });

  it("still reads as a warning for a screen reader", () => {
    const { container } = render(<ArtifactsPanel />);
    const icon = within(flag(container)).getByRole("img", { name: "Warning" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("data-kind")).toBe("warning");
  });

  it("binds the warning icon to currentColor so a theme or accent switch re-tints it", () => {
    const { container } = render(<ArtifactsPanel />);
    const icon = within(flag(container)).getByRole("img", { name: "Warning" });
    expect(icon.innerHTML).toContain("currentColor");
    // No hard-coded colour of any kind.
    expect(icon.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });
});

describe("Decision Checklist — done marker", () => {
  const spec: DecisionChecklistSpec = {
    title: "Offene Entscheidungen",
    presentation: "checklist",
    items: [{ id: "i1", label: "Big Idea festziehen" }],
  };

  it("renders no literal check glyph once an item is marked done", () => {
    const { container } = render(<DecisionChecklist spec={spec} />);
    const box = screen.getByRole("checkbox", { name: /Big Idea/ });
    fireEvent.click(box);

    const marker = container.querySelector(".dc-check") as HTMLElement;
    expect(marker.textContent ?? "").not.toMatch(GLYPH_RE);
    const svg = marker.querySelector("svg");
    expect(svg?.getAttribute("data-kind")).toBe("check");
    expect(svg?.innerHTML).toContain("currentColor");
  });

  it("still reads as done for a screen reader — the checkbox carries the state, not the glyph", () => {
    render(<DecisionChecklist spec={spec} />);
    const box = screen.getByRole("checkbox", { name: /Big Idea/ });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(screen.getByRole("checkbox", { name: /Big Idea/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("ActionIcon naming contract", () => {
  it("is decorative by default and named when a label is supplied", () => {
    const { container, rerender } = render(<ActionIcon kind="check" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    rerender(<ActionIcon kind="warning" label="Warning" />);
    const named = container.querySelector("svg")!;
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Warning");
  });
});
