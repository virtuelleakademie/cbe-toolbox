/**
 * The lecturer stop at the HOST SEAM (capability `agent-harness`, Requirement:
 * *A Lecturer Can Stop a Running Turn*, plus the two requirements its deltas
 * modify).
 *
 * The controller's own state machine is covered in
 * `packages/pi-bridge/tests/turn-stop.test.ts`. What only this seam can show is
 * everything between the runtime's events and the host's surfaces:
 *
 *   - exactly one run end reaches the renderer for a stopped run;
 *   - the abort's own stream error is not classified as a provider failure;
 *   - a lecturer stop and the loop breaker's abort stay distinguishable, and
 *     racing them still yields one run end and one recovery;
 *   - NO detector verdict is issued from ANY event of a stopped run — including
 *     the error results the abort manufactures for a half-started tool batch;
 *   - the stopped turn is retained, marked, and persisted into BOTH sidecars as
 *     a COMPLETED turn.
 *
 * Scaffolding follows `conversation-open.test.ts`: a real temp course, a real
 * persisted config, a mocked `AgentManager` whose fake session captures the
 * event subscription, and the REAL `sessions.js` writers so the sidecars can be
 * read back off disk. The stop controller, the loop detector and the truncation
 * detector are all the REAL ones — the doubles are the plumbing, never the logic
 * under test.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TurnStopController } from "@cbe/pi-bridge/turn-stop";
import type { CbeRuntimeEvent } from "@cbe/pi-bridge/runtime";
import { promotedDraftTurn } from "../src/shared/turn-stop.js";
import { en } from "../src/shared/i18n/en.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

interface FakeTurn {
  role: "user" | "assistant";
  text: string;
  stopped?: boolean;
  display?: { text: string };
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
    id: `sess-stop-${++h.seq}`,
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
      // The REAL promotion (`promotedDraftTurn`), exactly as `AgentManager.dump`
      // uses it — the double is the session plumbing, never the rule under test.
      if (s.draft) {
        s.transcript.push(promotedDraftTurn(s.draft, s.turnStop.stoppedForCurrentRun()));
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
  const course = await createCourse(h.root, `Stopkurs ${h.seq + 1}`);
  await writeActiveCourseId(h.statePath, course.id);
  await handlers.get("cbe:conversation:open")!(null);
  sent.length = 0;
  return h.active!;
}

const prompt = (text = "Erklär mir Schritt 4.") =>
  handlers.get("cbe:prompt")!(null, { sessionId: h.active!.id, text }) as Promise<unknown>;
const stop = (sessionId?: string) =>
  handlers.get("cbe:prompt:abort")!(null, { sessionId: sessionId ?? h.active!.id }) as Promise<{
    status: string;
    reason?: string;
  }>;

function emit(a: FakeActive, event: CbeRuntimeEvent): void {
  a.emit?.(event);
}

function assistantMessageEnd(text: string, stopReason: string): CbeRuntimeEvent {
  return { type: "message_end", message: { role: "assistant", stopReason, text, toolCallCount: 0 } };
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
  tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-turn-stop-"));
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

describe("Scenario: A lecturer stop aborts the run and the host observes one run end", () => {
  it("aborts through the runtime, forwards exactly one agent_end, and keeps the session usable", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      expect(a.aborts).toBe(1);
      emit(a, { type: "agent_end", aborted: false });
      await expect(stopping).resolves.toEqual({ status: "stopped" });
    });

    expect(sent.filter((e) => e.type === "agent_end")).toHaveLength(1);
    // A stop is not a session close: the next prompt is accepted and answered.
    a.session.prompt.mockResolvedValue(undefined);
    await expect(prompt("Weiter.")).resolves.toEqual({ ok: true });
  });

  it("announces the stop BEFORE the run's end, so the turn can be marked rather than corrected", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      expect(sent.map((e) => e.type)).toContain("turn_stopped");
      expect(sent.map((e) => e.type)).not.toContain("agent_end");
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });
    const types = sent.map((e) => e.type);
    expect(types.indexOf("turn_stopped")).toBeLessThan(types.indexOf("agent_end"));
  });

  it("clears the pending steering and follow-up queues at the stop", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      expect(a.queueClears).toBe(1);
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });
  });
});

describe("Scenario: A stopped run does not surface as a provider error", () => {
  it("suppresses the abort's own stream error and the aborted message_end", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      emit(a, { type: "stream_error", reason: "aborted", errorMessage: "aborted" });
      emit(a, {
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "aborted", text: "", toolCallCount: 0 },
      });
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });
    expect(sent.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("still surfaces a GENUINE provider error on an unstopped run", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "stream_error", reason: "error", errorMessage: "429 rate limited" });
      emit(a, { type: "agent_end", aborted: false });
    });
    expect(sent.filter((e) => e.type === "error")).toHaveLength(1);
  });
});

describe("Scenario: A split terminal control marker never enters app-owned assistant text", () => {
  it("cleans renderer events and both sidecars without model-id branching or raw-event mutation", async () => {
    const a = await boot();
    expect(a.modelId).toBe("test-model"); // deliberately not the model that exposed the defect

    const rawEnd = assistantMessageEnd("Eine ganze Antwort.<turn|>", "stop");
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "message_start" });
      emit(a, { type: "text_delta", delta: "Eine ganze Antwort.<tu" });
      emit(a, { type: "text_delta", delta: "rn|>" });
      emit(a, rawEnd);
      emit(a, { type: "agent_end", aborted: false });
    });

    const rendererText = sent
      .filter((event) => event.type === "text_delta")
      .map((event) => (event.data as { delta: string }).delta)
      .join("");
    expect(rendererText).toBe("Eine ganze Antwort.");
    expect(JSON.stringify(sent)).not.toContain("<turn|>");
    expect(sent.filter((event) => typeof event.type === "string" && event.type.startsWith("thinking_"))).toHaveLength(
      0
    );
    // The host consumed a copy. The runtime event itself is not mutated: it
    // remains evidence of what the provider sent.
    expect(JSON.stringify(rawEnd)).toContain("<turn|>");

    const jsonPath = path.join(a.sessionsDir, `${a.id}.json`);
    const mdPath = path.join(a.sessionsDir, `${a.id}.md`);
    for (let i = 0; i < 100; i++) {
      if (existsSync(jsonPath) && readFileSync(jsonPath, "utf8").includes("Eine ganze Antwort.")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { turns: FakeTurn[] };
    expect(json.turns.find((turn) => turn.role === "assistant")?.text).toBe("Eine ganze Antwort.");
    expect(readFileSync(mdPath, "utf8")).not.toContain("<turn|>");
  });

  it("uses agent_end as a safe fallback when message_end is absent", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "text_delta", delta: "Fallback.<turn|>" });
      emit(a, { type: "agent_end", aborted: false });
    });

    const rendererText = sent
      .filter((event) => event.type === "text_delta")
      .map((event) => (event.data as { delta: string }).delta)
      .join("");
    expect(rendererText).toBe("Fallback.");
    expect(a.transcript.find((turn) => turn.role === "assistant")?.text).toBe("Fallback.");
  });
});

describe("Scenario: Partial content is retained and recorded as stopped", () => {
  it("keeps the streamed text as the run's assistant turn, marked and COMPLETED", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "text_delta", delta: "Schritt 4 beginnt " });
      emit(a, { type: "text_delta", delta: "mit der Challenge" });
      const stopping = stop();
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    const assistant = a.transcript.filter((t) => t.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe("Schritt 4 beginnt mit der Challenge");
    expect(assistant[0]!.stopped).toBe(true);
    // Promoted, not left as a draft — which is what keeps the turn-boundary
    // "completed turns only" guarantee intact with no exception for a stop.
    expect(a.draft).toBe("");
  });
});

describe("Scenario: A stop with nothing streamed still leaves a continuable history", () => {
  it("appends the neutral synthetic message, distinct from the loop-abort note", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    const last = a.transcript[a.transcript.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.text).toBe(en.chatStoppedTurnPlaceholder);
    expect(last.stopped).toBe(true);
    expect(last.text).not.toBe(en.errorLoopAbortNote);

    // The history ends on a completed assistant turn, so the next prompt is
    // accepted rather than rejected as continuing from an assistant message.
    a.session.prompt.mockResolvedValue(undefined);
    await expect(prompt("Weiter.")).resolves.toEqual({ ok: true });
  });
});

describe("Scenario: A stopped turn persists as a completed turn carrying its marker", () => {
  it("writes the marker into the JSON sidecar and notes it in the Markdown archive", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "text_delta", delta: "Ein halber Satz" });
      const stopping = stop();
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    // The turn-boundary flush is fire-and-forget, and an EMPTY pair already
    // exists from the conversation's mint — so wait for the content, never for
    // the file (waiting for the file would read the empty pair and pass by
    // accident on an unwritten marker).
    const jsonPath = path.join(a.sessionsDir, `${a.id}.json`);
    const mdPath = path.join(a.sessionsDir, `${a.id}.md`);
    for (let i = 0; i < 150; i++) {
      if (existsSync(jsonPath) && readFileSync(jsonPath, "utf8").includes("Ein halber Satz")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { turns: FakeTurn[] };
    const persisted = json.turns.filter((t) => t.role === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.text).toBe("Ein halber Satz");
    expect(persisted[0]!.stopped).toBe(true);
    expect(readFileSync(mdPath, "utf8")).toContain(en.exportStoppedTurnNote);
  });

  it("an unstopped turn persists with no marker at all", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "text_delta", delta: "Eine ganze Antwort." });
      emit(a, assistantMessageEnd("Eine ganze Antwort.", "stop"));
      emit(a, { type: "agent_end", aborted: false });
    });

    const jsonPath = path.join(a.sessionsDir, `${a.id}.json`);
    for (let i = 0; i < 100; i++) {
      if (existsSync(jsonPath) && readFileSync(jsonPath, "utf8").includes("Eine ganze Antwort.")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { turns: FakeTurn[] };
    expect(json.turns.find((t) => t.role === "assistant")!.stopped).toBeUndefined();
    expect(readFileSync(path.join(a.sessionsDir, `${a.id}.md`), "utf8")).not.toContain(en.exportStoppedTurnNote);
  });
});

describe("Scenario: A closing flush over an unreleased stop keeps the marker", () => {
  it("persists the partial answer as stopped in both sidecars on the force-close", async () => {
    const a = await boot();
    let release!: () => void;
    a.session.prompt.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const running = prompt();
    await new Promise((r) => setTimeout(r, 0));
    emit(a, { type: "agent_start" });
    emit(a, { type: "text_delta", delta: "Halb geschrieben" });

    // The runtime never releases this run: the stop times out, which is exactly
    // the state the force-close recovery exists for.
    await expect(stop()).resolves.toEqual({ status: "timed-out" });

    const jsonPath = path.join(a.sessionsDir, `${a.id}.json`);
    const mdPath = path.join(a.sessionsDir, `${a.id}.md`);
    await handlers.get("cbe:conversation:fresh")!(null, { force: true });

    // The closing flush is awaited inside the handler, so the sidecars are
    // written by the time it returns. The draft is promoted — nothing the
    // lecturer watched arrive is lost — but NOT as a complete turn.
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { turns: FakeTurn[] };
    const persisted = json.turns.filter((t) => t.role === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.text).toBe("Halb geschrieben");
    expect(persisted[0]!.stopped).toBe(true);
    expect(readFileSync(mdPath, "utf8")).toContain(en.exportStoppedTurnNote);

    release();
    await running;
  });

  it("a closing flush over an ORDINARY run promotes its draft unmarked", async () => {
    const a = await boot();
    let release!: () => void;
    a.session.prompt.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const running = prompt();
    await new Promise((r) => setTimeout(r, 0));
    emit(a, { type: "agent_start" });
    emit(a, { type: "text_delta", delta: "Noch am Schreiben" });

    const jsonPath = path.join(a.sessionsDir, `${a.id}.json`);
    const mdPath = path.join(a.sessionsDir, `${a.id}.md`);
    await handlers.get("cbe:conversation:fresh")!(null, { force: true });

    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { turns: FakeTurn[] };
    const persisted = json.turns.filter((t) => t.role === "assistant");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.stopped).toBeUndefined();
    expect(readFileSync(mdPath, "utf8")).not.toContain(en.exportStoppedTurnNote);

    release();
    await running;
  });
});

describe("Scenario: A lecturer stop and a loop-breaker abort stay distinguishable", () => {
  it("a loop-broken run keeps the neutral note, carries no marker, and is never announced as a stop", async () => {
    const a = await boot();
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      runawayToolLoop(a, "loop");
      emit(a, { type: "agent_end", aborted: false });
    });

    const notes = a.transcript.filter((t) => t.text === en.errorLoopAbortNote);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.stopped).toBeUndefined();
    expect(sent.filter((e) => e.type === "turn_stopped")).toHaveLength(0);
  });
});

describe("Scenario: A stop racing the loop breaker still ends the run once", () => {
  it("the lecturer's stop owns the recovery: no second abort and no second note", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      const abortsAfterStop = a.aborts;
      runawayToolLoop(a, "race");
      expect(a.aborts).toBe(abortsAfterStop);
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    expect(a.transcript.filter((t) => t.text === en.errorLoopAbortNote)).toHaveLength(0);
    expect(sent.filter((e) => e.type === "agent_end")).toHaveLength(1);
    expect(a.aborts).toBe(1);
  });

  it("a stop AFTER the loop breaker took effect is a no-op that leaves its note standing", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      runawayToolLoop(a, "first");
      const abortsAfterLoop = a.aborts;
      await expect(stop()).resolves.toEqual({ status: "superseded" });
      expect(a.aborts).toBe(abortsAfterLoop);
      emit(a, { type: "agent_end", aborted: false });
    });

    expect(a.transcript.filter((t) => t.text === en.errorLoopAbortNote)).toHaveLength(1);
    expect(a.transcript.some((t) => t.stopped === true)).toBe(false);
  });
});

describe("Scenario: Neither detector issues a verdict from a stopped run", () => {
  it("no steer, no second abort, no error and no cut-off from a stopped run's events", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      // The abort manufactures an error result for every not-yet-started call
      // in the batch — enough repeated failure to reach the loop threshold.
      runawayToolLoop(a, "manufactured");
      // …and the final message looks exactly like a truncation.
      emit(a, assistantMessageEnd("mid-sen", "length"));
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });

    expect(a.steers).toHaveLength(0);
    expect(a.aborts).toBe(1);
    expect(sent.filter((e) => e.type === "error")).toHaveLength(0);
    expect(sent.filter((e) => e.type === "truncation_cutoff")).toHaveLength(0);
  });

  it("both detectors reset at the stopped run's boundary, exactly as at any other", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      runawayToolLoop(a, "leak");
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });
    const abortsAfterRunOne = a.aborts;

    // A clean next run: nothing may have leaked across the boundary.
    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, { type: "tool_execution_start", toolCallId: "b0", toolName: "read", args: { path: "x.md" } });
      emit(a, { type: "tool_execution_end", toolCallId: "b0", toolName: "read", result: {}, isError: true });
      emit(a, assistantMessageEnd("Eine vollstaendige Antwort.", "stop"));
      emit(a, { type: "agent_end", aborted: false });
    });

    expect(a.aborts).toBe(abortsAfterRunOne);
    expect(a.transcript.some((t) => t.text === en.errorLoopAbortNote)).toBe(false);
  });
});

describe("Scenario: A lecturer-stopped run is not remediated as a truncation", () => {
  it("issues no verdict for the stopped run, while a genuine truncation elsewhere still is", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      const stopping = stop();
      emit(a, assistantMessageEnd("Der Ansatz ist", "length"));
      emit(a, { type: "agent_end", aborted: false });
      await stopping;
    });
    expect(a.steers).toHaveLength(0);
    expect(sent.filter((e) => e.type === "truncation_cutoff")).toHaveLength(0);

    await turn(a, () => {
      emit(a, { type: "agent_start" });
      emit(a, assistantMessageEnd("Der Ansatz ist", "length"));
      emit(a, { type: "agent_end", aborted: false });
    });
    expect(a.steers.length + sent.filter((e) => e.type === "truncation_cutoff").length).toBeGreaterThan(0);
  });
});

describe("Scenario: A stop with no run in flight, or an unknown session, is a silent no-op", () => {
  it("reports nothing-running for an unknown session id, without throwing", async () => {
    await boot();
    await expect(stop("no-such-session")).resolves.toEqual({ status: "not-running" });
    await expect(handlers.get("cbe:prompt:abort")!(null, {})).resolves.toEqual({ status: "not-running" });
  });

  it("reports nothing-running for a held session with no turn dispatched", async () => {
    const a = await boot();
    await expect(stop()).resolves.toEqual({ status: "not-running" });
    expect(a.aborts).toBe(0);
  });
});

describe("Scenario: A stop during the compaction companion sequence is refused", () => {
  it("refuses with its classification, aborts nothing, and fabricates no run end", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      a.compacting = true;
      await expect(stop()).resolves.toEqual({ status: "refused", reason: "compaction" });
      expect(a.aborts).toBe(0);
      a.compacting = false;
      emit(a, { type: "agent_end", aborted: false });
    });
    expect(sent.filter((e) => e.type === "agent_end")).toHaveLength(1);
    expect(sent.filter((e) => e.type === "turn_stopped")).toHaveLength(0);
  });
});

describe("Scenario: A stop that never completes times out and is classified without leaking detail", () => {
  it("reports the timed-out classification and does not report the run as ended", async () => {
    const a = await boot();
    await turn(a, async () => {
      emit(a, { type: "agent_start" });
      // No `agent_end` — a stream that ignores the abort.
      const outcome = await stop();
      expect(outcome).toEqual({ status: "timed-out" });
      expect(JSON.stringify(outcome)).not.toMatch(/https?:|localhost/);
      expect(sent.filter((e) => e.type === "agent_end")).toHaveLength(0);
      emit(a, { type: "agent_end", aborted: false });
    });
  });
});

describe("Scenario: A stop before the run starts latches instead of being ignored", () => {
  it("aborts the run as soon as it starts, and the turn comes out marked", async () => {
    const a = await boot();
    await turn(a, async () => {
      // Dispatched, not yet started: no `agent_start` has been emitted.
      const stopping = stop();
      await new Promise((r) => setTimeout(r, 0));
      expect(a.aborts).toBe(0);

      emit(a, { type: "agent_start" });
      expect(a.aborts).toBe(1);
      emit(a, { type: "agent_end", aborted: false });
      await expect(stopping).resolves.toEqual({ status: "stopped" });
    });

    expect(a.transcript[a.transcript.length - 1]!.stopped).toBe(true);
    // Announced again once the run exists, so a surface that resets its per-run
    // state at `agent_start` still marks the turn.
    const types = sent.map((e) => e.type);
    expect(types.lastIndexOf("turn_stopped")).toBeGreaterThan(types.indexOf("agent_start"));
  });
});
