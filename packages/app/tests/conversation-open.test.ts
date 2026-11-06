/**
 * Main-process conversation lifecycle tests (change `one-conversation-per-course`):
 *
 * - desktop-app spec, Requirement: Renderer Boot-Hydration from the Main Process —
 *   Scenarios: Concurrent hydration calls yield one session; Legacy `mode`
 *   metadata never breaks continuity.
 * - course-workspace spec, Requirement: One Canonical Conversation per Course —
 *   Scenarios: Canonical conversation is the newest sidecar pair (handler side);
 *   Unreadable newest pair never silently resurrects an older conversation;
 *   Fresh conversation retires the canonical one durably; Fresh conversation is
 *   still refused while that conversation's turn runs; Legacy sidecar pairs
 *   stay on disk. Requirement: Active Course and Course Switching — Scenario:
 *   Background turn output is persisted in its own course.
 * - desktop-app spec — Scenario: Concurrent opens of two courses do not race
 *   the first-launch installation (global first-start gate).
 * - agent-harness spec, Requirement: Sessions as Local Markdown/JSON Files —
 *   Scenarios: Completed turns survive a crash or renderer reload (turn-boundary
 *   flush); Error-path flush excludes the partial draft, close includes it;
 *   Display projection (persisted only when differing).
 *
 * Harness pattern mirrors ipc-save-config.test.ts: electron + agent.js are
 * mocked; sessions.js and courses.js run REAL against a temp Space so the
 * on-disk contract (atomic sidecars, canonical scan) is exercised end-to-end.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SessionTurn } from "../src/main/sessions.js";
import type { DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import { ContextOccupancyTracker } from "@cbe/pi-bridge";
// Imported through the package's own subpath so the module-level
// `vi.mock("@cbe/pi-bridge")` below does not swallow it: the fake session
// carries the REAL stop controller, which is a pure state machine over injected
// callbacks (capability `agent-harness`, Requirement: *A Lecturer Can Stop a
// Running Turn*).
import { TurnStopController } from "@cbe/pi-bridge/turn-stop";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

let tempDir: string;

const h = vi.hoisted(() => ({
  // Mutable state the hoisted agent.js mock reads lazily (set in beforeEach
  // BEFORE ipc.js is imported).
  root: "",
  statePath: "",
  sessions: new Map<string, FakeActive>(),
  startCalls: [] as Array<{ resumeId?: string; canvasArtefacts?: unknown[]; didacticChecks?: unknown }>,
  startDelayMs: 0,
  seq: 0,
  // Concurrency observation for the global first-start gate: how many
  // `agentManager.start` calls were in flight simultaneously.
  activeStarts: 0,
  maxConcurrentStarts: 0,
  // When true, the NEXT `agentManager.start` throws once (fresh-start failure
  // path of the New Session reset).
  failNextStart: false,
  // Which Space the fixtures above currently describe. `newSpace()` bumps it;
  // every `AgentManager` stamps the value it was constructed under, and a
  // manager whose stamp has gone stale is quarantined (see `stale` below).
  generation: 0,
  // How many starts the quarantine has swallowed. Only the isolation guard reads
  // it, and it reads it to prove the guard is not passing vacuously: without it,
  // a stale call that died of something else would look exactly like a contained
  // one.
  quarantinedStarts: 0,
  // Same purpose for the flush paths (`snapshot` / `dump`): session ids collide
  // across Spaces because `newSpace()` resets `seq`, so an orphaned
  // `void flushSession(…)` would otherwise resolve its id against the CURRENT
  // test's session and write that session's state — on the closing path even
  // moving its live draft into the transcript.
  quarantinedFlushes: 0,
}));

interface FakeActive {
  id: string;
  courseId: string;
  sessionsDir: string;
  transcript: SessionTurn[];
  draft: string;
  cardRecorder: ToolCardRecorder;
  modelId: string;
  skillVersion: string;
  createdAt: string;
  env: { profile: string; affordances: Record<string, boolean>; paths: Record<string, string> };
  canvasMirror: {
    entries: unknown[];
    list: () => unknown[];
    recordUiDeletion: () => void;
    drainDeletionNotices: () => unknown[];
  };
  maturityMirror: {
    state: Record<string, unknown>;
    snapshot: () => Record<string, unknown>;
    isEmpty: () => boolean;
  };
  /** Host-side step-coverage mirror (wave B) — the New Session carry-over reads it.
   * `recordedList` / `holdsOnlySeededFocus` are the recorded-work half of the real
   * mirror's surface (capability `agent-harness`, Requirement: *Host-Set Initial
   * Step Focus*); this double never receives the host's initial focus seed, so they
   * answer "everything here is recorded". The seed itself is covered against the
   * REAL mirror in `initial-step-focus-host.test.ts`. */
  stepMirror: {
    entries: Array<{ step: number; depth: string; focus: boolean }>;
    list: () => unknown[];
    recordedList: () => unknown[];
    holdsOnlySeededFocus: () => boolean;
  };
  pendingAnswerGate: { reset: () => void };
  /** Context-occupancy tracker (Requirement: Context Occupancy Reported to the
   * Host) — the REAL one, so the hydration snapshot's `contextUsage` field is
   * exercised rather than stubbed away. */
  contextOccupancy: ContextOccupancyTracker;
  configuredContextLength?: number;
  /** Decision artefacts carried on the live session so every flush rewrites them
   * (Requirement: Decision Artefacts Are Per-Conversation State). */
  didacticChecks?: DidacticChecks;
  inFlight: boolean;
  pendingProfileNotes: string[];
  /** The REAL stop controller (capability `agent-harness`, Requirement: *A
   * Lecturer Can Stop a Running Turn*) — it is a pure state machine over
   * injected callbacks, so the fake session carries the production object rather
   * than a stub of it. */
  turnStop: TurnStopController;
  session: { subscribe: (cb: unknown) => void; dispose: () => void; prompt: (text: string) => Promise<void> };
}

