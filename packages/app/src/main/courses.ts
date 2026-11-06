import path from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { chrome } from "./interface-language.js";

/**
 * Course workspace store (capability `course-workspace`, Requirement: Course as a
 * Local Folder). A course is a self-contained folder under `<userData>/courses/<id>/`
 * — no central database, no central index. Courses are discovered by scanning the
 * `courses/` directory for folders that carry a `course.md`.
 *
 * This module is deliberately electron-free (parameterised by the courses root)
 * so it is unit-testable against a temp directory.
 */

export const COURSE_SUBFOLDERS = ["sessions", "canvas", "reflections", "inbox", "raw", "wiki"] as const;

export interface CourseSummary {
  id: string;
  title: string;
  /** Absolute path of the course folder. */
  path: string;
  createdAt?: string;
  /** Stored sessions in the course (`sessions/*.json` sidecars) — meta shown on
   * the course card instead of the raw folder slug. */
  sessionCount?: number;
  /** Wiki atoms in the course (recursive `.md` count under `wiki/`). */
  atomCount?: number;
}

/** The Space root IS `userData` (design.md D1); courses live under `<userData>/courses/`. */
export function coursesRoot(userDataDir: string): string {
  return path.join(userDataDir, "courses");
}

export function courseDir(root: string, id: string): string {
  return path.join(root, id);
}

export function courseSessionsDir(root: string, id: string): string {
  return path.join(root, id, "sessions");
}

export function courseWikiDir(root: string, id: string): string {
  return path.join(root, id, "wiki");
}

export function courseInboxDir(root: string, id: string): string {
  return path.join(root, id, "inbox");
}

export function courseRawDir(root: string, id: string): string {
  return path.join(root, id, "raw");
}

export function courseReflectionsDir(root: string, id: string): string {
  return path.join(root, id, "reflections");
}

export function courseCanvasDir(root: string, id: string): string {
  return path.join(root, id, "canvas");
}

export function courseMdPath(root: string, id: string): string {
  return path.join(root, id, "course.md");
}

export function lecturerStatePath(root: string, id: string): string {
  return path.join(root, id, "lecturer-state.md");
}

/** The GLOBAL Lecturer-State profile lives once at the Space root — cross-course
 * CBE fluency and scaffolding-fade state (Requirement: Lecturer-State as Global
 * Profile plus Per-Course Overlay). NOT inside any course folder. */
export function lecturerProfileMdPath(userDataDir: string): string {
  return path.join(userDataDir, "lecturer-profile.md");
}

/** The two Lecturer-State layers, read fresh at session start. */
export interface LecturerStateLayers {
  globalPath: string;
  globalContent: string;
  overlayPath: string;
  overlayContent: string;
}

/**
 * Read both Lecturer-State layers for a session start (Scenario: Both layers are
 * read and composed at session start). Missing files are created empty so the
 * agent's later write/edit calls do not fail with ENOENT — an empty layer means
 * "nothing recorded yet", which is the legitimate cold-start state.
 */
export async function readLecturerStateLayers(
  userDataDir: string,
  root: string,
  courseId: string
): Promise<LecturerStateLayers> {
  const globalPath = lecturerProfileMdPath(userDataDir);
  const overlayPath = lecturerStatePath(root, courseId);
  return {
    globalPath,
    globalContent: await readOrCreateEmpty(globalPath),
    overlayPath,
    overlayContent: await readOrCreateEmpty(overlayPath),
  };
}

async function readOrCreateEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "", { encoding: "utf8", flag: "wx" });
    } catch {
      // Lost race or unwritable location — treat as empty; the session still starts.
    }
    return "";
  }
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "course";
}

function courseMdTemplate(title: string, createdAt: string): string {
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    'discipline: ""',
    'learner-context: ""',
    'institutional-context: ""',
    "learning-objectives: []",
    `created: ${JSON.stringify(createdAt)}`,
    "---",
  ].join("\n");
  const body = [
    "",
    `# ${title}`,
    "",
    "<!--",
    "  Persistent course context. The CBE Toolbox loads this file at the start of",
    "  every session in this course — fill in the frontmatter fields (discipline,",
    "  learner context, institutional context, learning objectives) and add any",
    "  free-form notes below. What is recorded here is not asked again.",
    "-->",
    "",
  ].join("\n");
  return `${frontmatter}\n${body}`;
}

