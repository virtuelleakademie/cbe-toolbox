/** Real AgentManager start boundary; only the model runtime is replaced. The
 * real Electron lane covers IPC -> first hydrated renderer frame as well. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StepMirror, type StartSessionOptions } from "@cbe/pi-bridge";

const h = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
  app: {
    getPath: () => h.root,
    getAppPath: () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    isPackaged: false,
  },
}));
vi.mock("@cbe/pi-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cbe/pi-bridge")>();
  return {
    ...actual,
    createCitationResolver: vi.fn(async () => ({ listIds: () => [] })),
    startCbeSession: vi.fn(async (opts: StartSessionOptions) => {
      // Mirrors the bridge's own ordering: carry-over wins, the host's seed only
      // ever lands on a pristine mirror, and the descriptor is built from what
      // the mirror then holds.
      const stepMirror = new actual.StepMirror();
      if (opts.stepCoverage?.length) stepMirror.seed(opts.stepCoverage);
      else if (opts.initialStepFocus) stepMirror.seedInitialFocus();
      const seeded = stepMirror.holdsOnlySeededFocus() ? stepMirror.list() : null;
      return {
        stepMirror,
        env: actual.buildEnvironmentDescriptor({ ...opts, stepCoverage: seeded ?? opts.stepCoverage }),
        session: { dispose: vi.fn() },
        canvasMirror: new actual.CanvasMirror(),
        maturityMirror: new actual.MaturityMirror(),
      };
    }),
  };
});

let AgentManager: typeof import("../src/main/agent.js").AgentManager;
beforeAll(async () => {
  h.root = mkdtempSync(path.join(os.tmpdir(), "cbe-initial-focus-"));
  ({ AgentManager } = await import("../src/main/agent.js"));
});
afterAll(() => rmSync(h.root, { recursive: true, force: true }));
const provider = { baseURL: "http://127.0.0.1:9/v1", apiKey: "test-key", modelId: "test" };

describe("Host-Set Initial Step Focus — main-process startup", () => {
  it("seeds before both the descriptor and the first hydration snapshot, with no first-turn notice", async () => {
    const manager = new AgentManager();
    const active = await manager.start(provider);
    expect(active.stepMirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
    expect(active.env.toSystemPromptBlock()).toContain('step 1: "open" (in focus)');
    expect(manager.pendingStepFocus(active.id)).toBeNull();
    expect(manager.composePromptWithStepFocus(active.id, "My module")).toBe("My module");
    // The prior reports a starting point, never carried-over work.
    expect(active.env.toSystemPromptBlock()).toContain("design-flow starting point — no coverage recorded yet");
    expect(active.env.toSystemPromptBlock()).not.toContain("carried over from the previous conversation");
    expect(active.env.toSystemPromptBlock()).not.toContain("Work continues on step");
    // A course with no record stays without one: the seed is never persisted
    // (Requirement: Course Design-State Store — "never a default").
    expect(manager.snapshot(active.id)?.steps).toBeUndefined();
    // A later model/canvas transition is ordinary state, not re-oriented by a read.
    active.stepMirror.applyCanvasWrite(3);
    expect(manager.snapshot(active.id)?.steps?.find((e) => e.focus)?.step).toBe(3);
    expect(manager.snapshot(active.id)?.steps).toEqual(active.stepMirror.list());
  });

  it("persists the step state once a canvas write lands on the already-focused step 1", async () => {
    const manager = new AgentManager();
    const active = await manager.start(provider);
    expect(manager.snapshot(active.id)?.steps).toBeUndefined();
    // The ordinary first turn of a new course: the model fills step 1's card, and
    // the derived focus is already there. Recorded work all the same.
    active.stepMirror.applyCanvasWrite(1);
    expect(active.stepMirror.list()).toEqual([{ step: 1, depth: "open", focus: true }]);
    expect(manager.snapshot(active.id)?.steps).toEqual([{ step: 1, depth: "open", focus: true }]);
  });

  it("re-seeds nothing for a New Session carry-over that holds no recorded coverage", async () => {
    const manager = new AgentManager();
    // What the New Session reset snapshots from a course on which nothing happened.
    // The reset is a carry-over, so the exclusion holds and no focus is invented.
    const active = await manager.start(provider, undefined, undefined, undefined, undefined, undefined, {
      stepCoverage: [],
      maturity: {},
    });
    expect(active.stepMirror.list()).toEqual([]);
    expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    expect(manager.snapshot(active.id)?.steps).toBeUndefined();
  });

  it.each([true, false])("keeps New Session carry-over (focus=%s), including depth without focus", async (focus) => {
    const manager = new AgentManager();
    const steps = [{ step: 6, depth: "rough" as const, focus }];
    const active = await manager.start(provider, undefined, undefined, undefined, undefined, undefined, {
      stepCoverage: steps,
    });
    expect(active.stepMirror.list()).toEqual(steps);
    expect(active.env.toSystemPromptBlock()).toContain(`step 6: "rough"${focus ? " (in focus)" : ""}`);
    expect(active.env.toSystemPromptBlock()).toContain("carried over from the previous conversation");
    expect(manager.snapshot(active.id)?.steps).toEqual(steps);
    expect(manager.composePromptWithStepFocus(active.id, "Continue")).toBe("Continue");
  });

  it("does not seed an empty New Session carry-over or carried canvas work", async () => {
    const manager = new AgentManager();
    const carried = await manager.start(provider, undefined, undefined, undefined, undefined, undefined, {
      stepCoverage: [],
    });
    expect(carried.stepMirror.isEmpty()).toBe(true);
    const canvas = await manager.start(provider, undefined, undefined, [
      { step: 1, id: "modulemeta", value: "Existing course", state: "active" },
    ]);
    expect(canvas.stepMirror.isEmpty()).toBe(true);
  });

  it.each(["restored", "replayed"])("leaves a %s session untouched, including one with no focus", async (route) => {
    const manager = new AgentManager();
    const active = await manager.start(provider, undefined, {
      sessionId: route,
      createdAt: "2026-10-12T00:00:00Z",
      turns: [{ role: "user", text: "Existing conversation" }],
    });
    expect(active.stepMirror.list()).toEqual([]);
    expect(active.env.toSystemPromptBlock()).not.toContain("step-coverage prior");
    const entry = { step: 4, depth: "refined" as const, focus: false };
    if (route === "restored") active.stepMirror.restore([entry]);
    else active.stepMirror.applyToolResult({ kind: "step-update", ...entry });
    expect(manager.snapshot(active.id)?.steps).toEqual([entry]);
    expect(manager.composePromptWithStepFocus(active.id, "Continue")).toBe("Continue");
  });

  it("keeps the renderer cold seed separate from the host default", () => {
    expect(new StepMirror().list()).toEqual([]);
  });
});
