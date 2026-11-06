import type { LecturerProfile, ProfileDimension } from "@cbe/pi-bridge/lecturer-profile";
import type { LecturerIdentity } from "@cbe/pi-bridge/lecturer-identity";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";
import type { CitationVerification } from "@cbe/pi-bridge/citation-verification";
import type { ContextUsageReport } from "./context-usage.js";
import type { PersistedToolCard } from "./design-cards.js";

/** Re-exported so renderer/preload code types the occupancy against the single
 * source in `shared/context-usage.ts` (type-only; erased at runtime). */
export type { ContextUsageReport };

export type EnvironmentProfile = "app" | "headless";

/** Re-exported so renderer/preload code can type the Profile Panel against the
 * single schema source in pi-bridge (type-only; erased at runtime). */
export type { LecturerProfile, ProfileDimension };

/** Payload of `cbe:lecturer-profile:override` — one per-dimension manual override
 * from the Profile Panel (capability `desktop-app`, Requirement: Profile Panel). */
export interface LecturerProfileOverridePayload {
  dimension: ProfileDimension;
  value: string;
}

/** Result of `cbe:lecturer-profile:override`. `ok: false` means the value was
 * rejected (off the dimension's scale) and the stored profile is unchanged. */
export interface LecturerProfileOverrideResult {
  ok: boolean;
  profile: LecturerProfile;
}

/** Re-exported so renderer/preload code types the identity fields against the single
 * schema source in pi-bridge (type-only; erased at runtime). NOT a lecturer-state
 * dimension — a separate record with its own guard (capability `agent-harness`,
 * Requirement: Per-Lecturer Identity Record). */
export type { LecturerIdentity };

/** Payload of `cbe:lecturer-identity:set` — the whole record as the lecturer left
 * the two inputs. A field arriving empty or whitespace-only is a CLEAR, not a
 * no-op, and the two fields are independent (capability `desktop-app`, Requirement:
 * Lecturer Identity in the User/Profile Area). */
export interface LecturerIdentitySetPayload {
  name?: string;
  formOfAddress?: string;
}

/** Result of `cbe:lecturer-identity:set`. `ok: false` with `reason: "too-long"`
 * means a value exceeded the documented maximum: nothing was stored and the
 * returned record is what is still on disk — no silently shortened value. */
export interface LecturerIdentitySetResult {
  ok: boolean;
  identity: LecturerIdentity;
  reason?: "too-long";
}

/**
 * Reasoning effort for a reasoning-configured model. Mirrors pi-bridge's
 * `ReasoningEffort`. Only meaningful when `reasoning` is enabled; when reasoning
 * is enabled but no effort is set, the harness defaults to "medium".
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Provider-configuration DTO sent from the renderer to the main process.
 *
 * `apiKey` has three semantic states (see `desktop-app` spec, Requirement:
 * Provider Configuration Input Hygiene):
 *
 * - non-empty `string` — set or overwrite the persisted cipher.
 * - omitted (field absent / `undefined`) — preserve the existing persisted
 *   cipher; used by `SettingsPanel` for partial updates where the lecturer
 *   only edits `baseURL` or `modelId`.
 * - empty `string` (`""`) — discipline violation; main-process `saveConfig`
 *   throws `EmptyApiKeyError`. Should never arrive from a correct renderer
 *   path (the dialogs validate against this), but the type permits it because
 *   structured-clone of `{ apiKey: "" }` is indistinguishable from any other
 *   string at the wire level — the runtime check is the guard.
 */
