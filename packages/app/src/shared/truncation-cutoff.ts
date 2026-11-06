/**
 * Continue / Retry MODEL PAYLOADS for the Response-Cut-Off State (capability
 * `desktop-app`, Requirement: Response-Cut-Off State with One-Click Continue
 * and Retry).
 *
 * Lives in shared/ (importable by renderer and main alike, no Electron or Node
 * dependency) beside `reasoning-remediation.ts`. Display/payload split per the
 * help-me / iteration-toolbar precedent: the transcript shows the chrome the
 * catalogue owns (`chatContinueLabel` / `chatRetryLabel`), the model receives the
 * instruction PAYLOAD declared here. The payloads are model-directed natural
 * language — not skill-routed machine tokens — because completing/redoing a
 * cut-off answer is a runtime concern, not a CBE-skill affordance.
 */

/** Model payload of the one-click Continue: finish the truncated answer in place. */
export const TRUNCATION_CONTINUE_PAYLOAD =
  "Your previous response was cut off mid-generation before it was finished. " +
  "Continue the answer exactly where it stopped — do not repeat what you already wrote, do not apologise, just complete the remaining part.";

/** Model payload of the one-click Retry: answer the previous request again in full. */
export const TRUNCATION_RETRY_PAYLOAD =
  "Your previous response was cut off before it was finished. " +
  "Answer the previous request again in full — keep it concise enough that the whole answer fits.";
