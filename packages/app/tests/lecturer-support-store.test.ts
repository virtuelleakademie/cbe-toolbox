/**
 * The desktop host's lecturer-wide support-preference store (change
 * `recalibrate-tutor-support`, task 2.2; capability `agent-harness`, Requirement:
 * *Separate Lecturer-Wide Support Preference*).
 *
 * The record lives at `<userData>/lecturer-support.json`, beside — never inside — the
 * profile and identity records and outside every course directory. Load is fail-soft,
 * save is atomic, and the compare-and-set ordering is the shared pi-bridge service's,
 * driven here over the REAL file store so the restart round-trip, the cleared tombstone
 * and the last-saved-state-on-failure are proved against the disk.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileLecturerSupportStore } from "../src/main/lecturer-support-store.js";
import { LecturerSupportService } from "@cbe/pi-bridge/lecturer-support";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cbe-support-"));
  file = path.join(dir, "lecturer-support.json");
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

/** A fresh service over a fresh store on the same path — what an app restart is. */
const restart = () => new LecturerSupportService(new FileLecturerSupportStore(file), "lecturer-wide");

describe("FileLecturerSupportStore — the record on disk", () => {
  // Scenario: *An explicit preference survives conversations, courses and restart*.
  it("survives a restart and is the same for every conversation and course", async () => {
    const svc = restart();
    expect((await svc.change({ operation: "set", preference: "collaborative" }, 0)).outcome).toBe("accepted");
    const after = await restart().current();
    expect(after).toEqual({ preference: "collaborative", revision: 1, scope: "lecturer-wide" });
    // Nothing about a course is in the record or its location.
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, revision: 1, preference: "collaborative" });
    expect(path.basename(file)).toBe("lecturer-support.json");
  });

  it("writes one pretty-printed record and leaves no temp file behind", async () => {
    await restart().change({ operation: "set", preference: "concise" }, 0);
    expect(await readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "revision": 1,\n  "preference": "concise"\n}\n');
    expect(await readdir(dir)).toEqual(["lecturer-support.json"]);
  });

  // Scenario: *A missing or corrupt record leaves no preference*.
  it.each([
    ["absent", null],
    ["unparseable", "{not json"],
    ["a value outside the fixed set", JSON.stringify({ version: 1, revision: 2, preference: "intensive" })],
    ["a foreign key", JSON.stringify({ version: 1, revision: 2, preference: "guided", confidence: "high" })],
    ["another version", JSON.stringify({ version: 9, revision: 2, preference: "guided" })],
  ])("loads %s as no preference at revision 0", async (_label, content) => {
    if (content !== null) await writeFile(file, content, "utf8");
    expect(await restart().current()).toEqual({ preference: null, revision: 0, scope: "lecturer-wide" });
  });

  it("does not create a preference from a missing file just by loading it", async () => {
    await restart().current();
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});

describe("FileLecturerSupportStore — clear, stale writes and failure", () => {
  // Scenario: *Clear restores the default across already-open sessions* — the store half.
  it("persists a clear as a revisioned null that an older session cannot resurrect, even after restart", async () => {
    const svc = restart();
    await svc.change({ operation: "set", preference: "guided" }, 0);
    await svc.change({ operation: "clear" }, 1);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, revision: 2, preference: null });
    const later = restart();
    const stale = await later.change({ operation: "set", preference: "guided" }, 1);
    expect(stale.outcome).toBe("refused-stale");
    expect((await later.current()).preference).toBeNull();
  });

  // Scenario: *Failed persistence is not reported as success*.
  it("reports a failed save and keeps the last saved record in force", async () => {
    if (process.getuid?.() === 0) return; // root ignores the permission bits this relies on
    const svc = restart();
    await svc.change({ operation: "set", preference: "concise" }, 0);
    await chmod(dir, 0o500); // the directory refuses the temp file
    const failed = await svc.change({ operation: "set", preference: "guided" }, 1);
    expect(failed.outcome).toBe("failed");
    expect(failed.snapshot).toEqual({ preference: "concise", revision: 1, scope: "lecturer-wide" });
    await chmod(dir, 0o700);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, revision: 1, preference: "concise" });
    expect(await restart().current()).toEqual({ preference: "concise", revision: 1, scope: "lecturer-wide" });
  });

  // A course deletion removes the course directory; the preference lives outside it.
  it("is untouched when a course directory beside it is deleted", async () => {
    await restart().change({ operation: "set", preference: "collaborative" }, 0);
    const course = path.join(dir, "courses", "c1");
    await mkdir(course, { recursive: true });
    await rm(path.join(dir, "courses"), { recursive: true, force: true });
    expect((await restart().current()).preference).toBe("collaborative");
  });
});
