import { useMemo, useState } from "react";
import { useCbe } from "../state/store.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { sanitiseProviderField } from "../util/sanitize.js";
import { EndpointHintNotes } from "./EndpointHintNotes.js";
import { useChrome } from "../chrome.js";

export function ConfigDialog() {
  const t = useChrome();
  const setConfigured = useCbe((s) => s.setConfigured);
  const setProviderStatus = useCbe((s) => s.setProviderStatus);
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The `ready` predicate validates the SANITISED values, not the raw input
  // state. A paste of `""`, `''` or `` `` `` ` `` (a "no key needed" placeholder)
  // would pass a raw `apiKey.trim()` check but sanitise to an empty string —
  // the dialog must not enable Save in that case. See desktop-app spec,
  // Scenario: *Save button stays disabled when the typed apiKey sanitises to
  // an empty string*.
  const sanitised = useMemo(
    () => ({
      baseURL: sanitiseProviderField(baseURL),
      apiKey: sanitiseProviderField(apiKey),
      modelId: sanitiseProviderField(modelId),
    }),
    [baseURL, apiKey, modelId]
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await window.cbe.setConfig({
        baseURL: sanitised.baseURL,
        apiKey: sanitised.apiKey,
        modelId: sanitised.modelId,
      });
      setProviderStatus({ baseURL: sanitised.baseURL, modelId: sanitised.modelId, hasKey: true });
      setConfigured(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = !!sanitised.baseURL && !!sanitised.apiKey && !!sanitised.modelId;

  return (
    <section className="config-page" aria-label={t.configPageLabel}>
      <ThemeToggle variant="pill" />
      <div className="set-group">
        <span className="set-label mono">{t.configGroupLabel}</span>
        <p className="config-intro">{t.configIntro}</p>

        <div className="set-row">
          <div className="rk">
            {t.settingsBaseUrlLabel}
            <small>{t.configBaseUrlHint}</small>
          </div>
          <input
            className="set-input"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={t.settingsBaseUrlPlaceholder}
            autoFocus
          />
        </div>

        <EndpointHintNotes baseURL={sanitised.baseURL} />

        <div className="set-row">
          <div className="rk">
            {t.settingsApiKeyLabel}
            <small>{t.configApiKeyHint}</small>
          </div>
          <input
            className="set-input"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t.settingsApiKeyPlaceholder}
          />
        </div>

        <div className="set-row">
          <div className="rk">
            {t.settingsModelIdLabel}
            <small>{t.configModelIdHint}</small>
          </div>
          <input
            className="set-input"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder={t.configModelIdPlaceholder}
          />
        </div>

        {error && <p className="config-error">{error}</p>}

        <button className="send" onClick={() => void save()} disabled={!ready || busy}>
          {busy ? t.settingsSaving : t.settingsSave}
        </button>
      </div>
    </section>
  );
}
