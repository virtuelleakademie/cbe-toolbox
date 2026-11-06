/**
 * Application-level wiki-ingestion wiring (capability `lecturer-wiki`,
 * Requirement: Ingest Progress Outlives the Surface That Shows It).
 *
 * The renderer subscribes to `window.cbe.onWikiIngestProgress` EXACTLY ONCE —
 * here, at store-wiring level, not in a component effect — and drives the run
 * from this module rather than from the component that starts it. Both halves
 * exist for the same reason, and both are needed:
 *
 *  - The left panel does not render its body while collapsed (capability
 *    `desktop-app`, Requirement: Collapsible Left Panel), so the ingest surface
 *    is UNMOUNTED, not hidden. A component-scoped subscription dies with it, and
 *    the main process broadcasts progress without keeping a replay — every event
 *    emitted while collapsed would be lost for good, not merely hidden.
 *  - `ingestToWiki()` resolves long after the lecturer may have collapsed the
 *    panel. Awaited inside the component, that resolution lands in an unmounted
 *    component and React drops it: the closing notice and the cleared in-flight
 *    flag would never reach the record, however the rows were stored.
 *
 * Same shape and same rationale as `state/agentEvents.ts`, including the
 * idempotent subscription (StrictMode-safe by construction).
 */
import type { WikiIngestProgressEvent } from "../../shared/ipc-contract.js";
import { useCbe } from "./store.js";
import { chrome } from "../chrome.js";

let unsubscribe: (() => void) | null = null;

/**
 * Run tokens are minted HERE, before the call that produces the events they
 * stamp. The renderer therefore knows its own run's token before any event can
 * arrive — which binding it from the first event seen after a start would not:
 * that first event can legitimately belong to the run the lecturer just ended,
 * which is the very interleaving the token exists to catch.
 *
 * A token carries NO renderer-lifetime assumption, which a bare counter would:
 * a reload (or an HMR replacement of this module in dev) restarts the sequence
 * while a main-process run started before it is still stamping the old values,
 * and the collision would hand a dead run's rows straight through the guard. The
 * random per-load prefix is what removes that; the counter only keeps successive
 * tokens of one load distinct and readable.
 */
const ingestRunTokenPrefix =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let ingestRunSeq = 0;
function nextIngestRunToken(): string {
  ingestRunSeq += 1;
  return `wiki-ingest-${ingestRunTokenPrefix}-${ingestRunSeq}`;
}

/**
 * Subscribe the run record to the progress channel. Idempotent: a repeated call
 * replaces the previous subscription, so at most ONE live subscription exists.
 * Call once at renderer entry.
 */
export function wireWikiIngestEvents(): void {
  unsubscribe?.();
  unsubscribe = window.cbe.onWikiIngestProgress((evt: WikiIngestProgressEvent) => {
    useCbe.getState().applyWikiIngestProgress(evt);
  });
}

/** The run's closing notice. One home for the wording, next to the driver that
 * records it. */
export function ingestNotice(results: { ok: boolean }[]): string {
  const done = results.filter((r) => r.ok).length;
  return chrome().wikiIngestNotice({ done, failed: results.length - done });
}

/**
 * Start an ingestion and record its outcome — outside React, so neither a
 * collapse nor a course switch can discard the result. A completion with at
 * least one successful document advances the course's atom-list revision in the
 * same guarded store update that ends the run; the currently mounted browser
 * observes that application-level invalidation rather than a retained component
 * callback.
 *
 * The run's course id is taken from the store HERE and deliberately NOT accepted
 * from the caller. `ingestToWiki()` resolves the active course in the main
 * process and stamps every progress event of the run with it, so the record has
 * exactly one correct key and no surface may supply a different one. Reading is
 * the other half and binds differently: see `WikiIngest`.
 *
 * That id also travels WITH the call, as the caller's assertion about what it
 * just recorded (capability `lecturer-wiki`, Requirement: An Ingest Belongs to
 * the Course It Was Started In). The host resolves the active course itself and
 * refuses a mismatch, which is the only thing that covers the window between
 * this line and that resolution: a course switch inside it would otherwise file
 * this record under one course and the material under another. The refusal
 * arrives as a rejected call and ends the record with its cause, through the
 * ordinary failure path below.
 *
 * The run's TOKEN travels the other way — minted here, handed to
 * `ingestToWiki()`, stamped by the main process on every progress event of this
 * run. Run identity and course identity are different questions: the course says
 * WHICH RECORD an event belongs to, the token says WHICH RUN, and only the
 * second can tell a superseded run's late rows from the live one's.
 *
 * A start while that course's run is still live is refused HERE, as a total
 * no-op — not merely disabled in the UI. `startWikiIngestRun` re-seeds the
 * record with `docs: []`, so reaching it a second time would destroy a live
 * run's rows and then mark it finished while the ingest is still going, which
 * is exactly the state the collapsed rail reads to decide whether to keep
 * signalling. The control's own guard is the other layer; this one holds even
 * where no control is involved.
 */
