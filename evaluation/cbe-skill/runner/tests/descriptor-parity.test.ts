/**
 * Descriptor parity between the eval path and the app path (change
 * `express-app-priors-in-probe-setup`; capability `cbe-skill-eval-harness`,
 * Requirement: *A Probe Reproduces the App's Session Priors, and Every Divergence
 * Is Declared*).
 *
 * Both paths compose the environment descriptor through `startCbeSession`, so the
 * descriptor is identical by construction GIVEN THE SAME OPTS. What can diverge is
 * which descriptor-feeding opts each path supplies — that is exactly the defect
 * this test pins: a runner-only shortcut (or an app-only prior no probe can
 * express) fails here instead of quietly producing a prompt the product does not
 * have.
 *
 * Modelled on `packages/pi-bridge/tests/environment.test.ts`: assert the KEY SET,
 * never values or byte length — the app injects real course content, a probe
 * injects fixtures, so value equality would fail for the right reasons and teach
 * everyone to ignore the test.
 *
 * The authoritative key list is parsed from `BuildEnvOptions` in
 * `packages/pi-bridge/src/environment.ts`, so a NEW descriptor-feeding option
 * enters this comparison automatically and stays red until both paths can supply
 * it (or it is added to the declared exclusions below with a reason).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import { createPiEvalSessionFactory, type StartSessionLike, type StartSessionResultLike } from "../src/session-pi.js";
// The REAL descriptor renderer, by relative dist path (no `./environment` subpath
// exists and the root `@cbe/pi-bridge` entry would pull the Pi runtime).
import { buildEnvironmentDescriptor, encodeInertValue } from "../../../../packages/pi-bridge/dist/environment.js";

const ENVIRONMENT_TS = fileURLToPath(new URL("../../../../packages/pi-bridge/src/environment.ts", import.meta.url));
const AGENT_TS = fileURLToPath(new URL("../../../../packages/app/src/main/agent.ts", import.meta.url));

/**
 * Keys of `BuildEnvOptions` that are deliberately NOT part of the parity set.
 * Every entry carries the reason it stands (design D2: a bare list drifts, a
 * reasoned list is visibly stale when its reason no longer holds).
 */
const EXCLUDED_WITH_REASON: Record<string, string> = {
  // The affordance override exists FOR the eval (capability `agent-harness`,
  // eval-exercisability scenarios); the app takes its profile defaults and never
  // passes the key. A declared divergence, not a parity defect.
  affordances: "eval-only exercisability override; the app relies on the profile defaults",
};

/**
 * Descriptor keys that `startCbeSession` derives from a DIFFERENT option, with the
 * option that feeds them and the reason. Both paths must then supply that feeding
 * option: the key-set comparison checks the feeder, not the derived key.
 */
const FED_BY_WITH_REASON: Record<string, { option: string; reason: string }> = {
  // Change `recalibrate-tutor-support`: the `lecturer-support` block renders the
  // CURRENT snapshot of a service the session also writes through (`cbe_support`), so
  // the host passes the service and the bridge reads the snapshot from it. The app
  // passes its lecturer-wide file-backed service; the eval an isolated in-memory one.
  lecturerSupport: {
    option: "lecturerSupportService",
    reason: "the snapshot is read from the service the session's cbe_support writes through",
  },
};

/** Parse the property names of `export interface BuildEnvOptions { ... }`. */
function buildEnvOptionKeys(): string[] {
  const source = readFileSync(ENVIRONMENT_TS, "utf8");
  const start = source.indexOf("export interface BuildEnvOptions {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^ {2}(\w+)\??:/.exec(line);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

/** Extract the argument object of the app's `startCbeSession({ ... })` call. */
function appStartCallSpan(): string {
  const source = readFileSync(AGENT_TS, "utf8");
  const call = source.indexOf("startCbeSession({");
  expect(call).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf("{", call); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(call, i + 1);
    }
  }
  throw new Error("unbalanced braces in startCbeSession call");
}

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

