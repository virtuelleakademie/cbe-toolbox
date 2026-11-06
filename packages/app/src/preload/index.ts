import { contextBridge, ipcRenderer } from "electron";
import {
  Channels,
  type ProviderConfigDto,
  type ProviderStatus,
  type ConfigSetResult,
  type CitationDetail,
  type CitationVerification,
  type CitationVerifyRequest,
  type AgentEvent,
  type SlashCommand,
  type IngestOutcome,
  type LecturerProfile,
  type LecturerProfileOverridePayload,
  type LecturerProfileOverrideResult,
  type LecturerIdentity,
  type LecturerIdentitySetPayload,
  type LecturerIdentitySetResult,
  type CourseSummary,
  type CourseDeleteResult,
  type CourseListResult,
  type CourseRevealTarget,
  type ConversationOpenResult,
  type PromptPayload,
  type PromptAbortPayload,
  type PromptAbortResult,
  type ConversationFreshPayload,
  type ConversationListPayload,
  type ConversationListResult,
  type ConversationResumePayload,
  type WikiIngestProgressEvent,
  type WikiIngestStartPayload,
  type WikiIngestResult,
  type WikiListResult,
  type CanvasDeletePayload,
  type StepFocusPayload,
  type ConfigEraseResult,
  type ConnectionTestResult,
  type AboutInfo,
  type CorpusInfo,
  type CorpusRefreshResult,
  type UpdateEvent,
  type UpdateActionPayload,
  type InterfaceLanguageSetResult,
  type OnboardingReadResult,
  type OnboardingAcknowledgeResult,
  type OnboardingStateEvent,
  type NativeMenuCommand,
  type NativeMenuAvailability,
  type PioneerSiteOpenResult,
} from "../shared/ipc-contract.js";

