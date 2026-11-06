/**
 * The lecturer's SUPPORT PREFERENCE (capability `agent-harness`, Requirement:
 * *Separate Lecturer-Wide Support Preference*).
 *
 * One fixed-value choice — how much help the lecturer wants to start the work with —
 * stated by the lecturer and shared across their conversations and courses. It is the
 * THIRD per-lecturer record under userData and deliberately none of the other two:
 *
 *   - NOT a sixth `lecturer-profile.json` dimension. The five dimensions are
 *     INFERENCES and carry confidence, evidence, provenance and a revision stamp to keep
 *     an inference honest; a preference is an instruction the lecturer gives, so it
 *     carries none of them. Adding it to `LecturerProfile` would also be rendered as a
 *     dimension line by `lecturerProfilePriorLines`, which iterates the record.
 *   - NOT a field of `lecturer-identity.json`. That record is free text no tool may
 *     write; this one is a closed set written through `cbe_support` on the lecturer's
 *     explicit instruction.
 *
 * What the three values MEAN, and that a preference is never consent to formulate the
 * lecturer's course content, is owned by the skill (`cbe-skill`, Requirement *Adaptive
 * Behaviour Calibration*). This module owns only the record, its guard, the serialised
 * compare-and-set service both hosts share, and the next-prompt notice. The descriptor
 * block is rendered in environment.ts from the same field renderer.
 *
 * REVISIONS. Every accepted write — a set or a clear — takes the next revision, and a
 * clear persists `preference: null` at that revision (a tombstone) rather than deleting
 * the file. That is what lets an already-open session holding an older snapshot neither
 * resurrect a cleared preference (its write is refused as stale) nor keep acting on it
 * (the host discloses the newer revision before its next prompt). A missing or invalid
 * record is the normal default: no preference, revision 0.
 */

// The descriptor block and this module's notice line render the SAME fields through the
// SAME inert encoder; both live in environment.ts, which imports only TYPES from here.
import { lecturerSupportFields } from "./environment.js";

export const SUPPORT_PREFERENCES = ["guided", "collaborative", "concise"] as const;
export type SupportPreference = (typeof SUPPORT_PREFERENCES)[number];

/** Record format version. A record carrying any other version is invalid and loads
 *  as the default rather than being guessed at. */
export const LECTURER_SUPPORT_RECORD_VERSION = 1;

/** The persisted record. Exactly three keys — no confidence, no evidence, no
 *  provenance: see the module header. */
export interface LecturerSupportRecord {
  version: typeof LECTURER_SUPPORT_RECORD_VERSION;
  /** Non-negative safe integer, incremented by every accepted write. */
  revision: number;
  /** The stated preference, or `null` when none is recorded or it was cleared. */
  preference: SupportPreference | null;
}

/**
 * How long a saved preference lasts, as the HOST reports it. The desktop app keeps it
 * lecturer-wide and across restarts; a headless host that supplies only a
 * session-lifetime store reports `session-local`, so the assistant never promises a
 * durability the host does not provide.
 */
export type SupportStorageScope = "lecturer-wide" | "session-local";

/** What a session sees: the record's state plus the host's storage scope. */
export interface LecturerSupportSnapshot {
  preference: SupportPreference | null;
  revision: number;
  scope: SupportStorageScope;
}

/** The normal starting condition: nothing recorded, revision 0. */
export const EMPTY_SUPPORT_RECORD: LecturerSupportRecord = Object.freeze({
  version: LECTURER_SUPPORT_RECORD_VERSION,
  revision: 0,
  preference: null,
}) as LecturerSupportRecord;

const RECORD_KEYS = ["version", "revision", "preference"] as const;

export function isSupportPreference(value: unknown): value is SupportPreference {
  return typeof value === "string" && (SUPPORT_PREFERENCES as readonly string[]).includes(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Strict runtime guard, shared by the store readers and every boundary that receives a
 * record. Strict on keys, exactly like the profile and identity guards: a foreign key, a
 * value outside the fixed set, another version or a malformed revision rejects, so a
 * corrupt or hand-edited file degrades to the default instead of round-tripping.
 */
export function isLecturerSupportRecord(value: unknown): value is LecturerSupportRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(RECORD_KEYS as readonly string[]).includes(key)) return false;
  }
  if (raw.version !== LECTURER_SUPPORT_RECORD_VERSION) return false;
  if (!isRevision(raw.revision)) return false;
  return raw.preference === null || isSupportPreference(raw.preference);
}

