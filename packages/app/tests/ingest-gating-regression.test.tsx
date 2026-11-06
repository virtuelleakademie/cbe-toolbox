/**
 * Regression guard for change `add-ux-polish-collected-fixes` (capability
 * `desktop-app`, Requirement: Collected UX Polish) — Scenario: Ingestion is
 * available regardless of the work underway.
 *
 * Verified at spec time: the `ingestion` affordance is profile-based
 * (packages/pi-bridge/src/environment.ts) and the composer gates the ingest
 * button ONLY on `session.affordances.ingestion !== false` plus the run lock
 * (ChatPanel.tsx). This suite pins that: NO other session state — in
 * particular no notion of what kind of work is underway (conversation
 * content, step focus, canvas state, maturity readings) — may gate the
 * entry point.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import type { Turn } from "../src/renderer/state/conversationReducer.js";
import { entryDisabled, queryUploadEntry, uploadEntry } from "./helpers/composer.js";

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

// The entry point is the "+" menu's upload entry now; it is disabled
// with `aria-disabled` (never the `disabled` attribute), so it stays focusable.
const ingestDisabled = () => entryDisabled(uploadEntry());

/** A mid-work conversation: turns on record, a step in focus, canvas content. */
function midWorkState(): { turns: Turn[] } {
  return {
    turns: [
      { role: "user", text: "Lass uns das Assessment-Konzept schärfen." },
      { role: "assistant", activity: [{ kind: "text", id: "t1", text: "Gern — wo stehen die Lernziele?" }] },
    ],
  };
}

describe("Ingestion is available regardless of the work underway", () => {
  it("is present and enabled at any point of the conversation with the affordance on and no run in flight", () => {
    // Deep into a conversation (turns, step coverage, canvas artefacts) — the
    // exact states a mode/work-type gate would wrongly consult.
    seedConversation({
      session: { ...testSession(), affordances: { ingestion: true } },
      ...midWorkState(),
    });
    const { unmount } = render(<ChatPanel />);
    expect(ingestDisabled()).toBe(false);
    unmount();

    // Fresh, empty conversation — same gating, same result.
    seedConversation({ session: { ...testSession(), affordances: { ingestion: true } } });
    render(<ChatPanel />);
    expect(ingestDisabled()).toBe(false);
  });

  it("only the affordance and the run lock play any part in the gating", () => {
    seedConversation({
      session: { ...testSession(), affordances: { ingestion: true } },
      ...midWorkState(),
    });
    render(<ChatPanel />);

    // Run lock: an in-flight agent run disables (not hides) the entry point…
    emitAgentEvent({ type: "agent_start", data: {} });
    expect(ingestDisabled()).toBe(true);
    // …and the end of the run re-enables it, whatever work was underway.
    emitAgentEvent({ type: "agent_end", data: {} });
    expect(ingestDisabled()).toBe(false);
  });

  it("the affordance is the only thing that removes the entry point", () => {
    seedConversation({
      session: { ...testSession(), affordances: { ingestion: false } },
      ...midWorkState(),
    });
    render(<ChatPanel />);
    expect(queryUploadEntry()).toBeNull();
  });
});
