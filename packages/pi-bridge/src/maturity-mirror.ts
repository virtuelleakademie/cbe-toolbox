/**
 * Host-side session maturity mirror (capability `agent-harness`, Requirement:
 * Host-Side Session Maturity Mirror) plus the SHARED record semantics of the
 * `cbe_maturity` tool (Requirement: cbe_maturity Generative-UI Tool).
 *
 * The pattern is the Host-Side Canvas Artefact Mirror, applied to maturity: the
 * main process keeps an in-memory record of the current recorded raster, fed by
 * the same validated `cbe_maturity` result details the renderer consumes. It
 * exists so the reading survives renderer restarts — the boot-hydration /
 * `conversationOpen` snapshot carries `snapshot()`.
 *
 * The mirror is COURSE-backed, not session-scoped: opening a course populates it
 * from that course's own design-state record before the first hydration snapshot
 * (Requirement: Course Design-State Store), every applied update is written back
 * there at the turn boundary, and a New Session within the same course KEEPS the
 * reading. A different course never sees it, and a course with no stored reading
 * opens with an empty mirror rather than inheriting one. For a course predating
 * the record, the mirror is still rebuilt once by replaying that course's own
 * persisted `cbe_maturity` calls (see maturity-replay.ts), and the result is then
 * written through.
 *
 * Three further host-side consumers read `snapshot()`. Two sit around compaction:
 * the companion's consolidation check (compaction-companion-extension.ts) treats
 * the recorded reading as a durable store, and the post-compaction retained-state
 * handover (retained-state-handover.ts) hands it back to the model. The third is
 * the `cbe_maturity` tool itself (maturity-tool.ts): it classifies the
 * post-update raster via `computeMaturityDivergence` below and carries the result
 * as model-facing acknowledgement text. None of them may reach into the
 * renderer's store — the renderer is a display projection only.
 *
 * This module is deliberately free of Node and Pi imports: the renderer's
 * maturity reducer imports `applyMaturityDetails` / `parseMaturityDetails` from
 * here (subpath export `@cbe/pi-bridge/maturity`), so the host mirror and the
 * renderer state apply BYTE-IDENTICAL record semantics and can never diverge.
 *
 * Record semantics (the transport-layer contract both consumers implement):
 *   - a batched `readings` call REPLACES the whole recorded raster;
 *   - a single criterion/overall update MERGES per-field: `current`/`target`
 *     persist unless present in the call (`target: null` clears);
 *   - `hint`, `uncertain`, `capped` — and `note` on `overall` — are REPLACED on
 *     every update for that criterion (absent means cleared), so a stale gap
 *     hint, uncertainty marker or reservation cap never survives a level or
 *     target change;
 *   - a `current` on the `overall` record is DROPPED: the aggregate achieved
 *     level is host-derived (`deriveOverallMaturity`), never model-pushed and
 *     never stored;
 *   - levels are NOT a ratchet: any valid transition is accepted, including a
 *     lower level, a lowered/cleared target, and a fall back to `"unassessed"`;
 *   - within one turn, later calls win (event order).
 *
 * Beside the raster the mirror keeps HOST-WRITTEN provenance per record — the
 * substance signal and design-revision counter value at the moment an update was
 * applied (capability `agent-harness`, Requirement: Host-Side Session Maturity
 * Mirror). It is kept in its own map, never on `MaturityCriterionState`, so no
 * tool argument can reach it and it never travels into the persisted course
 * record. See `MaturityProvenance`.
 */
import type { DesignSubstance } from "./design-substance.js";

/** The seven fixed PIONEER criterion keys — 1:1 with the seven criteria of
 * `methodology-007` §4.4 Table 1. The renderer owns the canonical key→label
 * table; these keys are the transport identity. */
export const MATURITY_CRITERIA = [
  "societal-challenge",
  "stakeholder-involvement",
  "interdisciplinarity",
  "student-agency",
  "iterative-process",
  "value-reflection",
  "societal-impact",
] as const;

