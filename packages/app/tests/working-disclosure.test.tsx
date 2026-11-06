import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useCbe } from "../src/renderer/state/store.js";
import { __resetActiveLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { ChatPanel, normalChatItems } from "../src/renderer/components/ChatPanel.js";
import { WorkingDisclosure } from "../src/renderer/components/WorkingDisclosure.js";
import { en } from "../src/shared/i18n/en.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";
import { emitAgentEvent, TEST_SESSION_ID } from "./helpers/agent-events.js";
import { seedBackgroundConversation, seedConversation } from "./helpers/conversation.js";
import type { ActivityItem } from "../src/renderer/state/activity.js";
import type { ToolCardData } from "../src/renderer/components/ToolCard.js";

const PATH_SENTINEL = "PATH_SENTINEL_9f2a";
const RESULT_SENTINEL = "RESULT_SENTINEL_4d31";
const REASONING_SENTINEL = "REASONING_SENTINEL_729b";
const RAW_ERROR_SENTINEL = "RAW_ERROR_SENTINEL_631c";
const SENTINELS = [PATH_SENTINEL, RESULT_SENTINEL, REASONING_SENTINEL, RAW_ERROR_SENTINEL];

function toolItem(id: string, toolName: string, data: Partial<ToolCardData> = {}): ActivityItem {
  return {
    kind: "tool",
    id,
    data: { toolCallId: id, toolName, args: { pattern: "safe-pattern" }, status: "running", ...data },
  };
}

/** A shipped language that is not the one the test environment pins, derived from
 * the registry so a further language costs this file nothing. */
function otherLanguage() {
  const other = Object.values(LANGUAGES).find((language) => language.strings !== en);
  if (!other) throw new Error("only one catalogue ships — the switch cannot be observed");
  return other;
}

function domAndAttributeText(root: ParentNode): string {
  const attributes = [...root.querySelectorAll("*")].flatMap((element) =>
    [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)
  );
  return `${root.textContent ?? ""}\n${attributes.join("\n")}`;
}

function emitHostileActivity() {
  emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
  emitAgentEvent({
    type: "tool_execution_start",
    sessionId: TEST_SESSION_ID,
    data: { toolCallId: "good", toolName: "read", args: { path: `/workspace/${PATH_SENTINEL}.md` } },
  });
  emitAgentEvent({
    type: "tool_execution_end",
    sessionId: TEST_SESSION_ID,
    data: { toolCallId: "good", toolName: "read", result: RESULT_SENTINEL, isError: false },
  });
  emitAgentEvent({ type: "thinking_start", sessionId: TEST_SESSION_ID, data: { contentIndex: 0 } });
  emitAgentEvent({
    type: "thinking_delta",
    sessionId: TEST_SESSION_ID,
    data: { contentIndex: 0, delta: REASONING_SENTINEL },
  });
  emitAgentEvent({ type: "thinking_end", sessionId: TEST_SESSION_ID, data: { contentIndex: 0 } });
  emitAgentEvent({
    type: "tool_execution_start",
    sessionId: TEST_SESSION_ID,
    data: { toolCallId: "bad", toolName: "grep", args: { pattern: "safe-pattern" } },
  });
  emitAgentEvent({
    type: "tool_execution_end",
    sessionId: TEST_SESSION_ID,
    data: { toolCallId: "bad", toolName: "grep", result: RAW_ERROR_SENTINEL, isError: true },
  });
}

beforeEach(() => seedConversation());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetActiveLanguage();
  useCbe.getState().reset();
});

describe("Scenario: Closed detail is absent rather than CSS-hidden", () => {
  it("keeps hostile technical content out of DOM text, attributes and accessibility metadata while closed", () => {
    const { container } = render(<ChatPanel />);
    emitHostileActivity();

    const trigger = screen.getByRole("button", { name: "Working…" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();
    const surface = domAndAttributeText(container);
    for (const sentinel of SENTINELS) expect(surface).not.toContain(sentinel);
    expect(surface).not.toContain("toolName");
    expect(surface).not.toContain("toolCallId");
  });

  it("proves the sentinel audit catches CSS-hidden and aria-hidden leakage as a negative control", () => {
    const { container } = render(
      <div hidden aria-hidden="true" data-leaked={PATH_SENTINEL}>
        {RESULT_SENTINEL}
      </div>
    );
    const surface = domAndAttributeText(container);
    expect(surface).toContain(PATH_SENTINEL);
    expect(surface).toContain(RESULT_SENTINEL);
  });
});

describe("Scenario: The closed disclosure yields to the first visible answer text", () => {
  it("survives whitespace, then yields to prose and does not return during later activity", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "  \n" } });

    const beforeText = container.querySelector(".working-disclosure");
    expect(beforeText).not.toBeNull();
    expect(beforeText?.parentElement?.firstElementChild).toBe(beforeText);

    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "Visible answer." } });
    expect(screen.getByText("Visible answer.")).toBeTruthy();
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(screen.getByRole("button", { name: en.chatStopLabel })).toBeTruthy();

    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "later", toolName: "read", args: { path: "/workspace/later.md" } },
    });
    emitAgentEvent({ type: "thinking_start", sessionId: TEST_SESSION_ID, data: { contentIndex: 1 } });
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(container.querySelector(".tool-card")).toBeNull();
    expect(container.querySelector(".thinking")).toBeNull();
  });
});

