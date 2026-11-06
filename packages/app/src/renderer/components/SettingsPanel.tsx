import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CHAT_TEXT_SIZES, useCbe, type SettingsGroup } from "../state/store.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { FlavourPicker } from "./FlavourPicker.js";
import { AccentPicker } from "./AccentPicker.js";
import { sanitiseProviderField } from "../util/sanitize.js";
import { EndpointHintNotes } from "./EndpointHintNotes.js";
import { CorpusStatus } from "./CorpusStatus.js";
import { ExplanationHelpButton, ExplanationTooltip, useActivatedExplanationReveal } from "./ExplanationTooltip.js";
import type { AboutInfo, ProviderConfigDto, ReasoningEffort, SkillUpdateStatus } from "../../shared/ipc-contract.js";
import { setActiveLanguage, useChrome, useInterfaceLanguage } from "../chrome.js";
import { interfaceLanguageOptions } from "../../shared/i18n/index.js";
import type { ChromeStringKey } from "../../shared/i18n/index.js";
import { FirstUseOverview } from "./FirstUseOverview.js";

/** Vite copies this generated build resource into the renderer bundle. It is the
 * same PNG the BrowserWindow/runtime path uses, not a separate renderer logo. */
const APP_IDENTITY_ICON = new URL("../../../buildResources/icon.png", import.meta.url).href;

/**
 * The Settings section of the Profile-and-Settings overlay (capability
 * `desktop-app`, Requirement: Settings Panel (Phase 1 scaffold)). No longer a
 * right-panel tab: it is reached from the header's gear.
 *
 * **Four groups, in this order, as a TRUE accordion — exactly one open at a
 * time**, and opening one closes the one that was open:
 *
 * 1. **Model** — the LLM connection, in TWO levels since
 *    `split-llm-settings-into-standard-and-advanced`: a default view carrying
 *    only what connects you (baseURL, modelId, a legible apiKey, the connection
 *    check, with Save as their commit action) beside the credential-presence
 *    indicator and the locality statement, and an **Advanced** disclosure
 *    carrying everything that calibrates or destroys (context length, reasoning
 *    + effort, the erasure control). Advanced is a disclosure INSIDE this group,
 *    never a fifth accordion group. First in the order because it is the only
 *    group that can leave the app unusable, and — since the header carries no
 *    provider or model readout — the app's ONLY home for the host and model id
 *    as configuration. First in the order is NOT the same as open on arrival.
 * 2. **Appearance** — theme, Catppuccin flavour, accent, chat text size.
 * 3. **About** — read-only facts about what is installed: the running app
 *    version and the loaded skill's name and version, each read from its
 *    real source through `cbe:about:info`.
 * 4. **Corpus** — loaded corpus version / cache date + "Refresh corpus"
 *    (capability `distribution`, Corpus Distribution as Downloadable Bundle).
 *
 * **Which group is open is decided by the store's two-branch rule**
 * (`showSettingsSurface`), not here and not by memory of the last one open:
 * every showing opens on Appearance except one that follows a dismissal which
 * left an unsaved edit, which opens on the group holding it.
 *
 * **A closed group is hidden, not unmounted.** The overlay's whole dismissal
 * contract rests on "nothing is lost by closing", and that has to hold for a trip
 * through another group too — a half-typed endpoint must not evaporate because
 * the lecturer glanced at Appearance. `hidden` keeps the closed body out of the
 * tab order and out of the accessibility tree while its React state stays alive.
 *
 * No Lecturer-profile group: the lecturer-state estimate is owned by the
 * overlay's SIBLING Profile section (Requirement: Profile Panel); a duplicate
 * placeholder here was redundant (change add-chat-text-size-and-trim-settings).
 */
export function SettingsPanel() {
  const t = useChrome();
  const openGroup = useCbe((s) => s.settingsOpenGroup);
  const setOpenGroup = useCbe((s) => s.setSettingsOpenGroup);
  return (
    <div className="settings-panel">
      <AccordionGroup group="model" title={t.settingsGroupModel} openGroup={openGroup} onOpen={setOpenGroup}>
        <LlmConnectionGroup />
      </AccordionGroup>
      <AccordionGroup group="appearance" title={t.settingsGroupAppearance} openGroup={openGroup} onOpen={setOpenGroup}>
        <AppearanceGroup />
      </AccordionGroup>
      <AccordionGroup group="about" title={t.settingsGroupAbout} openGroup={openGroup} onOpen={setOpenGroup}>
        <AboutGroup />
      </AccordionGroup>
      <AccordionGroup group="corpus" title={t.settingsGroupCorpus} openGroup={openGroup} onOpen={setOpenGroup}>
        <CorpusStatus />
      </AccordionGroup>
    </div>
  );
}

