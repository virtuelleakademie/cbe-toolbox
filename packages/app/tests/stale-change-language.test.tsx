/**
 * What the lecturer READS follows the interface language; what the MODEL reads
 * stays the reference language (capability `desktop-app`, Requirement: *Every
 * String the App Renders Is English*, Scenario *The agent's reply language is
 * untouched*).
 *
 * The stale-maturity change enumeration is the last surface where both halves
 * are fed from ONE host record. `DesignSignal` hands out structured
 * `DesignChange` values; the Maturity Panel words them from the chrome
 * catalogue, while `stalenessNoticeLine` words the same records for the
 * machine-readable `[maturity-stale]` payload prefix — and that one must not
 * move with the setting, for the same reason the maturity Discuss token and the
 * step-focus/canvas-deletion labels are pinned.
 *
 * Both directions are asserted over the SAME records in one test, which is the
 * whole rule: German on screen, reference language on the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { MaturityPanel } from "../src/renderer/components/MaturityPanel.js";
import { __resetActiveLanguage, setActiveLanguage } from "../src/renderer/chrome.js";
import { de } from "../src/shared/i18n/de.js";
import { stalenessNoticeLine, type DesignChange, type MaturitySnapshot } from "@cbe/pi-bridge";
import type { MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import { seedConversation } from "./helpers/conversation.js";

const READING: MaturitySnapshot = {
  "societal-challenge": { current: 2, target: 3 },
  "stakeholder-involvement": { current: "unassessed" },
  interdisciplinarity: { current: "unassessed" },
  "student-agency": { current: "unassessed" },
  "iterative-process": { current: "unassessed" },
  "value-reflection": { current: "unassessed" },
  "societal-impact": { current: "unassessed" },
};

/** One of each shape the descriptors branch on: an ingestion carrying a
 * filename, a step-depth change, and an artefact change carrying id + label. */
const CHANGES: DesignChange[] = [
  { kind: "ingestion", revision: 5, label: "syllabus.pdf" },
  { kind: "step-depth", revision: 6, step: 3 },
  { kind: "canvas-set", revision: 7, id: "challenge", step: 4, label: "Challenge" },
];

const STALE: MaturityDerivedState = {
  substance: "sufficient",
  evidence: { ingestedDocuments: 1, artefacts: 4, stepGroups: 2 },
  reading: { kind: "stamped", recordedUnderSubstance: "sufficient", recordedAtRevision: 4 },
  stale: { recordedAtRevision: 4, currentRevision: 7, changes: CHANGES, omitted: 0 },
};

beforeEach(() => {
  useCbe.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetActiveLanguage();
});

describe("the stale-reading change enumeration", () => {
  it("is German on the panel while the model's notice stays in the reference language", () => {
    seedConversation({ maturity: structuredClone(READING), maturityState: STALE });
    const { container } = render(<MaturityPanel />);
    act(() => setActiveLanguage("de"));

    // The lecturer's half: the connective words are German.
    const framing = container.querySelector(".maturity-provenance[data-provenance='stale']") as HTMLElement;
    expect(framing).toBeTruthy();
    expect(framing.textContent).toContain(de.maturityStaleChangeIngestion({ label: "syllabus.pdf" }));
    expect(framing.textContent).toContain(de.maturityStaleChangeStepDepth({ step: 3 }));
    expect(framing.textContent).toContain(
      de.maturityStaleChangeArtefactSet({ label: "Challenge", id: "challenge", step: 4 })
    );
    // Same `; ` join as before the wording moved into the catalogue.
    expect(framing.textContent).toContain(
      `${de.maturityStaleChangeIngestion({ label: "syllabus.pdf" })}; ${de.maturityStaleChangeStepDepth({ step: 3 })}`
    );
    // The label, the filename and the artefact id are CONTENT and pass through
    // untranslated.
    expect(framing.textContent).toContain("syllabus.pdf");
    expect(framing.textContent).toContain("Challenge");
    expect(framing.textContent).toContain("challenge");
    // Plain text node, never markup: no element was produced inside the framing.
    expect(framing.querySelectorAll("*").length).toBe(1); // only the <strong> heading
    // And it really is German — not English that happens to match.
    expect(framing.textContent).not.toMatch(/material ingested/i);
    expect(framing.textContent).not.toMatch(/reached a new depth/i);

    // The model's half: the same records, worded in the reference language.
    const notice = stalenessNoticeLine({
      recordedAtRevision: 4,
      currentRevision: 7,
      changes: CHANGES,
      omitted: 0,
    });
    expect(notice).toContain("material ingested: “syllabus.pdf”");
    expect(notice).toContain("design step 3 reached a new depth");
    expect(notice).toContain("artefact changed: “Challenge” (id challenge, step 4)");
    expect(notice).not.toContain("Material eingelesen");
    expect(notice).not.toContain("Design-Schritt");
    expect(notice).not.toContain("Artefakt");
  });
});
