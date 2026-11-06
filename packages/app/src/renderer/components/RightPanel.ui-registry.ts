import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entry for the right-panel container itself
 * (`ui-reference-generation` spec, Requirement: UI Element Registry). Colocated
 * with `RightPanel.tsx` — when the collapse behaviour or the tab set changes,
 * update this entry in the same diff and run `npm run ui:reference`.
 *
 * Deliberately ungated: the panel is the way IN to both tabs documented
 * elsewhere in this registry.
 * Plain data module: type-only imports, no runtime deps. */
export const rightPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "right-panel",
    area: "Right panel",
    label: "panelRightLabel",
    description:
      "The column on the right of the window, holding the two surfaces that belong to the course you are working on: the {{panelCanvasTab}} (your module design along the ten design steps) and {{panelMaturityTab}} (how the assistant reads the design's maturity). It is open on the {{panelCanvasTab}} when you start, so the design work is on screen straight away. Your courses are in the left panel; your profile and the app's settings are behind their icons at the top right of the window.",
    howToUse:
      "Switch between the two tabs with the tab row at the top of the panel. Use the chevron on the panel's edge to collapse it to a narrow strip of icons and to open it again — clicking one of those icons opens the panel straight onto that tab. Drag the panel's inner edge to make it wider or narrower; the width is remembered, the collapsed state is not.",
  },
];
