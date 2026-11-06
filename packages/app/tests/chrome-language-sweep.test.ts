/**
 * The repo-wide half of the language rule (capability `desktop-app`, Requirement:
 * *Every String the App Renders Is English*, Scenario *No surface of the app
 * renders a language of its own*).
 *
 * **What this sweep now means.** German is a SHIPPED catalogue, so "no German in
 * the sources" is no longer the rule and would fail on `de.ts` by design. The rule
 * the requirement actually states is that no surface fixes its own language: every
 * rendered string resolves from the catalogue, and the catalogue is the ONLY place
 * a language's vocabulary appears. So the sweep asks a sharper question than
 * before — is there German OUTSIDE `src/shared/i18n/`? A hit there is a chrome
 * string somebody hardcoded past the catalogue, which is exactly the defect that
 * survives a type check.
 *
 * `chrome-copy.test.ts` sweeps the catalogue ENTRIES, in both directions (English
 * carrying German, German left at the English wording). That is necessary and not
 * sufficient: the catalogue contains no stray literal by construction, so on its
 * own it proves nothing about the surfaces the Scenario names — the conversation
 * header, the transcript, the two panels, the settings surface, the generative-UI
 * components and the notices the main process composes. A new inline German
 * literal in any of those would pass every catalogue sweep.
 *
 * So this file scans the real source trees, on the pattern `chrome-no-emoji.test.ts`
 * established for its own chrome-wide rule, and shares that file's machinery
 * (`helpers/source-scan.ts`).
 *
 * SCOPE, and why each boundary is where it is:
 *
 * - **Comments are blanked**, exactly as in the emoji sweep. The requirement
 *   governs what the app RENDERS; a comment renders nothing, and a stopword list
 *   cannot tell German prose from English that happens to contain `die`, `der` or
 *   `mit`. A code comment therefore never decides this test — which is also what
 *   keeps the allowlist below down to one entry instead of one per comment.
 * - **Tests and fixtures are not swept.** German fixture data — fake lecturer
 *   input, annotation notes, course content — is lecturer CONTENT, and translating
 *   it would weaken the very tests that prove a German-speaking lecturer is served
 *   correctly. No root below reaches a test tree.
 * - **`evaluation/` is not swept**, and neither is `packages/corpus-schema` (whose
 *   index generator carries an `[A-ZÄÖÜ]` character class — a parser, not chrome).
 * - **The chrome-string catalogue is not swept**, because it is where a shipped
 *   language's vocabulary belongs. That is a SCOPE boundary, not an exemption: the
 *   catalogue has its own two-directional sweep in `chrome-copy.test.ts`, and the
 *   test below asserts that the boundary is exactly `src/shared/i18n/` and that the
 *   directory really does carry the German it is excluded for — an exclusion that
 *   stopped matching anything would be silently widening this sweep's blind spot.
 *
 * The detector has two halves because either alone is blind: umlauts miss `Hilfe`,
 * `Senden`, `Notiz` and `Iterieren`, and the stopwords miss an umlaut word nobody
 * listed.
 *
 * **And the file no longer hunts only German.** Hunting one language cannot see an
 * ENGLISH chrome string declared past the catalogue — which is how four transcript
 * projections in `src/shared/*.ts` stayed English through the whole
 * interface-language change with every guard green. The second describe below asks
 * the language-generic question instead, derived from `LANGUAGES` rather than from
 * a word list: does any source outside the catalogue restate a string the
 * catalogue already owns, in ANY shipped language?
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readCode, REPO_ROOT, repoPath, sourceFiles } from "./helpers/source-scan.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";

/** The rendered app: the renderer, the main process, and the runtime behind them. */
const SCAN_ROOTS = ["packages/app/src", "packages/pi-bridge/src"];
const SOURCE_FILE = /\.(ts|tsx|css)$/;

/** The chrome-string catalogue — the one place a shipped language's vocabulary is
 * declared, and therefore out of this sweep's scope. */
const CATALOGUE_DIR = "packages/app/src/shared/i18n/";

const UMLAUT = /[äöüÄÖÜß]/g;

/**
 * German words that carry no umlaut, so the umlaut half cannot see them. Two
 * groups: the chrome labels this repo has actually rendered in German (`Hilfe`,
 * `Senden`, `Notiz`, `Iterieren`, `Übernehmen`, …), and the closed-class grammar
 * words that give away a German sentence.
 *
 * Kept conservative on purpose — every entry is matched on a WORD BOUNDARY, and a
 * false positive is answered by tightening the boundary rather than by dropping
 * the word, which would quietly shrink the detector.
 */
