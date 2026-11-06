/**
 * Unit tests for the live activity reducer.
 *
 * The reducer is the single source of truth for what the lecturer sees during
 * an agent run — every IPC event from pi-agent-core flows through here. The
 * tests below exercise each action variant in isolation AND the cross-action
 * invariants that the chronological-stream design depends on (sub-turn
 * boundaries do NOT touch items, fresh prompts wipe everything, text deltas
 * extend OR open a new segment depending on what came before).
 */
import { describe, it, expect } from "vitest";
import { liveReducer, INITIAL_LIVE, type LiveTurnState } from "../src/renderer/state/liveReducer.js";
import type { ActivityItem } from "../src/renderer/state/activity.js";

function toolItem(id: string, status: "running" | "done" | "error" = "running"): ActivityItem {
  return {
    kind: "tool",
    id,
    data: { toolCallId: id, toolName: "read", args: { path: "x.md" }, status },
  };
}

describe("liveReducer — lifecycle", () => {
  it("agent_start flips streaming on without touching items", () => {
    const seeded: LiveTurnState = {
      ...INITIAL_LIVE,
      items: [{ kind: "text", id: "t-0", text: "hi" }],
    };
    const next = liveReducer(seeded, { type: "agent_start" });
    expect(next.streaming).toBe(true);
    expect(next.items).toEqual(seeded.items);
  });

  it("agent_end flips streaming off without touching items", () => {
    const seeded: LiveTurnState = {
      ...INITIAL_LIVE,
      streaming: true,
      items: [{ kind: "text", id: "t-0", text: "hi" }],
    };
    const next = liveReducer(seeded, { type: "agent_end" });
    expect(next.streaming).toBe(false);
    expect(next.items).toEqual(seeded.items);
  });

  it("turn_start is a no-op — sub-turn boundaries must NOT wipe items", () => {
    const seeded: LiveTurnState = {
      ...INITIAL_LIVE,
      streaming: true,
      items: [{ kind: "text", id: "t-0", text: "before tool" }, toolItem("call-1", "done")],
      textSeq: 1,
    };
    const next = liveReducer(seeded, { type: "turn_start" });
    expect(next).toBe(seeded);
  });

  it("turn_end is a no-op — sub-turn boundaries must NOT wipe items", () => {
    const seeded: LiveTurnState = {
      ...INITIAL_LIVE,
      streaming: true,
      items: [toolItem("call-1", "done")],
    };
    const next = liveReducer(seeded, { type: "turn_end" });
    expect(next).toBe(seeded);
  });
});

describe("liveReducer — text_delta segmentation", () => {
  it("opens a new text segment when items is empty", () => {
    const next = liveReducer(INITIAL_LIVE, {
      type: "text_delta",
      data: { delta: "hello" },
    });
    expect(next.items).toEqual([{ kind: "text", id: "t-0", text: "hello" }]);
    expect(next.textSeq).toBe(1);
  });

  it("extends the trailing text item across consecutive deltas", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "text_delta", data: { delta: "hel" } });
    s = liveReducer(s, { type: "text_delta", data: { delta: "lo " } });
    s = liveReducer(s, { type: "text_delta", data: { delta: "world" } });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toEqual({ kind: "text", id: "t-0", text: "hello world" });
    expect(s.textSeq).toBe(1);
  });

  it("opens a NEW text segment after a tool interrupts the stream", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "text_delta", data: { delta: "intro " } });
    s = liveReducer(s, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c1", result: "ok", isError: false },
    });
    s = liveReducer(s, { type: "text_delta", data: { delta: "after" } });
    expect(s.items).toHaveLength(3);
    expect(s.items[0]).toMatchObject({ kind: "text", id: "t-0", text: "intro " });
    expect(s.items[1]).toMatchObject({ kind: "tool", id: "c1" });
    expect(s.items[2]).toMatchObject({ kind: "text", id: "t-1", text: "after" });
    expect(s.textSeq).toBe(2);
  });

  it("opens a NEW text segment after a thinking block interrupts the stream", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "text_delta", data: { delta: "before" } });
    s = liveReducer(s, { type: "thinking_start", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "thinking_end", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "text_delta", data: { delta: "after" } });
    expect(s.items.map((i) => i.kind)).toEqual(["text", "thinking", "text"]);
    expect((s.items[0] as { text: string }).text).toBe("before");
    expect((s.items[2] as { text: string }).text).toBe("after");
  });
});

describe("liveReducer — tool lifecycle", () => {
  it("tool_start appends a running tool item with the toolCallId as the React key", () => {
    const next = liveReducer(INITIAL_LIVE, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: { path: "a.md" } },
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: "tool",
      id: "c1",
      data: { toolName: "read", status: "running", args: { path: "a.md" } },
    });
  });

  it("tool_update merges partialResult into the matching tool item", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    s = liveReducer(s, {
      type: "tool_update",
      data: { toolCallId: "c1", partialResult: { lines: 12 } },
    });
    expect(s.items[0]).toMatchObject({
      kind: "tool",
      data: { status: "running", result: { lines: 12 } },
    });
  });

  it("tool_end with isError=false transitions status → done", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c1", result: "ok", isError: false },
    });
    expect(s.items[0]).toMatchObject({
      kind: "tool",
      data: { status: "done", result: "ok", errorMessage: undefined },
    });
  });

  it("tool_end with isError=true transitions status → error and surfaces a string result as errorMessage", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c1", result: "ENOENT", isError: true },
    });
    expect(s.items[0]).toMatchObject({
      kind: "tool",
      data: { status: "error", errorMessage: "ENOENT" },
    });
  });

  it("tool_end with isError=true and a non-string result falls back to a generic message", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: {} },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c1", result: { code: 1 }, isError: true },
    });
    expect(s.items[0]).toMatchObject({
      kind: "tool",
      data: { status: "error", errorMessage: "Tool execution failed" },
    });
  });

  it("tool_update for an unknown toolCallId is a no-op", () => {
    const seeded: LiveTurnState = { ...INITIAL_LIVE, items: [toolItem("c1")] };
    const next = liveReducer(seeded, {
      type: "tool_update",
      data: { toolCallId: "unknown", partialResult: 42 },
    });
    expect(next.items).toEqual(seeded.items);
  });
});

