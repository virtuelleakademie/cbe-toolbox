/**
 * Main-process delivery of the stale-maturity disclosure and the host-observed
 * material ingestion (change `ground-maturity-assessment-in-substance`;
 * capability `agent-harness`, Requirements: Stale-Maturity Disclosure on the Next
 * Lecturer Turn; Host-Side Design-Substance and Revision Signal).
 *
 * The `AgentManager` is driven through the REAL `DesignSignal` over the REAL
 * mirrors, so the composition chain in the prompt handler is exercised end to end
 * without a Pi runtime — the same discipline as the post-compaction handover
 * suite next door.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";
import {
  CanvasMirror,
  DesignSignal,
  MaturityMirror,
  StepMirror,
  composePayloadWithStalenessNotice,
  deriveMaturityState,
  governingStaleness,
  type CanvasArtefactEntry,
} from "@cbe/pi-bridge";

const h = vi.hoisted(() => {
  const fakeSession = {
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string; display?: { text: string } }>,
    // The prompt handler reads the session's affordances to filter the
    // `app-ui reference` block (Requirement: App-UI Reference Injected on the
    // Help-Token Turn). No turn in this fixture is the help dispatch, so the
    // map only has to exist; the block itself is covered in
    // `ui-reference-injection-delivery.test.ts`.
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
  app: { getPath: vi.fn(() => "/tmp/cbe-stale-disclosure-test") },
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

// The real host state the mocked AgentManager delegates to.
const canvasMirror = new CanvasMirror();
const stepMirror = new StepMirror();
let designSignal = new DesignSignal(canvasMirror);
let maturityMirror = new MaturityMirror(() => ({
  substance: designSignal.substance(),
  revision: designSignal.currentRevision(),
}));

function artefact(step: number, id: string, value = "v"): CanvasArtefactEntry {
  return { step, id, value, state: "draft", label: `Artefact ${id}` };
}

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
    hasPendingRetainedState() {
      return false;
    }
    rearmRetainedState() {}
    // The two paths under test, wired exactly as the real manager wires them.
    composePromptWithMaturityStaleness(_id: string, text: string) {
      return composePayloadWithStalenessNotice(governingStaleness(maturityMirror, designSignal), text);
    }
    // Lecturer-wide support preference (change `recalibrate-tutor-support`): inert
    // here — the production side is proved in `support-preference-host-channel.test.ts`.
    async pendingSupport() {
      return null;
    }
    markSupportDelivered() {}
    recordIngestion(_id: string, filename: string) {
      designSignal.record("ingestion", { label: filename });
    }
    unrecordIngestions(_id: string, count: number) {
      designSignal.unrecordIngestions(count);
    }
    maturityState() {
      return deriveMaturityState(maturityMirror, designSignal);
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

/** Reset to a fresh session: empty mirrors, counter at zero. */
beforeEach(() => {
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.session.prompt.mockReset();
  h.fakeSession.session.prompt.mockResolvedValue(undefined);
  canvasMirror.restore([]);
  stepMirror.seed([]);
  designSignal = new DesignSignal(canvasMirror);
  canvasMirror.observe((c) => designSignal.record(c.kind, c));
  maturityMirror = new MaturityMirror(() => ({
    substance: designSignal.substance(),
    revision: designSignal.currentRevision(),
  }));
});

/** Record a reading, then move the design far enough to make it stale. */
function establishThenMoveOn(): void {
  canvasMirror.applySet(artefact(1, "a"));
  maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });
  canvasMirror.applySet(artefact(4, "b"));
  canvasMirror.applySet(artefact(4, "c"));
  canvasMirror.applySet(artefact(7, "d"));
}

describe("Scenario: A stale reading prefixes the next lecturer turn's payload", () => {
  it("prefixes the next lecturer turn's payload when the reading is stale", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    await handler(undefined, {
      sessionId: "s1",
      text: "Wie steht es um die Prüfung?",
      display: { text: "Wie steht es um die Prüfung?" },
    });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload.startsWith("[maturity-stale]")).toBe(true);
    expect(payload).toMatch(/stamped at design revision 1/);
    expect(payload).toMatch(/now stands at revision 4/);
    // Each changed artefact is named by the id `cbe_canvas` addresses it with AND
    // by its human label, so no back-translation is needed to re-assess it.
    expect(payload).toContain("artefact changed: “Artefact b” (id b, step 4)");
    expect(payload.endsWith("Wie steht es um die Prüfung?")).toBe(true);
    // Lossless transcript, renderer-only display/payload split: the persisted
    // turn carries the full payload, the display projection the lecturer's text.
    expect(h.fakeSession.transcript[0].text).toBe(payload);
    expect(h.fakeSession.transcript[0].display?.text).toBe("Wie steht es um die Prüfung?");
  });

  it("leaves the payload untouched while the reading is current", async () => {
    const handler = await promptHandler();
    canvasMirror.applySet(artefact(1, "a"));
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });

    await handler(undefined, { sessionId: "s1", text: "weiter" });

    expect(h.fakeSession.session.prompt.mock.calls[0][0]).toBe("weiter");
  });
});

