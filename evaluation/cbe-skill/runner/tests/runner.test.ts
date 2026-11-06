import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { runProbe, allToolNames, fullAssistantText, judgeTranscriptText } from "../src/runner.js";
import { mockSessionFactory } from "../src/session-eval.js";
import {
  TurnAccumulator,
  createPiEvalSessionFactory,
  type StartSessionLike,
  type EvalSessionPort,
} from "../src/session-pi.js";
import type { Probe } from "../src/types.js";

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    probe: "7a",
    scenarioFile: "07.md",
    setup: { profile: "app" },
    turns: ["design a module"],
    checkpoints: [{ id: "7a.1", type: "judge", rubric: "x" }],
    ...overrides,
  };
}

describe("runner", () => {
  // spec: Runner replays turns and captures the assistant transcript
  it("replays turns and returns the assistant transcript for an app-profile probe", async () => {
    const factory = mockSessionFactory([{ assistant: "Here is your module.", tools: [] }]);
    const t = await runProbe(probe(), factory, "qwen");
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]!.user).toBe("design a module");
    expect(t.turns[0]!.assistant).toBe("Here is your module.");
    expect(factory.sessions[0]!.setup.profile).toBe("app");
  });

  // A probe's identity prior has to REACH the session, or the checkpoint measures
  // nothing and passes by absence — the failure mode `evaluation/cbe-skill/README.md`
  // records for S6's citing checkpoint. Change `address-the-lecturer-as-they-ask`.
  it("passes a probe's lecturerIdentity through to the session, and omits it when unstated", async () => {
    const identity = { name: "Anna Béringer-Oduya", formOfAddress: "Frau Professorin Béringer" };
    const factory = mockSessionFactory([{ assistant: "Guten Tag.", tools: [] }]);
    await runProbe(probe({ setup: { profile: "app", lecturerIdentity: identity } }), factory, "qwen");
    expect(factory.sessions[0]!.setup.lecturerIdentity).toEqual(identity);

    // A probe that states none must reproduce today's descriptor exactly — that is
    // the condition the no-question direction is measured under.
    const bare = mockSessionFactory([{ assistant: "Hello.", tools: [] }]);
    await runProbe(probe(), bare, "qwen");
    expect(bare.sessions[0]!.setup.lecturerIdentity).toBeUndefined();
  });

  // spec: Runner records tool invocations
  it("records a cbe_picker invocation in the transcript", async () => {
    const factory = mockSessionFactory([{ assistant: "Let me ask.", tools: [{ name: "cbe_picker" }] }]);
    const t = await runProbe(probe(), factory, "qwen");
    expect(allToolNames(t)).toContain("cbe_picker");
  });

  // spec: Sub-probes do not share session state
  it("runs 7b from a fresh session replaying both its turns, no carry-over from 7a", async () => {
    const factory = mockSessionFactory([
      { assistant: "opening reply", tools: [] },
      { assistant: "followup reply", tools: [] },
    ]);
    await runProbe(probe({ probe: "7a", turns: ["7a-opening"] }), factory, "qwen");
    const t7b = await runProbe(probe({ probe: "7b", turns: ["7a-opening", "7b-followup"] }), factory, "qwen");
    // Two separate sessions were created — no shared state.
    expect(factory.sessions).toHaveLength(2);
    // 7b's fresh session received both of its declared turns from cursor 0.
    expect(factory.sessions[1]!.received).toEqual(["7a-opening", "7b-followup"]);
    expect(t7b.turns.map((x) => x.assistant)).toEqual(["opening reply", "followup reply"]);
  });

  // spec: Affordance descriptor is correct for headless profile
  it("requests a headless-profile session whose descriptor has UI affordances false", async () => {
    const startSession = vi.fn<StartSessionLike>(async (o) => ({
      session: { subscribe: () => () => {}, async prompt() {}, dispose() {} } satisfies EvalSessionPort,
      env: { profile: o.profile, affordances: { picker: o.profile === "app", canvas: o.profile === "app" } },
    }));
    const factory = createPiEvalSessionFactory({
      skillDir: "/skills/cbe",
      sessionsDir: "/runs",
      agentDir: "/agent",
      // The agent's cwd root; the factory mkdirs a `workspace-<n>` under it
      // (change make-eval-measure-the-product).
      workspaceRoot: mkdtempSync(nodePath.join(tmpdir(), "cbe-eval-runner-ws-")),
      provider: { baseURL: "x", apiKey: "y", modelId: "m" },
      startSession,
    });
    const session = (await factory({ profile: "headless" })) as unknown as {
      env: { affordances: Record<string, boolean> };
    };
    expect(startSession).toHaveBeenCalledOnce();
    expect(startSession.mock.calls[0]![0]!.profile).toBe("headless");
    expect(session.env.affordances.picker).toBe(false);
    expect(session.env.affordances.canvas).toBe(false);
  });

  // spec: Runner is testable without a live LLM
  it("runs the full probe path with a mock session and no LLM", async () => {
    const factory = mockSessionFactory([{ assistant: "ok", tools: [] }]);
    const t = await runProbe(probe(), factory, "mock");
    expect(fullAssistantText(t)).toBe("ok");
  });
});