const STOPWORDS =
  /\b(Hilfe|Senden|Notiz|Notizen|Iterieren|Uebernehmen|Übernehmen|Hinzufuegen|Hinzufügen|Dateien|Nachricht|Nachrichten|Modell|Antwort|Entscheidungen|Angehängte|Angehaengte|Weitere|Aktionen|hochladen|gesperrt|läuft|laeuft|nicht|noch|wird|werden|und|oder|kein|keine|einen|eine|der|die|das|den|dem|des|von|mit|fuer|für|zum|zur|auf|ist|sind|sich|Gespraech|Gespräch)\b/g;

/**
 * Individually justified exceptions — a specific FILE plus the specific reason its
 * German is legitimate. Never a directory, never a relaxed detector: chrome is
 * fixed at the string, not exempted here.
 */
const ALLOWED = new Map<string, string>([
  [
    // Model-facing prompt prose, not chrome: the guideline teaches the model to
    // recognise a German plural interrogative ("Welche Kompetenzen…"), and names the
    // German "other" labels it must NOT invent. The lecturer never reads either.
    // Response language mirrors the lecturer and is explicitly outside this rule
    // (capability `cbe-skill`, Requirement: *Response Language Mirrors the Lecturer*).
    "packages/pi-bridge/src/picker-tool.ts",
    "German EXAMPLE phrasing inside model-facing prompt guidelines — the lecturer never reads it",
  ],
]);

type Hit = { file: string; line: number; column: number; token: string; excerpt: string };

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(SCAN_ROOTS, SOURCE_FILE)) {
    if (repoPath(file).startsWith(CATALOGUE_DIR)) continue;
    const lines = readCode(file).split("\n");
    lines.forEach((line, index) => {
      for (const detector of [UMLAUT, STOPWORDS]) {
        detector.lastIndex = 0;
        for (const match of line.matchAll(detector)) {
          hits.push({
            file: repoPath(file),
            line: index + 1,
            column: (match.index ?? 0) + 1,
            token: match[0],
            excerpt: line.trim().slice(0, 100),
          });
        }
      }
    });
  }
  return hits;
}

const describeHit = (hit: Hit): string =>
  `${hit.file}:${hit.line}:${hit.column} — German token "${hit.token}" in: ${hit.excerpt}`;

