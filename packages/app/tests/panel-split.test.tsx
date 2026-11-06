/**
 * Resizable chat ↔ panel split, now governing BOTH boundaries (capability
 * `desktop-app`, Requirement: Resizable Chat–Panel Split) — Scenarios:
 * Dragging either boundary resizes its split; Clamps keep every side usable — on
 * drag, on restore, and on resize; One boundary's clamp accounts for the other
 * panel; Both split widths persist across restart and collapse cycles; Each
 * handle is keyboard-accessible with perceivable value.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Workspace } from "../src/renderer/components/Workspace.js";
import { useCbe } from "../src/renderer/state/store.js";
import {
  CHAT_MIN,
  HANDLE_WIDTH,
  PANEL_DEFAULT,
  PANEL_MIN,
  RAIL_WIDTH,
  SPLIT_STEP,
  SPLIT_STORAGE_KEYS,
  clampPanelWidth,
  readStoredPanelWidth,
  type PanelSide,
} from "../src/renderer/util/panelSplit.js";

function handleOf(container: HTMLElement, side: PanelSide): HTMLElement | null {
  return container.querySelector(`.panel-resize-handle[data-side="${side}"]`);
}
function columnsOf(container: HTMLElement): string {
  return (container.querySelector(".workspace") as HTMLElement).style.gridTemplateColumns;
}
function renderWorkspace() {
  return render(
    <Workspace>
      <div />
      <div />
      <div />
    </Workspace>
  );
}

/** Both panels expanded is the state most of these assertions want; the app's
 * own default is left-collapsed / right-expanded. */
function expandBoth() {
  useCbe.setState({
    panelCollapsed: false,
    panelAutoCollapsed: false,
    leftPanelCollapsed: false,
    leftPanelAutoCollapsed: false,
  });
}

function setWindowWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

// jsdom's default 1024px cannot host both panels at their minimums (420 + 307 +
// 307 = 1034), so the width arbitration would legitimately auto-collapse the
// left panel and there would be no left boundary to drag. These are split tests,
// not arbitration tests — `panel-arbitration.test.ts` covers that — so they run
// in a window with room for both.
const ROOMY = 1400;

beforeEach(() => {
  localStorage.removeItem(SPLIT_STORAGE_KEYS.left);
  localStorage.removeItem(SPLIT_STORAGE_KEYS.right);
  setWindowWidth(ROOMY);
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SPLIT_STORAGE_KEYS.left);
  localStorage.removeItem(SPLIT_STORAGE_KEYS.right);
  setWindowWidth(1024);
  useCbe.getState().reset();
});

describe("clampPanelWidth (pure)", () => {
  it("clamps both ends and respects the chat minimum for the window width", () => {
    expect(clampPanelWidth(100, 1024)).toBe(PANEL_MIN);
    expect(clampPanelWidth(450, 1024)).toBe(450);
    // Against a collapsed opposite panel the ceiling still leaves the chat its
    // minimum, this panel's own handle included.
    expect(clampPanelWidth(900, 1024)).toBe(1024 - CHAT_MIN - RAIL_WIDTH - HANDLE_WIDTH);
  });

  // Scenario: One boundary's clamp accounts for the other panel
  it("shrinks one panel's ceiling as the opposite panel grows", () => {
    const againstRail = clampPanelWidth(900, 1200, RAIL_WIDTH);
    const againstWidePanel = clampPanelWidth(900, 1200, 400 + HANDLE_WIDTH);
    expect(againstWidePanel).toBeLessThan(againstRail);
    expect(againstWidePanel).toBe(1200 - CHAT_MIN - (400 + HANDLE_WIDTH) - HANDLE_WIDTH);
  });
});

