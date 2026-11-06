import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { setActiveLanguage } from "../src/renderer/chrome.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";
import { useCbe } from "../src/renderer/state/store.js";

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ overlaySection: "settings", settingsOpenGroup: "about" });
});

describe("Scenario: About shows the exact official destination in every interface language", () => {
  it.each(Object.keys(LANGUAGES))("renders the localized %s label, association and system-browser cue", (language) => {
    setActiveLanguage(language);
    const t = LANGUAGES[language]!.strings;
    render(<SettingsPanel />);
    const link = screen.getByRole("link", { name: t.settingsPioneerLinkLabel });
    const description = link
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(description).toEqual([t.settingsPioneerLinkDescription, t.settingsPioneerExternalCue]);
    expect(screen.getByText(t.settingsAboutSkill)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.onboardingReread })).toBeTruthy();
  });
});

describe("Scenario: The About link is keyboard and screen-reader accessible", () => {
  it("is a focusable semantic link whose accessible description names the system browser", async () => {
    const user = userEvent.setup();
    const open = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { openPioneerAllianceSite: open });
    render(<SettingsPanel />);
    const link = screen.getByRole("link", { name: LANGUAGES.en.strings.settingsPioneerLinkLabel });
    link.focus();
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual([]);
  });
});

describe("Scenario: The host opens the fixed URL and the renderer never navigates", () => {
  it("uses only the parameterless preload capability and leaves document location/popups untouched", async () => {
    const user = userEvent.setup();
    const open = vi.fn(async () => ({ ok: true as const }));
    const popup = vi.spyOn(window, "open");
    Object.assign(window.cbe, { openPioneerAllianceSite: open });
    render(<SettingsPanel />);
    const before = window.location.href;
    const link = screen.getByRole("link", { name: LANGUAGES.en.strings.settingsPioneerLinkLabel });
    link.focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledWith();
    expect(popup).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    expect(document.activeElement).toBe(link);
  });
});

describe("Scenario: External-open failure is local and retryable", () => {
  it("announces the localized failure, retains focus, and succeeds on a retry", async () => {
    const user = userEvent.setup();
    const open = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "open-failed" })
      .mockResolvedValueOnce({ ok: true });
    Object.assign(window.cbe, { openPioneerAllianceSite: open });
    render(<SettingsPanel />);
    const link = screen.getByRole("link", { name: LANGUAGES.en.strings.settingsPioneerLinkLabel });
    link.focus();
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("status")).textContent).toBe(LANGUAGES.en.strings.settingsPioneerOpenFailure);
    expect(document.activeElement).toBe(link);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("Scenario: About remains one factual dataset without remote branding claims", () => {
  it("reuses the generated local app image decoratively beside the existing installed facts", async () => {
    render(<SettingsPanel />);
    const image = document.querySelector<HTMLImageElement>(".set-about-identity img")!;
    expect(image).not.toBeNull();
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("aria-hidden")).toBe("true");
    expect(image.src).toMatch(/buildResources\/icon\.png|assets\/icon-/);
    expect(image.src).not.toContain("pioneer-alliance.eu");
    expect(await screen.findByText("stub-skill")).toBeTruthy();
    expect(screen.getByText("0.0.0-skill")).toBeTruthy();
    expect(screen.getByText("0.0.0-stub")).toBeTruthy();
    expect(document.querySelector("iframe, embed, object")).toBeNull();
  });
});
