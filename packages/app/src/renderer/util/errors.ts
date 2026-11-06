/**
 * Renderer-owned error copy (capability `desktop-app`, Requirement: Tiered
 * Error Surfacing). Known recoverable classes get their copy from the
 * interface-language catalogue; unknown
 * errors pass through human-readably with the IPC transport prefix stripped.
 * No surface ever names runtime internals (API parameter names, harness or
 * vendor identifiers).
 */
import { CONTEXT_WINDOW_TOO_SMALL_MESSAGE } from "@cbe/pi-bridge/compaction-companion";
import { chrome } from "../chrome.js";
import { textMatchesAnyLanguage } from "../../shared/i18n/index.js";
import type { ChatNotice } from "../state/conversationReducer.js";

/** Locked-affordance reason, shared idiom across New Session / iteration toolbar /
 * Maturity panel (Requirement: Canvas Dialogue-Steering Dispatches Respect the Run
 * Lock — reason affordance). NOT the canvas step-select affordance: since
 * `host-sets-step-focus-from-canvas-click` it sets the focus in the host and
 * dispatches no prompt, so it is outside the lock and carries no locked state. */
export function runLockedReason(): string {
  return chrome().errorRunLockedReason;
}

/** Catalog copy for the busy rejection (main-process precheck or Pi-level). */
export function busyNoticeText(): string {
  return chrome().errorBusyNoticeText;
}

/** Strip the Electron IPC transport prefix (and a leading `Error:`) so the
 * lecturer reads the message, not the plumbing. Applied on every surface. */
export function stripTransportPrefix(raw: string): string {
  return raw.replace(/^(?:Error invoking remote method '[^']*':\s*)?(?:Error:\s*)*/, "").trim();
}

/** True when the error is the "agent busy" rejection (either the main-process
 * precheck or Pi's own message — both carry the classifiable phrase). */
export function isBusyRejection(raw: string): boolean {
  // Pi composes its own message in English and always carries the phrase; the
  // HOST's refusal is chrome and is composed in the interface language, so it is
  // matched against every shipped catalogue's own entry rather than a phrase
  // transcribed here — the same discipline `isHarnessDocumentedError` follows.
  return /already processing/i.test(raw) || textMatchesAnyLanguage(raw, (t) => t.mainPromptBusyNotice);
}

/** Translate a raw prompt-dispatch error into the soft chat notice. */
export function chatNoticeFor(raw: string): ChatNotice {
  if (isBusyRejection(raw)) return { text: busyNoticeText() };
  return { text: stripTransportPrefix(raw) };
}

/**
 * Readable provider-error catalog (capability `desktop-app`, Requirement:
 * Collected UX Polish — readable provider-error surfacing). The raw provider
 * payload is NEVER rendered verbatim in the chat surface; full detail stays in
 * the session log (agent-harness, Requirement: Documented Error Behaviour).
 */

/** Specific classification for auth/billing failures: names the cause class
 * and the recovery path (provider account / Settings LLM connection). */
export function authBillingErrorText(): string {
  return chrome().errorAuthBillingText;
}

/** Generic readable state for every other provider error class — points at the
 * session log for the full detail instead of echoing the payload. */
export function genericProviderErrorText(): string {
  return chrome().errorGenericProviderText;
}

/** True for auth/billing provider failures: exhausted credits, HTTP 401/402
 * status codes (not digits embedded in ids like `req-402-x`), invalid or
 * unauthorized key, exceeded-quota or billing bodies. */
export function isAuthBillingFailure(raw: string): boolean {
  return /(?:^|[^\w-])40[12]\b|unauthori[sz]ed|invalid[ _-]?api[ _-]?key|incorrect api key|\bcredits?\b|quota[ _-]?exceeded|exceeded[^\n]{0,60}\bquota\b|billing|payment required|insufficient[ _-]?(funds|balance|credits?|quota)/i.test(
    raw
  );
}

/** Harness-authored documented errors (readable by construction — the
 * small-context-window remediation, the tool-loop abort note) ride the same
 * error event as provider failures; they pass through instead of being
 * flattened into the generic provider copy. Matched against the source
 * constants themselves — the abort note against every shipped catalogue's own
 * entry, since the host composes it in the interface language — so neither a
 * wording edit nor a translation can silently break the match. */
export function isHarnessDocumentedError(raw: string): boolean {
  return raw.includes(CONTEXT_WINDOW_TOO_SMALL_MESSAGE) || textMatchesAnyLanguage(raw, (t) => t.errorLoopAbortNote);
}

/**
 * Classify a provider failure into its readable chat error state (catalogue copy,
 * in the interface language):
 * auth/billing failures get the specific cause-and-recovery copy, everything
 * else the generic copy pointing at the session log. Applied on BOTH failure
 * paths — the `{ type: "error" }` stream event and the rejected prompt
 * invocation — so a provider failure never presents as a silent stall and
 * never echoes the raw payload.
 */
export function providerErrorNotice(raw: string): ChatNotice {
  const msg = stripTransportPrefix(raw);
  if (isHarnessDocumentedError(msg)) return { text: msg };
  if (isAuthBillingFailure(msg)) return { text: authBillingErrorText() };
  return { text: genericProviderErrorText() };
}

/** Rejected-prompt-path notice: the busy rejection keeps its recoverable
 * catalog copy; every other prompt rejection is a failed turn and gets the
 * classified provider-error state (never the raw payload). */
export function promptFailureNotice(raw: string): ChatNotice {
  if (isBusyRejection(raw)) return { text: busyNoticeText() };
  return providerErrorNotice(raw);
}