describe("Resizable Chat–Panel Split", () => {
  // Scenario: Dragging either boundary resizes its split
  it("a drag on either boundary adjusts that split and never collapses its panel", () => {
    expandBoth();
    const { container } = renderWorkspace();

    const right = handleOf(container, "right")!;
    fireEvent.pointerDown(right, { pointerId: 1, clientX: window.innerWidth - PANEL_DEFAULT });
    fireEvent.pointerMove(right, { pointerId: 1, clientX: window.innerWidth - 330 });
    fireEvent.pointerUp(right, { pointerId: 1 });
    expect(columnsOf(container).endsWith("330px")).toBe(true);

    const left = handleOf(container, "left")!;
    fireEvent.pointerDown(left, { pointerId: 2, clientX: PANEL_DEFAULT });
    fireEvent.pointerMove(left, { pointerId: 2, clientX: 320 });
    fireEvent.pointerUp(left, { pointerId: 2 });
    expect(columnsOf(container).startsWith("320px")).toBe(true);

    // Still expanded — a drag never collapses (that is the chevron's job).
    expect(useCbe.getState().panelCollapsed).toBe(false);
    expect(useCbe.getState().leftPanelCollapsed).toBe(false);
  });

  // Scenario: Clamps keep every side usable — on drag
  it("clamps a drag past either end of the right boundary", () => {
    const { container } = renderWorkspace(); // left at its rail, right expanded
    const handle = handleOf(container, "right")!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: window.innerWidth - PANEL_DEFAULT });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: window.innerWidth - 50 });
    expect(columnsOf(container)).toContain(`${PANEL_MIN}px`);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 });
    expect(columnsOf(container)).toContain(`${window.innerWidth - CHAT_MIN - RAIL_WIDTH - HANDLE_WIDTH}px`);
  });

  // Scenario: One boundary's clamp accounts for the other panel — rendered
  it("stops the left drag where the chat reaches its minimum given the right panel's live width", () => {
    expandBoth();
    const { container } = renderWorkspace();
    const left = handleOf(container, "left")!;
    fireEvent.pointerDown(left, { pointerId: 1, clientX: PANEL_DEFAULT });
    fireEvent.pointerMove(left, { pointerId: 1, clientX: window.innerWidth - 10 });
    const ceiling = window.innerWidth - CHAT_MIN - (PANEL_DEFAULT + HANDLE_WIDTH) - HANDLE_WIDTH;
    expect(columnsOf(container).startsWith(`${Math.max(PANEL_MIN, ceiling)}px`)).toBe(true);
  });

  // Scenario: Clamps keep every side usable — on restore
  it("re-clamps an oversized persisted width on restore and falls back on corrupt values", () => {
    localStorage.setItem(SPLIT_STORAGE_KEYS.right, "5000");
    const { container, unmount } = renderWorkspace();
    expect(columnsOf(container)).toContain(`${window.innerWidth - CHAT_MIN - RAIL_WIDTH - HANDLE_WIDTH}px`);
    unmount();

    localStorage.setItem(SPLIT_STORAGE_KEYS.right, "banana");
    expect(readStoredPanelWidth("right")).toBe(PANEL_DEFAULT);
    const second = renderWorkspace();
    expect(columnsOf(second.container)).toContain(`${PANEL_DEFAULT}px`);
  });

  // Scenario: Both split widths persist across restart and collapse cycles
  it("persists each width under its own key and restores it after remount and collapse/expand", () => {
    expandBoth();
    const first = renderWorkspace();
    fireEvent.pointerDown(handleOf(first.container, "right")!, { pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(handleOf(first.container, "right")!, { pointerId: 1, clientX: window.innerWidth - 340 });
    fireEvent.pointerUp(handleOf(first.container, "right")!, { pointerId: 1 });
    fireEvent.pointerDown(handleOf(first.container, "left")!, { pointerId: 2, clientX: 0 });
    fireEvent.pointerMove(handleOf(first.container, "left")!, { pointerId: 2, clientX: 310 });
    fireEvent.pointerUp(handleOf(first.container, "left")!, { pointerId: 2 });

    expect(localStorage.getItem(SPLIT_STORAGE_KEYS.right)).toBe("340");
    expect(localStorage.getItem(SPLIT_STORAGE_KEYS.left)).toBe("310");
    first.unmount();

    // "Restart": a fresh mount reads both persisted widths, independently.
    expandBoth();
    const second = renderWorkspace();
    expect(columnsOf(second.container).startsWith("310px")).toBe(true);
    expect(columnsOf(second.container).endsWith("340px")).toBe(true);

    // Collapse each: its handle goes, its track becomes the rail. Expand: restored.
    useCbe.getState().setLeftPanelCollapsed(true);
    second.rerender(
      <Workspace>
        <div />
        <div />
        <div />
      </Workspace>
    );
    expect(handleOf(second.container, "left")).toBeNull();
    expect(columnsOf(second.container).startsWith(`${RAIL_WIDTH}px`)).toBe(true);

    useCbe.getState().setLeftPanelCollapsed(false);
    second.rerender(
      <Workspace>
        <div />
        <div />
        <div />
      </Workspace>
    );
    expect(columnsOf(second.container).startsWith("310px")).toBe(true);
  });

  // Scenario: Each handle is keyboard-accessible with perceivable value
  it("exposes the separator pattern on both handles and resizes in steps via arrow keys", () => {
    expandBoth();
    const { container } = renderWorkspace();

    for (const side of ["left", "right"] as const) {
      const handle = handleOf(container, side)!;
      expect(handle.getAttribute("role")).toBe("separator");
      expect(handle.getAttribute("aria-orientation")).toBe("vertical");
      // Each handle names WHICH boundary it adjusts — two separators with one
      // name would be indistinguishable to a screen-reader user.
      expect(handle.getAttribute("aria-label")).toBe(side === "left" ? "Resize left panel" : "Resize right panel");
      expect(handle.getAttribute("aria-valuemin")).toBe(String(PANEL_MIN));
      expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    }

    // Arrow keys grow/shrink the panel the handle belongs to, and aria-valuenow
    // follows so assistive technology perceives the change.
    const before = Number(handleOf(container, "right")!.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handleOf(container, "right")!, { key: "ArrowLeft" });
    expect(Number(handleOf(container, "right")!.getAttribute("aria-valuenow"))).toBe(before + SPLIT_STEP);
    fireEvent.keyDown(handleOf(container, "right")!, { key: "ArrowRight" });
    expect(Number(handleOf(container, "right")!.getAttribute("aria-valuenow"))).toBe(before);

    const leftBefore = Number(handleOf(container, "left")!.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handleOf(container, "left")!, { key: "ArrowRight" });
    expect(Number(handleOf(container, "left")!.getAttribute("aria-valuenow"))).toBe(leftBefore + SPLIT_STEP);
  });
});