export type MaturityCriterionKey = (typeof MATURITY_CRITERIA)[number];
/** A record is keyed by a criterion or the aggregate `overall` row. */
export type MaturityRecordKey = MaturityCriterionKey | "overall";
export type MaturityLevel = 1 | 2 | 3;
/** `"unassessed"` is the explicit no-evidence state — never a fabricated level. */
export type MaturityCurrent = MaturityLevel | "unassessed";

export function isMaturityCriterionKey(v: unknown): v is MaturityCriterionKey {
  return typeof v === "string" && (MATURITY_CRITERIA as readonly string[]).includes(v);
}

export function isMaturityRecordKey(v: unknown): v is MaturityRecordKey {
  return v === "overall" || isMaturityCriterionKey(v);
}

function isMaturityLevel(v: unknown): v is MaturityLevel {
  return v === 1 || v === 2 || v === 3;
}

/** One validated reading record as carried in the tool's result details. A
 * present `target: null` explicitly clears a previously recorded target. */
export interface MaturityReadingRecord {
  criterion: MaturityRecordKey;
  current?: MaturityCurrent;
  target?: MaturityLevel | null;
  uncertain?: boolean;
  /** A standing didactic reservation caps this criterion, so the derived
   * aggregate may not exceed it (Requirement: *Host-Derived Overall Maturity
   * Level*). Criterion records only, and deliberately NOT `uncertain`:
   * uncertainty is weak evidence for a reading, a cap is a substantive finding
   * the lecturer left standing. */
  capped?: boolean;
  hint?: string;
  note?: string;
}

/** The structured `details` a `cbe_maturity` execute() returns. A refusal
 * carries only the kind; an update carries either the single validated record's
 * fields (flat) or the batched `readings`. */
export interface MaturityToolDetails extends Omit<MaturityReadingRecord, "criterion"> {
  kind: "maturity-refusal" | "maturity-update";
  criterion?: MaturityRecordKey;
  readings?: MaturityReadingRecord[];
}

/** One criterion's (or the overall row's) recorded state. A cleared target is
 * ABSENT (never null) so consumers need no null-vs-undefined distinction.
 *
 * The `overall` record NEVER carries a `current`: the aggregate achieved level
 * is host-derived (`deriveOverallMaturity`), so there is nothing to store and a
 * stored copy could only disagree with the criteria it is derived from. */
export interface MaturityCriterionState {
  current?: MaturityCurrent;
  target?: MaturityLevel;
  uncertain?: boolean;
  /** Standing-reservation cap — see `MaturityReadingRecord.capped`. */
  capped?: boolean;
  hint?: string;
  note?: string;
}

/** The recorded raster: only keys that received an update are present. Empty
 * object = no reading recorded (the panel's empty state). */
export type MaturitySnapshot = Partial<Record<MaturityRecordKey, MaturityCriterionState>>;

/**
 * Structural guard for ONE criterion's stored state, applied wherever a whole
 * raster enters the mirror outside the tool path — a New Session carry-over and a
 * course record read back from disk (capability `agent-harness`, Requirement:
 * Course Design-State Store). Deliberately narrower than the tool validator (a
 * carried raster need not satisfy the batch tool's "all seven exactly once"
 * shape) but strict about VALUES, so a hand-edited record cannot introduce a
 * level outside 1..3 or a non-string hint.
 */
export function isMaturityCriterionState(v: unknown): v is MaturityCriterionState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (s.current !== undefined && !(isMaturityLevel(s.current) || s.current === "unassessed")) return false;
  if (s.target !== undefined && !isMaturityLevel(s.target)) return false;
  if (s.uncertain !== undefined && typeof s.uncertain !== "boolean") return false;
  if (s.capped !== undefined && typeof s.capped !== "boolean") return false;
  if (s.hint !== undefined && typeof s.hint !== "string") return false;
  if (s.note !== undefined && typeof s.note !== "string") return false;
  return true;
}

/**
 * Keep only the well-formed records of an untrusted raster: an unknown key or an
 * invalid criterion state is DROPPED, never repaired and never defaulted. An
 * absent or wholly unreadable raster yields `{}` — "no reading recorded", which is
 * exactly what the carry-over rule requires it to mean (nothing is materialised
 * from absence).
 */
