/**
 * The support preference as a probe can state and exercise it (change
 * `recalibrate-tutor-support`, task 4.3; capability `agent-harness`, Requirement:
 * *Separate Lecturer-Wide Support Preference*, Scenario: *The eval can seed and exercise
 * the same support state*; capability `cbe-skill-eval-harness`, Requirement: *A Probe
 * Reproduces the App's Session Priors, and Every Divergence Is Declared*).
 *
 * Three obligations: an invalid seed fails at LOAD, before a candidate token is paid
 * for; the seed reaches the session through the same service type the app passes; and
 * every probe gets its OWN in-memory store, so one probe's `cbe_support` write is
 * visible in that probe and in nothing else.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseProbes, EvalValidationError } from "../src/loader.js";
import { runProbe } from "../src/runner.js";
import { mockSessionFactory } from "../src/session-eval.js";
import { createPiEvalSessionFactory, type StartSessionLike, type StartSessionResultLike } from "../src/session-pi.js";
import type { Probe } from "../src/types.js";
import type {
  InMemoryLecturerSupportStore,
  LecturerSupportHost,
} from "../../../../packages/pi-bridge/dist/lecturer-support.js";

const CORPUS = new Set<string>();

const SCENARIO = (setupExtra: string) => `# 13 Calibration

\`\`\`yaml
eval:
  probes:
    - probe: "13x"
      setup:
        profile: app
${setupExtra}      turns:
        - "Weiter."
      checkpoints:
        - id: "13x"
          type: judge
          anchor: "skill:SKILL.md#Calibration"
          rubric: "x"
\`\`\`
`;

const load = (extra: string) => parseProbes(SCENARIO(extra), "13.md", CORPUS, { onWarn: () => {} });

describe("ProbeSetup.lecturerSupport — validated at load", () => {
  it("parses a seed and leaves it undefined when unstated", () => {
    const p = load("        lecturerSupport:\n          preference: guided\n          revision: 3\n")[0]!;
    expect(p.setup.lecturerSupport).toEqual({ preference: "guided", revision: 3 });
    const none = load("        lecturerSupport:\n          preference: null\n")[0]!;
    expect(none.setup.lecturerSupport).toEqual({ preference: null });
    expect(load("")[0]!.setup.lecturerSupport).toBeUndefined();
  });

  it.each([
    [
      "a value outside the fixed set",
      "          preference: intensive\n",
      /not one of guided\|collaborative\|concise\|null/,
    ],
    ["a missing preference", "          revision: 1\n", /preference is required/],
    [
      "a malformed revision",
      "          preference: guided\n          revision: -2\n",
      /revision must be a non-negative integer/,
    ],
    ["an unknown scope", "          preference: guided\n          scope: forever\n", /scope "forever"/],
    ["a foreign key", "          preference: guided\n          confidence: high\n", /unknown field "confidence"/],
  ])("rejects %s before any model call", (_label, body, message) => {
    expect(() => load(`        lecturerSupport:\n${body}`)).toThrow(EvalValidationError);
    expect(() => load(`        lecturerSupport:\n${body}`)).toThrow(message);
  });
});

describe("ProbeSetup.lecturerSupport — reaches the session", () => {
  it("passes the seed through the runner to the session factory", async () => {
    const factory = mockSessionFactory([{ assistant: "ok", tools: [] }]);
    const probe: Probe = {
      probe: "13x",
      scenarioFile: "13.md",
      setup: { profile: "app", lecturerSupport: { preference: "concise" } },
      turns: ["Weiter."],
      checkpoints: [{ id: "13x", type: "judge", rubric: "x" }],
    };
    await runProbe(probe, factory, "m");
    expect(factory.sessions[0]!.setup.lecturerSupport).toEqual({ preference: "concise" });
  });
});

describe("ProbeSetup.lecturerSupport — one isolated store per probe", () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  function harness() {
    const services: LecturerSupportHost[] = [];
    const stores: InMemoryLecturerSupportStore[] = [];
    const start: StartSessionLike = async (opts) => {
      services.push(opts.lecturerSupportService as LecturerSupportHost);
      return {
        session: { subscribe: () => () => {}, prompt: async () => {}, dispose() {} },
        env: { profile: opts.profile, affordances: {} },
      } satisfies StartSessionResultLike;
    };
    const workspaceRoot = mkdtempSync(nodePath.join(tmpdir(), "cbe-eval-support-"));
    roots.push(workspaceRoot);
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot,
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      startSession: start,
      onSupportStore: (s) => stores.push(s),
    });
    return { factory, services, stores };
  }

  it("seeds the probe's store and reports the scope of the host the profile stands for", async () => {
    const { factory, services } = harness();
    await factory({ profile: "app", lecturerSupport: { preference: "guided", revision: 2 } });
    await factory({ profile: "headless" });
    expect(await services[0]!.current()).toEqual({ preference: "guided", revision: 2, scope: "lecturer-wide" });
    expect(await services[1]!.current()).toEqual({ preference: null, revision: 0, scope: "session-local" });
  });

  // Scenario: *The eval can seed and exercise the same support state*.
  it("keeps a probe's own write in that probe's store and out of every other probe", async () => {
    const { factory, services, stores } = harness();
    await factory({ profile: "app", lecturerSupport: { preference: "collaborative", revision: 1 } });
    await factory({ profile: "app", lecturerSupport: { preference: "collaborative", revision: 1 } });
    const r = await services[0]!.change({ operation: "clear" }, 1);
    expect(r.outcome).toBe("accepted");
    expect(await stores[0]!.load()).toEqual({ version: 1, revision: 2, preference: null });
    expect(await stores[1]!.load()).toEqual({ version: 1, revision: 1, preference: "collaborative" });
    expect(await services[1]!.current()).toEqual({ preference: "collaborative", revision: 1, scope: "lecturer-wide" });
  });
});
