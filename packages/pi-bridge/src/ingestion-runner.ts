/**
 * Ingestion runner — isolated subagent atomization sessions (capability
 * `lecturer-wiki`, Requirement: Ingestion Runs in Isolated Subagent Sessions;
 * design.md D7).
 *
 * Atomization is context-heavy and NEVER runs in the lecturer's conversation:
 * each raw document is processed by a dedicated, ephemeral agent session. The
 * runner bounds concurrency, bounds each turn IN TIME (Requirement: The
 * Atomization Turn Is Bounded in Time and Endable — a session that answers
 * nothing must not be able to wait forever), reports per-document progress,
 * enforces the shared validator as the gate before atoms count as landed, and
 * cleans up after aborts (the atoms the run created are removed; no file the run
 * found already there is).
 *
 * The session mechanics are injected via a factory so the orchestration logic
 * is deterministic and unit-testable; the production factory
 * (`createPiAtomizationSessionFactory`) drives a real pi `createAgentSession`.
 */
import path from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { validateFile } from "@cbe/corpus-schema";

/** Fixed upper bound for parallel atomization sessions — never unbounded fan-out. */
export const MAX_INGESTION_CONCURRENCY = 4;
export const DEFAULT_INGESTION_CONCURRENCY = 2;

/**
 * How long an atomization session may stay SILENT before its document is ended
 * as a failure (capability `lecturer-wiki`, Requirement: The Atomization Turn Is
 * Bounded in Time and Endable). Measured as time since the session's last
 * observed sign of life, never as total elapsed duration — a slow local model is
 * slow but not silent, while a model endpoint that is not running says nothing
 * at all, which is the failure this bounds. Before it existed, an ingest started
 * against a stopped inference server did not fail: it waited, the run never
 * ended, and the renderer's live-run guard then refused every further ingest
 * until the application was restarted.
 *
 * WHY 120 s. The longest silence a healthy run can legitimately contain is the
 * gap between the request leaving and the first stream event: on a cold local
 * server that spans loading the model weights plus prefilling the atomization
 * prompt (the whole wiki skill body) together with a full raw document — tens of
 * seconds on a slow machine, occasionally more. Two minutes clears that with
 * room. At the other end it is about as long as a lecturer will sit in front of
 * a spinner before concluding the application is broken, and they now get a
 * named error instead. 30 s would start failing cold local servers on the first
 * ingest of the day; 5 min buys a healthy run nothing and spends the lecturer's
 * patience.
 *
 * This is a JUDGEMENT, not a measurement: nothing here ties the value to
 * observed first-token latency across model sizes, and the tests assert that a
 * deadline fires, never that this is the right one. Whoever changes it states
 * their basis.
 */
export const ATOMIZATION_SILENCE_TIMEOUT_MS = 120_000;

export interface AtomizationDoc {
  /** Course-relative raw path, e.g. `raw/skript.md`. */
  rawRelPath: string;
}

/** Result of one atomization session run. `writtenWikiFiles` are the wiki files
 * the session created or modified (wiki-relative paths) — the production
 * factory collects them from the session's write/edit tool events. */
export interface AtomizationRunResult {
  summary: string;
  writtenWikiFiles: string[];
}

export interface AtomizationSession {
  run(taskPrompt: string): Promise<AtomizationRunResult>;
  abort(): Promise<void>;
  dispose(): void;
  /**
   * The wiki files written so far, independently of a successful `run`
   * (capability `lecturer-wiki`, Requirement: Ingestion Failure Containment).
   * A session that throws mid-run cannot deliver them through its return value,
   * and what it wrote must still reach the validation gate rather than sit on
   * disk unvalidated. OPTIONAL: a session that does not track them leaves the
   * run's behaviour unchanged.
   */
  writtenWikiFiles?(): string[];
  /**
   * Epoch-ms of the most recent event observed from this session — its last sign
   * of life (Requirement: The Atomization Turn Is Bounded in Time and Endable),
   * seeded when the session is constructed. The runner reads it to distinguish a
   * session that is working slowly from one that is not answering at all.
   *
   * OPTIONAL, and the consequence of omitting it is deliberate rather than a
   * special case: a session that reports no activity has, by that rule, no
   * observable sign of life, so the silence deadline applies to its WHOLE turn.
   * That is the safe direction — a session that cannot be observed is bounded,
   * not exempt.
   */
  lastActivityAt?(): number;
}

