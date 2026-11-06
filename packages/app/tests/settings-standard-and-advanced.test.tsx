/**
 * Tests for change `split-llm-settings-into-standard-and-advanced` (capability
 * `desktop-app`) — one per NEW Scenario the change's delta introduces.
 *
 * Requirement: Settings Panel (Phase 1 scaffold)
 *   - The Model group opens on four connection fields and nothing else to configure
 *   - Advanced holds the calibration controls and the erasure control
 *   - The API key field shows what is typed and never the stored key
 *   - Advanced opens with a pending edit it holds
 *   - Moving a control between the levels changes nothing about what a save does
 *
 * Requirement: Collected UX Polish (Settings Explanations, …)
 *   - A settings field explains itself only when its help control is activated
 *   - The help control is reachable and operable from the keyboard
 *   - Both levels of the Model group use the same help mechanism
 *   - The explanation is the field's accessible description whether or not it
 *     was revealed
 *
 * The pre-existing scenarios these requirements also carry are covered by the
 * suites they always lived in (`settings-panel.test.tsx`,
 * `settings-credentials.test.tsx`, `settings-scroll-structure.test.tsx`); this
 * file does not re-test them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";

function seed(overrides: Partial<{ hasKey: boolean; contextLength: number }> = {}) {
  useCbe.setState({
    providerStatus: {
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "Qwen3.6-35B-A3B-4bit",
      hasKey: true,
      ...overrides,
    },
  });
  useCbe.getState().setSettingsOpenGroup("model");
}

beforeEach(() => {
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

/** The Advanced disclosure's activating control. */
function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: /^advanced$/i });
}

/** Expand Advanced (a no-op if it is already open). */
function expandAdvanced() {
  const header = advancedHeader();
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
}

/** The `?` control belonging to a named field. */
function helpControlFor(fieldLabel: string): HTMLElement {
  return screen.getByRole("button", { name: `What is ${fieldLabel}?` });
}

/**
 * Testing-library's `ByPlaceholderText` / `ByLabelText` queries walk the DOM and
 * ignore `hidden`; only the `ByRole` queries consult the accessibility tree. So
 * "out of reach" is asserted the way the overlay's own focus trap computes it —
 * an element under a `[hidden]` ancestor is out of the tab order and out of the
 * accessibility tree — and with a role query wherever the control has an
 * accessible name to query by.
 */
function outOfReach(el: Element | null): boolean {
  return el === null || el.closest("[hidden]") !== null;
}

/** Resolve the tooltip an element's aria-describedby points at. */
function explanationOf(el: HTMLElement): HTMLElement {
  const id = el.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const tooltip = document.getElementById(id!);
  expect(tooltip).not.toBeNull();
  expect(tooltip!.getAttribute("role")).toBe("tooltip");
  return tooltip!;
}

describe("The Model group opens on four connection fields and nothing else to configure", () => {
  it("offers exactly the four connection fields in order, with Save beside Test connection", () => {
    seed();
    const { container } = render(<SettingsPanel />);

    // Advanced is not expanded on this showing.
    expect(advancedHeader().getAttribute("aria-expanded")).toBe("false");

    // The four lecturer-facing fields of the default view, in order.
    const labels = Array.from(container.querySelectorAll(".llm-conn > .set-field > .rk")).map((n) =>
      n.textContent?.trim()
    );
    expect(labels).toEqual(["Base URL", "Model ID", "API key"]);
    // …the fourth is the test-connection affordance, and Save sits beside it as
    // their commit action rather than as a fifth thing to configure.
    const actions = container.querySelector(".llm-conn > .set-actions")!;
    expect(Array.from(actions.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Save",
      "Test connection",
    ]);
  });

  it("keeps the calibration and erasure controls out of the accessibility tree while Advanced is collapsed", () => {
    seed();
    render(<SettingsPanel />);
    // `hidden` on the collapsed body: not merely invisible, but out of the
    // accessibility tree and the tab order.
    expect(outOfReach(screen.queryByPlaceholderText("e.g. 65536"))).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Enable reasoning" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Reasoning effort" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete api key/i })).toBeNull();
  });
});

