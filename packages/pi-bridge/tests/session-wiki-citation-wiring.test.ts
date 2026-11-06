/**
 * Session-level wiring of the wiki citation route (capability `citation-tool`,
 * Requirement: *Citation Tool Produces a Wiki Citation Validated Against the Wiki
 * Index*).
 *
 * The unit tests in `wiki-citation.test.ts` build `cbe_cite` by hand and hand it a
 * resolver, so they prove the ROUTE. They cannot prove that `startCbeSession` binds that
 * resolver to `opts.paths.wiki` — a session that forgot the third argument would keep
 * every one of them green while every `wiki:` call in the real app refused with
 * `no-wiki`, which is exactly the shape of failure this change exists to remove.
 *
 * So this test drives the REAL `startCbeSession` against an offline provider, pulls the
 * REGISTERED `cbe_cite` out of the session's own tool registry, and executes it. No
 * network: session construction never calls the model, and `session.prompt(...)` is
 * never sent.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startCbeSession } from "../src/session.js";
import { piSessionOf } from "./helpers/pi-adapter-access.js";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "cbe");
const CORPUS_DIR = path.resolve(__dirname, "..", "..", "..", "corpus");

async function writeCourseWiki(wikiDir: string): Promise<void> {
  await mkdir(path.join(wikiDir, "concept"), { recursive: true });
  await writeFile(
    path.join(wikiDir, "concept", "cognitive-load.md"),
    `---
type: concept
aliases: []
sources:
  - title: "Cognitive load during problem solving"
    author: "Sweller"
    year: 1988
raw: []
related: []
confidence: high
updated: 2026-08-19
---

## Working memory

Working memory is the bottleneck the whole design has to respect.
`,
    "utf8"
  );
  await writeFile(path.join(wikiDir, "index.md"), `# Course wiki\n\n- [[concept/cognitive-load]]\n`, "utf8");
}

async function start(withWiki: boolean) {
  tmp = mkdtempSync(path.join(tmpdir(), "cbe-wiki-cite-wiring-"));
  const wikiDir = path.join(tmp, "course", "wiki");
  if (withWiki) await writeCourseWiki(wikiDir);
  const { session } = await startCbeSession({
    profile: "headless",
    skillDir: SKILL_DIR,
    sessionsDir: path.join(tmp, "sessions"),
    agentDir: path.join(tmp, "agent"),
    cwd: path.join(tmp, "workspace"),
    paths: { corpus: CORPUS_DIR, ...(withWiki ? { wiki: wikiDir } : {}) },
    provider: { baseURL: "http://localhost:0", apiKey: "test-key", modelId: "test-model" },
  });
  return piSessionOf(session);
}

/** The tool as the model reaches it — out of the session's own registry, not rebuilt. */
async function cite(session: Awaited<ReturnType<typeof start>>, params: Record<string, unknown>): Promise<string> {
  const tool = session.getToolDefinition("cbe_cite");
  expect(tool, "cbe_cite is not registered on the session").toBeTruthy();
  const result = await tool!.execute("call-1", params as never, undefined, undefined, {} as never);
  return (result.content[0] as { text: string }).text;
}

describe("startCbeSession binds the wiki citation route to paths.wiki", () => {
  it("the registered cbe_cite produces a wiki token for an atom of the session's course wiki", async () => {
    const session = await start(true);
    expect(await cite(session, { id: "wiki:concept/cognitive-load", section: "Working memory" })).toBe(
      "(wiki:concept/cognitive-load § Working memory, Sweller 1988)"
    );
  });

  it("the same registered tool still serves the corpus route", async () => {
    const session = await start(true);
    expect(await cite(session, { id: "methodology-002", section: "Summary" })).toBe(
      "(corpus:methodology-002 § Summary)"
    );
  });

  it("a session with no course wiki says so rather than listing candidate atoms", async () => {
    const session = await start(false);
    const text = await cite(session, { id: "wiki:concept/cognitive-load", section: "Working memory" });
    expect(text).toContain("no wiki index");
    expect(text).not.toContain("(wiki:");
  });
});
