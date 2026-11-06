/**
 * File-backed lecturer-profile store (capability `agent-harness`, Requirement:
 * Per-Lecturer Profile Store). One human-readable JSON record per userData
 * directory; the path is injected by the host (agent.ts passes
 * `<userData>/lecturer-profile.json`) so this module stays electron-free and
 * unit-testable against a temp directory.
 *
 * The record contains ONLY structured dimension records — never transcripts —
 * and is validated through the shared pi-bridge guard on every load, so a
 * corrupted or foreign file degrades to a cold start instead of poisoning the
 * session (scenario: Absent record means cold start).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  applyProfileUpdate,
  isLecturerProfile,
  isValidDimensionValue,
  type Confidence,
  type LecturerProfile,
  type LecturerProfileStore,
  type ProfileDimension,
} from "@cbe/pi-bridge/lecturer-profile";

export class FileLecturerProfileStore implements LecturerProfileStore {
  constructor(private readonly filePath: string) {}

  /** The absolute path of the backing file (surfaced for diagnostics/tests). */
  get location(): string {
    return this.filePath;
  }

  async load(): Promise<LecturerProfile | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null; // absent file → cold start
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isLecturerProfile(parsed) ? parsed : null;
    } catch {
      return null; // unparseable → cold start, never throw into session start
    }
  }

  async save(profile: LecturerProfile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Pretty-printed on purpose: the stakeholder DoD requires the record to be
    // human-readable and inspectable by the lecturer.
    await writeFile(this.filePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
  }
}

export interface ProfileEstimateInput {
  dimension: ProfileDimension;
  value: string;
  confidence: Confidence;
  evidence: string;
  /** True when the lecturer explicitly confirmed this revision in conversation —
   * the only way an estimate may replace a panel override. */
  lecturerConfirmed?: boolean;
}

/** Outcome of an estimate application. `rejected-override` MUST NOT be silent at
 * the host layer — the caller surfaces it to the agent (capability `desktop-app`,
 * Requirement: Profile Panel). */
export interface ProfileEstimateResult {
  outcome: "applied" | "rejected-override" | "rejected-invalid";
  profile: LecturerProfile;
}

/**
 * Serialised read-modify-write façade over a `LecturerProfileStore`. Every
 * accepted `cbe_profile` tool call and every panel override flows through here
 * so concurrent updates cannot lose writes (single in-process queue).
 *
 * Precedence rule (capability `agent-harness`, Requirement: Per-Lecturer
 * Profile Store): a dimension with provenance `override` is the lecturer's word —
 * an unconfirmed ESTIMATE never overwrites it. It changes via a new panel
 * override, or via a `cbe_profile` call carrying `lecturerConfirmed: true`
 * after the lecturer explicitly confirmed the revision in conversation; the
 * accepted revision is model-estimated again (provenance `estimate`).
 * Conservative default: when in doubt, keep the lecturer's value — but never
 * silently (the outcome tells the caller what happened).
 */
export class LecturerProfileService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LecturerProfileStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  current(): Promise<LecturerProfile | null> {
    return this.enqueue(async () => this.store.load());
  }

  /** Apply a skill-emitted estimate. A dimension under lecturer override is left
   * untouched unless the call is lecturer-confirmed; the outcome reports which
   * path was taken so a rejection is never silent. */
  applyEstimate(input: ProfileEstimateInput): Promise<ProfileEstimateResult> {
    return this.enqueue(async () => {
      const profile = (await this.store.load()) ?? {};
      if (!isValidDimensionValue(input.dimension, input.value)) return { outcome: "rejected-invalid", profile }; // refused upstream too
      if (profile[input.dimension]?.provenance === "override" && input.lecturerConfirmed !== true)
        return { outcome: "rejected-override", profile };
      const next = applyProfileUpdate(profile, input.dimension, {
        value: input.value,
        confidence: input.confidence,
        evidence: input.evidence,
        provenance: "estimate",
        lastRevised: this.now(),
      });
      await this.store.save(next);
      return { outcome: "applied", profile: next };
    });
  }

  /** Apply a lecturer override from the Profile Panel. Always wins. */
  applyOverride(dimension: ProfileDimension, value: string): Promise<LecturerProfile> {
    return this.enqueue(async () => {
      const profile = (await this.store.load()) ?? {};
      if (!isValidDimensionValue(dimension, value)) return profile;
      const next = applyProfileUpdate(profile, dimension, {
        value,
        confidence: "high",
        evidence: "set by the lecturer in the Profile Panel",
        provenance: "override",
        lastRevised: this.now(),
      });
      await this.store.save(next);
      return next;
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined); // keep the chain alive after a failed job
    return next;
  }
}

/** The system note queued for running sessions when the lecturer overrides a
 * dimension in the Profile Panel (next-turn-boundary visibility). */
export function profileOverrideNote(dimension: ProfileDimension, value: string): string {
  return (
    `The lecturer manually set the profile dimension "${dimension}" to "${value}" in the ` +
    `Profile Panel (provenance: override). Calibrate on this value from now on; do not ` +
    `revise it without their explicit confirmation.`
  );
}

/** The system note queued when a `cbe_profile` estimate was rejected because the
 * dimension is under a lecturer override and the call was not lecturer-confirmed.
 * Surfaces the silent drop to the agent at the next turn boundary (capability
 * `desktop-app`, Requirement: Profile Panel — scenario "Rejected estimate is
 * surfaced to the agent, panel unchanged"). */
export function profileEstimateRejectedNote(dimension: ProfileDimension, value: string): string {
  return (
    `Your cbe_profile update setting "${dimension}" to "${value}" was NOT applied: the lecturer ` +
    `set this dimension manually in the Profile Panel and their value stands. Do not narrate the ` +
    `revision as done. To change it, the lecturer either edits it in the Profile Panel, or you ` +
    `re-emit the update with lecturerConfirmed: true after they explicitly confirm the change in ` +
    `the conversation.`
  );
}

/** Prepends queued profile notes to the next prompt as one bracketed system note.
 * The composed text goes to the model AND into the session transcript (the
 * transcript is never lossy w.r.t. the model payload). No notes → text unchanged. */
export function composePromptWithProfileNotes(notes: string[], text: string): string {
  return notes.length ? `[System note: ${notes.join(" ")}]\n\n${text}` : text;
}
