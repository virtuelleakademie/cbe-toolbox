/**
 * Ingestion runner (capability `lecturer-wiki`, Requirement: Ingestion Runs in
 * Isolated Subagent Sessions) — orchestration half, driven by fake sessions.
 * The real pi-session factory lives in atomization-session.ts; the LLM-visible
 * behaviour is exercised by the skill eval.
 *
 * Scenario mapping:
 *  - "Multiple documents are ingested in parallel subagent sessions" →
 *    bounded-concurrency + per-document isolation tests.
 *  - "Failed run stays retryable" → failure outcome + rollback tests.
 *  - Validation gate (Requirement: Atomization Implementation via Existing
 *    Wiki Skill, (b)) → invalid atoms never land.
 *  - "An abort removes what the run created and nothing else" (Requirement:
 *    Ingestion Failure Containment) → only ingestion sessions die, and the
 *    rollback removes the run's own new atoms while a pre-existing file stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runAtomization,
  MAX_INGESTION_CONCURRENCY,
  type AtomizationDoc,
  type AtomizationSession,
  type AtomizationSessionFactory,
  type IngestionProgress,
} from "../src/ingestion-runner.js";

let courseDir: string;
let wikiDir: string;

beforeEach(async () => {
  courseDir = await mkdtemp(path.join(tmpdir(), "cbe-runner-"));
  wikiDir = path.join(courseDir, "wiki");
  await mkdir(wikiDir, { recursive: true });
});

afterEach(async () => {
  await rm(courseDir, { recursive: true, force: true });
});

const VALID_ATOM = `---
type: concept
aliases: []
sources:
  - title: "skript.pdf"
    ingested: "2026-07-07"
raw:
  - raw/skript.md
related: []
confidence: medium
updated: 2026-07-07
---

One topic, one atom.
`;

function docs(n: number): AtomizationDoc[] {
  return Array.from({ length: n }, (_v, i) => ({ rawRelPath: `raw/doc-${i}.md` }));
}

/** Fake session factory that writes given files and resolves after a tick. */
function fakeFactory(
  behave: (doc: AtomizationDoc) => Promise<{ files: Record<string, string>; summary?: string }>
): AtomizationSessionFactory {
  return async (doc): Promise<AtomizationSession> => ({
    async run() {
      const { files, summary } = await behave(doc);
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(wikiDir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
      }
      return { summary: summary ?? "did things", writtenWikiFiles: Object.keys(files) };
    },
    async abort() {},
    dispose() {},
  });
}

describe("multiple documents are ingested in parallel subagent sessions", () => {
  it("processes documents in parallel up to a fixed concurrency bound", async () => {
    let running = 0;
    let peak = 0;
    const factory = fakeFactory(async (doc) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      const stem = path.basename(doc.rawRelPath, ".md");
      return { files: { [`concept/${stem}.md`]: VALID_ATOM } };
    });
    const outcomes = await runAtomization(docs(5), factory, { courseDir, wikiDir, concurrency: 2 });
    expect(outcomes.every((o) => o.status === "done")).toBe(true);
    expect(peak).toBeGreaterThan(1); // genuinely parallel …
    expect(peak).toBeLessThanOrEqual(2); // … but bounded
  });

  it("the concurrency bound is hard-capped, never unbounded fan-out", async () => {
    let running = 0;
    let peak = 0;
    const factory = fakeFactory(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return { files: {} };
    });
    await runAtomization(docs(12), factory, { courseDir, wikiDir, concurrency: 99 });
    expect(peak).toBeLessThanOrEqual(MAX_INGESTION_CONCURRENCY);
  });

  it("one document's failure does not abort the others; each status is visible individually", async () => {
    const seen: IngestionProgress[] = [];
    const factory = fakeFactory(async (doc) => {
      if (doc.rawRelPath === "raw/doc-1.md") throw new Error("provider exploded");
      const stem = path.basename(doc.rawRelPath, ".md");
      return { files: { [`concept/${stem}.md`]: VALID_ATOM } };
    });
    const outcomes = await runAtomization(docs(3), factory, {
      courseDir,
      wikiDir,
      onProgress: (p) => seen.push(p),
    });
    expect(outcomes.map((o) => o.status)).toEqual(["done", "failed", "done"]);
    expect(outcomes[1]!.error).toContain("provider exploded");
    // Per-document progress: running + terminal status for every doc.
    for (const d of docs(3)) {
      expect(seen.some((p) => p.rawRelPath === d.rawRelPath && p.status === "running")).toBe(true);
    }
  });
});

