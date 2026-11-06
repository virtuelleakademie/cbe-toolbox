/**
 * Contract group `deferred-answer` — the picker answer-as-user-turn round-trip
 * (capability `agent-harness`, Requirements: *The Agent Run Ends on a
 * Deferred-Answer Tool Call* and *Pi Upgrades Are Proven Through a Public
 * Contract Harness*, Scenario: *Deferred-answer tool ends cleanly and accepts
 * the next answer*).
 *
 * Built while investigating the reported failure
 *
 *   Error invoking remote method 'cbe:prompt': Error: Cannot continue from
 *   message role: assistant
 *
 * The picker design routes the lecturer's answer back as a NEW user turn via
 * `session.prompt(text)`. This file drives the REAL `startCbeSession` — the
 * production tool set, the production `cbe_picker`, the production provider
 * registration — through one and two picker round-trips and asserts that each
 * picker run makes exactly one model request, settles, and accepts the answer.
 *
 * The reported throw could NOT be reproduced in isolation across a wide battery
 * of scripted conditions (overflow / threshold compaction, retry, model error
 * turns, nested pickers, silent- and length-overflow); it only originates from
 * Pi's internal continue on an assistant-terminated transcript. Pinning the
 * exact trigger needs the real stack trace from the running app; see the
 * diagnostic instrumentation on the `cbe:prompt` IPC handler.
 *
 * History of the seam: the 0.75.5 version of this harness overwrote the private
 * `session.agent.streamFn`; the first Pi 1.3 version built a separate session
 * with its own provider. Change `guard-pi-upgrades-with-contract-tests` (task
 * 2.2) moved it onto the ONE public scripted provider and the CBE-owned port,
 * so it now asserts what a host observes rather than Pi's transcript.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openContractHarness, runBracket, type ContractHarness } from "./contracts/harness.js";

const PICKER_ARGS = {
  question: "Which finding first?",
  options: [
    { id: "engage", label: "Engage rebuild" },
    { id: "act", label: "Act phase" },
  ],
};

let harness: ContractHarness;

beforeEach(() => {
  harness = openContractHarness("picker");
});

afterEach(() => harness.close());

describe("Scenario: Deferred-answer tool ends cleanly and accepts the next answer", () => {
  // The END-TO-END half of `deferred-tool-terminates-run.test.ts`, which asserts
  // the flag on the result: here real Pi runs the loop and the script counts the
  // model round trips.
  it("a picker call ends the run — one model round trip, no second turn on the placeholder", async () => {
    const { result, events } = await harness.start();
    // The second scripted response is a trap: before `terminate: true` the loop
    // consumed it (that was the empty pass observed in the UX-3 run of 2026-08-05).
    harness.script.push(
      { blocks: [{ kind: "toolCall", id: "call-1", name: "cbe_picker", args: PICKER_ARGS }] },
      { blocks: [{ kind: "text", text: "This response must never be requested." }] }
    );

    await result.session.prompt("Help me redesign my module.");

    expect(harness.script.requests).toHaveLength(1);
    expect(runBracket(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    // The run ends on the delivered tool result, not on a trailing assistant
    // turn — a state Pi can always continue from.
    const roles = events.flatMap((e) => (e.type === "message_end" ? [e.message.role] : []));
    expect(roles.at(-1)).toBe("toolResult");
  });

  it("two picker round-trips submit their answers cleanly (no continue-from-assistant throw)", async () => {
    const { result, events } = await harness.start();
    // One scripted response per model round trip: each picker call terminates the
    // run, so a prompt that emits a picker consumes exactly one response.
    harness.script.push(
      { blocks: [{ kind: "toolCall", id: "call-1", name: "cbe_picker", args: PICKER_ARGS }] },
      { blocks: [{ kind: "toolCall", id: "call-2", name: "cbe_picker", args: PICKER_ARGS }] },
      { blocks: [{ kind: "text", text: "Working from your second answer now." }] }
    );

    await result.session.prompt("Help me redesign my module.");
    await result.session.prompt('[picker answer · tool call call-1]\nselected: engage ("Engage rebuild")');

    // Precondition: the second picker really ran, so the answer below is
    // submitted against the call it belongs to.
    expect(harness.script.requests).toHaveLength(2);
    const pickerCalls = events.flatMap((e) =>
      e.type === "tool_execution_start" && e.toolName === "cbe_picker" ? [e.toolCallId] : []
    );
    expect(pickerCalls).toEqual(["call-1", "call-2"]);

    // The reported failure happened HERE — submitting the second picker answer.
    await expect(
      result.session.prompt('[picker answer · tool call call-2]\nselected: act ("Act phase")')
    ).resolves.toBeUndefined();
    expect(harness.script.requests).toHaveLength(3);
    // Each answer arrived as the next user turn of the same conversation.
    expect(harness.script.requests[2]!.userTexts.slice(-2)).toEqual([
      '[picker answer · tool call call-1]\nselected: engage ("Engage rebuild")',
      '[picker answer · tool call call-2]\nselected: act ("Act phase")',
    ]);
    // Three accepted prompts, three settled runs, none of them aborted.
    expect(runBracket(events)).toEqual([
      { type: "agent_start" },
      { type: "agent_end", aborted: false },
      { type: "agent_start" },
      { type: "agent_end", aborted: false },
      { type: "agent_start" },
      { type: "agent_end", aborted: false },
    ]);
  });
});
