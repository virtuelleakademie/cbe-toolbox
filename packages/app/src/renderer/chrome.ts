import { useSyncExternalStore } from "react";
import {
  REFERENCE_LANGUAGE,
  catalogueFor,
  formatDateTime as formatDateTimeFor,
  formatNumber as formatNumberFor,
  formatTimestamp as formatTimestampFor,
  isInterfaceLanguage,
  stringsFor,
  type ChromeCatalogue,
  type InterfaceLanguage,
} from "../shared/i18n/index.js";

/**
 * The renderer's view of the ACTIVE interface language (capability `desktop-app`,
 * Requirement: *Every String the App Renders Is English* — "the renderer never
 * decides which language is active").
 *
 * **A tiny external store, not the Zustand store.** Two reasons, both structural:
 * the value is read by plain modules that run outside React (the canvas seed, the
 * conversation reducer, the error catalogue), and it must be readable BEFORE the
 * first render — an effect-based hydration would paint one frame of the wrong
 * language, which the OS-locale scenario explicitly forbids. Reading it from the
 * Zustand store instead would put a cycle between the store and the modules it
 * seeds itself from.
 *
 * The initial value comes from the preload bridge SYNCHRONOUSLY (`window.cbe`
 * exposes it as a plain property, resolved main-side before the window loads), so
 * module evaluation already has the right language. In a test environment the
 * stub supplies the reference language, which is what pins tests to one language
 * without any test naming it.
 */
let current: InterfaceLanguage = readInitialLanguage();
const listeners = new Set<() => void>();

function readInitialLanguage(): InterfaceLanguage {
  try {
    const bridged = (globalThis as { cbe?: { interfaceLanguage?: unknown } }).cbe?.interfaceLanguage;
    return isInterfaceLanguage(bridged) ? bridged : REFERENCE_LANGUAGE;
  } catch {
    return REFERENCE_LANGUAGE;
  }
}

/** The language in force. */
export function activeLanguage(): InterfaceLanguage {
  return current;
}

/** The strings in force, for code that is not a React component. A component
 * uses `useChrome()` instead, so it re-renders when the language changes. */
export function chrome(): ChromeCatalogue {
  return stringsFor(current);
}

/** The BCP-47 tag every number and date in the chrome is formatted by. */
export function activeFormattingLocale(): string {
  return catalogueFor(current).formattingLocale;
}

/**
 * Apply a language reported by the main process. Called from the application-level
 * wiring in `main.tsx` — once at boot and again on every broadcast — never from a
 * component: a component-scoped subscription dies with the surface that mounted it.
 */
export function setActiveLanguage(language: string): void {
  const next = isInterfaceLanguage(language) ? language : REFERENCE_LANGUAGE;
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The strings in force, as a subscription: the component re-renders when the
 * lecturer changes the language, with no restart and no remount. */
export function useChrome(): ChromeCatalogue {
  return stringsFor(useSyncExternalStore(subscribe, activeLanguage, () => REFERENCE_LANGUAGE));
}

/** The active language itself, as a subscription — for the few surfaces that
 * need the code rather than the strings (the Settings control's current value,
 * and formatting inside a component). */
export function useInterfaceLanguage(): InterfaceLanguage {
  return useSyncExternalStore(subscribe, activeLanguage, () => REFERENCE_LANGUAGE);
}

/** Number and date formatting for the active language. No component names a
 * locale literal; the tag is the catalogue's (Requirement: *Locale-Dependent
 * Formatting Follows the Interface Language*). */
export function formatNumber(value: number): string {
  return formatNumberFor(current, value);
}
export function formatDateTime(date: Date): string {
  return formatDateTimeFor(current, date);
}
export function formatTimestamp(date: Date): string {
  return formatTimestampFor(current, date);
}

/** Test seam: restore the pinned reference language between tests. */
export function __resetActiveLanguage(): void {
  setActiveLanguage(REFERENCE_LANGUAGE);
}