function makeFakeActive(
  courseId: string,
  sessionsDir: string,
  resume?: { sessionId: string; createdAt: string; turns: SessionTurn[]; didacticChecks?: DidacticChecks },
  canvasArtefacts?: unknown[],
  /** Decision artefacts carried onto a FRESH session by the New Session reset. */
  didacticChecks?: DidacticChecks,
  /** Step coverage + maturity carried onto a FRESH session (wave B retention). */
  retained?: { stepCoverage?: Array<{ step: number; depth: string; focus: boolean }> }
): FakeActive {
  // Mirror pre-seed semantics of the real startCbeSession: carried-over
  // artefacts land in the fresh session's mirror (Requirement: Session-Start
  // Canvas Artefact Injection).
  const entries = canvasArtefacts ? [...canvasArtefacts] : [];
  const mirror = {
    entries,
    list: () => [...entries],
    recordUiDeletion: () => {},
    drainDeletionNotices: () => [] as unknown[],
  };
  const active: FakeActive = {
    id: resume?.sessionId ?? `fresh-${++h.seq}`,
    courseId,
    sessionsDir,
    transcript: resume ? [...resume.turns] : [],
    draft: "",
    // Per-run design-record card buffer, as every live session carries
    // (capability `agent-harness`, Requirement: *Sessions as Local Markdown/JSON
    // Files*). The real recorder: no fixture here makes a design-record call, so
    // it stays empty and the promotion behaves as it did before it existed.
    cardRecorder: new ToolCardRecorder(),
    modelId: "test-model",
    skillVersion: "0.1.0",
    createdAt: resume?.createdAt ?? new Date().toISOString(),
    env: { profile: "app", affordances: {}, paths: { workspace: "/w", corpus: "/c" } },
    canvasMirror: mirror,
    maturityMirror: {
      state: {} as Record<string, unknown>,
      snapshot() {
        return { ...this.state };
      },
      isEmpty() {
        return Object.keys(this.state).length === 0;
      },
    },
    ...((resume?.didacticChecks ?? didacticChecks) ? { didacticChecks: resume?.didacticChecks ?? didacticChecks } : {}),
    stepMirror: {
      entries: [...(retained?.stepCoverage ?? [])] as Array<{ step: number; depth: string; focus: boolean }>,
      list() {
        return [...this.entries];
      },
      recordedList() {
        return [...this.entries];
      },
      holdsOnlySeededFocus() {
        return false;
      },
    },
    pendingAnswerGate: { reset: () => {} },
    contextOccupancy: new ContextOccupancyTracker(),
    inFlight: false,
    pendingProfileNotes: [],
    // Replaced immediately below with one bound to this object's own state.
    turnStop: undefined as unknown as TurnStopController,
    session: {
      subscribe: () => {},
      dispose: vi.fn(),
      prompt: async () => {},
      // Pi's public context-usage accessor. The tracker starts unmeasured, so
      // the hydration snapshot reports `used: null` regardless — which is the
      // contract: unknown, never zero.
      getContextUsage: () => ({ tokens: 4242, contextWindow: 131072, percent: 3 }),
    },
  };
  active.turnStop = new TurnStopController({
    abort: async () => {},
    clearQueue: () => ({ steering: [], followUp: [] }),
    hasPendingTurn: () => active.inFlight,
    isCompacting: () => false,
  });
  return active;
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

vi.mock("@cbe/pi-bridge", async (importOriginal) => ({
  // The design-document builder is pure and unit-tested in pi-bridge; the export
  // handler must exercise the REAL one, so the mock delegates for it.
  buildDesignDocument: ((await importOriginal()) as { buildDesignDocument: unknown }).buildDesignDocument,
  designDocumentFilename: ((await importOriginal()) as { designDocumentFilename: unknown }).designDocumentFilename,
  createCitationResolver: vi.fn(async () => ({ listIds: () => [] })),
  // The occupancy tracker and its change check are pure and unit-tested in
  // pi-bridge; the hydration snapshot and the report emission must exercise the
  // REAL ones, so the mock delegates for both.
  ContextOccupancyTracker: ((await importOriginal()) as { ContextOccupancyTracker: unknown }).ContextOccupancyTracker,
  occupancyChanged: ((await importOriginal()) as { occupancyChanged: unknown }).occupancyChanged,
  createPiAtomizationSessionFactory: vi.fn(),
  readWikiSkillVersion: vi.fn(),
  runAtomization: vi.fn(),
  ToolLoopDetector: class {
    reset() {}
    record() {
      return { action: "none" };
    }
  },
  // Truncation remediation (Requirement: Response-Cut-Off State with One-Click
  // Continue and Retry): wireSessionEvents instantiates the detector and applies
  // verdicts; these tests exercise conversation lifecycle, so a no-op double
  // mirrors the ToolLoopDetector mock above.
  TruncationDetector: class {
    reset() {}
    record() {
      return { action: "none" };
    }
  },
  applyTruncationVerdict: vi.fn(() => false),
}));

vi.mock("@cbe/corpus-schema", () => ({ validateDirectory: vi.fn() }));

vi.mock("../src/main/agent.js", () => {
  class AgentManager {
    /**
     * The Space this manager was constructed under.
     *
     * Vitest does NOT cancel the work of a test it killed on a timeout, so such
     * a test can resume mid-`conversationOpen` long after `beforeEach` pointed
     * the fixtures at a new Space — and every handler it holds is closed over
     * this, the module graph that test imported. Stamping the generation lets
     * the double recognise itself as orphaned and stay out of `h`, so a slow
     * test fails ALONE instead of writing a phantom session into its successor's
     * assertions.
     */
    readonly generation = h.generation;

    /** Never settles: an orphaned caller stops here, having mutated nothing.
     * Throwing instead would only relocate the damage into an unhandled
     * rejection that vitest attributes to whichever test is running by then. */
    private quarantine<T>(): Promise<T> {
      return new Promise<T>(() => {});
    }

    private stale(): boolean {
      return this.generation !== h.generation;
    }

    async start(
      _cfg: unknown,
      course?: { id: string; sessionsDir: string },
      resume?: { sessionId: string; createdAt: string; turns: SessionTurn[]; didacticChecks?: DidacticChecks },
      canvasArtefacts?: unknown[],
      _compaction?: unknown,
      didacticChecks?: DidacticChecks,
      retained?: { stepCoverage?: Array<{ step: number; depth: string; focus: boolean }> }
    ): Promise<FakeActive> {
      if (this.stale()) {
        h.quarantinedStarts += 1;
        return this.quarantine<FakeActive>();
      }
      h.startCalls.push({ resumeId: resume?.sessionId, canvasArtefacts, didacticChecks, retained });
      h.activeStarts += 1;
      h.maxConcurrentStarts = Math.max(h.maxConcurrentStarts, h.activeStarts);
      if (h.startDelayMs > 0) await new Promise((r) => setTimeout(r, h.startDelayMs));
      h.activeStarts -= 1;
      if (h.failNextStart) {
        h.failNextStart = false;
        throw new Error("provider unreachable during fresh start");
      }
      const active = makeFakeActive(
        course?.id ?? "",
        course?.sessionsDir ?? path.join(h.root, "..", "sessions"),
        resume,
        canvasArtefacts,
        didacticChecks
      );
      if (h.sessions.has(active.id)) throw new Error(`Session already open: ${active.id}`);
      h.sessions.set(active.id, active);
      return active;
    }
    get(id: string) {
      return h.sessions.get(id);
    }
    getByCourse(courseId: string) {
      if (!courseId) return undefined;
      for (const s of h.sessions.values()) if (s.courseId === courseId) return s;
      return undefined;
    }
    snapshot(id: string) {
      if (this.stale()) {
        h.quarantinedFlushes += 1;
        return null;
      }
      const s = h.sessions.get(id);
      if (!s) return null;
      return {
        meta: this.metaOf(s),
        turns: [...s.transcript],
        sessionsDir: s.sessionsDir,
        ...(s.didacticChecks ? { didacticChecks: s.didacticChecks } : {}),
      };
    }
    dump(id: string) {
      if (this.stale()) {
        h.quarantinedFlushes += 1;
        return null;
      }
      const s = h.sessions.get(id);
      if (!s) return null;
      if (s.draft) {
        s.transcript.push({ role: "assistant", text: s.draft });
        s.draft = "";
      }
      return {
        meta: this.metaOf(s),
        turns: [...s.transcript],
        sessionsDir: s.sessionsDir,
        ...(s.didacticChecks ? { didacticChecks: s.didacticChecks } : {}),
      };
    }
    metaOf(s: FakeActive) {
      return {
        sessionId: s.id,
        modelId: s.modelId,
        skillVersion: s.skillVersion,
        environmentProfile: s.env.profile,
        createdAt: s.createdAt,
      };
    }
    listIds() {
      return [...h.sessions.keys()];
    }
    // The remaining mutators carry the same quarantine as `start`: an orphaned
    // graph must not close or re-flag a session the CURRENT test owns.
    close(id: string) {
      if (this.stale()) return;
      h.sessions.get(id)?.session.dispose();
      h.sessions.delete(id);
    }
    closeAll() {
      if (this.stale()) return;
      h.sessions.clear();
    }
    setInFlight(id: string, inFlight: boolean) {
      if (this.stale()) return;
      const s = h.sessions.get(id);
      if (s) s.inFlight = inFlight;
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
    SESSIONS_DIR: path.join(h.root, "..", "flat-sessions"),
    get COURSES_ROOT() {
      return h.root;
    },
    get WORKSPACE_STATE_PATH() {
      return h.statePath;
    },
    resolveResource: (s: string) => `/tmp/test-resources/${s}`,
    lecturerProfileService: {
      current: async () => null,
      applyOverride: async () => ({}),
      applyEstimate: async () => ({ outcome: "applied" }),
    },
  };
});

type Handler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

async function bootHandlers(): Promise<Map<string, Handler>> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, Handler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: Handler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return handlers;
}

async function seedCourse(title = "Testkurs"): Promise<string> {
  const { createCourse, writeActiveCourseId } = await import("../src/main/courses.js");
  const course = await createCourse(h.root, title);
  await writeActiveCourseId(h.statePath, course.id);
  return course.id;
}

function sessionsDirOf(courseId: string): string {
  return path.join(h.root, courseId, "sessions");
}

async function seedSidecar(
  courseId: string,
  sessionId: string,
  closedAt: string,
  turns?: SessionTurn[],
  legacyMode?: string,
  didacticChecks?: DidacticChecks
) {
  const { writeSessionJson, writeSessionMd } = await import("../src/main/sessions.js");
  const meta = {
    sessionId,
    // Legacy sidecars may still carry a mode field (retired model) — the
    // writer no longer emits it, so tests seed it directly into meta.
    ...(legacyMode ? { mode: legacyMode } : {}),
    modelId: "test-model",
    skillVersion: "0.1.0",
    environmentProfile: "app",
    createdAt: "2026-07-01T00:00:00.000Z",
    closedAt,
  };
  const t = turns ?? [
    { role: "user" as const, text: "hello" },
    { role: "assistant" as const, text: "hi" },
  ];
  await writeSessionJson(sessionsDirOf(courseId), meta, t, didacticChecks);
  await writeSessionMd(sessionsDirOf(courseId), meta, t);
}

/** Wait until the fire-and-forget turn-boundary flush has landed on disk. */
async function waitForFile(file: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${file}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Wait until a session's sidecar carries `count` turns.
 *
 * `waitForFile` is NOT enough for a turn-boundary flush: a freshly started
 * conversation is minted with an immediately durable EMPTY pair, so the `.json`
 * already exists before the first prompt runs and the existence check returns at
 * once. The turn-boundary flush itself is fire-and-forget, so a test that ends on
 * `waitForFile` ends with a write still queued — which then lands after
 * `afterEach` removed the Space and re-creates the folder under `os.tmpdir()`.
 * That is where the stray `cbe-conv-test-XXXXXX` directories under `/tmp` came
 * from, each holding just the one course folder that write re-created.
 */
async function waitForTurns(file: string, count: number, timeoutMs = 2000): Promise<SessionTurn[]> {
  const start = Date.now();
  for (;;) {
    if (existsSync(file)) {
      const turns = JSON.parse(readFileSync(file, "utf8")).turns as SessionTurn[];
      if (turns.length >= count) return turns;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${count} turns in ${file}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Poll a mechanism until it reports what the test is waiting for.
 *
 * The counterpart to `waitForTurns` for in-memory state: a fixed delay followed
 * by a hard assertion is a tolerance, and a tolerance is what this file exists to
 * remove. Wait for the mechanism, then assert it strictly.
 */
async function waitUntil(what: string, ready: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Point the mocked `userData` at a fresh temp Space and re-arm the agent double. */
function newSpace(): void {
  h.generation += 1;
  tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-conv-test-"));
  h.root = path.join(tempDir, "courses");
  h.statePath = path.join(tempDir, "workspace-state.json");
  h.sessions.clear();
  h.startCalls.length = 0;
  h.startDelayMs = 0;
  h.seq = 0;
  h.activeStarts = 0;
  h.maxConcurrentStarts = 0;
  h.failNextStart = false;
  h.quarantinedStarts = 0;
  h.quarantinedFlushes = 0;
  mkdirSync(h.root, { recursive: true });
  // Minimal persisted provider config (plaintext branch — safeStorage mocked off).
  writeFileSync(
    path.join(tempDir, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://localhost:1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
}

function dropSpace(): void {
  if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
}

/**
 * The per-test hooks every describe in this file shares.
 *
 * `vi.resetModules()` is load-bearing, not decoration: `ipc.ts` derives
 * `CONFIG_PATH` from `app.getPath("userData")` at MODULE LOAD, and its
 * first-start gate and single-flight map are module-level state, so a test that
 * points the mocked `userData` at a fresh Space must get a fresh module graph
 * with it.
 *
 * The teardown settles in-flight dynamic imports BEFORE the reset the next
 * `beforeEach` performs. Vitest does not cancel the work of a test it killed on
 * a timeout, so such a test leaves its `await import("../src/main/ipc.js")`
 * mid-evaluation; invalidating the module cache underneath that evaluation hands
 * the NEXT test a half-initialised namespace, and its `await import("electron")`
 * then yields `undefined` for `ipcMain`. That is the amplifier that used to turn
 * one slow test into a failing PAIR — see `warm-up` below for the trigger.
 */
function useTempSpace(): void {
  beforeEach(() => {
    newSpace();
    vi.resetModules();
  });

  afterEach(async () => {
    await vi.dynamicImportSettled();
    dropSpace();
  });
}

// Pay the main-process module graph's cold fetch+transform ONCE, outside any
// test's timeout budget. Measured on this file (2026-08-25): the FIRST
// `import("../src/main/ipc.js")` costs ~770 ms and every later one 31–88 ms,
// because `vi.resetModules()` drops a module's evaluated exports but keeps its
// transformed code. Left inside the first test that calls `bootHandlers()`, that
// one-off made whichever test ran first a 10–25x outlier against vitest's 5 s
// default — the whole margin the flake ate under full-suite parallelism.
beforeAll(async () => {
  newSpace();
  await import("../src/main/ipc.js");
  dropSpace();
});

describe("conversationOpen — boot-hydration resolution", () => {
  useTempSpace();

  it("resumes the canonical (newest) conversation under its original sessionId", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "older", "2026-07-01T10:00:00.000Z");
    await seedSidecar(courseId, "newest", "2026-07-07T10:00:00.000Z");
    const handlers = await bootHandlers();
    const result = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      turns: SessionTurn[];
      agentRunning: boolean;
    };
    expect(result.session.sessionId).toBe("newest");
    expect(result.turns.map((t) => t.text)).toEqual(["hello", "hi"]);
    expect(result.agentRunning).toBe(false);
    expect(h.startCalls).toEqual([{ resumeId: "newest" }]);
  });

  it("concurrent hydration calls yield one session (single-flight)", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv", "2026-07-07T10:00:00.000Z");
    h.startDelayMs = 50;
    const handlers = await bootHandlers();
    const open = handlers.get("cbe:conversation:open")!;
    const [a, b] = (await Promise.all([open(null), open(null)])) as [
      { session: { sessionId: string } },
      { session: { sessionId: string } },
    ];
    expect(a.session.sessionId).toBe("conv");
    expect(b.session.sessionId).toBe("conv");
    // ONE resolution ran; the second call coalesced onto it.
    expect(h.startCalls.length).toBe(1);
    expect(h.sessions.size).toBe(1);
  });

  it("re-attaches to an already-open session without disturbing it, reporting the in-flight flag", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const open = handlers.get("cbe:conversation:open")!;
    const first = (await open(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(first.session.sessionId)!;
    active.inFlight = true;
    active.transcript.push({ role: "user", text: "turn 1" });
    const again = (await open(null)) as { session: { sessionId: string }; agentRunning: boolean; turns: SessionTurn[] };
    expect(again.session.sessionId).toBe(first.session.sessionId);
    expect(again.agentRunning).toBe(true);
    expect(again.turns.map((t) => t.text)).toContain("turn 1");
    expect(h.startCalls.length).toBe(1); // no restart
    expect((active.session.dispose as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(active.courseId).toBe(courseId);
  });

  it("legacy sidecar mode metadata never breaks continuity (no notice, no branch, file untouched)", async () => {
    // Scenario (Renderer Boot-Hydration): Legacy `mode` metadata never breaks
    // continuity — hydration ignores it, does not warn, does not rewrite.
    const courseId = await seedCourse();
    await seedSidecar(courseId, "legacy-mode", "2026-07-07T10:00:00.000Z", undefined, "sparring-v2");
    const jsonPath = path.join(sessionsDirOf(courseId), "legacy-mode.json");
    const before = readFileSync(jsonPath, "utf8");
    const handlers = await bootHandlers();
    const result = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      turns: SessionTurn[];
      notice?: string;
    };
    expect(result.session.sessionId).toBe("legacy-mode");
    expect(result.turns.length).toBe(2); // continuity preserved
    expect(result.notice).toBeUndefined(); // no warning over the legacy field
    expect(readFileSync(jsonPath, "utf8")).toBe(before); // never rewritten
  });

  it("unreadable newest pair starts fresh WITH a notice and never silently resumes the older pair", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "older-ok", "2026-07-01T10:00:00.000Z");
    // Torn newest pair: intact MD (newer stamp), truncated JSON.
    await seedSidecar(courseId, "newest-torn", "2026-07-07T10:00:00.000Z");
    writeFileSync(path.join(sessionsDirOf(courseId), "newest-torn.json"), '{"meta": {', "utf8");
    const handlers = await bootHandlers();
    const result = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      notice?: string;
      turns: SessionTurn[];
    };
    expect(result.session.sessionId).not.toBe("older-ok");
    expect(result.turns).toEqual([]);
    expect(result.notice).toMatch(/could not be read/i);
    // Legacy pairs stay on disk untouched.
    expect(existsSync(path.join(sessionsDirOf(courseId), "older-ok.json"))).toBe(true);
    expect(readFileSync(path.join(sessionsDirOf(courseId), "newest-torn.json"), "utf8")).toBe('{"meta": {');
  });

  // desktop-app spec, Scenario: Concurrent opens of two courses do not race the
  // first-launch installation (change add-background-course-sessions): the
  // per-course single-flight cannot stop two DIFFERENT courses from starting
  // concurrently; the global first-start gate serialises them until the first
  // `agentManager.start` has completed once.
  it("concurrent opens of two different courses serialise the first session start (global gate)", async () => {
    const courseA = await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    h.startDelayMs = 60;
    const open = handlers.get("cbe:conversation:open")!;

    // First open (course A) begins resolving; its start is in flight…
    const first = open(null);
    await new Promise((r) => setTimeout(r, 15));
    // …when the active course switches to B and a second open arrives.
    const { createCourse, writeActiveCourseId } = await import("../src/main/courses.js");
    const courseB = await createCourse(h.root, "Kurs B");
    await writeActiveCourseId(h.statePath, courseB.id);
    const second = open(null);

    const [a, b] = (await Promise.all([first, second])) as [
      { session: { sessionId: string } },
      { session: { sessionId: string } },
    ];
    // The second course's start WAITED for the first — never two concurrent
    // starts, so the lazy installation can never race itself.
    expect(h.maxConcurrentStarts).toBe(1);
    expect(h.startCalls.length).toBe(2);
    // Both opens resolved to their own course's session; neither failed.
    expect(a.session.sessionId).not.toBe(b.session.sessionId);
    expect(h.sessions.get(a.session.sessionId)!.courseId).toBe(courseA);
    expect(h.sessions.get(b.session.sessionId)!.courseId).toBe(courseB.id);
  });

  it("no stored conversation → fresh start with an immediately durable (empty) pair", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const result = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
    };
    // Durable minting: the empty pair is on disk BEFORE any turn ran.
    const json = path.join(sessionsDirOf(courseId), `${result.session.sessionId}.json`);
    const md = path.join(sessionsDirOf(courseId), `${result.session.sessionId}.md`);
    expect(existsSync(json)).toBe(true);
    expect(existsSync(md)).toBe(true);
    expect(JSON.parse(readFileSync(json, "utf8")).turns).toEqual([]);
  });
});

/**
 * Regression guard for the flake this file used to produce (2026-08-25).
 *
 * The two tests that failed together in a loaded full-suite run were the FIRST
 * two of this file, and they failed as one event: the first paid the whole main
 * module graph's cold import inside its own 5 s budget, overran it, and vitest
 * then moved on WITHOUT cancelling that work. The second inherited the wreckage
 * — first as a torn module cache (`vi.resetModules()` landing on a live
 * evaluation, so `import("electron")` yielded `undefined` for `ipcMain`), and,
 * once that was settled in teardown, as phantom fixture writes from the orphan.
 *
 * The trigger is gone (the graph is warmed in `beforeAll` above, which took the
 * first test from ~420 ms to ~100 ms and made it an ordinary member of the
 * file). This describe guards the containment, which is what keeps a single slow
 * test failing ALONE if the trigger ever comes back.
 */
describe("suite isolation — an orphaned module graph cannot reach the live fixtures", () => {
  useTempSpace();

  /**
   * Put the current handlers in the position an orphaned continuation is in: the
   * fixtures have moved on to a new Space and the module cache has been reset,
   * while the handlers still hold the previous graph. The previous Space stays on
   * disk for the length of the test — an orphan whose config read fails dies
   * before it ever reaches the double, which would make the guard vacuous — and
   * is dropped by the hook below however the test ends.
   */
  const strandedSpaces: string[] = [];
  function orphanCurrentGraph(): void {
    strandedSpaces.push(tempDir);
    newSpace();
    vi.resetModules();
  }
  afterEach(() => {
    for (const dir of strandedSpaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("a stale AgentManager writes no session and no start call into the next test's fixtures", async () => {
    const handlers = await bootHandlers();
    orphanCurrentGraph();
    await seedCourse();

    const startsBefore = h.startCalls.length;
    const sessionsBefore = h.sessions.size;
    // An orphan's own await is inside a test vitest has already failed; the
    // rejection is nobody's signal, exactly as `.catch` says here.
    void handlers.get("cbe:conversation:open")!(null).catch(() => {});
    // Wait for the mechanism, not for a delay: the stale call reads config and
    // course state off disk before it reaches the double, and how long that takes
    // is a property of the machine, not of the contract under test.
    await waitUntil("the stale start to reach the quarantine", () => h.quarantinedStarts > 0);

    // It DID reach the double — otherwise the two assertions below prove nothing.
    expect(h.quarantinedStarts).toBe(1);
    expect(h.startCalls.length).toBe(startsBefore);
    expect(h.sessions.size).toBe(sessionsBefore);
  });

  it("the CURRENT graph is unaffected — the quarantine is by generation, not a kill switch", async () => {
    const stale = await bootHandlers();
    orphanCurrentGraph();
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv", "2026-07-07T10:00:00.000Z");

    void stale.get("cbe:conversation:open")!(null).catch(() => {});
    const live = await bootHandlers();
    const result = (await live.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };

    expect(result.session.sessionId).toBe("conv");
    expect(h.startCalls).toEqual([{ resumeId: "conv" }]);
    expect(h.sessions.size).toBe(1);
  });

  // The flush paths need the same containment as `start`, and for a sharper
  // reason: `newSpace()` resets the id counter, so every Space mints `fresh-1`,
  // `fresh-2`, … . An orphaned `void flushSession(…)` therefore resolves its id
  // against the CURRENT test's session — writing that session's state to disk at
  // an arbitrary moment and, on the closing path, moving its live draft into the
  // transcript, which is exactly what "error path: flush excludes the partial
  // draft" asserts about.
  it("a stale flush neither writes nor mutates the live session that reuses its id", async () => {
    await seedCourse();
    const stale = await bootHandlers();
    const staleOpened = (await stale.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const staleId = staleOpened.session.sessionId;

    orphanCurrentGraph();

    const courseId = await seedCourse();
    const live = await bootHandlers();
    const liveOpened = (await live.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    // The id collision is the mechanism — without it the guard proves nothing.
    expect(liveOpened.session.sessionId).toBe(staleId);
    const liveActive = h.sessions.get(staleId)!;
    liveActive.transcript.push({ role: "user", text: "live question" });
    liveActive.draft = "half a sent";

    await stale.get("cbe:close-session")!(null, staleId);

    // It DID reach the double — otherwise the three assertions below prove nothing.
    expect(h.quarantinedFlushes).toBe(1);
    expect(liveActive.draft).toBe("half a sent");
    expect(liveActive.transcript.map((t) => t.role)).toEqual(["user"]);
    // The empty pair the live open minted is still empty: the stale flush wrote
    // neither the live turn nor the live draft into it.
    const liveJson = path.join(sessionsDirOf(courseId), `${staleId}.json`);
    expect(JSON.parse(readFileSync(liveJson, "utf8")).turns).toEqual([]);
  });
});

describe("conversationFresh — fresh-conversation semantics", () => {
  useTempSpace();

  it("retires the canonical conversation durably: old pair intact, new empty pair on disk", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "current", "2026-07-07T10:00:00.000Z");
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    expect(opened.session.sessionId).toBe("current");

    const fresh = (await handlers.get("cbe:conversation:fresh")!(null)) as {
      session: { sessionId: string };
    };
    expect(fresh.session.sessionId).not.toBe("current");
    // Retired pair stays on disk as a legacy file.
    expect(existsSync(path.join(sessionsDirOf(courseId), "current.json"))).toBe(true);
    // New pair is durable immediately (crash before the first turn cannot resurrect the retired one).
    const newJson = path.join(sessionsDirOf(courseId), `${fresh.session.sessionId}.json`);
    expect(existsSync(newJson)).toBe(true);
    expect(JSON.parse(readFileSync(newJson, "utf8")).turns).toEqual([]);
    // The new pair wins the canonical scan from now on.
    const { resolveCanonicalConversation } = await import("../src/main/sessions.js");
    const canonical = await resolveCanonicalConversation(sessionsDirOf(courseId));
    expect(canonical.kind === "resumable" && canonical.sessionId).toBe(fresh.session.sessionId);
  });

  // Scenario: Fresh conversation is still refused while that conversation's
  // turn runs — navigating away is permitted, destroying the running
  // conversation is not (change add-background-course-sessions).
  it("is still refused while that conversation's turn runs (main-side guard, direct IPC call)", async () => {
    await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    h.sessions.get(opened.session.sessionId)!.inFlight = true;
    await expect(handlers.get("cbe:conversation:fresh")!(null)).rejects.toThrow(/still working/i);
    // The running session is untouched.
    expect(h.sessions.has(opened.session.sessionId)).toBe(true);
  });

  // Scenario: Previous session is closed with the dual-sidecar discipline
  // (desktop-app, Requirement: New Session Control With Canvas Carry-Over).
  it("closes the previous session with the dual-sidecar discipline before the fresh session starts", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "outgoing", "2026-07-07T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const fresh = (await handlers.get("cbe:conversation:fresh")!(null)) as { session: { sessionId: string } };
    // BOTH sidecars of the retired session are on disk — never MD-only or JSON-only.
    expect(existsSync(path.join(sessionsDirOf(courseId), "outgoing.md"))).toBe(true);
    expect(existsSync(path.join(sessionsDirOf(courseId), "outgoing.json"))).toBe(true);
    expect(fresh.session.sessionId).not.toBe("outgoing");
  });

  // Scenario: New Session clears the chat but keeps the canvas — main/harness
  // side (agent-harness, Requirement: Session-Start Canvas Artefact Injection):
  // the snapshot comes from the OUTGOING session's host-side mirror and reaches
  // the fresh start; the fresh session's result carries the kept canvas.
  it("carries the outgoing session's canvas-mirror snapshot into the fresh start (no renderer round-trip)", async () => {
    await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const artefacts = [
      { step: 6, phase: "engage", id: "big-idea", label: "Big Idea", value: "Quartier", state: "done" },
    ];
    h.sessions.get(opened.session.sessionId)!.canvasMirror.entries.push(...artefacts);

    const fresh = (await handlers.get("cbe:conversation:fresh")!(null)) as {
      session: { sessionId: string };
      turns: SessionTurn[];
      canvas: unknown[];
    };
    // The fresh start received EXACTLY the mirror snapshot…
    expect(h.startCalls[h.startCalls.length - 1]!.canvasArtefacts).toEqual(artefacts);
    // …the conversation is cleared, and the kept canvas rides back to the renderer.
    expect(fresh.turns).toEqual([]);
    expect(fresh.canvas).toEqual(artefacts);
  });

  // Scenario: Fresh-session start failure shows a recoverable error state —
  // main side: fixed notice, retired sidecars intact, retry re-uses the SAME
  // carried-over snapshot even though the outgoing session is already gone.
  it("fresh-start failure after the close yields the fixed notice; retry re-uses the same carry-over snapshot", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "outgoing", "2026-07-07T10:00:00.000Z");
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const artefacts = [{ step: 4, id: "challenge", label: "Challenge", value: "Massnahme entwickeln", state: "draft" }];
    h.sessions.get(opened.session.sessionId)!.canvasMirror.entries.push(...artefacts);

    h.failNextStart = true;
    await expect(handlers.get("cbe:conversation:fresh")!(null)).rejects.toThrow(/safely saved/i);
    // The outgoing session was closed and its sidecars persisted — nothing lost.
    expect(h.sessions.size).toBe(0);
    expect(existsSync(path.join(sessionsDirOf(courseId), "outgoing.md"))).toBe(true);
    expect(existsSync(path.join(sessionsDirOf(courseId), "outgoing.json"))).toBe(true);

    // Retry: no open session anymore, but the pending snapshot is re-used.
    const fresh = (await handlers.get("cbe:conversation:fresh")!(null)) as { canvas: unknown[] };
    expect(h.startCalls[h.startCalls.length - 1]!.canvasArtefacts).toEqual(artefacts);
    expect(fresh.canvas).toEqual(artefacts);
  });

  it("closeSession is refused while a turn is in flight (main-side guard)", async () => {
    await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    h.sessions.get(opened.session.sessionId)!.inFlight = true;
    await expect(handlers.get("cbe:close-session")!(null, opened.session.sessionId)).rejects.toThrow(/still working/i);
    h.sessions.get(opened.session.sessionId)!.inFlight = false;
    await expect(handlers.get("cbe:close-session")!(null, opened.session.sessionId)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("prompt handler — turn-boundary persistence", () => {
  useTempSpace();

  it("dual-writes both sidecars with the completed turn after a successful run", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(opened.session.sessionId)!;
    active.session.prompt = async () => {
      active.draft = "assistant reply";
    };
    await handlers.get("cbe:prompt")!(null, { sessionId: active.id, text: "user question" });
    const json = path.join(sessionsDirOf(courseId), `${active.id}.json`);
    // Wait for the flush containing BOTH turns, not merely for the minted empty
    // pair (fire-and-forget) — see `waitForTurns`.
    const turns = await waitForTurns(json, 2);
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "user question"],
      ["assistant", "assistant reply"],
    ]);
    // No temp files linger (atomic replace).
    expect(readdirSync(sessionsDirOf(courseId)).filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  // The turn-boundary flush is fire-and-forget (`void flushSession(…)`), and what
  // keeps that lawful is the per-session chain guard: `flushChains.set(id,
  // run.then(ok, log))` attaches a rejection handler to the SAME promise the
  // caller voids, so a failed background write is logged instead of surfacing as
  // an unhandled rejection — which, under Node's default
  // `--unhandled-rejections=throw`, would exit the main process. The trigger is
  // real: a background turn can finish into a folder the lecturer just sent to
  // the Trash. Drop the rejection handler from that chain and this test goes red
  // on both assertions.
  it("a turn-boundary flush that cannot write is logged, not left as an unhandled rejection", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(opened.session.sessionId)!;
    active.session.prompt = async () => {
      active.draft = "assistant reply";
    };

    // Make the sessions folder unwritable in the crudest reproducible way: put a
    // FILE where the directory was, so the flush's `mkdir(dir, {recursive:true})`
    // throws on its first await.
    const sessionsDir = sessionsDirOf(courseId);
    rmSync(sessionsDir, { recursive: true, force: true });
    writeFileSync(sessionsDir, "the course folder is gone", "utf8");

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0]));
    });
    try {
      await handlers.get("cbe:prompt")!(null, { sessionId: active.id, text: "user question" });
      // Node emits `unhandledRejection` at the end of the event-loop turn in
      // which the promise settled — this drains that turn, it is not a tolerance.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onRejection);
    }

    // The write really did fail — otherwise the assertion below proves nothing.
    expect(logged.some((line) => line.includes("[cbe:flush]"))).toBe(true);
    expect(rejections).toEqual([]);
  });

  it("error path: flush excludes the partial draft; a later close includes it", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(opened.session.sessionId)!;
    active.session.prompt = async () => {
      active.draft = "half a sent";
      throw new Error("provider died mid-stream");
    };
    await expect(handlers.get("cbe:prompt")!(null, { sessionId: active.id, text: "user question" })).rejects.toThrow(
      /mid-stream/
    );
    const json = path.join(sessionsDirOf(courseId), `${active.id}.json`);
    // Wait for the error-path flush: it must contain the user turn but NOT the torn draft.
    const turns = await waitForTurns(json, 1);
    expect(turns.map((t) => t.role)).toEqual(["user"]);
    // The closing flush persists the lecturer-visible partial text as the final turn.
    await handlers.get("cbe:close-session")!(null, active.id);
    const closed = JSON.parse(readFileSync(json, "utf8")).turns as SessionTurn[];
    expect(closed.map((t) => [t.role, t.text])).toEqual([
      ["user", "user question"],
      ["assistant", "half a sent"],
    ]);
  });

  // course-workspace spec, Scenario: Background turn output is persisted in its
  // own course (change add-background-course-sessions): the lecturer switches
  // away mid-turn; the turn completes in the background and the turn-boundary
  // flush writes both sidecars into the OUTGOING course's sessions folder.
  it("a turn completing in a background course dual-writes into that course's own sessions folder", async () => {
    const courseA = await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    const open = handlers.get("cbe:conversation:open")!;
    const openedA = (await open(null)) as { session: { sessionId: string } };
    const activeA = h.sessions.get(openedA.session.sessionId)!;

    // A long-running turn in course A: the prompt handler stays pending until
    // we release it — meanwhile the lecturer switches to course B.
    let finishTurn: () => void = () => {};
    activeA.session.prompt = async () => {
      activeA.draft = "background answer";
      await new Promise<void>((resolve) => (finishTurn = resolve));
    };
    const promptPromise = handlers.get("cbe:prompt")!(null, { sessionId: activeA.id, text: "long request" });
    await new Promise((r) => setTimeout(r, 10));

    // Course switch: activate B and open ITS conversation. Nothing closes A.
    const { createCourse, writeActiveCourseId } = await import("../src/main/courses.js");
    const courseB = await createCourse(h.root, "Kurs B");
    await writeActiveCourseId(h.statePath, courseB.id);
    const openedB = (await open(null)) as { session: { sessionId: string } };
    expect(h.sessions.get(openedB.session.sessionId)!.courseId).toBe(courseB.id);
    expect(h.sessions.has(activeA.id)).toBe(true); // A stayed open in the background

    // The background turn completes → turn-boundary flush.
    finishTurn();
    await promptPromise;

    const jsonA = path.join(sessionsDirOf(courseA), `${activeA.id}.json`);
    const turns = await waitForTurns(jsonA, 2);
    // Both sidecars land in COURSE A's folder, exactly as if it were visible.
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "long request"],
      ["assistant", "background answer"],
    ]);
    expect(existsSync(path.join(sessionsDirOf(courseA), `${activeA.id}.md`))).toBe(true);
    // Nothing of A's turn leaked into course B's folder.
    expect(existsSync(path.join(sessionsDirOf(courseB.id), `${activeA.id}.json`))).toBe(false);
  });

  it("persists the display projection only when it differs from the composed payload", async () => {
    const courseId = await seedCourse();
    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(opened.session.sessionId)!;
    active.session.prompt = async () => {
      active.draft = "ok";
    };
    // Case 1: display text equals the payload, no attachments → not persisted.
    await handlers.get("cbe:prompt")!(null, {
      sessionId: active.id,
      text: "plain question",
      display: { text: "plain question" },
    });
    expect(active.transcript[0]?.display).toBeUndefined();
    // Case 2: envelope payload with attachment chips → display persisted.
    await handlers.get("cbe:prompt")!(null, {
      sessionId: active.id,
      text: "instruction\n\n<<<envelope: full document body>>>",
      display: { text: "instruction", attachments: [{ filename: "syllabus.pdf", docType: "pdf" }] },
    });
    const userTurns = active.transcript.filter((t) => t.role === "user");
    expect(userTurns[1]?.display?.text).toBe("instruction");
    expect(userTurns[1]?.display?.attachments?.[0]?.filename).toBe("syllabus.pdf");
    // Payload stays lossless.
    expect(userTurns[1]?.text).toContain("envelope");
    // Wait for the SECOND turn pair to reach disk, not merely for the file to
    // exist: the fresh conversation was minted with a durable empty pair, so the
    // `.json` is already there and a bare existence check would leave this test's
    // turn-boundary flush still queued when the Space is removed.
    const json = path.join(sessionsDirOf(courseId), `${active.id}.json`);
    await waitForTurns(json, 4);
  });
});

