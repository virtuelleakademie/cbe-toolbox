/**
 * Production EvalSession adapter: wraps `startCbeSession` from `@cbe/pi-bridge`.
 *
 * IMPORTANT: `@cbe/pi-bridge` (and the Pi runtime) is imported LAZILY inside the
 * factory call, never at module load. Importing this module therefore does NOT
 * pull the runtime — keeping the test path light. The only static reference is
 * TYPE-only, to the Pi-free contract entry `@cbe/pi-bridge/runtime`: the session
 * handle is the CBE-owned port and its events are the normalized CBE runtime
 * events (capability `agent-harness`, Requirement: *Pi Runtime Is Hidden Behind
 * a CBE-Owned Port*), so nothing here decodes an upstream event shape.
 */

import path from "node:path";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import type { EvalSession, EvalSessionFactory, EvalSessionSetup, TurnResult } from "./session-eval.js";
import type { TurnEvent } from "./types.js";
import { ProviderError } from "./judge-client.js";
import type { CbeRuntimeEvent, CbeSessionPort } from "@cbe/pi-bridge/runtime";

/** The part of the CBE session port the eval drives. */
export type EvalSessionPort = Pick<CbeSessionPort, "subscribe" | "prompt" | "dispose">;

export interface StartSessionResultLike {
  session: EvalSessionPort;
  env: { profile: string; affordances: Record<string, boolean> };
}

export interface StartSessionLike {
  (opts: {
    profile: "app" | "headless";
    skillDir: string;
    sessionsDir: string;
    agentDir: string;
    /** The agent's working directory. MUST be passed: `startCbeSession` falls back
     * to `process.cwd()`, which in an eval run is the repository root — see
     * `evalWorkspaceRoot` for what that costs. */
    cwd?: string;
    provider: {
      baseURL: string;
      apiKey: string;
      modelId: string;
      contextLength?: number;
      reasoning?: boolean;
      reasoningEffort?: string;
    };
    paths?: { workspace?: string; corpus?: string; wiki?: string };
    lecturerProfile?: Record<string, unknown>;
    /** Lecturer identity record rendered as a `lecturer-identity` block
     * (capability `agent-harness`, Requirement: Session-Start Identity Injection —
     * eval exercisability). */
    lecturerIdentity?: Record<string, unknown>;
    /** The probe's OWN support-preference service over an isolated in-memory store
     * (capability `agent-harness`, Requirement: Separate Lecturer-Wide Support
     * Preference). Typed opaquely: the runner's type surface does not import
     * pi-bridge, and `startCbeSession` validates nothing here beyond the interface. */
    lecturerSupportService?: unknown;
    courseContext?: string;
    /** Targeted affordance overrides merged onto the profile defaults (capability
     * `agent-harness`, Requirement: cbe_canvas Generative-UI Tool — eval
     * exercisability). Lets a scenario enable the `canvas` affordance so the
     * explicit-clear / ambiguous-clear checkpoints observe the emitted clear call
     * (or its absence) end-to-end. */
    affordances?: Record<string, boolean>;
    /** Carried-over canvas artefacts rendered as a `canvas prior` block
     * (capability `agent-harness`, Requirement: Session-Start Canvas Artefact
     * Injection — eval exercisability). */
    canvasArtefacts?: Array<Record<string, unknown>>;
    /** Retained step coverage / maturity reading (Requirement: Session-Start
     * Retained-State Injection — eval exercisability). */
    stepCoverage?: Array<Record<string, unknown>>;
    maturity?: Record<string, unknown>;
    /** The two Lecturer-State layers (global profile + per-course overlay),
     * rendered as the `lecturer-state layers` block (capability
     * `cbe-skill-eval-harness`, Requirement: A Probe Reproduces the App's
     * Session Priors, and Every Divergence Is Declared). */
    lecturerState?: { globalPath: string; globalContent: string; overlayPath: string; overlayContent: string };
    /** Recorded decisions, pre-summarised host-side to one compact line;
     * rendered as a `decisions prior` block (same requirement as above). */
    decisionsSummary?: string;
  }): Promise<StartSessionResultLike>;
}

