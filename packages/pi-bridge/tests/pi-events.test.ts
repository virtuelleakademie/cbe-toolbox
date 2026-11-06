/**
 * Scenario: Runtime events are normalized once at the boundary (capability
 * `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*)
 * — the field-level half. ADAPTER-level test: it builds Pi event values and
 * proves `normalizePiEvent` turns each kind into exactly the CBE event the host
 * consumers read. The order/one-to-one half against a real session lives in
 * `pi-runtime-port.test.ts`, and the whole-sequence equivalence in
 * `runtime-characterization.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { normalizePiEvent } from "../src/runtime/pi-events.js";

const ev = (e: unknown) => normalizePiEvent(e as AgentSessionEvent);
const update = (assistantMessageEvent: unknown) => ev({ type: "message_update", message: {}, assistantMessageEvent });

describe("Scenario: Runtime events are normalized once at the boundary — field mapping", () => {
  it("maps run and turn activity to payload-free lifecycle events, with the terminal end sourced from agent_settled", () => {
    expect(ev({ type: "agent_start" })).toEqual({ type: "agent_start" });
    // Pi's low-level end never crosses the boundary, whatever its willRetry says.
    expect(ev({ type: "agent_end", messages: [{ role: "assistant" }], willRetry: true })).toEqual({
      type: "runtime_activity",
    });
    expect(ev({ type: "agent_end", messages: [], willRetry: false })).toEqual({ type: "runtime_activity" });
    expect(ev({ type: "agent_settled", aborted: false })).toEqual({ type: "agent_end", aborted: false });
    expect(ev({ type: "agent_settled", aborted: true })).toEqual({ type: "agent_end", aborted: true });
    // Pi 1.x's transcript system message carries no product meaning.
    expect(ev({ type: "message_start", message: { role: "system", content: "" } })).toEqual({
      type: "runtime_activity",
    });
    expect(ev({ type: "message_end", message: { role: "system", content: "" } })).toEqual({
      type: "runtime_activity",
    });
    expect(ev({ type: "turn_start" })).toEqual({ type: "turn_start" });
    expect(ev({ type: "turn_end", message: {}, toolResults: [] })).toEqual({ type: "turn_end" });
    expect(ev({ type: "message_start", message: { role: "assistant", content: [] } })).toEqual({
      type: "message_start",
    });
  });

  it("maps text and thinking activity to flat stream events", () => {
    expect(update({ type: "text_delta", contentIndex: 0, delta: "Hal", partial: {} })).toEqual({
      type: "text_delta",
      delta: "Hal",
    });
    expect(update({ type: "thinking_start", contentIndex: 2, partial: {} })).toEqual({
      type: "thinking_start",
      contentIndex: 2,
    });
    expect(update({ type: "thinking_delta", contentIndex: 2, delta: "hm", partial: {} })).toEqual({
      type: "thinking_delta",
      contentIndex: 2,
      delta: "hm",
    });
    expect(update({ type: "thinking_end", contentIndex: 2, content: "hm", partial: {} })).toEqual({
      type: "thinking_end",
      contentIndex: 2,
    });
  });

  it("maps a stream error to stream_error with the runtime's reason and the provider text", () => {
    expect(
      update({ type: "error", reason: "aborted", error: { role: "assistant", errorMessage: "Request was aborted" } })
    ).toEqual({ type: "stream_error", reason: "aborted", errorMessage: "Request was aborted" });
    expect(update({ type: "error", reason: "error", error: { role: "assistant" } })).toEqual({
      type: "stream_error",
      reason: "error",
    });
  });

  it("maps a completed message to its summary: role, stop reason, error text, text and tool-call count", () => {
    expect(
      ev({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "length",
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "part one " },
            { type: "toolCall", id: "c1", name: "read", arguments: {} },
            { type: "text", text: "part two<turn|>" },
          ],
          api: "openai-completions",
          provider: "byo-llm",
          model: "m",
          usage: {},
          timestamp: 1,
        },
      })
    ).toEqual({
      type: "message_end",
      // Untransformed text: stripping protocol framing is the host's own decision.
      message: { role: "assistant", stopReason: "length", text: "part one part two<turn|>", toolCallCount: 1 },
    });
    expect(
      ev({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "401", content: [] } })
    ).toEqual({
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "401", text: "", toolCallCount: 0 },
    });
    // A user message with string content carries no text blocks; a degenerate one maps safely.
    expect(ev({ type: "message_end", message: { role: "user", content: "Hallo", timestamp: 1 } })).toEqual({
      type: "message_end",
      message: { role: "user", text: "", toolCallCount: 0 },
    });
    expect(ev({ type: "message_end", message: {} })).toEqual({
      type: "message_end",
      message: { role: "", text: "", toolCallCount: 0 },
    });
  });

  it("maps tool activity with its call id, name, arguments and result", () => {
    expect(ev({ type: "tool_execution_start", toolCallId: "c1", toolName: "cbe_step", args: { step: 2 } })).toEqual({
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "cbe_step",
      args: { step: 2 },
    });
    expect(
      ev({ type: "tool_execution_update", toolCallId: "c1", toolName: "read", args: { path: "a" }, partialResult: "x" })
    ).toEqual({
      type: "tool_execution_update",
      toolCallId: "c1",
      toolName: "read",
      args: { path: "a" },
      partialResult: "x",
    });
    const result = { content: [{ type: "text", text: "ok" }], details: { kind: "step" } };
    expect(ev({ type: "tool_execution_end", toolCallId: "c1", toolName: "cbe_step", result, isError: false })).toEqual({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "cbe_step",
      result,
      isError: false,
    });
  });

  it("maps retry and compaction activity, dropping the runtime's compaction result", () => {
    expect(ev({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "503" })).toEqual({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "503",
    });
    expect(ev({ type: "auto_retry_end", success: false, attempt: 3, finalError: "503" })).toEqual({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "503",
    });
    expect(ev({ type: "auto_retry_end", success: true, attempt: 1 })).toEqual({
      type: "auto_retry_end",
      success: true,
      attempt: 1,
    });
    expect(ev({ type: "compaction_start", reason: "threshold" })).toEqual({
      type: "compaction_start",
      reason: "threshold",
    });
    expect(
      ev({
        type: "compaction_end",
        reason: "overflow",
        result: { summary: "s", firstKeptEntryId: "e", tokensBefore: 9 },
        aborted: false,
        willRetry: true,
      })
    ).toEqual({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
    expect(
      ev({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted: true,
        willRetry: false,
        errorMessage: "x",
      })
    ).toEqual({ type: "compaction_end", reason: "manual", aborted: true, willRetry: false, errorMessage: "x" });
  });

  it("maps activity without product meaning to a payload-free runtime_activity — no unknown channel", () => {
    for (const raw of [
      { type: "queue_update", steering: ["x"], followUp: [] },
      { type: "session_info_changed", name: "n" },
      { type: "thinking_level_changed", level: "high" },
      { type: "some_future_event", payload: { secret: true } },
    ]) {
      expect(ev(raw)).toEqual({ type: "runtime_activity" });
    }
    for (const ame of [
      { type: "start", partial: {} },
      { type: "text_start", contentIndex: 0, partial: {} },
      { type: "text_end", contentIndex: 0, content: "x", partial: {} },
      { type: "toolcall_start", contentIndex: 1, partial: {} },
      { type: "toolcall_delta", contentIndex: 1, delta: "{", partial: {} },
      { type: "toolcall_end", contentIndex: 1, toolCall: {}, partial: {} },
    ]) {
      expect(update(ame)).toEqual({ type: "runtime_activity" });
    }
  });
});