describe("validation gate — atoms that would not pass the validator never land", () => {
  it("rejects an invalid atom (removed from the wiki) and fails the document", async () => {
    const factory = fakeFactory(async () => ({
      files: {
        "concept/invalid.md": "---\ntype: concept\n---\n\nMissing mandatory fields.\n",
      },
    }));
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("failed");
    expect(outcome!.error).toMatch(/validator rejected/);
    expect(outcome!.rejected.length).toBe(1);
    expect(existsSync(path.join(wikiDir, "concept/invalid.md"))).toBe(false);
  });

  it("accepts valid atoms and reports them; index.md is exempt from the atom gate", async () => {
    const factory = fakeFactory(async () => ({
      files: {
        "concept/cognitive-load.md": VALID_ATOM,
        "index.md": "# Wiki index\n\n## concept\n- [[concept/cognitive-load]]\n",
      },
      summary: "created 1 atom",
    }));
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("done");
    expect(outcome!.atoms).toEqual(["concept/cognitive-load.md"]);
    expect(outcome!.summary).toBe("created 1 atom");
    expect(await readFile(path.join(wikiDir, "index.md"), "utf8")).toContain("cognitive-load");
  });

  // lecturer-wiki, Requirement: Atom Source URL Loss-Avoidance — scenario
  // "A source url that is not a usable url counts as no url".
  it("keeps an atom whose source url is unusable and reports the dropped url", async () => {
    const factory = fakeFactory(async () => ({
      files: {
        "concept/git-amend.md": VALID_ATOM.replace('    ingested: "2026-07-07"\n', '    url: "n/a"\n'),
      },
    }));
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("done");
    expect(outcome!.atoms).toEqual(["concept/git-amend.md"]);
    expect(existsSync(path.join(wikiDir, "concept/git-amend.md"))).toBe(true);
    // The atom survives — but the loss is reported, not swallowed.
    expect(outcome!.notices.join("\n")).toMatch(/concept\/git-amend\.md .*sources\.0\.url/);
  });

  it("an atom carrying a corpus reference is rejected by the isolation invariant", async () => {
    const factory = fakeFactory(async () => ({
      files: {
        "concept/leaky.md": VALID_ATOM.replace("One topic, one atom.", "See (corpus:foundations-001 § X, Y 2020)."),
      },
    }));
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("failed");
    expect(outcome!.rejected[0]!.errors.join("\n")).toMatch(/isolation invariant/i);
  });
});

