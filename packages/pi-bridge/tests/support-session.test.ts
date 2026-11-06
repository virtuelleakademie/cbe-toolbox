/**
 * The support preference through the REAL `startCbeSession` (capability `agent-harness`,
 * Requirement: *Separate Lecturer-Wide Support Preference*; change
 * `recalibrate-tutor-support`, tasks 2.3 and 3.1/3.2).
 *
 * The record, service and tool are covered in isolation elsewhere; what only the real
 * factory can show is the WIRING: the tool is registered and allowlisted, the descriptor
 * carries a separate `lecturer-support` block from the same service the tool writes
 * through, a host that supplies no service still gets the uniform surface (session-local),
 * two sessions over one service see each other's changes at the next prompt boundary, and
 * the session's own accepted write does not get disclosed back to it. Session
 * construction does not call the model, so the factory runs against an offline provider.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession, type StartSessionOptions } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";
import { InMemoryLecturerSupportStore, LecturerSupportService } from "../src/lecturer-support.js";
import type { LecturerProfile } from "../src/lecturer-profile.js";

const tmps: string[] = [];

afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function baseOpts(): Omit<StartSessionOptions, "profile"> {
  const tmp = mkdtempSync(path.join(tmpdir(), "cbe-support-session-"));
  tmps.push(tmp);
  return {
    skillDir: path.resolve(__dirname, "..", "..", "..", "skills", "cbe"),
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  };
}

type Exec = (id: string, params: unknown) => Promise<{ details: { kind: string } }>;

async function supportToolOf(started: Awaited<ReturnType<typeof startCbeSession>>) {
  const { createSupportTool } = await import("../src/support-tool.js");
  // The registered tool is the session's own; re-create one over the same host and
  // the same disclosure hook to drive it the way pi would.
  return createSupportTool(started.lecturerSupportService, (s) => started.supportDisclosure.markDelivered(s.revision));
}

describe("cbe_support — registered uniformly through startCbeSession", () => {
  it("is in the active tool set of an app and a headless session", async () => {
    for (const profile of ["app", "headless"] as const) {
      const started = await startCbeSession({ profile, ...baseOpts() });
      try {
        expect(piSessionOf(started.session).getActiveToolNames()).toContain("cbe_support");
      } finally {
        started.session.dispose();
      }
    }
  });

  // Scenario: *A preference is never a profile dimension*.
  it("renders a separate lecturer-support block and leaves the profile prior unchanged", async () => {
    const lecturerProfile: LecturerProfile = {
      "cbe-prior-knowledge": {
        value: "pronounced",
        confidence: "high",
        evidence: "turn 2",
        provenance: "estimate",
        lastRevised: "2026-10-13T09:00:00.000Z",
      },
    };
    const service = new LecturerSupportService(
      new InMemoryLecturerSupportStore({ version: 1, revision: 3, preference: "guided" }),
      "lecturer-wide"
    );
    const started = await startCbeSession({
      profile: "app",
      ...baseOpts(),
      lecturerProfile,
      lecturerSupportService: service,
    });
    try {
      const block = started.env.toSystemPromptBlock();
      expect(block).toContain("  ```lecturer-support");
      expect(block).toContain('preference: "guided"');
      expect(block).toContain("revision: 3");
      expect(block).toContain("storage: lecturer-wide");
      // The profile prior names its dimension and nothing about support.
      const prior = block.slice(block.indexOf("lecturer-profile prior:"));
      expect(prior).toContain("cbe-prior-knowledge: pronounced");
      expect(prior.slice(0, prior.indexOf("```", prior.indexOf("```") + 3))).not.toMatch(/guided|support/);
    } finally {
      started.session.dispose();
    }
  });

  // Scenario: *A missing or corrupt record leaves no preference* — and a host with no
  // durable store still gets the same surface, honestly scoped.
  it("gives a host that supplies no service a session-local store and reports none recorded", async () => {
    const started = await startCbeSession({ profile: "headless", ...baseOpts() });
    try {
      const block = started.env.toSystemPromptBlock();
      expect(block).toContain("preference: none recorded");
      expect(block).toContain("storage: session-local");
      expect(started.lecturerSupportService.scope).toBe("session-local");
      expect(await started.supportDisclosure.due()).toBeNull();
    } finally {
      started.session.dispose();
    }
  });
});

describe("cbe_support — one lecturer-wide service across open sessions", () => {
  // Scenario: *Clear restores the default across already-open sessions*.
  it("discloses a clear made in one session to the other before its next prompt", async () => {
    const service = new LecturerSupportService(
      new InMemoryLecturerSupportStore({ version: 1, revision: 1, preference: "collaborative" }),
      "lecturer-wide"
    );
    const a = await startCbeSession({ profile: "app", ...baseOpts(), lecturerSupportService: service });
    const b = await startCbeSession({ profile: "app", ...baseOpts(), lecturerSupportService: service });
    try {
      const toolA = await supportToolOf(a);
      const r = await (toolA.execute as unknown as Exec)("c1", { operation: "clear", expectedRevision: 1 });
      expect(r.details.kind).toBe("support-accepted");
      // A read the snapshot in its own result: nothing further is due for it.
      expect(await a.supportDisclosure.due()).toBeNull();
      // B still holds revision 1 and must receive the current state before answering.
      expect(await b.supportDisclosure.due()).toEqual({ preference: null, revision: 2, scope: "lecturer-wide" });
      // B's delayed write carrying the old revision cannot restore the cleared preference.
      const toolB = await supportToolOf(b);
      const stale = await (toolB.execute as unknown as Exec)("c2", {
        operation: "set",
        preference: "collaborative",
        expectedRevision: 1,
      });
      expect(stale.details.kind).toBe("support-refused");
      expect((await service.current()).preference).toBeNull();
    } finally {
      a.session.dispose();
      b.session.dispose();
    }
  });

  // Scenario: *A local help request performs no preference mutation*. The bookkeeping
  // half: starting and using a session writes nothing on its own.
  it("leaves the stored preference and revision untouched when no cbe_support call is made", async () => {
    const store = new InMemoryLecturerSupportStore({ version: 1, revision: 6, preference: "concise" });
    const service = new LecturerSupportService(store, "lecturer-wide");
    const started = await startCbeSession({ profile: "app", ...baseOpts(), lecturerSupportService: service });
    try {
      expect(await store.load()).toEqual({ version: 1, revision: 6, preference: "concise" });
    } finally {
      started.session.dispose();
    }
  });
});
