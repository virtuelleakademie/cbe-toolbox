/**
 * Newly ingested wiki atoms reach the model on the next lecturer turn — the FULL
 * chain, main-process side (capability `agent-harness`, Requirement: *Newly Ingested
 * Wiki Atoms Are Disclosed on the Next Lecturer Turn*).
 *
 * Material arrives mid-session, and before this change nothing told a running
 * conversation about it: the atoms landed on disk and the model went on working from
 * whatever it had. Two halves are proved here, against the REAL IPC handlers:
 *
 *   ingest (`cbe:wiki:ingest`) → atoms reported to the course's open session
 *   next lecturer turn (`cbe:prompt`) → the notice prefixed to the payload, once
 *
 * The mocked `AgentManager` delegates to a REAL `WikiRetrievalGate` through the REAL
 * compose helper, exactly as the manager does — the same discipline as
 * `step-focus-host-channel.test.ts` next door, whose shape this file follows.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeTurnStop } from "./helpers/turn-stop-fake.js";
import { ToolCardRecorder } from "../src/shared/design-cards.js";
import { WikiRetrievalGate, composePayloadWithWikiAtomsNotice, type PendingWikiAtomsNotice } from "@cbe/pi-bridge";

const h = vi.hoisted(() => {
  // `vi.hoisted` runs before the imports above, so no imported binding is reachable
  // here — the paths are assembled from strings.
  const root = `${process.env.TMPDIR ?? "/tmp"}/cbe-wiki-atoms-${process.pid}`.replace(/\/+/g, "/");
  const fakeSession = {
    inFlight: false,
    transcript: [] as Array<{ role: string; text: string; display?: { text: string } }>,
    env: { affordances: {} as Record<string, boolean> },
    draft: "",
    session: { prompt: vi.fn<(text: string) => Promise<void>>() },
  };
  return {
    fakeSession,
    root,
    coursesRoot: `${root}/courses`,
    userData: `${root}/userData`,
    workspaceState: `${root}/workspace-state.json`,
    picked: { canceled: false, filePaths: [] as string[] },
    atomization: { outcomes: [] as Array<Record<string, unknown>> },
    /** Every `recordWikiAtoms(courseId, atoms)` the ingest handler made. */
    recorded: [] as Array<{ courseId: string; atoms: string[] }>,
  };
});

Object.assign(h.fakeSession, { turnStop: fakeTurnStop(h.fakeSession) });
// Same reason, same place: every live session carries the per-run design-record
// card buffer the prompt handler resets and promotes (capability `agent-harness`,
// Requirement: *Sessions as Local Markdown/JSON Files*). The REAL recorder — this
// fixture makes no design-record call, so it stays empty and the promotion behaves
// exactly as it did before the buffer existed.
Object.assign(h.fakeSession, { cardRecorder: new ToolCardRecorder() });

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => h.userData), getVersion: vi.fn(() => "0.0.0-test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8")),
  },
  BrowserWindow: vi.fn(),
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => h.picked), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

/** The real host state the mocked AgentManager delegates to. */
const gate = new WikiRetrievalGate();

vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return {
    ...actual,
    createCitationResolver: vi.fn(),
    // Atomization is the subagent workflow; this test is about what the HOST does
    // with the outcomes it produces, so the run itself is stubbed.
    createPiAtomizationSessionFactory: vi.fn(() => ({})),
    runAtomization: vi.fn(async () => h.atomization.outcomes),
    readWikiSkillVersion: vi.fn(async () => "1.0.0"),
  };
});

