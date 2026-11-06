/**
 * Tests for the Picker generative-UI component.
 *
 * Covers spec scenarios in `specs/desktop-app/spec.md`, *Generative UI — Picker
 * (single and multi-select)*:
 *   - Single-select renders pills, auto-submits on pick, freezes on ANSWERED
 *   - Multi-select allows multiple active pills, requires explicit submit
 *   - "Other" reveals a free-text input and round-trips the custom answer
 *   - Shift+Tab cycles backwards through pills
 *   - Picker freezes after commit (no further changes)
 *
 * The component is tested PURE — without going through the chat panel or any
 * skill-emission pipeline. The tool-result emission wiring is a separate task
 * (4.3); here the contract is "Picker is given a spec + an onSubmit callback
 * and behaves correctly".
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Picker, type PickerSpec } from "../src/renderer/components/Picker.js";

function makeSpec(overrides: Partial<PickerSpec> = {}): PickerSpec {
  return {
    question: "Was soll der Prototyp abdecken?",
    options: [
      { id: "hero", label: "Ein Hero-Screen" },
      { id: "core", label: "Kern-Flow" },
      { id: "broad", label: "Breiter Durchstich" },
    ],
    ...overrides,
  };
}

describe("Picker — single-select", () => {
  it("renders the question and one pill per option, plus an Other pill by default", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    // Three configured options + the app-provided free-text option
    const pills = screen.getAllByRole("radio");
    expect(pills).toHaveLength(4);
    expect(pills[0]!.textContent).toContain("Ein Hero-Screen");
    expect(pills[3]!.textContent).toContain("Other — I'll describe it");
  });

  it("auto-submits the moment a non-Other pill is clicked", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: /Kern-Flow/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ["core"] });
  });

  it("freezes into the ANSWERED state after auto-submit — pills lose selectability", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Picker spec={makeSpec()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: /Kern-Flow/i }));

    // ANSWERED badge appears
    expect(screen.getByLabelText("answered")).toBeTruthy();
    // Wrapper carries the answered class
    expect(container.querySelector(".picker")?.className).toContain("picker-answered");
    // Clicking another pill does NOT trigger a second submit
    fireEvent.click(screen.getByRole("radio", { name: /Breiter Durchstich/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("hides the Other option when otherEnabled is false", () => {
    render(<Picker spec={makeSpec({ otherEnabled: false })} onSubmit={() => {}} />);
    expect(screen.queryByRole("radio", { name: /Other/i })).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});

describe("Picker — multi-select", () => {
  it("allows multiple pills to be active and requires explicit Submit", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec({ multiSelect: true })} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ein Hero-Screen/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Breiter Durchstich/i }));
    // No auto-submit
    expect(onSubmit).not.toHaveBeenCalled();
    // Both pills look selected
    expect(
      (screen.getByRole("checkbox", { name: /Ein Hero-Screen/i }) as HTMLButtonElement).getAttribute("aria-checked")
    ).toBe("true");
    // Click Submit
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ["hero", "broad"] });
  });

  it("submit is disabled with zero selections", () => {
    render(<Picker spec={makeSpec({ multiSelect: true })} onSubmit={() => {}} />);
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("toggling a pill twice deselects it", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec({ multiSelect: true })} onSubmit={onSubmit} />);
    const pill = screen.getByRole("checkbox", { name: /Ein Hero-Screen/i });
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Picker — Other (free-text)", () => {
  it("reveals an input when Other is selected (single-select)", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Other/i }));
    const input = screen.getByRole("textbox", { name: /describe it/i });
    expect(input).toBeTruthy();
  });

  it("does NOT auto-submit on selecting Other — waits for text + Enter or Submit", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: /Other/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the otherText with the selection on Enter in the input", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: /Other/i }));
    const input = screen.getByRole("textbox", { name: /describe it/i });
    fireEvent.change(input, { target: { value: "Ich beschreibe es so." } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith({
      selectedIds: [],
      otherText: "Ich beschreibe es so.",
    });
  });

  it("multi-select with Other + other options round-trips both", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec({ multiSelect: true })} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ein Hero-Screen/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Other/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /describe it/i }), {
      target: { value: "Custom answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith({
      selectedIds: ["hero"],
      otherText: "Custom answer",
    });
  });

  it("after committing with Other, the input is replaced by a static answer line", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Other/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /describe it/i }), {
      target: { value: "Ich beschreibe es so." },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /describe it/i }), { key: "Enter" });
    // Input is gone; static answer line is shown
    expect(screen.queryByRole("textbox", { name: /describe it/i })).toBeNull();
    expect(screen.getByText("Ich beschreibe es so.")).toBeTruthy();
  });
});

describe("Picker — keyboard navigation", () => {
  it("Tab moves focus forward through pills with wrap at the end", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    const pills = screen.getAllByRole("radio");
    pills[0]!.focus();
    fireEvent.keyDown(pills[0]!, { key: "Tab" });
    expect(document.activeElement).toBe(pills[1]);
    fireEvent.keyDown(pills[1]!, { key: "Tab" });
    expect(document.activeElement).toBe(pills[2]);
    fireEvent.keyDown(pills[2]!, { key: "Tab" });
    expect(document.activeElement).toBe(pills[3]); // Other pill
    fireEvent.keyDown(pills[3]!, { key: "Tab" });
    expect(document.activeElement).toBe(pills[0]); // wrap
  });

  it("Shift+Tab moves focus backwards through pills with wrap at the start", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    const pills = screen.getAllByRole("radio");
    pills[0]!.focus();
    fireEvent.keyDown(pills[0]!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(pills[3]); // wrap to last
    fireEvent.keyDown(pills[3]!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(pills[2]);
  });

  it("Space toggles the focused pill", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec()} onSubmit={onSubmit} />);
    const pill = screen.getByRole("radio", { name: /Kern-Flow/i });
    pill.focus();
    fireEvent.keyDown(pill, { key: " " });
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ["core"] });
  });

  it("Enter on a pill toggles selection (mirror of Space)", () => {
    const onSubmit = vi.fn();
    render(<Picker spec={makeSpec({ multiSelect: true })} onSubmit={onSubmit} />);
    const pill = screen.getByRole("checkbox", { name: /Kern-Flow/i });
    pill.focus();
    fireEvent.keyDown(pill, { key: "Enter" });
    expect(pill.getAttribute("aria-checked")).toBe("true");
  });

  it("Escape blurs the focused pill", () => {
    render(<Picker spec={makeSpec()} onSubmit={() => {}} />);
    const pill = screen.getByRole("radio", { name: /Kern-Flow/i });
    pill.focus();
    expect(document.activeElement).toBe(pill);
    fireEvent.keyDown(pill, { key: "Escape" });
    expect(document.activeElement).not.toBe(pill);
  });
});

describe("Picker — required marker + question rendering", () => {
  it("renders a required asterisk when spec.required is set", () => {
    render(<Picker spec={makeSpec({ required: true })} onSubmit={() => {}} />);
    expect(screen.getByLabelText("required")).toBeTruthy();
  });

  it("renders the question through MarkdownView so it supports markdown", () => {
    const { container } = render(
      <Picker spec={makeSpec({ question: "## Heading\n\nWith a paragraph." })} onSubmit={() => {}} />
    );
    expect(container.querySelector("h2")?.textContent).toBe("Heading");
  });
});
