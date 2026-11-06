import { describe, expect, it } from "vitest";
import {
  createAtomizationStateMachine,
  hasToolResultForCall,
  latestUserText,
  startScriptedProvider,
} from "../../../scripts/user-documentation/scripted-provider.mjs";
import {
  assertCaptureIsolationOrder,
  CAPTURE_EXECUTION_ORDER,
} from "../../../scripts/user-documentation/screenshot-matrix.mjs";

const tools = [
  { type: "function", function: { name: "read" } },
  { type: "function", function: { name: "write" } },
];
const mainTools = [
  ...tools,
  { type: "function", function: { name: "cbe_canvas" } },
  { type: "function", function: { name: "cbe_cite" } },
  { type: "function", function: { name: "cbe_picker" } },
  { type: "function", function: { name: "cbe_support" } },
];

const initialRequest = (rawPath: string) => ({
  model: "documentation-fixture-model",
  messages: [{ role: "user", content: [{ type: "text", text: `Atomize ${rawPath}` }] }],
  tools,
});

const atomWriteFollowUp = {
  model: "documentation-fixture-model",
  messages: [
    { role: "developer", content: "Atomization fixture system text" },
    { role: "user", content: [{ type: "text", text: "Atomize raw/studio-brief.md" }] },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "docs-write-atom",
          type: "function",
          function: { name: "write", arguments: '{"path":"wiki/concept/studio-brief.md"}' },
        },
      ],
    },
    {
      role: "tool",
      content: "Successfully wrote wiki/concept/studio-brief.md",
      tool_call_id: "docs-write-atom",
    },
  ],
  tools,
};

const indexWriteFollowUp = {
  ...atomWriteFollowUp,
  messages: [
    ...atomWriteFollowUp.messages,
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "docs-write-index",
          type: "function",
          function: { name: "write", arguments: '{"path":"wiki/index.md"}' },
        },
      ],
    },
    {
      role: "tool",
      content: "Successfully wrote wiki/index.md",
      tool_call_id: "docs-write-index",
    },
  ],
};

describe("documentation scripted provider latest-user routing", () => {
  it("drives a dedicated citation through cbe_cite before emitting its verified token", async () => {
    const provider = await startScriptedProvider({ locale: "en", port: 0 });
    const post = (messages: unknown[]) =>
      fetch(`${provider.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "documentation-fixture-model", messages, tools: mainTools, stream: true }),
      });
    const prompt = "Show a verified corpus citation for the documentation example.";

    try {
      const initialWire = await (await post([{ role: "user", content: [{ type: "text", text: prompt }] }])).text();
      expect(initialWire).toContain('"name":"cbe_cite"');
      expect(initialWire).toContain('\\"section\\":\\"Phase 1: Engage\\"');
      expect(provider.decisions.at(-1)?.action).toBe("emit-cbe-cite");

      const token = "(corpus:methodology-001 § Phase 1: Engage, Nichols, M., Cator, K., and Torres, M. 2016)";
      const citationToolHistory = [
        { role: "user", content: prompt },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "docs-cite",
              type: "function",
              function: { name: "cbe_cite", arguments: "{}" },
            },
          ],
        },
        { role: "tool", content: token, name: "cbe_cite", tool_call_id: "docs-cite" },
      ];
      const finalWire = await (await post(citationToolHistory)).text();
      expect(finalWire).toContain(token);
      expect(provider.decisions.at(-1)?.action).toBe("emit-verified-citation");

      const laterWire = await (
        await post([
          ...citationToolHistory,
          { role: "assistant", content: `Grounded fixture claim ${token}` },
          { role: "user", content: "Continue with an ordinary fixture response." },
        ])
      ).text();
      expect(laterWire).toContain("deterministic synthetic documentation fixture content");
      expect(provider.decisions.filter((decision) => decision.action === "emit-verified-citation")).toHaveLength(1);
      expect(provider.unknownRoutes).toEqual([]);
    } finally {
      await provider.close();
    }
  });

  it("does not let an earlier Working request shadow a later unanswered Picker, Support, or latest Working command", async () => {
    const provider = await startScriptedProvider({ locale: "en", port: 0 });
    const post = (messages: unknown[]) =>
      fetch(`${provider.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "documentation-fixture-model", messages, tools: mainTools, stream: true }),
      });
    const history = [
      { role: "user", content: "Keep this synthetic documentation answer open while I inspect the working state." },
      { role: "assistant", content: "You stopped this answer before it began." },
    ];

    try {
      const pickerMessages = [
        ...history,
        {
          role: "user",
          content: [{ type: "text", text: "Ask one closed choice for the documentation fixture." }],
        },
      ];
      expect(latestUserText({ messages: pickerMessages })).toBe("Ask one closed choice for the documentation fixture.");
      const pickerWire = await (await post(pickerMessages)).text();
      expect(pickerWire).toContain('"name":"cbe_picker"');
      expect(pickerWire).not.toContain("deterministic synthetic documentation fixture content");
      expect(provider.decisions.at(-1)?.action).toBe("emit-cbe-picker");
      expect(provider.heldCount).toBe(0);
      expect(provider.requests).toHaveLength(1);

      const supportMessages = [
        ...history,
        {
          role: "user",
          content: [{ type: "text", text: "Change my lasting support preference to concise." }],
        },
      ];
      const supportWire = await (await post(supportMessages)).text();
      expect(supportWire).toContain('"name":"cbe_support"');
      expect(provider.heldCount).toBe(0);

      const workingMessages = [
        { role: "user", content: [{ type: "text", text: "Ask one closed choice for the documentation fixture." }] },
        ...history.slice(0, 1),
      ];
      const pending = post(workingMessages);
      for (let attempt = 0; attempt < 100 && provider.heldCount === 0; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(provider.heldCount).toBe(1);
      expect(provider.decisions.at(-1)?.action).toBe("hold-working-answer");
      provider.releaseHolds();
      await (await pending).text();
    } finally {
      await provider.close();
    }
  });
});

