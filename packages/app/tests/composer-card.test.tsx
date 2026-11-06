/**
 * The composer card (change `reshape-the-composer-in-the-llama-cpp-look`;
 * capability `desktop-app`, Requirement: Long-Form Composer for Lecturer Input).
 * One test per Scenario this change adds or rewrites:
 *
 * - Enter submits, Shift+Enter inserts a newline, Cmd/Ctrl+Enter still submits
 * - Enter during an input-method composition does not send
 * - Enter accepts a slash-command completion instead of sending
 * - The composer renders as one card with the control row inside it
 * - The locked state tints the whole card, and the lock survives without colour
 * - The text area has no placeholder but keeps an accessible name
 *
 * The requirement's carried-over scenarios (auto-grow, the run-level lock, the
 * `submitting` flag, paste preservation) keep their own files —
 * `composer-lock.test.tsx` and `composer-paste.test.tsx` — and still pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import {
  MODEL_PILL_NAME,
  composerField,
  openPlusMenu,
  plusButton,
  querySendButton,
  sendButton,
  stopButton,
} from "./helpers/composer.js";

const STYLES = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderer/styles.css"), "utf8");

function ruleFor(selector: string): string {
  const at = STYLES.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return STYLES.slice(at, STYLES.indexOf("}", at));
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation({ session: { ...testSession(), affordances: { ingestion: true } } });
  useCbe.setState({
    hydration: "ready",
    providerStatus: { baseURL: "https://llm.example/v1", modelId: "gemma4-31b", hasKey: true },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCbe.getState().reset();
});

/**
 * The slash panel accepts Enter from a capture-phase `keydown` listener it
 * attaches in a PASSIVE effect (`SlashAutocomplete`). RTL's `waitFor` runs with
 * React's act environment deliberately DISABLED (`asyncWrapper` in
 * `@testing-library/react`), so it observes the COMMITTED DOM while that effect
 * may still be queued in React's scheduler — waiting for the listbox to appear
 * therefore proves the render, not the mechanism, and an Enter dispatched right
 * after it can land before the listener exists. That is a real race, not
 * machine load: it went red on a clean CI runner during the v0.1.9 build and in
 * an isolated single-file run locally. So tests wait for the LISTENER.
 *
 * The tracker records every capture-phase document `keydown` registration and
 * drops it again on removal; `SlashAutocomplete` is the only renderer component
 * that uses that combination, so a non-empty set means the panel's key handling
 * is live. `vi.restoreAllMocks()` in `afterEach` puts the real methods back.
 */
function trackSlashKeyListeners(): Set<EventListenerOrEventListenerObject> {
  const live = new Set<EventListenerOrEventListenerObject>();
  const isCapture = (opts?: boolean | AddEventListenerOptions | EventListenerOptions) =>
    opts === true || (typeof opts === "object" && opts?.capture === true);
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((type, fn, opts) => {
    if (type === "keydown" && fn && isCapture(opts)) live.add(fn);
    add(type, fn, opts);
  });
  vi.spyOn(document, "removeEventListener").mockImplementation((type, fn, opts) => {
    if (type === "keydown" && fn && isCapture(opts)) live.delete(fn);
    remove(type, fn, opts);
  });
  return live;
}

describe("Scenario: Enter submits, Shift+Enter inserts a newline, Cmd/Ctrl+Enter still submits", () => {
  it("sends on a bare Enter", async () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    const field = composerField();
    fireEvent.change(field, { target: { value: "Kurze Frage" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toBe("Kurze Frage");
    expect(composerField().value).toBe("");
  });

  it("does not send on Shift+Enter — the textarea inserts its newline", () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    const field = composerField();
    fireEvent.change(field, { target: { value: "Erste Zeile" } });
    const evt = fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    // Not prevented → the textarea's own newline insertion stands.
    expect(evt).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(composerField().value).toBe("Erste Zeile");
  });

  it("still sends on Cmd+Enter and on Ctrl+Enter", async () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    fireEvent.change(composerField(), { target: { value: "mit Cmd" } });
    await act(async () => {
      fireEvent.keyDown(composerField(), { key: "Enter", metaKey: true });
    });
    fireEvent.change(composerField(), { target: { value: "mit Ctrl" } });
    await act(async () => {
      fireEvent.keyDown(composerField(), { key: "Enter", ctrlKey: true });
    });
    expect(send.mock.calls.map((c) => c[1])).toEqual(["mit Cmd", "mit Ctrl"]);
  });
});

