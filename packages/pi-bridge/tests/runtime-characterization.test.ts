/**
 * Behaviour-preservation characterization of the embedded runtime (capability
 * `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port* —
 * Scenario: *Boundary extraction changes no observable behavior*).
 *
 * The REAL `startCbeSession` runs against a deterministic provider script that
 * reaches the request path through Pi's public provider registration
 * (`helpers/scripted-provider.ts`). Each case freezes what a host consumer
 * observes — the event sequence and payloads, the provider selection, the
 * transcript, the persisted session record and the stop/retry/compaction
 * outcome — as literal expectations.
 *
 * Written BEFORE the boundary refactor, against a projection of the raw Pi event
 * stream onto exactly the fields the host consumers read; the refactor then
 * replaced that projection with the port's own normalized events and left every
 * expectation below untouched. That is the before/after equivalence.
 *
 * Re-pinned by `adopt-settled-pi-runtime-lifecycle` for Pi 1.3.0 (capability
 * `agent-harness`, Requirements: *Run Completion Uses Pi Settled State* and
 * *Accepted Pi 1.3 Runtime Semantics Are Explicit Contracts*). Every changed
 * expectation is a deliberate one: the terminal `agent_end` is the settled end
 * and carries `aborted` instead of `willRetry`; a retry's low-level end/start
 * pair and Pi's transcript system message reach the host as `runtime_activity`;
 * and per-case runtime settings are applied through the session's public
 * `settingsManager` instead of a project `.pi/settings.json`, which the explicit
 * resource policy no longer reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CBE_TOOL_ALLOWLIST, startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import { cbeIdentityPrompt } from "../src/cbe-system-prompt.js";
import { ATOMIZATION_TOOLS, createPiAtomizationSessionFactory } from "../src/atomization-session.js";
import { installScriptedProvider, type ScriptedProvider } from "./helpers/scripted-provider.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");

let tmp: string;
let script: ScriptedProvider;
let started: StartCbeSessionResult | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-runtime-char-"));
  script = installScriptedProvider();
});

afterEach(() => {
  started?.session.dispose();
  started = undefined;
  script.uninstall();
  rmSync(tmp, { recursive: true, force: true });
});

interface StartOverrides {
  contextLength?: number;
  settings?: Record<string, unknown>;
}

async function start(overrides: StartOverrides = {}): Promise<StartCbeSessionResult> {
  const cwd = path.join(tmp, "workspace");
  mkdirSync(cwd, { recursive: true });
  started = await startCbeSession({
    profile: "app",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    sessionId: "char-session",
    agentDir: path.join(tmp, "agent"),
    cwd,
    writableRoots: { dirs: [cwd] },
    provider: {
      baseURL: "http://127.0.0.1:0/v1",
      apiKey: "test-key",
      modelId: "model-a",
      ...(overrides.contextLength !== undefined ? { contextLength: overrides.contextLength } : {}),
    },
  });
  // Per-case runtime settings through the session's public settings manager: a
  // fast retry so the retry case does not wait seconds, and whatever a case adds.
  piSessionOf(started.session).settingsManager.applyOverrides({
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
    ...overrides.settings,
  } as never);
  return started;
}

/** What a host consumer observes of one run: the session's runtime events. */
function observe(result: StartCbeSessionResult): CbeRuntimeEvent[] {
  const seen: CbeRuntimeEvent[] = [];
  result.session.subscribe((event) => seen.push(event));
  return seen;
}

/** The persisted Pi session record, reduced to entry type and message role. */
function persistedShape(): string[] {
  const dir = path.join(tmp, "sessions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/_char-session\.jsonl$/);
  return readFileSync(path.join(dir, files[0]!), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; message?: { role?: string } })
    .map((entry) => (entry.message?.role ? `${entry.type}:${entry.message.role}` : entry.type));
}

const ASSISTANT_DONE = { role: "assistant", stopReason: "stop" } as const;

