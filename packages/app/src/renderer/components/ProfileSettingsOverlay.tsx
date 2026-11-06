import { useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useCbe } from "../state/store.js";
import { ProfilePanel } from "./ProfilePanel.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { useChrome } from "../chrome.js";

/**
 * The Profile-and-Settings overlay (capability `desktop-app`, Requirement:
 * Profile-and-Settings Overlay) — ONE surface with two sibling sections.
 *
 * **One overlay, not two.** Profile and Settings are top-level sections of the
 * same surface, never nested inside one another, with two entry points in the
 * header's top-right group: the user affordance opens it at Profile, the gear at
 * Settings. Moving between them does not close and re-open it. Making Profile a
 * SIBLING is also what carries the standing rule that the settings surface holds
 * no lecturer-profile group — a duplicate inside Settings has nowhere to form.
 *
 * **It is not a panel.** It consumes no layout width: it is drawn over the
 * workspace, and the chat column and both side panels keep their widths and
 * states underneath it. It does not resize and it does not collapse.
 *
 * **Dismissal is safe in all three directions — Escape, the dismiss control, a
 * click on the backdrop — because closing costs nothing.** Both sections stay
 * MOUNTED behind the closed overlay, so an unsaved settings edit survives the
 * dismissal for the app session and re-opening returns the lecturer to their
 * typing; the gear meanwhile carries the unsaved-changes indication so someone
 * who dismissed mid-edit can see that they did. Hiding rather than unmounting is
 * what makes the click-outside dismissal honest instead of a data-loss path — and
 * it is `hidden` (i.e. `display: none`), so the closed surface is neither
 * focusable nor exposed to assistive technology.
 *
 * **Focus.** `role="dialog"` + `aria-modal="true"` + an accessible name that
 * identifies the OPEN SECTION. On open, focus moves into the overlay; while it is
 * open, Tab and Shift+Tab cycle inside it, the surface itself takes focus for a
 * click on its own dead space (`tabIndex={-1}` — never a tab stop) and a
 * document-level `focusin` guard pulls back focus that reached anything behind
 * the backdrop by another route; on close, focus returns to the affordance that opened it — including when the
 * close came from Escape or from a backdrop click. Whether focus was ours is
 * RECORDED while the overlay is open rather than read back afterwards: hiding the
 * surface makes the focused control non-rendered, and the browser has already
 * blurred into `<body>` by the time any effect could look.
 *
 * **The session underneath keeps running.** The overlay is not part of the run
 * lock and gates nothing: a turn starting or ending does not close it, a
 * `cbe_profile` call updates the Profile section live, a settings save applies
 * live, and a course switch leaves it open while the Profile section re-resolves
 * to the newly active course's lecturer state (which it does by construction —
 * `ProfilePanel` reads the store slice the switch rewrites).
 */

