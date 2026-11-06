/**
 * Host-side canvas artefact mirror (capability `agent-harness`, Requirement:
 * Host-Side Canvas Artefact Mirror).
 *
 * The harness keeps its OWN record of the current canvas artefact state — fed by
 * every valid `cbe_canvas` call (a set upserts, a clear removes) and by UI-initiated
 * deletions from the canvas delete control. Two harness features consume it on the
 * host side (the session-start canvas prior of `add-new-session-keep-canvas` and the
 * compaction companion of `add-compaction-companion`) and neither may reach into the
 * renderer's store — the renderer is a display projection only.
 *
 * Final 4.2.1: the canvas is organized along the TEN design steps. Every mirror entry
 * carries its artefact's **resolved step group** (obtained from the SAME shared
 * addressing rule the renderer uses — `resolveCanvasAddress`) alongside the resolved
 * journey `phase` (where present), `id`, `label`, `value`, and `state`, so consumers
 * see step-addressed artefacts without re-deriving the mapping.
 *
 * The mirror also carries the pending UI-deletion notices: a confirmed UI deletion
 * removes the artefact's entry AND records a notice line so the NEXT lecturer turn's
 * payload can disclose the deletion to the model (display/payload split per the
 * ingested-doc-chips precedent). Skill-emitted clears need no notice — the model
 * already knows about its own calls.
 *
 * The mirror holds ONLY skill-pushed artefacts; renderer seed rows are never mirrored.
 * Removing an entry has NO effect on the conversation transcript or the session
 * sidecars — a clear is a canvas/mirror operation only.
 */
import {
  canvasEntryKey,
  isJourneyPhase,
  isValidStep,
  type JourneyPhase,
  type ResolvedCanvasAddress,
} from "./canvas-addressing.js";

/** The journey `phase` a step-6 artefact carries. Widened from the old three-phase
 * enum to include `reflect` (the fourth Step-6 journey element). */
export type CanvasPhase = JourneyPhase;
export type CanvasState = "done" | "active" | "draft" | "open";

/** One mirrored artefact entry. Carries the resolved step group plus, for a Step-6
 * journey artefact, the resolved journey `phase`. */
export interface CanvasArtefactEntry {
  step: number;
  phase?: CanvasPhase;
  id: string;
  label?: string;
  value: string;
  state: CanvasState;
}

export const CANVAS_STATES: readonly CanvasState[] = ["done", "active", "draft", "open"];

/**
 * Structural guard for ONE mirrored artefact entry, applied wherever a whole entry
 * list enters the mirror from outside — a New Session carry-over and a course record
 * read back from disk (capability `agent-harness`, Requirement: Course Design-State
 * Store). An entry that fails it is discarded rather than stored: every other writer
 * into this state filters malformed entries out, and an entry without a string
 * `value` would reach the renderer, which reads `value.trim()` unconditionally.
 */
export function isCanvasArtefactEntry(v: unknown): v is CanvasArtefactEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  if (!isValidStep(e.step)) return false;
  if (e.phase !== undefined && !isJourneyPhase(e.phase)) return false;
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  if (e.label !== undefined && typeof e.label !== "string") return false;
  if (typeof e.value !== "string") return false;
  if (!(CANVAS_STATES as readonly string[]).includes(e.state as string)) return false;
  return true;
}

/** A recorded UI deletion, disclosed to the agent on the next lecturer turn. */
export interface PendingDeletionNotice {
  step: number;
  phase?: CanvasPhase;
  id: string;
  label?: string;
}

/** The structured `details` a valid `cbe_canvas` execute() returns. Carries the
 * RESOLVED step group (and resolved journey `phase` where present) so every consumer
 * — the mirror and the renderer — reads one coherent address. */
export interface CanvasUpdateDetails {
  kind: "canvas-update";
  action: "set" | "clear";
  step: number;
  phase?: CanvasPhase;
  id: string;
  label?: string;
  value?: string;
  state?: CanvasState;
}

/**
 * One machine-readable deletion notice line. Names the resolved step group, the
 * journey `phase` (where present), `id`, and the label so the model can map it to its
 * own picture of the canvas. Deliberately structural, not lecturer-facing — it is
 * prefixed to the model payload, never rendered.
 */
export function canvasDeletionNoticeLine(n: PendingDeletionNotice): string {
  const label = n.label && n.label.trim().length > 0 ? n.label : n.id;
  const where = n.phase ? `step: ${n.step}, phase: ${n.phase}, id: ${n.id}` : `step: ${n.step}, id: ${n.id}`;
  return (
    `[canvas-deletion] The lecturer deleted the Canvas artefact "${label}" ` +
    `(${where}) directly in the canvas UI. It is already removed from the canvas — ` +
    `do NOT emit a cbe_canvas clear for it, and treat it as no longer on the canvas from here on.`
  );
}

