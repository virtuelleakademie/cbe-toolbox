/**
 * The interface-language control, and what a switch actually does to the chrome
 * (capability `desktop-app`, Requirements: *Interface Language Control in
 * Settings*; *Every String the App Renders Is English*).
 *
 * The control is rendered from the REAL Settings panel rather than in isolation,
 * because the claim under test is that the Appearance group offers it and that
 * choosing a language re-renders every surface — not that a picker component
 * works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { useCbe } from "../src/renderer/state/store.js";
import { __resetActiveLanguage, activeLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ settingsOpenGroup: "appearance" });
});
afterEach(() => {
  cleanup();
  __resetActiveLanguage();
});

describe("the interface-language control in the Appearance group", () => {
  // Scenario: The control offers exactly the shipped catalogues.
  it("offers exactly the shipped catalogues, each by its own endonym", () => {
    render(<SettingsPanel />);
    const group = screen.getByRole("group", { name: en.settingsInterfaceLanguageGroupLabel });
    const options = [...group.querySelectorAll("button")].map((b) => b.textContent);
    expect(options).toEqual(
      Object.values(LANGUAGES)
        .map((l) => l.endonym)
        .sort()
    );
    expect(options).toContain("Deutsch");
    expect(options).toContain("English");
  });

  // Scenario: The option names are readable from any language — an endonym is the
  // language's own name and does not move with the active one.
  it("keeps the option names identical whichever language is active", () => {
    render(<SettingsPanel />);
    const named = () =>
      [...screen.getAllByRole("button")].map((b) => b.textContent).filter((t) => t === "Deutsch" || t === "English");
    const inEnglish = named();
    cleanup();
    setActiveLanguage("de");
    render(<SettingsPanel />);
    expect(named()).toEqual(inEnglish);
  });

  it("shows the language actually in force as the pressed option", () => {
    render(<SettingsPanel />);
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Deutsch" }).getAttribute("aria-pressed")).toBe("false");
  });

  // Scenario: Selecting a language applies immediately and persists. The PERSISTING
  // half is the main process's (`interface-language.test.ts`); what the renderer
  // owns is that the choice is sent there and that the chrome follows the answer.
  it("sends the selection to the main process and re-renders the chrome on its answer", async () => {
    const setInterfaceLanguage = vi
      .fn()
      .mockResolvedValue({ ok: true, language: "de" } as { ok: boolean; language: string });
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<SettingsPanel />);
    // The label itself is chrome and is English before the switch.
    expect(screen.getByText(en.settingsInterfaceLanguageLabel)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(setInterfaceLanguage).toHaveBeenCalledWith("de");

    await waitFor(() => expect(activeLanguage()).toBe("de"));
    // …and the surface re-rendered without a remount: the group label, the other
    // rows' labels and the pressed state all moved together.
    await waitFor(() => expect(screen.getByText(de.settingsInterfaceLanguageLabel)).toBeTruthy());
    expect(screen.getByText(de.settingsThemeLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deutsch" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves the language untouched when the main process refuses the code", async () => {
    const setInterfaceLanguage = vi.fn().mockResolvedValue({ ok: false, language: "en" });
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));
    await waitFor(() => expect(setInterfaceLanguage).toHaveBeenCalled());
    expect(activeLanguage()).toBe("en");
    expect(screen.getByText(en.settingsInterfaceLanguageLabel)).toBeTruthy();
  });

  it("is keyboard-operable and carries an accessible name like every other Settings control", () => {
    render(<SettingsPanel />);
    const group = screen.getByRole("group", { name: en.settingsInterfaceLanguageGroupLabel });
    for (const option of group.querySelectorAll("button")) {
      // A plain <button> is in the tab order and activates on Enter/Space by
      // construction; what has to be asserted is that none of them opts out.
      expect(option.getAttribute("tabindex")).not.toBe("-1");
      expect(option.hasAttribute("disabled")).toBe(false);
      expect(option.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("a language change reaches every surface, not only the one that set it", () => {
  it("re-renders a surface that never mounted the control", async () => {
    useCbe.setState({ configured: true });
    render(<AppHeader configured />);
    expect(screen.getByRole("button", { name: en.headerOpenSettings })).toBeTruthy();

    setActiveLanguage("de");
    await waitFor(() => expect(screen.getByRole("button", { name: de.headerOpenSettings })).toBeTruthy());
    expect(screen.queryByRole("button", { name: en.headerOpenSettings })).toBeNull();
  });
});
