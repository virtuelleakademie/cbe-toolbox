/**
 * The catalogue's completeness guarantee, and the price of a further language
 * (capability `desktop-app`, Requirement: *Each Rendered Chrome String Has
 * Exactly One Owner*).
 *
 * **The type system is the completeness check**, so most of this file's subject
 * matter is not observable at run time: a missing key and a foreign key are `tsc`
 * errors, not values a test can read back. Asserting them therefore means
 * actually RUNNING the type check against deliberately broken catalogues — which
 * is what the first describe block does, on fixtures under
 * `tests/fixtures/i18n-broken/`. A check that cannot fail is a placebo, and
 * "the compiler would catch it" is exactly the claim that needs evidence.
 *
 * The rest is what types cannot reach: that a translation actually USES its
 * parameters, and that shipping a fourth language touches nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import {
  LANGUAGES,
  REFERENCE_LANGUAGE,
  catalogueFor,
  interfaceLanguageOptions,
  isInterfaceLanguage,
  resolveLanguageFromLocale,
  stringsFor,
  type LanguageCatalogue,
} from "../src/shared/i18n/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const TSC = path.join(REPO_ROOT, "node_modules", ".bin", "tsc");

/**
 * Type-check ONE catalogue variant: the real `en.ts` and `types.ts` beside a
 * German file we may sabotage. Returns tsc's combined output, or "" when it
 * passed — so a test can assert both that it fails and WHY.
 */
