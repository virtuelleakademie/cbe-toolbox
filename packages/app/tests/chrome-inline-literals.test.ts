/**
 * No module of the app declares a rendered chrome literal (capability
 * `desktop-app`, Requirement: *Each Rendered Chrome String Has Exactly One Owner*
 * — "A component MUST NOT inline a user-facing literal at all", Scenario *A chrome
 * literal inlined in a component is caught*).
 *
 * **Why a source sweep and not a type.** A catalogue entry is a `string`, and so
 * is a literal: nothing in the type system can tell `aria-label={t.chatSendLabel}`
 * from `aria-label="Send"`. The completeness of a LANGUAGE is a compile error
 * (`i18n-completeness.test.ts` proves that by running `tsc`); the completeness of
 * the CATALOGUE — that every rendered string got into it — can only be checked
 * against the source. Without this, a new hardcoded label ships untranslatable in
 * every language but one, and every other guard stays green.
 *
 * **What counts as rendered.** Three shapes, all narrow on purpose:
 *
 * - a lecturer-facing ATTRIBUTE with a literal value — `aria-label`, `title`,
 *   `placeholder`, `aria-description`, `alt`, `aria-valuetext`. `role`,
 *   `className`, `data-*` and the rest are structure and are not swept.
 * - a JSX TEXT NODE carrying a letter — `<button>Send</button>`.
 * - a DISPLAY PROJECTION: a module-level constant whose NAME declares it to be
 *   copy the app puts in front of the lecturer (`…_DISPLAY_TEXT`, `…_PLACEHOLDER`,
 *   `…_NOTE`, `…_LABEL`, …) assigned a string literal.
 *
 * The third shape is why this file no longer sweeps `.tsx` under `src/renderer`
 * alone. A rendered string does NOT need JSX to reach a surface: four transcript
 * projections lived in `src/shared/*.ts` — the Continue/Retry turn text, the help
 * turn, the stopped-turn placeholder — and stayed English through a whole
 * interface-language change because no guard could see a `.ts` module. The
 * MAIN process authors lecturer-facing chrome of its own for the same reason, so
 * all three trees are swept and the JSX detectors simply do not fire in a `.ts`
 * file.
 *
 * A naming-based detector has a stated limit: it sees a string a declaration
 * NAMES as rendered copy, not one returned inline from a function. It is the
 * shape the defect actually took, and it costs no false positives; the wider
 * question — is a language's vocabulary declared outside the catalogue at all — is
 * `chrome-language-sweep.test.ts`'s, which sweeps the same trees for a literal
 * restating any shipped catalogue entry.
 *
 * SCOPE. Comments are blanked first (shared `source-scan` machinery), so prose in
 * a comment never decides the rule. The chrome-string catalogue itself is out of
 * scope — it is where every one of these strings is SUPPOSED to be declared — and
 * that boundary is asserted below rather than assumed. `packages/pi-bridge` is not
 * swept: it is the runtime layer, it owns no catalogue, and most of its prose is
 * model-facing.
 *
 * A genuine exception is allowlisted per FILE with a stated reason, never as a
 * directory and never by relaxing the detector.
 */
import { describe, expect, it } from "vitest";
import { readCode, repoPath, sourceFiles } from "./helpers/source-scan.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";

const SCAN_ROOTS = ["packages/app/src/renderer", "packages/app/src/main", "packages/app/src/shared"];
const SOURCE_FILE = /\.tsx?$/;
const JSX_FILE = /\.tsx$/;

/** The one place a shipped language's vocabulary is declared, and therefore the
 * one place these literals belong. */
const CATALOGUE_DIR = "packages/app/src/shared/i18n/";

/** Attributes whose value a lecturer or their assistive technology reads. */
const CHROME_ATTRIBUTE = /\b(aria-label|aria-description|aria-valuetext|title|placeholder|alt)=\{?"([^"]*)"/g;

/** A JSX text node between two tags, carrying at least one letter. */
const JSX_TEXT = />([^<>{}]*\p{L}[^<>{}]*)</gu;

/**
 * A module-level constant whose NAME declares it to be copy the app renders,
 * assigned a string literal. Matched over the whole file rather than per line,
 * because the value of such a constant is routinely wrapped onto the next one.
 */
