/**
 * Main-process tests for `cbe:course:delete` (capability `course-workspace`,
 * Requirement: Course Deletion from the Detail View, Reversible via the OS
 * Trash — the guards the IPC layer owns, since UI placement is not
 * authorization).
 *
 * Scenarios covered here:
 *  - Deletion is refused while that course's turn is in flight (both halves:
 *    the refusal, and a background course's run NOT blocking it)
 *  - Deletion is refused while that course's wiki ingestion is running (same
 *    two halves), and a second, overlapping run finishing does NOT lift the
 *    first run's refusal
 *  - Deletion is refused while that course's conversation is still opening, and
 *    while one is being STARTED for it by a New Session reset (same two halves
 *    each), and a FAILED start leaves the course deletable again
 *  - An idle open session is closed cleanly before the folder is trashed
 *  - The refusal is re-evaluated after the closing flush, immediately before the
 *    folder moves — and a refusal there leaves the session open
 *  - A failed trash operation leaves the course's conversation usable
 *  - Deleting the active course leaves exactly one active course (including the
 *    last-course case, where a default course is created)
 *
 * The store-level halves (what is handed to the trash, already-gone, a failing
 * trash) live in courses.test.ts; the surface halves in
 * course-delete-control.test.tsx.
 *
 * `agent.js` is mocked so COURSES_ROOT / WORKSPACE_STATE_PATH point at a temp
 * Space — `courses.ts` itself runs for real against that directory, and
 * `shell.trashItem` is the only thing faked at the platform boundary.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ContextOccupancyTracker } from "@cbe/pi-bridge";
import { createCourse, readActiveCourseId, scanCourses, writeActiveCourseId } from "../src/main/courses.js";

const h = vi.hoisted(() => {
  const userData = "";
  return {
    userData,
    // Mutable per test: the session the AgentManager reports for a course id.
    sessions: new Map<string, { id: string; inFlight: boolean }>(),
    // Ordered log of side effects, so "flush before trash" is assertable.
    calls: [] as string[],
    trashImpl: null as null | ((target: string) => Promise<void>),
    // What the AgentManager reports for a closing flush. `null` (the default)
    // short-circuits the sidecar write; a payload makes the flush do real,
    // awaitable work — the window the deletion's re-check exists for.
    dumpImpl: null as null | ((id: string) => unknown),
    // Session starts the AgentManager performs: counted so a test can wait for
    // the start to be under way, and stubbed so it can hang or fail.
    startCalls: 0,
    startImpl: null as null | (() => Promise<unknown>),
    paths: { userData: "" },
  };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => h.paths.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  shell: {
    showItemInFolder: vi.fn(),
    trashItem: vi.fn(async (target: string) => {
      h.calls.push(`trash:${target}`);
      if (h.trashImpl) return h.trashImpl(target);
      await rm(target, { recursive: true, force: true });
    }),
  },
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", async (importOriginal) => ({
  ContextOccupancyTracker: ((await importOriginal()) as { ContextOccupancyTracker: unknown }).ContextOccupancyTracker,
  occupancyChanged: ((await importOriginal()) as { occupancyChanged: unknown }).occupancyChanged,
  createCitationResolver: vi.fn(),
  // Constructed by `wireSessionEvents`; their methods only run inside the event
  // subscription, which the fake session never emits into.
  ToolLoopDetector: class {},
  TruncationDetector: class {},
}));

vi.mock("../src/main/agent.js", () => ({
  AgentManager: class {
    getByCourse(courseId: string) {
      return h.sessions.get(courseId);
    }
    start() {
      h.startCalls += 1;
      return h.startImpl ? h.startImpl() : Promise.reject(new Error("unstubbed session start"));
    }
    close(id: string) {
      h.calls.push(`close:${id}`);
      for (const [courseId, s] of h.sessions) {
        if (s.id === id) h.sessions.delete(courseId);
      }
    }
    dump(id: string) {
      h.calls.push(`dump:${id}`);
      return h.dumpImpl ? h.dumpImpl(id) : null;
    }
    snapshot() {
      return null;
    }
    maturityState() {
      return null;
    }
    listIds() {
      return [];
    }
    closeAll() {}
  },
  get COURSES_ROOT() {
    return path.join(h.paths.userData, "courses");
  },
  get WORKSPACE_STATE_PATH() {
    return path.join(h.paths.userData, "workspace-state.json");
  },
  SESSIONS_DIR: "/tmp/test-sessions",
  resolveResource: (s: string) => `/tmp/test-resources/${s}`,
  lecturerProfileService: { current: vi.fn(), applyOverride: vi.fn() },
  currentCorpusDir: () => "/tmp/test-corpus",
  resetCorpusCaches: vi.fn(),
  CORPUS_UPDATER_PATHS: {},
}));

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
  resolveCanonicalConversation: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

/** Register the IPC surface against the current temp Space and hand back every
 * handler — the concurrency refusals are driven through the REAL handlers that
 * own the state they check (ingestion, conversation open), never by poking at
 * internals. */
