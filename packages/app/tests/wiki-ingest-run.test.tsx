/**
 * A wiki ingest's progress outlives the surface that shows it (capability
 * `lecturer-wiki`, Requirement: Ingest Progress Outlives the Surface That Shows
 * It). The defect these tests pin: the run's state used to live in the
 * `WikiIngest` component's own `useState`, and the left panel UNMOUNTS its body
 * when collapsed (capability `desktop-app`, Requirement: Collapsible Left Panel)
 * — so collapsing the panel discarded the rows, tore down the progress
 * subscription (whose events have no replay), dropped the abort control and lost
 * the run's closing notice, while the ingest itself kept running.
 *
 * Scenarios, one test each:
 *  - Progress survives collapsing and re-expanding the panel mid-run
 *  - Progress emitted while the panel is collapsed is recorded, not lost
 *  - A run that finishes while nothing is mounted still reports its outcome
 *  - The collapsed rail signals a running ingestion
 *  - The rail's count and the panel's rows come from one record
 *  - The abort control returns with the panel
 *  - A non-active course's wiki surface offers no way to start an ingest
 *  - A deactivated course still shows and can end its own running ingest
 *  - A running run stays bound to its own course across an active-course switch
 *  - The start control is disabled while its own course's run is live
 *  - A second start for a live run is refused rather than wiping its record
 *
 * The last four belong to capability `lecturer-wiki`, Requirement: *An Ingest
 * Belongs to the Course It Was Started In*.
 *
 * The load-bearing test asserts against the RUN RECORD, not against a rendered
 * string: a later redesign of the rows must be free to move every string without
 * moving what survives a collapse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe, wikiIngestActivity } from "../src/renderer/state/store.js";
import {
  abortWikiIngest as endWikiIngestRun,
  startWikiIngest,
  wireWikiIngestEvents,
} from "../src/renderer/state/wikiIngest.js";
import { LeftPanel } from "../src/renderer/components/LeftPanel.js";
import type { CourseSummary, WikiIngestProgressEvent, WikiIngestResult } from "../src/shared/ipc-contract.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

/**
 * The ACTIVE course — and therefore the run's key. `ingestToWiki()` resolves the
 * active course in the main process and stamps every progress event with that
 * id. An ingest may only be started in the active course (capability
 * `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It Was Started
 * In), so the divergent case is no longer a start under a foreign course but a
 * course DEACTIVATED while its run continues — which is what the tests below
 * drive.
 */
const COURSE = "algorithmen";

/** The main process's progress broadcast, as the preload hands it over. */
let emit: (evt: WikiIngestProgressEvent) => void = () => {};
/** Resolver of the in-flight `ingestToWiki()` call. */
let resolveIngest: ((v: WikiIngestResult[] | null) => void) | null = null;
let abortWikiIngest: ReturnType<typeof vi.fn>;
let ingestToWiki: ReturnType<typeof vi.fn>;
/** The token the renderer handed to the in-flight `ingestToWiki()` call — what
 * the main process stamps on that run's every progress event. */
let lastIngestToken = "";
/** The course the renderer NAMED on that call — its assertion about what it just
 * recorded the run under, which the host checks against the active course
 * (capability `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It
 * Was Started In). */
let lastIngestCourseId = "";

function progress(
  filename: string,
  status: WikiIngestProgressEvent["status"],
  error?: string,
  token: string = lastIngestToken
) {
  emit({ courseId: COURSE, token, filename, rawRelPath: `raw/${filename}.md`, status, ...(error ? { error } : {}) });
}

/**
 * Open the left panel on a course's detail level, where the wiki surface is.
 * Defaults to the ACTIVE course, which is the ordinary case. The chevron is a
 * sibling of the activation button, so this never changes `activeCourseId` —
 * pass another title to reach a non-active course's detail.
 */