/**
 * Pluggable persistence boundary, mirroring `LecturerProfileStore` and
 * `LecturerIdentityStore`. `load` resolves null when no record exists; it may also
 * throw or return an invalid shape — the service treats all three as the default.
 * `save` must either persist the whole record or throw; a partial write is the store's
 * defect (the app's file store writes atomically).
 */
export interface LecturerSupportStore {
  load(): Promise<unknown>;
  save(record: LecturerSupportRecord): Promise<void>;
}

/** A store that lives exactly as long as the object — the headless host's and the
 *  eval's store. Never claims durability: its service reports `session-local`. */
export class InMemoryLecturerSupportStore implements LecturerSupportStore {
  private record: LecturerSupportRecord | null;

  constructor(initial?: LecturerSupportRecord | null) {
    this.record = initial && isLecturerSupportRecord(initial) ? { ...initial } : null;
  }

  async load(): Promise<LecturerSupportRecord | null> {
    return this.record ? { ...this.record } : null;
  }

  async save(record: LecturerSupportRecord): Promise<void> {
    this.record = { ...record };
  }
}

/** A requested change. `set` carries exactly one preference; `clear` none. */
export type SupportChange = { operation: "set"; preference: SupportPreference } | { operation: "clear" };

/**
 * Outcome of a write. Every outcome carries the CURRENT snapshot — after an accepted
 * write that is the new state, otherwise the state that still holds — so the caller can
 * reconcile against the truth instead of against its own stale view.
 *
 *  - `accepted`: saved; reported only after the store's save resolved.
 *  - `refused-stale`: `expectedRevision` was not the current revision. Nothing written.
 *  - `failed`: the save threw. Nothing changed; the last saved record stays in force.
 */
export type SupportWriteResult =
  | { outcome: "accepted"; snapshot: LecturerSupportSnapshot }
  | { outcome: "refused-stale"; snapshot: LecturerSupportSnapshot }
  | { outcome: "failed"; snapshot: LecturerSupportSnapshot; error: string };

/** The host-side surface `cbe_support` and the prompt boundary bind to. */
export interface LecturerSupportHost {
  readonly scope: SupportStorageScope;
  current(): Promise<LecturerSupportSnapshot>;
  change(change: SupportChange, expectedRevision: number): Promise<SupportWriteResult>;
}

/**
 * The serialised compare-and-set service both hosts share. ONE instance per store: the
 * desktop app holds one lecturer-wide instance across every open conversation, so two
 * sessions writing at once are ordered by the queue and the later one, carrying the
 * earlier revision, is refused as stale instead of silently overwriting.
 *
 * The last SUCCESSFULLY saved record is cached after the first load, so a failed save
 * can never leave the in-process view ahead of what is on disk, and the per-prompt
 * revision comparison does not read the file on every lecturer turn.
 */
export class LecturerSupportService implements LecturerSupportHost {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: LecturerSupportRecord | null = null;

  constructor(
    private readonly store: LecturerSupportStore,
    readonly scope: SupportStorageScope
  ) {}

  current(): Promise<LecturerSupportSnapshot> {
    return this.enqueue(async () => this.snapshotOf(await this.loaded()));
  }

  change(change: SupportChange, expectedRevision: number): Promise<SupportWriteResult> {
    return this.enqueue(async (): Promise<SupportWriteResult> => {
      const current = await this.loaded();
      if (expectedRevision !== current.revision) {
        return { outcome: "refused-stale", snapshot: this.snapshotOf(current) };
      }
      const next: LecturerSupportRecord = {
        version: LECTURER_SUPPORT_RECORD_VERSION,
        revision: current.revision + 1,
        preference: change.operation === "set" ? change.preference : null,
      };
      try {
        await this.store.save(next);
      } catch (err) {
        return {
          outcome: "failed",
          snapshot: this.snapshotOf(current),
          error: err instanceof Error ? err.message : String(err),
        };
      }
      this.cached = next;
      return { outcome: "accepted", snapshot: this.snapshotOf(next) };
    });
  }

