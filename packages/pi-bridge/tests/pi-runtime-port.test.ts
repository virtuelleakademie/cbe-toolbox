/**
 * The CBE-owned runtime port against the REAL runtime (capability
 * `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*).
 * ADAPTER-level test: it may look behind the port (`piSessionOf`) to prove what
 * the port does and does not hand out. Every model call goes through the
 * deterministic provider script (`helpers/scripted-provider.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { CBE_TOOL_ALLOWLIST, startCbeSession, type StartCbeSessionResult } from "../src/session.js";
import { ATOMIZATION_TOOLS, createPiAtomizationSessionFactory } from "../src/atomization-session.js";
import { createPiEventNormalizer } from "../src/runtime/pi-events.js";
import type { CbeRuntimeEvent } from "../src/runtime/contracts.js";
import { installScriptedProvider, type ScriptedProvider } from "./helpers/scripted-provider.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const PI_CLASSES = [AgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager];

let tmp: string;
let script: ScriptedProvider;
let started: StartCbeSessionResult | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-runtime-port-"));
  script = installScriptedProvider();
});

afterEach(() => {
  started?.session.dispose();
  started = undefined;
  script.uninstall();
  rmSync(tmp, { recursive: true, force: true });
});

async function start(): Promise<StartCbeSessionResult> {
  const cwd = path.join(tmp, "workspace");
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ retry: { enabled: false } }));
  started = await startCbeSession({
    profile: "app",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    sessionId: "port-session",
    agentDir: path.join(tmp, "agent"),
    cwd,
    writableRoots: { dirs: [cwd] },
    provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "model-a" },
  });
  return started;
}

/** Every reachable non-function value of `root`, through own enumerable properties. */
function reachableValues(root: unknown): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  const visit = (value: unknown, depth: number) => {
    if (value === null || typeof value !== "object" || seen.has(value) || depth > 8) return;
    seen.add(value);
    out.push(value);
    const entries = value instanceof Map ? [...value.values()] : Object.values(value as Record<string, unknown>);
    for (const child of entries) visit(child, depth + 1);
  };
  visit(root, 0);
  return out;
}

describe("Scenario: Product layers receive no concrete Pi session", () => {
  it("returns a CBE port carrying exactly the product operations and no way back to Pi", async () => {
    const result = await start();
    const port = result.session;

    expect(Object.keys(port).sort()).toEqual([
      "abort",
      "dispose",
      "getCommands",
      "getContextUsage",
      "prompt",
      "steer",
      "subscribe",
      "updateProvider",
    ]);
    expect(Object.getPrototypeOf(port)).toBe(Object.prototype);
    for (const value of Object.values(port)) expect(typeof value).toBe("function");
    for (const piMember of [
      "agent",
      "messages",
      "model",
      "modelRegistry",
      "modelRuntime",
      "sessionManager",
      "state",
      "systemPrompt",
    ]) {
      expect(piMember in port, piMember).toBe(false);
    }
    // The adapter does hold a real Pi session behind it — the port just never shows it.
    expect(piSessionOf(port)).toBeInstanceOf(AgentSession);
  });

  it("hands out no Pi object anywhere in the start result the host keeps", async () => {
    const result = await start();
    const leaked = reachableValues(result).filter((value) => PI_CLASSES.some((cls) => value instanceof cls));
    expect(leaked).toEqual([]);
  });

  it("reports context usage as a CBE value, not the runtime's object", async () => {
    const result = await start();
    script.push({ blocks: [{ kind: "text", text: "Hallo." }] });
    await result.session.prompt("Hallo");

    const usage = result.session.getContextUsage();
    const raw = piSessionOf(result.session).getContextUsage();
    expect(usage).toBeDefined();
    expect(usage).not.toBe(raw);
    expect(Object.keys(usage!).sort()).toEqual(["contextWindow", "percent", "tokens"]);
    expect(usage).toEqual({ tokens: raw!.tokens, contextWindow: raw!.contextWindow, percent: raw!.percent });
  });

  it("gives the atomization policy a CBE run surface made of functions only", async () => {
    const courseDir = path.join(tmp, "course");
    mkdirSync(path.join(courseDir, "wiki"), { recursive: true });
    const skillDir = path.join(tmp, "wiki-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: wiki\n---\n\nAtomize.\n");
    const session = await createPiAtomizationSessionFactory({
      courseDir,
      wikiDir: path.join(courseDir, "wiki"),
      wikiSkillDir: skillDir,
      agentDir: path.join(tmp, "agent"),
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "m" },
    })({ rawRelPath: "raw/a.md" });
    try {
      expect(Object.keys(session).sort()).toEqual(["abort", "dispose", "lastActivityAt", "run", "writtenWikiFiles"]);
      for (const value of Object.values(session)) expect(typeof value).toBe("function");
      expect(reachableValues(session).filter((value) => PI_CLASSES.some((cls) => value instanceof cls))).toEqual([]);
    } finally {
      session.dispose();
    }
  });
});

