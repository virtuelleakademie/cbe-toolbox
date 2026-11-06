/**
 * Main-process saveConfig tests — one per Scenario in the
 * `fix-provider-config-persistence` change's `desktop-app` spec delta.
 *
 * The tests mock electron.safeStorage with a transparent enc()/dec() wrapper
 * so the persisted cipher's plaintext is verifiable by string match. The
 * actual macOS Keychain-backed safeStorage is exercised in integration tests
 * outside CI.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

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

type SetConfigHandler = (e: unknown, dto: unknown) => Promise<unknown>;

async function bootHandler(): Promise<SetConfigHandler> {
  const { registerIpc } = await import("../src/main/ipc.js");
  const { ipcMain } = await import("electron");
  const handlers = new Map<string, SetConfigHandler>();
  (ipcMain.handle as ReturnType<typeof vi.fn>).mockImplementation((channel: string, fn: SetConfigHandler) => {
    handlers.set(channel, fn);
  });
  registerIpc({ webContents: { send: vi.fn() } } as never);
  const h = handlers.get("cbe:config:set");
  if (!h) throw new Error("configSet handler did not register");
  return h;
}

function configPath(): string {
  return path.join(tempDir, "cbe-config.json");
}

function readPersisted(): {
  baseURL: string;
  modelId: string;
  apiKeyCipher?: string;
  apiKeyPlain?: string;
  contextLength?: number;
  reasoning?: boolean;
  reasoningEffort?: string;
} {
  return JSON.parse(readFileSync(configPath(), "utf8"));
}

describe("main-process saveConfig — apiKey persistence", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Covers Scenario: *Settings save with a re-entered apiKey overwrites the
  // existing cipher* (the canonical happy path; also doubles as a regression
  // anchor for the original failing-test seed from Phase-1).
  it("persists a non-empty apiKey as apiKeyCipher when safeStorage is available", async () => {
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "test-key-1234567890",
      modelId: "Qwen3.6-35B-A3B-4bit",
    });

    const raw = readPersisted();
    expect(raw.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(raw.modelId).toBe("Qwen3.6-35B-A3B-4bit");
    expect(raw.apiKeyCipher).toBeDefined();
    const { safeStorage } = await import("electron");
    expect(safeStorage.decryptString(Buffer.from(raw.apiKeyCipher!, "base64"))).toBe("test-key-1234567890");
  });

  // Covers Scenario: *Settings save preserves the existing apiKey when the field
  // is left blank and the endpoint is unchanged*. DTO omits `apiKey` and keeps the
  // SAME baseURL — the main process preserves the persisted cipher. (Under
  // fix-provider-endpoint-hygiene the preserve contract is scoped to the same
  // endpoint; a changed baseURL with an omitted key is refused — see the dedicated
  // scenario test in the endpoint-identity reset describe block below.)
  it("preserves the existing apiKeyCipher when DTO.apiKey is omitted on a same-endpoint save", async () => {
    // Seed an existing persisted record with a known cipher.
    writeFileSync(
      configPath(),
      JSON.stringify({
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "old-model",
        apiKeyCipher: Buffer.from("enc(preserved-key-XYZ)", "utf8").toString("base64"),
      })
    );

    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1", // SAME endpoint — only the model changes
      modelId: "new-model",
      // apiKey deliberately omitted
    });

    const raw = readPersisted();
    expect(raw.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(raw.modelId).toBe("new-model");
    expect(raw.apiKeyCipher).toBe(Buffer.from("enc(preserved-key-XYZ)", "utf8").toString("base64"));
  });

  // Covers Scenario: *Main process refuses an explicitly empty apiKey*.
  it("throws EmptyApiKeyError when DTO.apiKey === '' AND does not write the file", async () => {
    const handler = await bootHandler();
    // Pre-condition: no file yet.
    expect(existsSync(configPath()), "pre-condition: no config file").toBe(false);

    await expect(
      handler(undefined, {
        baseURL: "http://127.0.0.1:8000/v1",
        apiKey: "",
        modelId: "Qwen3.6-35B-A3B-4bit",
      })
    ).rejects.toThrow(/empty/i);

    expect(existsSync(configPath()), "file MUST NOT be written when apiKey is empty").toBe(false);
  });

  // Defence in depth: an apiKey that sanitises to empty (e.g. `""`) also
  // throws. The renderer dialogs prevent this case from reaching the main
  // process, but the main-process check is the second line.
  it("throws when DTO.apiKey is matched-quote-only (sanitises to empty)", async () => {
    const handler = await bootHandler();
    await expect(
      handler(undefined, {
        baseURL: "http://127.0.0.1:8000/v1",
        apiKey: '""',
        modelId: "Qwen3.6-35B-A3B-4bit",
      })
    ).rejects.toThrow(/empty/i);
    expect(existsSync(configPath())).toBe(false);
  });

  it("throws when DTO.apiKey is omitted AND no existing record exists", async () => {
    const handler = await bootHandler();
    expect(existsSync(configPath())).toBe(false);

    await expect(
      handler(undefined, {
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "Qwen3.6-35B-A3B-4bit",
      })
    ).rejects.toThrow(/no existing apikey/i);
  });
});

describe("main-process saveConfig — contextLength persistence", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-ctx-"));
    vi.resetModules();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists a positive contextLength from the DTO", async () => {
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "local-64k",
      contextLength: 65_536,
    });
    expect(readPersisted().contextLength).toBe(65_536);
  });

  it("preserves the existing contextLength when the DTO omits it on a same-endpoint partial update", async () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "old",
        apiKeyCipher: Buffer.from("enc(key)", "utf8").toString("base64"),
        contextLength: 65_536,
      })
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1", // SAME endpoint
      modelId: "new",
      // apiKey + contextLength deliberately omitted
    });
    expect(readPersisted().contextLength).toBe(65_536);
  });

  it("drops a non-positive contextLength so the provider default applies (no tiny window persisted)", async () => {
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "m",
      contextLength: 0,
    });
    expect(readPersisted().contextLength).toBeUndefined();
  });
});

describe("main-process saveConfig — reasoning persistence + metadata default", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-reason-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** A `/models` fetch stub that returns the OpenRouter shape for `id`. */
  function stubModelsFetch(rows: Array<{ id: string; supported_parameters?: string[] }>) {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: rows }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  // Covers Provider Reasoning Configuration: *Reasoning toggle and effort persist*
  // (the explicit-choice path: an explicit reasoning:true / effort persists verbatim).
  it("persists an explicit reasoning + reasoningEffort from the DTO", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("probe MUST NOT run when the lecturer set the control explicitly");
      })
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "k",
      modelId: "m",
      reasoning: true,
      reasoningEffort: "high",
    });
    const raw = readPersisted();
    expect(raw.reasoning).toBe(true);
    expect(raw.reasoningEffort).toBe("high");
  });

  // Covers Provider Reasoning Configuration: *OpenRouter model that advertises
  // reasoning defaults the toggle on*.
  it("defaults reasoning ON at medium when /models advertises reasoning support and the lecturer didn't set it", async () => {
    stubModelsFetch([{ id: "qwen/qwen3.6-35b-a3b", supported_parameters: ["reasoning", "tools"] }]);
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "k",
      modelId: "qwen/qwen3.6-35b-a3b",
      // reasoning deliberately omitted
    });
    const raw = readPersisted();
    expect(raw.reasoning).toBe(true);
    expect(raw.reasoningEffort).toBe("medium");
  });

  // Covers Provider Reasoning Configuration: *Endpoint without capability metadata
  // keeps the conservative default*.
  it("keeps reasoning OFF (omitted) when /models exposes only the minimal OpenAI shape", async () => {
    stubModelsFetch([{ id: "local-model" }]); // no supported_parameters
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: "k",
      modelId: "local-model",
    });
    const raw = readPersisted();
    expect(raw.reasoning).toBeUndefined();
    expect(raw.reasoningEffort).toBeUndefined();
  });

  // Covers Provider Reasoning Configuration: *Explicit lecturer choice overrides the
  // metadata default*.
  it("keeps reasoning:false when the lecturer set OFF even though the model advertises support", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("probe MUST NOT run for an explicit OFF choice");
      })
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "k",
      modelId: "qwen/qwen3.6-35b-a3b",
      reasoning: false,
    });
    const raw = readPersisted();
    expect(raw.reasoning).toBe(false);
  });

  // Covers the design's non-fatal probe contract: a failing /models call must not
  // block the save (reasoning falls back to the conservative default).
  it("a failing /models probe does not block the save (conservative default OFF)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "k",
      modelId: "qwen/qwen3.6-35b-a3b",
    });
    const raw = readPersisted();
    expect(raw.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(raw.reasoning).toBeUndefined();
  });

  // Covers Provider Reasoning Configuration Scenario: *Same-endpoint partial
  // update preserves the reasoning setting*. A partial update with the reasoning
  // control untouched AND the same baseURL keeps the persisted value (mirrors
  // apiKey / contextLength).
  it("Same-endpoint partial update preserves the reasoning setting", async () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        baseURL: "https://openrouter.ai/api/v1",
        modelId: "old",
        apiKeyCipher: Buffer.from("enc(key)", "utf8").toString("base64"),
        reasoning: true,
        reasoningEffort: "low",
      })
    );
    // Probe MUST NOT run on the preserve path.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("probe MUST NOT run when a reasoning value is already persisted");
      })
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "new",
      // reasoning + apiKey deliberately omitted
    });
    const raw = readPersisted();
    expect(raw.reasoning).toBe(true);
    expect(raw.reasoningEffort).toBe("low");
  });
});

