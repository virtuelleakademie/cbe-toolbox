/**
 * The ONE place a chrome literal is written twice.
 *
 * Every other test in this repo queries by the catalogue entry that owns the
 * string (capability `desktop-app`, Requirement: *Each Rendered Chrome String Has
 * Exactly One Owner*), which is what makes an interface-language switch a change
 * to the owning declarations and nothing else. That discipline has a cost: with
 * no literal anywhere, renaming a control to the wrong words would be silently
 * green. This file pays that cost back — deliberately, in one file, named for
 * what it is.
 *
 * It asserts the WORDING. It does not assert behaviour; the behavioural tests do
 * that, through the same entries.
 *
 * **A copy test names the language it asserts**, because the wording it pins is
 * one language's — a copy test that does not say which language it is reading is
 * a test that will be wrong in every other one. This file reads the ENGLISH
 * catalogue except where a describe title says otherwise: the inflected count
 * entries are pinned in German, because German is where a plural can be wrong.
 *
 * The second half is the language rule itself (Requirement: *Every String the App
 * Renders Is English*, whose body now names the configured interface language).
 * It is no longer "no owner declares German": German is a shipped catalogue, and
 * declaring German chrome is exactly what `de.ts` is for. What the sweep asserts
 * instead is that no catalogue LEAKS into another — the English catalogue carries
 * no German, and the German one carries no English left untranslated where the
 * two must differ.
 */
import { describe, expect, it } from "vitest";
import { explanationFor, labelFor } from "../src/renderer/components/ContextUsageRing.strings.js";
import { SUPPORTED_EXTENSIONS } from "../src/main/ingestion.js";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";

describe("the composer card's copy, in English", () => {
  it("names the '+' menu, its two entries and the message field", () => {
    expect(en.chatPlusMenuLabel).toBe("More actions");
    expect(en.chatUploadEntryLabel).toBe("Upload files");
    expect(en.chatHelpEntryLabel).toBe("Help");
    expect(en.chatComposerFieldLabel).toBe("Message");
    // The format list is a PARAMETER, owned by `@cbe/pi-bridge/ingest-formats` and not
    // by any catalogue: what is pinned here is the sentence, not the set.
    expect(en.chatIngestFormatsHint({ formats: "PDF / CSV" })).toBe("Read existing material (PDF / CSV) into the chat");
  });

  it("names both states of the send/stop slot", () => {
    expect(en.chatSendLabel).toBe("Send");
    expect(en.chatSendTitle).toBe("Send (Enter)");
    expect(en.chatStopLabel).toBe("Stop the answer");
    expect(en.chatStopPendingLabel).toBe("Stopping the answer…");
    expect(en.chatStopCompactionReason).toBe(
      "The context is being summarised — that runs to the end and cannot be stopped."
    );
  });

  it("names the model pill and the attachment pills", () => {
    expect(en.chatModelPillBlankLabel).toBe("No model configured");
    expect(en.chatModelPillPurpose).toBe('Open the model settings (Settings, "Model" group)');
    expect(en.chatModelPillAccessibleName({ purpose: en.chatModelPillPurpose, modelId: "gemma4-31b" })).toBe(
      'Open the model settings (Settings, "Model" group) — model: gemma4-31b'
    );
    expect(en.chatPendingAttachmentsLabel).toBe("Attached documents");
    expect(en.chatRemoveAttachmentLabel({ filename: "modul.pdf" })).toBe("Remove modul.pdf");
  });

  it("carries the same locked reason on the card as the conversation header does", () => {
    expect(en.chatNewSessionLockedReason).toBe("The agent is still working — wait for the turn to finish first.");
    expect(en.chatComposerLockedReason).toBe(en.chatNewSessionLockedReason);
  });
});

