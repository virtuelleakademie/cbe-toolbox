/**
 * The lecturer's stop on a running agent turn (capability `agent-harness`,
 * Requirement: *A Lecturer Can Stop a Running Turn*).
 *
 * The harness ALREADY aborts a chat turn on its own — Requirement: *Tool-Call
 * Loop Remediation* calls `session.abort()` once a tool-call loop persists past
 * its hard cap (`packages/app/src/main/tool-loop-remediation.ts`). The two stops
 * share that one runtime call and want OPPOSITE things from it: the loop breaker
 * clears the draft and replaces it with a neutral note, because runaway output is
 * noise; the lecturer's stop keeps the text, because they read it. This
 * controller is where the two are reconciled — it owns
 *
 *   - the single claim on a run's end, so whichever event takes effect FIRST
 *     owns the recovery and the second is a no-op (one run end, one recovery);
 *   - the per-run `stopped` fact the detectors, the error mapping and the
 *     persisted turn all read;
 *   - idempotence, the pre-run latch, the compaction refusal and the bounded
 *     wait — the whole of which is a pure state machine over injected callbacks,
 *     so it is testable with no Electron, no provider and no real session.
 *
 * Pi is NOT patched: the stop is `AgentSession.abort()` plus `clearQueue()`, both
 * public API. `abort()` does await idle (`abortRetry(); agent.abort(); await
 * agent.waitForIdle()`), so it has no failure mode of its own — a stream that
 * ignores the abort produces a call that simply never settles. "The abort failed"
 * is therefore a TIMEOUT, not a rejection, which is what `TURN_STOP_TIMEOUT_MS`
 * bounds.
 */

/**
 * How long the harness waits for the stopped run to actually END before it
 * reports the stop as timed out.
 *
 * The wait is on the run's END EVENT, not on `abort()` resolving — a stop is
 * complete when the host observes the run end (Requirement: *A Lecturer Can Stop
 * a Running Turn*). The value is deliberately generous: `abort()` waits for an
 * in-flight tool to settle, and a long `read` over a big corpus document is an
 * ordinary reason for the wait to run into seconds. It is a bound on a hang, not
 * a responsiveness target.
 */
export const TURN_STOP_TIMEOUT_MS = 20_000;

/** Why a stop was refused. A CLASSIFICATION, never a message derived from an
 * underlying rejection — provider error text routinely embeds the request URL,
 * and the provider host may not reach a workspace surface. */
export type StopRefusalReason = "compaction";

/**
 * The outcome of one lecturer stop. Every value is a classification the host can
 * render in its OWN copy; none of them carries runtime or provider text.
 *
 * - `stopped` — this stop took effect and the run's end was observed. The
 *   `stopped` marker applies to the turn it produced.
 * - `superseded` — the run's end was already claimed (the loop breaker got there
 *   first). No second abort, no second recovery note, and NO stopped marker: the
 *   loop-broken run keeps its own neutral note and is never presented to the
 *   lecturer as something they stopped.
 * - `not-running` — nothing was in flight for this session. A silent no-op,
 *   because nothing failed.
 * - `refused` — the compaction companion sequence is running; the sequence was
 *   not aborted and no run end was fabricated.
 * - `timed-out` — the runtime never reached idle within the bound. The run is
 *   NOT reported as ended; the raw detail went to the session log.
 * - `error` — the abort itself rejected. Classification only.
 */
export type TurnStopOutcome =
  | { status: "stopped" }
  | { status: "superseded" }
  | { status: "not-running" }
  | { status: "refused"; reason: StopRefusalReason }
  | { status: "timed-out" }
  | { status: "error" };

/** Who ended a run. Exactly one of the two owns any given run's end. */
export type RunEndOwner = "lecturer" | "loop-breaker";

export interface TurnStopDeps {
  /** Pi's public `AgentSession.abort()`. */
  abort: () => Promise<void>;
  /** Pi's public `AgentSession.clearQueue()`. Steering is enqueued
   * fire-and-forget and drained at the start of the NEXT run, so a stop that
   * leaves a truncation continuation queued would deliver "continue the answer
   * where it stopped" one turn later — undoing the stop invisibly. */
  clearQueue: () => unknown;
  /**
   * Is a lecturer turn dispatched and not yet resolved? This is the host's own
   * in-flight flag, NOT "the agent run has started" — the two differ exactly in
   * the window this requirement cares about, between the prompt being dispatched
   * and `agent_start` arriving. A stop there latches; a stop with no dispatch at
   * all is the silent no-op.
   */
  hasPendingTurn: () => boolean;
  /** Is the compaction companion sequence running (artefact consolidation, or
   * the runtime's own compaction)? A stop is refused there. */
  isCompacting: () => boolean;
  /** Override the bound (tests). Defaults to `TURN_STOP_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Raw-detail sink — the session log per Requirement: *Documented Error
   * Behaviour*. Never a host surface. */
  log?: (message: string, detail?: unknown) => void;
}