/** Capture the opts the eval path forwards for a maximal ProbeSetup. */
async function captureMaximalEvalOpts(): Promise<Parameters<StartSessionLike>[0]> {
  const calls: Parameters<StartSessionLike>[0][] = [];
  const fakeStart: StartSessionLike = async (opts) => {
    calls.push(opts);
    return {
      session: { subscribe: () => () => {}, prompt: async () => {}, dispose() {} },
      env: { profile: opts.profile, affordances: {} },
    } satisfies StartSessionResultLike;
  };
  const workspaceRoot = mkdtempSync(nodePath.join(tmpdir(), "cbe-eval-parity-"));
  tmpRoots.push(workspaceRoot);
  const factory = createPiEvalSessionFactory({
    skillDir: "/s",
    sessionsDir: "/sess",
    agentDir: "/agent",
    workspaceRoot,
    provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
    corpus: "/repo/corpus",
    startSession: fakeStart,
  });
  await factory({
    profile: "app",
    lecturerProfile: { cbeExperience: { value: "experienced" } },
    lecturerIdentity: { name: "Anna", formOfAddress: "Frau Professorin" },
    lecturerSupport: { preference: "guided", revision: 2 },
    courseContext: "---\ntitle: Algorithmen\n---\n",
    canvasArtefacts: [{ step: 1, id: "big-idea", value: "Water", state: "draft" }],
    stepCoverage: [{ step: 1, depth: "detailed", focus: true }],
    maturity: { intendedInnovation: { current: 2 } },
    lecturerState: {
      globalPath: "/data/global.md",
      globalContent: "fluent",
      overlayPath: "/data/overlay.md",
      overlayContent: "cohort",
    },
    decisionsSummary: "Kompetenz-Check: bestanden",
  });
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

describe("descriptor key-set parity — eval path versus app path", () => {
  // Scenario: *The descriptor key set is identical on both paths*. The
  // comparison covers EVERY descriptor-feeding key (`BuildEnvOptions` minus the
  // reasoned exclusions) — an ancestor-only or partial comparison would not
  // satisfy the requirement.
  it("the app path and the eval path supply the same descriptor-feeding keys", async () => {
    const authoritative = buildEnvOptionKeys().filter((k) => !(k in EXCLUDED_WITH_REASON));
    // Sanity: the parse found the real interface, including the two keys this
    // change made expressible.
    expect(authoritative).toContain("lecturerState");
    expect(authoritative).toContain("decisionsSummary");
    expect(authoritative.length).toBeGreaterThanOrEqual(9);

    const appSpan = appStartCallSpan();
    // A key appears either as `key:` or as an ES shorthand property `key,` /
    // `key\n` inside the call's object literal.
    const feeder = (k: string) => FED_BY_WITH_REASON[k]?.option ?? k;
    const appKeys = authoritative.filter((k) => new RegExp(`[{,\\s(]${feeder(k)}\\s*[:,}]`).test(appSpan));

    const evalOpts = await captureMaximalEvalOpts();
    const evalKeys = authoritative.filter((k) => feeder(k) in evalOpts);

    // Full set equality on both paths — a key added or dropped on one path only
    // fails one of these two assertions.
    expect(appKeys.sort()).toEqual([...authoritative].sort());
    expect(evalKeys.sort()).toEqual([...authoritative].sort());
  });
});

describe("descriptor rendering from probe-declared priors", () => {
  // Scenario: *A probe expresses the lecturer state and the recorded decisions* —
  // the descriptor carries both as prior blocks in the same shape the app path
  // renders (same renderer, same defensive encoding).
  it("renders the lecturer-state layers and the decisions prior from forwarded opts", async () => {
    const opts = await captureMaximalEvalOpts();
    const block = buildEnvironmentDescriptor({
      profile: opts.profile,
      paths: opts.paths,
      lecturerState: opts.lecturerState,
      decisionsSummary: opts.decisionsSummary,
    }).toSystemPromptBlock();
    expect(block).toContain("lecturer-state layers");
    expect(block).toContain("global profile: /data/global.md");
    expect(block).toContain("course overlay: /data/overlay.md");
    expect(block).toContain("fluent");
    expect(block).toContain("cohort");
    expect(block).toContain("decisions prior");
    // Defensively encoded through the SAME encoder the canvas prior uses.
    expect(block).toContain(encodeInertValue("Kompetenz-Check: bestanden"));
  });

  // Scenario: *A probe that declares neither prior is unchanged* — byte identity:
  // the factory forwards NEITHER key, and the rendered block equals the one the
  // pre-change forwarding produced (no block for either prior).
  it("a probe declaring neither prior renders a byte-identical descriptor", async () => {
    const calls: Parameters<StartSessionLike>[0][] = [];
    const fakeStart: StartSessionLike = async (opts) => {
      calls.push(opts);
      return {
        session: { subscribe: () => () => {}, prompt: async () => {}, dispose() {} },
        env: { profile: opts.profile, affordances: {} },
      } satisfies StartSessionResultLike;
    };
    const workspaceRoot = mkdtempSync(nodePath.join(tmpdir(), "cbe-eval-parity-"));
    tmpRoots.push(workspaceRoot);
    const factory = createPiEvalSessionFactory({
      skillDir: "/s",
      sessionsDir: "/sess",
      agentDir: "/agent",
      workspaceRoot,
      provider: { baseURL: "http://x", apiKey: "k", modelId: "m" },
      corpus: "/repo/corpus",
      startSession: fakeStart,
    });
    await factory({ profile: "headless" });
    const opts = calls[0]!;
    expect("lecturerState" in opts).toBe(false);
    expect("decisionsSummary" in opts).toBe(false);
    const rendered = buildEnvironmentDescriptor({ profile: opts.profile, paths: opts.paths }).toSystemPromptBlock();
    // The pre-change forwarding for the same probe was exactly {profile, paths}.
    const preChange = buildEnvironmentDescriptor({
      profile: "headless",
      paths: opts.paths,
    }).toSystemPromptBlock();
    expect(rendered).toBe(preChange);
    expect(rendered).not.toContain("lecturer-state layers");
    expect(rendered).not.toContain("decisions prior");
  });
});