describe("Scenario: Deliberately opened disclosure stays pinned when prose begins", () => {
  it("keeps safe technical detail pinned before prose and retains the trigger when closed", () => {
    const { container } = render(<ChatPanel />);
    emitHostileActivity();
    const trigger = screen.getByRole("button", { name: "Working…" });
    fireEvent.click(trigger);

    const panel = container.querySelector(".working-disclosure-panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain(PATH_SENTINEL);
    expect(panel?.textContent).toContain(RESULT_SENTINEL);
    expect(panel?.textContent).toContain(REASONING_SENTINEL);
    expect(panel?.textContent).not.toContain(RAW_ERROR_SENTINEL);
    expect(panel?.textContent).toContain("Tool execution failed");

    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "Visible intro." } });
    const disclosure = container.querySelector(".working-disclosure");
    const answer = screen.getByText("Visible intro.");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    expect(container.querySelector(".working-disclosure")).not.toBeNull();
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(container.querySelector(".working-disclosure-panel")).not.toBeNull();
  });

  it("closes with Escape, unmounts detail and returns focus to the disclosure trigger", async () => {
    const { container } = render(
      <WorkingDisclosure items={[toolItem("tool-1", "read", { args: { path: "/workspace/a.md" } })]} />
    );
    const trigger = screen.getByRole("button", { name: "Working…" });
    fireEvent.click(trigger);
    const tool = screen.getByRole("button", { name: /Reading/ });
    tool.focus();
    expect(document.activeElement).toBe(tool);
    fireEvent.keyDown(tool, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();
  });

  it("closes with Escape from the trigger itself, where opening leaves the keyboard focus", () => {
    // Opening deliberately does not move focus, so the trigger IS the default
    // post-open focus position — a panel-only Escape handler is inert there.
    const { container } = render(
      <WorkingDisclosure items={[toolItem("tool-1", "read", { args: { path: "/workspace/a.md" } })]} />
    );
    const trigger = screen.getByRole("button", { name: "Working…" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);
    expect(container.querySelector(".working-disclosure-panel")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("gives each tool row an accessible name carrying its own action and localized status", () => {
    // A constant name would make every row of a multi-tool turn indistinguishable
    // to a screen reader while sighted users read four different spans. The errored
    // row is real — it carries the hostile sentinel as both its result and its
    // message, so an implementation that interpolated either would fail here.
    const { container } = render(
      <WorkingDisclosure
        items={[
          toolItem("t1", "read", { args: { path: "/workspace/a.md" } }),
          toolItem("t2", "grep"),
          toolItem("t3", "read", {
            args: { path: "/workspace/b.md" },
            status: "error",
            result: RAW_ERROR_SENTINEL,
            errorMessage: RAW_ERROR_SENTINEL,
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: en.chatWorkingDisclosureLabel }));
    const rows = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("tool-card-head"))
      .map((button) => button.getAttribute("aria-label") ?? "");
    expect(rows).toHaveLength(3);
    expect(new Set(rows).size, `rows share one accessible name: ${rows.join(" | ")}`).toBe(3);
    expect(rows.filter((row) => row.includes(en.toolStatusRunning))).toHaveLength(2);
    expect(rows.filter((row) => row.includes(en.toolStatusError))).toHaveLength(1);
    expect(rows.find((row) => row.includes(en.toolReadLabel) && row.includes("a.md"))).toBeTruthy();
    expect(rows.find((row) => row.includes(en.toolGrepLabel))).toBeTruthy();
    // Raw failure text never enters visible or accessible output: the errored row
    // carries the safe status in its name and the safe copy in its body.
    for (const row of rows) expect(row).not.toContain(RAW_ERROR_SENTINEL);
    const panel = container.querySelector(".working-disclosure-panel");
    expect(panel?.textContent).toContain(en.toolExecutionFailed);
    expect(domAndAttributeText(panel!)).not.toContain(RAW_ERROR_SENTINEL);
  });

  it("follows an interface-language switch made mid-run, in the row and in its name", () => {
    const other = otherLanguage();
    const { container } = render(
      <WorkingDisclosure items={[toolItem("t1", "read", { args: { path: "/workspace/a.md" } })]} />
    );
    fireEvent.click(screen.getByRole("button", { name: en.chatWorkingDisclosureLabel }));
    const status = () => container.querySelector(".tool-card-status")?.textContent;
    const rowName = () => container.querySelector(".tool-card-head")?.getAttribute("aria-label") ?? "";
    expect(status()).toBe(en.toolStatusRunning);
    expect(rowName()).toContain(en.toolStatusRunning);

    act(() => setActiveLanguage(other.code));

    expect(status()).toBe(other.strings.toolStatusRunning);
    expect(rowName()).toContain(other.strings.toolStatusRunning);
    expect(screen.getByRole("button", { name: other.strings.chatWorkingDisclosureLabel })).toBeTruthy();
    // The internal union token is untouched — only its presentation moved.
    expect(container.querySelector(".tool-card")?.className).toContain("tool-running");
    expect(container.querySelector(".working-disclosure-panel")).not.toBeNull();
  });
});

describe("Scenario: A course switch never carries one conversation's disclosure into another", () => {
  it("starts an active switched-to course with visible prose without a disclosure and restores the other course's own", () => {
    const { container } = render(<ChatPanel />);
    seedBackgroundConversation("session-b", "course-b");
    emitHostileActivity();
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    expect(container.querySelector(".working-disclosure-panel")).not.toBeNull();

    emitAgentEvent({ type: "agent_start", sessionId: "session-b", data: {} });
    emitAgentEvent({ type: "text_delta", sessionId: "session-b", data: { delta: "Course B answer." } });

    act(() => useCbe.getState().setActiveCourse("course-b"));
    expect(screen.getByText("Course B answer.")).toBeTruthy();
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();

    act(() => useCbe.getState().setActiveCourse("test-course"));
    expect(screen.queryByText("Course B answer.")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Working…" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".working-disclosure-panel")).toBeNull();
    const surface = domAndAttributeText(container);
    for (const sentinel of SENTINELS) expect(surface).not.toContain(sentinel);
  });
});

describe("Scenario: The Working disclosure ignores empty-named activity", () => {
  it("omits an empty-named phantom row from the opened panel and leaves the trigger copy generic", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "real", toolName: "read", args: { path: "/workspace/a.md" } },
    });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: `phantom-${PATH_SENTINEL}`, toolName: "   ", args: {} },
    });

    const trigger = screen.getByRole("button", { name: "Working…" });
    fireEvent.click(trigger);
    expect(container.querySelectorAll(".tool-card")).toHaveLength(1);
    expect(container.querySelector(".tool-card-id")?.textContent).toBe("read");
    // The phantom must not reach the panel at all — not as a row, not as metadata.
    expect(domAndAttributeText(container)).not.toContain(PATH_SENTINEL);
    expect(screen.getByRole("button", { name: "Working…" })).toBe(trigger);
  });
});

