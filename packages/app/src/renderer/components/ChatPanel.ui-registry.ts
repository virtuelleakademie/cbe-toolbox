import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entries for the chat surface (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `ChatPanel.tsx` (which owns
 * the conversation header and the composer card) — when one of these controls
 * changes, update its entry in the same diff and run `npm run ui:reference`.
 * Plain data module: type-only imports, no runtime deps.
 *
 * The labels below are the ones the app RENDERS, quoted exactly — a lecturer
 * pointed at a button that does not exist is worse than no entry at all.
 *
 * **Keep these entries tight.** The whole registry is rendered into the
 * help-token turn's prompt block under `UI_REFERENCE_CAP`
 * (`main/ui-reference-prompt.ts`), and over that cap WHOLE entries are dropped —
 * a verbose entry here silently costs another surface its documentation. */
export const chatPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "material-upload",
    area: "Composer",
    label: "chatUploadEntryLabel",
    description:
      // The accepted formats deliberately do NOT appear here. This entry reaches the
      // model only on a help turn, and it was the third hand-written copy of a list
      // whose one owner is `@cbe/pi-bridge/ingest-formats`; the environment descriptor
      // now reports the set on every turn (capability `desktop-app`, Requirement:
      // *Material Ingestion Stub into the Chat Context* — one owner, every surface
      // derived). Dropping it also returns characters to `UI_REFERENCE_CAP`.
      "Reads existing teaching material into the conversation. Selected files appear as removable attachment pills above the message field and are sent to the assistant together with the next message.",
    howToUse:
      'Open the round "+" menu at the bottom left of the composer card, choose "{{chatUploadEntryLabel}}" and pick one or more files. Remove a pending pill via its × before sending if needed; optionally type an instruction, then send.',
    affordance: "ingestion",
  },
  {
    id: "new-session",
    area: "Conversation header",
    label: "chatNewSessionLabel",
    description:
      "Starts a fresh conversation for the current course. A context reset, not a data reset: the module design on the CBE Process Canvas, the recorded decisions, the design-step progress and the CBE Maturity reading are kept, the lecturer profile persists, and the previous conversation stays resumable from Courses. Nothing is deleted.",
    howToUse:
      "Click {{chatNewSessionLabel}} in the conversation header above the transcript and confirm in the inline prompt (it names what is kept and that the conversation stays resumable from Courses). The control is locked while the agent is still working.",
  },
  {
    id: "help-me",
    area: "Composer",
    label: "chatHelpEntryLabel",
    description:
      "The composer's route to the same help request as the header's question mark, reachable without leaving the message field.",
    howToUse:
      'Open the round "+" menu at the bottom left of the composer card and choose "{{chatHelpEntryLabel}}" while the agent is idle. Your draft and pending attachments stay untouched; for a specific question, type it into the message field instead.',
  },
  {
    id: "context-usage-ring",
    area: "Composer",
    label: "uiRefContextRing",
    description:
      "The small circle left of the model name at the bottom of the composer: how much of the model's context window this conversation occupies, i.e. how much room is left before the assistant automatically summarises the earlier part to make space.",
    howToUse:
      "Hover it or move keyboard focus to it and it states its current reading in words — not yet measured (a new conversation), carrying context that has not been re-measured yet (a reopened one), a percentage plus the token figures once both are known, or that no context window is configured, in which case the model pill beside it leads to the field that sets one. Near the summarising point it changes appearance and says so; nothing is blocked, and your canvas work, decisions, step progress and CBE Maturity reading are kept either way.",
  },
  {
    id: "model-pill",
    area: "Composer",
    label: "uiRefModelPill",
    description:
      "Shows which model the conversation runs on, at the bottom right of the composer card. Display-only — it never offers a model list and never switches models.",
    howToUse:
      'Click it to open {{overlaySettingsTab}} at the "{{settingsGroupModel}}" group, where the base URL, model id and API key are configured. It stays clickable while the agent is working. "{{chatModelPillBlankLabel}}" means no model id is saved yet.',
  },
  // Deliberately terse, and cut to fit rather than paid for by trimming a
  // neighbour's entry. The mechanism is what matters here: over
  // `UI_REFERENCE_CAP` WHOLE entries are dropped — supplementary ones first,
  // which is this one — so a verbose version here would simply have deleted
  // itself, silently, while reading as documented.
  //
  // This entry took the block to within a sentence of the 16,000 cap, and
  // `reach-help-from-the-app-header` (2026-08-25) then re-based that cap when a
  // new documented control could not be fitted at all. The CURRENT measurement
  // and the arithmetic for it live in one place, `SettingsPanel.ui-registry.ts`;
  // do not copy it here.
  {
    id: "send-stop",
    area: "Composer",
    label: "uiRefSendStop",
    description: "Sends your message; while the assistant works the same button is a square that stops the answer.",
    howToUse: "Enter or the button sends. Click the square to stop; the text already written stays, marked stopped.",
  },
];