describe("Scenario: Boundary extraction changes no observable behavior — an ordinary run with thinking, a tool call and text", () => {
  it("emits the normalized sequence, routes to the configured provider and persists the turn", async () => {
    const result = await start();
    const events = observe(result);
    script.push(
      {
        blocks: [
          { kind: "thinking", text: "plan" },
          { kind: "text", text: "Ich schaue nach. " },
          { kind: "toolCall", id: "call-1", name: "ls", args: { path: "." } },
        ],
      },
      { blocks: [{ kind: "text", text: "Fertig." }] }
    );

    await result.session.prompt("Bitte prüfe den Arbeitsbereich.");

    expect(events).toEqual([
      { type: "agent_start" },
      { type: "turn_start" },
      // Pi 1.x's transcript system message (start + end): no product meaning.
      { type: "runtime_activity" },
      { type: "runtime_activity" },
      { type: "message_start" },
      { type: "message_end", message: { role: "user", text: "Bitte prüfe den Arbeitsbereich.", toolCallCount: 0 } },
      { type: "message_start" },
      { type: "thinking_start", contentIndex: 0 },
      { type: "thinking_delta", contentIndex: 0, delta: "plan" },
      { type: "thinking_end", contentIndex: 0 },
      { type: "runtime_activity" },
      { type: "text_delta", delta: "Ich schaue nach. " },
      { type: "runtime_activity" },
      { type: "runtime_activity" },
      { type: "runtime_activity" },
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "toolUse", text: "Ich schaue nach. ", toolCallCount: 1 },
      },
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "ls", args: { path: "." } },
      {
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "ls",
        result: { content: [{ type: "text", text: "(empty directory)" }] },
        isError: false,
      },
      { type: "message_start" },
      { type: "message_end", message: { role: "toolResult", text: "(empty directory)", toolCallCount: 0 } },
      { type: "turn_end" },
      { type: "turn_start" },
      { type: "message_start" },
      { type: "runtime_activity" },
      { type: "text_delta", delta: "Fertig." },
      { type: "runtime_activity" },
      { type: "message_end", message: { ...ASSISTANT_DONE, text: "Fertig.", toolCallCount: 0 } },
      { type: "turn_end" },
      // Pi's low-level agent_end stays inside the adapter; the settled end follows.
      { type: "runtime_activity" },
      { type: "agent_end", aborted: false },
    ]);
    expect(script.requests.map((r) => `${r.provider}/${r.modelId}`)).toEqual(["byo-llm/model-a", "byo-llm/model-a"]);
    // Active tool set and prompt composition, as the provider receives them.
    expect(script.requests[0]!.toolNames).toEqual([...CBE_TOOL_ALLOWLIST].sort());
    const prompt = script.requests[0]!.systemPrompt ?? "";
    expect(prompt.startsWith(cbeIdentityPrompt)).toBe(true);
    const skillAt = prompt.indexOf(
      result.skillBody
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .trim()
        .slice(0, 200)
    );
    const envAt = prompt.indexOf(result.env.toSystemPromptBlock());
    expect(skillAt).toBeGreaterThan(cbeIdentityPrompt.length - 1);
    expect(envAt).toBeGreaterThan(skillAt);
    expect(persistedShape()).toEqual([
      "session",
      "model_change",
      "thinking_level_change",
      // Pi 1.x persists the system prompt sections as a transcript entry.
      "message:system",
      "message:user",
      "message:assistant",
      "message:toolResult",
      "message:assistant",
    ]);
  });
});

describe("Scenario: Boundary extraction changes no observable behavior — provider error, auto-retry and provider rebinding", () => {
  it("a non-retryable provider error ends the run with an error message_end and no retry", async () => {
    const result = await start();
    const events = observe(result);
    script.push({ blocks: [], stopReason: "error", errorMessage: "invalid request: unknown parameter" });

    await result.session.prompt("Hallo");

    expect(events.slice(-5)).toEqual([
      { type: "message_start" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "invalid request: unknown parameter",
          text: "",
          toolCallCount: 0,
        },
      },
      { type: "turn_end" },
      { type: "runtime_activity" },
      { type: "agent_end", aborted: false },
    ]);
  });

  it("a retryable provider error is retried once and the run then completes", async () => {
    const result = await start();
    const events = observe(result);
    script.push(
      { blocks: [], stopReason: "error", errorMessage: "503 service unavailable" },
      { blocks: [{ kind: "text", text: "Jetzt geht es." }] }
    );

    await result.session.prompt("Hallo");

    const lifecycle = events.filter((e) =>
      ["agent_start", "agent_end", "auto_retry_start", "auto_retry_end"].includes(e.type)
    );
    // ONE CBE run: the retry's low-level end and start never reach the host.
    expect(lifecycle).toEqual([
      { type: "agent_start" },
      {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 2,
        delayMs: 1,
        errorMessage: "503 service unavailable",
      },
      { type: "auto_retry_end", success: true, attempt: 1 },
      { type: "agent_end", aborted: false },
    ]);
    expect(events).toContainEqual({
      type: "message_end",
      message: { ...ASSISTANT_DONE, text: "Jetzt geht es.", toolCallCount: 0 },
    });
  });

  it("a provider rebind routes the next request to the new model and keeps the transcript", async () => {
    const result = await start();
    script.push({ blocks: [{ kind: "text", text: "A" }] }, { blocks: [{ kind: "text", text: "B" }] });
    await result.session.prompt("erste");
    await result.session.updateProvider({ baseURL: "http://127.0.0.1:0/v2", apiKey: "k2", modelId: "model-b" });
    await result.session.prompt("zweite");

    expect(script.requests.map((r) => `${r.provider}/${r.modelId}`)).toEqual(["byo-llm/model-a", "byo-llm/model-b"]);
    expect(script.requests[1]!.userTexts).toEqual(["erste", "zweite"]);
  });
});

