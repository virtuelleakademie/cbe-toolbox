#!/usr/bin/env node
/**
 * Canonical-citation discipline check — SAFETY NET.
 *
 * As of `add-deterministic-citation-tool`, corpus citation tokens are produced
 * by the deterministic `cbe_cite` tool (capability `citation-tool`), which
 * assembles all four canonical elements from corpus ground truth, so a
 * malformed token should be impossible on the tool path. This gate is therefore
 * a BACKSTOP: it catches any token that was NOT produced via `cbe_cite` — i.e.
 * a token the model hand-wrote in spite of the skill instruction — rather than
 * being the primary line of defence it once was. Its behaviour is unchanged.
 *
 * Reads one or more markdown files (typically a `<brief>-findings.md` produced
 * by an eval run) and asserts that every `(corpus:<id>` token is the bare
 * canonical form (`[draft]`-free — see the corpus-versioning note in
 * `canonical-citations-core.mjs`), in ONE of the two valid shapes:
 *
 *   (corpus:<id> § <section>, <author year>)   ← document WITH sources[]
 *   (corpus:<id> § <section>)                   ← source-less document (methodology-002…006)
 *
 * Discipline violations the check catches:
 *   - `(corpus:methodology-001)`                                       → no section
 *   - `(corpus:methodology-001 § Engage) [dev-corpus, non-final]`      → retired suffix present
 *   - `(corpus:methodology-001 § Engage / Investigate, X 2016)`        → multi-section join
 *   - `(corpus:methodology-001 § Engage, Nichols et al.)`           → author present but no year
 *
 * Covers cbe-skill spec, Citation Grounding > Scenario: Single-source corpus
 * citation carries canonical format.
 *
 * Exit codes:
 *   0  — every corpus citation in every file is canonical
 *   1  — at least one violation; details printed to stderr
 *   2  — usage error (no files given, file unreadable)
 *
 * Usage:
 *   node evaluation/cbe-skill/runner/check-canonical-citations.mjs <file> [<file> …]
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
// Canonical-form logic lives in the shared plain-ESM core (single source of
// truth, also consumed by the typed harness checker runner/src/check-canonical.ts).
import { findNonCanonicalCitations } from "../canonical-citations-core.mjs";

function checkFile(filePath) {
  let body;
  try {
    body = readFileSync(filePath, "utf-8");
  } catch (err) {
    return { ok: false, filePath, violations: [], readError: err.message };
  }
  const violations = findNonCanonicalCitations(body);
  return { ok: violations.length === 0, filePath, violations };
}

function main() {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: check-canonical-citations.mjs <file> [<file> …]");
    exit(2);
  }
  let hasViolations = false;
  let hasReadError = false;
  for (const file of files) {
    const result = checkFile(file);
    if (result.readError) {
      console.error(`[error] ${file}: ${result.readError}`);
      hasReadError = true;
      continue;
    }
    if (!result.ok) {
      hasViolations = true;
      console.error(`[fail] ${file}: ${result.violations.length} non-canonical corpus citation(s)`);
      for (const v of result.violations) {
        console.error(`  line ${v.line}: ${v.token}`);
      }
    } else {
      console.log(`[pass] ${file}: every corpus citation matches the canonical format`);
    }
  }
  if (hasReadError) exit(2);
  if (hasViolations) {
    console.error("\nValid formats (bare token, no suffix or status marker):");
    console.error("  with sources:  (corpus:<id> § <section>, <author year>)");
    console.error("  source-less:   (corpus:<id> § <section>)");
    console.error("See cbe-skill spec, Citation Grounding > Single-source corpus citation carries canonical format.");
    exit(1);
  }
  exit(0);
}

main();
