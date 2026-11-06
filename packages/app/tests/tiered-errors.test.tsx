/**
 * Tests for change `fix-step-select-run-lock`, Requirement: Tiered Error
 * Surfacing — Scenarios: Recoverable failure renders as a soft notice, not the
 * banner (catalog routing); Busy notice copy is English and names no runtime
 * internals; Banner carries no glyph, reads in body font, and is dismissible;
 * Raw transport prefixes never reach the lecturer.
 *
 * jsdom renders no pseudo-elements/fonts, so the glyph and font guarantees are
 * asserted against the stylesheet source (falsifiable: reintroducing the ⚠
 * pseudo-element or the monospace stack fails these tests), while the dismiss
 * affordance and copy are asserted in the DOM.
 */
import { readFileSync } from "node:fs";
import { en } from "../src/shared/i18n/en.js";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "../src/renderer/App.js";
import { useCbe } from "../src/renderer/state/store.js";
import { chatNoticeFor, isBusyRejection, stripTransportPrefix } from "../src/renderer/util/errors.js";
import type { ConversationOpenResult, ProviderStatus } from "../src/shared/ipc-contract.js";

const RAW_BUSY =
  "Error invoking remote method 'cbe:prompt': Error: Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.";

describe("error catalog (chatNoticeFor / stripTransportPrefix)", () => {
  // Scenario: Busy notice copy is English and names no runtime internals
  it("maps the busy rejection to English catalog copy without runtime API vocabulary", () => {
    const notice = chatNoticeFor(RAW_BUSY);
    expect(notice.text).toBe(en.errorBusyNoticeText);
    expect(notice.text).not.toMatch(/streamingBehavior|steer|followUp|Pi\b/);
    expect(notice.hint).toBeUndefined();
    // The main-process precheck message classifies the same way.
    expect(isBusyRejection("Agent is already processing — wait for the current turn to finish, then send again.")).toBe(
      true
    );
  });

  // Scenario: Raw transport prefixes never reach the lecturer
  it("strips the IPC transport prefix from unknown errors", () => {
    expect(stripTransportPrefix("Error invoking remote method 'cbe:prompt': Error: Something broke")).toBe(
      "Something broke"
    );
    expect(stripTransportPrefix("Error: plain failure")).toBe("plain failure");
    expect(stripTransportPrefix("no prefix at all")).toBe("no prefix at all");
    expect(chatNoticeFor("Error invoking remote method 'cbe:ingest': Error: File unreadable").text).toBe(
      "File unreadable"
    );
  });
});

describe("global error banner (hard-failure tier)", () => {
  const PROVIDER: ProviderStatus = { baseURL: "http://localhost:1", modelId: "test-model", hasKey: true };
  function conversation(): ConversationOpenResult {
    return {
      session: {
        sessionId: "conv-err",
        environmentProfile: "app",
        affordances: {},
        paths: { workspace: "/w", corpus: "/c" },
        courseId: "algorithmen",
      } as ConversationOpenResult["session"],
      turns: [],
      agentRunning: false,
      canvas: [],
    };
  }

  beforeEach(() => {
    useCbe.getState().reset();
    useCbe.setState({ configured: false, hydration: "idle", hydrationError: null });
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: vi.fn(async () => conversation()),
    });
  });
  afterEach(() => {
    cleanup();
    useCbe.getState().reset();
  });

  // Scenario: Banner carries no glyph, reads in body font, and is dismissible (DOM half)
  it("renders the message with a dismiss control that clears it", async () => {
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    act(() => useCbe.getState().setError("Session stream failed"));
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("Session stream failed");
    expect(banner.textContent).not.toContain("⚠");
    const dismiss = screen.getByRole("button", { name: /dismiss error/i });
    fireEvent.click(dismiss);
    expect(useCbe.getState().error).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Scenario: Banner carries no glyph, reads in body font (stylesheet half)
  it("stylesheet: .banner-error has no glyph pseudo-element and no monospace body", () => {
    // vitest runs with cwd = packages/app; jsdom rewrites import.meta.url, so
    // resolve from cwd instead.
    const css = readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
    const start = css.indexOf(".banner-error");
    const section = css.slice(start, css.indexOf("banner-notice", start));
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toContain('content: "⚠"');
    expect(section).not.toMatch(/\.banner-error[^{]*::before/);
    expect(section).not.toMatch(/font-family:\s*ui-monospace/);
  });
});
