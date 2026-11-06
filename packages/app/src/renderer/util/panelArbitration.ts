/**
 * Width arbitration between the chat column and its two flanking panels
 * (capability `desktop-app`, Requirement: The Chat Column Survives Two Flanking
 * Panels). Pure and unit-testable — the renderer only feeds it the live window
 * width and the two panels' states and applies what it returns.
 *
 * Three rules, in this order:
 *
 * 1. **Reversal before anything else.** A panel the APP collapsed is not a
 *    decision, so it re-expands as soon as the window can host it again — right
 *    before left, the reverse of the collapse order. A panel the LECTURER
 *    collapsed stays collapsed: the app never re-opens something they put away.
 * 2. **Reduce before collapsing.** Expanded panels are pushed toward their own
 *    300px minimum first; the left panel yields first because it is navigation,
 *    while the right panel is the artefact surface read alongside the answer.
 * 3. **Auto-collapse last, left first, and never the panel that was just
 *    expanded.** Expanding is never refused — a control that does nothing and
 *    explains why is not an acceptable outcome — so the side that was most
 *    recently opened on purpose (by the lecturer, or by the app's own one-time
 *    canvas reveal) is protected and the other one yields.
 *
 * The lecturer's PERSISTED width is never written here: this returns the width
 * to RENDER. An auto-collapse therefore costs nothing — the panel comes back at
 * the width it had.
 */

import { CHAT_MIN, PANEL_MIN, panelFootprint } from "../../shared/layout.js";
import type { PanelSide } from "./panelSplit.js";

export interface PanelArbitrationState {
  collapsed: boolean;
  /** Collapsed by the app to make room, not by the lecturer — reversible. */
  auto: boolean;
  /** The panel's stored (persisted) width. Never mutated by arbitration. */
  width: number;
}

export interface PanelArbitrationInput {
  windowWidth: number;
  left: PanelArbitrationState;
  right: PanelArbitrationState;
  /** The side most recently expanded on purpose. Never auto-collapsed. */
  protectedSide: PanelSide | null;
}

export interface ArbitratedPanel {
  collapsed: boolean;
  auto: boolean;
  /** Width to render — the stored width, reduced toward the minimum where the
   * window demands it. */
  effectiveWidth: number;
}

export interface PanelArbitration {
  left: ArbitratedPanel;
  right: ArbitratedPanel;
}

function chatWidth(windowWidth: number, left: ArbitratedPanel, right: ArbitratedPanel): number {
  return (
    windowWidth -
    panelFootprint(left.collapsed, left.effectiveWidth) -
    panelFootprint(right.collapsed, right.effectiveWidth)
  );
}

export function arbitratePanels(input: PanelArbitrationInput): PanelArbitration {
  const { windowWidth, protectedSide } = input;
  const state: PanelArbitration = {
    left: { collapsed: input.left.collapsed, auto: input.left.auto, effectiveWidth: input.left.width },
    right: { collapsed: input.right.collapsed, auto: input.right.auto, effectiveWidth: input.right.width },
  };
  const stored: Record<PanelSide, number> = { left: input.left.width, right: input.right.width };

  // 1. Reversal — right before left, and only for what the app collapsed itself.
  for (const side of ["right", "left"] as const) {
    const panel = state[side];
    if (!panel.collapsed || !panel.auto) continue;
    const other = state[side === "left" ? "right" : "left"];
    const roomWithout = windowWidth - panelFootprint(other.collapsed, other.effectiveWidth);
    if (roomWithout - panelFootprint(false, PANEL_MIN) >= CHAT_MIN) {
      state[side] = { collapsed: false, auto: false, effectiveWidth: stored[side] };
    }
  }

  // 2. Reduce toward the panel minimum — left yields first.
  for (const side of ["left", "right"] as const) {
    const panel = state[side];
    if (panel.collapsed) continue;
    const deficit = CHAT_MIN - chatWidth(windowWidth, state.left, state.right);
    if (deficit <= 0) continue;
    state[side] = { ...panel, effectiveWidth: Math.max(PANEL_MIN, panel.effectiveWidth - deficit) };
  }

  // 3. Auto-collapse — left first, and never the protected side.
  const order: PanelSide[] =
    protectedSide === "left" ? ["right"] : protectedSide === "right" ? ["left"] : ["left", "right"];
  for (const side of order) {
    if (chatWidth(windowWidth, state.left, state.right) >= CHAT_MIN) break;
    const panel = state[side];
    if (panel.collapsed) continue;
    // The stored width rides along untouched, so the reversal above brings the
    // panel back exactly where the lecturer left it.
    state[side] = { collapsed: true, auto: true, effectiveWidth: stored[side] };
  }

  return state;
}
