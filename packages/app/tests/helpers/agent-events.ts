import { act } from "@testing-library/react";
import type { AgentEvent } from "../../src/shared/ipc-contract.js";

/** The session id the shared test conversation is seeded with
 * (`seedConversation` in helpers/conversation.ts). */
export const TEST_SESSION_ID = "test-session";

/**
 * Drive every listener that the renderer registered via `window.cbe.onAgentEvent`.
 * Wrapped in `act` so React state updates flush before the assertion line.
 *
 * Pi-Agent emits these events from the main process; in the test environment
 * we simulate them directly through the same channel the preload bridge would
 * have used. Events are demultiplexed by their top-level `sessionId`
 * (capability `desktop-app`, Requirement: Background Conversations and
 * Per-Session Event Demultiplexing); older tests written before the demux
 * omitted it, so it defaults to the shared TEST_SESSION_ID.
 */
export function emitAgentEvent(evt: Omit<AgentEvent, "sessionId"> & { sessionId?: string }): void {
  const listeners = window.__cbeAgentListeners ?? [];
  const withId = { sessionId: TEST_SESSION_ID, ...evt } as AgentEvent;
  act(() => {
    for (const fn of listeners) fn(withId);
  });
}
