/**
 * The separate support-preference record and its serialised compare-and-set service
 * (capability `agent-harness`, Requirement: *Separate Lecturer-Wide Support
 * Preference*; change `recalibrate-tutor-support`, task 2.1).
 *
 * The file-backed store and restart round-trip are the app's and are tested there
 * (`packages/app/tests/lecturer-support-store.test.ts`); this file holds the shared
 * shape, its guard, the service semantics both hosts rely on, the data-only renderings
 * and the per-session disclosure bookkeeping.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_SUPPORT_RECORD,
  InMemoryLecturerSupportStore,
  LecturerSupportDisclosure,
  LecturerSupportService,
  SUPPORT_PREFERENCES,
  isLecturerSupportRecord,
  isSupportPreference,
  lecturerSupportNoticeLine,
  type LecturerSupportRecord,
  type LecturerSupportStore,
} from "../src/lecturer-support.js";
import { lecturerSupportLines } from "../src/environment.js";
import { isLecturerProfile, PROFILE_DIMENSIONS } from "../src/lecturer-profile.js";
import { isLecturerIdentity } from "../src/lecturer-identity.js";

const record = (revision: number, preference: LecturerSupportRecord["preference"]): LecturerSupportRecord => ({
  version: 1,
  revision,
  preference,
});

describe("support record — the shape and its strict guard", () => {
  it("accepts each of the three fixed values and null", () => {
    expect(SUPPORT_PREFERENCES).toEqual(["guided", "collaborative", "concise"]);
    for (const p of SUPPORT_PREFERENCES) expect(isLecturerSupportRecord(record(3, p))).toBe(true);
    expect(isLecturerSupportRecord(record(0, null))).toBe(true);
  });

  it("rejects a value outside the fixed set, a foreign key, another version and a malformed revision", () => {
    expect(isSupportPreference("intensive")).toBe(false);
    expect(isLecturerSupportRecord({ version: 1, revision: 1, preference: "intensive" })).toBe(false);
    expect(isLecturerSupportRecord({ version: 1, revision: 1, preference: "guided", confidence: "high" })).toBe(false);
    expect(isLecturerSupportRecord({ version: 2, revision: 1, preference: "guided" })).toBe(false);
    expect(isLecturerSupportRecord({ revision: 1, preference: "guided" })).toBe(false);
    for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
      expect(isLecturerSupportRecord({ version: 1, revision, preference: "guided" })).toBe(false);
    }
    expect(isLecturerSupportRecord({ version: 1, revision: 1 })).toBe(false); // preference must be present
    expect(isLecturerSupportRecord(null)).toBe(false);
    expect(isLecturerSupportRecord([record(1, "guided")])).toBe(false);
  });

  // Scenario: *A preference is never a profile dimension*.
  it("is independent of the five-dimension profile and the identity record", () => {
    const r = record(1, "collaborative");
    // Neither of the other two guards admits the support record…
    expect(isLecturerProfile(r)).toBe(false);
    expect(isLecturerIdentity(r)).toBe(false);
    // …and the profile still names exactly its five dimensions.
    expect(PROFILE_DIMENSIONS).toHaveLength(5);
    expect(PROFILE_DIMENSIONS as readonly string[]).not.toContain("support");
    expect(PROFILE_DIMENSIONS as readonly string[]).not.toContain("preference");
  });
});

describe("support service — fail-soft load, compare-and-set, revisioned clear", () => {
  // Scenario: *A missing or corrupt record leaves no preference*.
  it("loads absent, throwing and invalid stores as no preference at revision 0", async () => {
    const throwing: LecturerSupportStore = {
      load: async () => {
        throw new Error("EACCES");
      },
      save: async () => undefined,
    };
    const invalid: LecturerSupportStore = {
      load: async () => ({ version: 1, revision: 4, preference: "intensive" }),
      save: async () => undefined,
    };
    for (const store of [new InMemoryLecturerSupportStore(), throwing, invalid]) {
      const s = await new LecturerSupportService(store, "lecturer-wide").current();
      expect(s).toEqual({ preference: null, revision: 0, scope: "lecturer-wide" });
    }
    expect(EMPTY_SUPPORT_RECORD).toEqual({ version: 1, revision: 0, preference: null });
  });

  it("accepts a current write only after the save resolved, at the next revision", async () => {
    const store = new InMemoryLecturerSupportStore();
    const svc = new LecturerSupportService(store, "lecturer-wide");
    const r = await svc.change({ operation: "set", preference: "collaborative" }, 0);
    expect(r).toEqual({
      outcome: "accepted",
      snapshot: { preference: "collaborative", revision: 1, scope: "lecturer-wide" },
    });
    expect(await store.load()).toEqual(record(1, "collaborative"));
  });

  // Scenario: *Clear restores the default across already-open sessions*.
  it("persists a clear as a revisioned null that an older write cannot resurrect", async () => {
    const store = new InMemoryLecturerSupportStore(record(1, "guided"));
    const svc = new LecturerSupportService(store, "lecturer-wide");
    const cleared = await svc.change({ operation: "clear" }, 1);
    expect(cleared.outcome).toBe("accepted");
    expect(await store.load()).toEqual(record(2, null));
    // A session still holding revision 1 tries to restore its old choice.
    const stale = await svc.change({ operation: "set", preference: "guided" }, 1);
    expect(stale).toEqual({
      outcome: "refused-stale",
      snapshot: { preference: null, revision: 2, scope: "lecturer-wide" },
    });
    expect(await store.load()).toEqual(record(2, null));
  });

  // Scenario: *Malformed or stale preference writes are refused*. Two sessions over ONE
  // service, writing concurrently: the queue orders them and the second is stale.
  it("serialises concurrent writes so the later one carrying the earlier revision is refused", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(), "lecturer-wide");
    const [a, b] = await Promise.all([
      svc.change({ operation: "set", preference: "concise" }, 0),
      svc.change({ operation: "set", preference: "guided" }, 0),
    ]);
    expect(a.outcome).toBe("accepted");
    expect(b.outcome).toBe("refused-stale");
    expect((await svc.current()).preference).toBe("concise");
  });

  // Scenario: *Failed persistence is not reported as success*.
  it("keeps the last saved record in force when a save fails", async () => {
    let fail = false;
    const inner = new InMemoryLecturerSupportStore(record(3, "concise"));
    const store: LecturerSupportStore = {
      load: () => inner.load(),
      save: async (r) => {
        if (fail) throw new Error("ENOSPC");
        await inner.save(r);
      },
    };
    const svc = new LecturerSupportService(store, "lecturer-wide");
    fail = true;
    const r = await svc.change({ operation: "set", preference: "guided" }, 3);
    expect(r.outcome).toBe("failed");
    expect(r.snapshot).toEqual({ preference: "concise", revision: 3, scope: "lecturer-wide" });
    expect(await svc.current()).toEqual({ preference: "concise", revision: 3, scope: "lecturer-wide" });
    // The failure is not sticky: the next valid write lands at the next revision.
    fail = false;
    expect((await svc.change({ operation: "set", preference: "guided" }, 3)).snapshot.revision).toBe(4);
  });

  it("reports the scope the host declared", async () => {
    const s = await new LecturerSupportService(new InMemoryLecturerSupportStore(), "session-local").current();
    expect(s.scope).toBe("session-local");
  });
});

describe("support renderings — data only, inert-encoded, one source for both", () => {
  it("renders a distinct lecturer-support block, including when nothing is recorded", () => {
    const none = lecturerSupportLines({ preference: null, revision: 0, scope: "lecturer-wide" });
    expect(none[0]).toMatch(/^lecturer-support /);
    expect(none).toContain("  ```lecturer-support");
    expect(none.join("\n")).toContain("preference: none recorded");
    expect(none.join("\n")).toContain("revision: 0");
    const set = lecturerSupportLines({ preference: "guided", revision: 7, scope: "session-local" });
    // Fixed value, still through the shared inert encoder.
    expect(set.join("\n")).toContain('preference: "guided"');
    expect(set.join("\n")).toContain("revision: 7");
    expect(set.join("\n")).toMatch(/storage: session-local/);
  });

  it("renders nothing when the host supplied no snapshot", () => {
    expect(lecturerSupportLines(undefined)).toEqual([]);
  });

  it("carries no assistance rule — no meanings, no consent, no instruction to the model", () => {
    const text = [
      ...lecturerSupportLines({ preference: "guided", revision: 1, scope: "lecturer-wide" }),
      lecturerSupportNoticeLine({ preference: "guided", revision: 1, scope: "lecturer-wide" }),
    ].join("\n");
    expect(text).not.toMatch(/step by step|one question|consent|formulat|example|scaffold/i);
    expect(text).not.toMatch(/\b(you must|always|never ask)\b/i);
  });

  it("the next-prompt notice is one bracketed line stating the snapshot", () => {
    const line = lecturerSupportNoticeLine({ preference: null, revision: 5, scope: "lecturer-wide" });
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toMatch(/^\[lecturer-support\] /);
    expect(line).toContain("preference: none recorded");
    expect(line).toContain("revision: 5");
  });
});

describe("support disclosure — derived, so a refused prompt consumes nothing", () => {
  it("is not due while the session holds the current revision, and due once it moves", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(), "lecturer-wide");
    const d = new LecturerSupportDisclosure(svc, 0);
    expect(await d.due()).toBeNull();
    await svc.change({ operation: "set", preference: "concise" }, 0);
    expect((await d.due())?.revision).toBe(1);
  });

  // Scenario: *Refused prompt dispatch does not lose a preference update*.
  it("stays due until a payload carrying it is marked delivered", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(record(2, "guided")), "lecturer-wide");
    const d = new LecturerSupportDisclosure(svc, 1);
    expect((await d.due())?.revision).toBe(2); // first attempt: refused, nothing marked
    expect((await d.due())?.revision).toBe(2); // the retry still carries it
    d.markDelivered(2);
    expect(await d.due()).toBeNull();
  });

  // Scenario: *Compaction cannot restore an obsolete preference*.
  it("makes the current snapshot due again after a compaction, at an unchanged revision", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(record(4, null)), "lecturer-wide");
    const d = new LecturerSupportDisclosure(svc, 4);
    expect(await d.due()).toBeNull();
    d.invalidate();
    expect(await d.due()).toEqual({ preference: null, revision: 4, scope: "lecturer-wide" });
    d.markDelivered(4);
    expect(await d.due()).toBeNull();
  });

  it("keeps the snapshot due when a compaction lands between reading it and delivering it", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(record(3, "guided")), "lecturer-wide");
    const d = new LecturerSupportDisclosure(svc, 2);
    const due = await d.pending();
    expect(due?.snapshot.revision).toBe(3);
    d.invalidate(); // the run that carries the notice compacts before it resolves
    d.markDelivered(due!.snapshot.revision, due!.generation);
    expect(d.disclosedRevision).toBe(3);
    expect(await d.due()).toEqual({ preference: "guided", revision: 3, scope: "lecturer-wide" });
    const again = await d.pending();
    d.markDelivered(again!.snapshot.revision, again!.generation);
    expect(await d.due()).toBeNull();
  });

  it("lets a snapshot read after the compaction clear it", async () => {
    const svc = new LecturerSupportService(new InMemoryLecturerSupportStore(record(3, "guided")), "lecturer-wide");
    const d = new LecturerSupportDisclosure(svc, 3);
    d.invalidate();
    d.markDelivered(3); // a cbe_support result the model reads after the compaction
    expect(await d.due()).toBeNull();
  });

  it("never rolls back a newer revision the session already saw", () => {
    const d = new LecturerSupportDisclosure(
      new LecturerSupportService(new InMemoryLecturerSupportStore(), "lecturer-wide"),
      0
    );
    d.markDelivered(5);
    d.markDelivered(3);
    expect(d.disclosedRevision).toBe(5);
  });
});
