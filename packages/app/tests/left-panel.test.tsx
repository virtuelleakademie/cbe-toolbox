/**
 * Tests for the collapsible left panel (capability `desktop-app`, Requirement:
 * Collapsible Left Panel) — the peer of the right panel, clause by clause. Every
 * Scenario in the spec delta has a matching test:
 *   - The workspace opens with the course rail closed and the canvas panel open
 *   - Rail icon expands the collapsed left panel
 *   - Edge toggle collapses and re-expands the left panel
 *   - The panel's level survives a collapse cycle
 *   - Left panel width persists across restart, collapse state does not
 *   - Left rail and toggle are accessible
 *   - The two panels are independent
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import { RightPanel } from "../src/renderer/components/RightPanel.js";
import { Workspace } from "../src/renderer/components/Workspace.js";
import { PANEL_DEFAULT, RAIL_WIDTH, SPLIT_STORAGE_KEYS } from "../src/renderer/util/panelSplit.js";

const COURSES = [
  { id: "cbe-101", title: "CBE 101", path: "/tmp/cbe-101", atomCount: 2 },
  { id: "design-lab", title: "Design Lab", path: "/tmp/design-lab", atomCount: 0 },
];

function setWindowWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ courses: COURSES, activeCourseId: "cbe-101" });
  Object.assign(window.cbe, {
    listCourses: vi.fn(async () => ({ courses: COURSES, activeCourseId: "cbe-101" })),
    revealCourse: vi.fn(async () => undefined),
  });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SPLIT_STORAGE_KEYS.left);
  setWindowWidth(1024);
  useCbe.getState().reset();
});

describe("LeftPanel — collapse / expand", () => {
  // Scenario: The workspace opens with the course rail closed and the canvas
  // panel open (both halves in one place, because the assertion is about the pair).
  it("mounts with the left panel at its rail and the right panel expanded on the canvas", () => {
    const { container } = render(
      <Workspace>
        <LeftPanel />
        <div />
        <RightPanel />
      </Workspace>
    );
    expect(useCbe.getState().leftPanelCollapsed).toBe(true);
    expect(screen.getByRole("navigation", { name: /left panel/i })).toBeTruthy();
    // The full panel content is NOT in the DOM while collapsed.
    expect(container.querySelector(".courses-panel")).toBeNull();
    // …while the right panel is open on its canvas tab.
    expect(screen.getByRole("tab", { name: "CBE Process Canvas" }).getAttribute("aria-selected")).toBe("true");
    const ws = container.querySelector(".workspace") as HTMLElement;
    expect(ws.style.gridTemplateColumns.startsWith(`${RAIL_WIDTH}px`)).toBe(true);
  });

  // Scenario: Rail icon expands the collapsed left panel
  it("activating the Courses rail icon expands the panel and renders the course surface", () => {
    const { container } = render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open courses/i }));
    expect(useCbe.getState().leftPanelCollapsed).toBe(false);
    expect(container.querySelector(".courses-panel")).toBeTruthy();
  });

  it("the rail icon carries the lecturer's accent as the surface the rail opens", () => {
    const { container } = render(<LeftPanel />);
    const railBtn = container.querySelector(".panel-rail-btn") as HTMLElement;
    // The accent is applied by the same CSS rule as the right rail's selected
    // tab; the marker attribute is what the rule hangs off.
    expect(railBtn.getAttribute("data-current")).toBe("true");
  });

  // Scenario: Edge toggle collapses and re-expands the left panel
  it("the edge toggle collapses to the rail and expands again — the right panel's behaviour", () => {
    const { container } = render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));
    expect(container.querySelector(".courses-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /collapse left panel/i }));
    expect(useCbe.getState().leftPanelCollapsed).toBe(true);
    expect(container.querySelector(".courses-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));
    expect(container.querySelector(".courses-panel")).toBeTruthy();
  });

  // Scenario: The panel's level survives a collapse cycle
  it("re-expands on the course detail level it was collapsed on", () => {
    render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open courses/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /course details/i })[0]!);
    expect(screen.getByRole("heading", { name: "CBE 101" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /collapse left panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));

    // Back on that course's detail level, not on the list.
    expect(screen.getByRole("heading", { name: "CBE 101" })).toBeTruthy();
    expect(useCbe.getState().courseDetailId).toBe("cbe-101");
  });

  // Scenario: Left panel width persists across restart, collapse state does not
  it("persists its width and re-defaults to collapsed on a fresh mount", () => {
    localStorage.setItem(SPLIT_STORAGE_KEYS.left, "352");
    useCbe.getState().setLeftPanelCollapsed(false);
    const first = render(
      <Workspace>
        <LeftPanel />
        <div />
        <div />
      </Workspace>
    );
    expect((first.container.querySelector(".workspace") as HTMLElement).style.gridTemplateColumns).toContain("352px");
    first.unmount();

    // "Restart": the store re-seeds from defaults, the width comes back from
    // localStorage. The asymmetry is deliberate and inherited from the right
    // panel — a width is an appearance preference, a collapse is a posture.
    useCbe.getState().reset();
    expect(useCbe.getState().leftPanelCollapsed).toBe(true);
    const second = render(
      <Workspace>
        <LeftPanel />
        <div />
        <div />
      </Workspace>
    );
    const ws = second.container.querySelector(".workspace") as HTMLElement;
    expect(ws.style.gridTemplateColumns.startsWith(`${RAIL_WIDTH}px`)).toBe(true);
    useCbe.getState().setLeftPanelCollapsed(false);
    second.rerender(
      <Workspace>
        <LeftPanel />
        <div />
        <div />
      </Workspace>
    );
    expect(ws.style.gridTemplateColumns).toContain("352px");
  });

  // Scenario: Left rail and toggle are accessible
  it("names the surface the rail opens and exposes aria-expanded on the edge toggle", () => {
    render(<LeftPanel />);
    const railBtn = screen.getByRole("button", { name: /open courses/i });
    expect(railBtn.tagName).toBe("BUTTON"); // keyboard-operable by construction

    const expand = screen.getByRole("button", { name: /expand left panel/i });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: /collapse left panel/i }).getAttribute("aria-expanded")).toBe("true");
  });

  // Scenario: The two panels are independent
  it("collapsing one panel changes neither the other's state nor its width", () => {
    // A window with room for both panels at once — otherwise the width
    // arbitration would legitimately be the thing moving them (its own tests
    // cover that), and this assertion is about independence, not arbitration.
    setWindowWidth(1400);
    const { container } = render(
      <Workspace>
        <LeftPanel />
        <div />
        <RightPanel />
      </Workspace>
    );
    fireEvent.click(screen.getByRole("button", { name: /expand left panel/i }));
    const ws = container.querySelector(".workspace") as HTMLElement;
    const rightTrackBefore = ws.style.gridTemplateColumns.split(" ").at(-1);

    fireEvent.click(screen.getByRole("button", { name: /collapse left panel/i }));
    expect(useCbe.getState().leftPanelCollapsed).toBe(true);
    expect(useCbe.getState().panelCollapsed).toBe(false); // untouched
    expect(ws.style.gridTemplateColumns.split(" ").at(-1)).toBe(rightTrackBefore);

    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    expect(useCbe.getState().panelCollapsed).toBe(true);
    expect(useCbe.getState().leftPanelCollapsed).toBe(true); // still its own state
    expect(useCbe.getState().courseDetailId).toBe(null); // no level was disturbed
  });

  it("the rail width is the default track before any width is chosen", () => {
    expect(PANEL_DEFAULT).toBeGreaterThan(RAIL_WIDTH);
  });

  // Only the header reveal is specified to move focus (Requirement: App Header
  // Strip). The panel body remounts on every expansion, so a request that is not
  // consumed exactly once re-fires on each of them.
  it("moves focus into the course list on a header reveal, and never on a plain expansion", () => {
    render(
      <>
        <AppHeader workspaceVisible configured />
        <LeftPanel />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: /show courses/i }));
    expect(document.activeElement).toBe(document.querySelector(".proj-open"));

    // Collapse, then re-expand by the edge toggle: the toggle itself keeps focus.
    fireEvent.click(screen.getByRole("button", { name: /collapse left panel/i }));
    const toggle = screen.getByRole("button", { name: /expand left panel/i });
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);

    // Collapse, then re-expand by the rail icon: focus stays on the rail button's
    // successor, not on a course card.
    fireEvent.click(screen.getByRole("button", { name: /collapse left panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /open courses/i }));
    expect(document.activeElement).not.toBe(document.querySelector(".proj-open"));

    // …and a SECOND reveal moves focus again — the request is a counter, not a flag.
    fireEvent.click(screen.getByRole("button", { name: /show courses/i }));
    expect(document.activeElement).toBe(document.querySelector(".proj-open"));
  });
});