describe("documentation screenshot execution isolation", () => {
  it("releases the held Working/Stop state before the held Wiki-ingestion state and leaves progress until last", () => {
    expect(assertCaptureIsolationOrder()).toBe(true);
    const ids = CAPTURE_EXECUTION_ORDER.map(([id]) => id);
    expect(ids).not.toContain("picker");
    expect(ids.indexOf("working-and-stop")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("working-and-stop")).toBeLessThan(ids.indexOf("wiki-ingestion-progress"));
    expect(ids.at(-1)).toBe("wiki-ingestion-progress");
    expect(() =>
      assertCaptureIsolationOrder([
        ...CAPTURE_EXECUTION_ORDER.slice(0, -2),
        ...CAPTURE_EXECUTION_ORDER.slice(-1),
        CAPTURE_EXECUTION_ORDER.at(-2)!,
      ])
    ).toThrow("must be the final logical capture");
  });
});

describe("documentation scripted provider atomization state machine", () => {
  it("drives studio brief through atom write, index write and final while timetable stays held", () => {
    const state = createAtomizationStateMachine();

    expect(state.classify(initialRequest("raw/studio-brief.md"))).toBe("emit-atom-write");
    expect(state.classify(atomWriteFollowUp)).toBe("emit-index-write");
    expect(state.classify(indexWriteFollowUp)).toBe("finish-first");
    expect(state.classify(initialRequest("raw/timetable.md"))).toBe("hold-independent");
  });

  it("routes concurrent atomization starts by raw path in either arrival order", () => {
    for (const order of [
      ["raw/studio-brief.md", "raw/timetable.md"],
      ["raw/timetable.md", "raw/studio-brief.md"],
    ]) {
      const state = createAtomizationStateMachine();
      const outcomes = Object.fromEntries(order.map((rawPath) => [rawPath, state.classify(initialRequest(rawPath))]));
      expect(outcomes).toEqual({
        "raw/studio-brief.md": "emit-atom-write",
        "raw/timetable.md": "hold-independent",
      });
      expect(state.classify(atomWriteFollowUp)).toBe("emit-index-write");
      expect(state.classify(indexWriteFollowUp)).toBe("finish-first");
    }
  });

  it("does not mistake an unreturned or unrelated tool call for either completed write", () => {
    const onlyCall = {
      ...atomWriteFollowUp,
      messages: atomWriteFollowUp.messages.slice(0, 3),
    };
    const wrongResult = {
      ...atomWriteFollowUp,
      messages: [
        ...atomWriteFollowUp.messages.slice(0, 3),
        { role: "tool", content: "another result", tool_call_id: "some-other-call" },
      ],
    };

    expect(hasToolResultForCall(onlyCall, "docs-write-atom")).toBe(false);
    expect(hasToolResultForCall(wrongResult, "docs-write-atom")).toBe(false);
    expect(hasToolResultForCall(atomWriteFollowUp, "docs-write-atom")).toBe(true);
    expect(hasToolResultForCall(atomWriteFollowUp, "docs-write-index")).toBe(false);
    expect(hasToolResultForCall(indexWriteFollowUp, "docs-write-index")).toBe(true);
  });
});
