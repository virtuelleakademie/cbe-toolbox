/**
 * What the lecturer sees when they stop a running turn (capability
 * `desktop-app`, Requirement: *Composer Control Row*, § "What the stop does, and
 * what the lecturer is left with").
 *
 * One test per Scenario. The slot's two states themselves are asserted in
 * `composer-control-row.test.tsx`, beside the rest of that requirement's row;
 * everything here is about what the stop LEAVES BEHIND — the marked turn, the
 * released lock, the unrestored attachments, the absent cut-off and
 * provider-error states, the compaction refusal and the timed-out recovery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import {
  PENDING_ATTACHMENTS_SELECTOR,
  composerField,
  queryStopButton,
  sendButton,
  sendSlotState,
  stopButton,
} from "./helpers/composer.js";
import type { PromptAbortResult } from "../src/shared/ipc-contract.js";

/** Stub the stop channel with a fixed outcome, and record what it was asked to stop. */
function stubStop(outcome: PromptAbortResult = { status: "stopped" }) {
  const calls: string[] = [];
  const abortPrompt = vi.fn(async (sessionId: string) => {
    calls.push(sessionId);
    return outcome;
  });
  Object.assign(window.cbe, { abortPrompt });
  return { calls, abortPrompt };
}

/**
 * A PENDING attachment pill — the composer's own, never the doc chip the sent
 * turn keeps in the transcript. The two look alike and only the pill is the
 * subject of the restore rule, so the query is scoped to the card's pill row.
 */
function pendingPill(name = "syllabus.pdf"): HTMLElement | null {
  const row = document.querySelector(PENDING_ATTACHMENTS_SELECTOR);
  if (!row) return null;
  return within(row as HTMLElement).queryByTitle(name);
}

/** Put the visible conversation into a running turn. */
function startRun(sessionId = "test-session") {
  act(() => {
    emitAgentEvent({ type: "agent_start", sessionId, data: {} });
  });
}

function endRun(sessionId = "test-session") {
  act(() => {
    emitAgentEvent({ type: "agent_end", sessionId, data: {} });
  });
}

function stopTakesEffect(sessionId = "test-session") {
  act(() => {
    emitAgentEvent({ type: "turn_stopped", sessionId, data: {} });
  });
}

beforeEach(() => {
  seedConversation();
});

afterEach(() => {
  useCbe.getState().reset();
  vi.restoreAllMocks();
});

describe("Scenario: Stopping ends the turn and unlocks the composer", () => {
  it("stops through the host path, dispatches no prompt, creates no user turn, and releases the lock", async () => {
    const sendPrompt = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { sendPrompt });
    const { calls } = stubStop();

    render(<ChatPanel />);
    startRun();
    const turnsBefore = useCbe.getState().turns.length;

    fireEvent.click(stopButton());
    await waitFor(() => expect(calls).toEqual(["test-session"]));

    // A stop is not a dispatch: no prompt, no user turn, no entry into the
    // dialogue-steering dispatch lock.
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useCbe.getState().turns).toHaveLength(turnsBefore);

    // The lock is released by the RUN's own end, not by the stop call.
    expect(sendSlotState()).toBe("stop");
    stopTakesEffect();
    endRun();
    await waitFor(() => expect(sendSlotState()).toBe("send"));
    // …and the composer accepts input again.
    fireEvent.change(composerField(), { target: { value: "weiter" } });
    expect(sendButton().disabled).toBe(false);
  });
});

describe("Scenario: A stop in the pre-run window is honoured", () => {
  it("the slot already renders stop between the click on send and the run starting", async () => {
    // A never-resolving dispatch pins the composer in the pre-run window: the
    // lock is engaged and no run exists yet.
    Object.assign(window.cbe, { sendPrompt: vi.fn(() => new Promise<never>(() => {})) });
    const { calls } = stubStop();

    render(<ChatPanel />);
    fireEvent.change(composerField(), { target: { value: "Los geht's" } });
    fireEvent.click(sendButton());

    // No agent event has arrived — the slot must already be the stop, and it
    // must actually stop rather than present as enabled while doing nothing.
    expect(sendSlotState()).toBe("stop");
    fireEvent.click(stopButton());
    await waitFor(() => expect(calls).toEqual(["test-session"]));
  });
});

