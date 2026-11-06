/**
 * Main-process delivery of the `app-ui reference` block (change
 * `ground-help-orientation-in-ui-reference`; capability `desktop-app`,
 * Requirement: App-UI Reference Injected on the Help-Token Turn).
 *
 * Covers the host half at the IPC seam — the composition module itself is unit
 * tested in `ui-reference-prompt.test.ts`. What is asserted here is what only
 * the seam can show: the block reaches the MODEL payload and the transcript, the
 * lecturer's displayed turn stays "Help requested" (display/payload split), the
 * trigger reads the RENDERER-AUTHORED payload rather than the composed text, and
 * the session's affordances actually reach the filter.
 *
 * Same shape as `post-compaction-handover-delivery.test.ts`: the AgentManager is
 * mocked down to the methods the prompt handler calls, so the chain runs without
 * a Pi runtime.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { HELP_TOKEN } from "../src/shared/help-token.js";
import { en } from "../src/shared/i18n/en.js";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

const h = vi.hoisted(() => {
  const fakeSession = {
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string; display?: { text: string } }>,
    draft: "",
    env: { affordances: {} as Record<string, boolean> },
    session: { prompt: vi.fn<(text: string) => Promise<void>>() },
  };
  return { fakeSession };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/cbe-ui-reference-delivery-test") },
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

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return { ...actual, createCitationResolver: vi.fn() };
});

// Attached after the hoisted block: `vi.hoisted` runs before imports, so the
// helper cannot be reached from inside it.
Object.assign(h.fakeSession, { turnStop: fakeTurnStop(h.fakeSession) });
// Same reason, same place: every live session carries the per-run design-record
// card buffer the prompt handler resets and promotes (capability `agent-harness`,
// Requirement: *Sessions as Local Markdown/JSON Files*). The REAL recorder — this
// fixture makes no design-record call, so it stays empty and the promotion behaves
// exactly as it did before the buffer existed.
Object.assign(h.fakeSession, { cardRecorder: new ToolCardRecorder() });

/** A host note the renderer never authored — used to prove the trigger does not
 * read the composed text. */
let hostNote: string | null = null;

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
      return hostNote ? `${hostNote}\n\n${text}` : text;
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

/** Registered ONCE: importing `main/ipc.ts` pulls the whole main-process module
 * graph, which is slow enough under a loaded machine to blow a per-test timeout.
 * The handler is stateless between calls — per-turn state lives on the fake
 * session, which `beforeEach` resets. */
let handler: IpcHandler;

beforeAll(async () => {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  handler = handlers.get("cbe:prompt")!;
}, 60_000);

const APP_AFFORDANCES: Record<string, boolean> = {
  ingestion: true,
  canvas: true,
  citations: true,
  profilePanel: true,
  courseWorkspace: true,
  corpusAccess: true,
  picker: true,
  step: true,
  maturity: true,
  bash: false,
};

beforeEach(() => {
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.env.affordances = { ...APP_AFFORDANCES };
  h.fakeSession.session.prompt.mockReset();
  h.fakeSession.session.prompt.mockResolvedValue(undefined);
  hostNote = null;
});

describe("Scenario: Help token turn carries the UI reference block", () => {
  it("prefixes the block to the MODEL payload while the displayed turn stays the chrome text", async () => {
    await handler(undefined, { sessionId: "s1", text: HELP_TOKEN, display: { text: en.chatHelpDisplayText } });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload.startsWith("app-ui reference")).toBe(true);
    expect(payload.endsWith(HELP_TOKEN)).toBe(true);
    expect(payload).toContain('id: "material-upload"');
    expect(payload).toContain('id: "design-flow-canvas"');
    expect(payload).toContain('Open the round \\"+\\" menu at the bottom left of the composer card');

    // Lossless transcript; the lecturer still sees only "Help requested".
    expect(h.fakeSession.transcript[0].text).toBe(payload);
    expect(h.fakeSession.transcript[0].display?.text).toBe(en.chatHelpDisplayText);
  });

  it("keeps the block behind any earlier host prefix, so the token still closes the payload", async () => {
    hostNote = "[canvas deletion: the lecturer removed 'Big Idea']";

    await handler(undefined, { sessionId: "s1", text: HELP_TOKEN, display: { text: en.chatHelpDisplayText } });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload).toContain("app-ui reference");
    expect(payload).toContain("[canvas deletion:");
    expect(payload.endsWith(HELP_TOKEN)).toBe(true);
  });
});

describe("Scenario: An ordinary lecturer turn carries no block", () => {
  it("leaves a normal turn untouched", async () => {
    await handler(undefined, { sessionId: "s1", text: "Wie weiter mit Schritt 3?" });

    expect(h.fakeSession.session.prompt.mock.calls[0][0]).toBe("Wie weiter mit Schritt 3?");
  });
});

describe("Scenario: Host prefixes cannot manufacture the trigger", () => {
  it("emits no block when only a host-prepended notice contains the token", async () => {
    hostNote = `[system note: the lecturer pressed ${HELP_TOKEN} earlier]`;

    await handler(undefined, { sessionId: "s1", text: "Weiter mit Schritt 4." });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload).not.toContain("app-ui reference");
    expect(payload).toBe(`${hostNote}\n\nWeiter mit Schritt 4.`);
  });
});

describe("Scenario: Entries gated on an unavailable affordance are dropped by the host", () => {
  it("uses the SESSION's affordances, not a static assumption", async () => {
    h.fakeSession.env.affordances = { ...APP_AFFORDANCES, maturity: false, ingestion: false };

    await handler(undefined, { sessionId: "s1", text: HELP_TOKEN, display: { text: en.chatHelpDisplayText } });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload).not.toContain('id: "maturity-panel"');
    expect(payload).not.toContain('id: "material-upload"');
    expect(payload).toContain('id: "design-flow-canvas"');
  });
});
