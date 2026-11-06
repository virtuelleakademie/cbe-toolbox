/**
 * Contract group `persistence` — Scenario: *Persistence contract reads both
 * runtime generations safely* (capability `agent-harness`, Requirement: *Pi
 * Upgrades Are Proven Through a Public Contract Harness*; change
 * `guard-pi-upgrades-with-contract-tests`, task 3.5).
 *
 * `session-format-compat.test.ts` owns the two generations' REAL records and
 * their chronological replay. This file adds the fail-soft half a future Pi
 * release is most likely to exercise: entry types and message shapes CBE has
 * never seen, beside the supported ones, plus the pinned session id that makes
 * a conversation's legs discoverable at all. Every placed file must come out
 * byte for byte as it went in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartCbeSessionResult } from "../../src/session.js";
import { SKILL_DIR } from "./harness.js";

const FIXTURES = path.join(__dirname, "..", "fixtures", "pi-session-format");

let tmp: string | undefined;
let started: StartCbeSessionResult | undefined;

afterEach(() => {
  started?.session.dispose();
  started = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** Entry shapes no supported runtime generation writes, in the places a future one might. */
const FOREIGN_LINES = [
  JSON.stringify({ type: "future_entry_kind", id: "f1", parentId: null, timestamp: "t", payload: { any: 1 } }),
  JSON.stringify({ type: "message", id: "f2", parentId: "f1", timestamp: "t", message: null }),
  JSON.stringify({
    type: "message",
    id: "f3",
    parentId: "f2",
    timestamp: "t",
    message: { role: "assistant", content: "flat string" },
  }),
  JSON.stringify({
    type: "message",
    id: "f4",
    parentId: "f3",
    timestamp: "t",
    message: { role: "toolResult", toolName: "cbe_maturity", toolCallId: "x", content: [], details: "not an object" },
  }),
  JSON.stringify({ type: "custom", id: "f5", parentId: "f4", timestamp: "t", customType: "someone-else", data: {} }),
  "[1,2,3]",
  "",
  "\u0000 binary garbage",
];

describe("Scenario: Persistence contract reads both runtime generations safely", () => {
  it("rebuilds the reading from old and new legs beside foreign entries, rewrites nothing, and reads only its own pinned legs", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "cbe-contract-persistence-"));
    const sessionsDir = path.join(tmp, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    const sessionId = "pinned-conversation";
    const legs = [
      { fixture: "pi-0.75.5.jsonl", file: `2026-10-01T10-00-00-000Z_${sessionId}.jsonl` },
      { fixture: "pi-1.3.0.jsonl", file: `2026-10-02T10-00-00-000Z_${sessionId}.jsonl` },
    ];
    const placed: string[] = [];
    for (const leg of legs) {
      const file = path.join(sessionsDir, leg.file);
      copyFileSync(path.join(FIXTURES, leg.fixture), file);
      writeFileSync(file, readFileSync(file, "utf8") + FOREIGN_LINES.join("\n") + "\n");
      placed.push(file);
    }
    // A DIFFERENT conversation's record in the same store, carrying a reading
    // that would be visible if the replay ignored the pinned id.
    const foreign = path.join(sessionsDir, "2026-10-03T10-00-00-000Z_another-conversation.jsonl");
    writeFileSync(
      foreign,
      readFileSync(path.join(FIXTURES, "pi-1.3.0.jsonl"), "utf8").replaceAll('"current":2', '"current":3')
    );
    placed.push(foreign);
    const before = placed.map((f) => readFileSync(f));

    started = await startCbeSession({
      profile: "app",
      skillDir: SKILL_DIR,
      sessionsDir,
      sessionId,
      agentDir: path.join(tmp, "agent"),
      cwd: path.join(tmp, "workspace"),
      resume: {
        turns: [
          { role: "user", text: "Bitte erfasse die Reife." },
          { role: "assistant", text: "Reading recorded." },
        ],
      },
      provider: { baseURL: "http://127.0.0.1:0/v1", apiKey: "k", modelId: "fixture-model" },
    });

    const snapshot = started.maturityMirror.snapshot() as Record<string, { current?: unknown; target?: unknown }>;
    expect(snapshot["societal-challenge"]).toMatchObject({ current: 2, target: 2 });
    expect(snapshot["stakeholder-involvement"]).toMatchObject({ current: 1, target: 2 });
    expect(snapshot["interdisciplinarity"]).toMatchObject({ current: "unassessed" });
    // Nothing deleted, nothing rewritten.
    expect(placed.map((f) => readFileSync(f))).toEqual(before);
    // The resumed leg is pinned to the host's id, so the NEXT resume finds it too.
    const own = readdirSync(sessionsDir).filter((f) => f.endsWith(`_${sessionId}.jsonl`));
    expect(own.length).toBeGreaterThanOrEqual(legs.length);
  });
});