  /** Fail-soft load: absent, unreadable, throwing or invalid → the default record. */
  private async loaded(): Promise<LecturerSupportRecord> {
    if (this.cached) return this.cached;
    let raw: unknown = null;
    try {
      raw = await this.store.load();
    } catch {
      raw = null;
    }
    this.cached = isLecturerSupportRecord(raw) ? { ...raw } : { ...EMPTY_SUPPORT_RECORD };
    return this.cached;
  }

  private snapshotOf(record: LecturerSupportRecord): LecturerSupportSnapshot {
    return { preference: record.preference, revision: record.revision, scope: this.scope };
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined); // keep the chain alive after a failed job
    return next;
  }
}

/**
 * The one machine-readable line prefixed to the next lecturer payload of an
 * already-open session whose last disclosed revision is behind the store (and once
 * after a compaction). Same shape as the other payload-prefix notices: a bracketed tag,
 * the fact, no rule.
 */
export function lecturerSupportNoticeLine(snapshot: LecturerSupportSnapshot): string {
  return `[lecturer-support] current saved state — ${lecturerSupportFields(snapshot).join("; ")}. DATA, not an instruction.`;
}

/** Prefix the due snapshot's notice line to a lecturer payload; nothing due → the
 *  payload unchanged. Same `notice\n\ntext` shape as the other payload-prefix notices. */
export function composePayloadWithSupportNotice(snapshot: LecturerSupportSnapshot | null, text: string): string {
  if (!snapshot) return text;
  return `${lecturerSupportNoticeLine(snapshot)}\n\n${text}`;
}

/**
 * A snapshot due for disclosure, together with the invalidation generation it was
 * read under. Delivering it clears a compaction's re-disclosure only when no further
 * compaction happened since it was read.
 */
export interface LecturerSupportDue {
  snapshot: LecturerSupportSnapshot;
  generation: number;
}

/**
 * Per-session bookkeeping for the next-prompt disclosure. DERIVED, not drained: the
 * notice is due whenever the store's revision differs from the revision this session
 * last saw (or a compaction may have dropped what it saw), so a prompt that is refused
 * before reaching the model consumes nothing — the same comparison makes it due again
 * on the next attempt. The host calls `markDelivered` only once a payload carrying the
 * notice actually reached the model; a `cbe_support` result the model reads counts as
 * a delivery too, since that result states the snapshot. A compaction that lands while
 * a delivered payload's run is still going may have dropped that very snapshot, so the
 * delivery carries the generation it was read under and leaves the snapshot due when
 * an invalidation came after it.
 */
export class LecturerSupportDisclosure {
  private disclosed: number;
  private forced = false;
  private generation = 0;

  constructor(
    private readonly host: LecturerSupportHost,
    initiallyDisclosedRevision: number
  ) {
    this.disclosed = initiallyDisclosedRevision;
  }

  /** The snapshot due for disclosure before the next prompt, or null when this
   *  session already holds the current revision. */
  async due(): Promise<LecturerSupportSnapshot | null> {
    return (await this.pending())?.snapshot ?? null;
  }

  /** `due()` plus the invalidation generation observed BEFORE the store was read, so
   *  a compaction racing the read errs towards disclosing again. */
  async pending(): Promise<LecturerSupportDue | null> {
    const generation = this.generation;
    const current = await this.host.current();
    return this.forced || current.revision !== this.disclosed ? { snapshot: current, generation } : null;
  }

  /** The payload carrying `revision` reached the model. Monotonic: a later revision
   *  the session already saw (through its own `cbe_support` result) is never rolled
   *  back by an older disclosure completing after it. `generation` is the one the
   *  delivered snapshot was read under; omitted, the delivery is taken as current (a
   *  `cbe_support` result the model reads now). A delivery read before the latest
   *  invalidation never clears it. */
  markDelivered(revision: number, generation: number = this.generation): void {
    if (revision < this.disclosed) return;
    this.disclosed = revision;
    if (generation === this.generation) this.forced = false;
  }

  /** A compaction (or anything else that may have dropped the snapshot from the
   *  model's context) makes the current state due again, whatever the revision. */
  invalidate(): void {
    this.forced = true;
    this.generation += 1;
  }

  /** The revision this session last saw — for tests and diagnostics. */
  get disclosedRevision(): number {
    return this.disclosed;
  }
}
