import type { AppUiRegistryEntry } from "../../shared/ui-registry-entry.js";

/** UI reference entries for the Wiki surface (`ui-reference-generation` spec,
 * Requirement: UI Element Registry). Colocated with `WikiBrowser.tsx` — when a
 * control here changes, update its entry in the same diff and run
 * `npm run ui:reference`. Plain data module: type-only imports, no runtime deps. */
export const wikiBrowserUiRegistry: AppUiRegistryEntry[] = [
  {
    id: "wiki-browser",
    area: "Left panel",
    label: "coursesTabWiki",
    description:
      "Per-course knowledge wiki: browsable, searchable knowledge atoms distilled from the course's teaching material, with a list view and a knowledge-graph view.",
    howToUse:
      "Open a course's detail level in the left panel — its {{coursesTabWiki}} tab lists the atoms. Type in the search field to filter by title, alias, type, or body text; use the toolbar button to switch between list and knowledge-graph view; click an atom to read it and follow its Related links to connected atoms.",
  },
];
