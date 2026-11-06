/**
 * Shipping a further language is a catalogue file and NOTHING else (capability
 * `desktop-app`, Requirement: *Every String the App Renders Is English* —
 * Scenario *A further language ships without a change proposal*; Requirement:
 * *Interface Language Control in Settings* — Scenario *A newly shipped catalogue
 * appears without a code change*).
 *
 * **This file demonstrates the claim rather than asserting it.** A test that
 * checked a derived list would only be re-stating the implementation; what the
 * requirement promises is about the REST of the codebase — that the Settings
 * control, the components and the tests need no edit. So a further catalogue is
 * injected at the registry, the REAL `SettingsPanel` is rendered, and the new
 * language is read back off the actual control. Nothing in
 * `SettingsPanel.tsx` — or anywhere else — is touched to make this pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The code and endonym of the language injected below.
 *
 * `zxx` is ISO 639-2's "no linguistic content": a well-formed primary subtag that
 * can never be a real interface language, so this fixture stays a demonstration of
 * an UNSHIPPED language for good. It used to name `fr` and `it`, and shipping
 * French and Italian silently turned the whole file inert — the mock became an
 * overlay of the real registry onto itself, and a test that cannot fail proves
 * nothing. The endonym is deliberately synthetic for the same reason.
 */
const FURTHER = "zxx";
const FURTHER_ENDONYM = "Zxxian";

/**
 * The whole intervention: one further entry in the catalogue registry. The strings
 * are English stand-ins because what is under test is the REGISTRY's reach, not a
 * translation — a real further language is the same edit with its own file.
 */
vi.mock("../src/shared/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/i18n/index.js")>();
  const LANGUAGES = {
    ...actual.LANGUAGES,
    zxx: { code: "zxx", endonym: "Zxxian", formattingLocale: "zxx", strings: actual.en },
  };
  return {
    ...actual,
    LANGUAGES,
    isInterfaceLanguage: (v: unknown): v is string =>
      typeof v === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, v),
    interfaceLanguageOptions: (languages = LANGUAGES) => actual.interfaceLanguageOptions(languages),
  };
});

const { SettingsPanel } = await import("../src/renderer/components/SettingsPanel.js");
const { useCbe } = await import("../src/renderer/state/store.js");
const { en } = await import("../src/shared/i18n/en.js");
/** The registry as it really SHIPS — `importActual`, because the plain import
 * resolves to the mock above and would already carry the injected language. */
const { LANGUAGES: SHIPPED } =
  await vi.importActual<typeof import("../src/shared/i18n/index.js")>("../src/shared/i18n/index.js");

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ settingsOpenGroup: "appearance" });
});
afterEach(() => cleanup());

/** Every shipped language plus the injected one, sorted by code as the control is. */
const EXPECTED_ENDONYMS = [
  ...Object.values(SHIPPED).map((l) => ({ code: l.code, endonym: l.endonym })),
  { code: FURTHER, endonym: FURTHER_ENDONYM },
]
  .sort((a, b) => (a.code < b.code ? -1 : 1))
  .map((l) => l.endonym);

describe("a build that ships one catalogue more", () => {
  it("offers every catalogue in the real Settings control, each by its own endonym", () => {
    render(<SettingsPanel />);
    const group = screen.getByRole("group", { name: en.settingsInterfaceLanguageGroupLabel });
    const options = [...group.querySelectorAll("button")].map((b) => b.textContent);
    expect(options).toEqual(EXPECTED_ENDONYMS);
    // The injected one really is new — otherwise this whole file would be an
    // overlay of the shipped registry onto itself, and could not fail.
    expect(Object.keys(SHIPPED)).not.toContain(FURTHER);
    expect(options).toContain(FURTHER_ENDONYM);
  });

  it("does it with no edit to the control — the list is derived, not hand-kept", async () => {
    // The evidence, stated as source rather than as behaviour: the component names
    // no language anywhere. It asks the registry and renders what comes back. The
    // names checked for are DERIVED from the registry, so a further shipped
    // language widens this check instead of escaping it.
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../src/renderer/components/SettingsPanel.tsx"), "utf8");
    const forbidden = [
      ...Object.values(SHIPPED).flatMap((l) => [l.endonym, `"${l.code}"`]),
      FURTHER_ENDONYM,
      `"${FURTHER}"`,
    ];
    for (const name of forbidden) {
      expect(source, `SettingsPanel.tsx names ${name} — the option list must stay derived`).not.toContain(name);
    }
    expect(source).toContain("interfaceLanguageOptions()");
  });

  it("keeps the new language selectable without a second control", () => {
    render(<SettingsPanel />);
    // Every option is a live control of the same kind, not a special case bolted on.
    for (const endonym of EXPECTED_ENDONYMS) {
      const option = screen.getByRole("button", { name: endonym });
      expect(option.hasAttribute("disabled")).toBe(false);
      expect(option.getAttribute("aria-pressed")).toBe(endonym === en.languageNameEn ? "true" : "false");
    }
  });
});
