/**
 * App-side round trip of the course design-state store (change
 * `carry-over-all-state-per-course`):
 *
 * - capability `agent-harness`, Requirement: Course Design-State Store —
 *   Scenarios: the four states come back after an app restart; a course with no
 *   record opens empty rather than inheriting; write-through happens at the turn
 *   boundary, not only at close; a malformed record is treated as absent;
 *   carry-over materialises nothing that was never established.
 *
 * The mirror contract itself is covered in `packages/pi-bridge/tests/course-design-state.test.ts`.
 * What is exercised here is the path the pi-bridge tests cannot reach: the host
 * mirrors → `writeSessionJson` sidecar → app restart → `readSessionJson` +
 * `sanitizeDesignState` → `restoreCourseDesignState` → the hydration payload the
 * renderer receives.
 *
 * Harness pattern mirrors `conversation-open.test.ts`: electron + agent.js are
 * mocked, sessions.js and courses.js run REAL against a temp Space. Unlike that
 * file, the fake sessions carry the REAL `CanvasMirror` / `StepMirror` /
 * `MaturityMirror` from pi-bridge, so restore, validation and focus exclusivity
 * are the production implementations rather than test doubles.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CanvasMirror,
  StepMirror,
  MaturityMirror,
  ContextOccupancyTracker,
  type CanvasArtefactEntry,
  type MaturitySnapshot,
  type StepCoverageEntry,
} from "@cbe/pi-bridge";
import type { SessionTurn } from "../src/main/sessions.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

let tempDir: string;

const h = vi.hoisted(() => ({
  root: "",
  statePath: "",
  sessions: new Map<string, FakeActive>(),
  startCalls: [] as Array<{ resumeId?: string }>,
  seq: 0,
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
  canvasMirror: CanvasMirror;
  stepMirror: StepMirror;
  maturityMirror: MaturityMirror;
  pendingAnswerGate: { reset: () => void };
  /** The REAL occupancy tracker: the hydration snapshot reads it (Requirement:
   * Context Occupancy Reported to the Host). */
  contextOccupancy: ContextOccupancyTracker;
  inFlight: boolean;
  pendingProfileNotes: string[];
  session: { subscribe: (cb: unknown) => void; dispose: () => void; prompt: (text: string) => Promise<void> };
}

