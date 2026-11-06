import { useCbe } from "../state/store.js";
import { chrome } from "../chrome.js";
import type { CourseListResult } from "../../shared/ipc-contract.js";

/**
 * Full workspace swap on course switch (capability `course-workspace`,
 * Requirement: Active Course and Course Switching):
 *
 *  1. A session open in the outgoing course STAYS OPEN in the background — the
 *     switch never closes it. A running agent turn continues undisturbed; its
 *     output lands in that course's conversation slice and is persisted into
 *     that course's `sessions/` folder through the regular turn-boundary flush.
 *  2. Activate the target course (the main process persists the pointer and
 *     returns the fresh course list).
 *  3. Re-enter the target course's canonical conversation via `conversationOpen`
 *     (capability `desktop-app`, Requirement: Renderer Boot-Hydration from the
 *     Main Process) — the main process resolves re-attach / resume / fresh
 *     start; the renderer only hydrates what main reports. Switching back to a
 *     course with an open session re-attaches to it (same sessionId).
 *
 * Shared by the header course switcher (primary switching surface) and the
 * left panel's one-click activation on a card — both are the same swap.
 */

/** Refusal while a conversation resolution is still in flight — a switch must
 * not race the resume (capability `course-workspace`, Requirement: Active
 * Course and Course Switching: the ONLY switch guard). Catalogue-owned, so it is
 * composed in the interface language; surfaced through the caller's regular error
 * path. */
export function hydrationInFlightSwitchNotice(): string {
  return chrome().coursesHydrationInFlightSwitchNotice;
}

/**
 * The only switch guard: an in-flight boot- or switch-hydration. A RUNNING
 * agent turn no longer refuses the switch — navigating away is not a close;
 * the turn continues in the background (destructive actions on a running
 * conversation — fresh reset, explicit close — keep their guards main-side).
 */
function assertSwitchable(): void {
  if (useCbe.getState().hydration === "pending") throw new Error(hydrationInFlightSwitchNotice());
}

/** Shared swap tail: activate (optionally create first), then hydrate the
 * target course's canonical conversation from the main process. The outgoing
 * course's session is left open — its slice keeps receiving events. */
async function swapTo(activate: () => Promise<void>): Promise<void> {
  const state = useCbe.getState();
  state.setHydration("pending");
  try {
    await activate();
    // Canonical-conversation re-entry — re-attach / resume / fresh start is the
    // main process's decision; unreadable-archive notices ride
    // along in the result and land in the notice banner via hydrateConversation.
    const conv = await window.cbe.openConversation();
    useCbe.getState().hydrateConversation(conv);
    useCbe.getState().setHydration("ready");
  } catch (err) {
    useCbe.getState().setHydration("error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function switchCourse(courseId: string): Promise<void> {
  const state = useCbe.getState();
  if (courseId === state.activeCourseId) return;
  assertSwitchable();
  await swapTo(async () => {
    const result = await window.cbe.setActiveCourse(courseId);
    useCbe.getState().setCourses(result);
  });
}

/**
 * Resume a stored conversation as its course's open conversation (capability
 * `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki; model
 * semantics in `course-workspace`, Requirement: Stored Conversations Are
 * Resumable).
 *
 * Selecting a chat in a non-active course's detail view performs the regular
 * course switch FIRST — the lecturer who clicked a chat wants to be in it —
 * and then resumes directly, without hydrating the canonical conversation in
 * between (the resume IS the hydration). Every guard lives main-side: the
 * in-flight turn refusal, the unknown-id validation, the concurrent-resolution
 * refusal.
 *
 * Failure handling converges instead of guessing: a refused resume may leave
 * the current conversation open (refusals validate before closing), while a
 * start failure after the close leaves none — so on any failure the renderer
 * re-hydrates whatever the main process now holds via `openConversation` (the
 * one source of truth) and rethrows the original reason for the caller's
 * banner. Only when even that recovery fails does the hydration error state
 * carry the day — its retry re-runs `openConversation`.
 */
export async function resumeStoredConversation(courseId: string, sessionId: string): Promise<void> {
  assertSwitchable();
  // Pending goes up BEFORE the first await, exactly like `swapTo`: a second
  // click during the activation round-trip must hit `assertSwitchable`, not
  // start a second resolution in the gap.
  useCbe.getState().setHydration("pending");
  try {
    if (courseId !== useCbe.getState().activeCourseId) {
      const result = await window.cbe.setActiveCourse(courseId);
      useCbe.getState().setCourses(result);
    }
    const conv = await window.cbe.resumeConversation(courseId, sessionId);
    useCbe.getState().hydrateConversation(conv);
    useCbe.getState().setHydration("ready");
  } catch (err) {
    try {
      const conv = await window.cbe.openConversation();
      useCbe.getState().hydrateConversation(conv);
      useCbe.getState().setHydration("ready");
    } catch (recoveryErr) {
      useCbe.getState().setHydration("error", recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr));
    }
    throw err;
  }
}

/**
 * Adopt the course list the main process returned after a DELETION (capability
 * `course-workspace`, Requirement: Course Deletion from the Detail View,
 * Reversible via the OS Trash).
 *
 * The main process has already trashed the folder and re-resolved the active
 * course — the exactly-one-active-course invariant is settled before this runs.
 * Two shapes follow from that:
 *
 *  - The deleted course was NOT active: the active course, its open session and
 *    the visible conversation are untouched; only the list refreshes.
 *  - The deleted course WAS active: main resolved a different course (or created
 *    a default one for an emptied Space), so the renderer must enter that
 *    course's canonical conversation — the SAME workspace swap a switch performs,
 *    reusing the swap tail rather than duplicating hydration logic.
 *
 * Deliberately no `assertSwitchable()`: the deletion has already happened on
 * disk, so refusing the follow-up hydration would strand the renderer pointing
 * at a course that no longer exists.
 *
 * The deleted course's conversation slice is dropped FIRST, before the list is
 * adopted: a course id is derived from the title's slug, so a course later
 * created under the same title would otherwise be projected with the deleted
 * course's turns, canvas artefacts and maturity.
 */
export async function adoptCourseListAfterDeletion(result: CourseListResult): Promise<void> {
  const previousActive = useCbe.getState().activeCourseId;
  useCbe.getState().dropConversationsOfRemovedCourses(result.courses.map((c) => c.id));
  if (result.activeCourseId === previousActive) {
    useCbe.getState().setCourses(result);
    return;
  }
  await swapTo(async () => {
    useCbe.getState().setCourses(result);
  });
}

/**
 * Create a course and make it active. Creation implies a switch, so the same
 * swap semantics apply: the outgoing course's session stays open in the
 * background, and the fresh course opens directly in the chat with a fresh
 * conversation directly in the chat view (no selection screen).
 */
export async function createCourseAndSwitch(title: string): Promise<void> {
  assertSwitchable();
  await swapTo(async () => {
    const created = await window.cbe.createCourse(title);
    const result = await window.cbe.setActiveCourse(created.id);
    useCbe.getState().setCourses(result);
  });
}
