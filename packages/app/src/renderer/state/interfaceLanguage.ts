import { setActiveLanguage } from "../chrome.js";
import { useCbe } from "./store.js";

/**
 * The application-level interface-language subscription (capability
 * `desktop-app`, Requirement: *Every String the App Renders Is English* — "A
 * change MUST take effect immediately across the whole chrome, without an app
 * restart, and MUST NOT disturb the open conversation").
 *
 * Wired ONCE from `main.tsx`, on the same rule as the agent-event and
 * wiki-ingest subscriptions: the main process broadcasts and keeps no replay, so
 * a listener owned by a component that unmounts (a collapsed panel, a closed
 * overlay) would not hide a change — it would destroy it.
 *
 * Two things happen on a change. Most chrome re-renders on its own, because it is
 * read through `useChrome()`. The exception is the design-flow canvas: its step
 * names and artefact labels were SEEDED into per-conversation state, so they are
 * data by the time the language moves, and `relabelSeededChrome` re-derives them.
 */
export function wireInterfaceLanguage(): void {
  const adopt = (language: string): void => {
    setActiveLanguage(language);
    useCbe.getState().relabelSeededChrome();
  };
  // The bridge already carries the language the main process resolved before this
  // window loaded; adopting it here is what re-labels a hydrated canvas.
  adopt(window.cbe.interfaceLanguage);
  window.cbe.onInterfaceLanguageChanged(adopt);
}
