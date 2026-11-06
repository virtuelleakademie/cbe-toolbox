/**
 * Renderer-side test setup.
 *
 * Renderer components depend on `window.cbe` (the preload bridge exposed by
 * `src/preload/index.ts`). In a jsdom environment that bridge does not exist —
 * tests must install a stub. The default stub here is intentionally noisy: every
 * method throws unless a test overrides it via `Object.assign(window.cbe, …)` or
 * `vi.spyOn`. That way a renderer test never silently calls into the bridge with
 * a no-op and pretends to work.
 *
 * `onAgentEvent` is the one exception: tests need a way to capture the listener
 * the component registers so they can simulate `agent_*`, `turn_*`, `tool_*`,
 * `thinking_*` etc. events. The default implementation stashes the listener on
 * `window.__cbeAgentListeners` and returns an unsubscribe that removes it.
 * Tests can either inspect that array directly or use the `emitAgentEvent`
 * helper exported from `tests/helpers/agent-events.ts`.
 */
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { CbeApi } from "../src/preload/index.js";
import type { AgentEvent } from "../src/shared/ipc-contract.js";
import { wireAgentEvents } from "../src/renderer/state/agentEvents.js";
import { REFERENCE_LANGUAGE } from "../src/shared/i18n/index.js";
import { __resetActiveLanguage } from "../src/renderer/chrome.js";

declare global {
  interface Window {
    __cbeAgentListeners?: Array<(evt: AgentEvent) => void>;
  }
}

function throwUnstubbed(name: string): never {
  throw new Error(
    `window.cbe.${name} called without a test stub. Override with vi.spyOn or Object.assign(window.cbe, { ${name}: ... }) in the test.`
  );
}