describe("Scenario: The settling stop is visible and not re-activatable", () => {
  it("shows a distinct pending presentation and refuses a second activation until it settles", async () => {
    let release!: (v: PromptAbortResult) => void;
    const abortPrompt = vi.fn(
      () =>
        new Promise<PromptAbortResult>((resolve) => {
          release = resolve;
        })
    );
    Object.assign(window.cbe, { abortPrompt });

    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());

    // Distinct presentation, distinct accessible name, and inert.
    await waitFor(() => expect(stopButton().className).toContain("stop-pending"));
    expect(stopButton().getAttribute("aria-label")).toBe(en.chatStopPendingLabel);
    expect(stopButton().getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(stopButton());
    expect(abortPrompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ status: "stopped" });
    });
    await waitFor(() => expect(stopButton().className).not.toContain("stop-pending"));
  });
});

describe("Scenario: The partial answer stays, marked as stopped, across a reload", () => {
  it("marks the finalised turn, keeps its text, and never presents it as complete", async () => {
    stubStop();
    render(<ChatPanel />);
    startRun();
    act(() => {
      emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "Schritt 4 beginnt" } });
    });
    fireEvent.click(stopButton());
    stopTakesEffect();
    endRun();

    // The text the lecturer watched arrive is still there…
    expect(await screen.findByText(/Schritt 4 beginnt/)).toBeTruthy();
    // …carrying the English chat-notice marker, with no actions on it.
    const marker = screen.getByRole("note", { name: en.chatStoppedTurnMarker });
    expect(marker.className).toContain("chat-notice");
    expect(within(marker).queryAllByRole("button")).toHaveLength(0);
    expect(marker.textContent).toContain(en.chatStoppedTurnMarker);

    const stoppedTurns = useCbe.getState().turns.filter((t) => t.role === "assistant" && t.stopped);
    expect(stoppedTurns).toHaveLength(1);
  });

  it("survives a re-render, and comes back on a session re-entry from the persisted turn", async () => {
    stubStop();
    const { unmount } = render(<ChatPanel />);
    startRun();
    act(() => {
      emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "Halber Satz" } });
    });
    fireEvent.click(stopButton());
    stopTakesEffect();
    endRun();
    unmount();

    const rerendered = render(<ChatPanel />);
    expect(screen.getByRole("note", { name: en.chatStoppedTurnMarker })).toBeTruthy();
    rerendered.unmount();

    // Re-entry: the marker rides the PERSISTED turn, not renderer memory.
    useCbe.getState().reset();
    act(() => {
      useCbe.getState().hydrateConversation({
        session: testSession(),
        turns: [
          { role: "user", text: "Erklär mir Schritt 4." },
          { role: "assistant", text: "Halber Satz", stopped: true },
          { role: "assistant", text: "Eine ganze Antwort." },
        ],
        agentRunning: false,
        canvas: [],
        maturity: {},
      });
    });
    render(<ChatPanel />);
    expect(screen.getAllByRole("note", { name: en.chatStoppedTurnMarker })).toHaveLength(1);
  });

  it("a stop with nothing streamed still leaves a marked turn rather than swallowing it", async () => {
    stubStop();
    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    stopTakesEffect();
    endRun();

    expect(await screen.findByText(en.chatStoppedTurnPlaceholder)).toBeTruthy();
    expect(screen.getByRole("note", { name: en.chatStoppedTurnMarker })).toBeTruthy();
  });
});