describe("no source under the app renders a German chrome string", () => {
  const hits = scan();

  it("finds no umlaut and no German stopword outside the justified file allowlist", () => {
    const offenders = hits.filter((h) => !ALLOWED.has(h.file)).map(describeHit);
    expect(
      offenders,
      `German outside the chrome-string catalogue. Every string the app renders resolves from ` +
        `the catalogue in the configured interface language (capability \`desktop-app\`, ` +
        `Requirement: *Every String the App Renders Is English*). A German literal here is a ` +
        `chrome string hardcoded past the catalogue: move the wording into ` +
        `\`src/shared/i18n/\` and resolve it — allowlisting it defeats the rule:\n` +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("scans the rendered app's sources and neither tests, fixtures nor the eval harness", () => {
    const files = sourceFiles(SCAN_ROOTS, SOURCE_FILE).map(repoPath);
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.startsWith("packages/app/src/renderer/"))).toBe(true);
    expect(files.some((f) => f.startsWith("packages/app/src/main/"))).toBe(true);
    expect(files.some((f) => f.startsWith("packages/pi-bridge/src/"))).toBe(true);
    expect(files).toContain("packages/app/src/renderer/styles.css");
    // The surfaces the Scenario names, each reached by this sweep and by no owner sweep.
    for (const surface of [
      "packages/app/src/renderer/components/SettingsPanel.tsx",
      "packages/app/src/renderer/components/CoursesPanel.tsx",
      "packages/app/src/renderer/components/MaturityPanel.tsx",
      "packages/app/src/renderer/components/AppHeader.tsx",
      "packages/app/src/main/ipc.ts",
    ]) {
      expect(files).toContain(surface);
    }
    expect(files.some((f) => f.includes("/tests/") || f.includes("/fixtures/"))).toBe(false);
    expect(files.some((f) => f.startsWith("evaluation/"))).toBe(false);
  });

  it("excludes the catalogue by SCOPE, and only the catalogue", () => {
    // The exclusion is worth exactly what it excludes. Two halves: the German
    // catalogue really is in the scanned set and really does carry German (so the
    // exclusion is doing work rather than matching nothing), and it is the only
    // thing excluded — every other swept file still reaches the detector.
    const swept = sourceFiles(SCAN_ROOTS, SOURCE_FILE).map(repoPath);
    expect(swept).toContain("packages/app/src/shared/i18n/de.ts");
    const german = readCode(join(REPO_ROOT, "packages/app/src/shared/i18n/de.ts"));
    UMLAUT.lastIndex = 0;
    expect(UMLAUT.test(german), "de.ts carries no German — the exclusion has stopped meaning anything").toBe(true);

    // The expected set is DERIVED from the shipped registry — one file per
    // language plus `index` and `types` — rather than written out. A hand-kept
    // list would have to be edited every time a language ships, which is exactly
    // the "adding a language touches no test" property this catalogue exists for.
    const excluded = swept.filter((f) => f.startsWith(CATALOGUE_DIR));
    expect(excluded.sort()).toEqual(
      [...Object.keys(LANGUAGES), "index", "types"].map((name) => `${CATALOGUE_DIR}${name}.ts`).sort()
    );
    // …and the English catalogue, though excluded here, is swept for German by
    // `chrome-copy.test.ts` — neither file is unguarded.
    expect(excluded).toContain("packages/app/src/shared/i18n/en.ts");
  });

  it("detects both halves — an umlaut, and a German label that carries none", () => {
    // The detector is only worth what it catches; assert it on synthetic lines
    // rather than trusting that a clean tree means a working sweep.
    const probe = (line: string): boolean =>
      [UMLAUT, STOPWORDS].some((re) => {
        re.lastIndex = 0;
        return re.test(line);
      });
    expect(probe('const LABEL = "Angehängte Dokumente";')).toBe(true);
    expect(probe('const LABEL = "Senden";')).toBe(true);
    expect(probe('const LABEL = "Hilfe";')).toBe(true);
    expect(probe('const LABEL = "+ Notiz";')).toBe(true);
    expect(probe('const LABEL = "↻ Iterieren";')).toBe(true);
    expect(probe('const LABEL = "Dateien hochladen";')).toBe(true);
    expect(probe('const LABEL = "Agent laeuft, Senden ist gesperrt";')).toBe(true);
    // …and does not fire on the English chrome that replaced them.
    for (const english of [
      'const LABEL = "Attached documents";',
      'const LABEL = "Send";',
      'const LABEL = "Help";',
      'const LABEL = "+ Note";',
      'const LABEL = "↻ Iterate";',
      'const LABEL = "Upload files";',
      'const LABEL = "More actions";',
      'const LABEL = "No model configured";',
    ]) {
      expect(probe(english), english).toBe(false);
    }
  });

  it("ignores German that only occurs in a comment, and never in a literal", () => {
    const blanked = readCode(join(REPO_ROOT, "packages/app/tests/helpers/source-scan.ts"));
    expect(blanked).not.toContain("Blanks out comments");
    const probe = (line: string): boolean => {
      UMLAUT.lastIndex = 0;
      return UMLAUT.test(line);
    };
    expect(probe('// the old label read "Angehängte Dokumente"')).toBe(true);
    expect(probe(readCode(join(REPO_ROOT, "packages/pi-bridge/src/design-substance.ts")))).toBe(false);
  });

  it("keeps the allowlist narrow — every entry names a real file and a reason, and still applies", () => {
    const hitFiles = new Set(hits.map((h) => h.file));
    for (const [file, why] of ALLOWED) {
      expect(why.length).toBeGreaterThan(20);
      // An exemption that no longer matches anything is removed, not left standing.
      expect(hitFiles.has(file), `${file} no longer carries German — drop its allowlist entry`).toBe(true);
    }
    // The allowlist is per FILE. A file that renders chrome is never on it.
    for (const file of ALLOWED.keys()) expect(file.startsWith("packages/app/src/renderer/")).toBe(false);
  });
});

/**
 * The half that is not about German.
 *
 * The sweep above asks "is there GERMAN outside the catalogue?", which by
 * construction cannot see an ENGLISH chrome string somebody declared past the
 * catalogue — the exact blind spot that let four transcript projections in
 * `src/shared/*.ts` stay English through a whole interface-language change. So a
 * second, language-GENERIC question is asked here: does any source outside the
 * catalogue restate a string the catalogue already owns, in ANY shipped language?
 *
 * It is derived from `LANGUAGES` rather than from a word list, so adding French
 * makes it hunt French with nobody editing this file — the same property that
 * makes a new language a catalogue file and nothing else.
 *
 * Scoped to real COPY (at least eight characters and containing a space): a
 * one-word entry like "Add" collides with ordinary identifiers and would buy
 * false positives instead of coverage. And to `packages/app/src`, because
 * `packages/pi-bridge` owns no catalogue and its prose is model-facing.
 */
const RESTATEMENT_ROOTS = ["packages/app/src"];
const RESTATEMENT_FILE = /\.tsx?$/;
const STRING_LITERAL = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\$]*)`/g;

/**
 * A structural field whose value is a grouping key, not copy — the UI registry's
 * `area`. Named as a FIELD, on the same discipline that keeps `role` and `data-*`
 * out of the attribute detector in `chrome-inline-literals.test.ts`: it is not an
 * exemption for a file, it is a statement about what that field is.
 */
const STRUCTURAL_FIELD = /\barea\s*:\s*$/;

/** Every shipped language's real copy, as one set. */
function catalogueCopy(): Map<string, string> {
  const byValue = new Map<string, string>();
  for (const [code, language] of Object.entries(LANGUAGES)) {
    for (const [key, value] of Object.entries(language.strings)) {
      if (typeof value !== "string") continue;
      const v = value.trim();
      if (v.length < 8 || !/\s/.test(v)) continue;
      if (!byValue.has(v)) byValue.set(v, `${code}.${key}`);
    }
  }
  return byValue;
}

function restatements(): string[] {
  const owned = catalogueCopy();
  const offenders: string[] = [];
  for (const file of sourceFiles(RESTATEMENT_ROOTS, RESTATEMENT_FILE)) {
    const rel = repoPath(file);
    if (rel.startsWith(CATALOGUE_DIR)) continue;
    const code = readCode(file);
    STRING_LITERAL.lastIndex = 0;
    for (const m of code.matchAll(STRING_LITERAL)) {
      const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      const owner = owned.get(value);
      if (!owner) continue;
      const index = m.index ?? 0;
      if (STRUCTURAL_FIELD.test(code.slice(Math.max(0, index - 24), index))) continue;
      offenders.push(`${rel}:${code.slice(0, index).split("\n").length} restates ${owner}: "${value}"`);
    }
  }
  return offenders;
}

describe("no source outside the catalogue restates a string the catalogue owns", () => {
  it("finds no chrome copy declared past the catalogue, in any shipped language", () => {
    expect(
      restatements(),
      `A string the chrome catalogue already owns is declared again in the sources. Read the entry ` +
        `instead (capability \`desktop-app\`, Requirement: *Each Rendered Chrome String Has Exactly One ` +
        `Owner*) — a second declaration is a copy that will not move when the lecturer changes language:`
    ).toEqual([]);
  });

  it("sweeps real copy from every shipped language, and reaches the shared modules", () => {
    const owned = catalogueCopy();
    expect(owned.size).toBeGreaterThan(300);
    // Both directions of the leak the German sweep cannot see: an English entry
    // and a German one are equally owned.
    expect([...owned.values()].some((o) => o.startsWith("en."))).toBe(true);
    expect([...owned.values()].some((o) => o.startsWith("de."))).toBe(true);
    const files = sourceFiles(RESTATEMENT_ROOTS, RESTATEMENT_FILE).map(repoPath);
    for (const module of [
      "packages/app/src/shared/turn-stop.ts",
      "packages/app/src/shared/help-token.ts",
      "packages/app/src/shared/truncation-cutoff.ts",
      "packages/app/src/main/sessions.ts",
    ]) {
      expect(files).toContain(module);
    }
  });

  it("fires on a synthetic restatement, and stays quiet on the resolved form", () => {
    // The sweep is only worth what it catches; prove the detector on a string the
    // catalogue really owns rather than trusting a clean tree.
    const owned = catalogueCopy();
    const [copy] = [...owned.keys()];
    expect(copy).toBeTruthy();
    const seen = (source: string): boolean => {
      STRING_LITERAL.lastIndex = 0;
      return [...source.matchAll(STRING_LITERAL)].some((m) => owned.has((m[1] ?? m[2] ?? m[3] ?? "").trim()));
    };
    expect(seen(`const NOTE = ${JSON.stringify(copy!)};`)).toBe(true);
    expect(seen("const NOTE = chrome().chatStoppedTurnPlaceholder;")).toBe(false);
    // The structural field is skipped by the field's NAME, not by its file.
    const registry = `  area: ${JSON.stringify(LANGUAGES.en!.strings.headerLabel)},`;
    const index = registry.indexOf('"');
    expect(STRUCTURAL_FIELD.test(registry.slice(0, index))).toBe(true);
  });
});
