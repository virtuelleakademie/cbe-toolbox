import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App } from "../src/renderer/App.js";
import { useCbe } from "../src/renderer/state/store.js";
import { writeSessionJson, writeSessionMd, readSessionJson, type SessionMeta } from "../src/main/sessions.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";
import { promotedAssistantTurn } from "../src/shared/turn-stop.js";
import type { ConversationOpenResult, ProviderStatus, StoredTurn } from "../src/shared/ipc-contract.js";

const PROVIDER: ProviderStatus = { baseURL: "http://localhost:1", modelId: "test-model", hasKey: true };
const META: SessionMeta = {
  sessionId: "conv-cards",
  modelId: "gemma4-31b",
  skillVersion: "0.1.3",
  environmentProfile: "app",
  createdAt: "2026-08-25T10:00:00.000Z",
  closedAt: "2026-08-25T10:42:00.000Z",
};
const CANVAS_ARGS = { step: 3, id: "challenge-frame", label: "Challenge frame", value: "**Draft** framing." };
const STEP_ARGS = { step: 3, depth: "rough", focus: true };
const MATURITY_ARGS = { criterion: "authenticity", current: 2 };
const LEAD = "I have written the framing onto step 3.";
const TAIL = "\n\nNext we look at the assessment.";

function piResult(text: string) {
  return { content: [{ type: "text", text }], details: { kind: "canvas-update" } };
}

function recordedTurn(text: string) {
  const recorder = new ToolCardRecorder();
  recorder.start("c1", "cbe_canvas", CANVAS_ARGS, text ? LEAD.length : 0);
  recorder.end("c1", piResult("Artefact recorded on step 3."), false);
  recorder.start("c2", "cbe_step", STEP_ARGS, text ? LEAD.length : 0);
  recorder.end("c2", piResult("Step 3 is now rough."), false);
  recorder.start("c3", "cbe_maturity", MATURITY_ARGS, text ? LEAD.length : 0);
  recorder.end("c3", piResult("Authenticity read at L2."), false);
  return promotedAssistantTurn(text, false, recorder.take())!;
}

async function restart(turns: Parameters<typeof writeSessionJson>[2]): Promise<StoredTurn[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "cbe-cards-ui-"));
  try {
    await writeSessionMd(dir, META, turns);
    await writeSessionJson(dir, META, turns);
    const json = await readSessionJson(dir, META.sessionId);
    if (!json) throw new Error("sidecar unreadable after restart");
    return json.turns;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function conversation(turns: StoredTurn[], overrides?: Partial<ConversationOpenResult>): ConversationOpenResult {
  return {
    session: {
      sessionId: META.sessionId,
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/w", corpus: "/c" },
      courseId: "algorithmen",
    },
    turns,
    agentRunning: false,
    canvas: [],
    ...overrides,
  };
}

async function reopen(turns: StoredTurn[], overrides?: Partial<ConversationOpenResult>) {
  Object.assign(window.cbe, {
    getConfig: async () => PROVIDER,
    openConversation: vi.fn(async () => conversation(turns, overrides)),
  });
  render(<App />);
  await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
}

function resetStore() {
  useCbe.getState().reset();
  useCbe.setState({ configured: false, hydration: "idle", hydrationError: null });
}

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
});

describe("Scenario: Existing cards never replay normal-chat technical detail", () => {
  it("keeps sidecar cards readable internally but renders only ordinary assistant text after restart", async () => {
    const turns = await restart([{ role: "user", text: "Record what we agreed." }, recordedTurn(LEAD + TAIL)]);
    expect(turns[1]!.cards).toHaveLength(3);
    expect(turns[1]!.cards?.map((card) => card.toolName)).toEqual(["cbe_canvas", "cbe_step", "cbe_maturity"]);

    await reopen(turns);
    expect(screen.getByText(new RegExp(LEAD))).toBeTruthy();
    expect(screen.getByText(/Next we look at the assessment/)).toBeTruthy();
    expect(document.querySelector(".tool-card")).toBeNull();
    expect(document.querySelector(".working-disclosure")).toBeNull();
    expect(document.body.textContent).not.toContain("Artefact recorded on step 3");
  });

  it("omits a passive-only empty turn instead of inventing a receipt or blank bubble", async () => {
    const turns = await restart([
      { role: "user", text: "Record what we agreed." },
      recordedTurn(""),
      { role: "user", text: "And now step 4." },
    ]);
    expect(turns[1]!.cards).toHaveLength(3);
    await reopen(turns);
    expect(document.querySelectorAll(".msg-skill")).toHaveLength(0);
    expect(screen.getByText("Record what we agreed.")).toBeTruthy();
    expect(screen.getByText("And now step 4.")).toBeTruthy();
  });

  it("does not repopulate design panels from compatible card data", async () => {
    const turns = await restart([recordedTurn(LEAD + TAIL)]);
    await reopen(turns, { canvas: [], steps: [], maturity: {} });
    const items = useCbe.getState().artifacts.flatMap((group) => group.items);
    expect(items.every((item) => item.value === "" && item.state === "open")).toBe(true);
    expect(items.some((item) => item.id === CANVAS_ARGS.id)).toBe(false);
    expect(useCbe.getState().maturity).toEqual({});
    expect(useCbe.getState().steps.every((step) => step.depth === "open" && !step.focus)).toBe(true);
  });
});

describe("Scenario: Legacy and malformed card data costs ordinary text nothing", () => {
  it("renders a text-only pre-card conversation unchanged", async () => {
    await reopen(
      await restart([
        { role: "user", text: "Hello." },
        { role: "assistant", text: "Prior answer." },
      ])
    );
    expect(screen.getByText("Prior answer.")).toBeTruthy();
    expect(document.querySelector(".tool-card")).toBeNull();
  });

  it("drops malformed cards without dropping readable text or creating technical fallback", async () => {
    const turn = recordedTurn(LEAD + TAIL);
    const malformed = {
      ...turn,
      cards: [turn.cards![0]!, { toolCallId: "x", toolName: "cbe_step" }],
    } as unknown as StoredTurn;
    await reopen([malformed]);
    expect(screen.getByText(new RegExp(LEAD))).toBeTruthy();
    expect(document.querySelector(".tool-card")).toBeNull();
    expect(document.querySelector(".working-disclosure")).toBeNull();
  });

  it("still renders a stopped marker when passive card data is its only other content", async () => {
    const turn = { ...recordedTurn(""), stopped: true } as StoredTurn;
    await reopen(await restart([{ role: "user", text: "Halt." }, turn]));
    expect(document.querySelectorAll(".msg-skill")).toHaveLength(1);
    expect(screen.getByText(/You stopped this answer/)).toBeTruthy();
    expect(document.querySelector(".tool-card")).toBeNull();
  });
});