// Endpoint-identity reset (fix-provider-endpoint-hygiene): a save that CHANGES the
// sanitised baseURL must refuse an omitted key and reset endpoint-calibrated state
// (reasoning / contextLength) instead of carrying it to the new host. This is the
// defect class that surfaced as a 400 against a strict LiteLLM proxy (gpt-oss),
// where a reasoning:true calibrated for OpenRouter sent reasoning_effort to a host
// that rejects the parameter.
describe("main-process saveConfig — endpoint-identity reset on baseURL change", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "cbe-ipc-endpoint-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function seedPersisted(record: Record<string, unknown>) {
    writeFileSync(configPath(), JSON.stringify(record));
  }

  // Covers Scenario: *Main process refuses a changed base URL without a key*.
  it("Main process refuses a changed base URL without a key", async () => {
    seedPersisted({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "qwen/qwen3.6-35b-a3b",
      apiKeyCipher: Buffer.from("enc(old-endpoint-key)", "utf8").toString("base64"),
      reasoning: true,
      reasoningEffort: "medium",
    });
    const before = readFileSync(configPath(), "utf8");
    // The probe MUST NOT run — the throw happens before any persistence or probe call.
    const fetchSpy = vi.fn(async () => {
      throw new Error("probe MUST NOT run when the changed-baseURL save is refused");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const handler = await bootHandler();
    await expect(
      handler(undefined, {
        baseURL: "https://inference.example.org/api/v1", // changed endpoint
        modelId: "gpt-oss:120b",
        // apiKey deliberately omitted
      })
    ).rejects.toThrow(/key required for the new endpoint/i);

    // On-disk config is unchanged; the stored key was never sent anywhere.
    expect(readFileSync(configPath(), "utf8")).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Covers Scenario: *Base-URL change resets a stale reasoning setting*. The
  // persisted reasoning:true (calibrated for OpenRouter) is cleared; the probe
  // re-runs against the NEW endpoint with the just-entered key (never the stored
  // one). The new endpoint exposes no reasoning capability → reasoning stays OFF.
  it("Base-URL change resets a stale reasoning setting", async () => {
    seedPersisted({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "qwen/qwen3.6-35b-a3b",
      apiKeyCipher: Buffer.from("enc(old-endpoint-key)", "utf8").toString("base64"),
      reasoning: true,
      reasoningEffort: "high",
    });
    // /models for the new endpoint: minimal OpenAI shape, no supported_parameters.
    const fetchSpy = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-oss:120b" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "https://inference.example.org/api/v1", // changed endpoint
      modelId: "gpt-oss:120b",
      apiKey: "new-endpoint-key", // re-entered for the new endpoint
      // reasoning deliberately untouched
    });

    const raw = readPersisted();
    // Stale reasoning is cleared, not carried over.
    expect(raw.reasoning).toBeUndefined();
    expect(raw.reasoningEffort).toBeUndefined();
    // The probe ran against the NEW endpoint with the NEW key — never the stored one.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://inference.example.org/api/v1/models");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer new-endpoint-key");
  });

  // Covers Scenario: *Base-URL change resets the persisted context length*. A
  // changed baseURL with a blank context-length field clears the persisted value
  // (high-default path); a value entered in the same save persists normally.
  it("Base-URL change resets the persisted context length", async () => {
    seedPersisted({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "old",
      apiKeyCipher: Buffer.from("enc(old-key)", "utf8").toString("base64"),
      contextLength: 65_536,
    });
    // Probe is non-fatal; stub it to a benign empty result.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    );

    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1", // changed endpoint
      modelId: "new",
      apiKey: "new-key", // required for the new endpoint
      // contextLength blank → cleared
    });
    expect(readPersisted().contextLength).toBeUndefined();
  });

  it("a context length entered in the same endpoint-changing save persists normally", async () => {
    seedPersisted({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "old",
      apiKeyCipher: Buffer.from("enc(old-key)", "utf8").toString("base64"),
      contextLength: 65_536,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    );
    const handler = await bootHandler();
    await handler(undefined, {
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "new",
      apiKey: "new-key",
      contextLength: 32_768,
    });
    expect(readPersisted().contextLength).toBe(32_768);
  });
});
