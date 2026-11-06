import { useEffect, useRef, useState } from "react";
import { courseActivityOf, useCbe, type CourseActivity } from "../state/store.js";
import type { Turn } from "../state/conversationReducer.js";
import { WikiBrowser } from "./WikiBrowser.js";
import { ActionIcon } from "./ActionIcon.js";
import {
  adoptCourseListAfterDeletion,
  createCourseAndSwitch,
  resumeStoredConversation,
  switchCourse,
} from "../lib/course-switch.js";
import { formatDateTime, useChrome } from "../chrome.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";
import type {
  ConversationListEntry,
  ConversationListResult,
  CourseDeleteResult,
  CourseSummary,
} from "../../shared/ipc-contract.js";

/**
 * Per-course activity signal on the course cards (capability `desktop-app`,
 * Requirement: Background Conversations and Per-Session Event Demultiplexing):
 * a pulsing dot while the course's session has an agent turn in flight, a static
 * marker once a background run completed while the course was not visible.
 *
 * It used to be shared with the header's course-switcher dropdown; that dropdown
 * is gone (a second course list that could drift from this one), so the cards are
 * now the only per-course home — with the collapsed left rail carrying the
 * aggregate so a collapsed panel hides nothing (`LeftPanel.tsx`).
 */
export function CourseActivityDot({ activity }: { activity: CourseActivity }) {
  const t = useChrome();
  if (activity.running) {
    return (
      <span className="course-run-dot" role="img" aria-label={t.coursesAgentRunning} title={t.coursesAgentRunning} />
    );
  }
  if (activity.unseen) {
    return (
      <span
        className="course-unseen-dot"
        role="img"
        aria-label={t.coursesUnseenResult}
        title={t.coursesUnseenResultTitle}
      />
    );
  }
  return null;
}

/**
 * The LEFT panel's course surface — the real course workspace (capability
 * `course-workspace`; supersedes the Phase-1 mock). The surface term is
 * "Course" everywhere — "Project" is reserved for the students' project in CBE
 * terminology (course-workspace spec, Requirement: Course as a Local Folder).
 *
 * **Two levels, and the level lives in the store.** List + create + switch on the
 * list level; rename + delete in the title row plus the Chats | Wiki tabs on the
 * course detail level (Requirement: Course Detail Tabs: Chats and Wiki).
 * The left panel does not render this body while collapsed, so a component-local
 * level would be lost on every collapse cycle — and Requirement: Collapsible Left
 * Panel requires the level to survive them (`courseDetailId`).
 *
 * Courses come from the main-process folder scan via IPC; the renderer never
 * touches the filesystem. The detail view carries NO filesystem affordance —
 * no reveal control, no raw path (product decision 2026-08-19; Requirement:
 * Course Management in the UI): stored conversations are reached through the
 * Chats tab, not through the file manager.
 *
 * Deletion lives in the DETAIL level only (Requirement: Course Deletion from the
 * Detail View, Reversible via the OS Trash): on the list level a card's main
 * surface is the one-click activation control, so a delete affordance there
 * would sit one mis-click from the most destructive action the app has.
 */
