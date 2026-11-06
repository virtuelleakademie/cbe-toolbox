/**
 * The app's machine help token (capability `desktop-app`, Requirement: Help-Me
 * Button Dispatches a Structured Help Request).
 *
 * Lives in shared/ — importable by renderer and main alike, no Electron, React
 * or Node dependency — because BOTH sides need it: the renderer emits it as the
 * payload of its single help dispatch (`useHelpDispatch`, shared by both entry
 * points), and the main process recognises it to prepend the
 * `app-ui reference` block (Requirement: App-UI Reference Injected on the
 * Help-Token Turn). A second literal in main would be a silent divergence
 * waiting to happen.
 */

/** Machine token of the app's Help dispatch. Namespaced per the (now retired)
 * step-select token — a bare `[help]` is a plausible start of pasted content.
 * Payload-only: the visible turn renders the catalogue's `chatHelpDisplayText`.
 * The skill matches this token deterministically (tolerant of host-prepended
 * session notices) and routes it to its onboarding orientation. */
export const HELP_TOKEN = "[help · app]";
