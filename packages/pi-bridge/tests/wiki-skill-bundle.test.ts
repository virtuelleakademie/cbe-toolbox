/**
 * Adapted wiki-skill bundle (skills/wiki) — capability `lecturer-wiki`,
 * Requirement: Atomization Implementation via Existing Wiki Skill.
 *
 * Scenario mapping:
 *  - explicit bundle version identifier (responsibility (e))
 *  - citation-model adaptation: bibliographic sources[] + mechanical raw[]
 *    (responsibility (c); design.md D4 — deliberately rewritten, not copied)
 *  - merge-on-reingest carried over as-is (Requirement: Merge-on-Reingest)
 *  - index maintenance in the same run (Requirement: Wiki Index for Stage-1
 *    Retrieval)
 *  - "Network-fetch features are absent from the integration" (responsibility (f))
 *  - isolation invariant instruction (no corpus references from atoms)
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readWikiSkillVersion } from "../src/atomization-session.js";

const BUNDLE_DIR = path.resolve(__dirname, "..", "..", "..", "skills", "wiki");
const SKILL = readFileSync(path.join(BUNDLE_DIR, "SKILL.md"), "utf8");

describe("wiki-skill bundle", () => {
  it("carries an explicit version identifier readable by the reflection-log path", async () => {
    expect(SKILL).toMatch(/^version:\s*\d+\.\d+\.\d+/m);
    const version = await readWikiSkillVersion(BUNDLE_DIR);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("adapts the citation model: bibliographic sources[] split from mechanical raw[] provenance", () => {
    // The upstream skill used `sources:` for raw-file PATHS; the CBE bundle
    // must document the split (design.md D4) — not blindly copy upstream.
    expect(SKILL).toMatch(/sources\[\]/);
    expect(SKILL).toMatch(/bibliographic/i);
    expect(SKILL).toMatch(/raw\[\]/);
    expect(SKILL).toMatch(/differs from the upstream skill/i);
    // Explicit empty arrays for self-authored atoms, never omitted fields.
    expect(SKILL).toMatch(/sources: \[\]/);
    expect(SKILL).toMatch(/never omitted/i);
  });

  it("carries the merge-on-reingest behaviour as-is (## From sections, alias matching, Conflicts)", () => {
    expect(SKILL).toContain("## From <source-title>");
    expect(SKILL).toMatch(/merge, never duplicate/i);
    expect(SKILL).toMatch(/aliases/);
    expect(SKILL).toContain("## Conflicts");
    expect(SKILL).toMatch(/confidence: low/);
    expect(SKILL).toMatch(/do not force-merge/i);
  });

  it("requires the index to be updated in the same run that creates atoms", () => {
    expect(SKILL).toMatch(/wiki\/index\.md.*in this same run/i);
    expect(SKILL).toMatch(/No atom may land on disk without an index entry/i);
  });

  it("network-fetch features are absent from the integration", () => {
    // Local-documents-only is stated as a hard boundary …
    expect(SKILL).toMatch(/NO network fetching/i);
    expect(SKILL).toMatch(/no RSS, no YouTube transcripts, no URL scraping/i);
    // … and none of the upstream fetch tooling ships in the bundle.
    expect(existsSync(path.join(BUNDLE_DIR, "bin"))).toBe(false);
    expect(existsSync(path.join(BUNDLE_DIR, "tools"))).toBe(false);
    expect(SKILL).not.toMatch(/_feeds\.yml|llm-wiki-fetch|wiki-feeds/);
  });

  it("forbids corpus references from atoms (isolation invariant) while allowing cross-course wikilinks", () => {
    expect(SKILL).toMatch(/never references the PIONEER corpus/i);
    expect(SKILL).toMatch(/\(corpus:…\)/);
    expect(SKILL).toMatch(/another course's wiki \(read-only/i);
  });

  it("is language-neutral: mirrors the source document's language, never hardcodes an output language", () => {
    expect(SKILL).toMatch(/mirrors the SOURCE DOCUMENT's language/i);
    expect(SKILL).toMatch(/Never impose a language/i);
  });

  it("declares raw/ and inbox/ immutable and leaves the status transition to the host", () => {
    expect(SKILL).toMatch(/NEVER touch/);
    expect(SKILL).toMatch(/the host flips `status:`/i);
  });
});