/**
 * Per-session controller for the lecturer stop. One instance per agent session;
 * the host calls `noteRunStart` / `noteRunEnd` from the run boundaries it
 * already observes.
 */
export class TurnStopController {
  private readonly deps: TurnStopDeps;
  /** An `agent_start` has been observed and no terminal `agent_end` since. */
  private runStarted = false;
  /** Who claimed THIS run's end. Released at the run's end, so the next turn's
   * pre-run window starts unclaimed. */
  private owner: RunEndOwner | null = null;
  /** Was the current run stopped by the LECTURER? Read by the detectors, the
   * error mapping and the persisted turn. Survives the run end on purpose: the
   * marker is applied after the prompt resolves. */
  private stoppedRun = false;
  /** The in-flight stop, so a second call starts no second abort. */
  private pending: Promise<TurnStopOutcome> | null = null;
  /** A stop issued before the run started; fired at `agent_start`. */
  private latched = false;
  /** Resolvers waiting for the run's end event. */
  private runEndWaiters: Array<() => void> = [];
  /** How many aborts this controller issued — read by tests to prove that a
   * second stop, and a superseded one, start none. */
  private abortCount = 0;
  /** Host observers of the stop TAKING EFFECT. */
  private stopObservers: Array<() => void> = [];

  constructor(deps: TurnStopDeps) {
    this.deps = deps;
  }

  /** `agent_start` for this session. */
  noteRunStart(): void {
    // A new run: the previous run's stopped fact is spent (its claim was
    // already released at that run's end).
    this.owner = null;
    this.stoppedRun = false;
    this.runStarted = true;
    if (this.latched) {
      // The stop arrived before the run existed. Honour it now rather than
      // letting the lecturer watch a run they stopped proceed to completion.
      this.latched = false;
      this.stoppedRun = true;
      this.owner = "lecturer";
      // Announce it again, now that the run exists. The first announcement went
      // out before this run started, and a host that resets per-run state at the
      // run boundary would have dropped it — the latched stop would then abort
      // the run correctly while its turn came out unmarked. Observers are
      // idempotent, so re-announcing costs nothing and closes that gap.
      this.notifyStopTakingEffect();
      this.fireAbort();
    }
  }