describe("the transcript's own copy, in English", () => {
  it("names the turns the app itself writes into the transcript", () => {
    // Display projections: what the lecturer READS when they press a control or
    // stop a run. The model-facing payload beside each one is not chrome and is
    // deliberately absent from this catalogue.
    expect(en.chatHelpDisplayText).toBe("Help requested");
    expect(en.chatStoppedTurnPlaceholder).toBe("You stopped this answer before it began.");
    expect(en.exportStoppedTurnNote).toBe("_(stopped by the lecturer — this answer is incomplete)_");
    expect(en.errorLoopAbortNote).toBe(
      "I kept calling the same tool without making progress and stopped to avoid looping. " +
        "Please rephrase or try again."
    );
    expect(en.toolExecutionFailed).toBe("Tool execution failed");
    // The Continue / Retry turns echo the control the lecturer pressed, so they
    // read the control's OWN entry rather than growing a second wording.
    expect(en.chatContinueLabel).toBe("Continue");
    expect(en.chatRetryLabel).toBe("Retry");
  });
});

describe("the header strip's copy, in English", () => {
  it("names the help control and both of its unavailability reasons", () => {
    expect(en.headerHelpLabel).toBe("Help");
    // The busy reason is the composer's own entry, never a second one: one fact
    // about one run must not grow two wordings — in any language.
    expect(en.headerHelpStartingReason).toBe("The conversation is still starting — help is available in a moment.");
  });
});

describe("the panel and pipeline copy, in English", () => {
  it("names the CBE Process Canvas panel's annotation controls", () => {
    expect(en.canvasIterateLabel).toBe("↻ Iterate");
    expect(en.canvasAnnotateToggleLabel).toBe("+ Note");
    expect(en.canvasAnnotationAddLabel).toBe("Add");
    expect(en.canvasAnnotationInputPlaceholder).toBe("Note on this artefact…");
    expect(en.canvasRemoveAnnotationLabel).toBe("Remove note");
    expect(en.canvasNoAnnotationsLabel).toBe("no notes");
    expect(en.canvasAnnotationCountLabel({ count: 1 })).toBe("1 note");
    expect(en.canvasAnnotationCountLabel({ count: 3 })).toBe("3 notes");
  });

  it("names the Decision Checklist's submit control", () => {
    expect(en.checklistSubmitLabel).toBe("Apply");
  });

  it("names the ingestion pipeline's failure messages", () => {
    expect(en.ingestUnsupportedFormat({ ext: ".png", supported: SUPPORTED_EXTENSIONS.join(", ") })).toBe(
      'Unsupported format ".png". Supported formats: .pdf, .docx, .pptx, .xlsx, .txt, .md, .csv.'
    );
    // The legacy-Excel refusal is deliberately NOT the generic one: the generic message
    // lists `.xlsx`, so an `.xls` refused that way reads as "Excel is unsupported".
    expect(en.ingestLegacyExcelFormat({ ext: ".xls" })).toBe(
      '".xls" is an older or macro-enabled Excel format this app does not read. Open the workbook in Excel and ' +
        "save it as an .xlsx workbook, then try again."
    );
    expect(en.ingestNoExtension).toBe("(no extension)");
    expect(en.ingestUnreadableFile({ filename: "modul.pdf", detail: "EACCES" })).toBe(
      'File "modul.pdf" could not be read: EACCES'
    );
    expect(en.chatNoTextExtractedProblem({ filename: "scan.pdf" })).toBe(
      '"scan.pdf": no text extracted — a scanned PDF, or an empty document?'
    );
  });

  it("names every manual corpus-refresh outcome and fallback", () => {
    expect(en.corpusUpdated({ version: "2026-08" })).toBe("Corpus updated to version 2026-08.");
    expect(en.corpusUpToDate({ version: "2026-08" })).toBe("Corpus is up to date (version 2026-08).");
    expect(en.corpusIntegrityMismatch).toBe(
      "Corpus update failed, integrity check did not match. The previous corpus stays loaded."
    );
    expect(en.corpusRefreshNotConfigured).toBe("No corpus update location is configured for this build.");
    expect(en.corpusRefreshPointerHttp({ httpStatus: 503 })).toBe("Could not check for a corpus update (HTTP 503).");
    expect(en.corpusRefreshPointerRead).toBe("Could not read the corpus update information.");
    expect(en.corpusRefreshPointerInvalid).toBe("The corpus update information is incomplete (version/file/sha256).");
    expect(en.corpusRefreshDownloadHttp({ httpStatus: 429 })).toBe("Could not download the corpus update (HTTP 429).");
    expect(en.corpusRefreshDownloadRead).toBe("Could not read the downloaded corpus bundle.");
    expect(en.corpusRefreshMissingMarker({ markerFile: "index.json" })).toBe(
      "The downloaded corpus bundle does not contain the required top-level file index.json."
    );
    expect(en.corpusRefreshUnsafeEntry({ entryName: "../escape.txt" })).toBe(
      "The downloaded corpus bundle contains an unsafe entry and was refused: ../escape.txt."
    );
    expect(en.corpusRefreshInstallFailed).toBe("Could not install the corpus update.");
    expect(en.corpusRefreshUnexpected).toBe("Could not complete the corpus refresh.");
    expect(en.corpusInfoReloadFailed).toBe("The corpus information could not be reloaded.");
  });

  it("groups the context ring's token figures by the chrome language, not by a region", () => {
    // Scenario: The context ring's figures follow the interface language. The test
    // environment is pinned to English, so this is the English grouping.
    const measured = explanationFor("measured", { used: 41000, window: 128000 }, en);
    expect(measured).toContain("41,000");
    expect(measured).not.toContain("41'000");
    expect(measured).not.toContain("41’000");
    expect(labelFor("fresh", null, en)).toBe("Conversation length: not measured yet");
  });

  it("takes the grouping from the catalogue it is HANDED, not from the active language", () => {
    // The test environment is pinned to English. Handing the module the German
    // catalogue must move the wording and the figure together — a figure grouped
    // one way inside a sentence written another is the seam the rule forbids.
    const german = explanationFor("measured", { used: 41000, window: 128000 }, de);
    expect(german).toContain("41.000");
    expect(german).not.toContain("41,000");
  });
});