const DISPLAY_PROJECTION =
  /\b(?:const|let)\s+([A-Z][A-Z0-9_]*(?:_DISPLAY_TEXT|_DISPLAY|_PLACEHOLDER|_LABEL|_TITLE|_NOTE|_NOTICE|_MESSAGE|_TEXT|_HINT|_COPY|_HEADING|_CAPTION))\s*(?::\s*[^=;]+)?=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

/**
 * Values that are never chrome even when they sit in a chrome attribute. Kept to
 * shapes rather than to a word list: a bare identifier or path is a test hook or a
 * DOM id, not copy a lecturer reads as a sentence.
 */
function isStructural(value: string): boolean {
  const v = value.trim();
  if (v === "") return true;
  // Single lower-case token, kebab or snake or dotted: an id, a slug, a data key.
  if (/^[a-z][a-z0-9]*([-_.][a-z0-9]+)*$/.test(v)) return true;
  // A glyph-only run (arrows, chevrons, the × dismiss mark) carries no words.
  if (!/\p{L}/u.test(v)) return true;
  return false;
}

/**
 * Individually justified exceptions — a specific FILE plus the specific reason its
 * literal is not chrome.
 *
 * **It is empty, and that is the finding.** After the sweep that moved every
 * rendered string into the catalogue, no module in the tree needs an
 * exemption — so the rule holds without one. Adding an entry here means a
 * module is rendering a string the catalogue does not own, which is the defect
 * this file exists to catch: fix the string, do not list the file.
 */
const ALLOWED = new Map<string, string>();

type Hit = { file: string; line: number; kind: string; value: string };

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

function swept(): string[] {
  return sourceFiles(SCAN_ROOTS, SOURCE_FILE)
    .map(repoPath)
    .filter((f) => !f.startsWith(CATALOGUE_DIR));
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(SCAN_ROOTS, SOURCE_FILE)) {
    const rel = repoPath(file);
    if (rel.startsWith(CATALOGUE_DIR) || ALLOWED.has(rel)) continue;
    const code = readCode(file);
    if (JSX_FILE.test(rel)) {
      code.split("\n").forEach((line, index) => {
        for (const m of line.matchAll(CHROME_ATTRIBUTE)) {
          if (!isStructural(m[2]!)) hits.push({ file: rel, line: index + 1, kind: m[1]!, value: m[2]! });
        }
        for (const m of line.matchAll(JSX_TEXT)) {
          if (!isStructural(m[1]!)) hits.push({ file: rel, line: index + 1, kind: "text", value: m[1]!.trim() });
        }
      });
    }
    DISPLAY_PROJECTION.lastIndex = 0;
    for (const m of code.matchAll(DISPLAY_PROJECTION)) {
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (!isStructural(value)) {
        hits.push({ file: rel, line: lineOf(code, m.index ?? 0), kind: `const ${m[1]!}`, value });
      }
    }
  }
  return hits;
}