function typeCheck(deSource: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cbe-i18n-check-"));
  try {
    const i18n = path.join(dir, "i18n");
    mkdirSync(i18n);
    for (const file of ["en.ts", "types.ts"]) {
      writeFileSync(path.join(i18n, file), readFileSync(path.join(APP_ROOT, "src", "shared", "i18n", file), "utf8"));
    }
    writeFileSync(path.join(i18n, "de.ts"), deSource);
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(REPO_ROOT, "tsconfig.base.json"),
        compilerOptions: { noEmit: true, types: [] },
        include: ["i18n/**/*.ts"],
      })
    );
    try {
      execFileSync(TSC, ["-p", path.join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
      return "";
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REAL_DE = readFileSync(path.join(APP_ROOT, "src", "shared", "i18n", "de.ts"), "utf8");

describe("an incomplete language does not compile", () => {
  it("passes on the catalogues as they ship — the control for everything below", () => {
    // Without this, a broken harness would make every negative case below pass
    // for the wrong reason.
    expect(typeCheck(REAL_DE)).toBe("");
  });

  it("fails, naming the key, when a language file is missing one", () => {
    // Scenario: A language file missing a key fails the build.
    const sabotaged = REAL_DE.replace(/\n {2}appRetry: "[^"]*",/, "");
    expect(sabotaged, "the sabotage did not apply — fix the fixture, not the check").not.toBe(REAL_DE);
    const output = typeCheck(sabotaged);
    expect(output).toMatch(/error TS/);
    expect(output).toContain("appRetry");
  });

  it("fails, naming the foreign key, when a language file declares one no catalogue has", () => {
    // Scenario: A language file with a key no other language has fails the build.
    const sabotaged = REAL_DE.replace(/\n {2}appRetry: /, '\n  appRetryTypo: "x",\n  appRetry: ');
    expect(sabotaged).not.toBe(REAL_DE);
    const output = typeCheck(sabotaged);
    expect(output).toMatch(/error TS/);
    expect(output).toContain("appRetryTypo");
  });

  it("fails when a parametrised entry declares a different parameter shape", () => {
    // Scenario: A parametrised string keeps its parameters in every language.
    // The shipped German file omits its parameter annotations and inherits them
    // contextually, so the sabotage has to state a wrong one explicitly.
    const sabotaged = REAL_DE.replace(
      /\n {2}headerShowCoursesLabel: \(p\) =>[^\n]*/,
      "\n  headerShowCoursesLabel: (p: { kurs: string }) => `x ${p.kurs}`,"
    );
    expect(sabotaged).not.toBe(REAL_DE);
    const output = typeCheck(sabotaged);
    // The compiler reports the incompatible SHAPES rather than the entry name —
    // parameters are contravariant, so it names both sides of the mismatch. That
    // is the evidence: the wrong parameter object cannot be assigned at all.
    expect(output).toMatch(/error TS2322/);
    expect(output).toContain("kurs");
    expect(output).toContain("course");
    expect(output).toContain("de.ts");
  });
}, 60_000);

describe("a translation keeps the values it is given", () => {
  /**
   * A type check cannot see that a translation USES its parameters — `(p) => "x"`
   * is assignable to `(p: { filename: string }) => string`. So every
   * function-valued entry is called with sentinel values and its output searched
   * for them. Sentinels are per parameter NAME rather than per entry, so a new
   * parametrised string needs no new table row unless it introduces a new
   * parameter name — and one that does fails loudly below rather than silently
   * going unchecked.
   */
  const SENTINEL: Record<string, string | number> = {
    course: "S-COURSE",
    chats: "S-CHATS",
    wiki: "S-WIKI",
    about: "S-ABOUT",
    language: "S-LANGUAGE",
    code: "S-CODE",
    formats: "S-FORMATS",
    purpose: "S-PURPOSE",
    modelId: "S-MODEL",
    filename: "S-FILE",
    error: "S-ERROR",
    reason: "S-REASON",
    attempt: 4242,
    maxAttempts: 8484,
    count: 4242,
    path: "S-PATH",
    label: "S-LABEL",
    step: 4242,
    name: "S-NAME",
    stamp: "S-STAMP",
    depth: "S-DEPTH",
    note: "S-NOTE",
    detail: "S-DETAIL",
    index: 4242,
    used: "S-USED",
    window: "S-WINDOW",
    percent: 4242,
    runLocked: "S-RUNLOCKED",
    have: "S-HAVE",
    changes: "S-CHANGES",
    more: "S-MORE",
    level: 4242,
    contributing: 4242,
    total: 8484,
    mean: "S-MEAN",
    criterion: "S-CRITERION",
    base: "S-BASE",
    derivation: "S-DERIVATION",
    settled: 4242,
    omitted: 4242,
    title: "S-TITLE",
    sessionId: "S-SESSION",
    type: "S-TYPE",
    confidence: "S-CONFIDENCE",
    updated: "S-UPDATED",
    done: 4242,
    failed: 8484,
    status: "S-STATUS",
    version: "S-VERSION",
    message: "S-MESSAGE",
    httpStatus: 599,
    markerFile: "S-MARKER",
    entryName: "S-ENTRY",
    dimension: "S-DIMENSION",
    max: 4242,
    field: "S-FIELD",
    id: "S-ID",
    section: "S-SECTION",
    tags: "S-TAGS",
    ext: "S-EXT",
    supported: "S-SUPPORTED",
    baseURL: "S-BASEURL",
    course_: "S-COURSE",
    value: "S-VALUE",
    action: "S-ACTION",
    channel: "S-CHANNEL",
    epoch: 4242,
    sequence: 8484,
    keyId: "S-KEY",
  };

  /**
   * Parameter names of one entry, read off the function's source by its USES.
   *
   * Reading the signature does not work across both catalogues: the English file
   * annotates its parameter object (`(p: { course: string })`) while every other
   * file inherits that annotation contextually and writes only `(p)`. What both
   * share is the body, where each value is reached as `p.<name>` — so the uses
   * are the portable source of truth, and an entry that never mentions its
   * parameter yields an empty list and fails loudly below.
   */
  function paramNames(fn: (...args: never[]) => string): string[] {
    const src = fn.toString();
    const ident = /^\(?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(src)?.[1];
    if (!ident) return [];
    const uses = new Set<string>();
    for (const m of src.matchAll(new RegExp(`\\b${ident}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) uses.add(m[1]!);
    return [...uses];
  }

  const functionEntries = (catalogue: typeof en): [string, (p: never) => string][] =>
    Object.entries(catalogue).filter((e): e is [string, (p: never) => string] => typeof e[1] === "function");

  it.each(Object.keys(LANGUAGES))("interpolates every parameter it is handed, in %s", (code) => {
    const catalogue = stringsFor(code);
    const dropped: string[] = [];
    for (const [name, fn] of functionEntries(catalogue)) {
      const names = paramNames(fn);
      expect(names.length, `${name} takes a parameter object but none could be read off it`).toBeGreaterThan(0);
      const args: Record<string, string | number> = {};
      for (const p of names) {
        expect(SENTINEL, `${name} interpolates "${p}", which has no sentinel — add one`).toHaveProperty(p);
        args[p] = SENTINEL[p]!;
      }
      const out = (fn as (p: Record<string, string | number>) => string)(args);
      for (const p of names) {
        // A value the entry deliberately renders conditionally (a null reason, a
        // zero count) still has to appear for SOME input; the sentinels are chosen
        // truthy and non-zero so a dropped one is a real omission.
        if (!out.includes(String(args[p]))) dropped.push(`${code}.${name} drops "${p}"`);
      }
    }
    expect(dropped, "a translation silently dropped an interpolated value").toEqual([]);
  });

  /**
   * A count-parametrised entry is rendered TWICE — once singular, once plural —
   * because a plural is only wrong at one of the two counts and the sentinel pass
   * above only ever supplied the plural one. German is why: `Zug` pluralises by
   * umlauting its stem (`Züge`), so a translation written as stem + suffix
   * produced `Zugüge` and no test could see it.
   *
   * What is asserted is that class rather than any wording: a plural that is the
   * singular with an umlaut GLUED to its end can never be a German plural, since
   * an umlaut modifies a vowel inside the stem and does not begin a suffix. That
   * leaves the correct suffix-append entries (`Notiz`+`en`, `Wiki-Atom`+`e`)
   * alone, and it leaves an entry that deliberately renders one form for both
   * counts (`document(s)`) alone too. The wordings themselves are pinned in
   * `chrome-copy.test.ts`, which owns copy assertions.
   */
  const COUNT_PARAMS = ["count", "omitted"];
  const UMLAUT = /^[äöüÄÖÜ]/;

  it.each(Object.keys(LANGUAGES))("never glues an umlaut onto a singular to form a plural, in %s", (code) => {
    const catalogue = stringsFor(code);
    const malformed: string[] = [];
    let exercised = 0;
    for (const [name, fn] of functionEntries(catalogue)) {
      const names = paramNames(fn);
      const counted = names.filter((p) => COUNT_PARAMS.includes(p));
      if (counted.length !== 1) continue;
      const render = (n: number): string => {
        const args: Record<string, string | number> = {};
        for (const p of names) args[p] = counted.includes(p) ? n : SENTINEL[p]!;
        // The numerals themselves differ by construction; blank them so only the
        // words around them are compared.
        return (fn as (p: Record<string, string | number>) => string)(args).replace(/\d+/g, "#");
      };
      exercised += 1;
      const one = render(1);
      const many = render(2);
      if (many.length > one.length && many.startsWith(one) && UMLAUT.test(many.slice(one.length))) {
        malformed.push(`${code}.${name}: "${one}" + "${many.slice(one.length)}" -> "${many}"`);
      }
    }
    expect(exercised, "no count-parametrised entry was exercised — the check is inert").toBeGreaterThan(0);
    expect(malformed, "a plural was built by appending an umlaut to the singular").toEqual([]);
  });

  /**
   * Agreement at count 1, in EVERY shipped language.
   *
   * The umlaut check above is German by construction — its `^[äöüÄÖÜ]` test can
   * never fire on French or Italian — while the wordings are pinned in
   * `chrome-copy.test.ts` for German alone. That left the languages that do not
   * pluralise by suffix-append with no guard at either count, and three tails
   * shipped disagreeing with their own count: a French plural verb and pronoun
   * beside "1 fichier", and two Italian ones beside "1 file" / "1 non riusciti".
   *
   * What is asserted is the weakest thing that catches the whole class without
   * knowing any language's grammar: an entry that takes a count must RENDER
   * DIFFERENTLY at 1 and at 2. Byte-identical output apart from the numeral means
   * the entry has no inflection at all, which is the only state a test can call
   * wrong from outside the language. It says nothing about whether an inflection
   * is the RIGHT one — `chrome-copy.test.ts` owns wordings — but a language
   * cannot silently arrive with none.
   *
   * Every count parameter is varied on its own, the others held at their
   * sentinels, so an entry counting two things (`done` and `failed`) is held to
   * the rule in both.
   */
  const INFLECTING_COUNT_PARAMS = ["count", "omitted", "done", "failed"];

  /**
   * Entries that deliberately render ONE form for both counts.
   *
   * **AN EXEMPTION IS SCOPED BY ITS REASON**, and that is the whole rule.
   *
   * A fact about the ENTRY is written `*.<entry>.<param>` and holds in every
   * language, including ones this build does not ship. A fact about the LANGUAGE
   * is written `<code>.<entry>.<param>` and holds only there. Getting the scope
   * wrong has one visible cost and it is always the same one: a language-scoped
   * key recording an entry-level fact makes a further language go red merely by
   * existing, and someone then hand-adds a line per language forever.
   *
   * Two justifications, and no third is admitted without an argument here.
   *
   * (1) ENTRY-SCOPED — the count governs no noun. `toolSpec…TooFew` reports the
   * number RECEIVED ("got 1") beside a threshold written as the literal 2, so
   * the noun it reads next to ("entries") is governed by that constant and is
   * plural at every value of the parameter. That is true of the string's
   * construction, not of anyone's grammar, so no translation can make it false
   * and no future language owes a line for it.
   *
   * (2) LANGUAGE-SCOPED — the parenthetical idiom, "document(s)", "Dokument(e)",
   * "document(s) intégré(s)". It is one form BECAUSE it covers both, and
   * adopting it is a real decision the translator of a given catalogue makes:
   * Italian has no such form ("documento(i)" is not a word), so `it.ts` writes
   * the two forms out and is exempted nowhere, and German is absent from
   * `wikiInvalidAtoms` because its verb has to agree even where its noun carries
   * the parenthetical. A further language belongs here only if its own
   * translator adopts the idiom — which is exactly why naming the language is
   * right here and wrong above.
   */
  const UNINFLECTED_BY_DESIGN = new Set<string>([
    // (1) the parameter is the received value, not a number governing a noun
    "*.toolSpecDetailOptionsTooFew.count",
    "*.toolSpecDetailItemsTooFew.count",
    // (2) the parenthetical idiom carries both forms at once
    "en.maturityThinDocuments.count",
    "de.maturityThinDocuments.count",
    "fr.maturityThinDocuments.count",
    "en.maturityThinArtefacts.count",
    "de.maturityThinArtefacts.count",
    "fr.maturityThinArtefacts.count",
    "en.maturityThinSteps.count",
    "de.maturityThinSteps.count",
    "fr.maturityThinSteps.count",
    "en.wikiInvalidAtoms.count",
    "en.wikiIngestNotice.done",
    "de.wikiIngestNotice.done",
    "fr.wikiIngestNotice.done",
    // (2) again, on the second count: the word reporting the failures is
    // invariant in these three ("failed", "fehlgeschlagen", "en échec"), while
    // Italian moves it and is therefore held to the rule.
    "en.wikiIngestNotice.failed",
    "de.wikiIngestNotice.failed",
    "fr.wikiIngestNotice.failed",
  ]);

  function uninflectedCountEntries(
    catalogue: typeof en,
    code: string
  ): { exercised: number; findings: string[]; exemptionsUsed: string[] } {
    const findings: string[] = [];
    const exemptionsUsed: string[] = [];
    let exercised = 0;
    for (const [name, fn] of functionEntries(catalogue)) {
      const names = paramNames(fn);
      for (const param of names.filter((p) => INFLECTING_COUNT_PARAMS.includes(p))) {
        const render = (n: number): string => {
          const args: Record<string, string | number> = {};
          for (const p of names) args[p] = p === param ? n : SENTINEL[p]!;
          // The numerals themselves differ by construction; blank them so only
          // the words around them are compared.
          return (fn as (p: Record<string, string | number>) => string)(args).replace(/\d+/g, "#");
        };
        exercised += 1;
        if (render(1) !== render(2)) continue;
        const key = [`*.${name}.${param}`, `${code}.${name}.${param}`].find((k) => UNINFLECTED_BY_DESIGN.has(k));
        if (key) exemptionsUsed.push(key);
        else findings.push(`${code}.${name} ("${param}") renders "${render(1)}" at both 1 and 2`);
      }
    }
    return { exercised, findings, exemptionsUsed };
  }

  it.each(Object.keys(LANGUAGES))("inflects every entry that counts something, in %s", (code) => {
    const { exercised, findings } = uninflectedCountEntries(stringsFor(code), code);
    expect(exercised, "no count-parametrised entry was exercised — the check is inert").toBeGreaterThan(0);
    expect(findings, `a ${code} entry that counts renders the same words at 1 and at 2`).toEqual([]);
  });

  it("keeps the exemption list honest — every named entry is genuinely uninflected", () => {
    // A stale exemption is worse than none: it silently absolves an entry that
    // has since been given the two forms, and it would absolve a defect a later
    // rewording introduces there. Named-but-unused is therefore a failure — in
    // BOTH key forms, since each is recorded as the form it was declared in.
    const used = Object.keys(LANGUAGES).flatMap(
      (code) => uninflectedCountEntries(stringsFor(code), code).exemptionsUsed
    );
    expect(
      [...UNINFLECTED_BY_DESIGN].filter((key) => !used.includes(key)),
      "exempted but no longer needed"
    ).toEqual([]);
  });

  it("costs a further language nothing when its own translation inflects", () => {
    // The property under repair, demonstrated rather than assumed: a language
    // that writes both forms out owes no exemption line at all, so registering
    // it cannot turn this file red. The stand-in is DERIVED — whichever shipped
    // catalogue currently adopts none of the language-scoped idiom — and it is
    // read back under a code no build ships.
    const selfSufficient = Object.keys(LANGUAGES).find((code) =>
      uninflectedCountEntries(stringsFor(code), code).exemptionsUsed.every((key) => key.startsWith("*."))
    );
    expect(
      selfSufficient,
      "every shipped language adopts the idiom — the demonstration needs another stand-in"
    ).toBeDefined();
    const further = ["rm", "zxx", "qaa"].find((code) => !isInterfaceLanguage(code))!;
    const { exercised, findings } = uninflectedCountEntries(stringsFor(selfSufficient!), further);
    expect(exercised, "the stand-in exercised nothing — the demonstration is inert").toBeGreaterThan(0);
    expect(findings, "a further language went red merely by existing").toEqual([]);
  });

  it("fails on an entry that counts without inflecting", () => {
    // A check that cannot fail is a placebo: the offender is synthetic, so this
    // stays true whatever the shipped catalogues say.
    const offender = {
      goodCount: (p: { count: number }) => `${p.count} ${p.count === 1 ? "turno" : "turni"}`,
      badCount: (p: { count: number }) => `${p.count} turno`,
      badSecondCount: (p: { done: number; failed: number }) => `${p.done} andati, ${p.failed} non riusciti`,
    } as unknown as typeof en;
    const { exercised, findings } = uninflectedCountEntries(offender, "zxx");
    expect(exercised).toBe(4);
    expect(findings).toEqual([
      `zxx.badCount ("count") renders "# turno" at both 1 and 2`,
      `zxx.badSecondCount ("done") renders "# andati, # non riusciti" at both 1 and 2`,
      `zxx.badSecondCount ("failed") renders "# andati, # non riusciti" at both 1 and 2`,
    ]);
  });
});

describe("a further language is a catalogue file and nothing else", () => {
  /**
   * The demonstration the requirement asks for, rather than the assertion:
   * a synthetic FURTHER catalogue is registered and every derived surface is read
   * back. Nothing in `interfaceLanguageOptions`, in the Settings control that
   * consumes it, in the formatting helpers or in the resolution path names a
   * language, so all of it takes the new one without an edit.
   *
   * **The code is PICKED from the registry, never written down.** This fixture
   * used to hardcode `fr`, which meant that actually shipping French turned a
   * demonstration about an unshipped language into a false assertion about a
   * shipped one — breaking the very Scenario *Adding a language touches no test*
   * that this block exists to demonstrate. Derived, that cannot recur: whatever
   * the build ships, the first unshipped candidate is used.
   */
  const FURTHER = ["rm", "zxx", "qaa"].find((code) => !isInterfaceLanguage(code))!;
  const FURTHER_ENDONYM = `Endonym-${FURTHER}`;
  const further: LanguageCatalogue = {
    code: FURTHER,
    endonym: FURTHER_ENDONYM,
    formattingLocale: FURTHER,
    // A real further catalogue is a full translation; for THIS demonstration the
    // English strings stand in, because what is being demonstrated is the
    // registry's behaviour, not the wording.
    strings: en,
  };
  const withFurther = { ...LANGUAGES, [FURTHER]: further };
  const shippedCodes = Object.keys(LANGUAGES).sort();

  it("appears in the Settings control's options, by its own endonym, with no edit to the control", () => {
    const options = interfaceLanguageOptions(withFurther);
    expect(options.map((o) => o.code)).toEqual([...shippedCodes, FURTHER].sort());
    expect(options.find((o) => o.code === FURTHER)?.endonym).toBe(FURTHER_ENDONYM);
    const endonyms = options.map((o) => o.endonym);
    expect(endonyms).toContain("Deutsch");
    expect(endonyms).toContain("English");
    expect(endonyms).toContain(FURTHER_ENDONYM);
  });

  it("names every option in its OWN language, identically in every catalogue", () => {
    // Scenario: The option names are readable from any language. The endonym a
    // shipped language is offered under must read the same whichever catalogue is
    // active — that is what keeps a lecturer stranded in a language they cannot
    // read able to find their own in the list. Asserted against the catalogues
    // themselves rather than against the derived list, which cannot disagree with
    // itself: every catalogue must declare every other language's endonym, and
    // declare it identically.
    for (const [code, language] of Object.entries(LANGUAGES)) {
      const key = `languageName${code[0]!.toUpperCase()}${code.slice(1)}`;
      for (const [otherCode, other] of Object.entries(LANGUAGES)) {
        const declared = (other.strings as unknown as Record<string, unknown>)[key];
        expect(declared, `${otherCode}.ts does not declare ${key}`).toBe(language.endonym);
      }
    }
  });

  it("is selectable as an operating-system default, matched by primary subtag", () => {
    // The resolution path is language-blind: it asks the registry, so `<code>-CH`
    // and `<code>_XX.UTF-8` both select the language the moment the catalogue exists.
    expect(resolveLanguageFromLocale(`${FURTHER}-CH`)).toBe(REFERENCE_LANGUAGE);
    const resolveWith = (locale: string): string => {
      const primary = locale.split(/[-_.]/)[0]!.toLowerCase();
      return Object.prototype.hasOwnProperty.call(withFurther, primary) ? primary : REFERENCE_LANGUAGE;
    };
    expect(resolveWith(`${FURTHER}-CH`)).toBe(FURTHER);
    expect(resolveWith(`${FURTHER}_XX.UTF-8`)).toBe(FURTHER);
    expect(resolveWith("xx-YY")).toBe(REFERENCE_LANGUAGE);
  });

  it("costs the shipped languages nothing — the derived list is a pure function of the registry", () => {
    expect(interfaceLanguageOptions(LANGUAGES).map((o) => o.code)).toEqual(shippedCodes);
    expect(interfaceLanguageOptions(withFurther)).toHaveLength(shippedCodes.length + 1);
  });
});

describe("language resolution can never fail the app's start", () => {
  it("renders the reference language for an unknown, absent or malformed code", () => {
    // Scenario: An operating-system locale with no catalogue falls back to English;
    // Scenario: A stored language whose catalogue no longer ships renders English.
    for (const bad of [null, undefined, "", "xx", "de-CH-1996-extra", 42 as unknown as string]) {
      expect(catalogueFor(bad).code).toBe(REFERENCE_LANGUAGE);
      expect(stringsFor(bad).chatSendLabel).toBe(en.chatSendLabel);
    }
    expect(isInterfaceLanguage("de")).toBe(true);
    // A code no build ships: `zxx` is ISO 639-2's "no linguistic content", so it
    // can never become an interface language and this assertion can never be
    // turned false by shipping one.
    expect(isInterfaceLanguage("zxx")).toBe(false);
    expect(isInterfaceLanguage("toString")).toBe(false);
  });

  it("never renders a raw key or a blank label for a shipped language", () => {
    for (const [code, language] of Object.entries(LANGUAGES)) {
      for (const [name, value] of Object.entries(language.strings)) {
        if (typeof value !== "string") continue;
        expect(value.trim(), `${code}.${name} is blank`).not.toBe("");
        expect(value, `${code}.${name} renders its own key`).not.toBe(name);
      }
    }
  });

  it("declares a formatting locale and an endonym for every shipped language", () => {
    for (const [code, language] of Object.entries(LANGUAGES)) {
      expect(language.code, `${code} declares a mismatched code`).toBe(code);
      expect(language.formattingLocale.trim().length, `${code} declares no formatting locale`).toBeGreaterThan(0);
      expect(language.endonym.trim().length, `${code} declares no endonym`).toBeGreaterThan(0);
    }
    // The English catalogue declares the tag the ring's module constant named
    // before this change, so a lecturer who stays in English sees no formatting
    // change at all (Scenario: Choosing English leaves today's formatting unchanged).
    expect(LANGUAGES[REFERENCE_LANGUAGE]!.formattingLocale).toBe("en-US");
    expect(de).not.toBe(en);
  });
});