describe("the count-parametrised entries' singular and plural, in German", () => {
  // The German plurals are pinned at BOTH counts because a plural is only wrong at
  // one of them: `Zug` shipped as stem + suffix and rendered "0 Zugüge" in the
  // courses panel, which every English-reading assertion was blind to. The class
  // itself is guarded in `i18n-completeness.test.ts`; these four are the wordings.
  it("inflects the conversation turn count", () => {
    expect(de.coursesConversationTurnCount({ count: 1 })).toBe("1 Zug");
    expect(de.coursesConversationTurnCount({ count: 0 })).toBe("0 Züge");
    expect(de.coursesConversationTurnCount({ count: 2 })).toBe("2 Züge");
  });

  it("inflects the canvas annotation count", () => {
    expect(de.canvasAnnotationCountLabel({ count: 1 })).toBe("1 Notiz");
    expect(de.canvasAnnotationCountLabel({ count: 2 })).toBe("2 Notizen");
  });

  it("inflects the wiki atom count", () => {
    expect(de.coursesWikiAtomCount({ count: 1 })).toBe("1 Wiki-Atom");
    expect(de.coursesWikiAtomCount({ count: 2 })).toBe("2 Wiki-Atome");
  });

  it("inflects the omitted-changes suffix of the maturity panel", () => {
    expect(de.maturityStaleMore({ omitted: 1 })).toBe(" (+1 weitere Änderung)");
    expect(de.maturityStaleMore({ omitted: 3 })).toBe(" (+3 weitere Änderungen)");
  });
});

