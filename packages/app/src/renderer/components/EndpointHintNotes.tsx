import { deriveEndpointHints } from "../util/endpoint-hints.js";
import { useChrome } from "../chrome.js";

/**
 * Non-blocking endpoint guidance shared by the onboarding `ConfigDialog` and the
 * Settings `SettingsPanel` (desktop-app spec, Requirement: Provider Configuration
 * Input Hygiene). Renders an Azure-shape hint and/or a plain-http cleartext
 * warning derived from the sanitised base URL. Never blocks Save, never rewrites
 * the input. Renders nothing when there is no hint.
 */
export function EndpointHintNotes({ baseURL }: { baseURL: string }) {
  const t = useChrome();
  const hints = deriveEndpointHints(baseURL);
  if (!hints.azureSuggestion && !hints.cleartextWarning) return null;
  return (
    <>
      {hints.azureSuggestion && (
        <p className="set-note set-note-hint" role="note">
          {t.settingsAzureHintBefore} <code>{hints.azureSuggestion}</code>.
        </p>
      )}
      {hints.cleartextWarning && (
        <p className="set-note set-note-warn" role="note">
          {t.settingsCleartextWarningBefore} <code>http://</code> {t.settingsCleartextWarningMiddle}{" "}
          <code>https://</code>
          {t.settingsCleartextWarningAfter}
        </p>
      )}
    </>
  );
}