/**
 * Decision-artefact persistence round-trip (change `isolate-decision-artefacts-per-course`).
 *
 * - desktop-app spec, Requirement: Decision Artefacts Are Per-Conversation State —
 *   Scenarios: Decision state survives a restart in its own course; An unreadable
 *   or absent sidecar decision state hydrates as empty.
 * - course-workspace spec, Requirement: Course-Scoped Isolation of Canvas, Step,
 *   Maturity and Decision State — Scenario: A course folder carries the state it
 *   presents.
 *
 * Runs against the REAL sessions.js, so the on-disk contract (atomic sidecar
 * rewrite, `isDidacticChecks` validation) is exercised end to end.
 */
describe("decision artefacts round-trip through the course's own sidecar", () => {
  useTempSpace();

  const CHECKS: DidacticChecks = {
    kompetenz: {
      status: "completed",
      goals: [{ id: "g1", text: "Persisted goal", sharpness: "sharp" }],
    },
    alignment: { status: "completed", findings: [{ goalId: "g1", status: "aligned" }] },
    delegation: { status: "not-started", decisions: [] },
  };

  // Scenario: Decision state survives a restart in its own course
  it("resumes the decision state from the course's canonical sidecar", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);

    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as {
      didacticChecks?: DidacticChecks;
    };

    expect(opened.didacticChecks).toEqual(CHECKS);
    // …and the live session carries it, so later flushes can write it back.
    expect(h.sessions.get("sess-checks")!.didacticChecks).toEqual(CHECKS);
  });

  // Scenario: Decision state survives a restart in its own course (write side).
  // Regression guard for the data-loss bug this change fixes: the flush used to
  // call writeSessionJson WITHOUT the field, and because the write replaces the
  // file atomically, the first turn boundary after a resume destroyed the state.
  it("a turn-boundary flush rewrites the decision state instead of dropping it", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);

    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("sess-checks")!;
    active.session.prompt = async () => {
      active.transcript.push({ role: "assistant", text: "answer" });
    };
    await handlers.get("cbe:prompt")!(null, { sessionId: active.id, text: "next question" });

    const json = path.join(sessionsDirOf(courseA), "sess-checks.json");
    // The rewritten pair, not merely the resumed one — see `waitForTurns`.
    await waitForTurns(json, 3);
    expect(JSON.parse(readFileSync(json, "utf8")).didacticChecks).toEqual(CHECKS);
  });

  // Scenario: A re-attached open session still reports its decision state
  it("re-attaching to the open session reports its decision state", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);

    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    // Second open with the session still held by main: branch 1 (re-attach) —
    // this is what a renderer reload takes.
    const reattached = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
    };

    expect(reattached.session.sessionId).toBe("sess-checks");
    expect(h.startCalls).toHaveLength(1);
    expect(reattached.didacticChecks).toEqual(CHECKS);
  });

  // Scenario: A New Session reset retains the decision artefacts
  it("a New Session carries the decision artefacts onto the fresh conversation", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);

    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const fresh = (await handlers.get("cbe:conversation:fresh")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
    };

    expect(fresh.session.sessionId).not.toBe("sess-checks");
    expect(fresh.didacticChecks).toEqual(CHECKS);
    expect(h.sessions.get(fresh.session.sessionId)!.didacticChecks).toEqual(CHECKS);
    // …and the fresh pair on disk carries them, so a later restart resumes them.
    const freshJson = path.join(sessionsDirOf(courseA), `${fresh.session.sessionId}.json`);
    await waitForFile(freshJson);
    expect(JSON.parse(readFileSync(freshJson, "utf8")).didacticChecks).toEqual(CHECKS);
  });

  // Scenario: A New Session reset retains the decision artefacts (retry half)
  it("a retry after a failed fresh start carries the same decision artefacts", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);

    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    h.failNextStart = true;
    await expect(handlers.get("cbe:conversation:fresh")!(null)).rejects.toThrow();
    // The outgoing session is gone — the retry must still carry its artefacts.
    const retried = (await handlers.get("cbe:conversation:fresh")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
    };

    expect(retried.didacticChecks).toEqual(CHECKS);
  });

  // Scenario: A New Session reset retains the decision artefacts (the retry
  // snapshot is per course and follows the OUTGOING session — a parked snapshot
  // from an earlier unretried failure must not resurface later).
  it("a New Session from a session without decision state clears the parked snapshot", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);

    // A failed fresh start parks the outgoing session's decisions for the retry.
    h.failNextStart = true;
    await expect(handlers.get("cbe:conversation:fresh")!(null)).rejects.toThrow();

    // The course's stored conversations are removed out of band, so the next open
    // starts a conversation that carries NO decision state.
    rmSync(sessionsDirOf(courseA), { recursive: true, force: true });
    const plain = (await handlers.get("cbe:conversation:open")!(null)) as {
      didacticChecks?: DidacticChecks;
    };
    expect(plain.didacticChecks).toBeUndefined();

    // A New Session from that decision-less session overwrites the parked entry…
    h.failNextStart = true;
    await expect(handlers.get("cbe:conversation:fresh")!(null)).rejects.toThrow();
    // …so the retry does not resurrect the decisions of a session that is gone.
    const retried = (await handlers.get("cbe:conversation:fresh")!(null)) as {
      didacticChecks?: DidacticChecks;
    };
    expect(retried.didacticChecks).toBeUndefined();
  });

  // Scenario: A sidecar without decision state hydrates as empty
  it("a sidecar without decision state opens with none, and none is invented", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-plain", "2026-08-01T10:00:00.000Z");

    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as {
      didacticChecks?: DidacticChecks;
    };

    expect(opened.didacticChecks).toBeUndefined();
    expect(h.sessions.get("sess-plain")!.didacticChecks).toBeUndefined();
  });

  // Scenario: A malformed decision payload is rejected rather than partially
  // adopted — the sidecar validator rejects the WHOLE pair, so the conversation
  // is not resumed at all: a fresh one starts with the unreadable-archive notice
  // and the files stay on disk.
  it("a malformed decision payload is rejected rather than partially adopted", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-bad", "2026-08-01T10:00:00.000Z");
    const json = path.join(sessionsDirOf(courseA), "sess-bad.json");
    const payload = JSON.parse(readFileSync(json, "utf8"));
    payload.didacticChecks = { kompetenz: "not-an-object" };
    writeFileSync(json, JSON.stringify(payload, null, 2) + "\n");

    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
      notice?: string;
    };

    // The whole pair is rejected: no resume, a FRESH conversation with the
    // unreadable-archive notice, and the rejected files stay on disk.
    expect(opened.session.sessionId).not.toBe("sess-bad");
    expect(opened.notice).toMatch(/could not be read/);
    expect(opened.didacticChecks).toBeUndefined();
    expect(existsSync(json)).toBe(true);
  });

  // Scenario: A course folder carries the state it presents (removal half)
  it("a removed course folder leaves no residual decision state behind", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);
    // The lecturer deletes the course's stored conversations (folder handover /
    // deletion is a documented course-workspace operation).
    rmSync(sessionsDirOf(courseA), { recursive: true, force: true });

    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
    };

    // A fresh conversation starts; nothing of the removed state is resurrected.
    expect(opened.session.sessionId).not.toBe("sess-checks");
    expect(opened.didacticChecks).toBeUndefined();
    expect(h.sessions.get(opened.session.sessionId)!.didacticChecks).toBeUndefined();
  });

  // Scenario: A course folder carries the state it presents
  it("one course's decision state never reaches another course's folder", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "sess-checks", "2026-08-01T10:00:00.000Z", undefined, undefined, CHECKS);
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);

    // Switch to a second course and open ITS conversation (fresh, no sidecar).
    const { createCourse, writeActiveCourseId } = await import("../src/main/courses.js");
    const courseB = await createCourse(h.root, "Kurs B");
    await writeActiveCourseId(h.statePath, courseB.id);
    const openedB = (await handlers.get("cbe:conversation:open")!(null)) as {
      session: { sessionId: string };
      didacticChecks?: DidacticChecks;
    };

    expect(openedB.didacticChecks).toBeUndefined();
    expect(h.sessions.get(openedB.session.sessionId)!.didacticChecks).toBeUndefined();

    // Flush course B and assert its folder never gained A's decisions.
    const activeB = h.sessions.get(openedB.session.sessionId)!;
    activeB.session.prompt = async () => {
      activeB.transcript.push({ role: "assistant", text: "b answer" });
    };
    await handlers.get("cbe:prompt")!(null, { sessionId: activeB.id, text: "hello B" });
    const jsonB = path.join(sessionsDirOf(courseB.id), `${activeB.id}.json`);
    // The turn pair, not merely the minted empty pair — see `waitForTurns`.
    await waitForTurns(jsonB, 2);
    expect(JSON.parse(readFileSync(jsonB, "utf8")).didacticChecks).toBeUndefined();
  });
});

