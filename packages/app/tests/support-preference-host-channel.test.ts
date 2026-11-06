/**
 * Main-process delivery of the lecturer-wide support preference to ALREADY-OPEN
 * sessions (change `recalibrate-tutor-support`, task 3.2; capability `agent-harness`,
 * Requirement: *Separate Lecturer-Wide Support Preference*).
 *
 * The `AgentManager` is mocked, but what it delegates to is REAL: one shared
 * `LecturerSupportService` and one `LecturerSupportDisclosure` per conversation, wired
 * exactly as `AgentManager.start` wires them through `startCbeSession`. So the prompt
 * handler's composition — the derived notice, the display/payload split, the refused
 * dispatch that consumes nothing and the delivered one that marks the snapshot seen —
 * is exercised end to end without a Pi runtime.
 */
import { beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";
import {
  InMemoryLecturerSupportStore,
  LecturerSupportDisclosure,
  LecturerSupportService,
} from "@cbe/pi-bridge/lecturer-support";

const h = vi.hoisted(() => {
  const makeSession = () => ({
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string; display?: { text: string } }>,
    env: { affordances: {} as Record<string, boolean> },
    draft: "",
    session: { prompt: vi.fn<(text: string) => Promise<void>>() },
  });
  const sessions = { a: makeSession(), b: makeSession() } as Record<string, ReturnType<typeof makeSession>>;
  return { sessions, makeSession };
});

for (const s of Object.values(h.sessions)) {
  Object.assign(s, { turnStop: fakeTurnStop(s), cardRecorder: new ToolCardRecorder() });
}

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/cbe-support-host-channel-test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

// The real lecturer-wide service both conversations share, and each conversation's
// own disclosure — re-created per test in `beforeEach`.
let service = new LecturerSupportService(new InMemoryLecturerSupportStore(), "lecturer-wide");
let disclosures: Record<string, LecturerSupportDisclosure> = {};

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return { ...actual, createCitationResolver: vi.fn() };
});

