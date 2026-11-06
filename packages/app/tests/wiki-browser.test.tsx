/**
 * Wiki browse / search / knowledge-graph surface (capability `lecturer-wiki`,
 * Requirement: Wiki Is Browsable and Searchable in the App) + ingestion
 * progress UI (Requirement: Ingestion Runs in Isolated Subagent Sessions,
 * renderer half).
 *
 * Scenarios:
 *  - "Search for an atom in the app" — keyword matches frontmatter AND body,
 *    with preview and clickable drill-down.
 *  - "Knowledge graph shows atom relationships" — nodes + edges from
 *    frontmatter references, clickable through to the atom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WikiBrowser } from "../src/renderer/components/WikiBrowser.js";
import { useCbe } from "../src/renderer/state/store.js";
import { wireWikiIngestEvents } from "../src/renderer/state/wikiIngest.js";
import type { WikiAtomSummary } from "../src/shared/ipc-contract.js";

const ATOMS: WikiAtomSummary[] = [
  {
    relPath: "concept/cognitive-load.md",
    title: "cognitive-load",
    type: "concept",
    aliases: ["kognitive Belastung"],
    related: ["[[concept/constructive-alignment]]"],
    confidence: "high",
    updated: "2026-07-07",
    body: "Cognitive load is the working-memory demand of a task.",
  },
  {
    relPath: "concept/constructive-alignment.md",
    title: "constructive-alignment",
    type: "concept",
    aliases: [],
    related: [],
    confidence: "medium",
    updated: "2026-07-07",
    body: "Alignment of objectives, activities, and assessment.",
  },
];

beforeEach(() => {
  Object.assign(window.cbe, {
    listWikiAtoms: async () => ({ atoms: ATOMS, invalid: [] }),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ activeCourseId: "" });
});

describe("Search for an atom in the app", () => {
  it("shows all atoms with a preview, filters by keyword in frontmatter or body", async () => {
    render(<WikiBrowser courseId="datenbanken" />);
    await waitFor(() => expect(screen.getByText("cognitive-load")).toBeTruthy());
    expect(screen.getByText(/working-memory demand/)).toBeTruthy(); // preview

    // Body keyword match.
    fireEvent.change(screen.getByLabelText("Search wiki atoms"), { target: { value: "assessment" } });
    expect(screen.queryByText("cognitive-load")).toBeNull();
    expect(screen.getByText("constructive-alignment")).toBeTruthy();

    // Alias (frontmatter) match.
    fireEvent.change(screen.getByLabelText("Search wiki atoms"), { target: { value: "kognitive" } });
    expect(screen.getByText("cognitive-load")).toBeTruthy();
    expect(screen.queryByText("constructive-alignment")).toBeNull();
  });

  it("clicking a result drills down into the atom detail", async () => {
    render(<WikiBrowser courseId="datenbanken" />);
    await waitFor(() => expect(screen.getByText("cognitive-load")).toBeTruthy());
    fireEvent.click(screen.getByText("cognitive-load"));
    expect(screen.getByRole("heading", { name: "cognitive-load" })).toBeTruthy();
    expect(screen.getByText(/working-memory demand/)).toBeTruthy();
    // Related atoms are clickable through.
    fireEvent.click(screen.getByRole("button", { name: "constructive-alignment" }));
    expect(screen.getByRole("heading", { name: "constructive-alignment" })).toBeTruthy();
  });
});

describe("Knowledge graph shows atom relationships", () => {
  it("renders atoms as nodes and related-references as edges, clickable through to the atom", async () => {
    render(<WikiBrowser courseId="datenbanken" />);
    await waitFor(() => expect(screen.getByText("cognitive-load")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Knowledge graph" }));

    const svg = screen.getByRole("img", { name: /Knowledge graph/ });
    expect(svg.querySelectorAll(".wiki-graph-node").length).toBe(2);
    expect(svg.querySelectorAll('[data-testid="wiki-graph-edge"]').length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Open atom constructive-alignment" }));
    expect(screen.getByRole("heading", { name: "constructive-alignment" })).toBeTruthy();
  });
});

describe("ingestion progress UI", () => {
  it("streams per-document status and supports abort while running", async () => {
    let emit: ((evt: unknown) => void) | null = null;
    let resolveIngest: ((v: unknown) => void) | null = null;
    // The token the renderer minted for this run — the main process stamps it on
    // every progress event, and the record applies only its own run's events.
    let token = "";
    const abortWikiIngest = vi.fn(async () => ({ ok: true as const, delivered: true }));
    Object.assign(window.cbe, {
      onWikiIngestProgress(listener: (evt: unknown) => void) {
        emit = listener;
        return () => {};
      },
      ingestToWiki: (payload: { token: string; courseId: string }) => {
        token = payload.token;
        return new Promise((r) => (resolveIngest = r));
      },
      abortWikiIngest,
    });
    // The progress subscription is the APPLICATION's, not the component's
    // (capability `lecturer-wiki`, Requirement: Ingest Progress Outlives the
    // Surface That Shows It) — `main.tsx` wires it at renderer entry.
    wireWikiIngestEvents();
    // The run record is keyed by the ACTIVE course — the id the main process
    // resolves for the run and stamps on every progress event — so the fixture
    // states it rather than relying on the browse surface's `courseId` prop.
    useCbe.setState({ activeCourseId: "datenbanken" });
    render(<WikiBrowser courseId="datenbanken" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));

    emit!({ courseId: "datenbanken", token, filename: "skript.pdf", rawRelPath: "raw/skript.md", status: "running" });
    await waitFor(() => expect(screen.getByText("skript.pdf")).toBeTruthy());
    expect(screen.getByText("running")).toBeTruthy();

    // One document's failure is visible individually.
    emit!({
      courseId: "datenbanken",
      token,
      filename: "kaputt.docx",
      rawRelPath: "raw/kaputt.md",
      status: "failed",
      error: "provider exploded",
    });
    await waitFor(() => expect(screen.getByText("provider exploded")).toBeTruthy());
    expect(screen.getByText("running")).toBeTruthy(); // the other doc keeps running

    // The abort NAMES this run (capability `lecturer-wiki`, Requirement: An
    // Ingest Belongs to the Course It Was Started In) — an unnamed one could
    // end a run in another course.
    fireEvent.click(screen.getByRole("button", { name: "Abort" }));
    expect(abortWikiIngest).toHaveBeenCalledWith(token);

    resolveIngest!([
      { ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.md", atoms: ["concept/a.md"] },
      { ok: false, filename: "kaputt.docx", rawRelPath: "raw/kaputt.md", status: "failed", error: "provider exploded" },
    ]);
    await waitFor(() => expect(screen.getByText(/1 document\(s\) atomized, 1 failed/)).toBeTruthy());
  });
});
