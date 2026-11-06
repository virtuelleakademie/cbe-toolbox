/**
 * Main-process stored-conversation resume tests (change `resume-course-conversations`):
 *
 * - course-workspace spec, Requirement: Stored Conversations Are Resumable —
 *   Scenarios: Resuming a stored conversation switches the course's open
 *   conversation; A resumed conversation survives an app restart; An unknown or
 *   unreadable conversation id fails safely; Resume is refused while a turn is
 *   in flight; Resuming the open conversation re-attaches without disturbing it;
 *   A resolving resume refuses a course deletion.
 * - course-workspace spec, Requirement: One Canonical Conversation per Course —
 *   Scenario: Stored sidecar pairs stay on disk and unresumed pairs are never
 *   rewritten (handler side).
 * - desktop-app spec, Requirement: Course Detail Tabs: Chats and Wiki — the
 *   `cbe:conversation:list` half (newest first, openSessionId, row fields).
 *
 * Harness pattern mirrors conversation-open.test.ts (electron + agent.js
 * mocked; sessions.js and courses.js run REAL against a temp Space), with ONE
 * deliberate difference: handlers are registered ONCE in `beforeAll` — importing
 * `src/main/ipc.ts` pulls the whole main module graph, so a per-test import is
 * the documented way to time out under full-suite parallelism. Isolation comes
 * from one seeded course per test instead.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SessionTurn } from "../src/main/sessions.js";
import { ContextOccupancyTracker } from "@cbe/pi-bridge";
import { TurnStopController } from "@cbe/pi-bridge/turn-stop";
import { ToolCardRecorder } from "../src/shared/design-cards.js";

let tempDir: string;

const h = vi.hoisted(() => ({
  root: "",
  statePath: "",
  sessions: new Map<string, FakeActive>(),
  startCalls: [] as Array<{ resumeId?: string }>,
  startDelayMs: 0,
  seq: 0,
  onDump: undefined as ((sessionId: string) => void) | undefined,
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
  canvasMirror: { entries: unknown[]; list: () => unknown[]; restore: (e: unknown[]) => void };
  stepMirror: {
    entries: unknown[];
    list: () => unknown[];
    recordedList: () => unknown[];
    holdsOnlySeededFocus: () => boolean;
    restore: (e: unknown[]) => void;
  };
  maturityMirror: {
    state: Record<string, unknown>;
    snapshot: () => Record<string, unknown>;
    seed: (s: Record<string, unknown>) => void;
    isEmpty: () => boolean;
  };
  pendingAnswerGate: { reset: () => void };
  contextOccupancy: ContextOccupancyTracker;
  didacticChecks?: unknown;
  inFlight: boolean;
  pendingProfileNotes: string[];
  turnStop: TurnStopController;
  session: {
    subscribe: (cb: unknown) => void;
    dispose: ReturnType<typeof vi.fn>;
    prompt: (text: string) => Promise<void>;
    getContextUsage: () => unknown;
  };
}

function makeFakeActive(
  courseId: string,
  sessionsDir: string,
  resume?: { sessionId: string; createdAt: string; turns: SessionTurn[] }
): FakeActive {
  const canvasEntries: unknown[] = [];
  const stepEntries: unknown[] = [];
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
    canvasMirror: {
      entries: canvasEntries,
      list: () => [...canvasEntries],
      restore: (e) => {
        canvasEntries.length = 0;
        canvasEntries.push(...e);
      },
    },
    stepMirror: {
      entries: stepEntries,
      list: () => [...stepEntries],
      // This double is never given the host's initial focus seed, so everything
      // it holds is recorded work (Requirement: *Host-Set Initial Step Focus*).
      recordedList: () => [...stepEntries],
      holdsOnlySeededFocus: () => false,
      restore: (e) => {
        stepEntries.length = 0;
        stepEntries.push(...e);
      },
    },
    maturityMirror: {
      state: {} as Record<string, unknown>,
      snapshot() {
        return { ...this.state };
      },
      seed(s: Record<string, unknown>) {
        this.state = { ...s };
      },
      isEmpty() {
        return Object.keys(this.state).length === 0;
      },
    },
    pendingAnswerGate: { reset: () => {} },
    contextOccupancy: new ContextOccupancyTracker(),
    inFlight: false,
    pendingProfileNotes: [],
    turnStop: undefined as unknown as TurnStopController,
    session: {
      subscribe: () => {},
      dispose: vi.fn(),
      prompt: async () => {},
      getContextUsage: () => ({ tokens: 42, contextWindow: 131072, percent: 1 }),
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
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", async (importOriginal) => ({
  buildDesignDocument: ((await importOriginal()) as { buildDesignDocument: unknown }).buildDesignDocument,
  designDocumentFilename: ((await importOriginal()) as { designDocumentFilename: unknown }).designDocumentFilename,
  createCitationResolver: vi.fn(async () => ({ listIds: () => [] })),
  ContextOccupancyTracker: ((await importOriginal()) as { ContextOccupancyTracker: unknown }).ContextOccupancyTracker,
  occupancyChanged: ((await importOriginal()) as { occupancyChanged: unknown }).occupancyChanged,
  // sessions.ts validates sidecar design state through these three — they must
  // be the REAL guards, or `readSessionJson` maps the resulting TypeError to
  // null and every design-carrying sidecar reads as "unreadable".
  isCanvasArtefactEntry: ((await importOriginal()) as { isCanvasArtefactEntry: unknown }).isCanvasArtefactEntry,
  isStepCoverageEntry: ((await importOriginal()) as { isStepCoverageEntry: unknown }).isStepCoverageEntry,
  sanitizeMaturitySnapshot: ((await importOriginal()) as { sanitizeMaturitySnapshot: unknown })
    .sanitizeMaturitySnapshot,
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
  class AgentManager {
    async start(
      _cfg: unknown,
      course?: { id: string; sessionsDir: string },
      resume?: { sessionId: string; createdAt: string; turns: SessionTurn[] }
    ): Promise<FakeActive> {
      h.startCalls.push({ resumeId: resume?.sessionId });
      if (h.startDelayMs > 0) await new Promise((r) => setTimeout(r, h.startDelayMs));
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
      return this.flushShape(s, [...s.transcript]);
    }
    dump(id: string) {
      h.onDump?.(id);
      const s = h.sessions.get(id);
      if (!s) return null;
      if (s.draft) {
        s.transcript.push({ role: "assistant", text: s.draft });
        s.draft = "";
      }
      return this.flushShape(s, [...s.transcript]);
    }
    flushShape(s: FakeActive, turns: SessionTurn[]) {
      const canvas = s.canvasMirror.list();
      const steps = s.stepMirror.list();
      const maturity = s.maturityMirror.snapshot();
      return {
        meta: this.metaOf(s),
        turns,
        sessionsDir: s.sessionsDir,
        ...(s.didacticChecks ? { didacticChecks: s.didacticChecks } : {}),
        ...(canvas.length > 0 ? { canvas } : {}),
        ...(steps.length > 0 ? { steps } : {}),
        ...(Object.keys(maturity).length > 0 ? { maturity } : {}),
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
    close(id: string) {
      h.sessions.get(id)?.session.dispose();
      h.sessions.delete(id);
    }
    closeAll() {
      h.sessions.clear();
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
let handlers: Map<string, Handler>;

async function seedCourse(title: string): Promise<string> {
  const { createCourse } = await import("../src/main/courses.js");
  const course = await createCourse(h.root, title);
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
  design?: { canvas?: unknown[]; steps?: unknown[]; maturity?: Record<string, unknown> }
) {
  const { writeSessionJson, writeSessionMd } = await import("../src/main/sessions.js");
  const meta = {
    sessionId,
    modelId: "test-model",
    skillVersion: "0.1.0",
    environmentProfile: "app",
    // Creation tracks the stamp: the Chats list orders on `createdAt` (stable
    // historical order), the canonical scan on `closedAt` — a fixture with one
    // shared creation stamp would order the list by the sessionId tie-break.
    createdAt: closedAt,
    closedAt,
  };
  const t = turns ?? [
    { role: "user" as const, text: "hello" },
    { role: "assistant" as const, text: "hi" },
  ];
  await writeSessionJson(sessionsDirOf(courseId), meta, t, undefined, design as Parameters<typeof writeSessionJson>[4]);
  await writeSessionMd(sessionsDirOf(courseId), meta, t);
}

// Fixtures pass the REAL structural guards (`isCanvasArtefactEntry`,
// `isStepCoverageEntry`, `sanitizeMaturitySnapshot`) — the sidecar read
// silently drops what fails them, which would fake a restore failure here.
const CANVAS_ENTRY = { step: 1, id: "big-idea", label: "Big Idea", value: "Energy", state: "draft" };
const STEP_ENTRY = { step: 1, depth: "detailed", focus: true };
const MATURITY = { "societal-challenge": { current: 2 } };

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-resume-test-"));
  h.root = path.join(tempDir, "courses");
  h.statePath = path.join(tempDir, "workspace-state.json");
  mkdirSync(h.root, { recursive: true });
  writeFileSync(
    path.join(tempDir, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://localhost:1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
  // ONE ipc import for the whole suite (the documented per-test import pattern
  // is the known timeout under full-suite parallelism).
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  handlers = new Map<string, Handler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: Handler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
}, 30000);

beforeEach(() => {
  h.startCalls.length = 0;
  h.startDelayMs = 0;
  h.onDump = undefined;
});

afterAll(() => {
  if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

async function resume(courseId: string, sessionId: string) {
  return handlers.get("cbe:conversation:resume")!(null, { courseId, sessionId });
}

async function list(courseId: string) {
  return handlers.get("cbe:conversation:list")!(null, { courseId }) as Promise<{
    conversations: Array<Record<string, unknown>>;
    openSessionId?: string;
  }>;
}

describe("conversationResume — stored conversations are resumable", () => {
  it("switches the course's open conversation and hydrates turns + design snapshots", async () => {
    const courseId = await seedCourse("Resume Basis");
    const storedTurns: SessionTurn[] = [
      { role: "user", text: "erste Frage" },
      { role: "assistant", text: "erste Antwort" },
    ];
    await seedSidecar(courseId, "older", "2026-07-01T10:00:00.000Z", storedTurns, {
      canvas: [CANVAS_ENTRY],
      steps: [STEP_ENTRY],
      maturity: MATURITY,
    });
    await seedSidecar(courseId, "newest", "2026-07-07T10:00:00.000Z");
    // The course's open conversation: the canonical newest pair.
    const open = (await handlers.get("cbe:conversation:resume")!(null, {
      courseId,
      sessionId: "newest",
    })) as { session: { sessionId: string } };
    expect(open.session.sessionId).toBe("newest");
    const openSession = h.sessions.get("newest")!;

    const result = (await resume(courseId, "older")) as {
      session: { sessionId: string };
      turns: SessionTurn[];
      canvas: unknown[];
      steps: unknown[];
      maturity: Record<string, unknown>;
    };
    // The outgoing session went through the regular close path…
    expect(openSession.session.dispose).toHaveBeenCalled();
    expect(h.sessions.has("newest")).toBe(false);
    // …and the chosen pair is the open conversation, content restored.
    expect(result.session.sessionId).toBe("older");
    expect(result.turns).toEqual(storedTurns);
    expect(result.canvas).toEqual([CANVAS_ENTRY]);
    expect(result.steps).toEqual([STEP_ENTRY]);
    expect(result.maturity).toEqual(MATURITY);
    expect(h.startCalls.map((c) => c.resumeId)).toContain("older");
  });

  it("a resumed conversation survives an app restart (re-stamp wins the canonical scan)", async () => {
    const courseId = await seedCourse("Resume Dauerhaft");
    await seedSidecar(courseId, "dauer-older", "2026-07-01T10:00:00.000Z");
    await seedSidecar(courseId, "dauer-newest", "2026-07-07T10:00:00.000Z");
    await resume(courseId, "dauer-newest"); // open the canonical conversation
    await resume(courseId, "dauer-older"); // the lecturer resumes the older one

    // The boot scan — UNCHANGED, scan-only — now resolves the resumed pair:
    // closing "newest" stamped it first, the resume's flush stamped "older"
    // strictly later. No pointer file involved.
    const { resolveCanonicalConversation } = await import("../src/main/sessions.js");
    const canonical = await resolveCanonicalConversation(sessionsDirOf(courseId));
    expect(canonical.kind).toBe("resumable");
    expect(canonical.kind === "resumable" && canonical.sessionId).toBe("dauer-older");
  });

  it("an unknown or unreadable conversation id fails safely — the open conversation is untouched", async () => {
    const courseId = await seedCourse("Resume Unbekannt");
    await seedSidecar(courseId, "only", "2026-07-01T10:00:00.000Z");
    await resume(courseId, "only");
    const open = h.sessions.get("only")!;

    await expect(resume(courseId, "does-not-exist")).rejects.toThrow(en.mainResumeUnavailableNotice);
    // Nothing was closed, nothing was started.
    expect(open.session.dispose).not.toHaveBeenCalled();
    expect(h.sessions.get("only")).toBe(open);
    expect(h.startCalls.map((c) => c.resumeId)).not.toContain("does-not-exist");
  });

  it("is refused while the open conversation's turn is in flight", async () => {
    const courseId = await seedCourse("Resume Lauf");
    await seedSidecar(courseId, "lauf-target", "2026-07-01T10:00:00.000Z");
    await seedSidecar(courseId, "lauf-current", "2026-07-07T10:00:00.000Z");
    await resume(courseId, "lauf-current");
    const open = h.sessions.get("lauf-current")!;
    open.inFlight = true;

    await expect(resume(courseId, "lauf-target")).rejects.toThrow(en.mainTurnInFlightNotice);
    expect(open.session.dispose).not.toHaveBeenCalled();
    expect(h.sessions.get("lauf-current")).toBe(open);
  });

  it("resuming the open conversation re-attaches without closing or starting anything", async () => {
    const courseId = await seedCourse("Resume Noop");
    await seedSidecar(courseId, "same", "2026-07-01T10:00:00.000Z");
    await resume(courseId, "same");
    const open = h.sessions.get("same")!;
    h.startCalls.length = 0;

    const result = (await resume(courseId, "same")) as { session: { sessionId: string } };
    expect(result.session.sessionId).toBe("same");
    expect(h.startCalls).toEqual([]);
    expect(open.session.dispose).not.toHaveBeenCalled();
  });

  it("a resolving resume refuses a course deletion (same notice as a resolving open)", async () => {
    const courseId = await seedCourse("Resume Loeschguard");
    await seedSidecar(courseId, "slow", "2026-07-01T10:00:00.000Z");
    h.startDelayMs = 150;
    const pending = resume(courseId, "slow");
    // Immediately, while the resume is still resolving:
    await expect(handlers.get("cbe:course:delete")!(null, courseId)).rejects.toThrow(en.mainCourseDeleteOpeningNotice);
    await pending; // the resume completes undisturbed
    expect(h.sessions.has("slow")).toBe(true);
  });

  it("a concurrent resolution for the same course is refused, not raced", async () => {
    const courseId = await seedCourse("Resume Gleichzeitig");
    await seedSidecar(courseId, "a", "2026-07-01T10:00:00.000Z");
    await seedSidecar(courseId, "b", "2026-07-02T10:00:00.000Z");
    h.startDelayMs = 150;
    const pending = resume(courseId, "a");
    await expect(resume(courseId, "b")).rejects.toThrow(en.mainResumeWhileOpeningNotice);
    await pending;
    expect(h.sessions.has("a")).toBe(true);
  });

  it("is refused while a New Session fresh start is still resolving (never two live sessions)", async () => {
    // The fresh reset registers ONLY in `pendingSessionStarts` and has already
    // closed the outgoing session, so a resume gated on the in-flight map alone
    // would race it and leave the course with two live sessions. The guard is
    // `conversationOpeningFor` — the same question the deletion guard asks.
    const courseId = await seedCourse("Resume Waehrend Fresh");
    const { writeActiveCourseId } = await import("../src/main/courses.js");
    await writeActiveCourseId(h.statePath, courseId);
    await seedSidecar(courseId, "fresh-race-target", "2026-07-01T10:00:00.000Z");
    h.startDelayMs = 150;
    const startsBefore = h.startCalls.length;
    const pendingFresh = handlers.get("cbe:conversation:fresh")!(null, undefined);
    // Wait until the fresh start has actually BEGUN (its registration in
    // `pendingSessionStarts` precedes the agentManager.start call the counter
    // observes) — this pins the refusal inside the `pendingSessionStarts`
    // window specifically. The async gap BEFORE that registration is no longer
    // an accepted limit: the fresh handler registers in `conversationInflight`
    // synchronously behind its guard check, and the test below exercises that
    // earlier window.
    await vi.waitFor(() => expect(h.startCalls.length).toBe(startsBefore + 1));
    await expect(resume(courseId, "fresh-race-target")).rejects.toThrow(en.mainResumeWhileOpeningNotice);
    await pendingFresh; // the fresh start completes undisturbed…
    // …and exactly ONE session is open for the course: the fresh one.
    const forCourse = [...h.sessions.values()].filter((s) => s.courseId === courseId);
    expect(forCourse).toHaveLength(1);
    expect(forCourse[0]!.id).not.toBe("fresh-race-target");
  });

  it("is refused during the fresh reset's closing flush, before the fresh start registers (never two live sessions)", async () => {
    // The window BEFORE `pendingSessionStarts` becomes visible: the fresh
    // handler has passed its guard check and is still flushing the outgoing
    // session — `startFreshConversation` has not been reached yet. The handler
    // registers in `conversationInflight` synchronously behind its guard check,
    // so a resume landing exactly here is refused instead of racing the reset
    // into two live sessions. The dump hook fires synchronously at the START of
    // that closing flush, which pins the attempt inside the window.
    const courseId = await seedCourse("Resume Vorfenster");
    const { writeActiveCourseId } = await import("../src/main/courses.js");
    await writeActiveCourseId(h.statePath, courseId);
    await seedSidecar(courseId, "vorfenster-open", "2026-07-07T10:00:00.000Z");
    await seedSidecar(courseId, "vorfenster-target", "2026-07-01T10:00:00.000Z");
    await resume(courseId, "vorfenster-open");
    const startsBefore = h.startCalls.length;
    let resumeAttempt: Promise<unknown> | undefined;
    let startsAtAttempt = -1;
    h.onDump = (sessionId) => {
      if (sessionId !== "vorfenster-open" || resumeAttempt) return;
      startsAtAttempt = h.startCalls.length;
      resumeAttempt = resume(courseId, "vorfenster-target");
      resumeAttempt.catch(() => {});
    };
    await handlers.get("cbe:conversation:fresh")!(null, undefined);
    // The attempt was made while the fresh start had NOT begun…
    expect(startsAtAttempt).toBe(startsBefore);
    // …and was refused by the synchronous registration, not raced.
    await expect(resumeAttempt).rejects.toThrow(en.mainResumeWhileOpeningNotice);
    // Exactly ONE session is open for the course: the fresh one.
    const forCourse = [...h.sessions.values()].filter((s) => s.courseId === courseId);
    expect(forCourse).toHaveLength(1);
    expect(forCourse[0]!.id).not.toBe("vorfenster-target");
  });

  it("a New Session fresh start is refused while a resume is still resolving (never two live sessions)", async () => {
    // Mirror image of the test above: a resume holds the in-flight map for its
    // whole resolution, and the fresh handler asks the same
    // `conversationOpeningFor` question — a fresh start racing that window
    // would pass its open-session checks (the outgoing session is closed
    // mid-resume) and leave the course with two live sessions.
    const courseId = await seedCourse("Fresh Waehrend Resume");
    const { writeActiveCourseId } = await import("../src/main/courses.js");
    await writeActiveCourseId(h.statePath, courseId);
    await seedSidecar(courseId, "fresh-guard-target", "2026-07-01T10:00:00.000Z");
    h.startDelayMs = 150;
    const pendingResume = resume(courseId, "fresh-guard-target");
    await expect(handlers.get("cbe:conversation:fresh")!(null, undefined)).rejects.toThrow(
      en.mainResumeWhileOpeningNotice
    );
    await pendingResume; // the resume completes undisturbed…
    // …and exactly ONE session is open for the course: the resumed one.
    const forCourse = [...h.sessions.values()].filter((s) => s.courseId === courseId);
    expect(forCourse).toHaveLength(1);
    expect(forCourse[0]!.id).toBe("fresh-guard-target");
  });

  it("an unknown course id is refused for list and resume, and creates nothing on disk", async () => {
    await expect(list("kurs-existiert-nicht")).rejects.toThrow("Course not found");
    await expect(resume("kurs-existiert-nicht", "irgendeine-session")).rejects.toThrow("Course not found");
    expect(existsSync(path.join(h.root, "kurs-existiert-nicht"))).toBe(false);
    expect(h.startCalls).toEqual([]);
  });

  it("a path-shaped course id is refused for list and resume, before any file access", async () => {
    for (const id of ["../escape", "a/b", "a\\b", ".."]) {
      await expect(list(id)).rejects.toThrow("Course not found");
      await expect(resume(id, "target")).rejects.toThrow("Course not found");
    }
    expect(existsSync(path.join(path.dirname(h.root), "escape"))).toBe(false);
    expect(h.startCalls).toEqual([]);
  });

  it("a path-like session id is refused as unknown, before any file access", async () => {
    const courseId = await seedCourse("Resume Pfadform");
    await seedSidecar(courseId, "pfad-open", "2026-07-01T10:00:00.000Z");
    await resume(courseId, "pfad-open");
    const open = h.sessions.get("pfad-open")!;
    for (const id of ["../escape", "a/b", "a\\b"]) {
      await expect(resume(courseId, id)).rejects.toThrow(en.mainResumeUnavailableNotice);
    }
    expect(open.session.dispose).not.toHaveBeenCalled();
    expect(h.sessions.get("pfad-open")).toBe(open);
  });

  it("unresumed stored pairs stay byte-identical on disk through open and resume", async () => {
    const courseId = await seedCourse("Resume Unberuehrt");
    await seedSidecar(courseId, "bystander", "2026-07-01T10:00:00.000Z");
    await seedSidecar(courseId, "unber-target", "2026-07-03T10:00:00.000Z");
    await seedSidecar(courseId, "unber-newest", "2026-07-07T10:00:00.000Z");
    const mdBefore = readFileSync(path.join(sessionsDirOf(courseId), "bystander.md"), "utf8");
    const jsonBefore = readFileSync(path.join(sessionsDirOf(courseId), "bystander.json"), "utf8");

    await resume(courseId, "unber-newest");
    await resume(courseId, "unber-target");

    expect(readFileSync(path.join(sessionsDirOf(courseId), "bystander.md"), "utf8")).toBe(mdBefore);
    expect(readFileSync(path.join(sessionsDirOf(courseId), "bystander.json"), "utf8")).toBe(jsonBefore);
  });
});

describe("conversationList — the Chats tab's main-process half", () => {
  it("lists stored conversations newest-first with row fields and the open-session id", async () => {
    const courseId = await seedCourse("Liste Basis");
    await seedSidecar(courseId, "liste-older", "2026-07-01T10:00:00.000Z", [
      { role: "user", text: "raw payload\n\nSichtbare Frage", display: { text: "Sichtbare Frage" } },
      { role: "assistant", text: "Antwort" },
    ]);
    await seedSidecar(courseId, "liste-newest", "2026-07-07T10:00:00.000Z");
    await resume(courseId, "liste-newest");

    const result = await list(courseId);
    expect(result.conversations.map((c) => c.sessionId)).toEqual(["liste-newest", "liste-older"]);
    expect(result.openSessionId).toBe("liste-newest");
    const older = result.conversations[1]!;
    expect(older).toMatchObject({
      resumable: true,
      turnCount: 2,
      snippet: "Sichtbare Frage",
      closedAt: "2026-07-01T10:00:00.000Z",
    });
  });

  it("lists an md-only pair as non-resumable with the reason, and no openSessionId without an open session", async () => {
    const courseId = await seedCourse("Liste Unlesbar");
    const { writeSessionMd } = await import("../src/main/sessions.js");
    await writeSessionMd(
      sessionsDirOf(courseId),
      {
        sessionId: "md-only",
        modelId: "m",
        skillVersion: "0",
        environmentProfile: "app",
        createdAt: "2026-07-01T00:00:00.000Z",
        closedAt: "2026-07-01T01:00:00.000Z",
      },
      [{ role: "user", text: "hi" }]
    );
    const result = await list(courseId);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      sessionId: "md-only",
      resumable: false,
      reason: en.mainResumeDisabledReason,
    });
    expect(result.conversations[0]!.turnCount).toBeUndefined();
    expect(result.openSessionId).toBeUndefined();
  });
});
