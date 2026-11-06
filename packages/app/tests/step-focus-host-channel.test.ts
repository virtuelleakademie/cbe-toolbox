/**
 * Host-set step focus from the canvas UI — the FULL chain, main-process side
 * (capability `agent-harness`, Requirement: *Host-Set Step Focus from the Canvas UI*;
 * capability `desktop-app`, Requirement: *Design-Flow Canvas*).
 *
 * This is the half the eval cannot reach. A probe is turn 1 of a cold session and
 * `ProbeSetup` cannot fire an IPC call, so scenario 02's S2e can only measure how the
 * model RESPONDS to the notice line — never that a click produces it. What is proved
 * here instead is the production side:
 *
 *   click (`cbe:step:focus`) → mirror mutated → notice queued → drained into the
 *   payload of the next lecturer turn.
 *
 * Both real IPC handlers are registered and the mocked `AgentManager` delegates to a
 * REAL `StepMirror` through the REAL compose helper, exactly as the manager does — the
 * same discipline as `stale-maturity-disclosure.test.ts` next door. Test names mirror
 * the spec scenarios.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";
import { StepMirror, composePayloadWithFocusNotice, type PendingFocusNotice } from "@cbe/pi-bridge";

const h = vi.hoisted(() => {
  const fakeSession = {
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string; display?: { text: string } }>,
    env: { affordances: {} as Record<string, boolean> },
    draft: "",
    session: { prompt: vi.fn<(text: string) => Promise<void>>() },
  };
  return { fakeSession };
});

// Attached after the hoisted block: `vi.hoisted` runs before imports, so the
// helper cannot be reached from inside it. The prompt handler reads this
// session's stop state (capability `agent-harness`, Requirement: *A Lecturer Can
// Stop a Running Turn*).
Object.assign(h.fakeSession, { turnStop: fakeTurnStop(h.fakeSession) });
// Same reason, same place: every live session carries the per-run design-record
// card buffer the prompt handler resets and promotes (capability `agent-harness`,
// Requirement: *Sessions as Local Markdown/JSON Files*). The REAL recorder — this
// fixture makes no design-record call, so it stays empty and the promotion behaves
// exactly as it did before the buffer existed.
Object.assign(h.fakeSession, { cardRecorder: new ToolCardRecorder() });

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/cbe-step-focus-test") },
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
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

/** The real host state the mocked AgentManager delegates to. */
const stepMirror = new StepMirror();

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return { ...actual, createCitationResolver: vi.fn() };
});

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
    hasPendingRetainedState() {
      return false;
    }
    rearmRetainedState() {}
    recordIngestion() {}
    unrecordIngestions() {}
    maturityState() {
      return null;
    }
    // The four paths under test, wired exactly as the real manager wires them.
    recordStepFocus(_id: string, step: number, label?: string) {
      stepMirror.recordUiFocus(step, label);
    }
    pendingStepFocus(): PendingFocusNotice | null {
      return stepMirror.pendingFocus();
    }
    composePromptWithStepFocus(_id: string, text: string) {
      return composePayloadWithFocusNotice(stepMirror.drainFocusNotice(), text);
    }
    requeueStepFocus(_id: string, notice: PendingFocusNotice | null) {
      stepMirror.requeueFocusNotice(notice);
    }
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

/** Register the real IPC surface once and hand back both handlers of the chain. */
async function handlers(): Promise<{ click: IpcHandler; prompt: IpcHandler }> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const map = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    map.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return { click: map.get("cbe:step:focus")!, prompt: map.get("cbe:prompt")! };
}

function lastPayload(): string {
  const calls = h.fakeSession.session.prompt.mock.calls;
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.session.prompt.mockReset();
  h.fakeSession.session.prompt.mockResolvedValue(undefined);
  stepMirror.seed([]);
  stepMirror.drainFocusNotice();
});

