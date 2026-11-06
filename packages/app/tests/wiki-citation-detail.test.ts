/**
 * Main-process half of the wiki citation overlay (capability `desktop-app`, Requirement:
 * *A Wiki Citation Token Renders as the Same Citation Link and Opens the Shared Overlay
 * Unverified*, Scenarios: *Clicking a wiki citation opens the shared overlay without
 * corpus chrome* — the payload — and *An unknown atom id falls back to the overlay's
 * not-found state*).
 *
 * `loadWikiCitationDetail` is a pure helper (the `citation-body.ts` precedent), so it is
 * exercised here against a REAL wiki tree on disk — real `readWikiIndex`, real
 * containment policy, real frontmatter strip — without importing `main/ipc.ts` and its
 * module graph. The handler contributes only the active-course binding on top.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadWikiCitationDetail } from "../src/main/wiki-citation-detail.js";

let wikiDir: string;

const ATOM_BODY = [
  "---",
  "type: concept",
  "aliases: []",
  "related: []",
  "confidence: high",
  "updated: 2026-08-19",
  "sources:",
  "  - title: skript.pdf",
  "---",
  "",
  "# cognitive-load",
  "",
  "## From skript",
  "",
  "Working memory holds **few** elements at once.",
].join("\n");

beforeAll(() => {
  wikiDir = mkdtempSync(path.join(os.tmpdir(), "cbe-wiki-citation-detail-"));
  mkdirSync(path.join(wikiDir, "concept"), { recursive: true });
  mkdirSync(path.join(wikiDir, "person"), { recursive: true });
  writeFileSync(
    path.join(wikiDir, "index.md"),
    [
      "# Index",
      "",
      "- [[concept/cognitive-load]] — how much working memory holds",
      "- [[concept/scaffolding]] — support that fades",
      "- [[person/scaffolding]] — the person page sharing the basename",
    ].join("\n")
  );
  writeFileSync(path.join(wikiDir, "concept", "cognitive-load.md"), ATOM_BODY);
  writeFileSync(path.join(wikiDir, "concept", "scaffolding.md"), "body a");
  writeFileSync(path.join(wikiDir, "person", "scaffolding.md"), "body b");
});

afterAll(() => {
  rmSync(wikiDir, { recursive: true, force: true });
});

describe("loadWikiCitationDetail — an index-carried atom is served", () => {
  it("returns the atom's title and frontmatter-stripped body for an exact wiki-relative id", async () => {
    const detail = await loadWikiCitationDetail(wikiDir, "wiki:concept/cognitive-load");
    expect(detail).not.toBeNull();
    expect(detail!.store).toBe("wiki");
    expect(detail!.hit).toEqual({
      id: "concept/cognitive-load",
      title: "cognitive-load",
      path: "concept/cognitive-load.md",
    });
    // Frontmatter stripped, the title-repeating heading dropped, the prose kept.
    expect(detail!.body).not.toContain("---");
    expect(detail!.body).not.toContain("type: concept");
    expect(detail!.body).not.toContain("# cognitive-load\n");
    expect(detail!.body).toContain("## From skript");
    expect(detail!.body).toContain("Working memory holds **few** elements at once.");
  });

  it("resolves a UNIQUE basename to the index's wiki-relative id", async () => {
    const detail = await loadWikiCitationDetail(wikiDir, "wiki:cognitive-load");
    expect(detail?.hit.id).toBe("concept/cognitive-load");
  });

  it("serves nothing for an AMBIGUOUS basename — guessing between atoms is worse than not-found", async () => {
    expect(await loadWikiCitationDetail(wikiDir, "wiki:scaffolding")).toBeNull();
  });
});

describe("loadWikiCitationDetail — everything unservable answers null", () => {
  it("returns null for an atom id the index does not carry", async () => {
    expect(await loadWikiCitationDetail(wikiDir, "wiki:concept/does-not-exist")).toBeNull();
  });

  it("returns null when the wiki has no index", async () => {
    const bare = mkdtempSync(path.join(os.tmpdir(), "cbe-wiki-no-index-"));
    try {
      expect(await loadWikiCitationDetail(bare, "wiki:concept/cognitive-load")).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("returns null for an unbound wiki dir and for an empty id", async () => {
    expect(await loadWikiCitationDetail(undefined, "wiki:concept/cognitive-load")).toBeNull();
    expect(await loadWikiCitationDetail(wikiDir, "wiki:")).toBeNull();
  });
});
