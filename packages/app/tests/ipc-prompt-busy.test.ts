/**
 * Main-process tests for the busy-safe prompt handler (change
 * `fix-step-select-run-lock`, Requirement: Canvas Dialogue-Steering Dispatches
 * Respect the Run Lock — Scenario: Failed dispatch leaves no phantom user
 * turn, not even after resume; main-process half).
 *
 * Three ordering guarantees around `s.transcript`:
 *  1. the in-flight precheck refuses BEFORE the user turn is pushed;
 *  2. a Pi-level busy rejection pops the just-pushed turn (payload never
 *     reached the model);
 *  3. a mid-run failure does NOT pop — that payload was delivered, the turn
 *     is real.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

const h = vi.hoisted(() => {
  const fakeSession = {
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string }>,
    // The prompt handler reads the session's affordances to filter the
    // `app-ui reference` block (Requirement: App-UI Reference Injected on the
    // Help-Token Turn). No turn in this fixture is the help dispatch, so the
    // map only has to exist; the block itself is covered in
    // `ui-reference-injection-delivery.test.ts`.
    env: { affordances: {} as Record<string, boolean> },
    draft: "",
    session: { prompt: vi.fn<(text: string) => Promise<void>>() },
  };
  const webContentsSend = vi.fn();
  return { fakeSession, webContentsSend };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/cbe-prompt-busy-test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", () => ({
  createCitationResolver: vi.fn(),
}));

// Attached after the hoisted block: `vi.hoisted` runs before imports, so the
// helper cannot be reached from inside it.
Object.assign(h.fakeSession, { turnStop: fakeTurnStop(h.fakeSession) });
// Same reason, same place: every live session carries the per-run design-record
// card buffer the prompt handler resets and promotes (capability `agent-harness`,
// Requirement: *Sessions as Local Markdown/JSON Files*). The REAL recorder — this
// fixture makes no design-record call, so it stays empty and the promotion behaves
// exactly as it did before the buffer existed.
Object.assign(h.fakeSession, { cardRecorder: new ToolCardRecorder() });

vi.mock("../src/main/agent.js", () => ({
  AgentManager: class {
    get() {
      return h.fakeSession;
    }
    drainProfileNotes() {
      return [];
    }
    requeueProfileNotes() {}
    composePromptWithCanvasDeletions(_id: string, text: string) {
      return text;
    }
    pendingCanvasDeletions() {
      return [];
    }
    requeueCanvasDeletions() {}
    // UI step focus (Requirement: Host-Set Step Focus from the Canvas UI). Inert
    // here: this suite exercises other prefixes of the same prompt path.
    recordStepFocus() {}
    pendingStepFocus() {
      return null;
    }
    composePromptWithStepFocus(_id: string, text: string) {
      return text;
    }
    requeueStepFocus() {}
    // Wiki-atoms notice (change `give-the-wiki-a-reading-route`): inert here — the
    // production side is proved in `wiki-atoms-host-channel.test.ts`.
    recordWikiAtoms() {}
    pendingWikiAtoms() {
      return null;
    }
    composePromptWithWikiAtoms(_id: string, text: string) {
      return text;
    }
    requeueWikiAtoms() {}
    composePromptWithRetainedState(_id: string, text: string) {
      return text;
    }
    composePromptWithMaturityStaleness(_id: string, text: string) {
      return text;
    }
    // Lecturer-wide support preference (change `recalibrate-tutor-support`): inert
    // here — the production side is proved in `support-preference-host-channel.test.ts`.
    async pendingSupport() {
      return null;
    }
    markSupportDelivered() {}
    recordIngestion() {}
    maturityState() {
      return null;
    }
    hasPendingRetainedState() {
      return false;
    }
    rearmRetainedState() {}
    async applyPendingProvider() {}
    setInFlight(_id: string, v: boolean) {
      h.fakeSession.inFlight = v;
    }
    listIds() {
      return [];
    }
    dump() {
      return null;
    }
    snapshot() {
      return null;
    }
    closeAll() {}
  },
  SESSIONS_DIR: "/tmp/test-sessions",
  resolveResource: (s: string) => `/tmp/test-resources/${s}`,
}));

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
  resolveCanonicalConversation: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

async function ipcHandlers(): Promise<Map<string, IpcHandler>> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: h.webContentsSend } } as never);
  return handlers;
}

async function promptHandler(): Promise<IpcHandler> {
  return (await ipcHandlers()).get("cbe:prompt")!;
}

beforeEach(() => {
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.session.prompt.mockReset();
  h.webContentsSend.mockClear();
});

describe("cbe:prompt busy handling (no phantom user turns)", () => {
  it("refuses an in-flight session BEFORE pushing the user turn", async () => {
    const handler = await promptHandler();
    h.fakeSession.inFlight = true;
    await expect(handler(undefined, { sessionId: "s1", text: "hello" })).rejects.toThrow(/already processing/i);
    expect(h.fakeSession.transcript).toHaveLength(0);
    expect(h.fakeSession.session.prompt).not.toHaveBeenCalled();
    expect(h.webContentsSend).not.toHaveBeenCalledWith(
      "cbe:onboarding:changed",
      expect.objectContaining({ acknowledged: true })
    );
  });

  it("pops the pushed turn when Pi itself rejects as busy", async () => {
    const handler = await promptHandler();
    h.fakeSession.session.prompt.mockRejectedValue(
      new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")
    );
    await expect(handler(undefined, { sessionId: "s1", text: "hello" })).rejects.toThrow(/already processing/i);
    expect(h.fakeSession.transcript).toHaveLength(0);
  });

  it("keeps the turn on a mid-run failure — that exact payload reached the model", async () => {
    const handler = await promptHandler();
    h.fakeSession.session.prompt.mockRejectedValue(new Error("Provider exploded mid-stream"));
    await expect(handler(undefined, { sessionId: "s1", text: "hello" })).rejects.toThrow(/exploded/);
    expect(h.fakeSession.transcript).toHaveLength(1);
    expect(h.fakeSession.transcript[0]).toMatchObject({ role: "user", text: "hello" });
    expect(h.fakeSession.session.prompt).toHaveBeenCalledWith("hello");
  });

  it("keeps the turn on success", async () => {
    const handler = await promptHandler();
    h.fakeSession.session.prompt.mockResolvedValue(undefined);
    await expect(handler(undefined, { sessionId: "s1", text: "hello" })).resolves.toEqual({ ok: true });
    expect(h.fakeSession.transcript).toHaveLength(1);
  });
});

/**
 * Capability `desktop-app`, Requirement: *First-Use Orientation Acknowledgment
 * and Persistence* — Scenario: Failed persistence cannot trap or repeatedly
 * interrupt the lecturer. A directory standing where the record belongs makes
 * every write fail; the lecturer must still be told exactly once.
 */
describe("first-use acknowledgment with an unwritable record", () => {
  const recordPath = path.join("/tmp/cbe-prompt-busy-test", "onboarding.json");

  afterEach(async () => {
    await rm(recordPath, { recursive: true, force: true });
  });

  it("announces the failed write once, not on every acknowledgment", async () => {
    await rm(recordPath, { recursive: true, force: true });
    await mkdir(recordPath, { recursive: true });
    const acknowledge = (await ipcHandlers()).get("cbe:onboarding:acknowledge")!;

    expect(await acknowledge(undefined)).toEqual({ acknowledged: true, persisted: false });
    expect(await acknowledge(undefined)).toEqual({ acknowledged: true, persisted: false });

    const failures = h.webContentsSend.mock.calls.filter(
      ([channel, event]) =>
        channel === "cbe:onboarding:changed" && (event as { persistence?: string }).persistence === "failed"
    );
    expect(failures).toHaveLength(1);
  });
});
