/**
 * Host-side design-flow step-coverage mirror (capability `agent-harness`,
 * Requirement: *Deterministic Tool-Boundary Enforcement for Canvas Ids, Step Coverage
 * and Unfed Surfaces*).
 *
 * Until this module existed, step coverage was **purely model-asserted**: `cbe_step`
 * validated its payload and the renderer applied it, but nothing host-side remembered
 * the state, so nothing could derive it, guard it, or hand it to a fresh session. The
 * 2026-08-03 test session is the evidence for why that is not enough — the model
 * skipped `focus` for steps 2, 8 and 10 entirely, moved focus to step 6 while step 5
 * was still under discussion, and later jumped five steps from `rough` straight to
 * `detailed`. Every one of those is decidable from host state alone.
 *
 * The mirror is the counterpart of `CanvasMirror` and is fed from three directions:
 *
 * 1. a validated `cbe_step` result (`applyToolResult`),
 * 2. an accepted `cbe_canvas` write (`applyCanvasWrite`), which **derives** focus —
 *    the step that just received content is the step being worked on, whether or not
 *    the model remembered to say so, and
 * 3. a step the lecturer selected in the canvas UI (`recordUiFocus`) — the one feeder
 *    the model cannot break, because the lecturer already performed the action. It
 *    also arms the focus notice the next lecturer turn discloses, exactly as
 *    `CanvasMirror.recordUiDeletion` does for a UI deletion.
 *
 * Since `fix-ux3-wave2-orientation` the same derivation governs `cbe_step` itself, and
 * the DEPTH and FOCUS halves of a payload no longer share a fate: a depth is a coverage
 * claim the tool guards can refuse, a focus is navigation that cannot be fabricated, so
 * a refused depth still moves the focus — unless the focus was DERIVED from a depth two
 * or more rungs above the recorded one, which is bookkeeping about a step the model is
 * not working on. The split is implemented in `step-tool.ts`;
 * this class only applies what it is given — `applyUpdate` has always accepted the two
 * halves independently, which is why no change was needed here.
 *
 * It holds only what the skill actually pushed (plus derived focus and, on a pristine
 * mirror, the host's one-shot initial focus — see `seedInitialFocus()`); it is never a
 * projection of the renderer, which stays a display surface.
 *
 * `list()` is handed to a fresh session as the session-start step-coverage prior. The
 * post-compaction handover (retained-state-handover.ts, Requirement:
 * *Post-Compaction Retained-State Handover*) — a compaction summarizes away the
 * `cbe_step` calls, but the mirror keeps the coverage — reads `recordedList()`
 * instead, as does the persisted course record; that method's own doc below owns
 * which surface reads which, and why.
 */

export type StepDepth = "open" | "rough" | "refined" | "detailed";

/** The depth ladder, in ascending order. Index = rung. */
export const STEP_DEPTH_LADDER: readonly StepDepth[] = ["open", "rough", "refined", "detailed"];

/** Ladder position of a depth (0..3). */
export function depthRung(depth: StepDepth): number {
  return STEP_DEPTH_LADDER.indexOf(depth);
}

/** The next legal depth above `depth`, or null at the top of the ladder. */
export function nextDepthAbove(depth: StepDepth): StepDepth | null {
  const next = STEP_DEPTH_LADDER[depthRung(depth) + 1];
  return next ?? null;
}

export function isStepDepth(v: unknown): v is StepDepth {
  return typeof v === "string" && (STEP_DEPTH_LADDER as readonly string[]).includes(v);
}

/** One step's recorded coverage. Steps are 1..10 and align 1:1 with the canvas groups. */
export interface StepCoverageEntry {
  step: number;
  depth: StepDepth;
  focus: boolean;
}

const MIN_STEP = 1;
const MAX_STEP = 10;

export function isValidStepNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_STEP && v <= MAX_STEP;
}

/**
 * Structural guard for ONE stored coverage entry, applied identically wherever a
 * whole entry list enters the mirror from outside — a New Session carry-over and a
 * course record read back from disk (capability `agent-harness`, Requirement:
 * Course Design-State Store). An entry that fails it is discarded rather than
 * stored: a depth outside the ladder would make `depthRung` return -1 and the
 * one-rung guard of `cbe_step` compute against a rung that does not exist.
 */
