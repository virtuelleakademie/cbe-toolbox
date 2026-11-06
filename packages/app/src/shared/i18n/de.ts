/**
 * The German chrome-string catalogue (capability `desktop-app`, Requirement:
 * *Every String the App Renders Is English* — the heading is retained, the rule
 * now names the configured interface language).
 *
 * Annotated with `ChromeCatalogue`, which is derived from `en.ts`. That
 * annotation IS the completeness check: a missing key and a key `en.ts` does not
 * declare are both `tsc` errors, and a function entry whose parameter object has
 * a different shape is one too. There is no runtime fallback to English — an
 * incomplete language does not compile, so it cannot ship.
 *
 * Identical in every catalogue on purpose: the four endonyms, the product name,
 * and the two CBE surface names ("CBE Process Canvas", "CBE Maturity"), which
 * are proper names and are never translated. The retired "Artefakte" label is
 * not reintroduced here under any framing.
 *
 * Where the English entry is the PIONEER framework's own validated wording
 * (`methodology-007` §4.4 Table 1), the German entry is this app's rendering of
 * it for a German-reading lecturer, not a second normative source: the stable
 * identity of a criterion is its key, and the model-facing Discuss token carries
 * the reference-language label.
 *
 * Addressed formally ("Sie"), which is what a lecturer-facing tool at this
 * institution uses.
 */
import type { ChromeCatalogue } from "./types.js";