describe("Scenario: Runtime events are normalized once at the boundary", () => {
  it("delivers exactly one normalized event per runtime event, in order, with no upstream shape", async () => {
    const result = await start();
    const raw: unknown[] = [];
    piSessionOf(result.session).subscribe((event) => raw.push(event));
    const normalized: CbeRuntimeEvent[] = [];
    result.session.subscribe((event) => normalized.push(event));
    script.push(
      {
        blocks: [
          { kind: "thinking", text: "plan" },
          { kind: "text", text: "Ich lese. " },
          { kind: "toolCall", id: "c1", name: "ls", args: { path: "." } },
        ],
      },
      { blocks: [], stopReason: "error", errorMessage: "invalid request" }
    );

    await result.session.prompt("Bitte.");

    expect(normalized.length).toBe(raw.length);
    const normalize = createPiEventNormalizer();
    expect(normalized).toEqual(raw.map((event) => normalize(event as never)));
    // No upstream field crosses: the full runtime message and stream event stay behind.
    const serialized = JSON.stringify(normalized);
    for (const upstream of ["assistantMessageEvent", "partial", "usage", "api", "timestamp", "toolResults"]) {
      expect(serialized, upstream).not.toContain(`"${upstream}"`);
    }
  });

  it("ends a subscription when its handle is called, without touching other listeners", async () => {
    const result = await start();
    const first: CbeRuntimeEvent[] = [];
    const second: CbeRuntimeEvent[] = [];
    const unsubscribe = result.session.subscribe((event) => first.push(event));
    result.session.subscribe((event) => second.push(event));
    unsubscribe();
    script.push({ blocks: [{ kind: "text", text: "Ok." }] });

    await result.session.prompt("Hallo");

    expect(first).toEqual([]);
    expect(second.at(-1)).toEqual({ type: "agent_end", aborted: false });
  });
});

describe("Scenario: Main and atomization sessions retain separate policies", () => {
  it("keeps CBE tools, persistence and configured roots for the main session, FS-only ephemeral wiki-only for atomization", async () => {
    // Main conversation.
    const result = await start();
    const workspace = path.join(tmp, "workspace");
    script.push(
      {
        blocks: [
          { kind: "toolCall", id: "m1", name: "write", args: { path: "notiz.md", content: "ok" } },
          { kind: "toolCall", id: "m2", name: "write", args: { path: path.join(tmp, "outside.md"), content: "no" } },
        ],
      },
      { blocks: [{ kind: "text", text: "Erledigt." }] }
    );
    const mainTools: Array<{ id: string; isError: boolean }> = [];
    result.session.subscribe((e) => {
      if (e.type === "tool_execution_end") mainTools.push({ id: e.toolCallId, isError: e.isError });
    });
    await result.session.prompt("Schreib eine Notiz.");

    expect(script.requests[0]!.toolNames).toEqual([...CBE_TOOL_ALLOWLIST].sort());
    // Tool calls of one batch run concurrently, so their ends arrive in any order.
    expect(mainTools.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "m1", isError: false },
      { id: "m2", isError: true },
    ]);
    expect(readFileSync(path.join(workspace, "notiz.md"), "utf8")).toBe("ok");
    expect(existsSync(path.join(tmp, "outside.md"))).toBe(false);
    expect(readdirSync(path.join(tmp, "sessions")).filter((f) => f.endsWith("_port-session.jsonl"))).toHaveLength(1);

    // Isolated atomization, beside it.
    const courseDir = path.join(tmp, "course");
    const wikiDir = path.join(courseDir, "wiki");
    mkdirSync(wikiDir, { recursive: true });
    mkdirSync(path.join(courseDir, ".pi"), { recursive: true });
    writeFileSync(path.join(courseDir, ".pi", "settings.json"), JSON.stringify({ retry: { enabled: false } }));
    const skillDir = path.join(tmp, "wiki-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: wiki\n---\n\nAtomize.\n");
    const atomization = await createPiAtomizationSessionFactory({
      courseDir,
      wikiDir,
      wikiSkillDir: skillDir,
      agentDir: path.join(tmp, "agent"),
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "atom" },
    })({ rawRelPath: "raw/a.md" });
    script.push(
      {
        blocks: [
          { kind: "toolCall", id: "a1", name: "write", args: { path: "wiki/atom.md", content: "# A" } },
          { kind: "toolCall", id: "a2", name: "write", args: { path: "course-notes.md", content: "no" } },
        ],
      },
      { blocks: [{ kind: "text", text: "Atom erstellt." }] }
    );
    const outcome = await atomization.run("Atomisiere.");
    atomization.dispose();

    expect(script.requests.at(-1)!.toolNames).toEqual([...ATOMIZATION_TOOLS].sort());
    expect(outcome.writtenWikiFiles).toEqual(["atom.md"]);
    expect(existsSync(path.join(courseDir, "course-notes.md"))).toBe(false);
    // Ephemeral: the atomization run persisted no session record anywhere.
    expect(readdirSync(courseDir).sort()).toEqual([".pi", "wiki"]);
    expect(readdirSync(path.join(tmp, "sessions")).filter((f) => f.endsWith(".jsonl"))).toHaveLength(1);
    // And the main session's policy is untouched by the atomization beside it.
    expect(
      script.requests.filter((r) => r.modelId === "model-a").every((r) => r.toolNames.includes("cbe_canvas"))
    ).toBe(true);
  });
});
