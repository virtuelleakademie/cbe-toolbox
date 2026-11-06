/**
 * The lecturer's stop on a running turn (capability `agent-harness`,
 * Requirement: *A Lecturer Can Stop a Running Turn*).
 *
 * One test per Scenario of that requirement whose subject is the harness's own
 * state machine. The scenarios whose subject is the HOST seam — the single
 * observed run end across every listener, the provider-error suppression, the
 * detectors, the retained/marked turn — are in
 * `packages/app/tests/turn-stop-host.test.ts`, because only the seam can show
 * them.
 *
 * The controller is deliberately a pure state machine over injected callbacks,
 * so every one of these runs with no runtime, no provider and no session.
 */
import { describe, expect, it, vi } from "vitest";
import { TurnStopController, TURN_STOP_TIMEOUT_MS, isAbortOriginatedStreamError } from "../src/turn-stop.js";
import { CanvasMirror } from "../src/canvas-mirror.js";
import { StepMirror } from "../src/step-mirror.js";
import { MaturityMirror } from "../src/maturity-mirror.js";

/** A controller over a fake session, with the knobs each scenario needs. */
function harness(
  opts: {
    /** Milliseconds `abort()` takes to resolve. */
    abortDelayMs?: number;
    /** Make `abort()` reject. */
    abortRejects?: boolean;
    compacting?: boolean;
    pendingTurn?: boolean;
    timeoutMs?: number;
  } = {}
) {
  const state = {
    aborts: 0,
    queueClears: 0,
    compacting: opts.compacting ?? false,
    pendingTurn: opts.pendingTurn ?? true,
    logs: [] as Array<{ message: string; detail?: unknown }>,
  };
  const controller = new TurnStopController({
    abort: async () => {
      state.aborts += 1;
      if (opts.abortDelayMs) await new Promise((r) => setTimeout(r, opts.abortDelayMs));
      if (opts.abortRejects) throw new Error("https://provider.example/v1/chat: stream torn down");
    },
    clearQueue: () => {
      state.queueClears += 1;
      return { steering: [], followUp: [] };
    },
    hasPendingTurn: () => state.pendingTurn,
    isCompacting: () => state.compacting,
    timeoutMs: opts.timeoutMs ?? 50,
    log: (message, detail) => state.logs.push({ message, detail }),
  });
  return { controller, state };
}

describe("Scenario: A lecturer stop aborts the run and the host observes one run end", () => {
  it("invokes the runtime's abort and settles only once the run's end is observed", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();

    let settled = false;
    const stop = controller.stop().then((o) => {
      settled = true;
      return o;
    });

    // The abort is issued at once...
    expect(state.aborts).toBe(1);
    await Promise.resolve();
    // ...but the stop is NOT complete until the run's end event arrives.
    expect(settled).toBe(false);

    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });
  });

  it("does not treat a willRetry-style non-terminal boundary as the run's end", async () => {
    // The host only calls `noteRunEnd` for a TERMINAL agent_end; a retrying one
    // continues the same run. Nothing else may release the wait.
    const { controller } = harness({ timeoutMs: 30 });
    controller.noteRunStart();
    const stop = controller.stop();
    // No noteRunEnd at all → the bound is what settles it, as a timeout.
    await expect(stop).resolves.toEqual({ status: "timed-out" });
  });
});

describe("Scenario: A lecturer stop and a loop-breaker abort stay distinguishable", () => {
  it("marks only the lecturer's stop, and leaves a loop-broken run unmarked", async () => {
    const lecturer = harness();
    lecturer.controller.noteRunStart();
    const stop = lecturer.controller.stop();
    expect(lecturer.controller.stoppedForCurrentRun()).toBe(true);
    lecturer.controller.noteRunEnd();
    await stop;

    const loop = harness();
    loop.controller.noteRunStart();
    expect(loop.controller.claimRunEnd("loop-breaker")).toBe(true);
    // The loop breaker's own abort is issued by its remediation path, not by
    // this controller — and it records no stopped marker.
    expect(loop.controller.stoppedForCurrentRun()).toBe(false);
    expect(loop.state.aborts).toBe(0);
  });
});

describe("Scenario: A stop racing the loop breaker still ends the run once", () => {
  it("the loop breaker first: the lecturer's stop is a no-op that starts no second abort", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();
    expect(controller.claimRunEnd("loop-breaker")).toBe(true);

    await expect(controller.stop()).resolves.toEqual({ status: "superseded" });
    expect(state.aborts).toBe(0);
    // The loop-broken run keeps ITS recovery: no stopped marker is recorded.
    expect(controller.stoppedForCurrentRun()).toBe(false);
  });

  it("the lecturer first: the loop breaker's claim is refused, so it raises no second abort", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();
    const stop = controller.stop();
    expect(controller.claimRunEnd("loop-breaker")).toBe(false);
    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });
    expect(state.aborts).toBe(1);
    expect(controller.stoppedForCurrentRun()).toBe(true);
  });
});

