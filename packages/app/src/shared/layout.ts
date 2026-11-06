/**
 * Workspace layout arithmetic, shared by the renderer and the main process
 * (capability `desktop-app`, Requirements: Resizable Chat–Panel Split; The Chat
 * Column Survives Two Flanking Panels).
 *
 * It lives in `shared/` because the window minimum is the SUM of renderer-side
 * layout constants but has to be enforced main-side on the `BrowserWindow`. A
 * second copy of those numbers in `main/` is exactly how the two would drift.
 *
 * The floor is deliberately stated as the arithmetic, not as one figure: the
 * canonical specs give no pixel value for either the rail or the resize handle,
 * so the requirement names the terms — chat minimum + one panel minimum + one
 * rail + one handle — and this module names the same four. Every term occupies
 * layout width in the state the floor is measured against: one panel expanded
 * (so its boundary renders a handle) with the other at its rail.
 */

/** Which side of the chat column a panel sits on. The two panels are governed by
 * one rule with the side as a parameter — never by two implementations. */
export type PanelSide = "left" | "right";

/** A usable conversation column: below this the composer, tool cards and the
 * markdown transcript stop working, so it is inviolable rather than handled. */
export const CHAT_MIN = 420;

/** Either panel's minimum expanded width. The left panel gets the right panel's
 * figure by parity — its minimum has to hold the delete confirmation's naming
 * text, which settles it without a separate argument (design.md D1). */
export const PANEL_MIN = 300;

/** The collapsed panel's icon rail — matches `.workspace` grid track in
 * `styles.css` (`48px`). */
export const RAIL_WIDTH = 48;

/** The resize handle rendered on an expanded panel's boundary — matches
 * `.panel-resize-handle { width: 7px }` in `styles.css`. */
export const HANDLE_WIDTH = 7;

/* ---------------------------------------------------------------------------
 * The conversation's content column (capability `desktop-app`, Requirement: One
 * Centred Content Column for the Conversation).
 *
 * The requirement's § _The column, in numbers_ is the single owner of these
 * four DECLARED figures; everything else about the column is DERIVED from them
 * and is computed here rather than written down a second time. The stylesheet
 * reads them as CSS custom properties published by `applyLayoutVariables`
 * (renderer/util/layoutVariables.ts) — no rule repeats a literal, and the
 * scrollbar's width and the space reserved for it cannot drift apart because
 * both come from `SCROLLBAR_RESERVE`.
 * ------------------------------------------------------------------------- */

/** The content column's cap: past this the column stops growing with the chat. */
export const CONTENT_COLUMN_MAX = 760;

/** The column's TOTAL gutter inside the shared content box — a 24px minimum per
 * side, at every width. Not an addition to the padding that existed before it:
 * the scroll region's own 30px is withdrawn. */
export const CONTENT_COLUMN_GUTTER = 48;

/** A single turn's cap INSIDE the column. Unchanged in value from what `.msg`
 * carried before; what changed is the container it is measured against. */
export const TURN_MAX = 660;

/** One scrollbar width, reserved symmetrically on each inline edge of every
 * column-carrying surface so all of them resolve the column against one equally
 * wide shared content box. Consumed BOTH by the `::-webkit-scrollbar` rule and
 * by the reservation itself. */
export const SCROLLBAR_RESERVE = 9;

/** The shared content box: the chat column less one reservation per inline
 * edge. Both the scroll region (via `scrollbar-gutter: stable both-edges`) and
 * every column-carrying surface outside it (via symmetric inline padding)
 * resolve to it. */
export function sharedContentBox(chatWidth: number): number {
  return chatWidth - 2 * SCROLLBAR_RESERVE;
}

/** The column's width at a given chat-column width — `min(cap, box − gutter)`. */
export function contentColumnWidth(chatWidth: number): number {
  return Math.min(CONTENT_COLUMN_MAX, sharedContentBox(chatWidth) - CONTENT_COLUMN_GUTTER);
}

/** The chat-column width at which the cap engages. */
export function capEngagesAtChatWidth(): number {
  return CONTENT_COLUMN_MAX + CONTENT_COLUMN_GUTTER + 2 * SCROLLBAR_RESERVE;
}

/** The worst-case offset between a skill turn's and a lecturer turn's like
 * edges: the column cap less the turn cap. Today's is the chat column's width
 * less the turn cap, which grows with the window without limit. */
export function likeEdgeOffset(): number {
  return CONTENT_COLUMN_MAX - TURN_MAX;
}

/** The gutter per side measured against the chat column's BORDER box. */
export function gutterPerSide(): number {
  return CONTENT_COLUMN_GUTTER / 2 + SCROLLBAR_RESERVE;
}

/**
 * The application window's enforced minimum width: chat minimum + ONE panel
 * minimum + one rail + one handle.
 *
 * One panel minimum and not merely two rails: at the smaller floor a window
 * sitting exactly on it with both panels collapsed has nothing to give when a
 * panel is expanded — the other panel is already at its rail and the chat
 * minimum is inviolable — so "expanding is never refused" could not hold. At
 * this floor, expanding one panel always fits that panel's minimum with the
 * other at its rail, its handle rendered, and the chat still at its minimum.
 */
export const WINDOW_MIN_WIDTH = CHAT_MIN + PANEL_MIN + RAIL_WIDTH + HANDLE_WIDTH;

/** Layout width a panel occupies in a given state: its rail while collapsed,
 * its width plus its boundary handle while expanded. */
export function panelFootprint(collapsed: boolean, width: number): number {
  return collapsed ? RAIL_WIDTH : width + HANDLE_WIDTH;
}
