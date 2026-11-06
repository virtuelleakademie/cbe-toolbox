/**
 * Main-process ownership of the interface language (capability `desktop-app`,
 * Requirement: *Every String the App Renders Is English* — § The setting).
 *
 * The store is electron-free by construction, so this drives it against a temp
 * directory exactly as `lecturer-identity-store.test.ts` does. What is asserted
 * here is the resolution ORDER and the two properties that are easy to get
 * quietly wrong: a stored choice for a catalogue this build does not ship must
 * render the reference language WITHOUT rewriting the stored value, and no input
 * at all may throw — language resolution runs before the window exists, so a
 * throw here is a start failure.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileInterfaceLanguageStore,
  activeInterfaceLanguage,
  chrome,
  resolveInterfaceLanguage,
  setActiveInterfaceLanguage,
} from "../src/main/interface-language.js";
import { REFERENCE_LANGUAGE } from "../src/shared/i18n/index.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";

let dir: string;
const storeAt = (): FileInterfaceLanguageStore =>
  new FileInterfaceLanguageStore(path.join(dir, "interface-language.json"));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cbe-lang-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
});

/**
 * A language code this build does NOT ship.
 *
 * `zxx` is ISO 639-2's "no linguistic content", so it is a well-formed primary
 * subtag that can never become an interface language. The assertions below used
 * to spell `fr` here, which meant that shipping French turned four "this build
 * does not ship it" assertions false — the exact cost the Scenario *Adding a
 * language touches no test* forbids. A code that cannot ship carries the same
 * meaning permanently.
 */
const UNSHIPPED = "zxx";

describe("resolving which language is in force", () => {
  // Scenario: The operating-system locale decides the first launch.
  it("derives the default from the OS locale by its primary subtag", () => {
    expect(resolveInterfaceLanguage(null, "de-CH")).toBe("de");
    expect(resolveInterfaceLanguage(null, "de_DE.UTF-8")).toBe("de");
    expect(resolveInterfaceLanguage(null, "DE")).toBe("de");
    expect(resolveInterfaceLanguage(null, "fr-CH")).toBe("fr");
    expect(resolveInterfaceLanguage(null, "en-GB")).toBe("en");
  });

  // Scenario: An operating-system locale with no catalogue falls back to English.
  it("falls back to the reference language for an OS locale with no catalogue", () => {
    expect(resolveInterfaceLanguage(null, `${UNSHIPPED}-CH`)).toBe(REFERENCE_LANGUAGE);
    expect(resolveInterfaceLanguage(null, "")).toBe(REFERENCE_LANGUAGE);
    expect(resolveInterfaceLanguage(null, null)).toBe(REFERENCE_LANGUAGE);
  });

  // Scenario: The choice survives a restart — a stored choice always outranks the
  // OS default.
  it("lets a stored choice outrank the operating-system locale", () => {
    expect(resolveInterfaceLanguage("de", "en-US")).toBe("de");
    expect(resolveInterfaceLanguage("en", "de-CH")).toBe("en");
  });

  // Scenario: A stored language whose catalogue no longer ships renders English
  // and keeps the choice.
  it("renders the reference language for a stored code this build does not ship", () => {
    expect(resolveInterfaceLanguage(UNSHIPPED, "de-CH")).toBe(REFERENCE_LANGUAGE);
    // …and it does NOT fall through to the OS locale either: a stored choice is a
    // decision, so the fallback is the reference language, not another guess.
    expect(resolveInterfaceLanguage(UNSHIPPED, "de-CH")).not.toBe("de");
  });

  it("never throws, whatever it is handed", () => {
    for (const stored of [null, "", "  ", "xx", "en", 7 as unknown as string]) {
      for (const locale of [null, "", "…", "en", 7 as unknown as string]) {
        expect(() => resolveInterfaceLanguage(stored as string | null, locale as string | null)).not.toThrow();
      }
    }
  });
});

describe("the persisted record", () => {
  it("round-trips a choice", async () => {
    const store = storeAt();
    await store.save("de");
    expect(await store.load()).toBe("de");
    expect(existsSync(store.location)).toBe(true);
  });

  it("reads an absent, unparseable or foreign record as no choice", async () => {
    const store = storeAt();
    expect(await store.load()).toBe(null);
    writeFileSync(store.location, "{ not json", "utf8");
    expect(await store.load()).toBe(null);
    writeFileSync(store.location, JSON.stringify({ somethingElse: "de" }), "utf8");
    expect(await store.load()).toBe(null);
    writeFileSync(store.location, JSON.stringify({ interfaceLanguage: "   " }), "utf8");
    expect(await store.load()).toBe(null);
  });

  it("returns an unshipped stored value AS IT STANDS, so re-shipping restores the choice", async () => {
    // The load must not correct the value — resolution decides what is RENDERED,
    // and rewriting the record would silently convert the lecturer to English.
    const store = storeAt();
    writeFileSync(store.location, JSON.stringify({ interfaceLanguage: UNSHIPPED }), "utf8");
    expect(await store.load()).toBe(UNSHIPPED);
    expect(resolveInterfaceLanguage(await store.load(), "en-US")).toBe(REFERENCE_LANGUAGE);
    // …and nothing wrote the file back.
    expect(JSON.parse(readFileSync(store.location, "utf8")).interfaceLanguage).toBe(UNSHIPPED);
  });
});

describe("a header choice through the existing main-owned record", () => {
  it("persists Italian and resolves it on a fresh boot ahead of a different OS locale", async () => {
    const store = storeAt();
    const selected = setActiveInterfaceLanguage("it");
    await store.save(selected);

    // A fresh process resolves the stored record before the renderer's first
    // paint; the different locale cannot override the explicit choice.
    setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
    const boot = resolveInterfaceLanguage(await store.load(), "de-CH");
    expect(setActiveInterfaceLanguage(boot)).toBe("it");
    expect(activeInterfaceLanguage()).toBe("it");
  });

  it("persists an explicitly selected active OS default rather than treating it as a no-op", async () => {
    const store = storeAt();
    const osDefault = resolveInterfaceLanguage(null, "fr-CH");
    expect(setActiveInterfaceLanguage(osDefault)).toBe("fr");

    // The header deliberately calls the setter even for the selected option.
    await store.save(activeInterfaceLanguage());
    expect(resolveInterfaceLanguage(await store.load(), "it-CH")).toBe("fr");
  });
});

describe("the main process's own chrome follows the setting", () => {
  it("answers from one value, and coerces an unknown code rather than rendering blank", () => {
    expect(setActiveInterfaceLanguage("de")).toBe("de");
    expect(activeInterfaceLanguage()).toBe("de");
    expect(chrome().mainExportDialogTitle).toBe(de.mainExportDialogTitle);

    expect(setActiveInterfaceLanguage(UNSHIPPED)).toBe(REFERENCE_LANGUAGE);
    expect(chrome().mainExportDialogTitle).toBe(en.mainExportDialogTitle);
  });
});