vi.mock("../src/main/wiki-store.js", () => ({
  extractorId: () => "test-extractor@0.0.0",
  ingestIntoCourse: vi.fn(async (_dir: string, files: Array<{ filename: string }>) =>
    files.map((f) => ({ ok: true as const, filename: f.filename, rawRelPath: `raw/${f.filename}.md` }))
  ),
  setRawStatus: vi.fn(async () => {}),
  writeReflectionLog: vi.fn(async () => {}),
}));

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
    composePromptWithStepFocus(_id: string, text: string) {
      return text;
    }
    pendingStepFocus() {
      return null;
    }
    requeueStepFocus() {}
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
    // The four paths under test, wired exactly as the real manager wires them.
    recordWikiAtoms(courseId: string, atoms: readonly string[]) {
      h.recorded.push({ courseId, atoms: [...atoms] });
      if (atoms.length === 0) return;
      gate.recordIngestedAtoms(atoms);
    }
    pendingWikiAtoms(): PendingWikiAtomsNotice | null {
      return gate.pendingAtoms();
    }
    composePromptWithWikiAtoms(_id: string, text: string) {
      return composePayloadWithWikiAtomsNotice(gate.drainAtomsNotice(), text);
    }
    requeueWikiAtoms(_id: string, notice: PendingWikiAtomsNotice | null) {
      gate.requeueAtomsNotice(notice);
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
  SESSIONS_DIR: path.join(h.root, "sessions"),
  resolveResource: (s: string) => path.join(h.root, "resources", s),
  COURSES_ROOT: h.coursesRoot,
  WORKSPACE_STATE_PATH: h.workspaceState,
  CORPUS_UPDATER_PATHS: { cacheRoot: path.join(h.root, "c"), bundledDir: path.join(h.root, "b") },
  currentCorpusDir: () => path.join(h.root, "corpus"),
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

async function handlers(): Promise<{ ingest: IpcHandler; prompt: IpcHandler }> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const map = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    map.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return { ingest: map.get("cbe:wiki:ingest")!, prompt: map.get("cbe:prompt")! };
}

function lastPayload(): string {
  const calls = h.fakeSession.session.prompt.mock.calls;
  return calls[calls.length - 1]![0];
}

beforeEach(async () => {
  // The ingest pre-flights the model endpoint before it stores anything
  // (capability `lecturer-wiki`, Requirement: An Ingest That Cannot Reach the
  // Model Fails Visibly and Stays Retryable). The configured endpoint below is
  // a placeholder no server answers, so a reachable one is stubbed here — this
  // file is about what an ingest DISCLOSES, not about reaching the model.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
  );
  await mkdir(h.userData, { recursive: true });
  await mkdir(h.coursesRoot, { recursive: true });
  await mkdir(path.join(h.root, "material"), { recursive: true });
  await writeFile(
    path.join(h.userData, "cbe-config.json"),
    JSON.stringify({ baseURL: "http://localhost/v1", modelId: "test-model", apiKeyPlain: "k" }),
    "utf8"
  );
  await writeFile(path.join(h.root, "material", "skript.pdf"), "%PDF\n", "utf8");
  h.picked = { canceled: false, filePaths: [path.join(h.root, "material", "skript.pdf")] };
  h.atomization.outcomes = [];
  h.recorded.length = 0;
  h.fakeSession.inFlight = false;
  h.fakeSession.transcript = [];
  h.fakeSession.draft = "";
  h.fakeSession.session.prompt.mockReset();
  h.fakeSession.session.prompt.mockResolvedValue(undefined);
  gate.drainAtomsNotice();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(h.root, { recursive: true, force: true });
});