describe("failed run stays retryable / abort kills only the ingestion session", () => {
  it("abort marks queued documents as aborted and calls abort on running sessions", async () => {
    const controller = new AbortController();
    const abortSpy = vi.fn(async () => {});
    const factory: AtomizationSessionFactory = async () => ({
      async run() {
        controller.abort(); // abort arrives mid-run of the first doc
        await new Promise((r) => setTimeout(r, 10));
        return { summary: "", writtenWikiFiles: [] };
      },
      abort: abortSpy,
      dispose() {},
    });
    const outcomes = await runAtomization(docs(3), factory, {
      courseDir,
      wikiDir,
      concurrency: 1,
      signal: controller.signal,
    });
    expect(outcomes[0]!.status).toBe("aborted");
    expect(outcomes.slice(1).every((o) => o.status === "aborted")).toBe(true);
    expect(abortSpy).toHaveBeenCalled();
  });

  it("an aborted run removes the files it had written (never left half-written silently)", async () => {
    const controller = new AbortController();
    const factory: AtomizationSessionFactory = async () => ({
      async run() {
        const abs = path.join(wikiDir, "concept/half.md");
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, VALID_ATOM, "utf8");
        controller.abort();
        return { summary: "", writtenWikiFiles: ["concept/half.md"] };
      },
      async abort() {},
      dispose() {},
    });
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir, signal: controller.signal });
    expect(outcome!.status).toBe("aborted");
    expect(existsSync(path.join(wikiDir, "concept/half.md"))).toBe(false);
  });

  // Scenario: An abort before the turn starts never starts the turn.
  //
  // `runOne` awaits a snapshot of the wiki directory before the session exists,
  // and an abort dispatched in that window has no listener attached unless the
  // listener is registered first: `aborted` stays false and the session is
  // never asked to stop. Delivering the abort is only half of it — the turn
  // must also not be issued, because an atomization turn that runs rewrites
  // `index.md` and merges into existing atoms, and the created-only rollback
  // undoes neither.
  it("an abort that fires while the pre-session snapshot is in flight stops the session before its turn", async () => {
    const controller = new AbortController();
    const abortSpy = vi.fn(async () => {});
    const runSpy = vi.fn(async () => {
      const abs = path.join(wikiDir, "concept/should-not-exist.md");
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, VALID_ATOM, "utf8");
      return { summary: "", writtenWikiFiles: ["concept/should-not-exist.md"] };
    });
    const factory: AtomizationSessionFactory = async () => ({
      run: runSpy,
      abort: abortSpy,
      dispose() {},
    });
    const [outcome] = await runAtomization(docs(1), factory, {
      courseDir,
      wikiDir,
      concurrency: 1,
      signal: controller.signal,
      // The listener is registered synchronously after this callback returns,
      // so a microtask scheduled here lands inside the snapshot's first await.
      onProgress: (p) => {
        if (p.status === "running") queueMicrotask(() => controller.abort());
      },
    });
    expect(outcome!.status).toBe("aborted");
    expect(abortSpy).toHaveBeenCalled();
    // The turn is never issued, so nothing the compile procedure would have
    // touched is touched at all.
    expect(runSpy).not.toHaveBeenCalled();
    expect(existsSync(path.join(wikiDir, "concept/should-not-exist.md"))).toBe(false);
  });

  /**
   * Scenario: An abort removes what the run created and nothing else.
   *
   * The abort rollback removes what the RUN created, never what it found. The
   * session's written set spans every write and edit under the wiki directory,
   * so it routinely holds `wiki/index.md` — which the compile procedure requires
   * the run to update, and which carries the entries of every atom from every
   * previous run — and any atom the session merged into. Deleting either turns
   * an abort into a loss of the lecturer's material.
   */
  describe("the rollback removes only what the run created", () => {
    const INDEX_BEFORE = "# Wiki index\n\n## concept\n- [[concept/existing]]\n";

    async function seedWiki(): Promise<void> {
      await mkdir(path.join(wikiDir, "concept"), { recursive: true });
      await writeFile(path.join(wikiDir, "index.md"), INDEX_BEFORE, "utf8");
      await writeFile(path.join(wikiDir, "concept/existing.md"), VALID_ATOM, "utf8");
    }

    /** A session that rewrites the index, merges into a pre-existing atom and
     * creates a new one — then the lecturer aborts. */
    function abortingFactory(controller: AbortController, viaThrow: boolean): AtomizationSessionFactory {
      const written = ["index.md", "concept/existing.md", "concept/fresh.md"];
      return async () => ({
        async run() {
          await writeFile(path.join(wikiDir, "index.md"), `${INDEX_BEFORE}- [[concept/fresh]]\n`, "utf8");
          await writeFile(path.join(wikiDir, "concept/existing.md"), `${VALID_ATOM}\n## From skript.pdf\n`, "utf8");
          await writeFile(path.join(wikiDir, "concept/fresh.md"), VALID_ATOM, "utf8");
          controller.abort();
          if (viaThrow) throw new Error("session torn down by abort");
          return { summary: "", writtenWikiFiles: written };
        },
        writtenWikiFiles: () => written,
        async abort() {},
        dispose() {},
      });
    }

    // Both abort sites go through ONE cleanup helper, so they are asserted with
    // one body: `run` resolving despite the abort, and `run` rejecting on it.
    for (const viaThrow of [false, true]) {
      const label = viaThrow ? "the session rejects on the abort" : "the session resolves despite the abort";

      it(`keeps the wiki index and a merged-into atom, removes the new one — ${label}`, async () => {
        await seedWiki();
        const controller = new AbortController();
        const [outcome] = await runAtomization(docs(1), abortingFactory(controller, viaThrow), {
          courseDir,
          wikiDir,
          signal: controller.signal,
        });
        expect(outcome!.status).toBe("aborted");
        // The index is not an atom and pre-dates the run — it survives, with
        // every entry from previous runs it carried.
        expect(existsSync(path.join(wikiDir, "index.md"))).toBe(true);
        expect(await readFile(path.join(wikiDir, "index.md"), "utf8")).toContain("[[concept/existing]]");
        // The merge target existed before the session started — never unlinked.
        expect(existsSync(path.join(wikiDir, "concept/existing.md"))).toBe(true);
        // The atom this run created is rolled back.
        expect(existsSync(path.join(wikiDir, "concept/fresh.md"))).toBe(false);
      });
    }
  });
});