export type AtomizationSessionFactory = (doc: AtomizationDoc) => Promise<AtomizationSession>;

export type IngestionDocStatus = "running" | "done" | "failed" | "aborted";

export interface IngestionProgress {
  rawRelPath: string;
  status: IngestionDocStatus;
  error?: string;
}

export interface AtomizationOutcome {
  rawRelPath: string;
  status: Exclude<IngestionDocStatus, "running">;
  error?: string;
  /** Wiki-relative paths of atoms that passed the shared validator. */
  atoms: string[];
  /** Atoms the validator rejected — restored/removed before they count as landed. */
  rejected: Array<{ path: string; errors: string[] }>;
  /** Metadata the validator normalised away on landed atoms (e.g. an unusable
   * source url). The atom survives — but the loss is reported, never silent. */
  notices: string[];
  summary?: string;
}

export interface RunAtomizationOptions {
  courseDir: string;
  wikiDir: string;
  /** Parallel session bound; clamped to [1, MAX_INGESTION_CONCURRENCY]. */
  concurrency?: number;
  onProgress?: (progress: IngestionProgress) => void;
  /** Abort signal: kills only the ingestion sessions, never the lecturer session. */
  signal?: AbortSignal;
  /**
   * Silence deadline for one document's atomization turn, in ms. Defaults to
   * `ATOMIZATION_SILENCE_TIMEOUT_MS`; production never passes it. A test
   * overrides it to exercise the bound in milliseconds instead of minutes, and a
   * non-finite or non-positive value arms no deadline at all — that is the
   * PRE-CHANGE behaviour, kept reachable so the regression test can pin the hang
   * it fixes rather than describe it.
   */
  silenceTimeoutMs?: number;
}

/** The wiki index is maintained by the same run that creates atoms; it is not
 * itself an atom and is exempt from the atom validation gate. */
function isAtomFile(rel: string): boolean {
  const base = path.basename(rel);
  return base.endsWith(".md") && base !== "index.md" && !base.startsWith("_");
}

/**
 * Progress is a REPORT on the run, never an input to it (capability
 * `lecturer-wiki`, Requirement: Ingestion Failure Containment). The app's
 * consumer is `win.webContents.send`, which throws once the lecturer has closed
 * the window — a fact about the window, not about the document. Every emission
 * therefore goes through here, and a consumer exception is swallowed rather
 * than allowed to fail the document it reports on or end the run.
 */
function emitProgress(opts: RunAtomizationOptions, progress: IngestionProgress): void {
  try {
    // `onProgress` is declared `=> void`, which TypeScript lets a consumer
    // satisfy with an `async` function — so the channel can fail in two ways,
    // and a rejected promise would escape a bare try/catch as an unhandled
    // rejection (fatal under Node's default). Both are swallowed here, the same
    // shape `requestAbort` uses.
    void Promise.resolve(opts.onProgress?.(progress)).catch(() => {});
  } catch {
    /* a broken reporting channel must not change the result it reports */
  }
}

/**
 * VALIDATION GATE (lecturer-wiki, Requirement: Atomization Implementation via
 * Existing Wiki Skill, (b)): every produced atom must pass the shared validator
 * before it counts as landed; rejected atoms are rolled back.
 *
 * ONE implementation over a written-file set, called by BOTH the success path
 * and the mid-run-failure path (Requirement: Ingestion Failure Containment) —
 * two copies would drift, and it is the failure path that used to skip the gate
 * entirely and leave what a throwing session wrote on disk, unvalidated and
 * unreported.
 */
