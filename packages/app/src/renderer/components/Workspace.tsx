import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useCbe } from "../state/store.js";
import {
  CHAT_MIN,
  HANDLE_WIDTH,
  PANEL_MIN,
  RAIL_WIDTH,
  SPLIT_STEP,
  clampPanelWidth,
  panelFootprint,
  readStoredPanelWidth,
  storePanelWidth,
  type PanelSide,
} from "../util/panelSplit.js";
import { arbitratePanels } from "../util/panelArbitration.js";
import { useChrome } from "../chrome.js";

/**
 * Workspace grid wrapper: left panel · chat · right panel (capability
 * `desktop-app`, Requirements: Collapsible Left Panel; Collapsible Right Panel;
 * Resizable Chat–Panel Split; The Chat Column Survives Two Flanking Panels).
 *
 * It owns the grid's three column widths, so every surface that hosts the panels
 * (conversation view, hydration panes) collapses them consistently — the widths
 * live here, not at each call site, so one view can never silently miss one.
 *
 * **Both boundaries are one rule with the side as a parameter.** While a panel is
 * expanded, the boundary it shares with the chat carries a drag handle (col-resize
 * affordance, ARIA separator): dragging or arrow keys adjust that split within the
 * clamps, and each width persists independently via localStorage. Each clamp is
 * computed against the OPPOSITE panel's live footprint, so a drag on one boundary
 * can never push the chat below its minimum by exploiting the other panel's width.
 * A handle is a separate element from its edge-toggle chevron — a drag never
 * collapses a panel.
 *
 * **Width arbitration** (`util/panelArbitration.ts`) runs on every window resize
 * and every collapse-state change: it reverses what the app collapsed, reduces
 * before collapsing, and never auto-collapses the side that was just expanded. It
 * writes back only the collapse flags — the persisted widths are never overwritten
 * by it, so an auto-collapsed panel returns exactly where the lecturer left it.
 */
export function Workspace({ children }: { children: ReactNode }) {
  const t = useChrome();
  const rightCollapsed = useCbe((s) => s.panelCollapsed);
  const rightAuto = useCbe((s) => s.panelAutoCollapsed);
  const leftCollapsed = useCbe((s) => s.leftPanelCollapsed);
  const leftAuto = useCbe((s) => s.leftPanelAutoCollapsed);
  const lastExpandedSide = useCbe((s) => s.lastExpandedSide);
  const applyPanelArbitration = useCbe((s) => s.applyPanelArbitration);
  const clearExpandProtection = useCbe((s) => s.clearExpandProtection);

  const [widths, setWidths] = useState<Record<PanelSide, number>>(() => ({
    left: readStoredPanelWidth("left"),
    right: readStoredPanelWidth("right"),
  }));
  const [resizing, setResizing] = useState<PanelSide | null>(null);
  // Re-render on window resize so the clamps and the arbitration re-apply. The
  // just-expanded side's exemption is dropped first: it exists so that ONE
  // expansion is never refused, not so that a panel becomes permanently
  // un-collapsible — from a resize on, the fixed left-then-right order governs.
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => {
      clearExpandProtection();
      setResizeTick((t) => t + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clearExpandProtection]);

  const arbitrated = arbitratePanels({
    windowWidth: window.innerWidth,
    left: { collapsed: leftCollapsed, auto: leftAuto, width: widths.left },
    right: { collapsed: rightCollapsed, auto: rightAuto, width: widths.right },
    protectedSide: lastExpandedSide,
  });

  // Write the decided collapse flags back. The store patches only what actually
  // differs, so this settles in one pass and does not loop.
  useEffect(() => {
    applyPanelArbitration({
      left: { collapsed: arbitrated.left.collapsed, auto: arbitrated.left.auto },
      right: { collapsed: arbitrated.right.collapsed, auto: arbitrated.right.auto },
    });
  });

  const effective: Record<PanelSide, number> = {
    left: arbitrated.left.effectiveWidth,
    right: arbitrated.right.effectiveWidth,
  };
  const collapsedNow: Record<PanelSide, boolean> = {
    left: arbitrated.left.collapsed,
    right: arbitrated.right.collapsed,
  };

  const trackOf = (side: PanelSide) => (collapsedNow[side] ? RAIL_WIDTH : effective[side]);

  function oppositeFootprint(side: PanelSide): number {
    const other: PanelSide = side === "left" ? "right" : "left";
    return panelFootprint(collapsedNow[other], effective[other]);
  }

  function maxWidthOf(side: PanelSide): number {
    return Math.max(PANEL_MIN, window.innerWidth - CHAT_MIN - oppositeFootprint(side) - HANDLE_WIDTH);
  }

  function applyWidth(side: PanelSide, next: number) {
    const clamped = clampPanelWidth(next, window.innerWidth, oppositeFootprint(side));
    setWidths((w) => ({ ...w, [side]: clamped }));
    storePanelWidth(side, clamped);
  }

  function onPointerDown(side: PanelSide, e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setResizing(side);
    // Guarded — jsdom has no pointer capture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(side: PanelSide, e: PointerEvent<HTMLDivElement>) {
    if (resizing !== side) return;
    // The left panel's width is the pointer's distance from the left window edge;
    // the right panel's is its distance from the right edge.
    applyWidth(side, side === "left" ? e.clientX : window.innerWidth - e.clientX);
  }
  function endResize() {
    setResizing(null);
  }
  function onKeyDown(side: PanelSide, e: KeyboardEvent<HTMLDivElement>) {
    // Arrow keys grow/shrink the panel itself: for the left panel the panel grows
    // to the right, for the right panel it grows to the left.
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) {
      e.preventDefault();
      applyWidth(side, effective[side] + SPLIT_STEP);
    } else if (e.key === shrink) {
      e.preventDefault();
      applyWidth(side, effective[side] - SPLIT_STEP);
    }
  }

  // Both collapse states ride along as attributes. They drive no CSS any more —
  // the three track widths are set inline below, because a width here is a
  // decision (clamps plus arbitration) rather than a breakpoint. They stay as
  // the one place the rendered layout state is readable, from a test or from the
  // inspector.
  return (
    <div
      className={resizing ? "workspace workspace-resizing" : "workspace"}
      data-collapsed={collapsedNow.right}
      data-left-collapsed={collapsedNow.left}
      style={{ gridTemplateColumns: `${trackOf("left")}px minmax(0, 1fr) ${trackOf("right")}px` }}
    >
      {children}
      {(["left", "right"] as const).map((side) =>
        collapsedNow[side] ? null : (
          <div
            key={side}
            className="panel-resize-handle"
            data-side={side}
            role="separator"
            aria-orientation="vertical"
            aria-label={side === "left" ? t.workspaceResizeLeft : t.workspaceResizeRight}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={Math.round(maxWidthOf(side))}
            aria-valuenow={Math.round(effective[side])}
            tabIndex={0}
            style={side === "left" ? { left: effective.left - 3 } : { right: effective.right - 3 }}
            onPointerDown={(e) => onPointerDown(side, e)}
            onPointerMove={(e) => onPointerMove(side, e)}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={(e) => onKeyDown(side, e)}
          />
        )
      )}
    </div>
  );
}
