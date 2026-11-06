/** Ordinary course open/resume through real IPC -> AgentManager -> startCbeSession.
 * Only Electron is replaced. No model calls: inspect the first hydration response,
 * the descriptor, the real compaction handover and the durable sidecars. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDidacticChecks, type DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import { createCanvasTool } from "../../pi-bridge/src/canvas-tool.js";
import { createStepTool } from "../../pi-bridge/src/step-tool.js";
import type { AgentManager } from "../src/main/agent.js";
import type { SessionDesignState, SessionTurn } from "../src/main/sessions.js";
import { Channels, type ConversationOpenResult } from "../src/shared/ipc-contract.js";

type Active = Awaited<ReturnType<AgentManager["start"]>>;
const h = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
}));
vi.mock("electron", () => ({
  app: {
    getPath: () => h.root,
    getAppPath: () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (name: string, fn: (...args: any[]) => Promise<any>) => h.handlers.set(name, fn), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

let ipc: typeof import("../src/main/ipc.js");
let sessions: typeof import("../src/main/sessions.js");
let AgentManagerClass: typeof AgentManager;
let manager: AgentManager;
let active: Active;
const seed = [{ step: 1, depth: "open", focus: true }];
const provider = { baseURL: "http://127.0.0.1:9/v1", apiKey: "test-key", modelId: "test" };

beforeAll(async () => {
  h.root = mkdtempSync(path.join(os.tmpdir(), "cbe-untouched-resume-"));
  writeFileSync(path.join(h.root, "cbe-config.json"), JSON.stringify({ ...provider, apiKeyPlain: provider.apiKey }));
  ({ AgentManager: AgentManagerClass } = await import("../src/main/agent.js"));
  sessions = await import("../src/main/sessions.js");
  ipc = await import("../src/main/ipc.js");
  ipc.registerIpc({ webContents: { send: vi.fn() } } as never);
});
beforeEach(() => {
  // Observe, never replace, the production start. Reinstall after the shared
  // setup's restoreAllMocks so every assertion reads THIS session, not its predecessor.
  const start = AgentManagerClass.prototype.start;
  vi.spyOn(AgentManagerClass.prototype, "start").mockImplementation(async function (...args) {
    manager = this;
    active = await start.apply(this, args);
    return active;
  });
});
afterEach(async () => {
  await ipc.teardownIpc();
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(h.root, { recursive: true, force: true });
});

async function invoke<T = ConversationOpenResult>(channel: string, payload?: unknown): Promise<T> {
  return h.handlers.get(channel)!(null, payload);
}
async function newCourse(): Promise<string> {
  const course = await invoke<{ id: string }>(Channels.courseCreate, "Untouched course");
  await invoke(Channels.courseSetActive, course.id);
  return course.id;
}
async function storedCourse(
  state: SessionDesignState = {},
  didacticChecks?: DidacticChecks,
  turns: SessionTurn[] = []
): Promise<{ courseId: string; sessionId: string }> {
  const courseId = await newCourse();
  const sessionId = crypto.randomUUID();
  const dir = path.join(h.root, "courses", courseId, "sessions");
  const meta = {
    sessionId,
    createdAt: "2026-10-12T00:00:00Z",
    closedAt: "2026-10-12T00:00:01Z",
    modelId: "test",
    skillVersion: "0.1.0",
    environmentProfile: "app",
  };
  await sessions.writeSessionMd(dir, meta, turns);
  await sessions.writeSessionJson(dir, meta, turns, didacticChecks, state);
  return { courseId, sessionId };
}
async function persisted() {
  return sessions.readSessionJson(active.sessionsDir, active.id);
}
function expectSeed(result: ConversationOpenResult) {
  expect(result.steps).toEqual(seed);
  expect(active.stepMirror.holdsOnlySeededFocus()).toBe(true);
  expect(active.stepMirror.recordedList()).toEqual([]);
  expect(manager.snapshot(active.id)?.steps).toBeUndefined();
  const prior = active.env.toSystemPromptBlock();
  expect(prior).toContain('step 1: "open" (in focus)');
  expect(prior).toContain("design-flow starting point — no coverage recorded yet");
  expect(prior).not.toContain("carried over from the previous conversation");
  expect(prior).not.toContain("Work continues on step");
  expect(manager.pendingStepFocus(active.id)).toBeNull();
  expect(manager.composePromptWithStepFocus(active.id, "Continue")).toBe("Continue");
}

describe("Host-Set Initial Step Focus — ordinary untouched resume", () => {
  it("a newly created fresh course receives initial navigation in its first hydration response", async () => {
    await newCourse();
    expectSeed(await invoke(Channels.conversationOpen));
    expect((await persisted())?.steps).toBeUndefined();
  });

  it("opening alone creates a sidecar but reopening the untouched course seeds again", async () => {
    await newCourse();
    const first = await invoke(Channels.conversationOpen);
    await ipc.teardownIpc();
    expect((await persisted())?.steps).toBeUndefined();
    const reopened = await invoke(Channels.conversationOpen);
    expect(reopened.session.sessionId).toBe(first.session.sessionId);
    expectSeed(reopened);
  });

  it.each([Channels.conversationOpen, Channels.conversationResume])(
    "%s seeds an empty stored design, regardless of conversation existence",
    async (route) => {
      const target = await storedCourse({ canvas: [], steps: [], maturity: {} }, emptyDidacticChecks(), [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "Welcome" },
      ]);
      const result = await invoke(route, target);
      expect(result.turns).toHaveLength(2);
      expectSeed(result);
      expect((await persisted())?.steps).toBeUndefined();
    }
  );

  it("untouched New Session never re-seeds, including seed-only and empty carry-over", async () => {
    await newCourse();
    expectSeed(await invoke(Channels.conversationOpen));
    for (let reset = 0; reset < 2; reset++) {
      const result = await invoke(Channels.conversationFresh);
      expect(result.steps).toEqual([]);
      expect(active.stepMirror.holdsOnlySeededFocus()).toBe(false);
      expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
      expect((await persisted())?.steps).toBeUndefined();
    }
  });

  it.each([
    { step: 6, depth: "rough" as const, focus: true },
    { step: 6, depth: "refined" as const, focus: false },
    { step: 1, depth: "open" as const, focus: true },
    { step: 4, depth: "open" as const, focus: false },
  ])("resume preserves recorded step state exactly: %j", async (entry) => {
    const target = await storedCourse({ steps: [entry] });
    const result = await invoke(Channels.conversationResume, target);
    expect(result.steps).toEqual([entry]);
    expect(active.stepMirror.holdsOnlySeededFocus()).toBe(false);
    expect(active.env.toSystemPromptBlock()).not.toContain("design-flow starting point");
    expect((await persisted())?.steps).toEqual([entry]);
  });

  it.each([
    { canvas: [{ step: 1, id: "modulemeta", value: "Recorded course", state: "active" as const }] },
    { maturity: { "student-agency": { current: "unassessed" as const } } },
    { maturity: { overall: { target: 2 as const } } },
  ])("resume with design work but no step field never invents focus: %j", async (state) => {
    const target = await storedCourse(state);
    const result = await invoke(Channels.conversationResume, target);
    expect(result.steps).toEqual([]);
    expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    expect((await persisted())?.steps).toBeUndefined();
    expect(await persisted()).toMatchObject(state);
  });

  it("partial step state beside a canvas artefact is preserved, never filled with a default focus", async () => {
    const state = {
      canvas: [{ step: 3, id: "assessmentblueprint", value: "Portfolio", state: "active" as const }],
      steps: [{ step: 4, depth: "open" as const, focus: false }],
    };
    await storedCourse(state);
    const result = await invoke(Channels.conversationOpen);
    expect(result.steps).toEqual(state.steps);
    expect(result.canvas).toEqual(state.canvas);
    expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    expect(active.stepMirror.holdsOnlySeededFocus()).toBe(false);
  });

  it.each([
    { ...emptyDidacticChecks(), kompetenz: { status: "in-progress" as const, goals: [] } },
    { ...emptyDidacticChecks(), alignment: { status: "completed" as const, findings: [] } },
    {
      ...emptyDidacticChecks(),
      delegation: {
        status: "completed" as const,
        decisions: [{ component: "Question", status: "hybrid" as const, reasoning: "Together" }],
      },
    },
    { ...emptyDidacticChecks(), heterogeneity: { fired: true, notes: "Consider access" } },
    { ...emptyDidacticChecks(), softSkill: { fired: true } },
  ])("resume with didactic/decision work but no steps never seeds: %j", async (checks) => {
    const target = await storedCourse({}, checks);
    const result = await invoke(Channels.conversationResume, target);
    expect(result.steps).toEqual([]);
    expect(result.didacticChecks).toEqual(checks);
    expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    expect((await persisted())?.didacticChecks).toEqual(checks);
  });

  it("seed-only compaction after resume arms no retained-state handover", async () => {
    const target = await storedCourse();
    expectSeed(await invoke(Channels.conversationResume, target));
    active.retainedStateHandover.markCompacted();
    expect(manager.composePromptWithRetainedState(active.id, "My module")).toBe("My module");
    expect(manager.hasPendingRetainedState(active.id)).toBe(false);
    await ipc.teardownIpc();
    expect((await persisted())?.steps).toBeUndefined();
  });

  it.each(["cbe_canvas", "cbe_step"])(
    "first real same-step %s after resume consumes provenance and persists",
    async (tool) => {
      const target = await storedCourse();
      expectSeed(await invoke(Channels.conversationResume, target));
      if (tool === "cbe_canvas") {
        await createCanvasTool(active.canvasMirror, active.stepMirror).execute("first-write", {
          step: 1,
          id: "moduleframe",
          value: "My module",
        });
      } else {
        await createStepTool(active.stepMirror).execute("first-write", { step: 1, focus: true });
      }
      expect(active.stepMirror.list()).toEqual(seed);
      expect(active.stepMirror.holdsOnlySeededFocus()).toBe(false);
      expect(manager.snapshot(active.id)?.steps).toEqual(seed);
      active.retainedStateHandover.markCompacted();
      expect(manager.composePromptWithRetainedState(active.id, "Continue")).toContain('step 1: "open" (in focus)');
      await ipc.teardownIpc();
      expect((await persisted())?.steps).toEqual(seed);
      const reopened = await invoke(Channels.conversationOpen);
      expect(reopened.steps).toEqual(seed);
      expect(active.stepMirror.holdsOnlySeededFocus()).toBe(false);
    }
  );

  it("transcript-only replay/import remains excluded even when empty", async () => {
    const replayManager = new AgentManagerClass();
    try {
      const started = await replayManager.start(provider, undefined, {
        sessionId: crypto.randomUUID(),
        createdAt: "2026-10-12T00:00:00Z",
        turns: [],
      });
      expect(started.stepMirror.list()).toEqual([]);
      expect(started.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    } finally {
      replayManager.closeAll();
    }
  });
});
