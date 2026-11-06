/**
 * The chat column survives two flanking panels (capability `desktop-app`,
 * Requirement: The Chat Column Survives Two Flanking Panels). Every Scenario in
 * the spec delta has a matching test:
 *   - Narrowing the window collapses the left panel before the right
 *   - Widening restores only what the app collapsed
 *   - Expanding a panel in a narrow window makes room rather than refusing
 *   - The canvas reveal makes room rather than being suppressed
 *   - The window cannot be made narrow enough to break the chat
 *   - Expanding a panel at the window's minimum width is still honoured
 *
 * The pure arbitration is tested directly; the two rendered cases go through
 * <Workspace>, which is what actually feeds it the live window width.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import { RightPanel } from "../src/renderer/components/RightPanel.js";
import { Workspace } from "../src/renderer/components/Workspace.js";
import { arbitratePanels } from "../src/renderer/util/panelArbitration.js";
import { CHAT_MIN, HANDLE_WIDTH, PANEL_MIN, RAIL_WIDTH, WINDOW_MIN_WIDTH } from "../src/shared/layout.js";
import { PANEL_DEFAULT, SPLIT_STORAGE_KEYS } from "../src/renderer/util/panelSplit.js";

const expanded = (width = PANEL_DEFAULT) => ({ collapsed: false, auto: false, width });
const lecturerCollapsed = (width = PANEL_DEFAULT) => ({ collapsed: true, auto: false, width });
const autoCollapsed = (width = PANEL_DEFAULT) => ({ collapsed: true, auto: true, width });

function setWindowWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}
function resizeTo(px: number) {
  act(() => {
    setWindowWidth(px);
    window.dispatchEvent(new Event("resize"));
  });
}
function renderWorkspace() {
  return render(
    <Workspace>
      <LeftPanel />
      <div />
      <RightPanel />
    </Workspace>
  );
}

beforeEach(() => {
  localStorage.removeItem(SPLIT_STORAGE_KEYS.left);
  localStorage.removeItem(SPLIT_STORAGE_KEYS.right);
  setWindowWidth(1400);
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
  setWindowWidth(1024);
  useCbe.getState().reset();
});

describe("the window floor is the stated arithmetic", () => {
  // Scenario: The window cannot be made narrow enough to break the chat
  it("is chat minimum + one panel minimum + one rail + one handle, and no magic number", () => {
    expect(WINDOW_MIN_WIDTH).toBe(CHAT_MIN + PANEL_MIN + RAIL_WIDTH + HANDLE_WIDTH);
    // The four terms, named — 420 + 300 = 720, plus one rail, plus one handle.
    expect(CHAT_MIN + PANEL_MIN).toBe(720);
  });

  // Scenario: Expanding a panel at the window's minimum width is still honoured.
  // At the floor, one panel at its minimum WITH its handle plus the other at its
  // rail still leaves the chat exactly its minimum — so the chat minimum, the
  // make-room rule and the never-refused rule stay simultaneously true.
  it("leaves the chat exactly its minimum with one panel expanded at the floor", () => {
    const result = arbitratePanels({
      windowWidth: WINDOW_MIN_WIDTH,
      left: lecturerCollapsed(),
      right: expanded(PANEL_MIN),
      protectedSide: "right",
    });
    expect(result.right.collapsed).toBe(false);
    expect(result.right.effectiveWidth).toBe(PANEL_MIN);
    expect(result.left.collapsed).toBe(true);
    const chat = WINDOW_MIN_WIDTH - RAIL_WIDTH - (PANEL_MIN + HANDLE_WIDTH);
    expect(chat).toBe(CHAT_MIN);
  });
});

describe("arbitratePanels (pure)", () => {
  // Scenario: Narrowing the window collapses the left panel before the right
  it("reduces first, then collapses the left panel, then the right", () => {
    // Roomy: nothing moves.
    const roomy = arbitratePanels({
      windowWidth: 1400,
      left: expanded(),
      right: expanded(),
      protectedSide: null,
    });
    expect(roomy.left.collapsed).toBe(false);
    expect(roomy.right.collapsed).toBe(false);

    // Tighter: widths are pushed toward the minimum before anything collapses.
    const reduced = arbitratePanels({
      windowWidth: 1100,
      left: expanded(),
      right: expanded(),
      protectedSide: null,
    });
    expect(reduced.left.collapsed).toBe(false);
    expect(reduced.right.collapsed).toBe(false);
    expect(reduced.left.effectiveWidth).toBeLessThan(PANEL_DEFAULT);
    expect(1100 - (reduced.left.effectiveWidth + HANDLE_WIDTH) - (reduced.right.effectiveWidth + HANDLE_WIDTH)) //
      .toBeGreaterThanOrEqual(CHAT_MIN);

    // Narrower than both minimums allow: the LEFT panel goes, and it goes as an
    // app collapse (reversible), while the right one stays expanded.
    const oneCollapsed = arbitratePanels({
      windowWidth: 1000,
      left: expanded(),
      right: expanded(),
      protectedSide: null,
    });
    expect(oneCollapsed.left).toMatchObject({ collapsed: true, auto: true });
    expect(oneCollapsed.right.collapsed).toBe(false);

    // Narrower still: the right panel follows.
    const bothCollapsed = arbitratePanels({
      windowWidth: 740,
      left: expanded(),
      right: expanded(),
      protectedSide: null,
    });
    expect(bothCollapsed.left).toMatchObject({ collapsed: true, auto: true });
    expect(bothCollapsed.right).toMatchObject({ collapsed: true, auto: true });
  });

  // Scenario: Widening restores only what the app collapsed
  it("re-expands an auto-collapsed panel at its stored width and leaves a lecturer collapse alone", () => {
    const result = arbitratePanels({
      windowWidth: 1400,
      left: autoCollapsed(352),
      right: lecturerCollapsed(),
      protectedSide: null,
    });
    expect(result.left).toMatchObject({ collapsed: false, auto: false, effectiveWidth: 352 });
    // The lecturer's own collapse is not undone by the layout.
    expect(result.right).toMatchObject({ collapsed: true, auto: false });
  });

  it("an auto-collapse never overwrites the stored width", () => {
    const result = arbitratePanels({
      windowWidth: 900,
      left: expanded(500),
      right: expanded(500),
      protectedSide: null,
    });
    expect(result.left.collapsed).toBe(true);
    expect(result.left.effectiveWidth).toBe(500); // rides along untouched
  });

  // Scenario: Expanding a panel in a narrow window makes room rather than refusing
  it("never auto-collapses the side that was just expanded", () => {
    const result = arbitratePanels({
      windowWidth: 1000,
      left: expanded(),
      right: expanded(),
      protectedSide: "left",
    });
    expect(result.left.collapsed).toBe(false); // the expand is honoured
    // The other panel yields — reduced first, and auto-collapsed when that is
    // not enough, which is reversible.
    expect(result.right.effectiveWidth === PANEL_MIN || result.right.auto).toBe(true);
  });
});

describe("Workspace — the arbitration is wired to the live window width", () => {
  // Scenario: Narrowing the window collapses the left panel before the right
  it("narrowing the window collapses the left panel first and widening brings it back", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));
    expect(useCbe.getState().leftPanelCollapsed).toBe(false);
    expect(useCbe.getState().panelCollapsed).toBe(false);

    resizeTo(900);
    expect(useCbe.getState().leftPanelCollapsed).toBe(true);
    expect(useCbe.getState().leftPanelAutoCollapsed).toBe(true);
    expect(useCbe.getState().panelCollapsed).toBe(false); // the canvas stays

    resizeTo(1400);
    expect(useCbe.getState().leftPanelCollapsed).toBe(false); // reversible
    expect(useCbe.getState().leftPanelAutoCollapsed).toBe(false);
  });

  // Scenario: Widening restores only what the app collapsed
  it("widening does not re-open a panel the lecturer collapsed", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    expect(useCbe.getState().panelAutoCollapsed).toBe(false);

    resizeTo(900);
    resizeTo(1600);
    expect(useCbe.getState().panelCollapsed).toBe(true); // still put away
  });

  // Scenario: The canvas reveal makes room rather than being suppressed. The
  // reveal is an expansion the APP performs; it is protected exactly like one the
  // lecturer performs, and the left panel yields for it.
  it("an app-performed expansion is protected and the other panel yields", () => {
    setWindowWidth(1000);
    renderWorkspace();
    // Put the canvas panel away by hand first, then open the course panel — a
    // 1000px window has room for exactly one of them.
    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));
    expect(useCbe.getState().leftPanelCollapsed).toBe(false);

    // What the store does on the first artefact write of the conversation.
    act(() => {
      useCbe.getState().setPanelCollapsed(false);
    });
    expect(useCbe.getState().panelCollapsed).toBe(false); // never refused
    expect(useCbe.getState().leftPanelCollapsed).toBe(true); // yielded…
    expect(useCbe.getState().leftPanelAutoCollapsed).toBe(true); // …reversibly
  });
});