export function isStepCoverageEntry(v: unknown): v is StepCoverageEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  if (!isValidStepNumber(e.step)) return false;
  if (!isStepDepth(e.depth)) return false;
  if (e.focus !== undefined && typeof e.focus !== "boolean") return false;
  return true;
}

/** Reported when a step's recorded DEPTH actually moves (capability
 * `agent-harness`, Requirement: Host-Side Design-Substance and Revision Signal).
 * A focus-only update — including the focus a `cbe_canvas` write derives — is NOT
 * a depth transition and is never reported: moving attention is not a settled
 * design change. */
export type StepDepthObserver = (change: { step: number; from: StepDepth; to: StepDepth }) => void;

/**
 * A step selection the lecturer made in the canvas UI, awaiting disclosure to the
 * model (capability `agent-harness`, Requirement: *Host-Set Step Focus from the
 * Canvas UI*). The `label` is carried for the notice text only — the step NUMBER is
 * the contract, exactly as with `PendingDeletionNotice`.
 */
export interface PendingFocusNotice {
  step: number;
  label?: string;
}

/**
 * One machine-readable focus-notice line. Deliberately structural, not
 * lecturer-facing — it is prefixed to the model payload, never rendered.
 *
 * It states that the host has ALREADY moved the focus, because the standing rule
 * that has to fire here lives in `cbe_step`'s description ("Call it on TRANSITIONS
 * ONLY … never every turn") and nothing transitioned: re-asserting a focus the host
 * recorded is a call with no transition behind it. Naming that explicitly follows
 * `canvasDeletionNoticeLine`, which tells the model not to emit the `cbe_canvas`
 * clear for an artefact the UI already removed.
 */
export function stepFocusNoticeLine(n: PendingFocusNotice): string {
  const named = n.label && n.label.trim().length > 0 ? `step ${n.step} ("${n.label}")` : `step ${n.step}`;
  return (
    `[step-focus] The lecturer selected ${named} in the canvas UI. The host has ALREADY ` +
    `moved the step focus there — do NOT emit a cbe_step call to set it. Work on step ${n.step} from here on.`
  );
}

/**
 * Prefix the pending UI focus notice to the next lecturer turn's payload — one line
 * ahead of the lecturer's own text. No pending notice → text unchanged. The composed
 * text is what reaches the model AND the persisted transcript (lossless); the
 * renderer displays only the lecturer's own turn, and the moving in-focus marker is
 * the lecturer's feedback.
 */
export function composePayloadWithFocusNotice(notice: PendingFocusNotice | null, text: string): string {
  if (!notice) return text;
  return `${stepFocusNoticeLine(notice)}\n\n${text}`;
}

export class StepMirror {
  /** Only steps that have moved off their default are stored; absent = `open`, unfocused. */
  private readonly entries = new Map<number, StepCoverageEntry>();
  private observer: StepDepthObserver | null = null;
  private initialFocusConsidered = false;
  /** True while the ONLY content of this mirror is the host's initial-orientation
   * seed. The flag answers one question exactly: does anything here come from
   * recorded work? The surfaces that mean RECORDED coverage — the persisted course
   * record and the post-compaction handover — read `recordedList()` rather than
   * `list()` so a default is never reported as something that happened.
   *
   * It is cleared by `recordWork()`, which EVERY feeder calls before it decides
   * whether the entry map needs to change. Clearing it inside `applyUpdate` alone
   * was wrong: `applyCanvasWrite` returns early when the written step is already
   * the focused one, which with the seed standing is exactly step 1 — so a
   * `cbe_canvas` write into step 1 on the first turn of a new course left the
   * mirror reporting "nothing recorded" and the course record was written without
   * any step state. Provenance changes when work ARRIVES, not when a value moves. */
  private seededFocusStands = false;
  /** Suppresses reporting while a whole entry list is seeded/restored from
   * outside — a carry-over or a course record is not a settled design change. */
  private restoring = false;
  /** The UI step selection awaiting disclosure. AT MOST ONE, unlike the canvas
   * mirror's deletion QUEUE: focus is exclusive, so a second selection before the
   * next lecturer turn makes the first irrelevant, and disclosing both would tell
   * the model the lecturer is in two places at once. */
  private pendingFocusNotice: PendingFocusNotice | null = null;

  /** Register the depth-transition observer (the session's `DesignSignal`). One
   * observer; a second call replaces it. */
  observe(fn: StepDepthObserver | null): void {
    this.observer = fn;
  }