function installCbeStub() {
  window.__cbeAgentListeners = [];
  const stub: CbeApi = {
    // The interface language the preload resolves main-side. The test environment
    // PINS the reference language (capability `desktop-app`, Requirement: *Each
    // Rendered Chrome String Has Exactly One Owner* — "The test environment pins
    // one interface language"), so query handles are stable and shipping a further
    // language touches no test. A test that needs another language sets it
    // explicitly for that test via `setActiveLanguage`.
    interfaceLanguage: REFERENCE_LANGUAGE,
    setInterfaceLanguage: async () => throwUnstubbed("setInterfaceLanguage"),
    onInterfaceLanguageChanged() {
      return () => {};
    },
    // Benign default: existing renderer tests model a profile that already saw
    // first-use orientation. Dedicated onboarding suites override every outcome.
    readOnboarding: async () => ({ acknowledged: true }),
    acknowledgeOnboarding: async () => ({ acknowledged: true, persisted: true }),
    onOnboardingChanged() {
      return () => {};
    },
    onNativeMenuCommand() {
      return () => {};
    },
    setNativeMenuAvailability: async () => ({ ok: true }),
    openPioneerAllianceSite: async () => throwUnstubbed("openPioneerAllianceSite"),
    getConfig: async () => throwUnstubbed("getConfig"),
    setConfig: async () => throwUnstubbed("setConfig"),
    eraseApiKey: async () => throwUnstubbed("eraseApiKey"),
    testConnection: async () => throwUnstubbed("testConnection"),
    openConversation: async () => throwUnstubbed("openConversation"),
    freshConversation: async () => throwUnstubbed("freshConversation"),
    // Benign default: the course detail's Chats tab loads the list on mount and
    // an empty sessions folder is the legitimate cold-start state. Resuming is
    // an explicit click and throws unless the test stubs it.
    listConversations: async () => ({ conversations: [] }),
    resumeConversation: async () => throwUnstubbed("resumeConversation"),
    sendPrompt: async () => throwUnstubbed("sendPrompt"),
    abortPrompt: async () => throwUnstubbed("abortPrompt"),
    loadCitation: async () => throwUnstubbed("loadCitation"),
    // Benign default: EVERY rendered citation asks the host to verify it (capability
    // `desktop-app`, Requirement: A Citation Token Is Verified Against the Corpus
    // Before It Is Linked), so a throwing stub would crash every unrelated test whose
    // fixture text happens to carry a `(corpus:…)` token — and an `unknown-id` default
    // would silently turn those citations into non-links. The verification surface has
    // its own test file, which stubs each outcome explicitly.
    verifyCitation: async ({ id, section }) => ({
      status: "verified" as const,
      id,
      section: section ?? "",
      heading: section ?? "",
    }),
    closeSession: async () => throwUnstubbed("closeSession"),
    // Benign default (like onAgentEvent): the `/` autocomplete is a convenience —
    // ChatPanel fetches commands on session start, so a throwing stub would crash
    // unrelated chat-panel tests. Tests that exercise the autocomplete override this.
    getCommands: async () => [],
    ingestFile: async () => null, // benign default — only called on explicit button click
    // Benign default: the Profile Panel loads the record on mount and an empty
    // record IS the legitimate cold-start state, so unrelated tests don't crash.
    getLecturerProfile: async () => ({}),
    overrideLecturerProfile: async () => throwUnstubbed("overrideLecturerProfile"),
    // Benign default for the same reason: the identity fields hydrate on mount and
    // NOTHING RECORDED is the normal state, not a failure. Writes throw unstubbed.
    getLecturerIdentity: async () => ({}),
    setLecturerIdentity: async () => throwUnstubbed("setLecturerIdentity"),
    // Benign default: App + CoursesPanel hydrate the course list on mount, and an
    // empty Space is a legitimate cold-start state. Mutating course calls throw.
    listCourses: async () => ({ courses: [], activeCourseId: "" }),
    createCourse: async () => throwUnstubbed("createCourse"),
    renameCourse: async () => throwUnstubbed("renameCourse"),
    setActiveCourse: async () => throwUnstubbed("setActiveCourse"),
    revealCourse: async () => throwUnstubbed("revealCourse"),
    deleteCourse: async () => throwUnstubbed("deleteCourse"),
    // Benign default: the wiki browser loads the atom list on mount; an empty
    // wiki is the legitimate cold-start state. Ingest calls throw unless stubbed.
    listWikiAtoms: async () => ({ atoms: [], invalid: [] }),
    ingestToWiki: async () => throwUnstubbed("ingestToWiki"),
    abortWikiIngest: async () => throwUnstubbed("abortWikiIngest"),
    // Throws unless a test exercising the canvas delete control stubs it.
    deleteCanvasArtefact: async () => throwUnstubbed("deleteCanvasArtefact"),
    // Throws unless a test exercising the canvas step-select affordance stubs it.
    focusStep: async () => throwUnstubbed("focusStep"),
    // Benign default: the corpus section loads version info on mount; the
    // bundled corpus with no cache date is the legitimate cold-start state.
    getCorpusInfo: async () => ({ version: null, cacheDate: null, source: "bundled" as const }),
    refreshCorpus: async () => throwUnstubbed("refreshCorpus"),
    // Benign default: the About group loads on mount. The values are deliberately
    // unlike any real one, so a test asserting a real-looking version string is
    // asserting a literal someone put in the component.
    getAboutInfo: async () => ({ appVersion: "0.0.0-stub", skillName: "stub-skill", skillVersion: "0.0.0-skill" }),
    // Benign default (like onAgentEvent): the update banner subscribes on
    // mount; tests exercising it capture the listener via their own stub.
    onUpdateEvent() {
      return () => {};
    },
    updateAction: async () => throwUnstubbed("updateAction"),
    onWikiIngestProgress() {
      return () => {};
    },
    onAgentEvent(listener) {
      window.__cbeAgentListeners!.push(listener);
      return () => {
        const i = window.__cbeAgentListeners!.indexOf(listener);
        if (i >= 0) window.__cbeAgentListeners!.splice(i, 1);
      };
    },
  };
  (window as unknown as { cbe: CbeApi }).cbe = stub;
  // In the real app, main.tsx wires the ONE application-level agent-event
  // subscription (demuxed by sessionId into conversation slices). Tests get the
  // same wiring against the fresh stub — `wireAgentEvents` is idempotent, so the
  // per-test re-install never leaves a second live subscription.
  wireAgentEvents();
}

installCbeStub();

// jsdom does not implement Element.scrollTo / scrollIntoView. The renderer
// uses both in auto-scroll effects; without the stub a render crashes the test.
if (typeof Element !== "undefined") {
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
  // Re-install the stub fresh so per-test vi.spyOn / Object.assign overrides
  // do not bleed into the next test.
  vi.restoreAllMocks();
  installCbeStub();
  // A test that switched the interface language must not leak it into the next
  // one: the pin is what keeps every other test's query handles stable.
  __resetActiveLanguage();
});
