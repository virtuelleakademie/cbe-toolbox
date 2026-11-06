/**
 * The Italian chrome-string catalogue (capability `desktop-app`, Requirement:
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
 * are proper names and are never translated. The retired "Artefacts" label is
 * not reintroduced here under any framing.
 *
 * Where the English entry is the PIONEER framework's own validated wording
 * (`methodology-007` §4.4 Table 1), the Italian entry is this app's rendering of
 * it for an Italian-reading lecturer, not a second normative source: the stable
 * identity of a criterion is its key, and the model-facing Discuss token carries
 * the reference-language label.
 *
 * Addressed formally (the "Lei" courtesy form), which is what a lecturer-facing
 * tool at this institution uses.
 *
 * **Two conventions this file follows deliberately.**
 *
 * - **Quotation marks are the Italian caporali `«…»`, set tight** (no inner
 *   space) — what the German catalogue's `„…“` corresponds to. The straight
 *   apostrophe `'` is used throughout, as the English catalogue already does.
 * - **An Italian plural is NEVER a suffix append**, so no count entry is written
 *   as stem + letter: `nota`/`note`, `atomo`/`atomi`, `turno`/`turni`,
 *   `modifica`/`modifiche` all change the final vowel (and `-ca` gains an `h`).
 *   Both forms are therefore written out in full, which is also what keeps the
 *   English catalogue's `(s)` shorthand out of this file — Italian has no such
 *   form, and `documento(i)` is not a word.
 */
import type { ChromeCatalogue } from "./types.js";

