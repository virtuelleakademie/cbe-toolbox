/**
 * Electron wiring of the first-run seed (capability `desktop-app`, Requirement:
 * Build-Time Default Connection Configuration): `seedDefaultConnection` binds
 * CONFIG_PATH, the bundled resource path and safeStorage; afterwards
 * `cbe:config:get` reports the seeded record like a hand-entered one, and an
 * erasure followed by a restart stays erased. A public build has no bundled
 * default, remains unconfigured, and does not invoke safeStorage merely to
 * seed a key.
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let tempDir: string;
let resourcesDir: string;

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tempDir) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`, "utf8")),
    decryptString: vi.fn((buf: Buffer) => {
      const m = buf.toString("utf8").match(/^enc\((.*)\)$/);
      if (!m) throw new Error("decrypt failed");
      return m[1];
    }),
  },
  BrowserWindow: vi.fn(),
  // `on` beside `handle`: the interface-language read is SYNCHRONOUS
  // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
  // the window loads and cannot await a promise there.
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("@cbe/pi-bridge", () => ({ createCitationResolver: vi.fn() }));

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
  resolveResource: (s: string) => path.join(resourcesDir, s),
}));

vi.mock("../src/main/sessions.js", () => ({ writeSessionMd: vi.fn(), writeSessionJson: vi.fn() }));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;
let handlers: Map<string, IpcHandler>;
let seedDefaultConnection: () => Promise<string>;

// The per-test temp dirs are created AFTER the module graph loads: CONFIG_PATH
// is computed at import time from app.getPath, so the stable root is fixed here
// and only its content is reset per test.
beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-seed-ipc-"));
  resourcesDir = path.join(tempDir, "resources");
  const ipc = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  handlers = new Map();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  ipc.registerIpc({ webContents: { send: vi.fn() } } as never);
  seedDefaultConnection = ipc.seedDefaultConnection;
}, 30_000);

beforeEach(() => {
  rmSync(path.join(tempDir, "cbe-config.json"), { force: true });
  rmSync(resourcesDir, { recursive: true, force: true });
  mkdirSync(path.join(resourcesDir, "defaults"), { recursive: true });
});
afterEach(() => {
  rmSync(path.join(tempDir, "cbe-config.json"), { force: true });
});

const bundle = (apiKey: string) =>
  writeFileSync(path.join(resourcesDir, "defaults", "default-llm.json"), JSON.stringify({ apiKey }));

describe("seedDefaultConnection through Electron", () => {
  it("reports the seeded record as configured with a key present", async () => {
    bundle("sk-or-seeded");
    expect(await seedDefaultConnection()).toBe("seeded");
    const status = await handlers.get("cbe:config:get")!(null);
    expect(status).toEqual({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "google/gemma-4-31b-it",
      hasKey: true,
      contextLength: 131072,
      reasoning: true,
      reasoningEffort: "medium",
    });
  });

  it("starts unconfigured without a bundled file and does not call safeStorage", async () => {
    const { safeStorage } = await import("electron");
    const isEncryptionAvailable = safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>;
    const encryptString = safeStorage.encryptString as ReturnType<typeof vi.fn>;
    const decryptString = safeStorage.decryptString as ReturnType<typeof vi.fn>;
    isEncryptionAvailable.mockClear();
    encryptString.mockClear();
    decryptString.mockClear();

    expect(await seedDefaultConnection()).toBe("no-defaults");
    expect(await handlers.get("cbe:config:get")!(null)).toBeNull();
    expect(isEncryptionAvailable).not.toHaveBeenCalled();
    expect(encryptString).not.toHaveBeenCalled();
    expect(decryptString).not.toHaveBeenCalled();
  });

  it("keeps an erasure across a restart with the same bundled defaults", async () => {
    bundle("sk-or-seeded");
    await seedDefaultConnection();
    expect(await handlers.get("cbe:config:erase")!(null)).toEqual({ ok: true, hadKey: true });
    // "Restart": the seed runs again against the same bundle.
    expect(await seedDefaultConnection()).toBe("kept");
    expect(await handlers.get("cbe:config:get")!(null)).toBeNull();
  });
});
