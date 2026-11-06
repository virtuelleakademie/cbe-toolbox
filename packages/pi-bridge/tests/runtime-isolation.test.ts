/**
 * Every session policy is isolated by explicit configuration, not by a
 * process-global (capability `agent-harness`, Requirement: *Embedded Pi Runtime
 * Configuration Is Explicit and Versioned* — Scenarios: *Every host remains
 * isolated without process-global setup*, *Explicit resource policy keeps only
 * CBE resources*; change `adopt-settled-pi-runtime-lifecycle`, task 2.2).
 *
 * The agent home, the workspace and a decoy global Pi home are seeded with every
 * kind of resource Pi can discover — settings that enable extensions, skills,
 * prompt templates and a different steering mode, an extension, a skill, a prompt
 * template, context files and an APPEND_SYSTEM.md — and the request the provider
 * receives must still be byte-identical to the clean one.
 *
 * The wire comparison alone is defence in depth and cannot fail on one broken
 * layer (the forced CBE prompt and the tool allowlist would still hide it), so
 * the third case inspects the session's own resource and settings state, which
 * fails as soon as discovery or file-backed settings come back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { captureFirstRequest } from "./helpers/request-capture.mjs";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const REPO = path.resolve(__dirname, "..", "..", "..");
const SENTINEL = "ISOLATION-SENTINEL-7c1f";

let decoyHome: string;
const savedEnv = { ...process.env };

/** Seed one Pi home / project config directory with every discoverable resource. */
function seedPiResources(dir: string): void {
  mkdirSync(path.join(dir, "extensions"), { recursive: true });
  mkdirSync(path.join(dir, "skills", "decoy"), { recursive: true });
  mkdirSync(path.join(dir, "prompts"), { recursive: true });
  writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({
      extensions: [path.join(dir, "extensions", "decoy.ts")],
      skills: [path.join(dir, "skills")],
      steeringMode: "all",
      cacheWarming: "idle",
      retry: { provider: { maxRetries: 9 } },
    })
  );
  writeFileSync(
    path.join(dir, "extensions", "decoy.ts"),
    `export default function (pi) { pi.registerTool({ name: "decoy_tool", label: "d", description: "${SENTINEL}", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: {} }) }); }\n`
  );
  writeFileSync(
    path.join(dir, "skills", "decoy", "SKILL.md"),
    `---\nname: decoy\ndescription: ${SENTINEL}\n---\n\n${SENTINEL}\n`
  );
  writeFileSync(path.join(dir, "prompts", "decoy.md"), `${SENTINEL}\n`);
  writeFileSync(path.join(dir, "AGENTS.md"), `${SENTINEL}\n`);
  writeFileSync(path.join(dir, "APPEND_SYSTEM.md"), `${SENTINEL}\n`);
  writeFileSync(path.join(dir, "SYSTEM.md"), `${SENTINEL}\n`);
}

beforeEach(() => {
  decoyHome = mkdtempSync(path.join(tmpdir(), "cbe-decoy-pi-home-"));
  seedPiResources(decoyHome);
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(decoyHome, { recursive: true, force: true });
});

describe("Scenario: Explicit resource policy keeps only CBE resources", () => {
  it("sends the same request when the agent home, the workspace and a global Pi home carry decoy resources", async () => {
    delete process.env.PI_CODING_AGENT_DIR;
    const clean = await captureFirstRequest({ startCbeSession, repo: REPO });

    // A global Pi home the process environment points at, plus decoys in the
    // session's own agent home and the workspace's project config.
    process.env.PI_CODING_AGENT_DIR = decoyHome;
    const seeded = await captureFirstRequest({
      startCbeSession,
      repo: REPO,
      prepare: ({ cwd, agentDir }) => {
        seedPiResources(agentDir);
        seedPiResources(path.join(cwd, ".pi"));
        writeFileSync(path.join(cwd, "AGENTS.md"), `${SENTINEL}\n`);
        writeFileSync(path.join(cwd, "CLAUDE.md"), `${SENTINEL}\n`);
      },
    });

    expect(JSON.stringify(seeded)).not.toContain(SENTINEL);
    expect(seeded).toEqual(clean);
  }, 60_000);
});

describe("Scenario: Every host remains isolated without process-global setup", () => {
  it("builds a working session with no Pi environment variable set at all", async () => {
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_PACKAGE_DIR;
    const body = await captureFirstRequest({ startCbeSession, repo: REPO });
    expect(body.model).toBe("parity-model");
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  }, 60_000);
});

describe("Scenario: Explicit resource policy keeps only CBE resources — session state", () => {
  it("loads no decoy extension, skill, prompt or context file and reads no decoy settings", async () => {
    process.env.PI_CODING_AGENT_DIR = decoyHome;
    const root = mkdtempSync(path.join(tmpdir(), "cbe-isolation-"));
    const cwd = path.join(root, "workspace");
    const agentDir = path.join(root, "agent");
    seedPiResources(agentDir);
    seedPiResources(path.join(cwd, ".pi"));
    writeFileSync(path.join(cwd, "AGENTS.md"), `${SENTINEL}\n`);
    try {
      const started = await startCbeSession({
        profile: "app",
        skillDir: path.join(REPO, "skills", "cbe"),
        sessionsDir: path.join(root, "sessions"),
        agentDir,
        cwd,
        provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "m" },
      });
      const pi = piSessionOf(started.session);
      const loader = pi.resourceLoader;
      expect(loader.getExtensions().extensions.every((e) => e.path.startsWith("<inline:"))).toBe(true);
      expect(loader.getSkills().skills.map((s) => s.name)).toEqual(["cbe"]);
      expect(loader.getPrompts().prompts).toEqual([]);
      expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
      expect(pi.getActiveToolNames()).not.toContain("decoy_tool");
      expect(pi.settingsManager.getSteeringMode()).toBe("one-at-a-time");
      expect(pi.settingsManager.getCacheWarmingMode()).toBe("off");
      expect(pi.settingsManager.getProviderRetrySettings().maxRetries).toBe(2);
      expect(pi.systemPrompt).not.toContain(SENTINEL);
      started.session.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
