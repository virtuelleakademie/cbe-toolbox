/**
 * Credential + config resolution. Every case runs without a model, without a
 * network call, and without a real credential — all values here are invented.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSecretsFile, secretsSearchPaths, loadSecretsIntoEnv, describeSecretsSearch } from "../src/secrets.js";
import {
  configSearchPaths,
  resolveConfigPath,
  resolveModel,
  resolveConfig,
  configuredSecretVarNames,
  ConfigError,
} from "../src/config.js";
import { secretVarNamesForRun, APP_CONFIG_KEY_ENV } from "../src/app-config.js";

const CANDIDATE = { name: "qwen", modelId: "q", baseUrlEnv: "CBE_LLM_BASE_URL", apiKeyEnv: "CBE_LLM_API_KEY" };

/** The variable names the board above declares — what a secrets file may fill. */
const WANTED = ["CBE_LLM_BASE_URL", "CBE_LLM_API_KEY"];

/** Swallow the loader's stderr warnings unless a case asserts on them. */
const QUIET = () => {};

/** A throwaway directory shaped like a checkout, plus an isolated HOME. */
function makeCheckout(): { root: string; home: string; env: NodeJS.ProcessEnv } {
  const base = mkdtempSync(path.join(tmpdir(), "cbe-eval-test-"));
  const root = path.join(base, "checkout");
  const home = path.join(base, "home");
  mkdirSync(path.join(root, "evaluation", "cbe-skill", "runner"), { recursive: true });
  mkdirSync(home, { recursive: true });
  // A bare env: no inherited CBE_* variables, no inherited XDG_CONFIG_HOME.
  return { root, home, env: { HOME: home } as NodeJS.ProcessEnv };
}

function writeSecrets(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
}

const CREATED: string[] = [];
beforeEach(() => CREATED.splice(0));
afterEach(() => {
  for (const dir of CREATED) rmSync(dir, { recursive: true, force: true });
});

function checkout() {
  const c = makeCheckout();
  CREATED.push(path.dirname(c.root));
  return c;
}

describe("secrets file parsing", () => {
  it("parses plain KEY=VALUE lines", () => {
    expect(parseSecretsFile("CBE_LLM_BASE_URL=https://example.test/v1\nCBE_LLM_API_KEY=not-a-real-key")).toEqual({
      CBE_LLM_BASE_URL: "https://example.test/v1",
      CBE_LLM_API_KEY: "not-a-real-key",
    });
  });

  it("tolerates an export prefix, quotes, comments and blank lines", () => {
    const body = [
      "# a comment",
      "",
      "export CBE_LLM_BASE_URL='https://example.test/v1'",
      '   export CBE_LLM_API_KEY = "quoted-not-real"   ',
      "   # indented comment",
    ].join("\n");
    expect(parseSecretsFile(body)).toEqual({
      CBE_LLM_BASE_URL: "https://example.test/v1",
      CBE_LLM_API_KEY: "quoted-not-real",
    });
  });

  it("keeps '=' and '#' inside a value — truncating a credential is worse than a stray comment", () => {
    const parsed = parseSecretsFile("CBE_LLM_API_KEY=abc=def#ghi");
    expect(parsed.CBE_LLM_API_KEY).toBe("abc=def#ghi");
  });

  it("ignores lines that are not assignments to a valid identifier", () => {
    expect(parseSecretsFile("just a sentence\n=novalue\n9BAD=x\nOK=1")).toEqual({ OK: "1" });
  });
});