export const it: ChromeCatalogue = {
  languageNameEn: "English",
  languageNameDe: "Deutsch",
  languageNameFr: "Français",
  languageNameIt: "Italiano",

  appHydrationPaneLabel: "Apertura della conversazione",
  appHydrationTitle: "La sua conversazione si sta aprendo…",
  appHydrationSub: "Al primo avvio viene installato l'ambiente di esecuzione dell'agente — possono servire 1-2 minuti.",
  appHydrationErrorLabel: "Non è stato possibile aprire la conversazione",
  appHydrationErrorTitle: "Impossibile aprire la conversazione",
  appHydrationUnknownError: "Errore sconosciuto",
  appRetry: "Riprova",
  appDismissError: "Chiudi il messaggio di errore",
  appDismissNotice: "Chiudi l'avviso",

  menuApplication: "CBE Toolbox",
  menuFile: "File",
  menuEdit: "Modifica",
  menuView: "Vista",
  menuWindow: "Finestra",
  menuHelp: "Aiuto",
  menuAbout: "Informazioni su CBE Toolbox",
  menuSettings: "Impostazioni…",
  menuQuit: "Esci da CBE Toolbox",
  menuExit: "Esci",
  menuCloseWindow: "Chiudi finestra",
  menuUndo: "Annulla",
  menuRedo: "Ripristina",
  menuCut: "Taglia",
  menuCopy: "Copia",
  menuPaste: "Incolla",
  menuSelectAll: "Seleziona tutto",
  menuZoomIn: "Ingrandisci",
  menuZoomOut: "Riduci",
  menuResetZoom: "Dimensioni reali",
  menuToggleFullScreen: "Attiva/disattiva schermo intero",
  menuReload: "Ricarica",
  menuToggleDeveloperTools: "Attiva/disattiva strumenti di sviluppo",
  menuMinimize: "Riduci a icona",
  menuBringAllToFront: "Porta tutto in primo piano",
  menuCbeHelp: "Aiuto CBE Toolbox",
  menuPioneerWebsite: "Sito di PIONEER Alliance",
  menuWorkspaceUnavailable: "L'area di lavoro non è ancora pronta.",
  menuModalUnavailable: "Chiuda prima la finestra di dialogo aperta.",

  headerLabel: "Intestazione dell'applicazione",
  headerAppName: "CBE Toolbox",
  headerNoActiveCourse: "nessun corso attivo",
  headerShowCoursesLabel: (p) => `Mostra i corsi — corso attivo: ${p.course}`,
  headerShowCoursesTitle: "Mostra i corsi",
  headerOpenSettings: "Apri le impostazioni",
  headerOpenSettingsUnsaved: "Apri le impostazioni — modifiche non salvate",
  headerSettingsTitle: "Impostazioni",
  headerSettingsTitleUnsaved: "Impostazioni — modifiche non salvate",
  headerOpenProfile: "Apri il profilo",
  headerProfileTitle: "Profilo",
  headerLanguageLabel: "Lingua dell'interfaccia",
  headerLanguageAccessibleName: (p) => `Lingua dell'interfaccia: ${p.language} (${p.code})`,
  headerLanguageBusy: "Cambio della lingua dell'interfaccia…",
  headerLanguageFailure: "Non è stato possibile cambiare la lingua dell'interfaccia. Riprovi.",

  chatConversationLabel: "Conversazione",
  // ───────────────────────── Primo utilizzo ────────────────────────────────
  onboardingHeading: "Benvenuti in CBE Toolbox",
  onboardingValue: (p) =>
    `Un ${p.course} è l’unità di lavoro: sviluppi o adatti un modulo CBE e ne esamini la coerenza nella conversazione. Lei porta la conoscenza del modulo e prende le decisioni; l’assistente non consegna un modulo finito.`,
  onboardingCourseNavigation: (p) =>
    `L’intestazione indica il ${p.course} attivo. Crei e cambi corso nell’elenco a sinistra; rinomini o elimini un corso nei suoi dettagli.`,
  onboardingCourseChats: (p) =>
    `I dettagli contengono anche le sue ${p.chats}, le conversazioni salvate del corso, e il suo ${p.wiki}; aprire i dettagli non cambia il corso attivo.`,
  onboardingWikiReuse: (p) =>
    `Importi materiale didattico locale attraverso il ${p.wiki} del corso attivo per creare voci di conoscenza tematiche, riutilizzabili e consultabili.`,
  onboardingWikiGrounding: "L’assistente può leggere e citare queste voci per fondare il lavoro sul suo materiale.",
  onboardingAttachmentDistinction: "Un allegato alla chat alimenta invece questa conversazione e non popola il Wiki.",
  onboardingDesign:
    "Lavori con l’assistente nella conversazione. A destra, CBE Process Canvas registra le dieci fasi del corso attivo; CBE Maturity valuta ciò che è registrato, senza certificazione.",
  onboardingNextAction:
    "Descriva il modulo e ciò su cui vuole lavorare, oppure porti una domanda o del materiale esistente. Un allegato o un’importazione nel Wiki è facoltativo.",
  onboardingHelpAndReread: (p) =>
    `Usi il punto interrogativo nell’intestazione per l’aiuto conversazionale; rilegga questa panoramica nel gruppo ${p.about} della finestra delle impostazioni.`,
  onboardingBegin: "Inizia",
  onboardingSkip: "Salta",
  onboardingClose: "Chiudi panoramica",
  onboardingReread: "Rileggi la panoramica iniziale",
  onboardingAvailability: "Una panoramica iniziale è disponibile sopra la conversazione.",
  onboardingReadFailure:
    "Non è stato possibile leggere la preferenza iniziale. La panoramica resta disponibile e potrebbe riapparire.",
  onboardingWriteFailure:
    "La panoramica è chiusa per questa sessione dell’app, ma non è stato possibile salvare la preferenza. Potrebbe riapparire dopo il riavvio.",
  chatRoleAssistant: "Skill CBE",
  chatRoleLecturer: "Docente",
  chatNewSessionLockedReason: "L'agente sta ancora lavorando — attenda prima la fine del turno.",
  chatComposerLockedReason: "L'agente sta ancora lavorando — attenda prima la fine del turno.",
  chatNewSessionLabel: "Nuova sessione",
  chatNewSessionTitle: "Iniziare una nuova conversazione (il canvas resta; quella attuale resta sul disco)",
  chatNewSessionStarting: "Avvio della nuova sessione…",
  chatNewSessionFailedText:
    "Non è stato possibile avviare la nuova sessione. La conversazione precedente è salvata al sicuro — non va perso nulla.",
  chatNewSessionFailedDetail: "La ritrova in qualsiasi momento sotto Corsi.",
  chatNewSessionConfirmLabel: "Conferma la nuova sessione",
  chatNewSessionConfirmText:
    "Iniziare una nuova sessione? Le sue voci nel CBE Process Canvas e in CBE Maturity vengono mantenute. Può riprendere questa conversazione in qualsiasi momento da Corsi.",
  chatNewSessionConfirmAction: "Avvia una nuova sessione",
  chatCancel: "Annulla",
  chatIngestFormatsHint: (p) => `Leggere nella chat materiale esistente (${p.formats})`,
  chatPlusMenuLabel: "Altre azioni",
  chatUploadEntryLabel: "Carica file",
  chatHelpEntryLabel: "Aiuto",
  chatComposerFieldLabel: "Messaggio",
  chatSendLabel: "Invia",
  chatSendTitle: "Invia (Invio)",
  chatStopLabel: "Ferma la risposta",
  chatStopPendingLabel: "Arresto della risposta…",
  chatStopCompactionReason: "Il contesto viene riassunto — l'operazione arriva fino in fondo e non può essere fermata.",
  chatStoppedTurnMarker: "Ha fermato questa risposta — è incompleta.",
  chatStoppedTurnPlaceholder: "Ha fermato questa risposta prima che iniziasse.",
  chatStopTimedOutNoticeText:
    "L'arresto sta durando più del previsto — l'assistenza non ha ancora rilasciato questo turno. " +
    "Il campo del messaggio resta bloccato fino ad allora, così nulla di ciò che invia può entrare in conflitto.",
  chatStopTimedOutRecoveryLabel: "Chiudi forzatamente questa conversazione",
  chatStopTimedOutRecoveryConfirm:
    "La chiusura forzata termina questa conversazione senza attendere l'assistenza e ne avvia una nuova. " +
    "Il suo lavoro resta — la progettazione del modulo nel CBE Process Canvas, le decisioni registrate, " +
    "l'avanzamento nei passi di progettazione e la valutazione CBE Maturity — e la conversazione viene archiviata sul disco.",
  chatForceCloseBusy: "Chiusura…",
  chatForceCloseAction: "Chiudi forzatamente e ricomincia",
  chatForceCloseFailed:
    "Non è stato possibile chiudere forzatamente la conversazione. Il suo lavoro è salvato al sicuro nella cartella del corso — riprovi.",
  chatModelPillBlankLabel: "Nessun modello configurato",
  chatModelPillPurpose: "Aprire le impostazioni del modello (Impostazioni, gruppo «Modello»)",
  chatModelPillAccessibleName: (p) => `${p.purpose} — modello: ${p.modelId}`,
  chatPendingAttachmentsLabel: "Documenti allegati",
  chatRemoveAttachmentLabel: (p) => `Rimuovi ${p.filename}`,
  chatNoTextExtractedProblem: (p) =>
    `«${p.filename}»: nessun testo estratto — un PDF scansionato o un documento vuoto?`,
  chatReasoningEnabledNotice: "Ragionamento attivato — invii di nuovo il messaggio, ora con reasoning_effort.",
  chatReasoningSwapFailed: (p) =>
    `Non è stato possibile attivare il ragionamento nella sessione in corso (${p.error}). La chat resta invariata.`,
  chatReasoningOffer:
    "Il modello ha risposto senza chiamare alcuno strumento — tipico di un modello ibrido con ragionamento " +
    "eseguito senza reasoning_effort. Attivare il ragionamento e riprovare?",
  chatEnablingReasoning: "Attivazione…",
  chatEnableReasoning: "Attiva il ragionamento",
  chatDismissReasoningSuggestion: "Chiudi il suggerimento sul ragionamento",
  chatNotNow: "Non ora",
  chatDismissNotice: "Chiudi l'avviso",
  chatHelpAnnouncement: "Richiesta di aiuto inviata all'assistenza.",
  chatHelpDisplayText: "Aiuto richiesto",
  chatContinueLabel: "Continua",
  chatContinueTitle: "Lasciare che il modello completi la risposta interrotta",
  chatRetryLabel: "Riprova",
  chatRetryTitle: "Chiedere al modello di rispondere di nuovo per intero alla richiesta precedente",
  chatJumpToLatestLabel: "Vai al messaggio più recente",
  chatJumpToLatestText: "Al più recente",
  chatWorkingDisclosureLabel: "Elaborazione…",
  chatWorkingDetailLabel: "Attività tecnica in corso",
  chatWorkingDetailEmpty: "In attesa della prossima attività…",
  chatWorkingToolActivityLabel: (p) => `Attività dello strumento: ${p.action} (${p.status})`,
  chatInteractionUnavailable: "Questa domanda non è disponibile. Continui nel campo del messaggio.",
  chatThinkingHeadLive: "sta pensando…",
  chatThinkingHeadDone: "ragionamento",
  chatThinkingEmptyBody: "…",
  chatSlashCommandsLabel: "Comandi slash",

  errorRunLockedReason: "L'agente sta ancora lavorando — attenda la fine del turno.",
  errorBusyNoticeText: "L'assistenza sta ancora lavorando — riprovi quando avrà finito.",
  errorAuthBillingText:
    "Il fornitore del modello ha rifiutato la richiesta — segnala credito mancante o una chiave API non valida. " +
    "Verifichi il suo account presso il fornitore o la connessione LLM nelle impostazioni, poi invii di nuovo il messaggio.",
  errorGenericProviderText:
    "Il fornitore del modello non ha potuto completare la richiesta. La conversazione resta invariata — " +
    "riprovi; il dettaglio completo dell'errore è nel registro della sessione.",
  errorLoopAbortNote:
    "Ho chiamato ripetutamente lo stesso strumento senza fare progressi e mi sono fermato per evitare un ciclo. " +
    "La prego di riformulare o di riprovare.",

  canvasIterateLabel: "↻ Itera",
  canvasNoAnnotationsLabel: "nessuna nota",
  canvasAnnotationCountLabel: (p) => `${p.count} ${p.count === 1 ? "nota" : "note"}`,
  canvasRemoveAnnotationLabel: "Rimuovi la nota",
  canvasAnnotationInputPlaceholder: "Nota su questo artefatto…",
  canvasAnnotationAddLabel: "Aggiungi",
  canvasAnnotateToggleLabel: "+ Nota",
  canvasExportLabel: "Esporta",
  canvasExportBusy: "Esportazione…",
  canvasExportTitle: "Esportare in un file il documento di progettazione di questo corso dal CBE Process Canvas",
  canvasExportNoSession: "Non è ancora aperta alcuna conversazione.",
  canvasExportNothing:
    "Per ora non c'è nulla da esportare — nessun artefatto del CBE Process Canvas contiene un valore.",
  canvasExportDone: (p) => `Salvato in ${p.path}`,
  canvasDeleteArtefactLabel: (p) => `Elimina ${p.label}`,
  canvasDeleteArtefactTitle: "Eliminare questo artefatto",
  canvasDeleteConfirmLabel: (p) => `Eliminare ${p.label}?`,
  canvasDeleteConfirmText: (p) =>
    `Eliminare «${p.label}»? Il suo contenuto viene rimosso dal CBE Process Canvas; nella cronologia della conversazione resta.`,
  canvasDeleteAction: "Elimina",
  canvasEmptyValue: "—",
  canvasFocusMarkerLabel: "in primo piano",
  canvasFocusMarkerText: "focus",
  canvasStepFocusLabel: (p) => `Mettere a fuoco il passo ${p.step}: ${p.name}`,
  canvasStepFocusTitle: "Mettere a fuoco questo passo",

  canvasStep1Name: "Definire il quadro",
  canvasStep2Name: "Risultati di apprendimento",
  canvasStep3Name: "Valutazione delle competenze",
  canvasStep4Name: "Challenge",
  canvasStep5Name: "Stakeholder",
  canvasStep6Name: "Percorso di apprendimento",
  canvasStep7Name: "Attività",
  canvasStep8Name: "Risultati attesi",
  canvasStep9Name: "Controllo di allineamento",
  canvasStep10Name: "Preparazione",

  canvasJourneyEngage: "Engage",
  canvasJourneyInvestigate: "Investigate",
  canvasJourneyAct: "Act / Prototype",
  canvasJourneyReflect: "Reflect and present",

  canvasArtefactModuleframe: "Metadati del modulo / vincoli",
  canvasArtefactLearningoutcomes: "Risultati di apprendimento",
  canvasArtefactAssessmentblueprint: "Struttura della valutazione",
  canvasArtefactBigidea: "Big Idea",
  canvasArtefactEq: "Essential Question",
  canvasArtefactChallenge: "Challenge Statement",
  canvasArtefactStakeholderplan: "Piano degli stakeholder e del loro coinvolgimento",
  canvasArtefactEs: "Sequenza Engage",
  canvasArtefactIs: "Sequenza Investigate",
  canvasArtefactAs: "Sequenza Act",
  canvasArtefactRs: "Sequenza Reflect",
  canvasArtefactActivityplan: "Piano delle attività di apprendimento",
  canvasArtefactDeliverablesmap: "Panoramica dei risultati attesi",
  canvasArtefactAlignmentmatrix: "Matrice di allineamento + correzioni",
  canvasArtefactReadinesschecklist: "Lista di controllo: svolgimento e preparazione",

  canvasStateDone: "concluso",
  canvasStateActive: "attivo",
  canvasStateDraft: "bozza",
  canvasStateOpen: "aperto",
  canvasDepthOpen: "aperto",
  canvasDepthRough: "grezzo",
  canvasDepthRefined: "rifinito",
  canvasDepthDetailed: "dettagliato",

  exportDocumentTitle: (p) => `${p.course} — Progettazione del modulo CBE`,
  exportGeneratedAt: (p) => `_Esportato ${p.stamp} dallo stato registrato del canvas._`,
  exportCourseContextHeading: "Contesto del corso",
  exportStepHeading: (p) => `Passo ${p.step} — ${p.name}`,
  exportCoverage: (p) => `_Copertura: ${p.depth}_`,
  exportOpenArtefact: "_(aperto — non ancora deciso)_",
  exportStoppedTurnNote: "_(fermata da lei — questa risposta è incompleta)_",
  exportMaturityHeading: "CBE Maturity",
  exportMaturityColumnCriterion: "Criterio",
  exportMaturityColumnCurrent: "Attuale",
  exportMaturityColumnTarget: "Obiettivo",
  exportMaturityUnassessed: "non valutato",
  exportMaturityLimitation: (p) => `**Limite:** ${p.note}`,

  decisionsHeading: "Decisioni",
  decisionsResetBadge: "azzerato · obiettivo sovraordinato rivisto",
  decisionsModuleGoals: "Obiettivi del modulo",
  decisionsNoGoals: "Ancora nessun obiettivo operativo.",
  decisionsAlignmentStatus: "Stato dell'allineamento",
  decisionsAlignmentReset: "Azzerato — da riverificare rispetto all'obiettivo rivisto.",
  decisionsNoAlignment: "Ancora nessun riscontro di allineamento.",
  decisionsDelegation: "Decisioni di delega",
  decisionsDelegationReset: "Azzerato — da riverificare rispetto all'obiettivo o all'allineamento rivisto.",
  decisionsNoDelegation: "Ancora nessuna decisione di delega.",
  decisionsHeterogeneity: "Note sull'eterogeneità",
  decisionsSoftSkill: "Ancoraggi delle competenze trasversali",
  decisionsMissingAnchor: "ancoraggio mancante",
  decisionsWarningLabel: "Avvertenza",
  decisionsEmptyValue: "—",
  decisionsEmpty:
    "In questa conversazione non è ancora stata registrata alcuna decisione. Questa sezione si riempie man mano " +
    "che i controlli didattici vengono svolti con l'assistenza.",

  pickerGroupLabel: "Selezione",
  pickerRequiredLabel: "obbligatorio",
  pickerAnsweredLabel: "risposto",
  pickerAnsweredBadge: "RISPOSTO",
  pickerSubmitLabel: "Conferma",
  pickerOtherLabelFallback: "Altro — lo descrivo io",
  checklistGroupLabel: "Lista di controllo delle decisioni",
  checklistAnsweredLabel: "risposto",
  checklistAnsweredBadge: "RISPOSTO",
  checklistSubmitLabel: "Applica",

  toolFallbackLabel: "Sta lavorando…",
  toolReadLabel: "Legge la fonte",
  toolWriteLabel: "Scrive il file",
  toolEditLabel: "Modifica il file",
  toolGrepLabel: "Cerca nel corpus",
  toolFindLabel: "Cerca file",
  toolLsLabel: "Elenca la cartella",
  toolPickerLabel: "Pone una domanda",
  toolChecklistLabel: "Mostra la lista di controllo",
  toolCiteLabel: "Cita una fonte",
  toolCanvasLabel: "Aggiorna il canvas",
  toolProfileLabel: "Aggiorna il profilo",
  toolStepLabel: "Aggiorna il passo",
  toolMaturityLabel: "Aggiorna la maturità",
  toolWikiLabel: "Legge il wiki",
  toolSupportLabel: "Salva la preferenza di supporto",
  toolStatusRunning: "in corso",
  toolStatusDone: "completato",
  toolStatusError: "errore",
  toolProfileAssumptionNote:
    "Un'ipotesi dedotta dalla nostra conversazione — non un dato certo. Può sostituirla nel pannello Profilo.",
  toolPickerCallFailed: "La chiamata dello strumento di selezione non è riuscita",
  toolChecklistCallFailed: "La chiamata dello strumento lista di controllo non è riuscita",
  toolPickerSpecRejected: (p) => `Specifica di selezione rifiutata: ${p.detail}`,
  toolChecklistSpecRejected: (p) => `Specifica della lista di controllo rifiutata: ${p.detail}`,
  toolSpecDetailArgsMissing: "args manca o non è un oggetto",
  toolSpecDetailQuestionMissing: "question manca o è vuoto",
  toolSpecDetailOptionsMissing: "options manca o non è un array",
  toolSpecDetailOptionsTooFew: (p) => `options deve contenere almeno 2 voci (ricevute: ${p.count})`,
  toolSpecDetailOptionNotObject: (p) => `options[${p.index}] non è un oggetto`,
  toolSpecDetailOptionIdEmpty: (p) => `options[${p.index}].id è vuoto`,
  toolSpecDetailOptionLabelEmpty: (p) => `options[${p.index}].label è vuoto`,
  toolSpecDetailPresentationInvalid: "presentation deve valere 'checklist' oppure 'progress-bar'",
  toolSpecDetailItemsMissing: "items manca o non è un array",
  toolSpecDetailItemsTooFew: (p) => `items deve contenere almeno 2 voci (ricevute: ${p.count})`,
  toolSpecDetailItemNotObject: (p) => `items[${p.index}] non è un oggetto`,
  toolSpecDetailItemIdEmpty: (p) => `items[${p.index}].id è vuoto`,
  toolSpecDetailItemLabelEmpty: (p) => `items[${p.index}].label è vuoto`,

  maturityCriterionSocietalChallenge: "Challenge sociale (reale)",
  maturityCriterionStakeholderInvolvement: "Coinvolgimento degli stakeholder",
  maturityCriterionInterdisciplinarity: "Inter-/transdisciplinare",
  maturityCriterionStudentAgency: "Autonomia degli studenti e ruolo del corpo docente",
  maturityCriterionIterativeProcess: "Processo di apprendimento iterativo",
  maturityCriterionValueReflection: "Orientamento ai valori, riflessione",
  maturityCriterionSocietalImpact: "Impatto sociale e trasferibilità",

  maturityLevelShort1: "L1 — CBE light",
  maturityLevelShort2: "L2 — good practice",
  maturityLevelShort3: "L3 — full-fledged",
  maturityLevelFull1: "Livello 1 «CBE light / challenge-inspired»",
  maturityLevelFull2: "Livello 2 «CBE good practice / challenge-oriented»",
  maturityLevelFull3: "Livello 3 «full-fledged CBE / transformative»",

  maturityGlossSocietalChallenge1: "Si fa riferimento a un tema reale, ma la challenge è predefinita e chiusa.",
  maturityGlossSocietalChallenge2:
    "Gli studenti lavorano su una challenge aperta, radicata in una questione sociale o regionale reale.",
  maturityGlossSocietalChallenge3:
    "La challenge proviene da uno stakeholder reale, è davvero aperta e mira a un valore sociale che va oltre il corso.",
  maturityGlossStakeholderInvolvement1: "Gli stakeholder intervengono come relatori ospiti o come fornitori di casi.",
  maturityGlossStakeholderInvolvement2:
    "Gli stakeholder interagiscono con gli studenti in momenti definiti (p. es. briefing, feedback).",
  maturityGlossStakeholderInvolvement3:
    "Gli stakeholder agiscono come titolari della challenge o co-creatori lungo tutto il processo di apprendimento.",
  maturityGlossInterdisciplinarity1:
    "Gli studenti sono incoraggiati a considerare altre prospettive, ma senza integrazione strutturale.",
  maturityGlossInterdisciplinarity2: "Più discipline o ambiti di sapere sono integrati in modo esplicito.",
  maturityGlossInterdisciplinarity3:
    "Il sapere accademico e quello non accademico vengono co-prodotti in modo transdisciplinare e sono radicati nella struttura.",
  maturityGlossStudentAgency1: "Gli studenti hanno scelte limitate entro un quadro predefinito.",
  maturityGlossStudentAgency2:
    "Gli studenti prendono le decisioni chiave; il corpo docente agisce soprattutto come accompagnatore.",
  maturityGlossStudentAgency3:
    "Gli studenti assumono pienamente il processo della challenge; il corpo docente rende possibile, fa da coach e stimola la riflessione.",
  maturityGlossIterativeProcess1: "Alcune attività pratiche, ma poca iterazione o poco feedback.",
  maturityGlossIterativeProcess2: "Fasi di apprendimento strutturate con cicli di feedback e riflessione.",
  maturityGlossIterativeProcess3:
    "Più cicli iterativi di sperimentazione, feedback, riflessione e adattamento sono al centro.",
  maturityGlossValueReflection1:
    "La riflessione orientata ai valori è menzionata, ma non affrontata in modo sistematico.",
  maturityGlossValueReflection2:
    "Gli studenti riflettono sulle implicazioni etiche e sull'impatto sociale delle loro soluzioni.",
  maturityGlossValueReflection3:
    "La riflessione etica e la ponderazione dei valori sono radicate lungo tutto il processo della challenge.",
  maturityGlossSocietalImpact1: "La possibile rilevanza sociale viene discussa, ma non messa in pratica.",
  maturityGlossSocietalImpact2: "I risultati vengono condivisi con gli stakeholder o con le comunità interessate.",
  maturityGlossSocietalImpact3:
    "I risultati contribuiscono, oltre il corso, a un cambiamento reale, a decisioni o ad attività successive.",

  maturityTargetUnsettled:
    "L'ambizione complessiva della progettazione va ancora chiarita con la docente o il docente.",
  maturityAchievedNotDue: "La valutazione di quanto raggiunto non è ancora dovuta: nessun criterio è stato valutato.",
  maturityDiscussDisplay: (p) => `Discutere la maturità: ${p.label}`,
  maturityAssessDisplay: "Valutare la maturità della progettazione",
  maturityAssessLabel: "Valuta la maturità",
  maturityAssessTitle:
    "Chiedere all'assistenza di valutare la maturità della progettazione per il pannello CBE Maturity",
  maturityAssessLockedReason: (p) => `${p.runLocked} La valutazione CBE Maturity può iniziare solo dopo.`,
  maturityAssessNoSession:
    "Non è ancora aperta alcuna conversazione — la valutazione CBE Maturity si svolge all'interno di una conversazione.",
  maturityPanelIntroEmpty:
    "La valutazione della maturità mostra dove si colloca attualmente la progettazione del suo modulo sul " +
    "continuum PIONEER — tre livelli (CBE light, good practice, full-fledged) letti attraverso sette criteri — e " +
    "quale livello obiettivo sta perseguendo. Viene stabilita presto a partire dal suo materiale e dalla sua " +
    "conversazione con l'assistenza, e appartiene poi a questo corso — resta con il corso anche quando avvia una " +
    "nuova sessione. Per questo corso non è ancora stato valutato nulla.",
  maturityPanelIntroRaster:
    "Come l'assistenza legge attualmente la maturità CBE di questa progettazione. I livelli sono letti dal suo " +
    "materiale e da questa conversazione — sono ipotesi di lavoro, non un verdetto; usi «Discuti nella chat» su un " +
    "criterio per correggerli o svilupparli.",
  maturityPanelIntroNoRaster:
    "Come l'assistenza legge attualmente la maturità CBE di questa progettazione. I sette criteri vengono letti dal " +
    "suo materiale e da questa conversazione non appena la progettazione ha sostanza sufficiente per confrontarli.",
  maturityThinClosingEmpty: "Può comunque chiedere una valutazione — sarà contrassegnata come provvisoria.",
  maturityThinClosingPopulated:
    "Fino ad allora la valutazione resta ristretta — «Valuta la maturità» la aggiorna rispetto a quanto è sul tavolo.",
  maturityThinHeading: "Base di evidenze finora esile:",
  maturityThinNoMaterial: "ancora nessun materiale acquisito",
  maturityThinDocuments: (p) => `${p.count} ${p.count === 1 ? "documento acquisito" : "documenti acquisiti"}`,
  maturityThinArtefacts: (p) =>
    `${p.count} ${p.count === 1 ? "artefatto di progettazione registrato" : "artefatti di progettazione registrati"}`,
  maturityThinSteps: (p) =>
    `${p.count} ${p.count === 1 ? "passo di progettazione affrontato" : "passi di progettazione affrontati"}`,
  maturityThinGap: (p) =>
    `${p.have}. Portare materiale, oppure chiarire decisioni su un secondo passo di progettazione, dà una valutazione più solida.`,
  maturityUnknownProvenance:
    "Questa valutazione è stata registrata prima in questo corso. La sua base di evidenze non è più ricostruibile " +
    "qui, quindi non si afferma nulla su quanto sia fondata o attuale. Usi «Valuta la maturità» qui sotto per una " +
    "valutazione della progettazione così come si presenta oggi.",
  maturityStaleHeading: "Non più attuale:",
  maturityStaleBody: (p) =>
    `la progettazione è cambiata dopo questa valutazione — ${p.changes}${p.more}. I livelli qui sotto sono l'ultimo ` +
    `stato registrato. Usi «Valuta la maturità» qui sotto per aggiornarli.`,
  maturityStaleMore: (p) => ` (+${p.omitted} ${p.omitted === 1 ? "altra modifica" : "altre modifiche"})`,
  maturityStaleChangeIngestion: (p) => `materiale acquisito${p.label ? `: «${p.label}»` : ""}`,
  maturityStaleChangeStepDepth: (p) => `il passo di progettazione ${p.step ?? "?"} ha raggiunto una nuova profondità`,
  maturityStaleChangeArtefactSet: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `passo ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefatto modificato${p.label ? `: «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactCleared: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `passo ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefatto svuotato${p.label ? `: «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactDeleted: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `passo ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefatto eliminato${p.label ? `: «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityProvisionalHeading: "Provvisoria:",
  maturityProvisionalBody:
    "questa valutazione è nata quando c'era poco a disposizione e poggia quindi su una base di evidenze esile.",
  maturityProvisionalSufficient:
    "Nel frattempo è stato chiarito di più — usi «Valuta la maturità» qui sotto per una valutazione della progettazione così come si presenta oggi.",
  maturityTargetExceeded: "obiettivo superato",
  maturityTargetReached: "obiettivo raggiunto",
  maturityTargetLevel: (p) => `obiettivo L${p.level}`,
  maturityNotYetAssessed: "non ancora valutato",
  maturityCurrentPrefix: (p) => `attuale ${p.level}`,
  maturityUncertainRow: "incerto, evidenze deboli",
  maturityUncertainBadge: "incerto · evidenze deboli",
  maturityCappedRow: "un riscontro aperto limita questo criterio",
  maturityCappedBadge: "riscontro aperto · limita questo criterio",
  maturityDiscussLabel: "Discuti nella chat",
  maturityDiscussAccessibleName: (p) => `Discutere la maturità: ${p.label}`,
  maturityDiscussTitle: "Discutere questo criterio nella chat",
  maturityHeaderTargetLabel: "Maturità obiettivo",
  maturityHeaderAchievedLabel: "Totale raggiunto · derivato",
  maturityHeaderTargetAccessible: (p) => `Maturità obiettivo dichiarata: ${p.value}`,
  maturityHeaderAchievedAccessible: (p) =>
    `Valutazione complessiva derivata di quanto raggiunto: ${p.value}, ${p.derivation}${p.note}`,
  maturityHeaderNotDueAccessible: (p) => `Valutazione complessiva di quanto raggiunto: ${p.value}${p.note}`,
  maturityRecordedLimitation: (p) => `. Limite registrato: ${p.note}`,
  maturityDerivation: (p) => `derivato da ${p.contributing} criteri valutati su ${p.total} · media ${p.mean}`,
  maturityDerivationCapped: (p) => `${p.base} · limitato a ${p.level} dal riscontro aperto su ${p.criterion}`,

  panelLeftLabel: "Pannello di sinistra",
  panelRightLabel: "Pannello di destra",
  panelRightTabsLabel: "Schede del pannello di destra",
  panelCanvasTab: "CBE Process Canvas",
  panelMaturityTab: "CBE Maturity",
  panelCoursesTitle: "Corsi",
  panelExpandLeft: "Espandi il pannello di sinistra",
  panelCollapseLeft: "Riduci il pannello di sinistra",
  panelExpandRight: "Espandi il pannello di destra",
  panelCollapseRight: "Riduci il pannello di destra",
  panelOpenCourses: "Apri i corsi",
  panelOpenCoursesWithNote: (p) => `Apri i corsi (${p.note})`,
  panelCoursesTitleWithNote: (p) => `Corsi — ${p.note}`,
  panelAgentRunningElsewhere: "L'agente sta lavorando in un altro corso",
  panelRunFinishedElsewhere: "Un'esecuzione in un altro corso è terminata",
  panelIngestRunning: (p) => `Acquisizione nel wiki in corso (${p.settled} di ${p.total} documenti)`,
  panelOpenTab: (p) => `Apri ${p.label}`,
  panelOpenTabUnseen: (p) => `Apri ${p.label} (modifiche non viste)`,
  panelTabUnseenTitle: (p) => `${p.label} — modifiche non viste`,
  panelTabUnseenLabel: (p) => `${p.label} (modifiche non viste)`,
  workspaceResizeLeft: "Regola la larghezza del pannello di sinistra",
  workspaceResizeRight: "Regola la larghezza del pannello di destra",

  coursesAgentRunning: "L'agente sta lavorando",
  coursesUnseenResult: "Risultato non visto",
  coursesUnseenResultTitle: "Un'esecuzione in background è terminata — ci passi sopra per vedere il risultato",
  coursesIntro:
    "I suoi corsi. Ogni corso è una cartella autonoma che contiene le sue sessioni, il canvas, il wiki e i materiali.",
  coursesActiveBadge: "attivo",
  coursesDetailsLabel: "Dettagli del corso",
  coursesWikiAtomCount: (p) => `${p.count} ${p.count === 1 ? "atomo" : "atomi"} wiki`,
  coursesNewCourse: "Nuovo corso",
  coursesNewCourseTitlePlaceholder: "Titolo del nuovo corso",
  coursesCreateLabel: "Crea il corso",
  coursesCancelLabel: "Annulla",
  coursesSaveLabel: "Salva",
  coursesRenameLabel: "Rinomina",
  coursesDeleteLabel: "Elimina il corso",
  coursesBack: "← Indietro",
  coursesKicker: "Corso",
  coursesTitleFieldLabel: "Titolo del corso",
  coursesSetActive: "Imposta come attivo",
  coursesConfirmDeletionLabel: "Conferma l'eliminazione del corso",
  coursesDeleteConfirmText: (p) =>
    `Eliminare «${p.title}»? Le sue conversazioni, la progettazione del modulo nel CBE Process Canvas, il suo wiki ` +
    `e i materiali acquisiti se ne vanno con lui. La cartella del corso viene spostata nel cestino del suo sistema, da cui può ripristinarla.`,
  coursesMoveToTrash: "Sposta nel cestino",
  coursesDeletedTrashed: (p) => `Il corso «${p.title}» è stato spostato nel cestino del suo sistema.`,
  coursesDeletedMissing: (p) => `Il corso «${p.title}» non era più sul disco ed è stato rimosso dall'elenco.`,
  coursesContentTabsLabel: "Contenuto del corso",
  coursesTabChats: "Chats",
  coursesTabWiki: "Wiki",
  coursesChatsLockedReason:
    "L'agente sta ancora lavorando — attenda la fine del turno prima di cambiare conversazione.",
  coursesConversationsLabel: "Conversazioni salvate",
  coursesConversationsLoading: "Caricamento delle conversazioni…",
  coursesConversationsEmpty: "Ancora nessuna conversazione salvata.",
  coursesConversationUndated: "Senza data",
  coursesConversationOpenBadge: "aperta",
  coursesConversationNoMessages: "Ancora nessun messaggio",
  coursesConversationResumeTitle: (p) => `Riprendere questa conversazione (${p.sessionId})`,
  coursesConversationTurnCount: (p) => `${p.count} ${p.count === 1 ? "turno" : "turni"}`,
  coursesHydrationInFlightSwitchNotice:
    "La conversazione si sta ancora aprendo — attenda un momento prima di cambiare corso.",

  wikiBack: "← Wiki",
  wikiAtomMeta: (p) => `${p.type} · affidabilità ${p.confidence} · aggiornato ${p.updated}`,
  wikiRelated: "Correlati",
  wikiSearchPlaceholder: "Cerca atomi",
  wikiSearchLabel: "Cerca negli atomi del wiki",
  wikiKnowledgeGraph: "Grafo della conoscenza",
  wikiList: "Elenco",
  wikiInvalidAtoms: (p) =>
    p.count === 1
      ? `${p.count} file sotto wiki/ non ha superato la validazione degli atomi — apra la cartella per correggerlo.`
      : `${p.count} file sotto wiki/ non hanno superato la validazione degli atomi — apra la cartella per correggerli.`,
  wikiEmpty: "Ancora nessun atomo — acquisisca del materiale per costruire il wiki.",
  wikiNoMatches: "Nessun atomo corrisponde alla ricerca.",
  wikiNothingToGraph: "Ancora nessun atomo da rappresentare.",
  wikiGraphLabel: "Grafo della conoscenza degli atomi del wiki",
  wikiOpenAtom: (p) => `Apri l'atomo ${p.title}`,
  wikiAtomRowMeta: (p) => `${p.type} · ${p.updated}`,
  wikiIngestLabel: "Acquisisci materiale",
  wikiIngestInactiveCourse: "Attivi questo corso per avviare qui una nuova acquisizione.",
  wikiIngestAbortLabel: "Interrompi",
  wikiIngestNotice: (p) =>
    `${p.done} ${p.done === 1 ? "documento atomizzato" : "documenti atomizzati"}${p.failed ? `, ${p.failed} ${p.failed === 1 ? "non riuscito" : "non riusciti"}` : ""}.`,
  wikiIngestAbortedNotice: "Acquisizione interrotta.",
  wikiIngestAbortUndeliveredNotice:
    "L'acquisizione è stata terminata qui. L'interruzione non ha raggiunto alcuna atomizzazione in corso — un'acquisizione già avviata prosegue.",

  settingsGroupModel: "Modello",
  settingsGroupAppearance: "Aspetto",
  settingsGroupAbout: "Informazioni",
  settingsGroupCorpus: "Corpus",
  settingsThemeLabel: "Tema",
  settingsThemeHint: "Scuro usa Catppuccin · Chiaro usa Latte",
  settingsFlavourLabel: "Variante",
  settingsFlavourHint: "Variante Catppuccin per il tema scuro",
  settingsAccentLabel: "Accento",
  settingsAccentHint: "14 accenti Catppuccin",
  settingsChatTextSizeLabel: "Dimensione del testo nella chat",
  settingsChatTextSizeHint: "dimensione del carattere del filo di conversazione e del campo di scrittura",
  settingsChatTextSizeSmall: "Piccola",
  settingsChatTextSizeMedium: "Media",
  settingsChatTextSizeLarge: "Grande",
  settingsInterfaceLanguageLabel: "Lingua dell'interfaccia",
  settingsInterfaceLanguageHint: "lingua delle etichette, dei menu e dei messaggi dell'applicazione",
  settingsInterfaceLanguageGroupLabel: "Lingua dell'interfaccia",
  settingsApiKeyStatusLabel: "Stato della chiave API",
  settingsApiKeySet: "Una chiave API è impostata",
  settingsApiKeyUnset: "Nessuna chiave API impostata",
  settingsBaseUrlLabel: "URL di base",
  settingsBaseUrlExplanation:
    "L'indirizzo dell'endpoint compatibile con OpenAI a cui l'applicazione invia tutte le richieste. Di solito " +
    "termina con /v1, p. es. https://api.example.com/v1.",
  settingsBaseUrlPlaceholder: "https://il-suo-endpoint-llm/v1",
  settingsModelIdLabel: "ID del modello",
  settingsModelIdExplanation:
    "L'identificativo esatto del modello che il suo endpoint si aspetta, p. es. gemma-3-27b-it. Lo copi " +
    "dall'elenco dei modelli del suo fornitore — un ID digitato male fa fallire ogni richiesta.",
  settingsModelIdPlaceholder: "id-modello",
  settingsApiKeyLabel: "Chiave API",
  settingsApiKeyExplanation:
    "La chiave segreta che autorizza le richieste verso il suo endpoint (spesso inizia con sk-). Viene salvata " +
    "cifrata su questo dispositivo e inviata solo all'endpoint che ha configurato. Lasciando il campo vuoto resta " +
    "la chiave già salvata; digitando un nuovo valore la si sostituisce.",
  settingsApiKeyPlaceholder: "sk-…",
  settingsKeyRequiredForEndpoint:
    "Per il nuovo endpoint serve una chiave — una credenziale non viene mai trasferita a un altro URL di base. " +
    "Inserisca la chiave di questo endpoint per abilitare Salva.",
  settingsUnsavedChanges: "Modifiche non salvate — prema Salva per applicarle.",
  settingsSaved: "Salvato.",
  settingsSavedWithSwap: (p) => `Salvato · la chat in corso usa ora ${p.modelId}.`,
  settingsSaving: "Salvataggio…",
  settingsSave: "Salva",
  settingsTesting: "Verifica in corso…",
  settingsTestConnection: "Verifica la connessione",
  settingsRequiredFields: "L'URL di base e l'ID del modello sono obbligatori.",
  settingsContextLengthInvalid:
    "La lunghezza del contesto deve essere un numero intero positivo (token), p. es. 65536.",
  settingsSwapFailed: (p) =>
    `Salvato, ma la chat in corso non ha potuto cambiare modello (${p.error}). Resta sul modello precedente.`,
  settingsTestOk: "Connessione in ordine — l'endpoint ha risposto e ha accettato la chiave.",
  settingsTestUnauthorized: (p) =>
    `Non autorizzato — l'endpoint ha rifiutato la chiave API (HTTP ${p.status}). La verifichi o la inserisca di nuovo.`,
  settingsTestUnreachable: "Endpoint irraggiungibile — verifichi l'URL di base e la sua rete.",
  settingsTestNotConfigured: "Nessuna connessione configurata — salvi prima un URL di base e una chiave API.",
  settingsTestHttpError: (p) => `L'endpoint ha risposto con HTTP ${p.status} — verifichi l'URL di base.`,
  settingsAdvanced: "Avanzate",
  settingsReasoningLabel: "Reasoning",
  settingsReasoningExplanation:
    "Attiva la modalità di ragionamento esplicito del modello inviando un parametro reasoning_effort. Utile per i " +
    "modelli ibridi che altrimenti non chiamano strumenti (classe Qwen3-A3B); lo lasci disattivato per i modelli " +
    "nativamente capaci di ragionare come gpt-oss — alcuni endpoint rifiutano l'impostazione con un errore.",
  settingsReasoningToggleLabel: "Attiva il ragionamento",
  settingsReasoningOn: "Attivo",
  settingsReasoningOff: "Disattivo",
  settingsReasoningEffortLabel: "Intensità del ragionamento",
  settingsReasoningEffortExplanation:
    "Quanto tempo di riflessione il modello dedica a ogni risposta — bassa risponde più in fretta, alta è la più " +
    "accurata. Media è un valore predefinito ragionevole.",
  settingsEffortLow: "bassa",
  settingsEffortMedium: "media",
  settingsEffortHigh: "alta",
  settingsContextLengthLabel: "Lunghezza del contesto",
  settingsContextLengthExplanation:
    "La finestra di token reale del suo modello, p. es. 65536. La lasci vuota per usare il valore predefinito; un " +
    "valore troppo grande provoca errori a metà conversazione, uno troppo piccolo riassume la conversazione troppo presto.",
  settingsContextLengthPlaceholder: "p. es. 65536",
  settingsDeleteApiKey: "Elimina la chiave API",
  settingsConfirmEraseLabel: "Conferma l'eliminazione della chiave API",
  settingsEraseConfirmText:
    "Eliminare da questo dispositivo la chiave API salvata? Dovrà inserire di nuovo una chiave prima dell'avvio della prossima sessione.",
  settingsDeleteKey: "Elimina la chiave",
  settingsCancel: "Annulla",
  settingsKeyErased:
    "Chiave API eliminata da questo dispositivo. Inserisca una nuova chiave prima di avviare la prossima sessione.",
  settingsLocalityStatement:
    "La sua chiave API e tutto ciò che inserisce sono salvati localmente su questo dispositivo (la chiave cifrata " +
    "tramite Electron safeStorage dove disponibile) e inviati solo all'endpoint LLM che ha configurato — nessun " +
    "server CBE né altro server di terzi li riceve.",
  settingsAboutSkill: "Skill",
  settingsAboutSkillVersion: "Versione dello skill",
  settingsAboutAppVersion: "Versione dell'applicazione",
  settingsAboutSkillUpdateStatus: "Stato dell'aggiornamento dello skill",
  settingsAboutSkillUpdateNotChecked: "Non ancora verificato; lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdateUpdated: (p: { version: string }): string => `Aggiornato allo skill ${p.version}.`,
  settingsAboutSkillUpdateUpToDate: (p: { version: string }): string => `Lo skill ${p.version} è aggiornato.`,
  settingsAboutSkillUpdateMetadataInvalid: (p: { field: string }): string =>
    `Aggiornamento rifiutato: metadati del puntatore non validi${p.field ? ` (${p.field})` : ""}. Lo skill effettivo indicato sopra resta in uso.`,
  settingsAboutSkillUpdateAppMismatch:
    "Aggiornamento rifiutato: questo skill non supporta questa versione dell'applicazione. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdateAbiMismatch:
    "Aggiornamento rifiutato: l'ABI della superficie del modello è diversa. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdateToolMismatch:
    "Aggiornamento rifiutato: il contratto degli strumenti è diverso. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdatePiMismatch:
    "Aggiornamento rifiutato: la versione di Pi testata è diversa. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdateIntegrityMismatch:
    "Aggiornamento rifiutato: l'impronta dell'archivio non corrisponde. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillUpdateUnavailable:
    "La verifica degli aggiornamenti non è disponibile. Lo skill effettivo indicato sopra resta in uso.",
  settingsAboutSkillPackIdentity: "Pacchetto skill firmato",
  settingsAboutSkillPackIdentityValue: (p: {
    channel: string;
    epoch: number;
    sequence: number;
    keyId: string;
  }): string => `${p.channel} · epoca ${p.epoch} · sequenza ${p.sequence} · chiave ${p.keyId}`,
  settingsAboutSkillUpdateSignedRefused: (p: { code: string; field: string }): string =>
    `Aggiornamento firmato rifiutato (${p.code}${p.field ? `: ${p.field}` : ""}). Lo skill effettivo indicato sopra resta in uso.`,
  settingsAboutSkillUpdateSignedUnavailable: (p: { code: string }): string =>
    `La verifica dell'aggiornamento firmato non è disponibile (${p.code}). Lo skill effettivo indicato sopra resta in uso.`,
  settingsAboutLoading: "caricamento…",
  settingsAboutUnavailable: "non disponibile",
  settingsPioneerLinkLabel: "Sito di PIONEER Alliance",
  settingsPioneerLinkDescription:
    "Scopra di più su PIONEER Alliance, l'alleanza universitaria europea associata a questo strumento.",
  settingsPioneerExternalCue: "Si apre nel browser di sistema.",
  settingsPioneerOpenFailure: "Non è stato possibile aprire il sito di PIONEER Alliance. Riprovi.",
  settingsHelpButtonLabel: (p) => `Che cos'è ${p.field}?`,
  settingsThemeToggleLabel: "Cambia tema",
  settingsThemeDark: "Scuro",
  settingsThemeLight: "Chiaro",
  settingsFlavourGroupLabel: "Variante Catppuccin",
  settingsFlavourLatteNote:
    "Il tema chiaro usa la palette Latte — la scelta della variante vale solo per il tema scuro.",
  settingsFlavourFrappe: "Frappé",
  settingsFlavourMacchiato: "Macchiato",
  settingsFlavourMocha: "Mocha",
  settingsAccentGroupLabel: "Colore d'accento",
  settingsAzureHintBefore:
    "Sembra una risorsa Azure OpenAI. L'interfaccia compatibile con OpenAI si trova di solito sotto",
  settingsCleartextWarningBefore: "Questo endpoint usa il semplice",
  settingsCleartextWarningMiddle: "— la chiave API viaggerebbe in chiaro. Usi",
  settingsCleartextWarningAfter: ", a meno che non si tratti di una rete locale affidabile.",

  corpusVersionLabel: "Versione",
  corpusCacheDateLabel: "Data della cache",
  corpusPackIdentityLabel: "Pacchetto corpus firmato",
  corpusPackIdentityValue: (p: { channel: string; epoch: number; sequence: number; keyId: string }): string =>
    `${p.channel} · epoca ${p.epoch} · sequenza ${p.sequence} · chiave ${p.keyId}`,
  corpusShippedWithApp: "fornito con l'applicazione",
  corpusRefreshing: "Aggiornamento…",
  corpusRefresh: "Aggiorna il corpus",
  corpusEmptyValue: "—",
  corpusUpdated: (p) => `Corpus aggiornato alla versione ${p.version}.`,
  corpusUpToDate: (p) => `Il corpus è aggiornato (versione ${p.version}).`,
  corpusIntegrityMismatch:
    "L'aggiornamento del corpus non è riuscito, il controllo di integrità non ha corrisposto. Resta caricato il corpus precedente.",
  corpusRefreshNotConfigured:
    "Per questa versione dell'applicazione non è configurata una posizione per gli aggiornamenti del corpus.",
  corpusRefreshPointerHttp: (p) =>
    `Non è stato possibile verificare la disponibilità di un aggiornamento del corpus (HTTP ${p.httpStatus}).`,
  corpusRefreshPointerRead: "Non è stato possibile leggere le informazioni di aggiornamento del corpus.",
  corpusRefreshPointerInvalid: "Le informazioni di aggiornamento del corpus sono incomplete (version/file/sha256).",
  corpusRefreshDownloadHttp: (p) =>
    `Non è stato possibile scaricare l'aggiornamento del corpus (HTTP ${p.httpStatus}).`,
  corpusRefreshDownloadRead: "Non è stato possibile leggere il pacchetto del corpus scaricato.",
  corpusRefreshMissingMarker: (p) =>
    `Il pacchetto del corpus scaricato non contiene il file richiesto ${p.markerFile} al livello superiore.`,
  corpusRefreshUnsafeEntry: (p) =>
    `Il pacchetto del corpus scaricato contiene una voce non sicura ed è stato rifiutato: ${p.entryName}.`,
  corpusRefreshInstallFailed: "Non è stato possibile installare l'aggiornamento del corpus.",
  corpusRefreshSignedRefused: (p: { code: string; field: string }): string =>
    `Aggiornamento firmato del corpus rifiutato (${p.code}${p.field ? `: ${p.field}` : ""}). Il corpus attuale resta caricato.`,
  corpusRefreshSignedUnavailable: (p: { code: string }): string =>
    `L'aggiornamento firmato del corpus non è disponibile (${p.code}). Il corpus attuale resta caricato.`,
  corpusRefreshUnexpected: "Non è stato possibile completare l'aggiornamento del corpus.",
  corpusInfoReloadFailed: "Non è stato possibile ricaricare le informazioni sul corpus.",

  configPageLabel: "Configurazione iniziale",
  configGroupLabel: "Connessione LLM · BYO",
  configIntro:
    "Indichi il suo endpoint LLM compatibile con OpenAI. I dati di connessione sono salvati localmente su questa " +
    "macchina e cifrati tramite Electron safeStorage dove disponibile.",
  configBaseUrlHint: "p. es. https://router.huggingface.co/v1",
  configApiKeyHint: "salvata localmente, mai condivisa",
  configModelIdHint: "p. es. gpt-4o-mini, gemma-3-27b-it",
  configModelIdPlaceholder: "gemma-3-27b-it",

  profileDimensionPblPriorKnowledge: "Conoscenze pregresse di PBL",
  profileDimensionCbePriorKnowledge: "Conoscenze pregresse di CBE",
  profileDimensionDidacticStance: "Postura didattica",
  profileDimensionAttitude: "Atteggiamento verso la CBE",
  profileDimensionCapacity: "Carico didattico / capacità",
  profileReadingHeading: "Come l'assistenza la interpreta",
  profileReadingIntro:
    "Le stime provengono dalla conversazione e portano con sé i propri indizi; la sua impostazione manuale vale finché non la cambia.",
  profileOverrideRejected: "L'impostazione è stata rifiutata — il valore non è sulla scala della dimensione.",
  profileIdentityHeading: "Come desidera essere chiamata o chiamato",
  profileIdentityIntro:
    "Le sue parole, usate dall'assistenza per rivolgersi a lei. Entrambi i campi sono facoltativi e indipendenti " +
    "l'uno dall'altro — lasciarli vuoti è una scelta normale, e nulla viene dedotto o completato al posto suo.",
  profileNameLabel: "Nome",
  profileFormOfAddressLabel: "Formula di cortesia desiderata",
  profileTooLong: (p) => `Troppo lungo — mantenga ogni voce entro ${p.max} caratteri.`,
  profileTooLongNothingSaved: (p) =>
    `Troppo lungo — mantenga ogni voce entro ${p.max} caratteri. Non è stato salvato nulla.`,
  profileSaveFailed: "Salvataggio non riuscito — non è stato registrato nulla.",
  profileSaved: "Salvato.",
  profileSave: "Salva",
  profileOverriddenBadge: "impostato da lei",
  profileConfidenceBadge: (p) => `affidabilità · ${p.confidence}`,
  profileNotEstimatedBadge: "non ancora stimato",
  profileAssumptionNote:
    "Un'ipotesi dedotta dalla nostra conversazione — non un dato certo. Scelga un valore qui sotto per sostituirla.",
  profileOverrideSelectLabel: (p) => `Imposta ${p.dimension}`,
  profileChooseManually: "scegliere per impostare manualmente",
  profileLastRevised: (p) => `ultima revisione: ${p.stamp}`,

  overlaySectionsLabel: "Sezioni della sovrapposizione",
  overlaySettingsTab: "Impostazioni",
  overlayProfileTab: "Profilo",
  overlayCloseLabel: "Chiudi",

  updateFailed: (p) => `Aggiornamento non riuscito: ${p.message}`,
  updateDismiss: "Chiudi",
  updateDownloading: (p) => `Download dell'aggiornamento ${p.version}…`,
  updateDownloaded: (p) => `Aggiornamento ${p.version} scaricato.`,
  updateRestartAndInstall: "Riavvia e installa",
  updateLater: "Più tardi",
  updateAvailable: (p) => `La versione ${p.version} è disponibile.`,
  updateChangelog: "Registro delle modifiche",
  updateInstallNow: "Installa ora",
  updateSkipVersion: "Salta questa versione",

  citationUnknownId: (p) =>
    `Riferimento non risolto: nessun documento del corpus «${p.id}». Non è stato possibile verificarlo.`,
  citationMissingSection: (p) =>
    `Riferimento non verificato: nessuna sezione indicata, quindi non è verificabile rispetto a ${p.id}. ` +
    `Apra il documento per vedere da dove proviene.`,
  citationUnknownSection: (p) =>
    `Riferimento non verificato: «${p.section}» non corrisponde ad alcun titolo in ${p.id}. Apra il documento per verificare lei stesso l'affermazione.`,
  citationUnresolvedFlag: "non risolto",
  citationUnverifiedFlag: "non verificato",
  citationOpenWikiAtom: (p) => `Apri l'atomo wiki ${p.id}`,
  citationOpenCorpusDocument: (p) => `Apri il documento del corpus ${p.id}`,
  citationLoading: "Caricamento…",
  citationNotFound: (p) => `Riferimento non trovato: ${p.id}`,
  citationCorpusMeta: (p) => `corpus ${p.version} · ${p.tags}`,
  citationPathLabel: "percorso:",
  citationCloseLabel: "Chiudi",

  docChipLabel: (p) => `Allegato: ${p.name} (${p.type})`,

  ingestUnsupportedFormat: (p) => `Formato non supportato «${p.ext}». Formati supportati: ${p.supported}.`,
  ingestLegacyExcelFormat: (p) =>
    `«${p.ext}» è un formato Excel meno recente o con macro che questa applicazione non legge. Apri la cartella ` +
    `di lavoro in Excel, salvala come cartella di lavoro .xlsx e riprova.`,
  ingestNoExtension: "(nessuna estensione)",
  ingestUnreadableFile: (p) => `Non è stato possibile leggere il file «${p.filename}»: ${p.detail}`,
  mainExportDialogTitle: "Esporta il documento di progettazione",
  mainExportFilterMarkdown: "Markdown",
  mainExportInsideApp: "Questa posizione è all'interno dell'applicazione stessa. Scelga una cartella tra i suoi file.",
  mainExportWriteFailed: (p) =>
    `Non è stato possibile scrivere il documento di progettazione (${p.reason}). Non è stato modificato nulla.`,
  mainIngestDialogTitle: "Acquisire materiale didattico nel wiki",
  mainIngestFilterMaterial: "Materiale didattico",
  mainIngestWrongCourse: (p) =>
    `Questa acquisizione è stata avviata per un corso che non è più attivo. Il materiale viene acquisito sempre e ` +
    `solo nel corso attivo, attualmente «${p.course}». Attivi il corso desiderato, poi riavvii l'acquisizione.`,
  mainIngestAlreadyRunning: "Per questo corso è già in corso un'acquisizione",
  mainIngestEndpointUnreachable: (p) =>
    `L'endpoint del modello a ${p.baseURL} non è raggiungibile: la connessione è stata rifiutata, oppure ` +
    `l'indirizzo non si risolve né si instrada. Lo avvii, poi riprovi.`,
  mainIngestAborted: "Acquisizione interrotta",
  mainIngestAtomizationFailed: "Atomizzazione non riuscita",
  mainProviderNotConfigured: "Fornitore LLM non configurato",
  mainNoOpenConversation: "Per il corso attivo non è aperta alcuna conversazione.",
  mainArchiveUnreadable:
    "Non è stato possibile leggere l'archivio della conversazione precedente — viene avviata una nuova " +
    "conversazione. I file restano sul disco nella cartella del corso.",
  mainResumeDisabledReason: "File JSON associato mancante o illeggibile — apra il file .md in un editor per esaminarlo",
  mainTurnInFlightNotice:
    "L'agente sta ancora lavorando — attenda la fine del turno (o lo fermi) prima di chiudere o azzerare la conversazione.",
  mainResumeUnavailableNotice:
    "Non è stato possibile aprire quella conversazione — il suo archivio manca o è illeggibile. Non è stato modificato nulla; la conversazione attuale resta aperta.",
  mainResumeWhileOpeningNotice:
    "Per questo corso si sta ancora aprendo una conversazione — attenda un momento, poi riprovi.",
  mainPromptBusyNotice: "L'agente sta già elaborando — attenda la fine del turno in corso, poi invii di nuovo.",
  mainExportEmptyNotice: "Non c'è ancora nulla da esportare — nessun artefatto del canvas contiene un valore.",
  mainFreshStartFailedNotice:
    "Non è stato possibile avviare la nuova sessione. La conversazione precedente è salvata al sicuro nella cartella del corso — non va perso nulla. Riprovi ad avviare la nuova sessione.",
  mainCourseDeleteInFlightNotice:
    "L'agente sta ancora lavorando in questo corso — attenda la fine del turno (o lo fermi) prima di eliminare il corso.",
  mainCourseDeleteIngestingNotice:
    "Nel wiki di questo corso si sta ancora acquisendo materiale — quell'esecuzione termina da sé; la attenda (o interrompa l'acquisizione) prima di eliminare il corso.",
  mainCourseDeleteOpeningNotice:
    "La conversazione di questo corso si sta ancora aprendo — ci vuole un momento; riprovi a eliminare il corso una volta che è aperta.",
  mainCourseDeleteUnreadableNotice:
    "La cartella di questo corso è ancora sul disco, ma non è stato possibile leggere il suo course.md — non è stato spostato nulla nel cestino e non è stato modificato nulla. Apra la cartella del corso, verifichi course.md, poi riprovi.",
  mainIngestFileDialogTitle: "Leggere materiale",
  chatCompactionFailedText:
    "Il riassunto del contesto non è riuscito. La conversazione resta invariata — può continuare a lavorare.",
  chatCompactionFailedHint:
    "Se succede ripetutamente, la finestra di contesto configurata è forse troppo piccola (Impostazioni → Lunghezza del contesto).",
  toolExecutionFailed: "L'esecuzione dello strumento non è riuscita",
  ringExplanationPending:
    "Questa conversazione viene riassunta automaticamente per fare spazio. Il nuovo valore segue a breve.",
  ringExplanationFresh:
    "Lunghezza della conversazione: non ancora misurata. La prima misurazione arriva con la prima risposta.",
  ringExplanationCarried:
    "Questa conversazione porta con sé un contesto che al momento non è misurabile. Il valore torna con la prossima risposta.",
  ringExplanationWindowUnknown: (p) =>
    `Lunghezza della conversazione: ${p.used} token. Quanto sia grande la finestra di contesto del modello non è ` +
    `stato registrato — perciò non viene mostrata alcuna quota. Può indicarla nelle impostazioni, gruppo ` +
    `«Modello», sotto «Avanzate»; la pastiglia del modello a destra ci porta.`,
  ringExplanationMeasured: (p) =>
    `Lunghezza della conversazione: ${p.percent} % della finestra di contesto — ${p.used} token su ${p.window}.`,
  ringExplanationNearFull:
    "Questa conversazione sarà presto riassunta automaticamente per fare spazio — è normale e non è un problema. " +
    "Il suo lavoro nel CBE Process Canvas, le decisioni registrate, l'avanzamento nei passi di progettazione e la " +
    "valutazione CBE Maturity vengono tutti mantenuti.",
  ringLabelPending: "Lunghezza della conversazione: riassunto in corso",
  ringLabelFresh: "Lunghezza della conversazione: non ancora misurata",
  ringLabelCarried: "Lunghezza della conversazione: contesto trasportato, non ancora misurato",
  ringLabelWindowUnknown: "Lunghezza della conversazione: nessuna finestra di contesto registrata",
  ringLabelMeasured: (p) => `Lunghezza della conversazione: ${p.percent} %`,
  toolDetailFullRaster: "griglia completa",
  toolDetailUnassessed: "non valutato",
  toolDetailStep: (p) => `passo ${p.step}`,
  exportMaturityDerivation: (p) => `derivato da ${p.contributing} criteri valutati su ${p.total}, media ${p.mean}`,
  exportMaturityDerivationCapped: (p) => `${p.base}; limitato dal riscontro aperto su ${p.criterion}`,
  uiRefActiveCourseName: "Nome del corso attivo",
  uiRefArtefactNotes: "Note sull'artefatto e ↻ Itera",
  uiRefDeleteArtefact: "Elimina l'artefatto",
  uiRefContextRing: "Anello del contesto",
  uiRefModelPill: "Pastiglia del modello",
  uiRefSendStop: "Invia / Ferma",
  uiRefCourseList: "Elenco dei corsi",
  uiRefCourseDetail: "Dettagli del corso",
  headerHelpLabel: "Aiuto",
  headerHelpStartingReason: "La conversazione sta ancora partendo — l'aiuto sarà disponibile tra un istante.",
};
