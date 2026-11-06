/**
 * desktop-app spec, Requirement: Canvas Dialogue-Steering Dispatches Respect the Run
 * Lock — Scenarios: Iteration toolbar is disabled while the agent is streaming;
 * Double-click does not race past the lock; Failed dispatch leaves no phantom user
 * turn, not even after resume (renderer side); Step selection is not locked by a
 * running agent; Expanding a step group stays available during a run.
 *
 * Originally written for `fix-step-select-run-lock`, when the step-select affordance
 * WAS a dispatch surface. Since `host-sets-step-focus-from-canvas-click` it sets the
 * step focus in the host and dispatches no prompt at all, so it left this lock's scope
 * and the lock scenarios are carried by the iteration toolbar — the one canvas surface
 * that still dispatches. The step-select cases below assert the OPPOSITE of what they
 * used to: that the affordance stays active and reaches no dispatch path.
 *
 * The "Machine token does not resurface after re-entry" scenario is deliberately gone
 * from this file with the token that produced it; see the requirement's own note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { seedConversation, TEST_COURSE_ID } from "./helpers/conversation.js";
import type { AgentEvent } from "../src/shared/ipc-contract.js";

function startRun(sessionId = "test-session") {
  act(() => {
    useCbe.getState().ingestAgentEvent({ type: "agent_start", sessionId } as AgentEvent);
  });
}

function stepSelect(container: HTMLElement, step: number): HTMLButtonElement {
  return within(container.querySelector(`[data-step="${step}"]`) as HTMLElement).getByRole("button", {
    name: new RegExp(`Focus on step ${step}`),
  }) as HTMLButtonElement;
}

function withAnnotation() {
  useCbe.setState({
    annotations: [{ id: "a1", artifactId: "bigidea", excerpt: "x", note: "sharpen" }],
  });
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
  useCbe.setState({ activeCourseId: TEST_COURSE_ID, annotations: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Canvas dialogue-steering dispatches respect the run lock", () => {
  // Scenario: Iteration toolbar is disabled while the agent is streaming
  it("disables the iteration toolbar during a run: no dispatch, no turn, no error, reason tooltip", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    withAnnotation();
    const { container } = render(<ArtifactsPanel />);
    startRun();
    const btn = container.querySelector(".iterate-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(en.errorRunLockedReason);
    fireEvent.click(btn);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
    expect(useCbe.getState().chatNotice).toBeNull();
    expect(useCbe.getState().error).toBeNull();
  });

  // Scenario: Double-click does not race past the lock
  it("a rapid second click is a locked no-op — one dispatch, no busy notice", async () => {
    let resolveSend!: (v: { ok: true }) => void;
    const sendSpy = vi
      .spyOn(window.cbe, "sendPrompt")
      .mockImplementation(() => new Promise((res) => (resolveSend = res)));
    withAnnotation();
    const { container } = render(<ArtifactsPanel />);
    const btn = () => container.querySelector(".iterate-btn") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn());
    });
    // The dispatch-in-flight flag engages synchronously — before any agent_start event.
    expect(btn().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(btn());
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(useCbe.getState().chatNotice).toBeNull();
    await act(async () => {
      resolveSend({ ok: true });
    });
  });

  // Scenario: Failed dispatch leaves no phantom user turn, not even after resume
  // (renderer side: the notice is soft and catalog-English, never the alarm banner)
  it("shows the soft English notice on rejection, not the banner, and leaves no user turn", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(
      new Error(
        "Error invoking remote method 'cbe:prompt': Error: Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
      )
    );
    withAnnotation();
    const { container } = render(<ArtifactsPanel />);
    await act(async () => {
      fireEvent.click(container.querySelector(".iterate-btn") as HTMLButtonElement);
    });
    const state = useCbe.getState();
    // No phantom user turn survives the rejection.
    expect(state.turns.filter((t) => t.role === "user").length).toBe(0);
    // Soft notice with catalog copy — English, no transport prefix, no runtime API vocabulary.
    expect(state.chatNotice?.text).toBe(en.errorBusyNoticeText);
    expect(state.chatNotice?.text).not.toMatch(/invoking remote method|streamingBehavior|steer|followUp/);
    expect(state.chatNotice?.hint ?? "").not.toMatch(/streamingBehavior|Pi/);
    // The alarm banner stays untouched.
    expect(state.error).toBeNull();
    // The lock releases after the settled dispatch.
    expect((container.querySelector(".iterate-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  // Scenario: Step selection is not locked by a running agent
  it("keeps step select active during a run and reaches no dispatch path", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const focusSpy = vi.spyOn(window.cbe, "focusStep").mockResolvedValue({ ok: true });
    const { container } = render(<ArtifactsPanel />);
    startRun();
    const select = stepSelect(container, 5);
    expect(select.disabled).toBe(false);
    expect(select.title).not.toBe(en.errorRunLockedReason);
    await act(async () => {
      fireEvent.click(select);
    });
    // The focus moved; nothing was dispatched and no turn was created.
    expect(container.querySelector('[data-step="5"]')?.getAttribute("data-focus")).toBe("true");
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
    expect(useCbe.getState().chatNotice).toBeNull();
    expect(useCbe.getState().error).toBeNull();
  });

  // Scenario: Expanding a step group stays available during a run
  it("keeps the accordion interactive while the run lock is engaged", () => {
    const { container } = render(<ArtifactsPanel />);
    startRun();
    const head = container.querySelector('[data-step="3"] .step-head') as HTMLElement;
    fireEvent.click(head);
    expect(container.querySelector('[data-step="3"] .step-body')).not.toBeNull();
  });
});