/**
 * Scan the courses root for course folders — a course is any direct subdirectory
 * that carries a readable `course.md`. Anything else (stray files, legacy content,
 * folders without a course.md) is ignored without error; the flat Phase-1/2
 * `<userData>/sessions/` directory lives OUTSIDE the courses root and is never
 * touched (Scenario: Legacy flat sessions do not break the course workspace).
 */
export async function scanCourses(root: string): Promise<CourseSummary[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const courses: CourseSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const course = await readCourse(root, entry.name);
    if (course) courses.push(course);
  }
  courses.sort((a, b) => a.title.localeCompare(b.title));
  return courses;
}

/** Read one course's summary from its `course.md`. Returns null when the folder
 * is not a course (missing/unreadable course.md) — the caller skips it. */
export async function readCourse(root: string, id: string): Promise<CourseSummary | null> {
  try {
    const raw = await readFile(courseMdPath(root, id), "utf8");
    const parsed = matter(raw);
    const title = typeof parsed.data.title === "string" && parsed.data.title.trim() ? parsed.data.title : id;
    const createdAt = typeof parsed.data.created === "string" ? parsed.data.created : undefined;
    return {
      id,
      title,
      path: courseDir(root, id),
      createdAt,
      sessionCount: await countFiles(courseSessionsDir(root, id), ".json", false),
      atomCount: await countFiles(courseWikiDir(root, id), ".md", true),
    };
  } catch {
    return null;
  }
}

/** Count files with a given extension in a directory (optionally recursive).
 * A missing/unreadable directory counts as 0 — the summary must never fail on it. */
async function countFiles(dir: string, ext: string, recursive: boolean): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive });
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

/** Raw `course.md` content for session-start injection (Requirement: Course
 * Context in course.md). Read fresh on every call so external edits are picked
 * up at the next session start. Returns null when unreadable. */
export async function readCourseContext(root: string, id: string): Promise<string | null> {
  try {
    return await readFile(courseMdPath(root, id), "utf8");
  } catch {
    return null;
  }
}

/**
 * Create a new course folder: `course.md` (initial context), an empty
 * `lecturer-state.md` (the per-course Lecturer-State overlay), and the
 * subfolders `sessions/`, `canvas/`, `reflections/`, `inbox/`, `raw/`, `wiki/`.
 */
export async function createCourse(root: string, title: string): Promise<CourseSummary> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("course title must not be empty");
  await mkdir(root, { recursive: true });
  const base = slugify(trimmed);
  let id = base;
  for (let n = 2; ; n++) {
    try {
      await mkdir(courseDir(root, id));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      id = `${base}-${n}`;
    }
  }
  for (const sub of COURSE_SUBFOLDERS) {
    await mkdir(path.join(courseDir(root, id), sub), { recursive: true });
  }
  const createdAt = new Date().toISOString();
  await writeFile(courseMdPath(root, id), courseMdTemplate(trimmed, createdAt), "utf8");
  await writeFile(lecturerStatePath(root, id), "", "utf8");
  return { id, title: trimmed, path: courseDir(root, id), createdAt };
}

/**
 * Rename a course — updates the `title` in `course.md`'s frontmatter. The folder
 * id stays stable on purpose: sessions, wiki atoms and reflections keep their
 * paths, and cross-course wikilinks that name the folder id do not break.
 */
export async function renameCourse(root: string, id: string, newTitle: string): Promise<CourseSummary> {
  const trimmed = newTitle.trim();
  if (!trimmed) throw new Error("course title must not be empty");
  const file = courseMdPath(root, id);
  const raw = await readFile(file, "utf8");
  const parsed = matter(raw);
  const updated = matter.stringify(parsed.content, { ...parsed.data, title: trimmed });
  await writeFile(file, updated, "utf8");
  const course = await readCourse(root, id);
  if (!course) throw new Error(`course not readable after rename: ${id}`);
  return course;
}

