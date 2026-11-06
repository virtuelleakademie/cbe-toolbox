import { readFile, writeFile } from "node:fs/promises";

/**
 * Pure decision + persistence logic for the auto-updater (capability
 * `distribution`, Requirement: Auto-update mechanism — Scenario: User can
 * decline updates). Electron-free so it is testable outside the shell;
 * `update-manager.ts` owns the electron-updater wiring.
 */

interface UpdatePrefs {
  skippedVersion?: string;
}

/** A skipped version is never offered again; anything else is. */
export function shouldOfferUpdate(availableVersion: string, skippedVersion: string | null): boolean {
  return availableVersion !== "" && availableVersion !== skippedVersion;
}

export async function readSkippedVersion(prefsPath: string): Promise<string | null> {
  try {
    const prefs = JSON.parse(await readFile(prefsPath, "utf8")) as UpdatePrefs;
    return prefs.skippedVersion ?? null;
  } catch {
    return null;
  }
}

export async function writeSkippedVersion(prefsPath: string, version: string): Promise<void> {
  await writeFile(prefsPath, JSON.stringify({ skippedVersion: version } satisfies UpdatePrefs, null, 2) + "\n");
}
