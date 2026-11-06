/**
 * Renderer boot-hydration tests (change `one-conversation-per-course`):
 *
 * - desktop-app spec, Requirement: Renderer Boot-Hydration from the Main
 *   Process — Scenarios: Renderer reload re-attaches to the open session;
 *   Reload during an in-flight turn re-arms the lock and guards (renderer
 *   side); Hydration shows a busy state and disables the composer; Hydration
 *   failure surfaces an error with retry; Cold start on a brand-new course
 *   lands directly in the chat.
 * - desktop-app spec, Requirement: Conversation Opens Directly in the Chat
 *   View — Scenarios: Brand-new course opens directly in the chat; Resumed
 *   conversation continues without a mode restoration step; The workspace
 *   renders no mode control or mode label.
 * - course-workspace spec — Scenarios: App start re-enters the active course's
 *   conversation; Restart re-enters the same conversation (renderer side).
 * - agent-harness spec — Scenario: Display projection renders re-entry as the
 *   lecturer saw it (renderer side).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { App } from "../src/renderer/App.js";
import { useCbe } from "../src/renderer/state/store.js";
import { sendSlotState } from "./helpers/composer.js";
import type { ConversationOpenResult, ProviderStatus } from "../src/shared/ipc-contract.js";

const PROVIDER: ProviderStatus = { baseURL: "http://localhost:1", modelId: "test-model", hasKey: true };

function conversation(overrides?: Partial<ConversationOpenResult>): ConversationOpenResult {
  return {
    session: {
      sessionId: "conv-1",
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/w", corpus: "/c" },
      courseId: "algorithmen",
    },
    turns: [],
    agentRunning: false,
    canvas: [],
    ...overrides,
  };
}

function stubConfigured(openConversation: () => Promise<ConversationOpenResult>) {
  Object.assign(window.cbe, {
    getConfig: async () => PROVIDER,
    openConversation,
  });
}

function resetStore() {
  // reset() clears the conversation slices too — a leftover slice would make
  // the next test's hydration take the re-attach branch on the same sessionId.
  useCbe.getState().reset();
  useCbe.setState({
    configured: false,
    hydration: "idle",
    hydrationError: null,
  });
}

beforeEach(resetStore);

afterEach(() => {
  cleanup();
  resetStore();
});

describe("App start re-enters the active course's conversation", () => {
  it("hydrates the canonical conversation from main — transcript continues, no mode restoration step", async () => {
    // Scenario: Resumed conversation continues without a mode restoration step.
    const openConversation = vi.fn(async () =>
      conversation({
        session: { ...conversation().session, sessionId: "canonical" },
        turns: [
          { role: "user", text: "prior question" },
          { role: "assistant", text: "prior answer" },
        ],
      })
    );
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(openConversation).toHaveBeenCalled());
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(useCbe.getState().session?.sessionId).toBe("canonical");
    expect(screen.getByText("prior question")).toBeTruthy();
    expect(screen.getByText(/prior answer/)).toBeTruthy();
    // The composer is ready for input — the field exists AND its run lock is
    // open. Only the send slot can carry the second half: the field's
    // accessible name is static locked or not.
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
    expect(sendSlotState()).toBe("send");
  });

  it("renders the display projection of a user turn — never the raw ingest envelope", async () => {
    const openConversation = vi.fn(async () =>
      conversation({
        turns: [
          {
            role: "user",
            text: "instruction\n\n<<<ENVELOPE: full extracted document body>>>",
            display: { text: "instruction", attachments: [{ filename: "syllabus.pdf", docType: "pdf" }] },
          },
        ],
      })
    );
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(screen.getByText("instruction")).toBeTruthy();
    expect(screen.queryByText(/ENVELOPE/)).toBeNull();
    // The attachment renders as a chip.
    expect(screen.getByText(/syllabus/)).toBeTruthy();
  });
});

describe("Cold start on a brand-new course lands directly in the chat", () => {
  // Scenario: Brand-new course opens directly in the chat.
  it("opens the chat with a fresh conversation and the composer ready — no selection screen, no mode chrome", async () => {
    const openConversation = vi.fn(async () => conversation({ turns: [] }));
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    const composer = screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    // No selection screen and no mode chrome exist anywhere.
    expect(screen.queryByText(/Choose a mode/)).toBeNull();
    expect(document.querySelector(".modeswitch")).toBeNull();
  });

  // Scenario: The workspace renders no mode control or mode label.
  it("renders no mode control or mode label anywhere in the workspace chrome", async () => {
    const openConversation = vi.fn(async () => conversation({ turns: [] }));
    stubConfigured(openConversation);
    const { container } = render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    // No mode pills below the prompt, no mode label in the lead, no mode text.
    expect(container.querySelector(".modeswitch")).toBeNull();
    expect(container.querySelector(".chat-lead")).toBeNull();
    expect(screen.queryByText(/Session · /)).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: /operation mode/i })).toBeNull();
  });
});

describe("Hydration shows a busy state and disables the composer", () => {
  it("shows the accessible busy pane while conversationOpen resolves; no composer exists yet", async () => {
    let resolveOpen: (r: ConversationOpenResult) => void = () => {};
    const openConversation = vi.fn(() => new Promise<ConversationOpenResult>((resolve) => (resolveOpen = resolve)));
    stubConfigured(openConversation);
    render(<App />);

    // Pending: visible, accessibly announced busy state (covers the
    // first-launch runtime install), and NO composer to type into.
    const busy = await screen.findByRole("status");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.textContent).toMatch(/Opening your conversation/);
    expect(busy.textContent).toMatch(/1–2 minutes/);
    expect(screen.queryByRole("textbox", { name: en.chatComposerFieldLabel })).toBeNull();

    resolveOpen(conversation());
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
  });
});

describe("Hydration failure surfaces an error with retry", () => {
  it("shows a readable error and the retry affordance re-runs conversationOpen", async () => {
    let calls = 0;
    const openConversation = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("provider endpoint unreachable");
      return conversation();
    });
    stubConfigured(openConversation);
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Could not open the conversation/);
    expect(alert.textContent).toMatch(/provider endpoint unreachable/);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(openConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
    expect(sendSlotState()).toBe("send");
  });
});

describe("Reload during an in-flight turn re-arms the lock and guards", () => {
  it("hydrating agentRunning: true locks the composer, shows the working state, and arms the fresh-conversation guard", async () => {
    const openConversation = vi.fn(async () =>
      conversation({
        agentRunning: true,
        turns: [{ role: "user", text: "long-running request" }],
      })
    );
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    // Composer locked exactly as if agent_start had been observed.
    const composer = screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    expect(composer).toBeTruthy();
    // The send slot is the STOP control while the lock is engaged (capability
    // `desktop-app`, Requirement: *Composer Control Row*) — a reload onto an
    // in-flight run must therefore offer the stop, not a disabled send.
    expect(sendSlotState()).toBe("stop");
    // The VISIBLE conversation's running flag is armed — it locks this
    // composer and the fresh-conversation ("New Session") guard. Course
    // switching no longer keys on it (a switch is allowed mid-turn; change
    // add-background-course-sessions).
    await waitFor(() => expect(useCbe.getState().agentRunning).toBe(true));
    const newSession = screen.getByRole("button", { name: /New Session/ }) as HTMLButtonElement;
    expect(newSession.disabled).toBe(true);
  });
});

describe("Hydration notice from main lands in the notice banner", () => {
  it("shows the dismissible notice (unreadable archive)", async () => {
    const openConversation = vi.fn(async () =>
      conversation({
        notice:
          "The previous conversation's archive could not be read — starting a fresh conversation. The files remain on disk in the course folder.",
      })
    );
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});

describe("Canvas snapshot re-populates the Artifacts slice", () => {
  it("applies the host-side mirror snapshot on hydration (resolved step address, incl. Step-6 journey phase)", async () => {
    const openConversation = vi.fn(async () =>
      conversation({
        canvas: [
          {
            step: 1,
            id: "moduleframe",
            label: "Module Meta / Constraints",
            value: "BSc Informatik, 5 ECTS",
            state: "done",
          },
          {
            step: 6,
            phase: "engage",
            id: "big-idea",
            label: "Big Idea",
            value: "Nachhaltige Ernährung",
            state: "done",
          },
        ],
      })
    );
    stubConfigured(openConversation);
    render(<App />);

    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    const groups = useCbe.getState().artifacts;
    const step1 = groups.find((g) => g.step === 1);
    expect(step1?.items.find((it) => it.id === "moduleframe")?.value).toBe("BSc Informatik, 5 ECTS");
    const step6 = groups.find((g) => g.step === 6);
    const bigIdea = step6?.journey?.find((el) => el.phase === "engage")?.items.find((it) => it.id === "big-idea");
    expect(bigIdea?.value).toBe("Nachhaltige Ernährung");
    expect(bigIdea?.state).toBe("done");
  });
});
