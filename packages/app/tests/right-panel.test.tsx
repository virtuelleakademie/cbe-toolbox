/**
 * Tests for the collapsible right panel (capability `desktop-app`, Requirement:
 * Collapsible Right Panel). Every Scenario in the spec delta has a matching test:
 *   - The right panel carries exactly the two course surfaces
 *   - The rail and the tab bar carry the CBE surface names
 *   - Panel is expanded on the canvas tab by default
 *   - Collapse state still re-defaults on a fresh mount
 *   - Clicking a rail icon expands to that tab
 *   - Edge toggle collapses an expanded panel
 *   - Edge toggle expands to the last-active tab
 *   - Tab selection is preserved across collapse and expand
 *   - Rail and toggle are accessible
 * Plus a store-slice unit test for the `panelCollapsed` flag.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { RightPanel } from "../src/renderer/components/RightPanel.js";
import { Workspace } from "../src/renderer/components/Workspace.js";

beforeEach(() => {
  useCbe.getState().reset(); // re-seeds; sets panelCollapsed back to false (expanded)
  useCbe.getState().setPanelTab("artifacts");
});

describe("store slice — panelCollapsed", () => {
  // Scenario: Panel is expanded on the canvas tab by default (the store half —
  // the product authority swapped the mount defaults on 2026-08-14).
  it("defaults to expanded on the canvas tab", () => {
    expect(useCbe.getState().panelCollapsed).toBe(false);
    expect(useCbe.getState().panelTab).toBe("artifacts");
  });

  it("setPanelCollapsed and togglePanelCollapsed flip the flag", () => {
    useCbe.getState().setPanelCollapsed(true);
    expect(useCbe.getState().panelCollapsed).toBe(true);
    useCbe.getState().togglePanelCollapsed();
    expect(useCbe.getState().panelCollapsed).toBe(false);
    useCbe.getState().togglePanelCollapsed();
    expect(useCbe.getState().panelCollapsed).toBe(true);
  });

  it("setPanelTab is independent of panelCollapsed", () => {
    useCbe.getState().setPanelCollapsed(true);
    useCbe.getState().setPanelTab("maturity");
    expect(useCbe.getState().panelCollapsed).toBe(true); // unchanged
    expect(useCbe.getState().panelTab).toBe("maturity");
  });

  // Scenario: Collapse state still re-defaults on a fresh mount. `reset()` is the
  // store's fresh-mount equivalent — the state is never persisted, so a restart
  // cannot bring a collapse back.
  it("a fresh mount re-defaults to expanded on the canvas tab after a collapse", () => {
    useCbe.getState().setPanelCollapsed(true);
    useCbe.getState().setPanelTab("maturity");
    useCbe.getState().reset();
    expect(useCbe.getState().panelCollapsed).toBe(false);
  });
});

describe("Workspace — grid collapse attribute", () => {
  // The grid column widths (chat gets a collapsed panel's freed space) are driven
  // by the workspace grid. `data-collapsed` must reflect the store on EVERY host
  // surface, so the attribute is owned by <Workspace>, not duplicated per call site.
  it("reflects the right panel's expanded default and flips with the store", () => {
    const { container, rerender } = render(
      <Workspace>
        <div />
      </Workspace>
    );
    const ws = container.querySelector(".workspace") as HTMLElement;
    expect(ws.getAttribute("data-collapsed")).toBe("false");
    // The left panel is the mirror: collapsed on mount, its own attribute.
    expect(ws.getAttribute("data-left-collapsed")).toBe("true");

    useCbe.getState().setPanelCollapsed(true);
    rerender(
      <Workspace>
        <div />
      </Workspace>
    );
    expect(ws.getAttribute("data-collapsed")).toBe("true");
  });

  // The grid takes no caller-supplied className any more. It had exactly one
  // consumer left — the stage-1 bridge's `workspace-hidden`, which hid the
  // workspace while Profile or Settings was open. The Profile-and-Settings
  // overlay is drawn OVER the workspace instead, so nothing hides it and the
  // escape hatch is gone with the bridge (Requirement: Profile-and-Settings
  // Overlay — "the chat column and the two panels keep their widths and states
  // underneath it").
  it("takes no caller-supplied className — nothing may restyle or hide the grid from outside", () => {
    expect(Workspace.length).toBe(1); // one props object…
    const { container } = render(
      // @ts-expect-error — the prop no longer exists; a re-added className must
      // be a visible signature change, not a silent one.
      <Workspace className="workspace-hidden">
        <div />
      </Workspace>
    );
    const ws = container.querySelector(".workspace") as HTMLElement;
    expect(ws.className).toBe("workspace");
    expect(ws.getAttribute("data-collapsed")).toBe("false");
  });
});

describe("RightPanel — the two course surfaces", () => {
  // Scenario: Panel is expanded on the canvas tab by default
  it("renders expanded with its tab bar and the canvas tab active on mount", () => {
    render(<RightPanel />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "CBE Process Canvas" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("navigation", { name: /right panel tabs/i })).toBeNull();
  });

  // Scenario: The right panel carries exactly the two course surfaces
  it("offers exactly two tabs in the order CBE Process Canvas, CBE Maturity — expanded and collapsed", () => {
    render(<RightPanel />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["CBE Process Canvas", "CBE Maturity"]);
    // No Courses, Profile or Settings tab: those surfaces live elsewhere now.
    for (const gone of [/^Courses$/, /^Profile$/, /^Settings$/]) {
      expect(screen.queryByRole("tab", { name: gone })).toBeNull();
    }

    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    const rail = screen.getByRole("navigation", { name: /right panel tabs/i });
    expect(rail.querySelectorAll(".panel-rail-btn").length).toBe(2);
    expect(screen.getByRole("button", { name: /open cbe process canvas/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open cbe maturity/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open courses/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open settings/i })).toBeNull();
  });

  // Scenario: The rail and the tab bar carry the CBE surface names
  it("names both surfaces in full and nowhere reads Artifacts", () => {
    const { container } = render(<RightPanel />);
    // The panel's own heading names the active surface in full.
    expect(container.querySelector("h2")?.textContent).toBe("CBE Process Canvas");
    fireEvent.click(screen.getByRole("tab", { name: "CBE Maturity" }));
    expect(container.querySelector("h2")?.textContent).toBe("CBE Maturity");
    // One negative assertion over the whole panel, so a regression trips it —
    // including in the rail's accessible names and titles.
    const panel = container.querySelector(".panel") as HTMLElement;
    expect(panel.innerHTML).not.toMatch(/Artefakte|Artefacts|Artifacts/);
  });

  // Scenario: Clicking a rail icon expands to that tab
  it("clicking the CBE Maturity rail icon expands the panel and activates that tab", () => {
    render(<RightPanel />);
    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /open cbe maturity/i }));

    expect(useCbe.getState().panelCollapsed).toBe(false);
    expect(useCbe.getState().panelTab).toBe("maturity");
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /right panel tabs/i })).toBeNull();
    expect(screen.getByRole("tab", { name: "CBE Maturity" }).getAttribute("aria-selected")).toBe("true");
  });

  // Scenario: Edge toggle collapses an expanded panel
  it("the edge toggle collapses an expanded panel back to the rail", () => {
    render(<RightPanel />);
    expect(screen.getByRole("tablist")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    expect(useCbe.getState().panelCollapsed).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("navigation", { name: /right panel tabs/i })).toBeTruthy();
  });

  // Scenario: Edge toggle expands to the last-active tab
  it("the edge toggle re-expands to the last-active tab (CBE Maturity)", () => {
    render(<RightPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "CBE Maturity" }));
    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /expand right panel/i }));

    expect(useCbe.getState().panelCollapsed).toBe(false);
    expect(screen.getByRole("tab", { name: "CBE Maturity" }).getAttribute("aria-selected")).toBe("true");
  });

  // Scenario: Tab selection is preserved across collapse and expand
  it("preserves the active tab across a collapse / expand cycle", () => {
    render(<RightPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "CBE Maturity" }));
    fireEvent.click(screen.getByRole("button", { name: /collapse right panel/i }));
    fireEvent.click(screen.getByRole("button", { name: /expand right panel/i }));

    expect(useCbe.getState().panelTab).toBe("maturity");
    expect(screen.getByRole("tab", { name: "CBE Maturity" }).getAttribute("aria-selected")).toBe("true");
  });

  // Scenario: Rail and toggle are accessible
  it("rail buttons name their tab and the edge toggle exposes aria-expanded + an action name", () => {
    render(<RightPanel />);
    const collapseBtn = screen.getByRole("button", { name: /collapse right panel/i });
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(collapseBtn);
    for (const name of [/open cbe process canvas/i, /open cbe maturity/i]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /expand right panel/i }).getAttribute("aria-expanded")).toBe("false");
  });
});
