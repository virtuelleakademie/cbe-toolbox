import { useCallback, useEffect } from "react";
import { CHAT_TEXT_SIZES, useCbe, type ChatTextSize } from "./state/store.js";
import { AppHeader } from "./components/AppHeader.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { RightPanel } from "./components/RightPanel.js";
import { ProfileSettingsOverlay } from "./components/ProfileSettingsOverlay.js";
import { Workspace } from "./components/Workspace.js";
import { ConfigDialog } from "./components/ConfigDialog.js";
import { UpdateBanner } from "./components/UpdateBanner.js";
import { NativeMenuBridge } from "./components/NativeMenuBridge.js";
import { ACCENTS, FLAVOURS, applyPalette, type Accent, type Flavour, type Theme } from "./theme/catppuccin.js";
import { useChrome } from "./chrome.js";
import "./styles.css";

const VALID_THEMES: Theme[] = ["dark", "light"];

function readPersisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Boot-hydration pending pane (capability `desktop-app`, Requirement: Renderer
 * Boot-Hydration from the Main Process, "Pending state"): visible busy state,
 * accessibly announced. Covers the first-launch agent-runtime installation,
 * which can take minutes — the composer does not exist yet, so nothing can be
 * typed into no-session limbo.
 */
function HydrationPendingPane() {
  const t = useChrome();
  return (
    <section className="conv hydration-pane" role="status" aria-busy="true" aria-label={t.appHydrationPaneLabel}>
      <div className="hydration-pane-inner">
        <div className="hydration-pane-title">{t.appHydrationTitle}</div>
        <div className="hydration-pane-sub">{t.appHydrationSub}</div>
      </div>
    </section>
  );
}

/** Boot-hydration failure pane with a user-visible retry affordance (Scenario:
 * Hydration failure surfaces an error with retry) — an app restart is never the
 * only recovery path. */