/**
 * Requirement: Ingestion Failure Containment (capability `lecturer-wiki`).
 *
 * The isolation the runner already promised held only for the errors `runOne`
 * caught. These cases are the ones that escaped it — each was reproduced
 * against the pre-change runner, where the first two made `runAtomization`
 * itself reject and the third left a written atom on disk unvalidated.
 */
describe("ingestion failure containment", () => {
  // Scenario: A failure in one document's session teardown does not end the run
  it("a session that throws while being disposed costs its own document, not the run", async () => {
    const seen: IngestionProgress[] = [];
    const factory: AtomizationSessionFactory = async (doc) => ({
      async run() {
        const rel = `concept/${path.basename(doc.rawRelPath, ".md")}.md`;
        const abs = path.join(wikiDir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, VALID_ATOM, "utf8");
        return { summary: "did things", writtenWikiFiles: [rel] };
      },
      async abort() {},
      dispose() {
        if (doc.rawRelPath === "raw/doc-1.md") throw new Error("session teardown exploded");
      },
    });
    const outcomes = await runAtomization(docs(3), factory, {
      courseDir,
      wikiDir,
      concurrency: 1,
      onProgress: (p) => seen.push(p),
    });
    // One outcome per document, in input order, and no document skipped.
    expect(outcomes.map((o) => o.rawRelPath)).toEqual(["raw/doc-0.md", "raw/doc-1.md", "raw/doc-2.md"]);
    expect(outcomes.every((o) => o.status !== "running")).toBe(true);
    expect(outcomes[0]!.status).toBe("done");
    expect(outcomes[2]!.status).toBe("done");
    // The teardown is bookkeeping — it does not overturn the document's verdict.
    expect(outcomes[1]!.status).toBe("done");
    for (const d of docs(3)) {
      expect(seen.some((p) => p.rawRelPath === d.rawRelPath && p.status !== "running")).toBe(true);
    }
  });

  // Scenario: A failure in one document's session teardown does not end the run
  // (the progress consumer half — in the app it is `win.webContents.send`,
  // which throws once the lecturer has closed the window).
  it("a progress consumer that always throws changes neither a document nor the run", async () => {
    const factory = fakeFactory(async (doc) => {
      const stem = path.basename(doc.rawRelPath, ".md");
      return { files: { [`concept/${stem}.md`]: VALID_ATOM } };
    });
    const outcomes = await runAtomization(docs(3), factory, {
      courseDir,
      wikiDir,
      concurrency: 1,
      onProgress: () => {
        throw new Error("Object has been destroyed");
      },
    });
    expect(outcomes.map((o) => o.status)).toEqual(["done", "done", "done"]);
    expect(outcomes.map((o) => o.atoms.flat())).toEqual([
      ["concept/doc-0.md"],
      ["concept/doc-1.md"],
      ["concept/doc-2.md"],
    ]);
  });

  // Scenario: A failure in one document's session teardown does not end the run
  // (the abort half — `abort()` is called from an AbortSignal listener, where an
  // escaping error is reported as an uncaught exception in the host process
  // rather than as this document's failure).
  it("a session whose abort() misbehaves does not escape as an uncaught host exception", async () => {
    const broken: Array<[string, () => Promise<void>]> = [
      [
        "throws synchronously",
        (() => {
          throw new Error("session abort exploded");
        }) as () => Promise<void>,
      ],
      ["returns a non-thenable", (() => undefined) as unknown as () => Promise<void>],
    ];
    for (const [label, abort] of broken) {
      const uncaught: unknown[] = [];
      const capture = (err: unknown): void => void uncaught.push(err);
      process.on("uncaughtException", capture);
      try {
        const controller = new AbortController();
        const factory: AtomizationSessionFactory = async () => ({
          async run() {
            controller.abort(); // abort arrives mid-run of the first document
            await new Promise((r) => setTimeout(r, 10));
            return { summary: "", writtenWikiFiles: [] };
          },
          abort,
          dispose() {},
        });
        const outcomes = await runAtomization(docs(2), factory, {
          courseDir,
          wikiDir,
          concurrency: 1,
          signal: controller.signal,
        });
        expect(
          outcomes.map((o) => o.status),
          label
        ).toEqual(["aborted", "aborted"]);
        await new Promise((r) => setTimeout(r, 10)); // an escape would land here
        expect(uncaught, label).toEqual([]);
      } finally {
        process.off("uncaughtException", capture);
      }
    }
  });

  // Same scenario, the other call shape: `onProgress` is declared `=> void`,
  // which TypeScript lets a consumer satisfy with an `async` function — a
  // rejection then escapes a bare try/catch rather than being caught.
  it("a progress consumer whose promise rejects changes neither a document nor the run", async () => {
    const uncaught: unknown[] = [];
    const capture = (err: unknown): void => void uncaught.push(err);
    const rejection = (err: unknown): void => void uncaught.push(err);
    process.on("uncaughtException", capture);
    process.on("unhandledRejection", rejection);
    try {
      const factory = fakeFactory(async (doc) => {
        const stem = path.basename(doc.rawRelPath, ".md");
        return { files: { [`concept/${stem}.md`]: VALID_ATOM } };
      });
      const outcomes = await runAtomization(docs(3), factory, {
        courseDir,
        wikiDir,
        concurrency: 1,
        onProgress: (async () => {
          throw new Error("Object has been destroyed");
        }) as unknown as (p: IngestionProgress) => void,
      });
      expect(outcomes.map((o) => o.status)).toEqual(["done", "done", "done"]);
      await new Promise((r) => setTimeout(r, 10)); // an escape would land here
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", capture);
      process.off("unhandledRejection", rejection);
    }
  });

  it("a factory that throws for one document leaves the queue running", async () => {
    const factory: AtomizationSessionFactory = async (doc) => {
      if (doc.rawRelPath === "raw/doc-0.md") throw new Error("no provider credentials");
      return {
        async run() {
          return { summary: "", writtenWikiFiles: [] };
        },
        async abort() {},
        dispose() {},
      };
    };
    const outcomes = await runAtomization(docs(3), factory, { courseDir, wikiDir, concurrency: 1 });
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "done", "done"]);
    expect(outcomes[0]!.error).toContain("no provider credentials");
  });

  // Scenario: A session that throws mid-run has what it wrote gated, not orphaned
  it("gates what a throwing session had already written instead of orphaning it", async () => {
    const written = new Set<string>();
    const factory: AtomizationSessionFactory = async () => ({
      async run() {
        for (const [rel, content] of [
          ["concept/good.md", VALID_ATOM],
          ["concept/bad.md", "---\ntype: concept\n---\n\nMissing mandatory fields.\n"],
          ["concept/dropped-url.md", VALID_ATOM.replace('    ingested: "2026-07-07"\n', '    url: "n/a"\n')],
        ] as const) {
          const abs = path.join(wikiDir, rel);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf8");
          written.add(rel);
        }
        throw new Error("provider exploded after writing");
      },
      writtenWikiFiles: () => [...written],
      async abort() {},
      dispose() {},
    });
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("failed");
    expect(outcome!.error).toContain("provider exploded");
    // Invalid: rolled back. Valid: reported as landed rather than vanishing.
    expect(existsSync(path.join(wikiDir, "concept/bad.md"))).toBe(false);
    expect(outcome!.rejected.map((r) => r.path)).toEqual(["concept/bad.md"]);
    expect(outcome!.atoms.sort()).toEqual(["concept/dropped-url.md", "concept/good.md"]);
    expect(existsSync(path.join(wikiDir, "concept/good.md"))).toBe(true);
    // The validator's notices ride along, same as on the success path.
    expect(outcome!.notices.join("\n")).toMatch(/concept\/dropped-url\.md .*sources\.0\.url/);
  });

  it("a session that tracks no written files keeps the pre-change failure behaviour", async () => {
    const factory: AtomizationSessionFactory = async () => ({
      async run() {
        const abs = path.join(wikiDir, "concept/untracked.md");
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, VALID_ATOM, "utf8");
        throw new Error("provider exploded");
      },
      async abort() {},
      dispose() {},
    });
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir });
    expect(outcome!.status).toBe("failed");
    expect(outcome!.atoms).toEqual([]);
    expect(outcome!.rejected).toEqual([]);
  });

  // Scenario: A contained failure stays a failure
  it("a contained failure is still a failure — the host's raw transition never fires", async () => {
    const factory = fakeFactory(async (doc) => {
      if (doc.rawRelPath === "raw/doc-1.md") throw new Error("provider exploded");
      const stem = path.basename(doc.rawRelPath, ".md");
      return { files: { [`concept/${stem}.md`]: VALID_ATOM } };
    });
    const outcomes = await runAtomization(docs(3), factory, { courseDir, wikiDir, concurrency: 1 });
    const failed = outcomes[1]!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("provider exploded");
    // `ipc.ts` flips raw → compiled only on `status === "done"`, so a failed
    // document keeps `status: raw` and stays retryable.
    expect(outcomes.filter((o) => o.status === "done").map((o) => o.rawRelPath)).toEqual([
      "raw/doc-0.md",
      "raw/doc-2.md",
    ]);
  });
});