export function sanitizeMaturitySnapshot(value: unknown): MaturitySnapshot {
  const out: MaturitySnapshot = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, state] of Object.entries(value as Record<string, unknown>)) {
    if (!isMaturityRecordKey(key)) continue;
    if (!isMaturityCriterionState(state)) continue;
    const kept: MaturityCriterionState = { ...(state as MaturityCriterionState) };
    if (key === "overall") {
      // The aggregate achieved level is host-derived and stored NOWHERE
      // (Requirement: *Host-Derived Overall Maturity Level*). A course record
      // written before that rule, or a hand-edited one, may still carry one —
      // it is dropped here rather than restored, so a stale model-pushed
      // aggregate can never resurface beside the criteria it disagrees with.
      delete kept.current;
      delete kept.capped;
    }
    out[key] = kept;
  }
  return out;
}

/**
 * Parse an unknown tool-result `details` value into validated
 * `MaturityToolDetails`, or null for refusals, other tools' results, and
 * malformed payloads (same contract as the renderer's `parseCanvasDetails`).
 * Defensive re-validation: both consumers receive the details over an event
 * path, so structure is never assumed.
 */
export function parseMaturityDetails(details: unknown): MaturityToolDetails | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== "maturity-update") return null; // ignore refusals and foreign results
  if (Array.isArray(d.readings)) {
    const readings: MaturityReadingRecord[] = [];
    for (const raw of d.readings) {
      const rec = parseRecord(raw);
      if (!rec) return null; // a torn batch is not applied partially
      readings.push(rec);
    }
    if (readings.length === 0) return null;
    return { kind: "maturity-update", readings };
  }
  const rec = parseRecord(d);
  if (!rec) return null;
  return { kind: "maturity-update", ...rec };
}

/** Validate one record's structure (key, level ranges, field types). Content
 * rules (caps, sanitisation, shape exclusivity) are the tool validator's job —
 * this guard only keeps malformed event payloads out of the state. */
function parseRecord(raw: unknown): MaturityReadingRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isMaturityRecordKey(r.criterion)) return null;
  const rec: MaturityReadingRecord = { criterion: r.criterion };
  if ("current" in r) {
    if (!(isMaturityLevel(r.current) || r.current === "unassessed")) return null;
    rec.current = r.current;
  }
  if ("target" in r) {
    if (!(isMaturityLevel(r.target) || r.target === null)) return null;
    rec.target = r.target;
  }
  if ("uncertain" in r) {
    if (typeof r.uncertain !== "boolean") return null;
    rec.uncertain = r.uncertain;
  }
  if ("capped" in r) {
    if (typeof r.capped !== "boolean") return null;
    rec.capped = r.capped;
  }
  if ("hint" in r) {
    if (typeof r.hint !== "string") return null;
    rec.hint = r.hint;
  }
  if ("note" in r) {
    if (typeof r.note !== "string") return null;
    rec.note = r.note;
  }
  // The aggregate achieved level is HOST-DERIVED, so a `current` on the overall
  // record is dropped HERE — in the shared record semantics — and the host
  // mirror and the renderer therefore drop it identically, whatever path the
  // payload travelled (Requirement: *Host-Derived Overall Maturity Level*). The
  // capping marker is per-criterion and equally meaningless on the aggregate.
  if (rec.criterion === "overall") {
    delete rec.current;
    delete rec.capped;
  }
  // A record needs something to update. `note` counts on the overall record:
  // with the achieved level no longer settable, the limitation note is the one
  // field a call may carry alone, and rejecting it would throw away exactly the
  // sentence the panel must keep rendering while no aggregate exists yet.
  const overallNote = rec.criterion === "overall" && typeof rec.note === "string";
  if (rec.current === undefined && rec.target === undefined && !overallNote) return null;
  return rec;
}

/** Fold one record into a fresh per-key state (no previous state): only the
 * call's own fields are set; `target: null` stays cleared (absent). */
