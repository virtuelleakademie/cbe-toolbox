import { CONTENT_COLUMN_GUTTER, CONTENT_COLUMN_MAX, SCROLLBAR_RESERVE, TURN_MAX } from "../../shared/layout.js";

/**
 * Publish the content column's four DECLARED figures to the stylesheet as CSS
 * custom properties (capability `desktop-app`, Requirement: One Centred Content
 * Column for the Conversation, § The column, in numbers).
 *
 * The stylesheet reads `var(--content-column-max)` and friends and repeats no
 * literal of its own, so `shared/layout.ts` stays the single source: a value
 * changed there moves the column rule, the turn cap, the scrollbar rule and the
 * reservation together, and the derived figures follow rather than being
 * re-decided. In particular `--scrollbar-reserve` feeds BOTH the
 * `::-webkit-scrollbar` width and the space reserved for it, which is what keeps
 * those two from drifting apart.
 *
 * Called once at boot, before the first render — nothing is painted until React
 * mounts, so there is no window in which the declarations are unresolved.
 */
export function applyLayoutVariables(root: HTMLElement = document.documentElement): void {
  const rs = root.style;
  rs.setProperty("--content-column-max", `${CONTENT_COLUMN_MAX}px`);
  rs.setProperty("--content-column-gutter", `${CONTENT_COLUMN_GUTTER}px`);
  rs.setProperty("--turn-max", `${TURN_MAX}px`);
  rs.setProperty("--scrollbar-reserve", `${SCROLLBAR_RESERVE}px`);
}
