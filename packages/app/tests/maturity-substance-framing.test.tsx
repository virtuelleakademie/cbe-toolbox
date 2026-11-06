/**
 * Maturity Panel substance / provenance / staleness framing.
 *
 * Change `ground-maturity-assessment-in-substance`; capability `desktop-app`,
 * Requirement: Maturity Panel Substance and Staleness Framing. Test names mirror
 * the spec scenarios.
 *
 * The load-bearing one is the first: the product decision is that the Assess
 * control STAYS ("der Button muss bleiben"). The threshold is honest framing, not
 * a gate — a control that greys out for a reason the lecturer cannot interpret is
 * the defect this requirement replaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { emptyMaturityState, reduceConversation } from "../src/renderer/state/conversationReducer.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";
import type { MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import { seedConversation, seedBackgroundConversation, testSession } from "./helpers/conversation.js";

const READING: MaturitySnapshot = {
  "societal-challenge": { current: 2, target: 3 },
  "stakeholder-involvement": { current: 1, target: 2 },
  interdisciplinarity: { current: "unassessed" },
  "student-agency": { current: "unassessed" },
  "iterative-process": { current: "unassessed" },
  "value-reflection": { current: "unassessed" },
  "societal-impact": { current: "unassessed" },
};

const THIN: MaturityDerivedState = {
  substance: "thin",
  evidence: { ingestedDocuments: 0, artefacts: 1, stepGroups: 1 },
  reading: { kind: "stamped", recordedUnderSubstance: "thin", recordedAtRevision: 1 },
};

const SUFFICIENT: MaturityDerivedState = {
  substance: "sufficient",
  evidence: { ingestedDocuments: 2, artefacts: 5, stepGroups: 3 },
  reading: { kind: "stamped", recordedUnderSubstance: "sufficient", recordedAtRevision: 4 },
};

const STALE: MaturityDerivedState = {
  ...SUFFICIENT,
  stale: {
    recordedAtRevision: 4,
    currentRevision: 7,
    // Structured, not pre-formatted: the panel words them in the active interface
    // language (see `stale-change-language.test.tsx` for both directions).
    changes: [
      { kind: "ingestion", revision: 5, label: "syllabus.pdf" },
      { kind: "canvas-set", revision: 7, id: "challenge", step: 4, label: "Challenge" },
    ],
    omitted: 0,
  },
};

const UNKNOWN: MaturityDerivedState = {
  substance: "sufficient",
  evidence: { ingestedDocuments: 1, artefacts: 4, stepGroups: 2 },
  reading: { kind: "unknown" },
};

function assessButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /assess maturity/i }) as HTMLButtonElement;
}

beforeEach(() => {
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
});

describe("Maturity Panel Substance and Staleness Framing", () => {
  // Scenario: The Assess control stays operable in every substance state
  it("keeps the Assess control operable in every substance state", async () => {
    for (const state of [THIN, SUFFICIENT]) {
      useCbe.getState().reset();
      seedConversation({ maturity: structuredClone(READING), maturityState: state });
      const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
      render(<MaturityPanel />);
      const assess = assessButton();
      // Substance NEVER enters the disabled condition — the only lock is the run
      // lock, and none is in flight here.
      expect(assess.disabled).toBe(false);
      expect(screen.queryByText(/no conversation is open/i)).toBeNull();
      await act(async () => {
        fireEvent.click(assess);
      });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      sendSpy.mockRestore();
      cleanup();
    }

    // The run lock still disables it, and still states that reason.
    useCbe.getState().reset();
    seedConversation({ maturity: structuredClone(READING), maturityState: THIN, dispatchPending: true });
    render(<MaturityPanel />);
    const locked = assessButton();
    expect(locked.disabled).toBe(true);
    expect(locked.title).toMatch(/still working/i);

    // And so does the no-session case, with its own distinguishable reason.
    cleanup();
    useCbe.getState().reset();
    useCbe.setState({ session: null, maturity: {}, maturityState: THIN });
    render(<MaturityPanel />);
    expect(assessButton().disabled).toBe(true);
    expect(screen.getByText(/no conversation is open/i)).toBeTruthy();
  });

  // Scenario: Thin substance names the concrete gap and the path to a fuller reading
  it("names the concrete gap and the path to a fuller reading under thin substance", () => {
    seedConversation({ maturity: {}, maturityState: THIN });
    const { container } = render(<MaturityPanel />);
    const note = container.querySelector(".maturity-provenance[data-substance='thin']") as HTMLElement;
    expect(note).toBeTruthy();
    // The host's own counts, not a generic "not enough data".
    expect(note.textContent).toMatch(/no material ingested yet/i);
    expect(note.textContent).toMatch(/1 design artefact\(s\) recorded/i);
    expect(note.textContent).toMatch(/1 design step\(s\) touched/i);
    expect(note.textContent).toMatch(/gives a fuller reading/i);
    expect(note.textContent).not.toMatch(/not enough data/i);
    // Attached to a still-operable control, never a blocking message.
    expect(assessButton().disabled).toBe(false);
  });

  // Scenario: Thin substance is named beside a recorded reading too
  it("names thin substance beside a recorded reading too", () => {
    // The reachable state: three artefacts in one step group produced a reading
    // stamped `sufficient`, two canvas clears took the base back to thin. Delta 2
    // and no categorical change, so the reading is NOT stale — without the note
    // the panel would say nothing at all about the evidence base.
    seedConversation({
      maturity: structuredClone(READING),
      maturityState: {
        substance: "thin",
        evidence: { ingestedDocuments: 0, artefacts: 1, stepGroups: 1 },
        reading: { kind: "stamped", recordedUnderSubstance: "sufficient", recordedAtRevision: 3 },
      },
    });
    const { container } = render(<MaturityPanel />);
    const note = container.querySelector(".maturity-provenance[data-substance='thin']") as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.textContent).toMatch(/no material ingested yet/i);
    expect(note.textContent).toMatch(/1 design artefact\(s\) recorded/i);
    expect(note.textContent).toMatch(/gives a fuller reading/i);
    // The duty follows the CURRENT signal, not the stamp: the reading itself was
    // recorded on a fuller base, so it is not marked provisional.
    expect(container.querySelector("[data-provenance='provisional']")).toBeNull();
    expect(container.querySelector("[data-provenance='stale']")).toBeNull();
    // Framing beside a live control, and the levels stay rendered.
    expect(assessButton().disabled).toBe(false);
    expect(container.querySelectorAll("[data-criterion]").length).toBe(7);
  });

  // Scenario: A reading recorded under thin substance is marked provisional
  it("marks a reading recorded under thin substance as provisional", () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: THIN });
    const { container } = render(<MaturityPanel />);
    const mark = container.querySelector(".maturity-provenance[data-provenance='provisional']") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.textContent).toMatch(/provisional/i);
    expect(mark.textContent).toMatch(/thin evidence base/i);
    // It describes the RECORDING, not the session as it stands: the live counts
    // belong to the thin-substance note beside it, where they are true.
    expect(mark.textContent).toMatch(/recorded when little was on the table/i);
    expect(mark.textContent).not.toMatch(/design artefact\(s\) recorded/i);
    expect(container.querySelector("[data-substance='thin']")?.textContent).toMatch(/1 design artefact\(s\) recorded/i);
    // The levels themselves stay rendered — a caveat, never a blank.
    expect(container.querySelectorAll("[data-criterion]").length).toBe(7);
    expect(screen.getAllByText("L2 — good practice").length).toBeGreaterThan(0);

    // A reading recorded under SUFFICIENT substance carries no such marking,
    // even where the session has since gone thin — the mark follows the host
    // STAMP, not the current signal.
    cleanup();
    useCbe.getState().reset();
    seedConversation({
      maturity: structuredClone(READING),
      maturityState: {
        ...THIN,
        reading: { kind: "stamped", recordedUnderSubstance: "sufficient", recordedAtRevision: 1 },
      },
    });
    const second = render(<MaturityPanel />);
    expect(second.container.querySelector("[data-provenance='provisional']")).toBeNull();
    // …but the thinned base is still named, because that duty follows the signal.
    expect(second.container.querySelector("[data-substance='thin']")).toBeTruthy();
  });

  // Scenario: A provisional marking whose evidence base has since grown points at the refresh
  it("points a grown-past provisional marking at the refresh instead of quoting current counts", () => {
    // Stamped thin at revision 0, two artefacts settled in two distinct step
    // groups since: substance is `sufficient`, delta 2 keeps it out of staleness.
    seedConversation({
      maturity: structuredClone(READING),
      maturityState: {
        substance: "sufficient",
        evidence: { ingestedDocuments: 0, artefacts: 2, stepGroups: 2 },
        reading: { kind: "stamped", recordedUnderSubstance: "thin", recordedAtRevision: 0 },
      },
    });
    const { container } = render(<MaturityPanel />);
    const mark = container.querySelector(".maturity-provenance[data-provenance='provisional']") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.textContent).toMatch(/recorded when little was on the table/i);
    // The remedy is the refresh path, not advice the session has already followed.
    expect(mark.textContent).toMatch(/assess maturity/i);
    expect(mark.textContent).not.toMatch(/no material ingested yet/i);
    expect(mark.textContent).not.toMatch(/settling decisions across a second design step/i);
    // Nothing claims a thin base NOW — the host no longer reports one.
    expect(container.querySelector("[data-substance='thin']")).toBeNull();
  });

  // Scenario: A stale reading is marked stale with what changed, levels still visible
  it("marks a stale reading with what changed while keeping levels visible", () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: STALE });
    const { container } = render(<MaturityPanel />);
    const mark = container.querySelector(".maturity-provenance[data-provenance='stale']") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.textContent).toMatch(/out of date/i);
    expect(mark.textContent).toMatch(/syllabus\.pdf/);
    expect(mark.textContent).toMatch(/Challenge/);
    // The refresh path is NAMED, and it is the same Assess control.
    expect(mark.textContent).toMatch(/assess maturity/i);
    expect(assessButton().disabled).toBe(false);
    // Levels stay visible: an outdated level shown as current is worse than an
    // honestly marked stale one, and hiding them loses information.
    expect(container.querySelectorAll("[data-criterion]").length).toBe(7);
    expect(screen.getAllByText("L1 — CBE light").length).toBeGreaterThan(0);
    // Stale wins over the provisional marking — one framing, not two.
    expect(container.querySelectorAll(".maturity-provenance").length).toBe(1);
  });

  // Scenario: Unknown provenance is framed as unknown, not as provisional or stale
  it("frames unknown provenance as unknown, not provisional or stale", () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: UNKNOWN });
    const { container } = render(<MaturityPanel />);
    const mark = container.querySelector(".maturity-provenance[data-provenance='unknown']") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.textContent).toMatch(/recorded earlier in this course/i);
    expect(mark.textContent).toMatch(/not reconstructable/i);
    expect(mark.textContent).toMatch(/assess maturity/i);
    // Neither claim is supported, so neither is made.
    expect(container.querySelector("[data-provenance='provisional']")).toBeNull();
    expect(container.querySelector("[data-provenance='stale']")).toBeNull();
    // The copy makes no claim in either direction — it says what is unknown.
    expect(mark.textContent).toMatch(/nothing is claimed/i);
  });

  // Scenario: The dispatched assess turn carries the host state in its payload only
  it("carries the host state in the dispatched assess payload only", async () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: STALE });
    const sendSpy = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<MaturityPanel />);
    await act(async () => {
      fireEvent.click(assessButton());
    });
    const [, payload, display] = sendSpy.mock.calls[0]!;
    expect(payload).toMatch(/^\[maturity assess · substance sufficient · /);
    expect(payload).toMatch(/material 2, artefacts 5, step groups 3/);
    expect(payload).toMatch(/reading stale: recorded at revision 4, now 7/);
    // Display/payload split intact: the visible turn and the persisted display
    // projection keep the human rendering, so the annotated token never renders.
    expect(display).toEqual({ text: "Assess the design's maturity" });
    const lastUser = useCbe
      .getState()
      .turns.filter((t) => t.role === "user")
      .at(-1) as { text: string };
    expect(lastUser.text).toBe("Assess the design's maturity");
    expect(lastUser.text).not.toMatch(/substance|revision/);
    sendSpy.mockRestore();
  });

  // Scenario: Framing does not introduce a level-editing control
  it("introduces no level-editing control", () => {
    for (const state of [THIN, STALE, UNKNOWN]) {
      useCbe.getState().reset();
      seedConversation({ maturity: structuredClone(READING), maturityState: state });
      const { container } = render(<MaturityPanel />);
      expect(container.querySelector("select, input, [role='slider'], [role='spinbutton']")).toBeNull();
      const buttons = screen.getAllByRole("button");
      // Exactly: seven Discuss controls plus the one Assess control.
      expect(buttons.length).toBe(8);
      expect(buttons.filter((b) => b.getAttribute("aria-label")?.startsWith("Discuss maturity: ")).length).toBe(7);
      cleanup();
    }
  });
});

describe("Derived maturity state is per-conversation host state", () => {
  it("takes the live maturity_state event whole and never recomputes it", () => {
    const session = testSession();
    const slice = seedConversation({ maturity: structuredClone(READING), maturityState: emptyMaturityState() });
    const next = reduceConversation(slice, {
      type: "maturity_state",
      sessionId: session.sessionId,
      data: STALE,
    });
    // Stored verbatim — the renderer computes no substance and no staleness.
    expect(next.maturityState).toEqual(STALE);
  });

  it("keeps a background conversation's framing out of the visible panel", () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: SUFFICIENT });
    seedBackgroundConversation("other-session", "other-course", { maturityState: STALE });
    const { container } = render(<MaturityPanel />);
    // The visible course's reading is current; the background one's staleness
    // must not reframe it.
    expect(container.querySelector("[data-provenance='stale']")).toBeNull();
  });
});