function stateOfRecord(rec: MaturityReadingRecord): MaturityCriterionState {
  const next: MaturityCriterionState = {};
  // Structural guarantee, not a repetition of the parser's: whatever path a
  // record reached this function by, the aggregate never receives an achieved
  // level or a capping marker — both are meaningless on it.
  const overall = rec.criterion === "overall";
  if (rec.current !== undefined && !overall) next.current = rec.current;
  if (isMaturityLevel(rec.target)) next.target = rec.target;
  if (rec.uncertain === true) next.uncertain = true;
  if (rec.capped === true && !overall) next.capped = true;
  if (typeof rec.hint === "string" && rec.hint.length > 0) next.hint = rec.hint;
  if (typeof rec.note === "string" && rec.note.length > 0) next.note = rec.note;
  return next;
}

/** Merge one single-record update onto the previous state per the record
 * semantics: `current`/`target` persist unless present (`target: null` clears);
 * `hint`/`uncertain`/`note` are replaced on every update (absent = cleared). */
function mergeRecord(prev: MaturityCriterionState | undefined, rec: MaturityReadingRecord): MaturityCriterionState {
  const next = stateOfRecord(rec);
  if (rec.current === undefined && prev?.current !== undefined) next.current = prev.current;
  if (rec.target === undefined && prev?.target !== undefined) next.target = prev.target;
  return next;
}

/**
 * Apply one validated `cbe_maturity` update to a snapshot — the PURE record
 * semantics shared by the host mirror and the renderer's maturity reducer. A
 * batched `readings` update replaces the whole raster; a single update merges
 * per-field. Returns a new object; never mutates the input.
 */
export function applyMaturityDetails(state: MaturitySnapshot, details: MaturityToolDetails): MaturitySnapshot {
  if (details.kind !== "maturity-update") return state;
  if (details.readings) {
    const next: MaturitySnapshot = {};
    for (const rec of details.readings) {
      next[rec.criterion] = stateOfRecord(rec);
    }
    return next;
  }
  if (!details.criterion) return state;
  const rec: MaturityReadingRecord = {
    criterion: details.criterion,
    ...("current" in details && details.current !== undefined ? { current: details.current } : {}),
    ...("target" in details && details.target !== undefined ? { target: details.target } : {}),
    ...(details.uncertain !== undefined ? { uncertain: details.uncertain } : {}),
    ...(details.capped !== undefined ? { capped: details.capped } : {}),
    ...(details.hint !== undefined ? { hint: details.hint } : {}),
    ...(details.note !== undefined ? { note: details.note } : {}),
  };
  if (rec.criterion === "overall") {
    delete rec.current;
    delete rec.capped;
  }
  return { ...state, [rec.criterion]: mergeRecord(state[rec.criterion], rec) };
}

/**
 * The host-derived overall achieved reading (capability `agent-harness`,
 * Requirement: *Host-Derived Overall Maturity Level*).
 *
 * It is NEVER a stored value: `deriveOverallMaturity` is a pure function of the
 * recorded criterion readings and their capping markers, re-run wherever the
 * aggregate is needed. A stored copy is exactly the failure this replaces — a
 * second, independent judgement able to disagree with the seven readings shown
 * beside it.
 */
export interface DerivedOverallMaturity {
  /** The banded level after the reservation cap — what the panel shows. */
  level: MaturityLevel;
  /** The unrounded arithmetic mean of the contributing levels, so the panel can
   * show the rounding rather than hide it. */
  mean: number;
  /** How many assessed criteria the aggregate rests on. An aggregate over three
   * criteria and one over seven are different claims. */
  contributing: number;
  /** The criterion whose standing reservation LOWERED the band, where one did.
   * Absent when the mean's band already sat at or below every cap. */
  cappedBy?: MaturityCriterionKey;
}

/**
 * Band a mean to a level by rounding half DOWN (2.5 → L2). A mean between two
 * bands is exactly the thin evidence § Maturity rounds down on — "thin substance
 * never becomes invented levels" (`cbe-skill`, Requirement *Maturity Raster
 * Assessment and Lecturer-Facing Surfacing*).
 */
function bandOfMean(mean: number): MaturityLevel {
  const band = Math.ceil(mean - 0.5);
  return (band < 1 ? 1 : band > 3 ? 3 : band) as MaturityLevel;
}

