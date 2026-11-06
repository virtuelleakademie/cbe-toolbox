import { useEffect, useState } from "react";
import type { CorpusInfo, CorpusRefreshResult } from "../../shared/ipc-contract.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";
import { formatTimestamp, useChrome } from "../chrome.js";

type RefreshNotice =
  | { kind: "outcome"; outcome: CorpusRefreshResult; infoReadFailed: boolean }
  | { kind: "unexpected" };

export interface CorpusRefreshPresentation {
  ok: boolean;
  message: string;
}

const SIGNED_REFUSAL_CODES = new Set([
  "not-provisioned",
  "metadata-too-large",
  "signature-wrapper-invalid",
  "signature-invalid",
  "root-key-id-mismatch",
  "metadata-schema-invalid",
  "pack-mismatch",
  "channel-mismatch",
  "keyset-rollback",
  "keyset-equivocation",
  "key-revoked",
  "key-not-authorized",
  "metadata-expired",
  "metadata-from-future",
  "epoch-not-authorized",
  "rollback",
  "equivocation",
  "compatibility-mismatch",
]);
const SIGNED_TRANSPORT_CODES = new Set([
  "metadata-http",
  "metadata-read",
  "metadata-too-large",
  "redirect-refused",
  "artifact-http",
  "artifact-read",
  "artifact-too-large",
  "artifact-size-mismatch",
  "artifact-hash-mismatch",
  "artifact-path-invalid",
  "archive-invalid",
  "content-invalid",
  "install-failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Runtime IPC guard: a stale or malformed preload must not become display copy. */
export function parseCorpusRefreshResult(value: unknown): CorpusRefreshResult | null {
  const result = record(value);
  if (!result || typeof result.status !== "string") return null;

  if (result.status === "updated" || result.status === "up-to-date") {
    return typeof result.version === "string" && result.version.length > 0
      ? { status: result.status, version: result.version }
      : null;
  }
  if (result.status === "integrity-mismatch") {
    return typeof result.expected === "string" &&
      result.expected.length > 0 &&
      typeof result.actual === "string" &&
      result.actual.length > 0
      ? { status: result.status, expected: result.expected, actual: result.actual }
      : null;
  }
  if (result.status === "signed-refused") {
    if (typeof result.code !== "string" || !SIGNED_REFUSAL_CODES.has(result.code)) return null;
    if (result.field !== undefined && typeof result.field !== "string") return null;
    return {
      status: "signed-refused",
      code: result.code as Extract<CorpusRefreshResult, { status: "signed-refused" }>["code"],
      ...(typeof result.field === "string" ? { field: result.field } : {}),
    };
  }
  if (result.status === "signed-unavailable") {
    if (typeof result.code !== "string" || !SIGNED_TRANSPORT_CODES.has(result.code)) return null;
    if (
      result.httpStatus !== undefined &&
      (typeof result.httpStatus !== "number" || !Number.isFinite(result.httpStatus))
    ) {
      return null;
    }
    return {
      status: "signed-unavailable",
      code: result.code as Extract<CorpusRefreshResult, { status: "signed-unavailable" }>["code"],
      ...(typeof result.httpStatus === "number" ? { httpStatus: result.httpStatus } : {}),
    };
  }
  if (result.status !== "unavailable") return null;

  const reason = record(result.reason);
  if (!reason || typeof reason.code !== "string") return null;
  switch (reason.code) {
    case "not-configured":
    case "pointer-read":
    case "pointer-invalid":
    case "download-read":
    case "install-failed":
      return { status: "unavailable", reason: { code: reason.code } };
    case "pointer-http":
    case "download-http":
      return typeof reason.httpStatus === "number" && Number.isFinite(reason.httpStatus)
        ? { status: "unavailable", reason: { code: reason.code, httpStatus: reason.httpStatus } }
        : null;
    case "missing-marker":
      return typeof reason.markerFile === "string" && reason.markerFile.length > 0
        ? { status: "unavailable", reason: { code: reason.code, markerFile: reason.markerFile } }
        : null;
    case "unsafe-entry":
      return typeof reason.entryName === "string" && reason.entryName.length > 0
        ? { status: "unavailable", reason: { code: reason.code, entryName: reason.entryName } }
        : null;
    default:
      return null;
  }
}

/** Total semantic-outcome projection. It reads only typed facts and the catalogue in hand. */
export function presentCorpusRefresh(notice: RefreshNotice, t: ChromeCatalogue): CorpusRefreshPresentation {
  if (notice.kind === "unexpected") return { ok: false, message: t.corpusRefreshUnexpected };

  const { outcome } = notice;
  let presentation: CorpusRefreshPresentation;
  if (outcome.status === "updated") {
    presentation = { ok: true, message: t.corpusUpdated({ version: outcome.version }) };
  } else if (outcome.status === "up-to-date") {
    presentation = { ok: true, message: t.corpusUpToDate({ version: outcome.version }) };
  } else if (outcome.status === "integrity-mismatch") {
    presentation = { ok: false, message: t.corpusIntegrityMismatch };
  } else if (outcome.status === "signed-refused") {
    presentation = {
      ok: false,
      message: t.corpusRefreshSignedRefused({ code: outcome.code, field: outcome.field ?? "" }),
    };
  } else if (outcome.status === "signed-unavailable") {
    presentation = { ok: false, message: t.corpusRefreshSignedUnavailable({ code: outcome.code }) };
  } else {
    switch (outcome.reason.code) {
      case "not-configured":
        presentation = { ok: false, message: t.corpusRefreshNotConfigured };
        break;
      case "pointer-http":
        presentation = {
          ok: false,
          message: t.corpusRefreshPointerHttp({ httpStatus: outcome.reason.httpStatus }),
        };
        break;
      case "pointer-read":
        presentation = { ok: false, message: t.corpusRefreshPointerRead };
        break;
      case "pointer-invalid":
        presentation = { ok: false, message: t.corpusRefreshPointerInvalid };
        break;
      case "download-http":
        presentation = {
          ok: false,
          message: t.corpusRefreshDownloadHttp({ httpStatus: outcome.reason.httpStatus }),
        };
        break;
      case "download-read":
        presentation = { ok: false, message: t.corpusRefreshDownloadRead };
        break;
      case "missing-marker":
        presentation = {
          ok: false,
          message: t.corpusRefreshMissingMarker({ markerFile: outcome.reason.markerFile }),
        };
        break;
      case "unsafe-entry":
        presentation = {
          ok: false,
          message: t.corpusRefreshUnsafeEntry({ entryName: outcome.reason.entryName }),
        };
        break;
      case "install-failed":
        presentation = { ok: false, message: t.corpusRefreshInstallFailed };
        break;
    }
  }

  return notice.infoReadFailed
    ? { ...presentation, message: `${presentation.message} ${t.corpusInfoReloadFailed}` }
    : presentation;
}

/**
 * Corpus-state section (capability `distribution`, Requirement: Corpus
 * Distribution as Downloadable Bundle — Scenario: Corpus version auditable
 * from the app): shows the loaded corpus version and cache date, and offers a
 * refresh affordance that pulls the latest bundle on demand without restarting
 * the app. A failed refresh never unloads the current corpus.
 *
 * The notice holds the SEMANTIC outcome and resolves its wording at render time
 * (Requirement: Corpus Refresh Outcomes Resolve at Render Time) — storing a
 * formatted sentence would freeze an already visible notice in the language it
 * arrived in, and re-requesting the refresh to re-language it is forbidden.
 */
export function CorpusStatus() {
  const t = useChrome();
  const [info, setInfo] = useState<CorpusInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RefreshNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cbe
      .getCorpusInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        // Initial-load policy is unchanged: the surface keeps its empty values.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setBusy(true);
    setNotice(null);
    try {
      let rawResult: unknown;
      try {
        rawResult = await window.cbe.refreshCorpus();
      } catch {
        setNotice({ kind: "unexpected" });
        return;
      }

      const outcome = parseCorpusRefreshResult(rawResult);
      if (!outcome) {
        setNotice({ kind: "unexpected" });
      } else {
        setNotice({ kind: "outcome", outcome, infoReadFailed: false });
      }

      try {
        setInfo(await window.cbe.getCorpusInfo());
      } catch {
        // An unparsable result already stands as the unexpected fallback above.
        if (outcome) setNotice({ kind: "outcome", outcome, infoReadFailed: true });
      }
    } finally {
      setBusy(false);
    }
  }

  // Formatted for the ACTIVE INTERFACE LANGUAGE's declared tag, not the ambient
  // system locale — which is not the value the interface setting decides.
  const cacheDate = info?.cacheDate ? formatTimestamp(new Date(info.cacheDate)) : null;
  const presentation = notice ? presentCorpusRefresh(notice, t) : null;

  return (
    <div className="corpus-status">
      <div className="set-row">
        <div className="rk">{t.corpusVersionLabel}</div>
        <span className="set-val mono">{info?.version ?? t.corpusEmptyValue}</span>
      </div>
      <div className="set-row">
        <div className="rk">{t.corpusCacheDateLabel}</div>
        <span className="set-val">{cacheDate ?? t.corpusShippedWithApp}</span>
      </div>
      {info?.pack && (
        <div className="set-row">
          <div className="rk">{t.corpusPackIdentityLabel}</div>
          <span className="set-val mono">
            {t.corpusPackIdentityValue({
              channel: info.pack.channel,
              epoch: info.pack.epoch,
              sequence: info.pack.sequence,
              keyId: info.pack.signerKeyId,
            })}
          </span>
        </div>
      )}
      <div className="set-actions">
        <button className="set-secondary" type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? t.corpusRefreshing : t.corpusRefresh}
        </button>
      </div>
      {presentation && (
        <p className={`set-note ${presentation.ok ? "set-note-ok" : "set-note-warn"}`} role="status">
          {presentation.message}
        </p>
      )}
    </div>
  );
}
