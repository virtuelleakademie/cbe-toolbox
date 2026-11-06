import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entry for the Settings surface (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `SettingsPanel.tsx` — when the
 * panel changes, update this entry in the same diff and run `npm run ui:reference`.
 *
 * The `area` names the surface's REAL home: settings are the Settings section of
 * the Profile-and-Settings overlay, not a tab of the right panel. This is also the
 * entry that answers "where do I change the model?" — the model connection has no
 * other home, since the header carries no provider or model readout any more.
 *
 * The Model group has TWO levels since `split-llm-settings-into-standard-and-advanced`,
 * and the entry has to say so or the app's own help describes a surface that no
 * longer exists. The re-wording is NET NON-INCREASING and was measured, not
 * assumed: with it and the `model-pill` correction the rendered block was
 * **15,985 of `UI_REFERENCE_CAP`'s 16,000**, down from the 15,996 of 2026-08-18.
 * `resume-course-conversations` (2026-08-20) re-worded four entries for the
 * course-detail tabs, the removed reveal controls and the short New Session
 * copy at a measured net −4, taking the block to **15,981** — nineteen
 * characters of headroom, which is not headroom at all.
 * `dissolve-the-german-chrome-exception` (2026-08-25) then replaced six German
 * chrome labels with shorter English ones and their quotations in two entries,
 * measured at **15,947 of 16,000** — the first change in a while to GIVE the
 * budget room rather than spend it, and still only **53 characters** of it.
 * Over the cap whole entries are dropped SILENTLY (mechanism beside the
 * `send-stop` entry in `ChatPanel.ui-registry.ts`).
 *
 * `reach-help-from-the-app-header` (2026-08-25) is the change that hit that
 * wall — 53 characters could not hold a new documented control — and it paid in
 * both currencies rather than one. It added the header's `header-help` entry
 * (+521 rendered) and cut `help-me` to the composer route now that a second
 * entry states what help IS (−74), which is as far as the help documentation
 * could pay for itself without becoming worse documentation than it replaced;
 * the remainder came from re-basing `UI_REFERENCE_CAP` from 16,000 to 17,000,
 * whose basis is stated at the constant in `main/ui-reference-prompt.ts`.
 * That measured 16,394; the same change's documentation pass then corrected the
 * `right-panel` entry, which still located Profile and Settings behind "the two
 * icons at the top right" after the header grew a third (−2), taking the block to
 * **16,392 of 17,000**.
 *
 * `choose-the-interface-language` (2026-08-25) is where this budget acquired a
 * SECOND value, and the binding one is no longer English. Entry labels stopped
 * being literals and became catalogue keys resolved into the ACTIVE interface
 * language, so the block's size is now a function of the language: German labels
 * run longer than the English ones they resolve beside. The change also added the
 * spec-required mismatch rule as three further host-authored `#` lines (+282) and
 * one word to this entry's group list (+20). Measured with every affordance on:
 * **en 16,694 and de 16,812 of 17,000 — 306 and 188 characters of headroom.**
 *
 * Shipping French and Italian (2026-08-25) added two further catalogues and changed
 * NO entry — not a label, not a word of prose — so the whole movement is what the
 * two new languages cost when the same entries resolve into them. Measured with
 * every affordance on: **en 16,694 · de 16,812 · fr 16,822 · it 16,843.** Italian
 * is now the binding language, four characters per entry longer than German on
 * average. Against the old 17,000 that left 157 characters, a third of one entry;
 * `UI_REFERENCE_CAP` was therefore re-based to **18,000**, whose basis is stated
 * at the constant in `main/ui-reference-prompt.ts`. Nothing here was trimmed to
 * fit: over the cap whole entries are dropped SILENTLY, so trimming to fit buys a
 * documented control that the assistant then treats as non-existent. Current
 * headroom, in the binding language: **1,184 characters** (en 1,333).
 *
 * `accept-csv-and-report-the-format-list` (2026-08-26) gave 27 characters back
 * without touching this entry: the `material-upload` entry's parenthetical list of
 * accepted formats was the third hand-written copy of a set whose one owner is
 * `@cbe/pi-bridge/ingest-formats`, and the environment descriptor now reports that
 * set on EVERY turn rather than only on a help turn. Measured with every affordance
 * on: **en 16,667 · de 16,785 · fr 16,795 · it 16,816 of 18,000.** The cap did not
 * move. Note the shape of that trade, because it is the cheap kind: the fact was not
 * dropped, it was relocated to a channel that is neither budgeted nor help-gated.
 *
 * `expose-interface-language-in-the-header` adds the language entry and cross-route
 * wording without changing the cap. The route is paid for inside this entry by
 * tightening its how-to-use prose — but only wording, never a FACT: the field-help
 * clause keeps both of the operational facts it carries, where the `?` sits (beside
 * the field it explains) and how the explanation is revealed (pressing it). A fact
 * dropped from here is a fact the assistant can no longer ground a help answer in,
 * which is the expensive kind of trade and not what "tighten" licenses. Measured with
 * every affordance on: **en 17,223 · de 17,344 · fr 17,356 · it 17,381 of 18,000.**
 * Italian remains binding with 619 characters of headroom; no entry is dropped.
 *
 * `introduce-first-use-onboarding` documents the About rereading disclosure and
 * pays for it by tightening this entry's existing wording, without moving the
 * cap or another entry. Measured with every affordance on: **en 17,126 · de
 * 17,240 · fr 17,268 · it 17,292 of 18,000.** Italian remains binding with 708
 * characters of headroom; no entry is dropped.
 *
 * `add-app-icon-native-menu-and-pioneer-link` adds the native-menu entry and
 * documents its Settings/About routes plus the official site link. Measured with
 * every affordance on: **en 17,732 · de 17,858 · fr 17,892 · it 17,934.** The
 * old 18,000 cap left 66 characters, less than one entry, so it was deliberately
 * re-based to **19,000**; Italian remains binding with 1,066 characters of
 * headroom and no entry is dropped.
 *
 * **Measure the LONGEST language, not English.** A number taken in English now
 * understates the block by roughly 150 characters, and over the cap whole entries
 * are dropped silently — in that language only, which is the worst way to find
 * out. `tests/ui-reference-language-budget.test.ts` measures every shipped
 * catalogue on every run and prints all of them; read its output rather than
 * re-deriving one. Pay for any addition here inside this entry, and re-measure
 * rather than estimating: the rendered line is ~75 characters of scaffolding plus
 * both text fields.
 * Plain data module: type-only imports, no runtime deps. */
export const settingsPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "settings-panel",
    area: "Settings",
    label: "overlaySettingsTab",
    description:
      "App configuration in the {{overlaySettingsTab}} section over your workspace. Four groups, one open at a time: {{settingsGroupModel}} (endpoint, model id and key; context length, reasoning and key deletion behind {{settingsAdvanced}}), {{settingsGroupAppearance}} (theme, colour, chat text size, interface language), {{settingsGroupAbout}} (installed facts, the official PIONEER Alliance link and the rereadable first-use overview), and {{settingsGroupCorpus}} (corpus version and refresh). Only {{settingsGroupModel}} names the model your work runs on.",
    howToUse:
      "Open it with the gear at the top right or {{menuSettings}} in the native menu; {{menuAbout}} opens {{settingsGroupAbout}} directly. It opens on {{settingsGroupAppearance}}; its {{headerLanguageLabel}} matches the globe-and-code control left of {{headerHelpLabel}} in the header and applies immediately. Open {{settingsGroupModel}} for the connection; opening a group closes the other. A field's ? reveals its explanation. In {{settingsGroupAbout}}, {{onboardingReread}} shows the same overview inline without sending Help. Close with Escape, ×, or outside click; unsaved work remains and marks the gear. {{settingsGroupModel}} changes reach the open conversation on {{settingsSave}}.",
  },
];
