/**
 * Contract group `lifecycle` — Scenario: *Lifecycle contract catches premature
 * finalization* (capability `agent-harness`, Requirement: *Pi Upgrades Are
 * Proven Through a Public Contract Harness*; change
 * `guard-pi-upgrades-with-contract-tests`, task 3.2).
 *
 * The scripted provider produces a provider error, so REAL Pi reaches its
 * low-level end and schedules an automatic retry; the retried response is then
 * held open by the test. While it is held the host must see no terminal event
 * and no resolved prompt — Electron main promotes and persists the turn, releases
 * the run lock and marks an unseen completion only on the settled `agent_end`, so
 * those are the two signals that gate all four — and Pi's own record must carry
 * no answer yet; once Pi settles, exactly one of each. The settle-hook
 * continuation and the interleaved-sessions halves live in
 * `settled-lifecycle.test.ts`; the renderer half in the app's
 * `run-finalization.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openContractHarness, persistedAssistantTexts, runBracket, type ContractHarness } from "./harness.js";

let harness: ContractHarness;

beforeEach(() => {
  harness = openContractHarness("lifecycle");
});

afterEach(() => harness.close());

function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe("Scenario: Lifecycle contract catches premature finalization", () => {
  it("emits nothing terminal, persists no answer and keeps the prompt pending between the low-level end and the retried response", async () => {
    const { result, events, sessionsDir } = await harness.start();
    const gate = held();
    harness.script.push(
      { blocks: [], stopReason: "error", errorMessage: "503 service unavailable" },
      { blocks: [{ kind: "text", text: "Nach dem Retry." }], holdUntil: gate.promise }
    );

    let settled = false;
    const run = result.session.prompt("Hallo").then(() => (settled = true));
    await expect.poll(() => events.some((e) => e.type === "text_delta")).toBe(true);

    // Pi has ended one low-level run (the error) and is inside the retry.
    expect(events.filter((e) => e.type === "auto_retry_start")).toHaveLength(1);
    expect(events.some((e) => e.type === "agent_end")).toBe(false);
    expect(settled).toBe(false);
    expect(persistedAssistantTexts(sessionsDir)).not.toContain("Nach dem Retry.");

    gate.release();
    await run;

    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    // The terminal event is the LAST event of the run: after every message and tool event.
    expect(events.at(-1)).toEqual({ type: "agent_end", aborted: false });
    expect(persistedAssistantTexts(sessionsDir)).toContain("Nach dem Retry.");
  });

  it("settles exactly once per accepted prompt across consecutive ordinary runs", async () => {
    const { result, events } = await harness.start();
    harness.script.push(
      { blocks: [{ kind: "text", text: "Eins." }] },
      { blocks: [{ kind: "toolCall", id: "c1", name: "ls", args: { path: "." } }] },
      { blocks: [{ kind: "text", text: "Zwei." }] },
      { blocks: [{ kind: "text", text: "Drei." }] }
    );

    for (const prompt of ["erste", "zweite", "dritte"]) {
      const before = events.length;
      await result.session.prompt(prompt);
      const run = events.slice(before);
      expect(runBracket(run)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
      expect(run[0]).toEqual({ type: "agent_start" });
      expect(run.at(-1)).toEqual({ type: "agent_end", aborted: false });
    }
  });

  it("a stop inside the held retry completes only at settlement and leaves the session continuable", async () => {
    const { result, events } = await harness.start();
    result.session.subscribe((event) => {
      if (event.type === "agent_start") result.turnStop.noteRunStart();
      if (event.type === "agent_end") result.turnStop.noteRunEnd();
    });
    harness.script.push(
      { blocks: [], stopReason: "error", errorMessage: "503 service unavailable" },
      { blocks: [{ kind: "text", text: "Wird gestoppt" }], waitForAbort: true },
      { blocks: [{ kind: "text", text: "Neue Antwort." }] }
    );

    const run = result.session.prompt("Hallo");
    await expect.poll(() => events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(false);

    const outcome = await result.turnStop.stop();
    await run;
    expect(outcome).toEqual({ status: "stopped" });
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: true }]);

    events.length = 0;
    await result.session.prompt("Weiter.");
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    expect(events).toContainEqual({
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", text: "Neue Antwort.", toolCallCount: 0 },
    });
  });
});