describe("Advanced holds the calibration controls and the erasure control", () => {
  it("expanding reveals all four, flips aria-expanded, and opens or closes no accordion group", () => {
    seed();
    const { container } = render(<SettingsPanel />);

    const groupHeaders = () =>
      Array.from(container.querySelectorAll(".settings-panel > .set-group > .set-acc-header")).map((h) => [
        h.querySelector(".set-label")!.textContent,
        h.getAttribute("aria-expanded"),
      ]);
    const before = groupHeaders();

    expandAdvanced();

    expect(advancedHeader().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByPlaceholderText("e.g. 65536")).toBeTruthy();
    expect(screen.getByLabelText("Enable reasoning")).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete api key/i })).toBeTruthy();
    // The effort selector offers exactly low / medium / high (it renders once
    // reasoning is on — unchanged semantics, the control merely moved).
    fireEvent.click(screen.getByLabelText("Enable reasoning"));
    const effort = screen.getByLabelText("Reasoning effort") as HTMLSelectElement;
    expect(Array.from(effort.options).map((o) => o.value)).toEqual(["low", "medium", "high"]);

    // Advanced is a disclosure INSIDE the group, never a fifth accordion group.
    expect(groupHeaders()).toEqual(before);
    expect(useCbe.getState().settingsOpenGroup).toBe("model");

    // Collapsing again puts them back out of reach.
    fireEvent.click(advancedHeader());
    expect(advancedHeader().getAttribute("aria-expanded")).toBe("false");
    expect(outOfReach(screen.queryByPlaceholderText("e.g. 65536"))).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Enable reasoning" })).toBeNull();
  });
});

describe("The API key field shows what is typed and never the stored key", () => {
  it("is a legible input, empty on mount although a key is stored, and shows typed characters", () => {
    seed({ hasKey: true });
    render(<SettingsPanel />);
    const input = screen.getByLabelText("API key") as HTMLInputElement;

    // Legible rather than masked…
    expect(input.type).not.toBe("password");
    expect(input.type).toBe("text");
    // …and empty although a key is persisted: the stored credential never
    // reaches the renderer, so nothing is revealed by making the field legible.
    expect(input.value).toBe("");
    expect(screen.getByText("An API key is set")).toBeTruthy();
    expect(document.body.textContent).not.toContain("••••••••");

    fireEvent.change(input, { target: { value: "sk-typed-in-this-session" } });
    expect(input.value).toBe("sk-typed-in-this-session");
    expect(input.type).toBe("text");
  });
});

describe("Advanced opens with a pending edit it holds", () => {
  it("a dirty context length opens Advanced on the branch-2 showing; a dirty base URL leaves it closed", () => {
    useCbe.setState({
      providerStatus: { baseURL: "http://127.0.0.1:8000/v1", modelId: "m", hasKey: true, contextLength: 65536 },
    });
    useCbe.getState().showSettingsSurface("settings");
    useCbe.getState().setSettingsOpenGroup("model");
    render(<ProfileSettingsOverlay />);

    // Edit an ADVANCED-hosted control, then dismiss the overlay.
    expandAdvanced();
    fireEvent.change(screen.getByPlaceholderText("e.g. 65536"), { target: { value: "32768" } });
    act(() => useCbe.getState().closeSettingsSurface());
    expect(useCbe.getState().settingsDirtyGroup).toBe("model");

    // Branch 2: the showing opens on the group holding the edit — and Advanced
    // opens with it, or the edit would sit behind a closed disclosure one level
    // down, which is the very loss branch 2 exists to prevent.
    act(() => useCbe.getState().showSettingsSurface("settings"));
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
    expect(advancedHeader().getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByPlaceholderText("e.g. 65536") as HTMLInputElement).value).toBe("32768");

    // The other direction: a pending edit in a DEFAULT-VIEW field must not pop
    // Advanced open for no reason.
    fireEvent.change(screen.getByPlaceholderText("e.g. 65536"), { target: { value: "65536" } });
    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "http://127.0.0.1:9000/v1" },
    });
    act(() => useCbe.getState().closeSettingsSurface());
    act(() => useCbe.getState().showSettingsSurface("settings"));
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
    expect(advancedHeader().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Moving a control between the levels changes nothing about what a save does", () => {
  /**
   * The boundary of the whole change, asserted as the four DTO shapes exactly as
   * they were before the split: apiKey omitted on a blank same-endpoint save,
   * contextLength carried, reasoning omitted while untouched, `reasoning: false`
   * on an explicit off. A diff that changes an expectation here is a diff that
   * broke the boundary.
   */
  async function saveAndRead(spy: ReturnType<typeof vi.fn>) {
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    return spy.mock.calls[0][0];
  }

  it("a same-endpoint save with a blank API key still omits apiKey from the DTO", async () => {
    seed();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: spy });
    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "edited-model" } });
    const dto = await saveAndRead(spy);
    expect("apiKey" in dto).toBe(false);
    expect(dto.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(dto.modelId).toBe("edited-model");
  });

  it("a positive context length typed in Advanced still reaches the DTO unchanged", async () => {
    seed();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: spy });
    render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.change(screen.getByPlaceholderText("e.g. 65536"), { target: { value: "65536" } });
    const dto = await saveAndRead(spy);
    expect(dto.contextLength).toBe(65536);
  });

  it("an untouched reasoning control still omits reasoning from the DTO (preserve / metadata default)", async () => {
    seed();
    const spy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: spy });
    render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "edited-model" } });
    const dto = await saveAndRead(spy);
    expect("reasoning" in dto).toBe(false);
    expect("reasoningEffort" in dto).toBe(false);
  });

  it("an explicitly disabled reasoning control still sends reasoning:false", async () => {
    useCbe.setState({
      providerStatus: {
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "m",
        hasKey: true,
        reasoning: true,
        reasoningEffort: "high",
      },
    });
    useCbe.getState().setSettingsOpenGroup("model");
    const spy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: spy });
    render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.click(screen.getByLabelText("Enable reasoning"));
    const dto = await saveAndRead(spy);
    expect(dto.reasoning).toBe(false);
    expect("reasoningEffort" in dto).toBe(false);
  });
});

