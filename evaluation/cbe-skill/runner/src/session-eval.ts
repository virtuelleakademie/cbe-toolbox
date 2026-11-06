/**
 * EvalSession adapter interface + a mock implementation.
 *
 * This module deliberately has NO dependency on `@cbe/pi-bridge` (and therefore
 * none on the Pi runtime). The runner depends only on this interface, so the
 * whole runner→checker path is exercisable under `npm test` with zero LLM calls.
 * The production adapter that wraps `startCbeSession` lives in `session-pi.ts`
 * and is imported only by the CLI.
 */

import type { ProbeLecturerSupport, ToolInvocation, TurnEvent } from "./types.js";

export interface EvalSessionSetup {
  profile: "app" | "headless";
  affordances?: Record<string, boolean>;
  /** Persisted lecturer profile injected at session start (capability
   * `agent-harness`, Requirement: Session-Start Profile Injection). Passed
   * through untyped; pi-bridge validates the shape at runtime. */
  lecturerProfile?: Record<string, unknown>;
  /** Lecturer identity record injected at session start as a `lecturer-identity`
   * block (capability `agent-harness`, Requirement: Session-Start Identity
   * Injection — eval exercisability). A SEPARATE prior from `lecturerProfile`
   * above and never a sixth dimension of it. Passed through untyped; pi-bridge
   * validates and renders it at runtime. */
  lecturerIdentity?: Record<string, unknown>;
  /** Support-preference seed for the probe's isolated store (capability
   * `agent-harness`, Requirement: Separate Lecturer-Wide Support Preference — eval
   * exercisability). Shape-validated by the loader. */
  lecturerSupport?: ProbeLecturerSupport;
  /** Wiki fixture files (wiki-relative path → content), provisioned by the factory. */
  wikiFixture?: Record<string, string>;
  /** Raw course.md content injected at session start. */
  courseContext?: string;
  /** Carried-over canvas artefacts injected at session start as a `canvas prior`
   * (capability `agent-harness`, Requirement: Session-Start Canvas Artefact
   * Injection — eval exercisability). Passed through untyped; pi-bridge renders
   * and validates the block at runtime. */
  canvasArtefacts?: Array<Record<string, unknown>>;
  /** Carried-over design-flow step coverage, rendered as a `step-coverage prior`
   * (capability `agent-harness`, Requirement: Session-Start Retained-State
   * Injection — eval exercisability). */
  stepCoverage?: Array<Record<string, unknown>>;
  /** Carried-over maturity reading, rendered as a `maturity prior`. */
  maturity?: Record<string, unknown>;
  /** The two Lecturer-State layers (global profile + per-course overlay),
   * rendered as the `lecturer-state layers` block (capability
   * `cbe-skill-eval-harness`, Requirement: A Probe Reproduces the App's Session
   * Priors, and Every Divergence Is Declared). Shape-validated by the loader. */
  lecturerState?: { globalPath: string; globalContent: string; overlayPath: string; overlayContent: string };
  /** Recorded decisions, pre-summarised to one line; rendered as a `decisions prior`. */
  decisionsSummary?: string;
}

export interface TurnResult {
  assistant: string;
  tools: ToolInvocation[];
  events?: TurnEvent[];
}

export interface EvalSession {
  /** Send one user turn, resolve with the assistant text + tools emitted for that turn. */
  sendTurn(text: string): Promise<TurnResult>;
  close(): Promise<void>;
}

/** A factory creates ONE fresh session for a probe. */
export type EvalSessionFactory = (setup: EvalSessionSetup) => Promise<EvalSession>;

/**
 * Mock session: returns pre-canned turn results in order. Used by tests and by
 * `--dry-run`-adjacent paths. Records the setup it was created with and the user
 * turns it received so tests can assert against them.
 */
export class MockEvalSession implements EvalSession {
  readonly received: string[] = [];
  private cursor = 0;

  constructor(
    readonly setup: EvalSessionSetup,
    private readonly canned: TurnResult[]
  ) {}

  async sendTurn(text: string): Promise<TurnResult> {
    this.received.push(text);
    const r = this.canned[this.cursor] ?? { assistant: "", tools: [] };
    this.cursor += 1;
    return r;
  }

  async close(): Promise<void> {
    /* no-op */
  }
}

/**
 * Build a mock factory. `scripts` maps the turn index to a canned result; the
 * same script is replayed for every probe (each probe gets a fresh session that
 * starts at cursor 0 — proving sub-probes do not share state). Tracks every
 * session created so a test can inspect isolation.
 */
export function mockSessionFactory(canned: TurnResult[]): EvalSessionFactory & { sessions: MockEvalSession[] } {
  const sessions: MockEvalSession[] = [];
  const factory = async (setup: EvalSessionSetup): Promise<EvalSession> => {
    const s = new MockEvalSession(setup, canned);
    sessions.push(s);
    return s;
  };
  return Object.assign(factory, { sessions });
}