function openCourseDetail(title = "Algorithmen") {
  const card = screen.getByText(title).closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
  // The wiki browser lives behind the detail view's Wiki tab since change
  // `resume-course-conversations` (Requirement: Course Detail Tabs: Chats and
  // Wiki) — the default tab is Chats.
  fireEvent.click(screen.getByRole("tab", { name: "Wiki" }));
}

const collapse = () => fireEvent.click(screen.getByRole("button", { name: "Collapse left panel" }));
const expand = () => fireEvent.click(screen.getByRole("button", { name: "Expand left panel" }));

beforeEach(() => {
  resolveIngest = null;
  lastIngestToken = "";
  lastIngestCourseId = "";
  // The default fixture is a run in its atomization phase, so an abort reaches
  // it — `delivered: true`. The other direction has its own case below.
  abortWikiIngest = vi.fn(async () => ({ ok: true as const, delivered: true }));
  ingestToWiki = vi.fn((payload: { token: string; courseId: string }) => {
    lastIngestToken = payload.token;
    lastIngestCourseId = payload.courseId;
    return new Promise<WikiIngestResult[] | null>((r) => (resolveIngest = r));
  });
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen", leftPanelCollapsed: false });
  Object.assign(window.cbe, {
    listCourses: async () => ({ courses: COURSES, activeCourseId: "algorithmen" }),
    listWikiAtoms: async () => ({ atoms: [], invalid: [] }),
    ingestToWiki,
    abortWikiIngest,
    onWikiIngestProgress(listener: (evt: WikiIngestProgressEvent) => void) {
      emit = listener;
      return () => {
        emit = () => {};
      };
    },
  });
  // The ONE application-level subscription, as `main.tsx` wires it at renderer
  // entry — deliberately not a component effect.
  wireWikiIngestEvents();
});

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "" });
});

