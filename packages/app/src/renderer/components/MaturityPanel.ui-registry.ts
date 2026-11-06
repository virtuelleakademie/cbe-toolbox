import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entry for the CBE Maturity tab (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `MaturityPanel.tsx` — when
 * the panel's controls change, update this entry in the same diff and run
 * `npm run ui:reference`.
 *
 * Gated on the `maturity` affordance: the panel is fed exclusively by the
 * assistant's maturity pushes and does not exist outside the app.
 * Plain data module: type-only imports, no runtime deps. */
export const maturityPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "maturity-panel",
    area: "Right panel",
    label: "panelMaturityTab",
    description:
      "Shows how the assistant currently reads your design's CBE maturity: three levels (CBE light, good practice, full-fledged) across seven criteria, each with the level read now, the level you are working toward, and a hint on what is still missing. It opens with the two figures you read against each other — the target maturity settled for the design as a whole, and the overall level reached, which is worked out from the criterion readings below it and names how many of the seven it rests on. The levels are the assistant's working assumption from your material and this conversation — not a verdict — and the panel states it plainly when a reading rests on a thin evidence base or has fallen behind the design since it was taken.",
    howToUse:
      "Select the {{panelMaturityTab}} tab in the right panel. Click “{{maturityAssessLabel}}” to have the assistant read the design as it currently stands; that is also the way to refresh a reading marked out of date. To correct or develop a single criterion, click “{{maturityDiscussLabel}}” in its row — it carries that criterion into the conversation. Click a criterion's level token to unfold the full wording behind it. Both controls are locked while the assistant is working, and you cannot set a level yourself: the levels are argued in the conversation, not picked from a list.",
    affordance: "maturity",
  },
];