describe("secrets resolution order", () => {
  it("searches $CBE_EVAL_SECRETS, then the checkout, then the machine-local slot", () => {
    const { root, home, env } = checkout();
    env.CBE_EVAL_SECRETS = path.join(home, "explicit-secrets");
    expect(secretsSearchPaths(root, env)).toEqual([
      path.join(home, "explicit-secrets"),
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      path.join(home, ".config", "cbe-eval", "secrets"),
    ]);
  });

  it("honours XDG_CONFIG_HOME for the machine-local slot", () => {
    const { root, home, env } = checkout();
    env.XDG_CONFIG_HOME = path.join(home, "xdg");
    expect(secretsSearchPaths(root, env)).toContain(path.join(home, "xdg", "cbe-eval", "secrets"));
  });

  // spec: Environment variables already set take precedence over any file
  it("lets an already-set environment variable win and never overwrites it", () => {
    const { root, env } = checkout();
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      "CBE_LLM_BASE_URL=https://from-file.test/v1\nCBE_LLM_API_KEY=from-file-not-real"
    );
    env.CBE_LLM_BASE_URL = "https://from-env.test/v1";
    env.CBE_LLM_API_KEY = "from-env-not-real";

    loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(env.CBE_LLM_BASE_URL).toBe("https://from-env.test/v1");
    expect(env.CBE_LLM_API_KEY).toBe("from-env-not-real");
  });

  // spec: Environment variables already set take precedence over any file
  it("runs with no secrets file at all when the variables are already exported", () => {
    const { root, env } = checkout();
    env.CBE_LLM_BASE_URL = "https://from-env.test/v1";
    env.CBE_LLM_API_KEY = "from-env-not-real";

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(res.loaded).toEqual([]);
    expect(() => resolveModel(CANDIDATE, env, describeSecretsSearch(res))).not.toThrow();
  });

  it("reads the checkout-local file when nothing is exported", () => {
    const { root, env } = checkout();
    const file = path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets");
    writeSecrets(file, "CBE_LLM_BASE_URL=https://from-file.test/v1\nCBE_LLM_API_KEY=from-file-not-real");

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(res.loaded).toEqual([file]);
    expect(env.CBE_LLM_API_KEY).toBe("from-file-not-real");
  });

  it("falls back to the machine-local slot outside every repo tree", () => {
    const { root, home, env } = checkout();
    const file = path.join(home, ".config", "cbe-eval", "secrets");
    writeSecrets(file, "CBE_LLM_BASE_URL=https://machine.test/v1\nCBE_LLM_API_KEY=machine-not-real");

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(res.loaded).toEqual([file]);
    expect(env.CBE_LLM_BASE_URL).toBe("https://machine.test/v1");
  });

  it("prefers $CBE_EVAL_SECRETS over the checkout-local file", () => {
    const { root, home, env } = checkout();
    const explicit = path.join(home, "explicit-secrets");
    writeSecrets(explicit, "CBE_LLM_API_KEY=explicit-not-real");
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      "CBE_LLM_API_KEY=local-not-real"
    );
    env.CBE_EVAL_SECRETS = explicit;

    loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(env.CBE_LLM_API_KEY).toBe("explicit-not-real");
  });

  it("composes a later file for variables an earlier one did not supply", () => {
    const { root, home, env } = checkout();
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      "CBE_LLM_API_KEY=local-not-real"
    );
    writeSecrets(path.join(home, ".config", "cbe-eval", "secrets"), "CBE_LLM_BASE_URL=https://machine.test/v1");

    loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(env.CBE_LLM_API_KEY).toBe("local-not-real");
    expect(env.CBE_LLM_BASE_URL).toBe("https://machine.test/v1");
  });
});

