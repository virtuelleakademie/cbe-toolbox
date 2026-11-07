/**
 * Guard: citation tokens shown in the skill bundle must reference real corpus ids and
 * must not misattribute a document's license/copyright holder as its source author.
 *
 * Capability `cbe-skill`, Requirement: Skill-Bundle Citation Examples Match Corpus Ground
 * Truth (change `harden-citation-pipeline`).
 *
 * Root cause this guards against: "The Challenge Institute" is a license/copyright
 * holder, never a `sources[].author` of any corpus document (corpus 2026-12). Attributing
 * it as an author makes `cbe_cite` refuse the author (`unknown-source`), re-triggering the
 * hand-write loop the citation pipeline is meant to eliminate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCitationResolver } from "../src/citations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "../../../skills/cbe");
const corpusRoot = path.resolve(__dirname, "../../../corpus");

// Tolerant token matcher — one level of nested parens in the metadata, mirroring the
// renderer's CITATION_RE so a `§ … (dev-draft)` heading is captured whole.
const TOKEN_RE = /\(corpus:([a-z0-9]+(?:-[a-z0-9]+)*)\b(?:[^()]|\([^()]*\))*\)/g;

function skillMarkdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".md")) out.push(full);
    }
  };
  walk(skillRoot);
  return out;
}

interface Tok {
  file: string;
  id: string;
  raw: string;
}

function collectTokens(): Tok[] {
  const out: Tok[] = [];
  for (const f of skillMarkdownFiles()) {
    const body = readFileSync(f, "utf-8");
    for (const m of body.matchAll(TOKEN_RE)) {
      out.push({ file: path.relative(skillRoot, f), id: m[1]!, raw: m[0]! });
    }
  }
  return out;
}

describe("skill-bundle citation grounding — examples match corpus ground truth", () => {
  // Scenario: every cited id exists in the corpus
  it("every (corpus:<id> …) token in the skill bundle references a real corpus id", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const unknown = collectTokens().filter((t) => resolver.resolve(t.id) === null);
    expect(unknown.map((t) => `${t.file}: ${t.raw}`)).toEqual([]);
  });

  // Scenario: a document's copyright holder is not cited as its source author
  it("does not attribute 'The Challenge Institute' to any corpus id", () => {
    const offenders = collectTokens().filter((t) => /the challenge institute/i.test(t.raw));
    expect(offenders.map((t) => `${t.file}: ${t.raw}`)).toEqual([]);
  });

  // Requirement: Source Disclosure Applies Citation Grounding, Not Raw Corpus
  // Internals — "The rule has ONE home: the identity prompt's self-description
  // rules. The skill body does not restate it." (change
  // `rebuild-skill-prompt-and-eval`; the assertion in its new home is
  // `identity-prompt.test.ts` › *answers self-description as the lecturer's work*).
  it("does NOT restate source disclosure in the skill body — it has one home, the prompt", () => {
    const skill = readFileSync(path.join(skillRoot, "SKILL.md"), "utf-8");
    expect(skill).not.toMatch(/source[- ]disclosure/i);
    expect(skill).not.toMatch(/document ids/i);
    expect(skill).not.toMatch(/what are your sources/i);
  });

  // Scenario: a full citation token's year matches a real corpus source year for its id
  it("cites a year that exists in the document's corpus sources (no fabricated years)", async () => {
    const resolver = await createCitationResolver(corpusRoot);
    const mismatches: string[] = [];
    for (const t of collectTokens()) {
      if (/non-authoritative dev-draft/i.test(t.raw)) continue; // dev-draft marker carries no author/year
      const years = [...t.raw.matchAll(/\b(\d{4})\b/g)].map((m) => m[1]!);
      if (years.length === 0) continue; // partial reference, not a full citation
      if (resolver.resolve(t.id) === null) continue; // unknown id is the other test's job
      const corpusYears = new Set((await resolver.resolveSources(t.id)).map((s) => String(s.year)));
      // A token is grounded if at least one of its years is a real source year for the id
      // (`.some` tolerates an incidental 4-digit number inside a section heading).
      if (!years.some((y) => corpusYears.has(y))) {
        mismatches.push(`${t.file}: ${t.raw} (token ${years.join("/")} vs corpus ${[...corpusYears].join("/")})`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
