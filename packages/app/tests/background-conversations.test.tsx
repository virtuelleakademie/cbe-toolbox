/**
 * Background course sessions — renderer side (change add-background-course-sessions).
 *
 * - desktop-app spec, Requirement: Background Conversations and Per-Session
 *   Event Demultiplexing — Scenarios: Background session events do not bleed
 *   into the visible conversation; Events for unknown session ids are dropped;
 *   Switching back mid-run shows the accumulated live activity; Composer locks
 *   only for the visible running conversation; Running indicator appears on
 *   course surfaces; Unseen-completion marker is set and cleared.
 * - course-workspace spec, Requirement: Active Course and Course Switching —
 *   Scenario: Switching back re-attaches to the still-open session (renderer
 *   side: the slice keeps its buffered turns incl. background completions).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import { sendSlotState } from "./helpers/composer.js";
import type { ActivityItem } from "../src/renderer/state/activity.js";
import type { ConversationOpenResult, CourseSummary } from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "course-a", title: "Kurs A", path: "/space/courses/course-a" },
  { id: "course-b", title: "Kurs B", path: "/space/courses/course-b" },
];

function reattachResult(sessionId: string, courseId: string, agentRunning: boolean): ConversationOpenResult {
  return {
    session: testSession(sessionId, courseId),
    // Main's transcript projection — for an in-app switch back, the renderer's
    // richer buffered slice wins over this.
    turns: [],
    agentRunning,
    canvas: [],
  };
}

function textOf(items: ActivityItem[]): string {
  return items
    .filter((i): i is Extract<ActivityItem, { kind: "text" }> => i.kind === "text")
    .map((i) => i.text)
    .join("");
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ courses: COURSES, hydration: "ready" });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle" });
});

// Scenario: Background session events do not bleed into the visible conversation
describe("Background session events do not bleed into the visible conversation", () => {
  it("routes interleaved two-session streams into their own slices; the visible slice stays untouched", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");

    // Interleaved streams: the background session (sess-b) runs a full turn with
    // text, a tool execution, and lifecycle boundaries while sess-a is visible.
    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-b", data: { delta: "B intro. " } });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-a", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-a", data: { delta: "A text." } });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: "sess-b",
      data: { toolCallId: "tb-1", toolName: "read", args: { path: "corpus/x.md" } },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: "sess-b",
      data: { toolCallId: "tb-1", toolName: "read", result: "ok", isError: false },
    });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-b", data: { delta: "B more." } });

    const a = useCbe.getState().conversations["sess-a"]!;
    const b = useCbe.getState().conversations["sess-b"]!;
    // Each slice holds ONLY its own stream.
    expect(textOf(a.live.items)).toBe("A text.");
    expect(a.live.items.some((i) => i.kind === "tool")).toBe(false);
    expect(textOf(b.live.items)).toBe("B intro. B more.");
    expect(b.live.items.filter((i) => i.kind === "tool")).toHaveLength(1);
    // The visible mirror shows the visible slice only — no bleed from sess-b.
    expect(textOf(useCbe.getState().live.items)).toBe("A text.");
  });

  it("a background terminal agent_end finalizes ITS slice's turn without touching the visible transcript", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");

    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-b", data: { delta: "done in background" } });
    emitAgentEvent({ type: "agent_end", sessionId: "sess-b", data: {} });

    const b = useCbe.getState().conversations["sess-b"]!;
    expect(b.turns).toHaveLength(1);
    expect(b.turns[0]!.role).toBe("assistant");
    expect(b.live.streaming).toBe(false);
    // Visible conversation: transcript and lock untouched.
    expect(useCbe.getState().turns).toHaveLength(0);
    expect(useCbe.getState().agentRunning).toBe(false);
  });
});

// Scenario: Events for unknown session ids are dropped
describe("Events for unknown session ids are dropped", () => {
  it("ignores a straggler event: no slice is created, no state changes", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    const before = useCbe.getState();

    emitAgentEvent({ type: "text_delta", sessionId: "ghost-session", data: { delta: "orphan" } });
    emitAgentEvent({ type: "agent_start", sessionId: "ghost-session", data: {} });

    const after = useCbe.getState();
    expect(Object.keys(after.conversations)).toEqual(["sess-a"]);
    expect(after.conversations["sess-a"]).toBe(before.conversations["sess-a"]);
    expect(after.live).toBe(before.live);
    expect(after.turns).toBe(before.turns);
    expect(after.agentRunning).toBe(false);
    expect(after.error).toBeNull();
  });
});

// Scenario: Switching back mid-run shows the accumulated live activity
describe("Switching back mid-run shows the accumulated live activity", () => {
  it("the full chronological stream (text → tool → text) buffered in the background renders on return", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });

    // Run starts while course A is visible.
    emitAgentEvent({ type: "agent_start", sessionId: "sess-a", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-a", data: { delta: "Intro. " } });

    // Switch away to course B (store-level swap: activate + hydrate B's fresh slice).
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    useCbe.getState().hydrateConversation(reattachResult("sess-b", "course-b", false));

    // The run keeps streaming in the background: a tool call and more text.
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: "sess-a",
      data: { toolCallId: "ta-1", toolName: "read", args: { path: "corpus/x.md" } },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: "sess-a",
      data: { toolCallId: "ta-1", toolName: "read", result: "ok", isError: false },
    });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-a", data: { delta: "After the tool." } });

    // Switch back before the turn ends — the re-attach branch (same sessionId).
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-a" });
    useCbe.getState().hydrateConversation(reattachResult("sess-a", "course-a", true));

    // The buffered stream is fully there, in chronological order…
    const live = useCbe.getState().live;
    expect(live.streaming).toBe(true);
    expect(live.items.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
    expect(textOf(live.items)).toBe("Intro. After the tool.");

    // …and renders in the chat, still streaming live. Visible prose has already
    // replaced the default closed disclosure, so neither it nor passive detail
    // is restored merely because the lecturer returned to the course.
    render(<ChatPanel />);
    expect(screen.getByText(/Intro\./)).toBeTruthy();
    expect(screen.getByText(/After the tool\./)).toBeTruthy();
    expect(document.querySelector(".working-disclosure")).toBeNull();
    expect(document.querySelector(".tool-card")).toBeNull();
    emitAgentEvent({ type: "text_delta", sessionId: "sess-a", data: { delta: " Continued." } });
    expect(screen.getByText(/Continued\./)).toBeTruthy();
  });

  // course-workspace spec, Scenario: Switching back re-attaches to the still-open
  // session (renderer side): same sessionId, and the transcript includes turns
  // that completed while the course was in the background.
  it("re-attach keeps the same sessionId and the background-completed turn is in the transcript", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-a", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "sess-a", data: { delta: "finished while away" } });

    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    useCbe.getState().hydrateConversation(reattachResult("sess-b", "course-b", false));

    // The background run completes.
    emitAgentEvent({ type: "agent_end", sessionId: "sess-a", data: {} });

    // Back to course A: re-attach, not resume — same session identity.
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-a" });
    useCbe.getState().hydrateConversation(reattachResult("sess-a", "course-a", false));

    const s = useCbe.getState();
    expect(s.session?.sessionId).toBe("sess-a");
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]!.role).toBe("assistant");
    expect(textOf((s.turns[0] as { activity: ActivityItem[] }).activity)).toBe("finished while away");
  });
});

// Scenario: Composer locks only for the visible running conversation
describe("Composer locks only for the visible running conversation", () => {
  it("a running background turn leaves the visible composer unlocked; a visible run locks it", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });

    render(<ChatPanel />);
    const composer = screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "hello" } });
    const send = screen.getByRole("button", { name: en.chatSendLabel }) as HTMLButtonElement;
    // Background run in flight → visible composer unlocked, accepts a prompt.
    expect(send.disabled).toBe(false);
    expect(document.querySelector(".composer-locked")).toBeNull();
    expect(document.querySelector(".composer-status-dot")).toBeNull();

    // A run in the VISIBLE conversation locks it regardless of the background.
    emitAgentEvent({ type: "agent_start", sessionId: "sess-a", data: {} });
    // The lock turns the send slot into the stop control (Requirement:
    // *Composer Control Row*) — the visible conversation's own run, so its own
    // stop is what the lecturer is offered.
    expect(sendSlotState()).toBe("stop");
    expect(document.querySelector(".composer-locked")).not.toBeNull();
  });
});

// Scenario: Running indicator appears on course surfaces
describe("Running indicator appears on course surfaces", () => {
  it("shows the running dot on the left panel's card of the running course", async () => {
    Object.assign(window.cbe, { listCourses: async () => ({ courses: COURSES, activeCourseId: "course-a" }) });
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    // The BACKGROUND course's turn is in flight — the indicator must show
    // independent of which course is active.
    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });
    useCbe.setState({ courses: COURSES });

    render(<CoursesPanel />);

    // The left panel's card for Kurs B carries the running dot; Kurs A does not.
    // (The header used to carry a second copy on its switcher dropdown; that
    // dropdown is gone, so the cards are the per-course home — the collapsed
    // rail's aggregate is what covers a collapsed panel.)
    const cardB = (await screen.findByRole("button", { name: /Kurs B/ })).closest(".proj") as HTMLElement;
    expect(cardB.querySelector(".course-run-dot")).not.toBeNull();
    const cardA = screen.getByRole("button", { name: /Kurs A/ }).closest(".proj") as HTMLElement;
    expect(cardA.querySelector(".course-run-dot")).toBeNull();
  });
});

// Scenario: A collapsed left panel still signals background activity
describe("A collapsed left panel still signals background activity", () => {
  it("the collapsed rail's Courses icon carries an aggregate marker, named not coloured", () => {
    Object.assign(window.cbe, { listCourses: async () => ({ courses: COURSES, activeCourseId: "course-a" }) });
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    useCbe.setState({ courses: COURSES });

    // Quiet: no marker at all.
    const quiet = render(<LeftPanel />);
    expect(screen.getByRole("button", { name: "Open Courses" })).toBeTruthy();
    expect(quiet.container.querySelector(".panel-attention-dot")).toBeNull();
    quiet.unmount();

    // A background run in flight.
    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });
    const running = render(<LeftPanel />);
    const railRunning = screen.getByRole("button", { name: /Open Courses \(Agent running in another course\)/ });
    expect(railRunning.querySelector(".panel-attention-dot")).not.toBeNull();
    running.unmount();

    // …and after it completes unseen, the aggregate says so instead.
    emitAgentEvent({ type: "agent_end", sessionId: "sess-b", data: {} });
    render(<LeftPanel />);
    expect(screen.getByRole("button", { name: /Open Courses \(A run finished in another course\)/ })).toBeTruthy();
  });

  it("expanding the panel resolves the aggregate into the per-course markers", async () => {
    Object.assign(window.cbe, { listCourses: async () => ({ courses: COURSES, activeCourseId: "course-a" }) });
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");
    useCbe.setState({ courses: COURSES });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });

    render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Open Courses/ }));

    const cardB = (await screen.findByRole("button", { name: /Kurs B/ })).closest(".proj") as HTMLElement;
    expect(cardB.querySelector(".course-run-dot")).not.toBeNull();
  });
});

// Scenario: Unseen-completion marker is set and cleared
describe("Unseen-completion marker is set and cleared", () => {
  it("terminal background agent_end sets the marker; switching to the course clears it", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    seedBackgroundConversation("sess-b", "course-b");

    emitAgentEvent({ type: "agent_start", sessionId: "sess-b", data: {} });
    // A retry inside the run must NOT set the marker: the run has not settled.
    emitAgentEvent({
      type: "auto_retry_start",
      sessionId: "sess-b",
      data: { attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "503" },
    });
    emitAgentEvent({ type: "auto_retry_end", sessionId: "sess-b", data: { success: true, attempt: 1 } });
    expect(useCbe.getState().conversations["sess-b"]!.unseenCompletion).toBe(false);
    // The settled end does.
    emitAgentEvent({ type: "agent_end", sessionId: "sess-b", data: {} });
    expect(useCbe.getState().conversations["sess-b"]!.unseenCompletion).toBe(true);

    // The marker shows on the Courses tab card.
    Object.assign(window.cbe, { listCourses: async () => ({ courses: COURSES, activeCourseId: "course-a" }) });
    render(<CoursesPanel />);
    const cardB = screen.getByRole("button", { name: /Kurs B/ }).closest(".proj") as HTMLElement;
    expect(cardB.querySelector(".course-unseen-dot")).not.toBeNull();

    // Switching to the course clears it (becoming visible = seen).
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    expect(useCbe.getState().conversations["sess-b"]!.unseenCompletion).toBe(false);
  });

  it("a VISIBLE run's terminal end never sets the marker", () => {
    seedConversation({ session: testSession("sess-a", "course-a") });
    emitAgentEvent({ type: "agent_start", sessionId: "sess-a", data: {} });
    emitAgentEvent({ type: "agent_end", sessionId: "sess-a", data: {} });
    expect(useCbe.getState().conversations["sess-a"]!.unseenCompletion).toBe(false);
  });
});