export async function startWikiIngest(): Promise<void> {
  const store = useCbe.getState();
  const courseId = store.activeCourseId;
  if (store.wikiIngest[courseId]?.running) return;
  const token = nextIngestRunToken();
  store.startWikiIngestRun(courseId, token);
  // Which run this call is reporting on. The lecturer can end a run before its
  // promise resolves (`abortWikiIngest`), so this outcome may arrive after a
  // LATER run has started — the id is what stops it ending that one instead.
  const runId = useCbe.getState().wikiIngest[courseId]?.runId;
  try {
    const results = await window.cbe.ingestToWiki({ token, courseId });
    if (results === null) {
      // Dialog cancelled — a no-op run, and deliberately no notice.
      useCbe.getState().finishWikiIngestRun(courseId, null, runId);
      return;
    }
    useCbe.getState().finishWikiIngestRun(
      courseId,
      ingestNotice(results),
      runId,
      results.some((result) => result.ok)
    );
  } catch (err) {
    useCbe.getState().finishWikiIngestRun(courseId, err instanceof Error ? err.message : String(err), runId);
  }
}

/** The notice a run closes with when the abort actually reached it. */
export function ingestAbortedNotice(): string {
  return chrome().wikiIngestAbortedNotice;
}

/**
 * The notice a run closes with when the abort reached nothing. The main process
 * only holds something to signal during the atomization phase, so an abort
 * dispatched while the run is still pre-flighting the endpoint or extracting
 * into `inbox/` and `raw/` stops no work: that run goes on and will finish
 * writing. The record ends regardless — that is the recovery guarantee — but it
 * says what actually happened rather than claiming an abort that did not occur.
 */
export function ingestAbortUndeliveredNotice(): string {
  return chrome().wikiIngestAbortUndeliveredNotice;
}

/**
 * Abort a course's run and END ITS RECORD (capability `lecturer-wiki`,
 * Requirement: An Ingest That Cannot Reach the Model Fails Visibly and Stays
 * Retryable) — driven from here rather than from the panel, for the reason
 * `startWikiIngest` is: the panel is unmounted whenever the left panel is
 * collapsed, so a result awaited inside it is dropped.
 *
 * Ending the record is the point, not a side effect. The run's `running` flag is
 * what the start guard reads, and it is renderer memory: a run whose underlying
 * promise never resolves would otherwise keep the ingest facility refused until
 * the application was restarted, which is exactly the defect this change fixes.
 * The guard itself stays — it protects a live run's rows from a second click,
 * and this is the lecturer explicitly saying they want the run to end.
 *
 * The record is ended whether or not the main process accepted the abort: the
 * lecturer's instruction is what closes it, and a main-side refusal to start
 * again is reported by the next start attempt rather than silently kept here.
 *
 * The NOTICE is the part that must not overstate it. `abortWikiIngest()` reports
 * whether the abort was delivered to a running atomization at all, and the two
 * cases close with two different notices: a run still pre-flighting the endpoint
 * or extracting into `inbox/` and `raw/` holds nothing to signal, so it keeps
 * going and the lecturer is told so instead of being told it was aborted. A
 * failed call is treated as undelivered, which is the honest reading — nothing
 * confirmed that it arrived.
 */
export async function abortWikiIngest(courseId: string): Promise<void> {
  const run = useCbe.getState().wikiIngest[courseId];
  const runId = run?.runId;
  // The abort NAMES the run this record holds (capability `lecturer-wiki`,
  // Requirement: An Ingest Belongs to the Course It Was Started In). Runs in two
  // courses can be in flight together — the lecturer activates another course
  // and ingests there while this one finishes — so an unnamed abort would let
  // this control end that run instead. A record with no token has nothing live
  // to name, and the host reports the abort as undelivered.
  const token = run?.token ?? "";
  let delivered = false;
  try {
    delivered = (await window.cbe.abortWikiIngest(token)).delivered === true;
  } finally {
    useCbe
      .getState()
      .finishWikiIngestRun(courseId, delivered ? ingestAbortedNotice() : ingestAbortUndeliveredNotice(), runId);
  }
}
