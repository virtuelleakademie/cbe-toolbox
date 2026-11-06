/**
 * Per-lecturer IDENTITY record (capability `agent-harness`, Requirement:
 * *Per-Lecturer Identity Record*).
 *
 * Two optional, independent free-text fields — the lecturer's `name` and their
 * preferred `formOfAddress` — with the same per-lecturer scope, the same userData
 * directory, the same human-readable JSON and the same degrade-to-empty load
 * behaviour as the lecturer-PROFILE record, and a DIFFERENT record.
 *
 * WHY IT IS NOT A KEY IN `lecturer-profile.ts`. `LecturerProfile` is typed
 * `Partial<Record<ProfileDimension, DimensionRecord>>` — a map whose keys ARE the
 * five dimensions — and `lecturerProfilePriorLines` (environment.ts) renders the
 * prior by iterating `Object.entries(profile)`, emitting each entry as a dimension
 * line complete with `confidence`, `provenance` and `evidence`. A sibling `name`
 * key inside that object would therefore be emitted AS A DIMENSION by code already
 * in the tree. Separate record, separate guard, separate file.
 *
 * WHY THE RECORD CARRIES NO ESTIMATE MACHINERY. The five dimensions carry a
 * confidence, an evidence pointer, a provenance and a revision timestamp because
 * each value is an INFERENCE about a person and every one of those four properties
 * exists to keep an inference honest. A name is not an inference: it is a fact its
 * owner states, nobody else is in a position to estimate it, and a model-initiated
 * revision of it would be an error with no legitimate case behind it. So the record
 * has none of those fields, is written only by the lecturer, and is READ — never
 * written — by the assistant. There is deliberately no tool that can write it.
 */

/**
 * Documented maximum length of either field, in characters.
 *
 * A JUDGEMENT, not a measured limit: it is generous enough for a long honorific in
 * any script ("Frau Prof. Dr. rer. nat. …") and small enough that a pasted document
 * cannot become a prompt block. A value over it is REFUSED at the editing surface
 * with a visible reason (capability `desktop-app`, Requirement: *Lecturer Identity
 * in the User/Profile Area*) — never silently truncated on its way into the record.
 */
export const LECTURER_IDENTITY_MAX_LENGTH = 120;

/**
 * The record. Both fields optional and independent: either may be recorded while
 * the other stays in the not-recorded state, and `{}` — nothing recorded — is a
 * valid record and the normal starting condition.
 *
 * NO `confidence`, NO `evidence`, NO `provenance`, NO `lastRevised`. See the module
 * header: adding one of them would make this an estimate about the lecturer.
 */
export interface LecturerIdentity {
  /** The lecturer's name, exactly as they wrote it. */
  name?: string;
  /** How the lecturer wants to be addressed, in their own words and language. */
  formOfAddress?: string;
}

/** The two field names, so a consumer never has to spell them again. */
export const LECTURER_IDENTITY_FIELDS = ["name", "formOfAddress"] as const;
export type LecturerIdentityField = (typeof LECTURER_IDENTITY_FIELDS)[number];

/**
 * Pluggable persistence boundary, mirroring `LecturerProfileStore`. The app
 * implements it file-backed under userData; headless hosts may pass an in-memory or
 * no-op implementation. `load` resolves null when no record exists.
 */
export interface LecturerIdentityStore {
  load(): Promise<LecturerIdentity | null>;
  save(identity: LecturerIdentity): Promise<void>;
}

/**
 * THE not-recorded state, in one place (Requirement: *Per-Lecturer Identity
 * Record* — "Absent field, empty field and whitespace-only field MUST all resolve
 * to the same outcome").
 *
 * Returns the trimmed value, or `undefined` for anything that means "not
 * recorded": absent, a non-string, empty, whitespace-only. Trimming surrounding
 * whitespace is the ONLY transformation — no case change, no transliteration, no
 * expansion, no reordering. Every consumer routes through this so no downstream
 * code has to remember to trim, and no empty string can survive to be rendered.
 */
export function normaliseIdentityValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalise a whole record to the canonical shape: recorded fields present and
 * trimmed, unrecorded fields ABSENT (never `undefined`-valued, never `""`), and
 * every foreign key dropped. `{}` is the not-recorded record.
 */
export function normaliseLecturerIdentity(value: unknown): LecturerIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: LecturerIdentity = {};
  for (const field of LECTURER_IDENTITY_FIELDS) {
    const normalised = normaliseIdentityValue(raw[field]);
    if (normalised !== undefined) out[field] = normalised;
  }
  return out;
}

/**
 * Runtime type guard for the record, shared by the store reader and the IPC
 * boundary. Strict on keys, exactly as the profile guard is: anything outside the
 * two fields rejects, so a corrupted or foreign file never round-trips. A present
 * field must be a string; an absent one is legitimate.
 *
 * LENGTH IS NOT PART OF THE SHAPE. An over-long value is refused at the editing
 * surface with a visible reason; making the guard reject it would turn a
 * hand-edited file into a silently emptied record, which is the opposite of what
 * the refusal is for.
 */
export function isLecturerIdentity(value: unknown): value is LecturerIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, field] of Object.entries(value)) {
    if (!(LECTURER_IDENTITY_FIELDS as readonly string[]).includes(key)) return false;
    if (field !== undefined && typeof field !== "string") return false;
  }
  return true;
}

/** True when at least one field is recorded — the condition for rendering anything
 *  at all (Requirement: *Session-Start Identity Injection* — "Nothing recorded, no
 *  block"). */
export function hasRecordedIdentity(identity: LecturerIdentity | null | undefined): boolean {
  if (!identity) return false;
  return LECTURER_IDENTITY_FIELDS.some((field) => normaliseIdentityValue(identity[field]) !== undefined);
}

/** True when the value is within the documented maximum. Used by the editing
 *  surface and by the IPC boundary behind it; an absent value is within it. */
export function isWithinIdentityLimit(value: unknown): boolean {
  const normalised = normaliseIdentityValue(value);
  return normalised === undefined || normalised.length <= LECTURER_IDENTITY_MAX_LENGTH;
}
