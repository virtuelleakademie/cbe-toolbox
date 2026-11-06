/**
 * Tests for the Decision Checklist generative-UI component + its ToolCard swap.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement *Generative UI — Decision
 * Checklist (dual presentation)*:
 *  - Skill chooses checklist presentation for discrete decisions
 *  - Skill chooses progress-bar presentation for sequential phases
 *  - Lecturer marks an item, state propagates back
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DecisionChecklist, type DecisionChecklistSpec } from "../src/renderer/components/DecisionChecklist.js";
import { ToolCard, type ToolCardData } from "../src/renderer/components/ToolCard.js";
import { useCbe } from "../src/renderer/state/store.js";

function seedSession() {
  useCbe.setState({
    session: {
      sessionId: "sess-1",
      mode: "design",
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/ws", corpus: "/c" },
    },
  });
}

const checklistSpec: DecisionChecklistSpec = {
  title: "Offene Entscheidungen",
  presentation: "checklist",
  items: [
    { id: "i1", label: "Big Idea festziehen" },
    { id: "i2", label: "Essential Question lernerseitig" },
    { id: "i3", label: "Assessment skizzieren" },
    { id: "i4", label: "Audience bestätigen" },
  ],
};

const progressSpec: DecisionChecklistSpec = {
  presentation: "progress-bar",
  items: [
    { id: "p1", label: "Engage", done: true },
    { id: "p2", label: "Investigate" },
    { id: "p3", label: "Act" },
    { id: "p4", label: "Reflect" },
  ],
};

beforeEach(() => seedSession());
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("checklist presentation", () => {
  it("renders one checkbox per item with marked/unmarked visually distinct", () => {
    render(<DecisionChecklist spec={checklistSpec} onSubmit={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    // all start unchecked
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    // mark the second
    fireEvent.click(boxes[1]!);
    expect(screen.getAllByRole("checkbox")[1]!.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("checkbox")[1]!.className).toContain("dc-checkbox-done");
  });
});

describe("progress-bar presentation", () => {
  it("renders clickable phase markers with the current phase highlighted", () => {
    const { container } = render(<DecisionChecklist spec={progressSpec} onSubmit={() => {}} />);
    const markers = container.querySelectorAll(".dc-marker");
    expect(markers).toHaveLength(4);
    // p1 is done; the current (first not-done) is p2.
    expect(container.querySelector(".dc-marker-done")).toBeTruthy();
    const current = container.querySelector(".dc-marker-current");
    expect(current).toBeTruthy();
    expect(within(current as HTMLElement).getByText("Investigate")).toBeTruthy();
  });
});

describe("marking an item propagates state back", () => {
  it("commit calls onSubmit with the done item ids", () => {
    const onSubmit = vi.fn();
    render(<DecisionChecklist spec={checklistSpec} onSubmit={onSubmit} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // mark i2
    fireEvent.click(screen.getByRole("button", { name: en.checklistSubmitLabel }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toEqual(["i2"]);
  });

  it("freezes into ANSWERED after commit", () => {
    render(<DecisionChecklist spec={checklistSpec} onSubmit={() => {}} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: en.checklistSubmitLabel }));
    expect(screen.getByLabelText("answered")).toBeTruthy();
    // further toggles are no-ops (no submit button anymore)
    expect(screen.queryByRole("button", { name: en.checklistSubmitLabel })).toBeNull();
  });
});

describe("ToolCard — cbe_decision_checklist swap", () => {
  function makeCard(overrides: Partial<ToolCardData> = {}): ToolCardData {
    return {
      toolCallId: "call-7",
      toolName: "cbe_decision_checklist",
      args: checklistSpec,
      status: "done",
      ...overrides,
    };
  }

  it("renders the DecisionChecklist instead of the standard tool card", () => {
    const { container } = render(<ToolCard card={makeCard()} />);
    expect(container.querySelector(".tool-card-checklist")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("commit dispatches a structured user turn carrying done/open state", () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ToolCard card={makeCard()} />);
    fireEvent.click(screen.getAllByRole("checkbox")[2]!); // mark i3
    fireEvent.click(screen.getByRole("button", { name: en.checklistSubmitLabel }));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [sessionId, text] = sendSpy.mock.calls[0]!;
    expect(sessionId).toBe("sess-1");
    expect(text).toContain("[checklist update · tool call call-7]");
    expect(text).toContain('done: i3 ("Assessment skizzieren")');
    expect(text).toContain('open: i1 ("Big Idea festziehen")');
  });

  it("shows safe recovery when the spec is malformed", () => {
    const { container } = render(
      <ToolCard card={makeCard({ args: { presentation: "checklist", items: [{ id: "", label: "x" }] } })} />
    );
    expect(container.querySelector(".tool-card-checklist-error")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText(/question is unavailable/i)).toBeTruthy();
    expect(container.textContent).not.toContain("items[0]");
  });

  it("shows safe recovery without raw errors when the tool call errored", () => {
    const { container } = render(
      <ToolCard card={makeCard({ status: "error", errorMessage: "RAW_CHECKLIST_ERROR" })} />
    );
    expect(container.querySelector(".tool-card-checklist-error")).toBeTruthy();
    expect(screen.getByText(/question is unavailable/i)).toBeTruthy();
    expect(container.textContent).not.toContain("RAW_CHECKLIST_ERROR");
  });
});
