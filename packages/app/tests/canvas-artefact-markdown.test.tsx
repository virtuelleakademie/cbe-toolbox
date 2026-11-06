/**
 * Canvas artefact values render through the SHARED chat Markdown component, and the
 * canvas seed is derived from the shared canonical slot table (change
 * `harden-canvas-determinism-and-ux2-fixes`).
 *
 * - capability `desktop-app`, Requirement: Collected UX-2 Fixes — Scenario: *Canvas
 *   artefact values render as Markdown, not as raw text*.
 * - capability `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement
 *   for Canvas Ids … — "the renderer's canvas seed and the harness's slot table MUST be
 *   derived from that single source".
 *
 * Security boundary: artefact values are agent-authored CONTENT (the same class as
 * chat text), so they take the same pipeline chat takes — `skipHtml`, GFM, citation
 * linkification. That is deliberately NOT the Maturity panel's rule, where `hint` /
 * `note` MUST stay escaped plain-text nodes (desktop-app spec, Requirement: Maturity
 * Panel). The guard below pins the no-raw-HTML half here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { stepGroups, STEP_ORDER } from "../src/renderer/mocks/artifacts.js";
import { en } from "../src/shared/i18n/en.js";

/** The seed in the PINNED test language. It is a function of the catalogue now,
 * because a step name and an artefact label are chrome (capability `desktop-app`,
 * Requirement: *Each Rendered Chrome String Has Exactly One Owner*). */
const STEP_GROUPS = stepGroups(en);
import { CANONICAL_SLOTS, JOURNEY_PHASES } from "@cbe/pi-bridge/canvas-addressing";
import type { StartSessionResult } from "../src/shared/ipc-contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS_PATH = resolve(__dirname, "../src/renderer/styles.css");

const FAKE_SESSION = {
  sessionId: "s-1",
  mode: "design",
  environmentProfile: "app",
  affordances: {},
  paths: { workspace: "", corpus: "", wiki: undefined },
  courseId: "",
} as unknown as StartSessionResult;