describe("no module of the app declares a rendered chrome literal", () => {
  it("finds no hardcoded label, title, placeholder, text node or display projection", () => {
    const offenders = scan().map((h) => `${h.file}:${h.line} — ${h.kind}: "${h.value}"`);
    expect(
      offenders,
      `A rendered string is hardcoded outside the catalogue. Every chrome string resolves from the ` +
        `interface-language catalogue (capability \`desktop-app\`, Requirement: *Each Rendered Chrome ` +
        `String Has Exactly One Owner*): add an entry to \`src/shared/i18n/en.ts\` and its translation ` +
        `to every other catalogue, then read it through \`useChrome()\` in a component, \`chrome()\` in ` +
        `plain renderer code, or \`main/interface-language.ts\`'s \`chrome()\` in the main process. ` +
        `A string the MODEL reads is not chrome and does not move — declare it as a payload, not as ` +
        `a display projection. Allowlisting a genuine chrome string defeats the rule:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("sweeps the renderer, the main process and the shared modules — and not the catalogue", () => {
    const files = swept();
    expect(files.length).toBeGreaterThan(20);
    for (const surface of [
      "packages/app/src/renderer/components/ChatPanel.tsx",
      "packages/app/src/renderer/components/SettingsPanel.tsx",
      "packages/app/src/renderer/components/CoursesPanel.tsx",
      "packages/app/src/renderer/components/MaturityPanel.tsx",
      "packages/app/src/renderer/components/AppHeader.tsx",
      // The three trees the JSX-only sweep could not see, each a proven carrier:
      // a transcript projection, a main-process message, a renderer `.ts` module.
      "packages/app/src/shared/turn-stop.ts",
      "packages/app/src/main/ipc.ts",
      "packages/app/src/renderer/state/conversationReducer.ts",
    ]) {
      expect(files).toContain(surface);
    }
    // The catalogue is excluded by SCOPE, and the exclusion really does exclude
    // something — an exclusion that has stopped matching is a widening blind spot.
    // DERIVED from the shipped registry — one file per language plus `index` and
    // `types`. Written out, this list would need an edit every time a language
    // ships, which is the one cost the catalogue design promises a language never has.
    const all = sourceFiles(SCAN_ROOTS, SOURCE_FILE).map(repoPath);
    expect(all.filter((f) => f.startsWith(CATALOGUE_DIR)).sort()).toEqual(
      [...Object.keys(LANGUAGES), "index", "types"].map((name) => `${CATALOGUE_DIR}${name}.ts`).sort()
    );
    expect(files.some((f) => f.includes("/tests/"))).toBe(false);
  });

  it("detects all three shapes, and does not fire on a resolved entry", () => {
    // The detector is only worth what it catches: assert it on synthetic lines
    // rather than trusting that a clean tree means a working sweep.
    const probe = (source: string): boolean => {
      CHROME_ATTRIBUTE.lastIndex = 0;
      JSX_TEXT.lastIndex = 0;
      DISPLAY_PROJECTION.lastIndex = 0;
      const attr = [...source.matchAll(CHROME_ATTRIBUTE)].some((m) => !isStructural(m[2]!));
      const text = [...source.matchAll(JSX_TEXT)].some((m) => !isStructural(m[1]!));
      const decl = [...source.matchAll(DISPLAY_PROJECTION)].some((m) => !isStructural(m[2] ?? m[3] ?? m[4] ?? ""));
      return attr || text || decl;
    };
    expect(probe('<button aria-label="Send">')).toBe(true);
    expect(probe('<input placeholder="New course title" />')).toBe(true);
    expect(probe('<span title="Delete this artefact">')).toBe(true);
    expect(probe("<button>Start new session</button>")).toBe(true);
    // …the display projections that reached a human reviewer instead of a red test,
    // including the wrapped form a per-line sweep would have missed.
    expect(probe('export const HELP_DISPLAY_TEXT = "Help requested";')).toBe(true);
    expect(probe('export const STOPPED_TURN_PLACEHOLDER = "You stopped this answer before it began.";')).toBe(true);
    expect(probe('const TRUNCATION_RETRY_DISPLAY_TEXT = "Retry";')).toBe(true);
    expect(probe('export const LOOP_ABORT_NOTE =\n  "I kept calling the same tool and stopped.";')).toBe(true);
    // …and stays quiet on the resolved form, on structural values, and on the
    // model-facing payload beside them — what the model reads is not chrome.
    expect(probe("<button aria-label={t.chatSendLabel}>")).toBe(false);
    expect(probe("<button>{t.chatSendLabel}</button>")).toBe(false);
    expect(probe('<div role="status" className="chat-notice" data-tool="cbe_canvas">')).toBe(false);
    expect(probe('<span aria-hidden="true">×</span>')).toBe(false);
    expect(probe('export const HELP_TOKEN = "[help · app]";')).toBe(false);
    expect(probe("const displayText = chrome().chatHelpDisplayText;")).toBe(false);
  });

  it("needs no allowlist at all, and any entry it grows names a real file and a reason", () => {
    // The empty list is the assertion: every rendered string in the tree resolves
    // from the catalogue. A future entry still has to earn its place.
    expect([...ALLOWED.keys()]).toEqual([]);
    const files = swept();
    for (const [file, why] of ALLOWED) {
      expect(why.length).toBeGreaterThan(20);
      // An exemption for a file that does not exist is dead weight that hides the
      // next real one; the sweep's own file list is the check.
      expect(files).toContain(file);
    }
  });
});