function makeFakeActive(
  courseId: string,
  sessionsDir: string,
  resume?: { sessionId: string; createdAt: string; turns: SessionTurn[] }
): FakeActive {
  return {
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
    // A freshly started session's mirrors are EMPTY — everything the course gets
    // back must come from the record restore, never from the session doubles.
    canvasMirror: new CanvasMirror(),
    stepMirror: new StepMirror(),
    maturityMirror: new MaturityMirror(),
    pendingAnswerGate: { reset: () => {} },
    contextOccupancy: new ContextOccupancyTracker(),
    inFlight: false,
    pendingProfileNotes: [],
    // `wireSessionEvents` registers its stop observer on this (capability
    // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*).
    turnStop: fakeTurnStop({ inFlight: false }),
    session: { subscribe: () => {}, dispose: vi.fn(), prompt: async () => {} },
  };
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

// Delegate to the REAL pi-bridge (mirrors, guards, design-document builder); only
// the provider/corpus-touching entry points are stubbed.
vi.mock("@cbe/pi-bridge", async (importOriginal) => ({
  // The occupancy tracker and its change check are pure; the hydration snapshot
  // must exercise the REAL ones.
  ContextOccupancyTracker: ((await importOriginal()) as { ContextOccupancyTracker: unknown }).ContextOccupancyTracker,
  occupancyChanged: ((await importOriginal()) as { occupancyChanged: unknown }).occupancyChanged,
  ...((await importOriginal()) as Record<string, unknown>),
  createCitationResolver: vi.fn(async () => ({ listIds: () => [] })),
  createPiAtomizationSessionFactory: vi.fn(),
  readWikiSkillVersion: vi.fn(),
  runAtomization: vi.fn(),
  ToolLoopDetector: class {
    reset() {}
    record() {
      return { action: "none" };
    }
  },
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
  /** Mirrors `designStateOf` in src/main/agent.ts: every flush carries all of it.
   * Production reads `stepMirror.recordedList()` there, so that the host's initial
   * step-focus seed is never persisted; this double is never seeded, which is why
   * the two agree. The seed's own persistence contract is covered against the real
   * `AgentManager` in `initial-step-focus-host.test.ts`. */
  function designStateOf(s: FakeActive) {
    const canvas = s.canvasMirror.list();
    const steps = s.stepMirror.recordedList();
    const maturity = s.maturityMirror.snapshot();
    return {
      ...(canvas.length > 0 ? { canvas } : {}),
      ...(steps.length > 0 ? { steps } : {}),
      ...(Object.keys(maturity).length > 0 ? { maturity } : {}),
    };
  }
  class AgentManager {
    async start(
      _cfg: unknown,
      course?: { id: string; sessionsDir: string },
      resume?: { sessionId: string; createdAt: string; turns: SessionTurn[] }
    ): Promise<FakeActive> {
      h.startCalls.push({ resumeId: resume?.sessionId });
      const active = makeFakeActive(
        course?.id ?? "",
        course?.sessionsDir ?? path.join(h.root, "..", "sessions"),
        resume
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
      const s = h.sessions.get(id);
      if (!s) return null;
      return { meta: this.metaOf(s), turns: [...s.transcript], sessionsDir: s.sessionsDir, ...designStateOf(s) };
    }
    dump(id: string) {
      const s = h.sessions.get(id);
      if (!s) return null;
      if (s.draft) {
        s.transcript.push({ role: "assistant", text: s.draft });
        s.draft = "";
      }
      return { meta: this.metaOf(s), turns: [...s.transcript], sessionsDir: s.sessionsDir, ...designStateOf(s) };
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
    close(id: string) {
      h.sessions.get(id)?.session.dispose();
      h.sessions.delete(id);
    }
    closeAll() {
      h.sessions.clear();
    }
    setInFlight(id: string, inFlight: boolean) {
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

interface OpenResult {
  session: { sessionId: string };
  canvas: CanvasArtefactEntry[];
  steps?: StepCoverageEntry[];
  maturity?: MaturitySnapshot;
  notice?: string;
}

/** Boot the main process: fresh ipc.js module registry, fresh handler table. */
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

/**
 * Simulate an APP RESTART: every host mirror is gone (process died), the module
 * registry is reset, and the next boot may only re-derive state from disk.
 */
async function restartApp(): Promise<Map<string, Handler>> {
  h.sessions.clear();
  h.startCalls.length = 0;
  vi.resetModules();
  return bootHandlers();
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

async function seedSidecar(courseId: string, sessionId: string, closedAt: string) {
  const { writeSessionJson, writeSessionMd } = await import("../src/main/sessions.js");
  const meta = {
    sessionId,
    modelId: "test-model",
    skillVersion: "0.1.0",
    environmentProfile: "app",
    createdAt: "2026-08-01T00:00:00.000Z",
    closedAt,
  };
  const turns: SessionTurn[] = [
    { role: "user", text: "Wie strukturiere ich die Challenge?" },
    { role: "assistant", text: "Beginnen wir bei Schritt 1." },
  ];
  await writeSessionJson(sessionsDirOf(courseId), meta, turns);
  await writeSessionMd(sessionsDirOf(courseId), meta, turns);
}

/**
 * What the model produced in the course before the restart, pushed through the
 * REAL tool-result paths of the host mirrors — a canvas write, two step
 * transitions, and a partial maturity reading with one criterion left unassessed.
 */
function recordDesignWork(active: FakeActive): void {
  active.canvasMirror.applySet({
    step: 1,
    id: "challenge-frage",
    label: "Leitfrage",
    value: "Wie kann ein Quartier seinen Energiebedarf halbieren?",
    state: "done",
  });
  active.canvasMirror.applySet({
    step: 2,
    id: "stakeholder",
    label: "Stakeholder",
    value: "Energieversorger, Quartierverein",
    state: "draft",
  });
  active.stepMirror.applyToolResult({ kind: "step-update", step: 1, depth: "refined", focus: false });
  active.stepMirror.applyToolResult({ kind: "step-update", step: 2, depth: "rough", focus: true });
  active.maturityMirror.applyToolResult({
    kind: "maturity-update",
    criterion: "societal-challenge",
    current: 2,
    target: 3,
    hint: "Leitfrage steht, Auftraggeber fehlt",
  });
  active.maturityMirror.applyToolResult({
    kind: "maturity-update",
    criterion: "stakeholder-involvement",
    current: "unassessed",
  });
}

/** The reading `recordDesignWork` produced — one assessed criterion with a
 * target, one explicitly unassessed. */
const RECORDED_MATURITY = {
  "societal-challenge": { current: 2, target: 3, hint: "Leitfrage steht, Auftraggeber fehlt" },
  "stakeholder-involvement": { current: "unassessed" },
};

/** Run one lecturer turn so the turn-boundary flush fires, then wait for it. */
async function runTurn(handlers: Map<string, Handler>, active: FakeActive, text: string): Promise<string> {
  active.session.prompt = async () => {
    active.draft = "Verstanden.";
  };
  await handlers.get("cbe:prompt")!(null, { sessionId: active.id, text });
  const json = path.join(active.sessionsDir, `${active.id}.json`);
  // Wait for the flush that contains THIS turn — a resumed conversation already
  // has a sidecar with earlier turns on disk.
  for (let i = 0; i < 200; i++) {
    if (existsSync(json)) {
      const payload = JSON.parse(readFileSync(json, "utf8")) as { turns: SessionTurn[] };
      if (payload.turns.some((t) => t.role === "user" && t.text === text)) return json;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for the turn-boundary flush of ${json}`);
}

describe("course design-state store — app-side round trip", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-design-state-"));
    h.root = path.join(tempDir, "courses");
    h.statePath = path.join(tempDir, "workspace-state.json");
    h.sessions.clear();
    h.startCalls.length = 0;
    h.seq = 0;
    mkdirSync(h.root, { recursive: true });
    writeFileSync(
      path.join(tempDir, "cbe-config.json"),
      JSON.stringify({ baseURL: "http://localhost:1", modelId: "test-model", apiKeyPlain: "k" }),
      "utf8"
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes state through at the turn boundary, not only at close", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    recordDesignWork(active);

    // No close-session call — the app is killed after the turn instead.
    const json = await runTurn(handlers, active, "weiter");
    const payload = JSON.parse(readFileSync(json, "utf8"));

    expect(payload.canvas.map((e: CanvasArtefactEntry) => e.id)).toEqual(["challenge-frage", "stakeholder"]);
    expect(payload.steps).toEqual([
      { step: 1, depth: "refined", focus: false },
      { step: 2, depth: "rough", focus: true },
    ]);
    expect(payload.maturity).toEqual(RECORDED_MATURITY);
  });

  // Capability `agent-harness`, Requirement: *Host-Derived Overall Maturity
  // Level* — Scenario: *The derived level is never persisted as a stored value*.
  // What the course record carries is the criterion readings, their capping
  // markers, the overall target and the note; the aggregate is a pure function of
  // those and is re-derived on restore rather than reloaded.
  it("persists criteria, capping markers, target and note — and no overall achieved level", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    active.maturityMirror.applyToolResult({
      kind: "maturity-update",
      readings: [
        { criterion: "societal-challenge", current: 3 },
        { criterion: "stakeholder-involvement", current: 3 },
        { criterion: "interdisciplinarity", current: 1, capped: true },
        { criterion: "student-agency", current: "unassessed" },
        { criterion: "iterative-process", current: "unassessed" },
        { criterion: "value-reflection", current: "unassessed" },
        { criterion: "societal-impact", current: "unassessed" },
        // The model still pushes an achieved level here; the host drops it.
        { criterion: "overall", current: 3, target: 3, note: "Eine Kohärenzlücke bleibt offen." },
      ],
    });
    const live = active.maturityMirror.derivedOverall();
    const json = await runTurn(handlers, active, "weiter");
    const payload = JSON.parse(readFileSync(json, "utf8"));

    // Stored: the readings and their markers, the target and the note …
    expect(payload.maturity.interdisciplinarity).toEqual({ current: 1, capped: true });
    expect(payload.maturity.overall).toEqual({ target: 3, note: "Eine Kohärenzlücke bleibt offen." });
    // … and NO overall achieved level, anywhere in the record.
    expect(payload.maturity.overall).not.toHaveProperty("current");
    expect(JSON.stringify(payload.maturity)).not.toContain('"overall":{"current"');

    // Restored from that record, the aggregate is derived to the same value it
    // had live: mean 2.33 → L2, capped to L1 by the standing finding.
    const afterRestart = await restartApp();
    const opened = (await afterRestart.get("cbe:conversation:open")!(null)) as OpenResult;
    expect(opened.maturity?.overall).not.toHaveProperty("current");
    const restored = h.sessions.get("conv-a")!;
    expect(restored.maturityMirror.derivedOverall()).toEqual(live);
    expect(live).toMatchObject({ level: 1, contributing: 3, cappedBy: "interdisciplinarity" });
  });

  it("leaves the record untouched when a call is refused", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    recordDesignWork(active);
    const json = await runTurn(handlers, active, "weiter");
    const before = JSON.parse(readFileSync(json, "utf8"));

    // Refused / degenerate calls: a step refusal, a maturity refusal, and a clear
    // of an artefact that is not in the mirror. None of them may move the record.
    active.stepMirror.applyToolResult({ kind: "step-refusal", step: 5, depth: "detailed" });
    active.maturityMirror.applyToolResult({ kind: "maturity-refusal", criterion: "societal-challenge", current: 3 });
    active.canvasMirror.applyClear({ step: 7 }, "does-not-exist");
    await runTurn(handlers, active, "und weiter");
    const after = JSON.parse(readFileSync(json, "utf8"));

    expect(after.canvas).toEqual(before.canvas);
    expect(after.steps).toEqual(before.steps);
    expect(after.maturity).toEqual(before.maturity);
  });

  it("restores a course's design state after an app restart", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    recordDesignWork(active);
    await runTurn(handlers, active, "weiter");

    const afterRestart = await restartApp();
    const opened = (await afterRestart.get("cbe:conversation:open")!(null)) as OpenResult;

    // The hydration payload the renderer receives carries all of it…
    expect(opened.session.sessionId).toBe("conv-a");
    expect(opened.canvas.map((e) => [e.step, e.id, e.state])).toEqual([
      [1, "challenge-frage", "done"],
      [2, "stakeholder", "draft"],
    ]);
    expect(opened.steps).toEqual([
      { step: 1, depth: "refined", focus: false },
      { step: 2, depth: "rough", focus: true },
    ]);
    expect(opened.maturity).toEqual(RECORDED_MATURITY);
    // …and the host mirrors were populated by the restore, not by a `cbe_*` call:
    // the restarted session made none.
    const restored = h.sessions.get("conv-a")!;
    expect(restored.canvasMirror.size()).toBe(2);
    expect(restored.stepMirror.list()).toHaveLength(2);
    expect(restored.maturityMirror.isEmpty()).toBe(false);
  });

  it("materialises nothing that was never established", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    recordDesignWork(active);
    await runTurn(handlers, active, "weiter");

    const afterRestart = await restartApp();
    const opened = (await afterRestart.get("cbe:conversation:open")!(null)) as OpenResult;

    // `unassessed` stays unassessed — no level is invented for it…
    expect(opened.maturity?.["stakeholder-involvement"]).toEqual({ current: "unassessed" });
    // …no aggregate `overall` row appears…
    expect(opened.maturity?.overall).toBeUndefined();
    // …criteria that were never read stay absent…
    expect(Object.keys(opened.maturity ?? {}).sort()).toEqual(["societal-challenge", "stakeholder-involvement"]);
    // …and steps never transitioned stay off the record, i.e. `open` in the UI.
    expect((opened.steps ?? []).map((s) => s.step)).toEqual([1, 2]);
  });

  it("opens a course with no record empty rather than inheriting", async () => {
    const courseA = await seedCourse("Kurs A");
    await seedSidecar(courseA, "conv-a", "2026-08-02T10:00:00.000Z");
    const handlers = await bootHandlers();
    await handlers.get("cbe:conversation:open")!(null);
    const active = h.sessions.get("conv-a")!;
    recordDesignWork(active);
    await runTurn(handlers, active, "weiter");

    // Switch to a second, untouched course.
    const { createCourse, writeActiveCourseId } = await import("../src/main/courses.js");
    const courseB = await createCourse(h.root, "Kurs B");
    await writeActiveCourseId(h.statePath, courseB.id);
    const openedB = (await handlers.get("cbe:conversation:open")!(null)) as OpenResult;

    expect(openedB.canvas).toEqual([]);
    expect(openedB.steps ?? []).toEqual([]);
    expect(openedB.maturity ?? {}).toEqual({});
    const activeB = h.sessions.get(openedB.session.sessionId)!;
    expect(activeB.canvasMirror.size()).toBe(0);
    expect(activeB.stepMirror.list()).toEqual([]);
    expect(activeB.maturityMirror.isEmpty()).toBe(true);

    // Course B's own folder never gains course A's state either.
    const jsonB = await runTurn(handlers, activeB, "hallo B");
    const payloadB = JSON.parse(readFileSync(jsonB, "utf8"));
    expect(payloadB.canvas).toBeUndefined();
    expect(payloadB.steps).toBeUndefined();
    expect(payloadB.maturity).toBeUndefined();
  });

  it("opens the course empty when the record is malformed", async () => {
    const courseId = await seedCourse();
    await seedSidecar(courseId, "conv-a", "2026-08-02T10:00:00.000Z");
    const json = path.join(sessionsDirOf(courseId), "conv-a.json");
    const payload = JSON.parse(readFileSync(json, "utf8"));
    // Hand-corrupted record: wrong container types and out-of-range values.
    payload.canvas = { "not-an": "array" };
    payload.steps = [{ step: 42, depth: "refined", focus: true }];
    payload.maturity = { "societal-challenge": { current: 9 }, "not-a-criterion": { current: 2 } };
    writeFileSync(json, JSON.stringify(payload, null, 2) + "\n");
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "));
    });

    const handlers = await bootHandlers();
    const opened = (await handlers.get("cbe:conversation:open")!(null)) as OpenResult;
    spy.mockRestore();

    // The transcript survives — a corrupt design-state field costs the course its
    // design state, not its conversation.
    expect(opened.session.sessionId).toBe("conv-a");
    expect(opened.notice).toBeUndefined();
    expect(opened.canvas).toEqual([]);
    expect(opened.steps ?? []).toEqual([]);
    expect(opened.maturity ?? {}).toEqual({});
    expect(errors.some((e) => String(e).includes("[cbe:design-state]"))).toBe(true);
  });
});
