import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COURSE_SUBFOLDERS,
  coursesRoot,
  courseSessionsDir,
  courseWikiDir,
  createCourse,
  deleteCourse,
  ensureActiveCourse,
  lecturerProfileMdPath,
  readActiveCourseId,
  readCourse,
  readCourseContext,
  readLecturerStateLayers,
  renameCourse,
  scanCourses,
  writeActiveCourseId,
} from "../src/main/courses.js";

let userData: string;
let root: string;

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), "cbe-courses-"));
  root = coursesRoot(userData);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe("course-workspace: Course as a Local Folder", () => {
  it("creating a course produces a folder with course.md, empty lecturer-state.md, and all subfolders", async () => {
    const course = await createCourse(root, "Datenbanken HS26");
    expect(course.id).toBe("datenbanken-hs26");
    expect(course.title).toBe("Datenbanken HS26");

    const courseMd = await readFile(path.join(course.path, "course.md"), "utf8");
    expect(courseMd).toContain('title: "Datenbanken HS26"');
    expect(courseMd).toContain("discipline:");
    expect(courseMd).toContain("learner-context:");
    expect(courseMd).toContain("institutional-context:");
    expect(courseMd).toContain("learning-objectives:");

    const lecturerState = await readFile(path.join(course.path, "lecturer-state.md"), "utf8");
    expect(lecturerState).toBe("");

    for (const sub of COURSE_SUBFOLDERS) {
      const st = await stat(path.join(course.path, sub));
      expect(st.isDirectory()).toBe(true);
    }
    expect(COURSE_SUBFOLDERS).toEqual(["sessions", "canvas", "reflections", "inbox", "raw", "wiki"]);
  });

  it("course summary carries session and atom counts for the card meta line", async () => {
    const course = await createCourse(root, "Datenbanken");
    // 2 stored sessions (.json sidecars; the .md twin and stray files don't count)…
    await writeFile(path.join(courseSessionsDir(root, course.id), "s1.json"), "{}", "utf8");
    await writeFile(path.join(courseSessionsDir(root, course.id), "s1.md"), "", "utf8");
    await writeFile(path.join(courseSessionsDir(root, course.id), "s2.json"), "{}", "utf8");
    // …and 3 wiki atoms, one of them nested (recursive count).
    await writeFile(path.join(courseWikiDir(root, course.id), "a.md"), "", "utf8");
    await writeFile(path.join(courseWikiDir(root, course.id), "b.md"), "", "utf8");
    await mkdir(path.join(courseWikiDir(root, course.id), "nested"), { recursive: true });
    await writeFile(path.join(courseWikiDir(root, course.id), "nested", "c.md"), "", "utf8");

    const summary = await readCourse(root, course.id);
    expect(summary?.sessionCount).toBe(2);
    expect(summary?.atomCount).toBe(3);
  });

  it("courses are discovered by folder scan, without consulting an index", async () => {
    await createCourse(root, "Algorithmen");
    await createCourse(root, "Betriebssysteme");
    // Stray content in the courses root must be ignored, not crash the scan.
    await writeFile(path.join(root, "stray.txt"), "not a course", "utf8");
    await mkdir(path.join(root, "not-a-course"));

    const courses = await scanCourses(root);
    expect(courses.map((c) => c.id)).toEqual(["algorithmen", "betriebssysteme"]);
    // No index file was created anywhere in the root.
    const entries = await readdir(root);
    expect(entries).not.toContain("index.json");
  });

  it("legacy flat sessions do not break the course workspace", async () => {
    // Phase-1/2 layout: sessions flat under <userData>/sessions/ — not migrated,
    // not deleted, not listed as a course.
    const legacyDir = path.join(userData, "sessions");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "abc.md"), "---\nsessionId: abc\n---\n", "utf8");
    await writeFile(path.join(legacyDir, "abc.json"), JSON.stringify({ meta: {}, turns: [] }), "utf8");

    // Course discovery works (empty — legacy files are not a course) …
    expect(await scanCourses(root)).toEqual([]);
    // … course creation works …
    const course = await createCourse(root, "Neuer Kurs");
    expect((await scanCourses(root)).map((c) => c.id)).toEqual([course.id]);
    // … and the legacy files are untouched.
    expect(await readFile(path.join(legacyDir, "abc.md"), "utf8")).toContain("sessionId: abc");
    expect((await readdir(legacyDir)).sort()).toEqual(["abc.json", "abc.md"]);
  });

  it("slug collisions get a numeric suffix instead of clobbering the existing course", async () => {
    const first = await createCourse(root, "Physik");
    const second = await createCourse(root, "Physik");
    expect(first.id).toBe("physik");
    expect(second.id).toBe("physik-2");
  });
});

