/**
 * The English chrome-string catalogue — and the SHAPE SOURCE for every other
 * language (capability `desktop-app`, Requirement: *Each Rendered Chrome String
 * Has Exactly One Owner*).
 *
 * Every string the app itself renders lives here: visible labels, accessible
 * names and descriptions, `title` text, placeholders, menu entries and their
 * disabled reasons, confirmation, refusal, error and status copy, and the
 * operator-facing messages the main process composes for display. A component
 * resolves an entry; it never writes a literal of its own.
 *
 * **This file has no imports on purpose.** `ChromeCatalogue` is derived from it
 * (`types.ts`), so a language file can be checked against it without a cycle —
 * and the corpus-schema generator can `import()` it directly under Node's
 * type-stripping to resolve label placeholders (`ui-reference-gen.ts`).
 *
 * **Keys are flat and camelCase**, prefixed by the surface they belong to. Flat
 * because a key is also a value elsewhere: a UI registry entry's `label` field
 * and a `{{key}}` placeholder inside its prose both name one of these
 * (capability `ui-reference-generation`, Requirement: *UI Element Registry*).
 *
 * **A parametrised entry is a function over ONE typed parameter object**, so a
 * language cannot silently change an interpolation's shape — the parameter type
 * is declared here and every other language inherits it. That a translation
 * actually USES its parameters is not a type question and is asserted instead by
 * `packages/app/tests/i18n-completeness.test.ts`.
 *
 * **Two classes of string are deliberately NOT here.** Values the skill supplies
 * that the app merely renders (a Picker's `otherLabel`, a maturity `hint`) are
 * lecturer-language content passing through a chrome surface — only the app's own
 * last-resort fallback for such a value is chrome. And an invariant violation
 * thrown at a programmer (`Session already open: …`) is a diagnostic, not copy;
 * `chrome-inline-literals.test.ts` names that boundary where it applies it.
 */
