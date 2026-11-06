/**
 * Main-process delivery of the post-compaction retained-state handover (change
 * `add-post-compaction-retained-state-handover`; capability `agent-harness`,
 * Requirement: Post-Compaction Retained-State Handover).
 *
 * Covers the host half of two scenarios:
 * - The maturity reading and step coverage are handed back after a compaction
 *   (the block reaches the MODEL payload and the transcript; the lecturer's own
 *   displayed turn is untouched — the display/payload split).
 * - Several compactions before one turn hand over once (and a turn with no
 *   compaction in between carries nothing).
 *
 * The `AgentManager` is driven through a REAL `RetainedStateHandover` over the
 * REAL mirrors, so the composition chain in the prompt handler is exercised
 * end to end without a Pi runtime.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CanvasMirror, MaturityMirror, RetainedStateHandover, StepMirror } from "@cbe/pi-bridge";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

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
  return { fakeSession, promptedWith: [] as string[] };
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
  app: { getPath: vi.fn(() => "/tmp/cbe-handover-delivery-test") },
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

// The mirrors + handover the mocked AgentManager delegates to — the real classes.
const maturityMirror = new MaturityMirror();
const stepMirror = new StepMirror();
const canvasMirror = new CanvasMirror();
let profileNotes: string[] = [];
const handover = new RetainedStateHandover({
  getMaturity: () => maturityMirror.snapshot(),
  getStepCoverage: () => stepMirror.recordedList(),
});

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return { ...actual, createCitationResolver: vi.fn() };
});

vi.mock("../src/main/agent.js", async () => {
  const { composePayloadWithDeletionNotices, composePayloadWithRetainedState } = await import("@cbe/pi-bridge");
  return {
    AgentManager: class {
      get() {
        return h.fakeSession;
      }
      drainProfileNotes() {
        const notes = [...profileNotes];
        profileNotes = [];
        return notes;
      }
      requeueProfileNotes(_id: string, notes: readonly string[]) {
        profileNotes.unshift(...notes);
      }
      composePromptWithCanvasDeletions(_id: string, text: string) {
        return composePayloadWithDeletionNotices(canvasMirror.drainDeletionNotices(), text);
      }
      pendingCanvasDeletions() {
        return canvasMirror.listPendingDeletions();
      }
      requeueCanvasDeletions(_id: string, notices: Parameters<CanvasMirror["requeueDeletionNotices"]>[0]) {
        canvasMirror.requeueDeletionNotices(notices);
      }
      // UI step focus (Requirement: Host-Set Step Focus from the Canvas UI). Inert
      // here: this suite exercises the retained-state prefix of the same prompt path.
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
        return composePayloadWithRetainedState(handover.drain(), text);
      }
      // No recorded reading in this fixture, so the standing staleness notice is
      // never emitted — this suite asserts the handover prefix in isolation.
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
        return handover.isPending();
      }
      rearmRetainedState() {
        handover.markCompacted();
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
      closeAll() {}
    },
    SESSIONS_DIR: "/tmp/test-sessions",
    resolveResource: (s: string) => `/tmp/test-resources/${s}`,
  };
});

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

beforeEach(() => {
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.session.prompt.mockReset();
  h.fakeSession.session.prompt.mockResolvedValue(undefined);
  maturityMirror.seed({});
  stepMirror.seed([]);
  handover.drain(); // disarm
  canvasMirror.drainDeletionNotices();
  profileNotes = [];
});

describe("Scenario: The maturity reading and step coverage are handed back after a compaction", () => {
  it("prefixes the block to the MODEL payload while the displayed turn stays the lecturer's own", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2, target: 3 });
    stepMirror.applyUpdate(4, { depth: "refined", focus: true });
    handover.markCompacted();

    await handler(undefined, { sessionId: "s1", text: "Where were we?", display: { text: "Where were we?" } });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload.startsWith("[retained-state]")).toBe(true);
    expect(payload).toContain('student-agency": current "2", target "3"');
    expect(payload).toContain('step 4: "refined" (in focus)');
    expect(payload.endsWith("Where were we?")).toBe(true);

    // Lossless transcript: the payload is what is recorded; the display
    // projection keeps what the lecturer actually saw.
    expect(h.fakeSession.transcript[0].text).toBe(payload);
    expect(h.fakeSession.transcript[0].display?.text).toBe("Where were we?");
  });

  it("hands an unassessed record over as unassessed, never as a level", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({
      kind: "maturity-update",
      criterion: "interdisciplinarity",
      current: "unassessed",
    });
    handover.markCompacted();

    await handler(undefined, { sessionId: "s1", text: "continue" });

    const payload = h.fakeSession.session.prompt.mock.calls[0][0];
    expect(payload).toContain('interdisciplinarity": current "unassessed", target "none"');
    expect(payload).not.toMatch(/interdisciplinarity": current "[123]"/);
  });

  it("leaves the payload untouched when no compaction happened", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });

    await handler(undefined, { sessionId: "s1", text: "just my turn" });

    expect(h.fakeSession.session.prompt.mock.calls[0][0]).toBe("just my turn");
  });
});

describe("Scenario: A payload the model never received gives the handover back", () => {
  it("keeps the handover pending when Pi refuses the prompt as busy, and the retry carries exactly one block", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2, target: 3 });
    handover.markCompacted();

    h.fakeSession.session.prompt.mockRejectedValueOnce(
      new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")
    );
    await expect(handler(undefined, { sessionId: "s1", text: "Where were we?" })).rejects.toThrow(
      /already processing/i
    );
    // The refused turn left no phantom, and the handover it drained is armed again.
    expect(h.fakeSession.transcript).toHaveLength(0);
    expect(handover.isPending()).toBe(true);

    await handler(undefined, { sessionId: "s1", text: "Where were we?" });
    const retry = h.fakeSession.session.prompt.mock.calls[1][0];
    expect(retry.match(/\[retained-state\]/g)).toHaveLength(1);
    expect(retry).toContain('student-agency": current "2", target "3"');
  });

  it("gives ALL host-authored prefixes back, so the retry carries each exactly once", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2, target: 3 });
    handover.markCompacted();
    canvasMirror.recordUiDeletion({ step: 4 }, "lernziel-1", "Lernziel 1");
    profileNotes.push("The lecturer set feedback-style to direct.");

    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing."));
    await expect(handler(undefined, { sessionId: "s1", text: "Where were we?" })).rejects.toThrow(
      /already processing/i
    );
    expect(h.fakeSession.transcript).toHaveLength(0);
    expect(handover.isPending()).toBe(true);
    expect(canvasMirror.hasPendingDeletions()).toBe(true);
    expect(profileNotes).toEqual(["The lecturer set feedback-style to direct."]);

    await handler(undefined, { sessionId: "s1", text: "Where were we?" });
    const retry = h.fakeSession.session.prompt.mock.calls[1][0];
    expect(retry.match(/\[retained-state\]/g)).toHaveLength(1);
    expect(retry.match(/\[canvas-deletion\]/g)).toHaveLength(1);
    expect(retry.match(/\[System note:/g)).toHaveLength(1);
    expect(retry).toContain("lernziel-1");
    expect(retry).toContain("feedback-style to direct");
    // Nothing is left over for a third turn.
    expect(canvasMirror.hasPendingDeletions()).toBe(false);
    expect(profileNotes).toEqual([]);
    expect(handover.isPending()).toBe(false);
  });

  it("restores the deletion notices in order, ahead of one recorded after the refusal", async () => {
    const handler = await promptHandler();
    canvasMirror.recordUiDeletion({ step: 1 }, "erste");
    canvasMirror.recordUiDeletion({ step: 2 }, "zweite");

    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing."));
    await expect(handler(undefined, { sessionId: "s1", text: "go" })).rejects.toThrow(/already processing/i);
    canvasMirror.recordUiDeletion({ step: 3 }, "dritte");

    await handler(undefined, { sessionId: "s1", text: "go" });
    const retry = h.fakeSession.session.prompt.mock.calls[1][0] as string;
    expect(retry.match(/\[canvas-deletion\]/g)).toHaveLength(3);
    expect(retry.indexOf("erste")).toBeLessThan(retry.indexOf("zweite"));
    expect(retry.indexOf("zweite")).toBeLessThan(retry.indexOf("dritte"));
  });

  it("does not arm a handover on a refused prompt when no compaction happened", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2 });

    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing."));
    await expect(handler(undefined, { sessionId: "s1", text: "hello" })).rejects.toThrow(/already processing/i);
    expect(handover.isPending()).toBe(false);

    await handler(undefined, { sessionId: "s1", text: "hello" });
    expect(h.fakeSession.session.prompt.mock.calls[1][0]).toBe("hello");
  });
});

describe("Scenario: Several compactions before one turn hand over once", () => {
  it("carries one block on the next turn and none on the turn after", async () => {
    const handler = await promptHandler();
    maturityMirror.applyToolResult({ kind: "maturity-update", criterion: "student-agency", current: 2, target: 3 });
    handover.markCompacted();
    handover.markCompacted();

    await handler(undefined, { sessionId: "s1", text: "first" });
    await handler(undefined, { sessionId: "s1", text: "second" });

    const [first, second] = h.fakeSession.session.prompt.mock.calls.map((c) => c[0]);
    expect(first.match(/\[retained-state\]/g)).toHaveLength(1);
    expect(second).toBe("second");
  });
});
