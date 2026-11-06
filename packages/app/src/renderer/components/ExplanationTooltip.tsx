import { useCallback, useState, type ReactNode } from "react";
import { useChrome } from "../chrome.js";

/**
 * THE app's one revealed-explanation idiom (capability `desktop-app`,
 * Requirement: Collected UX Polish — settings field explanations; Requirement:
 * Context-Usage Ring in the Composer Control Row).
 *
 * Extracted from `SettingsPanel`'s `SettingsField`, which was its only consumer
 * until the composer's context-usage ring became the second. A second tooltip
 * class beside it is what *Collected UX Polish* prohibits, so the component
 * grew a **placement** instead:
 *
 * - `inline` — the original: the explanation renders **in flow** below the
 *   field row, which is correct in a settings surface that scrolls.
 * - `overlay` — drawn **over** the surrounding surface, consuming no layout box.
 *   The control row forbids a reflow, and an in-flow reveal inside it would
 *   move the three actions every time a pointer crossed the ring.
 *
 * Both placements share the same copy semantics, the same open/dismiss
 * behaviour and the same accessible-description wiring. The explanation element
 * stays in the DOM permanently so it is always exposed to assistive technology
 * as the control's accessible description — the control references it via
 * `aria-describedby={id}` (the caller's responsibility).
 *
 * WCAG 1.4.13 (Content on Hover or Focus) is satisfied by construction: the
 * reveal is triggered by hover AND by keyboard focus, it stays visible while
 * pointer or focus remains (the tooltip lives inside the hover container, so it
 * is hoverable), and Escape dismisses it without moving pointer or focus.
 *
 * **Two prescribed triggers, ONE tooltip system.** Beside the hover-and-focus
 * reveal above there is an ACTIVATION-driven one (`useActivatedExplanationReveal`
 * + `ExplanationHelpButton`): the explanation appears only when the field's `?`
 * control is pressed. The settings surface's Model group is bound to that trigger
 * (Requirement: Collected UX Polish — settings field explanations), the composer's
 * context-usage ring stays on hover-and-focus because its own requirement
 * prescribes it (Requirement: Context-Usage Ring in the Composer Control Row).
 * Same module, same `ExplanationTooltip` element, same Escape dismissal, same
 * accessible-description wiring — a second trigger, never a second class of
 * explanation. WCAG 1.4.13 governs hover/focus-triggered content and stops
 * applying once the trigger is an explicit activation; the Escape dismissal is
 * kept anyway so both triggers behave alike.
 */

/** The open/dismiss state machine, shared by every consumer. */
export function useExplanationReveal() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  return {
    open,
    /** Spread onto the element that owns the hover/focus region. */
    revealProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        setHovered(false);
        // A leave-and-return re-reveals: the dismissal lasts for the current
        // hover/focus episode only.
        if (!focused) setDismissed(false);
      },
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
          if (!hovered) setDismissed(false);
        }
      },
      onKeyDown: (e: { key: string; stopPropagation: () => void }) => {
        // WCAG 1.4.13 "dismissable": Escape hides the revealed content without
        // moving pointer or focus. It stops there — dismissing a tooltip must
        // not also close the surface it sits on.
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setDismissed(true);
        }
      },
    },
  };
}

/**
 * The ACTIVATION-driven variant of the state machine above: `open` is flipped by
 * pressing the field's `?` help control and by nothing else — no hover, no focus.
 * Escape dismisses a revealed explanation without moving pointer or focus.
 *
 * The reveal is per-showing: `close` lets a host that outlives one showing of its
 * surface — the settings overlay stays mounted from its first open — put the
 * explanation back to hidden when the surface is shown anew, so help appears only
 * where the lecturer asked for it on THIS showing. Ephemeral and derived, exactly
 * like the Advanced disclosure's reset: no store field, nothing persisted.
 */
export function useActivatedExplanationReveal() {
  const [open, setOpen] = useState(false);
  return {
    open,
    /** Bound to the `?` control's activation (pointer AND keyboard, since it is
     * a real button). */
    toggle: () => setOpen((o) => !o),
    /** Hide a revealed explanation without a lecturer action — the per-showing
     * reset. Stable across renders (a bare `setState` setter). */
    close: useCallback(() => setOpen(false), []),
    /** Spread onto the element containing the control and its explanation, so a
     * revealed explanation is dismissable from the keyboard. */
    dismissProps: {
      onKeyDown: (e: { key: string; stopPropagation: () => void }) => {
        // Dismissing a tooltip must not also close the surface it sits on.
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      },
    },
  };
}

/**
 * The `?` help control: a REAL button, which is the whole point — it takes
 * keyboard focus in the ordinary tab order and is activated by Enter/Space like
 * any other button, where a hover target on an icon would be pointer-only. The
 * mark is an inline SVG rather than a character or an emoji (repo convention,
 * guarded by `tests/chrome-no-emoji.test.ts`).
 *
 * `fieldLabel` names the field the explanation belongs to, so the accessible name
 * identifies it ("What is Context length?") instead of reading as one of many
 * anonymous question marks. `aria-expanded` exposes whether the explanation is
 * currently revealed; the explanation itself stays the control's — and the
 * field's — accessible description regardless.
 */
export function ExplanationHelpButton({
  fieldLabel,
  explanationId,
  open,
  onToggle,
}: {
  fieldLabel: string;
  /** DOM id of the `ExplanationTooltip` this control reveals. */
  explanationId: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="set-help"
      aria-label={useChrome().settingsHelpButtonLabel({ field: fieldLabel })}
      aria-expanded={open}
      aria-controls={explanationId}
      aria-describedby={explanationId}
      onClick={onToggle}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  );
}

export function ExplanationTooltip({
  id,
  open,
  placement = "inline",
  children,
}: {
  /** DOM id — pass the same id to the control's `aria-describedby`. */
  id: string;
  open: boolean;
  placement?: "inline" | "overlay";
  children: ReactNode;
}) {
  return (
    <div
      role="tooltip"
      id={id}
      className={`set-tooltip${placement === "overlay" ? " set-tooltip-overlay" : ""}`}
      data-placement={placement}
      data-open={open ? "true" : "false"}
    >
      {children}
    </div>
  );
}
