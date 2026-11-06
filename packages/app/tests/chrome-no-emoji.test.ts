/**
 * Tests for `specs/desktop-app/spec.md`, Requirement *Iconography Instead of Emojis*
 * — Scenarios *No emojis in app chrome by Phase 2* and *Every emoji placeholder in
 * chrome is replaced library-agnostically*, whose THEN is chrome-wide ("no emoji
 * remains" across settings, header, banners, tool cards, status dots, mode selector
 * and both panels).
 *
 * `iconography.test.tsx` renders the two surfaces the rollout touched. This file
 * freezes the chrome-wide half: it scans the rendered renderer and main sources for
 * the emoji and dingbat ranges and fails on anything outside a narrow, per-codepoint
 * allowlist of typographic marks that live inside text runs.
 */
import { describe, expect, it } from "vitest";
import { blankComments, readCode, repoPath, sourceFiles } from "./helpers/source-scan.js";

/** Chrome only — never tests, fixtures, or another package. */
// The chrome-string catalogue joins the two process trees: since
// `choose-the-interface-language` a rendered glyph lives in `shared/i18n/` rather
// than in the component, so a sweep that read only `renderer` and `main` would
// stop seeing the very characters this rule is about — `←`, `↻` and the rest
// moved there with the labels that carry them.
const SCAN_ROOTS = ["packages/app/src/renderer", "packages/app/src/main", "packages/app/src/shared/i18n"];
const SOURCE_FILE = /\.(ts|tsx|css|html)$/;

/** The emoji, dingbat, arrow and geometric-shape ranges the requirement forbids. */
const FORBIDDEN = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{25A0}-\u{25FF}]/gu;

/**
 * Individually justified exceptions — typographic characters that are part of a text
 * run, not an icon standing in for a status / mode / affordance marker. Never a range,
 * never a whole-file exemption: a new codepoint has to be argued for on its own line.
 */
const ALLOWED = new Map<number, string>([
  // U+2190 — the "← Back" / "← Wiki" back affordance in the course detail view and the wiki browser.
  [0x2190, "back arrow inside a button's text label"],
  // U+2192 — flow arrows inside text runs: the tool-card head marker, the step-select affordance,
  // the alignment deep-link, the profile card head (`dimension → value`) and the settings hint.
  [0x2192, "forward / flow arrow inside a text run"],
  // U+2193 — the "↓ Jump to latest" scroll affordance in the chat; the surrounding button is named.
  [0x2193, "scroll-to-latest arrow inside a button's text label"],
  // U+21BB — the reload arrow in the "↻ Iterate" button, whose wording the desktop-app spec fixes
  // verbatim in Requirement *Artifact Annotation and Iteration Loop*.
  [0x21bb, "reload arrow in the spec-fixed “↻ Iterate” label"],
  // U+25B8 — the collapsed disclosure chevron on phase, decision and thinking sections.
  [0x25b8, "collapsed disclosure chevron"],
  // U+25BE — the expanded disclosure chevron on the same sections.
  [0x25be, "expanded disclosure chevron"],
  // U+25CF — the focus dot in front of the "focus" step marker in the canvas panel.
  [0x25cf, "step-focus dot inside a text run"],
]);

type Hit = { file: string; line: number; column: number; char: string; codePoint: number; excerpt: string };

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(SCAN_ROOTS, SOURCE_FILE)) {
    const lines = readCode(file).split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(FORBIDDEN)) {
        const char = match[0];
        hits.push({
          file: repoPath(file),
          line: index + 1,
          column: (match.index ?? 0) + 1,
          char,
          codePoint: char.codePointAt(0) as number,
          excerpt: line.trim().slice(0, 100),
        });
      }
    });
  }
  return hits;
}

function describeHit(hit: Hit): string {
  const cp = `U+${hit.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  return `${hit.file}:${hit.line}:${hit.column} — ${cp} ${hit.char} in: ${hit.excerpt}`;
}

describe("app chrome carries no emoji placeholders", () => {
  const hits = scan();

  it("finds no emoji or dingbat outside the justified typographic allowlist", () => {
    const offenders = hits.filter((h) => !ALLOWED.has(h.codePoint)).map(describeHit);
    expect(
      offenders,
      `Emoji / dingbat placeholders in app chrome (render one with the inline-SVG icon components instead, ` +
        `or justify the codepoint in ALLOWED):\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("scans the rendered chrome sources and nothing else", () => {
    const files = sourceFiles(SCAN_ROOTS, SOURCE_FILE).map(repoPath);
    // The catalogue is where a rendered glyph now lives, so it has to be in the set.
    expect(files).toContain("packages/app/src/shared/i18n/en.ts");
    expect(files).toContain("packages/app/src/shared/i18n/de.ts");
    expect(files.length).toBeGreaterThan(50);
    expect(files.every((f) => f.startsWith("packages/app/src/"))).toBe(true);
    expect(files.some((f) => f.includes("/tests/") || f.includes("/fixtures/"))).toBe(false);
    expect(files).toContain("packages/app/src/renderer/styles.css");
  });

  it("ignores glyphs that only occur in comments", () => {
    const blanked = blankComments(
      ['const label = "→ go";', "// a comment arrow ⇒ and an emoji 🚀", "/* block ↔ */ const x = 1;"].join("\n")
    );
    expect(blanked).toContain("→ go");
    expect(blanked).not.toMatch(/[⇒🚀↔]/u);
  });

  it("keeps the allowlist explicit — every entry carries a justification", () => {
    for (const [codePoint, why] of ALLOWED) {
      expect(typeof codePoint).toBe("number");
      expect(why.length).toBeGreaterThan(10);
    }
    // Each allowed codepoint must still be reachable in the chrome; an allowance that no
    // longer applies to any source line is removed rather than left standing.
    const present = new Set(hits.map((h) => h.codePoint));
    for (const codePoint of ALLOWED.keys()) expect(present.has(codePoint)).toBe(true);
  });
});
