import { describe, it, expect, vi } from "vitest";
import { checkJudge, extractJson, loadJudgeTemplate } from "../src/checker-judge.js";
import type { LlmClient, LlmCompletion } from "../src/judge-client.js";
import type { Checkpoint, Probe, Transcript } from "../src/types.js";

function tx(assistant: string): Transcript {
  return { probe: "p", model: "m", turns: [{ user: "u", assistant, tools: [] }] };
}
const probe: Probe = { probe: "p", scenarioFile: "f.md", setup: { profile: "app" }, turns: ["t"], checkpoints: [] };
const cp: Checkpoint = { id: "c1", type: "judge", rubric: "Does it frame competences explicitly?" };
const TEMPLATE = "rubric:{{rubric}} transcript:{{transcript}}";

function fakeClient(replies: string[]): LlmClient & { calls: { system: string; user: string }[] } {
  let i = 0;
  const calls: { system: string; user: string }[] = [];
  return {
    modelId: "judge-J",
    tokensUsed: 0,
    calls,
    async complete(system: string, user: string): Promise<LlmCompletion> {
      calls.push({ system, user });
      return { text: replies[i++] ?? replies[replies.length - 1]! };
    },
  };
}

describe("judge checker", () => {
  // spec: Judge returns a verdict with evidence
  it("returns pass/fail plus an evidence quote", async () => {
    const client = fakeClient([`{"verdict":"pass","evidence":"frames competences explicitly","reasoning":"ok"}`]);
    const r = await checkJudge(cp, tx("The module frames competences explicitly for students."), probe, {
      client,
      template: TEMPLATE,
    });
    expect(r.verdict).toBe("pass");
    expect(r.evidence).toBe("frames competences explicitly");
  });

  // spec: Verdict evidence is rooted in the transcript
  it("keeps evidence that is a verbatim substring of the transcript", async () => {
    const transcript = "We explicitly name three competences: analysis, synthesis, evaluation.";
    const client = fakeClient([`{"verdict":"pass","evidence":"three competences: analysis","reasoning":"x"}`]);
    const r = await checkJudge(cp, tx(transcript), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("pass");
    expect(transcript.includes(r.evidence!)).toBe(true);
  });

  it("flags a pass whose evidence is NOT verbatim in the transcript", async () => {
    const client = fakeClient([`{"verdict":"pass","evidence":"a paraphrase that does not appear","reasoning":"x"}`]);
    const r = await checkJudge(cp, tx("entirely different wording"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("pass");
    expect(r.evidence).toBeUndefined();
    expect(r.reasoning).toMatch(/not found verbatim/);
  });

  // spec: The same judge scores every candidate in a comparison
  it("scores transcripts from candidates A and B with the same judge, never the candidate", async () => {
    const client = fakeClient([
      `{"verdict":"pass","evidence":"A out","reasoning":"x"}`,
      `{"verdict":"fail","reasoning":"y"}`,
    ]);
    const rA = await checkJudge(cp, tx("candidate A out"), probe, { client, template: TEMPLATE });
    const rB = await checkJudge(cp, tx("candidate B out"), probe, { client, template: TEMPLATE });
    expect(rA.verdict).toBe("pass");
    expect(rB.verdict).toBe("fail");
    expect(client.calls).toHaveLength(2); // both scored by judge J
  });

  it("retries once on non-JSON, then succeeds", async () => {
    const client = fakeClient(["not json at all", `{"verdict":"fail","reasoning":"second try"}`]);
    const r = await checkJudge(cp, tx("x"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("fail");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.user).toMatch(/not valid JSON/);
  });

  it("salvages the verdict from malformed JSON (inner quote in evidence), without retrying", async () => {
    // The evidence value contains an unescaped " — this is exactly what broke 7c.3 live.
    const bad = '{"verdict":"fail","evidence":"he said "yes" and left","reasoning":"x"}';
    const client = fakeClient([bad, `{"verdict":"pass"}`]);
    const r = await checkJudge(cp, tx("he said yes and left"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("fail");
    expect(client.calls).toHaveLength(1); // recovered on the first reply, no wasted retry
    expect(r.reasoning).toMatch(/recovered from malformed JSON/);
  });

  it("marks judge_error after two unparseable replies", async () => {
    const client = fakeClient(["nope", "still nope"]);
    const r = await checkJudge(cp, tx("x"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("error");
    expect(r.reasoning).toMatch(/judge_error/);
  });

  it("returns error (not throw) when the judge call fails", async () => {
    const client: LlmClient = {
      modelId: "j",
      tokensUsed: 0,
      async complete() {
        throw new Error("429 rate limited");
      },
    };
    const r = await checkJudge(cp, tx("x"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("error");
  });

  // Judge blind spot fix: tool calls and user turns are visible in the judge prompt.
  it("includes tool-call names and the user turn in the judge prompt", async () => {
    const client = fakeClient([`{"verdict":"pass","evidence":"cited from corpus","reasoning":"x"}`]);
    const transcript: Transcript = {
      probe: "p",
      model: "m",
      turns: [{ user: "please cite sources", assistant: "cited from corpus", tools: [{ name: "cbe_cite" }] }],
    };
    await checkJudge(cp, transcript, probe, { client, template: TEMPLATE });
    expect(client.calls[0]!.user).toContain("[turn 1 | tool calls] cbe_cite");
    expect(client.calls[0]!.user).toContain("please cite sources");
  });

  it("drops pass evidence quoted from the user turn (grounding is assistant-only)", async () => {
    const client = fakeClient([`{"verdict":"pass","evidence":"please cite sources","reasoning":"x"}`]);
    const transcript: Transcript = {
      probe: "p",
      model: "m",
      turns: [{ user: "please cite sources", assistant: "completely different reply", tools: [] }],
    };
    const r = await checkJudge(cp, transcript, probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("pass");
    expect(r.evidence).toBeUndefined();
    expect(r.reasoning).toMatch(/not found verbatim/);
  });

  it("marks not-assessable when the checkpoint targets an undeclared turn", async () => {
    const client = fakeClient([`{"verdict":"pass"}`]);
    const r = await checkJudge({ ...cp, turn: 5 }, tx("only one turn"), probe, { client, template: TEMPLATE });
    expect(r.verdict).toBe("not-assessable");
    expect(client.calls).toHaveLength(0); // no LLM call wasted
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The SHIPPED template, not the stub above. `turn:` is inert on a judge
// checkpoint, so the only thing that can hold a scoped rubric to its turn is the
// standing rule in the prompt itself. Asserted here because `2d` carried a
// per-rubric preamble from 2026-08-09 and still failed 3/3 with an evidence quote
// lifted out of turn 2 — the judge said so in its own reasoning.
// spec: cbe-skill-eval-harness, Requirement "A Turn-Scoped Judge Rubric Is Decided
//       and Evidenced Inside Its Turn"
// ─────────────────────────────────────────────────────────────────────────────
describe("the shipped judge prompt template", () => {
  const template = loadJudgeTemplate();
  const flat = template.replace(/\s+/g, " ");

  // spec scenario: The judge prompt binds a scoped verdict to its turn
  it("binds a scoped verdict to its turn", () => {
    expect(flat).toContain("Decide the verdict on THAT turn alone");
    expect(flat).toContain("Behaviour in any other turn MUST NOT influence it");
  });

  // spec scenario: The judge prompt binds the evidence quote to the scoped turn
  it("binds the evidence quote to the scoped turn", () => {
    expect(flat).toContain("Take the `evidence` quote from that same turn");
    expect(flat).toContain("Never reach into another turn for a quote");
    expect(flat).toContain("the quote MUST come from THAT turn's assistant section");
  });

  // spec scenario: A rubric does not grade what the judge cannot see — the template
  // is where the judge learns that tool arguments are not in the transcript at all.
  it("states that the tool-calls line carries names only", () => {
    expect(flat).toContain("it carries tool NAMES only, never their arguments");
  });
});

describe("extractJson", () => {
  it("pulls a JSON object out of fenced / prose-wrapped replies", () => {
    expect(extractJson('```json\n{"verdict":"pass"}\n```')).toEqual({ verdict: "pass" });
    expect(extractJson('Sure: {"a":1} done')).toEqual({ a: 1 });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no braces here")).toThrow();
  });
});
