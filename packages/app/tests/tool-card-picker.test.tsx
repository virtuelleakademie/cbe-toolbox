/**
 * Tests for ToolCard's generative-UI swap to the Picker component.
 *
 * When the rendered tool's name is `cbe_picker`, the ToolCard MUST replace the
 * standard "head + collapsible body" layout with the Picker React component
 * fed by the args payload (which is the validated PickerSpec from pi's
 * customTools mechanism). On submit, the response MUST flow back as a new
 * user turn via window.cbe.sendPrompt with a structured text payload that
 * carries the toolCallId for correlation.
 *
 * Covers spec scenarios in `specs/desktop-app/spec.md`, *Generative UI —
 * Picker* — specifically the integration "rendered via the Tool Result
 * component path" + "answer flows back as the next user turn".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolCard, type ToolCardData } from "../src/renderer/components/ToolCard.js";
import { useCbe } from "../src/renderer/state/store.js";

function seedSession() {
  useCbe.setState({
    session: {
      sessionId: "sess-1",
      mode: "design",
      environmentProfile: "app",
      courseId: "test-course",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
  });
}

function makePickerCard(): ToolCardData {
  return {
    toolCallId: "call-42",
    toolName: "cbe_picker",
    args: {
      question: "Welche Option passt?",
      options: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
    },
    status: "running",
  };
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  useCbe.getState().reset();
});

describe("ToolCard — cbe_picker swap", () => {
  it("renders the Picker component instead of the standard tool card body", () => {
    const { container } = render(<ToolCard card={makePickerCard()} />);
    // Picker container present
    expect(container.querySelector(".picker")).not.toBeNull();
    // Standard tool-card-head (collapsible button) is NOT used for the picker
    expect(container.querySelector(".tool-card-head")).toBeNull();
    // The wrapper carries the picker marker class so CSS can adjust spacing
    expect(container.querySelector(".tool-card-picker")).not.toBeNull();
  });

  it("non-picker tools still render with the standard head + collapsible body", () => {
    const card: ToolCardData = {
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "/ws/x.md" },
      status: "done",
      result: "file content",
    };
    const { container } = render(<ToolCard card={card} />);
    expect(container.querySelector(".tool-card-head")).not.toBeNull();
    expect(container.querySelector(".picker")).toBeNull();
  });

  it("submitting a single-select pick calls window.cbe.sendPrompt with the structured payload", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ToolCard card={makePickerCard()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Option B/i }));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [sessionId, text] = sendSpy.mock.calls[0]!;
    expect(sessionId).toBe("sess-1");
    expect(text).toContain("picker answer");
    expect(text).toContain("call-42");
    expect(text).toContain('b ("Option B")');
  });

  it("submitting Other with free text carries the otherText line back", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ToolCard card={makePickerCard()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Other/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /describe it/i }), {
      target: { value: "ein anderer Weg" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /describe it/i }), { key: "Enter" });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const text = sendSpy.mock.calls[0]![1];
    expect(text).toContain("other: ein anderer Weg");
  });

  it("ignores submit if there is no active session id", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({ session: null });
    render(<ToolCard card={makePickerCard()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Option A/i }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  describe("safe invalid-interaction recovery", () => {
    const raw = "RAW_PICKER_SCHEMA_SENTINEL";
    const invalidCards: ToolCardData[] = [
      {
        toolCallId: "call-error",
        toolName: "cbe_picker",
        args: makePickerCard().args,
        status: "error",
        errorMessage: raw,
      },
      { toolCallId: "call-missing", toolName: "cbe_picker", args: { question: "Q" }, status: "done" },
      {
        toolCallId: "call-few",
        toolName: "cbe_picker",
        args: { question: "Q", options: [{ id: "a", label: "A" }] },
        status: "done",
      },
      {
        toolCallId: "call-label",
        toolName: "cbe_picker",
        args: {
          question: "Q",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "" },
          ],
        },
        status: "done",
      },
      {
        toolCallId: "call-question",
        toolName: "cbe_picker",
        args: {
          question: "",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        status: "done",
      },
      {
        toolCallId: "call-overfull",
        toolName: "cbe_picker",
        args: {
          question: "Choose one",
          options: Array.from({ length: 8 }, (_, index) => ({ id: `o${index}`, label: `Option ${index}` })),
        },
        // `tool_execution_start` can reach the renderer before Pi reports the
        // maxItems schema error — the defensive guard must prevent a flash.
        status: "running",
      },
    ];

    it.each(invalidCards)("renders safe recovery without a broken Picker or raw defect ($toolCallId)", (card) => {
      const { container } = render(<ToolCard card={card} />);
      expect(container.querySelector(".picker")).toBeNull();
      expect(container.querySelector(".tool-card-head")).toBeNull();
      expect(container.querySelector(".tool-card-body")).toBeNull();
      expect(screen.getByText(/question is unavailable/i)).toBeTruthy();
      expect(container.textContent).not.toContain(raw);
      expect(container.textContent).not.toMatch(/options\[|schema|cbe_picker/i);
    });
  });
});