/**
 * Prefix the pending UI-deletion notices to the next lecturer turn's payload — one
 * line per deleted artefact, ahead of the lecturer's own text. Empty queue → text
 * unchanged. The composed text is what reaches the model AND the persisted transcript
 * (lossless); the renderer displays only the lecturer's own turn.
 */
export function composePayloadWithDeletionNotices(notices: readonly PendingDeletionNotice[], text: string): string {
  if (notices.length === 0) return text;
  return `${notices.map(canvasDeletionNoticeLine).join("\n")}\n\n${text}`;
}

/**
 * One settled canvas change, reported to an observer (capability `agent-harness`,
 * Requirement: Host-Side Design-Substance and Revision Signal). `kind` is the
 * settled-design-change kind the revision counter consumes; a `set` that did NOT
 * change the stored entry, and a `clear` that removed nothing, are never reported
 * — idempotence is decided HERE, where the previous entry is known.
 */
export interface CanvasMirrorChange {
  kind: "canvas-set" | "canvas-clear" | "canvas-deletion";
  step: number;
  id: string;
  label?: string;
}

export type CanvasMirrorObserver = (change: CanvasMirrorChange) => void;

/** True when two mirror entries are indistinguishable — the idempotence test for
 * a re-pushed artefact (a re-mirror, or a set replaying an injected canvas prior). */
function sameEntry(a: CanvasArtefactEntry | undefined, b: CanvasArtefactEntry): boolean {
  if (!a) return false;
  return (
    a.step === b.step &&
    a.phase === b.phase &&
    a.id === b.id &&
    a.label === b.label &&
    a.value === b.value &&
    a.state === b.state
  );
}

export class CanvasMirror {
  private readonly entries = new Map<string, CanvasArtefactEntry>();
  private readonly pendingDeletions: PendingDeletionNotice[] = [];
  private observer: CanvasMirrorObserver | null = null;
  /** Suppresses change reporting while a whole entry list is RESTORED from
   * outside (a course record, a carry-over seed). A restore is not a settled
   * design change — it is the session learning what the course already held, and
   * counting it would start every course open several revisions deep. */
  private restoring = false;

  /** Register the settled-change observer (the session's `DesignSignal`). One
   * observer; a second call replaces it. */
  observe(fn: CanvasMirrorObserver | null): void {
    this.observer = fn;
  }

  private report(change: CanvasMirrorChange): void {
    if (this.restoring) return;
    this.observer?.(change);
  }

  private static keyOf(entry: CanvasArtefactEntry): string {
    const addr: ResolvedCanvasAddress = entry.phase ? { step: entry.step, phase: entry.phase } : { step: entry.step };
    return canvasEntryKey(addr, entry.id);
  }

  /**
   * Would applying this entry actually CHANGE the mirror? The mirror's own
   * idempotence notion, exposed for a caller that must decide BEFORE the write —
   * `applySet` answers the same question internally, but only once the stored entry
   * has already been overwritten.
   *
   * `sameEntry` stays the single comparison implementation in the codebase: a second
   * notion of "changed" would let a change-triggered consumer and the settled-change
   * observer disagree about what a re-push is.
   */
  wouldChange(entry: CanvasArtefactEntry): boolean {
    return !sameEntry(this.entries.get(CanvasMirror.keyOf(entry)), entry);
  }

  /** Upsert an artefact entry (a valid `cbe_canvas` set). Replaces any prior entry
   * for the same resolved address + id. Reports a settled change only when the
   * resulting entry actually DIFFERS from the stored one. */
  applySet(entry: CanvasArtefactEntry): void {
    const key = CanvasMirror.keyOf(entry);
    const previous = this.entries.get(key);
    this.entries.set(key, { ...entry });
    if (sameEntry(previous, entry)) return;
    this.report({
      kind: "canvas-set",
      step: entry.step,
      id: entry.id,
      ...(entry.label ? { label: entry.label } : {}),
    });
  }

  /** Remove an artefact entry (a valid `cbe_canvas` clear). No-op if absent — and
   * a clear that removed nothing is not a settled change. */
  applyClear(addr: ResolvedCanvasAddress, id: string): void {
    const key = canvasEntryKey(addr, id);
    const previous = this.entries.get(key);
    if (!this.entries.delete(key)) return;
    this.report({
      kind: "canvas-clear",
      step: addr.step,
      id,
      ...(previous?.label ? { label: previous.label } : {}),
    });
  }

