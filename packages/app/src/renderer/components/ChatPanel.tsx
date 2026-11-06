import { useEffect, useId, useRef, useState, type ClipboardEvent } from "react";
import { useCbe } from "../state/store.js";
import { MarkdownView } from "./MarkdownView.js";
import { ToolCard, isRenderablePickerCard } from "./ToolCard.js";
import { WorkingDisclosure } from "./WorkingDisclosure.js";
import { type ActivityItem, isInteractiveCard, orderItemsForRender } from "../state/activity.js";
import { parseCanvasDetails, parseStepDetails } from "../state/conversationReducer.js";
import { SlashAutocomplete } from "./SlashAutocomplete.js";
import { ContextUsageRing } from "./ContextUsageRing.js";
import { type SlashCommand } from "../../shared/ipc-contract.js";
import { buildIngestEnvelope } from "@cbe/pi-bridge/ingest-envelope";
import { ingestFormatNames } from "@cbe/pi-bridge/ingest-formats";
import { DocChip, displayFilename } from "./DocChip.js";
import { DocTypeIcon } from "./DocTypeIcon.js";
import type { DisplayAttachment, DocType } from "../../shared/ipc-contract.js";
import { REMEDIATION_DEFAULT_EFFORT } from "../../shared/reasoning-remediation.js";
import { HELP_TOKEN } from "../../shared/help-token.js";
import { TRUNCATION_CONTINUE_PAYLOAD, TRUNCATION_RETRY_PAYLOAD } from "../../shared/truncation-cutoff.js";
import { promptFailureNotice } from "../util/errors.js";
import { chrome, useChrome } from "../chrome.js";
import { textMatchesAnyLanguage } from "../../shared/i18n/index.js";
import { FirstUseOverview } from "./FirstUseOverview.js";

// The reasoning-remediation signature check and the cbe_profile consumer moved
// with the per-session event demux; re-exported here so existing imports (tests,
// tooling) keep working.
export { shouldOfferReasoningRemediation } from "../state/conversationReducer.js";
export { applyProfileFromToolResult } from "../state/agentEvents.js";

/**
 * A document the lecturer has ingested but not yet sent. Transient renderer-only state:
 * it carries the extracted `text` so `send()` can build the envelope, but that body is
 * dropped the moment the turn is sent — only the `{ filename, docType }` display metadata
 * (a `DisplayAttachment`) reaches the turn record. `id` makes same-named files
 * independently removable.
 */
interface PendingAttachment {
  id: string;
  filename: string;
  docType: DocType;
  text: string;
}

/** Apply a finished `cbe_canvas` tool call to the VISIBLE conversation's Canvas
 * (Requirement: Live Canvas Population from Skill Tool-Calls; Design-Flow Canvas).
 * Reads the tool RESULT `details` via the shared parser — post-Pi-validation, so the
 * canvas mirrors exactly what was accepted. Skips errored calls and any non-canvas
 * result; a malformed/refusal payload is a safe no-op. Exported for testing; the
 * app-level event demux applies the same parse per slice (state/conversationReducer.ts). */
export function applyCanvasFromToolResult(result: unknown, isError: boolean): void {
  const canvas = parseCanvasDetails(result, isError);
  if (!canvas) return;
  if (canvas.action === "clear") {
    useCbe.getState().clearCanvasArtefact(canvas.step, canvas.phase, canvas.id);
    return;
  }
  useCbe.getState().applyCanvasUpdate(canvas.step, canvas.phase, canvas.id, canvas);
  // Host-derived step focus (Requirement: Deterministic Tool-Boundary Enforcement…).
  if (typeof canvas.focusStep === "number") {
    useCbe.getState().applyStepUpdate(canvas.focusStep, { focus: true });
  }
}

/** Apply a finished `cbe_step` tool call to the VISIBLE conversation's step coverage
 * (Requirement: Design-Flow Canvas). Same contract as the canvas consumer. Exported
 * for testing. */
export function applyStepFromToolResult(result: unknown, isError: boolean): void {
  const step = parseStepDetails(result, isError);
  if (!step) return;
  useCbe.getState().applyStepUpdate(step.step, step);
}

/**
 * Normal-chat projection shared by finalized and live turns. Passive tool and
 * reasoning items remain in the chronological stream but only the active
 * Working disclosure may mount them. Valid interactions stay in normal chat;
 * failed Pickers stay technical while active, then only the latest failure with
 * no later valid Picker becomes the one safe terminal recovery notice.
 */
export function normalChatItems(items: readonly ActivityItem[], options: { active?: boolean } = {}): ActivityItem[] {
  const ordered = orderItemsForRender(items as ActivityItem[]);
  let latestUnresolvedPicker = -1;

  if (!options.active) {
    let laterValidPicker = false;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const item = ordered[index]!;
      if (item.kind !== "tool" || item.data.toolName !== "cbe_picker") continue;
      if (isRenderablePickerCard(item.data)) {
        laterValidPicker = true;
      } else if (!laterValidPicker && latestUnresolvedPicker === -1) {
        latestUnresolvedPicker = index;
      }
    }
  }

  return ordered.filter((item, index) => {
    if (item.kind === "text") return true;
    if (!isInteractiveCard(item)) return false;
    if (item.data.toolName !== "cbe_picker") return true;
    if (isRenderablePickerCard(item.data)) return true;
    return index === latestUnresolvedPicker;
  });
}

function renderConversationItem(item: ActivityItem) {
  if (item.kind === "text") return <MarkdownView key={`txt-${item.id}`} text={item.text} />;
  if (item.kind === "tool" && isInteractiveCard(item)) {
    return <ToolCard key={`tool-${item.id}`} card={item.data} />;
  }
  return null;
}

// Soft-notice copy lives in the renderer's error catalog, which resolves it from
// the interface-language catalogue (Requirement:
// Tiered Error Surfacing): `promptFailureNotice` maps the busy rejection to its
// recoverable catalog copy and classifies every other prompt rejection into the
// readable provider-error state (Requirement: Collected UX Polish) — no raw
// payload and no runtime API vocabulary ever reaches the lecturer.

/**
 * "New Session" control (capability `desktop-app`, Requirement: New Session
 * Control With Canvas Carry-Over; supersedes the interim control from
 * `one-conversation-per-course` — same label and placement, upgraded semantics).
 * Confirm-then-reset, never one-click. The confirmation is SHORT: it names the
 * two kept panel surfaces by their labels (CBE Process Canvas, CBE Maturity —
 * never the retired "Artefacts") and says the conversation stays resumable from
 * Courses (the Chats tab lists it — Requirement: Course Detail Tabs: Chats and
 * Wiki). No file name, no path: the former file-name disclosure is retired with
 * its reason — the retired conversation is findable by being listed, not by its
 * UUID file name (`course-workspace`, Requirement: One Canonical Conversation
 * per Course). New Session is a CONTEXT reset, not a data reset — decisions and
 * step progress are kept too; the copy names the two panels, the kept set is
 * unchanged. A fresh-session start failure after the close shows a recoverable
 * error state with retry — the main process keeps the carry-over snapshot, so
 * retry re-attempts the start with the same artefacts.
 */
