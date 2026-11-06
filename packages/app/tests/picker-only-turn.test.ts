/**
 * A turn ending on a generative-UI question is a complete turn (desktop-app spec,
 * Requirement: *A Turn Ending on a Generative-UI Question Is a Complete Turn*,
 * Scenario: *A run whose only output is a picker is persisted as a normal turn*).
 *
 * Two changes make this shape ordinary rather than exotic: the skill no longer
 * announces a rendered question (capability `cbe-skill`, Requirement: *A Rendered
 * Question Is Not Announced*), and the run ends on the tool call itself
 * (capability `agent-harness`, Requirement: *The Agent Run Ends on a
 * Deferred-Answer Tool Call*). So a legitimate assistant turn can consist of the
 * picker card and nothing else — and it must read as finished, not as a run that
 * broke off.
 */
import { describe, it, expect } from "vitest";
import {
  newConversation,
  reduceConversation,
  type ConversationState,
} from "../src/renderer/state/conversationReducer.js";
import { testSession } from "./helpers/conversation.js";
import type { AgentEvent } from "../src/shared/ipc-contract.js";

const SESSION_ID = "picker-only";
const CTX = { visible: true, reasoningOn: false };

const PICKER_ARGS = {
  question: 'Who represents the "Stakeholder" in your course?',
  options: [
    { id: "lecturer", label: "Lecturer (Product Owner)" },
    { id: "simulated", label: "Simulated persona" },
  ],
};

/** The event stream of a run that emits ONE picker and ends there. */
const RUN: AgentEvent[] = [
  { type: "agent_start", sessionId: SESSION_ID, data: {} },
  { type: "turn_start", sessionId: SESSION_ID, data: {} },
  {
    type: "tool_execution_start",
    sessionId: SESSION_ID,
    data: { toolCallId: "p1", toolName: "cbe_picker", args: PICKER_ARGS },
  },
  {
    type: "tool_execution_end",
    sessionId: SESSION_ID,
    data: {
      toolCallId: "p1",
      toolName: "cbe_picker",
      result: { details: { kind: "cbe_picker", spec: PICKER_ARGS } },
      isError: false,
    },
  },
  { type: "turn_end", sessionId: SESSION_ID, data: {} },
  { type: "agent_end", sessionId: SESSION_ID, data: {} },
] as unknown as AgentEvent[];

function play(events: AgentEvent[]): ConversationState {
  return events.reduce((c, evt) => reduceConversation(c, evt, CTX), newConversation(testSession(SESSION_ID)));
}

describe("A run whose only output is a picker is persisted as a normal turn", () => {
  it("finalises exactly one assistant turn", () => {
    const c = play(RUN);
    expect(c.turns).toHaveLength(1);
    expect(c.turns[0]!.role).toBe("assistant");
  });

  it("that turn carries the picker card — nothing is dropped for lack of text", () => {
    const c = play(RUN);
    const activity = (c.turns[0] as { activity: Array<{ kind: string; data?: { toolName?: string } }> }).activity;
    expect(activity).toHaveLength(1);
    expect(activity[0]!.kind).toBe("tool");
    expect(activity[0]!.data?.toolName).toBe("cbe_picker");
  });

  it("unlocks the composer — the run is over, not still streaming", () => {
    const c = play(RUN);
    expect(c.live.streaming).toBe(false);
    expect(c.dispatchPending).toBe(false);
  });

  it("shows no error notice and no cut-off state", () => {
    const c = play(RUN);
    expect(c.chatNotice).toBeNull();
    expect(c.cutOffNote).toBeNull();
    expect(c.runHadError).toBe(false);
  });

  it("leaves no live activity behind that a following run could re-persist", () => {
    const c = play(RUN);
    expect(c.live.items).toHaveLength(0);
  });
});
