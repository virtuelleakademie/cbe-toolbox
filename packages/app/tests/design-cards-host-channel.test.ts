/**
 * Design-record tool cards at the HOST SEAM (change
 * `carry-the-design-cards-through-a-restart`).
 *
 * `design-cards-transcript.test.ts` proves the recorder, the promotion and the
 * sidecar round trip as units; `design-cards-rehydration.test.tsx` proves what a
 * re-entered conversation shows. What only this seam can show is the WIRING
 * between them: that the real `src/main/ipc.ts` opens a card on
 * `tool_execution_start`, closes it on `_end`, resets the buffer at dispatch,
 * clears it with the draft when a runaway run is aborted, and promotes it onto
 * the turn the boundary flush writes.
 *
 * Capability `agent-harness`, Requirement: *Sessions as Local Markdown/JSON
 * Files* — Scenarios: *A run whose only output is design-record cards is
 * persisted as a completed turn*; *A turn that streamed text keeps its text and
 * gains its cards*; *A stopped run that recorded cards keeps the stop's own
 * message*.
 *
 * Scaffolding is `turn-stop-host.test.ts`'s, trimmed: a real temp course, a real
 * persisted config, a mocked `AgentManager` whose fake session captures the
 * event subscription, and the REAL `sessions.js` writers so the sidecars can be
 * read back off disk. The card recorder, the promotion and the loop detector are
 * all the REAL ones — the doubles are the plumbing, never the logic under test.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TurnStopController } from "@cbe/pi-bridge/turn-stop";
import type { CbeRuntimeEvent } from "@cbe/pi-bridge/runtime";
import { promotedAssistantTurn } from "../src/shared/turn-stop.js";
import { en } from "../src/shared/i18n/en.js";
import { ToolCardRecorder, type PersistedToolCard } from "../src/shared/design-cards.js";
import { readSessionJson, seedableTurns, type SessionTurn } from "../src/main/sessions.js";

interface FakeTurn {
  role: "user" | "assistant";
  text: string;
  stopped?: boolean;
  display?: { text: string };
  cards?: PersistedToolCard[];
}

let tempDir: string;

const h = vi.hoisted(() => ({
  root: "",
  statePath: "",
  /** The one fake session, rebuilt per test. */
  active: null as null | FakeActive,
  seq: 0,
}));

interface FakeActive {
  id: string;
  courseId: string;
  sessionsDir: string;
  transcript: FakeTurn[];
  draft: string;
  cardRecorder: ToolCardRecorder;
  modelId: string;
  skillVersion: string;
  createdAt: string;
  env: { profile: string; affordances: Record<string, boolean>; paths: Record<string, string> };
  inFlight: boolean;
  aborts: number;
  steers: string[];
  queueClears: number;
  compacting: boolean;
  emit: null | ((event: CbeRuntimeEvent) => void);
  turnStop: TurnStopController;
  canvasMirror: { list: () => unknown[]; restore: () => void };
  stepMirror: {
    list: () => unknown[];
    recordedList: () => unknown[];
    holdsOnlySeededFocus: () => boolean;
    restore: () => void;
  };
  maturityMirror: { snapshot: () => Record<string, unknown>; seed: () => void };
  pendingAnswerGate: { reset: () => void };
  contextOccupancy: {
    read: () => { used: null; window?: number };
    noteAssistantMessageCompleted: () => void;
    noteCompactionBoundary: () => void;
  };
  session: {
    prompt: ReturnType<typeof vi.fn>;
    subscribe: (cb: (event: unknown) => void) => void;
    dispose: () => void;
    abort: () => Promise<void>;
    steer: (text: string) => Promise<void>;
    getContextUsage: () => { tokens: number; contextWindow: number; percent: number };
  };
}

