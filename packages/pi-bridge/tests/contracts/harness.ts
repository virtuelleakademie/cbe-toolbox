/**
 * Shared setup of the Pi upgrade contract harness (capability `agent-harness`,
 * Requirement: *Pi Upgrades Are Proven Through a Public Contract Harness*;
 * change `guard-pi-upgrades-with-contract-tests`).
 *
 * A contract case starts the REAL `startCbeSession` against the public scripted
 * provider (`../helpers/scripted-provider.ts`) and observes it through the
 * CBE-owned port: `CbeSessionPort` and the normalized `CbeRuntimeEvent` union.
 * The only reach behind the port is the adapter-edge `settingsManager` override
 * for a fast retry delay — a documented public `SettingsManager` method.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartCbeSessionResult } from "../../src/session.js";
import type { CbeRuntimeEvent } from "../../src/runtime/contracts.js";
import { installScriptedProvider, type ScriptedProvider } from "../helpers/scripted-provider.js";
import { piSessionOf } from "../helpers/pi-adapter-access.js";

export const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "..", "skills", "cbe");

export interface ContractSession {
  result: StartCbeSessionResult;
  events: CbeRuntimeEvent[];
  sessionsDir: string;
}

export interface ContractHarness {
  script: ScriptedProvider;
  tmp: string;
  start(opts?: { sessionId?: string; settings?: Record<string, unknown> }): Promise<ContractSession>;
  /** Dispose every session, uninstall the script and remove the temp tree. */
  close(): void;
}

export function openContractHarness(label: string): ContractHarness {
  const tmp = mkdtempSync(path.join(tmpdir(), `cbe-contract-${label}-`));
  const script = installScriptedProvider();
  const sessions: StartCbeSessionResult[] = [];
  return {
    script,
    tmp,
    async start(opts = {}) {
      const sessionId = opts.sessionId ?? "contract";
      const cwd = path.join(tmp, sessionId, "workspace");
      const sessionsDir = path.join(tmp, sessionId, "sessions");
      mkdirSync(cwd, { recursive: true });
      const result = await startCbeSession({
        profile: "app",
        skillDir: SKILL_DIR,
        sessionsDir,
        sessionId,
        agentDir: path.join(tmp, sessionId, "agent"),
        cwd,
        writableRoots: { dirs: [cwd] },
        provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "contract-key", modelId: "contract-model" },
      });
      sessions.push(result);
      piSessionOf(result.session).settingsManager.applyOverrides({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
        ...opts.settings,
      } as never);
      const events: CbeRuntimeEvent[] = [];
      result.session.subscribe((event) => events.push(event));
      return { result, events, sessionsDir };
    },
    close() {
      for (const s of sessions.splice(0)) s.session.dispose();
      script.uninstall();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** The run bracket a host sees: every `agent_start` / `agent_end`. */
export const runBracket = (events: CbeRuntimeEvent[]) =>
  events.filter((e) => e.type === "agent_start" || e.type === "agent_end");

/** The persisted Pi session record's assistant texts (the adapter-edge view of persistence). */
export function persistedAssistantTexts(sessionsDir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(path.join(sessionsDir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as {
        type: string;
        message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
      };
      if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
      texts.push((entry.message.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join(""));
    }
  }
  return texts;
}