describe("Scenario: Parallel tools keep one lifecycle wrapper", () => {
  it("shows both activities only when opened and never creates per-tool wrappers", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    for (const [toolCallId, toolName] of [
      ["a", "read"],
      ["b", "grep"],
    ] as const) {
      emitAgentEvent({
        type: "tool_execution_start",
        sessionId: TEST_SESSION_ID,
        data: { toolCallId, toolName, args: toolName === "read" ? { path: "/workspace/a.md" } : { pattern: "x" } },
      });
    }
    expect(container.querySelectorAll(".working-disclosure")).toHaveLength(1);
    expect(container.querySelectorAll(".tool-card")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    expect(container.querySelectorAll(".tool-card")).toHaveLength(2);

    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "b", toolName: "grep", result: "b done", isError: false },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "a", toolName: "read", result: "a done", isError: false },
    });
    expect(container.querySelectorAll(".working-disclosure")).toHaveLength(1);
    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });
    expect(container.querySelector(".working-disclosure")).toBeNull();
  });
});

describe("Scenario: Automatic retry does not restore a disclosure replaced by prose", () => {
  it("keeps the pre-text wrapper across a pre-text retry and does not restore it after prose", () => {
    // The host's `agent_end` is the SETTLED end, so a retry inside the run reaches
    // the renderer only as its retry signals — once before prose, once after.
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(1);
    emitAgentEvent({
      type: "auto_retry_start",
      sessionId: TEST_SESSION_ID,
      data: { attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "RAW_RETRY_ERROR" },
    });
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(1);
    emitAgentEvent({ type: "auto_retry_end", sessionId: TEST_SESSION_ID, data: { success: true, attempt: 1 } });
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "partial" } });
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(0);
    expect(useCbe.getState().turns).toHaveLength(0);

    emitAgentEvent({
      type: "auto_retry_start",
      sessionId: TEST_SESSION_ID,
      data: { attempt: 2, maxAttempts: 3, delayMs: 0, errorMessage: "RAW_RETRY_ERROR" },
    });
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(0);
    expect(document.querySelector(".chat-banners")).toBeNull();
    expect(document.body.textContent).not.toContain("RAW_RETRY_ERROR");
    emitAgentEvent({ type: "auto_retry_end", sessionId: TEST_SESSION_ID, data: { success: true, attempt: 2 } });
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: " final" } });
    expect(document.querySelectorAll(".working-disclosure")).toHaveLength(0);
    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });

    expect(document.querySelector(".working-disclosure")).toBeNull();
    expect(useCbe.getState().turns).toHaveLength(1);
    expect(screen.getByText("partial final")).toBeTruthy();
  });
});

