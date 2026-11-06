import type { UiElementRegistryEntry } from "@cbe/corpus-schema";
import type { ChromeStringKey } from "./i18n/index.js";

/**
 * A UI registry entry as the APP declares it (capability `ui-reference-generation`,
 * Requirement: *UI Element Registry*).
 *
 * The only difference from the shared `UiElementRegistryEntry` is that `label` is
 * typed as a `ChromeStringKey` rather than a bare `string`: a mistyped or retired
 * key is then a **compile error** in the registry file itself, not a failure the
 * generator has to discover at run time. The shared type cannot say this, because
 * `packages/corpus-schema` must not depend on the desktop shell.
 *
 * The two prose fields carry `{{catalogueKey}}` placeholders instead of literal
 * labels; those are checked by the resolver (`resolveUiEntryLabels`) at generation
 * and at block-composition time, and by `packages/app/tests/ui-registry-labels.test.ts`.
 */
export interface AppUiRegistryEntry extends Omit<UiElementRegistryEntry, "label"> {
  label: ChromeStringKey;
}
