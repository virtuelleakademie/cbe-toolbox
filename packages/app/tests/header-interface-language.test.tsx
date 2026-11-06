/**
 * Interface Language Dropdown in the App Header — one real-renderer test group
 * for every interaction class in the requirement. Language choices always come
 * from the shipped registry; no test-owned production list is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { __resetActiveLanguage, activeLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { LANGUAGES, interfaceLanguageOptions } from "../src/shared/i18n/index.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { useCbe } from "../src/renderer/state/store.js";

const setter = () => vi.fn().mockImplementation(async (language: string) => ({ ok: true, language }));
const trigger = () => document.querySelector(".header-language-trigger") as HTMLButtonElement;
const listbox = () => screen.queryByRole("listbox");
const options = () => screen.getAllByRole("option");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useCbe.getState().reset();
  Object.assign(window.cbe, { setInterfaceLanguage: setter() });
});

afterEach(() => {
  cleanup();
  __resetActiveLanguage();
  vi.useRealTimers();
});

describe("Scenario: The closed control is compact and the open choices remain endonyms", () => {
  it("derives the compact code, accessible name, endonyms and selected semantics in every shipped language", () => {
    for (const [code, catalogue] of Object.entries(LANGUAGES)) {
      setActiveLanguage(code);
      const view = render(<AppHeader configured />);
      const button = screen.getByRole("button", {
        name: catalogue.strings.headerLanguageAccessibleName({
          language: catalogue.endonym,
          code: code.toUpperCase(),
        }),
      });
      expect(button.textContent).toBe(code.toUpperCase());
      expect(button.querySelectorAll("svg")).toHaveLength(2);
      expect([...button.querySelectorAll("svg")].every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
      fireEvent.click(button);
      expect(options().map((option) => option.textContent)).toEqual(
        interfaceLanguageOptions().map((option) => option.endonym)
      );
      for (const [index, option] of options().entries()) {
        const expected = interfaceLanguageOptions()[index]!;
        expect(option.getAttribute("lang")).toBe(expected.code);
        expect(option.getAttribute("aria-selected")).toBe(String(expected.code === code));
      }
      view.unmount();
    }
  });

  it("pins the current endonym copy and derives an additional catalogue option without changing a component list", () => {
    expect(interfaceLanguageOptions().map((option) => option.endonym)).toEqual([
      "Deutsch",
      "English",
      "Français",
      "Italiano",
    ]);
    const extra = {
      ...LANGUAGES,
      zxx: { code: "zxx", endonym: "No language", formattingLocale: "en", strings: en },
    };
    expect(interfaceLanguageOptions(extra).at(-1)).toEqual({ code: "zxx", endonym: "No language" });
  });
});

describe("Scenario: Keyboard navigation does not commit a preference", () => {
  it.each(["Enter", " ", "ArrowDown", "ArrowUp"])("opens with %j and focuses the applied option", (key) => {
    render(<AppHeader configured />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key });
    if (key === "Enter" || key === " ") fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "English" }));
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(listbox()!.id);
  });

  it("wraps arrows, handles Home/End and typeahead without calling the setter", () => {
    vi.useFakeTimers();
    const setInterfaceLanguage = setter();
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    const list = listbox()!;

    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(options()[0]);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options().at(-1));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options()[0]);
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(options().at(-1));
    fireEvent.keyDown(list, { key: "f" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Français" }));
    act(() => vi.advanceTimersByTime(1_001));
    fireEvent.keyDown(list, { key: "i" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Italiano" }));
    expect(setInterfaceLanguage).not.toHaveBeenCalled();
    expect(activeLanguage()).toBe("en");
  });
});

describe("Scenario: Keyboard and pointer commit through the same setter", () => {
  it.each([
    ["Enter", "de"],
    [" ", "fr"],
  ])("commits with %j, adopts only the answer, closes and restores focus", async (key, code) => {
    const setInterfaceLanguage = setter();
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    const option = screen.getByRole("option", { name: LANGUAGES[code]!.endonym });
    option.focus();
    fireEvent.keyDown(option, { key });
    expect(activeLanguage()).toBe("en");
    await waitFor(() => expect(activeLanguage()).toBe(code));
    expect(setInterfaceLanguage).toHaveBeenCalledWith(code);
    expect(listbox()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("uses the same path for pointer activation and explicitly persists the active default", async () => {
    const setInterfaceLanguage = setter();
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    await waitFor(() => expect(setInterfaceLanguage).toHaveBeenCalledWith("en"));
  });
});

describe("dismissal and focus contract", () => {
  it("Escape and trigger toggle close without a write and return focus", async () => {
    const setInterfaceLanguage = setter();
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    fireEvent.keyDown(listbox()!, { key: "ArrowDown" });
    fireEvent.keyDown(listbox()!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(setInterfaceLanguage).not.toHaveBeenCalled();

    fireEvent.click(trigger());
    fireEvent.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(listbox()).toBeNull();
  });

  it("Tab and Shift+Tab close and continue relative to the trigger", () => {
    render(<AppHeader workspaceVisible configured />);
    fireEvent.click(trigger());
    fireEvent.keyDown(listbox()!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: en.headerHelpLabel }));
    expect(listbox()).toBeNull();

    fireEvent.click(trigger());
    fireEvent.keyDown(listbox()!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /show courses/i }));
    expect(listbox()).toBeNull();
  });

  it("outside controls retain activation/focus, dead space returns focus, and programmatic focus is not reclaimed", async () => {
    render(
      <>
        <AppHeader configured />
        <button type="button">Outside</button>
        <div data-testid="dead-space" />
      </>
    );
    fireEvent.click(trigger());
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    outside.focus();
    fireEvent.click(outside);
    await waitFor(() => expect(listbox()).toBeNull());
    expect(document.activeElement).toBe(outside);

    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByTestId("dead-space"));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));

    fireEvent.click(trigger());
    act(() => outside.focus());
    await waitFor(() => expect(listbox()).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  it("window deactivation dismisses without refocusing the app", () => {
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    fireEvent.blur(window);
    expect(listbox()).toBeNull();
  });
});

describe("pending, failure and synchronization", () => {
  it("prevents duplicate commits, remains dismissible, and a late reply updates without stealing focus", async () => {
    const answer = deferred<{ ok: boolean; language: string }>();
    const setInterfaceLanguage = vi.fn().mockReturnValue(answer.promise);
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(
      <>
        <AppHeader configured />
        <button type="button">Outside</button>
      </>
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    expect(trigger().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Français" }));
    expect(setInterfaceLanguage).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(listbox()!, { key: "Escape" });
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    answer.resolve({ ok: true, language: "de" });
    await waitFor(() => expect(activeLanguage()).toBe("de"));
    expect(document.activeElement).toBe(outside);
    expect(listbox()).toBeNull();
  });

  it.each([
    ["refusal", () => Promise.resolve({ ok: false, language: "en" })],
    ["rejection", () => Promise.reject(new Error("disk unavailable"))],
  ])("reports a localized %s without inventing success and permits retry", async (_label, outcome) => {
    const setInterfaceLanguage = vi.fn().mockImplementation(outcome);
    Object.assign(window.cbe, { setInterfaceLanguage });
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    expect(activeLanguage()).toBe("en");
    await waitFor(() =>
      expect(document.querySelector(".header-language-feedback")?.textContent).toBe(en.headerLanguageFailure)
    );
    expect(activeLanguage()).toBe("en");

    setInterfaceLanguage.mockResolvedValue({ ok: true, language: "de" });
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    await waitFor(() => expect(activeLanguage()).toBe("de"));
    expect(setInterfaceLanguage).toHaveBeenCalledTimes(2);
  });

  it("reflects main broadcasts while closed or open and Settings changes the same value", async () => {
    Object.assign(window.cbe, { setInterfaceLanguage: setter() });
    render(
      <>
        <AppHeader configured />
        <SettingsPanel />
      </>
    );
    act(() => setActiveLanguage("de"));
    expect(trigger().textContent).toBe("DE");
    fireEvent.click(trigger());
    act(() => setActiveLanguage("fr"));
    expect(trigger().textContent).toBe("FR");
    expect(screen.getByRole("option", { name: "Français" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(listbox()!, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Italiano" }));
    await waitFor(() => expect(trigger().textContent).toBe("IT"));
  });
});

describe("availability, modal authority and state isolation", () => {
  it("is the sole top-right control before configuration and remains usable without a session", async () => {
    const setInterfaceLanguage = setter();
    Object.assign(window.cbe, { setInterfaceLanguage });
    const { container } = render(<AppHeader />);
    expect(container.querySelectorAll(".app-header-right button")).toHaveLength(1);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    await waitFor(() => expect(activeLanguage()).toBe("de"));
    expect(useCbe.getState().overlaySection).toBeNull();
    expect(useCbe.getState().session).toBeNull();
  });

  it("modal opening dismisses the popup and keeps focus in the overlay, including after a delayed reply", async () => {
    const answer = deferred<{ ok: boolean; language: string }>();
    Object.assign(window.cbe, { setInterfaceLanguage: vi.fn().mockReturnValue(answer.promise) });
    render(
      <>
        <AppHeader configured />
        <ProfileSettingsOverlay />
      </>
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    useCbe.getState().showSettingsSurface("settings");
    await waitFor(() => expect(listbox()).toBeNull());
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    answer.resolve({ ok: true, language: "de" });
    await waitFor(() => expect(activeLanguage()).toBe("de"));
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("group", { name: de.settingsInterfaceLanguageGroupLabel })).toBeTruthy();
  });

  it("selection changes no conversation state and sends no prompt or session operation", async () => {
    const sendPrompt = vi.fn();
    const openConversation = vi.fn();
    const freshConversation = vi.fn();
    Object.assign(window.cbe, {
      setInterfaceLanguage: setter(),
      sendPrompt,
      openConversation,
      freshConversation,
    });
    useCbe.setState({
      settingsDirtyGroup: "model",
      hydration: "error",
      dispatchPending: true,
      live: { ...useCbe.getState().live, streaming: true },
    });
    const before = {
      dirty: useCbe.getState().settingsDirtyGroup,
      live: useCbe.getState().live,
      canvas: useCbe.getState().canvas,
      maturity: useCbe.getState().maturity,
    };
    render(<AppHeader configured />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    await waitFor(() => expect(activeLanguage()).toBe("de"));
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(openConversation).not.toHaveBeenCalled();
    expect(freshConversation).not.toHaveBeenCalled();
    expect(useCbe.getState().settingsDirtyGroup).toBe(before.dirty);
    expect(useCbe.getState().live).toBe(before.live);
    expect(useCbe.getState().canvas).toBe(before.canvas);
    expect(useCbe.getState().maturity).toBe(before.maturity);
  });
});

describe("screen-reader contract", () => {
  it("names the trigger/listbox, selected language, busy state and no-drag surfaces", () => {
    render(<AppHeader configured />);
    const button = trigger();
    expect(button.title).toBe(en.headerLanguageLabel);
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    fireEvent.click(button);
    expect(listbox()!.getAttribute("aria-label")).toBe(en.headerLanguageLabel);
    expect(screen.getByRole("option", { name: "English" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".header-language")).not.toBeNull();
    expect(document.querySelector(".header-language-listbox")).not.toBeNull();
  });
});