describe("Scenario: Terminal completion removes passive detail", () => {
  it("removes the wrapper and passive subtree while retaining internal chronology", () => {
    const { container } = render(<ChatPanel />);
    emitHostileActivity();
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    emitAgentEvent({ type: "text_delta", sessionId: TEST_SESSION_ID, data: { delta: "Visible intro." } });
    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });

    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(container.querySelector(".tool-card")).toBeNull();
    expect(container.querySelector(".thinking")).toBeNull();
    const surface = domAndAttributeText(container);
    for (const sentinel of SENTINELS) expect(surface).not.toContain(sentinel);
    const finalized = useCbe.getState().turns.at(-1);
    expect(finalized?.role).toBe("assistant");
    expect(finalized?.role === "assistant" ? finalized.activity.map((item) => item.kind) : []).toEqual([
      "tool",
      "thinking",
      "tool",
      "text",
    ]);
  });
});

describe("Scenario: A failed Picker stays technical while self-correction is possible", () => {
  const invalidArgs = {
    question: "Choose one per level",
    options: Array.from({ length: 9 }, (_, index) => ({ id: `o${index}`, label: `Option ${index}` })),
  };
  const validArgs = {
    question: "Choose unit 1",
    options: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" },
      { id: "c", label: "Option C" },
    ],
  };

  it("keeps an overfull running/error Picker out of normal chat and inside opened Working detail", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "failed", toolName: "cbe_picker", args: invalidArgs },
    });

    expect(container.querySelector(".picker")).toBeNull();
    expect(screen.queryByText(en.chatInteractionUnavailable)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Working…" }));
    const notice = screen.getByText(en.chatInteractionUnavailable);
    expect(notice.closest(".working-disclosure-panel")).toBeTruthy();

    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "failed", toolName: "cbe_picker", result: RAW_ERROR_SENTINEL, isError: true },
    });
    expect(domAndAttributeText(container)).not.toContain(RAW_ERROR_SENTINEL);
  });

  it("shows a later valid Picker and removes the corrected failure at terminal completion", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "failed", toolName: "cbe_picker", args: invalidArgs },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "failed", toolName: "cbe_picker", result: RAW_ERROR_SENTINEL, isError: true },
    });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "valid", toolName: "cbe_picker", args: validArgs },
    });
    emitAgentEvent({
      type: "tool_execution_end",
      sessionId: TEST_SESSION_ID,
      data: { toolCallId: "valid", toolName: "cbe_picker", result: "rendered", isError: false },
    });

    expect(screen.getByText("Choose unit 1")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Option A" })).toBeTruthy();
    expect(screen.queryByText(en.chatInteractionUnavailable)).toBeNull();

    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(screen.getByText("Choose unit 1")).toBeTruthy();
    expect(screen.queryByText(en.chatInteractionUnavailable)).toBeNull();
  });

  it("surfaces exactly the latest unresolved Picker failure once after terminal completion", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    for (const id of ["failed-1", "failed-2"]) {
      emitAgentEvent({
        type: "tool_execution_start",
        sessionId: TEST_SESSION_ID,
        data: { toolCallId: id, toolName: "cbe_picker", args: invalidArgs },
      });
      emitAgentEvent({
        type: "tool_execution_end",
        sessionId: TEST_SESSION_ID,
        data: { toolCallId: id, toolName: "cbe_picker", result: `${RAW_ERROR_SENTINEL}-${id}`, isError: true },
      });
    }

    expect(screen.queryByText(en.chatInteractionUnavailable)).toBeNull();
    emitAgentEvent({ type: "agent_end", sessionId: TEST_SESSION_ID, data: {} });
    expect(screen.getAllByText(en.chatInteractionUnavailable)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(RAW_ERROR_SENTINEL);
  });

  it("applies supersession only forward and only between Pickers", () => {
    const validPicker = toolItem("valid", "cbe_picker", { args: validArgs, status: "done" });
    const failedPicker = toolItem("failed", "cbe_picker", {
      args: invalidArgs,
      status: "error",
      errorMessage: RAW_ERROR_SENTINEL,
    });
    const validChecklist = toolItem("checklist", "cbe_decision_checklist", {
      status: "done",
      args: {
        presentation: "checklist",
        items: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });

    expect(normalChatItems([failedPicker, validPicker]).map((item) => item.id)).toEqual(["valid"]);
    expect(normalChatItems([failedPicker, { ...failedPicker, id: "failed-latest" }]).map((item) => item.id)).toEqual([
      "failed-latest",
    ]);
    expect(normalChatItems([validPicker, failedPicker]).map((item) => item.id)).toEqual(["valid", "failed"]);
    expect(normalChatItems([failedPicker, validChecklist]).map((item) => item.id)).toEqual(["failed", "checklist"]);
    expect(normalChatItems([failedPicker], { active: true })).toEqual([]);
  });
});