/**
 * One accordion group. The header is a button (label + chevron) exposing
 * `aria-expanded`; activating it OPENS this group, which closes whichever one was
 * open — the groups are no longer independent, and no interaction may leave two
 * open at once. Activating the already-open header is a no-op: the requirement
 * leaves "may a lecturer close the last open group" unconstrained, and one group
 * always open is the reading that never leaves the surface blank.
 */
function AccordionGroup({
  group,
  title,
  openGroup,
  onOpen,
  children,
}: {
  group: SettingsGroup;
  title: string;
  openGroup: SettingsGroup | null;
  onOpen: (g: SettingsGroup) => void;
  children: ReactNode;
}) {
  const open = openGroup === group;
  return (
    <div className={`set-group${open ? "" : " set-group-collapsed"}`} data-group={group}>
      <button type="button" className="set-acc-header" aria-expanded={open} onClick={() => onOpen(group)}>
        <span className="set-label">{title}</span>
        <svg
          className="set-acc-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className="set-acc-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function AppearanceGroup() {
  const t = useChrome();
  return (
    <>
      <div className="set-row set-row-stack">
        <div className="rk">
          {t.settingsThemeLabel}
          <small>{t.settingsThemeHint}</small>
        </div>
        <ThemeToggle variant="seg" />
      </div>

      <div className="set-row set-row-stack">
        <div className="rk">
          {t.settingsFlavourLabel}
          <small>{t.settingsFlavourHint}</small>
        </div>
        <FlavourPicker />
      </div>

      <div className="set-row set-row-stack">
        <div className="rk">
          {t.settingsAccentLabel}
          <small>{t.settingsAccentHint}</small>
        </div>
        <AccentPicker />
      </div>

      <div className="set-row set-row-stack">
        <div className="rk">
          {t.settingsChatTextSizeLabel}
          <small>{t.settingsChatTextSizeHint}</small>
        </div>
        <ChatTextSizePicker />
      </div>

      <div className="set-row set-row-stack">
        <div className="rk">
          {t.settingsInterfaceLanguageLabel}
          <small>{t.settingsInterfaceLanguageHint}</small>
        </div>
        <InterfaceLanguagePicker />
      </div>
    </>
  );
}

/** Catalogue entry per chat text size. */
const CHAT_TEXT_SIZE_KEYS: Record<(typeof CHAT_TEXT_SIZES)[number], ChromeStringKey> = {
  small: "settingsChatTextSizeSmall",
  medium: "settingsChatTextSizeMedium",
  large: "settingsChatTextSizeLarge",
};

/**
 * The interface-language control (capability `desktop-app`, Requirement:
 * *Interface Language Control in Settings*), in the Appearance group.
 *
 * **Its choices are DERIVED from the shipped catalogues** and never hand-kept —
 * that is what makes a further language a file rather than a change proposal:
 * adding one changes nothing here. Each option is named by its own ENDONYM,
 * identical in every catalogue, so a lecturer who has landed in a language they
 * cannot read can still find their own; the control's own label and explanation
 * are ordinary chrome and follow the active language.
 *
 * The value is owned by the main process. A selection is sent there and the change
 * arrives back as a broadcast; the local `setActiveLanguage` is the same adoption
 * the broadcast performs, so the switch is immediate without the renderer ever
 * deciding which language is active.
 */
function InterfaceLanguagePicker() {
  const t = useChrome();
  const current = useInterfaceLanguage();
  const options = interfaceLanguageOptions();
  return (
    <div className="seg" role="group" aria-label={t.settingsInterfaceLanguageGroupLabel}>
      {options.map((option) => (
        <button
          key={option.code}
          type="button"
          aria-pressed={current === option.code}
          onClick={() => {
            void window.cbe.setInterfaceLanguage(option.code).then((result) => {
              if (result.ok) setActiveLanguage(result.language);
            });
          }}
        >
          {option.endonym}
        </button>
      ))}
    </div>
  );
}

/** Discrete chat text-size control (Requirement: Settings Panel, chat text-size
 * control): persists via the store (localStorage) and applies immediately —
 * ChatPanel binds the value as a data attribute on the chat scroll container. */
function ChatTextSizePicker() {
  const t = useChrome();
  const chatTextSize = useCbe((s) => s.chatTextSize);
  const setChatTextSize = useCbe((s) => s.setChatTextSize);
  return (
    <div className="seg" role="group" aria-label={t.settingsChatTextSizeLabel}>
      {CHAT_TEXT_SIZES.map((size) => (
        <button key={size} type="button" aria-pressed={chatTextSize === size} onClick={() => setChatTextSize(size)}>
          {t[CHAT_TEXT_SIZE_KEYS[size]] as string}
        </button>
      ))}
    </div>
  );
}

/**
 * THE one reusable per-field explanation pattern for Settings fields
 * (capability `desktop-app`, Requirement: Collected UX Polish — settings field
 * explanations). A short explanation, in the interface language, is reached
 * through ONE help
 * control per field — a `?` button beside the field — and through nothing else:
 * neither hovering nor focusing the field reveals anything, and no hint or
 * explanation line stands rendered on the surface. This holds identically in
 * the Model group's default view and in its Advanced disclosure; one mechanism
 * for both levels, with no exceptions.
 *
 * The field carried a second, standing `<small>` hint until
 * `split-llm-settings-into-standard-and-advanced`; whatever that hint said that
 * the explanation did not now lives in the explanation (design D4), so the
 * surface reads as fields rather than as a wall of prose.
 *
 * The explanation element stays in the DOM permanently, so it is exposed to
 * assistive technology as the field's accessible description whether or not the
 * `?` was ever pressed — the control references it via
 * `aria-describedby={explanationId}` (the caller's responsibility). Escape
 * dismisses a revealed explanation without moving pointer or focus.
 *
 * The reveal and the `?` control both live in `components/ExplanationTooltip.tsx`
 * — the app's ONE tooltip system, whose second prescribed trigger (hover and
 * focus) belongs to the composer's context-usage ring. Future settings fields
 * MUST reuse this component rather than introduce a second class of explanation.
 */
export function SettingsField({
  label,
  explanation,
  explanationId,
  children,
}: {
  label: string;
  /** Short catalogue-owned explanation: what the field does and, where relevant,
   * what a sensible value looks like. */
  explanation: string;
  /** DOM id of the explanation element — pass the same id to the control's
   * `aria-describedby`. */
  explanationId: string;
  children: ReactNode;
}) {
  const { open, toggle, close, dismissProps } = useActivatedExplanationReveal();
  // The reveal is per showing, exactly as the Advanced disclosure is: the
  // overlay stays mounted from its first open, so an explanation left revealed
  // would otherwise still be standing the next time the lecturer opens Settings
  // — help nobody asked for on that showing. Derived from the store's section,
  // never stored anywhere.
  const overlaySection = useCbe((s) => s.overlaySection);
  useEffect(() => {
    if (overlaySection === "settings") close();
  }, [overlaySection, close]);
  return (
    <div className="set-row set-row-stack set-field" {...dismissProps}>
      <div className="rk">{label}</div>
      {/* The control and its `?` share a row: the help sits to the RIGHT of the
          field it explains, never above or below it. */}
      <div className="set-field-control">
        {children}
        <ExplanationHelpButton fieldLabel={label} explanationId={explanationId} open={open} onToggle={toggle} />
      </div>
      {/* Always in the DOM (accessible description must not depend on the
          reveal); visibility is toggled via data-open, styled in styles.css. */}
      <ExplanationTooltip id={explanationId} open={open} placement="inline">
        {explanation}
      </ExplanationTooltip>
    </div>
  );
}

function LlmConnectionGroup() {
  const t = useChrome();
  const providerStatus = useCbe((s) => s.providerStatus);
  const setProviderStatus = useCbe((s) => s.setProviderStatus);

  const [baseURL, setBaseURL] = useState(providerStatus?.baseURL ?? "");
  const [modelId, setModelId] = useState(providerStatus?.modelId ?? "");
  const [contextLength, setContextLength] = useState(
    providerStatus?.contextLength ? String(providerStatus.contextLength) : ""
  );
  const [apiKey, setApiKey] = useState("");
  // Reasoning controls. React-controlled (no direct DOM .value writes), per the
  // input-hygiene rule. `reasoning` mirrors the persisted on/off state; `effort`
  // the persisted level (default "medium" for the selector). `reasoningTouched`
  // tracks whether the lecturer changed the control: only then does the DTO carry
  // `reasoning` (an explicit choice). Untouched → the field is OMITTED so the main
  // process preserves the persisted value / applies its metadata default — the
  // same omit-to-preserve contract as apiKey / contextLength.
  const [reasoning, setReasoning] = useState<boolean>(providerStatus?.reasoning ?? false);
  const [effort, setEffort] = useState<ReasoningEffort>(providerStatus?.reasoningEffort ?? "medium");
  const [reasoningTouched, setReasoningTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [swapModel, setSwapModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Test-connection affordance (Requirement: Credential Presence Indicator and
  // Connection Verifiability) — non-blocking: only the Test button is disabled
  // while the probe runs; the rest of the panel stays interactive.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Credential erasure (Requirement: Credential Erasure with Confirmation) —
  // two-step: the delete control arms an inline confirmation, only the confirm
  // button calls the main-process erase path.
  const [confirmErase, setConfirmErase] = useState(false);
  const [eraseNote, setEraseNote] = useState<string | null>(null);
  // The Advanced disclosure (Requirement: Settings Panel (Phase 1 scaffold)) —
  // a disclosure INSIDE this group, never a fifth accordion group: toggling it
  // touches neither `settingsOpenGroup` nor the store's two-branch rule.
  //
  // `null` means "no lecturer decision on this showing", in which case the open
  // state is DERIVED (see `advancedOpen` below) — that is what makes Advanced
  // start closed on every showing, exactly as the accordion has no memory of a
  // last-open group, while still honouring the one exception below. The effect
  // clears a lecturer's toggle when the surface is shown again.
  const [advancedOverride, setAdvancedOverride] = useState<boolean | null>(null);
  const overlaySection = useCbe((s) => s.overlaySection);
  useEffect(() => {
    if (overlaySection === "settings") setAdvancedOverride(null);
  }, [overlaySection]);

  // Reflect upstream provider status changes (e.g. after first config save in ConfigDialog).
  useEffect(() => {
    setBaseURL(providerStatus?.baseURL ?? "");
    setModelId(providerStatus?.modelId ?? "");
    setContextLength(providerStatus?.contextLength ? String(providerStatus.contextLength) : "");
    setReasoning(providerStatus?.reasoning ?? false);
    setEffort(providerStatus?.reasoningEffort ?? "medium");
    setReasoningTouched(false);
  }, [
    providerStatus?.baseURL,
    providerStatus?.modelId,
    providerStatus?.contextLength,
    providerStatus?.reasoning,
    providerStatus?.reasoningEffort,
  ]);

  async function save() {
    const cleanBase = sanitiseProviderField(baseURL);
    const cleanModel = sanitiseProviderField(modelId);
    const cleanKey = sanitiseProviderField(apiKey);

    if (!cleanBase || !cleanModel) {
      setError(t.settingsRequiredFields);
      return;
    }

    // Context length: blank → omit (preserve persisted value); otherwise must
    // be a positive integer. Reject garbage early so a typo never persists a
    // tiny window (the root cause behind premature compaction / the picker
    // "Cannot continue from message role: assistant" failure).
    const trimmedCtx = contextLength.trim();
    let ctxValue: number | undefined;
    if (trimmedCtx !== "") {
      const parsed = Number(trimmedCtx);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError(t.settingsContextLengthInvalid);
        return;
      }
      ctxValue = parsed;
    }

    // Partial-update affordance: leaving the apiKey field blank means
    // "keep current key". The DTO is built with `apiKey` OMITTED in that
    // case — the main process's `saveConfig` reads the existing record
    // and preserves the persisted cipher (see desktop-app spec,
    // Scenario: *Settings save preserves the existing apiKey when the
    // field is left blank*). Sending `apiKey: ""` would trigger
    // EmptyApiKeyError; the dialog guarantees the empty case is omitted
    // instead. contextLength follows the same omit-to-preserve contract.
    // Endpoint identity = the persisted baseURL. A save that CHANGES it resets
    // the endpoint-calibrated fields (reasoning / contextLength) rather than
    // carrying them to the new host, and REQUIRES a re-entered key — the main
    // process enforces both, but the panel mirrors the reset in its controls and
    // gates Save below. See desktop-app spec, Requirement: Provider Configuration
    // Input Hygiene.
    const persistedBase = providerStatus?.baseURL ?? "";
    const endpointChanged = persistedBase !== "" && cleanBase !== persistedBase;

    const payload: ProviderConfigDto = { baseURL: cleanBase, modelId: cleanModel };
    if (cleanKey) payload.apiKey = cleanKey;
    if (ctxValue !== undefined) payload.contextLength = ctxValue;
    // Only an explicitly-touched reasoning control sends `reasoning` — an explicit
    // lecturer choice that always wins over the metadata default. Untouched →
    // omit, so the main process preserves the persisted value / applies the
    // metadata-driven default (Requirement: Provider Reasoning Configuration).
    if (reasoningTouched) {
      payload.reasoning = reasoning;
      if (reasoning) payload.reasoningEffort = effort;
    }

    setBusy(true);
    setError(null);
    setSwapModel(null);
    try {
      const result = await window.cbe.setConfig(payload);
      // hasKey stays true when we preserved the existing key; flips to true
      // (from a possibly-false starting state) when a new key is provided.
      const nextHasKey = cleanKey ? true : !!providerStatus?.hasKey;
      // On an endpoint change the persisted reasoning / contextLength were reset
      // by the main process; reflect that cleared state in the panel unless this
      // same save carried an explicit value. On a same-endpoint save the previous
      // persisted values are preserved (the `?? providerStatus?...` fallbacks).
      setProviderStatus({
        baseURL: cleanBase,
        modelId: cleanModel,
        hasKey: nextHasKey,
        contextLength: ctxValue ?? (endpointChanged ? undefined : providerStatus?.contextLength),
        reasoning: reasoningTouched ? reasoning : endpointChanged ? undefined : providerStatus?.reasoning,
        reasoningEffort:
          reasoningTouched && reasoning ? effort : endpointChanged ? undefined : providerStatus?.reasoningEffort,
      });
      setBaseURL(cleanBase);
      setModelId(cleanModel);
      setApiKey("");
      setReasoningTouched(false);
      // The config is persisted regardless. If a chat session was running, the main
      // process tried to re-bind it to the new provider live (desktop-app spec, Live
      // Provider Swap into the Running Session). A failed live swap is recoverable —
      // the config still saved, the chat stays on its previous provider — so surface
      // it as an error note, not a hard failure. A successful swap names the model.
      const swap = result.activeSwap;
      if (swap && !swap.ok) {
        setError(t.settingsSwapFailed({ error: swap.error }));
      } else {
        setSwapModel(swap?.ok ? swap.modelId : null);
        setSavedAt(Date.now());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Runs the main-process `GET {baseURL}/models` probe against the PERSISTED
  // configuration and surfaces the classified outcome. The key is never printed —
  // the IPC result carries only a cause + status.
  async function runConnectionTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await window.cbe.testConnection();
      if (r.ok) {
        setTestResult({ ok: true, message: t.settingsTestOk });
      } else if (r.cause === "unauthorized") {
        setTestResult({ ok: false, message: t.settingsTestUnauthorized({ status: String(r.status ?? 401) }) });
      } else if (r.cause === "unreachable") {
        setTestResult({ ok: false, message: t.settingsTestUnreachable });
      } else if (r.cause === "not-configured") {
        setTestResult({ ok: false, message: t.settingsTestNotConfigured });
      } else {
        setTestResult({ ok: false, message: t.settingsTestHttpError({ status: String(r.status ?? "error") }) });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  // Confirmed erase: the main process REMOVES the persisted cipher record (never
  // an empty-string cipher); the panel confirms the erasure and flips the
  // configured-state indicator to "no key set".
  async function eraseKey() {
    try {
      await window.cbe.eraseApiKey();
      setConfirmErase(false);
      setApiKey("");
      setTestResult(null);
      setEraseNote(t.settingsKeyErased);
      if (providerStatus) setProviderStatus({ ...providerStatus, hasKey: false });
    } catch (err) {
      setConfirmErase(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Save-gate for an endpoint change with no re-entered key. A credential entered
  // for one endpoint is never re-targeted at another (the main process refuses it
  // too); the dialog surfaces the requirement at the moment of change. See
  // desktop-app spec, Scenario: *Changing the base URL keeps Save disabled until
  // the key is re-entered*.
  const persistedBase = providerStatus?.baseURL ?? "";
  const cleanBaseForGate = sanitiseProviderField(baseURL);
  const endpointChangedForGate = persistedBase !== "" && cleanBaseForGate !== persistedBase;
  const keyMissingForNewEndpoint = endpointChangedForGate && sanitiseProviderField(apiKey) === "";

  // Unsaved-changes detection (Requirement: Settings Save Feedback and
  // Unsaved-Changes Indication): the section is dirty while any control differs
  // from the persisted state — including a typed (not yet saved) key and a
  // touched reasoning control. Presentation-only; the DTO omit-to-preserve
  // contracts are untouched.
  const persistedCtx = providerStatus?.contextLength ? String(providerStatus.contextLength) : "";
  const dirty =
    cleanBaseForGate !== persistedBase ||
    sanitiseProviderField(modelId) !== (providerStatus?.modelId ?? "") ||
    contextLength.trim() !== persistedCtx ||
    sanitiseProviderField(apiKey) !== "" ||
    reasoningTouched;
  const hasKey = !!providerStatus?.hasKey;

  // Which level the pending edit sits in — derived from the very comparisons
  // `dirty` already makes, so no store field and no persisted "last open" state.
  // This exists to protect the accordion's branch 2 (Requirement: Settings Panel
  // (Phase 1 scaffold)): a showing that re-opens the Model group so an unsaved
  // edit is on screen rather than behind a closed header must not then hide that
  // same edit behind a closed disclosure one level down. A pending edit in a
  // default-view field (base URL, model id, API key) leaves Advanced closed.
  const advancedDirty = contextLength.trim() !== persistedCtx || reasoningTouched;
  const advancedOpen = advancedOverride ?? advancedDirty;

  // Report the pending edit upwards (Requirement: Settings Save Feedback and
  // Unsaved-Changes Indication). Two consumers that cannot see this component:
  // the header's gear mirrors the indication while the overlay is CLOSED, and the
  // accordion's second branch re-opens on this group so the edit is on screen
  // rather than behind a closed header. Model is the only group with an explicit
  // Save action, so it is the only one that ever reports.
  const setSettingsDirtyGroup = useCbe((s) => s.setSettingsDirtyGroup);
  useEffect(() => {
    setSettingsDirtyGroup(dirty ? "model" : null);
  }, [dirty, setSettingsDirtyGroup]);

  return (
    <div className={`llm-conn${dirty ? " llm-conn-dirty" : ""}`}>
      {/* ---- DEFAULT VIEW: what connects you, and nothing else to configure.
          Four lecturer-facing fields — base URL, model id, API key, test
          connection — with Save beside the test affordance as their commit
          action (Requirement: Settings Panel (Phase 1 scaffold)). Everything
          that calibrates rather than connects sits in Advanced below. ---- */}

      {/* Configured-state indicator (Requirement: Credential Presence Indicator
          and Connection Verifiability) — derived from the persisted record's
          hasKey flag; the stored key value is never displayed. It stays in the
          default view: an indicator a lecturer has to go looking for tells them
          nothing at a glance. */}
      <div className="set-row">
        <div className="rk">{t.settingsApiKeyStatusLabel}</div>
        <span className={`set-keystate ${hasKey ? "set-keystate-set" : "set-keystate-unset"}`} role="status">
          {hasKey ? t.settingsApiKeySet : t.settingsApiKeyUnset}
        </span>
      </div>

      <SettingsField
        label={t.settingsBaseUrlLabel}
        explanationId="set-explain-baseurl"
        explanation={t.settingsBaseUrlExplanation}
      >
        <input
          className="set-input"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder={t.settingsBaseUrlPlaceholder}
          aria-describedby="set-explain-baseurl"
        />
      </SettingsField>

      <EndpointHintNotes baseURL={cleanBaseForGate} />

      <SettingsField
        label={t.settingsModelIdLabel}
        explanationId="set-explain-modelid"
        explanation={t.settingsModelIdExplanation}
      >
        <input
          className="set-input"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder={t.settingsModelIdPlaceholder}
          aria-describedby="set-explain-modelid"
        />
      </SettingsField>

      {/* The key field is LEGIBLE rather than masked (Requirement: Settings
          Panel (Phase 1 scaffold)) — it is worth seeing precisely while it is
          being typed. It never carries the persisted credential: the state
          starts at "" on every mount and the stored key is never sent to the
          renderer, so the presence row above stays the only statement the
          surface makes about it. `autoComplete="off"` and the React-controlled
          value flow bind it as a CREDENTIAL input, not as a password input
          (Requirement: Password Inputs Are Defended Against Browser Autofill). */}
      <SettingsField
        label={t.settingsApiKeyLabel}
        explanationId="set-explain-apikey"
        explanation={t.settingsApiKeyExplanation}
      >
        <input
          className="set-input"
          type="text"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t.settingsApiKeyPlaceholder}
          aria-label={t.settingsApiKeyLabel}
          aria-describedby="set-explain-apikey"
        />
      </SettingsField>
      {keyMissingForNewEndpoint && (
        <p className="set-note set-note-warn" role="note">
          {t.settingsKeyRequiredForEndpoint}
        </p>
      )}

      {error && <p className="config-error">{error}</p>}
      {/* Save-lifecycle feedback (Requirement: Settings Save Feedback and
          Unsaved-Changes Indication): the unsaved state and the saved
          confirmation are mutually exclusive — the lecturer is never left
          guessing whether a change took effect. */}
      {dirty && (
        <p className="set-note set-note-warn set-unsaved" role="status">
          {t.settingsUnsavedChanges}
        </p>
      )}
      {savedAt && !error && !dirty && (
        <p className="set-note set-note-ok" role="status">
          {swapModel ? t.settingsSavedWithSwap({ modelId: swapModel }) : t.settingsSaved}
        </p>
      )}

      <div className="set-actions">
        <button
          className="send set-save"
          type="button"
          onClick={() => void save()}
          disabled={busy || keyMissingForNewEndpoint}
        >
          {busy ? t.settingsSaving : t.settingsSave}
        </button>
        <button className="set-secondary" type="button" onClick={() => void runConnectionTest()} disabled={testing}>
          {testing ? t.settingsTesting : t.settingsTestConnection}
        </button>
      </div>
      {testResult && (
        <p className={`set-note ${testResult.ok ? "set-note-ok" : "set-note-warn"}`} role="status">
          {testResult.message}
        </p>
      )}

      {/* ---- ADVANCED: everything that is not part of getting connected —
          endpoint calibration and credential destruction. A disclosure INSIDE
          this group, using the same idiom as the group headers (activating
          control + aria-expanded + chevron) but participating in no accordion:
          opening or closing it opens or closes none of the four groups, and it
          deliberately carries its OWN classes rather than the accordion's, so a
          selector that means "one of the four groups" never picks it up. ---- */}
      <div className={`set-adv${advancedOpen ? "" : " set-adv-collapsed"}`}>
        <button
          type="button"
          className="set-adv-header"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOverride(!advancedOpen)}
        >
          <span className="set-label">{t.settingsAdvanced}</span>
          <svg
            className="set-acc-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {/* `hidden`, not unmounted — the same technique the accordion groups
            use, so a half-typed context length survives a collapse. */}
        <div className="set-adv-body" hidden={!advancedOpen}>
          <SettingsField
            label={t.settingsReasoningLabel}
            explanationId="set-explain-reasoning"
            explanation={t.settingsReasoningExplanation}
          >
            <label className="set-switch">
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(e) => {
                  setReasoning(e.target.checked);
                  setReasoningTouched(true);
                }}
                aria-label={t.settingsReasoningToggleLabel}
                aria-describedby="set-explain-reasoning"
              />
              <span className="set-switch-track" aria-hidden="true" />
              <span className="set-switch-text">{reasoning ? t.settingsReasoningOn : t.settingsReasoningOff}</span>
            </label>
          </SettingsField>

          {reasoning && (
            <SettingsField
              label={t.settingsReasoningEffortLabel}
              explanationId="set-explain-reasoning-effort"
              explanation={t.settingsReasoningEffortExplanation}
            >
              <select
                className="set-input"
                value={effort}
                onChange={(e) => {
                  setEffort(e.target.value as ReasoningEffort);
                  setReasoningTouched(true);
                }}
                aria-label={t.settingsReasoningEffortLabel}
                aria-describedby="set-explain-reasoning-effort"
              >
                <option value="low">{t.settingsEffortLow}</option>
                <option value="medium">{t.settingsEffortMedium}</option>
                <option value="high">{t.settingsEffortHigh}</option>
              </select>
            </SettingsField>
          )}

          <SettingsField
            label={t.settingsContextLengthLabel}
            explanationId="set-explain-contextlength"
            explanation={t.settingsContextLengthExplanation}
          >
            <input
              className="set-input"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={contextLength}
              onChange={(e) => setContextLength(e.target.value)}
              placeholder={t.settingsContextLengthPlaceholder}
              aria-describedby="set-explain-contextlength"
            />
          </SettingsField>

          {/* Credential erasure (Requirement: Credential Erasure with Confirmation):
              two-step delete — arm, then confirm. The main process removes the
              persisted safeStorage cipher record; the confirmation note reports it,
              where the control was triggered. Destroying a credential is not part of
              getting connected, so the control lives here rather than in the
              default view. */}
          {hasKey && !confirmErase && (
            <button
              className="set-danger"
              type="button"
              onClick={() => {
                setConfirmErase(true);
                setEraseNote(null);
              }}
            >
              {t.settingsDeleteApiKey}
            </button>
          )}
          {confirmErase && (
            <div className="set-erase-confirm" role="group" aria-label={t.settingsConfirmEraseLabel}>
              <p className="set-note set-note-warn">{t.settingsEraseConfirmText}</p>
              <div className="set-actions">
                <button className="set-danger" type="button" onClick={() => void eraseKey()}>
                  {t.settingsDeleteKey}
                </button>
                <button className="set-secondary" type="button" onClick={() => setConfirmErase(false)}>
                  {t.settingsCancel}
                </button>
              </div>
            </div>
          )}
          {eraseNote && (
            <p className="set-note set-note-ok" role="status">
              {eraseNote}
            </p>
          )}
        </div>
      </div>

      {/* Plain-language locality statement (Requirement: Credential Erasure with
          Confirmation, second scenario). It stays OUTSIDE Advanced: that duty is
          discharged by a lecturer *viewing* the group, not by one going looking.
          This is the app's only standing locality statement — the fuller
          data-handling disclosure lives in `docs/data-handling.md`
          (Requirement: Data-Handling Disclaimer), not on an app surface. */}
      <p className="set-note">{t.settingsLocalityStatement}</p>
    </div>
  );
}

/** Read-only facts about what is installed. Named **About** rather than "Skill"
 * because the group is the honest home for read-only facts generally, of which
 * the loaded skill and the running build are today's content — it is consulted,
 * never changed, which is why it comes after the two groups that carry actual
 * settings.
 *
 * Every value is fetched from the host (`getAboutInfo`), never written here: the
 * group's whole purpose is to state what is installed, and a literal in this
 * component states what was installed on the day someone typed it. The skill
 * version and the app version are separate rows on purpose — a row labelled just
 * "Version" is read as the app's. */
function AboutGroup() {
  const t = useChrome();
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [pioneerOpenFailed, setPioneerOpenFailed] = useState(false);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const pioneerDescriptionId = useId();
  const pioneerCueId = useId();
  const openGroup = useCbe((s) => s.settingsOpenGroup);
  const overlaySection = useCbe((s) => s.overlaySection);

  // Voluntary disclosure is transient. Accordion/overlay dismissal clears it
  // without acknowledgment; only its own explicit Close settles the marker.
  useEffect(() => {
    if (openGroup !== "about" || overlaySection !== "settings") setOverviewOpen(false);
  }, [openGroup, overlaySection]);

  useEffect(() => {
    let cancelled = false;
    void window.cbe.getAboutInfo().then(
      (i) => {
        if (!cancelled) setInfo(i);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A missing value is stated, never substituted: the row that used to read a
  // hardcoded "0.1.0" is exactly how a literal here rots into a false reading.
  const pending = !info && !failed;
  const state = (value: string | null | undefined) =>
    value ?? (pending ? t.settingsAboutLoading : t.settingsAboutUnavailable);
  const updateState = (update: SkillUpdateStatus | undefined): string => {
    if (failed) return t.settingsAboutUnavailable;
    if (!info) return t.settingsAboutLoading;
    switch (update?.status ?? "not-checked") {
      case "not-checked":
        return t.settingsAboutSkillUpdateNotChecked;
      case "updated":
        return t.settingsAboutSkillUpdateUpdated({ version: update.version });
      case "up-to-date":
        return t.settingsAboutSkillUpdateUpToDate({ version: update.version });
      case "metadata-invalid":
        return t.settingsAboutSkillUpdateMetadataInvalid({ field: update.field ?? "" });
      case "compatibility-mismatch":
        if (update.field === "appRange") return t.settingsAboutSkillUpdateAppMismatch;
        if (update.field === "modelSurfaceAbi") return t.settingsAboutSkillUpdateAbiMismatch;
        if (update.field === "toolContractSha256") return t.settingsAboutSkillUpdateToolMismatch;
        return t.settingsAboutSkillUpdatePiMismatch;
      case "integrity-mismatch":
        return t.settingsAboutSkillUpdateIntegrityMismatch;
      case "unavailable":
        return t.settingsAboutSkillUpdateUnavailable;
      case "signed-refused":
        return t.settingsAboutSkillUpdateSignedRefused({ code: update.code, field: update.field ?? "" });
      case "signed-unavailable":
        return t.settingsAboutSkillUpdateSignedUnavailable({ code: update.code });
    }
  };

  function closeOverview() {
    setOverviewOpen(false);
    useCbe.getState().settleOnboarding();
    requestAnimationFrame(() => disclosureRef.current?.focus());
  }

  async function openPioneerSite() {
    setPioneerOpenFailed(false);
    try {
      const result = await window.cbe.openPioneerAllianceSite();
      if (!result.ok) setPioneerOpenFailed(true);
    } catch {
      // The preload normally returns a closed failure result. Treat a lost IPC
      // boundary the same way so the link remains local and retryable.
      setPioneerOpenFailed(true);
    }
  }

  return (
    <>
      <div className="set-about-identity" aria-hidden="true">
        <img src={APP_IDENTITY_ICON} alt="" aria-hidden="true" />
      </div>
      <div className="set-row">
        <div className="rk">{t.settingsAboutSkill}</div>
        <span className="set-val mono">{state(info?.skillName)}</span>
      </div>
      <div className="set-row">
        <div className="rk">{t.settingsAboutSkillVersion}</div>
        <span className="set-val mono">{state(info?.skillVersion)}</span>
      </div>
      <div className="set-row">
        <div className="rk">{t.settingsAboutAppVersion}</div>
        <span className="set-val mono">{state(info?.appVersion)}</span>
      </div>
      {info?.skillPack && (
        <div className="set-row">
          <div className="rk">{t.settingsAboutSkillPackIdentity}</div>
          <span className="set-val mono">
            {t.settingsAboutSkillPackIdentityValue({
              channel: info.skillPack.channel,
              epoch: info.skillPack.epoch,
              sequence: info.skillPack.sequence,
              keyId: info.skillPack.signerKeyId,
            })}
          </span>
        </div>
      )}
      <div className="set-row">
        <div className="rk">{t.settingsAboutSkillUpdateStatus}</div>
        <span className="set-val">{updateState(info?.skillUpdate)}</span>
      </div>
      <div className="set-about-pioneer">
        <button
          type="button"
          role="link"
          className="set-about-pioneer-link"
          aria-describedby={`${pioneerDescriptionId} ${pioneerCueId}`}
          onClick={() => void openPioneerSite()}
        >
          {t.settingsPioneerLinkLabel}
        </button>
        <p id={pioneerDescriptionId}>{t.settingsPioneerLinkDescription}</p>
        <p id={pioneerCueId} className="set-about-external-cue">
          {t.settingsPioneerExternalCue}
        </p>
        <div className="set-about-pioneer-status" role="status" aria-live="polite">
          {pioneerOpenFailed ? t.settingsPioneerOpenFailure : ""}
        </div>
      </div>
      <div className="set-about-overview">
        <button
          ref={disclosureRef}
          type="button"
          className="set-secondary set-about-overview-trigger"
          aria-expanded={overviewOpen}
          aria-controls="settings-first-use-overview"
          // A real disclosure toggle: what `aria-expanded` announces is what the
          // control does. Collapsing here is navigation and acknowledges nothing —
          // only the overview's own Close settles the marker.
          onClick={() => setOverviewOpen((open) => !open)}
        >
          {t.onboardingReread}
        </button>
        {overviewOpen && <FirstUseOverview id="settings-first-use-overview" mode="reread" onClose={closeOverview} />}
      </div>
    </>
  );
}