describe("missing credentials", () => {
  // spec: Missing secrets file names the expected path
  it("names the missing variable AND every path it searched", () => {
    const { root, env } = checkout();
    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);
    const hint = describeSecretsSearch(res);

    let message = "";
    try {
      resolveModel(CANDIDATE, env, hint);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("CBE_LLM_BASE_URL");
    expect(message).toContain(path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"));
    expect(message).toContain(path.join(".config", "cbe-eval", "secrets"));
    expect(message).toContain("CBE_EVAL_SECRETS");
  });

  it("still fails fast before any model is contacted", () => {
    const { env } = checkout();
    env.CBE_LLM_BASE_URL = "https://example.test/v1"; // key still missing
    expect(() => resolveModel(CANDIDATE, env)).toThrow(ConfigError);
    expect(() => resolveModel(CANDIDATE, env)).toThrow(/CBE_LLM_API_KEY/);
  });
});

describe("config path resolution", () => {
  it("searches the override, the spec path, then the legacy path — and nothing else", () => {
    const { root, env } = checkout();
    env.CBE_EVAL_CONFIG = path.join(root, "custom.json");
    const evalDir = path.join(root, "evaluation", "cbe-skill");
    expect(configSearchPaths(root, env)).toEqual([
      path.join(root, "custom.json"),
      path.join(evalDir, "eval.config.json"),
      path.join(evalDir, "runner", "eval.config.json"),
    ]);
  });

  it("prefers the spec path over the legacy runner path", () => {
    const { root, env } = checkout();
    const evalDir = path.join(root, "evaluation", "cbe-skill");
    writeFileSync(path.join(evalDir, "eval.config.json"), "{}", "utf8");
    writeFileSync(path.join(evalDir, "runner", "eval.config.json"), "{}", "utf8");
    expect(resolveConfigPath(root, env)).toBe(path.join(evalDir, "eval.config.json"));
  });

  it("still honours a legacy runner/eval.config.json so an existing working copy keeps running", () => {
    const { root, env } = checkout();
    const legacy = path.join(root, "evaluation", "cbe-skill", "runner", "eval.config.json");
    writeFileSync(legacy, "{}", "utf8");
    expect(resolveConfigPath(root, env)).toBe(legacy);
  });

  it("honours $CBE_EVAL_CONFIG above everything else", () => {
    const { root, env } = checkout();
    const custom = path.join(root, "custom.json");
    writeFileSync(custom, "{}", "utf8");
    writeFileSync(path.join(root, "evaluation", "cbe-skill", "eval.config.json"), "{}", "utf8");
    env.CBE_EVAL_CONFIG = custom;
    expect(resolveConfigPath(root, env)).toBe(custom);
  });

  // spec: Missing config file aborts naming every path searched
  it("names every searched path when no configuration exists at all", () => {
    const { root, env } = checkout();
    let message = "";
    expect(() => resolveConfigPath(root, env)).toThrow(ConfigError);
    try {
      resolveConfigPath(root, env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(path.join("evaluation", "cbe-skill", "eval.config.json"));
    expect(message).toContain(path.join("evaluation", "cbe-skill", "runner", "eval.config.json"));
    // No example twin exists any more, so none may be advertised as a fallback.
    expect(message).not.toContain("example");
  });

  // spec: An explicit config override that points at nothing aborts
  it("aborts naming the exact path when $CBE_EVAL_CONFIG points at nothing", () => {
    const { root, env } = checkout();
    const missing = path.join(root, "typo.json");
    // A usable default board exists — the override must NOT silently degrade to it.
    writeFileSync(path.join(root, "evaluation", "cbe-skill", "eval.config.json"), "{}", "utf8");
    env.CBE_EVAL_CONFIG = missing;

    expect(() => resolveConfigPath(root, env)).toThrow(ConfigError);
    expect(() => resolveConfigPath(root, env)).toThrow(missing);
  });
});

// spec: A secrets file supplies only the variables the configuration names
describe("the secrets import is limited to the configured variable names", () => {
  it("never writes a variable the configuration does not name", () => {
    const { root, env } = checkout();
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      [
        "CBE_LLM_BASE_URL=https://example.test/v1",
        "CBE_LLM_API_KEY=wanted-not-real",
        "UNRELATED_CLOUD_TOKEN=unrelated-not-real",
        "CBE_SOMETHING_FUTURE=also-unrelated-not-real",
      ].join("\n")
    );

    loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(env.CBE_LLM_API_KEY).toBe("wanted-not-real");
    expect(env.UNRELATED_CLOUD_TOKEN).toBeUndefined();
    // A CBE_ prefix would have adopted this one — the filter is an explicit name list.
    expect(env.CBE_SOMETHING_FUTURE).toBeUndefined();
  });

  it("reports the file as loaded only when it supplied a wanted variable", () => {
    const { root, env } = checkout();
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      "UNRELATED_CLOUD_TOKEN=unrelated-not-real"
    );

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);

    expect(res.loaded).toEqual([]);
    expect(env.UNRELATED_CLOUD_TOKEN).toBeUndefined();
  });

  it("derives the wanted names from the candidates and the judge", () => {
    expect(
      configuredSecretVarNames({
        candidates: [CANDIDATE, { ...CANDIDATE, name: "other", apiKeyEnv: "OTHER_KEY" }],
        judge: { ...CANDIDATE, name: "judge", baseUrlEnv: "JUDGE_URL", apiKeyEnv: "JUDGE_KEY" },
      })
    ).toEqual(["CBE_LLM_BASE_URL", "CBE_LLM_API_KEY", "OTHER_KEY", "JUDGE_URL", "JUDGE_KEY"]);
  });

  // The board path and the app-config path are mutually exclusive, and so are the
  // variables they may import. A board config that names neither CBE_LLM_* variable
  // must not drag the app-config key in.
  it("whitelists only the board's own variables when a config is resolved", () => {
    const board = {
      candidates: [{ name: "byo", modelId: "m", baseUrlEnv: "OTHER_BASE_URL", apiKeyEnv: "OTHER_KEY" }],
    };
    expect(secretVarNamesForRun(board)).toEqual(["OTHER_BASE_URL", "OTHER_KEY"]);
    expect(secretVarNamesForRun(board)).not.toContain(APP_CONFIG_KEY_ENV);
  });

  it("whitelists the app-config key only when no board config was resolved", () => {
    expect(secretVarNamesForRun(undefined)).toEqual([APP_CONFIG_KEY_ENV]);
  });

  it("never imports CBE_LLM_API_KEY on the board path when no candidate names it", () => {
    const { root, env } = checkout();
    const board = {
      candidates: [{ name: "byo", modelId: "m", baseUrlEnv: "OTHER_BASE_URL", apiKeyEnv: "OTHER_KEY" }],
    };
    writeSecrets(
      path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"),
      ["OTHER_BASE_URL=https://example.test/v1", "OTHER_KEY=board-not-real", "CBE_LLM_API_KEY=app-path-not-real"].join(
        "\n"
      )
    );

    loadSecretsIntoEnv(root, secretVarNamesForRun(board), env, QUIET);

    expect(env.OTHER_KEY).toBe("board-not-real");
    // The board never reads the app config, so its key variable stays out of the
    // environment the judge and the pi eval session inherit.
    expect(env.CBE_LLM_API_KEY).toBeUndefined();
  });
});

