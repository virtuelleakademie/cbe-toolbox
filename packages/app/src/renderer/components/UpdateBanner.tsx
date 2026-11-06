import { useEffect, useState } from "react";
import type { UpdateEvent } from "../../shared/ipc-contract.js";
import { useChrome } from "../chrome.js";

type Phase =
  | { kind: "hidden" }
  | { kind: "available"; version: string; notesUrl: string }
  | { kind: "downloading"; version: string }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

/**
 * Non-blocking update notice (capability `distribution`, Requirement:
 * Auto-update mechanism — Scenarios: Update notice on a new version / User can
 * decline updates). Renders nothing until the main process reports an
 * available update; "Later" and "Skip" close the notice without forcing
 * anything (skip persists via the main process so the version is not offered
 * again).
 */
export function UpdateBanner() {
  const t = useChrome();
  const [phase, setPhase] = useState<Phase>({ kind: "hidden" });

  useEffect(() => {
    return window.cbe.onUpdateEvent((evt: UpdateEvent) => {
      setPhase((current) => {
        if (evt.type === "available") return { kind: "available", version: evt.version, notesUrl: evt.notesUrl };
        if (evt.type === "downloaded") return { kind: "downloaded", version: evt.version };
        // Errors matter only while an update flow is on screen — a failed
        // background check must not raise a banner out of nowhere.
        if (current.kind === "hidden") return current;
        return { kind: "error", message: evt.message };
      });
    });
  }, []);

  if (phase.kind === "hidden") return null;

  if (phase.kind === "error") {
    return (
      <div className="banner-notice update-banner" role="status">
        <span>{t.updateFailed({ message: phase.message })}</span>
        <button type="button" className="banner-notice-close" onClick={() => setPhase({ kind: "hidden" })}>
          {t.updateDismiss}
        </button>
      </div>
    );
  }

  if (phase.kind === "downloading") {
    return (
      <div className="banner-notice update-banner" role="status">
        <span>{t.updateDownloading({ version: phase.version })}</span>
      </div>
    );
  }

  if (phase.kind === "downloaded") {
    return (
      <div className="banner-notice update-banner" role="status">
        <span>{t.updateDownloaded({ version: phase.version })}</span>
        <button
          type="button"
          className="update-banner-action"
          onClick={() => void window.cbe.updateAction({ action: "install", version: phase.version })}
        >
          {t.updateRestartAndInstall}
        </button>
        <button type="button" className="banner-notice-close" onClick={() => setPhase({ kind: "hidden" })}>
          {t.updateLater}
        </button>
      </div>
    );
  }

  const { version, notesUrl } = phase;
  return (
    <div className="banner-notice update-banner" role="status">
      <span>
        {t.updateAvailable({ version })}{" "}
        <a href={notesUrl} target="_blank" rel="noreferrer">
          {t.updateChangelog}
        </a>
      </span>
      <button
        type="button"
        className="update-banner-action"
        onClick={() => {
          void window.cbe.updateAction({ action: "download", version });
          setPhase({ kind: "downloading", version });
        }}
      >
        {t.updateInstallNow}
      </button>
      <button type="button" className="banner-notice-close" onClick={() => setPhase({ kind: "hidden" })}>
        {t.updateLater}
      </button>
      <button
        type="button"
        className="banner-notice-close"
        onClick={() => {
          void window.cbe.updateAction({ action: "skip", version });
          setPhase({ kind: "hidden" });
        }}
      >
        {t.updateSkipVersion}
      </button>
    </div>
  );
}
