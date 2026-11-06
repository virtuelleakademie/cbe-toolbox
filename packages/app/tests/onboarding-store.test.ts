import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileOnboardingStore } from "../src/main/onboarding-store.js";

const roots: string[] = [];
async function space(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cbe-onboarding-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("First-Use Orientation Acknowledgment and Persistence", () => {
  it("treats an absent record as pending without creating or changing app data", async () => {
    const root = await space();
    const store = new FileOnboardingStore(path.join(root, "onboarding.json"));

    expect(await store.read()).toEqual({ acknowledged: false });
    expect(await readdir(root)).toEqual([]);
  });

  it("loads only the valid schema and suppresses onboarding after restart", async () => {
    const root = await space();
    const file = path.join(root, "onboarding.json");
    await writeFile(file, '{"schemaVersion":1,"acknowledged":true}\n');

    expect(await new FileOnboardingStore(file).read()).toEqual({ acknowledged: true });
    expect(await new FileOnboardingStore(file).read()).toEqual({ acknowledged: true });
  });

  it("treats malformed and foreign-schema records as pending without rewriting them", async () => {
    const root = await space();
    const malformed = path.join(root, "malformed.json");
    const foreign = path.join(root, "foreign.json");
    await writeFile(malformed, "not-json");
    await writeFile(foreign, '{"schemaVersion":2,"acknowledged":true,"course":"must-stay"}');

    expect(await new FileOnboardingStore(malformed).read()).toEqual({ acknowledged: false });
    expect(await new FileOnboardingStore(foreign).read()).toEqual({ acknowledged: false });
    expect(await readFile(foreign, "utf8")).toContain('"course":"must-stay"');
  });

  it("reports an unreadable record softly and keeps it pending", async () => {
    const root = await space();
    const directoryAtRecordPath = path.join(root, "onboarding.json");
    await mkdir(directoryAtRecordPath);

    expect(await new FileOnboardingStore(directoryAtRecordPath).read()).toEqual({
      acknowledged: false,
      issue: "unreadable",
    });
  });

  it("acknowledges idempotently with an atomic schema-only record", async () => {
    const root = await space();
    const file = path.join(root, "profile-a", "onboarding.json");
    const store = new FileOnboardingStore(file);

    expect(await Promise.all([store.acknowledge(), store.acknowledge()])).toEqual([
      { acknowledged: true, persisted: true },
      { acknowledged: true, persisted: true },
    ]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schemaVersion: 1, acknowledged: true });
    expect(await readdir(path.dirname(file))).toEqual(["onboarding.json"]);
  });

  it("keeps main-lifetime suppression after an unwritable record and allows an explicit retry", async () => {
    const root = await space();
    const blockedParent = path.join(root, "not-a-directory");
    await writeFile(blockedParent, "block");
    const file = path.join(blockedParent, "onboarding.json");
    const store = new FileOnboardingStore(file);

    expect(await store.acknowledge()).toEqual({ acknowledged: true, persisted: false });
    expect(await store.read()).toEqual({ acknowledged: true });
    expect(await store.acknowledge()).toEqual({ acknowledged: true, persisted: false });
    // A new main process has no durable marker and therefore offers again.
    expect(await new FileOnboardingStore(file).read()).toEqual({ acknowledged: false, issue: "unreadable" });
  });

  it("stops retrying the write after a failure, and only an explicit close tries once more", async () => {
    const root = await space();
    const blockedParent = path.join(root, "not-a-directory");
    await writeFile(blockedParent, "block");
    const file = path.join(blockedParent, "onboarding.json");
    const store = new FileOnboardingStore(file);

    expect(await store.acknowledge()).toEqual({ acknowledged: true, persisted: false });
    // Clear the obstacle: any further write attempt would now SUCCEED, so an
    // unchanged `persisted: false` proves no attempt was made.
    await rm(blockedParent);

    expect(await store.acknowledge()).toEqual({ acknowledged: true, persisted: false });
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    expect(await store.acknowledge({ retryPersistence: true })).toEqual({ acknowledged: true, persisted: true });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schemaVersion: 1, acknowledged: true });
  });

  it("never lets a delayed read reverse an acknowledgment", async () => {
    const root = await space();
    const file = path.join(root, "onboarding.json");
    await writeFile(file, '{"schemaVersion":1,"acknowledged":false}\n');
    const store = new FileOnboardingStore(file);

    const delayedRead = store.read();
    const acknowledgment = store.acknowledge();
    expect(await delayedRead).toEqual({ acknowledged: true });
    expect(await acknowledgment).toEqual({ acknowledged: true, persisted: true });
  });

  it("keeps separate local app-data profiles independent", async () => {
    const root = await space();
    const first = new FileOnboardingStore(path.join(root, "profile-a", "onboarding.json"));
    const second = new FileOnboardingStore(path.join(root, "profile-b", "onboarding.json"));

    await first.acknowledge();
    expect(await first.read()).toEqual({ acknowledged: true });
    expect(await second.read()).toEqual({ acknowledged: false });
  });
});
