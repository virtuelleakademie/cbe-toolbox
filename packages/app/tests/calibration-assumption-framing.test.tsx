/**
 * Assumption-framing tests — capability `desktop-app`, Requirement: Inferred
 * Calibration Framed as an Overridable Assumption (change
 * `surface-calibration-assumptions`, UX finding #19 "agent legibility").
 *
 * An inferred value is durable in the Profile Panel, not in completed chat.
 * Current-turn technical detail may show the call while it is deliberately open.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { ProfilePanel } from "../src/renderer/components/ProfilePanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import type { LecturerProfile } from "../src/shared/ipc-contract.js";
import { emitAgentEvent, TEST_SESSION_ID } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";

beforeEach(() => {
  seedConversation();
  useCbe.setState({ lecturerProfile: {} });
});

afterEach(() => {
  useCbe.getState().reset();
});

describe("Inferred Calibration Framed as an Overridable Assumption", () => {
  it("completed chat does not retain a Profile execution card", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: {
        toolCallId: "profile-1",
        toolName: "cbe_profile",
        args: { dimension: "capacity", value: "limited", confidence: "medium", evidence: "turn 3" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    expect(container.querySelector(".tool-card")).toBeTruthy();
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "profile-1", toolName: "cbe_profile", result: "accepted", isError: false },
    });
    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });
    expect(container.querySelector(".tool-card")).toBeNull();
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(document.body.textContent).not.toContain("capacity → limited");
  });

  // Scenario: Profile Panel frames inferred values as assumptions
  it("Profile Panel frames inferred values as assumptions", async () => {
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
    Object.assign(window.cbe, { getLecturerProfile: async () => stored });
    const { container } = render(<ProfilePanel />);
    await waitFor(() => expect(screen.getByText("PBL prior knowledge")).toBeTruthy());

    // The estimate-provenance dimension carries the assumption framing…
    const estimateRow = container.querySelector('.profile-dim[data-dimension="pbl-prior-knowledge"]');
    const note = estimateRow!.querySelector(".profile-dim-assumption");
    expect(note).not.toBeNull();
    // …conveying: inferred assumption (not a fixed fact), overridable right here.
    expect(note!.textContent).toMatch(/assumption/i);
    expect(note!.textContent).toMatch(/conversation/i);
    expect(note!.textContent).toMatch(/override/i);

    // Visually distinct from an override-provenance value: the override row has
    // no assumption note (it shows "set by you" instead), and only estimate rows
    // carry the note at all.
    const overrideRow = container.querySelector('.profile-dim[data-dimension="capacity"]');
    expect(overrideRow!.querySelector(".profile-dim-assumption")).toBeNull();
    expect(overrideRow!.textContent).toContain("set by you");
    expect(container.querySelectorAll(".profile-dim-assumption").length).toBe(1);
  });

  it("not-yet-estimated dimensions get no assumption note (nothing is inferred yet)", async () => {
    Object.assign(window.cbe, { getLecturerProfile: async () => ({}) });
    const { container } = render(<ProfilePanel />);
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    expect(container.querySelectorAll(".profile-dim-assumption").length).toBe(0);
  });
});