export const de: ChromeCatalogue = {
  languageNameEn: "English",
  languageNameDe: "Deutsch",
  languageNameFr: "Français",
  languageNameIt: "Italiano",

  appHydrationPaneLabel: "Gespräch wird geöffnet",
  appHydrationTitle: "Ihr Gespräch wird geöffnet…",
  appHydrationSub: "Beim ersten Start wird die Agent-Laufzeit installiert — das kann 1–2 Minuten dauern.",
  appHydrationErrorLabel: "Gespräch konnte nicht geöffnet werden",
  appHydrationErrorTitle: "Das Gespräch konnte nicht geöffnet werden",
  appHydrationUnknownError: "Unbekannter Fehler",
  appRetry: "Erneut versuchen",
  appDismissError: "Fehlermeldung schliessen",
  appDismissNotice: "Hinweis schliessen",

  menuApplication: "CBE Toolbox",
  menuFile: "Ablage",
  menuEdit: "Bearbeiten",
  menuView: "Darstellung",
  menuWindow: "Fenster",
  menuHelp: "Hilfe",
  menuAbout: "Über CBE Toolbox",
  menuSettings: "Einstellungen…",
  menuQuit: "CBE Toolbox beenden",
  menuExit: "Beenden",
  menuCloseWindow: "Fenster schliessen",
  menuUndo: "Widerrufen",
  menuRedo: "Wiederholen",
  menuCut: "Ausschneiden",
  menuCopy: "Kopieren",
  menuPaste: "Einsetzen",
  menuSelectAll: "Alles auswählen",
  menuZoomIn: "Vergrössern",
  menuZoomOut: "Verkleinern",
  menuResetZoom: "Tatsächliche Grösse",
  menuToggleFullScreen: "Vollbild ein/aus",
  menuReload: "Neu laden",
  menuToggleDeveloperTools: "Entwicklerwerkzeuge ein/aus",
  menuMinimize: "Minimieren",
  menuBringAllToFront: "Alle nach vorne bringen",
  menuCbeHelp: "CBE-Toolbox-Hilfe",
  menuPioneerWebsite: "Website der PIONEER Alliance",
  menuWorkspaceUnavailable: "Der Arbeitsbereich ist noch nicht bereit.",
  menuModalUnavailable: "Schliessen Sie zuerst den geöffneten Dialog.",

  headerLabel: "App-Kopfzeile",
  headerAppName: "CBE Toolbox",
  headerNoActiveCourse: "kein aktiver Kurs",
  headerShowCoursesLabel: (p) => `Kurse anzeigen — aktiver Kurs: ${p.course}`,
  headerShowCoursesTitle: "Kurse anzeigen",
  headerOpenSettings: "Einstellungen öffnen",
  headerOpenSettingsUnsaved: "Einstellungen öffnen — ungespeicherte Änderungen",
  headerSettingsTitle: "Einstellungen",
  headerSettingsTitleUnsaved: "Einstellungen — ungespeicherte Änderungen",
  headerOpenProfile: "Profil öffnen",
  headerProfileTitle: "Profil",
  headerLanguageLabel: "Oberflächensprache",
  headerLanguageAccessibleName: (p) => `Oberflächensprache: ${p.language} (${p.code})`,
  headerLanguageBusy: "Oberflächensprache wird geändert…",
  headerLanguageFailure: "Die Oberflächensprache konnte nicht geändert werden. Versuchen Sie es erneut.",

  chatConversationLabel: "Gespräch",
  // ───────────────────────── Erste Orientierung ───────────────────────────
  onboardingHeading: "Willkommen in der CBE Toolbox",
  onboardingValue: (p: { course: string }): string =>
    `Ein ${p.course} ist Ihre Arbeitseinheit: Entwickeln oder übertragen Sie ein CBE-Modul im Gespräch und prüfen Sie seine Stimmigkeit. Sie bringen das Modulwissen ein und treffen die Entscheidungen; die Assistenz liefert kein fertiges Modul.`,
  onboardingCourseNavigation: (p: { course: string }): string =>
    `Die Kopfleiste nennt den aktiven ${p.course}. In der linken Liste erstellen und wechseln Sie Kurse; in den Details benennen Sie einen um oder löschen ihn.`,
  onboardingCourseChats: (p: { chats: string; wiki: string }): string =>
    `Dort liegen auch seine ${p.chats}, die gespeicherten Gespräche des Kurses, und sein ${p.wiki}; das Öffnen der Details wechselt den aktiven Kurs nicht.`,
  onboardingWikiReuse: (p: { wiki: string }): string =>
    `Importieren Sie lokales Lehrmaterial über das ${p.wiki} des aktiven Kurses als wiederverwendbare, themengrosse Wissenseinträge, die Sie durchsuchen können.`,
  onboardingWikiGrounding:
    "Die Assistenz kann diese Einträge lesen und zitieren, um die Arbeit in Ihrem Material zu verankern.",
  onboardingAttachmentDistinction: "Ein Chat-Anhang versorgt stattdessen dieses Gespräch und füllt das Wiki nicht.",
  onboardingDesign:
    "Arbeiten Sie mit der Assistenz im Gespräch. Der rechte CBE Process Canvas hält die zehn Schritte des aktiven Kurses fest; CBE Maturity beurteilt das Festgehaltene und ist keine Zertifizierung.",
  onboardingNextAction:
    "Beschreiben Sie Ihr Modul und woran Sie arbeiten möchten, oder bringen Sie eine vorhandene Frage oder Material mit. Ein Anhang oder Wiki-Import ist optional.",
  onboardingHelpAndReread: (p: { about: string }): string =>
    `Das Fragezeichen in der Kopfleiste öffnet die Gesprächshilfe; in der Gruppe ${p.about} des Einstellungs-Overlays können Sie diese Übersicht erneut lesen.`,
  onboardingBegin: "Beginnen",
  onboardingSkip: "Überspringen",
  onboardingClose: "Übersicht schliessen",
  onboardingReread: "Einführung erneut lesen",
  onboardingAvailability: "Über dem Gespräch ist eine Einführung verfügbar.",
  onboardingReadFailure:
    "Die Einstellung zur Einführung konnte nicht gelesen werden. Die Übersicht bleibt verfügbar und kann erneut erscheinen.",
  onboardingWriteFailure:
    "Die Übersicht ist für diese App-Sitzung geschlossen, aber die Einstellung konnte nicht gespeichert werden. Nach einem Neustart kann sie erneut erscheinen.",
  chatRoleAssistant: "CBE-Skill",
  chatRoleLecturer: "Dozierende Person",
  chatNewSessionLockedReason: "Der Agent arbeitet noch — warten Sie, bis der Zug abgeschlossen ist.",
  chatComposerLockedReason: "Der Agent arbeitet noch — warten Sie, bis der Zug abgeschlossen ist.",
  chatNewSessionLabel: "Neue Sitzung",
  chatNewSessionTitle: "Ein neues Gespräch beginnen (Canvas bleibt erhalten; das aktuelle bleibt auf der Festplatte)",
  chatNewSessionStarting: "Neue Sitzung wird gestartet…",
  chatNewSessionFailedText:
    "Die neue Sitzung konnte nicht gestartet werden. Ihr bisheriges Gespräch ist sicher gespeichert — es geht nichts verloren.",
  chatNewSessionFailedDetail: "Sie finden es jederzeit unter Kurse.",
  chatNewSessionConfirmLabel: "Neue Sitzung bestätigen",
  chatNewSessionConfirmText:
    "Eine neue Sitzung beginnen? Ihre Einträge im CBE Process Canvas und in CBE Maturity bleiben erhalten. Sie können dieses Gespräch jederzeit unter Kurse fortsetzen.",
  chatNewSessionConfirmAction: "Neue Sitzung starten",
  chatCancel: "Abbrechen",
  chatIngestFormatsHint: (p) => `Vorhandenes Material (${p.formats}) in den Chat einlesen`,
  chatPlusMenuLabel: "Weitere Aktionen",
  chatUploadEntryLabel: "Dateien hochladen",
  chatHelpEntryLabel: "Hilfe",
  chatComposerFieldLabel: "Nachricht",
  chatSendLabel: "Senden",
  chatSendTitle: "Senden (Enter)",
  chatStopLabel: "Antwort stoppen",
  chatStopPendingLabel: "Antwort wird gestoppt…",
  chatStopCompactionReason:
    "Der Kontext wird gerade zusammengefasst — das läuft bis zum Ende und kann nicht gestoppt werden.",
  chatStoppedTurnMarker: "Sie haben diese Antwort gestoppt — sie ist unvollständig.",
  chatStoppedTurnPlaceholder: "Sie haben diese Antwort gestoppt, bevor sie begonnen hat.",
  chatStopTimedOutNoticeText:
    "Das Stoppen dauert länger als erwartet — die Assistenz hat diesen Zug noch nicht freigegeben. " +
    "Das Nachrichtenfeld bleibt so lange gesperrt, damit nichts, was Sie senden, damit kollidieren kann.",
  chatStopTimedOutRecoveryLabel: "Dieses Gespräch zwangsweise schliessen",
  chatStopTimedOutRecoveryConfirm:
    "Das Zwangsschliessen beendet dieses Gespräch, ohne auf die Assistenz zu warten, und startet ein neues. " +
    "Ihre Arbeit bleibt erhalten — das Moduldesign im CBE Process Canvas, die festgehaltenen Entscheidungen, der " +
    "Fortschritt über die Design-Schritte und die CBE-Maturity-Einschätzung — und das Gespräch wird auf der " +
    "Festplatte archiviert.",
  chatForceCloseBusy: "Wird geschlossen…",
  chatForceCloseAction: "Zwangsweise schliessen und neu starten",
  chatForceCloseFailed:
    "Das Gespräch konnte nicht zwangsweise geschlossen werden. Ihre Arbeit ist im Kursordner sicher gespeichert — versuchen Sie es erneut.",
  chatModelPillBlankLabel: "Kein Modell konfiguriert",
  chatModelPillPurpose: "Die Modelleinstellungen öffnen (Einstellungen, Gruppe „Modell“)",
  chatModelPillAccessibleName: (p) => `${p.purpose} — Modell: ${p.modelId}`,
  chatPendingAttachmentsLabel: "Angehängte Dokumente",
  chatRemoveAttachmentLabel: (p) => `${p.filename} entfernen`,
  chatNoTextExtractedProblem: (p) =>
    `„${p.filename}“: kein Text extrahiert — ein gescanntes PDF oder ein leeres Dokument?`,
  chatReasoningEnabledNotice: "Reasoning aktiviert — senden Sie Ihre Nachricht erneut, nun mit reasoning_effort.",
  chatReasoningSwapFailed: (p) =>
    `Reasoning konnte in der laufenden Sitzung nicht aktiviert werden (${p.error}). Der Chat bleibt unverändert.`,
  chatReasoningOffer:
    "Das Modell hat geantwortet, ohne ein Tool aufzurufen — typisch für ein Reasoning-Hybridmodell, das ohne " +
    "reasoning_effort läuft. Reasoning aktivieren und erneut versuchen?",
  chatEnablingReasoning: "Wird aktiviert…",
  chatEnableReasoning: "Reasoning aktivieren",
  chatDismissReasoningSuggestion: "Reasoning-Vorschlag schliessen",
  chatNotNow: "Jetzt nicht",
  chatDismissNotice: "Hinweis schliessen",
  chatHelpAnnouncement: "Hilfeanfrage an die Assistenz gesendet.",
  chatHelpDisplayText: "Hilfe angefordert",
  chatContinueLabel: "Fortsetzen",
  chatContinueTitle: "Das Modell die abgeschnittene Antwort vervollständigen lassen",
  chatRetryLabel: "Erneut versuchen",
  chatRetryTitle: "Das Modell bitten, die vorherige Anfrage noch einmal vollständig zu beantworten",
  chatJumpToLatestLabel: "Zur neuesten Nachricht springen",
  chatJumpToLatestText: "Zur neuesten",
  chatWorkingDisclosureLabel: "Arbeitet…",
  chatWorkingDetailLabel: "Aktuelle technische Aktivität",
  chatWorkingDetailEmpty: "Wartet auf die nächste Aktivität…",
  chatWorkingToolActivityLabel: (p) => `Tool-Aktivität: ${p.action} (${p.status})`,
  chatInteractionUnavailable: "Diese Frage ist nicht verfügbar. Fahren Sie im Nachrichtenfeld fort.",
  chatThinkingHeadLive: "denkt nach…",
  chatThinkingHeadDone: "Gedankengang",
  chatThinkingEmptyBody: "…",
  chatSlashCommandsLabel: "Slash-Befehle",

  errorRunLockedReason: "Der Agent arbeitet noch — warten Sie, bis der Zug abgeschlossen ist.",
  errorBusyNoticeText: "Die Assistenz arbeitet noch — versuchen Sie es erneut, sobald sie fertig ist.",
  errorAuthBillingText:
    "Der Modellanbieter hat die Anfrage abgelehnt — er meldet fehlendes Guthaben oder einen ungültigen API-Schlüssel. " +
    "Prüfen Sie Ihr Anbieterkonto oder die LLM-Verbindung in den Einstellungen und senden Sie Ihre Nachricht erneut.",
  errorGenericProviderText:
    "Der Modellanbieter konnte die Anfrage nicht ausführen. Ihr Gespräch bleibt unverändert — " +
    "versuchen Sie es erneut; die vollständigen Fehlerdetails stehen im Sitzungsprotokoll.",
  errorLoopAbortNote:
    "Ich habe dasselbe Werkzeug wiederholt ohne Fortschritt aufgerufen und abgebrochen, um eine Schleife zu " +
    "vermeiden. Bitte formulieren Sie die Anfrage um oder versuchen Sie es erneut.",

  canvasIterateLabel: "↻ Iterieren",
  canvasNoAnnotationsLabel: "keine Notizen",
  canvasAnnotationCountLabel: (p) => `${p.count} Notiz${p.count === 1 ? "" : "en"}`,
  canvasRemoveAnnotationLabel: "Notiz entfernen",
  canvasAnnotationInputPlaceholder: "Notiz zu diesem Artefakt…",
  canvasAnnotationAddLabel: "Hinzufügen",
  canvasAnnotateToggleLabel: "+ Notiz",
  canvasExportLabel: "Exportieren",
  canvasExportBusy: "Wird exportiert…",
  canvasExportTitle: "Das Designdokument dieses Kurses aus dem CBE Process Canvas in eine Datei exportieren",
  canvasExportNoSession: "Es ist noch kein Gespräch geöffnet.",
  canvasExportNothing: "Noch nichts zu exportieren — kein Artefakt im CBE Process Canvas enthält einen Wert.",
  canvasExportDone: (p) => `Gespeichert unter ${p.path}`,
  canvasDeleteArtefactLabel: (p) => `${p.label} löschen`,
  canvasDeleteArtefactTitle: "Dieses Artefakt löschen",
  canvasDeleteConfirmLabel: (p) => `${p.label} löschen?`,
  canvasDeleteConfirmText: (p) =>
    `„${p.label}“ löschen? Der Inhalt wird aus dem CBE Process Canvas entfernt; im Gesprächsverlauf bleibt er erhalten.`,
  canvasDeleteAction: "Löschen",
  canvasEmptyValue: "—",
  canvasFocusMarkerLabel: "im Fokus",
  canvasFocusMarkerText: "Fokus",
  canvasStepFocusLabel: (p) => `Auf Schritt ${p.step} fokussieren: ${p.name}`,
  canvasStepFocusTitle: "Diesen Schritt fokussieren",

  canvasStep1Name: "Rahmen setzen",
  canvasStep2Name: "Lernergebnisse",
  canvasStep3Name: "Leistungsnachweis",
  canvasStep4Name: "Challenge",
  canvasStep5Name: "Stakeholder",
  canvasStep6Name: "Lernreise",
  canvasStep7Name: "Aktivitäten",
  canvasStep8Name: "Ergebnisse",
  canvasStep9Name: "Alignment-Check",
  canvasStep10Name: "Vorbereitung",

  canvasJourneyEngage: "Engage",
  canvasJourneyInvestigate: "Investigate",
  canvasJourneyAct: "Act / Prototype",
  canvasJourneyReflect: "Reflect and present",

  canvasArtefactModuleframe: "Modul-Metadaten / Rahmenbedingungen",
  canvasArtefactLearningoutcomes: "Lernergebnisse",
  canvasArtefactAssessmentblueprint: "Assessment-Blueprint",
  canvasArtefactBigidea: "Big Idea",
  canvasArtefactEq: "Essential Question",
  canvasArtefactChallenge: "Challenge Statement",
  canvasArtefactStakeholderplan: "Stakeholder- und Engagement-Plan",
  canvasArtefactEs: "Engage-Sequenz",
  canvasArtefactIs: "Investigate-Sequenz",
  canvasArtefactAs: "Act-Sequenz",
  canvasArtefactRs: "Reflect-Sequenz",
  canvasArtefactActivityplan: "Plan der Lernaktivitäten",
  canvasArtefactDeliverablesmap: "Übersicht der Ergebnisse",
  canvasArtefactAlignmentmatrix: "Alignment-Matrix + Korrekturen",
  canvasArtefactReadinesschecklist: "Checkliste Durchführung und Bereitschaft",

  canvasStateDone: "fertig",
  canvasStateActive: "aktiv",
  canvasStateDraft: "Entwurf",
  canvasStateOpen: "offen",
  canvasDepthOpen: "offen",
  canvasDepthRough: "grob",
  canvasDepthRefined: "verfeinert",
  canvasDepthDetailed: "ausgearbeitet",

  exportDocumentTitle: (p) => `${p.course} — CBE-Moduldesign`,
  exportGeneratedAt: (p) => `_Exportiert ${p.stamp} aus dem festgehaltenen Canvas-Stand._`,
  exportCourseContextHeading: "Kurskontext",
  exportStepHeading: (p) => `Schritt ${p.step} — ${p.name}`,
  exportCoverage: (p) => `_Abdeckung: ${p.depth}_`,
  exportOpenArtefact: "_(offen — noch nicht entschieden)_",
  exportStoppedTurnNote: "_(von Ihnen gestoppt — diese Antwort ist unvollständig)_",
  exportMaturityHeading: "CBE Maturity",
  exportMaturityColumnCriterion: "Kriterium",
  exportMaturityColumnCurrent: "Aktuell",
  exportMaturityColumnTarget: "Ziel",
  exportMaturityUnassessed: "nicht eingeschätzt",
  exportMaturityLimitation: (p) => `**Einschränkung:** ${p.note}`,

  decisionsHeading: "Entscheidungen",
  decisionsResetBadge: "zurückgesetzt · übergeordnetes Ziel überarbeitet",
  decisionsModuleGoals: "Modulziele",
  decisionsNoGoals: "Noch keine operativen Ziele.",
  decisionsAlignmentStatus: "Alignment-Status",
  decisionsAlignmentReset: "Zurückgesetzt — erneut gegen das überarbeitete Ziel prüfen.",
  decisionsNoAlignment: "Noch keine Alignment-Befunde.",
  decisionsDelegation: "Delegationsentscheidungen",
  decisionsDelegationReset: "Zurückgesetzt — erneut gegen das überarbeitete Ziel bzw. Alignment prüfen.",
  decisionsNoDelegation: "Noch keine Delegationsentscheidungen.",
  decisionsHeterogeneity: "Notizen zur Heterogenität",
  decisionsSoftSkill: "Soft-Skill-Anker",
  decisionsMissingAnchor: "Anker fehlt",
  decisionsWarningLabel: "Warnung",
  decisionsEmptyValue: "—",
  decisionsEmpty:
    "In diesem Gespräch wurden noch keine Entscheidungen festgehalten. Dieser Abschnitt füllt sich, während die " +
    "didaktischen Prüfungen mit der Assistenz durchlaufen werden.",

  pickerGroupLabel: "Auswahl",
  pickerRequiredLabel: "erforderlich",
  pickerAnsweredLabel: "beantwortet",
  pickerAnsweredBadge: "BEANTWORTET",
  pickerSubmitLabel: "Übernehmen",
  pickerOtherLabelFallback: "Anderes — ich beschreibe es",
  checklistGroupLabel: "Entscheidungs-Checkliste",
  checklistAnsweredLabel: "beantwortet",
  checklistAnsweredBadge: "BEANTWORTET",
  checklistSubmitLabel: "Übernehmen",

  toolFallbackLabel: "Arbeitet…",
  toolReadLabel: "Liest Quelle",
  toolWriteLabel: "Schreibt Datei",
  toolEditLabel: "Bearbeitet Datei",
  toolGrepLabel: "Durchsucht Korpus",
  toolFindLabel: "Sucht Dateien",
  toolLsLabel: "Listet Verzeichnis",
  toolPickerLabel: "Stellt Frage",
  toolChecklistLabel: "Zeigt Checkliste",
  toolCiteLabel: "Belegt Quelle",
  toolCanvasLabel: "Aktualisiert Canvas",
  toolProfileLabel: "Aktualisiert Profil",
  toolStepLabel: "Aktualisiert Schritt",
  toolMaturityLabel: "Aktualisiert Maturity",
  toolWikiLabel: "Liest Wiki",
  toolSupportLabel: "Speichert Unterstützungswunsch",
  toolStatusRunning: "läuft",
  toolStatusDone: "fertig",
  toolStatusError: "Fehler",
  toolProfileAssumptionNote:
    "Eine aus unserem Gespräch abgeleitete Annahme — keine feststehende Tatsache. Sie können sie im Profilbereich überschreiben.",
  toolPickerCallFailed: "Aufruf des Auswahl-Tools fehlgeschlagen",
  toolChecklistCallFailed: "Aufruf des Checklisten-Tools fehlgeschlagen",
  toolPickerSpecRejected: (p) => `Auswahl-Spezifikation abgelehnt: ${p.detail}`,
  toolChecklistSpecRejected: (p) => `Checklisten-Spezifikation abgelehnt: ${p.detail}`,
  toolSpecDetailArgsMissing: "args fehlt oder ist kein Objekt",
  toolSpecDetailQuestionMissing: "question fehlt oder ist leer",
  toolSpecDetailOptionsMissing: "options fehlt oder ist kein Array",
  toolSpecDetailOptionsTooFew: (p) => `options braucht mindestens 2 Einträge (erhalten: ${p.count})`,
  toolSpecDetailOptionNotObject: (p) => `options[${p.index}] ist kein Objekt`,
  toolSpecDetailOptionIdEmpty: (p) => `options[${p.index}].id ist leer`,
  toolSpecDetailOptionLabelEmpty: (p) => `options[${p.index}].label ist leer`,
  toolSpecDetailPresentationInvalid: "presentation muss 'checklist' oder 'progress-bar' sein",
  toolSpecDetailItemsMissing: "items fehlt oder ist kein Array",
  toolSpecDetailItemsTooFew: (p) => `items braucht mindestens 2 Einträge (erhalten: ${p.count})`,
  toolSpecDetailItemNotObject: (p) => `items[${p.index}] ist kein Objekt`,
  toolSpecDetailItemIdEmpty: (p) => `items[${p.index}].id ist leer`,
  toolSpecDetailItemLabelEmpty: (p) => `items[${p.index}].label ist leer`,

  maturityCriterionSocietalChallenge: "Gesellschaftliche (reale) Challenge",
  maturityCriterionStakeholderInvolvement: "Einbindung von Stakeholdern",
  maturityCriterionInterdisciplinarity: "Inter-/transdisziplinär",
  maturityCriterionStudentAgency: "Selbstbestimmung der Studierenden & Rolle der Lehrperson",
  maturityCriterionIterativeProcess: "Iterativer Lernprozess",
  maturityCriterionValueReflection: "Werteorientierung, Reflexion",
  maturityCriterionSocietalImpact: "Gesellschaftliche Wirkung und Übertragbarkeit",

  maturityLevelShort1: "L1 — CBE light",
  maturityLevelShort2: "L2 — good practice",
  maturityLevelShort3: "L3 — full-fledged",
  maturityLevelFull1: "Stufe 1 „CBE light / challenge-inspired“",
  maturityLevelFull2: "Stufe 2 „CBE good practice / challenge-oriented“",
  maturityLevelFull3: "Stufe 3 „full-fledged CBE / transformative“",

  maturityGlossSocietalChallenge1:
    "Ein reales Thema wird aufgegriffen, die Challenge ist jedoch vorgegeben und geschlossen.",
  maturityGlossSocietalChallenge2:
    "Studierende arbeiten an einer offenen Challenge, die in einem realen gesellschaftlichen oder regionalen Anliegen wurzelt.",
  maturityGlossSocietalChallenge3:
    "Die Challenge stammt von einer realen Anspruchsgruppe, ist wirklich offen und zielt auf gesellschaftlichen Nutzen über den Kurs hinaus.",
  maturityGlossStakeholderInvolvement1: "Stakeholder treten als Gastvortragende oder Fallgebende auf.",
  maturityGlossStakeholderInvolvement2:
    "Stakeholder interagieren zu festgelegten Zeitpunkten mit den Studierenden (z. B. Briefing, Feedback).",
  maturityGlossStakeholderInvolvement3:
    "Stakeholder treten über den gesamten Lernprozess hinweg als Challenge-Gebende oder Ko-Gestaltende auf.",
  maturityGlossInterdisciplinarity1:
    "Studierende werden ermutigt, andere Perspektiven einzubeziehen, ohne dass dies strukturell verankert ist.",
  maturityGlossInterdisciplinarity2: "Mehrere Disziplinen oder Wissensbereiche werden ausdrücklich integriert.",
  maturityGlossInterdisciplinarity3:
    "Akademisches und ausserakademisches Wissen wird transdisziplinär ko-produziert und ist strukturell verankert.",
  maturityGlossStudentAgency1: "Studierende haben begrenzte Wahlmöglichkeiten in einem vorgegebenen Rahmen.",
  maturityGlossStudentAgency2:
    "Studierende treffen zentrale Entscheidungen; Lehrende wirken vor allem als Lernbegleitung.",
  maturityGlossStudentAgency3:
    "Studierende verantworten den Challenge-Prozess vollständig; Lehrende ermöglichen, coachen und reflektieren.",
  maturityGlossIterativeProcess1: "Einzelne praktische Aktivitäten, aber wenig Iteration oder Feedback.",
  maturityGlossIterativeProcess2: "Strukturierte Lernphasen mit Feedback- und Reflexionsschleifen.",
  maturityGlossIterativeProcess3:
    "Mehrere iterative Zyklen aus Erproben, Feedback, Reflexion und Anpassung sind zentral.",
  maturityGlossValueReflection1: "Werteorientierte Reflexion wird erwähnt, aber nicht systematisch bearbeitet.",
  maturityGlossValueReflection2:
    "Studierende reflektieren ethische Implikationen und die gesellschaftliche Wirkung ihrer Lösungen.",
  maturityGlossValueReflection3:
    "Ethische Reflexion und Werteabwägungen sind über den gesamten Challenge-Prozess hinweg verankert.",
  maturityGlossSocietalImpact1: "Mögliche gesellschaftliche Relevanz wird diskutiert, aber nicht umgesetzt.",
  maturityGlossSocietalImpact2: "Ergebnisse werden mit Stakeholdern oder relevanten Gemeinschaften geteilt.",
  maturityGlossSocietalImpact3:
    "Ergebnisse tragen über den Kurs hinaus zu realer Veränderung, Entscheidungen oder Folgeaktivitäten bei.",

  maturityTargetUnsettled: "Der Gesamtanspruch des Designs muss noch mit der dozierenden Person geklärt werden.",
  maturityAchievedNotDue: "Die Einschätzung des Erreichten steht noch nicht an: kein Kriterium wurde eingeschätzt.",
  maturityDiscussDisplay: (p) => `Maturity besprechen: ${p.label}`,
  maturityAssessDisplay: "Die Maturity des Designs einschätzen",
  maturityAssessLabel: "Maturity einschätzen",
  maturityAssessTitle: "Die Assistenz bitten, die Maturity des Designs für das CBE-Maturity-Panel einzuschätzen",
  maturityAssessLockedReason: (p) => `${p.runLocked} Die CBE-Maturity-Einschätzung kann erst danach starten.`,
  maturityAssessNoSession:
    "Es ist noch kein Gespräch geöffnet — die CBE-Maturity-Einschätzung läuft innerhalb eines Gesprächs.",
  maturityPanelIntroEmpty:
    "Die Maturity-Einschätzung zeigt, wo Ihr Moduldesign aktuell auf dem PIONEER-Kontinuum steht — drei Stufen " +
    "(CBE light, good practice, full-fledged) über sieben Kriterien — und welche Zielstufe Sie anstreben. Sie wird " +
    "früh aus Ihrem Material und Ihrem Gespräch mit der Assistenz gewonnen und gehört dann zu diesem Kurs — sie " +
    "bleibt beim Kurs, auch wenn Sie eine neue Sitzung beginnen. Für diesen Kurs wurde noch nichts eingeschätzt.",
  maturityPanelIntroRaster:
    "Wie die Assistenz die CBE-Maturity dieses Designs derzeit liest. Die Stufen stammen aus Ihrem Material und " +
    "diesem Gespräch — sie sind Arbeitsannahmen, kein Urteil; nutzen Sie „In Chat besprechen“ bei einem Kriterium, " +
    "um sie zu korrigieren oder weiterzuentwickeln.",
  maturityPanelIntroNoRaster:
    "Wie die Assistenz die CBE-Maturity dieses Designs derzeit liest. Die sieben Kriterien werden aus Ihrem Material " +
    "und diesem Gespräch gelesen, sobald das Design genug Substanz dafür hat.",
  maturityThinClosingEmpty: "Sie können trotzdem eine Einschätzung anfordern — sie wird als vorläufig markiert.",
  maturityThinClosingPopulated:
    "Bis dahin bleibt die Einschätzung eng — „Maturity einschätzen“ aktualisiert sie gegen den aktuellen Stand.",
  maturityThinHeading: "Bislang dünne Evidenzbasis:",
  maturityThinNoMaterial: "noch kein Material eingelesen",
  maturityThinDocuments: (p) => `${p.count} Dokument(e) eingelesen`,
  maturityThinArtefacts: (p) => `${p.count} Design-Artefakt(e) festgehalten`,
  maturityThinSteps: (p) => `${p.count} Design-Schritt(e) bearbeitet`,
  maturityThinGap: (p) =>
    `${p.have}. Material einzubringen oder Entscheidungen über einen zweiten Design-Schritt hinweg zu klären, ergibt eine tragfähigere Einschätzung.`,
  maturityUnknownProvenance:
    "Diese Einschätzung wurde früher in diesem Kurs festgehalten. Ihre Evidenzgrundlage ist hier nicht mehr " +
    "nachvollziehbar, daher wird nichts darüber behauptet, wie gut belegt oder wie aktuell sie ist. Nutzen Sie " +
    "„Maturity einschätzen“ unten für eine Einschätzung des Designs im heutigen Stand.",
  maturityStaleHeading: "Nicht mehr aktuell:",
  maturityStaleBody: (p) =>
    `das Design hat sich seit dieser Einschätzung verändert — ${p.changes}${p.more}. Die Stufen unten sind der ` +
    `zuletzt festgehaltene Stand. Nutzen Sie „Maturity einschätzen“ unten, um sie zu aktualisieren.`,
  maturityStaleMore: (p) => ` (+${p.omitted} weitere Änderung${p.omitted === 1 ? "" : "en"})`,
  maturityStaleChangeIngestion: (p) => `Material eingelesen${p.label ? `: „${p.label}“` : ""}`,
  maturityStaleChangeStepDepth: (p) => `Design-Schritt ${p.step ?? "?"} hat eine neue Tiefe erreicht`,
  maturityStaleChangeArtefactSet: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `Schritt ${p.step}` : undefined]
      .filter(Boolean)
      .join(", ");
    return `Artefakt geändert${p.label ? `: „${p.label}“` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactCleared: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `Schritt ${p.step}` : undefined]
      .filter(Boolean)
      .join(", ");
    return `Artefakt geleert${p.label ? `: „${p.label}“` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactDeleted: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `Schritt ${p.step}` : undefined]
      .filter(Boolean)
      .join(", ");
    return `Artefakt gelöscht${p.label ? `: „${p.label}“` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityProvisionalHeading: "Vorläufig:",
  maturityProvisionalBody:
    "diese Einschätzung entstand, als wenig vorlag, und beruht daher auf einer dünnen Evidenzbasis.",
  maturityProvisionalSufficient:
    "Inzwischen ist mehr geklärt — nutzen Sie „Maturity einschätzen“ unten für eine Einschätzung des Designs im heutigen Stand.",
  maturityTargetExceeded: "Ziel übertroffen",
  maturityTargetReached: "Ziel erreicht",
  maturityTargetLevel: (p) => `Ziel L${p.level}`,
  maturityNotYetAssessed: "noch nicht eingeschätzt",
  maturityCurrentPrefix: (p) => `aktuell ${p.level}`,
  maturityUncertainRow: "unsicher, schwache Evidenz",
  maturityUncertainBadge: "unsicher · schwache Evidenz",
  maturityCappedRow: "offener Befund begrenzt dieses Kriterium",
  maturityCappedBadge: "offener Befund · begrenzt dieses Kriterium",
  maturityDiscussLabel: "In Chat besprechen",
  maturityDiscussAccessibleName: (p) => `Maturity besprechen: ${p.label}`,
  maturityDiscussTitle: "Dieses Kriterium im Chat besprechen",
  maturityHeaderTargetLabel: "Ziel-Maturity",
  maturityHeaderAchievedLabel: "Gesamt erreicht · abgeleitet",
  maturityHeaderTargetAccessible: (p) => `Erklärte Ziel-Maturity: ${p.value}`,
  maturityHeaderAchievedAccessible: (p) =>
    `Abgeleitete Gesamteinschätzung des Erreichten: ${p.value}, ${p.derivation}${p.note}`,
  maturityHeaderNotDueAccessible: (p) => `Gesamteinschätzung des Erreichten: ${p.value}${p.note}`,
  maturityRecordedLimitation: (p) => `. Festgehaltene Einschränkung: ${p.note}`,
  maturityDerivation: (p) =>
    `abgeleitet aus ${p.contributing} von ${p.total} eingeschätzten Kriterien · Mittelwert ${p.mean}`,
  maturityDerivationCapped: (p) => `${p.base} · begrenzt auf ${p.level} durch den offenen Befund zu ${p.criterion}`,

  panelLeftLabel: "Linkes Panel",
  panelRightLabel: "Rechtes Panel",
  panelRightTabsLabel: "Tabs des rechten Panels",
  panelCanvasTab: "CBE Process Canvas",
  panelMaturityTab: "CBE Maturity",
  panelCoursesTitle: "Kurse",
  panelExpandLeft: "Linkes Panel ausklappen",
  panelCollapseLeft: "Linkes Panel einklappen",
  panelExpandRight: "Rechtes Panel ausklappen",
  panelCollapseRight: "Rechtes Panel einklappen",
  panelOpenCourses: "Kurse öffnen",
  panelOpenCoursesWithNote: (p) => `Kurse öffnen (${p.note})`,
  panelCoursesTitleWithNote: (p) => `Kurse — ${p.note}`,
  panelAgentRunningElsewhere: "Agent arbeitet in einem anderen Kurs",
  panelRunFinishedElsewhere: "Ein Durchlauf in einem anderen Kurs ist fertig",
  panelIngestRunning: (p) => `Wiki-Einlesen läuft (${p.settled} von ${p.total} Dokumenten)`,
  panelOpenTab: (p) => `${p.label} öffnen`,
  panelOpenTabUnseen: (p) => `${p.label} öffnen (ungesehene Änderungen)`,
  panelTabUnseenTitle: (p) => `${p.label} — ungesehene Änderungen`,
  panelTabUnseenLabel: (p) => `${p.label} (ungesehene Änderungen)`,
  workspaceResizeLeft: "Linkes Panel in der Breite anpassen",
  workspaceResizeRight: "Rechtes Panel in der Breite anpassen",

  coursesAgentRunning: "Agent arbeitet",
  coursesUnseenResult: "Ungesehenes Ergebnis",
  coursesUnseenResultTitle: "Ein Durchlauf im Hintergrund ist fertig — wechseln Sie hin, um das Ergebnis zu sehen",
  coursesIntro:
    "Ihre Kurse. Jeder Kurs ist ein eigenständiger Ordner mit seinen Sitzungen, dem Canvas, dem Wiki und den Materialien.",
  coursesActiveBadge: "aktiv",
  coursesDetailsLabel: "Kursdetails",
  coursesWikiAtomCount: (p) => `${p.count} Wiki-Atom${p.count === 1 ? "" : "e"}`,
  coursesNewCourse: "Neuer Kurs",
  coursesNewCourseTitlePlaceholder: "Titel des neuen Kurses",
  coursesCreateLabel: "Kurs anlegen",
  coursesCancelLabel: "Abbrechen",
  coursesSaveLabel: "Speichern",
  coursesRenameLabel: "Umbenennen",
  coursesDeleteLabel: "Kurs löschen",
  coursesBack: "← Zurück",
  coursesKicker: "Kurs",
  coursesTitleFieldLabel: "Kurstitel",
  coursesSetActive: "Aktiv setzen",
  coursesConfirmDeletionLabel: "Löschen des Kurses bestätigen",
  coursesDeleteConfirmText: (p) =>
    `„${p.title}“ löschen? Die Gespräche, das Moduldesign im CBE Process Canvas, das Wiki und die eingelesenen ` +
    `Materialien gehen mit. Der Kursordner wird in den Papierkorb Ihres Systems verschoben, von dort können Sie ihn wiederherstellen.`,
  coursesMoveToTrash: "In den Papierkorb",
  coursesDeletedTrashed: (p) => `Kurs „${p.title}“ wurde in den Papierkorb Ihres Systems verschoben.`,
  coursesDeletedMissing: (p) => `Kurs „${p.title}“ lag nicht mehr auf der Festplatte und wurde aus der Liste entfernt.`,
  coursesContentTabsLabel: "Kursinhalt",
  coursesTabChats: "Chats",
  coursesTabWiki: "Wiki",
  coursesChatsLockedReason:
    "Der Agent arbeitet noch — warten Sie, bis der Zug abgeschlossen ist, bevor Sie das Gespräch wechseln.",
  coursesConversationsLabel: "Gespeicherte Gespräche",
  coursesConversationsLoading: "Gespräche werden geladen…",
  coursesConversationsEmpty: "Noch keine gespeicherten Gespräche.",
  coursesConversationUndated: "Ohne Datum",
  coursesConversationOpenBadge: "offen",
  coursesConversationNoMessages: "Noch keine Nachrichten",
  coursesConversationResumeTitle: (p) => `Dieses Gespräch fortsetzen (${p.sessionId})`,
  coursesConversationTurnCount: (p) => `${p.count} ${p.count === 1 ? "Zug" : "Züge"}`,
  coursesHydrationInFlightSwitchNotice:
    "Das Gespräch wird noch geöffnet — warten Sie einen Moment, bevor Sie den Kurs wechseln.",

  wikiBack: "← Wiki",
  wikiAtomMeta: (p) => `${p.type} · Konfidenz ${p.confidence} · aktualisiert ${p.updated}`,
  wikiRelated: "Verwandt",
  wikiSearchPlaceholder: "Atome durchsuchen",
  wikiSearchLabel: "Wiki-Atome durchsuchen",
  wikiKnowledgeGraph: "Wissensgraph",
  wikiList: "Liste",
  wikiInvalidAtoms: (p) =>
    p.count === 1
      ? `${p.count} Datei unter wiki/ hat die Atom-Validierung nicht bestanden — öffnen Sie den Ordner, um sie zu korrigieren.`
      : `${p.count} Dateien unter wiki/ haben die Atom-Validierung nicht bestanden — öffnen Sie den Ordner, um sie zu korrigieren.`,
  wikiEmpty: "Noch keine Atome — lesen Sie Material ein, um das Wiki aufzubauen.",
  wikiNoMatches: "Keine Atome passen zur Suche.",
  wikiNothingToGraph: "Noch keine Atome für den Graphen.",
  wikiGraphLabel: "Wissensgraph der Wiki-Atome",
  wikiOpenAtom: (p) => `Atom ${p.title} öffnen`,
  wikiAtomRowMeta: (p) => `${p.type} · ${p.updated}`,
  wikiIngestLabel: "Material einlesen",
  wikiIngestInactiveCourse: "Aktivieren Sie diesen Kurs, um hier ein neues Einlesen zu starten.",
  wikiIngestAbortLabel: "Abbrechen",
  wikiIngestNotice: (p) => `${p.done} Dokument(e) atomisiert${p.failed ? `, ${p.failed} fehlgeschlagen` : ""}.`,
  wikiIngestAbortedNotice: "Einlesen abgebrochen.",
  wikiIngestAbortUndeliveredNotice:
    "Das Einlesen wurde hier beendet. Der Abbruch hat keine laufende Atomisierung erreicht — ein bereits gestartetes Einlesen läuft weiter.",

  settingsGroupModel: "Modell",
  settingsGroupAppearance: "Darstellung",
  settingsGroupAbout: "Über",
  settingsGroupCorpus: "Korpus",
  settingsThemeLabel: "Erscheinungsbild",
  settingsThemeHint: "Dunkel nutzt Catppuccin · Hell nutzt Latte",
  settingsFlavourLabel: "Variante",
  settingsFlavourHint: "Catppuccin-Variante für Dunkel",
  settingsAccentLabel: "Akzent",
  settingsAccentHint: "14 Catppuccin-Akzente",
  settingsChatTextSizeLabel: "Schriftgrösse im Chat",
  settingsChatTextSizeHint: "Schriftgrösse des Chatverlaufs und des Eingabefelds",
  settingsChatTextSizeSmall: "Klein",
  settingsChatTextSizeMedium: "Mittel",
  settingsChatTextSizeLarge: "Gross",
  settingsInterfaceLanguageLabel: "Oberflächensprache",
  settingsInterfaceLanguageHint: "Sprache der Beschriftungen, Menüs und Meldungen der App",
  settingsInterfaceLanguageGroupLabel: "Oberflächensprache",
  settingsApiKeyStatusLabel: "Status des API-Schlüssels",
  settingsApiKeySet: "Ein API-Schlüssel ist hinterlegt",
  settingsApiKeyUnset: "Kein API-Schlüssel hinterlegt",
  settingsBaseUrlLabel: "Basis-URL",
  settingsBaseUrlExplanation:
    "Die Adresse des OpenAI-kompatiblen Endpunkts, an den die App alle Anfragen sendet. Sie endet meist auf /v1, " +
    "z. B. https://api.example.com/v1.",
  settingsBaseUrlPlaceholder: "https://ihr-llm-endpunkt/v1",
  settingsModelIdLabel: "Modell-ID",
  settingsModelIdExplanation:
    "Die genaue Modellkennung, die Ihr Endpunkt erwartet, z. B. gemma-3-27b-it. Kopieren Sie sie aus der Modellliste " +
    "Ihres Anbieters — eine vertippte ID lässt jede Anfrage scheitern.",
  settingsModelIdPlaceholder: "modell-id",
  settingsApiKeyLabel: "API-Schlüssel",
  settingsApiKeyExplanation:
    "Der geheime Schlüssel, der Anfragen an Ihren Endpunkt autorisiert (beginnt oft mit sk-). Er wird auf diesem " +
    "Gerät verschlüsselt gespeichert und nur an den von Ihnen konfigurierten Endpunkt gesendet. Bleibt das Feld " +
    "leer, bleibt der bereits gespeicherte Schlüssel erhalten; ein neuer Wert ersetzt ihn.",
  settingsApiKeyPlaceholder: "sk-…",
  settingsKeyRequiredForEndpoint:
    "Für den neuen Endpunkt wird ein Schlüssel benötigt — eine Zugangsberechtigung wird nie auf eine andere " +
    "Basis-URL übertragen. Geben Sie den Schlüssel für diesen Endpunkt ein, um Speichern freizuschalten.",
  settingsUnsavedChanges: "Ungespeicherte Änderungen — drücken Sie Speichern, um sie zu übernehmen.",
  settingsSaved: "Gespeichert.",
  settingsSavedWithSwap: (p) => `Gespeichert · der laufende Chat nutzt jetzt ${p.modelId}.`,
  settingsSaving: "Wird gespeichert…",
  settingsSave: "Speichern",
  settingsTesting: "Wird geprüft…",
  settingsTestConnection: "Verbindung prüfen",
  settingsRequiredFields: "Basis-URL und Modell-ID sind erforderlich.",
  settingsContextLengthInvalid: "Die Kontextlänge muss eine positive ganze Zahl (Tokens) sein, z. B. 65536.",
  settingsSwapFailed: (p) =>
    `Gespeichert, aber der laufende Chat konnte das Modell nicht wechseln (${p.error}). Er bleibt beim bisherigen Modell.`,
  settingsTestOk: "Verbindung in Ordnung — der Endpunkt hat geantwortet und den Schlüssel akzeptiert.",
  settingsTestUnauthorized: (p) =>
    `Nicht autorisiert — der Endpunkt hat den API-Schlüssel abgelehnt (HTTP ${p.status}). Prüfen Sie ihn oder geben Sie ihn erneut ein.`,
  settingsTestUnreachable: "Endpunkt nicht erreichbar — prüfen Sie die Basis-URL und Ihr Netzwerk.",
  settingsTestNotConfigured:
    "Noch keine Verbindung konfiguriert — hinterlegen Sie zuerst eine Basis-URL und einen API-Schlüssel.",
  settingsTestHttpError: (p) => `Der Endpunkt hat mit HTTP ${p.status} geantwortet — prüfen Sie die Basis-URL.`,
  settingsAdvanced: "Erweitert",
  settingsReasoningLabel: "Reasoning",
  settingsReasoningExplanation:
    "Aktiviert den expliziten Reasoning-Modus des Modells, indem ein reasoning_effort-Parameter gesendet wird. " +
    "Hilfreich bei Hybridmodellen, die sonst keine Tools aufrufen (Klasse Qwen3-A3B); bei nativ reasoning-fähigen " +
    "Modellen wie gpt-oss ausgeschaltet lassen — manche Endpunkte lehnen die Einstellung mit einem Fehler ab.",
  settingsReasoningToggleLabel: "Reasoning aktivieren",
  settingsReasoningOn: "An",
  settingsReasoningOff: "Aus",
  settingsReasoningEffortLabel: "Reasoning-Aufwand",
  settingsReasoningEffortExplanation:
    "Wie viel Denkzeit sich das Modell vor jeder Antwort nimmt — niedrig antwortet am schnellsten, hoch ist am " +
    "gründlichsten. Mittel ist eine sinnvolle Voreinstellung.",
  settingsEffortLow: "niedrig",
  settingsEffortMedium: "mittel",
  settingsEffortHigh: "hoch",
  settingsContextLengthLabel: "Kontextlänge",
  settingsContextLengthExplanation:
    "Das tatsächliche Token-Fenster Ihres Modells, z. B. 65536. Leer lassen, um den Standard zu nutzen; ein zu " +
    "grosser Wert führt mitten im Gespräch zu Fehlern, ein zu kleiner fasst das Gespräch zu früh zusammen.",
  settingsContextLengthPlaceholder: "z. B. 65536",
  settingsDeleteApiKey: "API-Schlüssel löschen",
  settingsConfirmEraseLabel: "Löschen des API-Schlüssels bestätigen",
  settingsEraseConfirmText:
    "Den gespeicherten API-Schlüssel von diesem Gerät löschen? Vor der nächsten Sitzung müssen Sie erneut einen Schlüssel eingeben.",
  settingsDeleteKey: "Schlüssel löschen",
  settingsCancel: "Abbrechen",
  settingsKeyErased:
    "API-Schlüssel von diesem Gerät gelöscht. Geben Sie einen neuen Schlüssel ein, bevor Sie die nächste Sitzung starten.",
  settingsLocalityStatement:
    "Ihr API-Schlüssel und alles, was Sie eingeben, werden lokal auf diesem Gerät gespeichert (der Schlüssel " +
    "verschlüsselt über Electron safeStorage, sofern verfügbar) und nur an den von Ihnen konfigurierten " +
    "LLM-Endpunkt gesendet — kein CBE- oder anderer Drittserver erhält sie.",
  settingsAboutSkill: "Skill",
  settingsAboutSkillVersion: "Skill-Version",
  settingsAboutAppVersion: "App-Version",
  settingsAboutSkillUpdateStatus: "Status der Skill-Aktualisierung",
  settingsAboutSkillUpdateNotChecked: "Noch nicht geprüft; der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdateUpdated: (p: { version: string }): string => `Auf Skill ${p.version} aktualisiert.`,
  settingsAboutSkillUpdateUpToDate: (p: { version: string }): string => `Skill ${p.version} ist aktuell.`,
  settingsAboutSkillUpdateMetadataInvalid: (p: { field: string }): string =>
    `Aktualisierung abgelehnt: ungültige Zeigermetadaten${p.field ? ` (${p.field})` : ""}. Der oben angezeigte wirksame Skill bleibt in Verwendung.`,
  settingsAboutSkillUpdateAppMismatch:
    "Aktualisierung abgelehnt: Dieser Skill unterstützt diese App-Version nicht. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdateAbiMismatch:
    "Aktualisierung abgelehnt: Die ABI der Modelloberfläche weicht ab. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdateToolMismatch:
    "Aktualisierung abgelehnt: Der Tool-Vertrag weicht ab. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdatePiMismatch:
    "Aktualisierung abgelehnt: Die getestete Pi-Version weicht ab. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdateIntegrityMismatch:
    "Aktualisierung abgelehnt: Der Archiv-Prüfwert stimmt nicht überein. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillUpdateUnavailable:
    "Die Aktualisierungsprüfung ist nicht verfügbar. Der oben angezeigte wirksame Skill bleibt in Verwendung.",
  settingsAboutSkillPackIdentity: "Signiertes Skill-Paket",
  settingsAboutSkillPackIdentityValue: (p: {
    channel: string;
    epoch: number;
    sequence: number;
    keyId: string;
  }): string => `${p.channel} · Epoche ${p.epoch} · Sequenz ${p.sequence} · Schlüssel ${p.keyId}`,
  settingsAboutSkillUpdateSignedRefused: (p: { code: string; field: string }): string =>
    `Signierte Aktualisierung abgelehnt (${p.code}${p.field ? `: ${p.field}` : ""}). Der oben angezeigte wirksame Skill bleibt in Verwendung.`,
  settingsAboutSkillUpdateSignedUnavailable: (p: { code: string }): string =>
    `Die signierte Aktualisierungsprüfung ist nicht verfügbar (${p.code}). Der oben angezeigte wirksame Skill bleibt in Verwendung.`,
  settingsAboutLoading: "wird geladen…",
  settingsAboutUnavailable: "nicht verfügbar",
  settingsPioneerLinkLabel: "Website der PIONEER Alliance",
  settingsPioneerLinkDescription:
    "Erfahren Sie mehr über die PIONEER Alliance, den europäischen Hochschulverbund, mit dem diese Toolbox verbunden ist.",
  settingsPioneerExternalCue: "Wird im Systembrowser geöffnet.",
  settingsPioneerOpenFailure: "Die Website der PIONEER Alliance konnte nicht geöffnet werden. Versuchen Sie es erneut.",
  settingsHelpButtonLabel: (p) => `Was ist ${p.field}?`,
  settingsThemeToggleLabel: "Erscheinungsbild umschalten",
  settingsThemeDark: "Dunkel",
  settingsThemeLight: "Hell",
  settingsFlavourGroupLabel: "Catppuccin-Variante",
  settingsFlavourLatteNote: "Hell nutzt die Latte-Palette — die Variantenwahl gilt nur für Dunkel.",
  settingsFlavourFrappe: "Frappé",
  settingsFlavourMacchiato: "Macchiato",
  settingsFlavourMocha: "Mocha",
  settingsAccentGroupLabel: "Akzentfarbe",
  settingsAzureHintBefore:
    "Das sieht nach einer Azure-OpenAI-Ressource aus. Die OpenAI-kompatible Schnittstelle liegt meist unter",
  settingsCleartextWarningBefore: "Dieser Endpunkt nutzt einfaches",
  settingsCleartextWarningMiddle: "— der API-Schlüssel würde unverschlüsselt übertragen. Nutzen Sie",
  settingsCleartextWarningAfter: ", sofern dies kein vertrauenswürdiges lokales Netz ist.",

  corpusVersionLabel: "Version",
  corpusCacheDateLabel: "Cache-Datum",
  corpusPackIdentityLabel: "Signiertes Korpus-Paket",
  corpusPackIdentityValue: (p: { channel: string; epoch: number; sequence: number; keyId: string }): string =>
    `${p.channel} · Epoche ${p.epoch} · Sequenz ${p.sequence} · Schlüssel ${p.keyId}`,
  corpusShippedWithApp: "mit der App ausgeliefert",
  corpusRefreshing: "Wird aktualisiert…",
  corpusRefresh: "Korpus aktualisieren",
  corpusEmptyValue: "—",
  corpusUpdated: (p) => `Korpus auf Version ${p.version} aktualisiert.`,
  corpusUpToDate: (p) => `Der Korpus ist aktuell (Version ${p.version}).`,
  corpusIntegrityMismatch:
    "Die Korpus-Aktualisierung ist fehlgeschlagen, die Integritätsprüfung stimmte nicht. Der bisherige Korpus bleibt geladen.",
  corpusRefreshNotConfigured: "Für diesen Build ist kein Ort für Korpus-Aktualisierungen konfiguriert.",
  corpusRefreshPointerHttp: (p) =>
    `Es konnte nicht nach einer Korpus-Aktualisierung gesucht werden (HTTP ${p.httpStatus}).`,
  corpusRefreshPointerRead: "Die Angaben zur Korpus-Aktualisierung konnten nicht gelesen werden.",
  corpusRefreshPointerInvalid: "Die Angaben zur Korpus-Aktualisierung sind unvollständig (version/file/sha256).",
  corpusRefreshDownloadHttp: (p) =>
    `Die Korpus-Aktualisierung konnte nicht heruntergeladen werden (HTTP ${p.httpStatus}).`,
  corpusRefreshDownloadRead: "Das heruntergeladene Korpus-Paket konnte nicht gelesen werden.",
  corpusRefreshMissingMarker: (p) =>
    `Das heruntergeladene Korpus-Paket enthält die erforderliche Datei ${p.markerFile} nicht auf oberster Ebene.`,
  corpusRefreshUnsafeEntry: (p) =>
    `Das heruntergeladene Korpus-Paket enthält einen unsicheren Eintrag und wurde abgelehnt: ${p.entryName}.`,
  corpusRefreshInstallFailed: "Die Korpus-Aktualisierung konnte nicht installiert werden.",
  corpusRefreshSignedRefused: (p: { code: string; field: string }): string =>
    `Signierte Korpus-Aktualisierung abgelehnt (${p.code}${p.field ? `: ${p.field}` : ""}). Das aktuelle Korpus bleibt geladen.`,
  corpusRefreshSignedUnavailable: (p: { code: string }): string =>
    `Die signierte Korpus-Aktualisierung ist nicht verfügbar (${p.code}). Das aktuelle Korpus bleibt geladen.`,
  corpusRefreshUnexpected: "Die Korpus-Aktualisierung konnte nicht abgeschlossen werden.",
  corpusInfoReloadFailed: "Die Korpus-Informationen konnten nicht neu geladen werden.",

  configPageLabel: "Einmalige Einrichtung",
  configGroupLabel: "LLM-Verbindung · BYO",
  configIntro:
    "Geben Sie Ihren OpenAI-kompatiblen LLM-Endpunkt an. Die Verbindungsdaten werden lokal auf diesem Rechner " +
    "gespeichert und, sofern verfügbar, über Electron safeStorage verschlüsselt.",
  configBaseUrlHint: "z. B. https://router.huggingface.co/v1",
  configApiKeyHint: "lokal gespeichert, nie weitergegeben",
  configModelIdHint: "z. B. gpt-4o-mini, gemma-3-27b-it",
  configModelIdPlaceholder: "gemma-3-27b-it",

  profileDimensionPblPriorKnowledge: "Vorwissen PBL",
  profileDimensionCbePriorKnowledge: "Vorwissen CBE",
  profileDimensionDidacticStance: "Didaktische Haltung",
  profileDimensionAttitude: "Einstellung zu CBE",
  profileDimensionCapacity: "Lehrdeputat / Kapazität",
  profileReadingHeading: "Wie die Assistenz Sie einschätzt",
  profileReadingIntro:
    "Einschätzungen stammen aus dem Gespräch und führen ihre Belege mit; Ihre manuelle Festlegung gilt, bis Sie sie ändern.",
  profileOverrideRejected: "Die Festlegung wurde abgelehnt — der Wert liegt nicht auf der Skala der Dimension.",
  profileIdentityHeading: "Wie Sie angesprochen werden möchten",
  profileIdentityIntro:
    "Ihre eigenen Worte, die die Assistenz zur Anrede nutzt. Beide Angaben sind freiwillig und voneinander " +
    "unabhängig — sie leer zu lassen ist ein normaler Entscheid, und es wird nichts erschlossen oder ergänzt.",
  profileNameLabel: "Name",
  profileFormOfAddressLabel: "Gewünschte Anrede",
  profileTooLong: (p) => `Zu lang — halten Sie jeden Eintrag bei höchstens ${p.max} Zeichen.`,
  profileTooLongNothingSaved: (p) =>
    `Zu lang — halten Sie jeden Eintrag bei höchstens ${p.max} Zeichen. Es wurde nichts gespeichert.`,
  profileSaveFailed: "Konnte nicht gespeichert werden — es wurde nichts abgelegt.",
  profileSaved: "Gespeichert.",
  profileSave: "Speichern",
  profileOverriddenBadge: "von Ihnen festgelegt",
  profileConfidenceBadge: (p) => `Konfidenz · ${p.confidence}`,
  profileNotEstimatedBadge: "noch nicht eingeschätzt",
  profileAssumptionNote:
    "Eine aus unserem Gespräch abgeleitete Annahme — keine feststehende Tatsache. Wählen Sie unten einen Wert, um sie zu überschreiben.",
  profileOverrideSelectLabel: (p) => `${p.dimension} festlegen`,
  profileChooseManually: "auswählen, um manuell festzulegen",
  profileLastRevised: (p) => `zuletzt überarbeitet: ${p.stamp}`,

  overlaySectionsLabel: "Bereiche der Überlagerung",
  overlaySettingsTab: "Einstellungen",
  overlayProfileTab: "Profil",
  overlayCloseLabel: "Schliessen",

  updateFailed: (p) => `Aktualisierung fehlgeschlagen: ${p.message}`,
  updateDismiss: "Schliessen",
  updateDownloading: (p) => `Aktualisierung ${p.version} wird geladen…`,
  updateDownloaded: (p) => `Aktualisierung ${p.version} geladen.`,
  updateRestartAndInstall: "Neu starten und installieren",
  updateLater: "Später",
  updateAvailable: (p) => `Version ${p.version} ist verfügbar.`,
  updateChangelog: "Änderungsprotokoll",
  updateInstallNow: "Jetzt installieren",
  updateSkipVersion: "Diese Version überspringen",

  citationUnknownId: (p) =>
    `Nicht aufgelöster Beleg: kein Korpusdokument „${p.id}“. Diese Referenz konnte nicht geprüft werden.`,
  citationMissingSection: (p) =>
    `Ungeprüfter Beleg: kein Abschnitt angegeben, daher nicht gegen ${p.id} prüfbar. Öffnen Sie das Dokument, um zu ` +
    `sehen, woher dies stammt.`,
  citationUnknownSection: (p) =>
    `Ungeprüfter Beleg: „${p.section}“ entspricht keiner Überschrift in ${p.id}. Öffnen Sie das Dokument, um die Aussage selbst zu prüfen.`,
  citationUnresolvedFlag: "nicht aufgelöst",
  citationUnverifiedFlag: "ungeprüft",
  citationOpenWikiAtom: (p) => `Wiki-Atom ${p.id} öffnen`,
  citationOpenCorpusDocument: (p) => `Korpusdokument ${p.id} öffnen`,
  citationLoading: "Wird geladen…",
  citationNotFound: (p) => `Beleg nicht gefunden: ${p.id}`,
  citationCorpusMeta: (p) => `Korpus ${p.version} · ${p.tags}`,
  citationPathLabel: "Pfad:",
  citationCloseLabel: "Schliessen",

  docChipLabel: (p) => `Anhang: ${p.name} (${p.type})`,

  ingestUnsupportedFormat: (p) => `Nicht unterstütztes Format „${p.ext}“. Unterstützte Formate: ${p.supported}.`,
  ingestLegacyExcelFormat: (p) =>
    `„${p.ext}“ ist ein älteres oder makrofähiges Excel-Format, das diese App nicht liest. Öffnen Sie die ` +
    `Arbeitsmappe in Excel, speichern Sie sie als .xlsx-Arbeitsmappe und versuchen Sie es erneut.`,
  ingestNoExtension: "(keine Dateiendung)",
  ingestUnreadableFile: (p) => `Datei „${p.filename}“ konnte nicht gelesen werden: ${p.detail}`,
  mainExportDialogTitle: "Designdokument exportieren",
  mainExportFilterMarkdown: "Markdown",
  mainExportInsideApp:
    "Dieser Ort liegt innerhalb der Anwendung selbst. Wählen Sie einen Ordner in Ihren eigenen Dateien.",
  mainExportWriteFailed: (p) =>
    `Das Designdokument konnte nicht geschrieben werden (${p.reason}). Es wurde nichts geändert.`,
  mainIngestDialogTitle: "Lehrmaterial in das Wiki einlesen",
  mainIngestFilterMaterial: "Lehrmaterial",
  mainIngestWrongCourse: (p) =>
    `Dieses Einlesen wurde für einen Kurs gestartet, der nicht mehr aktiv ist. Material wird immer nur in den ` +
    `aktiven Kurs eingelesen, aktuell „${p.course}“. Aktivieren Sie den gewünschten Kurs und starten Sie das Einlesen erneut.`,
  mainIngestAlreadyRunning: "Für diesen Kurs läuft bereits ein Einlesevorgang",
  mainIngestEndpointUnreachable: (p) =>
    `Der Modellendpunkt unter ${p.baseURL} ist nicht erreichbar: die Verbindung wurde abgelehnt, oder die Adresse ` +
    `lässt sich nicht auflösen oder routen. Starten Sie ihn und versuchen Sie es erneut.`,
  mainIngestAborted: "Einlesen abgebrochen",
  mainIngestAtomizationFailed: "Atomisierung fehlgeschlagen",
  mainProviderNotConfigured: "LLM-Anbieter nicht konfiguriert",
  mainNoOpenConversation: "Für den aktiven Kurs ist kein Gespräch geöffnet.",
  mainArchiveUnreadable:
    "Das Archiv des bisherigen Gesprächs konnte nicht gelesen werden — es wird ein neues Gespräch gestartet. Die " +
    "Dateien bleiben im Kursordner auf der Festplatte.",
  mainResumeDisabledReason:
    "JSON-Sidecar fehlt oder ist unlesbar — öffnen Sie die .md-Datei in einem Editor, um sie zu prüfen",
  mainTurnInFlightNotice:
    "Der Agent arbeitet noch — warten Sie, bis der Zug abgeschlossen ist (oder stoppen Sie ihn), bevor Sie das Gespräch schliessen oder zurücksetzen.",
  mainResumeUnavailableNotice:
    "Dieses Gespräch konnte nicht geöffnet werden — sein Archiv fehlt oder ist unlesbar. Es wurde nichts geändert; das aktuelle Gespräch bleibt offen.",
  mainResumeWhileOpeningNotice:
    "Für diesen Kurs wird gerade ein Gespräch geöffnet — warten Sie einen Moment und versuchen Sie es erneut.",
  mainPromptBusyNotice:
    "Der Agent verarbeitet bereits eine Anfrage — warten Sie, bis der aktuelle Zug fertig ist, und senden Sie erneut.",
  mainExportEmptyNotice: "Es gibt noch nichts zu exportieren — kein Canvas-Artefakt enthält einen Wert.",
  mainFreshStartFailedNotice:
    "Die neue Sitzung konnte nicht gestartet werden. Ihr bisheriges Gespräch ist im Kursordner sicher gespeichert — es geht nichts verloren. Versuchen Sie erneut, die neue Sitzung zu starten.",
  mainCourseDeleteInFlightNotice:
    "Der Agent arbeitet noch in diesem Kurs — warten Sie, bis der Zug abgeschlossen ist (oder stoppen Sie ihn), bevor Sie den Kurs löschen.",
  mainCourseDeleteIngestingNotice:
    "In das Wiki dieses Kurses wird noch Material eingelesen — dieser Durchlauf endet von selbst; warten Sie ihn ab (oder brechen Sie das Einlesen ab), bevor Sie den Kurs löschen.",
  mainCourseDeleteOpeningNotice:
    "Das Gespräch dieses Kurses wird gerade geöffnet — das dauert einen Moment; versuchen Sie das Löschen erneut, sobald es offen ist.",
  mainCourseDeleteUnreadableNotice:
    "Der Ordner dieses Kurses liegt noch auf der Festplatte, seine course.md konnte aber nicht gelesen werden — es wurde nichts in den Papierkorb verschoben und nichts geändert. Öffnen Sie den Kursordner, prüfen Sie course.md und versuchen Sie es erneut.",
  mainIngestFileDialogTitle: "Material einlesen",
  chatCompactionFailedText:
    "Die Kontext-Zusammenfassung ist fehlgeschlagen. Ihr Gespräch bleibt unverändert — Sie können weiterarbeiten.",
  chatCompactionFailedHint:
    "Wenn das wiederholt auftritt, ist das konfigurierte Kontextfenster womöglich zu klein (Einstellungen → Kontextlänge).",
  toolExecutionFailed: "Tool-Ausführung fehlgeschlagen",
  ringExplanationPending:
    "Dieses Gespräch wird automatisch zusammengefasst, um Platz zu schaffen. Der neue Wert folgt in Kürze.",
  ringExplanationFresh: "Gesprächslänge: noch nicht gemessen. Die erste Messung kommt mit der ersten Antwort.",
  ringExplanationCarried:
    "Dieses Gespräch trägt Kontext mit, der sich derzeit nicht messen lässt. Der Wert kommt mit der nächsten Antwort zurück.",
  ringExplanationWindowUnknown: (p) =>
    `Gesprächslänge: ${p.used} Tokens. Wie gross das Kontextfenster des Modells ist, wurde nicht festgehalten — ` +
    `daher wird kein Anteil angezeigt. Sie können es in den Einstellungen unter „Modell“ hinter „Erweitert“ ` +
    `eintragen; die Modell-Pille rechts führt dorthin.`,
  ringExplanationMeasured: (p) =>
    `Gesprächslänge: ${p.percent} % des Kontextfensters — ${p.used} von ${p.window} Tokens.`,
  ringExplanationNearFull:
    "Dieses Gespräch wird in Kürze automatisch zusammengefasst, um Platz zu schaffen — das ist normal und kein " +
    "Problem. Ihre Arbeit im CBE Process Canvas, die festgehaltenen Entscheidungen, der Fortschritt über die " +
    "Design-Schritte und die CBE-Maturity-Einschätzung bleiben alle erhalten.",
  ringLabelPending: "Gesprächslänge: wird zusammengefasst",
  ringLabelFresh: "Gesprächslänge: noch nicht gemessen",
  ringLabelCarried: "Gesprächslänge: mitgeführter Kontext, noch nicht gemessen",
  ringLabelWindowUnknown: "Gesprächslänge: kein Kontextfenster festgehalten",
  ringLabelMeasured: (p) => `Gesprächslänge: ${p.percent} %`,
  toolDetailFullRaster: "gesamtes Raster",
  toolDetailUnassessed: "nicht eingeschätzt",
  toolDetailStep: (p) => `Schritt ${p.step}`,
  exportMaturityDerivation: (p) =>
    `abgeleitet aus ${p.contributing} von ${p.total} eingeschätzten Kriterien, Mittelwert ${p.mean}`,
  exportMaturityDerivationCapped: (p) => `${p.base}; begrenzt durch den offenen Befund zu ${p.criterion}`,
  uiRefActiveCourseName: "Name des aktiven Kurses",
  uiRefArtefactNotes: "Artefakt-Notizen und ↻ Iterieren",
  uiRefDeleteArtefact: "Artefakt löschen",
  uiRefContextRing: "Kontext-Ring",
  uiRefModelPill: "Modell-Pille",
  uiRefSendStop: "Senden / Stoppen",
  uiRefCourseList: "Kursliste",
  uiRefCourseDetail: "Kursdetails",
  headerHelpLabel: "Hilfe",
  headerHelpStartingReason: "Das Gespräch startet noch — Hilfe ist gleich verfügbar.",
};