/**
 * Derive the overall achieved level from a recorded raster.
 *
 * - **Contributors**: only criteria carrying a numeric level. An unassessed one
 *   is unmeasurable, not a shortfall, and counting it as any level would turn a
 *   gap in the reading into a verdict about the design.
 * - **Band**: the mean, rounded half down.
 * - **Reservation cap**: the result never exceeds the lowest criterion marked
 *   `capped`. Without this the derivation would contradict `cbe-skill`, which
 *   requires the aggregate not to exceed a criterion an unresolved finding holds
 *   down — six criteria at L3 and one capped at L1 average to 2.71.
 * - **No contributor, no aggregate**: `undefined`, never L1 and never a zero a
 *   reader could take for a reading.
 *
 * The `overall` record is ignored entirely: it carries the elicited target and
 * the limitation note, neither of which is an achieved level.
 */
export function deriveOverallMaturity(state: MaturitySnapshot): DerivedOverallMaturity | undefined {
  let sum = 0;
  let contributing = 0;
  // Iterating the fixed criterion order (rather than the object's) makes the
  // tie between two equally low caps resolve deterministically.
  let cap: { key: MaturityCriterionKey; level: MaturityLevel } | undefined;
  for (const key of MATURITY_CRITERIA) {
    const current = state[key]?.current;
    if (!isMaturityLevel(current)) continue;
    sum += current;
    contributing += 1;
    if (state[key]?.capped === true && (cap === undefined || current < cap.level)) cap = { key, level: current };
  }
  if (contributing === 0) return undefined;
  const mean = sum / contributing;
  const band = bandOfMean(mean);
  if (cap && cap.level < band) return { level: cap.level, mean, contributing, cappedBy: cap.key };
  return { level: band, mean, contributing };
}

/**
 * The recorded raster with the derived aggregate placed on the `overall`
 * record's `current` — the shape every existing raster consumer already reads.
 *
 * This is how the derivation travels to the MODEL-facing surfaces (the
 * session-start prior, the post-compaction handover) without being stored: the
 * returned object is a copy, the mirror's own state and the persisted course
 * record keep no aggregate, and a restore re-derives rather than reloads.
 */
export function withDerivedOverall(state: MaturitySnapshot | undefined): MaturitySnapshot {
  const out: MaturitySnapshot = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    out[key as MaturityRecordKey] = { ...(value as MaturityCriterionState) };
  }
  const derived = deriveOverallMaturity(out);
  if (!derived) return out;
  out.overall = { ...(out.overall ?? {}), current: derived.level };
  return out;
}

/** The five divergence states a recorded key can be in, relative to its own
 * declared target. Pure arithmetic over the recorded raster — no judgement.
 * The array is the single source of truth; it also fixes the rendering order. */
export const MATURITY_DIVERGENCE_STATES = ["below", "at", "above", "unassessed", "no-target"] as const;

export type MaturityDivergenceState = (typeof MATURITY_DIVERGENCE_STATES)[number];

/** One recorded CRITERION's classification. The aggregate `overall` row is not
 * an eighth criterion and is carried separately (see the summary below). */
export interface MaturityDivergenceEntry {
  key: MaturityCriterionKey;
  state: MaturityDivergenceState;
}

/** The host-computed divergence summary over a recorded raster (capability
 * `agent-harness`, Requirement: cbe_maturity Generative-UI Tool — the
 * acknowledgement's divergence summary).
 *
 * `entries`/`counts` cover the seven PIONEER CRITERIA only. The `overall` record
 * is the raster's own conservative aggregate — counting it in the same buckets
 * would inflate the shortfall tally by one on every establishment batch (one
 * genuinely-below criterion would render as `below 2`), which is exactly the
 * fabricated verdict the confrontation exists to prevent. It is classified by
 * the same rules and reported apart, absent when no `overall` record exists. */
export interface MaturityDivergenceSummary {
  entries: MaturityDivergenceEntry[];
  counts: Record<MaturityDivergenceState, number>;
  overall?: MaturityDivergenceState;
}

