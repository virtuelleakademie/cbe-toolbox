import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entries for the CBE Process Canvas tab (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `ArtifactsPanel.tsx`, which
 * owns the design-flow canvas and the artefact cards with their annotate/delete
 * affordances — when one of these controls changes, update its entry in the same
 * diff and run `npm run ui:reference`.
 *
 * NOT documented here: the Decisions container `ArtifactsPanel.tsx` also renders.
 * It has no producer — no tool emits `didacticChecks`, so an entry would send the
 * lecturer to a surface guaranteed to stay empty. This whole reference exists
 * because the help told lecturers things that were not true; a documented empty
 * container is that same defect in new packaging. The entry gets written together
 * with the tools that fill the section.
 *
 * Texts are lecturer-facing product copy: written from what the control does,
 * never derived from `aria-label` (see the type's doc comment). Chrome labels
 * are quoted exactly as they render.
 * Plain data module: type-only imports, no runtime deps. */
export const artifactsPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "design-flow-canvas",
    area: "Right panel",
    label: "panelCanvasTab",
    description:
      "The design-flow canvas: the ten design steps as an accordion, each holding the artefact cards that belong to it (step 4 carries the challenge ladder, step 6 the four-part learning journey). Every step header shows how far that step has been taken and marks the single step currently in focus. The cards are written by the assistant during the conversation — this is where the module design becomes visible as a document rather than as chat.",
    howToUse:
      "The right panel is open on the {{panelCanvasTab}} tab when you start the app; click a step header to open that step and read its cards; one step is open at a time. Click the arrow (→) beside a step header to put that step in focus — the focus marker moves immediately and nothing is added to the conversation; the assistant is told which step you chose with your next message. It stays available while the assistant is working. You do not type into the cards; you shape them through the conversation or through the notes described below.",
    affordance: "canvas",
  },
  {
    id: "artifact-annotation",
    area: "Right panel",
    label: "uiRefArtefactNotes",
    description:
      "Lets you comment on individual artefacts and hand all your comments back to the assistant in one message, instead of re-describing them in the chat. Each card keeps its own notes, and the counter above the canvas shows how many are still pending.",
    howToUse:
      "Click “{{canvasAnnotateToggleLabel}}” on an artefact card, type your comment and press Enter (or click “{{canvasAnnotationAddLabel}}”); repeat on as many cards as you like, and remove a note with the × beside it. When you are done, click “{{canvasIterateLabel}}” at the top of the {{panelCanvasTab}} tab — it sends every pending note as your next message and clears them. The button stays inactive while there are no notes and while the assistant is working.",
    affordance: "canvas",
  },
  {
    id: "artifact-delete",
    area: "Right panel",
    label: "uiRefDeleteArtefact",
    description:
      "Clears one artefact card's content from the canvas. It is not a history deletion: the conversation keeps everything that was said, and the assistant is informed with your next message that you removed the artefact, so it does not silently write it back.",
    howToUse:
      "On a card that carries content, click the × in its header and confirm with “{{canvasDeleteAction}}” in the inline prompt; “{{chatCancel}}” leaves the card untouched. Cards that are still empty have no × — there is nothing to clear.",
    affordance: "canvas",
  },
];