  /** Recorded depth of a step. A step never touched reads `open`. */
  depthOf(step: number): StepDepth {
    return this.entries.get(step)?.depth ?? "open";
  }

  /** The step currently in focus, or null when none is. */
  focused(): number | null {
    for (const e of this.entries.values()) if (e.focus) return e.step;
    return null;
  }

  /** Every recorded step, ascending. Steps still at their default are omitted. */
  list(): StepCoverageEntry[] {
    return [...this.entries.values()].sort((a, b) => a.step - b.step);
  }

  /**
   * `list()` restricted to what actually happened: empty while the mirror holds
   * nothing but the initial-orientation seed (Requirement: *Host-Set Initial Step
   * Focus* — the seed "is not a coverage claim").
   *
   * Two consumers MUST read this instead of `list()`, because both mean recorded
   * work: the course design-state record, whose Requirement *Course Design-State
   * Store* says a course with no record opens empty and "never a default"; and the
   * post-compaction handover, whose Requirement *Post-Compaction Retained-State
   * Handover* requires a session that established nothing to produce no block at
   * all. The descriptor's step prior and the renderer's hydration DO read `list()`
   * — the seed's whole purpose is to be visible there.
   */
  recordedList(): StepCoverageEntry[] {
    return this.seededFocusStands ? [] : this.list();
  }

  /** True while nothing but the host's initial-orientation seed stands. */
  holdsOnlySeededFocus(): boolean {
    return this.seededFocusStands;
  }

  /** Every feeder's first statement: work has arrived, so whatever the mirror now
   * holds is recorded coverage rather than the host's starting-point default. Call
   * it BEFORE any early return that skips a redundant entry write. */
  private recordWork(): void {
    this.initialFocusConsidered = true;
    this.seededFocusStands = false;
  }

  /** True when nothing has been recorded — no depth above `open` and no focus. */
  isEmpty(): boolean {
    return this.list().every((e) => e.depth === "open" && !e.focus);
  }

  /** Initial orientation, not a lecturer event or a coverage claim. Only a
   * pristine mirror may receive it, once; restores and replayed updates also
   * consume that opportunity, even if they later leave no focus. */
  seedInitialFocus(): void {
    if (this.initialFocusConsidered) return;
    this.initialFocusConsidered = true;
    if (!this.isEmpty()) return;
    this.applyUpdate(1, { focus: true });
    // AFTER the update: every feeder, `applyUpdate` included, calls `recordWork()`.
    this.seededFocusStands = true;
  }

  /**
   * Replace the mirror's contents with a stored course record (capability
   * `agent-harness`, Requirement: Course Design-State Store), applied when a course
   * is opened.
   *
   * Restores EXACTLY what was stored — a step recorded at `open` stays `open` and a
   * step absent from the record stays absent (which reads as `open`). No depth is
   * promoted and no focus is invented.
   *
   * This is `seed()` under the entry-list contract of the course record, and it
   * deliberately delegates rather than repeating it: the record comes off disk and
   * is the LESS trustworthy of the two inputs, so it must not be the one that skips
   * a validation rule.
   */
  restore(entries: readonly StepCoverageEntry[]): void {
    this.seed(entries);
  }

  /** Apply one validated transition. `focus: true` is exclusive — every other step
   * loses focus, exactly as the renderer's reducer enforces it. */
  applyUpdate(step: number, patch: { depth?: StepDepth; focus?: boolean }): void {
    if (!isValidStepNumber(step)) return;
    const hasDepth = patch.depth !== undefined && isStepDepth(patch.depth);
    const hasFocus = typeof patch.focus === "boolean";
    if (!hasDepth && !hasFocus) return;
    this.recordWork();
    if (hasFocus && patch.focus === true) this.clearFocus();
    const cur = this.entries.get(step) ?? { step, depth: "open" as StepDepth, focus: false };
    const nextDepth = hasDepth ? patch.depth! : cur.depth;
    this.entries.set(step, {
      step,
      depth: nextDepth,
      focus: hasFocus ? patch.focus! : cur.focus,
    });
    if (!this.restoring && nextDepth !== cur.depth) {
      this.observer?.({ step, from: cur.depth, to: nextDepth });
    }
  }