  /** The settled `agent_end` for this session (one per run, from Pi `agent_settled`). */
  noteRunEnd(): void {
    this.runStarted = false;
    // The claim covers ONE run, and this run is over: releasing it here rather
    // than at the next `agent_start` is what keeps the following turn's PRE-RUN
    // window usable. A stop issued between the next prompt's dispatch and its
    // `agent_start` would otherwise be refused as `superseded` by a claim the
    // previous run left behind — no latch, no abort, and a control that looks
    // enabled while doing nothing. `stoppedRun` deliberately does NOT reset
    // here: the marker is read after the prompt resolves, which is later than
    // this event, and it stays spent at the next run start.
    this.owner = null;
    const waiters = this.runEndWaiters;
    this.runEndWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * Claim this run's end for `owner`. The FIRST claim wins; every later one is
   * refused, which is what makes the second event a no-op instead of a second
   * abort and a second recovery note. Re-claiming by the same owner is refused
   * too — one recovery per run.
   */
  claimRunEnd(owner: RunEndOwner): boolean {
    if (this.owner !== null) return false;
    this.owner = owner;
    return true;
  }

  /** Was the current run stopped by the lecturer? Disarms both detectors, keeps
   * the abort's stream error off the provider-error path, and decides whether
   * the run's assistant turn carries the stopped marker. */
  stoppedForCurrentRun(): boolean {
    return this.stoppedRun;
  }

  /**
   * Observe a LECTURER stop TAKING EFFECT — fired synchronously, before the
   * abort is issued and therefore before the run's end event.
   *
   * The ordering is the whole point: a host that finalises its assistant turn on
   * the run end would otherwise have committed that turn as complete by the time
   * the stop's own call resolves, and the marker would arrive too late to be put
   * on it. A loop-breaker abort fires nothing here: it keeps its own neutral
   * recovery note and is never presented as something the lecturer stopped.
   */
  observeStopTakingEffect(fn: () => void): void {
    this.stopObservers.push(fn);
  }

  private notifyStopTakingEffect(): void {
    for (const fn of this.stopObservers) {
      try {
        fn();
      } catch (err) {
        this.deps.log?.("[turn-stop] a stop observer threw", err);
      }
    }
  }

  /** Is a stop settling right now? The host renders its pending presentation
   * from this and refuses to re-activate the control. */
  isStopping(): boolean {
    return this.pending !== null;
  }

  /** Aborts issued by this controller (tests). */
  get issuedAborts(): number {
    return this.abortCount;
  }

  /**
   * The lecturer's stop. Idempotent: a second call while the first is settling
   * returns the SAME promise, so no second abort is started, nothing errors and
   * exactly one run end is observed.
   */
  stop(): Promise<TurnStopOutcome> {
    if (this.pending) return this.pending;
    // Refused during the companion sequence: aborting between consolidation and
    // compaction could leave the consolidation half-applied and the app defines
    // no recovery for that. A deliberate limitation, stated rather than
    // discovered — and the sequence is NOT aborted.
    if (this.deps.isCompacting()) {
      return Promise.resolve<TurnStopOutcome>({ status: "refused", reason: "compaction" });
    }
    // Nothing dispatched: a no-op, because nothing failed.
    if (!this.deps.hasPendingTurn()) return Promise.resolve<TurnStopOutcome>({ status: "not-running" });
    // The loop breaker already owns this run's end — its neutral recovery note
    // stands and this stop records no marker.
    if (!this.claimRunEnd("lecturer")) return Promise.resolve<TurnStopOutcome>({ status: "superseded" });

    // Take effect SYNCHRONOUSLY, before the abort is issued: the abort
    // manufactures an error result for every not-yet-started call in the batch,
    // and a detector still armed when those land can steer a correction into —
    // or raise a second abort on — the run the lecturer just stopped.
    this.stoppedRun = true;
    this.notifyStopTakingEffect();
    try {
      this.deps.clearQueue();
    } catch (err) {
      this.deps.log?.("[turn-stop] clearing the pending queues failed", err);
    }

    const run = this.settle().finally(() => {
      this.pending = null;
    });
    this.pending = run;
    return run;
  }

  /** Issue the abort itself. Rejections are classified, never surfaced. */
  private fireAbort(): void {
    this.abortCount += 1;
    void this.deps.abort().catch((err) => {
      this.abortFailure = err;
      this.deps.log?.("[turn-stop] abort rejected", err);
      // A rejected abort will not produce a run end on its own — release the
      // wait so the host reports a classification instead of hanging on it.
      this.noteRunEnd();
    });
  }

  /** Set when `abort()` rejected, so the outcome is `error` rather than
   * `stopped` even though the wait was released. */
  private abortFailure: unknown = null;

  private async settle(): Promise<TurnStopOutcome> {
    this.abortFailure = null;
    if (this.runStarted) {
      this.fireAbort();
    } else {
      // Dispatched but not started: latch, and `noteRunStart` aborts the run the
      // moment it exists.
      this.latched = true;
    }
    const ended = await this.awaitRunEnd();
    if (!ended) {
      // The run still holds the runtime. Report a classification and do NOT
      // report the run as ended. A latch that has waited this long is stale — a
      // dispatch that produced no run inside the bound is stuck, and keeping the
      // latch armed would abort whatever run appears next instead.
      this.latched = false;
      this.deps.log?.("[turn-stop] the runtime did not reach idle within the stop timeout");
      return { status: "timed-out" };
    }
    if (this.abortFailure !== null) return { status: "error" };
    return { status: "stopped" };
  }

  /** Resolve `true` once the run's end event is observed, `false` on timeout. */
  private awaitRunEnd(): Promise<boolean> {
    if (!this.runStarted && !this.latched) return Promise.resolve(true);
    const timeoutMs = this.deps.timeoutMs ?? TURN_STOP_TIMEOUT_MS;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      // Do not hold the process open for a bound nobody is waiting on.
      (timer as unknown as { unref?: () => void }).unref?.();
      this.runEndWaiters.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

/**
 * Is this terminating stream error the abort's OWN error rather than a provider
 * failure? (Requirement: *A Lecturer Can Stop a Running Turn* — "A stopped run
 * MUST NOT surface as a provider error".)
 *
 * Pi terminates an aborted stream with an assistant message whose `stopReason`
 * is `"aborted"` and a `message_update` error event carrying the same reason
 * (`Extract<StopReason, "aborted" | "error">` in pi-agent-core's proxy types).
 * The ordinary error path would map that to "Provider error (reason: aborted)"
 * and render a deliberate stop as a failure.
 *
 * Deliberately keyed on the REASON, never on the message text: an error message
 * is provider-authored and may say anything, while the reason is pi's own
 * vocabulary.
 */
export function isAbortOriginatedStreamError(reason: unknown): boolean {
  return reason === "aborted";
}
