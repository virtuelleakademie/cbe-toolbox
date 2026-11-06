/**
 * Main-process tests for the credential-erase path and the test-connection
 * probe — one per Scenario in the `clarify-and-erase-credentials` change's
 * `desktop-app` spec delta (main-process halves; the renderer halves live in
 * settings-credentials.test.tsx).
 *
 * The tests mock electron.safeStorage with a transparent enc()/dec() wrapper so
 * the persisted cipher's plaintext is verifiable by string match (same scaffold
 * as ipc-save-config.test.ts).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { probeConnection } from "../src/main/model-metadata.js";

let tempDir: string;

vi.mock("electron", () => {
  return {
    app: {
      getPath: vi.fn(() => tempDir),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((s: string) => Buffer.from(`enc(${s})`, "utf8")),
      decryptString: vi.fn((buf: Buffer) => {
        const s = buf.toString("utf8");
        const m = s.match(/^enc\((.*)\)$/);
        if (!m) throw new Error("decrypt failed");
        return m[1];
      }),
    },
    BrowserWindow: vi.fn(),
    // `on` beside `handle`: the interface-language read is SYNCHRONOUS
    // (`ipcMain.on` + `event.returnValue`), because the preload reads it while
    // the window loads and cannot await a promise there.
    ipcMain: { handle: vi.fn(), on: vi.fn() },
  };
});

vi.mock("@cbe/pi-bridge", () => ({
  createCitationResolver: vi.fn(),
}));

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
}));

vi.mock("../src/main/sessions.js", () => ({
  writeSessionMd: vi.fn(),
  writeSessionJson: vi.fn(),
}));

type IpcHandler = (e: unknown, ...args: unknown[]) => Promise<unknown>;

async function bootHandlers(): Promise<Map<string, IpcHandler>> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, IpcHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  return handlers;
}

function configPath(): string {
  return path.join(tempDir, "cbe-config.json");
}

function seedPersisted(record: Record<string, unknown>) {
  writeFileSync(configPath(), JSON.stringify(record));
}

function readPersisted(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), "utf8"));
}

describe("main-process credential erasure (cbe:config:erase)", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-erase-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Covers Scenario: *Lecturer erases the stored API key and sees confirmation*
  // (main-process half): the persisted cipher is REMOVED from the record — not
  // overwritten with an empty-string cipher — and the configured-state check
  // (cbe:config:get) reports no key present afterwards.
  it("erases the stored API key: cipher record removed (not empty-string) and configured-state reports no key", async () => {
    seedPersisted({
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "Qwen3.6-35B-A3B-4bit",
      apiKeyCipher: Buffer.from("enc(secret-key-123)", "utf8").toString("base64"),
      contextLength: 65_536,
    });
    const handlers = await bootHandlers();
    const erase = handlers.get("cbe:config:erase")!;
    const get = handlers.get("cbe:config:get")!;

    const result = (await erase(undefined)) as { ok: true; hadKey: boolean };
    expect(result.ok).toBe(true);
    expect(result.hadKey).toBe(true);

    const raw = readPersisted();
    // The field is GONE — not present as "" (an empty-string cipher is
    // indistinguishable from a deliberate save and breaks the configured-state
    // check, cf. Requirement: Provider Configuration Input Hygiene).
    expect("apiKeyCipher" in raw).toBe(false);
    expect("apiKeyPlain" in raw).toBe(false);
    // Endpoint + model survive the erase; only the credential is removed.
    expect(raw.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(raw.modelId).toBe("Qwen3.6-35B-A3B-4bit");
    expect(raw.contextLength).toBe(65_536);

    // Configured-state check: no key present → getConfig reports null, so the
    // next session start requires a re-entered key.
    expect(await get(undefined)).toBeNull();
  });

  it("erase with no stored key is a benign no-op (hadKey: false)", async () => {
    const handlers = await bootHandlers();
    const erase = handlers.get("cbe:config:erase")!;
    const result = (await erase(undefined)) as { ok: true; hadKey: boolean };
    expect(result.ok).toBe(true);
    expect(result.hadKey).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });

  it("also removes a plaintext fallback key (apiKeyPlain)", async () => {
    seedPersisted({
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "m",
      apiKeyPlain: "plain-secret",
    });
    const handlers = await bootHandlers();
    await handlers.get("cbe:config:erase")!(undefined);
    const raw = readPersisted();
    expect("apiKeyPlain" in raw).toBe(false);
    expect("apiKeyCipher" in raw).toBe(false);
  });
});

describe("main-process test-connection (cbe:config:test)", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-test-conn-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Covers Scenario: *Test connection verifies the configuration and reports the
  // outcome* (main-process half): the probe runs GET {baseURL}/models with the
  // decrypted persisted key and classifies the result — the key itself never
  // appears in the IPC result.
  it("runs GET {baseURL}/models with the persisted key and reports success on 2xx", async () => {
    seedPersisted({
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "m",
      apiKeyCipher: Buffer.from("enc(probe-key-42)", "utf8").toString("base64"),
    });
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
    vi.stubGlobal("fetch", fetchSpy);

    const handlers = await bootHandlers();
    const result = await handlers.get("cbe:config:test")!(undefined);
    expect(result).toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/v1/models");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer probe-key-42");
    // The result carries no credential material.
    expect(JSON.stringify(result)).not.toContain("probe-key-42");
  });

  it("classifies a 401 as unauthorized", async () => {
    seedPersisted({
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "m",
      apiKeyCipher: Buffer.from("enc(k)", "utf8").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    );
    const handlers = await bootHandlers();
    const result = await handlers.get("cbe:config:test")!(undefined);
    expect(result).toEqual({ ok: false, cause: "unauthorized", status: 401 });
  });

  it("classifies a network failure as unreachable", async () => {
    seedPersisted({
      baseURL: "http://127.0.0.1:9999/v1",
      modelId: "m",
      apiKeyCipher: Buffer.from("enc(k)", "utf8").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const handlers = await bootHandlers();
    const result = await handlers.get("cbe:config:test")!(undefined);
    expect(result).toEqual({ ok: false, cause: "unreachable" });
  });

  it("reports not-configured when no connection is persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("probe MUST NOT run without a persisted config");
      })
    );
    const handlers = await bootHandlers();
    const result = await handlers.get("cbe:config:test")!(undefined);
    expect(result).toEqual({ ok: false, cause: "not-configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("probeConnection — classification of the /models probe", () => {
  it("returns ok on a 2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({ ok: true });
  });

  it("returns unauthorized on 401 and 403", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status })) as unknown as typeof fetch;
      expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({
        ok: false,
        cause: "unauthorized",
        status,
      });
    }
  });

  it("returns http-error with the status for other non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({
      ok: false,
      cause: "http-error",
      status: 500,
    });
  });

  it("returns unreachable when the fetch rejects, and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({ ok: false, cause: "unreachable" });
  });

  // The settings surface reads `cause` and nothing else, so both of the next two
  // report `unreachable` to it exactly as before. `definiteNegative` is the extra
  // fact the wiki ingest's pre-flight needs: only a refused connection or an
  // unresolvable name proves the endpoint is not there, while a slow endpoint —
  // this probe aborting its own request — has only failed to answer YET.
  it("marks a refused connection and an unresolvable name as a definite negative", async () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code}`), { code }) });
      }) as unknown as typeof fetch;
      expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({
        ok: false,
        cause: "unreachable",
        definiteNegative: true,
      });
    }
  });

  it("does not mark an aborted (slow) request as a definite negative", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    expect(await probeConnection("http://h/v1", "k", fetchImpl)).toEqual({ ok: false, cause: "unreachable" });
  });

  it("joins the /models path without doubling slashes", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    await probeConnection("http://h/v1/", "k", fetchImpl);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://h/v1/models");
  });
});