describe("course-workspace: Course Context in course.md", () => {
  it("course.md is editable outside the app — the changed context is used on next read", async () => {
    const course = await createCourse(root, "Original Title");
    // External editor rewrites the file wholesale.
    await writeFile(
      path.join(course.path, "course.md"),
      '---\ntitle: "Edited Externally"\ndiscipline: "Physics"\n---\n\nFree-form notes.\n',
      "utf8"
    );
    const reread = await readCourse(root, course.id);
    expect(reread?.title).toBe("Edited Externally");
    const context = await readCourseContext(root, course.id);
    expect(context).toContain("Free-form notes.");
    expect(context).toContain('discipline: "Physics"');
  });

  it("readCourseContext returns the raw course.md for session-start injection", async () => {
    const course = await createCourse(root, "Kontext Kurs");
    const context = await readCourseContext(root, course.id);
    expect(context).toContain('title: "Kontext Kurs"');
    expect(context).toContain("learning-objectives:");
  });
});

describe("course-workspace: Active Course and Course Switching", () => {
  it("renaming a course updates the title but keeps the folder id stable", async () => {
    const course = await createCourse(root, "Alter Name");
    const renamed = await renameCourse(root, course.id, "Neuer Name");
    expect(renamed.id).toBe(course.id);
    expect(renamed.title).toBe("Neuer Name");
    expect(renamed.path).toBe(course.path);
    const sessions = courseSessionsDir(root, course.id);
    expect(sessions).toBe(path.join(course.path, "sessions"));
  });

  it("ensureActiveCourse keeps a valid persisted id", async () => {
    const a = await createCourse(root, "A");
    await createCourse(root, "B");
    const active = await ensureActiveCourse(root, a.id);
    expect(active.id).toBe(a.id);
  });

  it("ensureActiveCourse falls back to the first scanned course when the persisted id is gone", async () => {
    const a = await createCourse(root, "Aaa");
    const active = await ensureActiveCourse(root, "deleted-course");
    expect(active.id).toBe(a.id);
  });

  it("ensureActiveCourse creates a default course in an empty Space", async () => {
    const active = await ensureActiveCourse(root, null);
    expect(active.title).toBe("My Course");
    const courses = await scanCourses(root);
    expect(courses.map((c) => c.id)).toEqual([active.id]);
  });

  it("new work lands in the active course: sessions and wiki paths derive from the course folder", async () => {
    const course = await createCourse(root, "Pfad Kurs");
    expect(courseSessionsDir(root, course.id)).toBe(path.join(root, course.id, "sessions"));
    expect(courseWikiDir(root, course.id)).toBe(path.join(root, course.id, "wiki"));
  });

  it("the active-course pointer persists across app restarts via the state file", async () => {
    const stateFile = path.join(userData, "workspace-state.json");
    expect(await readActiveCourseId(stateFile)).toBeNull();
    await writeActiveCourseId(stateFile, "physik");
    expect(await readActiveCourseId(stateFile)).toBe("physik");
  });
});

describe("course-workspace: Lecturer-State as Global Profile plus Per-Course Overlay", () => {
  it("both layers are read at session start; missing files are created empty", async () => {
    const course = await createCourse(root, "Layer Kurs");
    const layers = await readLecturerStateLayers(userData, root, course.id);
    expect(layers.globalPath).toBe(path.join(userData, "lecturer-profile.md"));
    expect(layers.overlayPath).toBe(path.join(course.path, "lecturer-state.md"));
    expect(layers.globalContent).toBe("");
    expect(layers.overlayContent).toBe("");
    // The global profile file now exists at the Space root (NOT in any course folder).
    expect(await readFile(lecturerProfileMdPath(userData), "utf8")).toBe("");
  });

  it("global fade carries across courses, overlay stays scoped", async () => {
    const a = await createCourse(root, "Kurs A");
    const b = await createCourse(root, "Kurs B");
    await writeFile(lecturerProfileMdPath(userData), "CBE fluency: high\n", "utf8");
    await writeFile(path.join(a.path, "lecturer-state.md"), "Knows the A material\n", "utf8");

    const inA = await readLecturerStateLayers(userData, root, a.id);
    const inB = await readLecturerStateLayers(userData, root, b.id);
    // The global layer is identical in both courses …
    expect(inA.globalContent).toContain("CBE fluency: high");
    expect(inB.globalContent).toContain("CBE fluency: high");
    // … while the overlay stays scoped to its course.
    expect(inA.overlayContent).toContain("Knows the A material");
    expect(inB.overlayContent).toBe("");
  });

  it("lecturer overrides in either layer are honoured at the next read (files re-read fresh)", async () => {
    const course = await createCourse(root, "Override Kurs");
    await readLecturerStateLayers(userData, root, course.id);
    // Lecturer edits both files externally.
    await writeFile(lecturerProfileMdPath(userData), "Override: never scaffold basics\n", "utf8");
    await writeFile(path.join(course.path, "lecturer-state.md"), "Override: cohort is first-semester\n", "utf8");
    const layers = await readLecturerStateLayers(userData, root, course.id);
    expect(layers.globalContent).toContain("never scaffold basics");
    expect(layers.overlayContent).toContain("cohort is first-semester");
  });
});

