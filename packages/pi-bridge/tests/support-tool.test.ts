/**
 * `cbe_support` (capability `agent-harness`, Requirement: *Separate Lecturer-Wide
 * Support Preference*; Requirement: *Tool Descriptions Carry Their Operating Rules*;
 * change `recalibrate-tutor-support`, task 2.3).
 *
 * The tool writes THROUGH the host's service, so these tests drive `execute` against a
 * real service over an in-memory store (and an injected failing one) and assert on the
 * store, not on the wording of an acknowledgement.
 */
import { describe, it, expect } from "vitest";
import { createSupportTool, SupportParamsSchema, type SupportToolDetails } from "../src/support-tool.js";
import {
  InMemoryLecturerSupportStore,
  LecturerSupportService,
  type LecturerSupportRecord,
  type LecturerSupportSnapshot,
  type LecturerSupportStore,
} from "../src/lecturer-support.js";
import { profileTool } from "../src/profile-tool.js";

type Exec = (id: string, params: unknown) => Promise<{ content: { text: string }[]; details: SupportToolDetails }>;

function setup(initial?: LecturerSupportRecord, scope: "lecturer-wide" | "session-local" = "lecturer-wide") {
  const store = new InMemoryLecturerSupportStore(initial ?? null);
  const service = new LecturerSupportService(store, scope);
  const seen: LecturerSupportSnapshot[] = [];
  const tool = createSupportTool(service, (s) => seen.push(s));
  const exec = (params: unknown) => (tool.execute as unknown as Exec)("call-1", params);
  return { store, service, tool, exec, seen };
}

describe("cbe_support — accepted writes report durable truth", () => {
  // Scenario: *An explicit preference survives conversations, courses and restart* — the
  // write half; the restart half is the app's file store test.
  it("saves a set and reports the accepted snapshot with its storage scope", async () => {
    const { store, exec, seen } = setup();
    const r = await exec({ operation: "set", preference: "collaborative", expectedRevision: 0 });
    expect(r.details).toEqual({
      kind: "support-accepted",
      snapshot: { preference: "collaborative", revision: 1, scope: "lecturer-wide" },
    });
    expect(r.content[0]!.text).toMatch(/saved/i);
    expect(r.content[0]!.text).toContain("storage: lecturer-wide");
    expect(await store.load()).toEqual({ version: 1, revision: 1, preference: "collaborative" });
    expect(seen.at(-1)?.revision).toBe(1);
  });

  it("saves a clear as a revisioned null", async () => {
    const { store, exec } = setup({ version: 1, revision: 2, preference: "guided" });
    const r = await exec({ operation: "clear", expectedRevision: 2 });
    expect(r.details.kind).toBe("support-accepted");
    expect(await store.load()).toEqual({ version: 1, revision: 3, preference: null });
  });

  it("reports session-local storage where a headless host supplies only a session store", async () => {
    const { exec } = setup(undefined, "session-local");
    const r = await exec({ operation: "set", preference: "concise", expectedRevision: 0 });
    expect(r.details.snapshot.scope).toBe("session-local");
    expect(r.content[0]!.text).toContain("storage: session-local");
  });

  it("does not terminate the agent run", async () => {
    const { exec } = setup();
    const r = (await exec({ operation: "set", preference: "guided", expectedRevision: 0 })) as unknown as {
      terminate?: boolean;
    };
    expect(r.terminate).toBeUndefined();
  });
});

