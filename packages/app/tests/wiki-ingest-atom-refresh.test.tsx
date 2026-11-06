/**
 * Regression for the Wiki atom list remaining stale after an ingest reached
 * Done. The real Electron reproduction established that this is independent of
 * the Pi migration: both former origin/main with Pi 0.75.5 and the Pi 1.3 branch
 * behaved identically. A WikiBrowser that stayed mounted refreshed, but a tab
 * switch, panel collapse/expand, or responsive auto-collapse replaced it while
 * `startWikiIngest` retained the old instance's `onDone` closure. The replacement
 * received the application-level Done record and notice but never listed the
 * atoms that were already on disk; leaving and re-entering the course merely
 * masked the defect.
 *
 * These tests hold the fix at the application-state seam: successful completion
 * advances one course's atom revision, and whichever WikiBrowser is mounted for
 * that course reloads it. Component lifetimes, unrelated courses, stale runs,
 * cancellation, abort and failure cannot produce that signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WikiBrowser } from "../src/renderer/components/WikiBrowser.js";
import { useCbe } from "../src/renderer/state/store.js";
import { abortWikiIngest, startWikiIngest } from "../src/renderer/state/wikiIngest.js";
import type { WikiAtomSummary, WikiIngestResult } from "../src/shared/ipc-contract.js";

const COURSE_A = "algorithmen";
const COURSE_B = "datenbanken";
const ATOM: WikiAtomSummary = {
  relPath: "concept/cognitive-load.md",
  title: "cognitive-load",
  type: "concept",
  aliases: [],
  related: [],
  confidence: "high",
  updated: "2026-08-27",
  body: "Working memory is limited.",
};

interface PendingRun {
  courseId: string;
  resolve: (result: WikiIngestResult[] | null) => void;
}

let atomsByCourse: Record<string, WikiAtomSummary[]>;
let pending: PendingRun[];
let listWikiAtoms: ReturnType<typeof vi.fn>;

const success = (): WikiIngestResult[] => [
  { ok: true, filename: "skript.md", rawRelPath: "raw/skript.md", atoms: [ATOM.relPath] },
];
const failed = (): WikiIngestResult[] => [
  { ok: false, filename: "skript.md", rawRelPath: "raw/skript.md", status: "failed", error: "provider failed" },
];

beforeEach(() => {
  atomsByCourse = { [COURSE_A]: [], [COURSE_B]: [] };
  pending = [];
  listWikiAtoms = vi.fn(async (courseId: string) => ({ atoms: atomsByCourse[courseId] ?? [], invalid: [] }));
  useCbe.setState({ activeCourseId: COURSE_A, wikiIngest: {}, wikiAtomRevision: {} });
  Object.assign(window.cbe, {
    listWikiAtoms,
    ingestToWiki: ({ courseId }: { token: string; courseId: string }) =>
      new Promise<WikiIngestResult[] | null>((resolve) => pending.push({ courseId, resolve })),
    abortWikiIngest: vi.fn(async () => ({ ok: true as const, delivered: true })),
  });
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ activeCourseId: "" });
});

function listCalls(courseId: string): number {
  return listWikiAtoms.mock.calls.filter(([listed]) => listed === courseId).length;
}

describe("Completed ingest refreshes the current course Wiki surface", () => {
  // Scenario: Same mounted surface shows landed atoms at completion.
  it("reloads the ordinary same-mount surface exactly once when a successful run completes", async () => {
    render(<WikiBrowser courseId={COURSE_A} />);
    await waitFor(() => expect(listCalls(COURSE_A)).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "Ingest material" }));
    atomsByCourse[COURSE_A] = [ATOM];
    pending[0]!.resolve(success());

    await waitFor(() => expect(screen.getByText(ATOM.title)).toBeTruthy());
    expect(listCalls(COURSE_A)).toBe(2);
    expect(useCbe.getState().wikiAtomRevision[COURSE_A]).toBe(1);
  });

  // Scenario: Replacement surface shows landed atoms at completion.
  it("reloads the replacement surface mounted during the run instead of calling the stale starter", async () => {
    const view = render(<WikiBrowser courseId={COURSE_A} />);
    await waitFor(() => expect(listCalls(COURSE_A)).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Ingest material" }));

    // Reproduce a tab switch / collapse cycle: the starter is gone and a fresh
    // instance has loaded the still-empty on-disk list while the run continues.
    view.rerender(<></>);
    view.rerender(<WikiBrowser courseId={COURSE_A} />);
    await waitFor(() => expect(listCalls(COURSE_A)).toBe(2));
    expect(screen.getByText(/No atoms yet/)).toBeTruthy();

    atomsByCourse[COURSE_A] = [ATOM];
    pending[0]!.resolve(success());

    await waitFor(() => expect(screen.getByText(ATOM.title)).toBeTruthy());
    expect(listCalls(COURSE_A)).toBe(3);
  });

  // Scenario: Completion refresh is course-scoped.
  it("invalidates only the completed run's course and never contaminates another mounted course", async () => {
    render(
      <>
        <WikiBrowser courseId={COURSE_A} />
        <WikiBrowser courseId={COURSE_B} />
      </>
    );
    await waitFor(() => {
      expect(listCalls(COURSE_A)).toBe(1);
      expect(listCalls(COURSE_B)).toBe(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Ingest material" }));
    atomsByCourse[COURSE_A] = [ATOM];
    pending[0]!.resolve(success());

    await waitFor(() => expect(screen.getByText(ATOM.title)).toBeTruthy());
    expect(listCalls(COURSE_A)).toBe(2);
    expect(listCalls(COURSE_B)).toBe(1);
    expect(useCbe.getState().wikiAtomRevision).toEqual({ [COURSE_A]: 1 });
  });

  // Scenario: Superseded completion cannot invalidate the current run.
  it("rejects a late successful completion from the run that a newer run superseded", async () => {
    render(<WikiBrowser courseId={COURSE_A} />);
    await waitFor(() => expect(listCalls(COURSE_A)).toBe(1));

    const first = startWikiIngest();
    const firstRun = pending[0]!;
    await abortWikiIngest(COURSE_A);
    const second = startWikiIngest();
    expect(pending).toHaveLength(2);

    atomsByCourse[COURSE_A] = [ATOM];
    firstRun.resolve(success());
    await first;

    expect(useCbe.getState().wikiIngest[COURSE_A]!.running).toBe(true);
    expect(useCbe.getState().wikiAtomRevision[COURSE_A] ?? 0).toBe(0);
    expect(listCalls(COURSE_A)).toBe(1);
    expect(screen.queryByText(ATOM.title)).toBeNull();

    pending[1]!.resolve(failed());
    await second;
  });

  // Scenario: Unsuccessful endings claim no new atoms.
  it("does not invalidate for cancellation, delivered abort, total failure, or a thrown start", async () => {
    render(<WikiBrowser courseId={COURSE_A} />);
    await waitFor(() => expect(listCalls(COURSE_A)).toBe(1));

    const cancelled = startWikiIngest();
    pending[0]!.resolve(null);
    await cancelled;

    const aborted = startWikiIngest();
    await abortWikiIngest(COURSE_A);
    pending[1]!.resolve([
      { ok: false, filename: "skript.md", rawRelPath: "raw/skript.md", status: "aborted", error: "aborted" },
    ]);
    await aborted;

    const totalFailure = startWikiIngest();
    pending[2]!.resolve(failed());
    await totalFailure;

    Object.assign(window.cbe, {
      ingestToWiki: async () => {
        throw new Error("endpoint unavailable");
      },
    });
    await startWikiIngest();

    expect(useCbe.getState().wikiAtomRevision[COURSE_A] ?? 0).toBe(0);
    expect(listCalls(COURSE_A)).toBe(1);
    expect(screen.queryByText(ATOM.title)).toBeNull();
  });
});