describe("a secrets file that cannot be used says so", () => {
  // spec: A secrets file that cannot be read warns instead of being skipped silently
  it("warns with the path, never the contents, when the file is unreadable", () => {
    const { root, home, env } = checkout();
    // A directory at the file's path: it exists, and reading it throws EISDIR.
    mkdirSync(path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"), { recursive: true });
    const machineLocal = path.join(home, ".config", "cbe-eval", "secrets");
    writeSecrets(machineLocal, "CBE_LLM_BASE_URL=https://fallback.test/v1\nCBE_LLM_API_KEY=fallback-not-real");
    const warnings: string[] = [];

    const res = loadSecretsIntoEnv(root, WANTED, env, (m) => warnings.push(m));

    expect(warnings.join("\n")).toContain(path.join("runner", ".eval-secrets"));
    expect(warnings.join("\n")).toContain("could not be read");
    expect(env.CBE_LLM_BASE_URL).toBe("https://fallback.test/v1");
    expect(env.CBE_LLM_API_KEY).toBe("fallback-not-real");
    expect(res.loaded).toContain(machineLocal);
  });

  // spec: An explicit secrets pointer to a missing file warns
  it("warns when $CBE_EVAL_SECRETS points at a file that does not exist", () => {
    const { root, home, env } = checkout();
    const missing = path.join(home, "gone-secrets");
    env.CBE_EVAL_SECRETS = missing;
    const warnings: string[] = [];

    loadSecretsIntoEnv(root, WANTED, env, (m) => warnings.push(m));

    expect(warnings.join("\n")).toContain(missing);
    expect(warnings.join("\n")).toContain("CBE_EVAL_SECRETS");
  });

  // spec: Absent optional secrets files stay silent
  it("stays silent when no explicit override is set and nothing exists", () => {
    const { root, env } = checkout();
    const warnings: string[] = [];

    loadSecretsIntoEnv(root, WANTED, env, (m) => warnings.push(m));

    expect(warnings).toEqual([]);
  });
});

// spec: A freshly built checkout runs a scoped eval
describe("a fresh checkout", () => {
  it("resolves config and credentials end to end, up to the model call", () => {
    const { root, env } = checkout();
    const evalDir = path.join(root, "evaluation", "cbe-skill");
    // Only what a fresh `git clone` carries: the versioned config, no secrets file.
    writeFileSync(path.join(evalDir, "eval.config.json"), JSON.stringify({ candidates: [CANDIDATE] }), "utf8");
    // Credentials arrive the way a provisioned machine supplies them.
    writeSecrets(
      path.join(env.HOME!, ".config", "cbe-eval", "secrets"),
      ["CBE_LLM_BASE_URL=https://example.test/v1", "CBE_LLM_API_KEY=fresh-checkout-not-real"].join("\n")
    );

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);
    const configPath = resolveConfigPath(root, env);
    const resolved = resolveConfig(JSON.parse(readFileSync(configPath, "utf8")), env, describeSecretsSearch(res));

    expect(configPath).toBe(path.join(evalDir, "eval.config.json"));
    expect(resolved.candidates[0]!.baseURL).toBe("https://example.test/v1");
    expect(resolved.candidates[0]!.apiKey).toBe("fresh-checkout-not-real");
  });
});

