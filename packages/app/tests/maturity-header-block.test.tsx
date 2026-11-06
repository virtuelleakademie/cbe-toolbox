/**
 * The Maturity Panel's header block — capability `desktop-app`, Requirement:
 * Maturity Panel, the scenarios added by change
 * `show-target-and-derive-overall-maturity`. Test names mirror the scenarios.
 *
 * What is under test: the declared target and the HOST-DERIVED overall achieved
 * reading render as two distinct elements ABOVE the seven criterion rows, no
 * aggregate row is left at the bottom, and the no-assessed-criterion state shows
 * the recorded limitation note WITHOUT any indicator a reader could take for a
 * reading.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { applyMaturityUpdate, reduceConversation } from "../src/renderer/state/conversationReducer.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";
import { seedConversation, testSession } from "./helpers/conversation.js";
import type { ConversationOpenResult } from "../src/shared/ipc-contract.js";

/** Four assessed criteria (2, 1, 2, 3 → mean 2.0 → L2) plus three unassessed. */
const FOUR_ASSESSED: MaturitySnapshot = {
  "societal-challenge": { current: 2, target: 2 },
  "stakeholder-involvement": { current: 1, target: 2 },
  interdisciplinarity: { current: 2 },
  "student-agency": { current: 3, target: 2 },
  "iterative-process": { current: "unassessed" },
  "value-reflection": { current: "unassessed" },
  "societal-impact": { current: "unassessed" },
  overall: { target: 2 },
};

const header = (c: HTMLElement) => c.querySelector(".maturity-header") as HTMLElement;
const ambition = (c: HTMLElement) => c.querySelector(".maturity-ambition") as HTMLElement;
const achieved = (c: HTMLElement) => c.querySelector(".maturity-achieved") as HTMLElement;

beforeEach(() => {
  useCbe.getState().reset();
});
afterEach(() => cleanup());

