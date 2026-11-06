/**
 * Wave-B renderer fixes (change `harden-canvas-determinism-and-ux2-fixes`).
 *
 * capability `desktop-app`, Requirement: Collected UX-2 Fixes — Scenarios:
 * - The Decisions section shows an honest empty state while it has no producer
 * - A disabled "Assess maturity" control states why it is disabled
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ArtifactsPanel } from "../src/renderer/components/ArtifactsPanel.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import { SAMPLE_DIDACTIC_CHECKS } from "./fixtures/decisions.js";

beforeEach(() => {
  useCbe.getState().reset();
  Object.assign(window, { cbe: { ...(window as { cbe?: object }).cbe } });
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

// Scenario: The Decisions section shows an honest empty state while it has no producer
describe("The Decisions section shows an honest empty state while it has no producer", () => {
  it("names the empty state in English and renders no entry scaffold", () => {
    const { container } = render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));

    const body = container.querySelector(".decisions-body")!;
    expect(body.textContent).toContain("No decisions have been recorded in this conversation yet");
    // No half-filled scaffold of "not-started" rows pretending to be state.
    expect(container.querySelector('[data-entry="module-goals"]')).toBeNull();
    expect(container.querySelector('[data-entry="alignment-status"]')).toBeNull();
    expect(container.querySelector('[data-entry="delegation-decisions"]')).toBeNull();
  });

  it("renders the entries again as soon as decisions exist", () => {
    seedConversation({ session: testSession("s1", "c1"), didacticChecks: SAMPLE_DIDACTIC_CHECKS });
    const { container } = render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));

    expect(container.querySelector(".decisions-empty")).toBeNull();
    expect(container.querySelector('[data-entry="module-goals"]')).toBeTruthy();
  });
});

// Scenario: A disabled "Assess maturity" control states why it is disabled
describe('A disabled "Assess maturity" control states why it is disabled', () => {
  it("distinguishes the no-session case and exposes the reason to assistive tech", () => {
    // No session open: the control is disabled for a different reason than a run lock.
    const { container } = render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toContain("No conversation is open yet");
    // Keyboard path: a disabled button is not focusable, so the reason is rendered as
    // text and wired via aria-describedby rather than hidden behind hover alone.
    const reasonId = btn.getAttribute("aria-describedby")!;
    expect(reasonId).toBeTruthy();
    const reason = container.querySelector(`#${reasonId}`)!;
    expect(reason.textContent).toContain("No conversation is open yet");
  });

  it("names the run lock while the agent is working", () => {
    seedConversation({ session: testSession("s1", "c1") });
    useCbe.setState({ agentRunning: true });

    render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/still working|agent/i);
    expect(screen.getByText(/still working|agent/i)).toBeTruthy();
  });

  it("carries no reason line when the control is usable", () => {
    seedConversation({ session: testSession("s1", "c1") });
    useCbe.setState({ agentRunning: false });

    const { container } = render(<MaturityPanel />);
    const btn = screen.getByRole("button", { name: /Assess maturity/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector(".maturity-assess-reason")).toBeNull();
  });
});

// capability `desktop-app`, Requirement: Collected UX-2 Fixes — Scenarios:
// - The CBE Process Canvas panel exposes an export control
// - The export control states why it is unavailable on an empty canvas
describe("The CBE Process Canvas panel exposes an export control", () => {
  it("is available with a filled canvas and starts the host-side export", async () => {
    seedConversation({ session: testSession("s1", "c1") });
    const exportDesignDocument = vi.fn().mockResolvedValue({ path: "/courses/c1/design.md" });
    Object.assign(window.cbe, { exportDesignDocument });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "Git in the times of AI" }));

    render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: /^Export$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(exportDesignDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Saved to \/courses\/c1\/design\.md/)).toBeTruthy();
  });

  // Scenario: The export control states why it is unavailable on an empty canvas
  it("names the reason on an empty canvas instead of being silently inert", () => {
    seedConversation({ session: testSession("s1", "c1") });
    const { container } = render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: /^Export$/ }) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/Nothing to export yet/);
    const reason = container.querySelector(`#${btn.getAttribute("aria-describedby")}`)!;
    expect(reason.textContent).toMatch(/Nothing to export yet/);
  });

  it("is locked with a stated reason while the agent runs", () => {
    seedConversation({ session: testSession("s1", "c1") });
    act(() => useCbe.getState().applyCanvasUpdate(4, undefined, "bigidea", { value: "x" }));
    useCbe.setState({ agentRunning: true });

    render(<ArtifactsPanel />);
    const btn = screen.getByRole("button", { name: /^Export$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/still working|agent/i);
  });
});