describe("Scenario: The notice repeats until the reading is refreshed", () => {
  it("repeats the notice on every lecturer turn while the reading is stale", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    for (const text of ["eins", "zwei", "drei"]) {
      await handler(undefined, { sessionId: "s1", text });
    }
    const payloads = h.fakeSession.session.prompt.mock.calls.map((c) => c[0] as string);
    expect(payloads.length).toBe(3);
    // No window exists in which the reading is stale without the model being told.
    for (const p of payloads) expect(p.startsWith("[maturity-stale]")).toBe(true);
  });
});

describe("Scenario: A recorded refresh stops the notice, a claimed one does not", () => {
  it("stops on a recorded refresh but not on a claimed one", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    // Turn 1: the model answers with prose asserting it has re-assessed. No tool
    // call lands, so no host state moves.
    await handler(undefined, { sessionId: "s1", text: "erste" });
    await handler(undefined, { sessionId: "s1", text: "zweite" });
    expect((h.fakeSession.session.prompt.mock.calls[1][0] as string).startsWith("[maturity-stale]")).toBe(true);

    // Now a REAL `cbe_maturity` call re-stamps the mirror at the current revision.
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 3 });
    await handler(undefined, { sessionId: "s1", text: "dritte" });
    expect(h.fakeSession.session.prompt.mock.calls[2][0]).toBe("dritte");
  });
});

describe("Scenario: The notice is bounded and emitted at most once per turn", () => {
  it("emits at most one bounded notice per turn", async () => {
    const handler = await promptHandler();
    canvasMirror.applySet(artefact(1, "a"));
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });
    for (let i = 0; i < 12; i += 1) canvasMirror.applySet(artefact(1, `x${i}`));

    await handler(undefined, { sessionId: "s1", text: "weiter" });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0] as string;
    expect(payload.match(/\[maturity-stale\]/g)?.length).toBe(1);
    expect(payload).toMatch(/further changes/);
  });
});

describe("Scenario: No extra model turn is injected to force a refresh", () => {
  it("injects no extra model turn to force a refresh", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    // The reading goes stale mid-session. Nothing runs until the lecturer sends
    // the next turn — and then exactly one prompt is issued, theirs.
    expect(h.fakeSession.session.prompt).not.toHaveBeenCalled();
    await handler(undefined, { sessionId: "s1", text: "meine Nachricht" });
    expect(h.fakeSession.session.prompt).toHaveBeenCalledTimes(1);
    expect(h.fakeSession.transcript.length).toBe(1);
    expect(h.fakeSession.transcript[0].role).toBe("user");
  });
});

