/**
 * Lecturer-profile record — the per-lecturer persistent state behind the
 * Profile Panel (capability `agent-harness`, Requirement: Per-Lecturer Profile
 * Store; capability `cbe-skill`, Requirement: Lecturer-State Dimensions).
 *
 * This module owns the SHAPE: the five dimensions, their scales, the
 * per-dimension record (value, confidence, evidence, provenance, lastRevised)
 * and the runtime guards both ends of the IPC/store boundary share.
 * Persistence lives in the host (the app's main process implements
 * `LecturerProfileStore` as a userData JSON file; headless hosts may pass an
 * in-memory store). The record deliberately contains NO conversation content —
 * the stakeholder requirement (plan/requirements.md § Lecturer-state
 * persistence) excludes transcripts from lecturer-state.
 */

export const PROFILE_DIMENSIONS = [
  "pbl-prior-knowledge",
  "cbe-prior-knowledge",
  "didactic-stance",
  "attitude",
  "capacity",
] as const;

export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

/**
 * Allowed values per dimension. Ordinal dimensions use their spec scale
 * verbatim; the two spectrum dimensions (stance, attitude) are discretised to
 * five steps so the record (and the panel control) stays structured without
 * pretending to more precision than the skill's estimate carries.
 */
export const DIMENSION_SCALES: Record<ProfileDimension, readonly string[]> = {
  "pbl-prior-knowledge": ["none", "some", "pronounced"],
  "cbe-prior-knowledge": ["none", "some", "pronounced"],
  "didactic-stance": ["facilitator", "facilitator-leaning", "mixed", "instructor-leaning", "instructor"],
  attitude: ["sceptic", "sceptic-leaning", "neutral", "enthusiast-leaning", "enthusiast"],
  capacity: ["saturated", "limited", "headroom"],
};

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Who set the current value: the skill's running estimate or a lecturer override. */
export const PROVENANCES = ["estimate", "override"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export interface DimensionRecord {
  /** Current value — MUST be on the dimension's scale (DIMENSION_SCALES). */
  value: string;
  confidence: Confidence;
  /** Short pointer to the observation grounding the value (e.g. "turn 6: fluent use of 'Guiding Questions'"). Never conversation content beyond the pointer. */
  evidence: string;
  provenance: Provenance;
  /** ISO-8601 timestamp of the last revision. */
  lastRevised: string;
}

/**
 * The per-lecturer profile. Dimensions are absent until a substantive signal
 * produced an estimate (capability `cbe-skill`, scenario "No signal, no
 * emission") — `{}` is a valid, empty profile.
 */
export type LecturerProfile = Partial<Record<ProfileDimension, DimensionRecord>>;

/**
 * Pluggable persistence boundary (Requirement: Per-Lecturer Profile Store).
 * The app implements it file-backed under userData; eval/headless hosts may
 * pass an in-memory implementation. `load` resolves null when no record exists
 * (cold start).
 */
export interface LecturerProfileStore {
  load(): Promise<LecturerProfile | null>;
  save(profile: LecturerProfile): Promise<void>;
}

/** True iff `value` is on `dimension`'s scale. */
export function isValidDimensionValue(dimension: ProfileDimension, value: string): boolean {
  return DIMENSION_SCALES[dimension].includes(value);
}

export function isProfileDimension(value: unknown): value is ProfileDimension {
  return typeof value === "string" && (PROFILE_DIMENSIONS as readonly string[]).includes(value);
}

function isDimensionRecord(dimension: ProfileDimension, value: unknown): value is DimensionRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.value !== "string" || !isValidDimensionValue(dimension, r.value)) return false;
  if (!(CONFIDENCE_LEVELS as readonly unknown[]).includes(r.confidence)) return false;
  if (typeof r.evidence !== "string") return false;
  if (!(PROVENANCES as readonly unknown[]).includes(r.provenance)) return false;
  if (typeof r.lastRevised !== "string") return false;
  return true;
}

/**
 * Runtime type guard for the whole record — used by the store reader and the
 * IPC boundary to reject malformed blobs. Strict on keys: anything outside the
 * five dimensions rejects, so a corrupted or foreign file never round-trips.
 */
export function isLecturerProfile(value: unknown): value is LecturerProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, record] of Object.entries(value)) {
    if (!isProfileDimension(key)) return false;
    if (!isDimensionRecord(key, record)) return false;
  }
  return true;
}

/**
 * Pure update: returns a new profile with `dimension` set to `record`
 * (last-write-wins; no history kept — the transcript stays the audit trail).
 * The input profile is not mutated. Throws on a value off the dimension's
 * scale so a malformed update can never corrupt stored state.
 */
export function applyProfileUpdate(
  profile: LecturerProfile,
  dimension: ProfileDimension,
  record: DimensionRecord
): LecturerProfile {
  if (!isValidDimensionValue(dimension, record.value)) {
    throw new Error(
      `value "${record.value}" is not on the ${dimension} scale (${DIMENSION_SCALES[dimension].join(" | ")})`
    );
  }
  return { ...profile, [dimension]: { ...record } };
}
