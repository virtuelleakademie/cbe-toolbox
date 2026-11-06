/**
 * The top-level conversation mirror is cleared by a course switch (capability
 * `course-workspace`, Requirement: Course-Scoped Isolation of Canvas, Step, Maturity
 * and Decision State — Scenarios: *A switch into an unresolved course presents no
 * conversation at all*; *A switch whose conversation resolution fails does not fall
 * back to the previous course*; *Returning to a course restores exactly its own
 * state*).
 *
 * The defect this pins: `setCourses` / `setActiveCourse` projected `emptyDesignState()`
 * for a course with no conversation slice, and that projection covered the four design
 * states only — `session`, `turns`, `live`, `agentRunning`, `notice`, `dispatchPending`,
 * `chatNotice`, `offerReasoningRemediation`, `cutOffNote`, `stopTimedOut` and the three
 * context-occupancy fields kept the OUTGOING course's values.
 *
 * The sweep is deliberately not a hand-written key list. It derives the set of mirror
 * keys from the store itself — every key a hydration CHANGED against a cold store — so a
 * field added to `project()` later is swept without anyone remembering to add it here.
 * Two hand-maintained lists drifting apart is the whole defect; a third would be the
 * same mistake.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { emptyConversationMirror, project, useCbe, type CbeState } from "../src/renderer/state/store.js";
import { newConversation } from "../src/renderer/state/conversationReducer.js";
import { testSession } from "./helpers/conversation.js";
import type { ConversationOpenResult, CourseSummary } from "../src/shared/ipc-contract.js";
import type { MaturitySnapshot } from "@cbe/pi-bridge/maturity";

const COURSES: CourseSummary[] = [
  { id: "course-a", title: "Course A", path: "/space/courses/course-a" },
  { id: "course-b", title: "Course B", path: "/space/courses/course-b" },
];

/** Keys that legitimately differ after a switch: they are not the mirror. */
const NOT_THE_MIRROR = new Set(["conversations", "activeCourseId", "courses"]);

/** A rich `conversationOpen` payload — every mirror field it can reach carries a
 * value distinctive enough that leaving it standing is unmistakable. */
function richOpenResult(sessionId: string, courseId: string): ConversationOpenResult {
  return {
    session: testSession(sessionId, courseId),
    turns: [
      { role: "user", text: `${courseId} question` },
      { role: "assistant", text: `${courseId} answer` },
    ],
    agentRunning: true,
    canvas: [{ step: 1, id: "module-meta", label: "Module meta", value: `${courseId} frame`, state: "draft" }],
    steps: [{ step: 2, depth: "rough", focus: true }],
    maturity: { "societal-challenge": { current: 2, target: 3 } } as MaturitySnapshot,
    contextUsage: { used: 4200, window: 100000 },
    notice: `${courseId} notice`,
  };
}

/** Snapshot of the whole store, for a key-by-key comparison. */
function snapshot(): Record<string, unknown> {
  return { ...(useCbe.getState() as unknown as Record<string, unknown>) };
}

/** Keys whose value differs between two snapshots, excluding the non-mirror ones. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter(
    (k) => !NOT_THE_MIRROR.has(k) && typeof after[k] !== "function" && !Object.is(after[k], before[k])
  );
}

describe("the empty mirror and the projection are one list", () => {
  /**
   * The DRIFT GUARD, and the reason this file exports two internals.
   *
   * `emptyConversationMirror()` derives its type from `project`, but **no gate in this
   * repo typechecks the renderer** — the app's `build` runs `tsc` over
   * `src/shared/i18n` only and ESLint carries no type-aware rules — so that link would
   * hold nothing on its own. This is the assertion that actually runs: whatever the
   * mirror can be filled WITH must be emptiable OF. A key added to `project()` without
   * an answer here fails under `npm test`, which is the exact drift that produced the
   * defect this file pins.
   */
  it("the empty mirror answers every key the projection writes", () => {
    const projected = Object.keys(project(newConversation(testSession()))).sort();
    const emptied = Object.keys(emptyConversationMirror()).sort();
    expect(emptied).toEqual([...projected, "annotations"].sort());
  });
});

describe("the conversation mirror does not survive a course switch", () => {
  let cold: Record<string, unknown>;

  beforeEach(() => {
    useCbe.getState().reset();
    cold = snapshot();
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-a" });
    useCbe.getState().hydrateConversation(richOpenResult("session-a", "course-a"));
  });

  it("clears every key the hydration touched when the target course has no conversation", () => {
    const populated = snapshot();
    const touched = changedKeys(cold, populated);
    // Guard the guard: if the seed stopped populating the mirror, the sweep below
    // would pass vacuously.
    expect(touched).toContain("session");
    expect(touched).toContain("turns");
    expect(touched.length).toBeGreaterThan(8);

    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });

    const after = snapshot();
    const stale = touched.filter(
      (k) => !Object.is(after[k], cold[k]) && JSON.stringify(after[k]) !== JSON.stringify(cold[k])
    );
    expect(stale).toEqual([]);
  });

  it("presents no conversation identity for the unresolved course", () => {
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    const s = useCbe.getState();
    expect(s.session).toBeNull();
    expect(s.turns).toEqual([]);
    expect(s.agentRunning).toBe(false);
    expect(s.notice).toBeNull();
    expect(s.live.streaming).toBe(false);
    expect(s.contextUsage).toBeNull();
    expect(s.contextEverMeasured).toBe(false);
  });

  it("clears the mirror on the setActiveCourse path too", () => {
    useCbe.getState().setActiveCourse("course-b");
    expect(useCbe.getState().session).toBeNull();
    expect(useCbe.getState().turns).toEqual([]);
  });

  it("leaves the empty state standing when the resolution never arrives", () => {
    useCbe.getState().setHydration("pending");
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    // The switch failed: no `hydrateConversation` ever runs for course B.
    useCbe.getState().setHydration("error", "EACCES: permission denied");

    const s = useCbe.getState();
    expect(s.hydration).toBe("error");
    expect(s.session).toBeNull();
    expect(s.turns).toEqual([]);
    // ... and course A's conversation is still preserved for course A.
    expect(Object.keys(s.conversations)).toEqual(["session-a"]);
  });

  it("still projects the target course's own conversation when it HAS one", () => {
    // The masking condition, as a counterfactual: same switch, one condition
    // different — course B has been visited, so its slice exists.
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    useCbe.getState().hydrateConversation(richOpenResult("session-b", "course-b"));
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-a" });
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });

    const s = useCbe.getState();
    expect(s.session?.sessionId).toBe("session-b");
    expect(s.turns.map((t) => ("text" in t ? t.text : ""))).toContain("course-b question");
    expect(s.notice).toBe("course-b notice");
  });

  it("restores course A's own conversation on the way back", () => {
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-b" });
    useCbe.getState().setCourses({ courses: COURSES, activeCourseId: "course-a" });

    const s = useCbe.getState();
    expect(s.session?.sessionId).toBe("session-a");
    expect(s.turns.map((t) => ("text" in t ? t.text : ""))).toContain("course-a question");
  });

  it("reset() leaves no conversation field behind either", () => {
    useCbe.getState().setDispatchPending(true);
    useCbe.getState().setChatNotice({ text: "left over" });
    useCbe.getState().reset();
    const s = useCbe.getState() as unknown as CbeState;
    expect(s.dispatchPending).toBe(false);
    expect(s.chatNotice).toBeNull();
    expect(s.session).toBeNull();
  });
});