/**
 * Deterministic design-document export — the host-side half (change
 * `harden-canvas-determinism-and-ux2-fixes`, tasks B4.4/B4.5).
 *
 * capability `course-workspace`, Requirement: Deterministic Design-Document Export from
 * Host State — Scenarios: *The export defaults to the active course folder*; *A failed
 * export surfaces readably and changes nothing*.
 *
 * The document BUILDER is unit-tested in pi-bridge; what is exercised here is the IPC
 * handler: where it offers to write, what it refuses, and what it leaves behind on a
 * failure.
 */
describe("design-document export from host state", () => {
  useTempSpace();

  /** Open a conversation and give its canvas mirror one filled artefact. */
  async function openWithArtefact(handlers: Map<string, Handler>) {
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as { session: { sessionId: string } };
    const active = h.sessions.get(opened.session.sessionId)!;
    active.canvasMirror.entries.push({
      step: 4,
      id: "bigidea",
      label: "Big Idea",
      value: "Git in the times of AI",
      state: "draft",
    });
    return active;
  }

  // Scenario: The export defaults to the active course folder
  it("offers the active course folder and a derived filename", async () => {
    const courseId = await seedCourse("Git in the times of AI");
    const handlers = await bootHandlers();
    await openWithArtefact(handlers);
    const { dialog } = await import("electron");
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true });

    await handlers.get("cbe:export:design-document")!(null);

    const opts = (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(opts.defaultPath).toContain(path.join(h.root, courseId));
    expect(opts.defaultPath).toContain("git-in-the-times-of-ai-module-design.md");
  });

  it("writes the document to the chosen path and returns it", async () => {
    await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    await openWithArtefact(handlers);
    const target = path.join(tempDir, "chosen.md");
    const { dialog } = await import("electron");
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: false, filePath: target });

    const res = (await handlers.get("cbe:export:design-document")!(null)) as { path: string };

    expect(res.path).toBe(target);
    const md = readFileSync(target, "utf8");
    expect(md).toContain("Git in the times of AI");
    expect(md).toContain("## Step 4 —");
  });

  it("returns null when the lecturer cancels, writing nothing", async () => {
    await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    await openWithArtefact(handlers);
    const { dialog } = await import("electron");
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: true });

    const res = await handlers.get("cbe:export:design-document")!(null);

    expect(res).toBeNull();
    // Nothing was written at the path the dialog offered.
    const { dialog: d } = await import("electron");
    const offered = (d.showSaveDialog as ReturnType<typeof vi.fn>).mock.calls[0]![1].defaultPath as string;
    expect(existsSync(offered)).toBe(false);
  });

  it("refuses a path inside the application bundle", async () => {
    await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    await openWithArtefact(handlers);
    const { dialog } = await import("electron");
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
      canceled: false,
      filePath: "/opt/cbe-app/resources/design.md",
    });

    await expect(handlers.get("cbe:export:design-document")!(null)).rejects.toThrow(/inside the application/i);
  });

  it("refuses when nothing carries a value yet", async () => {
    await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null); // no artefact pushed

    await expect(handlers.get("cbe:export:design-document")!(null)).rejects.toThrow(/nothing to export/i);
  });

  // Scenario: A failed export surfaces readably and changes nothing
  it("surfaces a readable error and leaves an existing file untouched", async () => {
    await seedCourse("Kurs A");
    const handlers = await bootHandlers();
    await openWithArtefact(handlers);
    // A directory that does not exist makes the atomic write fail.
    const target = path.join(tempDir, "no-such-dir", "design.md");
    const existing = path.join(tempDir, "keep.md");
    writeFileSync(existing, "untouched", "utf8");
    const { dialog } = await import("electron");
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: false, filePath: target });

    await expect(handlers.get("cbe:export:design-document")!(null)).rejects.toThrow(/could not be written/i);

    // No partial file, and an unrelated existing file is unchanged.
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe("untouched");
  });
});
