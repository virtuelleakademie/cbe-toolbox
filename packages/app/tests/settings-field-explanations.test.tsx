/**
 * Tests for capability `desktop-app`, Requirement: Collected UX Polish —
 * Scenario: *A settings field explains itself only when its help control is
 * activated*.
 *
 * Born with `add-ux-polish-collected-fixes`, where the reveal was triggered by
 * hover AND keyboard focus. `split-llm-settings-into-standard-and-advanced`
 * re-pointed the trigger: the ONE reusable pattern is still `SettingsField`
 * (SettingsPanel.tsx), but its short English explanation is now reached through
 * the field's `?` help control and through nothing else — no hover, no focus,
 * and no standing hint line on the surface. The explanation element is still
 * always in the DOM and referenced by the control's aria-describedby, so it is
 * exposed as the field's accessible description independent of the reveal, and
 * Escape still dismisses a revealed one.
 *
 * The hover-and-focus trigger did not disappear from the app — it is the
 * composer context-usage ring's, whose own requirement prescribes it
 * (`context-usage-ring.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({
    providerStatus: {
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "test-model",
      hasKey: true,
      reasoning: true,
      reasoningEffort: "medium",
    },
  });
  // Every field under test lives in the Model group; the accordion opens on
  // Appearance, so open it (Requirement: Settings Panel (Phase 1 scaffold)).
  useCbe.getState().setSettingsOpenGroup("model");
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

/** The field row hosting a control (the hover/focus container of the pattern). */
function fieldRowOf(el: HTMLElement): HTMLElement {
  const row = el.closest(".set-field");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

/** Resolve the tooltip the control's aria-describedby points at. */
function explanationOf(el: HTMLElement): HTMLElement {
  const id = el.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const tooltip = document.getElementById(id!);
  expect(tooltip).not.toBeNull();
  expect(tooltip!.getAttribute("role")).toBe("tooltip");
  return tooltip!;
}

/** The Advanced disclosure's activating control (Requirement: Settings Panel
 * (Phase 1 scaffold)) — the calibration fields live behind it since the Model
 * group gained two levels. */
function expandAdvanced() {
  const header = screen.getByRole("button", { name: /^advanced$/i });
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
}

/** The `?` help control belonging to a named field — the ONLY trigger. Scoped to
 * the field row rather than the whole surface: a name-matched role query computes
 * an accessible name for every button on the page, and this helper runs a dozen
 * times per case. */
function helpControlFor(fieldLabel: string, row: HTMLElement): HTMLElement {
  return within(row).getByRole("button", { name: `What is ${fieldLabel}?` });
}

/** Every lecturer-facing LLM-connection control, resolved fresh per assertion,
 * across BOTH levels of the Model group: the caller expands Advanced first, since
 * three of the six live there now. The apiKey field is resolved by its accessible
 * name rather than by the `••••••••` placeholder of a password input — it is a
 * legible text input since the split. */
function llmConnectionControls(): Array<{ name: string; label: string; el: HTMLElement }> {
  expandAdvanced();
  return [
    { name: "baseURL", label: "Base URL", el: screen.getByPlaceholderText("https://your-llm-endpoint/v1") },
    { name: "modelId", label: "Model ID", el: screen.getByPlaceholderText("model-id") },
    { name: "apiKey", label: "API key", el: screen.getByLabelText("API key") },
    { name: "contextLength", label: "Context length", el: screen.getByPlaceholderText("e.g. 65536") },
    { name: "reasoning", label: "Reasoning", el: screen.getByLabelText("Enable reasoning") },
    { name: "reasoningEffort", label: "Reasoning effort", el: screen.getByLabelText("Reasoning effort") },
  ];
}

describe("Settings fields explain themselves only when their help control is activated", () => {
  it("every LLM-connection field reveals its English explanation when its ? is activated, and only then", () => {
    render(<SettingsPanel />);
    for (const { name, label, el } of llmConnectionControls()) {
      const row = fieldRowOf(el);
      const tooltip = explanationOf(el);
      // Nothing stands revealed…
      expect(tooltip.getAttribute("data-open"), name).toBe("false");
      // …and neither hovering the field row nor focusing the control is a
      // trigger any more: the explanation is off the surface until asked for.
      fireEvent.mouseEnter(row);
      expect(tooltip.getAttribute("data-open"), `${name} on hover`).toBe("false");
      fireEvent.mouseLeave(row);
      fireEvent.focus(el);
      expect(tooltip.getAttribute("data-open"), `${name} on focus`).toBe("false");
      fireEvent.blur(el);
      // Activating the field's ? reveals it; activating it again puts it away.
      fireEvent.click(helpControlFor(label, row));
      expect(tooltip.getAttribute("data-open"), `${name} after activating ?`).toBe("true");
      fireEvent.click(helpControlFor(label, row));
      expect(tooltip.getAttribute("data-open"), `${name} after a second activation`).toBe("false");
      // The explanation is short English prose, not an empty shell.
      expect(tooltip.textContent!.trim().length, name).toBeGreaterThan(20);
    }
    // Six fields x six interactions each re-render the whole settings surface, so
    // this case runs well past vitest's 5 s default on a loaded machine under
    // full-suite parallelism. The timeout is raised rather than the coverage cut.
  }, 20_000);

  it("the revealed explanation stays until dismissed, and Escape dismisses it without moving pointer or focus", () => {
    render(<SettingsPanel />);
    expandAdvanced();
    const input = screen.getByPlaceholderText("e.g. 65536");
    const row = fieldRowOf(input);
    const tooltip = explanationOf(input);

    fireEvent.click(helpControlFor("Context length", row));
    expect(tooltip.getAttribute("data-open")).toBe("true");
    // Persistent: typing into the field does not put it away.
    input.focus();
    fireEvent.change(input, { target: { value: "65536" } });
    expect(tooltip.getAttribute("data-open")).toBe("true");
    // Dismissable without moving pointer or focus.
    fireEvent.keyDown(row, { key: "Escape" });
    expect(tooltip.getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(input);
    // And a later activation reveals it again — the dismissal is not permanent.
    fireEvent.click(helpControlFor("Context length", row));
    expect(tooltip.getAttribute("data-open")).toBe("true");
  });

  it("no field carries a standing hint or explanation line on either level", () => {
    const { container } = render(<SettingsPanel />);
    expandAdvanced();
    // The `<small>` hint under a field label is gone from the whole group; the
    // group's remaining prose is state and obligation, never explanation.
    expect(container.querySelectorAll(".llm-conn .rk small").length).toBe(0);
    for (const { name, el } of llmConnectionControls()) {
      expect(explanationOf(el).getAttribute("data-open"), name).toBe("false");
    }
  });

  it("the explanation is exposed as the field's accessible description (always in the DOM)", () => {
    render(<SettingsPanel />);
    for (const { name, el } of llmConnectionControls()) {
      const tooltip = explanationOf(el);
      // Never activated — yet the description element exists, carries the text,
      // and the control references it: assistive technology reads it
      // regardless of the visual reveal state.
      expect(tooltip.getAttribute("data-open"), name).toBe("false");
      expect(tooltip.isConnected, name).toBe(true);
      expect(el.getAttribute("aria-describedby"), name).toBe(tooltip.id);
    }
  });
});