describe("Scenario: The stop clears pending steering and follow-up", () => {
  it("clears the queues through the runtime's public surface, before the abort settles", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();
    const stop = controller.stop();
    // Synchronously, so a continuation enqueued for the NEXT run cannot survive
    // the stop and undo it one turn later.
    expect(state.queueClears).toBe(1);
    controller.noteRunEnd();
    await stop;
  });

  it("a refused or no-op stop clears nothing", async () => {
    const refused = harness({ compacting: true });
    await refused.controller.stop();
    expect(refused.state.queueClears).toBe(0);

    const idle = harness({ pendingTurn: false });
    await idle.controller.stop();
    expect(idle.state.queueClears).toBe(0);
  });
});

describe("Scenario: A stop before the run starts latches instead of being ignored", () => {
  it("aborts the run as soon as it starts, and settles at that run's end", async () => {
    // Dispatched but not started: the composer is already locked and no run
    // exists — exactly the window in which a lecturer changes their mind.
    const { controller, state } = harness();
    let settled = false;
    const stop = controller.stop().then((o) => {
      settled = true;
      return o;
    });
    // Nothing to abort yet, and the stop is NOT discarded.
    expect(state.aborts).toBe(0);
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.noteRunStart();
    expect(state.aborts).toBe(1);
    expect(controller.stoppedForCurrentRun()).toBe(true);

    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });
  });

  it("re-announces itself once the run exists, so a host that resets per-run state keeps it", async () => {
    const { controller } = harness();
    const seen: number[] = [];
    controller.observeStopTakingEffect(() => seen.push(seen.length));
    const stop = controller.stop();
    expect(seen).toHaveLength(1); // before the run exists
    controller.noteRunStart();
    expect(seen).toHaveLength(2); // and again once it does
    controller.noteRunEnd();
    await stop;
  });
});

describe("Scenario: A stop rolls back no accepted host state", () => {
  it("leaves the canvas, step and maturity mirrors exactly as the accepted writes left them", async () => {
    const canvas = new CanvasMirror();
    const steps = new StepMirror();
    const maturity = new MaturityMirror();
    canvas.applySet({ step: 2, id: "kompetenzen", value: "Systemdenken", state: "draft" });
    steps.applyUpdate(2, { depth: "rough", focus: true });
    maturity.seed({ authenticity: { current: "cbe-light" } });

    const canvasBefore = JSON.stringify(canvas.list());
    const stepsBefore = JSON.stringify(steps.list());
    const maturityBefore = JSON.stringify(maturity.snapshot());

    const { controller } = harness();
    controller.noteRunStart();
    const stop = controller.stop();
    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });

    // A stop ends a run; it does not undo one.
    expect(JSON.stringify(canvas.list())).toBe(canvasBefore);
    expect(JSON.stringify(steps.list())).toBe(stepsBefore);
    expect(JSON.stringify(maturity.snapshot())).toBe(maturityBefore);
  });
});

describe("Scenario: A tool call in flight is allowed to settle", () => {
  it("waits for idle rather than cutting the tool short, and the run ends afterwards", async () => {
    // `abort()` awaits idle by contract, so the tool's own result is handled
    // exactly as it would have been without the stop.
    const toolSettled: string[] = [];
    const { controller } = harness({ abortDelayMs: 20, timeoutMs: 500 });
    controller.noteRunStart();
    const stop = controller.stop();

    setTimeout(() => {
      toolSettled.push("tool result handled");
      controller.noteRunEnd();
    }, 25);

    await expect(stop).resolves.toEqual({ status: "stopped" });
    expect(toolSettled).toEqual(["tool result handled"]);
  });
});

describe("Scenario: Repeated stops are idempotent", () => {
  it("a second stop while the first settles starts no second abort, errors, or run end", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();
    const first = controller.stop();
    const second = controller.stop();
    expect(second).toBe(first); // the same settling stop, not a new one
    expect(state.aborts).toBe(1);
    expect(state.queueClears).toBe(1);

    controller.noteRunEnd();
    await expect(first).resolves.toEqual({ status: "stopped" });
    await expect(second).resolves.toEqual({ status: "stopped" });
    expect(state.aborts).toBe(1);
  });
});

describe("Scenario: A stop with no run in flight, or an unknown session, is a silent no-op", () => {
  it("reports nothing-running without aborting or throwing", async () => {
    const { controller, state } = harness({ pendingTurn: false });
    await expect(controller.stop()).resolves.toEqual({ status: "not-running" });
    expect(state.aborts).toBe(0);
    expect(state.logs).toHaveLength(0);
  });

  // The unknown-session half is the host's: it never reaches a controller,
  // because there is none to reach. Asserted at the seam
  // (`packages/app/tests/turn-stop-host.test.ts`).
});

describe("Scenario: A stop during the compaction companion sequence is refused", () => {
  it("refuses with a reason, aborts nothing, and fabricates no run end", async () => {
    const { controller, state } = harness({ compacting: true });
    controller.noteRunStart();
    await expect(controller.stop()).resolves.toEqual({ status: "refused", reason: "compaction" });
    expect(state.aborts).toBe(0);
    expect(controller.stoppedForCurrentRun()).toBe(false);
  });

  it("stops normally again once the sequence has ended", async () => {
    const { controller, state } = harness({ compacting: true });
    controller.noteRunStart();
    await controller.stop();
    state.compacting = false;
    const stop = controller.stop();
    expect(state.aborts).toBe(1);
    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });
  });
});