async function ipcHandlers(): Promise<Map<string, IpcHandler>> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return handlers;
}

async function deleteHandler(): Promise<IpcHandler> {
  return (await ipcHandlers()).get("cbe:course:delete")!;
}

/** A promise that never settles — models "still running" for a run the deletion
 * must refuse without cancelling it. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** The slice of an `ActiveSessionRef` the resume branch of `conversationOpen`
 * touches: the design-state restore, the event wiring and the hydration
 * payload. Registered under its course exactly like the real manager does, so
 * `getByCourse` reports the conversation as usable again. */
function fakeActiveSession(id: string, courseId: string) {
  return {
    id,
    courseId,
    inFlight: false,
    transcript: [],
    session: { subscribe: () => {} },
    env: { profile: "app", affordances: {}, paths: { workspace: "/w", corpus: "/c", wiki: "/wiki" } },
    canvasMirror: { list: () => [], restore: () => {} },
    // The hydration snapshot reads the occupancy tracker (Requirement: Context
    // Occupancy Reported to the Host).
    contextOccupancy: new ContextOccupancyTracker(),
    stepMirror: { list: () => [], recordedList: () => [], holdsOnlySeededFocus: () => false, restore: () => {} },
    maturityMirror: { snapshot: () => null, seed: () => {} },
    // `wireSessionEvents` registers its stop observer on this (capability
    // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*).
    turnStop: fakeTurnStop({ inFlight: false }),
  };
}

/** Wait until a started handler has actually reached the point that publishes
 * its run — a single tick is not enough, both paths do real file I/O first. */
