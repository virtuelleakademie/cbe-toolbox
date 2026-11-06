/**
 * Session-level tests for `cbe_maturity`: registration/allowlist parity, the
 * `maturity` affordance and its headless eval override, and the same-session
 * mirror rebuild on resume.
 *
 * Capability `agent-harness`, Requirements: cbe_maturity Generative-UI Tool,
 * Host-Side Session Maturity Mirror. Drives the REAL `startCbeSession` against
 * an offline test provider (session construction does not call the model).
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, CBE_TOOL_ALLOWLIST, type StartSessionOptions } from "../src/session.js";
import { buildEnvironmentDescriptor } from "../src/environment.js";
import { maturityTool } from "../src/maturity-tool.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function baseOpts(): Omit<StartSessionOptions, "profile"> & { sessionsDir: string } {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-maturity-session-"));
  const skillDir = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
  return {
    skillDir,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  };
}

const ESTABLISHMENT_DETAILS = {
  kind: "maturity-update",
  readings: [
    { criterion: "societal-challenge", current: 2, target: 2 },
    { criterion: "stakeholder-involvement", current: 1, target: 2, hint: "Add a stakeholder feedback moment." },
    { criterion: "interdisciplinarity", current: "unassessed" },
    { criterion: "student-agency", current: "unassessed" },
    { criterion: "iterative-process", current: "unassessed" },
    { criterion: "value-reflection", current: "unassessed" },
    { criterion: "societal-impact", current: "unassessed" },
    { criterion: "overall", current: 1, target: 2, note: "Only 2 of 7 criteria assessed." },
  ],
};

function toolResultLine(details: unknown): string {
  return JSON.stringify({
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "t",
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "cbe_maturity",
      content: [{ type: "text", text: "ack" }],
      details,
      isError: false,
      timestamp: 1,
    },
  });
}

function writeSessionLeg(sessionsDir: string, sessionId: string, lines: string[]): void {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    path.join(sessionsDir, `2026-07-01T10-00-00-000Z_${sessionId}.jsonl`),
    [JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "t", cwd: "/" }), ...lines].join("\n") +
      "\n"
  );
}

// Scenario: cbe_maturity is registered and allowlisted in both profiles
describe("cbe_maturity is registered and allowlisted in both profiles", () => {
  it("is in the shared allowlist constant, with bash still excluded", () => {
    // The allowlist is ONE profile-independent constant fed to createAgentSession
    // in both profiles, so presence here proves parity for app AND headless.
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_maturity");
    expect(CBE_TOOL_ALLOWLIST as readonly string[]).not.toContain("bash");
    expect(maturityTool.name).toBe("cbe_maturity");
  });
});

// Scenario: Descriptor exposes the maturity affordance per tool convention
describe("Descriptor exposes the maturity affordance per tool convention", () => {
  it("maturity is true in the app profile and false in headless", () => {
    const app = buildEnvironmentDescriptor({ profile: "app" });
    const headless = buildEnvironmentDescriptor({ profile: "headless" });
    expect(app.affordances.maturity).toBe(true);
    expect(headless.affordances.maturity).toBe(false);
    expect(app.toSystemPromptBlock()).toContain("maturity: true");
    expect(headless.toSystemPromptBlock()).toContain("maturity: false");
  });
});

// Scenario: Eval harness can enable the maturity affordance headless
describe("Eval harness can enable the maturity affordance headless", () => {
  it("the override flips ONLY the descriptor value; the headless default stays false", () => {
    const overridden = buildEnvironmentDescriptor({ profile: "headless", affordances: { maturity: true } });
    expect(overridden.affordances.maturity).toBe(true);
    // A headless session without the override still reports false.
    const plain = buildEnvironmentDescriptor({ profile: "headless" });
    expect(plain.affordances.maturity).toBe(false);
  });

  it("the override never alters tool registration or the allowlist", async () => {
    // Registration and allowlist are unconditional: the same constant and the same
    // customTools array are used regardless of affordances (there is no branch to
    // test behaviourally — assert the invariant on the surfaced session result).
    const { session, env } = await startCbeSession({
      profile: "headless",
      affordances: { maturity: true },
      ...baseOpts(),
    });
    try {
      expect(env.affordances.maturity).toBe(true);
      expect(CBE_TOOL_ALLOWLIST).toContain("cbe_maturity");
    } finally {
      session.dispose();
    }
  });
});

describe("Host-side session maturity mirror over the session lifecycle", () => {
  it("a fresh session starts with an empty mirror", async () => {
    const { session, maturityMirror } = await startCbeSession({
      profile: "app",
      sessionId: "fresh-session",
      ...baseOpts(),
    });
    try {
      expect(maturityMirror.isEmpty()).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it("pins Pi's session record to the host session id (discoverable for replay)", async () => {
    const opts = baseOpts();
    const { session } = await startCbeSession({
      profile: "app",
      sessionId: "pinned-session",
      // Pi persists the session file once an assistant message exists — seed both.
      resume: {
        turns: [
          { role: "user", text: "hello again" },
          { role: "assistant", text: "welcome back" },
        ],
      },
      ...opts,
    });
    try {
      // Appending the resume seed persists the leg file under the pinned name.
      expect(existsSync(opts.sessionsDir)).toBe(true);
      const legs = readdirSync(opts.sessionsDir).filter((f) => f.endsWith("_pinned-session.jsonl"));
      expect(legs.length).toBe(1);
    } finally {
      session.dispose();
    }
  });

  // Scenario: Resuming a persisted session rebuilds the mirror from its own record
  it("Resuming a persisted session rebuilds the mirror from its own record", async () => {
    const opts = baseOpts();
    writeSessionLeg(opts.sessionsDir, "resumed-session", [
      toolResultLine(ESTABLISHMENT_DETAILS),
      toolResultLine({ kind: "maturity-update", criterion: "stakeholder-involvement", current: 2 }),
    ]);
    const { session, maturityMirror } = await startCbeSession({
      profile: "app",
      sessionId: "resumed-session",
      resume: {
        turns: [
          { role: "user", text: "hi" },
          { role: "assistant", text: "hello" },
        ],
      },
      ...opts,
    });
    try {
      // Replay of establishment batch + one revision yields the post-revision
      // state, available before the first hydration snapshot is served.
      expect(maturityMirror.snapshot()["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
      expect(maturityMirror.snapshot()["societal-challenge"]).toEqual({ current: 2, target: 2 });
      // The replayed aggregate level is dropped exactly as the live path drops
      // it — the overall achieved reading is derived, never restored.
      expect(maturityMirror.snapshot().overall).toEqual({
        target: 2,
        note: "Only 2 of 7 criteria assessed.",
      });
    } finally {
      session.dispose();
    }
  });

  // Scenario: The mirror never crosses sessions
  it("The mirror never crosses sessions", async () => {
    const opts = baseOpts();
    // Another session's record with a full reading exists in the same store …
    writeSessionLeg(opts.sessionsDir, "previous-session", [toolResultLine(ESTABLISHMENT_DETAILS)]);
    // … and the REPLAY refuses to read it: a fresh id with no resume finds no
    // record of its own, so the mirror stays empty. This is about the replay
    // only — it says nothing about a New Session, whose carry-over is a separate
    // explicit `maturity` seed this call deliberately does not pass (capability
    // `desktop-app`, Requirement: Maturity Panel, § Course scoping).
    const fresh = await startCbeSession({ profile: "app", sessionId: "new-session", ...opts });
    try {
      expect(fresh.maturityMirror.isEmpty()).toBe(true);
    } finally {
      fresh.session.dispose();
    }
    // Even a RESUMED different conversation reads only its own record.
    const other = await startCbeSession({
      profile: "app",
      sessionId: "other-session",
      resume: { turns: [{ role: "user", text: "hi" }] },
      ...opts,
    });
    try {
      expect(other.maturityMirror.isEmpty()).toBe(true);
    } finally {
      other.session.dispose();
    }
  });
});