describe("Ingest progress outlives the surface that shows it", () => {
  // Scenario: Progress survives collapsing and re-expanding the panel mid-run.
  it("keeps the run record identical across a collapse cycle and shows it again on re-expanding", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "running");
    progress("folien.pptx", "extracting");
    await waitFor(() => expect(screen.getByText("skript.pdf")).toBeTruthy());

    const before = useCbe.getState().wikiIngest[COURSE];
    expect(before).toEqual({
      running: true,
      notice: null,
      runId: 1,
      token: lastIngestToken,
      docs: [
        {
          courseId: COURSE,
          token: lastIngestToken,
          filename: "skript.pdf",
          rawRelPath: "raw/skript.pdf.md",
          status: "running",
        },
        {
          courseId: COURSE,
          token: lastIngestToken,
          filename: "folien.pptx",
          rawRelPath: "raw/folien.pptx.md",
          status: "extracting",
        },
      ],
    });

    collapse();
    // The body is gone (Requirement: Collapsible Left Panel) — the record is not.
    expect(screen.queryByText("skript.pdf")).toBeNull();
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual(before);

    expand();
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual(before);
    // …and the re-expanded panel shows that record rather than an empty one.
    await waitFor(() => expect(screen.getByText("skript.pdf")).toBeTruthy());
    expect(screen.getByText("folien.pptx")).toBeTruthy();
  });

  // Scenario: Progress emitted while the panel is collapsed is recorded, not lost.
  it("records events that arrive while the panel is collapsed and shows them on re-expanding", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "running");
    await waitFor(() => expect(screen.getByText("skript.pdf")).toBeTruthy());

    collapse();
    // Everything below arrives with no wiki surface mounted anywhere.
    progress("skript.pdf", "done");
    progress("kaputt.docx", "failed", "provider exploded");

    const run = useCbe.getState().wikiIngest[COURSE]!;
    expect(run.docs.map((d) => [d.filename, d.status])).toEqual([
      ["skript.pdf", "done"], // upserted in place: arrival order is not disturbed
      ["kaputt.docx", "failed"],
    ]);

    expand();
    await waitFor(() => expect(screen.getByText("provider exploded")).toBeTruthy());
    expect(screen.getByText("done")).toBeTruthy();
  });

  // Scenario: A run that finishes while nothing is mounted still reports its outcome.
  it("records the closing notice of a run that completes with no surface mounted", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "running");
    await waitFor(() => expect(screen.getByText("skript.pdf")).toBeTruthy());

    collapse();
    resolveIngest!([
      { ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: ["concept/a.md"] },
      { ok: false, filename: "kaputt.docx", rawRelPath: "raw/k.md", status: "failed", error: "provider exploded" },
    ]);

    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false));
    expect(useCbe.getState().wikiIngest[COURSE]!.notice).toBe("1 document(s) atomized, 1 failed.");

    expand();
    await waitFor(() => expect(screen.getByText(/1 document\(s\) atomized, 1 failed/)).toBeTruthy());
  });

  // Scenario: The collapsed rail signals a running ingestion.
  it("names and counts the running ingest in the collapsed rail's accessible name", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "done");
    progress("folien.pptx", "running");
    await waitFor(() => expect(screen.getByText("folien.pptx")).toBeTruthy());

    collapse();
    const rail = screen.getByRole("button", { name: /Open Courses/ });
    expect(rail.getAttribute("aria-label")).toBe("Open Courses (Wiki ingest running (1 of 2 documents))");
    // Not colour alone: the marker is an attribute-flagged element beside an
    // accessible name that states the same thing.
    expect(rail.getAttribute("data-attention")).toBe("true");
    expect(rail.querySelector(".panel-attention-dot")).toBeTruthy();

    // It clears with the run, so a finished ingest does not keep shouting.
    resolveIngest!([{ ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: [] }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Courses" })).toBeTruthy());
  });

  // Scenario: The rail's count and the panel's rows come from one record.
  it("derives the rail summary from the same record the panel renders row by row", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("a.pdf", "done");
    progress("b.pdf", "failed", "provider exploded");
    progress("c.pdf", "aborted");
    progress("d.pdf", "running");
    progress("e.pdf", "extracting");
    await waitFor(() => expect(screen.getByText("e.pdf")).toBeTruthy());

    const rows = document.querySelectorAll(".wiki-ingest-row");
    const summary = wikiIngestActivity(useCbe.getState().wikiIngest);
    expect(summary).toEqual({ running: true, settled: 3, total: 5 });
    expect(summary.total).toBe(rows.length);
    // Settled = the three terminal statuses; the two in-flight rows are not counted.
    expect(summary.settled).toBe(
      document.querySelectorAll(".wiki-ingest-done, .wiki-ingest-failed, .wiki-ingest-aborted").length
    );

    collapse();
    expect(screen.getByRole("button", { name: /Open Courses/ }).getAttribute("aria-label")).toContain(
      "3 of 5 documents"
    );
  });

  // Scenario: The abort control returns with the panel.
  it("offers the abort control again after a collapse cycle, and it still aborts the run", async () => {
    render(<LeftPanel />);
    openCourseDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "running");
    await waitFor(() => expect(screen.getByRole("button", { name: "Abort" })).toBeTruthy());

    collapse();
    expand();

    const abort = await screen.findByRole("button", { name: "Abort" });
    fireEvent.click(abort);
    expect(abortWikiIngest).toHaveBeenCalled();
    // …and the control the collapse cycle gave back ENDS the run: the record
    // closes, the start control re-arms and the abort control goes away. Asserted
    // after the store update rather than in the same tick — the abort resolves a
    // microtask later, and a synchronous assertion here would only be measuring
    // that it had not landed yet.
    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ingest material" }).hasAttribute("disabled")).toBe(false)
    );
    expect(screen.queryByRole("button", { name: "Abort" })).toBeNull();
  });

  // The run's key is the ACTIVE course, which is what the main process stamps on
  // every progress event — not the course whose detail happens to be open. Keyed
  // by the displayed course instead, the start lands in one record and its events
  // in another: the rail reads "0 of 0" for the whole run, and a second, phantom
  // record shows the rows with no abort control and the start button re-armed.
  // Scenario: A non-active course's wiki surface offers no way to start an ingest
  //
  // The defect this replaces: the control sat under a non-active course's own
  // atom list and started a run in the ACTIVE course, so a lecturer reading
  // Datenbanken filed their PDF into Algorithmen.
  it("offers no start control in a non-active course's wiki surface, and says why", async () => {
    render(<LeftPanel />);
    // Datenbanken's detail is open; Algorithmen stays active (the chevron is a
    // sibling of the activation button, so opening a detail activates nothing).
    openCourseDetail("Datenbanken");
    expect(useCbe.getState().activeCourseId).toBe(COURSE);
    expect(useCbe.getState().courseDetailId).toBe("datenbanken");

    // Not offered — and not offered disabled either, which would show a control
    // whose only truthful action is elsewhere.
    await waitFor(() => expect(document.querySelector(".wiki-ingest")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Ingest material" })).toBeNull();
    expect(screen.getByText("Activate this course to start a new ingest here.")).toBeTruthy();
    expect(ingestToWiki).not.toHaveBeenCalled();

    // Activating the course is what offers it, and the run is then named for
    // the very course the surface shows.
    useCbe.getState().setActiveCourse("datenbanken");
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    expect(lastIngestCourseId).toBe("datenbanken");
    expect(Object.keys(useCbe.getState().wikiIngest)).toEqual(["datenbanken"]);
  });

  // Scenario: A deactivated course still shows and can end its own running
  // ingest — the run goes on in its own course, and this surface is the one
  // place its progress is shown.
  it("keeps a deactivated course's own run visible and endable on that course's surface", async () => {
    render(<LeftPanel />);
    openCourseDetail("Algorithmen");
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    const runToken = lastIngestToken;
    progress("skript.pdf", "done");
    progress("folien.pptx", "running");
    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.docs.length).toBe(2));

    // The lecturer activates the other course; this panel still shows THIS
    // course's detail, and this course's run.
    useCbe.getState().setActiveCourse("datenbanken");
    expect(useCbe.getState().courseDetailId).toBe("algorithmen");

    // The start control is gone with the activation, the abort control is not.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ingest material" })).toBeNull());
    expect(screen.getByText("Activate this course to start a new ingest here.")).toBeTruthy();
    expect(document.querySelectorAll(".wiki-ingest-row").length).toBe(2);

    // Ending it from here ends THIS run — named by its own token, so it cannot
    // reach a run in the course that is now active.
    fireEvent.click(screen.getByRole("button", { name: "Abort" }));
    await waitFor(() => expect(abortWikiIngest).toHaveBeenCalledWith(runToken));
    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false));
    expect(useCbe.getState().wikiIngest[COURSE]!.docs.length).toBe(2);
  });

  // Scenario: A running ingest keeps writing into its own course after the
  // active course changes — renderer half. The main process resolves the run's
  // course ONCE at handler entry and every progress event of the run carries
  // that id (the host half is pinned in `wiki-ingest-course-binding.test.ts`),
  // and the surface that shows the run must not follow the live active course
  // either, or it detaches from its own running record.
  //
  // THE REGRESSION THAT MUST NOT COME BACK.
  it("keeps the run bound to its own course when the active course changes mid-run", async () => {
    render(<LeftPanel />);
    openCourseDetail("Algorithmen");
    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "done");
    progress("folien.pptx", "running");
    await waitFor(() => expect(screen.getByText("folien.pptx")).toBeTruthy());
    const before = useCbe.getState().wikiIngest[COURSE];

    // The lecturer activates the other course. Nothing refuses this: the only
    // switch guard is an in-flight hydration, and a running ingest is not one.
    useCbe.getState().setActiveCourse("datenbanken");
    expect(useCbe.getState().activeCourseId).toBe("datenbanken");

    // The record has not moved, is still running, and still holds its rows.
    expect(Object.keys(useCbe.getState().wikiIngest)).toEqual([COURSE]);
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual(before);
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);
    // Events still arriving are filed by the event's own course id, never by
    // whatever happens to be active when the row lands.
    progress("anhang.pdf", "running");
    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.docs.length).toBe(3));
    expect(Object.keys(useCbe.getState().wikiIngest)).toEqual([COURSE]);

    // The rail keeps counting the live run…
    expect(wikiIngestActivity(useCbe.getState().wikiIngest)).toEqual({ running: true, settled: 1, total: 3 });
    // …and the course's own surface still shows that run, abort control included.
    expect(document.querySelectorAll(".wiki-ingest-row").length).toBe(3);
    expect(screen.getByRole("button", { name: "Abort" })).toBeTruthy();
    // The start control is the one thing that does NOT stay with this panel: it
    // belongs to the ACTIVE course, which the switch has just changed, so this
    // surface stops offering it. Nothing about the live run moved with it.
    expect(screen.queryByRole("button", { name: "Ingest material" })).toBeNull();
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);
  });

  // The start control's `disabled` state answers "would a click do anything?".
  // It is only ever rendered for the active course now, so the run it answers
  // for and the run this panel shows are the same run — the divergent
  // derivation the earlier version needed is gone with the divergent control.
  it("disables the start control while its own course's run is live, and re-arms it afterwards", async () => {
    render(<LeftPanel />);
    openCourseDetail("Algorithmen");
    const start = () => screen.getByRole("button", { name: "Ingest material" });

    fireEvent.click(await screen.findByRole("button", { name: "Ingest material" }));
    progress("skript.pdf", "running");
    await waitFor(() => expect(start().hasAttribute("disabled")).toBe(true));
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);

    resolveIngest!([{ ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: [] }]);
    await waitFor(() => expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false));
    await waitFor(() => expect(start().hasAttribute("disabled")).toBe(false));
  });
});