describe("A settings field explains itself only when its help control is activated", () => {
  it("hovering and focusing reveal nothing; the ? reveals, and a second press or Escape dismisses", () => {
    seed();
    const { container } = render(<SettingsPanel />);
    const input = screen.getByPlaceholderText("https://your-llm-endpoint/v1");
    const row = input.closest(".set-field") as HTMLElement;
    const tooltip = explanationOf(input);

    expect(tooltip.getAttribute("data-open")).toBe("false");
    // Neither hover nor focus is a trigger any more.
    fireEvent.mouseEnter(row);
    expect(tooltip.getAttribute("data-open")).toBe("false");
    fireEvent.focus(input);
    expect(tooltip.getAttribute("data-open")).toBe("false");

    // Activating the ? reveals it…
    fireEvent.click(helpControlFor("Base URL"));
    expect(tooltip.getAttribute("data-open")).toBe("true");
    expect(tooltip.textContent!.trim().length).toBeGreaterThan(20);
    // …activating it again dismisses it…
    fireEvent.click(helpControlFor("Base URL"));
    expect(tooltip.getAttribute("data-open")).toBe("false");
    // …and so does Escape, without moving pointer or focus.
    fireEvent.click(helpControlFor("Base URL"));
    expect(tooltip.getAttribute("data-open")).toBe("true");
    fireEvent.keyDown(row, { key: "Escape" });
    expect(tooltip.getAttribute("data-open")).toBe("false");

    // No standing hint line survives anywhere in the group.
    expect(container.querySelectorAll(".llm-conn .rk small").length).toBe(0);
  });
});

