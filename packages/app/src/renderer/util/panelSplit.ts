/**
 * Chat ↔ panel split helpers (capability `desktop-app`, Requirement: Resizable
 * Chat–Panel Split). Pure and unit-testable: clamping keeps every side usable
 * (chat ≥ 420px measured against BOTH panels, neither panel ≤ 300px),
 * persistence follows the localStorage appearance-state precedent, and invalid
 * stored values fall back to that panel's default width.
 *
 * Both boundaries are governed by one and the same rule — the left panel's
 * resize capability is the right panel's, not a weaker version of it — so every
 * function here takes the side as a parameter rather than assuming the right.
 * The two widths persist INDEPENDENTLY (one storage key each); the collapse
 * states deliberately do not persist at all (they are session-scoped working
 * posture, not an appearance preference).
 */

import { CHAT_MIN, HANDLE_WIDTH, PANEL_MIN, RAIL_WIDTH, panelFootprint } from "../../shared/layout.js";
import type { PanelSide } from "../../shared/layout.js";

export { CHAT_MIN, HANDLE_WIDTH, PANEL_MIN, RAIL_WIDTH, panelFootprint };
export type { PanelSide };

/** Matches the pre-change fixed column (`grid-template-columns: 1fr 404px`). */
export const PANEL_DEFAULT = 404;

/** One storage key per boundary — a width the lecturer chose for one panel says
 * nothing about the other. The right panel keeps its original key so an existing
 * install does not lose the width it already had. */
export const SPLIT_STORAGE_KEYS: Record<PanelSide, string> = {
  right: "cbe-panel-width",
  left: "cbe-left-panel-width",
};

/** Discrete keyboard step for a separator's arrow-key interaction. */
export const SPLIT_STEP = 24;

/**
 * Clamp a desired width for ONE panel so every side keeps its usable minimum,
 * given what the OTHER panel currently occupies. The opposite panel's live
 * footprint is part of the computation on purpose: with a panel on each side,
 * a drag on one boundary could otherwise push the chat below its minimum by
 * exploiting the other panel's width.
 */
export function clampPanelWidth(width: number, windowWidth: number, oppositeFootprint: number = RAIL_WIDTH): number {
  const max = Math.max(PANEL_MIN, windowWidth - CHAT_MIN - oppositeFootprint - HANDLE_WIDTH);
  return Math.min(Math.max(width, PANEL_MIN), max);
}

/** Read a panel's persisted width; non-numeric/corrupt/nonpositive values fall
 * back to the default (Scenario: Clamps keep every side usable — restore). */
export function readStoredPanelWidth(side: PanelSide = "right"): number {
  const raw = localStorage.getItem(SPLIT_STORAGE_KEYS[side]);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PANEL_DEFAULT;
}

export function storePanelWidth(side: PanelSide, width: number): void {
  localStorage.setItem(SPLIT_STORAGE_KEYS[side], String(Math.round(width)));
}