describe("judgeTranscriptText", () => {
  it("renders user text, tool-call names, and assistant text per turn", () => {
    const t = {
      probe: "p",
      model: "m",
      turns: [
        { user: "first question", assistant: "first answer", tools: [{ name: "cbe_cite" }, { name: "cbe_cite" }] },
        { user: "second question", assistant: "second answer", tools: [] },
      ],
    };
    const text = judgeTranscriptText(t);
    expect(text).toContain("[turn 1 | user]\nfirst question");
    expect(text).toContain("[turn 1 | tool calls] cbe_cite, cbe_cite");
    expect(text).toContain("[turn 1 | assistant]\nfirst answer");
    expect(text).toContain("[turn 2 | tool calls] (none)");
    expect(text).toContain("[turn 2 | assistant]\nsecond answer");
  });
});

describe("TurnAccumulator (normalized CBE runtime events)", () => {
  it("accumulates text and pairs tool start/end events", () => {
    const acc = new TurnAccumulator();
    acc.handle({ type: "text_delta", delta: "Hel" });
    acc.handle({ type: "tool_execution_start", toolCallId: "1", toolName: "cbe_picker", args: {} });
    acc.handle({
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "cbe_picker",
      result: { content: [{ type: "text", text: "shown" }] },
      isError: false,
    });
    acc.handle({ type: "text_delta", delta: "lo" });
    const r = acc.drain();
    expect(r.assistant).toBe("Hello");
    expect(r.tools).toEqual([
      {
        name: "cbe_picker",
        callId: "1",
        args: {},
        result: { content: [{ type: "text", text: "shown" }] },
        isError: false,
      },
    ]);
    expect(r.events).toEqual([
      { type: "text", text: "Hel" },
      { type: "tool_start", name: "cbe_picker", callId: "1", args: {} },
      {
        type: "tool_end",
        name: "cbe_picker",
        callId: "1",
        result: { content: [{ type: "text", text: "shown" }] },
        isError: false,
      },
      { type: "text", text: "lo" },
    ]);
  });

  it("drains to empty so the next turn starts fresh", () => {
    const acc = new TurnAccumulator();
    acc.handle({ type: "text_delta", delta: "a" });
    acc.drain();
    const r = acc.drain();
    expect(r.assistant).toBe("");
    expect(r.tools).toEqual([]);
    expect(r.events).toEqual([]);
  });

  // Provider failures surface on the subscribe stream, not as a prompt() rejection.
  // Two normalized shapes (the same the app's main process reads):
  //  - stream_error (a provider stream that terminated in error)
  //  - message_end with stopReason === "error" — the ONLY signal when the provider
  //    returns 4xx before any stream tokens (the live OpenRouter 401 case).
  it("records the message_end stopReason=error surface (4xx before any stream tokens)", () => {
    const acc = new TurnAccumulator();
    acc.handle({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: '401 {"error":{"message":"User not found.","code":401}}',
        text: "",
        toolCallCount: 0,
      },
    });
    expect(acc.providerErrors).toEqual(['401 {"error":{"message":"User not found.","code":401}}']);
  });

  it("records the stream_error event that terminates a stream", () => {
    const acc = new TurnAccumulator();
    acc.handle({ type: "stream_error", reason: "aborted", errorMessage: "boom from provider" });
    acc.handle({ type: "stream_error", reason: "error" });
    expect(acc.providerErrors).toEqual(["boom from provider", "Provider error (reason: error)"]);
  });

  it("ignores a non-error message_end and clears recorded errors on drain", () => {
    const acc = new TurnAccumulator();
    acc.handle({ type: "message_end", message: { role: "assistant", stopReason: "stop", text: "", toolCallCount: 0 } });
    expect(acc.providerErrors).toEqual([]);
    acc.handle({
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "x", text: "", toolCallCount: 0 },
    });
    acc.drain();
    expect(acc.providerErrors).toEqual([]);
  });
});
