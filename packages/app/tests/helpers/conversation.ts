import { useCbe, type ConversationState } from "../../src/renderer/state/store.js";
import { newConversation } from "../../src/renderer/state/conversationReducer.js";
import type { StartSessionResult } from "../../src/shared/ipc-contract.js";

export const TEST_COURSE_ID = "test-course";

/** A minimal StartSessionResult for renderer tests. */
export function testSession(sessionId = "test-session", courseId = TEST_COURSE_ID): StartSessionResult {
  return {
    sessionId,
    mode: "design",
    environmentProfile: "app",
    courseId,
    affordances: {},
    paths: { workspace: "/ws", corpus: "/c" },
  };
}

/**
 * Seed the store with ONE conversation slice and make it visible (its course is
 * the active one). Conversation state is per-session since the background-course
 * change — a test that emits agent events (or drives the composer) needs the
 * slice, not just the top-level mirror. Returns the slice for further tweaking
 * via `useCbe.setState`.
 */
export function seedConversation(
  overrides?: Partial<ConversationState> & { session?: StartSessionResult }
): ConversationState {
  const session = overrides?.session ?? testSession();
  const slice: ConversationState = { ...newConversation(session), ...overrides, session };
  useCbe.setState({
    conversations: { [session.sessionId]: slice },
    activeCourseId: session.courseId,
    mode: session.mode,
    session,
    turns: slice.turns,
    live: slice.live,
    agentRunning: slice.live.streaming || slice.dispatchPending,
    notice: slice.notice,
    dispatchPending: slice.dispatchPending,
    chatNotice: slice.chatNotice,
    artifacts: slice.artifacts,
    steps: slice.steps,
    maturity: slice.maturity,
    maturityState: slice.maturityState,
    didacticChecks: slice.didacticChecks,
    invalidatedChecks: slice.invalidatedChecks,
    offerReasoningRemediation: slice.offerReasoningRemediation,
    stopTimedOut: slice.stopTimedOut,
  });
  return slice;
}

/** Add a second, NON-visible (background) conversation slice to the store. */
export function seedBackgroundConversation(
  sessionId: string,
  courseId: string,
  overrides?: Partial<ConversationState>
): ConversationState {
  const session = testSession(sessionId, courseId);
  const slice: ConversationState = { ...newConversation(session), ...overrides, session };
  useCbe.setState((s) => ({ conversations: { ...s.conversations, [sessionId]: slice } }));
  return slice;
}
