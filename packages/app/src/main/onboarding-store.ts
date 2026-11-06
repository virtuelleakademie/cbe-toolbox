import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OnboardingAcknowledgeResult, OnboardingReadResult } from "../shared/ipc-contract.js";

/**
 * Main-process owner of the once-per-local-app-data-profile first-use marker.
 *
 * Electron stays outside this module: the caller injects a path below userData,
 * which lets the persistence contract run against real temporary directories in
 * tests. The record is intentionally independent of provider, course and
 * lecturer data; its schema version is a storage version, not a tour version.
 */
export class FileOnboardingStore {
  private readonly filePath: string;
  private acknowledgedInMemory = false;
  private persisted = false;
  private persistFailed = false;
  private writeInFlight: Promise<OnboardingAcknowledgeResult> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get location(): string {
    return this.filePath;
  }

  /**
   * Read the durable marker. Missing and malformed records are ordinary pending
   * state; an actual read failure is reported softly. A concurrent acknowledge
   * always wins: the post-read memory check prevents a delayed read from
   * restoring the offer after an accepted dispatch.
   */
  async read(): Promise<OnboardingReadResult> {
    if (this.acknowledgedInMemory) return { acknowledged: true };

    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (this.acknowledgedInMemory) return { acknowledged: true };
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { acknowledged: false };
      return { acknowledged: false, issue: "unreadable" };
    }

    if (this.acknowledgedInMemory) return { acknowledged: true };
    try {
      const parsed = JSON.parse(raw) as { schemaVersion?: unknown; acknowledged?: unknown };
      if (parsed?.schemaVersion === 1 && parsed.acknowledged === true) {
        this.acknowledgedInMemory = true;
        this.persisted = true;
        return { acknowledged: true };
      }
    } catch {
      // A malformed record is deliberately the same as no record. It is replaced
      // only if the lecturer later acknowledges; reading never mutates app data.
    }
    return { acknowledged: false };
  }

  /**
   * Acknowledge immediately in memory, then atomically replace the marker on
   * disk. A failed write never re-arms the offer during this main-process
   * lifetime, including across renderer reloads. Once a write has failed the
   * implicit route — every accepted lecturer dispatch — stops attempting it, so
   * ordinary work never drives a repeated write. Only an explicit close asks for
   * one further attempt (`retryPersistence`); there is no timer or retry loop.
   */
  acknowledge(options?: { retryPersistence?: boolean }): Promise<OnboardingAcknowledgeResult> {
    this.acknowledgedInMemory = true;
    if (this.persisted) return Promise.resolve({ acknowledged: true, persisted: true });
    if (this.writeInFlight) return this.writeInFlight;
    if (this.persistFailed && !options?.retryPersistence) {
      return Promise.resolve({ acknowledged: true, persisted: false });
    }

    const operation: Promise<OnboardingAcknowledgeResult> = this.persistAtomically()
      .then(() => {
        this.persisted = true;
        this.persistFailed = false;
        return { acknowledged: true as const, persisted: true };
      })
      .catch(() => {
        this.persistFailed = true;
        return { acknowledged: true as const, persisted: false };
      });
    this.writeInFlight = operation.finally(() => {
      this.writeInFlight = null;
    });
    return this.writeInFlight;
  }

  private async persistAtomically(): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, acknowledged: true }, null, 2) + "\n", "utf8");
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