/**
 * Accumulates the normalized `session.subscribe` event stream of ONE turn into a
 * TurnResult: `text_delta` for assistant text, `tool_execution_start` / `_end`
 * for tool invocations, and the TWO provider-error surfaces:
 *   - `stream_error` — a provider stream that terminated in error;
 *   - `message_end` with `stopReason === "error"` — the ONLY signal when the provider
 *     returns 4xx before any stream tokens (e.g. an auth failure). The session's
 *     `prompt()` resolves normally in both cases, so ignoring these events silently
 *     turns a provider failure into an empty assistant turn.
 */
export class TurnAccumulator {
  private text = "";
  private tools: { name: string; callId?: string; args?: unknown; result?: unknown; isError?: boolean }[] = [];
  private events: TurnEvent[] = [];
  private errors: string[] = [];

  handle(e: CbeRuntimeEvent): void {
    if (e.type === "text_delta") {
      const delta = e.delta;
      this.text += delta;
      if (delta) this.events.push({ type: "text", text: delta });
    } else if (e.type === "stream_error") {
      this.errors.push(e.errorMessage ?? `Provider error (reason: ${e.reason ?? "unknown"})`);
    } else if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason === "error") {
      this.errors.push(e.message.errorMessage ?? "Provider error (no message)");
    } else if (e.type === "tool_execution_start") {
      this.tools.push({ name: e.toolName, callId: e.toolCallId, args: e.args });
      this.events.push({ type: "tool_start", name: e.toolName, callId: e.toolCallId, args: e.args });
    } else if (e.type === "tool_execution_end") {
      const tool = [...this.tools]
        .reverse()
        .find((call) =>
          e.toolCallId ? call.callId === e.toolCallId : call.name === e.toolName && call.result === undefined
        );
      if (tool) {
        tool.result = e.result;
        tool.isError = e.isError === true;
      }
      this.events.push({
        type: "tool_end",
        name: e.toolName,
        callId: e.toolCallId,
        result: e.result,
        isError: e.isError === true,
      });
    }
  }

  /** Provider-error messages seen since the last drain. */
  get providerErrors(): readonly string[] {
    return this.errors;
  }

  drain(): TurnResult {
    const r: TurnResult = { assistant: this.text, tools: this.tools, events: this.events };
    this.text = "";
    this.tools = [];
    this.events = [];
    this.errors = [];
    return r;
  }
}

/**
 * Build a ProviderError for a candidate turn that ended in provider errors with no
 * output. Extracts the first HTTP 4xx/5xx status found in the provider messages so
 * the CLI can report e.g. `provider error: candidate call failed (HTTP 401): ...`.
 */
export function candidateProviderError(messages: readonly string[]): ProviderError {
  const unique = [...new Set(messages)];
  const joined = unique.join("; ");
  const status = /\b([45]\d{2})\b/.exec(joined)?.[1];
  const statusNote = status ? ` (HTTP ${status})` : "";
  return new ProviderError(`candidate call failed${statusNote}: ${joined}`, status ? Number(status) : undefined);
}

/**
 * Root under which every eval session gets its own agent workspace (the agent's
 * `cwd`). It MUST sit OUTSIDE the repository, and that is the whole point.
 *
 * WHY. `startCbeSession` defaults `cwd` to `process.cwd()`; until this function
 * existed the runner never passed one, so an eval session's `cwd` was the repo
 * root. Pi's `DefaultResourceLoader` walks `cwd` and EVERY ancestor for
 * `AGENTS.md` / `CLAUDE.md` and inlines what it finds as `<project_instructions>`
 * (`node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js`,
 * `loadProjectContextFiles`). The repo's own engineering handbook — 41,936
 * characters, 73 % of the composed system prompt — was therefore fed to the
 * candidate as project guidance on every eval turn. The desktop app never loads
 * it, because it pins `cwd` to `<userData>/workspace` (`packages/app/src/main/agent.ts`).
 * The eval was measuring a prompt surface the product does not have.
 *
 * The ancestor walk is why a path under `evaluation/cbe-skill/runs/` would NOT
 * have fixed this: the walk reaches the repo root from any descendant of it. The
 * workspace has to leave the tree entirely, which is also exactly the app's shape
 * (an app-owned scratch directory outside the checkout).
 *
 * Per run, so concurrent runs never share a workspace and a run's scratch files
 * are attributable to it.
 *
 * @param runStamp the run's timestamp, so the path is unique per run
 * @param repoRoot the repository root, asserted NOT to contain the result
 */
