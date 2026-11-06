/**
 * Accepted Pi 1.3 runtime semantics, pinned as deterministic contracts
 * (capability `agent-harness`, Requirement: *Accepted Pi 1.3 Runtime Semantics
 * Are Explicit Contracts*; change `adopt-settled-pi-runtime-lifecycle`).
 *
 * The upgrade from Pi 0.75.5 changed runtime behaviour that no public option
 * restores. Each case below states one such semantic as CBE now promises it,
 * and drives the REAL runtime — through the scripted API provider or through
 * Pi's real `openai-completions` client against a local mock server — so a
 * further Pi release that moves any of them fails here instead of reaching a
 * lecturer unannounced. Each case also pins the CBE-owned guarantee that holds
 * across the semantic: one CBE run, one settled `agent_end`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CBE_TOOL_ALLOWLIST, startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import type { CbeRuntimeEvent } from "../src/runtime/contracts.js";
import { CBE_PI_SETTINGS, LEGACY_PROVIDER_MAX_RETRIES, LEGACY_PROVIDER_TIMEOUT_MS } from "../src/runtime/pi-config.js";
import { applyTruncationVerdict, TruncationDetector, TRUNCATION_CONTINUE_MAX } from "../src/truncation-detector.js";
import { installScriptedProvider, type ScriptedProvider } from "./helpers/scripted-provider.js";
import { startMockOpenAiServer, type MockOpenAiServer } from "./helpers/mock-openai-server.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const SMALL_WINDOW = { compaction: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1 } };

let tmp: string;
let started: StartCbeSessionResult | undefined;
let script: ScriptedProvider | undefined;
let mock: MockOpenAiServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-pi13-"));
});

afterEach(async () => {
  started?.session.dispose();
  started = undefined;
  script?.uninstall();
  script = undefined;
  await mock?.close();
  mock = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function start(
  baseURL: string,
  opts: { contextLength?: number; settings?: Record<string, unknown>; resume?: boolean } = {}
) {
  const cwd = path.join(tmp, "workspace");
  mkdirSync(cwd, { recursive: true });
  started = await startCbeSession({
    profile: "app",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    sessionId: "pi13",
    agentDir: path.join(tmp, "agent"),
    cwd,
    ...(opts.resume
      ? {
          resume: {
            turns: [
              { role: "user" as const, text: "a" },
              { role: "assistant" as const, text: "b" },
            ],
          },
        }
      : {}),
    provider: {
      baseURL,
      apiKey: "k",
      modelId: "m",
      ...(opts.contextLength !== undefined ? { contextLength: opts.contextLength } : {}),
    },
  });
  if (opts.settings) piSessionOf(started.session).settingsManager.applyOverrides(opts.settings as never);
  const events: CbeRuntimeEvent[] = [];
  started.session.subscribe((e) => events.push(e));
  return { session: started, events };
}

const runBracket = (events: CbeRuntimeEvent[]) =>
  events.filter((e) => e.type === "agent_start" || e.type === "agent_end");
const ONE_RUN = [{ type: "agent_start" }, { type: "agent_end", aborted: false }];

function jsonlEntryTypes(): string[] {
  const dir = path.join(tmp, "sessions");
  const file = readdirSync(dir).find((f) => f.endsWith("_pi13.jsonl"))!;
  return readFileSync(path.join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((l) => (JSON.parse(l) as { type: string }).type);
}

/** The host's truncation remediation, wired exactly as Electron main wires it. */
function attachHostTruncationRemediation(result: StartCbeSessionResult, cutOffs: string[]) {
  const detector = new TruncationDetector();
  result.session.subscribe((e) => {
    if (e.type === "agent_start") detector.reset();
    if (e.type !== "message_end" || e.message.role !== "assistant") return;
    applyTruncationVerdict(
      detector.record({
        role: e.message.role,
        stopReason: e.message.stopReason ?? "",
        text: e.message.text,
        toolCallCount: e.message.toolCallCount,
      }),
      { session: result.session, notifyCutOff: (note) => cutOffs.push(note) }
    );
  });
}

