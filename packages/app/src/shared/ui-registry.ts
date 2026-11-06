import type { UiElementRegistryEntry } from "@cbe/corpus-schema";
import { appHeaderUiRegistry } from "../renderer/components/AppHeader.ui-registry.js";
import { artifactsPanelUiRegistry } from "../renderer/components/ArtifactsPanel.ui-registry.js";
import { chatPanelUiRegistry } from "../renderer/components/ChatPanel.ui-registry.js";
import { coursesPanelUiRegistry } from "../renderer/components/CoursesPanel.ui-registry.js";
import { leftPanelUiRegistry } from "../renderer/components/LeftPanel.ui-registry.js";
import { maturityPanelUiRegistry } from "../renderer/components/MaturityPanel.ui-registry.js";
import { nativeMenuUiRegistry } from "../renderer/components/NativeMenu.ui-registry.js";
import { profilePanelUiRegistry } from "../renderer/components/ProfilePanel.ui-registry.js";
import { rightPanelUiRegistry } from "../renderer/components/RightPanel.ui-registry.js";
import { settingsPanelUiRegistry } from "../renderer/components/SettingsPanel.ui-registry.js";
import { wikiBrowserUiRegistry } from "../renderer/components/WikiBrowser.ui-registry.js";

/**
 * The UI element registry as ONE ordered list, for consumers that need the
 * entries as data rather than as the generated Markdown artifact (capability
 * `ui-reference-generation`, Requirement: Registry Aggregate Consumable by the
 * Main Process).
 *
 * The main process injects these into the `[help · app]` turn and filters them
 * against the session's affordances (`main/ui-reference-prompt.ts`). It cannot
 * read `skills/cbe/references/ui-guide.md` for that: the guide is rendered prose
 * with no affordance field left to filter on, and in a packaged app the skills
 * tree lives behind an `extraResources` path. So the entries are imported
 * directly — the registry modules are plain data with type-only imports, which
 * is why this pulls no React into the main bundle.
 *
 * Lives in shared/ because it bridges renderer-owned source to a main-process
 * consumer; ownership of the entries stays with the components (each
 * `<Component>.ui-registry.ts` sits beside the component it describes).
 *
 * ORDER: identical to the generator's (`ui-reference-gen.ts` sorts by area, then
 * id), so the injected block and the generated guide present the same entries in
 * the same sequence. `packages/app/tests/ui-registry-aggregate.test.ts` fails if
 * this list and the generator's collection drift — including when a new
 * `*.ui-registry.ts` file is added but never imported here.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const APP_UI_REGISTRY: readonly UiElementRegistryEntry[] = [
  ...appHeaderUiRegistry,
  ...artifactsPanelUiRegistry,
  ...chatPanelUiRegistry,
  ...coursesPanelUiRegistry,
  ...leftPanelUiRegistry,
  ...maturityPanelUiRegistry,
  ...nativeMenuUiRegistry,
  ...profilePanelUiRegistry,
  ...rightPanelUiRegistry,
  ...settingsPanelUiRegistry,
  ...wikiBrowserUiRegistry,
].sort((a, b) => byCodeUnit(a.area, b.area) || byCodeUnit(a.id, b.id));

/**
 * The ids of the load-bearing lecturer work surfaces (`ui-reference-generation`,
 * Requirement: UI Element Registry — Scenario: The load-bearing work surfaces are
 * documented). These are the surfaces a lecturer actually works in; without them
 * the help orientation is app-blind, which is the whole reason this registry is
 * injected at all.
 *
 * ONE list with two consumers, so the two cannot disagree about what "load-bearing"
 * means: the coverage test uses it as the floor it demands entries for, and the
 * host's size backstop (`main/ui-reference-prompt.ts`) uses it as the set it
 * discards LAST. The default discard order is (area, id) — alphabetical accident —
 * and full registry coverage is a later step, so without this the backstop would
 * start throwing away the right panel and the design-flow canvas exactly when the
 * list grows enough for it to fire and nobody is watching.
 *
 * The set is a FLOOR, not a ceiling: it is not the list of everything documented.
 * A surface only belongs here once it can actually show the lecturer something.
 */
export const LOAD_BEARING_UI_IDS: ReadonlySet<string> = new Set([
  "right-panel",
  "left-panel",
  "design-flow-canvas",
  "artifact-annotation",
  "artifact-delete",
  "maturity-panel",
  "courses-panel",
  "course-detail",
  "header-course-name",
  "header-interface-language",
  "header-help",
  "settings-gear",
  "user-affordance",
  "profile-panel",
  "settings-panel",
  "material-upload",
  "help-me",
  "new-session",
  "wiki-browser",
]);
