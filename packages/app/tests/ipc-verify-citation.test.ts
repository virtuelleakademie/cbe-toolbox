/**
 * Main-process half of the citation-verification surface (capability `desktop-app`,
 * Requirement: *A Citation Token Is Verified Against the Corpus Before It Is Linked*,
 * Scenario: *Verification runs in the main process over an IPC channel*).
 *
 * The renderer never touches the filesystem, so the answer has to come from here — and
 * it has to come from the SAME verifier `cbe_cite` uses, which is why the handler calls
 * the real `verifyCitation` over a stubbed resolver rather than reimplementing the match.
 *
 * Registration trap (CLAUDE.md): importing `src/main/ipc.ts` pulls the whole main module
 * graph, so the handlers are registered ONCE in `beforeAll` with a raised timeout rather
 * than per test.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { verifyCitation } from "@cbe/pi-bridge/citation-verification";
import type { CitationVerification } from "../src/shared/ipc-contract.js";

let tempDir: string = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-verify-cite-"));

const HEADINGS = ["Phase 1: Engage", "Phase 2: Investigate"];

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tempDir) },
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
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", async () => {
  // The real verifier — the point of the test is that the handler does not carry a
  // second implementation of "does this heading exist".
  const real = await vi.importActual<typeof import("@cbe/pi-bridge/citation-verification")>(
    "@cbe/pi-bridge/citation-verification"
  );
  return {
    verifyCitation: real.verifyCitation,
    createCitationResolver: vi.fn(async () => ({
      getVersion: () => "2026-08",
      resolve: (id: string) => (id === "methodology-001" ? { id, title: "T", path: "p.md", tags: [] } : null),
      parseCitations: () => [],
      loadBody: async () => "",
      resolveSources: async () => [],
      resolveHeadings: async (id: string) => (id === "methodology-001" ? HEADINGS : []),
      listIds: () => ["methodology-001"],
    })),
  };
});

vi.mock("../src/main/agent.js", () => ({
  AgentManager: class {
    listIds() {
      return [];
    }
    dump() {
      return null;
    }
    closeAll() {}
  },
  SESSIONS_DIR: "/tmp/test-sessions",
  resolveResource: (s: string) => `/tmp/test-resources/${s}`,
  currentCorpusDir: () => "/tmp/test-corpus",
}));

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

let verify: IpcHandler;

beforeAll(async () => {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  verify = handlers.get("cbe:verify-citation")!;
  expect(verify, "cbe:verify-citation handler was not registered").toBeTypeOf("function");
}, 30_000);

afterAll(() => {
  if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

async function ask(id: string, section: string | null): Promise<CitationVerification> {
  return (await verify(undefined, { id, section })) as CitationVerification;
}

describe("cbe:verify-citation", () => {
  it("verifies a section that matches a heading and reports the heading verbatim", async () => {
    expect(await ask("methodology-001", "phase 1: engage")).toEqual({
      status: "verified",
      id: "methodology-001",
      section: "phase 1: engage",
      heading: "Phase 1: Engage",
    });
  });

  it("reports an unknown section with the document's actual headings", async () => {
    expect(await ask("methodology-001", "Resonanzstufen")).toEqual({
      status: "unknown-section",
      id: "methodology-001",
      section: "Resonanzstufen",
      headings: HEADINGS,
    });
  });

  it("reports a missing section when the token carried no § element", async () => {
    expect(await ask("methodology-001", null)).toEqual({ status: "missing-section", id: "methodology-001" });
  });

  it("reports an unknown id when the corpus carries no such document", async () => {
    // Distinct from "a document with no headings": the handler passes `null` headings.
    expect(await ask("assessment-991", "Rubric construction")).toEqual({
      status: "unknown-id",
      id: "assessment-991",
    });
  });

  it("answers exactly what the shared verifier answers", async () => {
    for (const section of ["Phase 1: Engage", "§ phase 2: investigate", "1. Phase 1: Engage", "nope", null]) {
      expect(await ask("methodology-001", section)).toEqual(verifyCitation("methodology-001", section, HEADINGS));
    }
  });
});