async function gateWrittenFiles(
  writtenWikiFiles: readonly string[],
  wikiDir: string
): Promise<Pick<AtomizationOutcome, "atoms" | "rejected" | "notices">> {
  const atoms: string[] = [];
  const rejected: AtomizationOutcome["rejected"] = [];
  const notices: string[] = [];
  for (const rel of writtenWikiFiles.filter(isAtomFile)) {
    const verdict = await validateFile(path.join(wikiDir, rel), "wiki");
    if (verdict.ok) {
      atoms.push(rel);
      // Metadata the schema normalised away rather than rejecting the atom
      // (Requirements: Atom Source Year Normalisation, Atom Source URL
      // Loss-Avoidance, Atom Related-Wikilink Spelling Normalisation). The atom
      // lands; the loss is still reported.
      notices.push(...verdict.notices.map((n) => `${rel} (${n})`));
    } else {
      rejected.push({ path: rel, errors: verdict.errors });
      await unlink(path.join(wikiDir, rel)).catch(() => {});
    }
  }
  return { atoms, rejected, notices };
}

/**
 * The wiki files that existed BEFORE this document's session started, as
 * wiki-relative paths. `null` means the snapshot could not be taken completely,
 * and the abort rollback then removes nothing at all: losing a rollback leaves
 * a stray atom the lecturer can delete, while a wrong rollback deletes material
 * that only the run itself could have produced.
 */
async function snapshotWikiFiles(wikiDir: string): Promise<ReadonlySet<string> | null> {
  const seen = new Set<string>();
  let complete = true;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // A wiki directory that does not exist yet pre-dates nothing — an empty
      // snapshot is the correct answer, not an incomplete one.
      if (!(prefix === "" && (err as NodeJS.ErrnoException)?.code === "ENOENT")) complete = false;
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else seen.add(rel);
    }
  };
  await walk(wikiDir, "");
  return complete ? seen : null;
}

/**
 * ABORT ROLLBACK (lecturer-wiki, Requirement: Ingestion Failure Containment):
 * an aborted document leaves behind no atom that only this run could have
 * produced.
 *
 * ONE implementation over a written-file set, called by BOTH abort sites — the
 * one that fires when `run` resolves despite the abort and the one on the catch
 * path — for the reason `gateWrittenFiles` is one implementation: two copies
 * drift, and here a drift deletes the lecturer's material.
 *
 * A rollback removes only what the run CREATED, and it never removes a
 * non-atom. The session's written set spans every write and edit under the wiki
 * directory, so it routinely contains `index.md` (the compile procedure
 * mandates updating it in the same run) and an atom the session MERGED into —
 * both pre-date the run, and `index.md` carries the entries of every atom from
 * every previous run. The `isAtomFile` filter is the floor under the
 * created-file test, not a substitute for it.
 *
 * The remainder is deliberate and is stated in the requirement rather than
 * fixed by deleting more: a merged-into atom keeps whatever the session
 * appended before the abort, an aborted first ingest leaves an `index.md`
 * listing atoms that were just rolled back, and an unavailable snapshot means
 * nothing is removed at all.
 */
async function rollbackCreatedFiles(
  writtenWikiFiles: readonly string[],
  wikiDir: string,
  preExisting: ReadonlySet<string> | null
): Promise<void> {
  if (!preExisting) return;
  for (const rel of writtenWikiFiles) {
    if (!isAtomFile(rel) || preExisting.has(rel)) continue;
    await unlink(path.join(wikiDir, rel)).catch(() => {});
  }
}

/** Asking a session to abort is bookkeeping, not a verdict: it runs inside an
 * AbortSignal listener, where an escaping error surfaces as an uncaught
 * exception in the host process (the app's Electron main process) instead of as
 * this document's failure — so neither a synchronous throw nor a non-thenable
 * return may leave here (Requirement: Ingestion Failure Containment). */
function requestAbort(session: AtomizationSession | null): void {
  try {
    void Promise.resolve(session?.abort()).catch(() => {});
  } catch {
    /* the document's outcome is decided by the run, never by its abort */
  }
}

/** What a session wrote before it threw — only a session that tracks it can
 * say, and the accessor itself must not be able to fail the containment. */
function writtenFilesOf(session: AtomizationSession | null): string[] {
  try {
    return session?.writtenWikiFiles?.() ?? [];
  } catch {
    return [];
  }
}

/** The session's last sign of life, or `null` when it reports none. Same posture
 * as `writtenFilesOf`: an accessor may not fail the containment. */
