/**
 * Tests for the composer's paste handler.
 *
 * The handler MUST take only `text/plain` from the clipboard, never `text/html`,
 * so that smart quotes, HTML fragments, and rich-text noise from Word / Google
 * Docs / Notion never reach the textarea — see spec scenario *Pasted Markdown
 * survives intact* in `specs/desktop-app/spec.md`.
 *
 * The handler also restores the caret position to immediately after the pasted
 * text, so a paste in the middle of a draft does not jump the cursor to the end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";

function seedSession() {
  useCbe.setState({
    mode: "design",
    session: {
      sessionId: "test-session",
      mode: "design",
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
    turns: [],
  });
}

function firePaste(el: HTMLElement, payload: { plain?: string; html?: string }): void {
  // jsdom has no real ClipboardEvent. fireEvent.paste accepts a clipboardData
  // object that the synthetic event wraps; the handler reads getData("text/plain")
  // off it. Reading "text/html" through the same shim proves the handler ignores it.
  fireEvent.paste(el, {
    clipboardData: {
      getData: (type: string) => {
        if (type === "text/plain") return payload.plain ?? "";
        if (type === "text/html") return payload.html ?? "";
        return "";
      },
    },
  });
}

function getComposer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  useCbe.getState().reset();
});

describe("composer paste — text/plain content lands intact", () => {
  it("plain Markdown with headings and lists pastes verbatim", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();

    const md = ["## Section", "", "- bullet one", "- bullet two", "", "```ts", "const x = 1;", "```"].join("\n");

    firePaste(ta, { plain: md });
    expect(ta.value).toBe(md);
  });

  it("citation token round-trips through paste", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    const text = "See (corpus:foundations-001 § Engage, Kolb 1984) for more.";
    firePaste(ta, { plain: text });
    expect(ta.value).toBe(text);
  });
});

describe("composer paste — text/html and rich-text noise never reach the textarea", () => {
  it("only text/plain is read; an accompanying text/html payload is ignored", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();

    const plain = "Plain version";
    const html = "<p style='color:red'>Plain <em>version</em> <span class='nbsp'>with</span> noise</p>";

    firePaste(ta, { plain, html });
    expect(ta.value).toBe(plain);
    expect(ta.value).not.toContain("<");
    expect(ta.value).not.toContain("style=");
  });

  it("smart quotes from a source app survive only if they are in text/plain — we do not transform them", () => {
    // The handler's contract is non-transformation: whatever text/plain says, we
    // take. If the source converted to smart quotes BEFORE the clipboard, that
    // is the source's choice. We assert: no auto-conversion happens HERE.
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    const plain = 'Plain "ASCII" quotes';
    firePaste(ta, { plain, html: "<p>Smart “quotes”</p>" });
    expect(ta.value).toBe('Plain "ASCII" quotes');
  });

  it("NBSP-runs and paragraph-collapsed whitespace from text/html never reach the textarea", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    const plain = "line 1\nline 2";
    const html = "<p>line 1</p>   <p>line 2</p>";
    firePaste(ta, { plain, html });
    expect(ta.value).toBe(plain);
    expect(ta.value).not.toContain(" ");
  });
});

describe("composer paste — caret restoration", () => {
  it("inserts at the caret position when pasting into a draft", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    // Seed the draft through the React onChange path so the controlled textarea's
    // value AND the component's `input` state agree (direct `ta.value = ...`
    // bypasses React and the handler then reads an empty closure value).
    fireEvent.change(ta, { target: { value: "abcXYZ" } });
    ta.selectionStart = 3;
    ta.selectionEnd = 3;
    firePaste(ta, { plain: "MIDDLE" });
    expect(ta.value).toBe("abcMIDDLEXYZ");
  });

  it("replaces a selection when pasting over text", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    fireEvent.change(ta, { target: { value: "keep [DROP THIS] keep" } });
    ta.selectionStart = 5; // before '['
    ta.selectionEnd = 16; // after ']'
    firePaste(ta, { plain: "kept" });
    expect(ta.value).toBe("keep kept keep");
  });
});

describe("composer paste — empty clipboard", () => {
  it("an empty text/plain payload leaves the textarea unchanged", () => {
    render(<ChatPanel />);
    const ta = getComposer();
    ta.focus();
    fireEvent.change(ta, { target: { value: "draft" } });
    firePaste(ta, { plain: "" });
    expect(ta.value).toBe("draft");
  });
});
