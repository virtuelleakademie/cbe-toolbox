import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseRawConfig,
  resolveCalibrationThreshold,
  resolveConfig,
  resolveModel,
  ConfigError,
} from "../src/config.js";

const RAW = {
  candidates: [{ name: "qwen", modelId: "q", baseUrlEnv: "CBE_LLM_BASE_URL", apiKeyEnv: "CBE_LLM_API_KEY" }],
  judge: { name: "judge", modelId: "j", baseUrlEnv: "CBE_JUDGE_BASE_URL", apiKeyEnv: "CBE_JUDGE_API_KEY" },
};

describe("judge calibration threshold", () => {
  it("carries the configured threshold through", () => {
    const cfg = parseRawConfig(JSON.stringify({ ...RAW, judgeCalibration: { threshold: 0.9 } }));
    expect(cfg.judgeCalibration?.threshold).toBe(0.9);
  });

  it("is optional — an absent block leaves the built-in default in charge", () => {
    expect(parseRawConfig(JSON.stringify(RAW)).judgeCalibration).toBeUndefined();
  });

  it("rejects a threshold outside (0, 1]", () => {
    for (const t of [0, -0.1, 1.5, "0.8"]) {
      expect(() => parseRawConfig(JSON.stringify({ ...RAW, judgeCalibration: { threshold: t } }))).toThrow(
        /judgeCalibration.threshold/
      );
    }
  });

  it("rejects a non-object judgeCalibration", () => {
    expect(() => parseRawConfig(JSON.stringify({ ...RAW, judgeCalibration: 0.8 }))).toThrow(/must be an object/);
  });
});