export function NewSessionControl({ locked, onError }: { locked: boolean; onError: (msg: string | null) => void }) {
  const t = useChrome();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fresh-start failure AFTER the outgoing session was closed: recoverable via
  // retry (the previous conversation's sidecars are already on disk).
  const [startFailed, setStartFailed] = useState(false);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const result = await window.cbe.freshConversation();
      useCbe.getState().hydrateConversation(result);
      setConfirming(false);
      setStartFailed(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Matched against every shipped catalogue's own entry: the notice is composed
      // main-side in the interface language, so a phrase transcribed here would stop
      // matching the moment the lecturer switched language.
      if (textMatchesAnyLanguage(msg, (c) => c.mainFreshStartFailedNotice)) {
        // Failure path: render the inline error state with the retry affordance
        // instead of a generic notice — nothing persisted is lost.
        setStartFailed(true);
        setConfirming(false);
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  // Initializing state (Requirement: New Session Control With Canvas Carry-Over,
  // Scenario: Initializing state bridges the reset gap): while the fresh session
  // starts, the gap must not look like a frozen UI with a silently locked composer.
  if (busy) {
    return (
      <span className="new-session-confirm new-session-initializing" role="status">
        <span className="new-session-confirm-text">{t.chatNewSessionStarting}</span>
      </span>
    );
  }

  if (startFailed) {
    return (
      <span className="new-session-confirm new-session-error" role="alert">
        <span className="new-session-confirm-text">
          {/* Plain primary sentence, no transport detail; the secondary line
              points at Courses — no file name or path (Requirement: New Session
              Control With Canvas Carry-Over, Failure path). */}
          {t.chatNewSessionFailedText}
          <span className="new-session-confirm-detail">{t.chatNewSessionFailedDetail}</span>
        </span>
        <button type="button" className="pp-action" disabled={busy} onClick={() => void start()}>
          {t.appRetry}
        </button>
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="new-session-confirm" role="alertdialog" aria-label={t.chatNewSessionConfirmLabel}>
        <span className="new-session-confirm-text">
          {/* Short copy (Scenario: Confirmation is short, names the kept panels,
              and points at Courses): the two panel surfaces by their labels, the
              resume route, nothing else — no file name, no path, no enumeration.
              New Session is a CONTEXT reset, not a data reset — the copy must not
              claim step progress or the maturity reading are cleared, because
              they are not. */}
          {t.chatNewSessionConfirmText}
        </span>
        <button type="button" className="pp-action" disabled={busy} onClick={() => void start()}>
          {t.chatNewSessionConfirmAction}
        </button>
        <button type="button" className="pp-action" disabled={busy} onClick={() => setConfirming(false)}>
          {t.chatCancel}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="pp-action new-session-btn"
      disabled={locked}
      title={locked ? t.chatNewSessionLockedReason : t.chatNewSessionTitle}
      onClick={() => setConfirming(true)}
    >
      {t.chatNewSessionLabel}
    </button>
  );
}

/** Re-exported from `shared/help-token.ts`: the main process needs the same
 * token to recognise the help turn (Requirement: App-UI Reference Injected on
 * the Help-Token Turn) and must not import a React component to learn it. The
 * renderer keeps importing it from here. */
export { HELP_TOKEN };

/**
 * The inline stopped-turn marker (capability `desktop-app`, Requirement:
 * *Composer Control Row*). The app's chat-notice idiom attached to the turn,
 * with an accessible name conveying the same thing the copy does, so the fact
 * reaches a screen-reader user who never sees the styling.
 */
export function StoppedTurnMarker() {
  const marker = useChrome().chatStoppedTurnMarker;
  return (
    <div className="chat-notice chat-notice-stopped" role="note" aria-label={marker}>
      <div className="chat-notice-text">{marker}</div>
    </div>
  );
}

/**
 * The send slot rendered as the STOP control (capability `desktop-app`,
 * Requirement: *Composer Control Row*).
 *
 * It follows the composer's run LOCK, not the run — which is why the caller
 * renders it for the whole locked window, including the gap between the prompt
 * being dispatched and the run starting. That leaves no third state in which the
 * button lies about what it does: a stop issued in that gap latches host-side
 * rather than silently doing nothing.
 *
 * Same footprint as send (one shared `.send` sizing rule plus the `.stop`
 * modifier), so the row does not shift at either transition, and an inline SVG
 * glyph — the chrome-glyph guard forbids the geometric-shape characters.
 */
export function ComposerStopButton({
  pending,
  disabledReason,
  onStop,
}: {
  /** The stop is settling: a distinct presentation, and not re-activatable. */
  pending: boolean;
  /** Non-null while the stop is refused (the compaction companion sequence).
   * Rendered via `aria-disabled` so the control stays focusable and announced,
   * with the reason as its accessible description. */
  disabledReason: string | null;
  onStop: () => void;
}) {
  const t = useChrome();
  const reasonId = useId();
  const inert = pending || disabledReason !== null;
  const label = pending ? t.chatStopPendingLabel : t.chatStopLabel;
  return (
    <>
      <button
        type="button"
        className={`send stop${pending ? " stop-pending" : ""}`}
        aria-label={label}
        title={disabledReason ?? label}
        // `aria-disabled`, never the `disabled` attribute: a disabled control is
        // skipped by assistive technology and its reason becomes unreachable
        // without a pointer. Activating it is simply a no-op.
        aria-disabled={inert || undefined}
        {...(disabledReason !== null ? { "aria-describedby": reasonId } : {})}
        onClick={() => {
          if (inert) return;
          onStop();
        }}
      >
        {/* Square glyph as an inline SVG — never the characters U+25A0/U+25FC,
            which the chrome-glyph guard forbids. */}
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" />
        </svg>
      </button>
      {disabledReason !== null && (
        <span id={reasonId} className="visually-hidden">
          {disabledReason}
        </span>
      )}
    </>
  );
}

/**
 * The help dispatch, extracted from the retired standalone "Help me" button
 * (capability `desktop-app`, Requirement: Help-Me Button Dispatches a Structured
 * Help Request). **This hook is the ONE dispatch behind BOTH entry points** — the
 * "+" menu's _Help_ entry and the app header strip's question mark (`AppHeader`)
 * — and it owns what is dispatched, what is optimistically rendered, how a
 * rejection rolls back and what is announced. A second dispatch path, a second
 * token or a second rollback branch is the defect this arrangement prevents.
 * What it dispatches is unchanged: the bare machine token, no natural-language
 * scaffold, no language pin; the composer is NOT involved, so drafts and pending
 * attachments stay untouched. A rejected dispatch rolls the optimistic turn back
 * and surfaces as the soft chat notice.
 *
 * The hook returns the dispatcher plus the announcement each caller renders in
 * its own live region — the dispatch stays perceivable to assistive technology
 * whether it was triggered from a menu that closes on activation or from an icon
 * outside the transcript.
 */
export function useHelpDispatch(sessionId: string, locked: boolean) {
  const appendUserTurn = useCbe((s) => s.appendUserTurn);
  const removeLastUserTurn = useCbe((s) => s.removeLastUserTurn);
  const setChatNotice = useCbe((s) => s.setChatNotice);
  const setDispatchPending = useCbe((s) => s.setDispatchPending);
  const resetLiveActivity = useCbe((s) => s.resetLiveActivity);
  const finalizeRun = useCbe((s) => s.finalizeRun);
  const [announcement, setAnnouncement] = useState("");

  const dispatchHelp = () => {
    if (locked) return;
    setChatNotice(null);
    // Optimistic display turn (display/payload split, iteration-toolbar precedent);
    // rolled back if the dispatch is rejected — no phantom turns.
    const displayText = chrome().chatHelpDisplayText;
    appendUserTurn(displayText);
    setAnnouncement(chrome().chatHelpAnnouncement);
    resetLiveActivity(sessionId);
    setDispatchPending(true);
    void window.cbe
      .sendPrompt(sessionId, HELP_TOKEN, { text: displayText })
      .then(() => finalizeRun(sessionId))
      .catch((err: unknown) => {
        removeLastUserTurn();
        const notice = promptFailureNotice(err instanceof Error ? err.message : String(err));
        setChatNotice(notice);
        setAnnouncement(notice.text);
      })
      .finally(() => setDispatchPending(false));
  };

  return { dispatchHelp, announcement };
}

/**
 * The composer's "+" menu (capability `desktop-app`, Requirement: Composer
 * Control Row). A round icon-only button opening an upward ARIA menu with at
 * most two entries — _Upload files_ (gated on the `ingestion` affordance)
 * and _Help_. Never a file dialog, never a direct action.
 *
 * The three close paths are ALL lecturer-initiated (Escape, entry activation,
 * outside click) and each returns focus to the "+". A run-lock transition in
 * either direction deliberately does NOT close it: a run can start without the
 * composer being touched at all (a canvas dispatch, a picker answer), and
 * closing on an event the lecturer did not cause would yank focus. The entries'
 * enabled state updates in place instead.
 *
 * A disabled entry uses `aria-disabled` rather than the `disabled` attribute, so
 * it stays focusable and announced, and carries its reason as its accessible
 * description — a `title` on a `disabled` control is invisible to a keyboard
 * user and is the idiom this menu deliberately does not copy.
 */
export function ComposerPlusMenu({
  open,
  onOpenChange,
  ingestionAvailable,
  locked,
  onUpload,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ingestionAvailable: boolean;
  locked: boolean;
  onUpload: () => void;
  onHelp: () => void;
}) {
  const t = useChrome();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reasonId = useId();

  const entries: { key: string; label: string; title?: string; onActivate: () => void }[] = [
    ...(ingestionAvailable
      ? [
          {
            key: "upload",
            label: t.chatUploadEntryLabel,
            // The list comes from the one accepted-extension declaration, never from
            // the catalogue: the tooltip and the model-facing descriptor report the
            // same set by construction.
            title: t.chatIngestFormatsHint({ formats: ingestFormatNames() }),
            onActivate: onUpload,
          },
        ]
      : []),
    { key: "help", label: t.chatHelpEntryLabel, onActivate: onHelp },
  ];

  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // Outside click — one of the three lecturer-initiated close paths. `mousedown`
  // so the menu is gone before a click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(true);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // `close` is stable enough for this effect's purpose (it only reads refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus the first entry when the menu opens — the ARIA menu-button pattern.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  function moveFocus(delta: number) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="composer-menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={`composer-plus${open ? " composer-plus-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.chatPlusMenuLabel}
        onClick={() => (open ? close(true) : onOpenChange(true))}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
          <path d="M8 2.75v10.5M2.75 8h10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="composer-menu"
          role="menu"
          aria-label={t.chatPlusMenuLabel}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              moveFocus(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {/* The disabled entries' reason: rendered once, referenced as their
              accessible DESCRIPTION so a keyboard user hears it. */}
          <span className="visually-hidden" id={reasonId}>
            {t.chatComposerLockedReason}
          </span>
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="menuitem"
              className="composer-menu-item"
              aria-disabled={locked || undefined}
              {...(locked ? { "aria-describedby": reasonId } : {})}
              {...(entry.title ? { title: entry.title } : {})}
              onClick={() => {
                // An `aria-disabled` entry stays focusable and announced; activating
                // it is a no-op that carries its reason.
                if (locked) return;
                close(true);
                entry.onActivate();
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rendered cap on the model id inside the pill. The persisted value is
 * free-typed and neither length-capped nor character-constrained, so the pill
 * states its own maxima rather than trusting it (Requirement: Composer Control
 * Row — "the model id is untrusted, free-typed text"). */
export const MODEL_PILL_LABEL_MAX = 28;
/** Cap on the hover / accessible-name form of the same id. Longer than the
 * rendered one, still bounded — never unbounded. */
export const MODEL_PILL_TITLE_MAX = 96;

/** Truncate with an ellipsis at a stated maximum. Newlines are folded to a space
 * so a pasted multi-line value cannot break the row. */
export function capModelId(id: string, max: number): string {
  const flat = id.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The composer control row's model pill (capability `desktop-app`, Requirement:
 * Composer Control Row). Display-only: it shows the configured model id and
 * opens the Profile-and-Settings overlay at the Settings section's **Model**
 * group — no model list, no request to the endpoint, no switching. It carries no
 * size badge and no chevron, and never the provider host.
 *
 * It stays ENABLED while a run is in flight: opening the settings surface is not
 * a dispatch, so the composer's run lock does not govern it.
 */
export function ModelPill() {
  const t = useChrome();
  const providerStatus = useCbe((s) => s.providerStatus);
  const showSettingsSurface = useCbe((s) => s.showSettingsSurface);
  const setSettingsOpenGroup = useCbe((s) => s.setSettingsOpenGroup);

  const rawId = providerStatus?.modelId ?? "";
  const blank = rawId.trim().length === 0;
  // Plain text, never the Markdown pipeline: the id is free-typed and may carry
  // brackets, backticks or underscores, which must render literally.
  const label = blank ? t.chatModelPillBlankLabel : capModelId(rawId, MODEL_PILL_LABEL_MAX);
  const longForm = blank ? t.chatModelPillBlankLabel : capModelId(rawId, MODEL_PILL_TITLE_MAX);
  const accessibleName = t.chatModelPillAccessibleName({ purpose: t.chatModelPillPurpose, modelId: longForm });

  return (
    <button
      type="button"
      className="model-pill"
      title={accessibleName}
      aria-label={accessibleName}
      onClick={() => {
        showSettingsSurface("settings");
        setSettingsOpenGroup("model");
      }}
    >
      {/* Cube icon — inline SVG in `currentColor`, never an emoji. */}
      <svg className="model-pill-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
          d="M8 1.6 14 5v6l-6 3.4L2 11V5L8 1.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M2 5l6 3.4L14 5M8 8.4v6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="model-pill-name">{label}</span>
    </button>
  );
}

/**
 * "Response was cut off" state (capability `desktop-app`, Requirement:
 * Response-Cut-Off State with One-Click Continue and Retry). Rendered when the
 * harness surfaced a truncated completion it could no longer auto-continue
 * (`truncation_cutoff` event → conversation slice → visible mirror). Both
 * affordances are ONE click: a normal prompt dispatch with the display/payload
 * split (the transcript shows the chrome text, the model receives the
 * instruction), sharing the run lock with the composer — no dispatch while a
 * run is in flight. The state clears at the next run's `agent_start`; a
 * rejected dispatch rolls the optimistic turn back and surfaces the soft chat
 * notice (Tiered Error Surfacing).
 */
export function TruncationCutoffNotice({
  sessionId,
  note,
  locked,
}: {
  sessionId: string;
  note: string;
  locked: boolean;
}) {
  const t = useChrome();
  const appendUserTurn = useCbe((s) => s.appendUserTurn);
  const removeLastUserTurn = useCbe((s) => s.removeLastUserTurn);
  const setChatNotice = useCbe((s) => s.setChatNotice);
  const setDispatchPending = useCbe((s) => s.setDispatchPending);
  const resetLiveActivity = useCbe((s) => s.resetLiveActivity);
  const finalizeRun = useCbe((s) => s.finalizeRun);

  const dispatch = (payload: string, displayText: string) => {
    if (locked) return;
    setChatNotice(null);
    // Optimistic display turn (display/payload split, help-me precedent);
    // rolled back if the dispatch is rejected — no phantom turns.
    appendUserTurn(displayText);
    resetLiveActivity(sessionId);
    setDispatchPending(true);
    void window.cbe
      .sendPrompt(sessionId, payload, { text: displayText })
      .then(() => finalizeRun(sessionId))
      .catch((err: unknown) => {
        removeLastUserTurn();
        setChatNotice(promptFailureNotice(err instanceof Error ? err.message : String(err)));
      })
      .finally(() => setDispatchPending(false));
  };

  return (
    <div className="chat-notice chat-notice-cutoff content-column" role="status">
      <div className="chat-notice-text">{note}</div>
      <div className="chat-notice-actions">
        <button
          type="button"
          className="send"
          disabled={locked}
          title={locked ? t.chatNewSessionLockedReason : t.chatContinueTitle}
          onClick={() => dispatch(TRUNCATION_CONTINUE_PAYLOAD, t.chatContinueLabel)}
        >
          {t.chatContinueLabel}
        </button>
        <button
          type="button"
          className="pp-action"
          disabled={locked}
          title={locked ? t.chatNewSessionLockedReason : t.chatRetryTitle}
          onClick={() => dispatch(TRUNCATION_RETRY_PAYLOAD, t.chatRetryLabel)}
        >
          {t.chatRetryLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The soft chat notice for a stop that timed out, with its way out (capability
 * `desktop-app`, Requirement: *Composer Control Row*).
 *
 * The composer stays locked until the run actually ends — a lock released over a
 * live run would let a second prompt race the first — and New Session is itself
 * disabled while a run is in flight. Without a recovery here that state is a
 * dead end whose only exit is quitting the app, so the notice carries a
 * force-close that ends the conversation and starts a fresh one. Destructive, so
 * it confirms first, on the New Session confirmation's discipline.
 */
export function StopTimedOutNotice() {
  const t = useChrome();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const forceClose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.cbe.freshConversation({ force: true });
      useCbe.getState().hydrateConversation(result);
      setConfirming(false);
      setFailed(false);
    } catch {
      // Nothing persisted is lost — the closing flush ran before the start.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-notice chat-notice-stop-timeout content-column" role="status">
      <div className="chat-notice-text">{t.chatStopTimedOutNoticeText}</div>
      {confirming ? (
        <>
          <div className="chat-notice-hint">{t.chatStopTimedOutRecoveryConfirm}</div>
          <div className="chat-notice-actions">
            <button type="button" className="pp-action" disabled={busy} onClick={() => void forceClose()}>
              {busy ? t.chatForceCloseBusy : t.chatForceCloseAction}
            </button>
            <button type="button" className="pp-action" disabled={busy} onClick={() => setConfirming(false)}>
              {t.chatCancel}
            </button>
          </div>
        </>
      ) : (
        <div className="chat-notice-actions">
          <button type="button" className="pp-action" onClick={() => setConfirming(true)}>
            {t.chatStopTimedOutRecoveryLabel}
          </button>
        </div>
      )}
      {failed && <div className="chat-notice-hint">{t.chatForceCloseFailed}</div>}
    </div>
  );
}

export function ChatPanel() {
  const t = useChrome();
  const session = useCbe((s) => s.session);
  // Chat text size (Requirement: Settings Panel, chat text-size control): the
  // store value binds as a data attribute on the chat scroll container and on
  // the composer; styles.css maps it to the font-size variable that the
  // transcript text and the composer input consume.
  const chatTextSize = useCbe((s) => s.chatTextSize);
  const turns = useCbe((s) => s.turns);
  const appendUser = useCbe((s) => s.appendUserTurn);
  const setError = useCbe((s) => s.setError);
  const [input, setInput] = useState("");
  // Ingested-but-unsent documents shown as removable pills above the composer. The
  // textarea stays clean for the lecturer's instruction; the envelope is built from
  // these at send time (capability desktop-app, Requirement: Ingested Documents Appear
  // as Pending Attachments in the Composer).
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // Live activity stream of the VISIBLE conversation — a store mirror of the
  // active course's conversation slice (capability `desktop-app`, Requirement:
  // Background Conversations and Per-Session Event Demultiplexing). The stream
  // is fed by the app-level event demux, survives this panel unmounting on a
  // course switch, and arrives pre-armed (`streaming: true`) when the renderer
  // re-attached to a session whose turn is still running in the main process.
  const live = useCbe((s) => s.live);
  const finalizeRun = useCbe((s) => s.finalizeRun);
  const resetLiveActivity = useCbe((s) => s.resetLiveActivity);
  // Chat-local notice (e.g. "Agent is already processing") — shown inline above the
  // composer, NOT as a global red top banner. Reserved for soft errors that the
  // lecturer can recover from by waiting / retrying; hard failures still go to setError.
  // Soft inline chat notice — store-level so canvas dispatches (ArtifactsPanel)
  // route their recoverable failures to the same surface (Tiered Error Surfacing).
  const notice = useCbe((s) => s.chatNotice);
  const setNotice = useCbe((s) => s.setChatNotice);
  const dispatchPending = useCbe((s) => s.dispatchPending);
  const setDispatchPending = useCbe((s) => s.setDispatchPending);
  // Local lock that complements live.streaming: covers the small window between
  // user click and the first turn_start event firing, so a fast second click can't
  // race into pi's "Agent is already processing" error. `live.streaming` is the
  // VISIBLE slice's running flag — a running background turn never locks this
  // composer (Scenario: Composer locks only for the visible running conversation).
  const [submitting, setSubmitting] = useState(false);
  const isLocked = submitting || live.streaming || dispatchPending;
  // The lecturer stop (capability `desktop-app`, Requirement: *Composer Control
  // Row*). `stopping` drives the settling presentation and blocks a second
  // activation: it is panel-local because it lives and dies with one click.
  // `stopTimedOut` raises the honest notice with its way out and is NOT — it is
  // the VISIBLE conversation's slice field, because a course switch unmounts
  // this panel while the run lock it reports on survives, and a panel-local flag
  // would take the recovery down with it.
  const [stopping, setStopping] = useState(false);
  const stopTimedOut = useCbe((s) => s.stopTimedOut);
  const noteStopTimedOut = useCbe((s) => s.noteStopTimedOut);
  // The compaction companion sequence, from the same live state the banner
  // reads: the stop is refused for the whole of it (consolidation, then the
  // runtime's own compaction), and the refusal is visible rather than silent.
  const compactionRunning = live.companionPhase !== null || live.compactionReason !== null;
  // Reasoning remediation (Requirement: Reasoning Remediation for Tool-Call-Gated
  // Models). The offer flag lives in the conversation slice (set by the event
  // demux when the opening exchange completes with the no-tool-call signature).
  const offerReasoningRemediation = useCbe((s) => s.offerReasoningRemediation);
  const dismissReasoningRemediation = useCbe((s) => s.dismissReasoningRemediation);
  // "Response was cut off" state of the VISIBLE conversation (Requirement:
  // Response-Cut-Off State with One-Click Continue and Retry) — set by the
  // harness's surfaced truncation verdict, cleared at the next run start.
  const cutOffNote = useCbe((s) => s.cutOffNote);
  const [remediating, setRemediating] = useState(false);
  // Slash-command autocomplete: commands fetched once per session; the panel is
  // shown while the composer holds a `/name` token (no space yet) and not dismissed.
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [slashClosed, setSlashClosed] = useState(false);
  const slashQuery = input.startsWith("/") && !input.includes(" ") ? input.slice(1) : null;
  // A popup belonging to the composer has no business handling keys while the
  // Profile-and-Settings overlay is drawn over it: its capture-phase document
  // listener would swallow the overlay's Escape, and accepting a command would
  // pull focus onto the composer behind the backdrop. The draft is untouched —
  // the panel reappears with it the moment the overlay closes.
  const overlayOpen = useCbe((s) => s.overlaySection !== null);
  const onboardingStatus = useCbe((s) => s.onboardingStatus);
  const onboardingAnnounced = useCbe((s) => s.onboardingAnnounced);
  const modalSurfaceOpen = useCbe((s) => s.modalSurfaceOpen);
  const markOnboardingAnnounced = useCbe((s) => s.markOnboardingAnnounced);
  const [onboardingAnnouncement, setOnboardingAnnouncement] = useState("");
  const showSlash = slashQuery !== null && !slashClosed && commands.length > 0 && !overlayOpen;
  // The "+" menu's open state. It is NOT a function of the run lock: a
  // transition in either direction updates the entries in place and leaves the
  // menu (and focus) exactly where the lecturer put them.
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Input-method composition state, read from the platform's own composition
  // events. `Enter` commits a candidate in a candidate-based IME and must not
  // send there.
  const composingRef = useRef(false);
  // Jump-to-latest state. `scrolledUp` is true when the chat-scroll viewport is
  // more than ~200 px away from the bottom — i.e. there is non-visible content
  // below the lecturer's vantage point. That alone is the trigger for the
  // floating pill; we deliberately do NOT additionally gate on "new turn
  // arrived" or "stream is live", because the lecturer's mental model is
  // simpler: "if there's text below I can't see, give me a way to jump there".
  const [scrolledUp, setScrolledUp] = useState(false);
  const SCROLL_THRESHOLD_PX = 200;

  // Auto-grow the textarea to fit content. CSS clamps min/max-height; we just set
  // height = scrollHeight so the box hugs the content within the clamp range.
  // Above max-height, the textarea scrolls internally (CSS overflow-y: auto).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // Plain-text paste. Rich-text sources (Word, Google Docs, Notion) can carry
  // smart quotes and HTML fragments that break Markdown round-tripping and corrupt
  // citation tokens. We intercept and insert only `text/plain` at the caret.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const t = e.currentTarget;
    const start = t.selectionStart ?? input.length;
    const end = t.selectionEnd ?? input.length;
    const next = input.slice(0, start) + text + input.slice(end);
    setInput(next);
    // Restore the caret position to immediately after the pasted text.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = start + text.length;
      textareaRef.current.selectionStart = textareaRef.current.selectionEnd = pos;
    });
  }

  /**
   * Confirm the reasoning remediation: enable reasoning for the active provider and
   * re-bind the running session via the EXISTING runtime re-bind path (`setConfig`
   * applies the persisted provider to every running session — the same path Settings
   * save uses). The apiKey is omitted so the persisted key is preserved; the
   * transcript is untouched. No mutation happens unless the lecturer confirms.
   */
  async function confirmReasoningRemediation() {
    const ps = useCbe.getState().providerStatus;
    if (!ps) {
      dismissReasoningRemediation();
      return;
    }
    setRemediating(true);
    setError(null);
    try {
      const result = await window.cbe.setConfig({
        baseURL: ps.baseURL,
        modelId: ps.modelId,
        reasoning: true,
        reasoningEffort: REMEDIATION_DEFAULT_EFFORT,
      });
      const swap = result.activeSwap;
      if (swap && !swap.ok) {
        setError(t.chatReasoningSwapFailed({ error: swap.error }));
      } else {
        // Reflect the new reasoning state so Settings mirrors it and the
        // remediation never re-offers for this provider.
        useCbe.getState().setProviderStatus({ ...ps, reasoning: true, reasoningEffort: REMEDIATION_DEFAULT_EFFORT });
        dismissReasoningRemediation();
        setNotice({ text: t.chatReasoningEnabledNotice });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemediating(false);
    }
  }

  // Fetch the session's slash commands once it exists (pi built-ins + /cite).
  useEffect(() => {
    if (!session?.sessionId) return;
    let cancelled = false;
    void window.cbe
      .getCommands(session.sessionId)
      .then((cmds) => {
        if (!cancelled) setCommands(cmds);
      })
      .catch(() => {
        /* autocomplete is a convenience; ignore enumeration failures */
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId]);

  // NOTE: no `onAgentEvent` subscription here. Agent events are demultiplexed by
  // sessionId at APPLICATION level (state/agentEvents.ts) into per-session
  // conversation slices — this panel only renders the visible slice's mirror.
  // The demux also finalizes runs on `agent_end` regardless of what initiated
  // them (the picker → text → reply → text-gone data-loss fix lives there now).

  // Auto-scroll to the bottom on new content ONLY if the lecturer is at the
  // bottom; if they have scrolled up to re-read, do not steal their viewport.
  // The jump-to-latest button is the affordance back to the bottom in that case.
  useEffect(() => {
    if (scrolledUp) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length, live.items.length, live.streaming, scrolledUp]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const up = distanceFromBottom > SCROLL_THRESHOLD_PX;
    setScrolledUp(up);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    // Dismiss immediately — the smooth scroll runs to completion regardless;
    // the visual cue should disappear as soon as the lecturer commits to going
    // back. The scroll-handler will keep `scrolledUp` false once the animation
    // arrives within the threshold.
    setScrolledUp(false);
  }

  const showJumpToLatest = scrolledUp;
  const showOnboarding =
    onboardingStatus === "pending" && !isLocked && !overlayOpen && !modalSurfaceOpen && session !== null;

  // Announce availability once per renderer lifetime without moving focus or
  // reading the whole overview. Course switches and incidental re-renders keep
  // the application-level marker, so remounting this panel cannot repeat it.
  useEffect(() => {
    if (!showOnboarding || onboardingAnnounced) return;
    setOnboardingAnnouncement(chrome().onboardingAvailability);
    markOnboardingAnnounced();
  }, [showOnboarding, onboardingAnnounced, markOnboardingAnnounced]);

  function acknowledgeOnboardingAndFocus() {
    useCbe.getState().settleOnboarding();
    textareaRef.current?.focus();
  }

  // Help dispatch — this panel's entry point into it is the "+" menu's _Help_
  // entry; the app header strip's question mark calls the same hook. The hook
  // must run before the early return below, so it takes the session id
  // defensively; the entry is only reachable once a session exists.
  const { dispatchHelp, announcement: helpAnnouncement } = useHelpDispatch(session?.sessionId ?? "", isLocked);

  // Mutual exclusion, the other direction: a slash token opening the panel
  // closes the "+" menu. (Opening the menu closes the panel in the "+"'s own
  // handler.) Only one upward surface and one keyboard model at a time.
  useEffect(() => {
    if (showSlash) setMenuOpen(false);
  }, [showSlash]);

  /** The ingestion flow, unchanged downstream of the dialog — only its TRIGGER
   * moved out of the text field into the "+" menu's _Upload files_ entry
   * (Requirement: Material Ingestion Stub into the Chat Context). */
  async function ingestFiles() {
    const outcomes = await window.cbe.ingestFile();
    if (!outcomes) return; // lecturer cancelled the file dialog
    // The dialog allows multiselect: one outcome per file, in selection order.
    // Per-file isolation — a failing file never discards the others' pills; its
    // message joins one combined non-fatal notice.
    const added: PendingAttachment[] = [];
    const problems: string[] = [];
    for (const out of outcomes) {
      if (!out.ok) {
        problems.push(out.message);
      } else if (!out.text.trim()) {
        // Empty extraction (e.g. a scanned, image-only PDF): no usable text, so
        // no pending attachment is created — just a non-fatal notice.
        problems.push(t.chatNoTextExtractedProblem({ filename: out.filename }));
      } else {
        added.push({ id: crypto.randomUUID(), filename: out.filename, docType: out.docType, text: out.text });
      }
    }
    // Add pending pills; leave the textarea untouched. The envelope is built
    // from these at send time, not inserted into the composer.
    if (added.length > 0) setPendingAttachments((prev) => [...prev, ...added]);
    if (problems.length > 0) setNotice({ text: problems.join("\n") });
    if (added.length > 0) textareaRef.current?.focus();
  }

  if (!session) return null;

  async function send() {
    const hasAttachments = pendingAttachments.length > 0;
    // Sendable when there is typed text OR at least one pending attachment — the latter
    // preserves today's "ingest, then send with no typing" flow now that the envelope no
    // longer fills the textarea (Requirement: Pending Attachments, empty-textarea send).
    if ((!input.trim() && !hasAttachments) || !session || isLocked) return;
    const instruction = input;
    const snapshot = pendingAttachments;
    // Model payload: instruction first, then one orientation envelope per attachment in
    // pill order (envelope(s) alone when the textarea is empty). Unchanged from today —
    // the full envelope still reaches the model and the persisted transcript.
    const modelText = [instruction, ...snapshot.map((a) => buildIngestEnvelope(a.filename, a.text))]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
    // Display record: instruction + per-document metadata only, never the body — the
    // whole payload/display split (Requirement: Ingested Document Display Is Separated
    // From Its Model Payload).
    const displayAttachments: DisplayAttachment[] = snapshot.map((a) => ({
      filename: a.filename,
      docType: a.docType,
    }));
    appendUser(instruction, displayAttachments);
    setInput("");
    setPendingAttachments([]);
    setError(null);
    setNotice(null);
    resetLiveActivity(session.sessionId);
    setSubmitting(true);
    // Shared dispatch-in-flight flag: locks the canvas dispatch surfaces during
    // the click-to-agent_start window too (Canvas Dialogue-Steering Run Lock).
    setDispatchPending(true);
    try {
      // The display record travels along so the persisted turn can carry what
      // the lecturer SAW (instruction + chips) beside the lossless payload —
      // re-entry then renders the conversation as experienced, never the raw
      // envelopes (agent-harness, Requirement: Sessions as Local Markdown/JSON
      // Files, display projection). Main persists it only when it differs.
      await window.cbe.sendPrompt(session.sessionId, modelText, {
        text: instruction,
        ...(displayAttachments.length ? { attachments: displayAttachments } : {}),
      });
      // sendPrompt resolves when the agent loop is done. agent_end usually
      // finalizes first via the app-level event demux, but if it didn't (e.g.
      // early exit) we still need to flush whatever live activity was captured.
      finalizeRun(session.sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Rejected-prompt path (Requirement: Collected UX Polish, readable
      // provider-error surfacing): busy keeps its recoverable catalog copy; a
      // failed turn gets the classified provider-error state — never the raw
      // payload, never the alarm banner. Display-state only.
      setNotice(promptFailureNotice(msg));
      // Restore the pending attachments (snapshot) so the lecturer can retry without
      // re-ingesting each file through the OS dialog.
      setPendingAttachments(snapshot);
    } finally {
      setSubmitting(false);
      setDispatchPending(false);
    }
  }

  /**
   * Stop the visible conversation's running turn (capability `desktop-app`,
   * Requirement: *Composer Control Row*).
   *
   * It dispatches no prompt and creates no user turn, so it never enters the
   * dispatch lock; it names its session, so a background conversation's run is
   * untouched. Everything the harness reports back is a CLASSIFICATION, and the
   * copy for each one is this surface's own — no runtime or provider text ever
   * reaches the lecturer here.
   *
   * The lock itself is NOT released here: it is released when the run's end is
   * observed, on the same `agent_start` / `agent_end` lifecycle that engaged it.
   */
  async function stopRun() {
    // `stopTimedOut` blocks a re-activation for the same reason `stopping` does:
    // the stop is still outstanding on a run the runtime has not released, so a
    // second one buys nothing — the way out is the notice's force-close.
    if (!session || stopping || stopTimedOut || compactionRunning) return;
    setStopping(true);
    try {
      const outcome = await window.cbe.abortPrompt(session.sessionId);
      // Timed out: the runtime still holds the run, so the composer stays locked
      // and the notice carries the force-close recovery. Every other outcome —
      // stopped, superseded by the loop breaker, nothing running, refused — needs
      // no surface of its own: the run either ends (and the lock releases with
      // it) or never existed.
      //
      // RAISED only, never cleared here. The run boundary in the conversation
      // reducer is the single honest signal that the dead end is over: a later
      // outcome for the same held run cannot be `timed-out` a second time, so
      // clearing on it would delete the only way out the lecturer has.
      if (outcome.status === "timed-out") noteStopTimedOut(session.sessionId);
    } catch {
      // The stop call itself failing is not a lecturer-facing failure: the run
      // is whatever it was, and the lock still follows the run's own lifecycle.
    } finally {
      setStopping(false);
    }
  }

  const livePresentationItems = normalChatItems(live.items, { active: true });
  const liveTextItems = livePresentationItems.filter((item) => item.kind === "text");
  const liveInteractiveItems = livePresentationItems.filter(isInteractiveCard);
  // Whitespace-only deltas do not give the lecturer a visible progress signal.
  // Once real prose exists it replaces the default closed Working disclosure;
  // an explicitly opened disclosure retains itself to protect focus and detail.
  const hasVisibleLiveText = liveTextItems.some((item) => item.kind === "text" && item.text.trim().length > 0);
  // `live.items.length` keeps the run active across event gaps (a retry's
  // backoff included) without changing event reduction: the host's settled
  // `agent_end` finalizes and resets the list in the same reducer transaction.
  const activityActive =
    submitting ||
    dispatchPending ||
    live.streaming ||
    live.items.length > 0 ||
    compactionRunning ||
    live.retryAttempt !== null;
  // `activityActive` already covers a non-empty `live.items`, of which the
  // presentation items are a filtered projection — no second operand can decide it.
  const showStreamingBubble = activityActive;

  return (
    <section className="conv" aria-label={t.chatConversationLabel}>
      {/* Conversation header (Requirement: Pinned Session Controls): a slim row
          OUTSIDE the transcript scroll region — always visible, layout not
          overlay; inline confirm/error states grow the row downward and the
          transcript viewport yields the height. It hosts New Session ALONE; the
          Help control moved into the composer's "+" menu. The question mark in
          the APP header strip is a different row and does not change this one
          (Requirement: App Header Strip). */}
      {/* The header's BORDER BOX stays full-bleed so its bottom border reads as
          the column's edge; its CONTENTS carry the content column (Requirement:
          One Centred Content Column for the Conversation). */}
      <div className="conv-header">
        <div className="conv-header-inner content-column">
          {/* Fresh-conversation affordance, reachable from the chat view (spec:
              "MUST be reachable from the workspace/chat view"). */}
          <NewSessionControl locked={isLocked} onError={(msg) => setNotice(msg ? { text: msg } : null)} />
        </div>
      </div>

      {/* A separate layout row between the pinned controls and transcript. It is
          never a turn and never a composer child; hidden readiness states leave
          a zero-height grid row and acknowledge nothing. */}
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {onboardingAnnouncement}
      </span>
      <div className="first-use-row conv-row" hidden={!showOnboarding}>
        <div className="content-column first-use-row-inner">
          <FirstUseOverview
            id="first-use-overview"
            mode="automatic"
            onBegin={acknowledgeOnboardingAndFocus}
            onSkip={acknowledgeOnboardingAndFocus}
          />
        </div>
      </div>

      <div className="chat-scroll" data-chat-text-size={chatTextSize} ref={scrollRef} onScroll={handleScroll}>
        {/* Everything that scrolls sits in the content column. The
            jump-to-latest pill deliberately does NOT: it is centred against the
            scroll viewport and stays a direct child of it, unchanged. */}
        <div className="chat-column content-column">
          {turns.map((turn, i) => {
            if (turn.role !== "user") {
              const items = normalChatItems(turn.activity);
              // A re-entered turn can arrive with NOTHING to present: a turn that
              // streamed no text and recorded only passive technical calls, which
              // normal chat never replays (capability `desktop-app`, Requirement:
              // *Lecturer-Facing Turn Presentation* — a passive-only turn creates
              // no empty bubble and no invented success text). An empty bubble is
              // the one shape that reads as a defect, so the turn is not drawn. A
              // stopped turn is the exception: its marker is content, and it
              // renders alone.
              if (items.length === 0 && !turn.stopped) return null;
              return (
                <div key={i} className="msg msg-skill">
                  <div className="msg-role visually-hidden">{t.chatRoleAssistant}</div>
                  <div className="msg-text">{items.map(renderConversationItem)}</div>
                  {/* A turn the lecturer stopped keeps its text — they watched it
                    arrive — but is never presented as a completed one
                    (Requirement: Composer Control Row). The marker rides the
                    persisted turn, so it is still here after a reload and after
                    a session re-entry. */}
                  {turn.stopped ? <StoppedTurnMarker /> : null}
                </div>
              );
            }
            return (
              <div key={i} className="msg msg-lecturer">
                <div className="msg-role visually-hidden">{t.chatRoleLecturer}</div>
                {/* Empty instruction (attachment-only turn) renders no text bubble — just
                  the chips — so the padded/filled .msg-text box doesn't show up empty. */}
                {turn.text.trim() ? <div className="msg-text">{turn.text}</div> : null}
                {turn.attachments && turn.attachments.length > 0 ? (
                  <div className="doc-chips">
                    {turn.attachments.map((a, j) => (
                      <DocChip key={j} filename={a.filename} docType={a.docType} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {showStreamingBubble && (
            <div className="msg msg-skill">
              <div className="msg-role visually-hidden">{t.chatRoleAssistant}</div>
              <div className="msg-text">
                {activityActive && (
                  <WorkingDisclosure key={session.sessionId} items={live.items} answerVisible={hasVisibleLiveText} />
                )}
                {liveTextItems.map(renderConversationItem)}
                {liveInteractiveItems.map(renderConversationItem)}
              </div>
            </div>
          )}
        </div>

        {showJumpToLatest && (
          <button
            type="button"
            className="jump-to-latest mono"
            onClick={jumpToLatest}
            aria-label={t.chatJumpToLatestLabel}
          >
            <span className="jump-to-latest-arrow" aria-hidden="true">
              ↓
            </span>
            <span>{t.chatJumpToLatestText}</span>
          </button>
        )}
      </div>

      <div className="chat-notices">
        {/* The three notice surfaces outside the scroll region: each row carries
          the scrollbar reservation, each notice carries the content column
          (Requirement: One Centred Content Column…). The wrapper is load-bearing
          — `.chat-notices` in `styles.css` owns why they share one grid row. */}
        {stopTimedOut && (
          <div className="conv-row">
            <StopTimedOutNotice />
          </div>
        )}

        {cutOffNote && (
          <div className="conv-row">
            <TruncationCutoffNotice sessionId={session.sessionId} note={cutOffNote} locked={isLocked} />
          </div>
        )}

        {offerReasoningRemediation && (
          <div className="conv-row">
            <div className="chat-notice chat-notice-remediation content-column" role="status">
              <div className="chat-notice-text">{t.chatReasoningOffer}</div>
              <div className="chat-notice-actions">
                <button
                  type="button"
                  className="send"
                  disabled={remediating}
                  onClick={() => void confirmReasoningRemediation()}
                >
                  {remediating ? t.chatEnablingReasoning : t.chatEnableReasoning}
                </button>
                <button
                  type="button"
                  className="chat-notice-close"
                  aria-label={t.chatDismissReasoningSuggestion}
                  onClick={() => dismissReasoningRemediation()}
                >
                  {t.chatNotNow}
                </button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div className="conv-row">
            <div className="chat-notice content-column" role="status">
              <button
                type="button"
                className="chat-notice-close"
                onClick={() => setNotice(null)}
                aria-label={t.chatDismissNotice}
              >
                ×
              </button>
              <div className="chat-notice-text">{notice.text}</div>
              {notice.hint && <div className="chat-notice-hint mono">{notice.hint}</div>}
            </div>
          </div>
        )}
      </div>

      {/* The composer carries the chat text-size attribute too: what the lecturer types
          renders at the size they read at (Requirement: Collected UX-2 Fixes, Scenario:
          *The composer input follows the chat text-size setting*). */}
      <div className={`composer ${isLocked ? "composer-locked" : ""}`} data-chat-text-size={chatTextSize}>
        {/* The slash panel is composer chrome anchored to the card; it shares the
            card's column so the composer is not the one surface whose popup is
            full-bleed. Its own contract is untouched. */}
        {showSlash && slashQuery !== null && (
          <SlashAutocomplete
            commands={commands}
            query={slashQuery}
            onAccept={(cmd) => {
              // Insert the command into the composer; the trailing space closes the
              // panel (slashQuery becomes null) and lets the lecturer add arguments.
              // It dispatches through pi's normal input pathway on submit.
              setInput(`/${cmd.name} `);
              textareaRef.current?.focus();
            }}
            onClose={() => setSlashClosed(true)}
          />
        )}
        {/* THE CARD. Exactly three children, top to bottom: the pending
            attachment pills (when any), the text area and the control row
            (Requirement: Long-Form Composer for Lecturer Input). No separator
            between the text area and the row, and no second border around the
            text area — the card is the frame. The card carries NO hint or status
            line: the unlocked hint restated a key binding every chat application
            shares, and the locked one named a state the send slot already shows
            by becoming the stop control. */}
        <div className="composer-box content-column">
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments" aria-label={t.chatPendingAttachmentsLabel}>
              {pendingAttachments.map((a) => {
                const name = displayFilename(a.filename);
                return (
                  <span className="pending-pill" key={a.id} data-doctype={a.docType}>
                    <DocTypeIcon type={a.docType} />
                    <span className="pending-pill-name" title={name}>
                      {name}
                    </span>
                    <button
                      type="button"
                      className="pending-pill-remove"
                      aria-label={t.chatRemoveAttachmentLabel({ filename: name })}
                      onClick={() => setPendingAttachments((prev) => prev.filter((p) => p.id !== a.id))}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            data-workspace-focus-target
            rows={3}
            // No placeholder in either state (Requirement: Long-Form Composer
            // for Lecturer Input): that a text field is where you type is
            // self-evident, and the locked-state placeholder restated a lock the
            // send slot already shows by becoming the stop. The field keeps an
            // accessible NAME, because an unnamed textbox is not self-evident to
            // assistive technology — static, and never naming the lock.
            aria-label={t.chatComposerFieldLabel}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Re-open the panel on fresh typing after an Esc dismiss.
              setSlashClosed(false);
            }}
            onPaste={handlePaste}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Shift+Enter inserts a newline (textarea default).
              if (e.shiftKey) return;
              // An input-method composition owns this Enter: it COMMITS the
              // candidate. Read the platform's own composition state (the
              // event's `isComposing` plus the composition start/end events) —
              // never a keycode heuristic, never a layout assumption.
              if (e.nativeEvent.isComposing || composingRef.current) return;
              // NO slash-panel guard here, deliberately. The panel claims Enter
              // on the document in the CAPTURE phase while it has at least one
              // match, so this handler is never reached in that case — and the
              // carve-out is bounded by the panel's own MATCH state, which this
              // component does not know (`showSlash` is true for a `/token` with
              // no match too, where Enter must send). A guard here would
              // pre-empt the panel, which the requirement forbids.
              e.preventDefault();
              if (!isLocked) void send();
            }}
          />
          {/* THE CONTROL ROW: the "+" on the left; the model pill and the send
              button on the right (Requirement: Composer Control Row). It never
              wraps — the pill is the only element permitted to shrink. */}
          <div className="composer-row">
            <div className="composer-row-left">
              <ComposerPlusMenu
                open={menuOpen}
                onOpenChange={(next) => {
                  // Mutual exclusion with the slash panel: only one upward
                  // surface, and one keyboard model, is live at a time.
                  if (next) setSlashClosed(true);
                  setMenuOpen(next);
                }}
                ingestionAvailable={session.affordances.ingestion !== false}
                locked={isLocked}
                onUpload={() => void ingestFiles()}
                onHelp={dispatchHelp}
              />
            </div>
            <div className="composer-row-right">
              {/* The row's single permitted STATUS INDICATOR, immediately left
                  of the model pill (Requirement: Context-Usage Ring in the
                  Composer Control Row). It performs nothing and is not a
                  button — the row still carries exactly three actions. */}
              <ContextUsageRing />
              <ModelPill />
              {/* ONE slot, two states, never both rendered (Requirement:
                  Composer Control Row). It follows the LOCK, not the run — so
                  there is no window in which an enabled-looking stop does
                  nothing: a stop issued before the run starts latches
                  host-side. The stop is not a fourth action in the row; it is
                  the second state of this one. */}
              {isLocked ? (
                <ComposerStopButton
                  // A timed-out stop is still outstanding — the run is held and
                  // the notice carries the way out — so the control keeps the
                  // SETTLING presentation rather than re-arming into a third
                  // state that would do nothing on click.
                  pending={stopping || stopTimedOut}
                  disabledReason={compactionRunning ? t.chatStopCompactionReason : null}
                  onStop={() => void stopRun()}
                />
              ) : (
                <button
                  className="send"
                  type="button"
                  onClick={() => void send()}
                  disabled={!input.trim() && pendingAttachments.length === 0}
                  aria-label={t.chatSendLabel}
                  title={t.chatSendTitle}
                >
                  {/* Up arrow as an inline SVG — never the character U+2191, which
                      the chrome-glyph guard forbids. */}
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
                    <path
                      d="M8 13V3.6M3.9 7.7 8 3.5l4.1 4.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Dispatch feedback for assistive technology (the transcript itself is
            not a live region) — announcement, not a specific ARIA technique. */}
        <span className="visually-hidden" aria-live="polite">
          {helpAnnouncement}
        </span>
      </div>
    </section>
  );
}