async function waitUntil(what: string, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

let root: string;

beforeEach(() => {
  // Fresh module graph per test: `ipc.ts` freezes CONFIG_PATH at import time,
  // and each test gets its own temp Space (plus a clean per-run state — the
  // in-flight conversation map lives at module scope).
  vi.resetModules();
  h.paths.userData = mkdtempSync(path.join(os.tmpdir(), "cbe-course-delete-"));
  root = path.join(h.paths.userData, "courses");
  h.sessions.clear();
  h.calls.length = 0;
  h.trashImpl = null;
  h.dumpImpl = null;
  h.startCalls = 0;
  h.startImpl = null;
  // A configured provider — the conversation-open path refuses before it reaches
  // the resolution step without one.
  writeFileSync(
    path.join(h.paths.userData, "cbe-config.json"),
    JSON.stringify({ baseURL: "https://example.invalid/v1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
});

afterEach(() => {
  rmSync(h.paths.userData, { recursive: true, force: true });
});

describe("cbe:course:delete — a running turn in that course refuses the deletion", () => {
  it("refuses the deletion while that course's turn is in flight", async () => {
    const handler = await deleteHandler();
    const course = await createCourse(root, "Laufender Kurs");
    h.sessions.set(course.id, { id: "sess-run", inFlight: true });

    await expect(handler(undefined, course.id)).rejects.toThrow(/still working in this course/i);

    // Nothing was trashed, the session was not closed, the run continues.
    expect(h.calls).toEqual([]);
    expect(h.sessions.get(course.id)?.inFlight).toBe(true);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  it("does not let a background course's running turn block the deletion", async () => {
    const handler = await deleteHandler();
    const target = await createCourse(root, "Zu Loeschen");
    const background = await createCourse(root, "Hintergrund");
    // A DIFFERENT course is mid-turn — none of this deletion's business.
    h.sessions.set(background.id, { id: "sess-bg", inFlight: true });

    const result = (await handler(undefined, target.id)) as { trashed: boolean; courses: Array<{ id: string }> };

    expect(result.trashed).toBe(true);
    expect(result.courses.map((c) => c.id)).toEqual([background.id]);
    // The background run is untouched.
    expect(h.sessions.get(background.id)?.inFlight).toBe(true);
    expect(h.calls).toEqual([`trash:${path.join(root, target.id)}`]);
  });
});

describe("cbe:course:delete — a running wiki ingestion in that course refuses the deletion", () => {
  /** Start an ingestion for the ACTIVE course and leave it hanging in the file
   * dialog: the run is live (its course is published) but nothing has been
   * written yet, so the assertion is about the refusal, not about cleanup. */
  async function startHangingIngestion(handlers: Map<string, IpcHandler>): Promise<void> {
    const { dialog } = await import("electron");
    const showOpenDialog = dialog.showOpenDialog as ReturnType<typeof vi.fn>;
    showOpenDialog.mockReturnValue(pending());
    void handlers.get("cbe:wiki:ingest")!(undefined);
    // The dialog is opened AFTER the run's course has been published, so this
    // is the deterministic "the ingestion is now live" signal.
    await waitUntil("the ingestion to reach the file dialog", () => showOpenDialog.mock.calls.length > 0);
  }

  it("refuses the deletion while that course's wiki ingestion is running", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Einlesender Kurs");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    await startHangingIngestion(handlers);

    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(
      /still being read into this course's wiki/i
    );

    // Nothing moved, and the ingestion was NOT cancelled to make room for the
    // deletion — the lecturer confirmed a course deletion, not the loss of a run.
    expect(h.calls).toEqual([]);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  // A second start for the SAME course is refused for the WHOLE run since
  // `bind-an-ingest-to-its-own-course` (capability `lecturer-wiki`, Requirement:
  // An Ingest Belongs to the Course It Was Started In) — the guard used to be
  // the abort controller, which only existed during atomization, so a run still
  // sitting in the file dialog refused nothing. What matters HERE is that the
  // refused second start leaves the first run's registration alone: a guard a
  // later call can tidy away is no guard, and the course is still being written
  // into.
  it("keeps refusing while a refused second start for the same course unwinds", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Zwei Laeufe");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    const { dialog } = await import("electron");
    const showOpenDialog = dialog.showOpenDialog as ReturnType<typeof vi.fn>;

    // Run A hangs in the file dialog — still live, still going to write.
    showOpenDialog.mockReturnValueOnce(pending());
    void handlers.get("cbe:wiki:ingest")!(undefined, { token: "t-a", courseId: course.id });
    await waitUntil("the first ingestion to reach the file dialog", () => showOpenDialog.mock.calls.length > 0);

    // Run B is refused before it reaches the picker, because A is live for this
    // very course.
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(handlers.get("cbe:wiki:ingest")!(undefined, { token: "t-b", courseId: course.id })).rejects.toThrow(
      /already running for this course/i
    );
    expect(showOpenDialog.mock.calls.length).toBe(1);

    // A is still writing into this folder, so the deletion stays refused.
    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(
      /still being read into this course's wiki/i
    );
    expect(h.calls).toEqual([]);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  it("does not let a background course's ingestion block the deletion", async () => {
    const handlers = await ipcHandlers();
    const target = await createCourse(root, "Zu Loeschen");
    const background = await createCourse(root, "Hintergrund");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), background.id);
    await startHangingIngestion(handlers);

    const result = (await handlers.get("cbe:course:delete")!(undefined, target.id)) as {
      trashed: boolean;
      courses: Array<{ id: string }>;
    };

    expect(result.trashed).toBe(true);
    expect(result.courses.map((c) => c.id)).toEqual([background.id]);
  });
});

describe("cbe:course:delete — a conversation still opening for that course refuses the deletion", () => {
  /** Open the ACTIVE course's conversation and leave the resolution hanging —
   * the window in which no session is registered yet, so the in-flight turn
   * check cannot see it. */
  async function startHangingConversationOpen(handlers: Map<string, IpcHandler>): Promise<void> {
    const { resolveCanonicalConversation } = await import("../src/main/sessions.js");
    const resolve = resolveCanonicalConversation as ReturnType<typeof vi.fn>;
    resolve.mockReturnValue(pending());
    void handlers.get("cbe:conversation:open")!(undefined);
    // Reached only after the open was registered as in flight for its course.
    await waitUntil("the conversation open to reach the resolution step", () => resolve.mock.calls.length > 0);
  }

  it("refuses the deletion while that course's conversation is still opening", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Oeffnender Kurs");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    await startHangingConversationOpen(handlers);

    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(
      /conversation is still opening/i
    );

    // No session is registered yet — precisely why the in-flight turn check
    // cannot cover this window.
    expect(h.sessions.size).toBe(0);
    expect(h.calls).toEqual([]);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  it("does not let a background course's opening conversation block the deletion", async () => {
    const handlers = await ipcHandlers();
    const target = await createCourse(root, "Zu Loeschen");
    const background = await createCourse(root, "Hintergrund");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), background.id);
    await startHangingConversationOpen(handlers);

    const result = (await handlers.get("cbe:course:delete")!(undefined, target.id)) as {
      trashed: boolean;
      courses: Array<{ id: string }>;
    };

    expect(result.trashed).toBe(true);
    expect(result.courses.map((c) => c.id)).toEqual([background.id]);
  });
});

describe("cbe:course:delete — a conversation being STARTED for that course refuses the deletion", () => {
  /** Kick off a New Session reset for the ACTIVE course and leave the session
   * start hanging — the window in which the outgoing session is already closed
   * and the replacement is not registered yet, so the course looks idle from
   * every other angle. */
  async function startHangingFreshStart(handlers: Map<string, IpcHandler>): Promise<void> {
    h.startImpl = () => pending();
    void handlers.get("cbe:conversation:fresh")!(undefined);
    await waitUntil("the session start to begin", () => h.startCalls > 0);
  }

  it("refuses the deletion while a new conversation is being started for that course", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Neu Startender Kurs");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    await startHangingFreshStart(handlers);

    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(
      /conversation is still opening/i
    );

    // The start would otherwise mint its sidecars into the trashed folder.
    expect(h.calls).toEqual([]);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  it("does not let a session start in a background course block the deletion", async () => {
    const handlers = await ipcHandlers();
    const target = await createCourse(root, "Zu Loeschen");
    const background = await createCourse(root, "Hintergrund");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), background.id);
    await startHangingFreshStart(handlers);

    const result = (await handlers.get("cbe:course:delete")!(undefined, target.id)) as {
      trashed: boolean;
      courses: Array<{ id: string }>;
    };

    expect(result.trashed).toBe(true);
    expect(result.courses.map((c) => c.id)).toEqual([background.id]);
  });

  it("makes the course deletable again after a failed session start", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Gescheiterter Start");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    h.startImpl = () => Promise.reject(new Error("runtime install failed"));

    await expect(handlers.get("cbe:conversation:fresh")!(undefined)).rejects.toThrow();

    // A refusal outliving its cause would be worse than the gap it closes.
    const result = (await handlers.get("cbe:course:delete")!(undefined, course.id)) as { trashed: boolean };
    expect(result.trashed).toBe(true);
  });
});

describe("cbe:course:delete — an idle open session is closed cleanly first", () => {
  it("closes an idle open session cleanly before the folder is trashed", async () => {
    const handler = await deleteHandler();
    const course = await createCourse(root, "Idle Kurs");
    h.sessions.set(course.id, { id: "sess-idle", inFlight: false });

    const result = (await handler(undefined, course.id)) as { trashed: boolean };

    expect(result.trashed).toBe(true);
    // Ordering is the point: the closing flush (dump) and the dispose happen
    // BEFORE the folder moves, so the trashed copy carries the full conversation
    // and no handle is open on a folder being moved.
    expect(h.calls).toEqual(["dump:sess-idle", "close:sess-idle", `trash:${path.join(root, course.id)}`]);
  });
});

describe("cbe:course:delete — the exactly-one-active-course invariant survives", () => {
  it("leaves exactly one active course after deleting the active course", async () => {
    const handler = await deleteHandler();
    const active = await createCourse(root, "Aktiv");
    const other = await createCourse(root, "Anderer");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), active.id);

    const result = (await handler(undefined, active.id)) as { activeCourseId: string; courses: Array<{ id: string }> };

    // Re-resolved to the remaining course, and the pointer is PERSISTED — an
    // app restart must not fall back to the deleted id.
    expect(result.activeCourseId).toBe(other.id);
    expect(result.courses.map((c) => c.id)).toEqual([other.id]);
    expect(await readActiveCourseId(path.join(h.paths.userData, "workspace-state.json"))).toBe(other.id);
  });

  it("creates a default course when the deleted course was the last one", async () => {
    const handler = await deleteHandler();
    const only = await createCourse(root, "Einziger");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), only.id);

    const result = (await handler(undefined, only.id)) as { activeCourseId: string; courses: Array<{ id: string }> };

    // The Space is never left without an active course.
    expect(result.activeCourseId).not.toBe(only.id);
    expect(result.activeCourseId).toBeTruthy();
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]!.id).toBe(result.activeCourseId);
  });

  it("leaves the active course untouched when a non-active course is deleted", async () => {
    const handler = await deleteHandler();
    const active = await createCourse(root, "Bleibt Aktiv");
    const doomed = await createCourse(root, "Geht Weg");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), active.id);

    const result = (await handler(undefined, doomed.id)) as { activeCourseId: string; courses: Array<{ id: string }> };

    expect(result.activeCourseId).toBe(active.id);
    expect(result.courses.map((c) => c.id)).toEqual([active.id]);
  });
});