describe("The run is driven outside React", () => {
  // The half a store slice alone would not fix: with the `await` inside the
  // component, unmounting mid-run discards the resolution outright.
  it("records start and outcome with no component rendered at all", async () => {
    const run = startWikiIngest();
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual({
      running: true,
      docs: [],
      notice: null,
      runId: 1,
      token: lastIngestToken,
    });

    progress("skript.pdf", "done");
    resolveIngest!([{ ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: ["concept/a.md"] }]);
    await run;

    expect(useCbe.getState().wikiIngest[COURSE]).toEqual({
      running: false,
      notice: "1 document(s) atomized.",
      docs: [
        {
          courseId: COURSE,
          token: lastIngestToken,
          filename: "skript.pdf",
          rawRelPath: "raw/skript.pdf.md",
          status: "done",
        },
      ],
      runId: 1,
      token: lastIngestToken,
    });
    expect(useCbe.getState().wikiAtomRevision[COURSE]).toBe(1);
  });

  // Defence in depth under the control's own guard: re-seeding the record would
  // drop a live run's rows and then mark it finished while the ingest is still
  // going, which is what the collapsed rail reads to decide whether to signal.
  it("refuses a second start for a course whose run is still live, leaving the record untouched", async () => {
    const first = startWikiIngest();
    progress("skript.pdf", "running");
    progress("folien.pptx", "extracting");
    const live = useCbe.getState().wikiIngest[COURSE];
    expect(live!.running).toBe(true);
    expect(live!.docs.length).toBe(2);

    await startWikiIngest();

    // A total no-op: the very same record object, and no second ingest started.
    expect(useCbe.getState().wikiIngest[COURSE]).toBe(live);
    expect(ingestToWiki).toHaveBeenCalledTimes(1);
    expect(wikiIngestActivity(useCbe.getState().wikiIngest)).toEqual({ running: true, settled: 0, total: 2 });

    // The first run still finishes normally, and a start is possible again.
    resolveIngest!([{ ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: [] }]);
    await first;
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false);
    expect(useCbe.getState().wikiIngest[COURSE]!.docs.length).toBe(2);
    void startWikiIngest();
    expect(ingestToWiki).toHaveBeenCalledTimes(2);
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual({
      running: true,
      docs: [],
      notice: null,
      runId: 2,
      token: lastIngestToken,
    });
  });

  it("leaves a cancelled file dialog a silent no-op, and reports a failed start", async () => {
    const cancelled = startWikiIngest();
    resolveIngest!(null);
    await cancelled;
    expect(useCbe.getState().wikiIngest[COURSE]).toEqual({
      running: false,
      docs: [],
      notice: null,
      runId: 1,
      token: lastIngestToken,
    });

    Object.assign(window.cbe, {
      ingestToWiki: async () => {
        throw new Error("An ingestion is already running");
      },
    });
    await startWikiIngest();
    expect(useCbe.getState().wikiIngest[COURSE]!.notice).toBe("An ingestion is already running");
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false);
  });
});

