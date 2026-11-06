/**
 * Maturity Panel tests — capability `desktop-app`, Requirement: Maturity Panel.
 * Test names mirror the spec scenarios. jsdom + @testing-library/react; the
 * preload bridge is stubbed in the shared test setup and overridden per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import {
  applyMaturityUpdate,
  newConversation,
  parseMaturityToolDetails,
  reduceConversation,
} from "../src/renderer/state/conversationReducer.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";
import { seedConversation, seedBackgroundConversation, testSession } from "./helpers/conversation.js";
import type { ConversationOpenResult } from "../src/shared/ipc-contract.js";

const READING: MaturitySnapshot = {
  "societal-challenge": { current: 2, target: 2 },
  "stakeholder-involvement": { current: 1, target: 2, hint: "Einen definierten Stakeholder-Feedbackmoment einplanen." },
  interdisciplinarity: { current: 1, uncertain: true },
  "student-agency": { current: "unassessed" },
  "iterative-process": { current: "unassessed" },
  "value-reflection": { current: "unassessed" },
  "societal-impact": { current: "unassessed" },
  // The `overall` record carries the elicited target and the limitation note
  // only — the achieved aggregate is derived from the criteria above (three
  // assessed: 2, 1, 1 → mean 1.3 → L1).
  overall: { target: 2, note: "Only 3 of 7 criteria assessed." },
};

function rowOf(container: HTMLElement, criterion: string): HTMLElement {
  return container.querySelector(`[data-criterion="${criterion}"]`) as HTMLElement;
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation({ maturity: structuredClone(READING) });
});
afterEach(() => {
  cleanup();
});

describe("Maturity Panel — raster rendering", () => {
  // Scenario: Raster shows current vs target per criterion
  it("Raster shows current vs target per criterion", () => {
    const { container } = render(<MaturityPanel />);
    // Assessed criterion: short-form level token + level visual.
    const stakeholder = rowOf(container, "stakeholder-involvement");
    expect(within(stakeholder).getByText("L1 — CBE light")).toBeTruthy();
    expect(stakeholder.querySelectorAll(".maturity-seg[data-lit='true']").length).toBe(1);
    // Target distinguished by more than colour: outline marker AND a text token.
    expect(stakeholder.querySelector(".maturity-seg[data-target='true']")).not.toBeNull();
    expect(within(stakeholder).getByText("target L2")).toBeTruthy();
    // Gap hint as plain text under the gapped criterion.
    expect(within(stakeholder).getByText("Einen definierten Stakeholder-Feedbackmoment einplanen.")).toBeTruthy();
    // Second assessed criterion at its target.
    const societal = rowOf(container, "societal-challenge");
    expect(within(societal).getByText("L2 — good practice")).toBeTruthy();
    // The aggregate lives in the header block above the raster, not in a row at
    // the bottom (change `show-target-and-derive-overall-maturity`).
    expect(container.querySelector(".maturity-overall")).toBeNull();
    const achieved = container.querySelector(".maturity-achieved") as HTMLElement;
    expect(within(achieved).getByText("Only 3 of 7 criteria assessed.")).toBeTruthy();
  });

  // Scenario: Unassessed is explicit and never defaulted
  it("Unassessed is explicit and never defaulted", () => {
    // student-agency carries an explicit "unassessed"; value-reflection gets NO
    // update at all (delete it from the seeded state).
    const maturity = structuredClone(READING);
    delete maturity["value-reflection"];
    seedConversation({ maturity });
    const { container } = render(<MaturityPanel />);
    for (const key of ["student-agency", "value-reflection"]) {
      const row = rowOf(container, key);
      expect(within(row).getByText("not yet assessed")).toBeTruthy();
      // No level indicator is lit — visually distinct from a Level-1 reading.
      expect(row.querySelectorAll(".maturity-seg[data-lit='true']").length).toBe(0);
      expect(within(row).queryByText(/L1 — CBE light/)).toBeNull();
    }
  });

  // Scenario: Current above target renders as target reached
  it("Current above target renders as target reached", () => {
    const maturity = structuredClone(READING);
    maturity["societal-challenge"] = { current: 3, target: 2 };
    seedConversation({ maturity });
    const { container } = render(<MaturityPanel />);
    const row = rowOf(container, "societal-challenge");
    expect(within(row).getByText("L3 — full-fledged")).toBeTruthy();
    expect(within(row).getByText("target exceeded")).toBeTruthy();
    // No gap hint, no negative gap, no error state.
    expect(row.querySelector(".maturity-hint")).toBeNull();
    // current === target renders "target reached".
    const reached = rowOf(container, "stakeholder-involvement");
    expect(within(reached).queryByText("target reached")).toBeNull(); // current 1 < target 2 → plain token
  });

  // Scenario: Uncertain readings carry an uncertainty badge
  it("Uncertain readings carry an uncertainty badge", () => {
    const { container } = render(<MaturityPanel />);
    const row = rowOf(container, "interdisciplinarity");
    expect(within(row).getByText("uncertain · weak evidence")).toBeTruthy();
    // A solidly evidenced reading carries no badge.
    expect(within(rowOf(container, "societal-challenge")).queryByText(/uncertain/)).toBeNull();
  });

  // Scenario: Hint text renders as plain text, not markup
  it("Hint text renders as plain text, not markup", () => {
    const maturity = structuredClone(READING);
    maturity["stakeholder-involvement"]!.hint = "[Open the full rubric](https://attacker.example)";
    maturity.overall!.note = "<a href='https://attacker.example'>note</a> **bold**";
    seedConversation({ maturity });
    const { container } = render(<MaturityPanel />);
    // The raw characters render as escaped plain text …
    expect(screen.getByText("[Open the full rubric](https://attacker.example)")).toBeTruthy();
    expect(screen.getByText("<a href='https://attacker.example'>note</a> **bold**")).toBeTruthy();
    // … and no link, element, or citation chip is created from hint/note content.
    expect(container.querySelector(".maturity-hint a")).toBeNull();
    expect(container.querySelector(".maturity-hint strong")).toBeNull();
    expect(container.querySelectorAll("a[href*='attacker.example']").length).toBe(0);
  });

  // Scenario: Panel is read-only for levels
  it("Panel is read-only for levels", () => {
    const { container } = render(<MaturityPanel />);
    // No form control sets or edits a level — no select, input, slider, spinner.
    expect(container.querySelector("select, input, [role='slider'], [role='spinbutton']")).toBeNull();
    // The interactive affordances are exactly the seven per-criterion Discuss
    // buttons plus the Assess control. Since change
    // `ground-maturity-assessment-in-substance` the Assess affordance is no
    // longer confined to the empty state: it is the named refresh path for a
    // stale reading, so the populated panel carries it too. Neither sets or
    // edits a level.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(8);
    const discuss = buttons.filter((b) => b.getAttribute("aria-label")?.startsWith("Discuss maturity: "));
    expect(discuss.length).toBe(7);
    expect(buttons.filter((b) => /assess maturity/i.test(b.textContent ?? "")).length).toBe(1);
  });

  // Scenario: Raster rows are accessible
  it("Raster rows are accessible", () => {
    const { container } = render(<MaturityPanel />);
    // Accessible row text: criterion, FULL verbatim framework term, target, uncertainty.
    const stakeholder = rowOf(container, "stakeholder-involvement");
    expect(stakeholder.getAttribute("aria-label")).toBe(
      'Stakeholder involvement, current Level 1 "CBE light / challenge-inspired", target L2'
    );
    const uncertain = rowOf(container, "interdisciplinarity");
    expect(uncertain.getAttribute("aria-label")).toContain("uncertain, weak evidence");
    const unassessed = rowOf(container, "student-agency");
    expect(unassessed.getAttribute("aria-label")).toContain("not yet assessed");
    // The full-term disclosure is a native <details> — keyboard-operable, not
    // hover-only — and carries the verbatim term plus the per-cell gloss.
    const disclosure = stakeholder.querySelector("details.maturity-disclosure") as HTMLDetailsElement;
    expect(disclosure).not.toBeNull();
    expect(disclosure.querySelector("summary")).not.toBeNull();
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(disclosure.textContent).toContain('Level 1 "CBE light / challenge-inspired"');
    expect(disclosure.textContent).toContain("Stakeholders appear as guest speakers or case providers.");
    // Non-colour-only target distinction: outline attribute + text token.
    expect(stakeholder.querySelector(".maturity-seg[data-target='true']")).not.toBeNull();
    expect(within(stakeholder).getByText("target L2")).toBeTruthy();
  });
});

describe("Maturity Panel — reducer / state semantics", () => {
  // Scenario: Reducer merges per-field and clears stale hint and uncertainty
  it("Reducer merges per-field and clears stale hint and uncertainty", () => {
    let state: MaturitySnapshot = {
      "stakeholder-involvement": { current: 1, target: 2, uncertain: true, hint: "Add a feedback moment." },
    };
    state = applyMaturityUpdate(state, {
      kind: "maturity-update",
      criterion: "stakeholder-involvement",
      current: 2,
    });
    expect(state["stakeholder-involvement"]).toEqual({ current: 2, target: 2 });
    state = applyMaturityUpdate(state, {
      kind: "maturity-update",
      criterion: "stakeholder-involvement",
      target: null,
    });
    expect(state["stakeholder-involvement"]).toEqual({ current: 2 });
  });

  // Scenario: Downward transitions render (no ratchet)
  it("Downward transitions render (no ratchet)", () => {
    seedConversation({ maturity: structuredClone(READING) });
    act(() =>
      useCbe.getState().applyMaturityUpdate({
        kind: "maturity-update",
        criterion: "societal-challenge",
        current: "unassessed",
        target: null,
      })
    );
    const { container } = render(<MaturityPanel />);
    const row = rowOf(container, "societal-challenge");
    expect(within(row).getByText("not yet assessed")).toBeTruthy();
    expect(row.querySelectorAll(".maturity-seg[data-lit='true']").length).toBe(0);
    expect(within(row).queryByText(/target/)).toBeNull();
  });

  it("consumes only validated maturity-update details from tool results", () => {
    expect(parseMaturityToolDetails({ details: { kind: "maturity-refusal" } }, false)).toBeNull();
    expect(
      parseMaturityToolDetails({ details: { kind: "maturity-update", criterion: "x", current: 1 } }, false)
    ).toBeNull();
    expect(
      parseMaturityToolDetails({ details: { kind: "maturity-update", criterion: "student-agency", current: 1 } }, true)
    ).toBeNull();
    expect(
      parseMaturityToolDetails({ details: { kind: "maturity-update", criterion: "student-agency", current: 1 } }, false)
    ).toMatchObject({ criterion: "student-agency", current: 1 });
  });

  // Scenario: Maturity state follows the visible conversation
  it("Maturity state follows the visible conversation", () => {
    const background = seedBackgroundConversation("bg-session", "other-course");
    // A background conversation receives a cbe_maturity update …
    const updated = reduceConversation(
      background,
      {
        type: "tool_execution_end",
        sessionId: "bg-session",
        data: {
          toolCallId: "t1",
          toolName: "cbe_maturity",
          result: { details: { kind: "maturity-update", criterion: "student-agency", current: 3 } },
          isError: false,
        },
      } as never,
      { visible: false, reasoningOn: false }
    );
    expect(updated.maturity["student-agency"]).toEqual({ current: 3 });
    // … while the visible conversation's state is untouched (pure per-slice reducer).
    expect(useCbe.getState().maturity["student-agency"]).toEqual({ current: "unassessed" });
    // Routing through the store demux mutates only the owning slice.
    act(() =>
      useCbe.getState().ingestAgentEvent({
        type: "tool_execution_end",
        sessionId: "bg-session",
        data: {
          toolCallId: "t2",
          toolName: "cbe_maturity",
          result: { details: { kind: "maturity-update", criterion: "societal-impact", current: 2 } },
          isError: false,
        },
      } as never)
    );
    expect(useCbe.getState().maturity["societal-impact"]).toEqual({ current: "unassessed" });
    expect(useCbe.getState().conversations["bg-session"]!.maturity["societal-impact"]).toEqual({ current: 2 });
    // Switching to the background conversation shows its updated reading.
    act(() => useCbe.getState().setActiveCourse("other-course"));
    expect(useCbe.getState().maturity["societal-impact"]).toEqual({ current: 2 });
  });
});

describe("Maturity Panel — empty state, dispatches, run lock", () => {
  function hydrationResult(
    maturity: MaturitySnapshot,
    turns: ConversationOpenResult["turns"] = []
  ): ConversationOpenResult {
    return {
      session: testSession("hydrated-session", "hydrated-course"),
      turns,
      agentRunning: false,
      canvas: [],
      maturity,
    };
  }

  // Scenario: Empty state offers the assess handoff
  it("Empty state offers the assess handoff", async () => {
    seedConversation({ maturity: {} });
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<MaturityPanel />);
    // Explanatory English empty state instead of an all-unassessed raster.
    expect(screen.getByText(/established early on from your material/i)).toBeTruthy();
    expect(document.querySelector("[data-criterion]")).toBeNull();
    const assess = screen.getByRole("button", { name: /assess maturity/i });
    await act(async () => {
      fireEvent.click(assess);
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, payload, display] = sendSpy.mock.calls[0]!;
    // The payload now carries the HOST's substance/staleness state appended to
    // the machine token (change `ground-maturity-assessment-in-substance`); the
    // display projection is unchanged, so the annotation never renders.
    expect(payload).toMatch(/^\[maturity assess · substance (thin|sufficient) · /);
    expect(display).toEqual({ text: "Assess the design's maturity" });
    const lastUser = useCbe
      .getState()
      .turns.filter((t) => t.role === "user")
      .at(-1) as { text: string };
    expect(lastUser.text).toBe("Assess the design's maturity");
    sendSpy.mockRestore();
  });

  // Scenario: The empty state scopes the absent reading to the course
  it("The empty state scopes the absent reading to the course", () => {
    seedConversation({ maturity: {} });
    const { container } = render(<MaturityPanel />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    // The absent reading is scoped to the COURSE …
    expect(text).toMatch(/nothing has been assessed for this course yet/i);
    // … and the copy says the reading stays with the course across a new session.
    expect(text).toMatch(/belongs to this course/i);
    expect(text).toMatch(/stays with the course when you start a new session/i);
    // No string in the empty state frames the reading as belonging to the
    // conversation, or as something a new session starts over.
    expect(text).not.toMatch(/in this conversation/i);
    expect(text).not.toMatch(/in this session|in the session/i);
    expect(text).not.toMatch(/starts over|start over|is cleared|are cleared/i);
  });

  it("the Assess affordance is a disabled no-op while a run is in flight", async () => {
    seedConversation({ maturity: {}, dispatchPending: true });
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<MaturityPanel />);
    const assess = screen.getByRole("button", { name: /assess maturity/i }) as HTMLButtonElement;
    expect(assess.disabled).toBe(true);
    expect(assess.title).toMatch(/still working/i);
    await act(async () => {
      fireEvent.click(assess);
    });
    expect(sendSpy).not.toHaveBeenCalled(); // nothing queued, no phantom turn
    expect(useCbe.getState().turns.filter((t) => t.role === "user").length).toBe(0);
    sendSpy.mockRestore();
  });

  // Scenario: Discuss dispatch splits display from payload and respects the run lock
  it("Discuss dispatch splits display from payload and respects the run lock", async () => {
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const { container, rerender } = render(<MaturityPanel />);
    const row = rowOf(container, "stakeholder-involvement");
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Discuss maturity: Stakeholder involvement" }));
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, payload, display] = sendSpy.mock.calls[0]!;
    // Payload token carries key AND label; the display projection travels along.
    expect(payload).toBe('[maturity discuss · criterion stakeholder-involvement ("Stakeholder involvement")]');
    expect(display).toEqual({ text: "Discuss maturity: Stakeholder involvement" });
    // The visible user turn renders the human projection, never the raw token.
    const lastUser = useCbe
      .getState()
      .turns.filter((t) => t.role === "user")
      .at(-1) as { text: string };
    expect(lastUser.text).toBe("Discuss maturity: Stakeholder involvement");
    expect(lastUser.text).not.toContain("[maturity discuss");
    // Run lock: while a run is in flight the affordance is disabled and a no-op.
    act(() => useCbe.getState().setDispatchPending(true));
    rerender(<MaturityPanel />);
    const locked = within(rowOf(container, "stakeholder-involvement")).getByRole("button", {
      name: "Discuss maturity: Stakeholder involvement",
    }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(locked.title).toMatch(/still working/i);
    await act(async () => {
      fireEvent.click(locked);
    });
    expect(sendSpy).toHaveBeenCalledTimes(1); // unchanged — nothing queued
    sendSpy.mockRestore();
  });

  it("the persisted display projection keeps the raw token out of rehydrated turns", () => {
    // After reload/resume the stored turn carries the payload token in `text`
    // and the human rendering in `display` — the renderer shows the projection.
    act(() =>
      useCbe.getState().hydrateConversation(
        hydrationResult(structuredClone(READING), [
          {
            role: "user",
            text: '[maturity discuss · criterion stakeholder-involvement ("Stakeholder involvement")]',
            display: { text: "Discuss maturity: Stakeholder involvement" },
          },
        ])
      )
    );
    act(() => useCbe.getState().setActiveCourse("hydrated-course"));
    const turn = useCbe.getState().turns[0] as { role: string; text: string };
    expect(turn.text).toBe("Discuss maturity: Stakeholder involvement");
    expect(turn.text).not.toContain("[maturity discuss");
  });

  // Scenario: Reload and resume repopulate from the course's reading
  it("Reload and resume repopulate from the course's reading; an empty snapshot renders the empty state", () => {
    // Hydration from the host-side mirror snapshot repopulates the panel …
    act(() => {
      useCbe.getState().hydrateConversation(hydrationResult(structuredClone(READING)));
      useCbe.getState().setActiveCourse("hydrated-course");
    });
    const { container, unmount } = render(<MaturityPanel />);
    expect(within(rowOf(container, "societal-challenge")).getByText("L2 — good practice")).toBeTruthy();
    unmount();
    // … while a hydration snapshot carrying NO reading renders the empty state.
    // That is the course-without-a-recorded-reading case, not a New Session:
    // a New Session in a course that HAS one keeps it (see the test below).
    act(() => {
      useCbe.getState().hydrateConversation({
        ...hydrationResult({}),
        session: testSession("fresh-session", "hydrated-course"),
      });
    });
    render(<MaturityPanel />);
    expect(screen.getByRole("button", { name: /assess maturity/i })).toBeTruthy();
    expect(document.querySelector("[data-criterion]")).toBeNull();
  });

  // Scenario: A New Session keeps the course's reading
  it("A New Session keeps the course's reading", () => {
    // The course has an established reading on its current conversation …
    act(() => {
      useCbe.getState().hydrateConversation(hydrationResult(structuredClone(READING)));
      useCbe.getState().setActiveCourse("hydrated-course");
    });

    // … and each New Session hydrates a FRESH session id for the SAME course
    // carrying that reading, because the host snapshots the outgoing mirror
    // before the close and seeds the fresh one (capability `agent-harness`,
    // Requirement: Host-Side Session Maturity Mirror, course-backed).
    const reset = (sessionId: string) => {
      act(() => {
        useCbe.getState().hydrateConversation({
          ...hydrationResult(structuredClone(READING)),
          session: testSession(sessionId, "hydrated-course"),
        });
      });
    };

    // Two consecutive resets: the second must carry the reading again.
    for (const sessionId of ["after-first-reset", "after-second-reset"]) {
      cleanup();
      reset(sessionId);
      const { container } = render(<MaturityPanel />);
      // Not the empty state.
      expect(container.querySelector(".maturity-empty")).toBeNull();
      // Levels and targets survive …
      const stakeholder = rowOf(container, "stakeholder-involvement");
      expect(within(stakeholder).getByText("L1 — CBE light")).toBeTruthy();
      expect(within(stakeholder).getByText("target L2")).toBeTruthy();
      // … the gap hint survives …
      expect(within(stakeholder).getByText("Einen definierten Stakeholder-Feedbackmoment einplanen.")).toBeTruthy();
      // … the uncertainty marker survives …
      expect(within(rowOf(container, "interdisciplinarity")).getByText("uncertain · weak evidence")).toBeTruthy();
      // … an unassessed criterion stays unassessed (absence is never a level) …
      expect(within(rowOf(container, "student-agency")).getByText("not yet assessed")).toBeTruthy();
      // … the declared target and the host-derived aggregate are both there.
      const achieved = container.querySelector(".maturity-achieved") as HTMLElement;
      expect(within(achieved).getByText("Only 3 of 7 criteria assessed.")).toBeTruthy();
      expect(useCbe.getState().maturity.overall).toEqual({ target: 2, note: "Only 3 of 7 criteria assessed." });
    }
  });
});
