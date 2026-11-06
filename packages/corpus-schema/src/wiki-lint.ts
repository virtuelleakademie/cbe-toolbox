import { readFile, readdir } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { validateDirectory } from "./validate.js";
import type { WikiAtom } from "./schema.js";

/**
 * Deterministic lint layer for a course wiki (capability `lecturer-wiki`):
 *
 *  - `dangling-raw` — an atom's `raw:` provenance names a `raw/` path that no
 *    longer exists on disk (Requirement: Atom Frontmatter Schema, Scenario:
 *    Dangling raw provenance is flagged).
 *  - `unindexed-atom` — an atom exists on disk but is missing from
 *    `wiki/index.md`, so stage-1 retrieval would never select it (Requirement:
 *    Wiki Index for Stage-1 Retrieval).
 *
 * The wiki directory is `<course>/wiki/`; `raw:` entries are course-relative
 * (`raw/<file>.md`), so they resolve against the wiki directory's parent.
 */
export interface WikiLintFinding {
  /** Absolute path of the affected atom. */
  path: string;
  finding: "dangling-raw" | "unindexed-atom";
  message: string;
}

export interface WikiLintResult {
  findings: WikiLintFinding[];
  /** Validation errors encountered while reading atoms (schema-invalid atoms
   * are reported by the validator, not silently skipped by the lint). */
  invalid: Array<{ path: string; errors: string[] }>;
}

export async function lintWikiDirectory(wikiDir: string): Promise<WikiLintResult> {
  const courseDir = path.dirname(wikiDir);
  const results = await validateDirectory(wikiDir, "wiki").catch(() => []);
  const findings: WikiLintFinding[] = [];
  const invalid: WikiLintResult["invalid"] = [];

  const indexContent = await readFile(path.join(wikiDir, "index.md"), "utf8").catch(() => "");

  for (const result of results) {
    if (!result.ok) {
      invalid.push({ path: result.path, errors: result.errors });
      continue;
    }
    const atom = result.doc as WikiAtom;

    // Source integrity: every raw provenance target must still exist.
    for (const rawRel of atom.raw) {
      const target = path.resolve(courseDir, rawRel);
      const exists = await access(target)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        findings.push({
          path: result.path,
          finding: "dangling-raw",
          message: `raw provenance target does not exist: ${rawRel}`,
        });
      }
    }

    // Index completeness: the atom must be reachable from wiki/index.md —
    // matched by its wiki-relative path (with or without .md) or its stem.
    const relToWiki = path.relative(wikiDir, result.path).split(path.sep).join("/");
    const stem = relToWiki.replace(/\.md$/, "");
    const indexed = indexContent.includes(relToWiki) || indexContent.includes(stem);
    if (!indexed) {
      findings.push({
        path: result.path,
        finding: "unindexed-atom",
        message: `atom is on disk but missing from wiki/index.md: ${relToWiki}`,
      });
    }
  }
  return { findings, invalid };
}

/** True when the wiki directory contains at least one atom file (used by hosts
 * to decide whether a lint pass is meaningful). */
export async function wikiHasAtoms(wikiDir: string): Promise<boolean> {
  try {
    const entries = await readdir(wikiDir, { withFileTypes: true, recursive: true });
    return entries.some(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md" && !e.name.startsWith("_")
    );
  } catch {
    return false;
  }
}