function expandStep(container: HTMLElement, step: number) {
  fireEvent.click(container.querySelector(`[data-step="${step}"] .step-head`) as HTMLElement);
}
function card(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-artifact-id="${id}"]`);
  if (!el) throw new Error(`artefact card ${id} not rendered`);
  return el as HTMLElement;
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ activeCourseId: "water-systems", annotations: [], session: FAKE_SESSION });
});
afterEach(() => {
  cleanup();
  useCbe.setState({ session: null });
});

describe("Canvas artefact values — shared Markdown pipeline", () => {
  // Scenario: Canvas artefact values render as Markdown, not as raw text
  it("renders Markdown structure instead of raw source markers", () => {
    // The exact shape the 2026-08-03 screenshot showed as literal text.
    const value = "- **Level:** BA\n- **Umfang:** Ein Semester (30 Wochen)\n- **Modus:** Blended";
    act(() => useCbe.getState().applyCanvasUpdate(1, undefined, "moduleframe", { value, state: "active" }));

    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 1);
    const value_el = card(container, "moduleframe").querySelector(".artifact-value") as HTMLElement;

    // Rendered through the shared component (`.md` wrapper), as a real list with bold.
    expect(value_el.querySelector(".md")).toBeTruthy();
    expect(value_el.querySelectorAll("li").length).toBe(3);
    expect(within(value_el).getByText("Level:").tagName).toBe("STRONG");
    // No literal Markdown markers survive.
    expect(value_el.textContent).not.toContain("**");
    expect(value_el.textContent).not.toContain("- ");
  });

  it("renders a table as a table and keeps its overflow inside the card", () => {
    const value = "| Outcome | Evidence |\n| --- | --- |\n| LO1 | Report |\n| LO2 | Prototype |";
    act(() => useCbe.getState().applyCanvasUpdate(3, undefined, "assessmentblueprint", { value, state: "active" }));

    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 3);
    const value_el = card(container, "assessmentblueprint").querySelector(".artifact-value") as HTMLElement;
    expect(value_el.querySelectorAll("table").length).toBe(1);
    expect(value_el.querySelectorAll("tbody tr").length).toBe(2);

    // jsdom applies no stylesheet — the containment is guarded on the rule itself:
    // the card scrolls its own wide content instead of widening the panel.
    const css = readFileSync(STYLES_CSS_PATH, "utf8");
    expect(css).toMatch(/\.artifact-value\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.artifact-value \.md table\s*\{[^}]*overflow-x:\s*auto/);
  });

  // Scenario: Math renders on a canvas artefact card too (change
  // `render-latex-math-in-markdown`). The point of the assertion is the SHARED stack:
  // math was wired into MarkdownView only, and the card gains it for free. A second
  // Markdown or math stack anywhere would show up as this test failing while the chat
  // tests in `markdown-math.test.tsx` still pass.
  it("renders math in an artefact value through the shared component", () => {
    const value = "Weighting $w_i = \\frac{p_i}{n}$ per outcome.";
    act(() => useCbe.getState().applyCanvasUpdate(3, undefined, "assessmentblueprint", { value, state: "active" }));

    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 3);
    const value_el = card(container, "assessmentblueprint").querySelector(".artifact-value") as HTMLElement;

    // Same `.md` wrapper the chat uses — one stack, not two.
    expect(value_el.querySelector(".md")).toBeTruthy();
    expect(value_el.querySelector(".katex")).toBeTruthy();
    expect(value_el.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(
      "w_i = \\frac{p_i}{n}"
    );

    // No literal delimiters survive in what the lecturer reads. KaTeX renders the
    // expression twice (MathML + an aria-hidden HTML branch); the visible half is the
    // one without the MathML annotation.
    const visible = value_el.cloneNode(true) as HTMLElement;
    for (const hidden of Array.from(visible.querySelectorAll(".katex-mathml"))) hidden.remove();
    expect(visible.textContent).not.toContain("$");
    expect(visible.textContent).toContain("per outcome.");
  });

  it("does not let model-authored raw HTML through the artefact card", () => {
    // Same hardening the chat view has: `skipHtml` in the shared component. A value
    // carrying markup renders as text, never as an element.
    const value = '<img src=x onerror="boom"> <b>bold?</b>';
    act(() => useCbe.getState().applyCanvasUpdate(2, undefined, "learningoutcomes", { value, state: "draft" }));

    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 2);
    const value_el = card(container, "learningoutcomes").querySelector(".artifact-value") as HTMLElement;
    expect(value_el.querySelector("img")).toBeNull();
    expect(value_el.querySelector("b")).toBeNull();
  });

  it("still shows the empty-state dash for an artefact without a value", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 5);
    const value_el = card(container, "stakeholderplan").querySelector(".artifact-value") as HTMLElement;
    expect(value_el.querySelector(".artifact-empty")).toBeTruthy();
    expect(value_el.querySelector(".md")).toBeNull();
  });
});

describe("Canvas seed — derived from the shared canonical slot table", () => {
  it("seeds exactly the canonical ids of every step group and journey element", () => {
    for (const step of STEP_ORDER) {
      const group = STEP_GROUPS.find((g) => g.step === step)!;
      if (step === 6) {
        // Step 6 seeds nothing at the group level; its four journey elements do.
        expect(group.items).toEqual([]);
        expect(group.journey?.map((el) => el.phase)).toEqual([...JOURNEY_PHASES]);
        for (const el of group.journey!) {
          expect(
            el.items.map((i) => i.id),
            `6/${el.phase}`
          ).toEqual([...(CANONICAL_SLOTS[`6/${el.phase}`] ?? [])]);
        }
        continue;
      }
      expect(
        group.items.map((i) => i.id),
        `step ${step}`
      ).toEqual([...(CANONICAL_SLOTS[String(step)] ?? [])]);
      expect(group.journey).toBeUndefined();
    }
  });

  it("seeds every artefact empty, open, and with a human label", () => {
    const all = STEP_GROUPS.flatMap((g) => [...g.items, ...(g.journey ?? []).flatMap((el) => el.items)]);
    expect(all.length).toBeGreaterThan(0);
    for (const it of all) {
      expect(it.value).toBe("");
      expect(it.state).toBe("open");
      expect(it.label.length).toBeGreaterThan(0);
      expect(it.label).not.toBe(it.id);
    }
  });

  // capability `desktop-app`, Requirement: Design-Flow Canvas — Scenario: Step 6 hosts the
  // four-element learning journey (rewritten by `harmonise-canvas-slots-with-the-ten-step-outputs`).
  // §4.6 gives step 6 ONE named output — the phase plan / module timeline — so every element
  // carries exactly one row holding its slice of it. The classic CBL phase artefacts
  // (`gq`, `ar`, `syn`, `sc`, `sd`, `ie`) are `methodology-001`'s LEARNER activities and are
  // no rows here.
  it("Step 6 hosts the four-element learning journey", () => {
    const group = STEP_GROUPS.find((g) => g.step === 6)!;
    const byPhase = Object.fromEntries((group.journey ?? []).map((el) => [el.phase, el]));

    expect(byPhase.engage.items.map((i) => i.id)).toEqual(["es"]);
    expect(byPhase.investigate.items.map((i) => i.id)).toEqual(["is"]);
    expect(byPhase.act.items.map((i) => i.id)).toEqual(["as"]);
    expect(byPhase.reflect.items.map((i) => i.id)).toEqual(["rs"]);
    expect(byPhase.engage.items.map((i) => i.label)).toEqual(["Engage Sequence"]);
    expect(byPhase.investigate.items.map((i) => i.label)).toEqual(["Investigate Sequence"]);
    expect(byPhase.act.items.map((i) => i.label)).toEqual(["Act Sequence"]);
    expect(byPhase.reflect.items.map((i) => i.label)).toEqual(["Reflect Sequence"]);
    // No journey element renders as an empty container, and none carries a second row.
    for (const el of group.journey!) expect(el.items.length, el.phase).toBe(1);

    // No retired learner-time label survives anywhere in the seed.
    const allLabels = STEP_GROUPS.flatMap((g) => [...g.items, ...(g.journey ?? []).flatMap((el) => el.items)]).map(
      (i) => i.label
    );
    for (const label of [
      "Guiding Questions",
      "Activities & Resources",
      "Analysis",
      "Synthesis",
      "Solution Concepts",
      "Solution Development",
      "Implementation & Evaluation",
    ]) {
      expect(allLabels, `retired label ${label} still seeded`).not.toContain(label);
    }
  });

  it("Ten-step groups visible — the step-6 rows render under their journey element", () => {
    const { container } = render(<ArtifactsPanel />);
    expandStep(container, 6);
    for (const id of ["es", "is", "as", "rs"]) {
      expect(card(container, id), `card ${id}`).toBeTruthy();
    }
  });
});
