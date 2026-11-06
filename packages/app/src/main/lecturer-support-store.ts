/**
 * File-backed store for the lecturer's SUPPORT PREFERENCE (capability `agent-harness`,
 * Requirement: Separate Lecturer-Wide Support Preference). One human-readable JSON record
 * per userData directory at `<userData>/lecturer-support.json` — beside
 * `lecturer-profile.json` and `lecturer-identity.json`, never inside either, and never in
 * a course directory, so a course switch, a new conversation or a course deletion
 * neither clears nor copies it. The path is injected by the host (agent.ts) so this
 * module stays electron-free and unit-testable against a temp directory.
 *
 * Load is fail-soft — an absent, unreadable or guard-failing file is "no preference" —
 * and validated through the shared pi-bridge guard. Save is ATOMIC: the record is written
 * to a sibling temp file and renamed over the target, so a crash or a full disk mid-write
 * leaves the previous record intact rather than a truncated one that would load as the
 * default and silently drop the lecturer's choice. Ordering, compare-and-set and the
 * revisioned clear live in the shared `LecturerSupportService`; the app holds ONE
 * instance of it for every open conversation.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isLecturerSupportRecord,
  type LecturerSupportRecord,
  type LecturerSupportStore,
} from "@cbe/pi-bridge/lecturer-support";

export class FileLecturerSupportStore implements LecturerSupportStore {
  constructor(private readonly filePath: string) {}

  /** The absolute path of the backing file (surfaced for diagnostics/tests). */
  get location(): string {
    return this.filePath;
  }

  async load(): Promise<LecturerSupportRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null; // absent or unreadable → no preference
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isLecturerSupportRecord(parsed) ? parsed : null;
    } catch {
      return null; // unparseable → no preference, never throw into session start
    }
  }

  async save(record: LecturerSupportRecord): Promise<void> {
    if (!isLecturerSupportRecord(record)) throw new Error("refusing to save an invalid support record");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      // Pretty-printed on purpose: the record is the lecturer's own data and must be
      // inspectable by them, the same discipline the profile and identity records follow.
      await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
      await rename(tmp, this.filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}
