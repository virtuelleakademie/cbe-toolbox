/**
 * Scenario: The raw status transition is host-owned (capability `lecturer-wiki`,
 * Requirement: Three-Layer Store — inbox, raw, wiki; change
 * `fence-agent-file-writes`, task 4.3).
 *
 * The `raw` → `compiled` transition was never the atomization run's write — the
 * host applies it after a successful run (`setRawStatus`, called from the
 * ingest handler in `ipc.ts`). The path fence now enforces that division: the
 * run's single writable root is the course's `wiki/`, so an agent attempt to
 * set `status:` itself is refused, while the host-applied transition still
 * lands. `raw/` is agent-immutable INCLUDING its provenance frontmatter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomizationWritableRoots, resolveAgainstRoots } from "@cbe/pi-bridge";
import { setRawStatus } from "../src/main/wiki-store.js";

let courseDir: string;
let wikiDir: string;

const RAW_DOC =
  "---\n" +
  "source: doc.pdf\n" +
  "extracted_from: inbox/doc.pdf\n" +
  "extractor: test@1\n" +
  "captured: 2026-08-24\n" +
  "status: raw\n" +
  "---\n" +
  "Body\n";

beforeEach(async () => {
  courseDir = await mkdtemp(path.join(tmpdir(), "cbe-raw-host-owned-"));
  wikiDir = path.join(courseDir, "wiki");
  await mkdir(wikiDir, { recursive: true });
  await mkdir(path.join(courseDir, "raw"), { recursive: true });
  await writeFile(path.join(courseDir, "raw", "doc.md"), RAW_DOC, "utf8");
});

afterEach(async () => {
  await rm(courseDir, { recursive: true, force: true });
});

describe("Scenario: The raw status transition is host-owned", () => {
  it("the run's own attempt on raw/ is refused by the fence — raw/ is not among its writable roots", () => {
    const roots = atomizationWritableRoots(wikiDir);
    const verdict = resolveAgainstRoots("raw/doc.md", courseDir, roots, { caseInsensitive: false });
    expect(verdict.allowed).toBe(false);
    // The wiki atom the run legitimately produces passes the same fence.
    expect(resolveAgainstRoots("wiki/atom-001.md", courseDir, roots, { caseInsensitive: false }).allowed).toBe(true);
  });

  it("the host-applied transition still lands after a successful run", async () => {
    await setRawStatus(courseDir, "raw/doc.md", "compiled");
    const after = await readFile(path.join(courseDir, "raw", "doc.md"), "utf8");
    expect(after).toContain("status: compiled");
    expect(after).toBe(RAW_DOC.replace("status: raw", "status: compiled"));
  });
});
