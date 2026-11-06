/**
 * Exactly ONE free-text option in the picker, labelled in the lecturer's own
 * language (capability `desktop-app`, Requirement: Collected UX-3 Fixes
 * (Wave 1), scenario *Exactly one free-text option, in the lecturer's
 * language*).
 *
 * Two halves, because the defect spanned both: the renderer appended a
 * hardcoded English option unconditionally, and the model shipped its own
 * German one — so the lecturer saw two adjacent escape hatches. The main
 * process now collapses the model's option into `otherLabel` on the way to the
 * renderer (that is the boundary the Picker is fed from), and the renderer
 * renders that label instead of a hardcoded string.
 */
import { describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { Picker, type PickerSpec } from "../src/renderer/components/Picker.js";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/cbe-picker-surface-test"),
    getAppPath: vi.fn(() => "/tmp/cbe-picker-surface-test"),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

// Static import (not `await import(...)` inside the test): ipc.ts is a large
// module and resolving it inside a 5s test body flakes under a loaded parallel
// suite.
const { pickerArgsForRenderer } = await import("../src/main/ipc.js");

function spec(overrides: Partial<PickerSpec> = {}): PickerSpec {
  return {
    question: "Wie weit soll das gehen?",
    options: [
      { id: "a", label: "Ein erster Schritt" },
      { id: "b", label: "Eine substanzielle Überarbeitung" },
    ],
    ...overrides,
  };
}

describe("Picker — one free-text surface in the lecturer's language", () => {
  it("labels the free-text option with the skill-supplied label", () => {
    render(<Picker spec={spec({ otherLabel: "Andere — ich beschreibe es" })} onSubmit={() => {}} />);
    const pills = screen.getAllByRole("radio");
    expect(pills).toHaveLength(3);
    expect(pills[2]!.textContent).toContain("Andere — ich beschreibe es");
    // …and only ONE free-text surface exists.
    expect(pills.filter((p) => /Andere|Other/i.test(p.textContent ?? "")).length).toBe(1);
  });

  it("falls back to the English chrome label when the skill supplies none", () => {
    render(<Picker spec={spec()} onSubmit={() => {}} />);
    const pills = screen.getAllByRole("radio");
    expect(pills[2]!.textContent).toContain(en.pickerOtherLabelFallback);
  });

  it("gives the free-text input the same label as its accessible name — no hardcoded placeholder", () => {
    render(<Picker spec={spec({ otherLabel: "Andere — ich beschreibe es" })} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Andere/i }));
    const input = screen.getByRole("textbox", { name: "Andere — ich beschreibe es" });
    expect(input.getAttribute("placeholder")).toBeNull();
  });
});

describe("Main process — picker args reaching the renderer", () => {
  it("collapses a model-supplied free-text option into otherLabel", () => {
    const out = pickerArgsForRenderer("cbe_picker", {
      question: "Wie weit soll das gehen?",
      options: [
        { id: "a", label: "Ein erster Schritt" },
        { id: "b", label: "Eine substanzielle Überarbeitung" },
        { id: "andere", label: "Andere — ich beschreibe es" },
      ],
    }) as PickerSpec;
    expect(out.options.map((o) => o.id)).toEqual(["a", "b"]);
    expect(out.otherLabel).toBe("Andere — ich beschreibe es");

    render(<Picker spec={out} onSubmit={() => {}} />);
    const pills = screen.getAllByRole("radio");
    expect(pills).toHaveLength(3);
    expect(pills.filter((p) => /Andere|Other/i.test(p.textContent ?? "")).length).toBe(1);
  });

  it("passes other tools' args through untouched", () => {
    const args = { path: "corpus/index.json" };
    expect(pickerArgsForRenderer("read", args)).toBe(args);
  });

  it("leaves a structurally malformed picker payload to the renderer's own check", () => {
    const args = { question: "Q" };
    expect(pickerArgsForRenderer("cbe_picker", args)).toBe(args);
  });
});