describe("Maturity Panel — the header block", () => {
  // Scenario: Target and achieved reading render together in a header block above the raster
  it("Target and achieved reading render together in a header block above the raster", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    const { container } = render(<MaturityPanel />);

    const block = header(container);
    expect(block).not.toBeNull();
    // One block carrying BOTH entities…
    expect(within(block).getByText("Target maturity")).toBeTruthy();
    expect(within(block).getByText(/Overall achieved/)).toBeTruthy();
    // …ABOVE the seven criterion rows, which follow below it unchanged…
    const rows = container.querySelectorAll("[data-criterion]");
    expect(rows.length).toBe(7);
    expect(block.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and NO aggregate row remains at the bottom of the panel.
    expect(container.querySelector(".maturity-overall")).toBeNull();
    const last = container.querySelector(".maturity-panel")!.lastElementChild!;
    expect(last.className).toContain("maturity-refresh");
  });

  // Scenario: The two header elements stay distinct
  it("The two header elements stay distinct", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    const { container } = render(<MaturityPanel />);

    // Two separately labelled elements, not one current-and-target row.
    const target = ambition(container);
    const reading = achieved(container);
    expect(target).not.toBe(reading);
    expect(target.getAttribute("aria-label")).toMatch(/declared target maturity/i);
    expect(reading.getAttribute("aria-label")).toMatch(/derived overall achieved reading/i);
    // The target element carries no achieved reading and the achieved element no
    // target of its own — that merge is exactly what the block replaced.
    expect(within(target).queryByText(/derived from/i)).toBeNull();
    expect(within(reading).queryByText(/^target/i)).toBeNull();
    expect(reading.querySelector(".maturity-target")).toBeNull();
    // Neither is rendered or styled as an eighth criterion row.
    for (const el of [target, reading]) {
      expect(el.getAttribute("data-criterion")).toBeNull();
      expect(el.className).not.toContain("maturity-row");
    }
    // The per-criterion targets keep rendering on their rows.
    const row = container.querySelector('[data-criterion="stakeholder-involvement"]') as HTMLElement;
    expect(within(row).getByText("target L2")).toBeTruthy();
  });

  // Scenario: An unsettled ambition is stated, not left blank
  it("An unsettled ambition is stated, not left blank", () => {
    const maturity = structuredClone(FOUR_ASSESSED);
    delete maturity.overall;
    seedConversation({ maturity });
    const { container } = render(<MaturityPanel />);

    const target = ambition(container);
    // Stated in the session-start prior's own wording — one state, one phrasing.
    expect(within(target).getByText(en.maturityTargetUnsettled)).toBeTruthy();
    // …which is the prior's own clause (`TARGET_DEMAND`, environment.ts), not a
    // second phrasing invented for the panel.
    expect(en.maturityTargetUnsettled.toLowerCase()).toContain(
      "the design's overall ambition still has to be settled with the lecturer"
    );
    // …and not as an empty slot, a dash, or a defaulted level.
    expect(target.textContent).not.toMatch(/—|--|L1|L2|L3/);
    expect(target.getAttribute("aria-label")).toContain(en.maturityTargetUnsettled);
  });

  // Scenario: The achieved element names what the aggregate rests on
  it("The achieved element names what the aggregate rests on", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    const { container } = render(<MaturityPanel />);

    const reading = achieved(container);
    // Labelled as derived, with the banded level…
    expect(within(reading).getByText(/Overall achieved · derived/)).toBeTruthy();
    expect(within(reading).getByText("L2 — good practice")).toBeTruthy();
    // …the contributing count and the unrounded mean beside it, so an aggregate
    // over four criteria is distinguishable from one over seven.
    expect(reading.textContent).toContain("derived from 4 of 7 assessed criteria");
    expect(reading.textContent).toContain("mean 2.0");
    // No cap applied, so none is named.
    expect(reading.textContent).not.toMatch(/capped/i);
  });

  // Scenario: A capped aggregate names the criterion that capped it
  it("A capped aggregate names the criterion that capped it", () => {
    const maturity: MaturitySnapshot = {
      "societal-challenge": { current: 3 },
      "stakeholder-involvement": { current: 3 },
      interdisciplinarity: { current: 3 },
      "student-agency": { current: 1, capped: true },
      "iterative-process": { current: 3 },
      "value-reflection": { current: 3, uncertain: true },
      "societal-impact": { current: 3 },
      overall: { target: 3 },
    };
    seedConversation({ maturity });
    const { container } = render(<MaturityPanel />);

    // Mean 2.71 would band to L3; the standing finding holds it at L1…
    const reading = achieved(container);
    expect(within(reading).getByText("L1 — CBE light")).toBeTruthy();
    expect(reading.textContent).toContain("mean 2.7");
    // …and the element names the criterion that applied the cap.
    expect(reading.textContent).toContain("Student agency & role of the teacher");
    expect(reading.textContent).toMatch(/capped at L1/i);

    // That criterion's row carries the reservation badge…
    const capped = container.querySelector('[data-criterion="student-agency"]') as HTMLElement;
    const badge = capped.querySelector('[data-marker="reservation"]') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/open finding/i);
    expect(capped.getAttribute("aria-label")).toContain("open finding caps this criterion");
    // …which is distinct from the uncertainty badge in wording and in styling,
    // and neither criterion carries the other's marker.
    const uncertain = container.querySelector('[data-criterion="value-reflection"]') as HTMLElement;
    expect(within(uncertain).getByText("uncertain · weak evidence")).toBeTruthy();
    expect(uncertain.querySelector('[data-marker="reservation"]')).toBeNull();
    expect(badge.textContent).not.toMatch(/uncertain/i);
    expect(badge.className).toContain("maturity-reservation");
    expect(within(capped).queryByText("uncertain · weak evidence")).toBeNull();
  });

  // Scenario: No assessed criterion renders no achieved aggregate
  it("No assessed criterion renders no achieved aggregate", () => {
    // A target on record and nothing assessed — the expected condition before
    // the coherence gate.
    seedConversation({ maturity: { overall: { target: 2 } } });
    const { container } = render(<MaturityPanel />);

    // This is NOT the panel's empty state: the ambition renders…
    expect(container.querySelector(".maturity-empty")).toBeNull();
    expect(screen.queryByText(/nothing has been assessed for this course yet/i)).toBeNull();
    expect(within(ambition(container)).getByText("L2 — good practice")).toBeTruthy();
    // …the panel states the achieved reading is not yet due…
    const reading = achieved(container);
    expect(reading.textContent).toMatch(/not yet due/i);
    // …and NO achieved level is rendered anywhere: no L1, no zero, no lit or
    // empty segment indicator, no dash, no placeholder.
    expect(reading.querySelector(".maturity-segments")).toBeNull();
    expect(reading.querySelector(".maturity-level")).toBeNull();
    expect(reading.textContent).not.toMatch(/L1|L2|L3|Level|—|--|\b0\b/);
    // …and no all-unassessed raster is drawn in place of it.
    expect(container.querySelectorAll("[data-criterion]").length).toBe(0);
  });

  // Scenario: A recorded limitation note renders while no achieved aggregate exists
  it("A recorded limitation note renders while no achieved aggregate exists", () => {
    const note = "Nur eine Vorstudie liegt vor; die Lesung folgt nach dem Kohärenz-Check.";
    seedConversation({ maturity: { overall: { target: 2, note } } });
    const { container } = render(<MaturityPanel />);

    const reading = achieved(container);
    // The ambition renders, the not-yet-due statement renders, and the note
    // renders beside it as an escaped plain-text node subordinate to it.
    expect(within(ambition(container)).getByText("L2 — good practice")).toBeTruthy();
    expect(reading.textContent).toMatch(/not yet due/i);
    const rendered = within(reading).getByText(note);
    expect(rendered.className).toContain("maturity-note");
    expect(rendered.querySelector("a")).toBeNull();
    // The note is NOT accompanied by anything readable as a reading…
    expect(reading.querySelector(".maturity-level")).toBeNull();
    expect(reading.querySelector(".maturity-segments")).toBeNull();
    expect(reading.querySelector(".maturity-seg")).toBeNull();
    expect(reading.textContent).not.toMatch(/L1|L2|L3|Level|—|--|\b0\b/);
    // …and the not-yet-due statement precedes it, so the note reads as the
    // limitation on an aggregate that does not exist yet, not as a verdict.
    expect(reading.textContent!.indexOf("not yet due")).toBeLessThan(reading.textContent!.indexOf(note));
  });

  // Scenario: A stray overall current level is dropped by the reducer
  it("A stray overall current level is dropped by the reducer", () => {
    // Directly through the reducer …
    const dropped = applyMaturityUpdate({ "societal-challenge": { current: 1 } }, {
      kind: "maturity-update",
      criterion: "overall",
      current: 3,
      target: 3,
    } as never);
    expect(dropped.overall).toEqual({ target: 3 });
    // … and through the event path a tool result travels.
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    act(() =>
      useCbe.getState().ingestAgentEvent({
        type: "tool_execution_end",
        sessionId: "test-session",
        data: {
          toolCallId: "t1",
          toolName: "cbe_maturity",
          result: { details: { kind: "maturity-update", criterion: "overall", current: 3, target: 2 } },
          isError: false,
        },
      } as never)
    );
    expect(useCbe.getState().maturity.overall).toEqual({ target: 2 });
    // The rendered aggregate stays the host-derived one — never the pushed L3.
    const { container } = render(<MaturityPanel />);
    expect(within(achieved(container)).getByText("L2 — good practice")).toBeTruthy();
    expect(achieved(container).textContent).toContain("derived from 4 of 7");
  });

  it("a stray overall current level from a hydration payload is dropped too", () => {
    const hydrated: ConversationOpenResult = {
      session: testSession("hydrated-session", "hydrated-course"),
      turns: [],
      agentRunning: false,
      canvas: [],
      maturity: {
        ...structuredClone(FOUR_ASSESSED),
        overall: { current: 3, target: 2 },
      } as MaturitySnapshot,
    };
    act(() => {
      useCbe.getState().hydrateConversation(hydrated);
      useCbe.getState().setActiveCourse("hydrated-course");
    });
    expect(useCbe.getState().maturity.overall).toEqual({ target: 2 });
    const { container } = render(<MaturityPanel />);
    expect(within(achieved(container)).getByText("L2 — good practice")).toBeTruthy();
  });

  it("the aggregate follows a downward transition (no ratchet, nothing cached)", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    act(() =>
      useCbe.getState().applyMaturityUpdate({
        kind: "maturity-update",
        criterion: "student-agency",
        current: 1,
      })
    );
    // 2, 1, 2, 1 → mean 1.5 → L1 (half down). Nothing was stored to go stale.
    const { container } = render(<MaturityPanel />);
    expect(within(achieved(container)).getByText("L1 — CBE light")).toBeTruthy();
    expect(achieved(container).textContent).toContain("mean 1.5");
  });

  // Scenario: Both header elements are accessible and distinguishable
  it("Both header elements are accessible and distinguishable", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    const { container, unmount } = render(<MaturityPanel />);

    // The target element names itself and gives the level, verbatim framework term.
    expect(ambition(container).getAttribute("aria-label")).toBe(
      'Declared target maturity: Level 2 "CBE good practice / challenge-oriented"'
    );
    // The achieved element names itself as derived, with count and mean.
    const label = achieved(container).getAttribute("aria-label")!;
    expect(label).toMatch(/^Derived overall achieved reading: Level 2 "CBE good practice \/ challenge-oriented"/);
    expect(label).toContain("derived from 4 of 7 assessed criteria");
    expect(label).toContain("mean 2.0");
    // Neither is announced as a criterion row.
    for (const el of [ambition(container), achieved(container)]) {
      expect(el.getAttribute("aria-label")).not.toMatch(/not yet assessed|target reached/);
      expect(el.getAttribute("data-criterion")).toBeNull();
    }
    unmount();

    // With nothing assessed, the accessible text carries the not-yet-due
    // statement and the recorded note, announces NO achieved level, and the
    // absent reading is not an empty or unlabelled element.
    const note = "Assessed on a partial draft.";
    seedConversation({ maturity: { overall: { target: 2, note } } });
    const second = render(<MaturityPanel />);
    const emptyLabel = achieved(second.container).getAttribute("aria-label")!;
    expect(emptyLabel).toMatch(/^Overall achieved reading: /);
    expect(emptyLabel).toMatch(/not yet due/i);
    expect(emptyLabel).toContain(note);
    expect(emptyLabel).not.toMatch(/Level [123]|L1|L2|L3/);
    expect(emptyLabel.trim().length).toBeGreaterThan(0);
  });

  it("a background conversation's aggregate is derived from its own raster", () => {
    seedConversation({ maturity: structuredClone(FOUR_ASSESSED) });
    const background = reduceConversation(
      { ...useCbe.getState().conversations["test-session"]!, maturity: {} },
      {
        type: "tool_execution_end",
        sessionId: "test-session",
        data: {
          toolCallId: "t1",
          toolName: "cbe_maturity",
          result: { details: { kind: "maturity-update", criterion: "societal-impact", current: 3 } },
          isError: false,
        },
      } as never,
      { visible: false, reasoningOn: false }
    );
    expect(background.maturity["societal-impact"]).toEqual({ current: 3 });
    // The visible conversation's own reading is unchanged.
    const { container } = render(<MaturityPanel />);
    expect(within(achieved(container)).getByText("L2 — good practice")).toBeTruthy();
  });
});