/** Classify one record against its own declared target. TOTAL and
 * precedence-ordered, so a record can never land in two states or in none. */
function classifyRecord(record: MaturityCriterionState): MaturityDivergenceState {
  const current = record.current;
  const target = record.target;
  if (typeof current !== "number") return "unassessed";
  if (typeof target !== "number") return "no-target";
  if (current < target) return "below";
  if (current === target) return "at";
  return "above";
}

/**
 * Classify every recorded key of a raster into exactly one divergence state.
 *
 * The classification is TOTAL and precedence-ordered, so a record can never land
 * in two states or in none:
 *   1. `unassessed` — `current` is the explicit `"unassessed"` state, OR no
 *      `current` is recorded at all (a target-only record is equally unmeasurable;
 *      it is an absence of evidence, never a gap);
 *   2. `no-target` — a numeric `current` with no recorded `target`;
 *   3. `below` / `at` / `above` — numeric `current` against numeric `target`.
 *
 * The `overall` record is classified by the very same rules but reported in its
 * own field, NEVER inside `entries`/`counts` — it is the raster's aggregate, not
 * an eighth criterion, and folding it into the per-criterion buckets would
 * inflate the shortfall count.
 *
 * Consumers (notably the adversarial review's ambition-vs-achievement
 * confrontation, capability `cbe-skill`) QUOTE this classification instead of
 * re-deriving it. It contains no model text: `hint` and `note` are never read.
 */
export function computeMaturityDivergence(state: MaturitySnapshot): MaturityDivergenceSummary {
  const entries: MaturityDivergenceEntry[] = [];
  const counts: Record<MaturityDivergenceState, number> = {
    below: 0,
    at: 0,
    above: 0,
    unassessed: 0,
    "no-target": 0,
  };
  // The aggregate is classified against the level the HOST derives, not against
  // a stored one — there is none any more. Classifying the bare `overall` record
  // would report every aggregate as `unassessed` while the panel shows a level,
  // which is the very disagreement the derivation exists to end.
  const derived = deriveOverallMaturity(state);
  let overall: MaturityDivergenceState | undefined;
  for (const [key, record] of Object.entries(state)) {
    if (!record || typeof record !== "object") continue;
    const divergence = classifyRecord(key === "overall" ? { ...record, current: derived?.level } : record);
    if (key === "overall") {
      overall = divergence;
      continue;
    }
    if (!isMaturityCriterionKey(key)) continue;
    entries.push({ key, state: divergence });
    counts[divergence] += 1;
  }
  return overall === undefined ? { entries, counts } : { entries, counts, overall };
}

/** True when the summary has something to report — at least one recorded
 * criterion or an `overall` record. An aggregate-only raster still classifies. */
export function hasMaturityDivergence(summary: MaturityDivergenceSummary): boolean {
  return summary.entries.length > 0 || summary.overall !== undefined;
}

/**
 * Render the divergence summary as the single deterministic line the
 * `cbe_maturity` acknowledgement carries. Model-facing only: it is never a
 * lecturer-visible string, and its wording describes THIS SESSION's recorded
 * raster without claiming any stored or cross-session reading.
 */
export function formatMaturityDivergence(summary: MaturityDivergenceSummary): string {
  const byState = new Map<MaturityDivergenceState, string[]>();
  for (const s of MATURITY_DIVERGENCE_STATES) byState.set(s, []);
  for (const entry of summary.entries) byState.get(entry.state)!.push(entry.key);
  const parts = MATURITY_DIVERGENCE_STATES.map((s) => {
    const keys = byState.get(s)!;
    const count = summary.counts[s];
    return count > 0 ? `${s} ${count} (${keys.join(", ")})` : `${s} 0`;
  });
  const aggregate =
    summary.overall === undefined
      ? ""
      : ` The aggregate \`overall\` record is classified separately and is NOT counted among the criteria above: ${summary.overall}.`;
  return (
    "Divergence against the declared targets in this session's recorded raster " +
    `(computed by the host, quote it rather than re-deriving it): ${parts.join("; ")}.${aggregate}`
  );
}