function HydrationErrorPane({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useChrome();
  return (
    <section className="conv hydration-pane" role="alert" aria-label={t.appHydrationErrorLabel}>
      <div className="hydration-pane-inner">
        <div className="hydration-pane-title">{t.appHydrationErrorTitle}</div>
        <div className="hydration-pane-sub">{message}</div>
        <button type="button" className="send" onClick={onRetry}>
          {t.appRetry}
        </button>
      </div>
    </section>
  );
}

export function App() {
  const t = useChrome();
  const configured = useCbe((s) => s.configured);
  const setConfigured = useCbe((s) => s.setConfigured);
  const setProviderStatus = useCbe((s) => s.setProviderStatus);
  const hydration = useCbe((s) => s.hydration);
  const hydrationError = useCbe((s) => s.hydrationError);
  const error = useCbe((s) => s.error);
  const setError = useCbe((s) => s.setError);
  const notice = useCbe((s) => s.notice);
  const setNotice = useCbe((s) => s.setNotice);
  const setTheme = useCbe((s) => s.setTheme);
  const setFlavour = useCbe((s) => s.setFlavour);
  const setAccent = useCbe((s) => s.setAccent);
  const setChatTextSize = useCbe((s) => s.setChatTextSize);
  const setCourses = useCbe((s) => s.setCourses);
  const overlaySection = useCbe((s) => s.overlaySection);
  const closeSettingsSurface = useCbe((s) => s.closeSettingsSurface);
  const onboardingIssue = useCbe((s) => s.onboardingIssue);
  const resolveOnboarding = useCbe((s) => s.resolveOnboarding);
  const acknowledgeOnboarding = useCbe((s) => s.acknowledgeOnboarding);
  const setOnboardingIssue = useCbe((s) => s.setOnboardingIssue);

  // Resolve the main-owned first-use marker independently of workspace boot.
  // Unknown state never flashes a card or blocks configuration/hydration. The
  // event listener is the one accepted-dispatch route for every prompt surface.
  useEffect(() => {
    const unsubscribe = window.cbe.onOnboardingChanged((event) => {
      acknowledgeOnboarding(event.persistence === "failed" ? false : event.persistence === "saved" ? true : undefined);
    });
    void window.cbe
      .readOnboarding()
      .then(resolveOnboarding, () => resolveOnboarding({ acknowledged: false, issue: "unreadable" }));
    return unsubscribe;
  }, [acknowledgeOnboarding, resolveOnboarding]);

  // Hydrate appearance from localStorage before first paint, then apply the palette.
  useEffect(() => {
    const theme = readPersisted("cbe-theme", VALID_THEMES, "dark");
    const flavour = readPersisted("cbe-flavour", FLAVOURS, "macchiato" as Flavour);
    const accent = readPersisted("cbe-accent", ACCENTS, "blue" as Accent);

    // applyPalette() once, then sync into store without re-running it three times.
    applyPalette(theme, flavour, accent);
    setTheme(theme);
    setFlavour(flavour);
    setAccent(accent);
    // Chat text size rides the same persistence pattern; no palette involvement —
    // ChatPanel binds the store value as a data attribute on the scroll container
    // and on the composer.
    setChatTextSize(readPersisted("cbe-chat-text-size", CHAT_TEXT_SIZES, "medium" as ChatTextSize));
  }, [setTheme, setFlavour, setAccent, setChatTextSize]);

  // Hydrate the course workspace from the main process (folder scan + persisted
  // active-course pointer — capability `course-workspace`). Non-fatal on failure:
  // the header then shows "no active course" until the left panel retries.
  useEffect(() => {
    void window.cbe
      .listCourses()
      .then(setCourses)
      .catch(() => {});
  }, [setCourses]);

  // Pull provider status on launch so the header strip can render `host · model`.
  useEffect(() => {
    void (async () => {
      const cfg = await window.cbe.getConfig();
      setProviderStatus(cfg);
      setConfigured(!!cfg && cfg.hasKey);
    })();
  }, [setConfigured, setProviderStatus]);

  // Boot-hydration (capability `desktop-app`, Requirement: Renderer
  // Boot-Hydration from the Main Process): resolve-or-create the active course's
  // ONE conversation — re-attach an open session, resume the canonical sidecar
  // pair, or start fresh. The main process resolves the active course itself and
  // single-flights concurrent calls (StrictMode double-mount, boot racing a
  // switch), so firing this effect twice is safe by contract.
  const hydrate = useCallback(async () => {
    useCbe.getState().setHydration("pending");
    try {
      const result = await window.cbe.openConversation();
      useCbe.getState().hydrateConversation(result);
      useCbe.getState().setHydration("ready");
    } catch (err) {
      useCbe.getState().setHydration("error", err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (configured) void hydrate();
  }, [configured, hydrate]);

  // The overlay is workspace chrome and must not outlive the workspace: whenever
  // the app falls back to the onboarding dialog (first run, or a credential
  // erased from Settings), a still-open overlay would otherwise be drawn over the
  // config dialog and would come back the moment the provider is configured again.
  useEffect(() => {
    if (!configured && overlaySection !== null) closeSettingsSurface();
  }, [configured, overlaySection, closeSettingsSurface]);

  return (
    <div className="app-root">
      <NativeMenuBridge />
      {/* The header's course name reveals the left panel — only where that panel
          is the surface in front. In the onboarding config dialog it is a plain
          label. It stays the reveal affordance while the overlay is open: the
          overlay is drawn OVER an unchanged workspace, and its focus trap is what
          keeps the header out of reach, not a change of the header's contract.
          Help, Settings and Profile keep their provider-configuration gate; the
          language dropdown is the deliberate pre-configuration exception. */}
      <AppHeader workspaceVisible={configured} configured={configured} />

      {/* Non-blocking auto-update notice (capability `distribution`) — renders
          nothing until the main process reports an available update. */}
      <UpdateBanner />

      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
          {/* The banner is reserved for hard failures but stays dismissible
              (Requirement: Tiered Error Surfacing) — app-unusable failures
              render as the boot-hydration panes, not this banner. */}
          <button
            type="button"
            className="banner-error-close"
            aria-label={t.appDismissError}
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="banner-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="banner-notice-close"
            aria-label={t.appDismissNotice}
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {onboardingIssue && (
        <div className="banner-notice onboarding-preference-notice" role="status">
          <span>{onboardingIssue === "read-failed" ? t.onboardingReadFailure : t.onboardingWriteFailure}</span>
          <button
            type="button"
            className="banner-notice-close"
            aria-label={t.appDismissNotice}
            onClick={() => setOnboardingIssue(null)}
          >
            ×
          </button>
        </div>
      )}

      {!configured ? (
        <ConfigDialog />
      ) : (
        <>
          <Workspace>
            <LeftPanel />
            {hydration === "error" ? (
              <HydrationErrorPane
                message={hydrationError ?? t.appHydrationUnknownError}
                onRetry={() => void hydrate()}
              />
            ) : hydration === "ready" ? (
              <ChatPanel />
            ) : (
              <HydrationPendingPane />
            )}
            <RightPanel defaultTab="artifacts" />
          </Workspace>
          {/* Drawn OVER the workspace, which keeps its widths and states
              underneath: the overlay takes no layout width and the chat column is
              never re-laid out for it. Renders nothing until it has been opened
              once (Requirement: Profile-and-Settings Overlay). */}
          <ProfileSettingsOverlay />
        </>
      )}
    </div>
  );
}