describe("no catalogue leaks into another", () => {
  // Requirement: Every String the App Renders Is English (the body now names the
  // CONFIGURED interface language). Umlauts catch half of a German string; the
  // stopwords catch the half that carries none.
  const UMLAUT = /[äöüÄÖÜß]/;
  const GERMAN_STOPWORDS =
    /\b(Hilfe|Senden|Notiz|Notizen|Iterieren|Uebernehmen|Hinzufuegen|Dateien|Nachricht|Modell|Antwort|Entscheidungen|nicht|noch|wird|und|oder|kein|keine|der|die|das|von|mit|fuer|zum|zur|Gespraech)\b/;

  /**
   * Entries that are IDENTICAL in every catalogue by design and therefore cannot
   * be swept for one language's vocabulary: the endonyms, the product name, the
   * two CBE surface names, and the two glyph-only markers.
   *
   * The endonyms are DERIVED from the shipped registry, because they are the one
   * sub-set whose membership is a pure function of it: every language contributes
   * exactly one `languageName<Code>` key, declared identically in every
   * catalogue, so a further language belongs here the moment it belongs to
   * `LANGUAGES` (Scenario: *Adding a language touches no test*). Everything below
   * stays named one by one — that each of those is identical is a fact about the
   * individual string, not something the registry can tell us.
   */
  const ENDONYM_KEYS = Object.keys(LANGUAGES).map((code) => `languageName${code[0]!.toUpperCase()}${code.slice(1)}`);
  const IDENTICAL_BY_DESIGN = new Set<string>([
    ...ENDONYM_KEYS,
    "headerAppName",
    // The native application-menu title is the same product proper name.
    "menuApplication",
    "panelCanvasTab",
    "panelMaturityTab",
    "canvasEmptyValue",
    "decisionsEmptyValue",
    "corpusEmptyValue",
    "chatThinkingEmptyBody",
    "settingsApiKeyPlaceholder",
    "configModelIdPlaceholder",
    "settingsFlavourFrappe",
    "settingsFlavourMacchiato",
    "settingsFlavourMocha",
    "maturityLevelShort1",
    "maturityLevelShort2",
    "maturityLevelShort3",
    "canvasJourneyEngage",
    "canvasJourneyInvestigate",
    "canvasJourneyAct",
    "canvasJourneyReflect",
    "canvasArtefactBigidea",
    "canvasArtefactEq",
    "canvasArtefactChallenge",
    "canvasStep4Name",
    "canvasStep5Name",
    "coursesTabChats",
    "coursesTabWiki",
    "wikiBack",
    "exportMaturityHeading",
    "settingsReasoningLabel",
    "settingsAboutSkill",
    "corpusVersionLabel",
    "profileNameLabel",
    "mainExportFilterMarkdown",
    // Pure interpolation of two host-supplied values around a separator — it
    // contains no word of any language, so there is nothing to translate.
    "wikiAtomRowMeta",
  ]);

  const stringEntries = (catalogue: typeof en): [string, string][] =>
    Object.entries(catalogue).filter((e): e is [string, string] => typeof e[1] === "string");

  /**
   * Every entry as the text it CONTRIBUTES — a plain string as itself, a
   * parametrised entry as its source.
   *
   * A sixth of the catalogue is function-valued, and filtering to `typeof ===
   * "string"` exempted all of it from both directions of this sweep: a German
   * literal inside an `en.ts` template, and a `de.ts` template left at the English
   * wording, were equally invisible. A function's source carries its literals, its
   * parameter names and nothing else, so comparing it is the same question asked
   * of the same text.
   *
   * Whitespace runs are COLLAPSED, which is what the word-boundary detectors below
   * need; the two EQUALITY checks go further and compare `sameCopy`, ignoring
   * whitespace altogether. Both exist because the source a function stringifies to
   * is the TRANSPILED one and toolchains disagree about type annotations: esbuild
   * deletes them, Node's own type-stripping blanks them to spaces, so `en`'s
   * `(p: { type: string }): string => …` and `de`'s `(p) => …` are one text under
   * the first and differ by a run of spaces under the second. A guard whose
   * verdict moves with the transpiler is one that stops working without anyone
   * noticing. Ignoring whitespace costs the equality checks nothing they want:
   * two entries that differ only in spacing are untranslated either way.
   */
  const contributedText = (value: unknown): string => String(value).replace(/\s+/g, " ").trim();

  const sameCopy = (a: string | undefined, b: string | undefined): boolean =>
    a !== undefined && b !== undefined && a.replace(/\s/g, "") === b.replace(/\s/g, "");

  const copyEntries = (catalogue: typeof en): [string, string][] =>
    Object.entries(catalogue)
      .filter(([, value]) => typeof value === "string" || typeof value === "function")
      .map(([name, value]) => [name, typeof value === "string" ? value : contributedText(value)]);

  it("declares no German chrome string in the English catalogue", () => {
    for (const [name, value] of copyEntries(en)) {
      if (IDENTICAL_BY_DESIGN.has(name)) continue;
      expect(value, `en.${name} carries an umlaut`).not.toMatch(UMLAUT);
      expect(value, `en.${name} carries a German stopword`).not.toMatch(GERMAN_STOPWORDS);
    }
  });

  it("gives the German catalogue a German string wherever the two must differ", () => {
    // The inverse leak: a key left at its English wording in `de.ts` is a hole a
    // type check cannot see, because both sides are strings. Anything not named
    // as identical by design must actually differ.
    const english = new Map(copyEntries(en));
    const same = copyEntries(de)
      .filter(([name, value]) => !IDENTICAL_BY_DESIGN.has(name) && sameCopy(value, english.get(name)))
      .map(([name]) => name);
    expect(
      same,
      "these German entries are still the English wording — translate them, or name them in IDENTICAL_BY_DESIGN"
    ).toEqual([]);
  });

  it("compares parametrised entries independently of the type-stripping transform", () => {
    // The two shapes a toolchain can hand back for the same entry — annotations
    // deleted, annotations blanked — must reach the sweep as one entry, and a
    // genuinely different body must still read as different.
    const deleted = "(p) => `${p.type} · ${p.updated}`";
    const blanked = "(p                                ) => `${p.type} · ${p.updated}`";
    expect(sameCopy(contributedText(blanked), contributedText(deleted))).toBe(true);
    expect(sameCopy(contributedText(deleted), "(p) => `${p.type} — ${p.updated}`")).toBe(false);
  });

  it("reaches the function-valued entries too, in both directions", () => {
    // The gap this closes is worth asserting rather than assuming: the sweep must
    // actually be looking at a substantial set of parametrised entries, and it must
    // fire on a synthetic offender of each kind.
    const parametrised = Object.entries(en).filter(([, v]) => typeof v === "function");
    expect(parametrised.length).toBeGreaterThan(50);
    const contributed = new Map(copyEntries(en));
    for (const [name] of parametrised) expect(contributed.get(name)).toMatch(/=>|function/);
    const germanTemplate = (p: { count: number }): string => `${p.count} Notizen`;
    expect(String(germanTemplate)).toMatch(GERMAN_STOPWORDS);
    const untranslated = String(en.chatRemoveAttachmentLabel);
    expect(String(de.chatRemoveAttachmentLabel)).not.toBe(untranslated);
  });

  it("keeps the exemption list honest — every named key exists and is genuinely identical", () => {
    const english = new Map(copyEntries(en));
    const german = new Map(copyEntries(de));
    for (const name of IDENTICAL_BY_DESIGN) {
      expect(Object.prototype.hasOwnProperty.call(en, name), `${name} is not a catalogue key`).toBe(true);
      // Compared as CONTRIBUTED text, so a parametrised entry is held to the same
      // standard as a plain one rather than to object identity, which no two
      // catalogues can ever satisfy.
      expect(
        sameCopy(german.get(name), english.get(name)),
        `${name} is exempted but the catalogues disagree: ${english.get(name)} / ${german.get(name)}`
      ).toBe(true);
    }
  });

  it("covers every entry of every shipped catalogue, so a new one cannot slip past", () => {
    // The sweep is only worth as much as its coverage: assert it actually saw a
    // substantial set from each catalogue rather than silently iterating short —
    // and that the covered set is now EVERY key, not only the string-valued ones.
    for (const [code, language] of Object.entries(LANGUAGES)) {
      expect(
        stringEntries(language.strings).length,
        `${code} has too few string entries to be a real catalogue`
      ).toBeGreaterThanOrEqual(400);
      expect(copyEntries(language.strings).length, `${code} leaves entries outside the sweep`).toBe(
        Object.keys(language.strings).length
      );
    }
    expect(Object.keys(en)).toContain("chatSendLabel");
    expect(Object.keys(en)).toContain("canvasIterateLabel");
    expect(Object.keys(en)).toContain("checklistSubmitLabel");
  });
});