/**
 * The atomization turn is bounded in time and endable (Requirement: The
 * Atomization Turn Is Bounded in Time and Endable).
 *
 * A session that neither returns nor throws reaches no verdict, so the
 * containment above never engages: the run stayed pending forever, and firing
 * the abort signal did not change that — the runner asked the session to stop
 * and went on awaiting it. The end-to-end reproduction against a real endpoint
 * that never answers is in `ingest-unreachable-endpoint.test.ts`; these cases
 * pin the orchestration with fake sessions.
 */
describe("the atomization turn is bounded in time and endable", () => {
  /** A session that never answers. Optionally reports a sign of life on a beat. */
  function silentFactory(opts: {
    heartbeatMs?: number;
    onAbort?: () => void;
    only?: string;
  }): AtomizationSessionFactory {
    return async (doc): Promise<AtomizationSession> => {
      if (opts.only && doc.rawRelPath !== opts.only) {
        return {
          async run() {
            const stem = path.basename(doc.rawRelPath, ".md");
            const rel = `concept/${stem}.md`;
            await mkdir(path.join(wikiDir, "concept"), { recursive: true });
            await writeFile(path.join(wikiDir, rel), VALID_ATOM, "utf8");
            return { summary: "did things", writtenWikiFiles: [rel] };
          },
          async abort() {},
          dispose() {},
        };
      }
      let beat: ReturnType<typeof setInterval> | undefined;
      let lastActivity = Date.now();
      if (opts.heartbeatMs !== undefined) {
        beat = setInterval(() => {
          lastActivity = Date.now();
        }, opts.heartbeatMs);
        beat.unref?.();
      }
      return {
        run: () => new Promise(() => {}),
        async abort() {
          opts.onAbort?.();
        },
        dispose() {
          clearInterval(beat);
        },
        ...(opts.heartbeatMs === undefined ? {} : { lastActivityAt: () => lastActivity }),
      };
    };
  }

  // Scenario: A session that never answers ends as a failed document
  it("ends a session that never answers as a failed document, while its siblings complete", async () => {
    const statuses: IngestionProgress[] = [];
    const outcomes = await runAtomization(docs(3), silentFactory({ only: "raw/doc-1.md" }), {
      courseDir,
      wikiDir,
      silenceTimeoutMs: 150,
      onProgress: (p) => statuses.push(p),
    });
    expect(outcomes.map((o) => o.status)).toEqual(["done", "failed", "done"]);
    expect(outcomes[1]!.error).toMatch(/no response from the model endpoint/i);
    // Contained exactly as any other per-document failure: the siblings ran,
    // and `ipc.ts` flips raw → compiled only on `done`, so doc-1 stays retryable.
    expect(statuses.filter((s) => s.status === "done").map((s) => s.rawRelPath)).toEqual([
      "raw/doc-0.md",
      "raw/doc-2.md",
    ]);
  });

  // Scenario: A slow but answering session is not cut off
  it("never cuts off a session that keeps reporting activity, however long it runs", async () => {
    // Answers after 5x the deadline, but is never silent for a whole deadline.
    const factory: AtomizationSessionFactory = async (): Promise<AtomizationSession> => {
      let lastActivity = Date.now();
      const beat = setInterval(() => {
        lastActivity = Date.now();
      }, 20);
      beat.unref?.();
      return {
        async run() {
          await new Promise((r) => setTimeout(r, 500));
          const rel = "concept/slow.md";
          await mkdir(path.join(wikiDir, "concept"), { recursive: true });
          await writeFile(path.join(wikiDir, rel), VALID_ATOM, "utf8");
          return { summary: "slow but alive", writtenWikiFiles: [rel] };
        },
        async abort() {},
        dispose() {
          clearInterval(beat);
        },
        lastActivityAt: () => lastActivity,
      };
    };
    const [outcome] = await runAtomization(docs(1), factory, { courseDir, wikiDir, silenceTimeoutMs: 100 });
    expect(outcome!.status).toBe("done");
    expect(outcome!.atoms).toEqual(["concept/slow.md"]);
  });

  // Scenario: An abort ends a document whose session never answered
  it("stops waiting on a silent session the moment the lecturer aborts", async () => {
    let asked = false;
    const ctrl = new AbortController();
    // A heartbeat keeps the silence deadline from firing, so only the abort can
    // end this run — which is exactly what used to be impossible.
    const run = runAtomization(docs(1), silentFactory({ heartbeatMs: 10, onAbort: () => (asked = true) }), {
      courseDir,
      wikiDir,
      signal: ctrl.signal,
      silenceTimeoutMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    const outcomes = await run;
    expect(outcomes[0]!.status).toBe("aborted");
    expect(asked).toBe(true);
  });

  // Scenario: An abort ends a document whose session was never created
  it("ends a document whose session construction never completes, and still disposes a late session", async () => {
    let asked = false;
    let disposed = false;
    let deliver: (() => void) | null = null;
    const factory: AtomizationSessionFactory = () =>
      new Promise<AtomizationSession>((resolve) => {
        deliver = () =>
          resolve({
            run: () => new Promise(() => {}),
            async abort() {
              asked = true;
            },
            dispose() {
              disposed = true;
            },
          });
      });
    const ctrl = new AbortController();
    const run = runAtomization(docs(1), factory, { courseDir, wikiDir, signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 30));
    ctrl.abort();
    const outcomes = await run;
    expect(outcomes[0]!.status).toBe("aborted");
    // The session arrives after the runner stopped waiting for it — abandoning
    // the wait must not abandon the resource.
    deliver!();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toBe(true);
    expect(disposed).toBe(true);
  });
});
