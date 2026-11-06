/**
 * An ingest belongs to the course it was started in — host side (capability
 * `lecturer-wiki`, Requirement: *An Ingest Belongs to the Course It Was Started
 * In*).
 *
 * The defect: a lecturer could open a NON-active course's detail level, click
 * the "Ingest material" control sitting under that course's own atom list, and
 * have the material filed into the ACTIVE course. Removing the control is the
 * visible half; this file is the half that makes it a rule rather than a
 * layout, and the half that keeps a run bound to its course once the lecturer
 * activates another one — at which point two runs in two courses are in flight
 * together and every course-blind mechanism in the handler becomes a way to
 * lose one of them.
 *
 * Scenarios, one test each:
 *  - The host refuses a start named for any course but the active one
 *  - A running ingest keeps writing into its own course after the active course changes
 *  - Aborting one course's run leaves another course's run running
 *    (twice: named runs, and the tokenless shape the host still accepts)
 *  - A second start is refused for the same course only
 *
 * The atomization run itself is stubbed — it is the subagent workflow, and what
 * is under test is what the HOST binds to it. Same shape as
 * `wiki-atoms-host-channel.test.ts` next door.
 */
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WikiIngestProgressEvent } from "../src/shared/ipc-contract.js";

/** One stubbed atomization run, captured as the handler starts it. */
interface CapturedRun {
  courseDir: string;
  wikiDir: string;
  signal: AbortSignal;
  onProgress: (p: { rawRelPath: string; status: string; error?: string }) => void;
  /** Lets the test decide when this run's atomization returns. */
  release: () => void;
  outcomes: Array<Record<string, unknown>>;
}

const h = vi.hoisted(() => ({
  paths: { userData: "" },
  /** `(courseDir, filename)` for every document handed to the store layer. */
  stored: [] as Array<{ courseDir: string; filename: string }>,
  /** Every `recordWikiAtoms(courseId, atoms)` an ingest made. */
  recorded: [] as Array<{ courseId: string; atoms: string[] }>,
  /** The runs currently stubbed, in start order. */
  runs: [] as CapturedRun[],
  picked: { canceled: false, filePaths: [] as string[] },
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => h.paths.userData), getVersion: vi.fn(() => "0.0.0-test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(async () => h.picked), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return {
    ...actual,
    createCitationResolver: vi.fn(),
    createPiAtomizationSessionFactory: vi.fn(() => ({})),
    readWikiSkillVersion: vi.fn(async () => "1.0.0"),
    // Held open until the test releases it, so a run can be observed WHILE it is
    // in flight — which is the only state any of these scenarios is about.
    runAtomization: vi.fn(
      async (
        _docs: unknown,
        _factory: unknown,
        opts: {
          courseDir: string;
          wikiDir: string;
          signal: AbortSignal;
          onProgress: (p: { rawRelPath: string; status: string; error?: string }) => void;
        }
      ) => {
        const run = {
          courseDir: opts.courseDir,
          wikiDir: opts.wikiDir,
          signal: opts.signal,
          onProgress: opts.onProgress,
          release: () => {},
          outcomes: [] as Array<Record<string, unknown>>,
        };
        h.runs.push(run);
        await new Promise<void>((resolve) => {
          run.release = resolve;
        });
        return run.outcomes;
      }
    ),
  };
});

vi.mock("../src/main/wiki-store.js", () => ({
  extractorId: () => "test-extractor@0.0.0",
  ingestIntoCourse: vi.fn(async (courseDir: string, files: Array<{ filename: string }>) => {
    h.stored.push(...files.map((f) => ({ courseDir, filename: f.filename })));
    return files.map((f) => ({ ok: true as const, filename: f.filename, rawRelPath: `raw/${f.filename}.md` }));
  }),
  setRawStatus: vi.fn(async () => {}),
  writeReflectionLog: vi.fn(async () => {}),
}));