function makeActive(courseId: string, sessionsDir: string): FakeActive {
  const a: FakeActive = {
    id: `sess-cards-${++h.seq}`,
    courseId,
    sessionsDir,
    transcript: [],
    draft: "",
    // Per-run design-record card buffer, as every live session carries
    // (capability `agent-harness`, Requirement: *Sessions as Local Markdown/JSON
    // Files*). The real recorder: no fixture here makes a design-record call, so
    // it stays empty and the promotion behaves as it did before it existed.
    cardRecorder: new ToolCardRecorder(),
    modelId: "test-model",
    skillVersion: "0.1.0",
    createdAt: "2026-08-17T10:00:00.000Z",
    env: { profile: "app", affordances: {}, paths: { workspace: "/w", corpus: "/c" } },
    inFlight: false,
    aborts: 0,
    steers: [],
    queueClears: 0,
    compacting: false,
    emit: null,
    turnStop: undefined as unknown as TurnStopController,
    canvasMirror: { list: () => [], restore: () => {} },
    stepMirror: { list: () => [], recordedList: () => [], holdsOnlySeededFocus: () => false, restore: () => {} },
    maturityMirror: { snapshot: () => ({}), seed: () => {} },
    pendingAnswerGate: { reset: () => {} },
    contextOccupancy: {
      read: () => ({ used: null }),
      noteAssistantMessageCompleted: () => {},
      noteCompactionBoundary: () => {},
    },
    session: {
      prompt: vi.fn<(text: string) => Promise<void>>(),
      subscribe: (cb) => {
        a.emit = cb;
      },
      dispose: () => {},
      abort: async () => {
        a.aborts += 1;
      },
      steer: async (text: string) => {
        a.steers.push(text);
      },
      getContextUsage: () => ({ tokens: 1, contextWindow: 1000, percent: 0 }),
    },
  };
  // The REAL controller, bound to this session's own state (capability
  // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*).
  a.turnStop = new TurnStopController({
    abort: () => a.session.abort(),
    clearQueue: () => {
      a.queueClears += 1;
      return { steering: [], followUp: [] };
    },
    hasPendingTurn: () => a.inFlight,
    isCompacting: () => a.compacting,
    timeoutMs: 60,
  });
  a.session.prompt.mockResolvedValue(undefined);
  return a;
}

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => tempDir),
    getVersion: vi.fn(() => "0.0.0-test"),
    getAppPath: vi.fn(() => "/opt/cbe-app"),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

vi.mock("@cbe/corpus-schema", () => ({ validateDirectory: vi.fn() }));

// The REAL detectors and the REAL abort-error recogniser: this suite exists to
// prove they are disarmed for a stopped run, which a stub could not show.
vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return { ...actual, createCitationResolver: vi.fn(async () => ({ listIds: () => [] })) };
});

