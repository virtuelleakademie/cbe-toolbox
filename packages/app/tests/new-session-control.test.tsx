/**
 * "New Session" control with canvas carry-over (change `add-new-session-keep-canvas`;
 * capability `desktop-app`, Requirement: New Session Control With Canvas Carry-Over).
 * Supersedes the interim control tests from `one-conversation-per-course`. The
 * confirmation copy is the SHORT form since `resume-course-conversations`: the two
 * kept panel surfaces plus the resume route via Courses — no file name, no path
 * (the retired conversation is findable by being listed in the Chats tab, not by
 * its UUID file name). One test per renderer Scenario:
 *
 * - "New Session clears the chat but keeps the canvas"
 * - "Confirmation is short, names the kept panels, and points at Courses"
 *   (change `resume-course-conversations`)
 * - "Initializing state bridges the reset gap"
 * - "Fresh-session start failure shows a recoverable error state"
 * - "Control is disabled while the agent is streaming"
 * - "Composer is ready after the reset"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewSessionControl } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { type ConversationOpenResult } from "../src/shared/ipc-contract.js";

const carriedCanvas = [
  {
    step: 4 as const,
    id: "challenge",
    label: "Challenge",
    value: "Massnahme fuers Quartier entwickeln",
    state: "draft" as const,
  },
];

function openResult(sessionId: string, overrides?: Partial<ConversationOpenResult>): ConversationOpenResult {
  return {
    session: {
      sessionId,
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/w", corpus: "/c" },
      courseId: "algorithmen",
    },
    turns: [],
    agentRunning: false,
    canvas: [],
    ...overrides,
  };
}

/** The step-4 "challenge" row of the visible canvas state. */
function challengeRow() {
  const step4 = useCbe.getState().artifacts.find((g) => g.step === 4);
  return step4?.items.find((i) => i.id === "challenge");
}

beforeEach(() => {
  useCbe.setState({ session: null, turns: [], hydration: "ready" });
});

afterEach(() => {
  cleanup();
  useCbe.setState({ session: null, turns: [], hydration: "idle" });
});

describe("Scenario: New Session clears the chat but keeps the canvas", () => {
  it("after confirming, the transcript is empty and the canvas rows keep label/value/state", async () => {
    // A running conversation with turns AND a populated canvas artefact.
    useCbe.getState().hydrateConversation(
      openResult("conv-old", {
        turns: [
          { role: "user", text: "hello" },
          { role: "assistant", text: "hi" },
        ],
        canvas: carriedCanvas,
      })
    );
    expect(useCbe.getState().turns.length).toBe(2);
    expect(challengeRow()?.value).toBe("Massnahme fuers Quartier entwickeln");

    // The fresh result mirrors the pre-seeded host mirror: canvas carried, no turns.
    const freshConversation = vi.fn(async () => openResult("conv-new", { canvas: carriedCanvas }));
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));

    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-new"));
    // Chat cleared…
    expect(useCbe.getState().turns).toEqual([]);
    // …canvas kept: same artefact, unchanged label, value, and state.
    const row = challengeRow();
    expect(row).toMatchObject({ label: "Challenge", value: "Massnahme fuers Quartier entwickeln", state: "draft" });
  });
});

describe("Scenario: Confirmation is short, names the kept panels, and points at Courses", () => {
  it("short copy: panel-vocabulary labels, resume route via Courses, no file name or path", async () => {
    const freshConversation = vi.fn(async () => openResult("conv-new"));
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    expect(freshConversation).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    // Short English copy: the two kept surfaces by their labels, and the resume
    // route — the whole disclosure (Requirement: New Session Control With Canvas
    // Carry-Over, confirmation copy).
    expect(dialog.textContent).toMatch(/Start a new session\?/);
    expect(dialog.textContent).toMatch(/CBE Process Canvas and CBE\s+Maturity entries are preserved/);
    expect(dialog.textContent).toMatch(/resume this\s+conversation anytime from Courses/);
    // No file name, path or sidecar mechanics; no retired label; New Session is a
    // CONTEXT reset — nothing is claimed as cleared.
    expect(dialog.textContent).not.toContain(".md");
    expect(dialog.textContent).not.toMatch(/folder/i);
    expect(dialog.textContent).not.toMatch(/Artefacts|Artifacts|Artefakte/);
    expect(dialog.textContent).not.toMatch(/cleared/i);

    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    await waitFor(() => expect(freshConversation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-new"));
  });

  // Scenario: Initializing state bridges the reset gap
  it("shows an explicit initializing state between confirm and session-ready", async () => {
    let resolveFresh!: (v: ConversationOpenResult) => void;
    const freshConversation = vi.fn(() => new Promise<ConversationOpenResult>((res) => (resolveFresh = res)));
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    // The gap renders an explicit English initializing state, not an idle UI.
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Starting new session…/);

    resolveFresh(openResult("conv-new"));
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-new"));
    // Initializing state clears when the fresh session is ready.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "New Session" })).toBeTruthy();
  });

  it("dismiss leaves the session untouched — no IPC call", () => {
    const freshConversation = vi.fn(async () => openResult("conv-new"));
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(freshConversation).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "New Session" })).toBeTruthy();
  });
});

describe("Scenario: Fresh-session start failure shows a recoverable error state", () => {
  it("renders the English error state with retry; retry re-attempts and hydrates on success", async () => {
    let attempts = 0;
    const freshConversation = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error(en.mainFreshStartFailedNotice);
      return openResult("conv-recovered", { canvas: carriedCanvas });
    });
    const onError = vi.fn();
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));

    // The failure renders the inline recoverable state (not the generic notice):
    // previous conversation named as safely saved, retry affordance present.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be started/);
    expect(alert.textContent).toMatch(/safely saved/);
    // The secondary line points at Courses — no file name or path (Requirement:
    // New Session Control With Canvas Carry-Over, Failure path).
    expect(alert.textContent).toMatch(/in Courses/);
    expect(alert.textContent).not.toContain(".md");
    expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/could not be started/));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-recovered"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(freshConversation).toHaveBeenCalledTimes(2);
  });

  it("a main-side mid-turn refusal still surfaces through onError (not the retry state)", async () => {
    const freshConversation = vi.fn(async () => {
      throw new Error("The agent is still working — wait for the turn to finish.");
    });
    const onError = vi.fn();
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/still working/)));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useCbe.getState().session).toBeNull();
  });
});

describe("Scenario: Control is disabled while the agent is streaming", () => {
  it("is disabled with the visible lock reason while locked (same lock lifecycle as the composer)", () => {
    // ChatPanel binds `locked` to the SAME `isLocked` the composer uses
    // (submitting || live.streaming, armed by agent_start/agent_end) — see
    // composer-lock.test.tsx for the lifecycle itself.
    render(<NewSessionControl locked={true} onError={() => {}} />);
    const btn = screen.getByRole("button", { name: "New Session" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe(en.chatNewSessionLockedReason);
  });
});

describe("Scenario: Composer is ready after the reset", () => {
  it("after the reset the store reports no running agent and an empty transcript — the composer lock releases", async () => {
    const freshConversation = vi.fn(async () => openResult("conv-new", { canvas: carriedCanvas }));
    Object.assign(window.cbe, { freshConversation });
    render(<NewSessionControl locked={false} onError={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-new"));

    // The composer lock derives from these (isLocked = submitting || live.streaming;
    // agentRunning mirrors live.streaming): both released → composer unlocked and
    // accepting input for the fresh session.
    const s = useCbe.getState();
    expect(s.agentRunning).toBe(false);
    expect(s.live.streaming).toBe(false);
    expect(s.turns).toEqual([]);
  });
});
