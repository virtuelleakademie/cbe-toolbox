/**
 * Renderer hydration on a COLD course open (change `carry-over-all-state-per-course`,
 * task 3.3):
 *
 * - capability `agent-harness`, Requirement: Course Design-State Store — the canvas,
 *   the step headers and the CBE Maturity panel present exactly what the course had, and
 *   a course with no record opens empty rather than inheriting the previous one.
 *
 * The main-process half (sidecar write → restart → mirrors → payload) is covered in
 * `course-design-state-roundtrip.test.ts`. This is the surface the lecturer actually
 * sees: `openConversation` returns the restored payload, and the panels render it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { App } from "../src/renderer/App.js";
import { useCbe } from "../src/renderer/state/store.js";
import type { ConversationOpenResult, ProviderStatus } from "../src/shared/ipc-contract.js";

const PROVIDER: ProviderStatus = { baseURL: "http://localhost:1", modelId: "test-model", hasKey: true };

/** The payload main serves after an app restart for a course WITH a design-state record. */
function restoredConversation(): ConversationOpenResult {
  return {
    session: {
      sessionId: "conv-a",
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/w", corpus: "/c" },
      courseId: "energiequartier",
    },
    turns: [{ role: "assistant", text: "Beginnen wir bei Schritt 1." }],
    agentRunning: false,
    canvas: [
      {
        step: 1,
        id: "challenge-frage",
        label: "Leitfrage",
        value: "Wie kann ein Quartier seinen Energiebedarf halbieren?",
        state: "done",
      },
      { step: 2, id: "stakeholder", label: "Stakeholder", value: "Energieversorger, Quartierverein", state: "draft" },
    ],
    steps: [
      { step: 1, depth: "refined", focus: false },
      { step: 2, depth: "rough", focus: true },
    ],
    maturity: {
      "societal-challenge": { current: 2, target: 3, hint: "Leitfrage steht, Auftraggeber fehlt" },
      "stakeholder-involvement": { current: "unassessed" },
    },
  };
}

/** The payload for a course that never recorded design state. */
function emptyConversation(): ConversationOpenResult {
  return {
    session: {
      sessionId: "conv-b",
      environmentProfile: "app",
      affordances: {},
      paths: { workspace: "/w", corpus: "/c" },
      courseId: "leerer-kurs",
    },
    turns: [],
    agentRunning: false,
    canvas: [],
  };
}

function stubConfigured(open: () => Promise<ConversationOpenResult>) {
  Object.assign(window.cbe, { getConfig: async () => PROVIDER, openConversation: open });
}

function resetStore() {
  useCbe.getState().reset();
  useCbe.setState({ configured: false, hydration: "idle", hydrationError: null });
}

/** Open the right panel on a tab the way the lecturer does: the rail icon while the
 * panel is collapsed, the tab strip once it is open. */
async function openTab(label: string) {
  const rail = screen.queryByLabelText(`Open ${label}`);
  fireEvent.click(rail ?? screen.getByRole("tab", { name: label }));
  await waitFor(() => expect(screen.getByRole("tab", { name: label }).getAttribute("aria-selected")).toBe("true"));
}

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
});

describe("cold course open renders the course's recorded design state", () => {
  it("renders the recorded step headers and canvas artefacts, not the seed", async () => {
    stubConfigured(vi.fn(async () => restoredConversation()));
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    await openTab("CBE Process Canvas");

    // Step 1 came back at `refined`, step 2 at `rough` AND in focus…
    // (Header lookups go through the step group, because the FOCUSED group is
    // expanded — its artefact labels repeat the step name in the body.)
    const headOf = (step: number) =>
      document.querySelector(`.step-group[data-step="${step}"] .step-head`) as HTMLElement;
    expect(within(headOf(1)).getByText("refined")).toBeTruthy();
    const step2 = headOf(2);
    expect(within(step2).getByText("rough")).toBeTruthy();
    expect(within(step2).getByLabelText("in focus")).toBeTruthy();
    // …focus stays exclusive: exactly one focused header.
    expect(screen.getAllByLabelText("in focus")).toHaveLength(1);
    // …and steps that never moved stay at the `open` seed.
    expect(within(headOf(3)).queryByLabelText("in focus")).toBeNull();

    // The canvas artefacts are back with their recorded values. The accordion
    // follows the FOCUSED step (Requirement: Panel Follows the Agent's Artefact
    // Work), so step 2 is the open group and step 1 shows its artefact once
    // expanded — the lecturer lands on the step the work is actually on.
    expect(screen.getByText(/Energieversorger, Quartierverein/)).toBeTruthy();
    fireEvent.click(headOf(1));
    expect(screen.getByText(/Quartier seinen Energiebedarf halbieren/)).toBeTruthy();
  });

  it("renders the recorded maturity reading, materialising nothing", async () => {
    stubConfigured(vi.fn(async () => restoredConversation()));
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    await openTab("CBE Maturity");

    // Not the empty state…
    expect(screen.queryByText(/nothing has been assessed for this course yet/i)).toBeNull();
    expect(screen.getByText(/Leitfrage steht, Auftraggeber fehlt/)).toBeTruthy();
    // …and the criterion stored as unassessed stays unassessed — no level invented.
    const row = screen.getByText("Stakeholder involvement").closest(".maturity-row") as HTMLElement;
    expect(within(row).getByText("not yet assessed")).toBeTruthy();
    // …and no aggregate `Overall reading` row is invented for a partial raster.
    expect(screen.queryByText("Overall reading")).toBeNull();
  });

  it("opens a course with no record empty rather than inheriting the previous one", async () => {
    // First the course WITH state, so a bleed would have something to bleed.
    const open = vi.fn(async () => restoredConversation());
    stubConfigured(open);
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    await openTab("CBE Process Canvas");
    expect(screen.getAllByLabelText("in focus")).toHaveLength(1);

    // Switch to a course whose payload carries no design state at all — the two
    // steps a course switch takes: activate the course, then hydrate its
    // conversation from main's `conversationOpen` result.
    useCbe.getState().setActiveCourse("leerer-kurs");
    useCbe.getState().hydrateConversation(emptyConversation());
    await waitFor(() => expect(useCbe.getState().session?.sessionId).toBe("conv-b"));

    expect(screen.queryAllByLabelText("in focus")).toHaveLength(0);
    expect(screen.queryByText(/Quartier seinen Energiebedarf halbieren/)).toBeNull();
    expect(useCbe.getState().steps.every((s) => s.depth === "open" && !s.focus)).toBe(true);
    await openTab("CBE Maturity");
    // The empty state, whose wording scopes the absent reading to the COURSE
    // (Requirement: Maturity Panel, § Empty state) — which is exactly what this
    // test is about: a course with no record shows its own emptiness, not the
    // previous course's raster.
    expect(screen.getByText(/nothing has been assessed for this course yet/i)).toBeTruthy();
  });
});
