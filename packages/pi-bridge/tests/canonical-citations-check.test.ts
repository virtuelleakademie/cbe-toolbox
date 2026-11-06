import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Covers cbe-skill spec, Citation Grounding > Scenario: Single-source corpus
// citation carries canonical format — at the eval-tooling layer. The tool
// under test is `evaluation/cbe-skill/runner/check-canonical-citations.mjs`;
// it is the regex gate that runs over findings files produced by skill eval
// runs. Without this test the eval gate could silently drift (e.g. an editor
// loosens the regex to accept a shorthand) and the discipline fails
// asymptotically.
//
// Corpus versioning model (change `version-corpus-replace-dev-track`): the
// canonical token is the BARE form the `cbe_cite` tool emits — no
// `[dev-corpus, non-final]` suffix, no `non-authoritative dev-draft` marker.
// A document WITH sources[] carries an author/year element; a source-less
// document (methodology-002…006) drops it.

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const TOOL = join(REPO_ROOT, "evaluation", "cbe-skill", "runner", "check-canonical-citations.mjs");

function runTool(...files: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [TOOL, ...files], { encoding: "utf-8" });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("check-canonical-citations.mjs", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "cbe-citation-check-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("passes on a file with three canonical bare-token citations", () => {
    const file = join(workDir, "good.md");
    writeFileSync(
      file,
      [
        "# Findings",
        "",
        "The skill cited `(corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016)`",
        "and `(corpus:foundations-003 § Multiple Points of Entry, Nichols et al. 2016)`",
        "and `(corpus:foundations-002 § Structural Tensions Worth Noting, Nichols et al. 2016)`.",
      ].join("\n"),
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("[pass]");
  });

  it("accepts the source-less bare form (no author/year element)", () => {
    // Source-less documents (methodology-002…006) are cited WITHOUT an
    // author/year; `cbe_cite` derives this from the document frontmatter. The
    // gate must NOT flag a source-less bare token as a missing-author violation.
    const file = join(workDir, "good-sourceless.md");
    writeFileSync(
      file,
      [
        "Per `(corpus:methodology-003 § Mis-alignment-pattern catalogue)`",
        "and `(corpus:methodology-005 § Process-artefact catalogue)`.",
      ].join("\n"),
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("[pass]");
  });

  it("passes on the bare author/year token (no suffix required)", () => {
    // After the versioning migration the author/year bare token IS canonical —
    // the former requirement for a trailing `[dev-corpus, non-final]` suffix is
    // gone.
    const file = join(workDir, "good-bare-author-year.md");
    writeFileSync(file, "Anchor: `(corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016)`.", "utf-8");
    const result = runTool(file);
    expect(result.code, result.stderr).toBe(0);
  });

  it("fails a token still carrying the retired [dev-corpus, non-final] suffix", () => {
    // The suffix is a retired format; a token that carries it is non-canonical.
    const file = join(workDir, "bad-retired-suffix.md");
    writeFileSync(
      file,
      "Anchor: `(corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016) [dev-corpus, non-final]`.",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("dev-corpus, non-final");
  });

  it("fails a token still carrying the retired dev-draft marker", () => {
    const file = join(workDir, "bad-retired-marker.md");
    writeFileSync(
      file,
      "Per `(corpus:methodology-003 § Mis-alignment-pattern catalogue, non-authoritative dev-draft, pending PIONEER source verification)`.",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
  });

  it("fails on the bare-id shortened form: (corpus:<id>)", () => {
    const file = join(workDir, "bad-bare-id.md");
    writeFileSync(file, "Per `(corpus:methodology-001)` the framework has three phases.", "utf-8");
    const result = runTool(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("(corpus:methodology-001)");
  });

  it("fails on the id-plus-suffix form: (corpus:<id>) [dev-corpus, non-final]", () => {
    const file = join(workDir, "bad-id-suffix.md");
    writeFileSync(
      file,
      "The Engage anchor `(corpus:methodology-001) [dev-corpus, non-final]` requires a Big Idea.",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/corpus:methodology-001/);
  });

  it("passes on a file with no corpus citations at all", () => {
    const file = join(workDir, "no-citations.md");
    writeFileSync(file, "# Findings\n\nLecturer said the skill felt slow but adequate.\n", "utf-8");
    const result = runTool(file);
    expect(result.code).toBe(0);
  });

  it("reports per-file results across multiple files (one pass, one fail)", () => {
    const good = join(workDir, "multi-good.md");
    const bad = join(workDir, "multi-bad.md");
    writeFileSync(good, "`(corpus:vocabulary-001 § Challenge Statement, Nichols et al. 2016)`", "utf-8");
    writeFileSync(bad, "`(corpus:vocabulary-001)`", "utf-8");
    const result = runTool(good, bad);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("[pass]");
    expect(result.stderr).toContain("[fail]");
  });

  it("exits 2 when called with no arguments", () => {
    const result = runTool();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 2 when a named file does not exist", () => {
    const result = runTool(join(workDir, "does-not-exist.md"));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("[error]");
  });

  // The following cases cover the two refinements added after the 02b eval:
  // multi-section tokens and non-canonical year tokens.

  it("rejects a multi-section citation joined by ' / '", () => {
    const file = join(workDir, "bad-multi-section-slash.md");
    writeFileSync(
      file,
      "Per `(corpus:foundations-003 § Institutional-Scale Implementation / Bounded Challenge Implementation, Nichols et al. 2016)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Institutional-Scale Implementation / Bounded Challenge Implementation");
  });

  it("rejects a multi-section citation joined by ' AND '", () => {
    const file = join(workDir, "bad-multi-section-and.md");
    writeFileSync(
      file,
      "Per `(corpus:methodology-001 § Phase 1: Engage AND Phase 2: Investigate, Nichols et al. 2016)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
  });

  it("rejects a multi-section citation joined by ' & '", () => {
    const file = join(workDir, "bad-multi-section-amp.md");
    writeFileSync(
      file,
      "Per `(corpus:methodology-001 § Phase 1: Engage & Phase 2: Investigate, Nichols et al. 2016)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
  });

  it("rejects a citation whose author/year is missing the year token", () => {
    const file = join(workDir, "bad-no-year.md");
    writeFileSync(
      file,
      "Per `(corpus:foundations-003 § Multiple Points of Entry, Challenge Based Learning)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(1);
  });

  it("rejects a citation whose year ends in a non-canonical suffix (e.g. '2010s', '20XX')", () => {
    // The regex enforces FORMAT, not semantic accuracy — so a hedged form
    // like "Kolb circa 2010" still ends in `\d{4}` and passes the gate
    // (semantic accuracy is an eval-reviewer responsibility, not the
    // regex's). What the regex DOES catch: terminal year-tokens that are
    // not a four-digit number or `n.d.`. The two common malformed shapes
    // are decade ranges ("2010s") and placeholder year-stubs ("20XX").
    const file = join(workDir, "bad-malformed-year.md");
    writeFileSync(file, "Per `(corpus:foundations-001 § Kolb's Learning Cycle, Kolb 2010s)` …", "utf-8");
    const result = runTool(file);
    expect(result.code).toBe(1);
  });

  it("accepts the literal 'n.d.' marker as the year token", () => {
    // Per spec: n.d. is permitted ONLY when the source has no year. The
    // regex cannot verify that semantics — it only enforces format. The
    // semantic check belongs to an eval-run reviewer; the regex allows the
    // shape so an otherwise-canonical citation with n.d. passes the gate.
    const file = join(workDir, "good-nd-marker.md");
    writeFileSync(
      file,
      "Per `(corpus:foundations-003 § Multiple Points of Entry, Challenge Based Learning n.d.)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(0);
  });

  it("accepts citations whose section heading contains slashes that are NOT multi-section joins", () => {
    // Example: a section literally titled "Engage/Investigate Transition" —
    // a single heading with a slash inside. The regex must not false-positive
    // here. Guard: the separator pattern is ` / ` (slash flanked by spaces),
    // not a bare slash.
    const file = join(workDir, "good-slash-in-heading.md");
    writeFileSync(
      file,
      "Per `(corpus:methodology-001 § Engage/Investigate Transition, Nichols et al. 2016)` …",
      "utf-8"
    );
    const result = runTool(file);
    expect(result.code).toBe(0);
  });
});