describe("Scenario: Enter during an input-method composition does not send", () => {
  it("reads the platform's composition state — via the event flag and via the composition events", async () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    const field = composerField();
    fireEvent.change(field, { target: { value: "にほんご" } });

    // (a) The key event's own `isComposing` flag.
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    });
    expect(send).not.toHaveBeenCalled();
    expect(composerField().value).toBe("にほんご");

    // (b) The composition start/end events, for platforms that report the state
    // that way rather than on the key event.
    fireEvent.compositionStart(field);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(send).not.toHaveBeenCalled();
    expect(composerField().value).toBe("にほんご");

    // Once the composition ends, the same key sends.
    fireEvent.compositionEnd(field);
    await act(async () => {
      fireEvent.keyDown(composerField(), { key: "Enter" });
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Scenario: Enter accepts a slash-command completion instead of sending", () => {
  it("the panel's capture-phase claim resolves first; with no match the same Enter sends", async () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "getCommands").mockResolvedValue([
      { name: "cite", source: "extension", description: "Insert a citation" },
    ]);
    const slashKeyListeners = trackSlashKeyListeners();
    render(<ChatPanel />);
    const field = composerField();
    fireEvent.change(field, { target: { value: "/ci" } });
    // Wait for the mechanism, not the paint: the listbox being in the DOM does
    // not yet mean the panel's capture-phase listener is attached.
    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
      expect(slashKeyListeners.size).toBeGreaterThan(0);
    });
    // The panel listens on the document in the capture phase, so the key has to
    // be dispatched there rather than on the textarea alone.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    expect(send).not.toHaveBeenCalled();
    // The highlighted completion is accepted into the field, draft intact.
    expect(composerField().value).toBe("/cite ");

    // With the panel showing no match, the same Enter sends. `fireEvent` is
    // act-wrapped, so the panel's effect cleanup has already run here — the
    // mirror image of the wait above, asserted rather than assumed.
    fireEvent.change(composerField(), { target: { value: "/zzz" } });
    expect(slashKeyListeners.size).toBe(0);
    await act(async () => {
      fireEvent.keyDown(composerField(), { key: "Enter" });
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toBe("/zzz");
  });
});

describe("Scenario: The composer renders as one card with the control row inside it", () => {
  it("carries exactly three children in order, with no inner border and no separator", () => {
    const { container } = render(<ChatPanel />);
    const card = container.querySelector(".composer-box") as HTMLElement;
    // Without pending attachments the card carries two of its three children;
    // the pills are the conditional first one.
    expect([...card.children].map((c) => c.tagName.toLowerCase() + "." + c.className)).toEqual([
      "textarea.",
      "div.composer-row",
    ]);
    // One rounded, bordered, softly shadowed surface.
    const box = ruleFor(".composer-box");
    expect(box).toMatch(/border-radius:\s*16px/);
    expect(box).toMatch(/border:\s*1px solid/);
    expect(box).toMatch(/box-shadow:/);
    // The card is the only frame — the textarea carries no second border…
    expect(ruleFor(".composer-box textarea")).toMatch(/border:\s*0/);
    // …and there is no separator between the text area and the control row.
    expect(ruleFor(".composer-row")).not.toMatch(/border-top/);
    // No hint or status line anywhere on the card, in either state — and the
    // rules that only it used are gone with it, so a stray element could not be
    // styled back into place unnoticed.
    expect(card.querySelector(".composer-hint, .composer-meta, .composer-status")).toBeNull();
    expect(STYLES).not.toContain(".composer-hint");
    expect(STYLES).not.toContain(".composer-meta");
    expect(STYLES).not.toContain(".composer-status");
  });

  it("puts the pending-attachment pills first when there are any", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, text: "BODY", filename: "modul.pdf", docType: "pdf" },
    ]);
    const { container } = render(<ChatPanel />);
    fireEvent.click(within(openPlusMenu()).getByRole("menuitem", { name: en.chatUploadEntryLabel }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "modul.pdf" }) })).toBeTruthy()
    );
    const card = container.querySelector(".composer-box") as HTMLElement;
    expect([...card.children].map((c) => c.className || c.tagName.toLowerCase())).toEqual([
      "pending-attachments",
      "textarea",
      "composer-row",
    ]);
  });
});

describe("Scenario: The locked state tints the whole card, and the lock survives without colour", () => {
  it("tints the card, and carries the lock on the stop control and the working indicator", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start" });
    const composer = container.querySelector(".composer") as HTMLElement;
    expect(composer.className).toContain("composer-locked");
    // The tint covers the CARD as a surface, and it is muted rather than accent.
    const tint = ruleFor(".composer-locked .composer-box");
    expect(tint).toMatch(/background:\s*color-mix\(in oklch, var\(--bg\), var\(--muted\)/);
    expect(tint).not.toMatch(/var\(--accent\)/);
    // CARRIER 1 — the send slot has become the stop control, and its accessible
    // name says what it stops. Not a re-tinted send: a different control.
    expect(querySendButton()).toBeNull();
    expect(stopButton().getAttribute("aria-label")).toBe(en.chatStopLabel);
    // CARRIER 2 — the transcript's Working disclosure states the run in words
    // and owns exactly one polite status announcement.
    const disclosure = container.querySelector(".working-disclosure") as HTMLElement;
    expect(disclosure).toBeTruthy();
    expect(disclosure.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    expect(disclosure.querySelector(".working-disclosure-label")?.textContent?.trim()).toBe(
      en.chatWorkingDisclosureLabel
    );
    // The cues that used to carry this are gone, not merely hidden.
    expect(container.querySelector(".composer-status-dot")).toBeNull();
    expect(container.querySelector(".composer-status")).toBeNull();
    expect(composerField().getAttribute("placeholder")).toBeNull();
  });
});

describe("Scenario: The text area has no placeholder but keeps an accessible name", () => {
  it("renders no placeholder in either state and keeps one static accessible name", () => {
    render(<ChatPanel />);
    expect(composerField().getAttribute("placeholder")).toBeNull();
    expect(composerField().getAttribute("aria-label")).toBe(en.chatComposerFieldLabel);

    emitAgentEvent({ type: "agent_start" });
    expect(composerField().getAttribute("placeholder")).toBeNull();
    // The name does not change with the lock and does not restate it.
    expect(composerField().getAttribute("aria-label")).toBe(en.chatComposerFieldLabel);
  });
});
