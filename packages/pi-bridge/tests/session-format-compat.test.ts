/**
 * Old and new Pi session records stay readable (capability `agent-harness`,
 * Requirement: *Accepted Pi 1.3 Runtime Semantics Are Explicit Contracts* —
 * persistence; change `adopt-settled-pi-runtime-lifecycle`, task 4.1).
 *
 * CBE's product source of truth is its own sidecars and course state; the one
 * place CBE reads Pi's JSONL is the bounded legacy maturity replay on resume.
 * The fixtures are REAL records written by each runtime generation
 * (`fixtures/pi-session-format/README.md`). Each case resumes a session whose
 * earlier leg is such a record and asserts the reading is rebuilt — and that the
 * earlier file is left byte for byte as it was.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartCbeSessionResult } from "../src/session.js";

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const FIXTURES = path.join(__dirname, "fixtures", "pi-session-format");

let tmp: string | undefined;
let started: StartCbeSessionResult | undefined;

afterEach(() => {
  started?.session.dispose();
  started = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** Place fixture legs as earlier legs of `sessionId`, then resume it. */
async function resumeWith(sessionId: string, legs: Array<{ fixture: string; stamp: string; extra?: string[] }>) {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-session-format-"));
  const sessionsDir = path.join(tmp, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const placed: string[] = [];
  for (const leg of legs) {
    const file = path.join(sessionsDir, `${leg.stamp}_${sessionId}.jsonl`);
    copyFileSync(path.join(FIXTURES, leg.fixture), file);
    if (leg.extra) writeFileSync(file, readFileSync(file, "utf8") + leg.extra.join("\n") + "\n");
    placed.push(file);
  }
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
  return { started, placed, before, sessionsDir };
}

function expectEstablishedReading(result: StartCbeSessionResult) {
  const snapshot = result.maturityMirror.snapshot() as Record<string, { current?: unknown; target?: unknown }>;
  expect(snapshot["societal-challenge"]).toMatchObject({ current: 2, target: 2 });
  expect(snapshot["stakeholder-involvement"]).toMatchObject({ current: 1, target: 2 });
  expect(snapshot["interdisciplinarity"]).toMatchObject({ current: "unassessed" });
}

describe("Scenario: Old and new Pi session records stay readable without being rewritten", () => {
  it("rebuilds the maturity reading from a Pi 0.75.5 record", async () => {
    const {
      started: result,
      placed,
      before,
    } = await resumeWith("legacy-leg", [{ fixture: "pi-0.75.5.jsonl", stamp: "2026-10-01T10-00-00-000Z" }]);
    expectEstablishedReading(result);
    expect(placed.map((f) => readFileSync(f))).toEqual(before);
  });

  it("rebuilds the maturity reading from a Pi 1.3.0 record (with its transcript system entry)", async () => {
    const raw = readFileSync(path.join(FIXTURES, "pi-1.3.0.jsonl"), "utf8");
    expect(raw).toContain('"role":"system"');
    const {
      started: result,
      placed,
      before,
    } = await resumeWith("current-leg", [{ fixture: "pi-1.3.0.jsonl", stamp: "2026-10-01T10-00-00-000Z" }]);
    expectEstablishedReading(result);
    expect(placed.map((f) => readFileSync(f))).toEqual(before);
  });

  it("reads an old leg and a new leg of one session in chronological order and tolerates 1.x recovery entries", async () => {
    // Pi 1.x records post-run recovery and compaction as their own entry types;
    // the replay must skip them, never fail the resume.
    const recovery = [
      JSON.stringify({
        type: "context_edit",
        id: "ce1",
        parentId: null,
        timestamp: "t",
        targetId: "x",
        replacement: null,
      }),
      JSON.stringify({
        type: "compaction",
        id: "cp1",
        parentId: "ce1",
        timestamp: "t",
        summary: "s",
        firstKeptEntryId: null,
      }),
      "{ torn line",
    ];
    const {
      started: result,
      placed,
      before,
      sessionsDir,
    } = await resumeWith("mixed-leg", [
      { fixture: "pi-0.75.5.jsonl", stamp: "2026-10-01T10-00-00-000Z" },
      { fixture: "pi-1.3.0.jsonl", stamp: "2026-10-02T10-00-00-000Z", extra: recovery },
    ]);
    expectEstablishedReading(result);
    expect(placed.map((f) => readFileSync(f))).toEqual(before);
    // The resumed session writes a NEW leg; the earlier ones stay as they were.
    expect(readdirSync(sessionsDir).filter((f) => f.endsWith("_mixed-leg.jsonl")).length).toBeGreaterThanOrEqual(2);
  });
});