  /**
   * Update the mirror from a validated `cbe_canvas` execute() `details` object. A
   * set upserts, a clear removes. The details already carry the RESOLVED step group
   * (execute() resolved the address via the shared rule); any other shape (a refusal,
   * a foreign tool's result) leaves the mirror untouched — degenerate/refused calls
   * never move it.
   */
  applyToolResult(details: unknown): void {
    if (!details || typeof details !== "object") return;
    const d = details as Record<string, unknown>;
    if (d.kind !== "canvas-update") return;
    if (typeof d.step !== "number" || typeof d.id !== "string") return;
    const addr: ResolvedCanvasAddress =
      typeof d.phase === "string" ? { step: d.step, phase: d.phase as CanvasPhase } : { step: d.step };
    if (d.action === "clear") {
      this.applyClear(addr, d.id);
      return;
    }
    if (d.action === "set") {
      if (typeof d.value !== "string") return;
      this.applySet({
        step: d.step,
        ...(typeof d.phase === "string" ? { phase: d.phase as CanvasPhase } : {}),
        id: d.id,
        ...(typeof d.label === "string" ? { label: d.label } : {}),
        value: d.value,
        state: (typeof d.state === "string" ? d.state : "draft") as CanvasState,
      });
    }
  }

  /**
   * Record a UI-initiated deletion (canvas delete control): remove the artefact's
   * entry exactly like a clear AND enqueue a deletion notice so the next lecturer
   * turn can disclose it to the agent. The label defaults to the mirrored entry's
   * label when the caller does not supply one.
   */
  recordUiDeletion(addr: ResolvedCanvasAddress, id: string, label?: string): void {
    const key = canvasEntryKey(addr, id);
    const existing = this.entries.get(key);
    this.entries.delete(key);
    this.pendingDeletions.push({
      step: addr.step,
      ...(addr.phase ? { phase: addr.phase } : {}),
      id,
      ...((label ?? existing?.label) ? { label: label ?? existing?.label } : {}),
    });
    // A deletion is a CATEGORICAL change to the evidence base — reported even
    // when the entry was already absent, because the lecturer removed a decision
    // either way and the model's picture of the canvas has moved.
    this.report({
      kind: "canvas-deletion",
      step: addr.step,
      id,
      ...((label ?? existing?.label) ? { label: (label ?? existing?.label) as string } : {}),
    });
  }

  /** True when at least one UI deletion is awaiting disclosure. */
  hasPendingDeletions(): boolean {
    return this.pendingDeletions.length > 0;
  }

  /** Return and clear the queued deletion notices (drained by the prompt handler). */
  drainDeletionNotices(): PendingDeletionNotice[] {
    return this.pendingDeletions.splice(0, this.pendingDeletions.length);
  }

  /** The queued deletion notices, without draining them (copies). */
  listPendingDeletions(): PendingDeletionNotice[] {
    return this.pendingDeletions.map((n) => ({ ...n }));
  }

  /**
   * Put notices back that were drained into a payload the model never received.
   * They return to the FRONT of the queue, in their original order and ahead of
   * anything deleted since, so the retried turn discloses the same deletions in
   * the same sequence. An empty batch is a no-op.
   */
  requeueDeletionNotices(notices: readonly PendingDeletionNotice[]): void {
    if (notices.length === 0) return;
    this.pendingDeletions.unshift(...notices.map((n) => ({ ...n })));
  }

  has(addr: ResolvedCanvasAddress, id: string): boolean {
    return this.entries.has(canvasEntryKey(addr, id));
  }

  get(addr: ResolvedCanvasAddress, id: string): CanvasArtefactEntry | undefined {
    return this.entries.get(canvasEntryKey(addr, id));
  }

  /** Snapshot of the mirrored artefacts (for harness consumers). */
  list(): CanvasArtefactEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  /** Number of mirrored artefacts. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Replace the mirror's contents with a stored course record (capability
   * `agent-harness`, Requirement: Course Design-State Store). Used when a course is
   * opened, before the first hydration snapshot is served.
   *
   * Restores EXACTLY what was stored: entries are re-keyed through the same address
   * rule `applySet` uses, and nothing is defaulted, promoted or invented. An empty
   * list yields an empty mirror — a course with no stored artefacts opens empty
   * rather than inheriting the previously active course's.
   *
   * The record comes off disk, so each entry passes `isCanvasArtefactEntry` first:
   * a malformed entry is DISCARDED rather than mirrored and handed on to the
   * renderer, which is what every other writer into this state already does.
   */
  restore(entries: readonly CanvasArtefactEntry[]): void {
    this.restoring = true;
    try {
      this.entries.clear();
      for (const entry of entries) {
        if (!isCanvasArtefactEntry(entry)) continue;
        this.applySet(entry);
      }
    } finally {
      this.restoring = false;
    }
  }
}