describe("Scenario: A length stop is first continued by CBE, then recovered by Pi", () => {
  it("steers CBE's continues, then lets Pi omit the attempt, compact and retry once — all in one run", async () => {
    script = installScriptedProvider();
    const { session, events } = await start("http://127.0.0.1:0/v1", { contextLength: 20_000, settings: SMALL_WINDOW });
    script.push({ blocks: [{ kind: "text", text: "Erste Antwort." }] });
    await session.session.prompt("erste");
    events.length = 0;
    const cutOffs: string[] = [];
    attachHostTruncationRemediation(session, cutOffs);
    for (let i = 0; i <= TRUNCATION_CONTINUE_MAX; i += 1) {
      script.push({ blocks: [{ kind: "text", text: `Teil${i + 1}` }], stopReason: "length", outputTokens: 50 });
    }
    script.push(
      { blocks: [{ kind: "text", text: "## Zusammenfassung" }] },
      { blocks: [{ kind: "text", text: "## Präfix" }] },
      { blocks: [{ kind: "text", text: "Vollständige Antwort." }] }
    );

    await session.session.prompt("zweite");

    // CBE's continues were steered first (the budget), then the cut-off surfaced…
    // (Agent requests only: the summary requests serialise the conversation, steers included.)
    const continues = script.requests.filter(
      (r) => r.toolNames.length > 0 && /cut off mid-generation/.test(r.userTexts.at(-1) ?? "")
    );
    expect(continues).toHaveLength(TRUNCATION_CONTINUE_MAX);
    expect(cutOffs).toHaveLength(1);
    // …and Pi recovered: overflow compaction with a retry, then a complete answer.
    expect(events.filter((e) => e.type.startsWith("compaction_"))).toEqual([
      { type: "compaction_start", reason: "overflow" },
      { type: "compaction_end", reason: "overflow", aborted: false, willRetry: true },
    ]);
    const lastAnswer = events.filter((e) => e.type === "message_end").at(-1);
    expect(lastAnswer).toMatchObject({
      message: { role: "assistant", stopReason: "stop", text: "Vollständige Antwort." },
    });
    expect(runBracket(events)).toEqual(ONE_RUN);
    // Pi records the omission and the compaction as their own entries.
    expect(jsonlEntryTypes()).toEqual(expect.arrayContaining(["context_edit", "compaction"]));
  });

  it("with no history to compact, omits the truncated attempt from model context and ends the run without a retry", async () => {
    script = installScriptedProvider();
    const { session, events } = await start("http://127.0.0.1:0/v1");
    script.push({ blocks: [{ kind: "text", text: "Teilantwort" }], stopReason: "length", outputTokens: 50 });

    await session.session.prompt("Frage");

    expect(script.requests).toHaveLength(1);
    expect(events.some((e) => e.type.startsWith("compaction_"))).toBe(false);
    expect(runBracket(events)).toEqual(ONE_RUN);
    expect(jsonlEntryTypes()).toContain("context_edit");
  });
});

describe("Scenario: Threshold compaction may run mid-run, between a tool result and the next answer", () => {
  it("compacts after the tool result and before the next assistant message, inside the same run", async () => {
    script = installScriptedProvider();
    const { session, events } = await start("http://127.0.0.1:0/v1", { contextLength: 20_000, settings: SMALL_WINDOW });
    script.push({ blocks: [{ kind: "text", text: "Erste." }] });
    await session.session.prompt("erste");
    events.length = 0;
    script.push(
      { blocks: [{ kind: "toolCall", id: "c1", name: "ls", args: { path: "." } }], inputTokens: 19_500 },
      { blocks: [{ kind: "text", text: "## Zusammenfassung" }] },
      { blocks: [{ kind: "text", text: "## Präfix" }] },
      { blocks: [{ kind: "text", text: "Nach dem Tool." }] }
    );

    await session.session.prompt("zweite");

    const order = events
      .filter((e) => ["tool_execution_end", "compaction_start", "compaction_end", "message_end"].includes(e.type))
      .map((e) => (e.type === "message_end" ? `message_end:${e.message.role}` : e.type));
    expect(order).toEqual([
      "message_end:user",
      "message_end:assistant",
      "tool_execution_end",
      "message_end:toolResult",
      "compaction_start",
      "compaction_end",
      "message_end:assistant",
    ]);
    expect(runBracket(events)).toEqual(ONE_RUN);
  });
});

describe("Scenario: Threshold compaction fires on servers that report no usage", () => {
  it("estimates the context when the provider sends all-zero usage, and compacts", async () => {
    script = installScriptedProvider();
    const { session, events } = await start("http://127.0.0.1:0/v1", { contextLength: 20_000, settings: SMALL_WINDOW });
    script.push(
      { blocks: [{ kind: "text", text: "Wort ".repeat(16_000) }], noUsage: true },
      { blocks: [{ kind: "text", text: "## Zusammenfassung" }] },
      { blocks: [{ kind: "text", text: "## Präfix" }] }
    );

    await session.session.prompt("erste");

    expect(events.some((e) => e.type === "compaction_start" && e.reason === "threshold")).toBe(true);
    // Post-run compaction stays inside the run bracket: the settled end follows it.
    const end = events.findIndex((e) => e.type === "agent_end");
    expect(events.findIndex((e) => e.type === "compaction_end")).toBeLessThan(end);
  });
});

