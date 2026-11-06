import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entries for the header strip (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `AppHeader.tsx` — when one of
 * these affordances changes, update the entry in the same diff and run
 * `npm run ui:reference`.
 *
 * The former `course-switcher` entry is gone with the dropdown it described: an
 * entry that sends a lecturer to a control that no longer exists produces a
 * confidently wrong answer, which is worse than no entry at all.
 * Plain data module: type-only imports, no runtime deps. */
export const appHeaderUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "header-course-name",
    area: "App header",
    label: "uiRefActiveCourseName",
    description:
      "The course name in the strip at the top of the window, next to “{{headerAppName}}”, always names the course you are working in — in every view, whether or not the left panel is open. It is also the way back to your courses: it does not switch course itself.",
    howToUse:
      "Click the course name to reveal the course list: the left panel opens on its list level and the list takes focus, and one click on a card switches the whole workspace to that course, conversation and canvas included. Renaming a course, resuming a chat, browsing its wiki and deleting it all happen a level deeper, in the course's own detail view.",
    affordance: "courseWorkspace",
  },
  {
    id: "header-interface-language",
    area: "App header",
    label: "headerLanguageLabel",
    description:
      "The compact globe-and-code control immediately left of {{headerHelpLabel}} changes the app interface language. It is the only header action available before a model provider is configured; Help, Settings and Profile keep their workspace gates.",
    howToUse:
      "Open it and choose a language by its own name. The same setting remains in the overlay's {{settingsGroupAppearance}} group, and either route updates the whole interface immediately without changing the conversation language.",
  },
  // Second entry point of the ONE help dispatch, not a second control: the
  // composer's `help-me` entry describes the same request from the composer, and
  // each entry names the other so a lecturer is told both routes.
  //
  // The whole registry is rendered into the help-token turn under
  // `UI_REFERENCE_CAP`, and over that cap WHOLE entries are dropped silently, so
  // the two help entries were budgeted TOGETHER: `help-me` was cut to the
  // composer route now that this entry states what help IS, and the remainder
  // was paid by re-basing the cap — never by dropping a neighbour. Measurement
  // and arithmetic live in one place, `SettingsPanel.ui-registry.ts`; the basis
  // for the re-base is stated at the constant in `main/ui-reference-prompt.ts`.
  {
    id: "header-help",
    area: "App header",
    label: "headerHelpLabel",
    description:
      "The question-mark icon at the top right of the window asks the assistant what it can help with right now: it sends a structured help request and the assistant replies with a compact orientation grounded in the current session.",
    howToUse:
      'Click it while the assistant is idle; your composer draft and pending attachments stay untouched. While the assistant is working it says so instead of dispatching. The composer\'s "+" menu carries the same request.',
  },
  {
    id: "settings-gear",
    area: "App header",
    label: "headerSettingsTitle",
    description:
      "The gear icon at the top right of the window opens the {{overlaySettingsTab}} section of the overlay — the model connection, the appearance of the app, what is installed, and the corpus. A small mark on the gear means you left an unsaved change in {{overlaySettingsTab}}.",
    howToUse:
      "Click the gear to open the overlay at {{overlaySettingsTab}}; close it with Escape, its × control, or a click outside it, and your workspace is exactly as you left it underneath. Everything in it applies to the whole app rather than to one course.",
  },
  {
    id: "user-affordance",
    area: "App header",
    label: "headerProfileTitle",
    description:
      "The person icon, the rightmost element of the header strip, opens the same overlay at its {{overlayProfileTab}} section: the assistant's running estimate of how you teach and what you already work with.",
    howToUse:
      "Click it to open the overlay at {{overlayProfileTab}}; from there you can switch to {{overlaySettingsTab}} without closing it. Close it with Escape, its × control, or a click outside it.",
    affordance: "profilePanel",
  },
];
