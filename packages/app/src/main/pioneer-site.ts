import { ipcMain, shell, type BrowserWindow } from "electron";
import { Channels, type PioneerSiteOpenResult } from "../shared/ipc-contract.js";

/** The entire external-navigation allowlist for this feature. */
export const PIONEER_ALLIANCE_URL = "https://pioneer-alliance.eu" as const;

/**
 * Open the fixed official destination in the system browser. The caller cannot
 * provide a URL; injection exists only so the exact host behavior is testable.
 */
export async function openPioneerAllianceSite(
  openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url)
): Promise<PioneerSiteOpenResult> {
  try {
    await openExternal(PIONEER_ALLIANCE_URL);
    return { ok: true };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}

/** Runtime boundary used by the IPC handler. Any supplied value is a refusal —
 * including a caller supplying the official URL — because this capability has
 * no destination parameter at all. */
export async function handlePioneerSiteRequest(
  args: readonly unknown[],
  openExternal?: (url: string) => Promise<void>
): Promise<PioneerSiteOpenResult> {
  if (args.length !== 0) return { ok: false, reason: "refused" };
  return openPioneerAllianceSite(openExternal);
}

/** Register the parameterless IPC capability for one owned application window. */
export function registerPioneerSiteIpc(win: BrowserWindow): void {
  ipcMain.handle(Channels.pioneerSiteOpen, async (event, ...args: unknown[]): Promise<PioneerSiteOpenResult> => {
    if (event.sender !== win.webContents) return { ok: false, reason: "refused" };
    return handlePioneerSiteRequest(args);
  });
}
