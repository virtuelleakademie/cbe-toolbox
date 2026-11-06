/**
 * Tests for the jump-to-latest floating button.
 *
 * The button MUST appear at the bottom-centre of the chat scroll whenever the
 * lecturer is more than ~200 px above the bottom — i.e. there is content below
 * the viewport that they cannot see — regardless of streaming state. Clicking
 * smooth-scrolls to the bottom and dismisses the button. When the lecturer is
 * at the bottom, the button is hidden.
 *
 * jsdom does not implement actual scroll layout, so the tests drive the scroll
 * geometry by mocking `scrollHeight`, `scrollTop` and `clientHeight` directly
 * on the .chat-scroll element and then firing the scroll event the component
 * listens for.
 *
 * Covers spec scenarios in `specs/desktop-app/spec.md`, *Jump-to-Latest
 * Affordance in the Chat Panel*.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation } from "./helpers/conversation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS_PATH = resolve(__dirname, "../src/renderer/styles.css");

function readJumpToLatestHoverBlock(): string {
  const css = readFileSync(STYLES_CSS_PATH, "utf8");
  const match = css.match(/\.jump-to-latest:hover\s*\{([^}]*)\}/);
  if (!match) throw new Error(".jump-to-latest:hover block not found in styles.css");
  // Strip CSS comments so the regression-guard regexes do not match historical
  // anti-pattern values quoted inside explanatory comments.
  return match[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

function seedSession() {
  // Conversation state is per-session (slice + visible mirror); events routed
  // by the app-level demux only land in an existing slice.
  seedConversation();
}

function getScrollEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".chat-scroll") as HTMLElement | null;
  if (!el) throw new Error(".chat-scroll not found");
  return el;
}

/** Force the scroll geometry of an element so handleScroll computes a chosen
 *  distance-from-bottom. jsdom does not lay out content, so we have to mock. */
function setScrollGeometry(
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }
): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(el, "scrollTop", { configurable: true, value: scrollTop, writable: true });
  fireEvent.scroll(el);
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  useCbe.getState().reset();
});

describe("jump-to-latest — visibility", () => {
  it("is hidden by default when the lecturer is at the bottom", () => {
    const { container } = render(<ChatPanel />);
    setScrollGeometry(getScrollEl(container), {
      scrollHeight: 1000,
      clientHeight: 600,
      scrollTop: 400, // distance from bottom = 0
    });
    expect(container.querySelector(".jump-to-latest")).toBeNull();
  });

  it("appears whenever the lecturer is scrolled up > ~200 px (no streaming or unseen-turn gate)", () => {
    const { container } = render(<ChatPanel />);
    // No agent_start, no fresh turn — pure idle history. The pill MUST still
    // appear because there is non-visible content below the viewport.
    setScrollGeometry(getScrollEl(container), {
      scrollHeight: 2000,
      clientHeight: 600,
      scrollTop: 800, // distance from bottom = 2000 - 600 - 800 = 600 px → scrolled up
    });
    expect(container.querySelector(".jump-to-latest")).not.toBeNull();
    expect(screen.getByLabelText("Jump to latest message")).toBeTruthy();
  });

  it("also appears mid-stream when scrolled up (streaming is not a precondition, just doesn't suppress)", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    setScrollGeometry(getScrollEl(container), {
      scrollHeight: 2000,
      clientHeight: 600,
      scrollTop: 800,
    });
    expect(container.querySelector(".jump-to-latest")).not.toBeNull();
  });

  it("appears when a new turn arrives while the lecturer is scrolled up", () => {
    const { container } = render(<ChatPanel />);
    setScrollGeometry(getScrollEl(container), {
      scrollHeight: 2000,
      clientHeight: 600,
      scrollTop: 800,
    });
    // Already visible by the bare-scrolled-up rule above, but assert the
    // post-new-turn state stays correct (no regression where the rule flips).
    act(() => {
      useCbe.getState().appendUserTurn("a fresh prompt");
    });
    expect(container.querySelector(".jump-to-latest")).not.toBeNull();
  });

  it("hides when the lecturer scrolls back to the bottom", () => {
    const { container } = render(<ChatPanel />);
    const scroll = getScrollEl(container);
    setScrollGeometry(scroll, { scrollHeight: 2000, clientHeight: 600, scrollTop: 800 });
    expect(container.querySelector(".jump-to-latest")).not.toBeNull();
    // Scroll back to the bottom (distance < threshold).
    setScrollGeometry(scroll, { scrollHeight: 2000, clientHeight: 600, scrollTop: 1399 });
    expect(container.querySelector(".jump-to-latest")).toBeNull();
  });
});

describe("jump-to-latest — interaction", () => {
  it("clicking calls scrollTo with smooth behavior and dismisses the button", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    const scroll = getScrollEl(container);
    setScrollGeometry(scroll, { scrollHeight: 2000, clientHeight: 600, scrollTop: 800 });

    const scrollSpy = vi.spyOn(scroll, "scrollTo");
    fireEvent.click(screen.getByLabelText("Jump to latest message"));

    expect(scrollSpy).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
    // Button hides on click. Even if jsdom does not animate the actual scroll,
    // the component flips scrolledUp=false eagerly so the cue disappears.
    expect(container.querySelector(".jump-to-latest")).toBeNull();
  });
});

describe("jump-to-latest — hover stability (static stylesheet check)", () => {
  // jsdom does not apply external CSS to elements, so we cannot assert
  // computed styles. Following the precedent set by the centring rule
  // (spec: "verified by manual inspection plus the static styles.css rule"),
  // we read styles.css and assert the .jump-to-latest:hover declarations.
  it("hover background mixes the accent INTO var(--bg), never to transparency", () => {
    const block = readJumpToLatestHoverBlock();
    expect(block).toMatch(/color-mix\(in oklch,\s*var\(--accent\)\s*\d+%,\s*var\(--bg\)\)/);
    // Regression guard: the previous fade-to-transparent rule must never come back.
    expect(block).not.toMatch(/transparent\s+\d+%/);
  });

  it("hover does not shift the pill (no translate transform on :hover)", () => {
    const block = readJumpToLatestHoverBlock();
    expect(block).not.toMatch(/transform\s*:\s*translate/);
  });
});

describe("jump-to-latest — auto-scroll deference", () => {
  it("does NOT auto-scroll to bottom on new content while the lecturer is scrolled up", () => {
    const { container } = render(<ChatPanel />);
    const scroll = getScrollEl(container);
    // Pin the lecturer scrolled up.
    setScrollGeometry(scroll, { scrollHeight: 2000, clientHeight: 600, scrollTop: 800 });
    const scrollSpy = vi.spyOn(scroll, "scrollTo");
    // Now stream content — auto-scroll effect should NOT fire because scrolledUp=true.
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    emitAgentEvent({ type: "text_delta", data: { delta: "fresh content arriving" } });
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("DOES auto-scroll when the lecturer is at the bottom (default behaviour preserved)", () => {
    const { container } = render(<ChatPanel />);
    const scroll = getScrollEl(container);
    setScrollGeometry(scroll, { scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    const scrollSpy = vi.spyOn(scroll, "scrollTo");
    emitAgentEvent({ type: "agent_start", data: { sessionId: "test-session" } });
    emitAgentEvent({ type: "text_delta", data: { delta: "fresh content" } });
    expect(scrollSpy).toHaveBeenCalled();
  });
});