export const en = {
  // ───────────────────────────── Language identity ─────────────────────────
  /** Endonyms. The Settings list is derived from the shipped catalogues rather
   * than translated per active language — a lecturer who has landed in a
   * language they cannot read must still find their own — and each option's name
   * is read from the catalogue of the language it names, so correcting `de.ts`
   * corrects the German option. The catalogue SHAPE is uniform, so every file
   * carries every endonym key; only its own is the one the registry reads. */
  languageNameEn: "English",
  languageNameDe: "Deutsch",
  languageNameFr: "Français",
  languageNameIt: "Italiano",

  // ───────────────────────────── App shell ─────────────────────────────────
  appHydrationPaneLabel: "Opening conversation",
  appHydrationTitle: "Opening your conversation…",
  appHydrationSub: "First run installs the agent runtime — this can take 1–2 minutes.",
  appHydrationErrorLabel: "Conversation could not be opened",
  appHydrationErrorTitle: "Could not open the conversation",
  appHydrationUnknownError: "Unknown error",
  appRetry: "Retry",
  appDismissError: "Dismiss error",
  appDismissNotice: "Dismiss notice",

  // ───────────────────────────── Native application menu ──────────────────
  menuApplication: "CBE Toolbox",
  menuFile: "File",
  menuEdit: "Edit",
  menuView: "View",
  menuWindow: "Window",
  menuHelp: "Help",
  menuAbout: "About CBE Toolbox",
  menuSettings: "Settings…",
  menuQuit: "Quit CBE Toolbox",
  menuExit: "Exit",
  menuCloseWindow: "Close Window",
  menuUndo: "Undo",
  menuRedo: "Redo",
  menuCut: "Cut",
  menuCopy: "Copy",
  menuPaste: "Paste",
  menuSelectAll: "Select All",
  menuZoomIn: "Zoom In",
  menuZoomOut: "Zoom Out",
  menuResetZoom: "Actual Size",
  menuToggleFullScreen: "Toggle Full Screen",
  menuReload: "Reload",
  menuToggleDeveloperTools: "Toggle Developer Tools",
  menuMinimize: "Minimize",
  menuBringAllToFront: "Bring All to Front",
  menuCbeHelp: "CBE Toolbox Help",
  menuPioneerWebsite: "PIONEER Alliance Website",
  menuWorkspaceUnavailable: "The workspace is not ready yet.",
  menuModalUnavailable: "Close the open dialog first.",

  // ───────────────────────────── Header strip ──────────────────────────────
  headerLabel: "App header",
  /** The product's own name — a proper name, identical in every language. */
  headerAppName: "CBE Toolbox",
  headerNoActiveCourse: "no active course",
  headerShowCoursesLabel: (p: { course: string }): string => `Show courses — active course: ${p.course}`,
  headerShowCoursesTitle: "Show courses",
  headerOpenSettings: "Open settings",
  headerOpenSettingsUnsaved: "Open settings — unsaved changes",
  headerSettingsTitle: "Settings",
  headerSettingsTitleUnsaved: "Settings — unsaved changes",
  headerOpenProfile: "Open profile",
  headerProfileTitle: "Profile",
  headerLanguageLabel: "Interface language",
  headerLanguageAccessibleName: (p: { language: string; code: string }): string =>
    `Interface language: ${p.language} (${p.code})`,
  headerLanguageBusy: "Changing interface language…",
  headerLanguageFailure: "The interface language could not be changed. Try again.",

  // ───────────────────────────── Chat surface ──────────────────────────────
  chatConversationLabel: "Conversation",
  // ───────────────────────── First-use orientation ────────────────────────
  onboardingHeading: "Welcome to CBE Toolbox",
  onboardingValue: (p: { course: string }): string =>
    `A ${p.course} is your unit of work: develop or adapt a CBE module and examine its coherence in conversation. You bring the module knowledge and make the decisions; the assistant does not deliver a finished module.`,
  onboardingCourseNavigation: (p: { course: string }): string =>
    `The header names the active ${p.course}. Create and switch courses in the left list; rename or delete one in its details.`,
  onboardingCourseChats: (p: { chats: string; wiki: string }): string =>
    `Those details also hold its ${p.chats}, the course’s stored conversations, and its ${p.wiki}; opening details alone does not switch courses.`,
  onboardingWikiReuse: (p: { wiki: string }): string =>
    `Import local teaching material through the active course’s ${p.wiki} to create reusable, topic-sized knowledge entries you can browse.`,
  onboardingWikiGrounding: "The assistant can read and cite those entries to ground work in your material.",
  onboardingAttachmentDistinction:
    "A chat attachment supplies this conversation instead; it does not populate the Wiki.",
  onboardingDesign:
    "Work with the assistant in conversation. The right-hand CBE Process Canvas records the ten-step work for the active course; CBE Maturity assesses what is recorded, not certification.",
  onboardingNextAction:
    "Describe your module and what you want to work on, or bring an existing question or material. An attachment or Wiki import is optional.",
  onboardingHelpAndReread: (p: { about: string }): string =>
    `Use the question mark in the header for conversational help; reread this overview in the settings overlay’s ${p.about} group.`,
  onboardingBegin: "Begin",
  onboardingSkip: "Skip",
  onboardingClose: "Close overview",
  onboardingReread: "Reread the first-use overview",
  onboardingAvailability: "A first-use overview is available above the conversation.",
  onboardingReadFailure:
    "The first-use preference could not be read. The overview remains available and may appear again.",
  onboardingWriteFailure:
    "The overview was dismissed for this app session, but that preference could not be saved. It may reappear after restart.",
  chatRoleAssistant: "CBE skill",
  chatRoleLecturer: "Lecturer",
  /** Locked-state reason for the New Session control (the main process enforces
   * the same guard on the IPC). */
  chatNewSessionLockedReason: "The agent is still working — wait for the turn to finish first.",
  /** The composer card's own controls. Says what the New Session reason says,
   * because it is the same fact about the same run; the two stay separate keys
   * because different requirements govern them. */
  chatComposerLockedReason: "The agent is still working — wait for the turn to finish first.",
  chatNewSessionLabel: "New Session",
  chatNewSessionTitle: "Start a new conversation (canvas kept; the current one is kept on disk)",
  chatNewSessionStarting: "Starting new session…",
  chatNewSessionFailedText:
    "The new session could not be started. Your previous conversation is safely saved — nothing is lost.",
  chatNewSessionFailedDetail: "You can find it anytime in Courses.",
  chatNewSessionConfirmLabel: "Confirm new session",
  chatNewSessionConfirmText:
    "Start a new session? Your CBE Process Canvas and CBE Maturity entries are preserved. You can resume this conversation anytime from Courses.",
  chatNewSessionConfirmAction: "Start new session",
  chatCancel: "Cancel",
  /** Supported ingestion formats, named in the upload entry's tooltip. The list
   * itself is NOT owned here: it is passed in, rendered from the one accepted-extension
   * declaration (`@cbe/pi-bridge/ingest-formats`), so a format can never be added for
   * the model and forgotten for the lecturer. Each catalogue owns the sentence around
   * it; the format names are the same tokens in every language. */
  chatIngestFormatsHint: (p: { formats: string }): string => `Read existing material (${p.formats}) into the chat`,
  /** The round "+" and the menu it opens. The name is the MENU's, never either
   * entry's — the button performs neither action. */
  chatPlusMenuLabel: "More actions",
  chatUploadEntryLabel: "Upload files",
  chatHelpEntryLabel: "Help",
  /** The message field's accessible name. The visible placeholder is gone in both
   * states; an unnamed textbox is not self-evident to assistive technology, so
   * the field keeps a STATIC name that never names the lock. */
  chatComposerFieldLabel: "Message",
  chatSendLabel: "Send",
  chatSendTitle: "Send (Enter)",
  /** The send slot's SECOND state — one of the two carriers of the composer lock
   * that do not depend on colour, so it names what it stops. */
  chatStopLabel: "Stop the answer",
  chatStopPendingLabel: "Stopping the answer…",
  chatStopCompactionReason: "The context is being summarised — that runs to the end and cannot be stopped.",
  chatStoppedTurnMarker: "You stopped this answer — it is incomplete.",
  /** The whole turn a stop that streamed nothing leaves behind. Written into the
   * transcript at the moment of the stop; a turn already recorded keeps the
   * wording it was recorded with. */
  chatStoppedTurnPlaceholder: "You stopped this answer before it began.",
  chatStopTimedOutNoticeText:
    "Stopping is taking longer than expected — the assistant has not released this turn yet. " +
    "The message field stays locked until it does, so nothing you send can collide with it.",
  chatStopTimedOutRecoveryLabel: "Force-close this conversation",
  chatStopTimedOutRecoveryConfirm:
    "Force-close ends this conversation without waiting for the assistant and starts a fresh one. " +
    "Your work is kept — the module design on the CBE Process Canvas, the recorded decisions, the design-step " +
    "progress and the CBE Maturity reading — and the conversation is archived on disk.",
  chatForceCloseBusy: "Closing…",
  chatForceCloseAction: "Force-close and start fresh",
  chatForceCloseFailed:
    "The conversation could not be force-closed. Your work is safely saved in the course folder — try again.",
  chatModelPillBlankLabel: "No model configured",
  /** The pill's PURPOSE — the stable half a test locates it by. The Settings
   * group is quoted exactly as that surface renders it. */
  chatModelPillPurpose: 'Open the model settings (Settings, "Model" group)',
  chatModelPillAccessibleName: (p: { purpose: string; modelId: string }): string =>
    `${p.purpose} — model: ${p.modelId}`,
  chatPendingAttachmentsLabel: "Attached documents",
  chatRemoveAttachmentLabel: (p: { filename: string }): string => `Remove ${p.filename}`,
  chatNoTextExtractedProblem: (p: { filename: string }): string =>
    `"${p.filename}": no text extracted — a scanned PDF, or an empty document?`,
  chatReasoningEnabledNotice: "Reasoning enabled — send your message again, now with reasoning_effort.",
  chatReasoningSwapFailed: (p: { error: string }): string =>
    `Could not enable reasoning on the running session (${p.error}). The chat is unchanged.`,
  chatReasoningOffer:
    "The model replied without calling any tool — typical for a reasoning-hybrid model run without " +
    "reasoning_effort. Enable reasoning and retry?",
  chatEnablingReasoning: "Enabling…",
  chatEnableReasoning: "Enable reasoning",
  chatDismissReasoningSuggestion: "Dismiss reasoning suggestion",
  chatNotNow: "Not now",
  chatDismissNotice: "Dismiss notice",
  chatHelpAnnouncement: "Help request sent to the assistant.",
  /** The visible turn a help dispatch leaves in the transcript. The machine token
   * the model receives is a payload, not chrome, and does not move with it. */
  chatHelpDisplayText: "Help requested",
  chatContinueLabel: "Continue",
  chatContinueTitle: "Let the model complete the cut-off answer",
  chatRetryLabel: "Retry",
  chatRetryTitle: "Ask the model to answer the previous request again in full",
  chatJumpToLatestLabel: "Jump to latest message",
  chatJumpToLatestText: "Jump to latest",
  chatWorkingDisclosureLabel: "Working…",
  chatWorkingDetailLabel: "Current technical activity",
  chatWorkingDetailEmpty: "Waiting for the next activity…",
  chatWorkingToolActivityLabel: (p: { action: string; status: string }): string =>
    `Tool activity: ${p.action} (${p.status})`,
  chatInteractionUnavailable: "This question is unavailable. Continue in the message field.",
  /** The reasoning block's own header, live and settled. */
  chatThinkingHeadLive: "thinking…",
  chatThinkingHeadDone: "thinking",
  chatThinkingEmptyBody: "…",
  /** The slash-command popup. */
  chatSlashCommandsLabel: "Slash commands",

  // ───────────────────────── Error and notice copy ─────────────────────────
  /** Locked-affordance reason, shared idiom across the iteration toolbar and the
   * Maturity panel. NOT the canvas step-select affordance, which dispatches no
   * prompt and is outside the lock. */
  errorRunLockedReason: "The agent is still working — wait for the turn to finish.",
  errorBusyNoticeText: "The assistant is still working — try again when it finishes.",
  errorAuthBillingText:
    "The model provider rejected the request — it reports missing credits or an invalid API key. " +
    "Check your provider account or the LLM connection in Settings, then send your message again.",
  errorGenericProviderText:
    "The model provider could not complete the request. Your conversation is unchanged — " +
    "try again; the full error detail is in the session log.",
  /** The tool-loop abort note. Rendered to the lecturer twice — as the error
   * notice and as the assistant turn the abort appends — and matched back in
   * every shipped language by `textMatchesAnyLanguage`, so a documented abort is
   * never flattened into the generic provider copy. */
  errorLoopAbortNote:
    "I kept calling the same tool without making progress and stopped to avoid looping. " +
    "Please rephrase or try again.",

  // ───────────────────── CBE Process Canvas (right panel) ──────────────────
  canvasIterateLabel: "↻ Iterate",
  canvasNoAnnotationsLabel: "no notes",
  canvasAnnotationCountLabel: (p: { count: number }): string => `${p.count} note${p.count === 1 ? "" : "s"}`,
  canvasRemoveAnnotationLabel: "Remove note",
  canvasAnnotationInputPlaceholder: "Note on this artefact…",
  canvasAnnotationAddLabel: "Add",
  canvasAnnotateToggleLabel: "+ Note",
  canvasExportLabel: "Export",
  canvasExportBusy: "Exporting…",
  canvasExportTitle: "Export this course's design document from the CBE Process Canvas panel to a file",
  canvasExportNoSession: "No conversation is open yet.",
  canvasExportNothing: "Nothing to export yet — no artefact on the CBE Process Canvas carries a value.",
  canvasExportDone: (p: { path: string }): string => `Saved to ${p.path}`,
  canvasDeleteArtefactLabel: (p: { label: string }): string => `Delete ${p.label}`,
  canvasDeleteArtefactTitle: "Delete this artefact",
  canvasDeleteConfirmLabel: (p: { label: string }): string => `Delete ${p.label}?`,
  canvasDeleteConfirmText: (p: { label: string }): string =>
    `Delete "${p.label}"? Its content is cleared from the CBE Process Canvas; it stays in the conversation history.`,
  canvasDeleteAction: "Delete",
  canvasEmptyValue: "—",
  canvasFocusMarkerLabel: "in focus",
  canvasFocusMarkerText: "focus",
  canvasStepFocusLabel: (p: { step: number; name: string }): string => `Focus on step ${p.step}: ${p.name}`,
  canvasStepFocusTitle: "Focus this step",

  /** The ten design-step group headers, in §4.6 flow order. */
  canvasStep1Name: "Set the Frame",
  canvasStep2Name: "Learning Outcomes",
  canvasStep3Name: "Assessment",
  canvasStep4Name: "Challenge",
  canvasStep5Name: "Stakeholder",
  canvasStep6Name: "Learning Journey",
  canvasStep7Name: "Activities",
  canvasStep8Name: "Deliverables",
  canvasStep9Name: "Alignment Check",
  canvasStep10Name: "Prepare",

  /** The four Step-6 learning-journey elements. */
  canvasJourneyEngage: "Engage",
  canvasJourneyInvestigate: "Investigate",
  canvasJourneyAct: "Act / Prototype",
  canvasJourneyReflect: "Reflect and present",

  /** One label per canonical artefact slot. Labels and ids are governed
   * separately: a label correction never renames an id. */
  canvasArtefactModuleframe: "Module Meta / Constraints",
  canvasArtefactLearningoutcomes: "Learning Outcomes",
  canvasArtefactAssessmentblueprint: "Assessment Blueprint",
  canvasArtefactBigidea: "Big Idea",
  canvasArtefactEq: "Essential Question",
  canvasArtefactChallenge: "Challenge Statement",
  canvasArtefactStakeholderplan: "Stakeholder & Engagement Plan",
  canvasArtefactEs: "Engage Sequence",
  canvasArtefactIs: "Investigate Sequence",
  canvasArtefactAs: "Act Sequence",
  canvasArtefactRs: "Reflect Sequence",
  canvasArtefactActivityplan: "Learning Activity Plan",
  canvasArtefactDeliverablesmap: "Deliverables Map",
  canvasArtefactAlignmentmatrix: "Alignment Matrix + Fixes",
  canvasArtefactReadinesschecklist: "Delivery & Readiness Checklist",

  canvasStateDone: "done",
  canvasStateActive: "active",
  canvasStateDraft: "draft",
  canvasStateOpen: "open",
  canvasDepthOpen: "open",
  canvasDepthRough: "rough",
  canvasDepthRefined: "refined",
  canvasDepthDetailed: "detailed",

  /** Design-document export (capability `course-workspace`, Requirement:
   * *Deterministic Design-Document Export from Host State*). The headings are
   * app-authored, so they follow the interface language like every other string
   * the app writes for the lecturer; the artefact VALUES are their content and
   * are exported as recorded. */
  exportDocumentTitle: (p: { course: string }): string => `${p.course} — CBE Module Design`,
  exportGeneratedAt: (p: { stamp: string }): string => `_Exported ${p.stamp} from the recorded canvas state._`,
  exportCourseContextHeading: "Course context",
  exportStepHeading: (p: { step: number; name: string }): string => `Step ${p.step} — ${p.name}`,
  exportCoverage: (p: { depth: string }): string => `_Coverage: ${p.depth}_`,
  exportOpenArtefact: "_(open — not yet decided)_",
  /** The note the Markdown archive carries on a stopped assistant turn — the face
   * a lecturer opens in an editor, so an unmarked half-answer there is the same
   * untruth as an unmarked one in the app. */
  exportStoppedTurnNote: "_(stopped by the lecturer — this answer is incomplete)_",
  exportMaturityHeading: "CBE Maturity",
  exportMaturityColumnCriterion: "Criterion",
  exportMaturityColumnCurrent: "Current",
  exportMaturityColumnTarget: "Target",
  exportMaturityUnassessed: "unassessed",
  exportMaturityLimitation: (p: { note: string }): string => `**Limitation:** ${p.note}`,

  // ───────────────────────── Decisions section ─────────────────────────────
  decisionsHeading: "Decisions",
  decisionsResetBadge: "reset · upstream goal revised",
  decisionsModuleGoals: "Module Goals",
  decisionsNoGoals: "No operative goals yet.",
  decisionsAlignmentStatus: "Alignment Status",
  decisionsAlignmentReset: "Reset — re-run against the revised goal.",
  decisionsNoAlignment: "No alignment findings yet.",
  decisionsDelegation: "Delegation Decisions",
  decisionsDelegationReset: "Reset — re-run against the revised goal/alignment.",
  decisionsNoDelegation: "No delegation decisions yet.",
  decisionsHeterogeneity: "Heterogeneity Notes",
  decisionsSoftSkill: "Soft-Skill Anchors",
  decisionsMissingAnchor: "missing anchor",
  decisionsWarningLabel: "Warning",
  decisionsEmptyValue: "—",
  decisionsEmpty:
    "No decisions have been recorded in this conversation yet. This section fills in as the didactic checks are " +
    "completed with the assistant.",

  // ─────────────────── Generative UI: Picker and Checklist ─────────────────
  pickerGroupLabel: "Picker",
  pickerRequiredLabel: "required",
  pickerAnsweredLabel: "answered",
  pickerAnsweredBadge: "ANSWERED",
  pickerSubmitLabel: "Submit",
  /** The app's own last-resort label for the free-text option. Used only where
   * the skill supplied no `otherLabel` of its own — a skill-supplied one is
   * lecturer-language content and passes through untouched. */
  pickerOtherLabelFallback: "Other — I'll describe it",
  checklistGroupLabel: "Decision checklist",
  checklistAnsweredLabel: "answered",
  checklistAnsweredBadge: "ANSWERED",
  checklistSubmitLabel: "Apply",

  // ───────────────────────────── Tool cards ────────────────────────────────
  toolFallbackLabel: "Working…",
  toolReadLabel: "Reading source",
  toolWriteLabel: "Writing file",
  toolEditLabel: "Editing file",
  toolGrepLabel: "Searching corpus",
  toolFindLabel: "Searching files",
  toolLsLabel: "Listing directory",
  toolPickerLabel: "Asking question",
  toolChecklistLabel: "Showing checklist",
  toolCiteLabel: "Citing source",
  toolCanvasLabel: "Updating canvas",
  toolProfileLabel: "Updating profile",
  toolStepLabel: "Updating step",
  toolMaturityLabel: "Updating maturity",
  toolWikiLabel: "Reading wiki",
  toolSupportLabel: "Saving support preference",
  /** The tool row's lifecycle state, shown in the row and repeated in its
   * accessible name. The internal `ToolStatus` union stays English; these are its
   * presentation, resolved like every other rendered string. */
  toolStatusRunning: "running",
  toolStatusDone: "done",
  toolStatusError: "error",
  toolProfileAssumptionNote:
    "An assumption inferred from our conversation — not a fixed fact. You can override it in the Profile Panel.",
  toolPickerCallFailed: "Picker tool call failed",
  toolChecklistCallFailed: "Decision checklist tool call failed",
  /** Why a generative-UI swap was refused. Rendered in the fallback error card's
   * body, so the lecturer sees a stated reason rather than a blank component. */
  toolPickerSpecRejected: (p: { detail: string }): string => `Picker spec rejected: ${p.detail}`,
  toolChecklistSpecRejected: (p: { detail: string }): string => `Checklist spec rejected: ${p.detail}`,
  toolSpecDetailArgsMissing: "args is missing or not an object",
  toolSpecDetailQuestionMissing: "question is missing or empty",
  toolSpecDetailOptionsMissing: "options is missing or not an array",
  toolSpecDetailOptionsTooFew: (p: { count: number }): string =>
    `options must have at least 2 entries (got ${p.count})`,
  toolSpecDetailOptionNotObject: (p: { index: number }): string => `options[${p.index}] is not an object`,
  toolSpecDetailOptionIdEmpty: (p: { index: number }): string => `options[${p.index}].id is empty`,
  toolSpecDetailOptionLabelEmpty: (p: { index: number }): string => `options[${p.index}].label is empty`,
  toolSpecDetailPresentationInvalid: "presentation must be 'checklist' or 'progress-bar'",
  toolSpecDetailItemsMissing: "items is missing or not an array",
  toolSpecDetailItemsTooFew: (p: { count: number }): string => `items must have at least 2 entries (got ${p.count})`,
  toolSpecDetailItemNotObject: (p: { index: number }): string => `items[${p.index}] is not an object`,
  toolSpecDetailItemIdEmpty: (p: { index: number }): string => `items[${p.index}].id is empty`,
  toolSpecDetailItemLabelEmpty: (p: { index: number }): string => `items[${p.index}].label is empty`,

  // ─────────────────────── CBE Maturity (right panel) ──────────────────────
  /** The seven PIONEER criteria (`methodology-007` §4.4 Table 1). The English
   * entries are the framework's own validated wording; every other catalogue
   * renders them in its language, because a rendered label is chrome and this
   * requirement admits no per-surface carve-out. The stable identity is the
   * criterion KEY, which is what the model-facing Discuss token carries. */
  maturityCriterionSocietalChallenge: "Societal (real-world) challenge",
  maturityCriterionStakeholderInvolvement: "Stakeholder involvement",
  maturityCriterionInterdisciplinarity: "Inter-/transdisciplinary",
  maturityCriterionStudentAgency: "Student agency & role of the teacher",
  maturityCriterionIterativeProcess: "Iterative learning process",
  maturityCriterionValueReflection: "Value-orientation, reflection",
  maturityCriterionSocietalImpact: "Societal impact and transferability",

  /** Short-form level tokens (compact row display). */
  maturityLevelShort1: "L1 — CBE light",
  maturityLevelShort2: "L2 — good practice",
  maturityLevelShort3: "L3 — full-fledged",
  /** Full framework terms (disclosure body + accessible text). */
  maturityLevelFull1: 'Level 1 "CBE light / challenge-inspired"',
  maturityLevelFull2: 'Level 2 "CBE good practice / challenge-oriented"',
  maturityLevelFull3: 'Level 3 "full-fledged CBE / transformative"',

  /** The criterion × level cells of Table 1, shown as the gloss in the level
   * disclosure. */
  maturityGlossSocietalChallenge1: "A real-world topic is referenced, but the challenge is predefined and closed.",
  maturityGlossSocietalChallenge2:
    "Students work on an open-ended challenge rooted in a real societal or regional issue.",
  maturityGlossSocietalChallenge3:
    "The challenge originates from a real stakeholder, is genuinely open-ended, and aims to create societal value beyond the course.",
  maturityGlossStakeholderInvolvement1: "Stakeholders appear as guest speakers or case providers.",
  maturityGlossStakeholderInvolvement2:
    "Stakeholders interact with students at defined moments (e.g. briefing, feedback).",
  maturityGlossStakeholderInvolvement3:
    "Stakeholders act as challenge owners or co-creators throughout the learning process.",
  maturityGlossInterdisciplinarity1:
    "Students are encouraged to consider other perspectives, but without structural integration.",
  maturityGlossInterdisciplinarity2: "Multiple disciplines or knowledge domains are explicitly integrated.",
  maturityGlossInterdisciplinarity3:
    "Academic and non-academic knowledge is co-created in a transdisciplinary manner and structurally embedded.",
  maturityGlossStudentAgency1: "Students have limited choices within a predefined framework.",
  maturityGlossStudentAgency2: "Students make key decisions; teachers act mainly as facilitators.",
  maturityGlossStudentAgency3:
    "Students fully own the challenge process; teachers primarily enable, coach, and reflect.",
  maturityGlossIterativeProcess1: "Some practical activities, but limited iteration or feedback.",
  maturityGlossIterativeProcess2: "Structured learning phases with feedback and reflection loops.",
  maturityGlossIterativeProcess3:
    "Multiple iterative cycles of testing, feedback, reflection, and adaptation are central.",
  maturityGlossValueReflection1: "Value-oriented reflection mentioned but not systematically addressed.",
  maturityGlossValueReflection2: "Students reflect on ethical implications and societal impact of their solutions.",
  maturityGlossValueReflection3:
    "Ethical reflection and value considerations are embedded throughout the challenge process.",
  maturityGlossSocietalImpact1: "Potential societal relevance is discussed but not acted upon.",
  maturityGlossSocietalImpact2: "Outputs are shared with stakeholders or relevant communities.",
  maturityGlossSocietalImpact3:
    "Outputs contribute to real change, decision-making, or follow-up actions beyond the course.",

  maturityTargetUnsettled: "The design's overall ambition still has to be settled with the lecturer.",
  maturityAchievedNotDue: "The achieved reading is not yet due: no criterion has been assessed.",
  /** Human display projection of the per-criterion Discuss dispatch. The machine
   * token beside it carries the criterion KEY and the REFERENCE-language label,
   * so a language switch never changes what the model reads. */
  maturityDiscussDisplay: (p: { label: string }): string => `Discuss maturity: ${p.label}`,
  maturityAssessDisplay: "Assess the design's maturity",
  maturityAssessLabel: "Assess maturity",
  maturityAssessTitle: "Ask the assistant to assess the design's maturity for the CBE Maturity panel",
  maturityAssessLockedReason: (p: { runLocked: string }): string =>
    `${p.runLocked} The CBE Maturity assessment cannot start until then.`,
  maturityAssessNoSession: "No conversation is open yet — the CBE Maturity assessment runs inside a conversation.",
  maturityPanelIntroEmpty:
    "The maturity reading shows where your module design currently sits on the PIONEER continuum — three levels " +
    "(CBE light, good practice, full-fledged) read across seven criteria — and the target level you are working " +
    "toward. It is established early on from your material and your conversation with the assistant, and it then " +
    "belongs to this course — it stays with the course when you start a new session. Nothing has been assessed for " +
    "this course yet.",
  maturityPanelIntroRaster:
    "How the assistant currently reads this design's CBE maturity. Levels are read from your material and this " +
    "conversation — they are working assumptions, not a verdict; use “Discuss in chat” on a criterion to correct or " +
    "develop them.",
  maturityPanelIntroNoRaster:
    "How the assistant currently reads this design's CBE maturity. The seven criteria are read from your material " +
    "and this conversation once the design has enough substance to read them against.",
  maturityThinClosingEmpty: "You can still ask for a reading — it will be marked as provisional.",
  maturityThinClosingPopulated:
    "Until then the reading stays a narrow one — “Assess maturity” refreshes it against whatever is on the table.",
  maturityThinHeading: "Thin evidence base so far:",
  maturityThinNoMaterial: "no material ingested yet",
  maturityThinDocuments: (p: { count: number }): string => `${p.count} document(s) ingested`,
  maturityThinArtefacts: (p: { count: number }): string => `${p.count} design artefact(s) recorded`,
  maturityThinSteps: (p: { count: number }): string => `${p.count} design step(s) touched`,
  maturityThinGap: (p: { have: string }): string =>
    `${p.have}. Bringing in material, or settling decisions across a second design step, gives a fuller reading.`,
  maturityUnknownProvenance:
    "This reading was recorded earlier in this course. Its evidence basis is not reconstructable here, so nothing is " +
    "claimed about how well it is evidenced or how current it is. Use “Assess maturity” below for a reading against " +
    "the design as it stands now.",
  maturityStaleHeading: "Out of date:",
  maturityStaleBody: (p: { changes: string; more: string }): string =>
    `the design has moved since this reading was recorded — ${p.changes}${p.more}. The levels below are what was ` +
    `last recorded. Use “Assess maturity” below to refresh them.`,
  maturityStaleMore: (p: { omitted: number }): string => ` (+${p.omitted} further change${p.omitted === 1 ? "" : "s"})`,
  // The descriptors the stale framing enumerates, one per change kind. The host
  // hands the panel STRUCTURED changes, so only the connective words live here;
  // the label, the filename, the artefact id and the step number are content and
  // pass through untranslated. One SELF-CONTAINED entry per kind rather than one
  // entry over a verb key: a key is not a rendered value, so a language could
  // silently drop it and no guard would see. Each entry names `p.id` and `p.step`
  // in its own body for the same reason — `i18n-completeness.test.ts` reads an
  // entry's parameters off its USES, so a shared helper would hide them.
  maturityStaleChangeIngestion: (p: { label?: string }): string =>
    `material ingested${p.label ? `: “${p.label}”` : ""}`,
  maturityStaleChangeStepDepth: (p: { step?: number }): string => `design step ${p.step ?? "?"} reached a new depth`,
  maturityStaleChangeArtefactSet: (p: { label?: string; id?: string; step?: number }): string => {
    const facts = [p.id ? `id ${p.id}` : undefined, p.step ? `step ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact changed${p.label ? `: “${p.label}”` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactCleared: (p: { label?: string; id?: string; step?: number }): string => {
    const facts = [p.id ? `id ${p.id}` : undefined, p.step ? `step ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact cleared${p.label ? `: “${p.label}”` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityStaleChangeArtefactDeleted: (p: { label?: string; id?: string; step?: number }): string => {
    const facts = [p.id ? `id ${p.id}` : undefined, p.step ? `step ${p.step}` : undefined].filter(Boolean).join(", ");
    return `artefact deleted${p.label ? `: “${p.label}”` : ""}${facts ? ` (${facts})` : ""}`;
  },
  maturityProvisionalHeading: "Provisional:",
  maturityProvisionalBody:
    "this reading was recorded when little was on the table, so it rests on a thin evidence base.",
  maturityProvisionalSufficient:
    "More has been settled since — use “Assess maturity” below for a reading against the design as it stands now.",
  maturityTargetExceeded: "target exceeded",
  maturityTargetReached: "target reached",
  maturityTargetLevel: (p: { level: number }): string => `target L${p.level}`,
  maturityNotYetAssessed: "not yet assessed",
  maturityCurrentPrefix: (p: { level: string }): string => `current ${p.level}`,
  maturityUncertainRow: "uncertain, weak evidence",
  maturityUncertainBadge: "uncertain · weak evidence",
  maturityCappedRow: "open finding caps this criterion",
  maturityCappedBadge: "open finding · caps this criterion",
  maturityDiscussLabel: "Discuss in chat",
  maturityDiscussAccessibleName: (p: { label: string }): string => `Discuss maturity: ${p.label}`,
  maturityDiscussTitle: "Discuss this criterion in the chat",
  maturityHeaderTargetLabel: "Target maturity",
  maturityHeaderAchievedLabel: "Overall achieved · derived",
  maturityHeaderTargetAccessible: (p: { value: string }): string => `Declared target maturity: ${p.value}`,
  maturityHeaderAchievedAccessible: (p: { value: string; derivation: string; note: string }): string =>
    `Derived overall achieved reading: ${p.value}, ${p.derivation}${p.note}`,
  maturityHeaderNotDueAccessible: (p: { value: string; note: string }): string =>
    `Overall achieved reading: ${p.value}${p.note}`,
  maturityRecordedLimitation: (p: { note: string }): string => `. Recorded limitation: ${p.note}`,
  maturityDerivation: (p: { contributing: number; total: number; mean: string }): string =>
    `derived from ${p.contributing} of ${p.total} assessed criteria · mean ${p.mean}`,
  maturityDerivationCapped: (p: { base: string; level: string; criterion: string }): string =>
    `${p.base} · capped at ${p.level} by the open finding on ${p.criterion}`,

  // ───────────────────────── Panels and workspace ──────────────────────────
  panelLeftLabel: "Left panel",
  panelRightLabel: "Right panel",
  panelRightTabsLabel: "Right panel tabs",
  /** The two right-panel surfaces. PROPER NAMES: identical in every catalogue,
   * and the retired "Artifacts" / "Artefacts" / "Artefakte" label binds every
   * language equally. */
  panelCanvasTab: "CBE Process Canvas",
  panelMaturityTab: "CBE Maturity",
  panelCoursesTitle: "Courses",
  panelExpandLeft: "Expand left panel",
  panelCollapseLeft: "Collapse left panel",
  panelExpandRight: "Expand right panel",
  panelCollapseRight: "Collapse right panel",
  panelOpenCourses: "Open Courses",
  panelOpenCoursesWithNote: (p: { note: string }): string => `Open Courses (${p.note})`,
  panelCoursesTitleWithNote: (p: { note: string }): string => `Courses — ${p.note}`,
  panelAgentRunningElsewhere: "Agent running in another course",
  panelRunFinishedElsewhere: "A run finished in another course",
  panelIngestRunning: (p: { settled: number; total: number }): string =>
    `Wiki ingest running (${p.settled} of ${p.total} documents)`,
  panelOpenTab: (p: { label: string }): string => `Open ${p.label}`,
  panelOpenTabUnseen: (p: { label: string }): string => `Open ${p.label} (unseen changes)`,
  panelTabUnseenTitle: (p: { label: string }): string => `${p.label} — unseen changes`,
  panelTabUnseenLabel: (p: { label: string }): string => `${p.label} (unseen changes)`,
  workspaceResizeLeft: "Resize left panel",
  workspaceResizeRight: "Resize right panel",

  // ───────────────────────────── Courses ───────────────────────────────────
  coursesAgentRunning: "Agent running",
  coursesUnseenResult: "Unseen result",
  coursesUnseenResultTitle: "A run finished in the background — switch to see the result",
  coursesIntro:
    "Your courses. Each course is a self-contained folder carrying its sessions, canvas, wiki, and materials.",
  coursesActiveBadge: "active",
  coursesDetailsLabel: "Course details",
  coursesWikiAtomCount: (p: { count: number }): string => `${p.count} wiki atom${p.count === 1 ? "" : "s"}`,
  coursesNewCourse: "New course",
  coursesNewCourseTitlePlaceholder: "New course title",
  coursesCreateLabel: "Create course",
  coursesCancelLabel: "Cancel",
  coursesSaveLabel: "Save",
  coursesRenameLabel: "Rename",
  coursesDeleteLabel: "Delete course",
  coursesBack: "← Back",
  coursesKicker: "Course",
  coursesTitleFieldLabel: "Course title",
  coursesSetActive: "Set active",
  coursesConfirmDeletionLabel: "Confirm course deletion",
  coursesDeleteConfirmText: (p: { title: string }): string =>
    `Delete "${p.title}"? Its conversations, its module design on the CBE Process Canvas, its wiki and its ingested ` +
    `materials go with it. The course folder is moved to your system trash, so you can restore it from there.`,
  coursesMoveToTrash: "Move to trash",
  coursesDeletedTrashed: (p: { title: string }): string => `Course "${p.title}" was moved to your system trash.`,
  coursesDeletedMissing: (p: { title: string }): string =>
    `Course "${p.title}" was no longer on disk and has been removed from the list.`,
  coursesContentTabsLabel: "Course content",
  coursesTabChats: "Chats",
  coursesTabWiki: "Wiki",
  coursesChatsLockedReason: "The agent is still working — wait for the turn to finish before switching conversations.",
  coursesConversationsLabel: "Stored conversations",
  coursesConversationsLoading: "Loading conversations…",
  coursesConversationsEmpty: "No stored conversations yet.",
  coursesConversationUndated: "Undated",
  coursesConversationOpenBadge: "open",
  coursesConversationNoMessages: "No messages yet",
  coursesConversationResumeTitle: (p: { sessionId: string }): string => `Resume this conversation (${p.sessionId})`,
  coursesConversationTurnCount: (p: { count: number }): string => `${p.count} turn${p.count === 1 ? "" : "s"}`,
  coursesHydrationInFlightSwitchNotice: "The conversation is still opening — wait a moment before switching courses.",

  // ─────────────────────────────── Wiki ────────────────────────────────────
  wikiBack: "← Wiki",
  wikiAtomMeta: (p: { type: string; confidence: string; updated: string }): string =>
    `${p.type} · confidence ${p.confidence} · updated ${p.updated}`,
  wikiRelated: "Related",
  wikiSearchPlaceholder: "Search atoms",
  wikiSearchLabel: "Search wiki atoms",
  wikiKnowledgeGraph: "Knowledge graph",
  wikiList: "List",
  wikiInvalidAtoms: (p: { count: number }): string =>
    `${p.count} file(s) under wiki/ failed atom validation — open the folder to fix them.`,
  wikiEmpty: "No atoms yet — ingest material to build the wiki.",
  wikiNoMatches: "No atoms match the search.",
  wikiNothingToGraph: "No atoms to graph yet.",
  wikiGraphLabel: "Knowledge graph of wiki atoms",
  wikiOpenAtom: (p: { title: string }): string => `Open atom ${p.title}`,
  wikiAtomRowMeta: (p: { type: string; updated: string }): string => `${p.type} · ${p.updated}`,
  wikiIngestLabel: "Ingest material",
  wikiIngestInactiveCourse: "Activate this course to start a new ingest here.",
  wikiIngestAbortLabel: "Abort",
  wikiIngestNotice: (p: { done: number; failed: number }): string =>
    `${p.done} document(s) atomized${p.failed ? `, ${p.failed} failed` : ""}.`,
  wikiIngestAbortedNotice: "Ingestion aborted.",
  wikiIngestAbortUndeliveredNotice:
    "Ingestion ended here. The abort reached no running atomization — an ingest already under way keeps going.",

  // ───────────────────────────── Settings ──────────────────────────────────
  settingsGroupModel: "Model",
  settingsGroupAppearance: "Appearance",
  settingsGroupAbout: "About",
  settingsGroupCorpus: "Corpus",
  settingsThemeLabel: "Theme",
  settingsThemeHint: "Dark uses Catppuccin · Light uses Latte",
  settingsFlavourLabel: "Flavour",
  settingsFlavourHint: "Catppuccin dark variant",
  settingsAccentLabel: "Accent",
  settingsAccentHint: "14 Catppuccin accents",
  settingsChatTextSizeLabel: "Chat text size",
  settingsChatTextSizeHint: "font size of the chat transcript and the composer",
  settingsChatTextSizeSmall: "Small",
  settingsChatTextSizeMedium: "Medium",
  settingsChatTextSizeLarge: "Large",
  /** The interface-language control (Requirement: *Interface Language Control in
   * Settings*). The control's own label and explanation are ordinary chrome; the
   * option NAMES are the endonyms above and never translate. */
  settingsInterfaceLanguageLabel: "Interface language",
  settingsInterfaceLanguageHint: "language of the app's own labels, menus and messages",
  settingsInterfaceLanguageGroupLabel: "Interface language",
  settingsApiKeyStatusLabel: "API key status",
  settingsApiKeySet: "An API key is set",
  settingsApiKeyUnset: "No API key set",
  settingsBaseUrlLabel: "Base URL",
  settingsBaseUrlExplanation:
    "The address of the OpenAI-compatible endpoint the app sends all requests to. It usually ends in /v1, e.g. " +
    "https://api.example.com/v1.",
  settingsBaseUrlPlaceholder: "https://your-llm-endpoint/v1",
  settingsModelIdLabel: "Model ID",
  settingsModelIdExplanation:
    "The exact model identifier your endpoint expects, e.g. gemma-3-27b-it. Copy it from your provider's model " +
    "list — a mistyped ID makes every request fail.",
  settingsModelIdPlaceholder: "model-id",
  settingsApiKeyLabel: "API key",
  settingsApiKeyExplanation:
    "The secret key that authorises requests to your endpoint (often starting with sk-). It is stored encrypted on " +
    "this device and sent only to the endpoint you configured. Leaving it blank keeps whatever key is already " +
    "stored, or type a new value to replace it.",
  settingsApiKeyPlaceholder: "sk-…",
  settingsKeyRequiredForEndpoint:
    "Key required for the new endpoint — a credential is never carried across base URLs. Enter the key for this " +
    "endpoint to enable Save.",
  settingsUnsavedChanges: "Unsaved changes — press Save to apply them.",
  settingsSaved: "Saved.",
  settingsSavedWithSwap: (p: { modelId: string }): string => `Saved · active chat now on ${p.modelId}.`,
  settingsSaving: "Saving…",
  settingsSave: "Save",
  settingsTesting: "Testing…",
  settingsTestConnection: "Test connection",
  settingsRequiredFields: "Base URL and Model ID are required.",
  settingsContextLengthInvalid: "Context length must be a positive whole number (tokens), e.g. 65536.",
  settingsSwapFailed: (p: { error: string }): string =>
    `Saved, but the active chat could not switch models (${p.error}). It stays on the previous model.`,
  settingsTestOk: "Connection OK — the endpoint responded and accepted the key.",
  settingsTestUnauthorized: (p: { status: string }): string =>
    `Unauthorized — the endpoint rejected the API key (HTTP ${p.status}). Check or re-enter the key.`,
  settingsTestUnreachable: "Endpoint unreachable — check the base URL and your network.",
  settingsTestNotConfigured: "No connection configured yet — save a base URL and API key first.",
  settingsTestHttpError: (p: { status: string }): string =>
    `The endpoint responded with HTTP ${p.status} — check the base URL.`,
  settingsAdvanced: "Advanced",
  settingsReasoningLabel: "Reasoning",
  settingsReasoningExplanation:
    "Turns on the model's explicit reasoning mode by sending a reasoning_effort parameter. Helpful for " +
    "tool-call-gated hybrids (the Qwen3-A3B class), which otherwise skip tool calls; leave it off for " +
    "natively-reasoning models like gpt-oss — some endpoints reject the setting with an error.",
  settingsReasoningToggleLabel: "Enable reasoning",
  settingsReasoningOn: "On",
  settingsReasoningOff: "Off",
  settingsReasoningEffortLabel: "Reasoning effort",
  settingsReasoningEffortExplanation:
    "How much thinking time the model spends before each reply — low answers fastest, high is the most thorough. " +
    "Medium is a sensible default.",
  settingsEffortLow: "low",
  settingsEffortMedium: "medium",
  settingsEffortHigh: "high",
  settingsContextLengthLabel: "Context length",
  settingsContextLengthExplanation:
    "The real token window of your model, e.g. 65536. Leave blank to use the default; a value that is too large " +
    "causes mid-conversation failures, one that is too small compacts the conversation too early.",
  settingsContextLengthPlaceholder: "e.g. 65536",
  settingsDeleteApiKey: "Delete API key",
  settingsConfirmEraseLabel: "Confirm API key deletion",
  settingsEraseConfirmText:
    "Delete the stored API key from this device? You will need to enter a key again before the next session starts.",
  settingsDeleteKey: "Delete key",
  settingsCancel: "Cancel",
  settingsKeyErased: "API key erased from this device. Enter a new key before starting the next session.",
  settingsLocalityStatement:
    "Your API key and everything you submit are stored locally on this device (the key encrypted via Electron " +
    "safeStorage where available) and sent only to the LLM endpoint you configured — no CBE or other third-party " +
    "server receives them.",
  settingsAboutSkill: "Skill",
  settingsAboutSkillVersion: "Skill version",
  settingsAboutAppVersion: "App version",
  settingsAboutSkillUpdateStatus: "Skill update status",
  settingsAboutSkillUpdateNotChecked: "Not checked yet; the effective Skill above remains in use.",
  settingsAboutSkillUpdateUpdated: (p: { version: string }): string => `Updated to Skill ${p.version}.`,
  settingsAboutSkillUpdateUpToDate: (p: { version: string }): string => `Up to date on Skill ${p.version}.`,
  settingsAboutSkillUpdateMetadataInvalid: (p: { field: string }): string =>
    `Update refused: invalid pointer metadata${p.field ? ` (${p.field})` : ""}. The effective Skill above remains in use.`,
  settingsAboutSkillUpdateAppMismatch:
    "Update refused: this Skill does not support this app version. The effective Skill above remains in use.",
  settingsAboutSkillUpdateAbiMismatch:
    "Update refused: the model-surface ABI differs. The effective Skill above remains in use.",
  settingsAboutSkillUpdateToolMismatch:
    "Update refused: the tool contract differs. The effective Skill above remains in use.",
  settingsAboutSkillUpdatePiMismatch:
    "Update refused: the tested Pi version differs. The effective Skill above remains in use.",
  settingsAboutSkillUpdateIntegrityMismatch:
    "Update refused: the archive digest did not match. The effective Skill above remains in use.",
  settingsAboutSkillUpdateUnavailable: "The update check is unavailable. The effective Skill above remains in use.",
  settingsAboutSkillPackIdentity: "Signed Skill pack",
  settingsAboutSkillPackIdentityValue: (p: {
    channel: string;
    epoch: number;
    sequence: number;
    keyId: string;
  }): string => `${p.channel} · epoch ${p.epoch} · sequence ${p.sequence} · key ${p.keyId}`,
  settingsAboutSkillUpdateSignedRefused: (p: { code: string; field: string }): string =>
    `Signed update refused (${p.code}${p.field ? `: ${p.field}` : ""}). The effective Skill above remains in use.`,
  settingsAboutSkillUpdateSignedUnavailable: (p: { code: string }): string =>
    `The signed update check is unavailable (${p.code}). The effective Skill above remains in use.`,
  settingsAboutLoading: "loading…",
  settingsAboutUnavailable: "unavailable",
  settingsPioneerLinkLabel: "PIONEER Alliance website",
  settingsPioneerLinkDescription:
    "Learn more about the PIONEER Alliance, the European university alliance associated with this toolbox.",
  settingsPioneerExternalCue: "Opens in your system browser.",
  settingsPioneerOpenFailure: "The PIONEER Alliance website could not be opened. Try again.",
  settingsHelpButtonLabel: (p: { field: string }): string => `What is ${p.field}?`,
  settingsThemeToggleLabel: "Theme toggle",
  settingsThemeDark: "Dark",
  settingsThemeLight: "Light",
  settingsFlavourGroupLabel: "Catppuccin flavour",
  settingsFlavourLatteNote: "Light uses the Latte palette — flavour selection only applies to Dark.",
  settingsFlavourFrappe: "Frappé",
  settingsFlavourMacchiato: "Macchiato",
  settingsFlavourMocha: "Mocha",
  settingsAccentGroupLabel: "Accent colour",
  settingsAzureHintBefore: "This looks like an Azure OpenAI resource. The OpenAI-compatible surface usually lives at",
  settingsCleartextWarningBefore: "This endpoint uses plain",
  settingsCleartextWarningMiddle: "— the API key would travel unencrypted. Use",
  settingsCleartextWarningAfter: "unless this is a trusted local network.",

  // ───────────────────────────── Corpus group ──────────────────────────────
  corpusVersionLabel: "Version",
  corpusCacheDateLabel: "Cache date",
  corpusPackIdentityLabel: "Signed corpus pack",
  corpusPackIdentityValue: (p: { channel: string; epoch: number; sequence: number; keyId: string }): string =>
    `${p.channel} · epoch ${p.epoch} · sequence ${p.sequence} · key ${p.keyId}`,
  corpusShippedWithApp: "shipped with the app",
  corpusRefreshing: "Refreshing…",
  corpusRefresh: "Refresh corpus",
  corpusEmptyValue: "—",
  corpusUpdated: (p: { version: string }): string => `Corpus updated to version ${p.version}.`,
  corpusUpToDate: (p: { version: string }): string => `Corpus is up to date (version ${p.version}).`,
  corpusIntegrityMismatch: "Corpus update failed, integrity check did not match. The previous corpus stays loaded.",
  corpusRefreshNotConfigured: "No corpus update location is configured for this build.",
  corpusRefreshPointerHttp: (p: { httpStatus: number }): string =>
    `Could not check for a corpus update (HTTP ${p.httpStatus}).`,
  corpusRefreshPointerRead: "Could not read the corpus update information.",
  corpusRefreshPointerInvalid: "The corpus update information is incomplete (version/file/sha256).",
  corpusRefreshDownloadHttp: (p: { httpStatus: number }): string =>
    `Could not download the corpus update (HTTP ${p.httpStatus}).`,
  corpusRefreshDownloadRead: "Could not read the downloaded corpus bundle.",
  corpusRefreshMissingMarker: (p: { markerFile: string }): string =>
    `The downloaded corpus bundle does not contain the required top-level file ${p.markerFile}.`,
  corpusRefreshUnsafeEntry: (p: { entryName: string }): string =>
    `The downloaded corpus bundle contains an unsafe entry and was refused: ${p.entryName}.`,
  corpusRefreshInstallFailed: "Could not install the corpus update.",
  corpusRefreshSignedRefused: (p: { code: string; field: string }): string =>
    `Signed corpus update refused (${p.code}${p.field ? `: ${p.field}` : ""}). The current corpus remains loaded.`,
  corpusRefreshSignedUnavailable: (p: { code: string }): string =>
    `The signed corpus update is unavailable (${p.code}). The current corpus remains loaded.`,
  corpusRefreshUnexpected: "Could not complete the corpus refresh.",
  corpusInfoReloadFailed: "The corpus information could not be reloaded.",

  // ──────────────────────── Onboarding config dialog ───────────────────────
  configPageLabel: "One-time setup",
  configGroupLabel: "LLM connection · BYO",
  configIntro:
    "Provide your OpenAI-compatible LLM endpoint. The connection details are stored locally on this machine and " +
    "encrypted via Electron safeStorage where available.",
  configBaseUrlHint: "e.g. https://router.huggingface.co/v1",
  configApiKeyHint: "stored locally, never shared",
  configModelIdHint: "e.g. gpt-4o-mini, gemma-3-27b-it",
  configModelIdPlaceholder: "gemma-3-27b-it",

  // ───────────────────────────── Profile ───────────────────────────────────
  profileDimensionPblPriorKnowledge: "PBL prior knowledge",
  profileDimensionCbePriorKnowledge: "CBE prior knowledge",
  profileDimensionDidacticStance: "Didactic stance",
  profileDimensionAttitude: "Attitude toward CBE",
  profileDimensionCapacity: "Teaching load / capacity",
  profileReadingHeading: "How the assistant reads you",
  profileReadingIntro:
    "Estimates come from the conversation and carry their evidence; your manual setting always wins until you " +
    "change it.",
  profileOverrideRejected: "Override was rejected — value not on the dimension's scale.",
  profileIdentityHeading: "How you would like to be addressed",
  profileIdentityIntro:
    "Your own words, used when the assistant addresses you. Both are optional and independent of each other — " +
    "leaving them empty is a normal choice, and nothing is inferred or filled in for you.",
  profileNameLabel: "Name",
  profileFormOfAddressLabel: "Preferred form of address",
  profileTooLong: (p: { max: number }): string => `Too long — keep each entry to ${p.max} characters or fewer.`,
  profileTooLongNothingSaved: (p: { max: number }): string =>
    `Too long — keep each entry to ${p.max} characters or fewer. Nothing saved.`,
  profileSaveFailed: "Could not save — nothing was stored.",
  profileSaved: "Saved.",
  profileSave: "Save",
  profileOverriddenBadge: "set by you",
  profileConfidenceBadge: (p: { confidence: string }): string => `confidence · ${p.confidence}`,
  profileNotEstimatedBadge: "not yet estimated",
  profileAssumptionNote:
    "An assumption inferred from our conversation — not a fixed fact. Pick a value below to override it.",
  profileOverrideSelectLabel: (p: { dimension: string }): string => `Override ${p.dimension}`,
  profileChooseManually: "choose to set manually",
  profileLastRevised: (p: { stamp: string }): string => `last revised: ${p.stamp}`,

  // ──────────────────────── Profile-and-Settings overlay ───────────────────
  overlaySectionsLabel: "Overlay sections",
  overlaySettingsTab: "Settings",
  overlayProfileTab: "Profile",
  overlayCloseLabel: "Close",

  // ───────────────────────── Update notice ─────────────────────────────────
  updateFailed: (p: { message: string }): string => `Update failed: ${p.message}`,
  updateDismiss: "Dismiss",
  updateDownloading: (p: { version: string }): string => `Downloading update ${p.version}…`,
  updateDownloaded: (p: { version: string }): string => `Update ${p.version} downloaded.`,
  updateRestartAndInstall: "Restart and install",
  updateLater: "Later",
  updateAvailable: (p: { version: string }): string => `Version ${p.version} is available.`,
  updateChangelog: "Changelog",
  updateInstallNow: "Install now",
  updateSkipVersion: "Skip this version",

  // ───────────────────────────── Citations ─────────────────────────────────
  citationUnknownId: (p: { id: string }): string =>
    `Unresolved citation: no corpus document "${p.id}". This reference could not be checked.`,
  citationMissingSection: (p: { id: string }): string =>
    `Unverified citation: no section given, so it cannot be checked against ${p.id}. Open the document to see where ` +
    `this comes from.`,
  citationUnknownSection: (p: { section: string; id: string }): string =>
    `Unverified citation: "${p.section}" matches no heading in ${p.id}. Open the document to check the claim yourself.`,
  citationUnresolvedFlag: "unresolved",
  citationUnverifiedFlag: "unverified",
  citationOpenWikiAtom: (p: { id: string }): string => `Open wiki atom ${p.id}`,
  citationOpenCorpusDocument: (p: { id: string }): string => `Open corpus document ${p.id}`,
  citationLoading: "Loading…",
  citationNotFound: (p: { id: string }): string => `Citation not found: ${p.id}`,
  citationCorpusMeta: (p: { version: string; tags: string }): string => `corpus ${p.version} · ${p.tags}`,
  citationPathLabel: "path:",
  citationCloseLabel: "Close",

  // ───────────────────────────── Doc chips ─────────────────────────────────
  docChipLabel: (p: { name: string; type: string }): string => `Attachment: ${p.name} (${p.type})`,

  // ──────────────── Main-process, operator-facing display copy ─────────────
  ingestUnsupportedFormat: (p: { ext: string; supported: string }): string =>
    `Unsupported format "${p.ext}". Supported formats: ${p.supported}.`,
  /** Refusal for the legacy and variant Excel workbook formats, which are named
   * explicitly rather than being swept into the generic list. The generic message lists
   * `.xlsx`, so a lecturer holding an `.xls` would otherwise read it as "Excel is
   * unsupported" (capability `desktop-app`, Requirement: *Material Ingestion Stub into
   * the Chat Context*). It names the remedy, because that is the actionable half. */
  ingestLegacyExcelFormat: (p: { ext: string }): string =>
    `"${p.ext}" is an older or macro-enabled Excel format this app does not read. Open the workbook in ` +
    `Excel and save it as an .xlsx workbook, then try again.`,
  ingestNoExtension: "(no extension)",
  ingestUnreadableFile: (p: { filename: string; detail: string }): string =>
    `File "${p.filename}" could not be read: ${p.detail}`,
  mainExportDialogTitle: "Export design document",
  mainExportFilterMarkdown: "Markdown",
  mainExportInsideApp: "That location is inside the application itself. Choose a folder in your own files.",
  mainExportWriteFailed: (p: { reason: string }): string =>
    `The design document could not be written (${p.reason}). Nothing was changed.`,
  mainIngestDialogTitle: "Ingest teaching material into the wiki",
  mainIngestFilterMaterial: "Teaching material",
  mainIngestWrongCourse: (p: { course: string }): string =>
    `This ingest was started for a course that is no longer active. Material is only ever ingested into the active ` +
    `course, which is now "${p.course}". Activate the course you meant, then start the ingest again.`,
  mainIngestAlreadyRunning: "An ingestion is already running for this course",
  mainIngestEndpointUnreachable: (p: { baseURL: string }): string =>
    `The model endpoint at ${p.baseURL} is not reachable: the connection was refused, or the address does not ` +
    `resolve or route. Start it, then try again.`,
  mainIngestAborted: "Ingestion aborted",
  mainIngestAtomizationFailed: "Atomization failed",
  mainProviderNotConfigured: "LLM provider not configured",
  mainNoOpenConversation: "No conversation is open for the active course.",
  mainArchiveUnreadable:
    "The previous conversation's archive could not be read — starting a fresh conversation. The files remain on " +
    "disk in the course folder.",
  mainResumeDisabledReason: "JSON sidecar missing or unreadable — open the .md file in an editor to review",
  /** Main-side refusals and notices carried across IPC and rendered by the
   * renderer's error surfaces. Their rationale stays at the throw site; the
   * WORDING is owned here like every other rendered string.
   *
   * Two of them are additionally MATCHED by the renderer — the busy rejection and
   * the fresh-start failure. The match runs against every shipped catalogue's
   * entry (`textMatchesAnyLanguage`), on the precedent `isHarnessDocumentedError`
   * already set: matching the source constant rather than a transcribed phrase is
   * what keeps a wording edit — or a translation — from silently breaking it. */
  mainTurnInFlightNotice:
    "The agent is still working — wait for the turn to finish (or stop it) before closing or resetting the conversation.",
  mainResumeUnavailableNotice:
    "That conversation could not be opened — its archive is missing or unreadable. Nothing was changed; the current conversation stays open.",
  mainResumeWhileOpeningNotice: "A conversation is still opening for this course — wait a moment, then try again.",
  mainPromptBusyNotice: "Agent is already processing — wait for the current turn to finish, then send again.",
  mainExportEmptyNotice: "There is nothing to export yet — no canvas artefact carries a value.",
  mainFreshStartFailedNotice:
    "The new session could not be started. Your previous conversation is safely saved in the course folder — nothing is lost. Retry to start the new session.",
  mainCourseDeleteInFlightNotice:
    "The agent is still working in this course — wait for the turn to finish (or stop it) before deleting the course.",
  mainCourseDeleteIngestingNotice:
    "Material is still being read into this course's wiki — that run finishes on its own; wait for it (or stop the ingestion) before deleting the course.",
  mainCourseDeleteOpeningNotice:
    "This course's conversation is still opening — that takes a moment; try deleting the course again once it is open.",
  mainCourseDeleteUnreadableNotice:
    "This course's folder is still on disk, but its course.md could not be read — nothing was moved to the trash and nothing was changed. Open the course folder, check course.md, then try again.",
  mainIngestFileDialogTitle: "Read in material",
  chatCompactionFailedText: "Context compaction failed. Your conversation is unchanged — you can keep working.",
  chatCompactionFailedHint:
    "If this keeps happening, the configured context window may be too small (Settings → contextLength).",
  /** The generic message an errored tool card shows when the failure carries no
   * readable text of its own — one owner for the live card and the restored one,
   * which must not be able to disagree. */
  toolExecutionFailed: "Tool execution failed",
  ringExplanationPending:
    "This conversation is being summarised automatically to make room. The new reading follows shortly.",
  ringExplanationFresh: "Conversation length: not measured yet. The first measurement arrives with the first answer.",
  ringExplanationCarried:
    "This conversation carries context that cannot be measured right now. The value returns with the next answer.",
  ringExplanationWindowUnknown: (p: { used: string }): string =>
    `Conversation length: ${p.used} tokens. How large the model's context window is has not been recorded — so no ` +
    `share is shown. You can enter it under Settings, "Model" group, behind "Advanced"; the model pill to the right ` +
    `leads there.`,
  ringExplanationMeasured: (p: { percent: number; used: string; window: string }): string =>
    `Conversation length: ${p.percent} % of the context window — ${p.used} of ${p.window} tokens.`,
  ringExplanationNearFull:
    "This conversation will shortly be summarised automatically to free up room — that is normal and not a problem. " +
    "Your work on the CBE Process Canvas, the recorded decisions, the progress across the design steps and the CBE " +
    "Maturity reading are all kept.",
  ringLabelPending: "Conversation length: being summarised",
  ringLabelFresh: "Conversation length: not measured yet",
  ringLabelCarried: "Conversation length: carried context, not measured yet",
  ringLabelWindowUnknown: "Conversation length: no context window recorded",
  ringLabelMeasured: (p: { percent: number }): string => `Conversation length: ${p.percent} %`,
  toolDetailFullRaster: "full raster",
  toolDetailUnassessed: "unassessed",
  toolDetailStep: (p: { step: number }): string => `step ${p.step}`,
  exportMaturityDerivation: (p: { contributing: number; total: number; mean: string }): string =>
    `derived from ${p.contributing} of ${p.total} assessed criteria, mean ${p.mean}`,
  exportMaturityDerivationCapped: (p: { base: string; criterion: string }): string =>
    `${p.base}; capped by the open finding on ${p.criterion}`,
  /** Registry-facing surface NAMES: the label a UI registry entry gives a surface
   * that has no single rendered control label of its own (capability
   * `ui-reference-generation`, Requirement: *UI Element Registry*). They are chrome
   * — the assistant quotes them to the lecturer — and they live here for the same
   * reason every other rendered string does. Where a surface DOES have a rendered
   * label, its entry names that entry instead and no name is duplicated. */
  uiRefActiveCourseName: "Active course name",
  uiRefArtefactNotes: "Artefact notes and ↻ Iterate",
  uiRefDeleteArtefact: "Delete artefact",
  uiRefContextRing: "Context ring",
  uiRefModelPill: "Model pill",
  uiRefSendStop: "Send / Stop",
  uiRefCourseList: "Course list",
  uiRefCourseDetail: "Course detail",
  /** The header strip's help control (capability `desktop-app`, Requirement:
   * *Help-Me Button Dispatches a Structured Help Request*). It is the SECOND entry
   * point of one dispatch, so its label is the same word the "+" menu's entry
   * carries — but a separate key, because this surface may diverge later for a
   * reason that is not language. Its busy reason is deliberately the composer's
   * own entry, not a second wording for one fact about one run. */
  headerHelpLabel: "Help",
  headerHelpStartingReason: "The conversation is still starting — help is available in a moment.",
};