describe("Host-Set Step Focus from the Canvas UI — the click-to-payload chain", () => {
  // Scenario: A UI step selection moves the focus in the host mirror at once
  // Scenario: The next lecturer turn discloses the selection to the model
  it("moves the focus at once and discloses it on the next lecturer turn", async () => {
    const { click, prompt } = await handlers();
    stepMirror.applyUpdate(2, { depth: "refined", focus: true });

    await expect(click(undefined, { sessionId: "s1", step: 7, label: "Activities" })).resolves.toEqual({ ok: true });

    // The mirror moved on the CLICK — before any agent turn ran.
    expect(stepMirror.focused()).toBe(7);
    expect(h.fakeSession.session.prompt).not.toHaveBeenCalled();
    expect(h.fakeSession.transcript).toHaveLength(0);

    await prompt(undefined, {
      sessionId: "s1",
      text: "Und wie fange ich da an?",
      display: { text: "Und wie fange ich da an?" },
    });

    const payload = lastPayload();
    expect(payload.startsWith("[step-focus]")).toBe(true);
    expect(payload).toContain('step 7 ("Activities")');
    expect(payload).toContain("do NOT emit a cbe_step call");
    expect(payload.endsWith("Und wie fange ich da an?")).toBe(true);
    // Lossless transcript, renderer-only display/payload split.
    expect(h.fakeSession.transcript[0]!.text).toBe(payload);
    expect(h.fakeSession.transcript[0]!.display?.text).toBe("Und wie fange ich da an?");
  });

  // Scenario: A UI step selection leaves every coverage depth untouched
  it("leaves every coverage depth untouched", async () => {
    const { click } = await handlers();
    stepMirror.applyUpdate(2, { depth: "refined", focus: true });

    await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });

    expect(stepMirror.depthOf(7)).toBe("open");
    expect(stepMirror.depthOf(2)).toBe("refined");
  });

  // Scenario: The notice is drained exactly once
  it("drains the notice exactly once — the following turn carries none", async () => {
    const { click, prompt } = await handlers();
    await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });

    await prompt(undefined, { sessionId: "s1", text: "erste" });
    await prompt(undefined, { sessionId: "s1", text: "zweite" });

    expect(h.fakeSession.session.prompt.mock.calls[0]![0].startsWith("[step-focus]")).toBe(true);
    expect(h.fakeSession.session.prompt.mock.calls[1]![0]).toBe("zweite");
  });

  // Scenario: A second selection supersedes the pending notice
  it("supersedes the pending notice with a second selection", async () => {
    const { click, prompt } = await handlers();
    await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });
    await click(undefined, { sessionId: "s1", step: 4, label: "Challenge" });

    await prompt(undefined, { sessionId: "s1", text: "weiter" });

    const payload = lastPayload();
    expect(stepMirror.focused()).toBe(4);
    expect(payload.match(/\[step-focus\]/g)?.length).toBe(1);
    expect(payload).toContain('step 4 ("Challenge")');
    expect(payload).not.toContain("Activities");
  });

  // Scenario: An undelivered notice returns for the retry
  it("returns an undelivered notice for the retry", async () => {
    const { click, prompt } = await handlers();
    await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });
    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing a message"));

    await expect(prompt(undefined, { sessionId: "s1", text: "weiter" })).rejects.toThrow(/already processing/);
    // The payload never reached the model — no phantom turn, and the notice is
    // pending again rather than lost.
    expect(h.fakeSession.transcript).toHaveLength(0);
    expect(stepMirror.hasPendingFocus()).toBe(true);

    await prompt(undefined, { sessionId: "s1", text: "weiter" });
    expect(lastPayload().startsWith("[step-focus]")).toBe(true);

    // Exactly once: the retry consumed it, the turn after carries nothing.
    await prompt(undefined, { sessionId: "s1", text: "danach" });
    expect(lastPayload()).toBe("danach");
  });

  // Scenario: A newer selection is not overwritten by a requeued one
  it("does not overwrite a newer selection with a requeued one", async () => {
    const { click, prompt } = await handlers();
    await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });
    h.fakeSession.session.prompt.mockImplementationOnce(async () => {
      // The lecturer clicks again while the refused payload is in flight.
      await click(undefined, { sessionId: "s1", step: 4, label: "Challenge" });
      throw new Error("Agent is already processing a message");
    });

    await expect(prompt(undefined, { sessionId: "s1", text: "weiter" })).rejects.toThrow(/already processing/);
    await prompt(undefined, { sessionId: "s1", text: "nochmal" });

    const payload = lastPayload();
    expect(payload).toContain('step 4 ("Challenge")');
    expect(payload).not.toContain("Activities");
  });

  // Scenario: A selection outside the step range is a safe no-op
  it("is a safe no-op for a step outside the range", async () => {
    const { click, prompt } = await handlers();
    stepMirror.applyUpdate(2, { focus: true });

    await expect(click(undefined, { sessionId: "s1", step: 14, label: "Nowhere" })).resolves.toEqual({ ok: true });

    expect(stepMirror.focused()).toBe(2);
    expect(stepMirror.hasPendingFocus()).toBe(false);
    await prompt(undefined, { sessionId: "s1", text: "weiter" });
    expect(lastPayload()).toBe("weiter");
  });

  // Scenario: A selection during a running turn is recorded and disclosed afterwards
  it("records a selection made during a running turn and discloses it afterwards", async () => {
    const { click, prompt } = await handlers();
    h.fakeSession.session.prompt.mockImplementationOnce(async () => {
      // Mid-run: the lecturer selects a step. Nothing is dispatched into the
      // running turn, and the mirror moves immediately.
      await click(undefined, { sessionId: "s1", step: 7, label: "Activities" });
      expect(stepMirror.focused()).toBe(7);
    });

    await prompt(undefined, { sessionId: "s1", text: "laufender Zug" });
    // The running turn's own payload carried nothing — the click came after it
    // was composed.
    expect(h.fakeSession.session.prompt.mock.calls[0]![0]).toBe("laufender Zug");

    await prompt(undefined, { sessionId: "s1", text: "danach" });
    expect(lastPayload().startsWith("[step-focus]")).toBe(true);
    expect(lastPayload().endsWith("danach")).toBe(true);
  });

  it("is a safe no-op for an unknown session", async () => {
    const { click } = await handlers();
    await expect(click(undefined, { sessionId: "", step: 7 })).resolves.toEqual({ ok: true });
    await expect(click(undefined, undefined)).resolves.toEqual({ ok: true });
  });
});
