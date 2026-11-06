/**
 * The reported failure, end to end (capability `lecturer-wiki`, Requirement: The
 * Atomization Turn Is Bounded in Time and Endable).
 *
 * A lecturer started a wiki ingest with their inference server not running. It
 * did not fail — it WAITED. No error was raised, so nothing in the runner's
 * containment engaged, the run never ended, and the renderer's live-run guard
 * then refused every further ingest until the application was restarted.
 *
 * This file pins both halves against the REAL production session factory, over
 * a TCP endpoint that accepts the connection and never answers — which is what
 * a stopped or wedged local inference server looks like from the client side,
 * and the one shape that produces neither a rejection nor a result:
 *
 *  - the defect: with no deadline armed, the run neither resolves nor rejects
 *  - the fix: with a deadline armed, the document ends as `failed` and names it
 *
 * The unbounded half is deliberately reachable (`silenceTimeoutMs: 0` arms no
 * deadline, see `RunAtomizationOptions`) so the regression is PINNED rather than
 * described in a comment. Deleting the bound makes the second case fail.
 *
 * No model is ever contacted: the endpoint answers nothing, which is the point.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import net from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { runAtomization } from "../src/ingestion-runner.js";
import { createPiAtomizationSessionFactory } from "../src/atomization-session.js";

/** Accepts every connection and answers nothing, ever. */
let blackHole: net.Server;
let held: net.Socket[] = [];
let port: number;
let courseDir: string;

beforeAll(async () => {
  blackHole = net.createServer((socket) => {
    // Held open and never written to.
    held.push(socket);
  });
  await new Promise<void>((resolve) => blackHole.listen(0, "127.0.0.1", resolve));
  port = (blackHole.address() as net.AddressInfo).port;
});

afterAll(async () => {
  // The held-open sockets are the whole point of the fixture, so `close()` alone
  // would wait for them forever — exactly the shape under test.
  for (const socket of held) socket.destroy();
  held = [];
  await new Promise<void>((resolve) => blackHole.close(() => resolve()));
});

beforeEach(async () => {
  courseDir = await mkdtemp(path.join(tmpdir(), "cbe-unreachable-"));
  await mkdir(path.join(courseDir, "wiki"), { recursive: true });
  await mkdir(path.join(courseDir, "raw"), { recursive: true });
  await mkdir(path.join(courseDir, "skill"), { recursive: true });
  await writeFile(path.join(courseDir, "skill", "SKILL.md"), "---\nname: wiki\nversion: 1.0.0\n---\n\nAtomize.\n");
  await writeFile(path.join(courseDir, "raw", "skript.md"), "# Skript\n");
});

afterEach(async () => {
  await rm(courseDir, { recursive: true, force: true });
});

function ingest(silenceTimeoutMs: number) {
  const wikiDir = path.join(courseDir, "wiki");
  const factory = createPiAtomizationSessionFactory({
    courseDir,
    wikiDir,
    wikiSkillDir: path.join(courseDir, "skill"),
    agentDir: path.join(courseDir, "pi-agent"),
    provider: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "unused", modelId: "unused" },
  });
  return runAtomization([{ rawRelPath: "raw/skript.md" }], factory, { courseDir, wikiDir, silenceTimeoutMs });
}

describe("an ingest against an endpoint that never answers", () => {
  it("reproduces the defect: with no deadline armed the run never settles", async () => {
    let settled = false;
    // `silenceTimeoutMs: 0` arms no deadline — the pre-change code path exactly.
    void ingest(0).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(settled).toBe(false);
  }, 20_000);

  it("ends the document as a failure naming the deadline, instead of waiting", async () => {
    const outcomes = await ingest(1_500);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe("failed");
    expect(outcomes[0]?.error).toMatch(/no response from the model endpoint/i);
    expect(outcomes[0]?.atoms).toEqual([]);
  }, 30_000);
});