describe("Scenario: Provider retry, timeout and cache-warming policy is explicit", () => {
  it("runs every session with the characterised retry/timeout values and cache warming off", async () => {
    const { session } = await start("http://127.0.0.1:0/v1");
    const settings = piSessionOf(session.session).settingsManager;
    expect(settings.getProviderRetrySettings()).toEqual({
      maxRetries: LEGACY_PROVIDER_MAX_RETRIES,
      timeoutMs: LEGACY_PROVIDER_TIMEOUT_MS,
      maxRetryDelayMs: 60_000,
    });
    expect(settings.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 3, baseDelayMs: 2_000 });
    expect(settings.getCacheWarmingMode()).toBe("off");
    expect(settings.getCompactionSettings()).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });
    expect(CBE_PI_SETTINGS.cacheWarming).toBe("off");
  });

  it("retries a transient HTTP 503 inside the provider request, invisibly to the run", async () => {
    mock = await startMockOpenAiServer();
    const { session, events } = await start(mock.baseURL);
    mock.push(
      { kind: "status", status: 503, body: JSON.stringify({ error: { message: "busy" } }) },
      { kind: "status", status: 503, body: "{}" },
      { kind: "text", text: "Ok." }
    );

    await session.session.prompt("Hallo");

    expect(mock.requests).toHaveLength(LEGACY_PROVIDER_MAX_RETRIES + 1);
    expect(events.some((e) => e.type === "auto_retry_start")).toBe(false);
    expect(events.filter((e) => e.type === "message_end").at(-1)).toMatchObject({
      message: { role: "assistant", stopReason: "stop", text: "Ok." },
    });
    expect(runBracket(events)).toEqual(ONE_RUN);
  });

  it("reports a non-retryable provider error with the response body in its text", async () => {
    mock = await startMockOpenAiServer();
    const { session, events } = await start(mock.baseURL);
    mock.push({
      kind: "status",
      status: 400,
      body: JSON.stringify({ error: { message: "unknown parameter: frobnicate" } }),
    });

    await session.session.prompt("Hallo");

    expect(mock.requests).toHaveLength(1);
    const error = events.filter((e) => e.type === "message_end").at(-1);
    expect(error).toMatchObject({ message: { role: "assistant", stopReason: "error" } });
    expect(error?.type === "message_end" ? error.message.errorMessage : "").toContain("unknown parameter: frobnicate");
    expect(runBracket(events)).toEqual(ONE_RUN);
  });
});

describe("Scenario: A malformed tool argument fails validation and shows the model what it sent", () => {
  it("returns an error tool result carrying the raw arguments, and the run continues", async () => {
    mock = await startMockOpenAiServer();
    const { session, events } = await start(mock.baseURL);
    mock.push({ kind: "toolCall", id: "c1", name: "ls", rawArguments: '{"path": ".' }, { kind: "text", text: "Ok." });

    await session.session.prompt("Hallo");

    const end = events.find((e) => e.type === "tool_execution_end");
    expect(end).toMatchObject({ type: "tool_execution_end", toolName: "ls", isError: true });
    const toolMessage = ((mock.requests[1]!.messages as Array<{ role: string; content: string }>) ?? []).find(
      (m) => m.role === "tool"
    );
    expect(toolMessage?.content).toContain('Invalid arguments for tool "ls"');
    expect(toolMessage?.content).toContain('Received arguments:\n{"path": ".');
    expect(runBracket(events)).toEqual(ONE_RUN);
  });
});

describe("Scenario: The compaction summary request is Pi's own, budgeted, tool-free request", () => {
  it("sends summaries without tools and with their own output budget, untouched by the request-parity hook", async () => {
    mock = await startMockOpenAiServer();
    const { session, events } = await start(mock.baseURL, { contextLength: 20_000, settings: SMALL_WINDOW });
    mock.push({ kind: "text", text: "Erste." });
    await session.session.prompt("erste");
    mock.push(
      { kind: "text", text: "Zweite.", promptTokens: 19_000 },
      { kind: "text", text: "## Summary" },
      { kind: "text", text: "## Prefix" }
    );

    await session.session.prompt("zweite");

    const agentRequests = mock.requests.filter((r) => Array.isArray(r.tools) && (r.tools as unknown[]).length > 0);
    const summaryRequests = mock.requests.filter((r) => !Array.isArray(r.tools) || (r.tools as unknown[]).length === 0);
    expect(agentRequests).toHaveLength(2);
    for (const r of agentRequests) expect(r).not.toHaveProperty("max_completion_tokens");
    expect(summaryRequests.length).toBeGreaterThanOrEqual(1);
    for (const r of summaryRequests) {
      // Budget = a share of `reserveTokens` (0.8 for the history, 0.5 for a split turn).
      expect([800, 500]).toContain(r.max_completion_tokens);
      expect(String((r.messages as Array<{ content: unknown }>)[0]!.content)).toMatch(/summarization assistant/);
    }
    expect(events.some((e) => e.type === "compaction_end")).toBe(true);
  });
});

describe("Scenario: A resumed CBE session runs the current tool set and prompt", () => {
  it("activates the full CBE allowlist on a seeded resume rather than a transcript-recorded loadout", async () => {
    const { session } = await start("http://127.0.0.1:0/v1", { resume: true });
    expect([...piSessionOf(session.session).getActiveToolNames()].sort()).toEqual([...CBE_TOOL_ALLOWLIST].sort());
  });
});