vi.mock("../src/main/agent.js", () => ({
  AgentManager: class {
    get(id: string) {
      return h.sessions[id];
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
    recordStepFocus() {}
    pendingStepFocus() {
      return null;
    }
    composePromptWithStepFocus(_id: string, text: string) {
      return text;
    }
    requeueStepFocus() {}
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
    // The production delegation, verbatim in shape: `AgentManager.pendingSupport` /
    // `markSupportDelivered` forward to the session's own disclosure.
    async pendingSupport(id: string) {
      return disclosures[id] ? disclosures[id].pending() : null;
    }
    markSupportDelivered(id: string, due: { snapshot: { revision: number }; generation: number }) {
      disclosures[id]?.markDelivered(due.snapshot.revision, due.generation);
    }
    hasPendingRetainedState() {
      return false;
    }
    rearmRetainedState() {}
    recordIngestion() {}
    unrecordIngestions() {}
    maturityState() {
      return null;
    }
    async applyPendingProvider() {}
    setInFlight(id: string, v: boolean) {
      h.sessions[id].inFlight = v;
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
    getByCourse() {
      return undefined;
    }
    close() {}
    closeAll() {}
  },
  SESSIONS_DIR: "/tmp/test-sessions",
  resolveResource: (s: string) => `/tmp/test-resources/${s}`,
  COURSES_ROOT: "/tmp/test-courses",
  WORKSPACE_STATE_PATH: "/tmp/test-workspace-state.json",
  CORPUS_UPDATER_PATHS: { cacheRoot: "/tmp/c", bundledDir: "/tmp/b" },
  currentCorpusDir: () => "/tmp/corpus",
  lecturerProfileService: { current: vi.fn(async () => null), applyOverride: vi.fn() },
  summariseDecisions: () => "",
  resetCorpusCaches: () => {},
}));

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
  resolveCanonicalConversation: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

async function promptHandler(): Promise<IpcHandler> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return handlers.get("cbe:prompt")!;
}

// Warm the module graph once, so the cold import does not land inside the first test
// (the ~770 ms first-import cost CLAUDE.md describes for main-process suites).
beforeAll(async () => {
  await import("../src/main/ipc.js");
});

/** Two conversations open on one lecturer-wide service, both having seen revision 1. */
beforeEach(async () => {
  service = new LecturerSupportService(
    new InMemoryLecturerSupportStore({ version: 1, revision: 1, preference: "collaborative" }),
    "lecturer-wide"
  );
  const seen = (await service.current()).revision;
  disclosures = { a: new LecturerSupportDisclosure(service, seen), b: new LecturerSupportDisclosure(service, seen) };
  for (const s of Object.values(h.sessions)) {
    s.inFlight = false;
    s.transcript = [];
    s.draft = "";
    s.session.prompt.mockReset();
    s.session.prompt.mockResolvedValue(undefined);
  }
});

const payloadOf = (id: string, call = 0) => h.sessions[id].session.prompt.mock.calls[call][0];

describe("Scenario: Clear restores the default across already-open sessions", () => {
  it("prefixes the other open conversation's next payload with the current snapshot", async () => {
    const handler = await promptHandler();
    // Conversation A clears the preference (as an accepted cbe_support call would).
    expect((await service.change({ operation: "clear" }, 1)).outcome).toBe("accepted");
    disclosures.a.markDelivered(2);

    await handler(undefined, {
      sessionId: "b",
      text: "Weiter mit der Challenge.",
      display: { text: "Weiter mit der Challenge." },
    });

    const payload = payloadOf("b");
    expect(payload.startsWith("[lecturer-support] current saved state")).toBe(true);
    expect(payload).toContain("preference: none recorded");
    expect(payload).toContain("revision: 2");
    expect(payload.endsWith("Weiter mit der Challenge.")).toBe(true);
    // Lossless transcript; the rendered user turn shows only the lecturer's text.
    expect(h.sessions.b.transcript[0].text).toBe(payload);
    expect(h.sessions.b.transcript[0].display?.text).toBe("Weiter mit der Challenge.");
  });

  it("carries no notice where the session already holds the current revision, and none twice", async () => {
    const handler = await promptHandler();
    await handler(undefined, { sessionId: "a", text: "eins" });
    expect(payloadOf("a")).toBe("eins");

    await service.change({ operation: "set", preference: "concise" }, 1);
    await handler(undefined, { sessionId: "a", text: "zwei" });
    expect(payloadOf("a", 1)).toContain('preference: "concise"');
    await handler(undefined, { sessionId: "a", text: "drei" });
    expect(payloadOf("a", 2)).toBe("drei");
  });
});

describe("Scenario: Refused prompt dispatch does not lose a preference update", () => {
  it("keeps the snapshot due when Pi refuses the payload, and carries it on the retry", async () => {
    const handler = await promptHandler();
    await service.change({ operation: "set", preference: "guided" }, 1);
    h.sessions.b.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing."));

    await expect(handler(undefined, { sessionId: "b", text: "Hallo" })).rejects.toThrow(/already processing/);
    expect(h.sessions.b.transcript).toHaveLength(0);

    h.sessions.b.inFlight = false;
    await handler(undefined, { sessionId: "b", text: "Hallo" });
    const retry = payloadOf("b", 1);
    expect(retry.startsWith("[lecturer-support]")).toBe(true);
    expect(retry).toContain('preference: "guided"');
    expect(await disclosures.b.due()).toBeNull();
  });

  it("counts a mid-run failure as delivered — that payload reached the model", async () => {
    const handler = await promptHandler();
    await service.change({ operation: "set", preference: "guided" }, 1);
    h.sessions.b.session.prompt.mockRejectedValueOnce(new Error("Provider exploded mid-stream"));
    await expect(handler(undefined, { sessionId: "b", text: "Hallo" })).rejects.toThrow(/exploded/);
    expect(payloadOf("b")).toContain('preference: "guided"');
    expect(await disclosures.b.due()).toBeNull();
  });
});

describe("Scenario: Compaction cannot restore an obsolete preference", () => {
  it("re-discloses the current saved snapshot on the first prompt after a compaction", async () => {
    const handler = await promptHandler();
    await service.change({ operation: "clear" }, 1);
    disclosures.a.markDelivered(2);
    // The session's own compaction callback (session.ts) invalidates its disclosure.
    disclosures.a.invalidate();

    await handler(undefined, { sessionId: "a", text: "Wo waren wir?" });
    const payload = payloadOf("a");
    expect(payload).toContain("preference: none recorded");
    expect(payload).toContain("revision: 2");
  });

  it("leaves the snapshot due when a compaction lands during the run that carried it", async () => {
    const handler = await promptHandler();
    await service.change({ operation: "set", preference: "guided" }, 1);
    h.sessions.b.session.prompt.mockImplementationOnce(async () => {
      disclosures.b.invalidate();
    });

    await handler(undefined, { sessionId: "b", text: "Erste Frage" });
    expect(payloadOf("b")).toContain('preference: "guided"');

    h.sessions.b.inFlight = false;
    await handler(undefined, { sessionId: "b", text: "Zweite Frage" });
    const next = payloadOf("b", 1);
    expect(next.startsWith("[lecturer-support]")).toBe(true);
    expect(next).toContain('preference: "guided"');
    expect(next).toContain("revision: 2");
    expect(await disclosures.b.due()).toBeNull();
  });
});