export function CoursesPanel() {
  const t = useChrome();
  const courses = useCbe((s) => s.courses);
  const activeCourseId = useCbe((s) => s.activeCourseId);
  const conversations = useCbe((s) => s.conversations);
  const setCourses = useCbe((s) => s.setCourses);
  const openId = useCbe((s) => s.courseDetailId);
  const setOpenId = useCbe((s) => s.setCourseDetailId);
  const coursesFocusRequest = useCbe((s) => s.coursesFocusRequest);
  const coursesFocusHandled = useCbe((s) => s.coursesFocusHandled);
  const noteCoursesFocusHandled = useCbe((s) => s.noteCoursesFocusHandled);
  const listRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Deletion outcomes are announced here rather than inside CourseDetail: a
  // successful deletion unmounts the detail view, and a live region that
  // disappears in the same commit never announces anything.
  //
  // The sequence number is the announcement's identity, NOT its text: outcomes
  // repeat verbatim (the same refusal on a second attempt while the same turn is
  // still running; two same-titled courses deleted in a row — titles are not
  // unique, only ids are), and re-rendering identical text into the same node
  // mutates nothing, so assistive technology stays silent where the sighted user
  // sees the banner again.
  const [announcement, setAnnouncement] = useState<{ seq: number; text: string }>({ seq: 0, text: "" });
  const announce = (text: string) => setAnnouncement((prev) => ({ seq: prev.seq + 1, text }));

  // Refresh the scan on mount — the folder is the source of truth (external
  // edits, e.g. a course.md changed in an editor, become visible here).
  useEffect(() => {
    void window.cbe
      .listCourses()
      .then(setCourses)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [setCourses]);

  const course = openId ? (courses.find((c) => c.id === openId) ?? null) : null;

  // The header's active-course name reveals this panel and moves focus into the
  // course list (Requirement: App Header Strip), so the lecturer who reached for
  // the course name lands where a single click switches. A counter, not a flag:
  // two reveals in a row must both move focus.
  //
  // Each request is consumed exactly once, and the marker lives in the store
  // because this component REMOUNTS on every expansion (the left panel does not
  // render its body while collapsed). Without it, this mount effect would fire
  // again on a rail or edge-toggle expansion and pull focus off whatever the
  // lecturer was on — including the edge toggle they had just pressed. Only the
  // header reveal is specified to move focus.
  useEffect(() => {
    if (coursesFocusRequest === 0 || coursesFocusRequest === coursesFocusHandled) return;
    noteCoursesFocusHandled(coursesFocusRequest);
    listRef.current?.querySelector<HTMLElement>(".proj-open, .proj-plus")?.focus();
  }, [coursesFocusRequest, coursesFocusHandled, noteCoursesFocusHandled]);

  // ONE return with the detail/list switch INSIDE it, so the live region keeps
  // the same position under the same fragment root across the transition. React
  // reconciles children by position: the first child changes type and remounts,
  // the announcer node survives. Two separate returns (fragment root vs. div
  // root) would remount the whole subtree, and a live region that already
  // carries its text when it is inserted is generally not announced — which
  // would silence exactly the successful deletion (Requirement: Course
  // Management in the UI — the deletion outcome is announced through a live
  // region).
  return (
    <>
      {course ? (
        <CourseDetail
          course={course}
          isActive={course.id === activeCourseId}
          onBack={() => setOpenId(null)}
          onAnnounce={announce}
          onDeleted={() => setOpenId(null)}
          onError={setError}
        />
      ) : (
        <div className="courses-panel" ref={listRef}>
          <div className="panel-intro">{t.coursesIntro}</div>
          {error && (
            <div className="banner-error" role="alert">
              {error}
            </div>
          )}
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              isActive={c.id === activeCourseId}
              activity={courseActivityOf(conversations, c.id)}
              onOpen={() => setOpenId(c.id)}
              onError={setError}
            />
          ))}
          <CreateCoursePlusCard onError={setError} />
        </div>
      )}
      {/* TWO regions, written alternately by the announcement's sequence number.
          Each announcement lands in the region the previous one did not use, so
          it is always a genuine "" → text change in that node — the change
          assistive technology listens for. Both regions are permanent siblings
          of the detail/list switch above, so neither is ever remounted with its
          text already in place. */}
      <span className="visually-hidden" aria-live="polite">
        {announcement.seq % 2 === 1 ? announcement.text : ""}
      </span>
      <span className="visually-hidden" aria-live="polite">
        {announcement.seq % 2 === 0 ? announcement.text : ""}
      </span>
    </>
  );
}