describe("Scenario: A stopped turn offers neither Continue, Retry, nor a provider error", () => {
  it("renders no cut-off notice and no provider-error state for a stopped run", async () => {
    stubStop();
    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    stopTakesEffect();
    // Both states the stop must not produce, arriving anyway.
    act(() => {
      emitAgentEvent({
        type: "truncation_cutoff",
        sessionId: "test-session",
        data: { note: "The response was cut off." },
      });
      emitAgentEvent({
        type: "error",
        sessionId: "test-session",
        data: { message: "Provider error (reason: aborted)" },
      });
    });
    endRun();

    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/cut off/i)).toBeNull();
    expect(screen.queryByText(/Provider error/i)).toBeNull();
    expect(useCbe.getState().cutOffNote).toBeNull();
    expect(useCbe.getState().chatNotice).toBeNull();
  });

  it("a GENUINE truncation in an unstopped run still renders its cut-off state", async () => {
    render(<ChatPanel />);
    startRun();
    act(() => {
      emitAgentEvent({
        type: "truncation_cutoff",
        sessionId: "test-session",
        data: { note: "The response was cut off." },
      });
    });
    endRun();
    expect(screen.getByText("The response was cut off.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("Scenario: Pending attachments are not restored by a stop, but still are by a failed send", () => {
  it("leaves the composer empty after a stop, and restores the pills after a failed send", async () => {
    // A send that REACHES the model and is then stopped: the attachments were
    // consumed, and restoring them would invite a duplicate upload.
    Object.assign(window.cbe, {
      sendPrompt: vi.fn(async () => ({ ok: true as const })),
      ingestFile: vi.fn(async () => [
        { ok: true as const, filename: "syllabus.pdf", docType: "pdf" as const, text: "body" },
      ]),
    });
    stubStop();
    render(<ChatPanel />);

    await act(async () => {
      await useCbe.getState().setChatNotice(null);
    });
    // Ingest one document, then send it.
    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel }));
    await waitFor(() => expect(pendingPill()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(pendingPill()).toBeNull());

    startRun();
    fireEvent.click(stopButton());
    stopTakesEffect();
    endRun();

    // Not restored: the turn reached the model.
    await waitFor(() => expect(sendSlotState()).toBe("send"));
    expect(pendingPill()).toBeNull();
    expect(composerField().value).toBe("");

    // The failed-send path is untouched and still restores them.
    Object.assign(window.cbe, {
      sendPrompt: vi.fn(async () => {
        throw new Error("Agent is already processing a message");
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel }));
    await waitFor(() => expect(pendingPill()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(pendingPill()).toBeTruthy());
  });
});

describe("Scenario: Stop is disabled with a reachable reason during a compaction", () => {
  it("stays focusable and announced via aria-disabled, carries its reason, and stops nothing", async () => {
    const { abortPrompt } = stubStop();
    render(<ChatPanel />);
    startRun();
    act(() => {
      emitAgentEvent({ type: "compaction_phase", sessionId: "test-session", data: { phase: "consolidating" } });
    });

    const stop = stopButton();
    // `aria-disabled`, never the `disabled` attribute — a disabled control is
    // skipped by assistive technology and its reason becomes pointer-only.
    expect(stop.getAttribute("aria-disabled")).toBe("true");
    expect(stop.hasAttribute("disabled")).toBe(false);
    const describedBy = stop.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(en.chatStopCompactionReason);

    fireEvent.click(stop);
    expect(abortPrompt).not.toHaveBeenCalled();
    // Compaction shares the one active Working disclosure; no sibling banner.
    expect(screen.getByRole("button", { name: en.chatWorkingDisclosureLabel })).toBeTruthy();
    expect(document.querySelector(".chat-banners")).toBeNull();

    // …and it works again once the sequence ends.
    act(() => {
      emitAgentEvent({ type: "compaction_phase", sessionId: "test-session", data: { phase: "idle" } });
    });
    expect(stopButton().getAttribute("aria-disabled")).toBeNull();
  });
});

describe("Scenario: A timed-out stop is honest and offers a way out", () => {
  it("reports it in the app's own copy, keeps the composer locked, and offers the force-close", async () => {
    stubStop({ status: "timed-out" });
    const freshConversation = vi.fn(async () => ({
      session: testSession("fresh-session"),
      turns: [],
      agentRunning: false,
      canvas: [],
      maturity: {},
    }));
    Object.assign(window.cbe, { freshConversation });

    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());

    const notice = await screen.findByText(en.chatStopTimedOutNoticeText);
    expect(notice).toBeTruthy();
    // The app's own English copy — never a raw runtime or provider message.
    expect(notice.textContent).not.toMatch(/https?:|aborted|abort\(\)/);
    // The composer stays locked until the run actually ends, so no second
    // prompt can race the first. The lock binds the send ACTION, not typing
    // (Requirement: *Long-Form Composer for Lecturer Input* — "the send action
    // is blocked; the send button offers no send"), so what must hold is that
    // the slot is still the stop and that Enter dispatches nothing.
    expect(sendSlotState()).toBe("stop");
    const sendPrompt = vi.fn(async () => ({ ok: true as const }));
    Object.assign(window.cbe, { sendPrompt });
    fireEvent.change(composerField(), { target: { value: "noch eine Frage" } });
    fireEvent.keyDown(composerField(), { key: "Enter" });
    expect(sendPrompt).not.toHaveBeenCalled();

    // The recovery: destructive, so it confirms first.
    fireEvent.click(screen.getByRole("button", { name: en.chatStopTimedOutRecoveryLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Force-close and start fresh" }));
    await waitFor(() => expect(freshConversation).toHaveBeenCalledWith({ force: true }));
  });

  it("clears itself once the run finally ends", async () => {
    stubStop({ status: "timed-out" });
    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    await screen.findByText(en.chatStopTimedOutNoticeText);

    stopTakesEffect();
    endRun();
    await waitFor(() => expect(screen.queryByText(en.chatStopTimedOutNoticeText)).toBeNull());
  });

  it("keeps the way out when the still-locked control is activated again", async () => {
    // After a timed-out stop the run is still held. A second activation reaches
    // a controller that already owns this run's end and comes back `superseded`
    // — which must NOT retract the notice: nothing can be `timed-out` twice for
    // one run, so clearing on a later outcome would delete the recovery for
    // good and leave the lecturer with a locked composer and no exit.
    const outcomes: PromptAbortResult[] = [{ status: "timed-out" }, { status: "superseded" }];
    let call = 0;
    const abortPrompt = vi.fn(async () => outcomes[Math.min(call++, outcomes.length - 1)]!);
    Object.assign(window.cbe, { abortPrompt });

    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    await screen.findByText(en.chatStopTimedOutNoticeText);

    // The control keeps the settling presentation rather than re-arming into a
    // state that would do nothing on click.
    expect(stopButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(stopButton());
    await act(async () => {});
    expect(abortPrompt).toHaveBeenCalledTimes(1);

    // Notice and recovery both still there.
    expect(screen.queryByText(en.chatStopTimedOutNoticeText)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.chatStopTimedOutRecoveryLabel })).toBeTruthy();
  });

  it("survives the panel unmounting for a course switch, while the composer stays locked", async () => {
    // A course switch puts hydration into `pending`, which renders the pending
    // pane INSTEAD of the chat panel — so the panel unmounts and remounts while
    // the run lock, which lives on the conversation slice, survives untouched.
    // A panel-local flag would take the notice and its force-close down with it
    // and restore exactly the dead end the recovery exists for.
    stubStop({ status: "timed-out" });
    const first = render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    await screen.findByText(en.chatStopTimedOutNoticeText);

    first.unmount();
    render(<ChatPanel />);

    expect(screen.getByText(en.chatStopTimedOutNoticeText)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.chatStopTimedOutRecoveryLabel })).toBeTruthy();
    expect(sendSlotState()).toBe("stop");
  });

  it("does not surface a BACKGROUND conversation's timed-out stop in the visible one", async () => {
    seedConversation({ session: testSession("sess-visible", "course-a") });
    seedBackgroundConversation("sess-background", "course-b");
    act(() => {
      emitAgentEvent({ type: "agent_start", sessionId: "sess-background", data: {} });
      useCbe.getState().noteStopTimedOut("sess-background");
    });

    render(<ChatPanel />);
    expect(screen.queryByText(en.chatStopTimedOutNoticeText)).toBeNull();
    expect(useCbe.getState().conversations["sess-background"]!.stopTimedOut).toBe(true);
    expect(useCbe.getState().stopTimedOut).toBe(false);
  });

  it("shows no notice at all for an ordinary stop", async () => {
    stubStop({ status: "stopped" });
    render(<ChatPanel />);
    startRun();
    fireEvent.click(stopButton());
    stopTakesEffect();
    endRun();
    await waitFor(() => expect(sendSlotState()).toBe("send"));
    expect(screen.queryByText(en.chatStopTimedOutNoticeText)).toBeNull();
  });
});

describe("Scenario: A background conversation's run is not stopped", () => {
  it("the visible conversation's control names its OWN session, and the background run continues", async () => {
    seedConversation({ session: testSession("sess-visible", "course-a") });
    seedBackgroundConversation("sess-background", "course-b");
    act(() => {
      emitAgentEvent({ type: "agent_start", sessionId: "sess-background", data: {} });
    });
    const { calls } = stubStop();

    render(<ChatPanel />);
    // A background run does not lock the visible composer at all — so there is
    // no stop control to press for it.
    expect(sendSlotState()).toBe("send");
    expect(queryStopButton()).toBeNull();

    startRun("sess-visible");
    fireEvent.click(stopButton());
    await waitFor(() => expect(calls).toEqual(["sess-visible"]));

    // The background conversation is untouched: still streaming, unmarked.
    const background = useCbe.getState().conversations["sess-background"]!;
    expect(background.live.streaming).toBe(true);
    expect(background.runStopped).toBe(false);
  });
});

describe("No keyboard shortcut is introduced", () => {
  it("Escape does not stop the run", async () => {
    const { abortPrompt } = stubStop();
    render(<ChatPanel />);
    startRun();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(composerField(), { key: "Escape" });
    expect(abortPrompt).not.toHaveBeenCalled();
    // …and the control is an ordinary keyboard-reachable button.
    expect(stopButton().tagName).toBe("BUTTON");
  });
});