describe("cbe_support — malformed and stale calls change nothing", () => {
  // Scenario: *Malformed or stale preference writes are refused*.
  it.each([
    [{ operation: "set", preference: "intensive", expectedRevision: 0 }],
    [{ operation: "set", expectedRevision: 0 }],
    [{ operation: "clear", preference: "guided", expectedRevision: 0 }],
    [{ operation: "reset", expectedRevision: 0 }],
    [{ operation: "set", preference: "guided", expectedRevision: -1 }],
    [{ operation: "set", preference: "guided", expectedRevision: 1.5 }],
    [{ operation: "set", preference: "guided" }],
  ])("refuses %j without writing and returns the current snapshot", async (params) => {
    const { store, exec } = setup({ version: 1, revision: 0, preference: null });
    const r = await exec(params);
    expect(r.details).toEqual({
      kind: "support-refused",
      reason: "malformed",
      snapshot: { preference: null, revision: 0, scope: "lecturer-wide" },
    });
    expect(r.content[0]!.text).toMatch(/Nothing was saved/);
    expect(await store.load()).toEqual({ version: 1, revision: 0, preference: null });
  });

  it("refuses a stale revision and returns the newer state rather than overwriting it", async () => {
    const { store, exec } = setup({ version: 1, revision: 4, preference: null });
    const r = await exec({ operation: "set", preference: "guided", expectedRevision: 3 });
    expect(r.details).toEqual({
      kind: "support-refused",
      reason: "stale",
      snapshot: { preference: null, revision: 4, scope: "lecturer-wide" },
    });
    expect(await store.load()).toEqual({ version: 1, revision: 4, preference: null });
  });
});

describe("cbe_support — a failed save is reported as failure", () => {
  // Scenario: *Failed persistence is not reported as success*.
  it("reports failure, claims no save, and leaves the last saved record in force", async () => {
    const inner = new InMemoryLecturerSupportStore({ version: 1, revision: 1, preference: "concise" });
    const failing: LecturerSupportStore = {
      load: () => inner.load(),
      save: async () => {
        throw new Error("EROFS");
      },
    };
    const tool = createSupportTool(new LecturerSupportService(failing, "lecturer-wide"));
    const r = await (tool.execute as unknown as Exec)("c", {
      operation: "set",
      preference: "guided",
      expectedRevision: 1,
    });
    expect(r.details).toEqual({
      kind: "support-failed",
      reason: "save-failed",
      snapshot: { preference: "concise", revision: 1, scope: "lecturer-wide" },
    });
    expect(r.content[0]!.text).not.toMatch(/\bsaved\. Now\b/);
    expect(r.content[0]!.text).toMatch(/could not be saved/);
    expect(await inner.load()).toEqual({ version: 1, revision: 1, preference: "concise" });
  });
});

describe("cbe_support — the operating rules live in the tool's own schema", () => {
  // Requirement: *Tool Descriptions Carry Their Operating Rules* — the `cbe_support` bullet.
  const { tool } = setup();
  const d = tool.description;

  it("states the explicit-instruction-only trigger and the one-off/lasting distinction", () => {
    expect(d).toMatch(/ONLY on their explicit instruction/);
    expect(d).toMatch(/Never for a one-off request/);
    expect(d).toMatch(/never inferred from their competence, silence or difficulty/);
  });

  it("states expected-revision handling, save acknowledgement, stale reconciliation and no retry loop", () => {
    expect(d).toMatch(/expectedRevision from the latest lecturer-support snapshot/);
    expect(d).toMatch(/only an accepted result is saved/);
    expect(d).toMatch(/reconcile it with what the lecturer now asks; never replay the older choice/);
    expect(d).toMatch(/A failed save changed nothing: say so and do not retry on your own/);
  });

  it("names the three values in its parameter schema, and copies no support ladder or calibration rule", () => {
    const params = JSON.stringify(SupportParamsSchema);
    for (const v of ["guided", "collaborative", "concise"]) expect(params).toContain(v);
    expect(`${d}\n${params}`).not.toMatch(/prior knowledge|scaffold|consent|fade|Big Idea|learning outcome/i);
  });

  it("leaves cbe_profile unchanged — no support field reaches the profile schema", () => {
    const profileParams = JSON.stringify(profileTool.parameters);
    expect(profileParams).not.toMatch(/support|preference|guided|collaborative/i);
  });
});
