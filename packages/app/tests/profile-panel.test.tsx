/**
 * Profile Panel tests — capability `desktop-app`, Requirement: Profile Panel.
 * Test names mirror the spec scenarios. jsdom + @testing-library/react; the
 * preload bridge is stubbed in vitest.setup.ts and overridden per test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ProfilePanel } from "../src/renderer/components/ProfilePanel.js";
import { applyProfileFromToolResult } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import type { LecturerProfile } from "../src/shared/ipc-contract.js";

const stored: LecturerProfile = {
  "pbl-prior-knowledge": {
    value: "pronounced",
    confidence: "high",
    evidence: "described a complete PBL sequence they ran",
    provenance: "estimate",
    lastRevised: "2026-06-10T09:00:00.000Z",
  },
  capacity: {
    value: "limited",
    confidence: "medium",
    evidence: "set by the lecturer in the Profile Panel",
    provenance: "override",
    lastRevised: "2026-06-10T09:05:00.000Z",
  },
};

beforeEach(() => {
  useCbe.setState({ lecturerProfile: {} });
});

describe("Profile Panel", () => {
  // Scenario: Panel renders the persisted profile on app start
  it("renders the persisted profile on mount, with not-yet-estimated for absent dimensions", async () => {
    Object.assign(window.cbe, { getLecturerProfile: async () => stored });
    render(<ProfilePanel />);
    await waitFor(() => {
      expect(screen.getByText("PBL prior knowledge")).toBeTruthy();
    });
    // Stored dimension: value, confidence, evidence, last-revised.
    expect(screen.getByText("confidence · high")).toBeTruthy();
    expect(screen.getByText("described a complete PBL sequence they ran")).toBeTruthy();
    expect(screen.getByText(/last revised: 2026-06-10T09:00:00.000Z/)).toBeTruthy();
    // Overridden dimension is visually distinguishable.
    expect(screen.getByText("set by you")).toBeTruthy();
    // Absent dimensions render the cold-start state.
    expect(screen.getAllByText("not yet estimated").length).toBe(3);
  });

  // Scenario: Panel renders the persisted profile on app start (empty-control half)
  it("renders an empty value control for not-yet-estimated dimensions", async () => {
    Object.assign(window.cbe, { getLecturerProfile: async () => stored });
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(3));
    // No stored record: the control carries no value and is marked empty.
    const empty = screen.getByLabelText("Override Didactic stance") as HTMLSelectElement;
    expect(empty.value).toBe("");
    expect(empty.dataset.empty).toBe("true");
    // Stored record: the control shows the value and is not marked empty.
    const filled = screen.getByLabelText("Override PBL prior knowledge") as HTMLSelectElement;
    expect(filled.value).toBe("pronounced");
    expect(filled.dataset.empty).toBeUndefined();
  });

  // Scenario: Panel updates live from a cbe_profile tool call
  it("updates live when a cbe_profile tool result is consumed", async () => {
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    act(() => {
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "cbe-prior-knowledge",
            value: "some",
            confidence: "low",
            evidence: "uses 'challenge' but not 'Big Idea'",
          },
        },
        false
      );
    });
    await waitFor(() => expect(screen.getByText("confidence · low")).toBeTruthy());
    expect(screen.getByText("uses 'challenge' but not 'Big Idea'")).toBeTruthy();
    expect(screen.getAllByText("not yet estimated").length).toBe(4);
  });

  it("ignores refusals, errored calls, and foreign tool results (safe no-op)", async () => {
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    act(() => {
      applyProfileFromToolResult({ details: { kind: "profile-refusal" } }, false);
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "capacity",
            value: "limited",
            confidence: "low",
            evidence: "x",
          },
        },
        true // errored call
      );
      applyProfileFromToolResult({ details: { kind: "canvas-update", phase: "engage" } }, false);
    });
    expect(screen.getAllByText("not yet estimated").length).toBe(5);
  });

  // Scenario: Manual override is persisted and takes precedence (renderer half)
  it("submits a manual override via IPC and renders the override distinctly", async () => {
    const calls: Array<{ dimension: string; value: string }> = [];
    Object.assign(window.cbe, {
      getLecturerProfile: async () => ({}),
      overrideLecturerProfile: async (payload: { dimension: string; value: string }) => {
        calls.push(payload);
        const profile: LecturerProfile = {
          capacity: {
            value: payload.value,
            confidence: "high",
            evidence: "set by the lecturer in the Profile Panel",
            provenance: "override",
            lastRevised: "2026-06-11T14:00:00.000Z",
          },
        };
        return { ok: true, profile };
      },
    });
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    fireEvent.change(screen.getByLabelText("Override Teaching load / capacity"), {
      target: { value: "headroom" },
    });
    await waitFor(() => expect(screen.getByText("set by you")).toBeTruthy());
    expect(calls).toEqual([{ dimension: "capacity", value: "headroom" }]);
    // A later estimate does not displace the override in the live slice.
    act(() => {
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "capacity",
            value: "saturated",
            confidence: "high",
            evidence: "y",
          },
        },
        false
      );
    });
    expect(screen.getByText("set by you")).toBeTruthy();
    expect((screen.getByLabelText("Override Teaching load / capacity") as HTMLSelectElement).value).toBe("headroom");
  });

  // Scenario: Manual override is persisted and takes precedence (rejection half)
  it("reports a rejected override inside the dimension group, not beside the lecturer's own fields", async () => {
    Object.assign(window.cbe, {
      getLecturerProfile: async () => ({}),
      getLecturerIdentity: async () => ({ name: "Sam Oyelaran" }),
      overrideLecturerProfile: async () => ({ ok: false, profile: {} as LecturerProfile }),
    });
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    fireEvent.change(screen.getByLabelText("Override Teaching load / capacity"), {
      target: { value: "headroom" },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Override was rejected/);
    // The message belongs to the dropdown that produced it. Rendered above this
    // group it would raise an alert beside the lecturer's own two fields about a
    // rejection that has nothing to do with them.
    expect(screen.getByTestId("profile-dimensions").contains(alert)).toBe(true);
    expect(screen.getByTestId("profile-identity").contains(alert)).toBe(false);
  });

  // Scenario: Rejected estimate is surfaced to the agent, panel unchanged (panel half)
  it("keeps the override marking and value when an unconfirmed estimate arrives", async () => {
    Object.assign(window.cbe, { getLecturerProfile: async () => stored });
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getByText("set by you")).toBeTruthy());
    act(() => {
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "capacity",
            value: "saturated",
            confidence: "medium",
            evidence: "turn 4: mentioned three parallel modules",
          },
        },
        false
      );
    });
    expect(screen.getByText("set by you")).toBeTruthy();
    expect((screen.getByLabelText("Override Teaching load / capacity") as HTMLSelectElement).value).toBe("limited");
  });

  // Scenario: Confirmed revision clears the override marking in the panel
  it("clears the override marking and shows the revised estimate on a lecturer-confirmed revision", async () => {
    Object.assign(window.cbe, { getLecturerProfile: async () => stored });
    render(<ProfilePanel />);
    await waitFor(() => expect(screen.getByText("set by you")).toBeTruthy());
    act(() => {
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "capacity",
            value: "headroom",
            confidence: "medium",
            evidence: "turn 6: lecturer confirmed the revision",
            lecturerConfirmed: true,
          },
        },
        false
      );
    });
    await waitFor(() => expect(screen.queryByText("set by you")).toBeNull());
    expect((screen.getByLabelText("Override Teaching load / capacity") as HTMLSelectElement).value).toBe("headroom");
    expect(screen.getByText("confidence · medium")).toBeTruthy();
    expect(screen.getByText("turn 6: lecturer confirmed the revision")).toBeTruthy();
  });
});
