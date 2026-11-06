/**
 * Contract group `provider` — Scenario: *Scripted provider exercises the real
 * runtime without network* (capability `agent-harness`, Requirement: *Pi
 * Upgrades Are Proven Through a Public Contract Harness*; change
 * `guard-pi-upgrades-with-contract-tests`, tasks 2.1 and 3.1).
 *
 * The script supplies provider OUTPUT only — text, thinking, a tool call, an
 * error, usage and a delay. Real Pi then decides the rest: it runs the tool,
 * retries the error, writes the session record and emits the events the port
 * normalizes. Every case runs with the network sentinel armed, so a request that
 * leaves the process is a recorded failure, not a slow test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forbidNetwork, type NetworkSentinel } from "../helpers/no-network.js";
import { openContractHarness, persistedAssistantTexts, runBracket, type ContractHarness } from "./harness.js";

let harness: ContractHarness;
let network: NetworkSentinel;

beforeEach(() => {
  network = forbidNetwork();
  harness = openContractHarness("provider");
});

afterEach(() => {
  harness.close();
  network.restore();
});

describe("Scenario: Scripted provider exercises the real runtime without network", () => {
  it("drives thinking, a real tool execution, a retried error and text through real Pi with no request leaving the process", async () => {
    const { result, events, sessionsDir } = await harness.start();
    harness.script.push(
      {
        blocks: [
          { kind: "thinking", text: "Ich schaue zuerst nach." },
          { kind: "toolCall", id: "call-ls", name: "ls", args: { path: "." } },
        ],
      },
      { blocks: [], stopReason: "error", errorMessage: "503 service unavailable" },
      { blocks: [{ kind: "text", text: "Fertig." }], inputTokens: 42, outputTokens: 7 }
    );

    await result.session.prompt("Bitte prüfe den Arbeitsbereich.");

    // Real Pi executed the tool the script named, retried the scripted error and
    // finished on the scripted text — one CBE run.
    expect(events).toContainEqual({ type: "thinking_delta", contentIndex: 0, delta: "Ich schaue zuerst nach." });
    expect(
      events.filter((e) => e.type === "tool_execution_end").map((e) => e.type === "tool_execution_end" && e.toolName)
    ).toEqual(["ls"]);
    expect(events.filter((e) => e.type === "auto_retry_start")).toHaveLength(1);
    expect(events).toContainEqual({
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", text: "Fertig.", toolCallCount: 0 },
    });
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    // Usage reaches the runtime's own accounting.
    expect(result.session.getContextUsage()?.tokens).toBe(49);
    // Every model call went through the public seam to the configured BYO model …
    expect(harness.script.requests.map((r) => `${r.provider}/${r.modelId}`)).toEqual([
      "byo-llm/contract-model",
      "byo-llm/contract-model",
      "byo-llm/contract-model",
    ]);
    // … real Pi persisted the turn, and nothing touched the network.
    expect(persistedAssistantTexts(sessionsDir)).toContain("Fertig.");
    expect(network.attempts).toEqual([]);
  });

  it("holds a controlled delay open: nothing terminal is emitted until the scripted response is released", async () => {
    const { result, events } = await harness.start();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    harness.script.push({ blocks: [{ kind: "text", text: "Langsam." }], delayMs: 20, holdUntil: held });

    const run = result.session.prompt("Antworte langsam.");
    await expect.poll(() => events.some((e) => e.type === "text_delta")).toBe(true);
    // The response is streaming and held: the run has neither ended its message nor settled.
    expect(events.some((e) => e.type === "message_end" && e.message.role === "assistant")).toBe(false);
    expect(events.some((e) => e.type === "agent_end")).toBe(false);

    release();
    await run;
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    expect(network.attempts).toEqual([]);
  });

  it("the sentinel itself is able to fail: a real fetch or socket connect is recorded and refused", async () => {
    await expect(fetch("http://127.0.0.1:9/never")).rejects.toThrow(/network access is forbidden/);
    const { Socket } = await import("node:net");
    expect(() => new Socket().connect(9, "127.0.0.1")).toThrow(/network access is forbidden/);
    expect(network.attempts).toHaveLength(2);
    network.attempts.length = 0;
  });
});
