import { useId } from "react";
import { useCbe } from "../state/store.js";
import { useHelpDispatch } from "./ChatPanel.js";
import { PanelTabIcon } from "./PanelTabIcon.js";
import { useChrome } from "../chrome.js";
import { HeaderLanguageDropdown } from "./HeaderLanguageDropdown.js";

/**
 * Slim header strip across the top of the renderer.
 *
 * NOT a fake window chrome (no mac traffic lights, no inner border-radius, no shadow).
 * Visible in every top-level view (config dialog, workspace).
 *
 * **The active course name is the app's permanent answer to "which course am I
 * in"** (capability `desktop-app`, Requirement: App Header Strip). It is shown in
 * every top-level view whatever the left panel's state, so the invariant that
 * exactly one course is active and identifiable at all times does not depend on a
 * panel being expanded.
 *
 * **The header does not switch courses.** The switcher dropdown is removed:
 * activating the course name REVEALS the course surface instead — it expands the
 * left panel, brings its list level forward and moves focus into the course list,
 * where switching is a one-click action on a card. With courses listed in a panel
 * of their own, a header dropdown would have been a second, drift-prone copy of
 * the same list, including its running indicators and unseen-completion markers.
 * Where no left panel is rendered (the onboarding config dialog), the name is a
 * plain label. Course creation is likewise the left panel's; the header offers none.
 *
 * **No provider host and no model id** — and no technical readout of them anywhere
 * in the workspace (product decision 2026-08-13). They are configuration, not
 * working context. Their single home as configuration is the settings surface's
 * Model group. Nothing loses a signal by it: an unconfigured provider is surfaced
 * by the onboarding dialog that gates first use and by the readable chat error
 * state, and a changed model by the save confirmation plus the live swap. The
 * data-protection question the provider name used to answer here is answered in
 * `docs/data-handling.md`, which points the lecturer at the Model group for the
 * provider actually in force rather than repeating a name it cannot know.
 *
 * **The configured top-right group carries exactly four affordances**: language,
 * help, gear, user. The language dropdown is the sole control available before
 * provider configuration; adding it does not move or weaken the existing three
 * controls' gates. Help dispatches the app's one help request implementation; the
 * other two open the ONE Profile-and-Settings overlay at Settings and Profile.
 *
 * **The gear carries the unsaved-changes indication** while the Settings section
 * holds an edit that has not been saved (Requirement: Settings Save Feedback and
 * Unsaved-Changes Indication). That mirror is what makes the overlay's
 * click-outside dismissal safe rather than a data-loss path: a lecturer who
 * dismissed mid-edit can see that they did, and re-opening returns them to their
 * typing.
 *
 * **Two gates, because they answer two questions.** `configured` gates Help,
 * Settings and Profile: they are workspace chrome, and on the onboarding config
 * dialog the overlay-opening two would be dead controls that still opened the
 * overlay — so saving the provider config would land the lecturer on Settings
 * instead of the workspace. The language dropdown deliberately sits outside that
 * gate so a lecturer can recover from an unreadable configuration view.
 * `workspaceVisible` gates the course-name reveal, which additionally needs the
 * left panel to be the surface in front. `workspaceVisible` therefore implies
 * `configured`; the reverse does not hold.
 */