vi.mock("../src/main/agent.js", () => {
  class AgentManager {
    async start(_cfg: unknown, course?: { id: string; sessionsDir: string }) {
      h.active = makeActive(course?.id ?? "", course?.sessionsDir ?? path.join(h.root, "sessions"));
      return h.active;
    }
    get(id: string) {
      return h.active && h.active.id === id ? h.active : undefined;
    }
    getByCourse(courseId: string) {
      return h.active && h.active.courseId === courseId ? h.active : undefined;
    }
    snapshot(id: string) {
      const s = this.get(id);
      if (!s) return null;
      return { meta: this.metaOf(s), turns: [...s.transcript], sessionsDir: s.sessionsDir };
    }
    dump(id: string) {
      const s = this.get(id);
      if (!s) return null;
      // The REAL promotion (`promotedAssistantTurn`), exactly as
      // `AgentManager.dump` uses it — the double is the session plumbing, never
      // the rule under test.
      const promoted = promotedAssistantTurn(s.draft, s.turnStop.stoppedForCurrentRun(), s.cardRecorder.take());
      if (promoted) {
        s.transcript.push(promoted);
        s.draft = "";
      }
      return { meta: this.metaOf(s), turns: [...s.transcript], sessionsDir: s.sessionsDir };
    }
    private metaOf(s: FakeActive) {
      return {
        sessionId: s.id,
        modelId: s.modelId,
        skillVersion: s.skillVersion,
        environmentProfile: s.env.profile,
        createdAt: s.createdAt,
      };
    }
    setInFlight(id: string, inFlight: boolean) {
      const s = this.get(id);
      if (s) s.inFlight = inFlight;
    }
    listIds() {
      return h.active ? [h.active.id] : [];
    }
    close() {}
    closeAll() {}
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
    async applyPendingProvider() {}
    async updateProvider() {
      return { ok: true as const, modelId: "test-model" };
    }
    queueProfileNote() {}
    recordCanvasDeletion() {}
    getCommands() {
      return [];
    }
  }
  return {
    AgentManager,
    SESSIONS_DIR: path.join(h.root, "flat-sessions"),
    get COURSES_ROOT() {
      return h.root;
    },
    get WORKSPACE_STATE_PATH() {
      return h.statePath;
    },
    resolveResource: (s: string) => `/tmp/test-resources/${s}`,
    currentCorpusDir: () => "/tmp/corpus",
    CORPUS_UPDATER_PATHS: { cacheRoot: "/tmp/c", bundledDir: "/tmp/b" },
    lecturerProfileService: {
      current: async () => null,
      applyOverride: async () => ({}),
      applyEstimate: async () => ({ outcome: "applied" }),
    },
    summariseDecisions: () => "",
    resetCorpusCaches: () => {},
  };
});

type Handler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

let handlers: Map<string, Handler>;
let sent: Array<{ type: string; sessionId?: string; data?: unknown }>;
let createCourse: (root: string, title: string) => Promise<{ id: string }>;
let writeActiveCourseId: (statePath: string, id: string) => Promise<unknown>;

/**
 * Register the real IPC surface ONCE, in a `beforeAll` with a raised timeout.
 *
 * Importing `src/main/ipc.ts` pulls the whole main module graph, which under
 * full-suite parallelism takes longer than vitest's 5 s default — a per-test
 * import made these tests pass alone and time out in the suite. Registering once
 * is safe here because every handler resolves its state through the mocked
 * manager and a per-test course, so nothing is shared between tests but the
 * handler table itself.
 */
async function registerOnce(): Promise<void> {
  ({ createCourse, writeActiveCourseId } = await import("../src/main/courses.js"));
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  handlers = new Map<string, Handler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: Handler) => {
    handlers.set(channel, fn);
  });
  registerIpc({
    webContents: {
      send: (_c: string, evt: { type: string; sessionId?: string; data?: unknown }) => sent.push(evt),
    },
  } as never);
}

/** A fresh course with its own conversation — which is what wires the session's
 * events through the production path. Its own course per test, so no state
 * survives from the previous one. */
async function boot(): Promise<FakeActive> {
  const course = await createCourse(h.root, `Kartenkurs ${h.seq + 1}`);
  await writeActiveCourseId(h.statePath, course.id);
  await handlers.get("cbe:conversation:open")!(null);
  sent.length = 0;
  return h.active!;
}

const prompt = (text = "Erklär mir Schritt 4.") =>
  handlers.get("cbe:prompt")!(null, { sessionId: h.active!.id, text }) as Promise<unknown>;
/** The lecturer's stop on the run in flight — its own channel, as in
 *  `turn-stop-host.test.ts`. */
const stop = () => handlers.get("cbe:prompt:abort")!(null, { sessionId: h.active!.id }) as Promise<{ status: string }>;
function emit(a: FakeActive, event: CbeRuntimeEvent): void {
  a.emit?.(event);
}

/**
 * Drive one whole turn: dispatch the prompt, run `during` while it is in flight,
 * then let it resolve. The prompt handler owns the in-flight flag and the
 * post-run transcript flush, so a stop has to land INSIDE it.
 */