const api = {
  /**
   * The interface language in force, resolved MAIN-SIDE before this window
   * loaded and read here SYNCHRONOUSLY (capability `desktop-app`, Requirement:
   * *Every String the App Renders Is English* — "The setting").
   *
   * A plain property, not a method: the renderer's chrome module reads it during
   * module evaluation, so the first paint is already in the right language. An
   * async getter would give the OS-locale scenario the "intermediate English
   * flash" it explicitly forbids.
   */
  interfaceLanguage: ipcRenderer.sendSync(Channels.interfaceLanguageGetSync) as string,
  /** Persist and apply a language. The main process broadcasts the change to
   * every renderer, so this call's result is a confirmation, not the mechanism. */
  async setInterfaceLanguage(language: string): Promise<InterfaceLanguageSetResult> {
    return ipcRenderer.invoke(Channels.interfaceLanguageSet, language);
  },
  onInterfaceLanguageChanged(listener: (language: string) => void): () => void {
    const handler = (_e: unknown, language: string) => listener(language);
    ipcRenderer.on(Channels.interfaceLanguageChanged, handler);
    return () => ipcRenderer.off(Channels.interfaceLanguageChanged, handler);
  },
  /** Resolve the main-owned once-per-profile marker. This never gates boot. */
  async readOnboarding(): Promise<OnboardingReadResult> {
    return ipcRenderer.invoke(Channels.onboardingRead);
  },
  /** Idempotently acknowledge first-use orientation. A failed write is returned
   * as a value because dismissal and work must continue. */
  async acknowledgeOnboarding(): Promise<OnboardingAcknowledgeResult> {
    return ipcRenderer.invoke(Channels.onboardingAcknowledge);
  },
  /** Main reports accepted prompt dispatches here so ordinary, attachment-only,
   * Help and every other existing renderer route share one dismissal boundary. */
  onOnboardingChanged(listener: (event: OnboardingStateEvent) => void): () => void {
    const handler = (_e: unknown, event: OnboardingStateEvent) => listener(event);
    ipcRenderer.on(Channels.onboardingChanged, handler);
    return () => ipcRenderer.off(Channels.onboardingChanged, handler);
  },
  /** One application-level listener routes the closed native-menu command union
   * into the renderer actions already used by the header. */
  onNativeMenuCommand(listener: (command: NativeMenuCommand) => void): () => void {
    const handler = (_e: unknown, command: NativeMenuCommand) => listener(command);
    ipcRenderer.on(Channels.nativeMenuCommand, handler);
    return () => ipcRenderer.off(Channels.nativeMenuCommand, handler);
  },
  /** Project the existing action gates back to the main-owned native menu. */
  async setNativeMenuAvailability(availability: NativeMenuAvailability): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.nativeMenuAvailability, availability);
  },
  /** Open the one host-owned PIONEER destination. No URL crosses the bridge. */
  async openPioneerAllianceSite(): Promise<PioneerSiteOpenResult> {
    return ipcRenderer.invoke(Channels.pioneerSiteOpen);
  },
  async getConfig(): Promise<ProviderStatus | null> {
    return ipcRenderer.invoke(Channels.configGet);
  },
  async setConfig(cfg: ProviderConfigDto): Promise<ConfigSetResult> {
    return ipcRenderer.invoke(Channels.configSet, cfg);
  },
  /** Erase the persisted API key: removes the safeStorage cipher record entirely
   * (never an empty-string cipher). Endpoint + model stay persisted. */
  async eraseApiKey(): Promise<ConfigEraseResult> {
    return ipcRenderer.invoke(Channels.configErase);
  },
  /** Verify the persisted connection via `GET {baseURL}/models`; returns a
   * classified outcome (unauthorized / unreachable / http-error), never the key. */
  async testConnection(): Promise<ConnectionTestResult> {
    return ipcRenderer.invoke(Channels.configTest);
  },
  /** Resolve-or-create the active course's ONE conversation (re-attach open /
   * resume canonical / start fresh) — the only way a session comes into renderer
   * view (capability `desktop-app`, Requirement: Renderer Boot-Hydration from
   * the Main Process). */
  async openConversation(): Promise<ConversationOpenResult> {
    return ipcRenderer.invoke(Channels.conversationOpen);
  },
  /** Explicit fresh-conversation action ("New Session"): retires the canonical
   * conversation (nothing deleted) and starts a fresh one (capability
   * `course-workspace`, Requirement: One Canonical Conversation per Course). */
  /**
   * @param opts.force Force-close a conversation whose turn is still in flight.
   *   The ONLY caller is the timed-out-stop recovery (capability `desktop-app`,
   *   Requirement: *Composer Control Row*): a stop that never settles leaves the
   *   composer locked and New Session disabled, so without this the state is a
   *   dead end whose only exit is quitting the app. Never a general escape from
   *   the in-flight refusal.
   */
  async freshConversation(opts?: { force?: boolean }): Promise<ConversationOpenResult> {
    return ipcRenderer.invoke(Channels.conversationFresh, {
      ...(opts?.force ? { force: true } : {}),
    } satisfies ConversationFreshPayload);
  },
  /** List a course's stored conversations for the detail view's Chats tab —
   * newest first, plus the open-session id (capability `desktop-app`,
   * Requirement: Course Detail Tabs: Chats and Wiki). */
  async listConversations(courseId: string): Promise<ConversationListResult> {
    return ipcRenderer.invoke(Channels.conversationList, { courseId } satisfies ConversationListPayload);
  },
  /** Resume a stored conversation as THE course's open conversation (capability
   * `course-workspace`, Requirement: Stored Conversations Are Resumable). */
  async resumeConversation(courseId: string, sessionId: string): Promise<ConversationOpenResult> {
    return ipcRenderer.invoke(Channels.conversationResume, {
      courseId,
      sessionId,
    } satisfies ConversationResumePayload);
  },
  /**
   * Stop the running turn of ONE conversation (capability `agent-harness`,
   * Requirement: *A Lecturer Can Stop a Running Turn*). Its own channel — it
   * dispatches no prompt and creates no user turn — and it names its target, so
   * a background conversation's run is never affected. Resolves with a
   * classification, never a runtime message.
   */
  async abortPrompt(sessionId: string): Promise<PromptAbortResult> {
    return ipcRenderer.invoke(Channels.promptAbort, { sessionId } satisfies PromptAbortPayload);
  },
  /** Export the active course's design document from host state (capability
   * `course-workspace`, Requirement: Deterministic Design-Document Export from Host
   * State). Resolves with the written path, or null when the lecturer cancels. */
  exportDesignDocument(): Promise<{ path: string } | null> {
    return ipcRenderer.invoke(Channels.exportDesignDocument);
  },
  async sendPrompt(sessionId: string, text: string, display?: PromptPayload["display"]): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.prompt, {
      sessionId,
      text,
      ...(display ? { display } : {}),
    } satisfies PromptPayload);
  },
  async loadCitation(id: string): Promise<CitationDetail | null> {
    return ipcRenderer.invoke(Channels.loadCitation, id);
  },
  async verifyCitation(req: CitationVerifyRequest): Promise<CitationVerification> {
    return ipcRenderer.invoke(Channels.verifyCitation, req);
  },
  async closeSession(sessionId: string): Promise<{ ok: true; path?: string }> {
    return ipcRenderer.invoke(Channels.closeSession, sessionId);
  },
  async getCommands(sessionId: string): Promise<SlashCommand[]> {
    return ipcRenderer.invoke(Channels.getCommands, sessionId);
  },
  async ingestFile(): Promise<IngestOutcome[] | null> {
    return ipcRenderer.invoke(Channels.ingestFile);
  },
  async getLecturerProfile(): Promise<LecturerProfile> {
    return ipcRenderer.invoke(Channels.lecturerProfileGet);
  },
  async overrideLecturerProfile(payload: LecturerProfileOverridePayload): Promise<LecturerProfileOverrideResult> {
    return ipcRenderer.invoke(Channels.lecturerProfileOverride, payload);
  },
  /** The lecturer's own identity record — name and preferred form of address, both
   *  optional (capability `agent-harness`, Requirement: Per-Lecturer Identity
   *  Record). `{}` means nothing is recorded, which is a normal state. */
  async getLecturerIdentity(): Promise<LecturerIdentity> {
    return ipcRenderer.invoke(Channels.lecturerIdentityGet);
  },
  /** Persist the identity record. A field sent empty is cleared; an over-long value
   *  is refused whole (`ok: false`, `reason: "too-long"`) and nothing is stored. */
  async setLecturerIdentity(payload: LecturerIdentitySetPayload): Promise<LecturerIdentitySetResult> {
    return ipcRenderer.invoke(Channels.lecturerIdentitySet, payload);
  },
  async listCourses(): Promise<CourseListResult> {
    return ipcRenderer.invoke(Channels.courseList);
  },
  async createCourse(title: string): Promise<CourseSummary> {
    return ipcRenderer.invoke(Channels.courseCreate, title);
  },
  async renameCourse(id: string, title: string): Promise<CourseSummary> {
    return ipcRenderer.invoke(Channels.courseRename, { id, title });
  },
  async setActiveCourse(id: string): Promise<CourseListResult> {
    return ipcRenderer.invoke(Channels.courseSetActive, id);
  },
  async revealCourse(id: string, target: CourseRevealTarget): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.courseReveal, { id, target });
  },
  /** Move a course folder to the OS trash (capability `course-workspace`,
   * Requirement: Course Deletion from the Detail View, Reversible via the OS
   * Trash). Returns the refreshed list plus the re-resolved active course. */
  async deleteCourse(id: string): Promise<CourseDeleteResult> {
    return ipcRenderer.invoke(Channels.courseDelete, id);
  },
  /** `token` names the run the caller has just recorded (every progress event of
   * this run carries it back); `courseId` is the course the caller recorded it
   * under, which the host checks against the active course and refuses on a
   * mismatch — see `WikiIngestStartPayload`. */
  async ingestToWiki(payload: WikiIngestStartPayload): Promise<WikiIngestResult[] | null> {
    return ipcRenderer.invoke(Channels.wikiIngest, payload);
  },
  /** Ends the run named by `token`, and no other — runs in different courses can
   * be in flight together. `delivered` says whether the abort actually reached
   * that run: one still in its pre-flight or extraction phase has nothing to
   * signal, and the host then holds no controller for it. */
  async abortWikiIngest(token: string): Promise<{ ok: true; delivered: boolean }> {
    return ipcRenderer.invoke(Channels.wikiIngestAbort, token);
  },
  async listWikiAtoms(courseId: string): Promise<WikiListResult> {
    return ipcRenderer.invoke(Channels.wikiList, courseId);
  },
  onWikiIngestProgress(listener: (evt: WikiIngestProgressEvent) => void): () => void {
    const handler = (_e: unknown, evt: WikiIngestProgressEvent) => listener(evt);
    ipcRenderer.on(Channels.wikiIngestProgress, handler);
    return () => ipcRenderer.off(Channels.wikiIngestProgress, handler);
  },
  /** Route a confirmed UI deletion of a canvas artefact into the host-side deletion
   * pipeline (mirror removal + pending deletion notice). Fire-and-forget from the
   * renderer's point of view — the store applies the equivalent clear locally. */
  async deleteCanvasArtefact(payload: CanvasDeletePayload): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.canvasDelete, payload);
  },
  /** Route a lecturer's canvas step selection into the host-side focus pipeline
   * (mirror focus + pending focus notice for the next lecturer turn). Dispatches NO
   * prompt and creates no user turn — the renderer applies the equivalent focus
   * locally, so the in-focus marker moves without waiting for the round trip. */
  async focusStep(payload: StepFocusPayload): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.stepFocus, payload);
  },
  /** Version + cache date of the loaded corpus (capability `distribution`,
   * Scenario: Corpus version auditable from the app). */
  async getCorpusInfo(): Promise<CorpusInfo> {
    return ipcRenderer.invoke(Channels.corpusInfo);
  },
  /** User-triggered corpus refresh: fetch pointer → verify SHA256 → unpack.
   * Every outcome is a value; a failed refresh never unloads the current corpus. */
  async refreshCorpus(): Promise<CorpusRefreshResult> {
    return ipcRenderer.invoke(Channels.corpusRefresh);
  },
  /** Read-only facts behind the settings About group (capability `desktop-app`,
   * Requirement: Settings Panel (Phase 1 scaffold)): the running app version and
   * the loaded skill's name and version, each read from its real source. */
  async getAboutInfo(): Promise<AboutInfo> {
    return ipcRenderer.invoke(Channels.aboutInfo);
  },
  onAgentEvent(listener: (evt: AgentEvent) => void): () => void {
    const handler = (_e: unknown, evt: AgentEvent) => listener(evt);
    ipcRenderer.on(Channels.agentEvents, handler);
    return () => ipcRenderer.off(Channels.agentEvents, handler);
  },
  /** Auto-update lifecycle events (capability `distribution`, Requirement:
   * Auto-update mechanism) — feeds the non-blocking update notice. */
  onUpdateEvent(listener: (evt: UpdateEvent) => void): () => void {
    const handler = (_e: unknown, evt: UpdateEvent) => listener(evt);
    ipcRenderer.on(Channels.updateEvent, handler);
    return () => ipcRenderer.off(Channels.updateEvent, handler);
  },
  /** User decision on an offered update: install now / restart / later / skip. */
  async updateAction(payload: UpdateActionPayload): Promise<{ ok: true }> {
    return ipcRenderer.invoke(Channels.updateAction, payload);
  },
};

contextBridge.exposeInMainWorld("cbe", api);
export type CbeApi = typeof api;
