import { describe, it, expect } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { readFile, writeFile, mkdtemp, rm, stat, chmod, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeSessionMd,
  writeSessionJson,
  readSessionJson,
  listStoredSessions,
  deleteStoredSession,
  resolveCanonicalConversation,
  type SessionMeta,
  type SessionTurn,
} from "../src/main/sessions.js";
import { emptyDidacticChecks, type DidacticChecks } from "@cbe/pi-bridge/didactic-checks";

const meta: SessionMeta = {
  sessionId: "test-uuid-1",
  modelId: "gpt-oss-120b",
  skillVersion: "0.1.3",
  environmentProfile: "app",
  createdAt: "2026-05-26T10:00:00.000Z",
  closedAt: "2026-05-26T10:42:00.000Z",
};

const turns: SessionTurn[] = [
  { role: "user", text: "Hello." },
  { role: "assistant", text: "Hi." },
];

describe("writeSessionMd", () => {
  it("writes a transcript markdown file with frontmatter + per-turn sections", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const out = await writeSessionMd(dir, meta, turns);
      const md = await readFile(out, "utf8");
      expect(md).toContain("sessionId: test-uuid-1");
      // Retired operation-mode model: new sidecars carry NO mode line.
      expect(md).not.toMatch(/^mode:/m);
      expect(md).toContain("## user\n\nHello.");
      expect(md).toContain("## assistant\n\nHi.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Scenario: Markdown archive renders the display projection. The prompt-prefix
  // chain used to prepend one-line notices; it now prepends bodies of machine
  // text — the `app-ui reference` block is several kilobytes on every Help-me
  // activation. Rendering `text` there would bury the human-readable archive in
  // the model payload. The JSON sidecar keeps `text` verbatim (asserted below in
  // "display projection on user turns"), so nothing is lost.
  it("renders the display projection for turns that carry one, with attachment names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const machineBlock =
        "app-ui reference (the documented controls of this app):\n```app-ui-reference\n" +
        '  - id: "material-upload" | how: "Click the attach button."\n```\n\n[help · app]';
      const projected: SessionTurn[] = [
        { role: "user", text: machineBlock, display: { text: "Help requested" } },
        {
          role: "user",
          text: "[ingested document: modul.pdf]\n<content>…</content>\n\nPlease review this.",
          display: { text: "Please review this.", attachments: [{ filename: "modul.pdf", docType: "pdf" }] },
        },
        { role: "assistant", text: "Here is the orientation." },
      ];
      const out = await writeSessionMd(dir, meta, projected);
      const md = await readFile(out, "utf8");

      expect(md).toContain("## user\n\nHelp requested");
      expect(md).not.toContain("app-ui-reference");
      // The chips the lecturer saw stay in the archive; the envelope does not.
      expect(md).toContain("Please review this.");
      expect(md).toContain("Attachments: modul.pdf");
      expect(md).not.toContain("<content>");
      // A turn without a projection is unchanged.
      expect(md).toContain("## assistant\n\nHere is the orientation.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // desktop-app spec, Requirement: Ingested Document Display Is Separated From
  // Its Model Payload — Scenario: One flush writes the readable face and the full
  // record together. The Markdown no longer carries the envelope, so the promise
  // that the payload stays retrievable rests on a structural property: both
  // writers get the SAME unprojected turns array in one flush (`flushSession` in
  // main/ipc.ts) and the JSON writer serialises it verbatim. This test reproduces
  // that flush shape, so a future change that projects the turns before the JSON
  // write fails here rather than silently making the record lossy.
  it("writes the projected Markdown and the verbatim JSON from one unprojected turns array", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const envelope =
        "[ingested document: modul.pdf]\n<content>the full extracted body</content>\n\nPlease review this.";
      const turnsToFlush: SessionTurn[] = [
        {
          role: "user",
          text: envelope,
          display: { text: "Please review this.", attachments: [{ filename: "modul.pdf", docType: "pdf" }] },
        },
      ];
      // The order and the shared array are the point — this is what flushSession does.
      const mdPath = await writeSessionMd(dir, meta, turnsToFlush);
      await writeSessionJson(dir, meta, turnsToFlush);

      const md = await readFile(mdPath, "utf8");
      expect(md).toContain("Please review this.");
      expect(md).toContain("Attachments: modul.pdf");
      expect(md).not.toContain("the full extracted body");

      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed?.turns[0]?.text).toBe(envelope);
      expect(parsed?.turns[0]?.display?.text).toBe("Please review this.");
      // Writing the Markdown must not have mutated what the JSON writer received.
      expect(turnsToFlush[0].text).toBe(envelope);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Covers agent-harness spec, Requirement: Sessions as Local Markdown/JSON
// Files — Scenario: JSON sidecar carries the reload source-of-truth. The
// JSON form is what the Phase-3 Project View reads back to resume a stored
// conversation; the Markdown form is the human-readable archive.
describe("writeSessionJson", () => {
  it("writes a JSON sidecar alongside the markdown archive", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const out = await writeSessionJson(dir, meta, turns);
      expect(out.endsWith(".json")).toBe(true);
      const raw = await readFile(out, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.meta).toEqual(meta);
      expect(parsed.turns).toEqual(turns);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits .md and .json side by side when both writers run for the same session", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await writeSessionJson(dir, meta, turns);
      const mdStat = await stat(path.join(dir, `${meta.sessionId}.md`));
      const jsonStat = await stat(path.join(dir, `${meta.sessionId}.json`));
      expect(mdStat.isFile()).toBe(true);
      expect(jsonStat.isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves turn content that contains markdown heading characters", async () => {
    // The MD form is lossy when turn content contains `##` — the JSON form
    // is the reason we can still reload faithfully. This test guards that
    // invariant: round-trip through JSON preserves the literal text.
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const trickyTurns: SessionTurn[] = [
        { role: "user", text: "Please format your answer as:\n\n## Heading\n\nWith bullets" },
        { role: "assistant", text: "Here is the answer:\n## My heading\n- bullet" },
      ];
      await writeSessionJson(dir, meta, trickyTurns);
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back).not.toBeNull();
      expect(back?.turns).toEqual(trickyTurns);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readSessionJson", () => {
  it("returns the same payload that was written", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns);
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back).not.toBeNull();
      expect(back?.meta).toEqual(meta);
      expect(back?.turns).toEqual(turns);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps terminal protocol framing out of newly written JSON and Markdown sidecars", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    const contaminated: SessionTurn[] = [
      { role: "user", text: "Hello." },
      { role: "assistant", text: "Clean answer.<turn|>" },
    ];
    try {
      const jsonPath = await writeSessionJson(dir, meta, contaminated);
      const mdPath = await writeSessionMd(dir, meta, contaminated);
      const json = JSON.parse(await readFile(jsonPath, "utf8")) as { turns: SessionTurn[] };
      expect(json.turns[1]?.text).toBe("Clean answer.");
      expect(await readFile(mdPath, "utf8")).not.toContain("<turn|>");
      // Writers sanitize a copy; the caller's diagnostic input stays untouched.
      expect(contaminated[1]?.text).toBe("Clean answer.<turn|>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes an already contaminated sidecar for display and resume without rewriting it on read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    const file = path.join(dir, `${meta.sessionId}.json`);
    try {
      const raw = JSON.stringify({
        meta,
        turns: [
          { role: "user", text: "Hello." },
          { role: "assistant", text: "Existing answer.<turn|>" },
        ],
      });
      await writeFile(file, raw, "utf8");
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back?.turns[1]?.text).toBe("Existing answer.");
      expect(await readFile(file, "utf8")).toBe(raw);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the sidecar file is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const back = await readSessionJson(dir, "does-not-exist");
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null on a malformed JSON payload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.join(dir, "bad.json"), "{ not valid json", "utf8");
      const back = await readSessionJson(dir, "bad");
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null on a structurally invalid payload (turn missing role)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.join(dir, "shape.json"), JSON.stringify({ meta, turns: [{ text: "no role" }] }), "utf8");
      const back = await readSessionJson(dir, "shape");
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Covers cbe-skill spec, Requirement: Check Execution Order — Scenario: check
// state survives session resume. The didactic-check state is persisted in the
// JSON sidecar and rehydrated on resume so the Decisions canvas can rebuild
// without re-running any check (desktop-app, Requirement: Decision Artifacts).
describe("didactic-checks sidecar round-trip", () => {
  const checks: DidacticChecks = {
    kompetenz: {
      status: "completed",
      goals: [
        { id: "g1", text: "stakeholder-impact mapping", sharpness: "sharp", citations: ["corpus:vocabulary-001"] },
      ],
    },
    alignment: {
      status: "in-progress",
      findings: [{ goalId: "g1", status: "flagged", pattern: "soft-skill via end-product score" }],
    },
    delegation: { status: "not-started", decisions: [] },
    heterogeneity: { fired: true, notes: "two study programmes, wide prior-knowledge spread" },
  };

  it("persists the didacticChecks block when present", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const out = await writeSessionJson(dir, meta, turns, checks);
      const parsed = JSON.parse(await readFile(out, "utf8"));
      expect(parsed.didacticChecks).toEqual(checks);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rehydrates the didacticChecks state on resume (read-back)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns, checks);
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back?.didacticChecks).toEqual(checks);
      // resume continues the in-progress check from where it was left
      expect(back?.didacticChecks?.alignment.status).toBe("in-progress");
      expect(back?.didacticChecks?.kompetenz.status).toBe("completed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits the field on sessions that never entered the pipeline (forward-readable)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const out = await writeSessionJson(dir, meta, turns);
      const parsed = JSON.parse(await readFile(out, "utf8"));
      expect("didacticChecks" in parsed).toBe(false);
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back).not.toBeNull();
      expect(back?.didacticChecks).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads back an empty (all not-started) check state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns, emptyDidacticChecks());
      const back = await readSessionJson(dir, meta.sessionId);
      expect(back?.didacticChecks).toEqual(emptyDidacticChecks());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the didacticChecks block is malformed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        path.join(dir, "bad-checks.json"),
        JSON.stringify({ meta, turns, didacticChecks: { kompetenz: { status: "bogus", goals: [] } } }),
        "utf8"
      );
      const back = await readSessionJson(dir, "bad-checks");
      expect(back).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Covers course-workspace spec, Requirement: One Canonical Conversation per
// Course (the stored-conversation listing half) — the main-process sidecar-scan
// side of the Chats tab (desktop-app, Requirement: Course Detail Tabs: Chats and
// Wiki). The renderer half (rows, resume dispatch) lives in
// tests/course-detail-tabs.test.tsx.
describe("listStoredSessions", () => {
  it("enumerates stored conversations from disk (no central index)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await writeSessionJson(dir, meta, turns);
      const second: SessionMeta = {
        ...meta,
        sessionId: "test-uuid-2",
        createdAt: "2026-05-27T10:00:00.000Z",
        closedAt: "2026-05-27T10:42:00.000Z",
      };
      await writeSessionMd(dir, second, turns);
      await writeSessionJson(dir, second, turns);

      const listed = await listStoredSessions(dir);
      expect(listed.map((s) => s.sessionId)).toEqual(["test-uuid-2", "test-uuid-1"]); // newest first
      const row = listed[1]!;
      expect(row).toMatchObject({
        modelId: "gpt-oss-120b",
        skillVersion: "0.1.3",
        createdAt: meta.createdAt,
        closedAt: meta.closedAt,
        resumable: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("orders by createdAt, so a re-stamped resumed pair stays below a newer-created one", async () => {
    // Scenario: Resuming an older conversation keeps its row in place. The list
    // orders on the CREATION stamp, not on the activity stamp (`closedAt`) the
    // resume flush re-writes for the canonical scan: a resume never moves a row.
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      const resumedOld: SessionMeta = {
        ...meta,
        sessionId: "resumed-old",
        createdAt: "2026-05-01T10:00:00.000Z",
        closedAt: "2026-06-01T10:00:00.000Z", // re-stamped by a resume
      };
      const newerCreated: SessionMeta = {
        ...meta,
        sessionId: "newer-created",
        createdAt: "2026-05-20T10:00:00.000Z",
        closedAt: "2026-05-20T11:00:00.000Z",
      };
      for (const m of [resumedOld, newerCreated]) {
        await writeSessionMd(dir, m, turns);
        await writeSessionJson(dir, m, turns);
      }
      const listed = await listStoredSessions(dir);
      expect(listed.map((s) => s.sessionId)).toEqual(["newer-created", "resumed-old"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("breaks a createdAt tie on the codepoint-wise larger sessionId and keeps a non-resumable pair in place by its frontmatter createdAt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      const a: SessionMeta = { ...meta, sessionId: "tie-a", createdAt: "2026-05-10T10:00:00.000Z" };
      const b: SessionMeta = { ...meta, sessionId: "tie-b", createdAt: "2026-05-10T10:00:00.000Z" };
      const mdOnly: SessionMeta = { ...meta, sessionId: "md-only", createdAt: "2026-05-15T10:00:00.000Z" };
      for (const m of [a, b]) {
        await writeSessionMd(dir, m, turns);
        await writeSessionJson(dir, m, turns);
      }
      await writeSessionMd(dir, mdOnly, turns); // no JSON sidecar: resume disabled, still ordered
      const listed = await listStoredSessions(dir);
      expect(listed.map((s) => s.sessionId)).toEqual(["md-only", "tie-b", "tie-a"]);
      expect(listed[0]!.resumable).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("carries a turn count and a first-user-turn snippet from the displayed form", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      const projected: SessionTurn[] = [
        {
          role: "user",
          text: "host-prefix machine text\n\nWie strukturiere ich Schritt 3?",
          display: { text: "Wie strukturiere ich Schritt 3?" },
        },
        { role: "assistant", text: "Gern —" },
        { role: "user", text: "Weiter." },
      ];
      await writeSessionMd(dir, meta, projected);
      await writeSessionJson(dir, meta, projected);
      const listed = await listStoredSessions(dir);
      expect(listed[0]).toMatchObject({
        turnCount: 3,
        // The DISPLAYED form, never the model payload with its host prefixes.
        snippet: "Wie strukturiere ich Schritt 3?",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("truncates a long snippet to one readable line and omits it when no user turn exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      const long = "x".repeat(200);
      await writeSessionMd(dir, meta, [{ role: "user", text: long }]);
      await writeSessionJson(dir, meta, [{ role: "user", text: long }]);
      const empty: SessionMeta = { ...meta, sessionId: "empty-pair", closedAt: "2026-05-25T10:00:00.000Z" };
      await writeSessionMd(dir, empty, []);
      await writeSessionJson(dir, empty, []);
      const listed = await listStoredSessions(dir);
      const withSnippet = listed.find((s) => s.sessionId === meta.sessionId)!;
      expect(withSnippet.snippet!.length).toBeLessThanOrEqual(96);
      expect(withSnippet.snippet!.endsWith("…")).toBe(true);
      const emptyRow = listed.find((s) => s.sessionId === "empty-pair")!;
      expect(emptyRow.snippet).toBeUndefined();
      expect(emptyRow.turnCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("missing JSON sidecar disables resume but keeps the entry listed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      await writeSessionMd(dir, meta, turns); // md only — no JSON sidecar
      const listed = await listStoredSessions(dir);
      expect(listed.length).toBe(1);
      expect(listed[0]).toMatchObject({
        sessionId: "test-uuid-1",
        resumable: false,
        reason: en.mainResumeDisabledReason,
      });
      expect(listed[0]!.mdPath).toContain("test-uuid-1.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("malformed JSON sidecar disables resume but keeps the entry listed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-list-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await writeFile(path.join(dir, "test-uuid-1.json"), "{ not json", "utf8");
      const listed = await listStoredSessions(dir);
      expect(listed.length).toBe(1);
      expect(listed[0]!.resumable).toBe(false);
      expect(listed[0]!.reason).toBe(en.mainResumeDisabledReason);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("legacy sidecar with a mode field stays readable and is not rewritten", async () => {
    // Read-tolerance (capability desktop-app, Renderer Boot-Hydration: "Legacy
    // `mode` metadata never breaks continuity"): an old pair carrying `mode:` in
    // frontmatter and meta parses cleanly; the file is never rewritten over it.
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-legacy-"));
    try {
      const legacyMd = [
        "---",
        "sessionId: legacy-1",
        "mode: sparring",
        "modelId: gpt-oss-120b",
        "skillVersion: 0.1.6",
        "environmentProfile: app",
        "createdAt: 2026-06-01T10:00:00.000Z",
        "closedAt: 2026-06-01T11:00:00.000Z",
        "---",
        "",
        "## user",
        "",
        "Hello.",
        "",
      ].join("\n");
      await writeFile(path.join(dir, "legacy-1.md"), legacyMd, "utf8");
      await writeFile(
        path.join(dir, "legacy-1.json"),
        JSON.stringify({
          meta: {
            sessionId: "legacy-1",
            mode: "sparring",
            modelId: "gpt-oss-120b",
            skillVersion: "0.1.6",
            environmentProfile: "app",
            createdAt: "2026-06-01T10:00:00.000Z",
            closedAt: "2026-06-01T11:00:00.000Z",
          },
          turns: [{ role: "user", text: "Hello." }],
        }),
        "utf8"
      );
      const before = await readFile(path.join(dir, "legacy-1.md"), "utf8");
      const listed = await listStoredSessions(dir);
      expect(listed.length).toBe(1);
      expect(listed[0]).toMatchObject({ sessionId: "legacy-1", resumable: true });
      // Not rewritten: the legacy file is byte-identical after the read.
      expect(await readFile(path.join(dir, "legacy-1.md"), "utf8")).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for a course without a sessions folder", async () => {
    expect(await listStoredSessions(path.join(tmpdir(), "does-not-exist-cbe"))).toEqual([]);
  });
});

describe("deleteStoredSession", () => {
  it("deleting a session removes both sidecars in a single action", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-del-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await writeSessionJson(dir, meta, turns);
      await deleteStoredSession(dir, "test-uuid-1");
      expect(await listStoredSessions(dir)).toEqual([]);
      await expect(stat(path.join(dir, "test-uuid-1.md"))).rejects.toThrow();
      await expect(stat(path.join(dir, "test-uuid-1.json"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a failing removal aborts with a one-line error and the surviving sidecar stays", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-del-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await writeSessionJson(dir, meta, turns);
      // Make the directory read-only so unlink fails (POSIX).
      await chmod(dir, 0o555);
      await expect(deleteStoredSession(dir, "test-uuid-1")).rejects.toThrow(/Could not delete/);
      await chmod(dir, 0o755);
      // Both sidecars survived the aborted operation.
      await stat(path.join(dir, "test-uuid-1.md"));
      await stat(path.join(dir, "test-uuid-1.json"));
    } finally {
      await chmod(dir, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an already-absent sidecar is not an error (md-only entry)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-del-"));
    try {
      await writeSessionMd(dir, meta, turns);
      await deleteStoredSession(dir, "test-uuid-1");
      await expect(stat(path.join(dir, "test-uuid-1.md"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// one-conversation-per-course — agent-harness spec, Requirement: Sessions as
// Local Markdown/JSON Files ("Write discipline" + display projection) and
// course-workspace spec, Requirement: One Canonical Conversation per Course.
// ---------------------------------------------------------------------------

// Scenario: A crash during a flush cannot tear the previous sidecar state.
// The atomic temp-file + rename discipline means an interrupted write can never
// truncate the destination: we simulate the crash window by making the target
// directory reject the rename (read-only) — the pre-flush file must survive
// intact and parseable, and no partial content may reach it.
describe("atomic sidecar writes", () => {
  it("a failed flush leaves the previous sidecar state intact and parseable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns);
      const before = await readFile(path.join(dir, `${meta.sessionId}.json`), "utf8");
      // Make the directory read-only so the atomic rename (and temp write) fails.
      await chmod(dir, 0o500);
      await expect(
        writeSessionJson(dir, { ...meta, closedAt: "2026-07-07T09:00:00.000Z" }, [
          ...turns,
          { role: "user", text: "next turn" },
        ])
      ).rejects.toThrow();
      await chmod(dir, 0o700);
      const after = await readFile(path.join(dir, `${meta.sessionId}.json`), "utf8");
      expect(after).toBe(before); // pre-flush state in full — never torn
      expect(() => JSON.parse(after)).not.toThrow();
    } finally {
      await chmod(dir, 0o700).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not leave temp files behind after a successful flush", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns);
      await writeSessionMd(dir, meta, turns);
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// course-workspace spec — Scenario: Canonical conversation is the newest
// sidecar pair (+ tie-break, legacy-pairs-present, MD/mtime participation,
// unreadable-newest marker).
describe("resolveCanonicalConversation", () => {
  const metaAt = (sessionId: string, closedAt: string): SessionMeta => ({
    ...meta,
    sessionId,
    closedAt,
  });

  it("selects the newest pair by closedAt among several legacy pairs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, metaAt("old-a", "2026-07-01T10:00:00.000Z"), turns);
      await writeSessionJson(dir, metaAt("new-c", "2026-07-07T10:00:00.000Z"), turns);
      await writeSessionJson(dir, metaAt("mid-b", "2026-07-03T10:00:00.000Z"), turns);
      const r = await resolveCanonicalConversation(dir);
      expect(r.kind).toBe("resumable");
      if (r.kind === "resumable") expect(r.sessionId).toBe("new-c");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to createdAt when closedAt is empty", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, { ...metaAt("a", ""), createdAt: "2026-07-01T10:00:00.000Z" }, turns);
      await writeSessionJson(dir, { ...metaAt("b", ""), createdAt: "2026-07-05T10:00:00.000Z" }, turns);
      const r = await resolveCanonicalConversation(dir);
      expect(r.kind === "resumable" && r.sessionId).toBe("b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("breaks timestamp ties by the codepoint-wise larger sessionId", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const stamp = "2026-07-07T10:00:00.000Z";
      await writeSessionJson(dir, metaAt("aaa", stamp), turns);
      await writeSessionJson(dir, metaAt("zzz", stamp), turns);
      const r = await resolveCanonicalConversation(dir);
      expect(r.kind === "resumable" && r.sessionId).toBe("zzz");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a pair with unreadable JSON still participates via MD frontmatter and, when newest, is marked unreadable — never a silent fallback to an older pair", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, metaAt("older-ok", "2026-07-01T10:00:00.000Z"), turns);
      await writeSessionMd(dir, metaAt("older-ok", "2026-07-01T10:00:00.000Z"), turns);
      // Newest pair: torn JSON (truncated) + intact MD carrying the newer stamp.
      await writeSessionMd(dir, metaAt("newest-torn", "2026-07-07T10:00:00.000Z"), turns);
      await writeFile(path.join(dir, "newest-torn.json"), '{"meta": {"sessionId": "newest-t', "utf8");
      const r = await resolveCanonicalConversation(dir);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") expect(r.sessionId).toBe("newest-torn");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a JSON-less pair without MD meta participates via file mtime", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, metaAt("older-ok", "2026-07-01T10:00:00.000Z"), turns);
      // Bare markdown with NO parseable frontmatter timestamps.
      const bare = path.join(dir, "bare-md.md");
      await writeFile(bare, "# notes\n", "utf8");
      // Force the mtime far into the future relative to the JSON pair's stamp.
      const future = new Date("2027-01-01T00:00:00.000Z");
      await utimes(bare, future, future);
      const r = await resolveCanonicalConversation(dir);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") expect(r.sessionId).toBe("bare-md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns none for an empty or missing folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      expect((await resolveCanonicalConversation(dir)).kind).toBe("none");
      expect((await resolveCanonicalConversation(path.join(dir, "missing"))).kind).toBe("none");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// agent-harness spec — Scenario: Display projection renders re-entry as the
// lecturer saw it (sidecar side: round-trip, malformed tolerated, older
// sidecars without the field stay valid).
describe("display projection on user turns", () => {
  it("round-trips a user turn's display field through the JSON sidecar", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const withDisplay: SessionTurn[] = [
        {
          role: "user",
          text: "instruction\n\n<<<ingest envelope with full document body>>>",
          display: { text: "instruction", attachments: [{ filename: "syllabus.pdf", docType: "pdf" }] },
        },
        { role: "assistant", text: "Hi." },
      ];
      await writeSessionJson(dir, meta, withDisplay);
      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed?.turns[0]?.display?.text).toBe("instruction");
      expect(parsed?.turns[0]?.display?.attachments?.[0]?.filename).toBe("syllabus.pdf");
      // The payload text stays lossless beside it.
      expect(parsed?.turns[0]?.text).toContain("ingest envelope");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a malformed display value as absent without invalidating the sidecar", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      const payload = {
        meta,
        turns: [
          { role: "user", text: "hello", display: { bogus: true } },
          { role: "assistant", text: "Hi." },
        ],
      };
      await writeFile(path.join(dir, `${meta.sessionId}.json`), JSON.stringify(payload), "utf8");
      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed).not.toBeNull();
      expect(parsed?.turns[0]?.display).toBeUndefined();
      expect(parsed?.turns[0]?.text).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("older sidecars without display stay fully readable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns);
      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed?.turns).toEqual(turns);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The stopped marker (capability `agent-harness`, Requirement: *Sessions as
 * Local Markdown/JSON Files*, "Stopped marker on an assistant turn"). Optional
 * and additive on exactly the terms `display` establishes above — which is why
 * these tests sit beside those, asserting the same three properties for it.
 */
describe("Sessions — stopped marker on an assistant turn", () => {
  const stoppedTurns: SessionTurn[] = [
    { role: "user", text: "Erklär mir Schritt 4." },
    { role: "assistant", text: "Schritt 4 beginnt", stopped: true },
  ];

  // Scenario: A stopped turn persists as a completed turn carrying its marker
  it("round-trips the marker through the JSON sidecar and notes it in the Markdown archive", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, stoppedTurns);
      await writeSessionMd(dir, meta, stoppedTurns);

      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed?.turns[1]?.stopped).toBe(true);
      // The turn itself is an ordinary COMPLETED turn: its text is intact and
      // nothing about it is withheld.
      expect(parsed?.turns[1]?.text).toBe("Schritt 4 beginnt");

      const md = await readFile(path.join(dir, `${meta.sessionId}.md`), "utf8");
      expect(md).toContain("Schritt 4 beginnt");
      expect(md).toContain("stopped by the lecturer");
      // The lecturer's own turn carries no such note.
      expect(md.split("## assistant")[0]).not.toContain("stopped by the lecturer");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes no marker, and no archive note, for an ordinary completed turn", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      await writeSessionJson(dir, meta, turns);
      await writeSessionMd(dir, meta, turns);
      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed?.turns[1]).not.toHaveProperty("stopped");
      expect(await readFile(path.join(dir, `${meta.sessionId}.md`), "utf8")).not.toContain("stopped by the lecturer");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Scenario: An older sidecar without the marker is still fully readable
  it("reads an older sidecar without the marker, and a malformed one, as complete turns", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cbe-test-"));
    try {
      // Written before the marker existed.
      await writeSessionJson(dir, meta, turns);
      const older = await readSessionJson(dir, meta.sessionId);
      expect(older).not.toBeNull();
      expect(older?.turns.every((t) => t.stopped === undefined)).toBe(true);

      // …and one whose `stopped` value is malformed: treated as absent, never
      // invalidating the sidecar.
      const malformed = {
        meta,
        turns: [
          { role: "user", text: "hello" },
          { role: "assistant", text: "Hi.", stopped: "yes please" },
        ],
      };
      await writeFile(path.join(dir, `${meta.sessionId}.json`), JSON.stringify(malformed), "utf8");
      const parsed = await readSessionJson(dir, meta.sessionId);
      expect(parsed).not.toBeNull();
      expect(parsed?.turns[1]?.stopped).toBeUndefined();
      expect(parsed?.turns[1]?.text).toBe("Hi.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