async function turn(a: FakeActive, during: (a: FakeActive) => void | Promise<void>): Promise<void> {
  let release!: () => void;
  a.session.prompt.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
  const running = prompt();
  await new Promise((r) => setTimeout(r, 0));
  await during(a);
  release();
  await running;
}

/** Repeat one failing tool call often enough to trip the real loop detector. */
function runawayToolLoop(a: FakeActive, prefix: string): void {
  for (let i = 0; i < 14; i++) {
    emit(a, { type: "tool_execution_start", toolCallId: `${prefix}${i}`, toolName: "read", args: { path: "x.md" } });
    emit(a, {
      type: "tool_execution_end",
      toolCallId: `${prefix}${i}`,
      toolName: "read",
      result: { output: "no" },
      isError: true,
    });
  }
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-design-cards-"));
  h.root = path.join(tempDir, "courses");
  h.statePath = path.join(tempDir, "workspace-state.json");
  sent = [];
  mkdirSync(h.root, { recursive: true });
  writeFileSync(
    path.join(tempDir, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://localhost:1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
  await registerOnce();
}, 60_000);

beforeEach(() => {
  h.active = null;
  sent = [];
});

afterAll(() => {
  if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

const CANVAS_ARGS = { step: 3, id: "challenge-frame", label: "Challenge frame", value: "**Draft** framing." };
const STEP_ARGS = { step: 3, depth: "rough", focus: true };
const MATURITY_ARGS = { criterion: "authenticity", current: 2 };

/** Emit a completed tool call the way the runtime does — args on `_start`, the
 *  `{ content, details }` result on `_end`. */
function toolCall(a: FakeActive, id: string, toolName: string, args: unknown, text: string): void {
  emit(a, { type: "tool_execution_start", toolCallId: id, toolName, args });
  emit(a, {
    type: "tool_execution_end",
    toolCallId: id,
    toolName,
    result: { content: [{ type: "text", text }], details: { kind: "canvas-update" } },
    isError: false,
  });
}

function streamText(a: FakeActive, delta: string): void {
  emit(a, { type: "text_delta", delta });
}

/** Read the JSON sidecar the boundary flush wrote for the live session. */
async function storedTurns(a: FakeActive): Promise<SessionTurn[]> {
  // The flush is fire-and-forget behind a per-session chain; give it the tick.
  await new Promise((r) => setTimeout(r, 20));
  const json = await readSessionJson(a.sessionsDir, a.id);
  expect(json).not.toBeNull();
  return json!.turns;
}

function assistantTurns(turns: SessionTurn[]): SessionTurn[] {
  return turns.filter((t) => t.role === "assistant");
}

describe("A turn that streamed text keeps its text and gains its cards", () => {
  it("records the three calls onto the turn the boundary flush writes, at their offsets", async () => {
    const a = await boot();
    const lead = "I have written the framing onto step 3.";
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      streamText(a, lead);
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      toolCall(a, "t2", "cbe_step", STEP_ARGS, "Step 3 is now rough.");
      toolCall(a, "t3", "cbe_maturity", MATURITY_ARGS, "Authenticity read at L2.");
      streamText(a, " Next, the assessment.");
      emit(a, { type: "agent_end", aborted: false });
    });

    const assistant = assistantTurns(await storedTurns(a));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe(lead + " Next, the assessment.");
    const cards = assistant[0]!.cards!;
    expect(cards.map((c) => c.toolName)).toEqual(["cbe_canvas", "cbe_step", "cbe_maturity"]);
    expect(cards.map((c) => c.at)).toEqual([lead.length, lead.length, lead.length]);
    expect(cards.map((c) => c.resultText)).toEqual([
      "Artefact recorded on step 3.",
      "Step 3 is now rough.",
      "Authenticity read at L2.",
    ]);
    expect(cards.every((c) => c.status === "done")).toBe(true);
  });

  it("records nothing for a tool outside the design record — the scope holds at the seam", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      streamText(a, "Let me look that up.");
      toolCall(a, "r1", "read", { path: "corpus/index.json" }, "… index …");
      emit(a, { type: "agent_end", aborted: false });
    });

    const assistant = assistantTurns(await storedTurns(a));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.cards).toBeUndefined();
  });
});

