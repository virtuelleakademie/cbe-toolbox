import { fireEvent, screen, within } from "@testing-library/react";
import { en } from "../../src/shared/i18n/en.js";

/**
 * Query helpers for the composer card (capability `desktop-app`, Requirements:
 * Long-Form Composer for Lecturer Input; Composer Control Row). The ingestion
 * and help triggers live inside the "+" menu rather than on the card's surface —
 * so every test that reaches for one of them goes through here rather than
 * repeating a selector that would have to be updated in twenty places.
 *
 * Every query below names its control through the constant that OWNS the string
 * (Requirement: *Each Rendered Chrome String Has Exactly One Owner*); the
 * literal wording is asserted in `chrome-copy.test.ts` and nowhere else.
 */

/** The message field. It carries no placeholder in either state, so it is found
 * by its accessible name — which is static and identical locked or not. */
export const composerField = (): HTMLTextAreaElement =>
  screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;

/**
 * The round send button in the control row.
 *
 * ONE slot, two states, never both rendered (Requirement: *Composer Control
 * Row*): while the composer's run lock is engaged the same slot is the STOP
 * control instead, so this query finds nothing there — which is the point, and
 * why the two states have separate accessors below rather than one that
 * silently matches either.
 */
export const sendButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: en.chatSendLabel }) as HTMLButtonElement;

/** The send button if the slot is currently in its idle state, else null. */
export const querySendButton = (): HTMLButtonElement | null =>
  screen.queryByRole("button", { name: en.chatSendLabel }) as HTMLButtonElement | null;

/** Matches either of the stop control's two accessible names, built from the
 * owning constants rather than from a literal. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stopNamePattern = (): RegExp => new RegExp(`${escapeRe(en.chatStopLabel)}|${escapeRe(en.chatStopPendingLabel)}`);

/** The stop control — the send slot's locked state. Matches both its resting
 * and its settling name, so a test that only cares "the slot is the stop" does
 * not have to know which. */
export const stopButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: stopNamePattern() }) as HTMLButtonElement;

/** The stop control if the slot is currently locked, else null. */
export const queryStopButton = (): HTMLButtonElement | null =>
  screen.queryByRole("button", { name: stopNamePattern() }) as HTMLButtonElement | null;

/**
 * Which of the send slot's two states is rendered right now (Requirement:
 * *Composer Control Row*). The slot follows the composer's run LOCK, not the
 * run, so `"stop"` covers the whole locked window — including the gap between
 * the prompt being dispatched and the run starting.
 *
 * Throws if neither is present: "the slot vanished" is a failure, never a
 * silently-passing third state.
 */
export const sendSlotState = (): "send" | "stop" => {
  const stop = queryStopButton();
  if (stop) return "stop";
  if (querySendButton()) return "send";
  throw new Error("The composer's send/stop slot rendered neither state.");
};

/**
 * Is the send/stop slot refusing input right now?
 *
 * The two states express it differently on purpose: idle send uses the
 * `disabled` attribute (there is nothing to send and no reason to announce),
 * while the stop uses `aria-disabled` so it stays focusable and its reason stays
 * reachable without a pointer. A test asking "is the slot inert" should not have
 * to care which.
 */
export const sendSlotInert = (): boolean => {
  const stop = queryStopButton();
  if (stop) return stop.getAttribute("aria-disabled") === "true";
  return sendButton().disabled;
};

/** The round "+" that opens the composer's two-entry menu. */
export const plusButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: en.chatPlusMenuLabel }) as HTMLButtonElement;

/** Open the "+" menu (idempotent) and return it. */
export function openPlusMenu(): HTMLElement {
  const btn = plusButton();
  if (btn.getAttribute("aria-expanded") !== "true") fireEvent.click(btn);
  return screen.getByRole("menu");
}

/** The upload entry — the ingestion entry point. */
export const uploadEntry = (): HTMLButtonElement =>
  within(openPlusMenu()).getByRole("menuitem", { name: en.chatUploadEntryLabel }) as HTMLButtonElement;

/** The help entry — the help dispatch. */
export const helpEntry = (): HTMLButtonElement =>
  within(openPlusMenu()).getByRole("menuitem", { name: en.chatHelpEntryLabel }) as HTMLButtonElement;

/** Is the upload entry present in the menu at all? (Affordance gating removes
 * it entirely rather than disabling it.) */
export const queryUploadEntry = (): HTMLElement | null =>
  within(openPlusMenu()).queryByRole("menuitem", { name: en.chatUploadEntryLabel });

/** `aria-disabled`, never the `disabled` attribute — the entry must stay
 * focusable and announced. */
export const entryDisabled = (el: HTMLElement): boolean => el.getAttribute("aria-disabled") === "true";

/** The model pill, matched on the STABLE half of its accessible name — the
 * purpose — so a test does not have to know which model id is configured. */
export const MODEL_PILL_NAME = new RegExp(`^${escapeRe(en.chatModelPillPurpose)}`);

/** The pending-attachment row, and its per-file remove controls. `ANY_…` matches
 * every remove control at once, for the tests that count pills. */
export const PENDING_ATTACHMENTS_SELECTOR = `[aria-label="${en.chatPendingAttachmentsLabel}"]`;
export const ANY_REMOVE_ATTACHMENT = new RegExp(
  `^${escapeRe(en.chatRemoveAttachmentLabel({ filename: "" }).trimEnd())}\\b`
);