function lastActivityOf(session: AtomizationSession | null): number | null {
  try {
    const at = session?.lastActivityAt?.();
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** A watch that can be raced against work in flight, and is always disposed by
 * the code that armed it. `promise` never rejects — losing the race must cost
 * nothing. */
interface Watch {
  promise: Promise<void>;
  dispose(): void;
}

const NEVER: Watch = { promise: new Promise<void>(() => {}), dispose: () => {} };

/** Settles when `signal` aborts — including when it already has. The runner
 * races this so an abort STOPS THE WAIT rather than only asking the session to
 * stop: asking is a message to a session that may itself be blocked. */
function abortWatch(signal: AbortSignal | undefined): Watch {
  if (!signal) return NEVER;
  if (signal.aborted) return { promise: Promise.resolve(), dispose: () => {} };
  let off = (): void => {};
  const promise = new Promise<void>((resolve) => {
    const handler = (): void => resolve();
    signal.addEventListener("abort", handler, { once: true });
    off = () => signal.removeEventListener("abort", handler);
  });
  return { promise, dispose: () => off() };
}

/**
 * Settles once the session has been silent for `timeoutMs` (Requirement: The
 * Atomization Turn Is Bounded in Time and Endable). Polled rather than pushed:
 * the session's side of the contract stays one read-only accessor with no
 * subscription to tear down, and the poll interval is derived from the deadline
 * so a short test deadline stays responsive.
 *
 * A session that reports no activity is measured from the moment the watch was
 * armed, which makes the deadline a whole-turn cap for it — see
 * `AtomizationSession.lastActivityAt`.
 */
function silenceWatch(session: AtomizationSession, timeoutMs: number): Watch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return NEVER;
  const armedAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setInterval(
      () => {
        if (Date.now() - (lastActivityOf(session) ?? armedAt) >= timeoutMs) resolve();
      },
      Math.max(20, Math.min(1_000, Math.floor(timeoutMs / 4)))
    );
    // A stray watch must never hold the host process (or a test runner) open.
    timer.unref?.();
  });
  return { promise, dispose: () => clearInterval(timer) };
}

/** What a race reports when the runner stopped waiting for the work. */
const GAVE_UP = Symbol("gave-up");

/**
 * Awaits `work`, but stops waiting as soon as one of the `watches` settles.
 *
 * The abandoned promise is neither awaited nor dropped: `onAbandon` gets it for
 * cleanup, and a `catch` stays attached whatever the caller does with it — a
 * rejection arriving after the runner stopped caring is not the document's
 * business, while an unhandled rejection is fatal under Node's default.
 */
async function raceWatches<T>(
  work: Promise<T>,
  watches: readonly Watch[],
  onAbandon: (abandoned: Promise<T>) => void
): Promise<T | typeof GAVE_UP> {
  const outcome = await Promise.race<T | typeof GAVE_UP>([
    work,
    ...watches.map((w) => w.promise.then((): typeof GAVE_UP => GAVE_UP)),
  ]);
  if (outcome !== GAVE_UP) return outcome;
  work.catch(() => {});
  onAbandon(work);
  return GAVE_UP;
}

/** The error a document carries when the model endpoint never answered. Named
 * so the lecturer reads a cause rather than a generic failure. */
export function silenceTimeoutError(timeoutMs: number): string {
  return `no response from the model endpoint for ${Math.round(timeoutMs / 1000)}s — check that it is running`;
}

/**
 * Run atomization for a batch of raw documents in parallel, mutually isolated
 * subagent sessions (bounded). Per-document isolation: one document's failure
 * never aborts the others, and a failed or aborted document's raw file is left
 * for the host at `status: raw`, so the run can be retried.
 *
 * What happens to what the document wrote differs by verdict, and neither is a
 * blanket rollback:
 *  - FAILED: everything the session wrote goes through the validation gate —
 *    atoms the validator rejects are removed, atoms that pass are reported as
 *    landed, while the document itself stays failed.
 *  - ABORTED: the atoms this run CREATED are removed, so none is left
 *    half-written; files that already existed when the session started — the
 *    wiki index, an atom the session merged into — are never touched, and an
 *    unavailable pre-existing set means nothing is removed at all.
 *
 * The isolation is STRUCTURAL, not a property of today's error inventory
 * (Requirement: Ingestion Failure Containment): this function returns exactly
 * one outcome per document, in input order, and never rejects — whatever the
 * session, its abort, its teardown or the progress consumer does. It used to
 * hold only for the errors `runOne` caught, and a throwing `dispose()` took the
 * whole run down with it, discarding the siblings' outcomes and skipping queued
 * documents.
 *
 * It is also structural in TIME (Requirement: The Atomization Turn Is Bounded in
 * Time and Endable). Containment only ever engages once a document reaches a
 * verdict, and a call that neither returns nor throws reaches none: against a
 * model endpoint that accepts the connection and never answers, this function
 * used to stay pending forever, and firing the abort signal did not change that
 * — the runner asked the session to stop and went on awaiting it. Every wait
 * that can hang is now raced against the abort and against a silence deadline.
 */