describe("Scenario: A stop that never completes times out and is classified without leaking detail", () => {
  it("reports the classification, leaks no provider host or URL, and does not report the run as ended", async () => {
    const { controller, state } = harness({ abortRejects: false, timeoutMs: 30 });
    controller.noteRunStart();
    // The run end never arrives — a stream ignoring the abort.
    const outcome = await controller.stop();
    expect(outcome).toEqual({ status: "timed-out" });
    // A classification only: nothing derived from an underlying message.
    expect(JSON.stringify(outcome)).not.toMatch(/https?:|provider\.example/);
    // The raw detail goes to the session log instead.
    expect(state.logs.some((l) => /stop timeout/i.test(l.message))).toBe(true);
  });

  it("classifies a rejected abort as an error rather than as a completed stop", async () => {
    const { controller, state } = harness({ abortRejects: true, timeoutMs: 500 });
    controller.noteRunStart();
    const outcome = await controller.stop();
    expect(outcome).toEqual({ status: "error" });
    // The provider's URL reached the log, never the outcome.
    expect(JSON.stringify(outcome)).not.toContain("provider.example");
    expect(state.logs.some((l) => String((l.detail as Error)?.message).includes("provider.example"))).toBe(true);
  });

  it("bounds the wait with a stated constant rather than an ad-hoc literal", () => {
    expect(TURN_STOP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(TURN_STOP_TIMEOUT_MS)).toBe(true);
  });
});

describe("Scenario: A stopped run does not surface as a provider error (recognition half)", () => {
  it("recognises the abort's own stream reason and nothing else", () => {
    // Keyed on pi's own reason vocabulary — never on the message text, which is
    // provider-authored and may say anything.
    expect(isAbortOriginatedStreamError("aborted")).toBe(true);
    expect(isAbortOriginatedStreamError("error")).toBe(false);
    expect(isAbortOriginatedStreamError(undefined)).toBe(false);
    expect(isAbortOriginatedStreamError("Request aborted by the user")).toBe(false);
  });
});

describe("run boundaries spend the previous run's state", () => {
  it("a new run is neither stopped nor claimed by the previous one's events", async () => {
    const { controller } = harness();
    controller.noteRunStart();
    const stop = controller.stop();
    controller.noteRunEnd();
    await stop;
    expect(controller.stoppedForCurrentRun()).toBe(true);

    // The next run starts clean — the marker is not inherited, and the end
    // claim is available again (so the loop breaker can still act on it).
    controller.noteRunStart();
    expect(controller.stoppedForCurrentRun()).toBe(false);
    expect(controller.claimRunEnd("loop-breaker")).toBe(true);
  });

  it("the previous run's end claim does not swallow the NEXT turn's pre-run stop", async () => {
    // The claim covers one run. Held past that run's end, it would refuse the
    // following turn's pre-run stop as `superseded` — no latch, no abort, no
    // announcement, and a control the lecturer sees enabled while it does
    // nothing. The latch test above cannot see this: it uses a fresh controller.
    const { controller, state } = harness();
    controller.noteRunStart();
    const first = controller.stop();
    controller.noteRunEnd();
    await expect(first).resolves.toEqual({ status: "stopped" });
    expect(state.aborts).toBe(1);

    // Turn 2 is dispatched and its `agent_start` has not arrived yet.
    const second = controller.stop();
    await Promise.resolve();
    expect(state.aborts).toBe(1); // latched, not superseded — nothing to abort yet
    controller.noteRunStart();
    expect(state.aborts).toBe(2);
    expect(controller.stoppedForCurrentRun()).toBe(true);
    controller.noteRunEnd();
    await expect(second).resolves.toEqual({ status: "stopped" });
  });

  it("a loop-breaker claim is released at its own run's end too", async () => {
    const { controller, state } = harness();
    controller.noteRunStart();
    expect(controller.claimRunEnd("loop-breaker")).toBe(true);
    controller.noteRunEnd();

    const stopping = controller.stop();
    await Promise.resolve();
    expect(state.aborts).toBe(0);
    controller.noteRunStart();
    expect(state.aborts).toBe(1);
    controller.noteRunEnd();
    await expect(stopping).resolves.toEqual({ status: "stopped" });
  });

  it("a stop observer that throws does not break the stop", async () => {
    const { controller, state } = harness();
    controller.observeStopTakingEffect(() => {
      throw new Error("observer blew up");
    });
    const seen = vi.fn();
    controller.observeStopTakingEffect(seen);
    controller.noteRunStart();
    const stop = controller.stop();
    expect(seen).toHaveBeenCalled();
    expect(state.aborts).toBe(1);
    controller.noteRunEnd();
    await expect(stop).resolves.toEqual({ status: "stopped" });
  });
});
