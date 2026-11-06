/**
 * The session-start occupancy rides the boot-hydration snapshot (capability
 * `agent-harness`, Requirement: Context Occupancy Reported to the Host —
 * Scenario: *The session-start occupancy rides the hydration snapshot*).
 *
 * The event subscription is wired after the session is created, so anything
 * emitted during session start has no subscriber, and a renderer reload
 * re-attaching to a live session has the same gap. The snapshot is what closes
 * both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/renderer/App.js";
import { useCbe } from "../src/renderer/state/store.js";
import type { ConversationOpenResult, ProviderStatus } from "../src/shared/ipc-contract.js";
import { labelFor } from "../src/renderer/components/ContextUsageRing.strings.js";

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
    maturity: {},
    ...overrides,
  } as ConversationOpenResult;
}

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ configured: false, hydration: "idle", hydrationError: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCbe.getState().reset();
});

describe("Scenario: The session-start occupancy rides the hydration snapshot", () => {
  it("a conversation opening carries its occupancy with the canvas, step and maturity state", async () => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => conversation({ contextUsage: { used: 41234, window: 131072 } }),
    });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    // Delivered with the snapshot — no `context_usage` event was emitted.
    expect(useCbe.getState().contextUsage).toEqual({ used: 41234, window: 131072 });
    const meter = await screen.findByRole("meter");
    expect(meter.getAttribute("aria-label")).toMatch(/31 %/);
  });

  it("a reload re-attaching to a live session takes the snapshot's occupancy too", async () => {
    // First open: measured.
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => conversation({ contextUsage: { used: 10000, window: 131072 } }),
    });
    const first = render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    first.unmount();

    // Re-attach to the SAME session, whose run has moved on in the main process.
    // The slice already exists, so this is the re-attach branch — it must still
    // take the fresh report rather than keeping the stale one.
    Object.assign(window.cbe, {
      openConversation: async () => conversation({ agentRunning: true, contextUsage: { used: 98000, window: 131072 } }),
    });
    useCbe.setState({ hydration: "idle" });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(useCbe.getState().contextUsage).toEqual({ used: 98000, window: 131072 });
  });

  it("a snapshot without the field leaves the ring unmeasured rather than claiming zero", async () => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => conversation(),
    });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    expect(useCbe.getState().contextUsage).toBeNull();
    const meter = await screen.findByRole("meter");
    expect(meter.getAttribute("aria-label")).toBe(labelFor("fresh", null, en));
    expect(meter.getAttribute("aria-valuenow")).toBeNull();
  });

  it("a resumed conversation with prior turns is CARRIED, not fresh", async () => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () =>
        conversation({
          turns: [{ role: "user", text: "eine frühere Frage" }] as never,
          contextUsage: { used: null, window: 131072 },
        }),
    });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    const meter = await screen.findByRole("meter");
    // It carries context that has not been re-measured — never "empty".
    expect(meter.className).toContain("ctx-ring-carried");
    expect(meter.getAttribute("aria-label")).toBe(labelFor("carried", null, en));
  });
});