describe("The help control is reachable and operable from the keyboard", () => {
  it("each ? is a focusable button naming its field, exposing its reveal state, and activated from the keyboard", () => {
    seed();
    render(<SettingsPanel />);
    for (const label of ["Base URL", "Model ID", "API key"]) {
      const control = helpControlFor(label);
      // A real <button>: in the ordinary tab order, no tabindex trickery, and
      // activated by Enter/Space by the platform rather than by a key handler.
      expect(control.tagName).toBe("BUTTON");
      expect(control.getAttribute("type")).toBe("button");
      expect(control.hasAttribute("disabled")).toBe(false);
      expect(control.getAttribute("tabindex")).toBeNull();
      expect(control.getAttribute("aria-expanded")).toBe("false");

      control.focus();
      expect(document.activeElement).toBe(control);
      // Enter/Space on a focused button dispatch a click in the browser; jsdom
      // does not, so the click is the faithful stand-in for that activation.
      fireEvent.click(control);
      expect(control.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(control);
      fireEvent.click(control);
      expect(control.getAttribute("aria-expanded")).toBe("false");
    }
  });
});

describe("Both levels of the Model group use the same help mechanism", () => {
  it("every input on both levels carries a ? and no field carries a standing explanation line", () => {
    seed();
    const { container } = render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.click(screen.getByLabelText("Enable reasoning")); // reveal the effort selector too

    const fields = Array.from(container.querySelectorAll<HTMLElement>(".llm-conn .set-field"));
    const labels = fields.map((f) => f.querySelector(".rk")!.textContent!.trim());
    expect(labels).toEqual(["Base URL", "Model ID", "API key", "Reasoning", "Reasoning effort", "Context length"]);

    for (const field of fields) {
      const label = field.querySelector(".rk")!.textContent!.trim();
      // One help control per field, in both levels, with the same behaviour…
      const help = within(field).getByRole("button", { name: `What is ${label}?` });
      const tooltip = field.querySelector('[role="tooltip"]') as HTMLElement;
      expect(tooltip, label).not.toBeNull();
      expect(tooltip.getAttribute("data-open"), label).toBe("false");
      fireEvent.click(help);
      expect(tooltip.getAttribute("data-open"), label).toBe("true");
      fireEvent.click(help);
      // …and no standing hint or explanation line on either level.
      expect(field.querySelectorAll(".rk small").length, label).toBe(0);
    }
  });
});

describe("The explanation is the field's accessible description whether or not it was revealed", () => {
  it("aria-describedby resolves to the tooltip with the ? never activated", () => {
    seed();
    render(<SettingsPanel />);
    const controls = [
      screen.getByPlaceholderText("https://your-llm-endpoint/v1"),
      screen.getByPlaceholderText("model-id"),
      screen.getByLabelText("API key"),
    ];
    expandAdvanced();
    controls.push(screen.getByPlaceholderText("e.g. 65536"), screen.getByLabelText("Enable reasoning"));

    for (const el of controls) {
      const tooltip = explanationOf(el);
      expect(tooltip.getAttribute("data-open")).toBe("false");
      expect(tooltip.isConnected).toBe(true);
      expect(el.getAttribute("aria-describedby")).toBe(tooltip.id);
      expect(tooltip.textContent!.trim().length).toBeGreaterThan(20);
    }
  });
});

// The reveal is per showing, exactly as the Advanced disclosure is (Requirement:
// Collected UX Polish — the explanation is revealed only when the field's help
// control is ACTIVATED). The overlay stays mounted from its first open, so
// without an explicit reset a `?` left revealed would still be standing on the
// next showing — help nobody asked for there.
describe("An explanation left revealed does not survive into the next showing of the settings surface", () => {
  it("resets the reveal on both levels when the surface is shown anew", () => {
    seed({ contextLength: 65536 });
    act(() => useCbe.getState().showSettingsSurface("settings"));
    act(() => useCbe.getState().setSettingsOpenGroup("model"));
    render(<ProfileSettingsOverlay />);

    // Reveal one explanation in the default view and one inside Advanced.
    expandAdvanced();
    fireEvent.click(helpControlFor("Base URL"));
    fireEvent.click(helpControlFor("Context length"));
    expect(document.getElementById("set-explain-baseurl")!.getAttribute("data-open")).toBe("true");
    expect(document.getElementById("set-explain-contextlength")!.getAttribute("data-open")).toBe("true");

    // Dismiss and open the surface again — nothing was edited, so this is the
    // ordinary showing, not the branch-2 one.
    act(() => useCbe.getState().closeSettingsSurface());
    expect(document.getElementById("set-explain-baseurl")!.getAttribute("data-open")).toBe("true");
    act(() => useCbe.getState().showSettingsSurface("settings"));

    expect(document.getElementById("set-explain-baseurl")!.getAttribute("data-open")).toBe("false");
    expect(document.getElementById("set-explain-contextlength")!.getAttribute("data-open")).toBe("false");

    // …and the controls agree: reopening the group finds every `?` collapsed,
    // and a press still reveals as before — the reset is a reset, not a lock.
    act(() => useCbe.getState().setSettingsOpenGroup("model"));
    expect(helpControlFor("Base URL").getAttribute("aria-expanded")).toBe("false");
    expandAdvanced();
    expect(helpControlFor("Context length").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(helpControlFor("Base URL"));
    expect(document.getElementById("set-explain-baseurl")!.getAttribute("data-open")).toBe("true");
  });
});