describe("Scenario: Interactive components stay outside the disclosure", () => {
  it("keeps Picker selection, answered state and exact payload behavior with technical detail closed", () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start", sessionId: TEST_SESSION_ID, data: {} });
    emitAgentEvent({
      type: "tool_execution_start",
      sessionId: TEST_SESSION_ID,
      data: {
        toolCallId: "pick-1",
        toolName: "cbe_picker",
        args: {
          question: "Choose one",
          options: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
          otherEnabled: true,
        },
      },
    });

    expect(document.querySelector(".working-disclosure-panel")).toBeNull();
    expect(document.querySelector(".tool-card-picker")?.closest(".working-disclosure")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Option B" }));
    expect(screen.getByLabelText("answered")).toBeTruthy();
    expect(send).toHaveBeenCalledWith(
      TEST_SESSION_ID,
      '[picker answer · tool call pick-1]\nquestion: Choose one\nselected: b ("Option B")',
      { text: '[picker answer · tool call pick-1]\nquestion: Choose one\nselected: b ("Option B")' }
    );
    expect(screen.getByRole("button", { name: "Working…" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Catalogue and reduced-motion contract", () => {
  it("provides disclosure and safe-interaction copy in every shipped catalogue", () => {
    for (const language of Object.values(LANGUAGES)) {
      for (const key of [
        "chatWorkingDisclosureLabel",
        "chatWorkingDetailLabel",
        "chatWorkingDetailEmpty",
        "chatInteractionUnavailable",
        "toolStatusRunning",
        "toolStatusDone",
        "toolStatusError",
      ] as const) {
        expect(language.strings[key].trim(), `${language.code}.${key}`).not.toBe("");
      }
      const states = [
        language.strings.toolStatusRunning,
        language.strings.toolStatusDone,
        language.strings.toolStatusError,
      ];
      expect(new Set(states).size, `${language.code} collapses two lifecycle states`).toBe(states.length);
      // The row label is parametrised: it must carry BOTH the action and the
      // status, or the rows of a multi-tool turn stop being distinguishable.
      const row = language.strings.chatWorkingToolActivityLabel({ action: "S-ACTION", status: "S-STATUS" });
      expect(row, `${language.code}.chatWorkingToolActivityLabel`).toContain("S-ACTION");
      expect(row, `${language.code}.chatWorkingToolActivityLabel`).toContain("S-STATUS");
    }
  });

  it("makes the disclosure's dot-grid static under reduced motion", () => {
    const fromWorkspace = process.cwd().endsWith("packages/app")
      ? "src/renderer/styles.css"
      : "packages/app/src/renderer/styles.css";
    const css = readFileSync(resolve(process.cwd(), fromWorkspace), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stream-dot[\s\S]*?animation:\s*none/);
  });
});
