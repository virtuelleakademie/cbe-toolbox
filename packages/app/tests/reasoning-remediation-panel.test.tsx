/**
 * ChatPanel-level tests for the reasoning remediation (capability `agent-harness`,
 * Requirement: Reasoning Remediation for Tool-Call-Gated Models). Covers the three
 * Scenarios end-to-end through the renderer:
 *
 * - No-tool-call opening turn surfaces a remediation affordance.
 * - Confirming re-binds the running session with reasoning on (via the existing
 *   setConfig runtime re-bind), transcript preserved.
 * - A turn that DID call a tool surfaces nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { shouldOfferReasoningRemediation } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import type { Turn } from "../src/renderer/state/store.js";

function seedSession(reasoning?: boolean) {
  // Conversation state is per-session (slice + visible mirror); events routed
  // by the app-level demux only land in an existing slice.
  seedConversation();
  useCbe.setState({
    providerStatus: { baseURL: "http://x/v1", modelId: "qwen-a3b", hasKey: true, reasoning },
  });
}

beforeEach(() => seedSession());
afterEach(() => useCbe.getState().reset());

describe("shouldOfferReasoningRemediation (renderer observation mapping)", () => {
  it("offers on a clean tool-free opening exchange with reasoning off", () => {
    expect(
      shouldOfferReasoningRemediation({
        isOpeningExchange: true,
        reasoningAlreadyOn: false,
        anyToolRan: false,
        endedWithError: false,
      })
    ).toBe(true);
  });

  it("does not offer when a tool ran", () => {
    expect(
      shouldOfferReasoningRemediation({
        isOpeningExchange: true,
        reasoningAlreadyOn: false,
        anyToolRan: true,
        endedWithError: false,
      })
    ).toBe(false);
  });

  it("does not offer when reasoning is already on", () => {
    expect(
      shouldOfferReasoningRemediation({
        isOpeningExchange: true,
        reasoningAlreadyOn: true,
        anyToolRan: false,
        endedWithError: false,
      })
    ).toBe(false);
  });

  it("does not offer past the opening exchange", () => {
    expect(
      shouldOfferReasoningRemediation({
        isOpeningExchange: false,
        reasoningAlreadyOn: false,
        anyToolRan: false,
        endedWithError: false,
      })
    ).toBe(false);
  });

  it("does not offer when the run ended with an error (not a clean stop)", () => {
    expect(
      shouldOfferReasoningRemediation({
        isOpeningExchange: true,
        reasoningAlreadyOn: false,
        anyToolRan: false,
        endedWithError: true,
      })
    ).toBe(false);
  });
});

describe("ChatPanel reasoning remediation", () => {
  // Scenario: No-tool-call opening turn surfaces a reasoning remediation.
  it("surfaces the remediation when the opening turn returns text only with no tool call", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "I would read the skill…" } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    expect(screen.getByRole("button", { name: /enable reasoning/i })).toBeTruthy();
  });

  // Scenario: Confirming the remediation re-binds the session with reasoning on.
  it("confirming calls setConfig with reasoning:true and preserves the transcript", async () => {
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true, activeSwap: { ok: true, modelId: "qwen-a3b" } });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "narration only" } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    // The opening turn was persisted as an assistant turn — the transcript exists.
    const before = useCbe.getState().turns as Turn[];
    expect(before.length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /enable reasoning/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const dto = setConfigSpy.mock.calls[0][0];
    expect(dto.reasoning).toBe(true);
    expect(dto.reasoningEffort).toBe("medium");
    // apiKey omitted → persisted key preserved by the runtime re-bind.
    expect("apiKey" in dto).toBe(false);
    // Transcript preserved (the re-bind does not discard the conversation).
    expect((useCbe.getState().turns as Turn[]).length).toBe(1);
    // providerStatus reflects reasoning now ON.
    expect(useCbe.getState().providerStatus?.reasoning).toBe(true);
  });

  // Scenario (negative): a turn that DID call a tool surfaces no remediation.
  it("does not surface the remediation when the opening turn called a tool", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: "test-session",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: "test-session",
      data: { toolCallId: "c1", toolName: "read", result: "ok", isError: false },
    });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    expect(screen.queryByRole("button", { name: /enable reasoning/i })).toBeNull();
  });

  it("does not surface the remediation when reasoning is already enabled", () => {
    seedSession(true);
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: "test-session", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "test-session", data: { delta: "text only" } });
    emitAgentEvent({ type: "agent_end", sessionId: "test-session", data: {} });

    expect(screen.queryByRole("button", { name: /enable reasoning/i })).toBeNull();
  });
});