vi.mock("../src/main/agent.js", () => ({
  AgentManager: class {
    getByCourse() {
      return undefined;
    }
    listIds() {
      return [];
    }
    snapshot() {
      return null;
    }
    maturityState() {
      return null;
    }
    recordWikiAtoms(courseId: string, atoms: readonly string[]) {
      h.recorded.push({ courseId, atoms: [...atoms] });
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

let ingest: IpcHandler;
let abort: IpcHandler;
/** Every progress event the handlers broadcast, in order. */
let sent: WikiIngestProgressEvent[] = [];
let ALPHA = "";
let BETA = "";

/** Point the workspace's active course at `id`, as `cbe:course:set-active` does. */
async function activate(id: string): Promise<void> {
  const { writeActiveCourseId } = await import("../src/main/courses.js");
  await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), id);
}

/** Start an ingest and hand back its in-flight promise plus its captured run. */
async function startRun(courseId: string, token: string): Promise<{ done: Promise<unknown>; run: CapturedRun }> {
  const before = h.runs.length;
  const done = ingest(undefined, { token, courseId });
  // Swallow a rejection only once the caller has had its chance to assert on it.
  done.catch(() => {});
  await vi.waitFor(() => expect(h.runs.length).toBe(before + 1));
  return { done, run: h.runs[before]! };
}

// Registered ONCE with a raised timeout: importing `src/main/ipc.ts` pulls the
// whole main-process module graph, which blows vitest's 5 s default when done
// per test (the documented IPC-test trap). The handler closures therefore hold
// their run registries across cases, so every test releases the runs it starts.
beforeAll(async () => {
  h.paths.userData = mkdtempSync(path.join(os.tmpdir(), "cbe-ingest-binding-"));
  writeFileSync(
    path.join(h.paths.userData, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://127.0.0.1:9/v1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
  const { createCourse } = await import("../src/main/courses.js");
  const coursesRoot = path.join(h.paths.userData, "courses");
  ALPHA = (await createCourse(coursesRoot, "Algorithmen")).id;
  BETA = (await createCourse(coursesRoot, "Datenbanken")).id;
  mkdirSync(path.join(h.paths.userData, "material"), { recursive: true });
  writeFileSync(path.join(h.paths.userData, "material", "skript.md"), "# Skript\n", "utf8");
  h.picked = { canceled: false, filePaths: [path.join(h.paths.userData, "material", "skript.md")] };

  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const map = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    map.set(channel, fn);
  });
  registerIpc({
    webContents: {
      send: (_channel: string, evt: WikiIngestProgressEvent) => {
        sent.push(evt);
      },
    },
  } as never);
  ingest = map.get("cbe:wiki:ingest")!;
  abort = map.get("cbe:wiki:ingest-abort")!;
}, 60_000);

afterAll(() => {
  rmSync(h.paths.userData, { recursive: true, force: true });
});

beforeEach(async () => {
  // The ingest pre-flights the endpoint before storing anything; the configured
  // URL is a placeholder no server answers, so a reachable one is stubbed —
  // reachability is `ingest-preflight.test.ts`'s subject, not this file's.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
  );
  h.stored.length = 0;
  h.recorded.length = 0;
  h.runs.length = 0;
  sent = [];
  await activate(ALPHA);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("An ingest belongs to the course it was started in", () => {
  // Scenario: The host refuses a start named for any course but the active one
  it("refuses a start named for a non-active course, before anything is stored", async () => {
    const { dialog } = await import("electron");
    (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockClear();

    await expect(ingest(undefined, { token: "t-stale", courseId: BETA })).rejects.toThrow(/no longer active/i);

    // Nothing was picked, nothing stored, no atomization started — and no run
    // appeared under either course.
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(h.stored).toEqual([]);
    expect(h.runs).toEqual([]);
    // The refusal names where material actually goes, so the lecturer can act.
    await expect(ingest(undefined, { token: "t-stale", courseId: BETA })).rejects.toThrow(/Algorithmen/);
  });

  // Scenario: A running ingest keeps writing into its own course after the
  // active course changes
  //
  // The regression that must never come back: the remaining events of a run
  // used to be filed under whatever course was active when they landed.
  it("keeps stamping and writing under its own course when the active course changes mid-run", async () => {
    const { done, run } = await startRun(ALPHA, "t-alpha");
    expect(run.courseDir.endsWith(ALPHA)).toBe(true);
    expect(run.wikiDir).toBe(path.join(h.paths.userData, "courses", ALPHA, "wiki"));
    expect(h.stored).toEqual([{ courseDir: path.join(h.paths.userData, "courses", ALPHA), filename: "skript.md" }]);

    // The lecturer activates the other course while the run is atomizing.
    await activate(BETA);

    run.onProgress({ rawRelPath: "raw/skript.md.md", status: "running" });
    run.onProgress({ rawRelPath: "raw/skript.md.md", status: "done" });
    run.outcomes = [{ rawRelPath: "raw/skript.md.md", status: "done", atoms: ["concept/cognitive-load"] }];
    run.release();
    await done;

    // Every event of the run — the ones emitted before the switch and the ones
    // after it — carries the run's own course, never the newly active one.
    expect(sent.length).toBeGreaterThan(0);
    expect([...new Set(sent.map((e) => e.courseId))]).toEqual([ALPHA]);
    expect([...new Set(sent.map((e) => e.token))]).toEqual(["t-alpha"]);
    expect(sent.map((e) => e.status)).toEqual(["extracting", "running", "done"]);
    // …and so does the disclosure of the atoms it landed.
    expect(h.recorded).toEqual([{ courseId: ALPHA, atoms: ["concept/cognitive-load"] }]);
  });

  // Scenario: Aborting one course's run leaves another course's run running
  it("aborts only the run its token names, and reports an unheld token as undelivered", async () => {
    const alpha = await startRun(ALPHA, "t-alpha");
    await activate(BETA);
    const beta = await startRun(BETA, "t-beta");

    // A token no run holds reaches nothing and says so — neither run is touched.
    await expect(abort(undefined, "t-nobody")).resolves.toEqual({ ok: true, delivered: false });
    expect(alpha.run.signal.aborted).toBe(false);
    expect(beta.run.signal.aborted).toBe(false);

    await expect(abort(undefined, "t-alpha")).resolves.toEqual({ ok: true, delivered: true });
    expect(alpha.run.signal.aborted).toBe(true);
    // The other course's run is none of that abort's business.
    expect(beta.run.signal.aborted).toBe(false);

    alpha.run.release();
    await alpha.done;
    // …and it is still abortable in its own right afterwards.
    await expect(abort(undefined, "t-beta")).resolves.toEqual({ ok: true, delivered: true });
    expect(beta.run.signal.aborted).toBe(true);
    beta.run.release();
    await beta.done;
  });

  // Scenario: Aborting one course's run leaves another course's run running —
  // the tokenless shape of it. An omitted token asserts nothing and is a caller
  // shape the host still accepts, so two such runs must not share one registry
  // entry: keyed by the token, both would collide on the empty string, the
  // second would overwrite the first's controller and the first's release would
  // clear the second's — the single-slot loss this registry exists to remove.
  // An abort naming nothing must correspondingly reach nothing.
  it("keeps two tokenless runs in two courses separate, and delivers a tokenless abort to neither", async () => {
    const alpha = await startRun(ALPHA, "");
    await activate(BETA);
    const beta = await startRun(BETA, "");

    // Both are still live and independent — neither registration consumed the
    // other's, which is what the empty-string key used to do.
    expect(alpha.run.courseDir.endsWith(ALPHA)).toBe(true);
    expect(beta.run.courseDir.endsWith(BETA)).toBe(true);

    await expect(abort(undefined, "")).resolves.toEqual({ ok: true, delivered: false });
    await expect(abort(undefined)).resolves.toEqual({ ok: true, delivered: false });
    expect(alpha.run.signal.aborted).toBe(false);
    expect(beta.run.signal.aborted).toBe(false);

    // Ending one leaves the other's entry intact — a later, named run is still
    // reachable, so nothing was cleared out from under it.
    alpha.run.release();
    await alpha.done;
    expect(beta.run.signal.aborted).toBe(false);

    await activate(ALPHA);
    const named = await startRun(ALPHA, "t-named");
    await expect(abort(undefined, "t-named")).resolves.toEqual({ ok: true, delivered: true });
    expect(named.run.signal.aborted).toBe(true);
    expect(beta.run.signal.aborted).toBe(false);

    named.run.release();
    await named.done;
    beta.run.release();
    await beta.done;
  });

  // Scenario: A second start is refused for the same course only
  it("refuses a second start for the running course and accepts one for the newly active course", async () => {
    const alpha = await startRun(ALPHA, "t-alpha");

    await expect(ingest(undefined, { token: "t-alpha-2", courseId: ALPHA })).rejects.toThrow(
      /already running for this course/i
    );
    expect(h.runs.length).toBe(1);

    // The lecturer activates the other course: work there is not refused by a
    // run elsewhere — that would be the mirror of the defect being fixed.
    await activate(BETA);
    const beta = await startRun(BETA, "t-beta");
    expect(beta.run.courseDir.endsWith(BETA)).toBe(true);

    alpha.run.release();
    await alpha.done;
    beta.run.release();
    await beta.done;

    // The refusal spans the WHOLE run, so it lifts only once the run is over.
    const third = await startRun(BETA, "t-beta-2");
    third.run.release();
    await third.done;
  });
});