/**
 * An ingest that cannot reach the model fails visibly and stays retryable
 * (capability `lecturer-wiki`, Requirement of the same name).
 *
 * The reported defect: a run against a stopped inference server never ended, so
 * `running` stayed `true` and the start guard — correct, and not the cause —
 * refused every further ingest until the application was restarted. The bound
 * that makes the run end lives in the runner; what these cases hold is the
 * lecturer's side of it.
 */
describe("An ingest that cannot reach the model fails visibly and stays retryable", () => {
  // Scenario: The lecturer sees that the ingest failed
  it("ends the record with the cause when the ingest is refused, and when a document fails", async () => {
    Object.assign(window.cbe, {
      ingestToWiki: async () => {
        throw new Error("The model endpoint at http://localhost:8080/v1 did not answer. Start it, then try again.");
      },
    });
    await startWikiIngest();
    const refused = useCbe.getState().wikiIngest[COURSE]!;
    expect(refused.running).toBe(false);
    expect(refused.notice).toMatch(/did not answer/i);

    // The other half: the run starts, and the model never answers one document.
    Object.assign(window.cbe, { ingestToWiki });
    const run = startWikiIngest();
    progress("skript.pdf", "failed", "no response from the model endpoint for 120s — check that it is running");
    resolveIngest!([
      {
        ok: false,
        filename: "skript.pdf",
        rawRelPath: "raw/skript.pdf.md",
        status: "failed",
        error: "no response from the model endpoint for 120s — check that it is running",
      },
    ]);
    await run;
    const failed = useCbe.getState().wikiIngest[COURSE]!;
    expect(failed.running).toBe(false);
    expect(failed.notice).toBe("0 document(s) atomized, 1 failed.");
    expect(failed.docs[0]!.error).toMatch(/no response from the model endpoint/i);
  });

  // Scenario: A further ingest is possible without restarting the application
  it("re-arms the start control when the lecturer aborts a run whose promise never resolves", async () => {
    // The run that hangs: `ingestToWiki()` never settles, which is exactly what
    // an unreachable endpoint used to produce — and what left the guard armed
    // for the rest of the application's life.
    Object.assign(window.cbe, { ingestToWiki: vi.fn(() => new Promise<WikiIngestResult[] | null>(() => {})) });
    void startWikiIngest();
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);

    await endWikiIngestRun(COURSE);
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false);
    expect(useCbe.getState().wikiIngest[COURSE]!.notice).toBe("Ingestion aborted.");

    // …and a further ingest is accepted, with no restart involved.
    Object.assign(window.cbe, { ingestToWiki });
    void startWikiIngest();
    expect(ingestToWiki).toHaveBeenCalledTimes(1);
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);
  });

  // Scenario: A late outcome never ends the run that followed it
  it("discards the outcome of an aborted run instead of ending the run that followed it", async () => {
    const stuck = startWikiIngest();
    const resolveStuck = resolveIngest!;
    await endWikiIngestRun(COURSE);

    // The lecturer starts again; this is now the live run.
    const second = startWikiIngest();
    progress("folien.pptx", "running");
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(true);

    // The first run finally answers. Applying it here would re-arm the start
    // control behind a live ingest and wipe its notice — the data loss the start
    // guard exists to prevent, arriving through a different door.
    resolveStuck([{ ok: true, filename: "skript.pdf", rawRelPath: "raw/skript.pdf.md", atoms: [] }]);
    await stuck;
    const live = useCbe.getState().wikiIngest[COURSE]!;
    expect(live.running).toBe(true);
    expect(live.notice).toBeNull();
    expect(live.docs.map((d) => d.filename)).toEqual(["folien.pptx"]);

    resolveIngest!([{ ok: true, filename: "folien.pptx", rawRelPath: "raw/folien.pptx.md", atoms: [] }]);
    await second;
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false);
    expect(useCbe.getState().wikiIngest[COURSE]!.notice).toBe("1 document(s) atomized.");
  });

  // Scenario: A late progress event never lands in the run that followed it
  it("discards a superseded run's progress instead of upserting it into the live run's rows", async () => {
    const stuck = startWikiIngest();
    const staleToken = lastIngestToken;
    progress("skript.pdf", "running");
    await endWikiIngestRun(COURSE);

    // The lecturer starts again, picking the same document plus another one.
    void startWikiIngest();
    progress("skript.pdf", "running");
    progress("folien.pptx", "extracting");

    // The abandoned run reports afterwards — its abort progress reaches the
    // renderer only after `abortWikiIngest()` has resolved, so this ordering is
    // the ordinary one rather than an exotic race.
    progress("skript.pdf", "aborted", "Ingestion aborted", staleToken);
    progress("altklausur.pdf", "failed", "no response from the model endpoint", staleToken);

    const live = useCbe.getState().wikiIngest[COURSE]!;
    // The live document keeps its own status, and the document this run never
    // picked is not a row at all.
    expect(live.docs.map((d) => [d.filename, d.status])).toEqual([
      ["skript.pdf", "running"],
      ["folien.pptx", "extracting"],
    ]);
    // …so the rail counts the live run only, with no phantom settled document.
    expect(wikiIngestActivity(useCbe.getState().wikiIngest)).toEqual({ running: true, settled: 0, total: 2 });
    void stuck;
  });

  // Scenario: The lecturer is told what the abort actually did
  it("names an abort that reached the run, and does not claim one that reached nothing", async () => {
    // Delivered: the run is atomizing, so the main process has a controller to
    // signal and says so.
    void startWikiIngest();
    await endWikiIngestRun(COURSE);
    expect(useCbe.getState().wikiIngest[COURSE]!.notice).toBe("Ingestion aborted.");
    expect(useCbe.getState().wikiIngest[COURSE]!.running).toBe(false);

    // Not delivered: the run is still pre-flighting the endpoint or extracting
    // into `inbox/` and `raw/`, so the abort reaches nothing and that run keeps
    // going. The record still ends — that is the recovery guarantee — but it must
    // not report an abort that did not happen.
    Object.assign(window.cbe, { abortWikiIngest: vi.fn(async () => ({ ok: true as const, delivered: false })) });
    void startWikiIngest();
    await endWikiIngestRun(COURSE);
    const undelivered = useCbe.getState().wikiIngest[COURSE]!;
    expect(undelivered.running).toBe(false);
    expect(undelivered.notice).not.toBe("Ingestion aborted.");
    expect(undelivered.notice).toMatch(/reached no running atomization/i);
  });
});
