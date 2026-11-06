/**
 * Settled run lifecycle at the CBE boundary (capability `agent-harness`,
 * Requirement: *Run Completion Uses Pi Settled State*; change
 * `adopt-settled-pi-runtime-lifecycle`, tasks 3.1, 3.2 and 3.4).
 *
 * ADAPTER-level: it drives real Pi sessions through the public provider seam
 * (`helpers/scripted-provider.ts`) and one public settle hook, and proves that
 * every consumer of the CBE port sees exactly ONE `agent_start` and ONE terminal
 * `agent_end` per run — the end sourced from Pi `agent_settled`, after every
 * message/tool event — while Pi's low-level ends stay inside the adapter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSessionEvent,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import type { CbeRuntimeEvent } from "../src/runtime/contracts.js";
import { createPiEventNormalizer } from "../src/runtime/pi-events.js";
import { adaptPiRun } from "../src/runtime/pi-session-port.js";
import { createPiModelBinding } from "../src/runtime/pi-model.js";
import { CBE_RESOURCE_POLICY, createCbeSettingsManager } from "../src/runtime/pi-config.js";
import { installScriptedProvider, type ScriptedProvider } from "./helpers/scripted-provider.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const REPO = path.resolve(__dirname, "..", "..", "..");

const lifecycle = (events: CbeRuntimeEvent[]) =>
  events.filter((e) => e.type === "agent_start" || e.type === "agent_end");

describe("Scenario: Low-level end before retry is not final — the normalizer's run bracket", () => {
  const pi = (e: unknown) => e as AgentSessionEvent;

  it("collapses a retry's low-level end/start pair into one CBE run", () => {
    const normalize = createPiEventNormalizer();
    const out = [
      pi({ type: "agent_start" }),
      pi({ type: "agent_end", messages: [], willRetry: true }),
      pi({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "503" }),
      pi({ type: "agent_start" }),
      pi({ type: "auto_retry_end", success: true, attempt: 1 }),
      pi({ type: "agent_end", messages: [], willRetry: false }),
      pi({ type: "agent_settled", aborted: false }),
    ].map(normalize);
    expect(out.map((e) => e.type)).toEqual([
      "agent_start",
      "runtime_activity",
      "auto_retry_start",
      "runtime_activity",
      "auto_retry_end",
      "runtime_activity",
      "agent_end",
    ]);
    expect(out.at(-1)).toEqual({ type: "agent_end", aborted: false });
  });

  it("keeps a settle-hook continuation inside the same run", () => {
    const normalize = createPiEventNormalizer();
    const out = [
      pi({ type: "agent_start" }),
      pi({ type: "agent_end", messages: [], willRetry: false }),
      pi({ type: "agent_start" }),
      pi({ type: "agent_end", messages: [], willRetry: false }),
      pi({ type: "agent_settled", aborted: false }),
    ].map(normalize);
    expect(lifecycle(out)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
  });

  it("reports a settle with no started run as activity, never as an end without a start", () => {
    const normalize = createPiEventNormalizer();
    expect(normalize(pi({ type: "agent_settled", aborted: true }))).toEqual({ type: "runtime_activity" });
    // ...and the next run still brackets normally.
    expect(normalize(pi({ type: "agent_start" }))).toEqual({ type: "agent_start" });
    expect(normalize(pi({ type: "agent_settled", aborted: true }))).toEqual({ type: "agent_end", aborted: true });
  });

  it("brackets two interleaved sessions independently (one normalizer per session)", () => {
    const a = createPiEventNormalizer();
    const b = createPiEventNormalizer();
    const seenA: CbeRuntimeEvent[] = [];
    const seenB: CbeRuntimeEvent[] = [];
    seenA.push(a(pi({ type: "agent_start" })));
    seenB.push(b(pi({ type: "agent_start" })));
    seenB.push(b(pi({ type: "agent_end", messages: [], willRetry: true })));
    seenA.push(a(pi({ type: "agent_settled", aborted: false })));
    seenB.push(b(pi({ type: "agent_start" })));
    seenB.push(b(pi({ type: "agent_settled", aborted: false })));
    expect(lifecycle(seenA)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    expect(lifecycle(seenB)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
  });
});

let tmp: string;
let script: ScriptedProvider;
const startedSessions: StartCbeSessionResult[] = [];

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-settled-"));
  script = installScriptedProvider();
});

afterEach(() => {
  for (const s of startedSessions.splice(0)) s.session.dispose();
  script.uninstall();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Scenario: Settle-hook continuation remains in the same run", () => {
  it("emits one terminal agent_end only after the continued low-level run, through the real runtime", async () => {
    const cwd = path.join(tmp, "workspace");
    const agentDir = path.join(tmp, "agent");
    mkdirSync(cwd, { recursive: true });
    // One public settle hook that asks for exactly one continuation.
    let continued = false;
    const continueOnce: ExtensionFactory = (api) => {
      api.on("agent_before_settle", () => {
        if (continued) return undefined;
        continued = true;
        return {
          entries: [{ type: "custom_message", customType: "cbe-test", content: "Bitte fortfahren.", display: false }],
          continue: true,
        };
      });
    };
    const settingsManager = createCbeSettingsManager();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      ...CBE_RESOURCE_POLICY,
      systemPrompt: "Test.",
      extensionFactories: [continueOnce],
    });
    await loader.reload();
    const { modelRuntime, model } = await createPiModelBinding(
      { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "m" },
      agentDir
    );
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      modelRuntime,
      settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      tools: ["read"],
    });
    const port = adaptPiRun(session);
    const raw: string[] = [];
    session.subscribe((e) => raw.push(e.type));
    const events: CbeRuntimeEvent[] = [];
    port.subscribe((e) => events.push(e));
    script.push({ blocks: [{ kind: "text", text: "Teil eins." }] }, { blocks: [{ kind: "text", text: "Teil zwei." }] });

    await port.prompt("Los.");
    port.dispose();

    // Pi ran two low-level runs...
    expect(raw.filter((t) => t === "agent_end")).toHaveLength(2);
    expect(script.requests).toHaveLength(2);
    // ...and the host sees ONE run, ending after the continued answer.
    expect(lifecycle(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    const lastAnswer = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === "message_end")
      .at(-1)!;
    expect(lastAnswer.e).toMatchObject({ message: { role: "assistant", text: "Teil zwei." } });
    expect(events.findIndex((e) => e.type === "agent_end")).toBeGreaterThan(lastAnswer.i);
  });
});

describe("Scenario: Concurrent sessions settle independently", () => {
  it("keys each settled end to its own session while two runs overlap", async () => {
    const start = async (id: string) => {
      const cwd = path.join(tmp, id);
      mkdirSync(cwd, { recursive: true });
      const s = await startCbeSession({
        profile: "app",
        skillDir: SKILL_DIR,
        sessionsDir: path.join(tmp, "sessions"),
        sessionId: id,
        agentDir: path.join(tmp, "agent"),
        cwd,
        provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: `model-${id}` },
      });
      startedSessions.push(s);
      return s;
    };
    const a = await start("a");
    const b = await start("b");
    const seenA: CbeRuntimeEvent[] = [];
    const seenB: CbeRuntimeEvent[] = [];
    a.session.subscribe((e) => seenA.push(e));
    b.session.subscribe((e) => seenB.push(e));
    script.routeWhen((r) => r.userTexts.at(-1) === "Frage A", { blocks: [{ kind: "text", text: "Antwort A" }] });
    script.routeWhen((r) => r.userTexts.at(-1) === "Frage B", {
      blocks: [{ kind: "text", text: "Antwort B" }],
      stopReason: "error",
      errorMessage: "503 service unavailable",
    });
    script.routeWhen((r) => r.userTexts.at(-1) === "Frage B", { blocks: [{ kind: "text", text: "Antwort B2" }] });
    for (const s of [a, b]) {
      piSessionOf(s.session).settingsManager.applyOverrides({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
      } as never);
    }

    await Promise.all([a.session.prompt("Frage A"), b.session.prompt("Frage B")]);

    expect(lifecycle(seenA)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    // B retried — still exactly one run.
    expect(lifecycle(seenB)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: false }]);
    expect(seenA.some((e) => e.type === "text_delta" && e.delta.includes("B"))).toBe(false);
    expect(seenB.some((e) => e.type === "text_delta" && e.delta === "Antwort A")).toBe(false);
  });
});

describe("Scenario: no product code reads the low-level willRetry", () => {
  /** Every `.ts`/`.tsx` file under a directory. */
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it("mentions willRetry only as the compaction_end field (and in the adapter's own notes)", () => {
    const roots = ["packages/app/src", "packages/pi-bridge/src", "evaluation/cbe-skill/runner/src"];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sources(path.join(REPO, root))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!line.includes("willRetry")) return;
          if (/^\s*(\*|\/\/)/.test(line)) return; // documentation
          // A compaction_end field: the nearest event discriminant above names compaction.
          const window = lines.slice(Math.max(0, i - 12), i).join("\n");
          if (/compaction_end/.test(window)) return;
          offenders.push(`${path.relative(REPO, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Scenario: Stop completes at settlement", () => {
  it("honours a stop latched BEFORE the run starts and completes it at the settled end", async () => {
    const cwd = path.join(tmp, "workspace");
    mkdirSync(cwd, { recursive: true });
    let pending = false;
    const s = await startCbeSession({
      profile: "app",
      skillDir: SKILL_DIR,
      sessionsDir: path.join(tmp, "sessions"),
      agentDir: path.join(tmp, "agent"),
      cwd,
      hasPendingTurn: () => pending,
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "m" },
    });
    startedSessions.push(s);
    const events: CbeRuntimeEvent[] = [];
    // Host wiring, as Electron main drives the stop's run boundaries.
    s.session.subscribe((e) => {
      events.push(e);
      if (e.type === "agent_start") s.turnStop.noteRunStart();
      if (e.type === "agent_end") s.turnStop.noteRunEnd();
    });
    script.push({ blocks: [{ kind: "text", text: "Ich beginne" }], waitForAbort: true });

    // The lecturer dispatched and stopped before the runtime started the run.
    pending = true;
    const stop = s.turnStop.stop();
    const run = s.session.prompt("Erkläre mir alles.");
    const outcome = await stop;
    await run;
    pending = false;

    expect(outcome).toEqual({ status: "stopped" });
    expect(s.turnStop.stoppedForCurrentRun()).toBe(true);
    expect(lifecycle(events)).toEqual([{ type: "agent_start" }, { type: "agent_end", aborted: true }]);
  });
});