export function evalWorkspaceRoot(runStamp: string, repoRoot: string): string {
  const root = path.join(os.tmpdir(), "cbe-eval-workspace", `run-${runStamp}`);
  const rel = path.relative(path.resolve(repoRoot), path.resolve(root));
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside) {
    throw new Error(
      `eval workspace ${root} resolves inside the repository ${repoRoot}: pi would load the repo's AGENTS.md ` +
        `into the system prompt as project instructions, which the desktop app never does. Set TMPDIR outside the checkout.`
    );
  }
  return root;
}

export interface PiFactoryOptions {
  skillDir: string;
  sessionsDir: string;
  agentDir: string;
  /**
   * Root for the per-session agent workspaces (the agent's `cwd`). Supply
   * `evalWorkspaceRoot(...)`; see its doc comment for why this must not be a
   * path inside the repository.
   */
  workspaceRoot: string;
  provider: {
    baseURL: string;
    apiKey: string;
    modelId: string;
    contextLength?: number;
    reasoning?: boolean;
    reasoningEffort?: string;
  };
  corpus?: string;
  /** Injectable for tests; defaults to the real `startCbeSession`. */
  startSession?: StartSessionLike;
  /** Test hook: receives each probe's isolated support-preference store as it is
   * created, so a test can prove the probe's own mutation landed there and nowhere
   * else. Never set in a real run. */
  onSupportStore?: (store: import("@cbe/pi-bridge/lecturer-support").InMemoryLecturerSupportStore) => void;
}

class PiEvalSession implements EvalSession {
  readonly env: { profile: string; affordances: Record<string, boolean> };
  private readonly acc = new TurnAccumulator();

  constructor(
    private readonly pi: EvalSessionPort,
    env: StartSessionResultLike["env"]
  ) {
    this.env = env;
    this.pi.subscribe((e) => this.acc.handle(e));
  }

  async sendTurn(text: string): Promise<TurnResult> {
    await this.pi.prompt(text);
    const errors = [...this.acc.providerErrors];
    const r = this.acc.drain(); // always drain, so a failed turn never leaks into the next one
    // Fail fast on provider/auth failures: a turn that ended in a provider error and
    // produced neither text nor tool calls must abort the run (CLI maps ProviderError
    // to exit 3), never reach the judge as an empty assistant turn. A transient error
    // that Pi's auto-retry recovered (text arrived after the error event) is not fatal.
    if (errors.length > 0 && r.assistant.trim() === "" && r.tools.length === 0) {
      throw candidateProviderError(errors);
    }
    return r;
  }

  async close(): Promise<void> {
    this.pi.dispose();
  }
}

/**
 * Build a production session factory. Each factory call creates an isolated
 * session directory so parallel probes never collide.
 */
