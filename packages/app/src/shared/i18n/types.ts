import type { en } from "./en.js";

/**
 * The chrome-string catalogue's shape (capability `desktop-app`, Requirement:
 * *Each Rendered Chrome String Has Exactly One Owner*).
 *
 * **The English catalogue is the shape source.** The key set is declared exactly
 * once — in `en.ts` — and every other language file is annotated with this type.
 * That makes completeness a TYPE question rather than a runtime one:
 *
 * - a language file **missing a key** fails `tsc` (the annotation demands it),
 * - a language file carrying a **key no other language has** fails `tsc` too
 *   (excess-property checking on the annotated object literal),
 * - a function-valued entry whose **parameter object has a different shape**
 *   fails `tsc` (function parameters are contravariant under `strictFunctionTypes`).
 *
 * There is deliberately **no runtime fallback** to another language for a missing
 * key: a fallback is exactly the failure this catalogue exists to prevent — a
 * lecturer silently reading a label in a language they did not choose, with
 * nothing red anywhere. An incomplete language does not compile, so it cannot ship.
 *
 * The completeness check runs as `npm run typecheck:i18n` in this package (a
 * scoped `tsc --noEmit`) and is asserted — including both failure modes — by
 * `packages/app/tests/i18n-completeness.test.ts`.
 */
export type ChromeCatalogue = typeof en;

/** Every key a rendered chrome string is reachable by. Also the type of a UI
 * registry entry's `label` field and of a `{{key}}` placeholder in its prose. */
export type ChromeStringKey = keyof ChromeCatalogue;

/**
 * One shipped language: its strings, the name it calls itself, and the BCP-47
 * tag every number and date in its chrome is formatted by (Requirement:
 * *Locale-Dependent Formatting Follows the Interface Language*).
 *
 * The endonym is declared **once, by the language's own file** — which is what
 * makes it identical in every catalogue rather than merely required to be
 * (Requirement: *Interface Language Control in Settings*). A lecturer stranded in
 * a language they cannot read still finds their own in the list.
 */
export interface LanguageCatalogue {
  /** BCP-47 primary language subtag; also the persisted value. */
  readonly code: string;
  /** What this language calls itself, for the Settings control's option list. */
  readonly endonym: string;
  /** BCP-47 tag for `Intl` number and date formatting in this language. */
  readonly formattingLocale: string;
  readonly strings: ChromeCatalogue;
}
