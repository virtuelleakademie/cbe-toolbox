/**
 * First-run seed of the provider record — one test per Scenario of capability
 * `desktop-app`, Requirement: Build-Time Default Connection Configuration
 * (change preconfigure-the-llm-at-build-time). Pure file-system tests; the
 * Electron wiring is covered in default-connection-ipc.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  seedDefaultConnectionConfig,
  readBundledDefaults,
  DEFAULT_CONNECTION,
} from "../src/main/default-connection.js";

let dir: string;
const encryptKey = vi.fn((k: string) => ({ apiKeyCipher: Buffer.from(`enc(${k})`).toString("base64") }));
const cfg = () => path.join(dir, "cbe-config.json");
const defaults = () => path.join(dir, "default-llm.json");
const seed = () => seedDefaultConnectionConfig({ configPath: cfg(), defaultsPath: defaults(), encryptKey });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cbe-default-connection-"));
  encryptKey.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Build-Time Default Connection Configuration", () => {
  it("seeds a fresh install from the bundled defaults", async () => {
    writeFileSync(defaults(), JSON.stringify({ apiKey: "sk-or-seed" }));
    expect(await seed()).toBe("seeded");
    const record = JSON.parse(readFileSync(cfg(), "utf8"));
    expect(record).toEqual({
      baseURL: "https://openrouter.ai/api/v1",
      modelId: "google/gemma-4-31b-it",
      apiKeyCipher: encryptKey("sk-or-seed").apiKeyCipher,
      contextLength: 131072,
      reasoning: true,
      reasoningEffort: "medium",
    });
    expect(DEFAULT_CONNECTION.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("seeds into a userData directory that does not exist yet", async () => {
    writeFileSync(defaults(), JSON.stringify({ apiKey: "sk-or-seed" }));
    const configPath = path.join(dir, "fresh", "userData", "cbe-config.json");
    expect(existsSync(path.dirname(configPath))).toBe(false);
    expect(await seedDefaultConnectionConfig({ configPath, defaultsPath: defaults(), encryptKey })).toBe("seeded");
    expect(JSON.parse(readFileSync(configPath, "utf8")).modelId).toBe("google/gemma-4-31b-it");
  });

  it("leaves an existing encrypted configuration byte-for-byte untouched on update", async () => {
    writeFileSync(defaults(), JSON.stringify({ apiKey: "sk-or-new-seed" }));
    const existing = [
      "{",
      '  "baseURL": "https://provider.example/v1",',
      '  "modelId": "existing-model",',
      '  "apiKeyCipher": "ZXhpc3RpbmctZW5jcnlwdGVkLWtleQ==",',
      '  "contextLength": 65536',
      "}",
      "",
    ].join("\n");
    writeFileSync(cfg(), existing);

    expect(await seed()).toBe("kept");
    expect(readFileSync(cfg(), "utf8")).toBe(existing);
    expect(encryptKey).not.toHaveBeenCalled();
  });

  it("starts unconfigured when no defaults were bundled", async () => {
    expect(await seed()).toBe("no-defaults");
    expect(existsSync(cfg())).toBe(false);
    // Malformed or blank files are the same as none.
    writeFileSync(defaults(), "not json");
    expect(await seed()).toBe("no-defaults");
    writeFileSync(defaults(), JSON.stringify({ apiKey: "  " }));
    expect(await seed()).toBe("no-defaults");
    expect(await readBundledDefaults(defaults())).toBeNull();
    expect(existsSync(cfg())).toBe(false);
  });

  it("keeps a user edit over the seed across restarts", async () => {
    writeFileSync(defaults(), JSON.stringify({ apiKey: "sk-or-seed" }));
    expect(await seed()).toBe("seeded");
    // The lecturer changes the model and later erases the key (what saveConfig / erase write).
    const record = JSON.parse(readFileSync(cfg(), "utf8"));
    record.modelId = "qwen/qwen3.6-35b-a3b";
    delete record.apiKeyCipher;
    const edited = JSON.stringify(record, null, 2);
    writeFileSync(cfg(), edited);
    expect(await seed()).toBe("kept");
    expect(readFileSync(cfg(), "utf8")).toBe(edited);
  });
});
