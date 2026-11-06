import { describe, it, expect } from "vitest";
import { scoreProbe, EMPTY_COMPLETION_REASON } from "../src/scorer.js";
import type { LlmClient, LlmCompletion } from "../src/judge-client.js";
import type { Probe, Transcript } from "../src/types.js";

const TEMPLATE = "rubric:{{rubric}} transcript:{{transcript}}";

function probe(): Probe {
  return {
    probe: "p",
    scenarioFile: "f.md",
    setup: { profile: "app" },
    turns: ["t"],
    checkpoints: [
      { id: "p.1", type: "deterministic", check: { kind: "contains", pattern: "competence" } },
      { id: "p.2", type: "judge", rubric: "Does it frame competences explicitly?" },
    ],
  };
}

function countingClient(reply: string): LlmClient & { calls: number } {
  const client = {
    modelId: "judge-J",
    tokensUsed: 0,
    calls: 0,
    async complete(): Promise<LlmCompletion> {
      client.calls += 1;
      return { text: reply };
    },
  };
  return client;
}

// fix/eval-runner-provider-errors, defense-in-depth: an all-empty transcript that
// still reaches scoring (the session layer should have thrown first) is marked as
// a suspected provider failure instead of being seriously judged as a content FAIL.
describe("scoreProbe empty-completion guard", () => {
  it("marks every checkpoint 'error' with the empty-completion reason and never calls the judge", async () => {
    const transcript: Transcript = {
      probe: "p",
      model: "m",
      turns: [
        { user: "t1", assistant: "", tools: [] },
        { user: "t2", assistant: "   \n", tools: [] },
      ],
    };
    const client = countingClient(`{"verdict":"fail","reasoning":"the assistant's turn is empty"}`);
    const results = await scoreProbe(probe(), transcript, {
      corpusIds: new Set(),
      judge: { client, template: TEMPLATE },
    });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.verdict).toBe("error");
      expect(r.reasoning).toBe(EMPTY_COMPLETION_REASON);
    }
    expect(client.calls).toBe(0); // no judge tokens burned on an empty transcript
  });

  it("scores normally when a turn produced tool calls even without assistant text", async () => {
    const transcript: Transcript = {
      probe: "p",
      model: "m",
      turns: [{ user: "t1", assistant: "", tools: [{ name: "cbe_picker" }] }],
    };
    const client = countingClient(`{"verdict":"fail","reasoning":"no text"}`);
    const results = await scoreProbe(probe(), transcript, {
      corpusIds: new Set(),
      judge: { client, template: TEMPLATE },
    });
    expect(results.map((r) => r.verdict)).toEqual(["fail", "fail"]);
    expect(results.every((r) => r.reasoning !== EMPTY_COMPLETION_REASON)).toBe(true);
    expect(client.calls).toBe(1);
  });

  it("scores a transcript with assistant text through the normal path", async () => {
    const transcript: Transcript = {
      probe: "p",
      model: "m",
      turns: [{ user: "t1", assistant: "We frame each competence explicitly.", tools: [] }],
    };
    const client = countingClient(`{"verdict":"pass","reasoning":"ok"}`);
    const results = await scoreProbe(probe(), transcript, {
      corpusIds: new Set(),
      judge: { client, template: TEMPLATE },
    });
    expect(results.map((r) => r.verdict)).toEqual(["pass", "pass"]);
  });
});