export interface ProviderConfigDto {
  baseURL: string;
  apiKey?: string;
  modelId: string;
  /**
   * Real context window (in tokens) of the configured model. MUST reflect the
   * model's true window — a value smaller than the real one makes pi misread
   * normal usage as a context overflow and compact prematurely. Omitted means
   * "keep the persisted value" (partial update); a fresh config that omits it
   * falls back to the provider's high default.
   */
  contextLength?: number;
  /**
   * Enable reasoning for the configured model. When `true`, the session is
   * started with `reasoning_effort` sent at `reasoningEffort` — the lever that
   * makes reasoning-hybrid models (Qwen3-A3B / gpt-oss class) emit tool calls.
   *
   * Omitted (field absent / `undefined`) means "keep the persisted value" on a
   * partial update — the same omit-to-preserve contract as `apiKey` /
   * `contextLength`. An explicit `true` / `false` is the lecturer's choice and
   * always wins over the metadata-derived default.
   */
  reasoning?: boolean;
  /**
   * Reasoning effort (`low` | `medium` | `high`); only meaningful when
   * `reasoning` is enabled. Omitted on a partial update preserves the persisted
   * value.
   */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Thrown by `saveConfig` when the DTO carries an explicitly empty `apiKey`
 * (`""` after sanitisation). The renderer dialogs render the caught error
 * string; type-narrowing on `name === "EmptyApiKeyError"` is the documented
 * way to react programmatically.
 */
export class EmptyApiKeyError extends Error {
  override name = "EmptyApiKeyError";
  constructor(
    message = "apiKey must be a non-empty string when provided; omit the field to preserve the existing key"
  ) {
    super(message);
  }
}

/**
 * Thrown by `saveConfig` when the DTO changes the sanitised `baseURL` relative to
 * the persisted record but omits the `apiKey`. A credential entered for one
 * endpoint MUST NEVER be silently re-targeted at another (including by the
 * `/models` capability probe, which runs at save time against the NEW baseURL) —
 * see `desktop-app` spec, Requirement: Provider Configuration Input Hygiene,
 * Scenario *Main process refuses a changed base URL without a key*. The renderer
 * dialogs block Save in this state; this is the second, main-process layer.
 */
export class EndpointChangedKeyRequiredError extends Error {
  override name = "EndpointChangedKeyRequiredError";
  constructor(message = "key required for the new endpoint; a credential is never carried across base URLs") {
    super(message);
  }
}

export interface ProviderStatus {
  baseURL: string;
  modelId: string;
  hasKey: boolean;
  /** Configured context window in tokens, if set (undefined → provider default). */
  contextLength?: number;
  /** Whether reasoning is enabled for the configured model (undefined → conservative default OFF). */
  reasoning?: boolean;
  /** Configured reasoning effort, if set (only meaningful when `reasoning` is enabled). */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Result of `cbe:config:set`. The config is always persisted on `ok: true`.
 * `activeSwap` is present ONLY when at least one chat session was running at save
 * time — it reports whether the live re-bind of that session to the new provider
 * succeeded (capability `desktop-app`, Requirement: Live Provider Swap into the
 * Running Session on Settings Save). Omitted when no session is active (the new
 * values are then picked up at the next session start). NEVER carries the apiKey.
 */
export interface ConfigSetResult {
  ok: true;
  activeSwap?: { ok: true; modelId: string } | { ok: false; error: string };
}

/** One course in the Space (capability `course-workspace`, Requirement: Course as a
 * Local Folder). Discovered by folder scan; `path` is the absolute course folder —
 * surfaced to the renderer for the open-in-file-manager affordance, never as the
 * primary UI surface (Requirement: Local Location Shown as an Open Affordance). */
export interface CourseSummary {
  id: string;
  title: string;
  path: string;
  createdAt?: string;
  /** Stored sessions in the course — card meta ("3 sessions · 12 atoms"). */
  sessionCount?: number;
  /** Wiki atoms in the course — card meta. */
  atomCount?: number;
}

/** Result of `cbe:course:list` — the scanned courses plus the active course id.
 * The main process guarantees the exactly-one-active-course invariant (creating a
 * default course in an empty Space, falling back when the persisted id is gone). */
export interface CourseListResult {
  courses: CourseSummary[];
  activeCourseId: string;
}

/** Target of the `cbe:course:reveal` open-in-file-manager affordance. */
export type CourseRevealTarget = "course" | "wiki";

/** Result of `cbe:course:delete` (capability `course-workspace`, Requirement:
 * Course Deletion from the Detail View, Reversible via the OS Trash). Carries
 * the refreshed list plus the RE-RESOLVED active course, so the renderer never
 * has to guess who is active after the deleted course was the active one.
 *
 * `trashed` distinguishes the two success shapes: `true` — the folder was moved
 * to the OS trash; `false` — it had already disappeared outside the app, so
 * there was nothing to move. A failure is an IPC rejection, never `trashed:
 * false`. */
export interface CourseDeleteResult extends CourseListResult {
  trashed: boolean;
}

/** One reconstructed conversation turn of a re-entered conversation. `text` is
 * the lossless model payload; `display`, when present, is what the lecturer saw
 * (capability `agent-harness`, Requirement: Sessions as Local Markdown/JSON
 * Files, display projection) — the renderer renders `display` and falls back to
 * `text` for older turns. */
export interface StoredTurn {
  role: "user" | "assistant";
  text: string;
  display?: { text: string; attachments?: DisplayAttachment[] };
  /** ASSISTANT turns only: the lecturer stopped the run that produced this turn
   * (capability `agent-harness`, Requirement: *A Lecturer Can Stop a Running
   * Turn*; carrier: Requirement: *Sessions as Local Markdown/JSON Files*).
   * Optional and additive on exactly the terms `display` establishes — absent
   * means the turn is complete, a malformed value is treated as absent, and an
   * older sidecar without it stays fully readable. Its whole job is that a
   * stopped answer is never re-read later as a short complete one. */
  stopped?: boolean;
  /** ASSISTANT turns only: compatible DESIGN-RECORD calls made by the run
   * (`cbe_canvas`, `cbe_step`, `cbe_maturity`). Re-entry keeps this data readable,
   * but normal chat no longer reconstructs passive technical cards from it
   * (carrier: capability `agent-harness`, Requirement: *Sessions as Local
   * Markdown/JSON Files*). Optional and additive on the same terms as `display`
   * and `stopped`; absent means the turn recorded no such call. The panels are
   * populated from the host-side snapshot, never from these records. */
  cards?: PersistedToolCard[];
}

/** One canvas artefact in the boot-hydration snapshot — mirrors pi-bridge's
 * `CanvasArtefactEntry` (host-side canvas artefact mirror). */
export interface CanvasArtefactSnapshot {
  /** Resolved step group (ten-step canvas); Step-6 journey artefacts also carry `phase`. */
  step: number;
  phase?: JourneyPhase;
  id: string;
  label?: string;
  value: string;
  state: "done" | "active" | "draft" | "open";
}

/** One recorded design-flow step in the boot-hydration snapshot — mirrors
 * pi-bridge's `StepCoverageEntry` (host-side step-coverage mirror). */
export interface StepCoverageSnapshot {
  /** Design-flow step, 1..10. */
  step: number;
  depth: "open" | "rough" | "refined" | "detailed";
  focus: boolean;
}

/**
 * Result of `cbe:conversation:open` (capability `desktop-app`, Requirement:
 * Renderer Boot-Hydration from the Main Process): the course's one conversation —
 * re-attached (already open in the main process), resumed from the canonical
 * sidecar pair, or freshly started. The renderer renders what main reports; it
 * never decides which session exists.
 */
export interface ConversationOpenResult {
  session: StartSessionResult;
  turns: StoredTurn[];
  /** Main's in-flight flag: true → a turn is running; the renderer MUST arm the
   * composer lock, working indicator, and mid-turn guards from this. */
  agentRunning: boolean;
  /** Host-side canvas mirror snapshot. Survives renderer reloads (the mirror lives
   * in main) AND app restarts: opening a course populates the mirror from that
   * course's own design-state record before this snapshot is served (capability
   * `agent-harness`, Requirement: Course Design-State Store). Empty = the course
   * has no recorded artefacts — never another course's. */
  canvas: CanvasArtefactSnapshot[];
  /** Host-side step-coverage mirror snapshot, restored from the same course record
   * as `canvas` (capability `agent-harness`, Requirement: Course Design-State
   * Store). Carries ONLY steps that moved off their default — a step absent from
   * the list is `open` and unfocused, which is what the renderer's seed already
   * shows. Absent/empty ⇒ the seeded all-`open` scaffold, never another course's
   * coverage. The course record is not the only source: on a fresh design or an
   * ordinary untouched resume this snapshot also carries the host's initial step-1
   * focus (capability `agent-harness`, Requirement: Host-Set Initial Step Focus,
   * whose routes and exclusions `AgentManager.start` decides), and it is that
   * focus's ONLY route to the renderer — a position, never recorded coverage, so
   * the surfaces that mean recorded work read `StepMirror.recordedList()`
   * instead. */
  steps?: StepCoverageSnapshot[];
  /** Host-side session maturity mirror snapshot (capability `agent-harness`,
   * Requirement: Host-Side Session Maturity Mirror): the conversation's recorded
   * maturity raster. Survives renderer reloads (mirror lives in main) AND app
   * restarts: opening a course populates the mirror from that course's own
   * design-state record before this snapshot is served (Requirement: Course
   * Design-State Store); for a course predating that record, the resume replay of
   * its own `cbe_maturity` calls fills the mirror once. Empty object = no reading
   * recorded for this course (empty state) — never another course's. */
  maturity: import("@cbe/pi-bridge/maturity").MaturitySnapshot;
  /** Host-derived substance / provenance / staleness state for the reading above
   * (capability `agent-harness`, Requirement: Host-Side Design-Substance and
   * Revision Signal). The Maturity Panel FRAMES the reading from this and never
   * recomputes any of it. Always present — an empty reading still reports the
   * session's substance, which is what the empty state's framing needs. Absent
   * only where a caller predates this field; the renderer then falls back to the
   * cautious cold-start default, which asserts neither provisional nor stale. */
  maturityState?: import("@cbe/pi-bridge/design-substance").MaturityDerivedState;
  /** The session-start context occupancy (capability `agent-harness`,
   * Requirement: Context Occupancy Reported to the Host). It rides THIS snapshot
   * rather than the event channel: `wireSessionEvents` runs after the session is
   * created, so anything emitted at start has no subscriber, and a renderer
   * reload re-attaching to a live session has the same gap. Absent only from a
   * caller predating this field; the renderer then shows the unmeasured state. */
  contextUsage?: ContextUsageReport;
  /** User-visible notice (unreadable canonical archive). */
  notice?: string;
  /** This course's decision artefacts, read off the LIVE session (re-attach) or
   * seeded from its own canonical sidecar (resume). Absent = the conversation has
   * no recorded decision state; the renderer then shows the empty state and never
   * the previously visible course's value. */
  didacticChecks?: import("@cbe/pi-bridge/didactic-checks").DidacticChecks;
}

/**
 * The start of a wiki ingestion, as the renderer dispatches it over
 * `cbe:wiki:ingest` (capability `lecturer-wiki`, Requirement: An Ingest Belongs
 * to the Course It Was Started In).
 *
 * Two identities, and they answer different questions. `token` names the RUN —
 * minted by the renderer before the call it stamps, and carried back on every
 * progress event of that run (see `WikiIngestProgressEvent.token`).
 *
 * `courseId` is the caller's ASSERTION about which course it recorded the run
 * under. It is NOT the write target: the host resolves the active course itself
 * and refuses the start when the two differ, because a surface may not decide
 * where material is written. It closes the one window UI placement cannot — the
 * lecturer switching course between the click and the host's resolution — which
 * would otherwise file the record under one course and its material under
 * another.
 */
export interface WikiIngestStartPayload {
  token: string;
  courseId: string;
}

/** Per-document progress of a running wiki ingestion (capability
 * `lecturer-wiki`, Requirement: Ingestion Runs in Isolated Subagent Sessions),
 * streamed to the renderer over `cbe:wiki:ingest-progress`. `filename` is the
 * lecturer-visible original name; `rawRelPath` identifies the raw-layer file. */
export interface WikiIngestProgressEvent {
  courseId: string;
  /**
   * Which RUN emitted this event — the token the renderer generated for the
   * `ingestToWiki()` call and the main process stamps on every event of that
   * run (capability `lecturer-wiki`, Requirement: An Ingest That Cannot Reach
   * the Model Fails Visibly and Stays Retryable).
   *
   * The course id alone cannot identify a run: a lecturer who ends a stuck run
   * and starts a second ingest of the same course has two runs alive, and the
   * first one's late `aborted` / `failed` events would otherwise be upserted
   * into the second one's rows by filename. The token is what lets the record
   * discard them.
   */
  token: string;
  filename: string;
  rawRelPath: string;
  status: "extracting" | "running" | "done" | "failed" | "aborted";
  error?: string;
}

/** Per-file outcome of a completed wiki ingestion batch. */
export type WikiIngestResult =
  | { ok: true; filename: string; rawRelPath: string; atoms: string[] }
  | { ok: false; filename: string; rawRelPath?: string; status: "failed" | "aborted" | "unsupported"; error: string };

/** One wiki atom as listed by the browse/search surface (capability
 * `lecturer-wiki`, Requirement: Wiki Is Browsable and Searchable in the App).
 * The body rides along so search can match content without a second IPC. */
export interface WikiAtomSummary {
  /** Wiki-relative path, e.g. `concept/cognitive-load.md`. */
  relPath: string;
  title: string;
  type: string;
  aliases: string[];
  related: string[];
  confidence: string;
  updated: string;
  body: string;
}

export interface WikiListResult {
  atoms: WikiAtomSummary[];
  /** Files under wiki/ that failed atom validation (surfaced, not hidden). */
  invalid: Array<{ relPath: string; errors: string[] }>;
}

/** On-disk paths the model is allowed to navigate, forwarded to the renderer so
 * the UI can pretty-print tool-call arguments as `corpus/…` or `workspace/…`
 * instead of leaking the absolute filesystem layout to the lecturer. */
export interface SessionPaths {
  workspace: string;
  corpus: string;
  wiki?: string;
}

export interface StartSessionResult {
  sessionId: string;
  environmentProfile: EnvironmentProfile;
  affordances: Record<string, boolean>;
  paths: SessionPaths;
  /** The course this session belongs to — new sessions always land in the active
   * course's folder (capability `course-workspace`, Requirement: Active Course and
   * Course Switching). */
  courseId: string;
}

export interface PromptPayload {
  sessionId: string;
  /** Full model payload (instruction + ingest envelopes). Lossless; persisted as
   * the turn's `text`. */
  text: string;
  /** What the lecturer saw for this turn (instruction + attachment chips).
   * Persisted as the turn's optional `display` projection so re-entry renders
   * the conversation as experienced, never the raw envelopes. Omitted when the
   * displayed form equals the payload. */
  display?: { text: string; attachments?: DisplayAttachment[] };
}

/**
 * Payload for `Channels.promptAbort` (capability `agent-harness`, Requirement:
 * *A Lecturer Can Stop a Running Turn*). The session id is the contract: the
 * stop acts on the conversation it names and on no other, so a run in a
 * background conversation is untouched by the visible one's control.
 */
export interface PromptAbortPayload {
  sessionId: string;
}

/**
 * Payload for `Channels.conversationFresh`. Ordinarily empty — a fresh
 * conversation mid-turn is refused, because it would abort the run and lose its
 * output.
 *
 * `force` is the ONE documented way past that refusal, and it exists for exactly
 * one caller: the recovery on a stop that timed out (capability `desktop-app`,
 * Requirement: *Composer Control Row* — "a stop that does not complete surfaces
 * readably and offers a way out"). There the composer is locked over a run the
 * runtime will not release and New Session is itself disabled while a run is in
 * flight, so without a force-close the lecturer's only exit is quitting the app.
 * Absent / false keeps the refusal exactly as it is.
 */
export interface ConversationFreshPayload {
  force?: boolean;
}

/**
 * One stored conversation of a course, as listed by the detail view's Chats tab
 * (capability `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki;
 * model semantics in capability `course-workspace`, Requirements: One Canonical
 * Conversation per Course / Stored Conversations Are Resumable). Rows come from
 * the main-process sidecar scan — the renderer never touches the filesystem.
 */
export interface ConversationListEntry {
  sessionId: string;
  createdAt: string;
  closedAt: string;
  /** False when the pair's JSON sidecar is missing or unreadable; `reason` then
   * carries the one-line explanation the row shows. */
  resumable: boolean;
  reason?: string;
  /** Completed turns in the stored pair. Absent when the sidecar is unreadable. */
  turnCount?: number;
  /** One line of the first user turn's displayed form — the human handle on a
   * row of UUID-named files. Absent when unreadable or when no user turn exists. */
  snippet?: string;
}

/** Payload for `Channels.conversationList`. */
export interface ConversationListPayload {
  courseId: string;
}

/** Result of `cbe:conversation:list`: the course's stored conversations, newest
 * first (ordered main-side), plus the id of the course's currently OPEN session
 * where one exists — the renderer marks the open row from this, never by
 * guessing. */
export interface ConversationListResult {
  conversations: ConversationListEntry[];
  openSessionId?: string;
}

/** Payload for `Channels.conversationResume` (capability `course-workspace`,
 * Requirement: Stored Conversations Are Resumable): make the named stored
 * conversation THE course's open conversation. Resolves to the same
 * `ConversationOpenResult` every conversation open yields. */
export interface ConversationResumePayload {
  courseId: string;
  sessionId: string;
}

/**
 * Outcome of a lecturer stop, as reported across the process boundary.
 *
 * Every value is a CLASSIFICATION the renderer renders in its own copy. None of
 * them carries a message derived from an underlying rejection: provider error
 * text routinely embeds the request URL, and the provider host may not reach a
 * workspace surface (Requirement: *App Header Strip*). The raw detail goes to
 * the session log (Requirement: *Documented Error Behaviour*).
 *
 * - `stopped` — the stop took effect and the run's end was observed.
 * - `superseded` — the loop breaker had already claimed this run's end. Its
 *   neutral recovery note stands; no stopped marker, no second abort.
 * - `not-running` — nothing was in flight for this session, or the host does not
 *   hold that session id. A silent no-op: nothing failed.
 * - `refused` — the compaction companion sequence is running. The sequence was
 *   not aborted and no run end was fabricated.
 * - `timed-out` — the runtime never reached idle inside the bound. The run is
 *   NOT reported as ended, so the composer stays locked.
 * - `error` — the abort itself failed. Classification only.
 */
export type PromptAbortResult =
  | { status: "stopped" }
  | { status: "superseded" }
  | { status: "not-running" }
  | { status: "refused"; reason: "compaction" }
  | { status: "timed-out" }
  | { status: "error" };

/** The store prefix that qualifies a citation id as a wiki atom. The renderer's whole
 * click path carries the SAME store-qualified id vocabulary `cbe_cite`'s `id` parameter
 * uses — `wiki:<atomId>` for an atom, the bare id for a corpus document — so this one
 * constant is what tells `CitationLink` (skip verification) and `loadCitation` (resolve
 * against the active course's wiki) which store an id names (capability `desktop-app`,
 * Requirement: *A Wiki Citation Token Renders as the Same Citation Link and Opens the
 * Shared Overlay Unverified*). */
export const WIKI_CITATION_PREFIX = "wiki:";

/** The two payloads share `hit` essentials and `body`; the union is discriminated on
 * `store` so the overlay omits the corpus-only chrome for an atom BY TYPE — the wiki
 * payload simply has no `corpus-version` and no `tags` to render, rather than carrying
 * placeholder values. */
export type CitationDetail = CorpusCitationDetail | WikiCitationDetail;

export interface CorpusCitationDetail {
  store: "corpus";
  hit: {
    id: string;
    title: string;
    path: string;
    tags: string[];
  };
  /** The loaded corpus version (`YYYY-MM`) — the corpus is purely versioned content. */
  "corpus-version": string;
  /** The document's MARKDOWN BODY — not the raw file. The main process removes the YAML
   * frontmatter (the head above already presents its contents in rendered form) and a
   * leading level-1 heading that merely repeats `hit.title`, then the renderer renders
   * what is left through the app's single shared Markdown component. See
   * `main/citation-body.ts` and capability `desktop-app`, Requirement: *The Citation
   * Detail Renders the Cited Source as Markdown*. */
  body: string;
}

export interface WikiCitationDetail {
  store: "wiki";
  hit: {
    /** The wiki-relative atom id as the index writes it (`concept/cognitive-load`). */
    id: string;
    title: string;
    /** The atom's wiki-relative file (`<id>.md`) — the wiki has no version stamp. */
    path: string;
  };
  /** Frontmatter-stripped Markdown body, prepared exactly as the corpus body is. */
  body: string;
}

/** Re-exported so renderer/preload code can type the citation surface against the
 * single verifier in pi-bridge (type-only; erased at runtime). The renderer never
 * imports the verifier's implementation — verification is a main-process obligation
 * (capability `desktop-app`, Requirement: *A Citation Token Is Verified Against the
 * Corpus Before It Is Linked*). */
export type { CitationVerification };

/** Payload of `cbe:verify-citation` — the two elements of an emitted `(corpus:…)`
 * token that the host can check against the corpus. `section` is `null` when the
 * token carries no `§` element at all, which is itself a verification outcome. */
export interface CitationVerifyRequest {
  id: string;
  section: string | null;
}

// Event types mirror pi-agent-core's AgentEvent (turn/message/tool/thinking) plus
// pi-coding-agent's AgentSessionEvent extensions (compaction, auto_retry). Each variant
// carries only the renderer-relevant fields; sessionId is added by the main bridge.
export type AgentEvent =
  // Text streaming (assistant final message body).
  | { type: "text_delta"; sessionId: string; data: { delta: string } }
  | { type: "error"; sessionId: string; data: { message: string } }
  // Run lifecycle — wraps the whole agent loop, including tool execution between
  // sub-turns. Use these (not turn_start/turn_end) to drive composer locks and
  // top-level streaming indicators.
  | { type: "agent_start"; sessionId: string; data: Record<string, unknown> }
  // `agent_end` is the host's SETTLED end: emitted once per run, after Pi has
  // finished every retry, recovery and continuation (capability `agent-harness`,
  // Requirement: *Run Completion Uses Pi Settled State*).
  | { type: "agent_end"; sessionId: string; data: Record<string, unknown> }
  // Sub-turn lifecycle — finer-grained boundary inside a single agent run.
  // Informational only; do NOT reset live tool/thinking accumulators here.
  | { type: "turn_start"; sessionId: string; data: Record<string, unknown> }
  | { type: "turn_end"; sessionId: string; data: Record<string, unknown> }
  // Per-message lifecycle (assistant message inside a turn).
  | { type: "message_start"; sessionId: string; data: Record<string, unknown> }
  | { type: "message_end"; sessionId: string; data: Record<string, unknown> }
  // Tool execution stream.
  | {
      type: "tool_execution_start";
      sessionId: string;
      data: { toolCallId: string; toolName: string; args: unknown };
    }
  | {
      type: "tool_execution_update";
      sessionId: string;
      data: { toolCallId: string; toolName: string; args: unknown; partialResult: unknown };
    }
  | {
      type: "tool_execution_end";
      sessionId: string;
      data: { toolCallId: string; toolName: string; result: unknown; isError: boolean };
    }
  // Reasoning stream — pi-ai's proxy emits these inside `message_update`.
  | { type: "thinking_start"; sessionId: string; data: { contentIndex: number } }
  | { type: "thinking_delta"; sessionId: string; data: { contentIndex: number; delta: string } }
  | { type: "thinking_end"; sessionId: string; data: { contentIndex: number; content: string } }
  // Context compaction (manual / threshold / overflow).
  | {
      type: "compaction_start";
      sessionId: string;
      data: { reason: "manual" | "threshold" | "overflow" };
    }
  | {
      type: "compaction_end";
      sessionId: string;
      data: {
        reason: "manual" | "threshold" | "overflow";
        aborted: boolean;
        willRetry: boolean;
        errorMessage?: string;
      };
    }
  // Auto-retry on retryable provider errors.
  | {
      type: "auto_retry_start";
      sessionId: string;
      data: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string };
    }
  | {
      type: "auto_retry_end";
      sessionId: string;
      data: { success: boolean; attempt: number; finalError?: string };
    }
  // Truncated-completion surface verdict (capability `desktop-app`, Requirement:
  // Response-Cut-Off State with One-Click Continue and Retry): the harness could
  // not (or may no longer) auto-continue a truncated generation — the renderer
  // must show the "response was cut off" state with continue/retry. `note` is
  // the harness's cut-off note (English chrome copy).
  | { type: "truncation_cutoff"; sessionId: string; data: { note: string } }
  // Compaction-companion phase signal (capability `desktop-app`, Requirement:
  // Compaction Visibility in the Renderer). Mirrors pi-bridge's `CompanionPhase`:
  // the bridge's `onPhase` callback is forwarded by main so the renderer can
  // span ONE continuous working state over the whole companion sequence —
  // consolidation, then Pi's compaction, including the gap a steered cycle
  // produces between `compaction_end(aborted)` and the re-triggered
  // `compaction_start`. "idle" ends the sequence; "error" ends it into a
  // readable error state (never a permanently stuck status).
  | { type: "compaction_phase"; sessionId: string; data: { phase: CompanionPhase } }
  // Host-derived maturity substance / provenance / staleness (capability
  // `agent-harness`, Requirement: Host-Side Session Maturity Mirror — "the same
  // derived state MUST accompany live mirror updates"). Emitted whenever a
  // settled design change or a `cbe_maturity` call moves the state, so a panel
  // that is ALREADY open sees a reading go stale without a reload.
  | { type: "maturity_state"; sessionId: string; data: MaturityDerivedStateDto }
  // Context occupancy of THIS session (capability `agent-harness`, Requirement:
  // Context Occupancy Reported to the Host). A separate event, never a widening
  // of `message_end`'s empty payload. `used: null` means UNKNOWN — never zero —
  // and `window` is absent wherever the lecturer configured no `contextLength`,
  // because the provider's high default for an unset value is a safety
  // assumption about an unknown model rather than a measurement of it.
  | { type: "context_usage"; sessionId: string; data: ContextUsageReport }
  // The lecturer's stop TAKING EFFECT (capability `agent-harness`, Requirement:
  // *A Lecturer Can Stop a Running Turn*). Emitted the moment the stop is
  // effected — deliberately BEFORE the run's end event, because the renderer
  // finalises its assistant turn on `agent_end` and would otherwise have already
  // committed the turn by the time the stop's own IPC call resolves. A
  // loop-breaker abort emits nothing here: it keeps its own neutral recovery
  // note and is never presented as something the lecturer stopped.
  | { type: "turn_stopped"; sessionId: string; data: Record<string, never> };

/** Wire shape of the host-derived maturity framing state. Structurally identical
 * to pi-bridge's `MaturityDerivedState`; aliased here so renderer/preload code
 * types against the shared contract module. */
export type MaturityDerivedStateDto = import("@cbe/pi-bridge/design-substance").MaturityDerivedState;

/**
 * Phase of the compaction companion sequence (capability `desktop-app`,
 * Requirement: Compaction Visibility in the Renderer). Structurally identical
 * to pi-bridge's `CompanionPhase`; duplicated here as a literal union so the
 * renderer/preload contract stays importable without the bridge runtime.
 */
export type CompanionPhase = "consolidating" | "compacting" | "idle" | "error";

/** Supported ingested-document formats. Single shared union (importable across the
 * preload boundary by both main and renderer); the extension→docType derivation lives
 * once in `main/ingestion.ts` and the renderer never re-parses the filename. */
export type DocType = "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "md" | "csv";

/** Display-only metadata for an ingested document, rendered as a chip in the transcript
 * (capability `desktop-app`, Requirement: Ingested Document Display Is Separated From Its
 * Model Payload). Deliberately has NO body field — the payload/display separation is
 * enforced by the type, so the extracted text can never ride along into the displayed or
 * persisted turn. */
export interface DisplayAttachment {
  filename: string;
  docType: DocType;
}

/** Per-file outcome of a material-ingestion request (capability `desktop-app`,
 * Requirement: Material Ingestion Stub into the Chat Context). The dialog allows
 * multiselect, so one request yields one outcome per selected file, in selection
 * order; `null` is returned to the renderer when the lecturer cancels the dialog.
 * The failure branch carries the filename so a notice can name the culprit
 * within a mixed batch. */
export type IngestOutcome =
  | { ok: true; text: string; filename: string; docType: DocType }
  | { ok: false; unsupported: true; filename: string; message: string };

/** Slash command surfaced to the renderer's `/` autocomplete (capability
 * `desktop-app`, Requirement: Slash Commands via Pi-First Architecture). Mapped
 * from pi's `SlashCommandInfo` at the bridge boundary. */
export interface SlashCommand {
  name: string;
  description?: string;
  /** "extension" (app-registered /cite), a pi built-in source, or "skill". */
  source: string;
}

/** Result of `cbe:interface-language:set`. `ok: false` means the code names no
 * shipped catalogue and NOTHING was stored — the persisted choice is never
 * rewritten by a resolution. `language` is what is in force after the call. */
export interface InterfaceLanguageSetResult {
  ok: boolean;
  language: string;
}

/** Main-owned first-use marker read. Missing and malformed records resolve to
 * `acknowledged: false`; only an actual filesystem read failure carries the
 * soft, catalogue-rendered issue. */
export interface OnboardingReadResult {
  acknowledged: boolean;
  issue?: "unreadable";
}

/** Result of an idempotent first-use acknowledgment. `persisted: false` means
 * the in-memory marker is active for this main-process lifetime but the card may
 * return after restart; it is never reported as saved. */
export interface OnboardingAcknowledgeResult {
  acknowledged: true;
  persisted: boolean;
}

/** Main-to-renderer state emitted at the accepted-dispatch boundary and after
 * its persistence attempt settles. It dismisses every renderer prompt path
 * without modifying that path's payload or rollback semantics. */
export interface OnboardingStateEvent {
  acknowledged: true;
  persistence: "saving" | "saved" | "failed";
}

/** Closed native-menu command vocabulary. Main can request only the three
 * renderer actions that already have one owner; no product state crosses here. */
export type NativeMenuCommand = "open-settings" | "open-about" | "request-help";

export type NativeMenuUnavailableReason = "not-ready" | "busy" | "modal";
export interface NativeMenuItemAvailability {
  enabled: boolean;
  reason: NativeMenuUnavailableReason | null;
}

/** Renderer projection of the existing controls' gates. It carries no URL and
 * no app state beyond what the three custom native items need to be disabled. */
export interface NativeMenuAvailability {
  settings: NativeMenuItemAvailability;
  about: NativeMenuItemAvailability;
  help: NativeMenuItemAvailability;
}

/** The fixed PIONEER host capability returns a value rather than throwing across
 * preload. `refused` is reserved for an unexpected IPC argument; the typed
 * renderer bridge cannot produce it. */
export type PioneerSiteOpenResult = { ok: true } | { ok: false; reason: "refused" | "open-failed" };

export const Channels = {
  prompt: "cbe:prompt",
  // The lecturer's stop on a running turn (capability `agent-harness`,
  // Requirement: *A Lecturer Can Stop a Running Turn*). A channel of its OWN:
  // never the prompt channel — a stop dispatches no prompt and creates no user
  // turn — and never `wikiIngestAbort` widened to a second meaning, which would
  // make one control able to silently stop the other's work. It NAMES the
  // session it targets, like every other conversation-scoped channel.
  promptAbort: "cbe:prompt:abort",
  loadCitation: "cbe:load-citation",
  verifyCitation: "cbe:verify-citation",
  closeSession: "cbe:close-session",
  getCommands: "cbe:get-commands",
  ingestFile: "cbe:ingest-file",
  agentEvents: "cbe:agent-event",
  configGet: "cbe:config:get",
  configSet: "cbe:config:set",
  lecturerProfileGet: "cbe:lecturer-profile:get",
  lecturerProfileOverride: "cbe:lecturer-profile:override",
  // Per-lecturer identity record — a SEPARATE record from the profile above, with
  // its own file and its own guard (capability `agent-harness`, Requirement:
  // Per-Lecturer Identity Record). Nothing here writes a lecturer-state dimension.
  lecturerIdentityGet: "cbe:lecturer-identity:get",
  lecturerIdentitySet: "cbe:lecturer-identity:set",
  courseList: "cbe:course:list",
  courseCreate: "cbe:course:create",
  courseRename: "cbe:course:rename",
  courseSetActive: "cbe:course:set-active",
  courseReveal: "cbe:course:reveal",
  courseDelete: "cbe:course:delete",
  // One-conversation-per-course (capability `course-workspace` / `desktop-app`,
  // Requirements: One Canonical Conversation per Course, Renderer Boot-Hydration
  // from the Main Process): the ONLY ways sessions come into renderer view.
  conversationOpen: "cbe:conversation:open",
  conversationFresh: "cbe:conversation:fresh",
  // Stored conversations of a course (capability `course-workspace`, Requirement:
  // Stored Conversations Are Resumable; capability `desktop-app`, Requirement:
  // Course Detail Tabs: Chats and Wiki): list the sidecar pairs, resume one as
  // THE course's open conversation.
  conversationList: "cbe:conversation:list",
  conversationResume: "cbe:conversation:resume",
  exportDesignDocument: "cbe:export:design-document",
  wikiIngest: "cbe:wiki:ingest",
  // Ends ONE run, named by its token (capability `lecturer-wiki`, Requirement:
  // An Ingest Belongs to the Course It Was Started In). Runs in different
  // courses can be in flight together, so a course-wide or process-wide abort
  // would let one course's control end another course's work.
  wikiIngestAbort: "cbe:wiki:ingest-abort",
  wikiIngestProgress: "cbe:wiki:ingest-progress",
  wikiList: "cbe:wiki:list",
  // UI-initiated canvas artefact deletion (capability `desktop-app`, Requirement:
  // Canvas Artefact Delete Control; stakeholder directive 2026-07-07, D2): the
  // renderer's per-artefact delete control routes a confirmed deletion into the
  // host-side deletion pipeline (mirror removal + pending deletion notice).
  canvasDelete: "cbe:canvas:delete",
  // UI-initiated step focus (capability `agent-harness`, Requirement: Host-Set Step
  // Focus from the Canvas UI): the canvas step-select affordance routes the lecturer's
  // selection into the host-side focus pipeline (mirror focus + pending focus notice).
  // Deliberately NOT the prompt channel — the selection dispatches no prompt and
  // creates no user turn.
  stepFocus: "cbe:step:focus",
  // Credential erasure + connection verification (capability `desktop-app`,
  // Requirements: Credential Erasure with Confirmation / Credential Presence
  // Indicator and Connection Verifiability).
  configErase: "cbe:config:erase",
  /** Interface language (capability `desktop-app`, Requirement: *Every String
   * the App Renders Is English* — "The setting"). Three channels because the
   * value is read three ways: SYNCHRONOUSLY by the preload before the first
   * paint (an async read would paint one frame in the wrong language), by the
   * Settings control on change, and back to every renderer as a broadcast. */
  interfaceLanguageGetSync: "cbe:interface-language:get-sync",
  interfaceLanguageSet: "cbe:interface-language:set",
  interfaceLanguageChanged: "cbe:interface-language:changed",
  // Once-per-local-app-data-profile first-use marker. The explicit read and
  // acknowledge pair is complemented by a main-to-renderer event so every
  // accepted prompt path dismisses the same card without a second dispatcher.
  onboardingRead: "cbe:onboarding:read",
  onboardingAcknowledge: "cbe:onboarding:acknowledge",
  onboardingChanged: "cbe:onboarding:changed",
  // One narrow main↔renderer boundary for the native menu. Commands are a closed
  // union; availability is the matching renderer-owned action gate.
  nativeMenuCommand: "cbe:native-menu:command",
  nativeMenuAvailability: "cbe:native-menu:availability",
  // Parameterless renderer capability. Main owns the one exact destination.
  pioneerSiteOpen: "cbe:pioneer-site:open",
  configTest: "cbe:config:test",
  // Corpus bundle channel (capability `distribution`, Requirement: Corpus
  // Distribution as Downloadable Bundle): version/cache-date surface plus the
  // user-triggered "refresh corpus" cycle (pointer → verify → unpack).
  corpusInfo: "cbe:corpus:info",
  corpusRefresh: "cbe:corpus:refresh",
  // Read-only "what is installed" surface behind the settings About group
  // (capability `desktop-app`, Requirement: Settings Panel (Phase 1 scaffold)):
  // the running app version and the loaded skill's own name and version. Read
  // from their real sources on every call — no literals in the renderer.
  aboutInfo: "cbe:about:info",
  // App auto-update (capability `distribution`, Requirement: Auto-update
  // mechanism): main → renderer update lifecycle events, renderer → main
  // user decisions (install now / later / skip).
  updateEvent: "cbe:update:event",
  updateAction: "cbe:update:action",
} as const;

/**
 * Result of `cbe:config:erase` (capability `desktop-app`, Requirement: Credential
 * Erasure with Confirmation). The erase path REMOVES the persisted `apiKeyCipher`
 * / `apiKeyPlain` field from the config record — it never writes an empty-string
 * cipher, which the input-hygiene contract treats as a corrupt configured-state.
 * `baseURL` / `modelId` stay persisted; the configured-state check reports no key
 * present until one is re-entered. `hadKey` reports whether a credential actually
 * existed before the call (an erase with no stored key is a benign no-op).
 */
export interface ConfigEraseResult {
  ok: true;
  hadKey: boolean;
}

/**
 * Result of `cbe:config:test` — the test-connection probe (capability
 * `desktop-app`, Requirement: Credential Presence Indicator and Connection
 * Verifiability). Runs `GET {baseURL}/models` against the PERSISTED configuration
 * and classifies the outcome at a debugging-useful granularity:
 *
 * - `unauthorized` — the endpoint answered 401/403 (key rejected).
 * - `unreachable` — network error or timeout (host/URL/network problem).
 * - `http-error` — any other non-2xx response (`status` carries the code).
 * - `not-configured` — no persisted connection to test yet.
 *
 * NEVER carries the key, and the probe never throws — a failed probe is a value,
 * so Settings stays unblocked.
 */
export type ConnectionTestResult =
  | { ok: true }
  | { ok: false; cause: "unauthorized" | "unreachable" | "http-error" | "not-configured"; status?: number };

/** Payload for a UI-initiated canvas artefact deletion (Channels.canvasDelete). After
 * the ten-step restructure the artefact is addressed by its resolved step group (1..10)
 * plus, for a Step-6 journey artefact, the journey `phase` — the renderer knows both
 * because it renders the artefact in that group. */
export interface CanvasDeletePayload {
  sessionId: string;
  step: number;
  phase?: JourneyPhase;
  id: string;
  label?: string;
}

/**
 * Payload for a UI-initiated step focus (Channels.stepFocus; capability
 * `agent-harness`, Requirement: Host-Set Step Focus from the Canvas UI). The step
 * NUMBER is the contract — `label` travels only so the host-side focus notice can
 * name the step the way the lecturer saw it, exactly as `CanvasDeletePayload.label`
 * does for a deletion.
 */
export interface StepFocusPayload {
  sessionId: string;
  step: number;
  label?: string;
}

/**
 * Result of `cbe:corpus:info` (capability `distribution`, Scenario: Corpus
 * version auditable from the app). `cacheDate` is the ISO timestamp of the last
 * successful bundle download; null while the app still runs on the corpus copy
 * shipped inside the build (`source: "bundled"`).
 */
export interface ContentPackIdentity {
  packId: "cbe-skill" | "cbe-corpus";
  channel: "stable";
  epoch: number;
  sequence: number;
  version: string;
  source: "downloaded" | "previous";
  sourceCommit: string;
  manifestSha256: string;
  signerKeyId: string;
  installedAt: string;
}

export interface CorpusInfo {
  version: string | null;
  cacheDate: string | null;
  source: "bundled" | "downloaded";
  pack?: ContentPackIdentity;
}

/**
 * Result of `cbe:about:info` (capability `desktop-app`, Requirement: Settings
 * Panel (Phase 1 scaffold) — the About group). `appVersion` is the running
 * build's version; `skillName` / `skillVersion` come from the loaded skill's
 * frontmatter and are `null` when that file cannot be read or omits the field.
 * The renderer states an absent value plainly and never substitutes a literal.
 */
export type SkillCompatibilityField = "appRange" | "modelSurfaceAbi" | "toolContractSha256" | "testedPiVersion";

export type SignedContentPackRefusalCode =
  | "not-provisioned"
  | "metadata-too-large"
  | "signature-wrapper-invalid"
  | "signature-invalid"
  | "root-key-id-mismatch"
  | "metadata-schema-invalid"
  | "pack-mismatch"
  | "channel-mismatch"
  | "keyset-rollback"
  | "keyset-equivocation"
  | "key-revoked"
  | "key-not-authorized"
  | "metadata-expired"
  | "metadata-from-future"
  | "epoch-not-authorized"
  | "rollback"
  | "equivocation"
  | "compatibility-mismatch";

export type SignedContentPackTransportCode =
  | "metadata-http"
  | "metadata-read"
  | "metadata-too-large"
  | "redirect-refused"
  | "artifact-http"
  | "artifact-read"
  | "artifact-too-large"
  | "artifact-size-mismatch"
  | "artifact-hash-mismatch"
  | "artifact-path-invalid"
  | "archive-invalid"
  | "content-invalid"
  | "install-failed";

export type SkillUpdateStatus =
  | { status: "not-checked" }
  | { status: "updated"; version: string }
  | { status: "up-to-date"; version: string }
  | { status: "integrity-mismatch" }
  | { status: "unavailable" }
  | {
      status: "metadata-invalid";
      reason:
        | "malformed-json"
        | "not-object"
        | "missing-field"
        | "unknown-field"
        | "duplicate-field"
        | "field-malformed"
        | "too-large";
      field?: string;
    }
  | { status: "compatibility-mismatch"; field: SkillCompatibilityField }
  | { status: "signed-refused"; code: SignedContentPackRefusalCode; field?: string }
  | { status: "signed-unavailable"; code: SignedContentPackTransportCode };

export interface AboutInfo {
  appVersion: string;
  skillName: string | null;
  skillVersion: string | null;
  /** Last Skill update check. The effective version above remains authoritative
   * when this reports a refusal or unavailable channel. Optional for older
   * preload/main pairs during development. */
  skillUpdate?: SkillUpdateStatus;
  skillPack?: ContentPackIdentity;
}

/**
 * Why a refresh could not complete (Requirement: Corpus Refresh Outcomes
 * Resolve at Render Time). A reason is a code plus the technical data that
 * belongs to it — never a display sentence: the renderer resolves every code
 * through the active chrome catalogue, so no app-authored prose crosses the IPC
 * boundary and none of it is recognised by matching English text. The data a
 * reason carries (HTTP status, marker filename, refused entry name) is
 * untranslated technical detail. The underlying OS/network/library error is
 * logged in the main process instead of being surfaced.
 */
export type CorpusRefreshUnavailableReason =
  | { code: "not-configured" }
  | { code: "pointer-http"; httpStatus: number }
  | { code: "pointer-read" }
  | { code: "pointer-invalid" }
  | { code: "download-http"; httpStatus: number }
  | { code: "download-read" }
  | { code: "missing-marker"; markerFile: string }
  | { code: "unsafe-entry"; entryName: string }
  | { code: "install-failed" };

/**
 * Result of `cbe:corpus:refresh` (capability `distribution`, Requirement:
 * Corpus Distribution as Downloadable Bundle). Never throws across IPC — every
 * outcome is a value:
 *
 * - `updated` — new bundle verified, unpacked, and now the active corpus.
 * - `up-to-date` — the pointer does not advertise a version newer than the
 *   loaded one (the same version, or an older one that was refused); the
 *   `version` field carries the loaded version, not the advertised one.
 * - `integrity-mismatch` — the download's SHA256 differs from `latest.json`;
 *   the download was discarded and the previous corpus stays loaded.
 * - `unavailable` — channel unconfigured, network/HTTP failure, or a bundle
 *   that could not be unpacked; the typed `reason` names which, and the
 *   previous corpus stays loaded.
 */
export type CorpusRefreshResult =
  | { status: "updated"; version: string; pack?: ContentPackIdentity }
  | { status: "up-to-date"; version: string }
  | { status: "integrity-mismatch"; expected: string; actual: string }
  | { status: "unavailable"; reason: CorpusRefreshUnavailableReason }
  | { status: "signed-refused"; code: SignedContentPackRefusalCode; field?: string }
  | { status: "signed-unavailable"; code: SignedContentPackTransportCode; httpStatus?: number };

/**
 * Main → renderer auto-update lifecycle (capability `distribution`,
 * Requirement: Auto-update mechanism). `available` carries the version and a
 * changelog link for the non-blocking notice; `downloaded` flips the notice to
 * the restart-and-install affordance; `error` covers a failed download (e.g.
 * unsigned macOS — see docs/auto-update.md) without blocking anything.
 */
export type UpdateEvent =
  | { type: "available"; version: string; notesUrl: string }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

/**
 * Renderer → main user decision on an offered update. `download` = "install
 * now" (starts the download), `install` = restart-and-install after
 * `downloaded`, `later` dismisses for this run, `skip` persists the version so
 * it is not offered again (Scenario: User can decline updates).
 */
export interface UpdateActionPayload {
  action: "download" | "install" | "later" | "skip";
  version: string;
}