/** Everything the focus trap treats as a stop. Deliberately a query rather than a
 * registry: the two sections own their own controls and must not have to enrol
 * them here. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  // A control inside the section that is not shown sits under `hidden`, so it is
  // out of the tab order and must be out of the trap's cycle too.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.closest("[hidden]") === null);
}

export function ProfileSettingsOverlay() {
  const t = useChrome();
  const section = useCbe((s) => s.overlaySection);
  const showSection = useCbe((s) => s.showSettingsSurface);
  const close = useCbe((s) => s.closeSettingsSurface);
  const rootRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  /** The affordance that opened the overlay, so the close can hand focus back to
   * it whichever of the three dismissals fired. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** Mount the surface lazily — the overlay is never open on a fresh mount, and
   * nothing should run the sections' mount effects (profile hydration, corpus
   * info) before the lecturer has asked for them once. From the first open it
   * stays mounted, which is what lets an unsaved edit survive a dismissal. */
  const openedOnce = useRef(false);
  if (section !== null) openedOnce.current = true;
  /** Recorded while the overlay is open: does the overlay currently hold focus?
   * The close path restores from this fact instead of reading
   * `document.activeElement` after the surface has been hidden, which in a real
   * browser has already dropped focus to `<body>`. */
  const focusIsOurs = useRef(false);

  const open = section !== null;

  useLayoutEffect(() => {
    if (!open) {
      const opener = openerRef.current;
      openerRef.current = null;
      // Only take focus back if it was still ours when the close was decided — a
      // dismissal that moved focus somewhere on purpose is not overridden. A
      // native-menu opener can disappear while the overlay is open (for example
      // during hydration); then the composer is the workspace's safe fallback.
      if (focusIsOurs.current) {
        if (opener?.isConnected) opener.focus();
        else document.querySelector<HTMLElement>("[data-workspace-focus-target]")?.focus();
      }
      focusIsOurs.current = false;
      return;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusIsOurs.current = true;
    // Focus lands on the dismiss control: it is the one stop that is always
    // present, in both sections, and it is the way back out.
    dismissRef.current?.focus();

    /** The modal backstop: the surface is drawn over a workspace that is still
     * focusable, so focus reaching it by any route other than Tab (a click behind
     * the backdrop, a component focusing itself, a window blur) is pulled back
     * in. Only the close may hand focus away, and a close that did so on purpose
     * is recorded here so the restore does not override it. */
    function onFocusIn(e: FocusEvent) {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target instanceof Node ? e.target : null;
      if (target && root.contains(target)) {
        focusIsOurs.current = true;
        return;
      }
      if (useCbe.getState().overlaySection === null) {
        focusIsOurs.current = false;
        return;
      }
      const stops = focusableWithin(root);
      (stops[0] ?? dismissRef.current)?.focus();
    }
    /** Escape closes from anywhere while the overlay is open, including a press
     * that never travels through the surface — a click on dead space inside it
     * can leave focus on `<body>`, whose keydown reaches the document without
     * passing the surface's own handler.
     *
     * BUBBLE phase, deliberately. A field's tooltip dismissal (`SettingsField`,
     * WCAG 1.4.13) stops propagation when it actually dismisses, and React's
     * synthetic `stopPropagation` stops the native event with it — so a bubble
     * listener correctly never sees that press, while a capture listener would
     * fire first and throw the lecturer out of Settings for dismissing a tooltip. */
    function onDocumentKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open, close]);

  if (!openedOnce.current) return null;

  const title = section === "profile" ? t.overlayProfileTab : t.overlaySettingsTab;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const root = rootRef.current;
    if (!root) return;
    const stops = focusableWithin(root);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const active = document.activeElement as HTMLElement | null;
    // Wrap at both ends. This handler only ever sees a key pressed inside the
    // surface; focus that left it by another route is recovered by the
    // `focusin` guard above, not from here.
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** A press that STARTS on the backdrop dismisses. `mousedown` rather than
   * `click`, so a drag that begins inside the surface and ends on the backdrop
   * (selecting text to the edge) never closes it. The default action is
   * prevented so the press does not additionally drop focus to `<body>` on its
   * way out, which would race the close path's hand-back to the opener. */
  function onBackdropMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    close();
  }

  return (
    <div className="overlay-backdrop" hidden={!open} onMouseDown={onBackdropMouseDown} data-testid="overlay-backdrop">
      <div
        ref={rootRef}
        className="overlay-surface"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="overlay-bar">
          {/* The two sections are siblings and are reached from each other
              without the overlay closing. */}
          <div className="overlay-sections" role="tablist" aria-label={t.overlaySectionsLabel}>
            <button
              type="button"
              role="tab"
              id="overlay-tab-settings"
              aria-controls="overlay-section-settings"
              className="overlay-section-tab"
              aria-selected={section === "settings"}
              onClick={() => showSection("settings")}
            >
              {t.overlaySettingsTab}
            </button>
            <button
              type="button"
              role="tab"
              id="overlay-tab-profile"
              aria-controls="overlay-section-profile"
              className="overlay-section-tab"
              aria-selected={section === "profile"}
              onClick={() => showSection("profile")}
            >
              {t.overlayProfileTab}
            </button>
          </div>
          <button
            ref={dismissRef}
            type="button"
            className="overlay-dismiss"
            aria-label={t.overlayCloseLabel}
            onClick={() => close()}
          >
            ×
          </button>
        </div>

        {/* Both sections stay mounted; only one is shown. That is the whole
            mechanism behind "nothing is lost by closing" — and behind an unsaved
            edit still being there after a trip through the other section. */}
        <div
          className="overlay-body"
          id="overlay-section-settings"
          role="tabpanel"
          aria-labelledby="overlay-tab-settings"
          hidden={section !== "settings"}
        >
          <SettingsPanel />
        </div>
        <div
          className="overlay-body"
          id="overlay-section-profile"
          role="tabpanel"
          aria-labelledby="overlay-tab-profile"
          hidden={section !== "profile"}
        >
          <ProfilePanel />
        </div>
      </div>
    </div>
  );
}
