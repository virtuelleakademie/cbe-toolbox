/**
 * The wiki ingest's connection pre-flight (capability `lecturer-wiki`,
 * Requirement: An Ingest That Cannot Reach the Model Fails Visibly and Stays
 * Retryable).
 *
 * A lecturer started an ingest with their inference server not running. The
 * documents were copied into `inbox/` and extracted into `raw/` for an
 * atomization that then never happened — entries left behind by a run that
 * produced nothing. The pre-flight sits between the picker and the first byte
 * written, so a dead endpoint costs the course folder nothing.
 *
 * Both directions of the refusal rule are load-bearing and one test each:
 *
 *  - Scenario: An unreachable endpoint refuses the ingest before anything is
 *    stored — a DEFINITE NEGATIVE (refused connection, unresolvable name), the
 *    only verdict that refuses.
 *  - Scenario: An endpoint that answers is never refused by the pre-flight —
 *    a rejected key and a missing `/models` route both mean something answered,
 *    and refusing on them would make the pre-flight a new failure source of
 *    exactly the kind it removes. A SLOW endpoint belongs to the same scenario
 *    for the same reason: not answering within the probe's window says the
 *    endpoint has not answered yet, never that it is absent — a local model
 *    loading its weights is precisely that, and it is the case the silence
 *    deadline was sized to tolerate. The pre-flight must not be a timer.
 *
 * The real `probeConnection` runs; only `fetch` is stubbed, so the classification
 * under test is the product's own rather than a restatement of it here.
 */
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCourse, writeActiveCourseId } from "../src/main/courses.js";

const h = vi.hoisted(() => ({
  paths: { userData: "" },
  /** Documents handed to the store layer — empty means the pre-flight refused. */
  stored: [] as string[],
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => h.paths.userData), getVersion: vi.fn(() => "0.0.0-test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn() },
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
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
    recordWikiAtoms() {}
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

// The store layer is the tripwire: reaching it at all means the pre-flight let
// the run through, and its absence means nothing was written.
vi.mock("../src/main/wiki-store.js", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    ingestIntoCourse: vi.fn(async (_dir: string, files: Array<{ filename: string }>) => {
      h.stored.push(...files.map((f) => f.filename));
      return [];
    }),
  };
});

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
  resolveCanonicalConversation: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

async function ingestHandler(): Promise<IpcHandler> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return handlers.get("cbe:wiki:ingest")!;
}

/** The picker has already returned one file — the pre-flight is next. */
async function pickOneFile(): Promise<void> {
  const { dialog } = await import("electron");
  const picked = path.join(h.paths.userData, "skript.md");
  writeFileSync(picked, "# Skript\n", "utf8");
  (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({ canceled: false, filePaths: [picked] });
}

let ingest: IpcHandler;

// Registered ONCE, with a raised timeout: importing `src/main/ipc.ts` pulls the
// whole main-process module graph, which takes seconds on a loaded machine and
// blows vitest's 5 s default when done per test. Nothing here carries state
// between cases — the config and the course are fixtures, and the two things a
// case does own (the stubbed `fetch`, the recorded store calls) are reset in
// `beforeEach`. A refused run never reaches the handler's abort controller, so
// no run-level singleton leaks either.
beforeAll(async () => {
  h.paths.userData = mkdtempSync(path.join(os.tmpdir(), "cbe-preflight-"));
  writeFileSync(
    path.join(h.paths.userData, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://127.0.0.1:9/v1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
  const course = await createCourse(path.join(h.paths.userData, "courses"), "Kurs");
  await writeActiveCourseId(path.join(h.paths.userData, "workspace-state.json"), course.id);
  ingest = await ingestHandler();
}, 60_000);

afterAll(() => {
  rmSync(h.paths.userData, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.unstubAllGlobals();
  h.stored.length = 0;
  await pickOneFile();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A rejected `fetch` as the runtime produces one: the transport error carries
 * the code and is wrapped in the thrown `TypeError`. */
function transportFailure(code: string): Error {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code}`), { code }) });
}

describe("the wiki ingest's connection pre-flight", () => {
  // Scenario: An unreachable endpoint refuses the ingest before anything is stored
  it("refuses a refused connection with a named cause, before anything is stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw transportFailure("ECONNREFUSED");
      })
    );
    await expect(ingest(undefined)).rejects.toThrow(/not reachable/i);
    expect(h.stored).toEqual([]);
  });

  // Scenario: An unreachable endpoint refuses the ingest before anything is stored
  //
  // One case per shape of "an answer was received and the answer is no": the name
  // does not resolve, and the host or network cannot be routed to. The second is
  // the endpoint on another machine that is switched off — without the refusal
  // its documents are copied into `inbox/`, extracted into `raw/` and then wait
  // out the full silence deadline each, which is the outcome the pre-flight
  // exists to prevent.
  it("refuses a name that does not resolve and a host that cannot be routed to, for the same reason", async () => {
    for (const code of ["ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]) {
      h.stored.length = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw transportFailure(code);
        })
      );
      await expect(ingest(undefined)).rejects.toThrow(/not reachable/i);
      expect(h.stored).toEqual([]);
    }
  });

  // Scenario: An endpoint that answers is never refused by the pre-flight
  it("lets a rejected key through — that is a credential fact, not a reachability one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 }))
    );
    await expect(ingest(undefined)).resolves.toEqual([]);
    expect(h.stored).toEqual(["skript.md"]);
  });

  // Scenario: An endpoint that answers is never refused by the pre-flight
  it("lets an endpoint without a /models route through — a minimal local server is not unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );
    await expect(ingest(undefined)).resolves.toEqual([]);
    expect(h.stored).toEqual(["skript.md"]);
  });

  // Scenario: An endpoint that answers is never refused by the pre-flight
  //
  // The endpoint is up and busy — a local model loading its weights — and does
  // not answer inside the probe's window, so the probe aborts its own request.
  // That is slowness, not absence: refusing here would turn the pre-flight into
  // the timer this change deliberately does not build, and would fail the very
  // cold-start case the silence deadline exists to tolerate.
  it("lets a slow endpoint through — a probe window elapsing is never a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            // Never answers; only the probe's own abort ends this, exactly as the
            // runtime ends a request whose deadline passed.
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
            );
          })
      )
    );
    await expect(ingest(undefined)).resolves.toEqual([]);
    expect(h.stored).toEqual(["skript.md"]);
  }, 15_000);
});
