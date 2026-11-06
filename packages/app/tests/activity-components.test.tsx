/**
 * Component tests for the three activity-stream views:
 *   - ToolCard       — tool execution (running → done / error)
 *   - ThinkingBlock  — reasoning stream (live, then collapsed-after-done with
 *                      expand-on-click)
 * These components now render only inside the deliberately opened current-turn
 * disclosure (except valid interactive ToolCard swaps, which stay outside it).
 *
 * Style assertions go via class names (not screenshots) — the accent variable
 * is `--accent` on the CSS root, and the components consume it through
 * `currentColor` / `var(--accent)`. The tests pin the class wiring; CSS itself
 * is tested at integration time by visual review.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ToolCard, type ToolCardData } from "../src/renderer/components/ToolCard.js";
import { ThinkingBlock, type ThinkingBlockData } from "../src/renderer/components/ThinkingBlock.js";
import { en } from "../src/shared/i18n/en.js";

function seedSession() {
  useCbe.setState({
    session: {
      sessionId: "s",
      mode: "design",
      environmentProfile: "app",
      courseId: "test-course",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
  });
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  useCbe.getState().reset();
});

function makeTool(overrides: Partial<ToolCardData> = {}): ToolCardData {
  return {
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "/ws/notes.md" },
    status: "running",
    ...overrides,
  };
}

describe("ToolCard — status transitions", () => {
  it("running state renders a card with tool-running class and the running status text", () => {
    const { container } = render(<ToolCard card={makeTool({ status: "running" })} />);
    const card = container.querySelector(".tool-card");
    expect(card).not.toBeNull();
    // The class carries the INTERNAL union token; the text is the catalogue's.
    expect(card!.className).toContain("tool-running");
    expect(container.querySelector(".tool-card-status")?.textContent).toBe(en.toolStatusRunning);
  });

  it("done state renders tool-done class and the done status text", () => {
    const { container } = render(<ToolCard card={makeTool({ status: "done", result: "ok" })} />);
    expect(container.querySelector(".tool-card")?.className).toContain("tool-done");
    expect(container.querySelector(".tool-card-status")?.textContent).toBe(en.toolStatusDone);
  });

  it("error state renders tool-error class and substitutes safe copy for the raw message", () => {
    // The substitution is unconditional — it does not depend on the caller passing
    // `technicalDetail` — so no call site can print a raw failure into the chat.
    const { container } = render(
      <ToolCard card={makeTool({ status: "error", errorMessage: "ENOENT: missing file" })} />
    );
    expect(container.querySelector(".tool-card")?.className).toContain("tool-error");
    expect(container.querySelector(".tool-card-status")?.textContent).toBe(en.toolStatusError);
    // Body is collapsed by default — expand it.
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".tool-card-body")?.textContent).toBe(en.toolExecutionFailed);
    expect(container.textContent).not.toContain("ENOENT");
  });

  it("leads the header with the human label, raw id de-emphasised, plus the args summary", () => {
    // The head LEADS with the human-readable action label; the raw tool id stays
    // present but de-emphasised (`.tool-card-id`), and the args summary is unchanged.
    const { container } = render(<ToolCard card={makeTool({ toolName: "grep", args: { pattern: "TODO" } })} />);
    expect(container.querySelector(".tool-card-label")?.textContent).toBe("Searching corpus");
    expect(container.querySelector(".tool-card-id")?.textContent).toBe("grep");
    expect(container.querySelector(".tool-card-args")?.textContent).toBe("/TODO/");
  });

  it("path args are shortened against the active session's workspace path", () => {
    const { container } = render(<ToolCard card={makeTool({ args: { path: "/ws/sub/dir/file.md" } })} />);
    // shortenAgentPath strips the workspace prefix so the lecturer sees a
    // relative path, not a leaked absolute filesystem location.
    expect(container.querySelector(".tool-card-args")?.textContent).not.toContain("/ws/");
  });

  it("clicking the header toggles the body open/closed", () => {
    const { container } = render(<ToolCard card={makeTool({ status: "done", result: "some output" })} />);
    const head = screen.getByRole("button");
    expect(container.querySelector(".tool-card-body")).toBeNull();
    fireEvent.click(head);
    expect(container.querySelector(".tool-card-body")?.textContent).toBe("some output");
    fireEvent.click(head);
    expect(container.querySelector(".tool-card-body")).toBeNull();
  });

  it("body shows the FULL tool result, not a 140-char preview", () => {
    // Multi-line file content typical for a `read` against a corpus document.
    // The body must render the whole thing — the CSS-side max-height + overflow
    // produces the scrollbar; truncating in JS defeats the purpose of the
    // scrollable body.
    const longResult = Array.from({ length: 80 }, (_, i) => `line ${i + 1} of the corpus document`).join("\n");
    const { container } = render(<ToolCard card={makeTool({ status: "done", result: longResult })} />);
    fireEvent.click(screen.getByRole("button"));
    const body = container.querySelector(".tool-card-body");
    expect(body).not.toBeNull();
    expect(body!.textContent).toBe(longResult);
    expect(body!.textContent!.length).toBeGreaterThan(140);
  });

  it("body unwraps the standard Anthropic content[0].text shape (covers `read` tool results)", () => {
    const fileContent = "## Foundations\n\nLong corpus paragraph one.\n\nLong corpus paragraph two.";
    const sdkShape = { content: [{ text: fileContent, type: "text" }] };
    const { container } = render(<ToolCard card={makeTool({ status: "done", result: sdkShape })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".tool-card-body")?.textContent).toBe(fileContent);
  });

  it("body clamps pathological inputs at the safety cap with a truncation marker", () => {
    // Far above the 50 kB cap.
    const huge = "x".repeat(120_000);
    const { container } = render(<ToolCard card={makeTool({ status: "done", result: huge })} />);
    fireEvent.click(screen.getByRole("button"));
    const body = container.querySelector(".tool-card-body");
    expect(body).not.toBeNull();
    expect(body!.textContent!.length).toBeLessThan(huge.length);
    expect(body!.textContent).toContain("… (truncated, exceeded body cap)");
  });
});

describe("ThinkingBlock — collapsed by default, expand-on-click", () => {
  function makeBlock(overrides: Partial<ThinkingBlockData> = {}): ThinkingBlockData {
    return {
      id: 0,
      contentIndex: 0,
      text: "thinking through the problem",
      done: false,
      ...overrides,
    };
  }

  it("while live (done=false) the body is collapsed by default — reasoning must not dominate the chat", () => {
    const { container } = render(<ThinkingBlock block={makeBlock({ done: false })} />);
    expect(container.querySelector(".thinking-body")).toBeNull();
    expect(container.querySelector(".thinking")?.className).toContain("thinking-live");
  });

  it("once done, the body is still collapsed by default", () => {
    const { container } = render(<ThinkingBlock block={makeBlock({ done: true })} />);
    expect(container.querySelector(".thinking-body")).toBeNull();
    expect(container.querySelector(".thinking")?.className).toContain("thinking-done");
  });

  it("clicking the header expands a live block — the streamed-so-far reasoning is revealed", () => {
    const { container } = render(<ThinkingBlock block={makeBlock({ done: false })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".thinking-body")?.textContent).toBe("thinking through the problem");
  });

  it("clicking the header expands a done block — the captured reasoning becomes visible", () => {
    const { container } = render(<ThinkingBlock block={makeBlock({ done: true })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".thinking-body")?.textContent).toBe("thinking through the problem");
  });

  it("a second click on the header collapses the block again", () => {
    const { container } = render(<ThinkingBlock block={makeBlock({ done: true })} />);
    const head = screen.getByRole("button");
    fireEvent.click(head);
    expect(container.querySelector(".thinking-body")).not.toBeNull();
    fireEvent.click(head);
    expect(container.querySelector(".thinking-body")).toBeNull();
  });

  it("when expanded with no text yet, shows an ellipsis placeholder", () => {
    render(<ThinkingBlock block={makeBlock({ text: "", done: false })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("the label changes between 'thinking…' (live) and 'thinking' (done)", () => {
    const { rerender, container } = render(<ThinkingBlock block={makeBlock({ done: false })} />);
    expect(container.querySelector(".thinking-label")?.textContent).toBe("thinking…");
    rerender(<ThinkingBlock block={makeBlock({ done: true })} />);
    expect(container.querySelector(".thinking-label")?.textContent).toBe("thinking");
  });
});
