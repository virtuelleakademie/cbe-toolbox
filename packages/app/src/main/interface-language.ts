import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  REFERENCE_LANGUAGE,
  catalogueFor,
  formatNumber as formatNumberFor,
  isInterfaceLanguage,
  resolveLanguageFromLocale,
  stringsFor,
  type ChromeCatalogue,
  type InterfaceLanguage,
} from "../shared/i18n/index.js";

/**
 * MAIN-PROCESS ownership of the interface language (capability `desktop-app`,
 * Requirement: *Every String the App Renders Is English* — "The setting").
 *
 * It deliberately does NOT join the renderer-`localStorage` appearance family
 * (theme, flavour, accent, chat text size). Two facts decide it: the main process
 * composes lecturer-facing chrome of its own AND needs the active language when
 * it assembles the `app-ui reference` block — including on the very first turn
 * after a boot, before the renderer has told anyone anything — and the OS-locale
 * default is only readable main-side (`app.getLocale()`).
 *
 * This module is ELECTRON-FREE on purpose: the path and the OS locale are
 * injected, exactly as `lecturer-identity-store.ts` is, so it is unit-testable
 * against a temp directory.
 */

/** Shape of the persisted record. One key, so a later interface preference can
 * join it without a second file. */
interface InterfaceLanguageRecord {
  interfaceLanguage?: unknown;
}

export class FileInterfaceLanguageStore {
  // An explicit field rather than a constructor parameter property: a parameter
  // property is NOT erasable TypeScript, and this module is loaded by Node's
  // type-stripping in tooling that measures the injected block.
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get location(): string {
    return this.filePath;
  }

  /**
   * The stored value EXACTLY as it stands, unvalidated — a code whose catalogue
   * this build does not ship is returned as-is rather than corrected, because
   * resolution must not rewrite the lecturer's choice (Scenario: *A stored
   * language whose catalogue no longer ships renders English and keeps the
   * choice*). Absent, unparseable and foreign records all read as "no choice".
   */
  async load(): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as InterfaceLanguageRecord;
      const stored = parsed?.interfaceLanguage;
      return typeof stored === "string" && stored.trim().length > 0 ? stored : null;
    } catch {
      return null;
    }
  }

  async save(language: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ interfaceLanguage: language }, null, 2) + "\n", "utf8");
  }
}

/**
 * Which language is in force: a stored choice outranks the operating-system
 * locale, an OS locale is matched by its primary language subtag, and anything
 * with no shipped catalogue falls back to the reference language. Total — it
 * never throws, so language resolution can never fail the app's start.
 */
export function resolveInterfaceLanguage(stored: string | null, osLocale: string | null): InterfaceLanguage {
  if (stored !== null) return isInterfaceLanguage(stored) ? stored : REFERENCE_LANGUAGE;
  return resolveLanguageFromLocale(osLocale);
}

/** The language the main process renders its own chrome in. Held here rather
 * than read per call site, so every main-side surface answers from one value. */
let active: InterfaceLanguage = REFERENCE_LANGUAGE;

/** Set at startup from the persisted record and the OS locale, and again on
 * every accepted change. Returns what is now in force. */
export function setActiveInterfaceLanguage(language: string): InterfaceLanguage {
  active = isInterfaceLanguage(language) ? language : REFERENCE_LANGUAGE;
  return active;
}

export function activeInterfaceLanguage(): InterfaceLanguage {
  return active;
}

/** The main process's own chrome strings, in the language in force. */
export function chrome(): ChromeCatalogue {
  return stringsFor(active);
}

/** Number formatting for the active language, for main-composed display copy. */
export function formatNumber(value: number): string {
  return formatNumberFor(active, value);
}

/** The BCP-47 tag the active catalogue declares. */
export function activeFormattingLocale(): string {
  return catalogueFor(active).formattingLocale;
}