describe("cbe:course:delete — failure is honest", () => {
  it("propagates a failed trash operation and leaves the course in place", async () => {
    const handler = await deleteHandler();
    const course = await createCourse(root, "Trash Kaputt");
    h.trashImpl = async () => {
      throw new Error("Operation not permitted");
    };

    await expect(handler(undefined, course.id)).rejects.toThrow(/not permitted/i);

    // No fallback to an irreversible delete — the course is still scannable.
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });

  it("leaves the course's conversation usable when the trash operation fails", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Trash Kaputt Mit Sitzung");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    h.sessions.set(course.id, { id: "sess-idle", inFlight: false });
    h.trashImpl = async () => {
      throw new Error("Operation not permitted");
    };
    // The closing flush rewrote this pair moments ago; the re-open resumes it
    // under the SAME sessionId — the one the renderer is still holding.
    const { resolveCanonicalConversation } = await import("../src/main/sessions.js");
    (resolveCanonicalConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "resumable",
      json: { meta: { sessionId: "sess-idle", createdAt: "2026-01-01T00:00:00.000Z" }, turns: [] },
    });
    h.startImpl = async () => {
      h.calls.push("start:sess-idle");
      const resumed = fakeActiveSession("sess-idle", course.id);
      h.sessions.set(course.id, resumed);
      return resumed;
    };
    // The re-open is best-effort, so a broken one would be swallowed — this
    // asserts it actually went through rather than being logged away.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(/not permitted/i);

    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();

    // "The deletion failed" and "your conversation is gone" must not arrive
    // together: nothing moved, so nothing stays changed.
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
    expect(h.sessions.get(course.id)?.id).toBe("sess-idle");
    expect(h.calls).toEqual([
      "dump:sess-idle",
      "close:sess-idle",
      `trash:${path.join(root, course.id)}`,
      "start:sess-idle",
    ]);
  });
});

