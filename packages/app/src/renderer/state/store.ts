import { create } from "zustand";
import type {
  ProviderStatus,
  StartSessionResult,
  DisplayAttachment,
  CourseSummary,
  CourseListResult,
  ConversationOpenResult,
  AgentEvent,
  ContextUsageReport,
  WikiIngestProgressEvent,
} from "../../shared/ipc-contract.js";
import { applyPalette, type Accent, type Flavour, type Theme } from "../theme/catppuccin.js";
import {
  resetDownstreamOnGoalChange,
  downstreamChecks,
  emptyDidacticChecks,
  type CheckName,
  type DidacticChecks,
} from "@cbe/pi-bridge/didactic-checks";
import type { DimensionRecord, LecturerProfile, ProfileDimension } from "@cbe/pi-bridge/lecturer-profile";
import {
  seededArtefactLabel,
  seededJourneyName,
  seededJourneyNameInAnyLanguage,
  seededLabelInAnyLanguage,
  seededStepName,
  seededStepNameInAnyLanguage,
  type ArtefactItem,
  type ArtefactState,
  type StepDepth,
  type StepGroup,
  type StepId,
} from "../mocks/artifacts.js";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";
import { chrome } from "../chrome.js";
import { resolveCanvasAddress, type ResolvedCanvasAddress } from "@cbe/pi-bridge/canvas-addressing";
import type { ArtifactAnnotation } from "../util/annotations.js";
import type { PanelSide } from "../../shared/layout.js";
import { INITIAL_LIVE, liveReducer, type LiveTurnState } from "./liveReducer.js";
import { activityFromStoredTurn, type ActivityItem } from "./activity.js";
import type { MaturitySnapshot, MaturityToolDetails } from "@cbe/pi-bridge/maturity";
import { sanitizeMaturitySnapshot } from "@cbe/pi-bridge/maturity";
import type { MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import {
  applyCanvasClear,
  applyCanvasSet,
  applyMaturityUpdate,
  applyStepPatch,
  emptyMaturityState,
  finalizeConversationRun,
  itemExistsAt,
  mapContainerAt,
  newConversation,
  panelResponseToArtefactWrite,
  parseCanvasDetails,
  reduceConversation,
  seedArtifacts,
  seedSteps,
  stepsFromSnapshot,
  upsertItem,
  type ConversationState,
  type ChatNotice,
  type StepCoverage,
  type Turn,
} from "./conversationReducer.js";

// Conversation-slice types moved to conversationReducer.ts (per-session state,
// capability `desktop-app`, Requirement: Background Conversations and Per-Session
// Event Demultiplexing); re-exported so existing imports keep working.
export type { Turn, StepCoverage, ConversationState, ChatNotice };

/** The right panel holds ONLY what belongs to the course (capability
 * `desktop-app`, Requirement: Collapsible Right Panel): the design canvas and the
 * maturity reading, in that order. Course management is the left panel's; the
 * lecturer profile and the settings surface are reached from the header. The
 * slice ids stay `artifacts` / `maturity` — labels and ids are governed
 * separately in this repo, and no id, tool or component identifier is renamed by
 * the surface vocabulary. */
export type PanelTab = "artifacts" | "maturity";

/** A panel's collapse state (capability `desktop-app`, Requirements: Collapsible
 * Right Panel; Collapsible Left Panel; The Chat Column Survives Two Flanking
 * Panels). Session-scoped for both panels — never persisted; the WIDTH is what
 * persists. `auto` distinguishes a collapse the APP performed to make room (a
 * layout consequence, reversible when the window grows) from one the lecturer
 * performed (a decision, never undone by the layout). */
export interface PanelCollapseState {
  collapsed: boolean;
  auto: boolean;
}

/** Which section of the Profile-and-Settings overlay is shown, or `null` while
 * the overlay is closed (capability `desktop-app`, Requirement:
 * Profile-and-Settings Overlay). ONE overlay with two sibling sections and two
 * entry points: the user affordance opens it at `profile`, the gear at
 * `settings`. Moving between the sections does not close and re-open it, so this
 * doubles as the in-overlay navigation state. Never persisted — a fresh mount
 * shows the workspace. */
export type OverlaySection = "profile" | "settings" | null;

/** The four accordion groups of the Settings section, in the order they are
 * rendered (Requirement: Settings Panel (Phase 1 scaffold)). */
export type SettingsGroup = "model" | "appearance" | "about" | "corpus";
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ["model", "appearance", "about", "corpus"];

/** Discrete chat-transcript text sizes (Requirement: Settings Panel, chat
 * text-size control). Kept as a validated list so App.tsx can hydrate the
 * persisted choice with the same allowlist pattern as theme/flavour/accent. */
export type ChatTextSize = "small" | "medium" | "large";
export const CHAT_TEXT_SIZES: readonly ChatTextSize[] = ["small", "medium", "large"];

/** Boot-hydration lifecycle (capability `desktop-app`, Requirement: Renderer
 * Boot-Hydration from the Main Process): `pending` shows the busy pane and keeps
 * the composer unavailable; `error` shows the retry pane; `ready` renders the
 * conversation. `idle` = before/without a provider configuration. */
export type HydrationState = "idle" | "pending" | "ready" | "error";

/** Application-level first-use state. It is deliberately outside conversation
 * slices: one local app-data profile has one acknowledgment across every course,
 * conversation, provider and interface language. */
export type OnboardingStatus = "unknown" | "pending" | "acknowledged";
export type OnboardingIssue = "read-failed" | "write-failed" | null;

/** Per-course activity signal for the switching surface (the
 * left panel's course cards): running while the course's session has a turn in flight,
 * unseen once a background run completed while the course was not visible. */
export interface CourseActivity {
  running: boolean;
  unseen: boolean;
}

/**
 * One course's wiki-ingestion run, as the renderer holds it (capability
 * `lecturer-wiki`, Requirement: Ingest Progress Outlives the Surface That Shows
 * It). State of the RUN, not of the panel that displays it: the left panel does
 * not render its body while collapsed, so a component-local record would be
 * discarded on every collapse cycle — and worse, the progress stream carries no
 * replay, so a component-scoped subscription loses events for good.
 *
 * `docs` is an array in ARRIVAL order, upserted by filename — the order the
 * component's `Map` had, without a mutable object living in store state.
 */
export interface WikiIngestRun {
  /** A run is in flight (the abort control is offered; a second start is refused). */
  running: boolean;
  /** Per-document rows, first-seen order, one entry per filename. */
  docs: WikiIngestProgressEvent[];
  /** The run's closing outcome, or null while it runs / after a cancelled dialog. */
  notice: string | null;
  /**
   * Which run this record IS, bumped on every start (capability `lecturer-wiki`,
   * Requirement: An Ingest That Cannot Reach the Model Fails Visibly and Stays
   * Retryable). It exists so an outcome can only ever end its OWN run: the
   * lecturer may abort a run whose `ingestToWiki()` promise is still in flight
   * — that is the whole point of being able to end a stuck run — and the
   * outcome arriving afterwards would otherwise mark the NEXT run of the same
   * course finished, re-arming the start control behind a live ingest. That is
   * precisely the data loss the start guard exists to prevent, through a
   * different door.
   */
  runId: number;
  /**
   * The token the run was started with, echoed by every progress event of that
   * run (`WikiIngestProgressEvent.token`). `runId` guards the run's OUTCOME; this
   * guards its per-document ROWS, against the same interleaving: an aborted run
   * whose documents report `aborted` / `failed` afterwards would otherwise have
   * those rows upserted by filename into the successor's record, overwriting a
   * live document's status and adding rows for documents the successor never
   * picked. `null` in the empty record, which therefore matches no event.
   *
   * It is also what an abort NAMES, so that ending this record ends this run and
   * no other — see `abortWikiIngest` in `state/wikiIngest.ts`.
   */
  token: string | null;
}

/** Aggregate of every recorded run, for the collapsed rail's summary. */
export interface WikiIngestActivity {
  running: boolean;
  /** Documents whose status has settled (`done` | `failed` | `aborted`). */
  settled: number;
  /** Documents the run has reported at all. */
  total: number;
}

const SETTLED_INGEST_STATUS: ReadonlySet<WikiIngestProgressEvent["status"]> = new Set([
  "done",
  "failed",
  "aborted",
] as const);

export const EMPTY_WIKI_INGEST_RUN: WikiIngestRun = { running: false, docs: [], notice: null, runId: 0, token: null };

/**
 * The collapsed left rail's ingest summary — a PURE derivation over the same
 * records the expanded panel renders row by row (capability `lecturer-wiki`,
 * Requirement: Ingest Progress Outlives the Surface That Shows It, § one record,
 * two projections). Nothing about the summary is stored, so the rail's count and
 * the panel's rows cannot drift apart.
 *
 * Counts LIVE runs only, across courses: the rail is one control for all of them,
 * and a finished run's documents are not part of what is in flight.
 */
export function wikiIngestActivity(runs: Record<string, WikiIngestRun>): WikiIngestActivity {
  let running = false;
  let settled = 0;
  let total = 0;
  for (const run of Object.values(runs)) {
    if (!run.running) continue;
    running = true;
    for (const doc of run.docs) {
      total += 1;
      if (SETTLED_INGEST_STATUS.has(doc.status)) settled += 1;
    }
  }
  return { running, settled, total };
}

interface CbeState {
  /**
   * Per-session conversation slices, keyed by `sessionId` (capability
   * `desktop-app`, Requirement: Background Conversations and Per-Session Event
   * Demultiplexing). The slice whose `session.courseId` matches
   * `activeCourseId` is the VISIBLE conversation; the top-level fields below
   * (`session`, `turns`, `live`, `agentRunning`, `notice`, `artifacts`,
   * `steps`, `offerReasoningRemediation`) mirror that visible slice so every
   * existing selector keeps working. All slice mutations flow through actions
   * in this store, which keep the mirror in sync in the same `set` call.
   */
  conversations: Record<string, ConversationState>;

  session: StartSessionResult | null;
  turns: Turn[];
  /** Live activity stream of the VISIBLE conversation's current run. */
  live: LiveTurnState;
  configured: boolean;
  providerStatus: ProviderStatus | null;
  error: string | null;
  /** Non-fatal, dismissible notice from conversation resolution (unreadable
   * archive) — rendered as a banner, not the red alert. */
  notice: string | null;
  /** Mirror: dispatch-in-flight flag of the VISIBLE conversation. */
  dispatchPending: boolean;
  /** Mirror: soft inline chat notice of the VISIBLE conversation (Requirement:
   * Tiered Error Surfacing — recoverable failures, non-alarm presentation). */
  chatNotice: ChatNotice | null;
  hydration: HydrationState;
  hydrationError: string | null;

  /** Main-owned first-use marker projected into application state. A delayed
   * read can move unknown → pending/acknowledged but never reverse a local or
   * accepted-dispatch acknowledgment. */
  onboardingStatus: OnboardingStatus;
  onboardingIssue: OnboardingIssue;
  onboardingAnnounced: boolean;
  /** A modal other than the Profile-and-Settings overlay (currently citation
   * detail) is open over the workspace. Readiness hides, never acknowledges. */
  modalSurfaceOpen: boolean;

  // Appearance — persisted (localStorage). Apply via applyPalette() on every change.
  theme: Theme;
  flavour: Flavour;
  accent: Accent;
  /** Chat text size — persisted (localStorage); ChatPanel binds it as a data
   * attribute on the chat scroll container AND on the composer, so what the
   * lecturer reads and what they type scale together (Requirement: Settings
   * Panel, chat text-size control). */
  chatTextSize: ChatTextSize;

  // Right-panel tab — ephemeral. Default depends on view (set by App.tsx on mount).
  panelTab: PanelTab;
  // Right-panel collapse state — ephemeral, session-scoped, default EXPANDED on
  // the CBE Process Canvas tab (product decision 2026-08-14: the workspace opens
  // on the design work). Not persisted — it re-defaults on every fresh mount,
  // exactly as before the default was swapped.
  panelCollapsed: boolean;
  /** Was the right panel collapsed by the app to make room, rather than by the
   * lecturer? Only an app collapse is reversed when the window grows again. */
  panelAutoCollapsed: boolean;

  /** Left-panel collapse state — the peer of `panelCollapsed` under the SAME
   * rule (capability `desktop-app`, Requirement: Collapsible Left Panel):
   * session-scoped, never persisted, default COLLAPSED to its rail. */
  leftPanelCollapsed: boolean;
  leftPanelAutoCollapsed: boolean;

  /** The left panel's current LEVEL: `null` is the course list, a course id is
   * that course's detail level. Preserved across any number of collapse cycles —
   * the parity of the right panel's tab-selection preservation — which is why it
   * lives here and not inside the unmounted panel body. */
  courseDetailId: string | null;

  /** The detail level's active tab (Requirement: Course Detail Tabs: Chats and
   * Wiki). In the store for the same reason as the level above: the panel body
   * unmounts while collapsed, and a collapse over the Wiki tab must re-expand on
   * the Wiki tab — the lecturer-wiki run rows "show again on re-expanding" only
   * if the tab survives the cycle. Opening a DIFFERENT course's detail resets it
   * to the Chats default (`setCourseDetailId`). */
  courseDetailTab: "chats" | "wiki";

  /** Wiki-ingestion runs, keyed by the course they write into (capability
   * `lecturer-wiki`, Requirement: Ingest Progress Outlives the Surface That Shows
   * It). Keyed rather than a single slot for the reason `main/ipc.ts` keys its own
   * registry: overlapping runs are reachable, and every progress event carries its
   * `courseId`. Fed by the ONE application-level subscription in
   * `state/wikiIngest.ts` — never by a component effect. */
  wikiIngest: Record<string, WikiIngestRun>;
  /** Course-scoped invalidation for atom listings. Advanced only by an accepted
   * successful/partially successful run completion, never by a component. */
  wikiAtomRevision: Record<string, number>;

  /** Bumped when a surface asks the left panel's course list to take focus (the
   * header's active-course name — Requirement: App Header Strip). A counter, not
   * a boolean: two reveals in a row must both move focus. */
  coursesFocusRequest: number;

  /** The request the course list has already consumed. It lives HERE and not in
   * the list component, because the left panel does not render its body while
   * collapsed: a component-local marker resets on every expansion, and the
   * mount-time focus effect would then pull focus onto the first course card on
   * every rail or edge-toggle expansion — only the header reveal is specified to
   * move focus (Requirement: App Header Strip). */
  coursesFocusHandled: number;

  /** The side most recently expanded on purpose — by the lecturer, or by the
   * app's own one-time canvas reveal. Protected from auto-collapse, which is
   * what makes "expanding is never refused" true in a narrow window.
   *
   * It guards the EXPANSION, not the panel: a window resize clears it, so the
   * fixed left-then-right collapse order governs from then on. Without that,
   * expanding the left panel once would exempt it from every later narrowing. */
  lastExpandedSide: PanelSide | null;

  /** The open section of the Profile-and-Settings overlay, `null` while closed
   * (Requirement: Profile-and-Settings Overlay). Ephemeral and never persisted:
   * the overlay is never open on a fresh mount. */
  overlaySection: OverlaySection;

  /** The single open accordion group of the Settings section (Requirement:
   * Settings Panel (Phase 1 scaffold)). Exactly one group is open at a time.
   *
   * It is NOT a "last-open group" memory, and it must never become one: every
   * showing of the settings surface recomputes it from the two-branch rule in
   * `showSettingsSurface` below, so which group the lecturer had open when they
   * closed the surface has no effect on the next showing. The field exists
   * because the rule is a coordination between the overlay's showing and the
   * accordion, and both halves need to read it. */
  settingsOpenGroup: SettingsGroup;

  /** The group holding an unsaved edit, or `null` when nothing is pending
   * (Requirement: Settings Save Feedback and Unsaved-Changes Indication). Two
   * consumers outside the group itself: the header's gear carries the
   * unsaved-changes indication from it while the overlay is CLOSED, and the
   * accordion's second branch opens on it after such a dismissal. Only the Model
   * group has an explicit Save action today, so only it ever sets this. */
  settingsDirtyGroup: SettingsGroup | null;

  /** The one-time canvas reveal is still available (Requirement: Panel Follows the
   * Agent's Artefact Work). Lives HERE, beside `panelTab` / `panelCollapsed`, because
   * it guards exactly that global panel state: a deliberate navigation disarms it for
   * the whole app session, so neither a New Session nor a course switch can undo the
   * lecturer's decision. Ephemeral and session-scoped like its neighbours — armed
   * again on a fresh renderer mount, never persisted. */
  panelRevealArmed: boolean;

  /** Mirror: the VISIBLE conversation's Artifacts tab carries unseen artefact
   * changes (Requirement: Panel Follows the Agent's Artefact Work). Per
   * conversation like the other design-state slices — a background course's write
   * never marks the visible course's tab. */
  artifactsAttention: boolean;

  // Course workspace (capability `course-workspace`): the scanned courses and the
  // active course id — both hydrated from the main process (folder scan + persisted
  // pointer), never from renderer-side storage. Drives the header strip + left panel.
  courses: CourseSummary[];
  activeCourseId: string;

  // True while the VISIBLE conversation's agent turn is in flight (mirror of the
  // visible slice's running flag). A running background turn never sets this —
  // the composer lock, working indicator, and mid-turn guards are armed from the
  // visible conversation only (Requirement: Background Conversations and
  // Per-Session Event Demultiplexing).
  agentRunning: boolean;

  // Didactic-check state populating the Canvas Decisions section — a MIRROR of the
  // visible conversation's slice, like `artifacts` / `steps` / `maturity`
  // (Requirement: Decision Artefacts Are Per-Conversation State). Cold start is the
  // EMPTY state: demo/fixture content is never a lecturer-facing value.
  didacticChecks: DidacticChecks;
  // Which downstream checks were invalidated by the lecturer revising an upstream
  // operative goal (Requirement: Decision Artifacts, goal-revision propagation).
  // Scoped to the same conversation as `didacticChecks`.
  invalidatedChecks: CheckName[];

  // Artifact annotation layer (Requirement: Artifact Annotation and Iteration
  // Loop). Per-round, NOT a persistent comment thread — the chat history is the
  // persistent record. Cleared after a round is sent and on artifact replacement.
  // Visible-conversation concern: anchored to the visible canvas.
  annotations: ArtifactAnnotation[];

  // Live Canvas state of the VISIBLE conversation (mirror of its slice).
  artifacts: StepGroup[];

  // Per-step coverage of the VISIBLE conversation (mirror of its slice).
  steps: StepCoverage[];

  // Recorded maturity raster of the VISIBLE conversation (mirror of its slice;
  // Requirement: Maturity Panel). Empty object = no reading (panel empty state).
  maturity: MaturitySnapshot;

  /** Host-derived substance / provenance / staleness framing for the VISIBLE
   * conversation's reading (mirror of its slice; capability `desktop-app`,
   * Requirement: Maturity Panel Substance and Staleness Framing). Computed
   * entirely host-side — the panel renders it, never recomputes it. */
  maturityState: MaturityDerivedState;

  /** Reasoning-remediation affordance of the VISIBLE conversation (mirror). */
  offerReasoningRemediation: boolean;

  /** Mirror: surfaced "response was cut off" note of the VISIBLE conversation
   * (Requirement: Response-Cut-Off State with One-Click Continue and Retry),
   * or null. Set by the `truncation_cutoff` event, cleared at the next run. */
  cutOffNote: string | null;

  /** Mirror: has a lecturer stop on the VISIBLE conversation reported
   * `timed-out` over a run the runtime has not released since (capability
   * `desktop-app`, Requirement: *Composer Control Row*)? Per slice, so it
   * survives the panel unmounting for a course switch and a background
   * conversation's timed-out stop never surfaces here. */
  stopTimedOut: boolean;

  /** Mirror: the VISIBLE conversation's context occupancy, as the harness last
   * reported it (Requirement: Context-Usage Ring in the Composer Control Row).
   * The renderer computes neither figure. */
  contextUsage: ContextUsageReport | null;
  /** Mirror: has the VISIBLE conversation ever carried a measured occupancy?
   * Separates the ring's fresh state from its carried-but-unmeasured one. */
  contextEverMeasured: boolean;
  /** Mirror: is a compaction companion sequence running for the VISIBLE
   * conversation? The ring's pending state. */
  contextPending: boolean;

  setSession: (s: StartSessionResult | null) => void;
  appendUserTurn: (text: string, attachments?: DisplayAttachment[]) => void;
  /** Persist the live activity stream as a finalised assistant turn. The caller
   * passes the captured `ActivityItem[]` snapshot directly — no implicit reach
   * into store-side draft state. Empty snapshots are a no-op. */
  appendAssistantTurn: (activity: ActivityItem[]) => void;
  setConfigured: (v: boolean) => void;
  setProviderStatus: (s: ProviderStatus | null) => void;
  setError: (msg: string | null) => void;
  setNotice: (msg: string | null) => void;
  /** Set/clear the VISIBLE conversation's dispatch-in-flight flag. Every prompt
   * dispatcher sets it synchronously before `sendPrompt` and clears it when the
   * dispatch settles; `agent_start` clears it in the reducer. */
  setDispatchPending: (v: boolean) => void;
  /** Set/dismiss the VISIBLE conversation's soft inline chat notice. */
  setChatNotice: (n: ChatNotice | null) => void;
  /** Roll back an optimistically appended user turn after a rejected dispatch
   * (Requirement: Canvas Dialogue-Steering Dispatches Respect the Run Lock — no
   * phantom turns). No-op unless the trailing turn is a user turn. */
  removeLastUserTurn: () => void;
  setHydration: (state: HydrationState, error?: string | null) => void;
  resolveOnboarding: (result: { acknowledged: boolean; issue?: "unreadable" }) => void;
  acknowledgeOnboarding: (persisted?: boolean) => void;
  /** The one settle path shared by Begin, Skip and the About overview's Close:
   * acknowledge optimistically, then reflect what the main process could write.
   * Focus handling stays with each call site. */
  settleOnboarding: () => void;
  setOnboardingIssue: (issue: OnboardingIssue) => void;
  markOnboardingAnnounced: () => void;
  setModalSurfaceOpen: (open: boolean) => void;

  setTheme: (t: Theme) => void;
  setFlavour: (f: Flavour) => void;
  setAccent: (a: Accent) => void;
  setChatTextSize: (s: ChatTextSize) => void;
  setPanelTab: (t: PanelTab) => void;
  /** Collapse/expand the RIGHT panel deliberately (lecturer or app reveal). Any
   * deliberate change clears the auto flag — what follows is no longer a layout
   * consequence the app may undo — and an expansion protects this side from the
   * width arbitration. */
  setPanelCollapsed: (collapsed: boolean) => void;
  /** The left panel's peer of `setPanelCollapsed`, under the same rule. */
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  toggleLeftPanelCollapsed: () => void;
  /** Apply what the width arbitration decided (capability `desktop-app`,
   * Requirement: The Chat Column Survives Two Flanking Panels). Separate from the
   * deliberate setters on purpose: an auto-collapse is not a lecturer collapse,
   * so it neither disarms the one-time canvas reveal nor becomes permanent. */
  applyPanelArbitration: (next: { left: PanelCollapseState; right: PanelCollapseState }) => void;
  /** Drop the just-expanded side's exemption from auto-collapse. Called on a
   * window resize: the exemption exists to keep one expansion from being refused,
   * not to make a panel permanently un-collapsible. */
  clearExpandProtection: () => void;
  /** Reveal the course surface: expand the left panel, bring its LIST level
   * forward and ask it for focus (Requirement: App Header Strip — the header's
   * active-course name reveals rather than switches). */
  revealCourses: () => void;
  /** Record that the course list has consumed focus request `seq`, so a later
   * mount of the same list (a plain expansion) moves focus nowhere. */
  noteCoursesFocusHandled: (seq: number) => void;
  /** Open a course's detail level, or return to the list with `null`. */
  setCourseDetailId: (id: string | null) => void;
  /** Switch the detail level's tab (plain surface switch, no side effects). */
  setCourseDetailTab: (tab: "chats" | "wiki") => void;
  /** A wiki ingestion has been started for `courseId`: in flight, no rows yet,
   * no notice. `token` names the run and is what its progress events carry back.
   * Called from `state/wikiIngest.ts`, never from a component. */
  startWikiIngestRun: (courseId: string, token: string) => void;
  /** Record one per-document progress event, upserted by filename into the run's
   * arrival-ordered rows.
   *
   * An event is applied ONLY to the run it belongs to: its `token` must be the
   * one the course's current record was started with. Anything else is a run
   * that has been superseded — the record has moved on — and is discarded, rows
   * and all, so a dead run can neither overwrite a live document's status nor
   * add rows the live run never picked (see `WikiIngestRun.token`). */
  applyWikiIngestProgress: (evt: WikiIngestProgressEvent) => void;
  /** The run has ended (or its file dialog was cancelled, with `notice` null):
   * clear the in-flight flag and record the closing notice. The rows stay, so a
   * finished run is still readable after the fact.
   *
   * `runId` names the run being reported on. When it does not match the record's,
   * the record has moved on to a LATER run and this call is a no-op — a late
   * outcome never ends the run that followed it. Omitting it reports on whatever
   * the record currently holds. `atomsChanged` advances only this course's atom
   * revision in the same guarded update, so completion and invalidation cannot
   * disagree about which run won. */
  finishWikiIngestRun: (courseId: string, notice: string | null, runId?: number, atomsChanged?: boolean) => void;
  /** Open the Profile-and-Settings overlay at one of its two sections, or move
   * to the other section while it is already open — the same call, because the
   * overlay's contract is that switching sections never closes and re-opens it.
   * Showing the Settings section additionally applies the accordion's two-branch
   * rule (see `settingsOpenGroup`). */
  showSettingsSurface: (section: Exclude<OverlaySection, null>) => void;
  /** Named direct About route used by the native menu. It changes visibility
   * only; any dirty group remains recorded for the next generic Settings open. */
  showAboutSurface: () => void;
  /** Close the overlay. Loses nothing: the sections stay mounted, so an unsaved
   * settings edit survives for the app session and the gear keeps carrying its
   * indication (Requirement: Profile-and-Settings Overlay). */
  closeSettingsSurface: () => void;
  /** Open one settings accordion group, which closes the one that was open. */
  setSettingsOpenGroup: (group: SettingsGroup) => void;
  /** Report which group holds an unsaved edit (`null` when none does). */
  setSettingsDirtyGroup: (group: SettingsGroup | null) => void;
  /** Record a DELIBERATE panel navigation by the lecturer (tab click, rail click,
   * edge toggle). Disarms the one-time canvas reveal for the rest of the app
   * session: someone who has already found the panel is never moved out of it, and
   * that decision survives a New Session and a course switch (Requirement: Panel
   * Follows the Agent's Artefact Work). Deliberately NOT called by the mount-time
   * default-tab hydration or by the reveal itself. */
  notePanelNavigation: () => void;
  /** Clear the Artifacts attention marker of the visible conversation — called when
   * the canvas actually becomes the visible surface, by whichever route. */
  clearArtifactsAttention: () => void;
  togglePanelCollapsed: () => void;
  /** Replace the course slice from a main-process `CourseListResult` (list scan,
   * create, switch — every course IPC round-trip returns the fresh state). */
  setCourses: (result: CourseListResult) => void;
  /** Drop every conversation slice whose course is no longer in the scanned list
   * (course deletion). A course id is derived from the title's slug, so a course
   * later created under the same title would otherwise inherit the deleted
   * course's turns, canvas artefacts and maturity — the cross-conversation bleed
   * this store isolates everywhere else. */
  dropConversationsOfRemovedCourses: (remainingCourseIds: string[]) => void;
  setActiveCourse: (id: string) => void;

  /**
   * Route ONE agent event into the conversation slice owning `event.sessionId`
   * (capability `desktop-app`, Requirement: Background Conversations and
   * Per-Session Event Demultiplexing). Subscribed exactly once at application
   * level (`state/agentEvents.ts`). An event whose sessionId matches no known
   * slice is dropped without side effects. Only when the owning slice is the
   * VISIBLE conversation does the event touch the top-level mirror (composer
   * lock, live view, error banner) — background events accumulate invisibly in
   * their own slice.
   */
  ingestAgentEvent: (evt: AgentEvent) => void;
  /** Fallback finalization after `sendPrompt` resolves: persist whatever live
   * activity was captured if the run's `agent_end` did not (no-op otherwise). */
  finalizeRun: (sessionId: string) => void;
  /** Authoritative live-state wipe when the lecturer sends the next prompt. */
  resetLiveActivity: (sessionId: string) => void;
  /** Record that a lecturer stop on this session reported `timed-out`
   * (capability `desktop-app`, Requirement: *Composer Control Row*). RAISE
   * only: no outcome clears it, because a run held past the bound cannot report
   * `timed-out` twice and clearing on a later one would delete the lecturer's
   * only way out. The run boundary in the reducer is what clears it. */
  noteStopTimedOut: (sessionId: string) => void;
  /** Dismiss / consume the visible conversation's reasoning-remediation offer. */
  dismissReasoningRemediation: () => void;

  /** Resume rehydration: replace the VISIBLE conversation's Decisions state from a
   * session sidecar's `didacticChecks` without recomputing any check. Clears the
   * invalidated set. Scoped to the visible slice — another course's decisions are
   * never overwritten (Requirement: Decision Artefacts Are Per-Conversation State). */
  hydrateDidacticChecks: (checks: DidacticChecks) => void;
  /** Boot-hydration (capability `desktop-app`, Requirement: Renderer
   * Boot-Hydration from the Main Process): land a `conversationOpen` result in
   * the store. A session we already hold a slice for (in-app switch back)
   * re-attaches — its buffered live stream and rich turns are kept, nothing of
   * the stream is lost. Otherwise a fresh slice is built from the result
   * (re-attach after reload, resume, fresh start). The renderer renders what
   * main reports; it never decides which session exists. */
  hydrateConversation: (result: ConversationOpenResult) => void;
  /** The lecturer revised an upstream operative goal: reset downstream checks to
   * not-started and mark them invalidated so the Decisions section can signal it. */
  reviseGoal: (check: CheckName) => void;

  /** Add an annotation anchored to an artifact (excerpt + lecturer note). */
  addAnnotation: (artifactId: string, excerpt: string, note: string) => void;
  /** Remove a single annotation by id. */
  removeAnnotation: (id: string) => void;
  /** Clear the whole annotation layer — called once an iteration round is sent. */
  clearAnnotations: () => void;
  /** Reset-on-replacement: when a revised artifact replaces the previous one, drop
   * that artifact's annotations (the iteration trail lives on in the chat history). */
  resetAnnotationsForArtifact: (artifactId: string) => void;

  /** Apply one `cbe_canvas` tool-call to the VISIBLE conversation's Canvas. Resolves
   * the address via the shared rule (`resolveCanvasAddress`) then replaces the artefact
   * when its id already exists at the resolved location, else inserts it. An
   * unresolvable address is ignored. On replacement it drops the artefact's stale
   * annotations inline. */
  applyCanvasUpdate: (
    step: number | undefined,
    phase: string | undefined,
    id: string,
    patch: { label?: string; value: string; state?: ArtefactState }
  ) => void;

  /** Apply a `cbe_canvas` clear (or a confirmed UI deletion) to the VISIBLE
   * conversation's Canvas, resolving the target by the same shared rule. */
  clearCanvasArtefact: (step: number | undefined, phase: string | undefined, id: string) => void;

  /** Apply one `cbe_step` tool-call to the VISIBLE conversation's step coverage. */
  applyStepUpdate: (step: number, patch: { depth?: StepDepth; focus?: boolean }) => void;

  /** Apply one validated `cbe_maturity` update to the VISIBLE conversation's
   * maturity raster (record semantics via the shared reducer). */
  applyMaturityUpdate: (details: MaturityToolDetails) => void;

  /** Live lecturer profile rendered by the Profile Panel (capability `desktop-app`,
   * Requirement: Profile Panel). Hydrated from the persisted record on panel mount;
   * updated live from `cbe_profile` tool calls and panel overrides. */
  lecturerProfile: LecturerProfile;
  /** Replace the whole profile (hydration on mount, override round-trip result). */
  setLecturerProfile: (profile: LecturerProfile) => void;
  /** Apply one `cbe_profile` tool-call to the live profile. Mirrors the main-process
   * precedence rule: an estimate never overwrites a lecturer override — unless the
   * call is lecturer-confirmed, which replaces the override with a regular estimate. */
  applyLecturerProfileUpdate: (
    dimension: ProfileDimension,
    record: DimensionRecord,
    lecturerConfirmed?: boolean
  ) => void;

  /** Re-derive the chrome labels the canvas seed wrote into per-conversation
   * state, after an interface-language change (capability `desktop-app`,
   * Requirement: *Every String the App Renders Is English* — "A change MUST take
   * effect immediately across the whole chrome"). */
  relabelSeededChrome: () => void;
  reset: () => void;
}

/** The sessionId of the slice belonging to `activeCourseId`, or null. */
function visibleIdOf(conversations: Record<string, ConversationState>, activeCourseId: string): string | null {
  for (const [id, c] of Object.entries(conversations)) {
    if (c.session.courseId === activeCourseId) return id;
  }
  return null;
}

/**
 * Re-derive the labels the canvas SEED wrote into per-conversation state, for the
 * interface language now in force.
 *
 * A seeded label is data by the time the language moves — the seed resolved it once
 * — so a re-render alone cannot change it. A label is treated as seeded, and
 * therefore re-derived, when it equals what ANY shipped catalogue seeds for that id;
 * anything else was supplied by the skill through `cbe_canvas` and is lecturer-language
 * content that must survive untouched (capability `desktop-app`, Requirement: *Every
 * String the App Renders Is English*, § "Values the skill supplies that the app merely
 * renders").
 */
function relabelArtifacts(groups: StepGroup[]): StepGroup[] {
  const strings = chrome();
  const item = (it: ArtefactItem): ArtefactItem =>
    seededLabelInAnyLanguage(it.id, it.label) ? { ...it, label: seededArtefactLabel(it.id, strings) } : it;
  return groups.map((g) => ({
    ...g,
    name: seededStepNameInAnyLanguage(g.step, g.name) ? seededStepName(g.step, strings) : g.name,
    items: g.items.map(item),
    ...(g.journey
      ? {
          journey: g.journey.map((el) => ({
            ...el,
            name: seededJourneyNameInAnyLanguage(el.phase, el.name) ? seededJourneyName(el.phase, strings) : el.name,
            items: el.items.map(item),
          })),
        }
      : {}),
  }));
}

function relabelSteps(steps: StepCoverage[]): StepCoverage[] {
  const strings = chrome();
  return steps.map((sc) =>
    seededStepNameInAnyLanguage(sc.step as StepId, sc.label)
      ? { ...sc, label: seededStepName(sc.step as StepId, strings) }
      : sc
  );
}

/** Top-level mirror of one (visible) conversation slice — every existing
 * selector (`s.session`, `s.turns`, `s.agentRunning`, …) reads this.
 *
 * Exported for `tests/course-switch-session-mirror.test.ts`, which asserts that
 * `emptyConversationMirror()` answers every key this writes. Nothing else outside
 * this module may call it: the mirror is written here and read through selectors. */
export function project(c: ConversationState) {
  return {
    session: c.session,
    turns: c.turns,
    live: c.live,
    // Running covers the dispatch-to-agent_start window too (Requirement:
    // Canvas Dialogue-Steering Dispatches Respect the Run Lock).
    agentRunning: c.live.streaming || c.dispatchPending,
    notice: c.notice,
    dispatchPending: c.dispatchPending,
    chatNotice: c.chatNotice,
    artifacts: c.artifacts,
    steps: c.steps,
    maturity: c.maturity,
    maturityState: c.maturityState,
    // Decision artefacts are per-conversation like the three above (Requirement:
    // Decision Artefacts Are Per-Conversation State). Projecting them here is what
    // makes a course switch swap the Decisions section instead of leaving the
    // previous course's entries on screen.
    didacticChecks: c.didacticChecks,
    invalidatedChecks: c.invalidatedChecks,
    offerReasoningRemediation: c.offerReasoningRemediation,
    cutOffNote: c.cutOffNote,
    stopTimedOut: c.stopTimedOut,
    // Per-conversation like the four above: a BACKGROUND conversation's
    // occupancy report must never render in the visible one (Requirement:
    // Context-Usage Ring in the Composer Control Row, § Scope).
    contextUsage: c.contextUsage,
    contextEverMeasured: c.contextEverMeasured,
    contextPending: c.contextPending,
    // Same reason as the four above: the Artifacts tab's attention marker belongs
    // to ONE conversation (Requirement: Panel Follows the Agent's Artefact Work).
    artifactsAttention: c.artifactsAttention,
  };
}

/** The mirror's key set, taken from `project`, with each value typed as the STORE
 * types it (`project` reads a slice, whose `session` is never null; the store's is).
 * Deriving the keys is what keeps the projection and its empty counterpart one list. */
type ConversationMirror = { [K in keyof ReturnType<typeof project>]: K extends keyof CbeState ? CbeState[K] : never };

/** The DESIGN half of the empty state: the four design states plus the annotation
 * layer, which anchors to the canvas being cleared here and is dropped by
 * `hydrateConversation` for the same reason. Kept as its own function because it is
 * the half capability `course-workspace`, Requirement: Course-Scoped Isolation of
 * Canvas, Step, Maturity and Decision State names one by one. Callers want
 * `emptyConversationMirror()` — the design half alone is never the right answer for
 * a course switch. */
function emptyDesignState(): Pick<
  CbeState,
  | "artifacts"
  | "steps"
  | "maturity"
  | "maturityState"
  | "didacticChecks"
  | "invalidatedChecks"
  | "annotations"
  | "artifactsAttention"
> {
  return {
    artifactsAttention: false,
    artifacts: seedArtifacts(),
    steps: seedSteps(),
    maturity: {},
    maturityState: emptyMaturityState(),
    didacticChecks: emptyDidacticChecks(),
    invalidatedChecks: [],
    annotations: [],
  };
}

/**
 * Everything a course presents while it has NO loaded conversation slice — between
 * the switch and the arrival of its `conversationOpen` result, and permanently when
 * that resolution fails (capability `course-workspace`, Requirement: Course-Scoped
 * Isolation of Canvas, Step, Maturity and Decision State).
 *
 * **The return type is derived from `project`, and that is the point.** This function
 * and `project` are one list, not two: whatever the mirror can be filled WITH, it must
 * be emptiable OF. The defect this replaces was exactly that drift — the empty state
 * covered the eight design keys while `project` wrote twenty, so a switch into a course
 * with no slice left `session`, `turns`, `live`, `agentRunning`, `notice`,
 * `dispatchPending`, `chatNotice`, `offerReasoningRemediation`, `cutOffNote`,
 * `stopTimedOut` and the three context-occupancy fields pointing at the course the
 * lecturer had just LEFT. Panels repainted to their empty state while live controls —
 * the maturity dispatch, the canvas step-focus, the header's help control — went on
 * addressing the outgoing course's session, invisibly. With the key set derived, a key
 * added to `project` has to be answered here — see the caveat below for which gate
 * actually catches it.
 *
 * A course switch clears ALL of it. A New Session within a course is a different
 * transition and does not come through here: it hands `hydrateConversation` the state
 * the main process carried over (capability `desktop-app`, Requirement: New Session
 * Control With Canvas Carry-Over).
 *
 * Caveat worth knowing: **no gate in this repo typechecks this file** — the app's
 * `build` runs `tsc` over `src/shared/i18n` only and ESLint carries no type-aware
 * rules — so the type link above is a correct statement that nothing enforces on its
 * own. The enforced half is `tests/course-switch-session-mirror.test.ts`, which
 * compares the two key sets at runtime under `npm test`.
 */
export function emptyConversationMirror(): ConversationMirror & Pick<CbeState, "annotations"> {
  return {
    session: null,
    turns: [],
    live: INITIAL_LIVE,
    agentRunning: false,
    notice: null,
    dispatchPending: false,
    chatNotice: null,
    offerReasoningRemediation: false,
    cutOffNote: null,
    stopTimedOut: false,
    contextUsage: null,
    contextEverMeasured: false,
    contextPending: false,
    ...emptyDesignState(),
  };
}

/** Per-course activity derived from the conversation slices (design D5 — derived,
 * not stored twice). Used by the left panel's course cards. */
/**
 * The aggregate of every BACKGROUND course's activity (capability `desktop-app`,
 * Requirement: Background Conversations and Per-Session Event Demultiplexing).
 *
 * A collapsed left panel must not hide the per-course markers: the header's
 * removed course-switcher dropdown used to keep them permanently visible, so the
 * collapsed rail's Courses icon carries this aggregate instead. Only background
 * courses count — the visible course's own run is already signalled by the
 * composer lock and the working indicator.
 */
export function backgroundCourseActivity(
  conversations: Record<string, ConversationState>,
  activeCourseId: string
): CourseActivity {
  let running = false;
  let unseen = false;
  for (const c of Object.values(conversations)) {
    if (c.session.courseId === activeCourseId) continue;
    if (c.live.streaming) running = true;
    if (c.unseenCompletion) unseen = true;
  }
  return { running, unseen };
}

export function courseActivityOf(conversations: Record<string, ConversationState>, courseId: string): CourseActivity {
  for (const c of Object.values(conversations)) {
    if (c.session.courseId === courseId) {
      return { running: c.live.streaming, unseen: c.unseenCompletion };
    }
  }
  return { running: false, unseen: false };
}

export const useCbe = create<CbeState>((set, get) => {
  /** Write one slice back into the map, mirroring it to the top level iff it is
   * the visible conversation. The single sync point between slices and mirror. */
  function commitConversation(
    s: CbeState,
    sessionId: string,
    next: ConversationState
  ): Partial<CbeState> & { conversations: Record<string, ConversationState> } {
    const conversations = { ...s.conversations, [sessionId]: next };
    const visible = next.session.courseId === s.activeCourseId;
    return { conversations, ...(visible ? project(next) : {}) };
  }

  /** Update the VISIBLE slice via `fn`, falling back to `legacy` when no slice
   * exists (pre-hydration state and unit tests that seed only the mirror). */
  function updateVisible(
    fn: (c: ConversationState) => ConversationState,
    legacy: (s: CbeState) => Partial<CbeState>
  ): void {
    set((s) => {
      const id = visibleIdOf(s.conversations, s.activeCourseId);
      if (!id) return legacy(s);
      return commitConversation(s, id, fn(s.conversations[id]!));
    });
  }

  return {
    conversations: {},
    session: null,
    turns: [],
    live: INITIAL_LIVE,
    configured: false,
    providerStatus: null,
    error: null,
    notice: null,
    dispatchPending: false,
    chatNotice: null,
    hydration: "idle",
    hydrationError: null,
    onboardingStatus: "unknown",
    onboardingIssue: null,
    onboardingAnnounced: false,
    modalSurfaceOpen: false,
    theme: "dark",
    flavour: "macchiato",
    accent: "blue",
    chatTextSize: "medium",
    panelTab: "artifacts",
    panelCollapsed: false,
    panelAutoCollapsed: false,
    leftPanelCollapsed: true,
    leftPanelAutoCollapsed: false,
    courseDetailId: null,
    courseDetailTab: "chats",
    wikiIngest: {},
    wikiAtomRevision: {},
    coursesFocusRequest: 0,
    coursesFocusHandled: 0,
    lastExpandedSide: null,
    overlaySection: null,
    settingsOpenGroup: "appearance",
    settingsDirtyGroup: null,
    panelRevealArmed: true,
    artifactsAttention: false,
    courses: [],
    activeCourseId: "",
    agentRunning: false,
    // Cold start is the EMPTY decision state (Requirement: Decision Artefacts Are
    // Per-Conversation State) — a demo fixture must never be a lecturer-facing value.
    didacticChecks: emptyDidacticChecks(),
    invalidatedChecks: [],
    annotations: [],
    artifacts: seedArtifacts(),
    steps: seedSteps(),
    maturity: {},
    maturityState: emptyMaturityState(),
    offerReasoningRemediation: false,
    cutOffNote: null,
    stopTimedOut: false,
    contextUsage: null,
    contextEverMeasured: false,
    contextPending: false,
    lecturerProfile: {},

    setSession: (session) => set({ session }),
    appendUserTurn: (text, attachments) =>
      updateVisible(
        (c) => ({
          ...c,
          turns: [...c.turns, { role: "user", text, ...(attachments && attachments.length ? { attachments } : {}) }],
        }),
        (s) => ({
          turns: [...s.turns, { role: "user", text, ...(attachments && attachments.length ? { attachments } : {}) }],
        })
      ),
    appendAssistantTurn: (activity) => {
      if (activity.length === 0) return;
      updateVisible(
        (c) => ({ ...c, turns: [...c.turns, { role: "assistant", activity }] }),
        (s) => ({ turns: [...s.turns, { role: "assistant", activity }] })
      );
    },
    setConfigured: (configured) => set({ configured }),
    setProviderStatus: (providerStatus) => set({ providerStatus }),
    setError: (error) => set({ error }),
    setNotice: (notice) =>
      updateVisible(
        (c) => ({ ...c, notice }),
        () => ({ notice })
      ),
    setDispatchPending: (dispatchPending) =>
      updateVisible(
        (c) => ({ ...c, dispatchPending }),
        () => ({ dispatchPending })
      ),
    setChatNotice: (chatNotice) =>
      updateVisible(
        (c) => ({ ...c, chatNotice }),
        () => ({ chatNotice })
      ),
    removeLastUserTurn: () =>
      updateVisible(
        (c) =>
          c.turns.length > 0 && c.turns[c.turns.length - 1]!.role === "user"
            ? { ...c, turns: c.turns.slice(0, -1) }
            : c,
        (s) =>
          s.turns.length > 0 && s.turns[s.turns.length - 1]!.role === "user" ? { turns: s.turns.slice(0, -1) } : {}
      ),
    setHydration: (hydration, error) => set({ hydration, hydrationError: error ?? null }),
    resolveOnboarding: (result) =>
      set((state) => {
        // Accepted dispatch / Begin / Skip may win while the main read is still
        // pending. That decision is monotonic for this renderer lifetime.
        if (state.onboardingStatus === "acknowledged") return {};
        return {
          onboardingStatus: result.acknowledged ? "acknowledged" : "pending",
          onboardingIssue: result.issue === "unreadable" ? "read-failed" : null,
        };
      }),
    acknowledgeOnboarding: (persisted) =>
      set((state) => ({
        onboardingStatus: "acknowledged",
        onboardingIssue: persisted === false ? "write-failed" : persisted === true ? null : state.onboardingIssue,
      })),
    settleOnboarding: () => {
      const acknowledge = get().acknowledgeOnboarding;
      acknowledge();
      void window.cbe.acknowledgeOnboarding().then(
        (result) => acknowledge(result.persisted),
        () => acknowledge(false)
      );
    },
    setOnboardingIssue: (onboardingIssue) => set({ onboardingIssue }),
    markOnboardingAnnounced: () => set({ onboardingAnnounced: true }),
    setModalSurfaceOpen: (modalSurfaceOpen) => set({ modalSurfaceOpen }),

    setTheme: (theme) => {
      localStorage.setItem("cbe-theme", theme);
      const { flavour, accent } = get();
      applyPalette(theme, flavour, accent);
      set({ theme });
    },
    setFlavour: (flavour) => {
      localStorage.setItem("cbe-flavour", flavour);
      const { theme, accent } = get();
      applyPalette(theme, flavour, accent);
      set({ flavour });
    },
    setAccent: (accent) => {
      localStorage.setItem("cbe-accent", accent);
      const { theme, flavour } = get();
      applyPalette(theme, flavour, accent);
      set({ accent });
    },
    setChatTextSize: (chatTextSize) => {
      localStorage.setItem("cbe-chat-text-size", chatTextSize);
      set({ chatTextSize });
    },
    setPanelTab: (panelTab) => set({ panelTab }),
    setPanelCollapsed: (panelCollapsed) =>
      set({
        panelCollapsed,
        panelAutoCollapsed: false,
        ...(panelCollapsed ? {} : { lastExpandedSide: "right" as PanelSide }),
      }),
    setLeftPanelCollapsed: (leftPanelCollapsed) =>
      set({
        leftPanelCollapsed,
        leftPanelAutoCollapsed: false,
        ...(leftPanelCollapsed ? {} : { lastExpandedSide: "left" as PanelSide }),
      }),
    toggleLeftPanelCollapsed: () =>
      set((s) => ({
        leftPanelCollapsed: !s.leftPanelCollapsed,
        leftPanelAutoCollapsed: false,
        ...(s.leftPanelCollapsed ? { lastExpandedSide: "left" as PanelSide } : {}),
      })),
    applyPanelArbitration: ({ left, right }) => {
      // The arbitration is recomputed on every render of the workspace, so the
      // overwhelmingly common call is a no-op. Bail out BEFORE `set` rather than
      // returning an empty patch: zustand still notifies every subscriber for an
      // empty patch, and a store that churns on every render is a trap for the
      // next selector someone writes without one.
      const s = get();
      if (
        left.collapsed === s.leftPanelCollapsed &&
        left.auto === s.leftPanelAutoCollapsed &&
        right.collapsed === s.panelCollapsed &&
        right.auto === s.panelAutoCollapsed
      ) {
        return;
      }
      set({
        leftPanelCollapsed: left.collapsed,
        leftPanelAutoCollapsed: left.auto,
        panelCollapsed: right.collapsed,
        panelAutoCollapsed: right.auto,
      });
    },
    clearExpandProtection: () => {
      if (get().lastExpandedSide !== null) set({ lastExpandedSide: null });
    },
    revealCourses: () =>
      set((s) => ({
        leftPanelCollapsed: false,
        leftPanelAutoCollapsed: false,
        lastExpandedSide: "left" as PanelSide,
        // Switching course is what the lecturer asked for, so the list level
        // outranks the preserved detail level (Requirement: Collapsible Left
        // Panel — the two named exceptions to level preservation).
        courseDetailId: null,
        coursesFocusRequest: s.coursesFocusRequest + 1,
      })),
    noteCoursesFocusHandled: (seq) => {
      if (get().coursesFocusHandled !== seq) set({ coursesFocusHandled: seq });
    },
    setCourseDetailId: (courseDetailId) =>
      set((s) => ({
        courseDetailId,
        // A different course's detail (or a fresh open from the list) starts on
        // the Chats default; the SAME course keeps its tab across the round trip.
        ...(courseDetailId !== s.courseDetailId ? { courseDetailTab: "chats" as const } : {}),
      })),
    setCourseDetailTab: (courseDetailTab) => set({ courseDetailTab }),

    // Wiki-ingestion run record (capability `lecturer-wiki`, Requirement: Ingest
    // Progress Outlives the Surface That Shows It). Three writers, all of them in
    // `state/wikiIngest.ts` — the panel only reads.
    startWikiIngestRun: (courseId, token) =>
      set((s) => ({
        wikiIngest: {
          ...s.wikiIngest,
          [courseId]: {
            running: true,
            docs: [],
            notice: null,
            runId: (s.wikiIngest[courseId]?.runId ?? 0) + 1,
            token,
          },
        },
      })),
    applyWikiIngestProgress: (evt) =>
      set((s) => {
        const run = s.wikiIngest[evt.courseId] ?? EMPTY_WIKI_INGEST_RUN;
        // Only the run that owns the event may carry it. A superseded run's late
        // rows are discarded rather than upserted into the record that followed
        // it — and with them the phantom entries the rail's activity summary
        // would otherwise count.
        if (evt.token !== run.token) return {};
        const at = run.docs.findIndex((d) => d.filename === evt.filename);
        // Upsert in place keeps ARRIVAL order — a document's later status update
        // must not jump its row to the end of the list.
        const docs = at === -1 ? [...run.docs, evt] : run.docs.map((d, i) => (i === at ? evt : d));
        return { wikiIngest: { ...s.wikiIngest, [evt.courseId]: { ...run, docs } } };
      }),
    finishWikiIngestRun: (courseId, notice, runId, atomsChanged = false) =>
      set((s) => {
        const run = s.wikiIngest[courseId] ?? EMPTY_WIKI_INGEST_RUN;
        // An outcome only ever ends its OWN run: the record has moved on to a
        // later run, so this one arrived after the lecturer had already started
        // the next ingest, and applying it would re-arm the start control behind
        // a live run (see `WikiIngestRun.runId`). The same guard covers atom-list
        // invalidation, so a stale completion cannot refresh a successor's data.
        if (runId !== undefined && runId !== run.runId) return {};
        return {
          wikiIngest: { ...s.wikiIngest, [courseId]: { ...run, running: false, notice } },
          ...(atomsChanged
            ? { wikiAtomRevision: { ...s.wikiAtomRevision, [courseId]: (s.wikiAtomRevision[courseId] ?? 0) + 1 } }
            : {}),
        };
      }),

    // The accordion's default is a TOTAL two-branch rule (Requirement: Settings
    // Panel (Phase 1 scaffold)): every showing of the settings surface opens on
    // Appearance — the second and the tenth exactly like the first — EXCEPT one
    // that follows a dismissal which left an unsaved edit, which opens on the
    // group holding it. There is no third branch and deliberately no "last-open
    // group" memory: preserving an edit while hiding it behind a closed header
    // reads as data loss even though nothing was lost.
    showSettingsSurface: (section) =>
      set((s) => ({
        overlaySection: section,
        settingsOpenGroup: section === "settings" ? (s.settingsDirtyGroup ?? "appearance") : s.settingsOpenGroup,
      })),
    showAboutSurface: () => set({ overlaySection: "settings", settingsOpenGroup: "about" }),
    closeSettingsSurface: () => set({ overlaySection: null }),
    setSettingsOpenGroup: (settingsOpenGroup) => set({ settingsOpenGroup }),
    setSettingsDirtyGroup: (settingsDirtyGroup) => {
      if (get().settingsDirtyGroup !== settingsDirtyGroup) set({ settingsDirtyGroup });
    },
    notePanelNavigation: () => set({ panelRevealArmed: false }),
    clearArtifactsAttention: () =>
      updateVisible(
        (c) => (c.artifactsAttention ? { ...c, artifactsAttention: false } : c),
        () => ({ artifactsAttention: false })
      ),
    togglePanelCollapsed: () =>
      set((s) => ({
        panelCollapsed: !s.panelCollapsed,
        panelAutoCollapsed: false,
        ...(s.panelCollapsed ? { lastExpandedSide: "right" as PanelSide } : {}),
      })),
    setCourses: ({ courses, activeCourseId }) =>
      set((s) => {
        // Becoming visible clears the course's unseen-completion marker and
        // re-projects its slice into the top-level mirror (the incoming visible
        // conversation may have accumulated state in the background).
        const id = visibleIdOf(s.conversations, activeCourseId);
        // No slice for the target course (its conversation has not been hydrated
        // yet, or the resolution failed): present the EMPTY mirror rather than the
        // outgoing course's — conversation identity included, so no control the app
        // still renders can act on the course the lecturer has left.
        if (!id) return { courses, activeCourseId, ...emptyConversationMirror() };
        const slice = s.conversations[id]!;
        const cleared = slice.unseenCompletion ? { ...slice, unseenCompletion: false } : slice;
        return {
          courses,
          activeCourseId,
          conversations: cleared === slice ? s.conversations : { ...s.conversations, [id]: cleared },
          ...project(cleared),
        };
      }),
    // The top-level design mirror is NOT touched here: every caller follows this
    // with `setCourses`, which re-projects the visible slice (or the empty design
    // state when the dropped slice was the visible one).
    dropConversationsOfRemovedCourses: (remainingCourseIds) =>
      set((s) => {
        const alive = new Set(remainingCourseIds);
        const conversations: Record<string, ConversationState> = {};
        for (const [id, c] of Object.entries(s.conversations)) {
          if (!alive.has(c.session.courseId)) continue;
          conversations[id] = c;
        }
        if (Object.keys(conversations).length === Object.keys(s.conversations).length) return {};
        return { conversations };
      }),
    // Persistence lives in the main process (workspace-state file) — the renderer
    // only mirrors the value; no localStorage involved.
    setActiveCourse: (activeCourseId) =>
      set((s) => {
        const id = visibleIdOf(s.conversations, activeCourseId);
        // See `setCourses`: an unhydrated target course presents the empty mirror,
        // never the outgoing course's.
        if (!id) return { activeCourseId, ...emptyConversationMirror() };
        const slice = s.conversations[id]!;
        const cleared = slice.unseenCompletion ? { ...slice, unseenCompletion: false } : slice;
        return {
          activeCourseId,
          conversations: cleared === slice ? s.conversations : { ...s.conversations, [id]: cleared },
          ...project(cleared),
        };
      }),

    ingestAgentEvent: (evt) =>
      set((s) => {
        const slice = s.conversations[evt.sessionId];
        // Unknown session id (straggler of an already-closed session): drop
        // without side effects — no slice is created, no state changes.
        if (!slice) return {};
        const visible = slice.session.courseId === s.activeCourseId;
        const next = reduceConversation(slice, evt, {
          visible,
          reasoningOn: s.providerStatus?.reasoning === true,
        });
        let committed = next;
        // Global side effects — visible conversation only where user-facing.
        // (Provider `error` events are NOT one of them anymore: they surface as
        // the slice's readable chat error state via the reducer — chat panel,
        // not the alarm banner. Requirement: Collected UX Polish.)
        const patch: Partial<CbeState> = {};
        if (evt.type === "tool_execution_end") {
          const canvas = parseCanvasDetails(evt.data.result, evt.data.isError);
          if (canvas && visible) {
            // Replacement/clear drops the artefact's stale annotations (the
            // annotation layer anchors to the visible canvas).
            const addr = resolveCanvasAddress({ step: canvas.step, phase: canvas.phase, id: canvas.id });
            if (addr && itemExistsAt(slice.artifacts, addr, canvas.id)) {
              patch.annotations = s.annotations.filter((a) => a.artifactId !== canvas.id);
            }
            // The panel follows the agent's artefact work (Requirement: Panel
            // Follows the Agent's Artefact Work). Every write for the visible
            // conversation spends the reveal — it fires at most once per app session.
            const canvasVisible = !s.panelCollapsed && s.panelTab === "artifacts";
            const r = panelResponseToArtefactWrite({ canvasVisible, revealArmed: s.panelRevealArmed });
            patch.panelRevealArmed = false;
            if (r.mark) committed = { ...next, artifactsAttention: true };
            if (r.reveal) {
              // The reveal is an expansion the APP performs, and the arbitration
              // treats it exactly like one the lecturer performs: it is never
              // refused, and the LEFT panel yields to make room for it in a
              // narrow window (Requirement: The Chat Column Survives Two
              // Flanking Panels).
              patch.panelCollapsed = false;
              patch.panelAutoCollapsed = false;
              patch.lastExpandedSide = "right";
              patch.panelTab = "artifacts";
            }
          } else if (canvas) {
            // A BACKGROUND conversation marks its OWN slice and never moves the
            // visible panel — the marker is projected only once that course is
            // visible, and the reveal is not spent by work the lecturer cannot see.
            committed = { ...next, artifactsAttention: true };
          }
        }
        return { ...commitConversation(s, evt.sessionId, committed), ...patch };
      }),
    finalizeRun: (sessionId) =>
      set((s) => {
        const slice = s.conversations[sessionId];
        if (slice) return commitConversation(s, sessionId, finalizeConversationRun(slice));
        // Legacy fallback (mirror-only state): flush the mirror's live items.
        if (s.session?.sessionId !== sessionId || s.live.items.length === 0) return {};
        return {
          turns: [...s.turns, { role: "assistant", activity: s.live.items }],
          live: liveReducer(s.live, { type: "reset" }),
        };
      }),
    resetLiveActivity: (sessionId) =>
      set((s) => {
        const slice = s.conversations[sessionId];
        if (slice) return commitConversation(s, sessionId, { ...slice, live: INITIAL_LIVE });
        if (s.session?.sessionId !== sessionId) return {};
        return { live: INITIAL_LIVE };
      }),
    noteStopTimedOut: (sessionId) =>
      set((s) => {
        const slice = s.conversations[sessionId];
        if (slice) return commitConversation(s, sessionId, { ...slice, stopTimedOut: true });
        if (s.session?.sessionId !== sessionId) return {};
        return { stopTimedOut: true };
      }),
    dismissReasoningRemediation: () =>
      updateVisible(
        (c) => ({ ...c, offerReasoningRemediation: false }),
        () => ({ offerReasoningRemediation: false })
      ),

    hydrateDidacticChecks: (checks) =>
      updateVisible(
        (c) => ({ ...c, didacticChecks: checks, invalidatedChecks: [] }),
        () => ({ didacticChecks: checks, invalidatedChecks: [] })
      ),
    hydrateConversation: (result) =>
      set((s) => {
        const sessionId = result.session.sessionId;
        const existing = s.conversations[sessionId];
        // One conversation per course: a fresh-conversation reset replaced the
        // course's session, so any OTHER slice of the same course is stale.
        const conversations: Record<string, ConversationState> = {};
        for (const [id, c] of Object.entries(s.conversations)) {
          if (id !== sessionId && c.session.courseId === result.session.courseId) continue;
          conversations[id] = c;
        }
        let slice: ConversationState;
        if (existing) {
          // In-app switch back to a session we still hold: the buffered live
          // stream and rich turns (tool cards, thinking blocks — including
          // turns completed in the background) win over the sidecar projection.
          // Main stays authoritative for session identity.
          slice = {
            ...existing,
            session: result.session,
            notice: result.notice ?? existing.notice,
            unseenCompletion: false, // the course is visible now
            // A re-attach carries the snapshot's occupancy too: the renderer may
            // have reloaded onto a session whose run is already in flight, and
            // the event that would have reported it fired before any subscriber.
            ...(result.contextUsage
              ? {
                  contextUsage: result.contextUsage,
                  contextEverMeasured: existing.contextEverMeasured || result.contextUsage.used !== null,
                }
              : {}),
          };
        } else {
          // Fresh slice from the main-process result (boot re-attach, resume,
          // fresh start). Canvas: seed the ten-step scaffold, then apply the
          // host-side mirror snapshot (entries arrive with their RESOLVED step
          // address — applied verbatim, no re-derivation).
          let artifacts = seedArtifacts();
          for (const entry of result.canvas) {
            const addr: ResolvedCanvasAddress =
              entry.phase !== undefined ? { step: entry.step, phase: entry.phase } : { step: entry.step };
            artifacts = mapContainerAt(artifacts, addr, (items) =>
              upsertItem(items, entry.id, {
                ...(entry.label !== undefined ? { label: entry.label } : {}),
                value: entry.value,
                state: entry.state,
              })
            );
          }
          // Reconstruct the transcript turn by turn. User turns render their
          // display projection (what the lecturer saw — instruction + chips),
          // falling back to the payload text for older sidecars; assistant turns
          // render their text interleaved with the design-record cards the
          // sidecar kept (`cbe_canvas`, `cbe_step`, `cbe_maturity` — every other
          // tool call and all thinking blocks are still unpersisted).
          const turns = result.turns.map((t): Turn => {
            if (t.role === "user") {
              return {
                role: "user",
                text: t.display?.text ?? t.text,
                ...(t.display?.attachments && t.display.attachments.length
                  ? { attachments: t.display.attachments }
                  : {}),
              };
            }
            // The stopped marker rides the persisted turn back onto the surface
            // (capability `desktop-app`, Requirement: *Composer Control Row* —
            // the marker "MUST survive a renderer reload and a session
            // re-entry"), so a stopped answer is never re-read later as a short
            // complete one. Absent on every turn of an older sidecar, which
            // reads as complete exactly as it did before.
            return {
              role: "assistant",
              // Rebuild the compatible internal chronology from text and stored
              // design calls. Normal chat subsequently projects out passive cards;
              // preserving them here keeps old sidecars readable without migration.
              activity: activityFromStoredTurn(t.text, t.cards, () => crypto.randomUUID()),
              ...(t.stopped === true ? { stopped: true } : {}),
            };
          });
          // `running` seeds the live state as an in-flight run — a reload during
          // a running turn re-arms the composer lock and the mid-turn guards
          // (Scenario: Reload during an in-flight turn re-arms the lock and guards).
          slice = newConversation(result.session, {
            turns,
            running: result.agentRunning,
            artifacts,
            // The session-start occupancy rides the snapshot rather than the
            // event channel (capability `agent-harness`, Requirement: Context
            // Occupancy Reported to the Host) — the subscription is wired after
            // the session exists, so an event emitted at start has no subscriber.
            ...(result.contextUsage ? { contextUsage: result.contextUsage } : {}),
            // Step coverage from the host-side step mirror, restored from THIS
            // course's record on a cold open (capability `agent-harness`,
            // Requirement: Course Design-State Store). Absent/empty ⇒ the
            // all-`open` seed — never the previously visible course's headers.
            ...(result.steps && result.steps.length > 0 ? { steps: stepsFromSnapshot(result.steps) } : {}),
            // Maturity raster from the host-side session maturity mirror — a
            // reload or app-restart resume repopulates the Maturity Panel
            // instead of stranding it in the empty state (Requirement:
            // Host-Side Session Maturity Mirror). Absent/empty = empty state.
            // `sanitizeMaturitySnapshot` drops a stray `overall.current` from an
            // older course record: the overall achieved level is host-derived
            // (capability `agent-harness`, Requirement: Host-Derived Overall
            // Maturity Level), so no hydration path may re-introduce a stored one.
            maturity: sanitizeMaturitySnapshot(result.maturity ?? {}),
            // Host-derived framing for that reading (capability `desktop-app`,
            // Requirement: Maturity Panel Substance and Staleness Framing).
            // Absent ⇒ the cautious cold-start default, which asserts neither
            // provisional nor stale — never the previous course's framing.
            ...(result.maturityState ? { maturityState: result.maturityState } : {}),
            // Decision artefacts from THIS course's canonical sidecar. Absent (or
            // rejected by the sidecar validator) ⇒ the empty state — never the
            // previously visible conversation's value (Requirement: Decision
            // Artefacts Are Per-Conversation State).
            ...(result.didacticChecks ? { didacticChecks: result.didacticChecks } : {}),
            notice: result.notice ?? null,
          });
        }
        conversations[sessionId] = slice;
        return {
          conversations,
          // `project` carries the slice's decision artefacts into the mirror, so a
          // course without recorded state clears the panel instead of inheriting
          // the outgoing course's entries.
          ...project(slice),
          error: null,
          annotations: [],
        };
      }),
    // Goal revision touches the VISIBLE conversation only — a background course's
    // decision artefacts are never rewritten by an action taken in another course
    // (Requirement: Decision Artefacts Are Per-Conversation State).
    reviseGoal: (check) =>
      updateVisible(
        (c) => ({
          ...c,
          didacticChecks: resetDownstreamOnGoalChange(c.didacticChecks, check),
          invalidatedChecks: downstreamChecks(check),
        }),
        (s) => ({
          didacticChecks: resetDownstreamOnGoalChange(s.didacticChecks, check),
          invalidatedChecks: downstreamChecks(check),
        })
      ),

    addAnnotation: (artifactId, excerpt, note) =>
      set((s) => ({
        annotations: [...s.annotations, { id: crypto.randomUUID(), artifactId, excerpt, note }],
      })),
    removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
    clearAnnotations: () => set({ annotations: [] }),
    resetAnnotationsForArtifact: (artifactId) =>
      set((s) => ({ annotations: s.annotations.filter((a) => a.artifactId !== artifactId) })),

    applyCanvasUpdate: (step, phase, id, patch) =>
      set((s) => {
        const addr = resolveCanvasAddress({ step, phase, id });
        if (!addr) return {}; // unresolvable address — ignore, never crash
        const visibleId = visibleIdOf(s.conversations, s.activeCourseId);
        const artifacts = visibleId ? s.conversations[visibleId]!.artifacts : s.artifacts;
        const existed = itemExistsAt(artifacts, addr, id);
        const nextArtifacts = applyCanvasSet(artifacts, step, phase, id, patch);
        // Replacement drops the artefact's stale annotations (iteration trail lives in chat history).
        const annotations = existed ? s.annotations.filter((a) => a.artifactId !== id) : s.annotations;
        if (!visibleId) return { artifacts: nextArtifacts, annotations };
        return {
          ...commitConversation(s, visibleId, { ...s.conversations[visibleId]!, artifacts: nextArtifacts }),
          annotations,
        };
      }),

    clearCanvasArtefact: (step, phase, id) =>
      set((s) => {
        const addr = resolveCanvasAddress({ step, phase, id });
        if (!addr) return {}; // unresolvable address — ignore
        const visibleId = visibleIdOf(s.conversations, s.activeCourseId);
        const artifacts = visibleId ? s.conversations[visibleId]!.artifacts : s.artifacts;
        if (!itemExistsAt(artifacts, addr, id)) return {}; // absent — clear is a no-op
        const nextArtifacts = applyCanvasClear(artifacts, step, phase, id);
        const annotations = s.annotations.filter((a) => a.artifactId !== id);
        if (!visibleId) return { artifacts: nextArtifacts, annotations };
        return {
          ...commitConversation(s, visibleId, { ...s.conversations[visibleId]!, artifacts: nextArtifacts }),
          annotations,
        };
      }),

    applyStepUpdate: (step, patch) =>
      updateVisible(
        (c) => ({ ...c, steps: applyStepPatch(c.steps, step, patch) }),
        (s) => ({ steps: applyStepPatch(s.steps, step, patch) })
      ),

    applyMaturityUpdate: (details) =>
      updateVisible(
        (c) => ({ ...c, maturity: applyMaturityUpdate(c.maturity, details) }),
        (s) => ({ maturity: applyMaturityUpdate(s.maturity, details) })
      ),

    setLecturerProfile: (lecturerProfile) => set({ lecturerProfile }),
    applyLecturerProfileUpdate: (dimension, record, lecturerConfirmed) =>
      set((s) => {
        // Override precedence mirrored in the UI: the lecturer's word stands until
        // they change it themselves or explicitly confirm the revision in the
        // conversation (the persisted record enforces the same rule).
        if (s.lecturerProfile[dimension]?.provenance === "override" && lecturerConfirmed !== true) return {};
        return { lecturerProfile: { ...s.lecturerProfile, [dimension]: record } };
      }),

    relabelSeededChrome: () =>
      set((s) => {
        // Only a label that is STILL a seeded one in some shipped language is
        // re-derived; a label the skill supplied through `cbe_canvas` is
        // lecturer-language content and is left exactly as it arrived.
        const conversations: Record<string, ConversationState> = {};
        for (const [id, c] of Object.entries(s.conversations)) {
          conversations[id] = { ...c, artifacts: relabelArtifacts(c.artifacts), steps: relabelSteps(c.steps) };
        }
        const visibleId = s.session?.sessionId ?? null;
        const visible = visibleId ? conversations[visibleId] : undefined;
        return {
          conversations,
          artifacts: visible ? visible.artifacts : relabelArtifacts(s.artifacts),
          steps: visible ? visible.steps : relabelSteps(s.steps),
        };
      }),

    reset: () =>
      set({
        conversations: {},
        error: null,
        // The same empty mirror a course switch projects — a fresh mount holds no
        // conversation for the same reason an unresolved course does.
        ...emptyConversationMirror(),
        // Both panels re-default (Requirements: Collapsible Right Panel;
        // Collapsible Left Panel): the canvas panel open, the course panel at
        // its rail.
        panelCollapsed: false,
        panelAutoCollapsed: false,
        leftPanelCollapsed: true,
        leftPanelAutoCollapsed: false,
        courseDetailId: null,
        courseDetailTab: "chats",
        // A fresh mount has no run to report: the main process broadcasts progress
        // and keeps no replay, so a record carried across a mount could never be
        // reconciled with what is actually running.
        wikiIngest: {},
        wikiAtomRevision: {},
        lastExpandedSide: null,
        panelRevealArmed: true,
        // The overlay is never open on a fresh mount and keeps no state across
        // one (Requirement: Profile-and-Settings Overlay).
        overlaySection: null,
        settingsOpenGroup: "appearance",
        settingsDirtyGroup: null,
        onboardingStatus: "unknown",
        onboardingIssue: null,
        onboardingAnnounced: false,
        modalSurfaceOpen: false,
      }),
  };
});