export function AppHeader({
  workspaceVisible = false,
  configured = false,
}: {
  workspaceVisible?: boolean;
  configured?: boolean;
}) {
  const t = useChrome();
  const activeCourseId = useCbe((s) => s.activeCourseId);
  const courses = useCbe((s) => s.courses);
  const revealCourses = useCbe((s) => s.revealCourses);
  const showSettingsSurface = useCbe((s) => s.showSettingsSurface);
  const unsaved = useCbe((s) => s.settingsDirtyGroup !== null);
  // The help dispatch's run lock, read from the store rather than from the chat
  // panel's local `submitting` flag: `dispatchPending` covers the same
  // click-to-`agent_start` window app-wide (Requirement: Canvas Dialogue-Steering
  // Dispatches Respect the Run Lock — same shared lock state).
  const session = useCbe((s) => s.session);
  const hydration = useCbe((s) => s.hydration);
  const streaming = useCbe((s) => s.live.streaming);
  const dispatchPending = useCbe((s) => s.dispatchPending);
  // `hydration !== "ready"` no longer stands between the lecturer and the PREVIOUS
  // course's session — the store does that now: a switch into a course with no
  // conversation slice projects the whole empty mirror, `session` included
  // (`state/store.ts`, `emptyConversationMirror`; capability `course-workspace`,
  // Requirement: Course-Scoped Isolation of Canvas, Step, Maturity and Decision
  // State). It was added here symptomatically on 2026-08-25 and is KEPT on its own
  // grounds: it also covers the window in which the mirror is CORRECT but the
  // conversation resolution is still in flight — a switch back into a course whose
  // slice is already held, and `resumeStoredConversation`, which can close the held
  // session and start another. Dispatching into a session that is about to be closed
  // is a different defect, and dropping this gate would open it.
  // `headerHelpStartingReason` covers the whole window between a configured
  // provider and a resolved conversation — before the first session is minted,
  // while a course switch is still hydrating, and after a switch that failed.
  // There is nothing to dispatch into in any of them, and saying so beats a
  // control that silently does nothing.
  //
  // The busy reason IS the "+" menu entry's, resolved from the SAME catalogue
  // entry rather than given a second one: one fact about one run must not grow
  // two wordings, in any language (capability `desktop-app`, Requirement: *Each
  // Rendered Chrome String Has Exactly One Owner*).
  const helpReason =
    !session || hydration !== "ready"
      ? t.headerHelpStartingReason
      : streaming || dispatchPending
        ? t.chatComposerLockedReason
        : null;
  const helpReasonId = useId();
  // ONE dispatch, two entry points: the hook the "+" menu entry uses. Called
  // unconditionally (hooks rule); `locked` covers the no-session window too, so a
  // header click before hydration is the same no-op the lock already defines.
  const { dispatchHelp, announcement: helpAnnouncement } = useHelpDispatch(
    session?.sessionId ?? "",
    helpReason !== null
  );
  // Active course is identifiable at all times (capability `desktop-app`,
  // Requirement: Course Management in the UI) — the header mirrors the scanned
  // course list from the main process.
  const courseLabel = courses.find((c) => c.id === activeCourseId)?.title ?? t.headerNoActiveCourse;

  return (
    <header className="app-header" aria-label={t.headerLabel}>
      <div className="app-header-left">
        <span className="app-header-name">{t.headerAppName}</span>
        <span className="app-header-sep">/</span>
        {workspaceVisible ? (
          <button
            type="button"
            className="app-header-course-btn"
            aria-label={t.headerShowCoursesLabel({ course: courseLabel })}
            title={t.headerShowCoursesTitle}
            onClick={() => revealCourses()}
          >
            <span className="app-header-course">{courseLabel}</span>
          </button>
        ) : (
          <span className="app-header-course">{courseLabel}</span>
        )}
      </div>
      <div className="app-header-right">
        {/* Language is always first and is the sole pre-configuration action.
            Help, gear and Profile retain their existing shared configuration gate,
            order and behavior; Profile remains the rightmost strip element. */}
        <HeaderLanguageDropdown />
        {configured && (
          <>
            <button
              type="button"
              className="app-header-affordance"
              aria-label={t.headerHelpLabel}
              title={helpReason ?? t.headerHelpLabel}
              // `aria-disabled`, never the `disabled` attribute — the discipline
              // the gear, the menu entries and the stop button already keep: a
              // disabled control is skipped by assistive technology and its
              // reason becomes unreachable without a pointer. Activating it is a
              // no-op.
              aria-disabled={helpReason !== null || undefined}
              {...(helpReason !== null ? { "aria-describedby": helpReasonId } : {})}
              onClick={() => {
                if (helpReason !== null) return;
                dispatchHelp();
              }}
            >
              <PanelTabIcon tab="help" />
            </button>
            <button
              type="button"
              className={`app-header-affordance${unsaved ? " app-header-affordance-unsaved" : ""}`}
              aria-label={unsaved ? t.headerOpenSettingsUnsaved : t.headerOpenSettings}
              title={unsaved ? t.headerSettingsTitleUnsaved : t.headerSettingsTitle}
              onClick={() => showSettingsSurface("settings")}
            >
              <PanelTabIcon tab="settings" />
              {/* The indication itself: a dot on the gear, mirroring the section's
                  own unsaved state so a dismissal mid-edit stays visible. */}
              {unsaved && <span className="app-header-unsaved-dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="app-header-affordance"
              aria-label={t.headerOpenProfile}
              title={t.headerProfileTitle}
              onClick={() => showSettingsSurface("profile")}
            >
              <PanelTabIcon tab="profile" />
            </button>
          </>
        )}
      </div>
      {/* Both of these sit OUTSIDE the top-right group, so the group's inventory
          and its rightmost element stay exactly what the spec names.
          First: the help control's unavailability reason, referenced as its
          accessible DESCRIPTION so a keyboard user hears it — `aria-describedby`
          binds by id, not by proximity.
          Second: dispatch feedback for assistive technology, the header's own
          live region — the chat transcript is not one. */}
      {helpReason !== null && (
        <span id={helpReasonId} className="visually-hidden">
          {helpReason}
        </span>
      )}
      <span className="visually-hidden" aria-live="polite">
        {helpAnnouncement}
      </span>
    </header>
  );
}