describe("cbe:course:delete — the refusal is re-evaluated immediately before the folder moves", () => {
  it("refuses when a writer starts during the closing flush, and keeps the session open", async () => {
    const handlers = await ipcHandlers();
    const course = await createCourse(root, "Flush Fenster");
    await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
    h.sessions.set(course.id, { id: "sess-idle", inFlight: false });
    // A closing flush that does real work: the sidecar write below is awaited by
    // the handler, and the lecturer can act while it runs.
    h.dumpImpl = () => ({
      meta: { sessionId: "sess-idle" },
      turns: [],
      sessionsDir: path.join(root, course.id, "sessions"),
      canvas: [],
      steps: [],
    });
    const { writeSessionMd } = await import("../src/main/sessions.js");
    const { dialog } = await import("electron");
    const showOpenDialog = dialog.showOpenDialog as ReturnType<typeof vi.fn>;
    // A wiki ingestion for this course starts WHILE the flush writes — after the
    // entry check has already passed. Only a re-check placed immediately before
    // the trash call can still see it.
    (writeSessionMd as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      showOpenDialog.mockReturnValue(pending());
      void handlers.get("cbe:wiki:ingest")!(undefined);
      await waitUntil("the ingestion to reach the file dialog", () => showOpenDialog.mock.calls.length > 0);
      return path.join(root, course.id, "sessions", "sess-idle.md");
    });

    await expect(handlers.get("cbe:course:delete")!(undefined, course.id)).rejects.toThrow(
      /still being read into this course's wiki/i
    );

    // The folder is untouched, and the refusal did not cost the lecturer the
    // conversation it just refused to delete: no close, no trash.
    expect(h.calls).toEqual(["dump:sess-idle"]);
    expect(h.sessions.get(course.id)?.id).toBe("sess-idle");
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });
});
