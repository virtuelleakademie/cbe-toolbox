/**
 * Inline-SVG glyphs for both panel rails (capability `desktop-app`, Requirements:
 * Collapsible Right Panel; Collapsible Left Panel), the header's three existing
 * icon affordances within its four-control group (Requirement: App Header Strip)
 * and the edge-toggle chevron. No
 * icon-library dependency; every glyph is themed via `currentColor` so it inherits
 * the rail/toggle colour, matching the `DocTypeIcon` idiom. Decorative — the
 * surrounding button carries the accessible name, so each SVG is `aria-hidden`.
 *
 * The kind set is DELIBERATELY wider than `PanelTab`: `courses` is the left rail's
 * single icon, and `profile` / `settings` / `help` are the header group's three
 * existing icon affordances beside the language dropdown. None is a right-panel
 * tab any more.
 */
export type PanelIconKind = "artifacts" | "courses" | "profile" | "maturity" | "settings" | "help";

const TAB_PATHS: Record<PanelIconKind, JSX.Element> = {
  // Canvas: two stacked artefact tiles.
  artifacts: (
    <>
      <rect x="3.5" y="3.5" width="17" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3.5" y="13.5" width="17" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  // Courses: folder.
  courses: (
    <path
      d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3.8l1.6 2h8.1a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  // Profile: person silhouette (head + shoulders).
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  // Maturity: three ascending level bars (the 3-level raster read at a glance).
  maturity: (
    <>
      <rect x="3.5" y="14.5" width="4" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="9.5" width="4" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="16.5" y="4.5" width="4" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  // Help: question mark in a ring — a drawn glyph, never the "?" character and
  // never an emoji (Requirement: Iconography Instead of Emojis).
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.6 9.4a2.5 2.5 0 0 1 4.85.85c0 1.67-2.45 2.1-2.45 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.6" r="0.95" fill="currentColor" />
    </>
  ),
  // Settings: cog/gear (clearly a gear, not a sun — the lobes read as cog teeth).
  settings: (
    <>
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
};

export function PanelTabIcon({ tab }: { tab: PanelIconKind }) {
  return (
    <svg
      className="panel-tab-icon"
      data-tab={tab}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {TAB_PATHS[tab]}
    </svg>
  );
}

/** Chevron for the edge toggle. Points right (`›`) when the panel is expanded (the
 * toggle will collapse it) and left (`‹`) when collapsed (the toggle will expand it). */
export function PanelChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      className="panel-chevron-icon"
      data-direction={direction}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={direction === "right" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