/** Outcome of a course deletion (Requirement: Course Deletion from the Detail
 * View, Reversible via the OS Trash). `trashed: false` means the folder was
 * already gone before the call — the lecturer's intent is satisfied either way,
 * but the two outcomes are phrased differently on the surface. */
export interface CourseDeleteOutcome {
  trashed: boolean;
}

/** Move a folder to the platform trash. Injected so this module stays
 * electron-free and unit-testable; the app passes `shell.trashItem`. */
export type TrashFn = (target: string) => Promise<void>;

/**
 * Delete a course by moving its whole folder to the operating system's trash
 * (Requirement: Course Deletion from the Detail View, Reversible via the OS
 * Trash). The course travels as a unit — `sessions/`, `canvas/`, `reflections/`,
 * `inbox/`, `raw/`, `wiki/`, `course.md`, `lecturer-state.md` — matching the
 * self-contained-folder property of Requirement: Course as a Local Folder. The
 * GLOBAL `lecturer-profile.md` sits at the Space ROOT, outside every course
 * folder, and is therefore untouched by construction.
 *
 * Three deliberate behaviours:
 *
 *  - **Already gone is success.** A folder that disappeared outside the app
 *    (file manager, external sync) leaves nothing to do — the intent is met.
 *    Reported as `trashed: false` so the caller can phrase it honestly instead
 *    of claiming a move to the trash that never happened. Throwing here would
 *    strand the card in the list for a folder that does not exist.
 *  - **A folder that is still there but no longer reads as a course is NOT that
 *    case.** `readCourse` returns null for a missing directory AND for an
 *    unreadable `course.md` (permissions, a truncated file, a sync conflict) —
 *    but in the second case `sessions/`, `wiki/` and `inbox/` are all still on
 *    disk. Reporting "no longer on disk" there would remove the only card that
 *    leads to them: silent data loss the lecturer never even notices. The real
 *    reason is reported instead, and nothing is changed.
 *  - **A failed trash call NEVER degrades to an unlink.** The confirmation the
 *    lecturer just answered promised recoverability; falling back to an
 *    irreversible delete would break that promise silently. The rejection
 *    propagates and the course stays where it is.
 */
export async function deleteCourse(root: string, id: string, trash: TrashFn): Promise<CourseDeleteOutcome> {
  const dir = courseDir(root, id);
  // "Is this a course?" uses the same test as discovery — a readable course.md
  // (scanCourses / readCourse). Anything else is not ours to trash.
  if (await readCourse(root, id)) {
    await trash(dir);
    return { trashed: true };
  }
  // Distinct from the already-gone outcome on purpose: there the folder is gone and
  // the intent is met, here the sessions, wiki and materials are all still there, and
  // reporting them as gone would drop the only card leading to them (Requirement:
  // Course Deletion from the Detail View, Reversible via the OS Trash).
  if (await directoryExists(dir)) throw new Error(chrome().mainCourseDeleteUnreadableNotice);
  return { trashed: false };
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Active-course pointer persistence. A tiny app-state file at the Space root —
 * deliberately NOT a course index (discovery stays a pure folder scan); it only
 * remembers which course was active across app restarts.
 */
export async function readActiveCourseId(stateFile: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(stateFile, "utf8")) as { activeCourseId?: unknown };
    return typeof raw.activeCourseId === "string" && raw.activeCourseId ? raw.activeCourseId : null;
  } catch {
    return null;
  }
}

export async function writeActiveCourseId(stateFile: string, id: string): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ activeCourseId: id }, null, 2) + "\n", "utf8");
}

/**
 * Guarantee the exactly-one-active-course invariant at app start (Requirement:
 * Active Course and Course Switching): returns the id to use as the active
 * course, creating a default course when the Space has none, and falling back
 * to the first scanned course when the persisted active id no longer exists.
 */
export async function ensureActiveCourse(root: string, persistedActiveId: string | null): Promise<CourseSummary> {
  if (persistedActiveId) {
    const existing = await readCourse(root, persistedActiveId);
    if (existing) return existing;
  }
  const courses = await scanCourses(root);
  if (courses.length > 0) return courses[0]!;
  return createCourse(root, "My Course");
}
