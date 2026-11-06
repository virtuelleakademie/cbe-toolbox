import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entry for the left-panel container itself
 * (`ui-reference-generation` spec, Requirement: UI Element Registry). Colocated
 * with `LeftPanel.tsx` — when the collapse behaviour or the panel's levels
 * change, update this entry in the same diff and run `npm run ui:reference`.
 *
 * Deliberately ungated: the panel is the way IN to the course surface, and it
 * ships collapsed — an entry that did not say so would leave a lecturer looking
 * for a course list that is behind a rail.
 * Plain data module: type-only imports, no runtime deps. */
export const leftPanelUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "left-panel",
    area: "Left panel",
    label: "panelLeftLabel",
    description:
      "The column on the left of the window, holding your courses. It starts collapsed to a narrow strip with a single {{panelCoursesTitle}} icon — which is why no course list is on screen when you open the app. A marker on that icon means an assistant run in another course is live or just done, or a wiki ingest is running.",
    howToUse:
      "Click the {{panelCoursesTitle}} icon in the narrow strip to expand the panel, or use the chevron on the panel's edge to expand and collapse it. The course name in the header strip opens it too and puts you straight in the list. Drag the panel's inner edge to make it wider or narrower; the width is remembered, the collapsed state is not.",
    affordance: "courseWorkspace",
  },
];
