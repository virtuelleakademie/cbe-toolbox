/**
 * Tests for change `add-ux-polish-collected-fixes` (capability `desktop-app`,
 * Requirement: Collected UX Polish) — Scenarios: Missing-credits provider
 * error surfaces as a readable chat error state; Other provider errors surface
 * generically without the raw payload.
 *
 * Both failure paths are exercised: the `{ type: "error" }` stream event
 * (main-process forwarding of Pi's message_update error / message_end
 * stopReason "error") and the rejected `cbe:prompt` invocation. The chat error
 * display is display-state — never a persisted transcript turn — the run
 * visibly ends, and the composer unlocks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";
import { isAuthBillingFailure, isHarnessDocumentedError, providerErrorNotice } from "../src/renderer/util/errors.js";
import { CONTEXT_WINDOW_TOO_SMALL_MESSAGE } from "@cbe/pi-bridge/compaction-companion";
import { sendButton, sendSlotState } from "./helpers/composer.js";

const RAW_CREDITS_BODY =
  '402 Payment Required: {"error":{"code":"insufficient_credits","message":"Your account has run out of credits. XQJ-RAW-MARKER"}}';
const RAW_SERVER_BODY = '500 Internal Server Error: {"detail":"upstream worker exploded","trace":"XQJ-RAW-MARKER"}';

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;

describe("provider-error classification (catalog)", () => {
  it("classifies 401/402/credits-exhausted bodies as auth/billing, everything else as generic", () => {
    expect(isAuthBillingFailure("401 Unauthorized")).toBe(true);
    expect(isAuthBillingFailure("HTTP 402 Payment Required")).toBe(true);
    expect(isAuthBillingFailure(RAW_CREDITS_BODY)).toBe(true);
    expect(isAuthBillingFailure("invalid_api_key: incorrect API key provided")).toBe(true);
    expect(isAuthBillingFailure(RAW_SERVER_BODY)).toBe(false);
    expect(providerErrorNotice(RAW_CREDITS_BODY).text).toBe(en.errorAuthBillingText);
    expect(providerErrorNotice(RAW_SERVER_BODY).text).toBe(en.errorGenericProviderText);
    // Never the raw payload, on either class.
    expect(providerErrorNotice(RAW_CREDITS_BODY).text).not.toContain("XQJ-RAW-MARKER");
    expect(providerErrorNotice(RAW_SERVER_BODY).text).not.toContain("XQJ-RAW-MARKER");
    // The specific copy names the cause class and the recovery path.
    expect(en.errorAuthBillingText).toMatch(/credits|API key/i);
    expect(en.errorAuthBillingText).toMatch(/Settings|provider account/i);
    // The generic copy points at the session log.
    expect(en.errorGenericProviderText).toMatch(/session log/i);
  });

  it("does not misclassify near-miss bodies as auth/billing", () => {
    expect(isAuthBillingFailure("The summary accredits the original author")).toBe(false);
    expect(isAuthBillingFailure("upstream trace req-402-x failed")).toBe(false);
    expect(isAuthBillingFailure("500: disk quota reached on worker volume")).toBe(false);
    expect(isAuthBillingFailure("insufficient_quota")).toBe(true);
    expect(isAuthBillingFailure("You exceeded your current quota, please check your plan and billing details.")).toBe(
      true
    );
  });

  it("passes both harness-documented errors through verbatim", () => {
    expect(isHarnessDocumentedError(en.errorLoopAbortNote)).toBe(true);
    expect(isHarnessDocumentedError(CONTEXT_WINDOW_TOO_SMALL_MESSAGE)).toBe(true);
    expect(providerErrorNotice(en.errorLoopAbortNote).text).toBe(en.errorLoopAbortNote);
    expect(providerErrorNotice(CONTEXT_WINDOW_TOO_SMALL_MESSAGE).text).toBe(CONTEXT_WINDOW_TOO_SMALL_MESSAGE);
  });
});

describe("Missing-credits provider error surfaces as a readable chat error state", () => {
  it("stream-error path: readable auth/billing state, run visibly ends, composer unlocks, no transcript turn", () => {
    seedConversation();
    render(<ChatPanel />);
    const turnsBefore = useCbe.getState().turns.length;

    emitAgentEvent({ type: "agent_start", data: {} });
    expect(sendSlotState()).toBe("stop");
    emitAgentEvent({ type: "error", data: { message: RAW_CREDITS_BODY } });

    // Readable English error state where the lecturer is looking — the chat
    // panel's notice surface — naming the cause class and the recovery path.
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(en.errorAuthBillingText);
    // Never the raw payload verbatim in the chat surface.
    expect(document.body.textContent).not.toContain("XQJ-RAW-MARKER");
    // Not the alarm banner either (readable provider errors are chat-surface).
    expect(useCbe.getState().error).toBeNull();
    // The run visibly ends instead of stalling silently…
    expect(useCbe.getState().live.streaming).toBe(false);
    // …and the composer is usable again.
    expect(sendSlotState()).toBe("send");
    // Display-state only: no transcript turn was persisted for the error.
    expect(useCbe.getState().turns.length).toBe(turnsBefore);
  });

  it("rejected-prompt path: readable auth/billing state, composer unlocks", async () => {
    seedConversation();
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(new Error(RAW_CREDITS_BODY));
    render(<ChatPanel />);

    fireEvent.change(composer(), { target: { value: "Weiter bitte" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(en.errorAuthBillingText));
    expect(document.body.textContent).not.toContain("XQJ-RAW-MARKER");
    // The composer unlocked again (submitting/dispatchPending cleared).
    await waitFor(() => expect(sendSlotState()).toBe("send"));
    // Display-state only: the error is not a persisted transcript turn (the
    // lecturer's own turn stays — the error text joins no turn).
    const turns = useCbe.getState().turns;
    expect(JSON.stringify(turns)).not.toContain(en.errorAuthBillingText);
    expect(JSON.stringify(turns)).not.toContain("XQJ-RAW-MARKER");
  });
});

describe("Other provider errors surface generically without the raw payload", () => {
  it("stream-error path: generic readable state, raw body absent, run ends, composer unlocks", () => {
    seedConversation();
    render(<ChatPanel />);

    emitAgentEvent({ type: "agent_start", data: {} });
    emitAgentEvent({ type: "error", data: { message: RAW_SERVER_BODY } });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(en.errorGenericProviderText);
    expect(document.body.textContent).not.toContain("XQJ-RAW-MARKER");
    expect(document.body.textContent).not.toContain("upstream worker exploded");
    expect(useCbe.getState().live.streaming).toBe(false);
    expect(sendSlotState()).toBe("send");
  });

  it("rejected-prompt path: generic readable state, raw body absent, composer unlocks", async () => {
    seedConversation();
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(new Error(RAW_SERVER_BODY));
    render(<ChatPanel />);

    fireEvent.change(composer(), { target: { value: "Noch ein Versuch" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(en.errorGenericProviderText));
    expect(document.body.textContent).not.toContain("XQJ-RAW-MARKER");
    await waitFor(() => expect(sendSlotState()).toBe("send"));
  });
});