export function createPiEvalSessionFactory(opts: PiFactoryOptions): EvalSessionFactory {
  let counter = 0;
  return async (setup: EvalSessionSetup): Promise<EvalSession> => {
    const start: StartSessionLike =
      opts.startSession ??
      ((await import("@cbe/pi-bridge")) as unknown as { startCbeSession: StartSessionLike }).startCbeSession;
    counter += 1;
    const isolatedSessionsDir = path.join(opts.sessionsDir, `session-${counter}`);
    // The agent's cwd: one empty workspace per session, created up front so the
    // agent's file tools have somewhere to land, and OUTSIDE the repository so
    // pi's context-file walk finds no `AGENTS.md` to inline (see
    // `evalWorkspaceRoot`). This is what makes the eval's prompt surface the
    // app's prompt surface.
    const workspaceDir = path.join(opts.workspaceRoot, `workspace-${counter}`);
    await mkdir(workspaceDir, { recursive: true });
    // Wiki fixture (capability `lecturer-wiki`): provision an isolated course
    // wiki so probes can exercise wiki-grounded retrieval / wiki-wins precedence.
    let wikiDir: string | undefined;
    if (setup.wikiFixture && Object.keys(setup.wikiFixture).length > 0) {
      wikiDir = path.join(opts.sessionsDir, `wiki-${counter}`);
      for (const [rel, content] of Object.entries(setup.wikiFixture)) {
        const abs = path.join(wikiDir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
      }
    }
    // The support preference: ONE isolated in-memory store per probe, seeded from the
    // scenario, behind the same service type the app's file-backed store sits behind.
    // `cbe_support` writes through it, so a probe's mutation is visible in the probe
    // and nowhere else — never in another probe, never in a production record. The
    // scope reported to the model mirrors the host the profile stands for (the app
    // reports lecturer-wide); the store itself does not outlive the probe, which is a
    // DECLARED divergence (README § Parity): the eval never claims restart durability.
    const support =
      (await import("@cbe/pi-bridge/lecturer-support")) as typeof import("@cbe/pi-bridge/lecturer-support");
    const seed = setup.lecturerSupport;
    const supportStore = new support.InMemoryLecturerSupportStore(
      seed ? { version: 1, revision: seed.revision ?? 0, preference: seed.preference } : null
    );
    const lecturerSupportService = new support.LecturerSupportService(
      supportStore,
      seed?.scope ?? (setup.profile === "app" ? "lecturer-wide" : "session-local")
    );
    opts.onSupportStore?.(supportStore);
    const { session, env } = await start({
      profile: setup.profile,
      skillDir: opts.skillDir,
      sessionsDir: isolatedSessionsDir,
      agentDir: opts.agentDir,
      cwd: workspaceDir,
      provider: opts.provider,
      paths: opts.corpus || wikiDir ? { corpus: opts.corpus, wiki: wikiDir } : undefined,
      lecturerProfile: setup.lecturerProfile,
      // The lecturer's own identity record. Passed only when the scenario states
      // one, so a probe that states none reproduces today's descriptor exactly —
      // the condition the no-question direction is measured under.
      ...(setup.lecturerIdentity ? { lecturerIdentity: setup.lecturerIdentity } : {}),
      lecturerSupportService,
      courseContext: setup.courseContext,
      // Forward scenario affordance overrides so the environment descriptor reports
      // e.g. `canvas: true` even under a headless-leaning profile — required for the
      // deletion scenarios to be exercisable end-to-end.
      ...(setup.affordances ? { affordances: setup.affordances } : {}),
      // Seed carried-over canvas artefacts as a `canvas prior` so adoption /
      // instruction-shaped / PII scenarios are exercisable headlessly.
      ...(setup.canvasArtefacts ? { canvasArtefacts: setup.canvasArtefacts } : {}),
      ...(setup.stepCoverage ? { stepCoverage: setup.stepCoverage } : {}),
      ...(setup.maturity ? { maturity: setup.maturity } : {}),
      // The two priors a probe could not express before `express-app-priors-in-
      // probe-setup`: the two-layer lecturer state and the recorded decisions
      // summary. Passed only when the scenario declares them, so a probe that
      // declares neither renders a descriptor byte-identical to today's.
      ...(setup.lecturerState ? { lecturerState: setup.lecturerState } : {}),
      ...(setup.decisionsSummary ? { decisionsSummary: setup.decisionsSummary } : {}),
    });
    return new PiEvalSession(session, env);
  };
}
