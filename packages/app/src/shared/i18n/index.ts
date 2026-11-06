/**
 * The shipped catalogues, and everything that resolves a language from them
 * (capability `desktop-app`, Requirements: *Every String the App Renders Is
 * English*; *Interface Language Control in Settings*; *Locale-Dependent
 * Formatting Follows the Interface Language*).
 *
 * **Adding a language is a file plus one line here — and nothing else.** No
 * component, no Settings control and no test names a language: the control's
 * option list is derived from `LANGUAGES`, formatting reads the catalogue's own
 * declared tag, and the test environment pins the reference language. That is
 * what let French and Italian ship as catalogue files rather than as change
 * proposals, and a fifth language costs exactly the same.
 */
import { en } from "./en.js";
import { de } from "./de.js";
import { fr } from "./fr.js";
import { it } from "./it.js";
import type { ChromeCatalogue, LanguageCatalogue } from "./types.js";

export type { ChromeCatalogue, ChromeStringKey, LanguageCatalogue } from "./types.js";
export { en } from "./en.js";
export { de } from "./de.js";
export { fr } from "./fr.js";
export { it } from "./it.js";

/**
 * English declares the tag `NUMBER_LOCALE` named before this change, so a
 * lecturer who stays in English sees no formatting change at all.
 *
 * German declares the PLAIN language tag. A regional tag (`de-CH`) would assert
 * a country's convention, and the governing rule is only that a figure agrees
 * with the sentence around it — the app has no basis for choosing a region on
 * the lecturer's behalf, and the `de-CH` value this repo once carried was
 * removed on purpose.
 *
 * **French and Italian follow German, and for exactly the same reason.** `fr-CH`
 * and `it-CH` would be as much of an assertion as `de-CH` was — and `fr-FR` /
 * `it-IT` more of one still, since this app is not shipped to a country. Nothing
 * a lecturer sees turns on the difference: the two figures the setting reaches
 * are a token count and a timestamp, and the plain tags group and order both the
 * way a French- or Italian-reading lecturer expects. A regional tag is available
 * the day a concrete convention has to be asserted; until then it would be an
 * unargued choice made on the lecturer's behalf.
 */
export const LANGUAGES: Record<string, LanguageCatalogue> = {
  en: { code: "en", endonym: en.languageNameEn, formattingLocale: "en-US", strings: en },
  de: { code: "de", endonym: de.languageNameDe, formattingLocale: "de", strings: de },
  fr: { code: "fr", endonym: fr.languageNameFr, formattingLocale: "fr", strings: fr },
  it: { code: "it", endonym: it.languageNameIt, formattingLocale: "it", strings: it },
};

/** Every shipped language code. */
export type InterfaceLanguage = string;

/**
 * The language the test environment pins, the fallback for an operating-system
 * locale with no catalogue, and the language the committed `ui-guide.md`
 * resolves its label placeholders against.
 */
export const REFERENCE_LANGUAGE = "en";

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, value);
}

/** The catalogue in force. An unknown code renders the reference language — the
 * app never renders a blank label or a raw key as a consequence of language
 * resolution, and resolution can never fail the app's start. */
export function catalogueFor(language: string | null | undefined): LanguageCatalogue {
  return (isInterfaceLanguage(language) ? LANGUAGES[language] : LANGUAGES[REFERENCE_LANGUAGE])!;
}

/** The strings in force. */
export function stringsFor(language: string | null | undefined): ChromeCatalogue {
  return catalogueFor(language).strings;
}

/**
 * Resolve an operating-system locale (`fr-CH`, `de_DE.UTF-8`, `DE`) against the
 * shipped catalogues by its PRIMARY LANGUAGE SUBTAG, falling back to the
 * reference language. Total: it never throws and never returns an unshipped code.
 */
export function resolveLanguageFromLocale(locale: string | null | undefined): InterfaceLanguage {
  const primary = String(locale ?? "")
    .trim()
    .split(/[-_.]/)[0]
    ?.toLowerCase();
  return primary && isInterfaceLanguage(primary) ? primary : REFERENCE_LANGUAGE;
}

/** One option of the Settings control: the code, and the name the language
 * calls itself. Derived from the registry, never hand-kept, and sorted by code
 * so the order is deterministic rather than declaration-dependent. */
export interface InterfaceLanguageOption {
  code: InterfaceLanguage;
  endonym: string;
}

export function interfaceLanguageOptions(
  languages: Record<string, LanguageCatalogue> = LANGUAGES
): InterfaceLanguageOption[] {
  return Object.entries(languages)
    .map(([code, cat]) => ({ code, endonym: cat.endonym }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Group a number for the active interface language (Requirement:
 * *Locale-Dependent Formatting Follows the Interface Language*). No component
 * names a locale literal; the tag comes from the catalogue. */
export function formatNumber(language: string | null | undefined, value: number): string {
  return value.toLocaleString(catalogueFor(language).formattingLocale);
}

/** The formatting tag declared by the language whose strings these are. Falls back
 * to the reference language for a catalogue no registry entry owns. */
export function formattingLocaleOf(strings: ChromeCatalogue): string {
  const owner = Object.values(LANGUAGES).find((language) => language.strings === strings);
  return (owner ?? LANGUAGES[REFERENCE_LANGUAGE]!).formattingLocale;
}

/**
 * Group a number for the language of a catalogue held in hand, rather than for
 * whichever one is globally active.
 *
 * Composed copy takes its wording from a catalogue passed in; the figures inside
 * that copy have to come from the SAME language, or a caller holding a
 * non-active catalogue gets a figure grouped one way inside a sentence written
 * another — the seam this rule exists to prevent.
 */
export function formatNumberIn(strings: ChromeCatalogue, value: number): string {
  return value.toLocaleString(formattingLocaleOf(strings));
}

/** Format a date-and-time for the active interface language. The options are
 * the ones the two affected surfaces already used; only the LOCALE moves, from
 * the ambient system one — which the interface setting does not decide — to the
 * catalogue's declared tag. */
export function formatDateTime(language: string | null | undefined, date: Date): string {
  return date.toLocaleString(catalogueFor(language).formattingLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Format a date-and-time in the host's default style (the corpus cache date's
 * existing presentation), for the active interface language. */
export function formatTimestamp(language: string | null | undefined, date: Date): string {
  return date.toLocaleString(catalogueFor(language).formattingLocale);
}

/**
 * True when `raw` contains the given entry in ANY shipped language.
 *
 * Two host-composed notices are MATCHED by the renderer rather than only
 * displayed — the busy rejection and the fresh-start failure — and the match has
 * to survive the notice being composed in a language the matcher was not written
 * in. Matching every catalogue's own entry is the precedent
 * `isHarnessDocumentedError` already set: match the source constant, never a
 * transcribed phrase, so neither a wording edit nor a translation can silently
 * break it.
 */
export function textMatchesAnyLanguage(raw: string, pick: (strings: ChromeCatalogue) => string): boolean {
  return Object.values(LANGUAGES).some((language) => raw.includes(pick(language.strings)));
}