describe("Newly Ingested Wiki Atoms Are Disclosed on the Next Lecturer Turn", () => {
  // Scenario: Atoms landed mid-session reach the model on the next turn
  it("discloses the atoms an ingestion landed on the next lecturer turn", async () => {
    const { ingest, prompt } = await handlers();
    h.atomization.outcomes = [
      { rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["concept/cognitive-load", "method/jigsaw"] },
    ];

    await ingest(undefined);

    // The handler reported the landed atoms to the course, before any agent turn ran.
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]!.atoms).toEqual(["concept/cognitive-load", "method/jigsaw"]);
    expect(h.fakeSession.session.prompt).not.toHaveBeenCalled();

    await prompt(undefined, {
      sessionId: "s1",
      text: "Und was heisst das für Woche 3?",
      display: { text: "Und was heisst das für Woche 3?" },
    });

    const payload = lastPayload();
    expect(payload.startsWith("[wiki-atoms]")).toBe(true);
    expect(payload).toContain("2 atoms");
    expect(payload).toContain("concept/cognitive-load, method/jigsaw");
    expect(payload.endsWith("Und was heisst das für Woche 3?")).toBe(true);
    // Lossless transcript, renderer-only display/payload split.
    expect(h.fakeSession.transcript[0]!.text).toBe(payload);
    expect(h.fakeSession.transcript[0]!.display?.text).toBe("Und was heisst das für Woche 3?");
  });

  it("drains the notice exactly once — the following turn carries none", async () => {
    const { ingest, prompt } = await handlers();
    h.atomization.outcomes = [{ rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["concept/a"] }];
    await ingest(undefined);

    await prompt(undefined, { sessionId: "s1", text: "erste" });
    await prompt(undefined, { sessionId: "s1", text: "zweite" });

    expect(h.fakeSession.session.prompt.mock.calls[0]![0].startsWith("[wiki-atoms]")).toBe(true);
    expect(h.fakeSession.session.prompt.mock.calls[1]![0]).toBe("zweite");
  });

  // Scenario: A notice drained into a refused payload is given back
  it("returns an undelivered notice for the retry", async () => {
    const { ingest, prompt } = await handlers();
    h.atomization.outcomes = [{ rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["concept/a"] }];
    await ingest(undefined);
    h.fakeSession.session.prompt.mockRejectedValueOnce(new Error("Agent is already processing a message"));

    await expect(prompt(undefined, { sessionId: "s1", text: "weiter" })).rejects.toThrow(/already processing/);
    expect(h.fakeSession.transcript).toHaveLength(0);
    expect(gate.pendingAtoms()).toEqual({ atoms: ["concept/a"] });

    await prompt(undefined, { sessionId: "s1", text: "weiter" });
    expect(lastPayload().startsWith("[wiki-atoms]")).toBe(true);

    await prompt(undefined, { sessionId: "s1", text: "danach" });
    expect(lastPayload()).toBe("danach");
  });

  // Scenario: An ingestion that lands no atoms says nothing
  it("says nothing when a run landed no atom", async () => {
    const { ingest, prompt } = await handlers();
    h.atomization.outcomes = [
      { rawRelPath: "raw/skript.pdf.md", status: "failed", atoms: [], error: "provider exploded" },
    ];

    await ingest(undefined);

    // A failed document never reaches the disclosure path at all.
    expect(h.recorded).toHaveLength(0);
    await prompt(undefined, { sessionId: "s1", text: "weiter" });
    expect(lastPayload()).toBe("weiter");
  });

  // Scenario: The first atom read after an ingestion goes through the index again
  it("invalidates a delivered index when atoms land", async () => {
    const { ingest } = await handlers();
    gate.markIndexDelivered();
    expect(gate.requiresIndex()).toBe(false);

    h.atomization.outcomes = [{ rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["concept/a"] }];
    await ingest(undefined);

    expect(gate.requiresIndex()).toBe(true);
  });

  it("accumulates two runs between two turns into one notice", async () => {
    const { ingest, prompt } = await handlers();
    h.atomization.outcomes = [{ rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["concept/a"] }];
    await ingest(undefined);
    h.atomization.outcomes = [{ rawRelPath: "raw/skript.pdf.md", status: "done", atoms: ["method/b"] }];
    await ingest(undefined);

    await prompt(undefined, { sessionId: "s1", text: "weiter" });

    const payload = lastPayload();
    expect(payload.match(/\[wiki-atoms\]/g)?.length).toBe(1);
    expect(payload).toContain("concept/a, method/b");
  });
});