describe("resolveCalibrationThreshold", () => {
  /** A repo root carrying a versioned eval.config.json, as every checkout does. */
  function rootWithConfig(cfg: object): string {
    const root = mkdtempSync(path.join(tmpdir(), "cbe-cfg-"));
    const dir = path.join(root, "evaluation", "cbe-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "eval.config.json"), JSON.stringify(cfg), "utf8");
    return root;
  }

  it("reads the configured threshold on the default candidate path, where no board config is preloaded", () => {
    const root = rootWithConfig({ ...RAW, judgeCalibration: { threshold: 0.9 } });
    expect(resolveCalibrationThreshold(root, undefined, 0.8, {} as NodeJS.ProcessEnv)).toBe(0.9);
  });

  it("prefers the already-loaded board config over re-reading the file", () => {
    const root = rootWithConfig({ ...RAW, judgeCalibration: { threshold: 0.9 } });
    const preloaded = parseRawConfig(JSON.stringify({ ...RAW, judgeCalibration: { threshold: 0.95 } }));
    expect(resolveCalibrationThreshold(root, preloaded, 0.8, {} as NodeJS.ProcessEnv)).toBe(0.95);
  });

  it("falls back to the built-in default when the config names no threshold", () => {
    const root = rootWithConfig(RAW);
    expect(resolveCalibrationThreshold(root, undefined, 0.8, {} as NodeJS.ProcessEnv)).toBe(0.8);
  });

  it("falls back to the built-in default when no config file exists at all", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cbe-cfg-empty-"));
    expect(resolveCalibrationThreshold(root, undefined, 0.8, {} as NodeJS.ProcessEnv)).toBe(0.8);
  });

  it("still reports a malformed threshold rather than silently defaulting", () => {
    const root = rootWithConfig({ ...RAW, judgeCalibration: { threshold: 2 } });
    expect(() => resolveCalibrationThreshold(root, undefined, 0.8, {} as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  // A typo'd override must abort here exactly as it does on the board path — the
  // fallback covers "no configuration anywhere", never a deliberate abort.
  it("propagates an explicit $CBE_EVAL_CONFIG that points at nothing instead of falling back", () => {
    const root = rootWithConfig({ ...RAW, judgeCalibration: { threshold: 0.9 } });
    const env = { CBE_EVAL_CONFIG: path.join(root, "does-not-exist.json") } as NodeJS.ProcessEnv;
    expect(() => resolveCalibrationThreshold(root, undefined, 0.8, env)).toThrow(ConfigError);
    expect(() => resolveCalibrationThreshold(root, undefined, 0.8, env)).toThrow(/does-not-exist\.json/);
  });

  it("honours an explicit $CBE_EVAL_CONFIG that does exist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cbe-cfg-explicit-"));
    const file = path.join(root, "custom.json");
    writeFileSync(file, JSON.stringify({ ...RAW, judgeCalibration: { threshold: 0.95 } }), "utf8");
    expect(resolveCalibrationThreshold(root, undefined, 0.8, { CBE_EVAL_CONFIG: file } as NodeJS.ProcessEnv)).toBe(
      0.95
    );
  });
});

describe("config", () => {
  // spec: Keys are resolved from the environment at runtime
  it("resolves base URL and key from the environment, not the file", () => {
    const env = {
      CBE_LLM_BASE_URL: "https://llm/v1",
      CBE_LLM_API_KEY: "secret-123",
      CBE_JUDGE_BASE_URL: "https://judge/v1",
      CBE_JUDGE_API_KEY: "judge-key",
    } as NodeJS.ProcessEnv;
    const resolved = resolveConfig(RAW, env);
    expect(resolved.candidates[0]!.apiKey).toBe("secret-123");
    expect(resolved.candidates[0]!.baseURL).toBe("https://llm/v1");
    // the raw config itself never carried a key
    expect(JSON.stringify(RAW)).not.toContain("secret-123");
  });

  // spec: Missing key environment variable fails fast with a clear message
  it("fails fast naming the missing variable, before any model is contacted", () => {
    const env = { CBE_LLM_BASE_URL: "https://llm/v1" } as NodeJS.ProcessEnv; // no API key
    expect(() => resolveModel(RAW.candidates[0]!, env)).toThrow(ConfigError);
    expect(() => resolveModel(RAW.candidates[0]!, env)).toThrow(/CBE_LLM_API_KEY/);
  });

  it("rejects a config with no candidates", () => {
    expect(() => parseRawConfig(JSON.stringify({ judge: RAW.judge }))).toThrow(/candidates/);
  });

  it("rejects invalid JSON naming the file", () => {
    expect(() => parseRawConfig("{not json", "eval.config.json")).toThrow(/eval\.config\.json/);
  });

  // spec: reasoning is a per-model option carried from config to the resolved model
  it("carries reasoning and reasoningEffort through to the resolved model", () => {
    const env = { B: "https://api.example/v1", K: "secret-key" } as NodeJS.ProcessEnv;
    const r = resolveModel(
      { name: "m", modelId: "x", baseUrlEnv: "B", apiKeyEnv: "K", reasoning: true, reasoningEffort: "low" },
      env
    );
    expect(r.reasoning).toBe(true);
    expect(r.reasoningEffort).toBe("low");
  });

  it("leaves reasoning fields undefined when the config omits them", () => {
    const env = { B: "https://api.example/v1", K: "secret-key" } as NodeJS.ProcessEnv;
    const r = resolveModel({ name: "m", modelId: "x", baseUrlEnv: "B", apiKeyEnv: "K" }, env);
    expect(r.reasoning).toBeUndefined();
    expect(r.reasoningEffort).toBeUndefined();
  });

  it("propagates per-candidate reasoning settings through resolveConfig", () => {
    const env = { B: "https://api.example/v1", K: "secret-key" } as NodeJS.ProcessEnv;
    const raw = {
      candidates: [
        { name: "plain", modelId: "p", baseUrlEnv: "B", apiKeyEnv: "K" },
        { name: "thinky", modelId: "t", baseUrlEnv: "B", apiKeyEnv: "K", reasoning: true, reasoningEffort: "high" },
      ],
    };
    const resolved = resolveConfig(raw, env);
    expect(resolved.candidates[0]!.reasoning).toBeUndefined();
    expect(resolved.candidates[1]!.reasoning).toBe(true);
    expect(resolved.candidates[1]!.reasoningEffort).toBe("high");
  });
});