describe("Scenario: Boundary extraction changes no observable behavior — the lecturer's stop", () => {
  it("a stop during a streaming answer is classified stopped and ends the run once", async () => {
    const result = await start();
    const events = observe(result);
    // The host drives the stop's run boundaries from the run events (as Electron
    // main does); the bridge alone never calls them.
    result.session.subscribe((event) => {
      if (event.type === "agent_start") result.turnStop.noteRunStart();
      if (event.type === "agent_end") result.turnStop.noteRunEnd();
    });
    script.push({ blocks: [{ kind: "text", text: "Ich beginne" }], waitForAbort: true });

    const run = result.session.prompt("Erkläre mir alles.");
    await expect.poll(() => events.some((e) => e.type === "text_delta")).toBe(true);
    const outcome = await result.turnStop.stop();
    await run;

    expect(outcome).toEqual({ status: "stopped" });
    expect(result.turnStop.stoppedForCurrentRun()).toBe(true);
    expect(events.slice(-4)).toEqual([
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "aborted",
          errorMessage: "Request was aborted",
          text: "Ich beginne",
          toolCallCount: 0,
        },
      },
      { type: "turn_end" },
      { type: "runtime_activity" },
      // The stop completes at settlement, which carries the aborted outcome.
      { type: "agent_end", aborted: true },
    ]);
  });
});

describe("Scenario: Boundary extraction changes no observable behavior — threshold compaction", () => {
  it("a run over the threshold compacts once and arms the retained-state handover", async () => {
    const result = await start({
      contextLength: 4000,
      settings: { compaction: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1 } },
    });
    const events = observe(result);
    script.push({ blocks: [{ kind: "text", text: "Erste Antwort." }] });
    await result.session.prompt("erste Frage");
    script.push(
      { blocks: [{ kind: "text", text: "Zweite Antwort." }], inputTokens: 3500 },
      // History summary, then the split turn's prefix summary.
      { blocks: [{ kind: "text", text: "## Zusammenfassung\nBisher zwei Fragen." }] },
      { blocks: [{ kind: "text", text: "## Präfix\nZweite Frage." }] }
    );
    await result.session.prompt("zweite Frage");
    await expect.poll(() => events.some((e) => e.type === "compaction_end")).toBe(true);

    const compaction = events.filter((e) => e.type.startsWith("compaction_"));
    expect(compaction).toEqual([
      { type: "compaction_start", reason: "threshold" },
      { type: "compaction_end", reason: "threshold", aborted: false, willRetry: false },
    ]);
    expect(result.retainedStateHandover.isPending()).toBe(true);
    expect(script.requests).toHaveLength(4);
  });
});

describe("Scenario: Boundary extraction changes no observable behavior — the atomization policy", () => {
  it("runs FS-only and ephemeral, tracks wiki writes, and stamps activity on every event", async () => {
    const courseDir = path.join(tmp, "course");
    const wikiDir = path.join(courseDir, "wiki");
    const skillDir = path.join(tmp, "wiki-skill");
    mkdirSync(wikiDir, { recursive: true });
    mkdirSync(path.join(courseDir, ".pi"), { recursive: true });
    writeFileSync(path.join(courseDir, ".pi", "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: wiki\nversion: 1.2.3\n---\n\nAtomize the document.\n");
    const factory = createPiAtomizationSessionFactory({
      courseDir,
      wikiDir,
      wikiSkillDir: skillDir,
      agentDir: path.join(tmp, "agent"),
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "atom-model" },
    });
    script.push(
      {
        blocks: [
          { kind: "toolCall", id: "w1", name: "write", args: { path: "wiki/atom-1.md", content: "# Atom\n" } },
          { kind: "toolCall", id: "w2", name: "write", args: { path: "raw/escape.md", content: "nein" } },
        ],
      },
      { blocks: [{ kind: "text", text: "  Ein Atom erstellt.  " }] }
    );

    const session = await factory({ rawRelPath: "raw/doc.md" });
    const before = session.lastActivityAt!();
    await new Promise((r) => setTimeout(r, 5));
    const outcome = await session.run("Atomisiere raw/doc.md");
    session.dispose();

    expect(outcome).toEqual({ summary: "Ein Atom erstellt.", writtenWikiFiles: ["atom-1.md"] });
    expect(session.writtenWikiFiles!()).toEqual(["atom-1.md"]);
    expect(session.lastActivityAt!()).toBeGreaterThan(before);
    expect(script.requests[0]!.toolNames).toEqual([...ATOMIZATION_TOOLS].sort());
    expect(script.requests[0]!.provider).toBe("byo-llm");
    expect(script.requests[0]!.modelId).toBe("atom-model");
    expect(script.requests[0]!.systemPrompt).toContain("Atomize the document.");
    expect(script.requests[0]!.systemPrompt).toContain("raw document to process:  raw/doc.md");
    // Ephemeral: nothing persisted under the course or the agent home.
    expect(readdirSync(courseDir).sort()).toEqual([".pi", "wiki"]);
    expect(readdirSync(wikiDir)).toEqual(["atom-1.md"]);
  });
});