describe("A run whose only output is design-record cards is persisted as a completed turn", () => {
  it("writes the turn the old `if (s.draft)` guard swallowed", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      toolCall(a, "t2", "cbe_step", STEP_ARGS, "Step 3 is now rough.");
      toolCall(a, "t3", "cbe_maturity", MATURITY_ARGS, "Authenticity read at L2.");
      emit(a, { type: "agent_end", aborted: false });
    });

    const stored = await storedTurns(a);
    const assistant = assistantTurns(stored);
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe("");
    expect(assistant[0]!.cards!.map((c) => c.toolName)).toEqual(["cbe_canvas", "cbe_step", "cbe_maturity"]);
    // The lecturer's own message is no longer followed by another user turn.
    expect(stored.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("names the recorded actions in the Markdown archive", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      emit(a, { type: "agent_end", aborted: false });
    });
    await new Promise((r) => setTimeout(r, 20));
    const md = readFileSync(path.join(a.sessionsDir, `${a.id}.md`), "utf8");
    expect(md).toContain("Recorded: cbe_canvas");
  });
});

describe("A stopped run that recorded cards keeps the stop's own message", () => {
  it("writes the neutral message with the cards on it, so the resume seed is unchanged", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      toolCall(a, "t2", "cbe_step", STEP_ARGS, "Step 3 is now rough.");
      const stopping = stop();
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    const stored = await storedTurns(a);
    const assistant = assistantTurns(stored);
    expect(assistant).toHaveLength(1);
    // Exactly the text this path wrote before the field existed — `seedableTurns`
    // drops an empty-text assistant turn, so an empty one here would silently
    // shorten what a resumed model is seeded with.
    expect(assistant[0]!.text).toBe(en.chatStoppedTurnPlaceholder);
    expect(assistant[0]!.stopped).toBe(true);
    expect(seedableTurns(stored).map((t) => t.text)).toEqual(["Erklär mir Schritt 4.", en.chatStoppedTurnPlaceholder]);
    // …and the cards are kept rather than traded away for it, without the offsets
    // that indexed a draft this turn's text is not.
    expect(assistant[0]!.cards!.map((c) => c.toolName)).toEqual(["cbe_canvas", "cbe_step"]);
    expect(assistant[0]!.cards!.every((c) => c.at === undefined)).toBe(true);
  });

  it("still writes the placeholder alone for a stop that recorded nothing", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    const assistant = assistantTurns(await storedTurns(a));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe(en.chatStoppedTurnPlaceholder);
    expect(assistant[0]!.cards).toBeUndefined();
  });
});

describe("the card buffer is run-scoped", () => {
  it("does not carry a previous run's cards onto the next turn", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      emit(a, { type: "agent_end", aborted: false });
    });
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      streamText(a, "Nothing recorded this time.");
      emit(a, { type: "agent_end", aborted: false });
    });

    const assistant = assistantTurns(await storedTurns(a));
    expect(assistant).toHaveLength(2);
    expect(assistant[0]!.cards!.map((c) => c.toolName)).toEqual(["cbe_canvas"]);
    expect(assistant[1]!.cards).toBeUndefined();
  });

  it("discards a runaway run's cards with its draft, leaving no orphan turn after the abort note", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      streamText(a, "Recording, then looping.");
      toolCall(a, "t1", "cbe_canvas", CANVAS_ARGS, "Artefact recorded on step 3.");
      runawayToolLoop(a, "loop");
      emit(a, { type: "agent_end", aborted: false });
    });

    const assistant = assistantTurns(await storedTurns(a));
    // Exactly the loop breaker's neutral note — no second assistant turn carrying
    // calls that were made BEFORE it.
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe(en.errorLoopAbortNote);
    expect(assistant[0]!.cards).toBeUndefined();
  });
});
