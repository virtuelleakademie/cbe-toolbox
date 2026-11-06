/**
 * Inline-SVG action glyphs for the left panel's course surface and the wiki browser, in the
 * `PanelTabIcon` idiom: no icon-library dependency, `currentColor` strokes so the
 * glyph inherits the button colour, `aria-hidden` because the surrounding button
 * carries the accessible name (via `aria-label`).
 *
 * Not every site has a surrounding control, though. Where the glyph itself carried
 * the meaning as text before (the Decisions section's inconsistency warning), pass
 * `label` — the SVG then renders as `role="img"` with that accessible name instead
 * of being hidden, so the warning still reaches a screen reader.
 */

export type ActionIconKind =
  | "pencil" // rename
  | "folder" // reveal in file manager
  | "book" // open wiki folder
  | "trash" // delete
  | "play" // resume
  | "stop" // abort
  | "check" // save (inline rename)
  | "cross" // cancel (inline rename)
  | "plus" // create course
  | "graph" // switch to knowledge-graph view
  | "list" // switch to list view
  | "chevron" // open details (course card)
  | "warning"; // inconsistency flag (Decisions section)

const PATHS: Record<ActionIconKind, JSX.Element> = {
  pencil: (
    <path
      d="M4.5 19.5l1-4L16.7 4.3a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.5 18.5l-4 1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  folder: (
    <path
      d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h3.8l1.6 2h8.1a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  book: (
    <>
      <path
        d="M4.5 5.75A2.25 2.25 0 0 1 6.75 3.5H19.5v14.75H6.75a2.25 2.25 0 0 0-2.25 2.25V5.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M4.5 20.5a2.25 2.25 0 0 1 2.25-2.25H19.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.5 6.5v-2h5v2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 6.5l.9 13h9.2l.9-13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" strokeLinejoin="round" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />,
  check: (
    <path
      d="M5 13l4.5 4.5L19 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  cross: (
    <path
      d="M6.5 6.5l11 11M17.5 6.5l-11 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  graph: (
    <>
      <circle cx="6" cy="17" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="6.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="15.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.3 15L10.8 8.6M13.6 8.2l3.2 5.4M8.4 16.6l7.2-.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  list: <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  chevron: (
    <path
      d="M9 5.5l7 6.5-7 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Warning: triangle with an exclamation stem and dot.
  warning: (
    <>
      <path d="M12 3.8 21 19.5H3L12 3.8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 9.5v4.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

export function ActionIcon({ kind, label }: { kind: ActionIconKind; label?: string }) {
  const naming = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      className="action-icon"
      data-kind={kind}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      focusable="false"
      {...naming}
    >
      {PATHS[kind]}
    </svg>
  );
}