describe("Scenario: The answer turn carries the question in both the payload and the displayed projection", () => {
  // A deferred-answer turn (`cbe_picker` / `cbe_decision_checklist`) dispatches
  // ONE envelope as payload and as display projection — the question rides both
  // (capability `desktop-app`, Requirement: *A Turn Ending on a Generative-UI
  // Question Is a Complete Turn*). The projection is what keeps host-composed
  // machine notices out of the reopened chat, so it must be dispatched even
  // though it equals the lecturer's own text.
  const PICKER_ENVELOPE = [
    "[picker answer · tool call call-42]",
    "question: Wer ist der Stakeholder?",
    'selected: b ("Praxispartner")',
  ].join("\n");
  const CHECKLIST_ENVELOPE = [
    "[checklist update · tool call call-77]",
    "title: Offene Entscheide",
    'done: i1 ("Stakeholder verankert")',
    'open: i2 ("Challenge entworfen")',
  ].join("\n");

  it("keeps the machine notice out of the rendered answer turn while the payload keeps notice and question", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    await handler(undefined, {
      sessionId: "s1",
      text: PICKER_ENVELOPE,
      display: { text: PICKER_ENVELOPE },
    });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload.startsWith("[maturity-stale]")).toBe(true);
    expect(payload.endsWith(PICKER_ENVELOPE)).toBe(true);
    expect(payload).toContain("question: Wer ist der Stakeholder?");
    // What a reopened conversation renders (`store.ts` hydration and the
    // Markdown archive both read the projection): the lecturer's envelope with
    // its question, and no `[maturity-stale]` prefix.
    expect(h.fakeSession.transcript[0].text).toBe(payload);
    expect(h.fakeSession.transcript[0].display?.text).toBe(PICKER_ENVELOPE);
    expect(h.fakeSession.transcript[0].display?.text).not.toContain("[maturity-stale]");
  });

  it("does the same for a checklist answer", async () => {
    const handler = await promptHandler();
    establishThenMoveOn();

    await handler(undefined, {
      sessionId: "s1",
      text: CHECKLIST_ENVELOPE,
      display: { text: CHECKLIST_ENVELOPE },
    });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload.startsWith("[maturity-stale]")).toBe(true);
    expect(h.fakeSession.transcript[0].display?.text).toBe(CHECKLIST_ENVELOPE);
  });

  it("persists no projection when nothing was prefixed — payload and projection coincide", async () => {
    const handler = await promptHandler();
    canvasMirror.applySet(artefact(1, "a"));
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });

    await handler(undefined, {
      sessionId: "s1",
      text: PICKER_ENVELOPE,
      display: { text: PICKER_ENVELOPE },
    });

    expect(h.fakeSession.session.prompt.mock.calls[0][0]).toBe(PICKER_ENVELOPE);
    expect(h.fakeSession.transcript[0].text).toBe(PICKER_ENVELOPE);
    expect(h.fakeSession.transcript[0].display).toBeUndefined();
  });
});

describe("Requirement: Host-Side Design-Substance and Revision Signal — ingestion is host-observed", () => {
  it("records a completed material ingestion as a settled design change", async () => {
    const handler = await promptHandler();
    canvasMirror.applySet(artefact(1, "a"));
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });
    expect(designSignal.substance()).toBe("thin");

    // A turn carrying attachment chips IS the moment material reaches the
    // conversation. It is a substance clause on its own AND a categorical change
    // to the evidence base, so the reading goes stale on this very turn.
    await handler(undefined, {
      sessionId: "s1",
      text: "[document: syllabus.pdf] …",
      display: { text: "Hier mein Syllabus", attachments: [{ filename: "syllabus.pdf", docType: "pdf" }] },
    });

    expect(designSignal.evidence().ingestedDocuments).toBe(1);
    expect(designSignal.substance()).toBe("sufficient");
    const payload = h.fakeSession.session.prompt.mock.calls[0][0] as string;
    expect(payload.startsWith("[maturity-stale]")).toBe(true);
    expect(payload).toMatch(/syllabus\.pdf/);
  });

  it("takes the ingestion back when Pi refuses the payload as busy", async () => {
    const handler = await promptHandler();
    canvasMirror.applySet(artefact(1, "a"));
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });
    const before = designSignal.currentRevision();
    const attachedTurn = {
      sessionId: "s1",
      text: "[document: syllabus.pdf] …",
      display: { text: "Hier mein Syllabus", attachments: [{ filename: "syllabus.pdf", docType: "pdf" }] },
    };
    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing a message"));

    await expect(handler(undefined, attachedTurn)).rejects.toThrow(/already processing/);

    // The payload never reached the model, so no material entered the
    // conversation: the phantom user turn is gone and so is the ingestion.
    expect(h.fakeSession.transcript.length).toBe(0);
    expect(designSignal.evidence().ingestedDocuments).toBe(0);
    expect(designSignal.currentRevision()).toBe(before);

    // The lecturer's retry re-sends the same attachment, and it counts once.
    await handler(undefined, attachedTurn);
    expect(designSignal.evidence().ingestedDocuments).toBe(1);
    expect(designSignal.currentRevision()).toBe(before + 1);
  });

  it("does not record an ingestion for an ordinary turn", async () => {
    const handler = await promptHandler();
    await handler(undefined, { sessionId: "s1", text: "nur Text", display: { text: "nur Text" } });
    expect(designSignal.evidence().ingestedDocuments).toBe(0);
    expect(designSignal.currentRevision()).toBe(0);
  });
});