// spec: The configuration file is versioned because it carries no secrets
describe("the shipped configuration", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const shipped = path.join(repoRoot, "evaluation", "cbe-skill", "eval.config.json");

  it("is present in the checkout at the path the spec names", () => {
    expect(existsSync(shipped)).toBe(true);
  });

  it("declares base URL and key by environment-variable name only, carrying no key material", () => {
    const body = readFileSync(shipped, "utf8");
    const cfg = JSON.parse(body) as { candidates: Record<string, unknown>[] };

    expect(cfg.candidates.length).toBeGreaterThan(0);
    for (const candidate of cfg.candidates) {
      expect(typeof candidate.baseUrlEnv).toBe("string");
      expect(typeof candidate.apiKeyEnv).toBe("string");
      // No resolved value may be inlined next to the variable name.
      expect(candidate).not.toHaveProperty("apiKey");
      expect(candidate).not.toHaveProperty("baseURL");
    }
    // No credential-shaped literal anywhere in the file.
    expect(body).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(body).not.toMatch(/\bBearer\s+\S/);
  });
});

describe("the missing-credential hint distinguishes its two failure modes", () => {
  // spec: No secrets file exists anywhere
  it("says only 'searched' when no secrets file exists anywhere", () => {
    const { root, home, env } = checkout();
    env.CBE_EVAL_SECRETS = path.join(home, "explicit-secrets");
    const searched = secretsSearchPaths(root, env);
    const hint = describeSecretsSearch(loadSecretsIntoEnv(root, WANTED, env, QUIET));
    const positions = searched.map((file) => hint.indexOf(file));

    expect(hint).toContain("Searched, in order:");
    expect(hint).not.toContain("read but did not carry it");
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
    expect(hint).toContain("export the variable");
    expect(hint).toContain("point $CBE_EVAL_SECRETS at a KEY=VALUE file");
    expect(hint).toContain("place one at a path above");
    expect(hint).not.toContain("add the missing line to a file listed above");
  });

  // spec: A secrets file was read but does not carry the variable
  it("names the file that was read but lacked the variable — the opposite diagnosis", () => {
    const { root, env } = checkout();
    const file = path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets");
    // Present and parsed, but carries only one of the two wanted variables.
    writeSecrets(file, "CBE_LLM_API_KEY=partial-not-real");

    const hint = describeSecretsSearch(loadSecretsIntoEnv(root, WANTED, env, QUIET));

    expect(hint).toContain("read but did not carry it");
    expect(hint).toContain(file);
    // Still tells the operator every other place it looked.
    expect(hint).toContain(path.join(".config", "cbe-eval", "secrets"));
    expect(hint).toContain("add the missing line to a file listed above");
    expect(hint).not.toContain("place one at a path above");
  });

  // spec: A file that supplied nothing still counts as read
  it("names a file that parsed cleanly but carried none of the wanted variables", () => {
    const { root, home, env } = checkout();
    const file = path.join(home, ".config", "cbe-eval", "secrets");
    // The machine-local slot symlinked into a secret store that names its entries
    // differently: it exists and parses, but supplies neither wanted variable.
    writeSecrets(file, ["UNRELATED_CLOUD_TOKEN=unrelated-not-real", "OTHER_VENDOR_KEY=other-not-real"].join("\n"));

    const res = loadSecretsIntoEnv(root, WANTED, env, QUIET);
    const hint = describeSecretsSearch(res);

    // `loaded` keeps its meaning: nothing was supplied.
    expect(res.loaded).toEqual([]);
    expect(res.parsedWithoutMatch).toEqual([file]);
    // "add a line to the file you already have", never "create a file somewhere".
    expect(hint).toContain("read but did not carry it");
    expect(hint).toContain(file);
    expect(hint).not.toContain("Searched, in order:");
    expect(hint).toContain(path.join(root, "evaluation", "cbe-skill", "runner", ".eval-secrets"));
    expect(hint).toContain("add the missing line to a file listed above");
    expect(hint).not.toContain("place one at a path above");
  });
});