export async function runAtomization(
  docs: readonly AtomizationDoc[],
  factory: AtomizationSessionFactory,
  opts: RunAtomizationOptions
): Promise<AtomizationOutcome[]> {
  const bound = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_INGESTION_CONCURRENCY, MAX_INGESTION_CONCURRENCY));
  const outcomes: AtomizationOutcome[] = new Array(docs.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= docs.length) return;
      const doc = docs[index]!;
      if (opts.signal?.aborted) {
        outcomes[index] = { rawRelPath: doc.rawRelPath, status: "aborted", atoms: [], rejected: [], notices: [] };
        emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "aborted" });
        continue;
      }
      try {
        outcomes[index] = await runOne(doc, factory, opts);
      } catch (err) {
        // `runOne` is written to be total; this is the backstop that keeps the
        // guarantee structural — an unforeseen escape costs its own document an
        // outcome, never the worker, the siblings or the run.
        const error = err instanceof Error ? err.message : String(err);
        outcomes[index] = { rawRelPath: doc.rawRelPath, status: "failed", error, atoms: [], rejected: [], notices: [] };
        emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "failed", error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(bound, docs.length) }, () => worker()));
  return outcomes;
}

async function runOne(
  doc: AtomizationDoc,
  factory: AtomizationSessionFactory,
  opts: RunAtomizationOptions
): Promise<AtomizationOutcome> {
  emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "running" });
  let session: AtomizationSession | null = null;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    requestAbort(session);
  };
  // Registered BEFORE the first await of this function: an abort dispatched
  // while the snapshot or the factory is in flight has no listener attached
  // otherwise, and the session then runs to completion after the lecturer
  // stopped it.
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  // Taken before the session exists, so "created by this run" is recorded
  // rather than guessed on the way out.
  const preExisting = await snapshotWikiFiles(opts.wikiDir);

  // Both awaits below can hang — `session.run` is the one that does when the
  // model endpoint never answers, and session construction is the other — so
  // both are raced against this watch. An abort must STOP THE WAIT, not merely
  // ask a session that may itself be blocked to stop (design.md D5).
  const abortStop = abortWatch(opts.signal);

  try {
    const created = await raceWatches(factory(doc), [abortStop], (abandoned) => {
      // Abandoning the wait must not abandon the resource: a session arriving
      // from a factory promise nobody is awaiting any more is still asked to
      // stop and disposed.
      void abandoned.then(
        (late) => {
          requestAbort(late);
          try {
            late.dispose();
          } catch {
            /* teardown is bookkeeping, never a verdict */
          }
        },
        () => {}
      );
    });
    if (created === GAVE_UP) {
      // Aborted while the session was still being constructed. Nothing was
      // written — the turn never started — so there is nothing to roll back.
      emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "aborted" });
      return { rawRelPath: doc.rawRelPath, status: "aborted", atoms: [], rejected: [], notices: [] };
    }
    session = created;
    if (aborted || opts.signal?.aborted) {
      // An abort that arrived before the session existed had nothing to reach;
      // the listener recorded it, and this is where it is delivered. The turn
      // is then NOT started at all — whether pi suppresses a prompt on an
      // already-aborted session is its business, and an atomization turn that
      // does run rewrites `index.md` and merges into existing atoms, which no
      // rollback undoes.
      requestAbort(session);
      await rollbackCreatedFiles(writtenFilesOf(session), opts.wikiDir, preExisting);
      emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "aborted" });
      return { rawRelPath: doc.rawRelPath, status: "aborted", atoms: [], rejected: [], notices: [] };
    }
    const taskPrompt =
      `Atomize the raw document \`${doc.rawRelPath}\` of this course into wiki atoms, ` +
      `following your compile procedure. Update wiki/index.md in this same run.`;
    // The atomization turn is bounded by SILENCE, not by total duration: a slow
    // local model keeps emitting, a stopped one emits nothing (design.md D1).
    const silenceTimeoutMs = opts.silenceTimeoutMs ?? ATOMIZATION_SILENCE_TIMEOUT_MS;
    const silenceStop = silenceWatch(session, silenceTimeoutMs);
    let result: AtomizationRunResult;
    try {
      const ran = await raceWatches(session.run(taskPrompt), [abortStop, silenceStop], () => requestAbort(session));
      if (ran === GAVE_UP) {
        // Whichever watch won, the way out is the same one every other mid-run
        // failure takes: throw, and let the catch below decide the outcome and
        // give what the session had written the treatment that outcome calls
        // for. `aborted` distinguishes the two exactly as it already does.
        throw new Error(aborted || opts.signal?.aborted ? "aborted" : silenceTimeoutError(silenceTimeoutMs));
      }
      result = ran;
    } finally {
      silenceStop.dispose();
    }

    if (aborted || opts.signal?.aborted) {
      // Aborted mid-run: the atoms this run created are removed, so none is
      // left half-written.
      await rollbackCreatedFiles(result.writtenWikiFiles, opts.wikiDir, preExisting);
      emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "aborted" });
      return { rawRelPath: doc.rawRelPath, status: "aborted", atoms: [], rejected: [], notices: [] };
    }

    const { atoms, rejected, notices } = await gateWrittenFiles(result.writtenWikiFiles, opts.wikiDir);

    if (rejected.length > 0) {
      // The raw file stays at `status: raw` on any rejection, so the run is
      // retryable without duplicate atoms.
      const error =
        `validator rejected ${rejected.length} atom(s): ` +
        rejected.map((r) => `${r.path} (${r.errors[0] ?? "invalid"})`).join("; ");
      emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "failed", error });
      return { rawRelPath: doc.rawRelPath, status: "failed", error, atoms, rejected, notices, summary: result.summary };
    }

    emitProgress(opts, { rawRelPath: doc.rawRelPath, status: "done" });
    return { rawRelPath: doc.rawRelPath, status: "done", atoms, rejected: [], notices, summary: result.summary };
  } catch (err) {
    const status: "failed" | "aborted" = aborted || opts.signal?.aborted ? "aborted" : "failed";
    const error = err instanceof Error ? err.message : String(err);

    // The session may have written atoms before it threw. They get the SAME
    // gate as a successful run (Requirement: Ingestion Failure Containment):
    // invalid ones are rolled back, valid ones are reported — nothing is left
    // on disk unvalidated and unreported. An aborted document keeps the
    // abort contract instead: the atoms this run created are removed.
    const written = writtenFilesOf(session);
    let gated: Pick<AtomizationOutcome, "atoms" | "rejected" | "notices"> = { atoms: [], rejected: [], notices: [] };
    if (status === "aborted") {
      await rollbackCreatedFiles(written, opts.wikiDir, preExisting);
    } else {
      gated = await gateWrittenFiles(written, opts.wikiDir).catch(() => gated);
    }

    emitProgress(opts, { rawRelPath: doc.rawRelPath, status, ...(status === "failed" ? { error } : {}) });
    return {
      rawRelPath: doc.rawRelPath,
      status,
      ...(status === "failed" ? { error } : {}),
      ...gated,
    };
  } finally {
    abortStop.dispose();
    opts.signal?.removeEventListener("abort", onAbort);
    // Teardown is bookkeeping, not a verdict on the document: a session that
    // throws while being disposed used to reject the whole run (`finally` sits
    // outside the `try` above), discarding every sibling outcome.
    try {
      session?.dispose();
    } catch {
      /* the document's outcome is already decided */
    }
  }
}