describe("liveReducer — thinking lifecycle", () => {
  it("thinking_start mints a fresh monotonic id, not the SDK contentIndex", () => {
    // Two sub-turns in a row both report contentIndex 0 (each message restarts
    // at 0). Our minted ids must NOT collide.
    let s = liveReducer(INITIAL_LIVE, { type: "thinking_start", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "thinking_end", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "thinking_start", data: { contentIndex: 0 } });
    expect(s.items).toHaveLength(2);
    expect((s.items[0] as { id: number }).id).toBe(0);
    expect((s.items[1] as { id: number }).id).toBe(1);
    expect(s.thinkingSeq).toBe(2);
  });

  it("thinking_delta extends the most recent OPEN thinking block", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "thinking_start", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "thinking_delta", data: { contentIndex: 0, delta: "rea" } });
    s = liveReducer(s, { type: "thinking_delta", data: { contentIndex: 0, delta: "soning…" } });
    expect((s.items[0] as { data: { text: string } }).data.text).toBe("reasoning…");
  });

  it("thinking_delta with no open block is a no-op", () => {
    const next = liveReducer(INITIAL_LIVE, {
      type: "thinking_delta",
      data: { contentIndex: 0, delta: "noop" },
    });
    expect(next).toBe(INITIAL_LIVE);
  });

  it("thinking_end closes the most recent open block (sets done=true)", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "thinking_start", data: { contentIndex: 0 } });
    s = liveReducer(s, { type: "thinking_end", data: { contentIndex: 0 } });
    expect((s.items[0] as { data: { done: boolean } }).data.done).toBe(true);
  });

  it("thinking_end with no open block is a no-op", () => {
    const next = liveReducer(INITIAL_LIVE, {
      type: "thinking_end",
      data: { contentIndex: 0 },
    });
    expect(next).toBe(INITIAL_LIVE);
  });
});

describe("liveReducer — banners (compaction + retry)", () => {
  it("compaction_start sets the reason banner, compaction_end clears it", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "compaction_start",
      data: { reason: "context-full" },
    });
    expect(s.compactionReason).toBe("context-full");
    s = liveReducer(s, { type: "compaction_end" });
    expect(s.compactionReason).toBeNull();
  });

  it("retry_start carries attempt/maxAttempts, retry_end clears it", () => {
    let s = liveReducer(INITIAL_LIVE, {
      type: "retry_start",
      data: { attempt: 2, maxAttempts: 5 },
    });
    expect(s.retryAttempt).toEqual({ attempt: 2, maxAttempts: 5 });
    s = liveReducer(s, { type: "retry_end" });
    expect(s.retryAttempt).toBeNull();
  });
});

describe("liveReducer — reset (fresh prompt wipes transients)", () => {
  it("reset returns INITIAL_LIVE, dropping items, banners, retry, AND streaming flag", () => {
    const seeded: LiveTurnState = {
      items: [{ kind: "text", id: "t-0", text: "old" }, toolItem("c1", "done")],
      thinkingSeq: 3,
      textSeq: 4,
      streaming: true,
      compactionReason: "x",
      retryAttempt: { attempt: 1, maxAttempts: 3 },
    };
    const next = liveReducer(seeded, { type: "reset" });
    expect(next).toEqual(INITIAL_LIVE);
  });
});

describe("liveReducer — invariant: full run produces chronological text/tool/text", () => {
  it("intro → tool → narration → tool → answer round-trips into items in order", () => {
    let s = liveReducer(INITIAL_LIVE, { type: "reset" });
    s = liveReducer(s, { type: "agent_start" });
    s = liveReducer(s, { type: "turn_start" });
    s = liveReducer(s, { type: "text_delta", data: { delta: "Lass mich nachsehen. " } });
    s = liveReducer(s, {
      type: "tool_start",
      data: { toolCallId: "c1", toolName: "read", args: { path: "a.md" } },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c1", result: "…", isError: false },
    });
    s = liveReducer(s, { type: "turn_end" });
    s = liveReducer(s, { type: "turn_start" });
    s = liveReducer(s, { type: "text_delta", data: { delta: "Wie erwartet. " } });
    s = liveReducer(s, {
      type: "tool_start",
      data: { toolCallId: "c2", toolName: "grep", args: { pattern: "x" } },
    });
    s = liveReducer(s, {
      type: "tool_end",
      data: { toolCallId: "c2", result: "…", isError: false },
    });
    s = liveReducer(s, { type: "text_delta", data: { delta: "Antwort folgt." } });
    s = liveReducer(s, { type: "turn_end" });
    s = liveReducer(s, { type: "agent_end" });

    expect(s.items.map((i) => i.kind)).toEqual(["text", "tool", "text", "tool", "text"]);
    expect((s.items[0] as { text: string }).text).toBe("Lass mich nachsehen. ");
    expect((s.items[2] as { text: string }).text).toBe("Wie erwartet. ");
    expect((s.items[4] as { text: string }).text).toBe("Antwort folgt.");
    expect(s.streaming).toBe(false);
  });
});