function CourseCard({
  course,
  isActive,
  activity,
  onOpen,
  onError,
}: {
  course: CourseSummary;
  isActive: boolean;
  activity: CourseActivity;
  onOpen: () => void;
  onError: (msg: string | null) => void;
}) {
  const t = useChrome();
  const activate = async () => {
    if (isActive) return;
    onError(null);
    try {
      await switchCourse(course.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  // The card's main surface IS the activation control — one click on the list
  // level performs the workspace swap (Requirement: Course Management in the
  // UI, Scenario: One-click activation from the course list); the active card
  // is marked by an accented frame plus the badge. The detail view is reached
  // via the explicit chevron affordance — a separate sibling control, since
  // nested buttons are invalid HTML.
  return (
    <div className={isActive ? "proj proj-row proj-active" : "proj proj-row"}>
      {/* The folder slug is secondary detail only (tooltip) — the primary
          surface shows the title plus content meta instead of a raw identifier. */}
      <button type="button" className="proj-open" title={course.id} onClick={() => void activate()}>
        <span className="proj-top">
          <span className="proj-title">{course.title}</span>
          <CourseActivityDot activity={activity} />
          {isActive && <span className="proj-badge mono">{t.coursesActiveBadge}</span>}
        </span>
        <span className="proj-foot">{formatCourseMeta(course, t)}</span>
      </button>
      <button
        type="button"
        className="pp-icon-btn proj-more"
        aria-label={t.coursesDetailsLabel}
        title={t.coursesDetailsLabel}
        onClick={onOpen}
      >
        <ActionIcon kind="chevron" />
      </button>
    </div>
  );
}

/** Card meta line. Deliberately NO conversation count: the list level lists
 * courses and nothing else (Requirement: Course Management in the UI) — a
 * course's stored conversations live in its detail view's Chats tab, and the
 * course re-enters exactly one of them (capability `course-workspace`,
 * Requirement: One Canonical Conversation per Course). */
function formatCourseMeta(course: CourseSummary, t: ChromeCatalogue): string {
  return t.coursesWikiAtomCount({ count: course.atomCount ?? 0 });
}

/**
 * Course creation as a dashed plus-card at the end of the course list (analogous
 * to the composer's attach affordance): the card itself is the "New course"
 * button; clicking it reveals an inline title field with create/cancel.
 *
 * This is the app's ONLY course-creation entry point (capability `desktop-app`,
 * Requirement: Course Management in the UI). The header used to carry a second
 * one inside its switcher dropdown; both are gone.
 */
export function CreateCoursePlusCard({
  onError,
  onCreated,
}: {
  onError: (msg: string | null) => void;
  onCreated?: () => void;
}) {
  const t = useChrome();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    onError(null);
    try {
      // A newly created course becomes the active one — the lecturer created it
      // to work in it. Creation implies a switch, so the shared swap semantics
      // apply (running session closed cleanly, fresh course opens directly in
      // the chat with a fresh conversation).
      await createCourseAndSwitch(trimmed);
      setTitle("");
      setEditing(false);
      onCreated?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" className="proj proj-plus" onClick={() => setEditing(true)}>
        <ActionIcon kind="plus" />
        {t.coursesNewCourse}
      </button>
    );
  }

  return (
    <form
      className="proj proj-create"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="proj-create-input"
        placeholder={t.coursesNewCourseTitlePlaceholder}
        aria-label={t.coursesNewCourseTitlePlaceholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setEditing(false), setTitle(""))}
        disabled={busy}
      />
      <button
        type="submit"
        className="pp-icon-btn"
        aria-label={t.coursesCreateLabel}
        title={t.coursesCreateLabel}
        disabled={busy || !title.trim()}
      >
        <ActionIcon kind="check" />
      </button>
      <button
        type="button"
        className="pp-icon-btn"
        aria-label={t.coursesCancelLabel}
        title={t.coursesCancelLabel}
        onClick={() => {
          setEditing(false);
          setTitle("");
        }}
      >
        <ActionIcon kind="cross" />
      </button>
    </form>
  );
}

function CourseDetail({
  course,
  isActive,
  onBack,
  onAnnounce,
  onDeleted,
  onError,
}: {
  course: CourseSummary;
  isActive: boolean;
  onBack: () => void;
  onAnnounce: (message: string) => void;
  onDeleted: () => void;
  /** Failures that arrive AFTER the detail view has been left — this view's own
   * banner would unmount with it, the list's banner survives. */
  onError: (message: string) => void;
}) {
  const t = useChrome();
  const setCourses = useCbe((s) => s.setCourses);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(course.title);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tab = useCbe((s) => s.courseDetailTab);
  const setTab = useCbe((s) => s.setCourseDetailTab);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  // Cancel is the default answer (Requirement: Course Deletion from the Detail
  // View — "the cancelling choice MUST be the one a lecturer reaches by
  // default"): it holds focus the moment the confirmation is armed, so a stray
  // Enter cancels rather than deletes.
  useEffect(() => {
    if (confirmDelete) cancelDeleteRef.current?.focus();
  }, [confirmDelete]);

  const activate = async () => {
    setError(null);
    try {
      // Same workspace swap as a one-click activation on the list level
      // (Requirement: Active Course and Course Switching) — close running
      // session, re-enter the target's
      // canonical conversation (fresh conversation when none exists).
      await switchCourse(course.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const rename = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === course.title) {
      setRenaming(false);
      return;
    }
    setError(null);
    try {
      await window.cbe.renameCourse(course.id, trimmed);
      setCourses(await window.cbe.listCourses());
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Confirmed deletion (Requirement: Course Deletion from the Detail View,
   * Reversible via the OS Trash). Every guard that matters lives main-side — the
   * in-flight refusal, the clean session close, the trash call, the re-resolved
   * active course; this handler owns the surface consequences only: announce the
   * outcome honestly, adopt the returned list (swapping into the new active
   * course when the deleted one was active), and leave the detail view.
   *
   * `trashed: false` is a success too — the folder was already gone outside the
   * app — but it is phrased differently, because claiming a move to the trash
   * that never happened would be a lie the lecturer might rely on.
   */
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    let result: CourseDeleteResult;
    try {
      result = await window.cbe.deleteCourse(course.id);
    } catch (err) {
      // Refusal (a turn is running in this course) and failure (the trash
      // operation did not succeed) share this path: the course is still there,
      // the surface stays usable, and the reason is both readable and announced.
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onAnnounce(message);
      setConfirmDelete(false);
      setDeleting(false);
      return;
    }
    onAnnounce(
      result.trashed
        ? t.coursesDeletedTrashed({ title: course.title })
        : t.coursesDeletedMissing({ title: course.title })
    );
    // Leaving the detail view follows the DELETION, not the follow-up hydration:
    // the course is gone from disk either way, and a hydration that rejects (an
    // unconfigured provider, say) must not leave the panel holding the deleted
    // course's id — ids are title slugs, so a course created later under the
    // same title would open straight into its detail view.
    onDeleted();
    try {
      await adoptCourseListAfterDeletion(result);
    } catch (err) {
      // The deletion itself succeeded; only entering the new active course's
      // conversation failed. Reported on the list this handler just returned to.
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
      onAnnounce(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="pp">
      <button type="button" className="pp-back" onClick={onBack}>
        {t.coursesBack}
      </button>
      <div className="pp-kicker mono">{t.coursesKicker}</div>
      {renaming ? (
        <form
          className="pp-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <input
            type="text"
            className="pp-rename-input"
            aria-label={t.coursesTitleFieldLabel}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
          />
          <button type="submit" className="pp-icon-btn" aria-label={t.coursesSaveLabel} title={t.coursesSaveLabel}>
            <ActionIcon kind="check" />
          </button>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label={t.coursesCancelLabel}
            title={t.coursesCancelLabel}
            onClick={() => setRenaming(false)}
          >
            <ActionIcon kind="cross" />
          </button>
        </form>
      ) : (
        <div className="pp-title-row">
          <h2 className="pp-title">{course.title}</h2>
          <button
            type="button"
            className="pp-icon-btn"
            aria-label={t.coursesRenameLabel}
            title={t.coursesRenameLabel}
            onClick={() => setRenaming(true)}
          >
            <ActionIcon kind="pencil" />
          </button>
          {/* Delete lives in the title row beside the rename control (Requirement:
              Course Management in the UI) — an icon trigger, but still two steps,
              never one: activating it only ARMS the confirmation below. */}
          <button
            type="button"
            className="pp-icon-btn"
            aria-label={t.coursesDeleteLabel}
            title={t.coursesDeleteLabel}
            onClick={() => setConfirmDelete(true)}
          >
            <ActionIcon kind="trash" />
          </button>
        </div>
      )}
      {error && (
        <div className="banner-error" role="alert">
          {error}
        </div>
      )}

      {/* No filesystem affordance anywhere in the detail view — no reveal control,
          no raw path (product decision 2026-08-19; Requirement: Course Management
          in the UI). Stored conversations are reached through the Chats tab. */}
      <div className="pp-actions">
        {isActive ? (
          <span className="proj-badge mono">{t.coursesActiveBadge}</span>
        ) : (
          <button type="button" className="pp-action" onClick={() => void activate()}>
            {t.coursesSetActive}
          </button>
        )}
      </div>

      {/* Deletion (Requirement: Course Deletion from the Detail View, Reversible
          via the OS Trash) — two steps, never one. Arming shows what travels
          with the folder and says what actually happens ("moved to your system
          trash"), because the lecturer should expect the recoverable outcome
          they get. Cancel comes FIRST in DOM order and takes focus, so the
          destructive path is never the convenient one; Escape dismisses.

          The four nouns are JOINTLY GOVERNED — capability `course-workspace`,
          Requirement: Course Deletion from the Detail View, and capability
          `desktop-app`, Requirement: Course Management in the UI dictate the same
          rendered string, so the two must stay word-for-word aligned in any later
          edit. They name the module design on the CBE Process Canvas rather than
          a retired category label: at the app's most destructive moment the
          lecturer must read what actually disappears. Moving the trigger into the
          title row changed NOTHING here — the armed confirmation and its copy are
          exactly the ones the body placement carried. */}
      {confirmDelete && (
        <div
          className="set-erase-confirm"
          role="group"
          aria-label={t.coursesConfirmDeletionLabel}
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmDelete(false);
          }}
        >
          <p className="set-note set-note-warn">{t.coursesDeleteConfirmText({ title: course.title })}</p>
          <div className="set-actions">
            <button
              ref={cancelDeleteRef}
              className="set-secondary"
              type="button"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              {t.coursesCancelLabel}
            </button>
            <button className="set-danger" type="button" disabled={deleting} onClick={() => void remove()}>
              {t.coursesMoveToTrash}
            </button>
          </div>
        </div>
      )}

      {/* Chats | Wiki (Requirement: Course Detail Tabs: Chats and Wiki). The tab
          choice lives in the store like the LEVEL does (`courseDetailId`): the
          collapsed panel unmounts this body, and a collapse over the Wiki tab
          must re-expand on the Wiki tab — the lecturer-wiki run rows "show again
          on re-expanding" only if the choice survives the cycle. Opening another
          course's detail resets it to the Chats default (store). */}
      <div className="panel-tabs pp-tabs" role="tablist" aria-label={t.coursesContentTabsLabel}>
        {(["chats", "wiki"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="panel-tab"
            aria-current={tab === id ? "true" : undefined}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {id === "chats" ? t.coursesTabChats : t.coursesTabWiki}
          </button>
        ))}
      </div>
      {tab === "chats" ? <ConversationList course={course} onError={setError} /> : <WikiBrowser courseId={course.id} />}
    </div>
  );
}

/** Longest snippet a row carries — mirrors the main-side scan's cut. */
const ROW_SNIPPET_MAX_CHARS = 96;

/** The OPEN row's live snippet: first non-empty line of the first user turn the
 * store holds, cut like the main-side scan. Undefined while no user turn exists. */
function liveSnippet(turns: Turn[]): string | undefined {
  const first = turns.find((t): t is Extract<Turn, { role: "user" }> => t.role === "user");
  const line = first?.text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > ROW_SNIPPET_MAX_CHARS ? `${line.slice(0, ROW_SNIPPET_MAX_CHARS - 1)}…` : line;
}

function formatConversationStamp(entry: ConversationListEntry, t: ChromeCatalogue): string {
  const iso = entry.createdAt || entry.closedAt;
  if (!iso) return t.coursesConversationUndated;
  const d = new Date(iso);
  // Formatted for the ACTIVE INTERFACE LANGUAGE's declared tag rather than the
  // ambient system locale, which the interface setting does not decide
  // (Requirement: *Locale-Dependent Formatting Follows the Interface Language*).
  return isNaN(d.getTime()) ? t.coursesConversationUndated : formatDateTime(d);
}

/**
 * The Chats tab: the course's stored conversations, newest first, the open one
 * marked (Requirement: Course Detail Tabs: Chats and Wiki). Rows come from the
 * main-process sidecar scan; selecting one resumes it as THE course's open
 * conversation (capability `course-workspace`, Requirement: Stored Conversations
 * Are Resumable). Every guard lives main-side; the rows additionally disable
 * while this course's turn runs, with a readable reason — UI placement is not
 * authorization, but a dead click should still explain itself.
 */
function ConversationList({ course, onError }: { course: CourseSummary; onError: (msg: string | null) => void }) {
  const t = useChrome();
  const conversations = useCbe((s) => s.conversations);
  const activeCourseId = useCbe((s) => s.activeCourseId);
  const running = courseActivityOf(conversations, course.id).running;
  // The course's open conversation as the STORE knows it: the slice the open
  // pipeline hydrated for this course (exactly one per course — a fresh start
  // or a resume replaces it). Main reported that identity in the hydration
  // snapshot, so marking from it is not a renderer guess. It changes the
  // moment a New Session or a switch lands, long before this list re-reads.
  const hydratedOpenId = useCbe(
    (s) => Object.values(s.conversations).find((c) => c.session.courseId === course.id)?.session.sessionId ?? null
  );
  // The open row renders from the LIVE slice, not the one-time scan: turns land
  // in the store while the list stays mounted, and a re-read per turn is
  // exactly what the no-polling rule forbids. Every other row keeps its scan data.
  const liveTurns = useCbe((s) => (hydratedOpenId ? (s.conversations[hydratedOpenId]?.turns ?? null) : null));
  const [list, setList] = useState<ConversationListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Re-read on every mount (the tab switch and the collapse cycle both unmount
  // this body) AND whenever the course's open conversation changes under a
  // mounted list — a fresh start from the New Session control, a resume from
  // this list or any other open-pipeline path. The folder is the source of
  // truth; the store identity is only the trigger (no polling, no second
  // subscription: the hydration that changed the store is the event). A read
  // that resolves after a newer one started is dropped.
  useEffect(() => {
    let cancelled = false;
    void window.cbe
      .listConversations(course.id)
      .then((result) => {
        if (cancelled) return;
        setList(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [course.id, hydratedOpenId]);

  // Which row is open: the hydrated identity wins while the store holds a slice
  // for this course; the scan's report covers a course whose session is open
  // main-side but was never hydrated in this renderer (a background course
  // after a reload).
  const openSessionId = hydratedOpenId ?? list?.openSessionId;

  const resume = async (entry: ConversationListEntry) => {
    if (busyId || running || !entry.resumable) return;
    // Selecting the open conversation of the ACTIVE course has nothing to do;
    // in a non-active course it still switches the workspace to this course.
    if (entry.sessionId === openSessionId && course.id === activeCourseId) return;
    setBusyId(entry.sessionId);
    onError(null);
    try {
      // The hydration inside changes `hydratedOpenId`, which re-reads the list.
      await resumeStoredConversation(course.id, entry.sessionId);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) {
    return (
      <div className="banner-error" role="alert">
        {loadError}
      </div>
    );
  }
  if (!list) return <div className="chat-list-empty">{t.coursesConversationsLoading}</div>;
  if (list.conversations.length === 0) {
    return <div className="chat-list-empty">{t.coursesConversationsEmpty}</div>;
  }

  return (
    // A real <ul>/<li> WRAPPING the buttons, so both roles survive for
    // assistive technology: an explicit role="listitem" on the <button> itself
    // would override the implicit button role and announce a static list item —
    // muting the actionable/disabled semantics (review finding of change
    // `resume-course-conversations`, decided FIX).
    <ul className="chat-list" aria-label={t.coursesConversationsLabel}>
      {list.conversations.map((entry) => {
        const isOpen = entry.sessionId === openSessionId;
        const live = isOpen && entry.sessionId === hydratedOpenId ? liveTurns : null;
        const snippet = live ? liveSnippet(live) : entry.snippet;
        const turnCount = live ? live.length : entry.turnCount;
        const disabled = running || !entry.resumable || busyId !== null;
        const reason = running ? t.coursesChatsLockedReason : !entry.resumable ? entry.reason : undefined;
        return (
          <li key={entry.sessionId} className="chat-list-item">
            <button
              type="button"
              className={isOpen ? "chat-row chat-row-open" : "chat-row"}
              aria-current={isOpen ? "true" : undefined}
              disabled={disabled}
              title={reason ?? t.coursesConversationResumeTitle({ sessionId: entry.sessionId })}
              onClick={() => void resume(entry)}
            >
              <span className="chat-row-top">
                <span className="chat-row-date">{formatConversationStamp(entry, t)}</span>
                {isOpen && <span className="proj-badge mono">{t.coursesConversationOpenBadge}</span>}
              </span>
              <span className="chat-row-snippet">
                {snippet ?? (entry.resumable ? t.coursesConversationNoMessages : entry.reason)}
              </span>
              {turnCount !== undefined && (
                <span className="chat-row-meta mono">{t.coursesConversationTurnCount({ count: turnCount })}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
