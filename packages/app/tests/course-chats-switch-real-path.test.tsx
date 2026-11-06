/**
 * Chats-list behaviour on a LIVE switch, driven through the real resume
 * pipeline (change `keep-the-chats-order-stable`; capability `desktop-app`,
 * Requirement: Course Detail Tabs: Chats and Wiki):
 *
 *   row click -> `resumeStoredConversation` -> `window.cbe.resumeConversation`
 *   (stubbed at the preload boundary only, re-stamping the sidecar exactly as the
 *   main process's post-resume flush does) -> `hydrateConversation`; the list
 *   re-reads through the REAL main-side scan (`listStoredSessions`) over a real
 *   temp `sessions/` folder.
 *
 * One test per Scenario:
 * - "Switching the open conversation moves the open marker at once" (hardening:
 *   the freshness test drives the store directly, this one drives the path)
 * - "Resuming an older conversation keeps its row in place"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { useCbe } from "../src/renderer/state/store.js";
import { CoursesPanel } from "../src/renderer/components/CoursesPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import {
  listStoredSessions,
  readSessionJson,
  writeSessionJson,
  writeSessionMd,
  type SessionMeta,
} from "../src/main/sessions.js";
import type { ConversationListResult, ConversationOpenResult, CourseSummary } from "../src/shared/ipc-contract.js";

const COURSE_ID = "algorithmen";
const COURSES: CourseSummary[] = [{ id: COURSE_ID, title: "Algorithmen", path: "/space/courses/algorithmen" }];

const baseMeta: SessionMeta = {
  sessionId: "",
  modelId: "gemma4-31b",
  skillVersion: "0.1.12",
  environmentProfile: "app",
  createdAt: "",
  closedAt: "",
};
/** Three stored pairs, creation order OLDEST -> NEWEST: conv-old, conv-mid, conv-new. */
const PAIRS: SessionMeta[] = [
  { ...baseMeta, sessionId: "conv-old", createdAt: "2026-07-01T09:00:00.000Z", closedAt: "2026-07-02T09:00:00.000Z" },
  { ...baseMeta, sessionId: "conv-mid", createdAt: "2026-07-15T09:00:00.000Z", closedAt: "2026-07-16T09:00:00.000Z" },
  { ...baseMeta, sessionId: "conv-new", createdAt: "2026-08-10T09:00:00.000Z", closedAt: "2026-08-18T09:00:00.000Z" },
];

function openResult(sessionId: string): ConversationOpenResult {
  return {
    session: testSession(sessionId, COURSE_ID),
    turns: [],
    agentRunning: false,
    canvas: [],
  } as unknown as ConversationOpenResult;
}

let dir: string;
let openSessionId: string;

/** The preload `listConversations`, backed by the REAL main-side scan. */
async function listConversations(): Promise<ConversationListResult> {
  const stored = await listStoredSessions(dir);
  return {
    conversations: stored.map((s) => ({
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      resumable: s.resumable,
      ...(s.turnCount !== undefined ? { turnCount: s.turnCount } : {}),
      ...(s.snippet ? { snippet: s.snippet } : {}),
    })),
    openSessionId,
  };
}

/** The preload `resumeConversation`: what the main process does to the folder —
 * the resumed pair is flushed once, which re-stamps its `closedAt` to now. */
async function resumeConversation(_courseId: string, sessionId: string): Promise<ConversationOpenResult> {
  const stored = await readSessionJson(dir, sessionId);
  if (!stored) throw new Error("unknown");
  const restamped: SessionMeta = { ...stored.meta, closedAt: "2026-08-20T12:00:00.000Z" };
  await writeSessionMd(dir, restamped, stored.turns);
  await writeSessionJson(dir, restamped, stored.turns);
  openSessionId = sessionId;
  return openResult(stored.meta.sessionId);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cbe-chats-"));
  for (const m of PAIRS) {
    await writeSessionMd(dir, m, [{ role: "user", text: `Frage aus ${m.sessionId}` }]);
    await writeSessionJson(dir, m, [{ role: "user", text: `Frage aus ${m.sessionId}` }]);
  }
  openSessionId = "conv-new";
  seedConversation({ session: testSession("conv-new", COURSE_ID) });
  useCbe.setState({ courses: COURSES, activeCourseId: COURSE_ID, hydration: "ready" });
  Object.assign(window.cbe, {
    listCourses: async () => ({ courses: COURSES, activeCourseId: COURSE_ID }),
    listConversations: vi.fn(listConversations),
    resumeConversation: vi.fn(resumeConversation),
  });
});

afterEach(async () => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "", hydration: "idle", hydrationError: null });
  await rm(dir, { recursive: true, force: true });
});

async function openChatsTab() {
  render(<CoursesPanel />);
  const card = screen.getByText("Algorithmen").closest(".proj") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Course details" }));
  const list = await screen.findByRole("list", { name: "Stored conversations" });
  const rows = () => within(list).getAllByRole("button");
  const idOf = (b: HTMLElement) => /\(([^)]+)\)$/.exec(b.title)?.[1];
  const order = () => rows().map(idOf);
  const openId = () => rows().find((b) => b.getAttribute("aria-current") === "true");
  return { rows, order, openId, idOf };
}

describe("Scenario: Switching the open conversation moves the open marker at once", () => {
  it("moves border and badge to the resumed row through the real resume pipeline", async () => {
    const { rows, idOf, openId } = await openChatsTab();
    expect(idOf(openId()!)).toBe("conv-new");

    fireEvent.click(rows().find((b) => idOf(b) === "conv-old")!);
    await waitFor(() => expect(window.cbe.resumeConversation).toHaveBeenCalledWith(COURSE_ID, "conv-old"));

    await waitFor(() => expect(idOf(openId()!)).toBe("conv-old"));
    const resumed = openId()!;
    expect(resumed.className).toContain("chat-row-open");
    expect(within(resumed).getByText("open")).toBeTruthy();
    const previous = rows().find((b) => idOf(b) === "conv-new")!;
    expect(previous.getAttribute("aria-current")).toBeNull();
    expect(previous.className).not.toContain("chat-row-open");
    expect(within(previous).queryByText("open")).toBeNull();
    expect(useCbe.getState().conversations["conv-new"]).toBeUndefined();
  });
});

describe("Scenario: Resuming an older conversation keeps its row in place", () => {
  it("keeps the resumed row at its index after the post-resume re-read; only the marker moves", async () => {
    const { rows, order, idOf, openId } = await openChatsTab();
    expect(order()).toEqual(["conv-new", "conv-mid", "conv-old"]);

    fireEvent.click(rows().find((b) => idOf(b) === "conv-mid")!);
    await waitFor(() => expect(idOf(openId()!)).toBe("conv-mid"));
    // The re-read triggered by the hydrated identity has landed once the scan
    // was asked a second time and its result rendered: the list is settled.
    await waitFor(() => expect(window.cbe.listConversations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(order()).toHaveLength(3));

    expect(order()).toEqual(["conv-new", "conv-mid", "conv-old"]);
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    expect(rows()[0]!.getAttribute("aria-current")).toBeNull();
    // The flush did re-stamp the pair on disk — the order key simply is not that stamp.
    expect((await readSessionJson(dir, "conv-mid"))!.meta.closedAt).toBe("2026-08-20T12:00:00.000Z");
    // The row's date label reads the creation stamp too, so what the eye reads matches the order.
    const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const label = rows()[1]!.querySelector(".chat-row-date")!.textContent;
    expect(label).toBe(fmt("2026-07-15T09:00:00.000Z"));
    expect(label).not.toBe(fmt("2026-08-20T12:00:00.000Z"));
  });
});