/**
 * Host-written provenance of ONE recorded reading record (capability
 * `agent-harness`, Requirement: Host-Side Session Maturity Mirror — host-stamped
 * provenance).
 *
 * `unknown` is the honest state for a record the mirror did not see recorded:
 * one restored from the course design-state record, seeded by a New Session
 * carry-over, or rebuilt by the migration replay. The evidence that existed at
 * that historical call is not reconstructable, so neither field is fabricated —
 * and a reading with `unknown` provenance is never reported as stale.
 */
export type MaturityProvenance =
  | { kind: "unknown" }
  | { kind: "stamped"; recordedUnderSubstance: DesignSubstance; recordedAtRevision: number };

export type MaturityProvenanceMap = Partial<Record<MaturityRecordKey, MaturityProvenance>>;

/** What the host supplies at stamp time. Read at the moment a validated update is
 * APPLIED, so the stamp cannot drift from the evidence. */
export interface MaturityStampSource {
  substance: DesignSubstance;
  revision: number;
}

export class MaturityMirror {
  private state: MaturitySnapshot = {};
  /**
   * Provenance lives in a SEPARATE map, deliberately not on
   * `MaturityCriterionState`. That is the structural guarantee behind "no tool
   * argument can set, override or clear the stamp": the fields simply do not
   * exist on the record path the tool payload flows through, so there is nothing
   * for a model-supplied field to collide with. It also keeps the stamp out of
   * the course design-state record, which persists `MaturitySnapshot` only.
   */
  private provenanceByKey: MaturityProvenanceMap = {};

  /** Host-side stamp source (the session's `DesignSignal`). Absent in the
   * headless/unit paths, where records are stamped `unknown`. */
  constructor(private readonly stampSource?: () => MaturityStampSource) {}

  /**
   * Update the mirror from a `cbe_maturity` execute() `details` object (or the
   * same details replayed from the session record). Refusals, foreign tools'
   * results, and malformed payloads leave the mirror untouched.
   *
   * `stamp` overrides the host stamp source — the migration replay passes
   * `{ kind: "unknown" }` so a rebuilt reading is never presented as freshly
   * confirmed.
   */
  applyToolResult(details: unknown, stamp?: MaturityProvenance): void {
    const parsed = parseMaturityDetails(details);
    if (!parsed) return;
    this.state = applyMaturityDetails(this.state, parsed);
    const provenance = stamp ?? this.currentStamp();
    if (parsed.readings) {
      // A batched call REPLACES the raster, so it replaces the provenance map
      // too — and every record it writes carries the SAME values.
      const next: MaturityProvenanceMap = {};
      for (const rec of parsed.readings) next[rec.criterion] = provenance;
      this.provenanceByKey = next;
      return;
    }
    if (parsed.criterion) this.provenanceByKey[parsed.criterion] = provenance;
  }

  private currentStamp(): MaturityProvenance {
    if (!this.stampSource) return { kind: "unknown" };
    const src = this.stampSource();
    return { kind: "stamped", recordedUnderSubstance: src.substance, recordedAtRevision: src.revision };
  }

  /** Per-record provenance (copies). */
  provenance(): MaturityProvenanceMap {
    const out: MaturityProvenanceMap = {};
    for (const [key, value] of Object.entries(this.provenanceByKey)) {
      out[key as MaturityRecordKey] = { ...(value as MaturityProvenance) };
    }
    return out;
  }

  /**
   * The VISIBLE reading's provenance, aggregated for the panel's single framing.
   *
   * - No record carries a stamp (an empty mirror, or one filled purely by a
   *   restore) → `unknown`. Nothing can be claimed about the evidence.
   * - CURRENCY takes the MOST RECENT stamp (`max`), SUBSTANCE the weakest
   *   (`thin` if ANY stamped record was recorded under thin substance). The
   *   asymmetry is specified, not incidental: capability `agent-harness`,
   *   Requirement _Host-Side Design-Substance and Revision Signal_, "which stamp
   *   governs" — read it before changing either half.
   * - Records still carrying `unknown` from a restore take part in neither
   *   aggregate — they cannot go stale, and letting them veto it would hide
   *   staleness of the records that can.
   */
  readingProvenance(): MaturityProvenance {
    let revision: number | null = null;
    let thin = false;
    for (const value of Object.values(this.provenanceByKey)) {
      if (!value || value.kind !== "stamped") continue;
      revision = revision === null ? value.recordedAtRevision : Math.max(revision, value.recordedAtRevision);
      if (value.recordedUnderSubstance === "thin") thin = true;
    }
    if (revision === null) return { kind: "unknown" };
    return { kind: "stamped", recordedUnderSubstance: thin ? "thin" : "sufficient", recordedAtRevision: revision };
  }

