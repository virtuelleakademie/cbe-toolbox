/**
 * The French chrome-string catalogue (capability `desktop-app`, Requirement:
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
 * (`methodology-007` §4.4 Table 1), the French entry is this app's rendering of
 * it for a French-reading lecturer, not a second normative source: the stable
 * identity of a criterion is its key, and the model-facing Discuss token carries
 * the reference-language label.
 *
 * Addressed formally ("vous"), which is what a lecturer-facing tool at this
 * institution uses.
 *
 * **Two conventions this file follows deliberately.**
 *
 * - **Quotation marks are the French guillemets `«…»`, set tight** (no inner
 *   space), which is the Swiss French convention and what the German catalogue's
 *   `„…“` corresponds to. The straight apostrophe `'` is used throughout, as the
 *   English catalogue already does.
 * - **A plural is never built by appending a letter to an interpolated word.**
 *   French agrees at 2 and above and keeps the singular at 0 and 1, so a count
 *   entry tests `p.count < 2` rather than `p.count === 1` — the English
 *   catalogue's `=== 1` would render "0 notes" where French writes "0 note".
 *   Where the plural is not a suffix append, both forms are written out.
 */
import type { ChromeCatalogue } from "./types.js";

export const fr: ChromeCatalogue = {
  languageNameEn: "English",
  languageNameDe: "Deutsch",
  languageNameFr: "Français",
  languageNameIt: "Italiano",

  appHydrationPaneLabel: "Ouverture de la conversation",
  appHydrationTitle: "Votre conversation s'ouvre…",
  appHydrationSub:
    "Au premier lancement, l'environnement d'exécution de l'agent est installé — cela peut prendre 1 à 2 minutes.",
  appHydrationErrorLabel: "La conversation n'a pas pu être ouverte",
  appHydrationErrorTitle: "Impossible d'ouvrir la conversation",
  appHydrationUnknownError: "Erreur inconnue",
  appRetry: "Réessayer",
  appDismissError: "Fermer le message d'erreur",
  appDismissNotice: "Fermer l'avis",

  menuApplication: "CBE Toolbox",
  menuFile: "Fichier",
  menuEdit: "Édition",
  menuView: "Affichage",
  menuWindow: "Fenêtre",
  menuHelp: "Aide",
  menuAbout: "À propos de CBE Toolbox",
  menuSettings: "Réglages…",
  menuQuit: "Quitter CBE Toolbox",
  menuExit: "Quitter",
  menuCloseWindow: "Fermer la fenêtre",
  menuUndo: "Annuler",
  menuRedo: "Rétablir",
  menuCut: "Couper",
  menuCopy: "Copier",
  menuPaste: "Coller",
  menuSelectAll: "Tout sélectionner",
  menuZoomIn: "Agrandir",
  menuZoomOut: "Réduire",
  menuResetZoom: "Taille réelle",
  menuToggleFullScreen: "Activer/désactiver le plein écran",
  menuReload: "Recharger",
  menuToggleDeveloperTools: "Activer/désactiver les outils de développement",
  menuMinimize: "Réduire",
  menuBringAllToFront: "Tout ramener au premier plan",
  menuCbeHelp: "Aide de CBE Toolbox",
  menuPioneerWebsite: "Site de PIONEER Alliance",
  menuWorkspaceUnavailable: "L'espace de travail n'est pas encore prêt.",
  menuModalUnavailable: "Fermez d'abord la boîte de dialogue ouverte.",

  headerLabel: "En-tête de l'application",
  headerAppName: "CBE Toolbox",
  headerNoActiveCourse: "aucun cours actif",
  headerShowCoursesLabel: (p) => `Afficher les cours — cours actif : ${p.course}`,
  headerShowCoursesTitle: "Afficher les cours",
  headerOpenSettings: "Ouvrir les réglages",
  headerOpenSettingsUnsaved: "Ouvrir les réglages — modifications non enregistrées",
  headerSettingsTitle: "Réglages",
  headerSettingsTitleUnsaved: "Réglages — modifications non enregistrées",
  headerOpenProfile: "Ouvrir le profil",
  headerProfileTitle: "Profil",
  headerLanguageLabel: "Langue de l'interface",
  headerLanguageAccessibleName: (p) => `Langue de l'interface : ${p.language} (${p.code})`,
  headerLanguageBusy: "Changement de la langue de l'interface…",
  headerLanguageFailure: "La langue de l'interface n'a pas pu être modifiée. Réessayez.",

  chatConversationLabel: "Conversation",
  // ─────────────────────── Première prise en main ─────────────────────────
  onboardingHeading: "Bienvenue dans CBE Toolbox",
  onboardingValue: (p) =>
    `Un ${p.course} est votre unité de travail : développez ou adaptez un module CBE et examinez sa cohérence dans la conversation. Vous apportez la connaissance du module et prenez les décisions ; l’assistant ne livre pas un module terminé.`,
  onboardingCourseNavigation: (p) =>
    `L’en-tête indique le ${p.course} actif. Créez et changez de cours dans la liste de gauche ; renommez ou supprimez-en un dans ses détails.`,
  onboardingCourseChats: (p) =>
    `Ces détails contiennent aussi ses ${p.chats}, les conversations enregistrées du cours, et son ${p.wiki} ; ouvrir les détails ne change pas le cours actif.`,
  onboardingWikiReuse: (p) =>
    `Importez du matériel pédagogique local par le ${p.wiki} du cours actif pour créer des entrées de connaissances thématiques, réutilisables et consultables.`,
  onboardingWikiGrounding: "L’assistant peut lire et citer ces entrées afin d’ancrer le travail dans votre matériel.",
  onboardingAttachmentDistinction:
    "Une pièce jointe au chat alimente plutôt cette conversation ; elle ne remplit pas le Wiki.",
  onboardingDesign:
    "Travaillez avec l’assistant dans la conversation. À droite, CBE Process Canvas consigne les dix étapes du cours actif ; CBE Maturity évalue ce qui est consigné, sans certification.",
  onboardingNextAction:
    "Décrivez votre module et ce que vous souhaitez travailler, ou apportez une question ou du matériel existant. Une pièce jointe ou un import Wiki reste facultatif.",
  onboardingHelpAndReread: (p) =>
    `Utilisez le point d’interrogation dans l’en-tête pour l’aide conversationnelle ; relisez cette présentation dans le groupe ${p.about} de la fenêtre des réglages.`,
  onboardingBegin: "Commencer",
  onboardingSkip: "Ignorer",
  onboardingClose: "Fermer la présentation",
  onboardingReread: "Relire la présentation de démarrage",
  onboardingAvailability: "Une présentation de démarrage est disponible au-dessus de la conversation.",
  onboardingReadFailure:
    "La préférence de démarrage n’a pas pu être lue. La présentation reste disponible et peut réapparaître.",
  onboardingWriteFailure:
    "La présentation est fermée pour cette session, mais la préférence n’a pas pu être enregistrée. Elle peut réapparaître après le redémarrage.",
  chatRoleAssistant: "Skill CBE",
  chatRoleLecturer: "Personne enseignante",
  chatNewSessionLockedReason: "L'agent travaille encore — attendez d'abord la fin du tour.",
  chatComposerLockedReason: "L'agent travaille encore — attendez d'abord la fin du tour.",
  chatNewSessionLabel: "Nouvelle session",
  chatNewSessionTitle: "Commencer une nouvelle conversation (le canvas est conservé ; l'actuelle reste sur le disque)",
  chatNewSessionStarting: "Démarrage de la nouvelle session…",
  chatNewSessionFailedText:
    "La nouvelle session n'a pas pu être démarrée. Votre conversation précédente est enregistrée en sécurité — rien n'est perdu.",
  chatNewSessionFailedDetail: "Vous la retrouvez à tout moment sous Cours.",
  chatNewSessionConfirmLabel: "Confirmer la nouvelle session",
  chatNewSessionConfirmText:
    "Commencer une nouvelle session ? Vos entrées dans le CBE Process Canvas et dans CBE Maturity sont conservées. Vous pouvez reprendre cette conversation à tout moment depuis Cours.",
  chatNewSessionConfirmAction: "Démarrer une nouvelle session",
  chatCancel: "Annuler",
  chatIngestFormatsHint: (p) => `Lire du matériel existant (${p.formats}) dans le chat`,
  chatPlusMenuLabel: "Autres actions",
  chatUploadEntryLabel: "Téléverser des fichiers",
  chatHelpEntryLabel: "Aide",
  chatComposerFieldLabel: "Message",
  chatSendLabel: "Envoyer",
  chatSendTitle: "Envoyer (Entrée)",
  chatStopLabel: "Arrêter la réponse",
  chatStopPendingLabel: "Arrêt de la réponse…",
  chatStopCompactionReason: "Le contexte est en cours de résumé — cela va jusqu'au bout et ne peut pas être arrêté.",
  chatStoppedTurnMarker: "Vous avez arrêté cette réponse — elle est incomplète.",
  chatStoppedTurnPlaceholder: "Vous avez arrêté cette réponse avant qu'elle ne commence.",
  chatStopTimedOutNoticeText:
    "L'arrêt prend plus de temps que prévu — l'assistance n'a pas encore libéré ce tour. " +
    "Le champ de message reste verrouillé jusque-là, pour que rien de ce que vous envoyez ne puisse entrer en collision.",
  chatStopTimedOutRecoveryLabel: "Fermer de force cette conversation",
  chatStopTimedOutRecoveryConfirm:
    "La fermeture forcée met fin à cette conversation sans attendre l'assistance et en démarre une nouvelle. " +
    "Votre travail est conservé — la conception du module dans le CBE Process Canvas, les décisions consignées, " +
    "la progression dans les étapes de conception et l'évaluation CBE Maturity — et la conversation est archivée " +
    "sur le disque.",
  chatForceCloseBusy: "Fermeture…",
  chatForceCloseAction: "Fermer de force et recommencer",
  chatForceCloseFailed:
    "La conversation n'a pas pu être fermée de force. Votre travail est enregistré en sécurité dans le dossier du cours — réessayez.",
  chatModelPillBlankLabel: "Aucun modèle configuré",
  chatModelPillPurpose: "Ouvrir les réglages du modèle (Réglages, groupe «Modèle»)",
  chatModelPillAccessibleName: (p) => `${p.purpose} — modèle : ${p.modelId}`,
  chatPendingAttachmentsLabel: "Documents joints",
  chatRemoveAttachmentLabel: (p) => `Retirer ${p.filename}`,
  chatNoTextExtractedProblem: (p) => `«${p.filename}» : aucun texte extrait — un PDF numérisé ou un document vide ?`,
  chatReasoningEnabledNotice:
    "Raisonnement activé — envoyez à nouveau votre message, cette fois avec reasoning_effort.",
  chatReasoningSwapFailed: (p) =>
    `Le raisonnement n'a pas pu être activé dans la session en cours (${p.error}). Le chat reste inchangé.`,
  chatReasoningOffer:
    "Le modèle a répondu sans appeler d'outil — typique d'un modèle hybride à raisonnement exécuté sans " +
    "reasoning_effort. Activer le raisonnement et réessayer ?",
  chatEnablingReasoning: "Activation…",
  chatEnableReasoning: "Activer le raisonnement",
  chatDismissReasoningSuggestion: "Fermer la suggestion de raisonnement",
  chatNotNow: "Pas maintenant",
  chatDismissNotice: "Fermer l'avis",
  chatHelpAnnouncement: "Demande d'aide envoyée à l'assistance.",
  chatHelpDisplayText: "Aide demandée",
  chatContinueLabel: "Continuer",
  chatContinueTitle: "Laisser le modèle compléter la réponse interrompue",
  chatRetryLabel: "Réessayer",
  chatRetryTitle: "Demander au modèle de répondre à nouveau intégralement à la demande précédente",
  chatJumpToLatestLabel: "Aller au message le plus récent",
  chatJumpToLatestText: "Au plus récent",
  chatWorkingDisclosureLabel: "Travail en cours…",
  chatWorkingDetailLabel: "Activité technique en cours",
  chatWorkingDetailEmpty: "En attente de la prochaine activité…",
  chatWorkingToolActivityLabel: (p) => `Activité de l'outil : ${p.action} (${p.status})`,
  chatInteractionUnavailable: "Cette question n'est pas disponible. Continuez dans le champ de message.",
  chatThinkingHeadLive: "réfléchit…",
  chatThinkingHeadDone: "raisonnement",
  chatThinkingEmptyBody: "…",
  chatSlashCommandsLabel: "Commandes slash",

  errorRunLockedReason: "L'agent travaille encore — attendez la fin du tour.",
  errorBusyNoticeText: "L'assistance travaille encore — réessayez lorsqu'elle aura terminé.",
  errorAuthBillingText:
    "Le fournisseur du modèle a rejeté la requête — il signale un crédit manquant ou une clé API invalide. " +
    "Vérifiez votre compte chez le fournisseur ou la connexion LLM dans les réglages, puis renvoyez votre message.",
  errorGenericProviderText:
    "Le fournisseur du modèle n'a pas pu traiter la requête. Votre conversation reste inchangée — " +
    "réessayez ; le détail complet de l'erreur figure dans le journal de session.",
  errorLoopAbortNote:
    "J'ai appelé le même outil à répétition sans progresser et j'ai arrêté pour éviter une boucle. " +
    "Veuillez reformuler ou réessayer.",

  canvasIterateLabel: "↻ Itérer",
  canvasNoAnnotationsLabel: "aucune note",
  canvasAnnotationCountLabel: (p) => `${p.count} note${p.count < 2 ? "" : "s"}`,
  canvasRemoveAnnotationLabel: "Retirer la note",
  canvasAnnotationInputPlaceholder: "Note sur cet artefact…",
  canvasAnnotationAddLabel: "Ajouter",
  canvasAnnotateToggleLabel: "+ Note",
  canvasExportLabel: "Exporter",
  canvasExportBusy: "Exportation…",
  canvasExportTitle: "Exporter le document de conception de ce cours depuis le CBE Process Canvas vers un fichier",
  canvasExportNoSession: "Aucune conversation n'est encore ouverte.",
  canvasExportNothing: "Rien à exporter pour l'instant — aucun artefact du CBE Process Canvas ne porte de valeur.",
  canvasExportDone: (p) => `Enregistré sous ${p.path}`,
  canvasDeleteArtefactLabel: (p) => `Supprimer ${p.label}`,
  canvasDeleteArtefactTitle: "Supprimer cet artefact",
  canvasDeleteConfirmLabel: (p) => `Supprimer ${p.label} ?`,
  canvasDeleteConfirmText: (p) =>
    `Supprimer «${p.label}» ? Son contenu est retiré du CBE Process Canvas ; il reste dans l'historique de la conversation.`,
  canvasDeleteAction: "Supprimer",
  canvasEmptyValue: "—",
  canvasFocusMarkerLabel: "en focus",
  canvasFocusMarkerText: "focus",
  canvasStepFocusLabel: (p) => `Se concentrer sur l'étape ${p.step} : ${p.name}`,
  canvasStepFocusTitle: "Se concentrer sur cette étape",

  canvasStep1Name: "Poser le cadre",
  canvasStep2Name: "Résultats d'apprentissage",
  canvasStep3Name: "Évaluation des acquis",
  canvasStep4Name: "Challenge",
  canvasStep5Name: "Stakeholder",
  canvasStep6Name: "Parcours d'apprentissage",
  canvasStep7Name: "Activités",
  canvasStep8Name: "Livrables",
  canvasStep9Name: "Contrôle d'alignement",
  canvasStep10Name: "Préparation",

  canvasJourneyEngage: "Engage",
  canvasJourneyInvestigate: "Investigate",
  canvasJourneyAct: "Act / Prototype",
  canvasJourneyReflect: "Reflect and present",

  canvasArtefactModuleframe: "Métadonnées du module / contraintes",
  canvasArtefactLearningoutcomes: "Résultats d'apprentissage",
  canvasArtefactAssessmentblueprint: "Plan d'évaluation",
  canvasArtefactBigidea: "Big Idea",
  canvasArtefactEq: "Essential Question",
  canvasArtefactChallenge: "Challenge Statement",
  canvasArtefactStakeholderplan: "Plan des parties prenantes et de leur implication",
  canvasArtefactEs: "Séquence Engage",
  canvasArtefactIs: "Séquence Investigate",
  canvasArtefactAs: "Séquence Act",
  canvasArtefactRs: "Séquence Reflect",
  canvasArtefactActivityplan: "Plan des activités d'apprentissage",
  canvasArtefactDeliverablesmap: "Vue d'ensemble des livrables",
  canvasArtefactAlignmentmatrix: "Matrice d'alignement + corrections",
  canvasArtefactReadinesschecklist: "Liste de contrôle : déroulement et préparation",

  canvasStateDone: "terminé",
  canvasStateActive: "actif",
  canvasStateDraft: "brouillon",
  canvasStateOpen: "ouvert",
  canvasDepthOpen: "ouvert",
  canvasDepthRough: "grossier",
  canvasDepthRefined: "affiné",
  canvasDepthDetailed: "détaillé",

  exportDocumentTitle: (p) => `${p.course} — Conception de module CBE`,
  exportGeneratedAt: (p) => `_Exporté ${p.stamp} depuis l'état consigné du canvas._`,
  exportCourseContextHeading: "Contexte du cours",
  exportStepHeading: (p) => `Étape ${p.step} — ${p.name}`,
  exportCoverage: (p) => `_Couverture : ${p.depth}_`,
  exportOpenArtefact: "_(ouvert — pas encore décidé)_",
  exportStoppedTurnNote: "_(arrêté par vous — cette réponse est incomplète)_",
  exportMaturityHeading: "CBE Maturity",
  exportMaturityColumnCriterion: "Critère",
  exportMaturityColumnCurrent: "Actuel",
  exportMaturityColumnTarget: "Cible",
  exportMaturityUnassessed: "non évalué",
  exportMaturityLimitation: (p) => `**Limite :** ${p.note}`,

  decisionsHeading: "Décisions",
  decisionsResetBadge: "réinitialisé · objectif supérieur révisé",
  decisionsModuleGoals: "Objectifs du module",
  decisionsNoGoals: "Aucun objectif opérationnel pour l'instant.",
  decisionsAlignmentStatus: "État de l'alignement",
  decisionsAlignmentReset: "Réinitialisé — à revérifier par rapport à l'objectif révisé.",
  decisionsNoAlignment: "Aucun constat d'alignement pour l'instant.",
  decisionsDelegation: "Décisions de délégation",
  decisionsDelegationReset: "Réinitialisé — à revérifier par rapport à l'objectif ou à l'alignement révisé.",
  decisionsNoDelegation: "Aucune décision de délégation pour l'instant.",
  decisionsHeterogeneity: "Notes sur l'hétérogénéité",
  decisionsSoftSkill: "Ancrages des compétences transversales",
  decisionsMissingAnchor: "ancrage manquant",
  decisionsWarningLabel: "Avertissement",
  decisionsEmptyValue: "—",
  decisionsEmpty:
    "Aucune décision n'a encore été consignée dans cette conversation. Cette section se remplit à mesure que les " +
    "contrôles didactiques sont effectués avec l'assistance.",

  pickerGroupLabel: "Sélection",
  pickerRequiredLabel: "obligatoire",
  pickerAnsweredLabel: "répondu",
  pickerAnsweredBadge: "RÉPONDU",
  pickerSubmitLabel: "Valider",
  pickerOtherLabelFallback: "Autre — je le décris moi-même",
  checklistGroupLabel: "Liste de contrôle des décisions",
  checklistAnsweredLabel: "répondu",
  checklistAnsweredBadge: "RÉPONDU",
  checklistSubmitLabel: "Appliquer",

  toolFallbackLabel: "Travaille…",
  toolReadLabel: "Lit la source",
  toolWriteLabel: "Écrit le fichier",
  toolEditLabel: "Modifie le fichier",
  toolGrepLabel: "Cherche dans le corpus",
  toolFindLabel: "Cherche des fichiers",
  toolLsLabel: "Liste le répertoire",
  toolPickerLabel: "Pose une question",
  toolChecklistLabel: "Affiche la liste de contrôle",
  toolCiteLabel: "Cite une source",
  toolCanvasLabel: "Met à jour le canvas",
  toolProfileLabel: "Met à jour le profil",
  toolStepLabel: "Met à jour l'étape",
  toolMaturityLabel: "Met à jour la maturité",
  toolWikiLabel: "Lit le wiki",
  toolSupportLabel: "Enregistre la préférence d'accompagnement",
  toolStatusRunning: "en cours",
  toolStatusDone: "terminé",
  toolStatusError: "erreur",
  toolProfileAssumptionNote:
    "Une hypothèse déduite de notre conversation — pas un fait établi. Vous pouvez la remplacer dans le panneau Profil.",
  toolPickerCallFailed: "L'appel de l'outil de sélection a échoué",
  toolChecklistCallFailed: "L'appel de l'outil de liste de contrôle a échoué",
  toolPickerSpecRejected: (p) => `Spécification de sélection rejetée : ${p.detail}`,
  toolChecklistSpecRejected: (p) => `Spécification de liste de contrôle rejetée : ${p.detail}`,
  toolSpecDetailArgsMissing: "args est absent ou n'est pas un objet",
  toolSpecDetailQuestionMissing: "question est absent ou vide",
  toolSpecDetailOptionsMissing: "options est absent ou n'est pas un tableau",
  toolSpecDetailOptionsTooFew: (p) => `options doit contenir au moins 2 entrées (reçu : ${p.count})`,
  toolSpecDetailOptionNotObject: (p) => `options[${p.index}] n'est pas un objet`,
  toolSpecDetailOptionIdEmpty: (p) => `options[${p.index}].id est vide`,
  toolSpecDetailOptionLabelEmpty: (p) => `options[${p.index}].label est vide`,
  toolSpecDetailPresentationInvalid: "presentation doit valoir 'checklist' ou 'progress-bar'",
  toolSpecDetailItemsMissing: "items est absent ou n'est pas un tableau",
  toolSpecDetailItemsTooFew: (p) => `items doit contenir au moins 2 entrées (reçu : ${p.count})`,
  toolSpecDetailItemNotObject: (p) => `items[${p.index}] n'est pas un objet`,
  toolSpecDetailItemIdEmpty: (p) => `items[${p.index}].id est vide`,
  toolSpecDetailItemLabelEmpty: (p) => `items[${p.index}].label est vide`,

  maturityCriterionSocietalChallenge: "Challenge sociétal (réel)",
  maturityCriterionStakeholderInvolvement: "Implication des parties prenantes",
  maturityCriterionInterdisciplinarity: "Inter-/transdisciplinaire",
  maturityCriterionStudentAgency: "Autonomie des étudiantes et étudiants et rôle du corps enseignant",
  maturityCriterionIterativeProcess: "Processus d'apprentissage itératif",
  maturityCriterionValueReflection: "Orientation vers les valeurs, réflexion",
  maturityCriterionSocietalImpact: "Impact sociétal et transférabilité",

  maturityLevelShort1: "L1 — CBE light",
  maturityLevelShort2: "L2 — good practice",
  maturityLevelShort3: "L3 — full-fledged",
  maturityLevelFull1: "Niveau 1 «CBE light / challenge-inspired»",
  maturityLevelFull2: "Niveau 2 «CBE good practice / challenge-oriented»",
  maturityLevelFull3: "Niveau 3 «full-fledged CBE / transformative»",

  maturityGlossSocietalChallenge1: "Un sujet réel est évoqué, mais le challenge est prédéfini et fermé.",
  maturityGlossSocietalChallenge2:
    "Les étudiantes et étudiants travaillent sur un challenge ouvert, ancré dans un enjeu sociétal ou régional réel.",
  maturityGlossSocietalChallenge3:
    "Le challenge émane d'une partie prenante réelle, est véritablement ouvert et vise une valeur sociétale au-delà du cours.",
  maturityGlossStakeholderInvolvement1:
    "Les parties prenantes interviennent comme conférencières ou fournisseuses de cas.",
  maturityGlossStakeholderInvolvement2:
    "Les parties prenantes interagissent avec les étudiantes et étudiants à des moments définis (p. ex. briefing, retour).",
  maturityGlossStakeholderInvolvement3:
    "Les parties prenantes agissent comme porteuses du challenge ou co-créatrices tout au long du processus d'apprentissage.",
  maturityGlossInterdisciplinarity1:
    "Les étudiantes et étudiants sont encouragés à considérer d'autres perspectives, sans intégration structurelle.",
  maturityGlossInterdisciplinarity2: "Plusieurs disciplines ou domaines de savoir sont explicitement intégrés.",
  maturityGlossInterdisciplinarity3:
    "Les savoirs académiques et non académiques sont co-produits de manière transdisciplinaire et structurellement ancrés.",
  maturityGlossStudentAgency1: "Les étudiantes et étudiants disposent de choix limités dans un cadre prédéfini.",
  maturityGlossStudentAgency2:
    "Les étudiantes et étudiants prennent les décisions clés ; le corps enseignant agit surtout comme accompagnateur.",
  maturityGlossStudentAgency3:
    "Les étudiantes et étudiants assument pleinement le processus du challenge ; le corps enseignant rend possible, coache et fait réfléchir.",
  maturityGlossIterativeProcess1: "Quelques activités pratiques, mais peu d'itération ou de retours.",
  maturityGlossIterativeProcess2: "Des phases d'apprentissage structurées avec des boucles de retour et de réflexion.",
  maturityGlossIterativeProcess3:
    "Plusieurs cycles itératifs de test, de retour, de réflexion et d'adaptation sont au centre.",
  maturityGlossValueReflection1:
    "La réflexion orientée vers les valeurs est mentionnée, mais pas traitée systématiquement.",
  maturityGlossValueReflection2:
    "Les étudiantes et étudiants réfléchissent aux implications éthiques et à l'impact sociétal de leurs solutions.",
  maturityGlossValueReflection3:
    "La réflexion éthique et la pesée des valeurs sont ancrées tout au long du processus du challenge.",
  maturityGlossSocietalImpact1: "La pertinence sociétale possible est discutée, mais pas mise en oeuvre.",
  maturityGlossSocietalImpact2: "Les résultats sont partagés avec les parties prenantes ou les communautés concernées.",
  maturityGlossSocietalImpact3:
    "Les résultats contribuent, au-delà du cours, à un changement réel, à des décisions ou à des suites concrètes.",

  maturityTargetUnsettled:
    "L'ambition globale de la conception doit encore être clarifiée avec la personne enseignante.",
  maturityAchievedNotDue: "L'évaluation de l'atteint n'est pas encore due : aucun critère n'a été évalué.",
  maturityDiscussDisplay: (p) => `Discuter de la maturité : ${p.label}`,
  maturityAssessDisplay: "Évaluer la maturité de la conception",
  maturityAssessLabel: "Évaluer la maturité",
  maturityAssessTitle: "Demander à l'assistance d'évaluer la maturité de la conception pour le panneau CBE Maturity",
  maturityAssessLockedReason: (p) => `${p.runLocked} L'évaluation CBE Maturity ne peut démarrer qu'ensuite.`,
  maturityAssessNoSession:
    "Aucune conversation n'est encore ouverte — l'évaluation CBE Maturity se déroule au sein d'une conversation.",
  maturityPanelIntroEmpty:
    "L'évaluation de la maturité montre où se situe actuellement la conception de votre module sur le continuum " +
    "PIONEER — trois niveaux (CBE light, good practice, full-fledged) lus à travers sept critères — ainsi que le " +
    "niveau cible que vous visez. Elle est établie tôt à partir de votre matériel et de votre conversation avec " +
    "l'assistance, puis appartient à ce cours — elle reste avec le cours lorsque vous démarrez une nouvelle " +
    "session. Rien n'a encore été évalué pour ce cours.",
  maturityPanelIntroRaster:
    "Comment l'assistance lit actuellement la maturité CBE de cette conception. Les niveaux sont lus à partir de " +
    "votre matériel et de cette conversation — ce sont des hypothèses de travail, pas un verdict ; utilisez " +
    "«Discuter dans le chat» sur un critère pour les corriger ou les développer.",
  maturityPanelIntroNoRaster:
    "Comment l'assistance lit actuellement la maturité CBE de cette conception. Les sept critères sont lus à partir " +
    "de votre matériel et de cette conversation dès que la conception a assez de substance pour les y confronter.",
  maturityThinClosingEmpty: "Vous pouvez tout de même demander une évaluation — elle sera marquée comme provisoire.",
  maturityThinClosingPopulated:
    "D'ici là, l'évaluation reste étroite — «Évaluer la maturité» l'actualise par rapport à ce qui est sur la table.",
  maturityThinHeading: "Base de preuves encore mince :",
  maturityThinNoMaterial: "aucun matériel intégré pour l'instant",
  maturityThinDocuments: (p) => `${p.count} document(s) intégré(s)`,
  maturityThinArtefacts: (p) => `${p.count} artefact(s) de conception consigné(s)`,
  maturityThinSteps: (p) => `${p.count} étape(s) de conception abordée(s)`,
  maturityThinGap: (p) =>
    `${p.have}. Apporter du matériel, ou clarifier des décisions sur une deuxième étape de conception, donne une évaluation plus solide.`,
  maturityUnknownProvenance:
    "Cette évaluation a été consignée plus tôt dans ce cours. Sa base de preuves n'est plus reconstituable ici ; " +
    "rien n'est donc affirmé sur la qualité de ses appuis ni sur son actualité. Utilisez «Évaluer la maturité» " +
    "ci-dessous pour une évaluation de la conception telle qu'elle se présente aujourd'hui.",
  maturityStaleHeading: "Plus à jour :",
  maturityStaleBody: (p) =>
    `la conception a évolué depuis cette évaluation — ${p.changes}${p.more}. Les niveaux ci-dessous sont le ` +
    `dernier état consigné. Utilisez «Évaluer la maturité» ci-dessous pour les actualiser.`,
  maturityStaleMore: (p) => ` (+${p.omitted} autre${p.omitted < 2 ? "" : "s"} modification${p.omitted < 2 ? "" : "s"})`,
  maturityStaleChangeIngestion: (p) => `matériel intégré${p.label ? ` : «${p.label}»` : ""}`,
  maturityStaleChangeStepDepth: (p) => `l'étape de conception ${p.step ?? "?"} a atteint une nouvelle profondeur`,
  maturityStaleChangeArtefactSet: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `étape ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact modifié${p.label ? ` : «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactCleared: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `étape ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact vidé${p.label ? ` : «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactDeleted: (p) => {
    const facts = [p.id ? `ID ${p.id}` : undefined, p.step ? `étape ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact supprimé${p.label ? ` : «${p.label}»` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityProvisionalHeading: "Provisoire :",
  maturityProvisionalBody:
    "cette évaluation a été consignée alors que peu d'éléments étaient disponibles ; elle repose donc sur une base de preuves mince.",
  maturityProvisionalSufficient:
    "Depuis, davantage a été clarifié — utilisez «Évaluer la maturité» ci-dessous pour une évaluation de la conception telle qu'elle se présente aujourd'hui.",
  maturityTargetExceeded: "cible dépassée",
  maturityTargetReached: "cible atteinte",
  maturityTargetLevel: (p) => `cible L${p.level}`,
  maturityNotYetAssessed: "pas encore évalué",
  maturityCurrentPrefix: (p) => `actuel ${p.level}`,
  maturityUncertainRow: "incertain, preuves faibles",
  maturityUncertainBadge: "incertain · preuves faibles",
  maturityCappedRow: "un constat ouvert plafonne ce critère",
  maturityCappedBadge: "constat ouvert · plafonne ce critère",
  maturityDiscussLabel: "Discuter dans le chat",
  maturityDiscussAccessibleName: (p) => `Discuter de la maturité : ${p.label}`,
  maturityDiscussTitle: "Discuter de ce critère dans le chat",
  maturityHeaderTargetLabel: "Maturité cible",
  maturityHeaderAchievedLabel: "Total atteint · dérivé",
  maturityHeaderTargetAccessible: (p) => `Maturité cible déclarée : ${p.value}`,
  maturityHeaderAchievedAccessible: (p) =>
    `Évaluation globale dérivée de l'atteint : ${p.value}, ${p.derivation}${p.note}`,
  maturityHeaderNotDueAccessible: (p) => `Évaluation globale de l'atteint : ${p.value}${p.note}`,
  maturityRecordedLimitation: (p) => `. Limite consignée : ${p.note}`,
  maturityDerivation: (p) => `dérivé de ${p.contributing} critères évalués sur ${p.total} · moyenne ${p.mean}`,
  maturityDerivationCapped: (p) => `${p.base} · plafonné à ${p.level} par le constat ouvert sur ${p.criterion}`,

  panelLeftLabel: "Panneau de gauche",
  panelRightLabel: "Panneau de droite",
  panelRightTabsLabel: "Onglets du panneau de droite",
  panelCanvasTab: "CBE Process Canvas",
  panelMaturityTab: "CBE Maturity",
  panelCoursesTitle: "Cours",
  panelExpandLeft: "Déplier le panneau de gauche",
  panelCollapseLeft: "Replier le panneau de gauche",
  panelExpandRight: "Déplier le panneau de droite",
  panelCollapseRight: "Replier le panneau de droite",
  panelOpenCourses: "Ouvrir les cours",
  panelOpenCoursesWithNote: (p) => `Ouvrir les cours (${p.note})`,
  panelCoursesTitleWithNote: (p) => `Cours — ${p.note}`,
  panelAgentRunningElsewhere: "L'agent travaille dans un autre cours",
  panelRunFinishedElsewhere: "Une exécution s'est terminée dans un autre cours",
  panelIngestRunning: (p) => `Intégration du wiki en cours (${p.settled} sur ${p.total} documents)`,
  panelOpenTab: (p) => `Ouvrir ${p.label}`,
  panelOpenTabUnseen: (p) => `Ouvrir ${p.label} (modifications non vues)`,
  panelTabUnseenTitle: (p) => `${p.label} — modifications non vues`,
  panelTabUnseenLabel: (p) => `${p.label} (modifications non vues)`,
  workspaceResizeLeft: "Ajuster la largeur du panneau de gauche",
  workspaceResizeRight: "Ajuster la largeur du panneau de droite",

  coursesAgentRunning: "L'agent travaille",
  coursesUnseenResult: "Résultat non vu",
  coursesUnseenResultTitle: "Une exécution en arrière-plan est terminée — passez-y pour voir le résultat",
  coursesIntro:
    "Vos cours. Chaque cours est un dossier autonome contenant ses sessions, son canvas, son wiki et ses matériaux.",
  coursesActiveBadge: "actif",
  coursesDetailsLabel: "Détails du cours",
  coursesWikiAtomCount: (p) => `${p.count} atome${p.count < 2 ? "" : "s"} de wiki`,
  coursesNewCourse: "Nouveau cours",
  coursesNewCourseTitlePlaceholder: "Titre du nouveau cours",
  coursesCreateLabel: "Créer le cours",
  coursesCancelLabel: "Annuler",
  coursesSaveLabel: "Enregistrer",
  coursesRenameLabel: "Renommer",
  coursesDeleteLabel: "Supprimer le cours",
  coursesBack: "← Retour",
  coursesKicker: "Cours",
  coursesTitleFieldLabel: "Titre du cours",
  coursesSetActive: "Définir comme actif",
  coursesConfirmDeletionLabel: "Confirmer la suppression du cours",
  coursesDeleteConfirmText: (p) =>
    `Supprimer «${p.title}» ? Ses conversations, la conception du module dans le CBE Process Canvas, son wiki et ` +
    `les matériaux intégrés disparaissent avec lui. Le dossier du cours est déplacé vers la corbeille de votre système, d'où vous pouvez le restaurer.`,
  coursesMoveToTrash: "Mettre à la corbeille",
  coursesDeletedTrashed: (p) => `Le cours «${p.title}» a été déplacé vers la corbeille de votre système.`,
  coursesDeletedMissing: (p) => `Le cours «${p.title}» ne se trouvait plus sur le disque et a été retiré de la liste.`,
  coursesContentTabsLabel: "Contenu du cours",
  coursesTabChats: "Chats",
  coursesTabWiki: "Wiki",
  coursesChatsLockedReason: "L'agent travaille encore — attendez la fin du tour avant de changer de conversation.",
  coursesConversationsLabel: "Conversations enregistrées",
  coursesConversationsLoading: "Chargement des conversations…",
  coursesConversationsEmpty: "Aucune conversation enregistrée pour l'instant.",
  coursesConversationUndated: "Sans date",
  coursesConversationOpenBadge: "ouverte",
  coursesConversationNoMessages: "Aucun message pour l'instant",
  coursesConversationResumeTitle: (p) => `Reprendre cette conversation (${p.sessionId})`,
  coursesConversationTurnCount: (p) => `${p.count} tour${p.count < 2 ? "" : "s"}`,
  coursesHydrationInFlightSwitchNotice:
    "La conversation est encore en cours d'ouverture — patientez un instant avant de changer de cours.",

  wikiBack: "← Wiki",
  wikiAtomMeta: (p) => `${p.type} · confiance ${p.confidence} · mis à jour ${p.updated}`,
  wikiRelated: "Liés",
  wikiSearchPlaceholder: "Rechercher des atomes",
  wikiSearchLabel: "Rechercher dans les atomes du wiki",
  wikiKnowledgeGraph: "Graphe de connaissances",
  wikiList: "Liste",
  wikiInvalidAtoms: (p) =>
    p.count < 2
      ? `${p.count} fichier sous wiki/ n'a pas passé la validation des atomes — ouvrez le dossier pour le corriger.`
      : `${p.count} fichiers sous wiki/ n'ont pas passé la validation des atomes — ouvrez le dossier pour les corriger.`,
  wikiEmpty: "Aucun atome pour l'instant — intégrez du matériel pour construire le wiki.",
  wikiNoMatches: "Aucun atome ne correspond à la recherche.",
  wikiNothingToGraph: "Aucun atome à représenter pour l'instant.",
  wikiGraphLabel: "Graphe de connaissances des atomes du wiki",
  wikiOpenAtom: (p) => `Ouvrir l'atome ${p.title}`,
  wikiAtomRowMeta: (p) => `${p.type} · ${p.updated}`,
  wikiIngestLabel: "Intégrer du matériel",
  wikiIngestInactiveCourse: "Activez ce cours pour lancer une nouvelle intégration ici.",
  wikiIngestAbortLabel: "Interrompre",
  wikiIngestNotice: (p) => `${p.done} document(s) atomisé(s)${p.failed ? `, ${p.failed} en échec` : ""}.`,
  wikiIngestAbortedNotice: "Intégration interrompue.",
  wikiIngestAbortUndeliveredNotice:
    "L'intégration a été arrêtée ici. L'interruption n'a atteint aucune atomisation en cours — une intégration déjà lancée se poursuit.",

  settingsGroupModel: "Modèle",
  settingsGroupAppearance: "Apparence",
  settingsGroupAbout: "À propos",
  settingsGroupCorpus: "Corpus",
  settingsThemeLabel: "Thème",
  settingsThemeHint: "Sombre utilise Catppuccin · Clair utilise Latte",
  settingsFlavourLabel: "Variante",
  settingsFlavourHint: "Variante Catppuccin pour le mode sombre",
  settingsAccentLabel: "Accent",
  settingsAccentHint: "14 accents Catppuccin",
  settingsChatTextSizeLabel: "Taille du texte du chat",
  settingsChatTextSizeHint: "taille de police du fil de discussion et du champ de saisie",
  settingsChatTextSizeSmall: "Petite",
  settingsChatTextSizeMedium: "Moyenne",
  settingsChatTextSizeLarge: "Grande",
  settingsInterfaceLanguageLabel: "Langue de l'interface",
  settingsInterfaceLanguageHint: "langue des libellés, menus et messages de l'application",
  settingsInterfaceLanguageGroupLabel: "Langue de l'interface",
  settingsApiKeyStatusLabel: "État de la clé API",
  settingsApiKeySet: "Une clé API est enregistrée",
  settingsApiKeyUnset: "Aucune clé API enregistrée",
  settingsBaseUrlLabel: "URL de base",
  settingsBaseUrlExplanation:
    "L'adresse du point de terminaison compatible OpenAI auquel l'application envoie toutes les requêtes. Elle se " +
    "termine généralement par /v1, p. ex. https://api.example.com/v1.",
  settingsBaseUrlPlaceholder: "https://votre-endpoint-llm/v1",
  settingsModelIdLabel: "ID du modèle",
  settingsModelIdExplanation:
    "L'identifiant exact du modèle attendu par votre point de terminaison, p. ex. gemma-3-27b-it. Copiez-le depuis " +
    "la liste des modèles de votre fournisseur — un ID mal saisi fait échouer chaque requête.",
  settingsModelIdPlaceholder: "id-du-modele",
  settingsApiKeyLabel: "Clé API",
  settingsApiKeyExplanation:
    "La clé secrète qui autorise les requêtes vers votre point de terminaison (commence souvent par sk-). Elle est " +
    "stockée chiffrée sur cet appareil et envoyée uniquement au point de terminaison que vous avez configuré. " +
    "Laisser le champ vide conserve la clé déjà enregistrée ; saisir une nouvelle valeur la remplace.",
  settingsApiKeyPlaceholder: "sk-…",
  settingsKeyRequiredForEndpoint:
    "Une clé est requise pour le nouveau point de terminaison — un identifiant n'est jamais transféré vers une " +
    "autre URL de base. Saisissez la clé de ce point de terminaison pour activer Enregistrer.",
  settingsUnsavedChanges: "Modifications non enregistrées — appuyez sur Enregistrer pour les appliquer.",
  settingsSaved: "Enregistré.",
  settingsSavedWithSwap: (p) => `Enregistré · le chat en cours utilise désormais ${p.modelId}.`,
  settingsSaving: "Enregistrement…",
  settingsSave: "Enregistrer",
  settingsTesting: "Test en cours…",
  settingsTestConnection: "Tester la connexion",
  settingsRequiredFields: "L'URL de base et l'ID du modèle sont obligatoires.",
  settingsContextLengthInvalid: "La longueur de contexte doit être un nombre entier positif (jetons), p. ex. 65536.",
  settingsSwapFailed: (p) =>
    `Enregistré, mais le chat en cours n'a pas pu changer de modèle (${p.error}). Il reste sur le modèle précédent.`,
  settingsTestOk: "Connexion correcte — le point de terminaison a répondu et accepté la clé.",
  settingsTestUnauthorized: (p) =>
    `Non autorisé — le point de terminaison a rejeté la clé API (HTTP ${p.status}). Vérifiez-la ou saisissez-la à nouveau.`,
  settingsTestUnreachable: "Point de terminaison injoignable — vérifiez l'URL de base et votre réseau.",
  settingsTestNotConfigured:
    "Aucune connexion configurée pour l'instant — enregistrez d'abord une URL de base et une clé API.",
  settingsTestHttpError: (p) => `Le point de terminaison a répondu avec HTTP ${p.status} — vérifiez l'URL de base.`,
  settingsAdvanced: "Avancé",
  settingsReasoningLabel: "Reasoning",
  settingsReasoningExplanation:
    "Active le mode de raisonnement explicite du modèle en envoyant un paramètre reasoning_effort. Utile pour les " +
    "modèles hybrides qui, sinon, n'appellent aucun outil (classe Qwen3-A3B) ; laissez-le désactivé pour les " +
    "modèles nativement capables de raisonner comme gpt-oss — certains points de terminaison rejettent ce réglage avec une erreur.",
  settingsReasoningToggleLabel: "Activer le raisonnement",
  settingsReasoningOn: "Activé",
  settingsReasoningOff: "Désactivé",
  settingsReasoningEffortLabel: "Effort de raisonnement",
  settingsReasoningEffortExplanation:
    "Le temps de réflexion que le modèle consacre à chaque réponse — faible répond le plus vite, élevé est le plus " +
    "approfondi. Moyen est une valeur par défaut raisonnable.",
  settingsEffortLow: "faible",
  settingsEffortMedium: "moyen",
  settingsEffortHigh: "élevé",
  settingsContextLengthLabel: "Longueur de contexte",
  settingsContextLengthExplanation:
    "La fenêtre de jetons réelle de votre modèle, p. ex. 65536. Laissez vide pour utiliser la valeur par défaut ; " +
    "une valeur trop grande provoque des erreurs en cours de conversation, une valeur trop petite résume la conversation trop tôt.",
  settingsContextLengthPlaceholder: "p. ex. 65536",
  settingsDeleteApiKey: "Supprimer la clé API",
  settingsConfirmEraseLabel: "Confirmer la suppression de la clé API",
  settingsEraseConfirmText:
    "Supprimer de cet appareil la clé API enregistrée ? Vous devrez saisir à nouveau une clé avant le démarrage de la prochaine session.",
  settingsDeleteKey: "Supprimer la clé",
  settingsCancel: "Annuler",
  settingsKeyErased:
    "Clé API supprimée de cet appareil. Saisissez une nouvelle clé avant de démarrer la prochaine session.",
  settingsLocalityStatement:
    "Votre clé API et tout ce que vous saisissez sont stockés localement sur cet appareil (la clé chiffrée via " +
    "Electron safeStorage lorsque c'est possible) et envoyés uniquement au point de terminaison LLM que vous avez " +
    "configuré — aucun serveur CBE ni aucun autre serveur tiers ne les reçoit.",
  settingsAboutSkill: "Skill",
  settingsAboutSkillVersion: "Version du skill",
  settingsAboutAppVersion: "Version de l'application",
  settingsAboutSkillUpdateStatus: "État de la mise à jour du skill",
  settingsAboutSkillUpdateNotChecked: "Pas encore vérifié ; le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdateUpdated: (p: { version: string }): string => `Skill mis à jour vers ${p.version}.`,
  settingsAboutSkillUpdateUpToDate: (p: { version: string }): string => `Le skill ${p.version} est à jour.`,
  settingsAboutSkillUpdateMetadataInvalid: (p: { field: string }): string =>
    `Mise à jour refusée : métadonnées du pointeur invalides${p.field ? ` (${p.field})` : ""}. Le skill effectif indiqué ci-dessus reste utilisé.`,
  settingsAboutSkillUpdateAppMismatch:
    "Mise à jour refusée : ce skill ne prend pas en charge cette version de l'application. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdateAbiMismatch:
    "Mise à jour refusée : l'ABI de la surface du modèle diffère. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdateToolMismatch:
    "Mise à jour refusée : le contrat des outils diffère. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdatePiMismatch:
    "Mise à jour refusée : la version de Pi testée diffère. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdateIntegrityMismatch:
    "Mise à jour refusée : l'empreinte de l'archive ne correspond pas. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillUpdateUnavailable:
    "La vérification de mise à jour est indisponible. Le skill effectif indiqué ci-dessus reste utilisé.",
  settingsAboutSkillPackIdentity: "Paquet de skill signé",
  settingsAboutSkillPackIdentityValue: (p: {
    channel: string;
    epoch: number;
    sequence: number;
    keyId: string;
  }): string => `${p.channel} · époque ${p.epoch} · séquence ${p.sequence} · clé ${p.keyId}`,
  settingsAboutSkillUpdateSignedRefused: (p: { code: string; field: string }): string =>
    `Mise à jour signée refusée (${p.code}${p.field ? ` : ${p.field}` : ""}). Le skill effectif indiqué ci-dessus reste utilisé.`,
  settingsAboutSkillUpdateSignedUnavailable: (p: { code: string }): string =>
    `La vérification de mise à jour signée est indisponible (${p.code}). Le skill effectif indiqué ci-dessus reste utilisé.`,
  settingsAboutLoading: "chargement…",
  settingsAboutUnavailable: "indisponible",
  settingsPioneerLinkLabel: "Site de PIONEER Alliance",
  settingsPioneerLinkDescription:
    "En savoir plus sur PIONEER Alliance, l'alliance universitaire européenne associée à cette boîte à outils.",
  settingsPioneerExternalCue: "S'ouvre dans votre navigateur système.",
  settingsPioneerOpenFailure: "Le site de PIONEER Alliance n'a pas pu être ouvert. Réessayez.",
  settingsHelpButtonLabel: (p) => `Qu'est-ce que ${p.field} ?`,
  settingsThemeToggleLabel: "Basculer le thème",
  settingsThemeDark: "Sombre",
  settingsThemeLight: "Clair",
  settingsFlavourGroupLabel: "Variante Catppuccin",
  settingsFlavourLatteNote:
    "Le mode clair utilise la palette Latte — le choix de variante ne s'applique qu'au mode sombre.",
  settingsFlavourFrappe: "Frappé",
  settingsFlavourMacchiato: "Macchiato",
  settingsFlavourMocha: "Mocha",
  settingsAccentGroupLabel: "Couleur d'accent",
  settingsAzureHintBefore:
    "Cela ressemble à une ressource Azure OpenAI. La surface compatible OpenAI se trouve généralement sous",
  settingsCleartextWarningBefore: "Ce point de terminaison utilise du",
  settingsCleartextWarningMiddle: "— la clé API circulerait en clair. Utilisez",
  settingsCleartextWarningAfter: ", sauf s'il s'agit d'un réseau local de confiance.",

  corpusVersionLabel: "Version",
  corpusCacheDateLabel: "Date du cache",
  corpusPackIdentityLabel: "Paquet de corpus signé",
  corpusPackIdentityValue: (p: { channel: string; epoch: number; sequence: number; keyId: string }): string =>
    `${p.channel} · époque ${p.epoch} · séquence ${p.sequence} · clé ${p.keyId}`,
  corpusShippedWithApp: "livré avec l'application",
  corpusRefreshing: "Actualisation…",
  corpusRefresh: "Actualiser le corpus",
  corpusEmptyValue: "—",
  corpusUpdated: (p) => `Corpus mis à jour vers la version ${p.version}.`,
  corpusUpToDate: (p) => `Le corpus est à jour (version ${p.version}).`,
  corpusIntegrityMismatch:
    "La mise à jour du corpus a échoué, le contrôle d'intégrité n'a pas correspondu. Le corpus précédent reste chargé.",
  corpusRefreshNotConfigured:
    "Aucun emplacement de mise à jour du corpus n'est configuré pour cette version de l'application.",
  corpusRefreshPointerHttp: (p) =>
    `Impossible de vérifier la présence d'une mise à jour du corpus (HTTP ${p.httpStatus}).`,
  corpusRefreshPointerRead: "Impossible de lire les informations de mise à jour du corpus.",
  corpusRefreshPointerInvalid: "Les informations de mise à jour du corpus sont incomplètes (version/file/sha256).",
  corpusRefreshDownloadHttp: (p) => `Impossible de télécharger la mise à jour du corpus (HTTP ${p.httpStatus}).`,
  corpusRefreshDownloadRead: "Impossible de lire le paquet du corpus téléchargé.",
  corpusRefreshMissingMarker: (p) =>
    `Le paquet du corpus téléchargé ne contient pas le fichier requis ${p.markerFile} au niveau supérieur.`,
  corpusRefreshUnsafeEntry: (p) =>
    `Le paquet du corpus téléchargé contient une entrée non sûre et a été refusé : ${p.entryName}.`,
  corpusRefreshInstallFailed: "Impossible d'installer la mise à jour du corpus.",
  corpusRefreshSignedRefused: (p: { code: string; field: string }): string =>
    `Mise à jour signée du corpus refusée (${p.code}${p.field ? ` : ${p.field}` : ""}). Le corpus actuel reste chargé.`,
  corpusRefreshSignedUnavailable: (p: { code: string }): string =>
    `La mise à jour signée du corpus est indisponible (${p.code}). Le corpus actuel reste chargé.`,
  corpusRefreshUnexpected: "Impossible de terminer l'actualisation du corpus.",
  corpusInfoReloadFailed: "Impossible de recharger les informations du corpus.",

  configPageLabel: "Configuration initiale",
  configGroupLabel: "Connexion LLM · BYO",
  configIntro:
    "Indiquez votre point de terminaison LLM compatible OpenAI. Les données de connexion sont stockées localement " +
    "sur cette machine et chiffrées via Electron safeStorage lorsque c'est possible.",
  configBaseUrlHint: "p. ex. https://router.huggingface.co/v1",
  configApiKeyHint: "stockée localement, jamais partagée",
  configModelIdHint: "p. ex. gpt-4o-mini, gemma-3-27b-it",
  configModelIdPlaceholder: "gemma-3-27b-it",

  profileDimensionPblPriorKnowledge: "Connaissances préalables en PBL",
  profileDimensionCbePriorKnowledge: "Connaissances préalables en CBE",
  profileDimensionDidacticStance: "Posture didactique",
  profileDimensionAttitude: "Attitude envers la CBE",
  profileDimensionCapacity: "Charge d'enseignement / capacité",
  profileReadingHeading: "Comment l'assistance vous perçoit",
  profileReadingIntro:
    "Les estimations proviennent de la conversation et portent leurs indices ; votre réglage manuel prévaut tant que vous ne le modifiez pas.",
  profileOverrideRejected: "Le réglage a été rejeté — la valeur ne figure pas sur l'échelle de la dimension.",
  profileIdentityHeading: "Comment vous souhaitez qu'on s'adresse à vous",
  profileIdentityIntro:
    "Vos propres mots, utilisés par l'assistance pour s'adresser à vous. Les deux champs sont facultatifs et " +
    "indépendants l'un de l'autre — les laisser vides est un choix normal, et rien n'est déduit ni complété à votre place.",
  profileNameLabel: "Nom",
  profileFormOfAddressLabel: "Formule d'adresse souhaitée",
  profileTooLong: (p) => `Trop long — limitez chaque entrée à ${p.max} caractères au maximum.`,
  profileTooLongNothingSaved: (p) =>
    `Trop long — limitez chaque entrée à ${p.max} caractères au maximum. Rien n'a été enregistré.`,
  profileSaveFailed: "Enregistrement impossible — rien n'a été stocké.",
  profileSaved: "Enregistré.",
  profileSave: "Enregistrer",
  profileOverriddenBadge: "défini par vous",
  profileConfidenceBadge: (p) => `confiance · ${p.confidence}`,
  profileNotEstimatedBadge: "pas encore estimé",
  profileAssumptionNote:
    "Une hypothèse déduite de notre conversation — pas un fait établi. Choisissez une valeur ci-dessous pour la remplacer.",
  profileOverrideSelectLabel: (p) => `Définir ${p.dimension}`,
  profileChooseManually: "choisir pour définir manuellement",
  profileLastRevised: (p) => `dernière révision : ${p.stamp}`,

  overlaySectionsLabel: "Sections de la superposition",
  overlaySettingsTab: "Réglages",
  overlayProfileTab: "Profil",
  overlayCloseLabel: "Fermer",

  updateFailed: (p) => `Échec de la mise à jour : ${p.message}`,
  updateDismiss: "Fermer",
  updateDownloading: (p) => `Téléchargement de la mise à jour ${p.version}…`,
  updateDownloaded: (p) => `Mise à jour ${p.version} téléchargée.`,
  updateRestartAndInstall: "Redémarrer et installer",
  updateLater: "Plus tard",
  updateAvailable: (p) => `La version ${p.version} est disponible.`,
  updateChangelog: "Journal des modifications",
  updateInstallNow: "Installer maintenant",
  updateSkipVersion: "Ignorer cette version",

  citationUnknownId: (p) =>
    `Référence non résolue : aucun document du corpus «${p.id}». Cette référence n'a pas pu être vérifiée.`,
  citationMissingSection: (p) =>
    `Référence non vérifiée : aucune section indiquée, elle ne peut donc pas être vérifiée par rapport à ${p.id}. ` +
    `Ouvrez le document pour voir d'où cela provient.`,
  citationUnknownSection: (p) =>
    `Référence non vérifiée : «${p.section}» ne correspond à aucun titre dans ${p.id}. Ouvrez le document pour vérifier vous-même l'affirmation.`,
  citationUnresolvedFlag: "non résolue",
  citationUnverifiedFlag: "non vérifiée",
  citationOpenWikiAtom: (p) => `Ouvrir l'atome de wiki ${p.id}`,
  citationOpenCorpusDocument: (p) => `Ouvrir le document du corpus ${p.id}`,
  citationLoading: "Chargement…",
  citationNotFound: (p) => `Référence introuvable : ${p.id}`,
  citationCorpusMeta: (p) => `corpus ${p.version} · ${p.tags}`,
  citationPathLabel: "chemin :",
  citationCloseLabel: "Fermer",

  docChipLabel: (p) => `Pièce jointe : ${p.name} (${p.type})`,

  ingestUnsupportedFormat: (p) => `Format non pris en charge «${p.ext}». Formats pris en charge : ${p.supported}.`,
  ingestLegacyExcelFormat: (p) =>
    `«${p.ext}» est un format Excel ancien ou avec macros que cette application ne lit pas. Ouvrez le classeur ` +
    `dans Excel, enregistrez-le comme classeur .xlsx, puis réessayez.`,
  ingestNoExtension: "(aucune extension)",
  ingestUnreadableFile: (p) => `Le fichier «${p.filename}» n'a pas pu être lu : ${p.detail}`,
  mainExportDialogTitle: "Exporter le document de conception",
  mainExportFilterMarkdown: "Markdown",
  mainExportInsideApp:
    "Cet emplacement se trouve à l'intérieur de l'application elle-même. Choisissez un dossier dans vos propres fichiers.",
  mainExportWriteFailed: (p) => `Le document de conception n'a pas pu être écrit (${p.reason}). Rien n'a été modifié.`,
  mainIngestDialogTitle: "Intégrer du matériel pédagogique dans le wiki",
  mainIngestFilterMaterial: "Matériel pédagogique",
  mainIngestWrongCourse: (p) =>
    `Cette intégration a été lancée pour un cours qui n'est plus actif. Le matériel n'est intégré que dans le ` +
    `cours actif, actuellement «${p.course}». Activez le cours voulu, puis relancez l'intégration.`,
  mainIngestAlreadyRunning: "Une intégration est déjà en cours pour ce cours",
  mainIngestEndpointUnreachable: (p) =>
    `Le point de terminaison du modèle à ${p.baseURL} est injoignable : la connexion a été refusée, ou l'adresse ` +
    `ne se résout ni ne se route. Démarrez-le, puis réessayez.`,
  mainIngestAborted: "Intégration interrompue",
  mainIngestAtomizationFailed: "Échec de l'atomisation",
  mainProviderNotConfigured: "Fournisseur LLM non configuré",
  mainNoOpenConversation: "Aucune conversation n'est ouverte pour le cours actif.",
  mainArchiveUnreadable:
    "L'archive de la conversation précédente n'a pas pu être lue — une nouvelle conversation démarre. Les fichiers " +
    "restent sur le disque dans le dossier du cours.",
  mainResumeDisabledReason:
    "Fichier JSON associé manquant ou illisible — ouvrez le fichier .md dans un éditeur pour le vérifier",
  mainTurnInFlightNotice:
    "L'agent travaille encore — attendez la fin du tour (ou arrêtez-le) avant de fermer ou de réinitialiser la conversation.",
  mainResumeUnavailableNotice:
    "Cette conversation n'a pas pu être ouverte — son archive est manquante ou illisible. Rien n'a été modifié ; la conversation actuelle reste ouverte.",
  mainResumeWhileOpeningNotice:
    "Une conversation est encore en cours d'ouverture pour ce cours — patientez un instant, puis réessayez.",
  mainPromptBusyNotice:
    "L'agent traite déjà une demande — attendez la fin du tour en cours, puis renvoyez votre message.",
  mainExportEmptyNotice: "Il n'y a encore rien à exporter — aucun artefact du canvas ne porte de valeur.",
  mainFreshStartFailedNotice:
    "La nouvelle session n'a pas pu être démarrée. Votre conversation précédente est enregistrée en sécurité dans le dossier du cours — rien n'est perdu. Réessayez de démarrer la nouvelle session.",
  mainCourseDeleteInFlightNotice:
    "L'agent travaille encore dans ce cours — attendez la fin du tour (ou arrêtez-le) avant de supprimer le cours.",
  mainCourseDeleteIngestingNotice:
    "Du matériel est encore en cours d'intégration dans le wiki de ce cours — cette exécution se termine d'elle-même ; attendez-la (ou interrompez l'intégration) avant de supprimer le cours.",
  mainCourseDeleteOpeningNotice:
    "La conversation de ce cours est encore en cours d'ouverture — cela prend un instant ; réessayez de supprimer le cours une fois qu'elle est ouverte.",
  mainCourseDeleteUnreadableNotice:
    "Le dossier de ce cours se trouve encore sur le disque, mais son course.md n'a pas pu être lu — rien n'a été déplacé vers la corbeille et rien n'a été modifié. Ouvrez le dossier du cours, vérifiez course.md, puis réessayez.",
  mainIngestFileDialogTitle: "Lire du matériel",
  chatCompactionFailedText:
    "Le résumé du contexte a échoué. Votre conversation reste inchangée — vous pouvez continuer à travailler.",
  chatCompactionFailedHint:
    "Si cela se répète, la fenêtre de contexte configurée est peut-être trop petite (Réglages → Longueur de contexte).",
  toolExecutionFailed: "L'exécution de l'outil a échoué",
  ringExplanationPending:
    "Cette conversation est résumée automatiquement pour libérer de la place. La nouvelle valeur suit sous peu.",
  ringExplanationFresh:
    "Longueur de la conversation : pas encore mesurée. La première mesure arrive avec la première réponse.",
  ringExplanationCarried:
    "Cette conversation transporte un contexte qui ne peut pas être mesuré pour l'instant. La valeur revient avec la prochaine réponse.",
  ringExplanationWindowUnknown: (p) =>
    `Longueur de la conversation : ${p.used} jetons. La taille de la fenêtre de contexte du modèle n'a pas été ` +
    `consignée — aucune proportion n'est donc affichée. Vous pouvez la saisir dans les réglages, groupe «Modèle», ` +
    `sous «Avancé» ; la pastille du modèle à droite y conduit.`,
  ringExplanationMeasured: (p) =>
    `Longueur de la conversation : ${p.percent} % de la fenêtre de contexte — ${p.used} jetons sur ${p.window}.`,
  ringExplanationNearFull:
    "Cette conversation sera bientôt résumée automatiquement pour libérer de la place — c'est normal et ce n'est " +
    "pas un problème. Votre travail dans le CBE Process Canvas, les décisions consignées, la progression dans les " +
    "étapes de conception et l'évaluation CBE Maturity sont tous conservés.",
  ringLabelPending: "Longueur de la conversation : résumé en cours",
  ringLabelFresh: "Longueur de la conversation : pas encore mesurée",
  ringLabelCarried: "Longueur de la conversation : contexte transporté, pas encore mesuré",
  ringLabelWindowUnknown: "Longueur de la conversation : aucune fenêtre de contexte consignée",
  ringLabelMeasured: (p) => `Longueur de la conversation : ${p.percent} %`,
  toolDetailFullRaster: "grille complète",
  toolDetailUnassessed: "non évalué",
  toolDetailStep: (p) => `étape ${p.step}`,
  exportMaturityDerivation: (p) => `dérivé de ${p.contributing} critères évalués sur ${p.total}, moyenne ${p.mean}`,
  exportMaturityDerivationCapped: (p) => `${p.base} ; plafonné par le constat ouvert sur ${p.criterion}`,
  uiRefActiveCourseName: "Nom du cours actif",
  uiRefArtefactNotes: "Notes d'artefact et ↻ Itérer",
  uiRefDeleteArtefact: "Supprimer l'artefact",
  uiRefContextRing: "Anneau de contexte",
  uiRefModelPill: "Pastille du modèle",
  uiRefSendStop: "Envoyer / Arrêter",
  uiRefCourseList: "Liste des cours",
  uiRefCourseDetail: "Détails du cours",
  headerHelpLabel: "Aide",
  headerHelpStartingReason: "La conversation démarre encore — l'aide sera disponible dans un instant.",
};