/**
 * Store-level halves of capability `course-workspace`, Requirement: Course
 * Deletion from the Detail View, Reversible via the OS Trash. The trash function
 * is injected (the module stays electron-free), so these tests assert exactly
 * what the app hands to `shell.trashItem` and what it does when that call fails.
 * The IPC-level guards live in course-delete.test.ts, the surface in
 * course-delete-control.test.tsx.
 */
describe("course-workspace: Course Deletion from the Detail View, Reversible via the OS Trash", () => {
  it("moves a course folder to the trash as a unit", async () => {
    const course = await createCourse(root, "Wegwerf Kurs");
    const keep = await createCourse(root, "Bleibt Kurs");
    await writeFile(lecturerProfileMdPath(userData), "CBE fluency: high\n", "utf8");
    // Populate the layers that must travel with the folder rather than be
    // singled out (lecturer-wiki, Scenario: Deleting the course discards its
    // three layers as one unit).
    await writeFile(path.join(course.path, "inbox", "original.pdf"), "PDF", "utf8");
    await writeFile(path.join(course.path, "raw", "original.md"), "# extracted", "utf8");
    await writeFile(path.join(course.path, "wiki", "atom.md"), "# atom", "utf8");

    const trashed: string[] = [];
    const outcome = await deleteCourse(root, course.id, async (target) => {
      // A real trash moves the folder; the fake removes it so the follow-up
      // scan sees the same end state.
      trashed.push(target);
      await rm(target, { recursive: true, force: true });
    });

    expect(outcome.trashed).toBe(true);
    // The whole folder is handed over — not a file, not a subfolder.
    expect(trashed).toEqual([course.path]);
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: keep.id })]);
    // The GLOBAL profile lives at the Space root, outside every course folder.
    expect(await readFile(lecturerProfileMdPath(userData), "utf8")).toContain("CBE fluency: high");
    // The sibling course is untouched.
    expect(await readCourse(root, keep.id)).not.toBeNull();
  });

  it("reports an already-gone course as removed rather than failing", async () => {
    const course = await createCourse(root, "Extern Geloescht");
    // The folder disappears outside the app (file manager, external sync).
    await rm(course.path, { recursive: true, force: true });

    const trash = async () => {
      throw new Error("trash must not be called for a folder that is already gone");
    };
    const outcome = await deleteCourse(root, course.id, trash);

    // Success, but honestly distinguished: nothing was moved to the trash.
    expect(outcome.trashed).toBe(false);
    expect(await scanCourses(root)).toEqual([]);
  });

  it("reports an unreadable course.md as the real reason instead of as already gone", async () => {
    const course = await createCourse(root, "Kaputte Kursdatei");
    await writeFile(path.join(course.path, "sessions", "conversation.json"), "{}", "utf8");
    await writeFile(path.join(course.path, "wiki", "atom.md"), "# atom", "utf8");
    // course.md becomes unreadable (permissions, truncation, a sync conflict)
    // while everything else is still there.
    await rm(path.join(course.path, "course.md"));

    const trash = async () => {
      throw new Error("trash must not be called for a folder we did not recognise");
    };

    await expect(deleteCourse(root, course.id, trash)).rejects.toThrow(/course\.md could not be read/i);

    // Nothing was changed, and the lecturer is NOT told the course is gone while
    // its sessions and wiki sit on disk with no card leading to them.
    expect(await stat(path.join(course.path, "sessions", "conversation.json"))).toBeTruthy();
    expect(await stat(path.join(course.path, "wiki", "atom.md"))).toBeTruthy();
  });

  it("leaves the course in place when the trash operation fails", async () => {
    const course = await createCourse(root, "Trash Kaputt");

    await expect(
      deleteCourse(root, course.id, async () => {
        throw new Error("no trash implementation on this platform");
      })
    ).rejects.toThrow(/no trash implementation/);

    // No fallback to an irreversible delete: the folder and its contents survive.
    expect(await readCourse(root, course.id)).not.toBeNull();
    expect(await stat(path.join(course.path, "course.md"))).toBeTruthy();
    expect(await scanCourses(root)).toEqual([expect.objectContaining({ id: course.id })]);
  });
});