  /**
   * Seed the mirror from a snapshot carried over by a New Session reset (capability
   * `desktop-app`, Requirement: New Session Control With Canvas Carry-Over) or
   * restored from the course record (Requirement: Course Design-State Store). This
   * is a HOST-side restore, so it deliberately bypasses the tool-payload validation
   * (a carried raster need not satisfy the batch tool's "all seven criteria exactly
   * once" shape) — but not the per-record VALUE guard: the course record comes off
   * disk, and an unknown key or an invalid level is dropped rather than mirrored.
   * Replaces any content.
   */
  seed(snapshot: MaturitySnapshot | undefined): void {
    this.state = sanitizeMaturitySnapshot(snapshot);
    // A restore is not a recording: the counter is back at zero and the substance
    // signal describes the NEW session, so neither field is reconstructable.
    // Stamping `unknown` is the honest answer; the first `cbe_maturity` call
    // after the restore replaces it with a real stamp.
    const next: MaturityProvenanceMap = {};
    for (const key of Object.keys(this.state)) next[key as MaturityRecordKey] = { kind: "unknown" };
    this.provenanceByKey = next;
  }

  /** Deep-copied snapshot of the recorded raster (hydration payload). */
  snapshot(): MaturitySnapshot {
    const out: MaturitySnapshot = {};
    for (const [key, value] of Object.entries(this.state)) {
      out[key as MaturityRecordKey] = { ...value };
    }
    return out;
  }

  /**
   * The host-derived overall achieved reading, or `undefined` while no criterion
   * is assessed (Requirement: *Host-Derived Overall Maturity Level*). Computed on
   * every call from the recorded criteria — the mirror stores no aggregate, so a
   * restored or replayed session derives exactly what the live one showed.
   */
  derivedOverall(): DerivedOverallMaturity | undefined {
    return deriveOverallMaturity(this.state);
  }

  /** True while no reading has been recorded (the panel's empty state). */
  isEmpty(): boolean {
    return Object.keys(this.state).length === 0;
  }

  /** True when at least one record carries a numeric target level. The Maturity
   * panel renders its current-versus-target presentation only for records that do
   * (Requirement: The Elicited Maturity Target Is Mirrored, Not Only Discussed), so a
   * reading without any target leaves that promise unmet. */
  hasTarget(): boolean {
    return Object.values(this.snapshot()).some((r) => typeof (r as { target?: unknown })?.target === "number");
  }

  /**
   * True when at least one record carries an ACHIEVED level — a numeric `current`, or
   * the explicit `"unassessed"` state, which is a read criterion with no evidence
   * rather than an unread one.
   *
   * The distinction the mirror could not make before `stage-the-maturity-reading-
   * behind-the-coherence-gate`: the target ambition is recorded through this same
   * tool, from the opening and long before the coherence gate, so a target-only raster
   * is a NON-EMPTY, freshly STAMPED mirror carrying no reading at all. Staleness is
   * about a reading falling behind the design (Requirement: *Stale-Maturity Disclosure
   * on the Next Lecturer Turn*), and an ambition does not fall behind anything — but
   * `governingStaleness` measured `isEmpty()`, so three settled changes after the
   * opening put a session into the standing staleness notice with nothing to refresh.
   * That is the loop the staging change exists to end; see `governingStaleness`.
   */
  hasAchievedReading(): boolean {
    return Object.values(this.snapshot()).some((r) => (r as { current?: unknown })?.current !== undefined);
  }
}