  /**
   * Derive focus from an accepted `cbe_canvas` write: the step that just received
   * content becomes the step in focus (Scenario: *An accepted canvas write moves the
   * step focus to that step*). Depth is NOT touched — writing content is not by
   * itself a claim about coverage depth, which stays a deliberate `cbe_step` call
   * subject to the ladder guards.
   */
  applyCanvasWrite(step: number): void {
    if (!isValidStepNumber(step)) return;
    this.recordWork();
    if (this.focused() === step) return;
    this.applyUpdate(step, { focus: true });
  }

  /**
   * Record a UI-initiated step selection (the canvas step-select affordance,
   * capability `agent-harness`, Requirement: *Host-Set Step Focus from the Canvas
   * UI*): move the exclusive focus onto that step AND arm the focus notice so the
   * next lecturer turn discloses it to the agent.
   *
   * This is the mirror's THIRD feeder, beside a validated `cbe_step` result and the
   * focus an accepted `cbe_canvas` write derives — and the only one the model cannot
   * break, because the lecturer already performed the action. DEPTH is deliberately
   * untouched: selecting a step is navigation, never a claim that its named output
   * exists, so `applyUpdate` reports no depth transition for it either.
   *
   * A step outside 1..10 is a safe no-op that arms nothing, the same defensive shape
   * as `applyCanvasWrite`.
   */
  recordUiFocus(step: number, label?: string): void {
    if (!isValidStepNumber(step)) return;
    this.recordWork();
    this.applyUpdate(step, { focus: true });
    this.pendingFocusNotice = { step, ...(label !== undefined ? { label } : {}) };
  }

  /** True while a UI step selection is awaiting disclosure. */
  hasPendingFocus(): boolean {
    return this.pendingFocusNotice !== null;
  }

  /** The pending focus notice without draining it (a copy), or null. Read BEFORE
   * composing, so a payload the model never receives can give it back. */
  pendingFocus(): PendingFocusNotice | null {
    return this.pendingFocusNotice ? { ...this.pendingFocusNotice } : null;
  }

  /** Return and clear the pending focus notice (drained by the prompt handler). */
  drainFocusNotice(): PendingFocusNotice | null {
    const notice = this.pendingFocusNotice;
    this.pendingFocusNotice = null;
    return notice;
  }

  /**
   * Put back a notice that was drained into a payload the model never received —
   * but ONLY while nothing newer is pending. A selection made since is the current
   * truth, and restoring a stale one over it would disclose a step the lecturer has
   * already left. That conditional is the deliberate divergence from
   * `CanvasMirror.requeueDeletionNotices`, where every deletion is an independent
   * fact and none supersedes another.
   */
  requeueFocusNotice(notice: PendingFocusNotice | null): void {
    if (!notice) return;
    if (this.pendingFocusNotice !== null) return;
    this.pendingFocusNotice = { ...notice };
  }

  /** Update from a validated `cbe_step` execute() `details`. Any other shape (a
   * refusal, a foreign tool's result) leaves the mirror untouched. */
  applyToolResult(details: unknown): void {
    if (!details || typeof details !== "object") return;
    const d = details as Record<string, unknown>;
    if (d.kind !== "step-update") return;
    if (!isValidStepNumber(d.step)) return;
    this.applyUpdate(d.step, {
      ...(isStepDepth(d.depth) ? { depth: d.depth } : {}),
      ...(typeof d.focus === "boolean" ? { focus: d.focus } : {}),
    });
  }

  /** Seed the mirror from state carried over by a New Session reset (capability
   * `desktop-app`, Requirement: *New Session Control With Canvas Carry-Over*) or
   * restored from the course record (Requirement: *Course Design-State Store*).
   * Replaces any current content — a fresh session starts from the carried state.
   * Entries that fail `isStepCoverageEntry` are dropped, never stored. */
  seed(entries: readonly StepCoverageEntry[]): void {
    this.recordWork();
    this.restoring = true;
    try {
      this.seedInternal(entries);
    } finally {
      this.restoring = false;
    }
  }

  private seedInternal(entries: readonly StepCoverageEntry[]): void {
    this.entries.clear();
    let focusSeen = false;
    for (const e of entries) {
      if (!isStepCoverageEntry(e)) continue;
      // Defensive: a malformed carry-over must not produce two focused steps.
      const focus = e.focus === true && !focusSeen;
      if (focus) focusSeen = true;
      this.entries.set(e.step, { step: e.step, depth: e.depth, focus });
    }
  }

  private clearFocus(): void {
    for (const [step, e] of this.entries) {
      if (e.focus) this.entries.set(step, { ...e, focus: false });
    }
  }
}
