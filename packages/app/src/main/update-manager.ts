import { app, ipcMain, type BrowserWindow } from "electron";
import path from "node:path";
import { Channels, type UpdateActionPayload, type UpdateEvent } from "../shared/ipc-contract.js";
import { readSkippedVersion, shouldOfferUpdate, writeSkippedVersion } from "./update-policy.js";

/**
 * Auto-update wiring (capability `distribution`, Requirement: Auto-update
 * mechanism). electron-updater's generic provider checks the feed URL embedded
 * by electron-builder (`build.publish` in package.json — the Cloudflare worker
 * `/update/*` route, see docs/auto-update.md). Nothing here blocks the app:
 * the renderer shows a non-blocking notice, the user decides.
 *
 * Inert in dev (`!app.isPackaged`) — there is no app-update.yml to read.
 */

// Changelog link shown in the update notice. The GitHub release page is
// private; the portal build page is what testers can actually open.
const NOTES_URL = "https://cbe-stories.pages.dev/build/";

const PREFS_PATH = () => path.join(app.getPath("userData"), "update-prefs.json");

export function registerUpdateManager(win: BrowserWindow): void {
  ipcMain.handle(Channels.updateAction, async (_e, payload: UpdateActionPayload) => {
    if (payload.action === "skip") {
      await writeSkippedVersion(PREFS_PATH(), payload.version);
      return { ok: true };
    }
    if (!app.isPackaged) return { ok: true };
    const { autoUpdater } = await import("electron-updater");
    if (payload.action === "download") {
      // Failures surface as an updater "error" event → non-blocking note.
      void autoUpdater.downloadUpdate().catch(() => {});
    } else if (payload.action === "install") {
      autoUpdater.quitAndInstall();
    }
    // "later" is a renderer-side dismiss; nothing to persist.
    return { ok: true };
  });

  if (!app.isPackaged) return;

  void (async () => {
    const { autoUpdater } = await import("electron-updater");
    const send = (evt: UpdateEvent) => {
      if (!win.isDestroyed()) win.webContents.send(Channels.updateEvent, evt);
    };

    // The user decides when to download/install (Scenario: User can decline
    // updates) — never auto-download, never install behind their back.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("update-available", (info) => {
      void readSkippedVersion(PREFS_PATH()).then((skipped) => {
        if (shouldOfferUpdate(info.version, skipped)) {
          send({ type: "available", version: info.version, notesUrl: NOTES_URL });
        }
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      send({ type: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (err) => {
      // Reaches the renderer only while an update flow is visible; a failed
      // background check stays silent (offline is not an error state).
      send({ type: "error", message: err.message });
      console.error("auto-update error:", err);
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error("auto-update check failed:", err);
    }
  })();
}
