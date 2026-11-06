import {
  startCbeSession,
  createCitationResolver,
  composePayloadWithDeletionNotices,
  composePayloadWithFocusNotice,
  composePayloadWithRetainedState,
  composePayloadWithStalenessNotice,
  composePayloadWithWikiAtomsNotice,
  deriveMaturityState,
  governingStaleness,
  type DesignSignal,
  type MaturityDerivedState,
  type RetainedStateHandover,
  type CanvasArtefactEntry,
  type CbeSlashCommand,
  type CanvasMirror,
  type MaturityMirror,
  type MaturitySnapshot,
  type PendingDeletionNotice,
  type PendingFocusNotice,
  type PendingWikiAtomsNotice,
  type WikiRetrievalGate,
  type ResolvedCanvasAddress,
  type ProviderConfig,
  type CompanionPhase,
  type TurnStopController,
  type CbeSessionPort,
} from "@cbe/pi-bridge";
import { FileLecturerProfileStore, LecturerProfileService } from "./lecturer-profile-store.js";
import { FileLecturerIdentityStore, LecturerIdentityService } from "./lecturer-identity-store.js";
import { FileLecturerSupportStore } from "./lecturer-support-store.js";
import {
  LecturerSupportService,
  type LecturerSupportDisclosure,
  type LecturerSupportDue,
} from "@cbe/pi-bridge/lecturer-support";
import { coursesRoot, lecturerProfileMdPath, lecturerStatePath, type LecturerStateLayers } from "./courses.js";
import { activeCorpusDir, type CorpusUpdaterPaths } from "./corpus-updater.js";
import { activeSkillDir, type SkillUpdaterPaths } from "./skill-updater.js";
import { readSkillIdentity } from "./skill-meta.js";
import path from "node:path";
import { app } from "electron";
import { readFile } from "node:fs/promises";
import { mkdirSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { seedableTurns, type SessionDesignState, type SessionMeta, type SessionTurn } from "./sessions.js";
import { promotedAssistantTurn } from "../shared/turn-stop.js";
import { chrome } from "./interface-language.js";
import { ToolCardRecorder } from "../shared/design-cards.js";
import type { DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import type { StepMirror, PendingAnswerGate, StepCoverageEntry } from "@cbe/pi-bridge";
import { ContextOccupancyTracker, type ContextOccupancy } from "@cbe/pi-bridge";

// Isolate pi-coding-agent in an app-owned directory under userData. This prevents any
// touch of the user's global ~/.pi/ installation and stops pi-coding-agent's default
// behaviour of lazy-installing packages (e.g. pi-claude-cli) to the user's home dir.
//
// Since `adopt-settled-pi-runtime-lifecycle` the bridge passes this directory, an
// in-memory settings manager and a no-discovery resource policy to every session
// explicitly (`@cbe/pi-bridge` runtime/pi-config.ts), so correctness no longer
// depends on these environment variables. They stay set as defence in depth for any
// Pi code path that still consults `getAgentDir()`.
//
// The seeded settings.json (packages=[], extensions=[], skills=[]) is no longer read
// by any session; it is still created for a fresh profile so a rollback to a build
// that does read it finds the same isolating file, and an existing one is never
// rewritten.
const PI_AGENT_DIR = path.join(app.getPath("userData"), "pi-agent");
process.env.PI_CODING_AGENT_DIR = PI_AGENT_DIR;
process.env.PI_PACKAGE_DIR = path.join(PI_AGENT_DIR, "npm");
mkdirSync(PI_AGENT_DIR, { recursive: true });

// Workspace pin: the agent's cwd MUST be a writable app-owned directory, never the
// filesystem root or the user's home. Packaged Electron apps default to "/" when no
// cwd is set; that breaks file tools and leaks paths into the system prompt.
//
// The workspace lives OUTSIDE pi-agent/ on purpose. pi-coding-agent appends
// "Current working directory: <cwd>" to the system prompt; if that path contained
// "pi-agent", the model would confabulate a pi-coding-agent identity from the path
// alone. The workspace dir is named neutrally so the cwd-as-prompt-leak says nothing.
const CBE_WORKSPACE = path.join(app.getPath("userData"), "workspace");
mkdirSync(CBE_WORKSPACE, { recursive: true });
const piSettingsPath = path.join(PI_AGENT_DIR, "settings.json");
if (!existsSync(piSettingsPath)) {
  writeFileSync(piSettingsPath, JSON.stringify({ packages: [], extensions: [], skills: [] }, null, 2), "utf-8");
}

type StartResult = Awaited<ReturnType<typeof startCbeSession>>;

interface ActiveSession {
  id: string;
  /** The CBE-owned session port (capability `agent-harness`, Requirement: *Pi
   * Runtime Is Hidden Behind a CBE-Owned Port*) — prompt, steer, abort, dispose,
   * normalized events, context usage, provider re-bind and slash commands. */
  session: CbeSessionPort;
  env: StartResult["env"];
  /** Course this session belongs to (capability `course-workspace`). Sessions
   * started in a course persist to that course's folder even if the lecturer
   * switches the active course before closing. */
  courseId: string;
  /** Directory the session sidecars are written to — the course's
   * `sessions/` folder. */
  sessionsDir: string;
  /** Lossless model-payload transcript; user turns may carry the optional
   * `display` projection (what the lecturer saw). */
  transcript: SessionTurn[];
  draft: string;
  /** Per-run buffer of the DESIGN-RECORD tool calls this run made (capability
   * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files* —
   * "Design-record tool cards on an assistant turn"). Filled from the same tool
   * events the renderer receives; promoted onto the assistant turn beside
   * `draft`, and cleared with it. */
  cardRecorder: ToolCardRecorder;
  modelId: string;
  skillVersion: string;
  createdAt: string;
  /** Host-side canvas artefact mirror (capability `agent-harness`, Requirement:
   * Host-Side Canvas Artefact Mirror). A UI deletion routes through it; its pending
   * notices are drained onto the next lecturer turn's payload. */
  canvasMirror: CanvasMirror;
  /** Host-side session maturity mirror (capability `agent-harness`, Requirement:
   * Host-Side Session Maturity Mirror). Its snapshot rides every hydration /
   * `conversationOpen` payload; on resume the bridge rebuilt it from the
   * session's own record before this handle existed. Never written to disk. */
  maturityMirror: MaturityMirror;
  /** Host-side design-substance and revision signal (capability `agent-harness`,
   * Requirement: Host-Side Design-Substance and Revision Signal). The single
   * authority behind the panel's framing and the standing staleness notice. */
  designSignal: DesignSignal;
  /** Host-side step-coverage mirror — depth-ladder guard, derived focus, and the
   * step-coverage snapshot a New Session carries over. */
  stepMirror: StepMirror;
  /** Per-run outstanding-question gate, reset at each `agent_start`. */
  pendingAnswerGate: PendingAnswerGate;
  /** Context-occupancy tracker (capability `agent-harness`, Requirement: Context
   * Occupancy Reported to the Host). Reports pi's own figure and knows which of
   * the three unknown states the session is in. */
  contextOccupancy: ContextOccupancyTracker;
  /** The lecturer's CONFIGURED context window, or undefined where they set none.
   * The provider's high default for an unset value is a safety assumption about
   * an unknown model, not a measurement of it, and is deliberately not stored
   * here — the report omits `window` instead. Re-set by a live provider swap. */
  configuredContextLength?: number;
  /** The last occupancy reported to the renderer, so an unchanged one is not
   * re-emitted. */
  lastOccupancy?: ContextOccupancy;
  /** Armed by every completed compaction; drained into the next lecturer turn's
   * payload so the model's view of the retained state is re-synced with the
   * host's (capability `agent-harness`, Requirement: Post-Compaction
   * Retained-State Handover). */
  retainedStateHandover: RetainedStateHandover;
  /** The lecturer's stop on this session's running turn (capability
   * `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*). Owns
   * the single claim on a run's end, so the lecturer stop and the loop breaker's
   * abort stay distinguishable and produce exactly one run end between them. */
  turnStop: TurnStopController;
  /** This session's wiki retrieval gate (capability `agent-harness`, Requirement:
   * *Newly Ingested Wiki Atoms Are Disclosed on the Next Lecturer Turn*). The host
   * arms it when an ingestion lands atoms; `cbe_wiki` reads it on every call. */
  wikiIndexGate: WikiRetrievalGate;
  /** This session's next-prompt disclosure of the lecturer-wide support preference
   * (capability `agent-harness`, Requirement: *Separate Lecturer-Wide Support
   * Preference*). Derived from the shared service's revision, so a prompt Pi refuses
   * consumes nothing and needs no requeue. */
  supportDisclosure: LecturerSupportDisclosure;
  /** This session's decision artefacts, seeded from its own course's sidecar on
   * resume and written back at every flush (Requirement: Decision Artefacts Are
   * Per-Conversation State). It is per SESSION — a course switch cannot make one
   * course's decisions reach another course's sidecar. Undefined = never entered
   * the Check Pipeline, which keeps the sidecar's trivial `{meta, turns}` shape. */
  didacticChecks?: DidacticChecks;
  /** True while an agent turn is being processed for this session. A provider swap
   * requested during a turn is deferred (see `pendingProvider`) so `setModel` is
   * only ever called at an idle boundary. */
  inFlight: boolean;
  /** A provider swap requested while `inFlight` — applied before the next prompt. */
  pendingProvider?: ProviderConfig;
  /** Profile Panel overrides applied since the last prompt. Drained by the prompt
   * handler and prepended as a bracketed system note, so the running session learns
   * about the override at the next turn boundary (no mid-turn mutation). */
  pendingProfileNotes: string[];
}

// Read-only resources (skill bundle, dev corpus) are shipped inside the app bundle as
// `extraResources` in packaged builds and resolved from the repo root in dev.
// See desktop-app spec, Requirement: Resource Bundling and Path Resolution.
export function resolveResource(relPath: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relPath);
  }
  // Dev: packages/app → repo root via ../..
  return path.resolve(app.getAppPath(), "../..", relPath);
}

// Skill resolution goes through the bundle updater (capability `distribution`,
// Requirement: Skill Distribution as Versioned Bundle): a verified, downloaded
// skill state in the user-data cache takes precedence over the read-only copy
// shipped with the app. Resolved per use, not once at module load, so a
// refreshed skill is picked up by the NEXT session without an app restart —
// a running session keeps the skill body it was started with.
export const SKILL_UPDATER_PATHS: SkillUpdaterPaths = {
  cacheRoot: path.join(app.getPath("userData"), "skill-cache"),
  trustDir: path.join(app.getPath("userData"), "content-pack-trust"),
  packsDir: path.join(app.getPath("userData"), "content-packs"),
  bundledDir: resolveResource(path.join("skills", "cbe")),
  signedOnly: true,
  get installedAppVersion() {
    return app.getVersion?.();
  },
};
export function currentSkillDir(): string {
  return activeSkillDir(SKILL_UPDATER_PATHS);
}

/** The loaded skill's own file — the single source for its name and version,
 * read by the session (`skillVersion`) and by the settings About group. */
export function currentSkillMdPath(): string {
  return path.join(currentSkillDir(), "SKILL.md");
}

// Corpus resolution goes through the bundle updater (capability `distribution`,
// Requirement: Corpus Distribution as Downloadable Bundle): a verified,
// downloaded corpus in the user-data cache takes precedence over the read-only
// copy shipped with the app. Resolved per use, not once at module load, so a
// refreshed corpus is picked up without an app restart.
export const CORPUS_UPDATER_PATHS: CorpusUpdaterPaths = {
  cacheRoot: path.join(app.getPath("userData"), "corpus-cache"),
  trustDir: path.join(app.getPath("userData"), "content-pack-trust"),
  packsDir: path.join(app.getPath("userData"), "content-packs"),
  bundledDir: resolveResource("corpus"),
  signedOnly: true,
  get installedAppVersion() {
    return app.getVersion?.();
  },
};
export function currentCorpusDir(): string {
  return activeCorpusDir(CORPUS_UPDATER_PATHS);
}

// User-writable data lives in the per-user writable location, never inside the bundle —
// identical in dev and packaged so the path semantics do not diverge.
//
// LEGACY (Phase 1/2): flat sessions directory. New sessions land in the active
// course's `sessions/` folder (capability `course-workspace`); files here are
// neither migrated nor deleted — their presence is tolerated (Scenario: Legacy
// flat sessions do not break the course workspace).
const SESSIONS_DIR = path.join(app.getPath("userData"), "sessions");

export { SESSIONS_DIR };

// Course workspace (capability `course-workspace`): the Space root IS userData
// (design.md D1); courses live under <userData>/courses/. The active-course
// pointer is app state in its own small file — NOT a course index (courses are
// discovered by folder scan only).
export const COURSES_ROOT = coursesRoot(app.getPath("userData"));
export const WORKSPACE_STATE_PATH = path.join(app.getPath("userData"), "workspace-state.json");

/** Course session-start context passed by the IPC layer (capability
 * `course-workspace`): where to store sidecars, the course wiki path for the
 * environment descriptor, and the `course.md` content injected at session start. */
export interface CourseSessionContext {
  id: string;
  sessionsDir: string;
  wikiDir: string;
  courseContext?: string;
  /** The two Lecturer-State layers (global profile + per-course overlay),
   * read fresh at session start (capability `course-workspace`). */
  lecturerState?: LecturerStateLayers;
}

/** Resume context: reopen a stored session under its original id, seeding the
 * stored transcript into the fresh pi session (capability `course-workspace`,
 * Requirement: Project View Lists Stored Sessions and Supports Resume). */
/** What a flush needs from a live session: the sidecar pair's content plus the
 * course-pinned destination. `didacticChecks` rides along so a flush REWRITES the
 * decision state instead of dropping it (Requirement: Decision Artefacts Are
 * Per-Conversation State). */
/** One compact line describing the carried decision artefacts, for the decisions
 * prior. Deliberately a summary, not a dump: the block is bounded and the entries
 * themselves stay authoritative in the renderer. */
export function summariseDecisions(checks: DidacticChecks): string {
  const parts: string[] = [];
  if (checks.kompetenz.goals.length > 0) parts.push(`${checks.kompetenz.goals.length} operative goal(s) recorded`);
  if (checks.alignment.findings.length > 0) parts.push(`${checks.alignment.findings.length} alignment finding(s)`);
  if (checks.delegation.decisions.length > 0)
    parts.push(`${checks.delegation.decisions.length} delegation decision(s)`);
  if (checks.heterogeneity?.fired) parts.push("heterogeneity question answered");
  if (checks.softSkill?.fired) parts.push("soft-skill anchor recorded");
  return parts.join("; ");
}

export interface SessionFlushSnapshot {
  meta: Omit<SessionMeta, "closedAt">;
  turns: SessionTurn[];
  sessionsDir: string;
  didacticChecks?: DidacticChecks;
  /** Course design state persisted alongside the decision artefacts (capability
   * `agent-harness`, Requirement: Course Design-State Store). Read from the host
   * mirrors at flush time so the course keeps them across a restart, exactly as
   * `didacticChecks` already does. Every flush carries all of them — the sidecar
   * write replaces the file atomically, so an omitted field is a deletion. */
  canvas?: CanvasArtefactEntry[];
  steps?: StepCoverageEntry[];
  maturity?: MaturitySnapshot;
}

/**
 * The course design state a flush must persist (capability `agent-harness`,
 * Requirement: Course Design-State Store), read from the host mirrors that own it
 * at runtime.
 *
 * EVERY flush carries all of it. The sidecar write replaces the file atomically,
 * so a flush that omits a field deletes previously persisted state — the defect
 * that already hit `didacticChecks` once. Empty states are omitted rather than
 * written as empty arrays, keeping the trivial `{meta, turns}` sidecar shape for
 * sessions that never produced design state, and an absent field reads back as
 * "nothing recorded" rather than as an established-but-empty reading.
 */
function designStateOf(s: ActiveSession): Pick<SessionFlushSnapshot, "canvas" | "steps" | "maturity"> {
  const canvas = s.canvasMirror.list();
  // `recordedList()`, not `list()`: the host's initial step-focus seed is a
  // starting point, and a course with no record MUST open empty — "never a
  // default" (Requirement: *Course Design-State Store*). Persisting the seed
  // would write that default into the course's own folder on the first turn
  // boundary and hand it back on the next open as recorded work.
  const steps = s.stepMirror.recordedList();
  const maturity = s.maturityMirror.snapshot();
  return {
    ...(canvas.length > 0 ? { canvas } : {}),
    ...(steps.length > 0 ? { steps } : {}),
    ...(Object.keys(maturity).length > 0 ? { maturity } : {}),
  };
}

export interface SessionResumeContext {
  sessionId: string;
  createdAt: string;
  turns: SessionTurn[];
  /** Sanitised design state from the ordinary course open/resume route, inspected
   * before the descriptor is built. An explicit empty object proves an untouched
   * course; absence keeps replay/import and other transcript-only restores out. */
  designState?: SessionDesignState;
  /** Decision artefacts restored from THIS course's canonical sidecar
   * (capability `desktop-app`, Requirement: Decision Artefacts Are
   * Per-Conversation State). Carried on the session so every flush writes it
   * BACK — otherwise the next turn-boundary flush would drop the field and
   * silently destroy the persisted state. */
  didacticChecks?: DidacticChecks;
}

/**
 * Host wiring for the compaction companion's renderer visibility (capability
 * `desktop-app`, Requirement: Compaction Visibility in the Renderer). The
 * bridge's per-session callbacks carry no session identity, so the manager
 * binds the session id before forwarding — the IPC layer turns `onPhase` into
 * the `compaction_phase` AgentEvent and routes the documented small-context
 * error (`onContextWindowTooSmall`, Requirement: Documented Error Behaviour)
 * through the existing `error` event surface.
 */
export interface CompactionWiring {
  onPhase: (sessionId: string, phase: CompanionPhase) => void;
  onContextWindowTooSmall: (sessionId: string, message: string) => void;
}

// Per-lecturer profile record (capability `agent-harness`, Requirement: Per-Lecturer
// Profile Store): ONE human-readable JSON file per userData directory, loaded at
// session start (prior injection) and updated on every accepted `cbe_profile` tool
// call and every Profile Panel override. All writes go through the serialised
// service so concurrent updates cannot lose writes.
const LECTURER_PROFILE_PATH = path.join(app.getPath("userData"), "lecturer-profile.json");
export const lecturerProfileService = new LecturerProfileService(new FileLecturerProfileStore(LECTURER_PROFILE_PATH));

// Per-lecturer IDENTITY record (capability `agent-harness`, Requirement:
// Per-Lecturer Identity Record): the lecturer's name and preferred form of address,
// both optional. Its own file BESIDE the profile record — never a key inside it,
// because that record is typed and rendered as a map of the five dimensions and a
// sibling key there would be emitted as a dimension complete with a confidence it
// does not have. Written only by the lecturer, through the Profile area.
const LECTURER_IDENTITY_PATH = path.join(app.getPath("userData"), "lecturer-identity.json");
export const lecturerIdentityService = new LecturerIdentityService(
  new FileLecturerIdentityStore(LECTURER_IDENTITY_PATH)
);

// The lecturer's SUPPORT PREFERENCE (capability `agent-harness`, Requirement: Separate
// Lecturer-Wide Support Preference): a third record beside the two above and part of
// neither — a stated instruction about how much help to start with, not an estimate and
// not identity. ONE service for every open conversation, so its compare-and-set orders
// writes from concurrent sessions and each session's disclosure compares against the
// same revision. Written only through `cbe_support`; no panel edits it.
const LECTURER_SUPPORT_PATH = path.join(app.getPath("userData"), "lecturer-support.json");
export const lecturerSupportService = new LecturerSupportService(
  new FileLecturerSupportStore(LECTURER_SUPPORT_PATH),
  "lecturer-wide"
);

async function readSkillVersion(skillPath: string): Promise<string> {
  return (await readSkillIdentity(skillPath)).version ?? "0.1.0";
}

/** Concrete `sessions/` paths of courses that exist right now — the Linux leg
 * of the session-store write denial (agent-harness, Requirement: Session Store
 * Is Not Agent-Writable): bubblewrap skips glob patterns, so existing courses
 * are pinned by concrete subpath denies. Sync on purpose: called once per
 * session start on a tiny directory. */
function existingCourseSessionDirs(): string[] {
  try {
    return readdirSync(COURSES_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(COURSES_ROOT, e.name, "sessions"));
  } catch {
    return [];
  }
}

// Corpus ids for `/cite` argument completion — read once, cached across sessions.
let corpusIdsCache: string[] | null = null;
async function loadCorpusIds(): Promise<string[]> {
  if (corpusIdsCache) return corpusIdsCache;
  try {
    const resolver = await createCitationResolver(currentCorpusDir());
    corpusIdsCache = resolver.listIds();
  } catch {
    corpusIdsCache = [];
  }
  return corpusIdsCache;
}

/** Drop corpus-derived caches after a successful bundle refresh so completions
 * (and anything else keyed on corpus ids) re-read the new tree. */
export function resetCorpusCaches(): void {
  corpusIdsCache = null;
}

export class AgentManager {
  private sessions = new Map<string, ActiveSession>();

  async start(
    provider: {
      baseURL: string;
      apiKey: string;
      modelId: string;
      contextLength?: number;
      reasoning?: boolean;
      reasoningEffort?: ProviderConfig["reasoningEffort"];
    },
    course?: CourseSessionContext,
    resume?: SessionResumeContext,
    /** Canvas artefacts carried over from the outgoing session (capability
     * `agent-harness`, Requirement: Session-Start Canvas Artefact Injection).
     * The IPC layer snapshots them from the OUTGOING session's host-side canvas
     * mirror before closing it — never from the renderer store. */
    canvasArtefacts?: ReadonlyArray<CanvasArtefactEntry>,
    /** Compaction-companion visibility wiring (capability `desktop-app`,
     * Requirement: Compaction Visibility in the Renderer) — bound to this
     * session's id and handed to the bridge's `compaction` option. */
    compaction?: CompactionWiring,
    /** Decision artefacts carried onto a FRESH session by the New Session reset
     * (Requirement: Decision Artefacts Are Per-Conversation State) — the reset
     * clears the conversation context, not the course's artefacts. Ignored on a
     * resume, which brings its own value in `resume.didacticChecks`. */
    didacticChecks?: DidacticChecks,
    /** Step coverage and maturity reading carried over by a New Session reset
     * (capability `desktop-app`, Requirement: New Session Control With Canvas
     * Carry-Over). Seeded into the fresh session's mirrors AND rendered as prior
     * blocks so the model starts from the recorded state instead of re-deriving it. */
    retained?: { stepCoverage?: ReadonlyArray<StepCoverageEntry>; maturity?: Record<string, unknown> }
  ): Promise<ActiveSession> {
    // Resume keeps the ORIGINAL sessionId so subsequent turns append to the
    // same sidecars (capability `course-workspace`, Requirement: Project View
    // Lists Stored Sessions and Supports Resume).
    const id = resume?.sessionId ?? crypto.randomUUID();
    if (this.sessions.has(id)) throw new Error(`Session already open: ${id}`);
    const corpusIds = await loadCorpusIds();
    // Inject the persisted lecturer profile as a prior (capability `agent-harness`,
    // Requirement: Session-Start Profile Injection) so a returning lecturer is not
    // re-scaffolded from zero. null → undefined → no block, cold start unchanged.
    const lecturerProfile = (await lecturerProfileService.current()) ?? undefined;
    // The lecturer's own identity record (capability `agent-harness`, Requirement:
    // Session-Start Identity Injection). null → undefined → no block; a record with
    // nothing recorded renders no block either, so today's descriptor is unchanged
    // for a lecturer who never filled the fields in.
    const lecturerIdentity = (await lecturerIdentityService.current()) ?? undefined;
    // A resume brings its own course's persisted value; a fresh start carries the
    // outgoing session's value across the New Session reset.
    const carriedChecks = resume?.didacticChecks ?? didacticChecks;
    // Orientation for a genuinely fresh design, and for an ordinary untouched
    // resume/reopen (capability `agent-harness`,
    // Requirement: *Host-Set Initial Step Focus*). Declared as a FLAG rather than
    // smuggled in as carry-over coverage: the bridge applies it to the session's
    // own mirror, which then knows the focus is a default — so the descriptor's
    // step prior and the renderer's first frame carry it while the persisted
    // course record and the post-compaction handover, both of which mean recorded
    // work, see nothing.
    //
    // New Session is excluded absolutely, including empty/seed-only carry-over.
    // Ordinary resume may seed again, but only after inspecting ALL durable design
    // surfaces: a missing step field cannot erase evidence on another surface.
    // Transcript/sidecar existence alone is not design work. Other restore routes
    // supply no designState and remain excluded, even with an empty transcript.
    const restored = resume?.designState;
    const hasChecks =
      carriedChecks &&
      (carriedChecks.kompetenz.status !== "not-started" ||
        carriedChecks.alignment.status !== "not-started" ||
        carriedChecks.delegation.status !== "not-started" ||
        carriedChecks.kompetenz.goals.length > 0 ||
        carriedChecks.alignment.findings.length > 0 ||
        carriedChecks.delegation.decisions.length > 0 ||
        carriedChecks.heterogeneity?.fired ||
        carriedChecks.heterogeneity?.notes ||
        carriedChecks.softSkill?.fired ||
        carriedChecks.softSkill?.anchors?.length);
    const initialStepFocus =
      !retained &&
      !canvasArtefacts?.length &&
      !didacticChecks &&
      !hasChecks &&
      (!resume ||
        (restored !== undefined &&
          !restored.steps?.length &&
          !restored.canvas?.length &&
          !Object.keys(restored.maturity ?? {}).length));
    const result = await startCbeSession({
      profile: "app",
      // Pin Pi's session record to the host session id so the same-session
      // maturity-mirror rebuild can find this session's own record on resume
      // (Requirement: Host-Side Session Maturity Mirror).
      sessionId: id,
      lecturerProfile,
      lecturerIdentity,
      // Lecturer-wide, shared by every open session (see `lecturerSupportService`).
      lecturerSupportService,
      // Persistent course context (capability `course-workspace`, Requirement:
      // Course Context in course.md) — injected so recorded facts are not re-asked.
      courseContext: course?.courseContext,
      // Two-layer Lecturer-State (global profile + per-course overlay) so the
      // scaffolding fade carries across sessions instead of resetting.
      lecturerState: course?.lecturerState,
      // Resume: seed the stored transcript into the fresh pi session so the
      // model continues the conversation instead of starting cold.
      //
      // `seedableTurns` leaves out an assistant turn with no text — a turn whose
      // whole output was design-record tool calls. It stays in `transcript`
      // above (the lecturer reads their conversation back complete); it is not
      // seeded, because nothing about such a turn reached a resumed model before
      // it was persisted, and persisting it must not change what the model sees
      // (capability `agent-harness`, Requirement: *Sessions as Local
      // Markdown/JSON Files* — "The resume seed skips an assistant turn with no
      // text").
      ...(resume ? { resume: { turns: seedableTurns(resume.turns) } } : {}),
      // New Session carry-over: the outgoing session's canvas artefacts, rendered
      // as a `canvas prior` block and pre-seeded into the fresh session's mirror.
      ...(canvasArtefacts && canvasArtefacts.length > 0 ? { canvasArtefacts } : {}),
      ...(retained?.stepCoverage && retained.stepCoverage.length > 0 ? { stepCoverage: retained.stepCoverage } : {}),
      ...(initialStepFocus ? { initialStepFocus: true } : {}),
      ...(retained?.maturity && Object.keys(retained.maturity).length > 0
        ? { maturity: retained.maturity as Record<string, { current?: unknown; target?: unknown; note?: string }> }
        : {}),
      ...(didacticChecks ? { decisionsSummary: summariseDecisions(didacticChecks) } : {}),
      // The stop's pre-run latch reads the HOST's in-flight flag, not the
      // runtime's streaming flag: the two differ exactly in the window between
      // the prompt being dispatched and `agent_start` arriving, which is the
      // window this requirement exists for (capability `agent-harness`,
      // Requirement: *A Lecturer Can Stop a Running Turn*). Read off the LIVE
      // session, exactly like `getDecisionsSummary` below — the handle does not
      // exist yet at this point.
      hasPendingTurn: () => this.sessions.get(id)?.inFlight === true,
      skillDir: currentSkillDir(),
      // New sessions live under the active course; the flat SESSIONS_DIR remains
      // only as the course-less fallback (headless-like starts, tests).
      sessionsDir: course?.sessionsDir ?? SESSIONS_DIR,
      agentDir: PI_AGENT_DIR,
      cwd: CBE_WORKSPACE,
      // Surface the corpus directory in the system-prompt-visible env descriptor
      // so the model doesn't have to grep the skill body to discover it. The wiki
      // path is the active course's own `wiki/` folder (capability
      // `course-workspace`, Requirement: Course-Owned Wiki).
      paths: {
        workspace: CBE_WORKSPACE,
        corpus: currentCorpusDir(),
        ...(course ? { wiki: course.wikiDir } : {}),
      },
      // Path fence on `write`/`edit` (capability `agent-harness`, Requirement:
      // Path-Fenced File Mutation Tools): exactly the four destinations the
      // harness's own prompt directs the model to, and no others — the agent
      // workspace, the active course's wiki, and the two Lecturer-State FILES
      // at the absolute paths the descriptor names (files, not their parent
      // directories: both sit beside host-owned state). Built here, in app
      // code, from no model-reachable input; a course-less session gets the
      // workspace and the global profile file only.
      writableRoots: {
        dirs: [CBE_WORKSPACE, ...(course ? [course.wikiDir] : [])],
        files: [
          lecturerProfileMdPath(app.getPath("userData")),
          ...(course ? [lecturerStatePath(COURSES_ROOT, course.id)] : []),
        ],
      },
      provider,
      // Slash-command extension: /cite completes from the corpus.
      commands: {
        listCorpusIds: () => corpusIds,
      },
      // Compaction companion host wiring (capability `agent-harness`,
      // Requirement: Compaction Companion — Artefact Consolidation Before
      // Context Compaction; renderer surface: `desktop-app`, Requirement:
      // Compaction Visibility in the Renderer). The extension itself is always
      // registered by the bridge; this binds the host-side accessors: the
      // LIVE per-lecturer profile store (not the session-start snapshot, so a
      // mid-session `cbe_profile` write counts as mirrored) plus the phase /
      // small-context-error callbacks, session id bound here.
      compaction: {
        getProfile: () => lecturerProfileService.current(),
        // Decisions section of the post-compaction retained-state handover
        // (Requirement: Post-Compaction Retained-State Handover). Read from the
        // LIVE ActiveSession at handover time — the didactic-check store lives in
        // the app and no tool writes it today, so this renders nothing; the wiring
        // is here so a future producer needs no second sweep.
        getDecisionsSummary: () => {
          const checks = this.sessions.get(id)?.didacticChecks;
          return checks ? summariseDecisions(checks) : undefined;
        },
        ...(compaction
          ? {
              onPhase: (phase: CompanionPhase) => compaction.onPhase(id, phase),
              onContextWindowTooSmall: (message: string) => compaction.onContextWindowTooSmall(id, message),
            }
          : {}),
      },
    });
    const skillVersion = await readSkillVersion(currentSkillMdPath());
    const active: ActiveSession = {
      id,
      session: result.session,
      env: result.env,
      courseId: course?.id ?? "",
      sessionsDir: course?.sessionsDir ?? SESSIONS_DIR,
      transcript: resume ? [...resume.turns] : [],
      draft: "",
      cardRecorder: new ToolCardRecorder(),
      modelId: provider.modelId,
      skillVersion,
      // Resume preserves the original creation time — the archive stays one
      // continuous session across app restarts.
      createdAt: resume?.createdAt ?? new Date().toISOString(),
      canvasMirror: result.canvasMirror,
      maturityMirror: result.maturityMirror,
      designSignal: result.designSignal,
      stepMirror: result.stepMirror,
      pendingAnswerGate: result.pendingAnswerGate,
      retainedStateHandover: result.retainedStateHandover,
      turnStop: result.turnStop,
      wikiIndexGate: result.wikiIndexGate,
      supportDisclosure: result.supportDisclosure,
      contextOccupancy: new ContextOccupancyTracker(),
      ...(provider.contextLength !== undefined ? { configuredContextLength: provider.contextLength } : {}),
      ...(carriedChecks ? { didacticChecks: carriedChecks } : {}),
      inFlight: false,
      pendingProfileNotes: [],
    };
    this.sessions.set(id, active);
    return active;
  }

  /**
   * Apply a saved provider to a running session live (capability `desktop-app`,
   * Requirement: Live Provider Swap into the Running Session on Settings Save).
   * Idle-safe: if a turn is in flight, the swap is stashed and applied at the next
   * idle boundary (before the next prompt, see `applyPendingProvider`). On failure
   * the session is left on its previous provider and the error is reported back.
   */
  async updateProvider(
    sessionId: string,
    provider: ProviderConfig
  ): Promise<{ ok: true; modelId: string } | { ok: false; error: string }> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: `Session not found: ${sessionId}` };
    if (s.inFlight) {
      // Defer: a turn is running. Apply before the next prompt so the next message
      // the lecturer sends already uses the new model — without aborting the turn.
      s.pendingProvider = provider;
      return { ok: true, modelId: provider.modelId };
    }
    try {
      await s.session.updateProvider(provider);
      s.modelId = provider.modelId;
      // The registered model's effective window may have moved — including
      // being CLEARED, so the assignment is unconditional (Requirement: Context
      // Occupancy Reported to the Host, live-provider-swap scenario).
      s.configuredContextLength = provider.contextLength;
      return { ok: true, modelId: provider.modelId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Apply a deferred provider swap (stashed while a turn was in flight) at an idle
   * boundary — called by the prompt handler before issuing the next prompt. A
   * failure leaves the session on its previous provider (recoverable). */
  async applyPendingProvider(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s?.pendingProvider) return;
    const provider = s.pendingProvider;
    s.pendingProvider = undefined;
    try {
      await s.session.updateProvider(provider);
      s.modelId = provider.modelId;
    } catch (err) {
      console.error(`[agent] deferred provider swap failed for session ${sessionId}:`, err);
    }
  }

  /** Mark turn boundaries so a provider swap requested mid-turn can be deferred. */
  setInFlight(sessionId: string, inFlight: boolean): void {
    const s = this.sessions.get(sessionId);
    if (s) s.inFlight = inFlight;
  }

  /** Queue a profile-override note on every active session. The override record is
   * per-lecturer (global), so every running session must learn about it at its next
   * turn boundary (capability `desktop-app`, Requirement: Profile Panel). */
  queueProfileNote(note: string): void {
    for (const s of this.sessions.values()) s.pendingProfileNotes.push(note);
  }

  /** Drain the queued profile notes for one session (called by the prompt handler). */
  drainProfileNotes(sessionId: string): string[] {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    const notes = [...s.pendingProfileNotes];
    s.pendingProfileNotes = [];
    return notes;
  }

  /** Put profile notes back that were drained into a payload the model never
   * received. They return to the front of the queue in their original order, so
   * the lecturer's retry carries them once, at the next turn boundary the Profile
   * Panel requirement promises. */
  requeueProfileNotes(sessionId: string, notes: readonly string[]): void {
    const s = this.sessions.get(sessionId);
    if (!s || notes.length === 0) return;
    s.pendingProfileNotes.unshift(...notes);
  }

  /** Record a UI-initiated canvas artefact deletion (capability `desktop-app`,
   * Requirement: Canvas Artefact Delete Control): remove the mirror entry exactly
   * like a skill-emitted clear AND enqueue a deletion notice so the next lecturer
   * turn discloses it to the agent. No-op for an unknown session. */
  recordCanvasDeletion(sessionId: string, addr: ResolvedCanvasAddress, id: string, label?: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.canvasMirror.recordUiDeletion(addr, id, label);
  }

  /** Prefix any pending UI-deletion notices for one session to the given payload
   * (drained). One machine-readable line per deleted artefact ahead of the text;
   * empty queue → text unchanged. Called by the prompt handler. */
  composePromptWithCanvasDeletions(sessionId: string, text: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return text;
    return composePayloadWithDeletionNotices(s.canvasMirror.drainDeletionNotices(), text);
  }

  /** The UI-deletion notices awaiting disclosure, read BEFORE composing so a
   * payload the model never receives can give them back. Unknown session → none. */
  pendingCanvasDeletions(sessionId: string): PendingDeletionNotice[] {
    return this.sessions.get(sessionId)?.canvasMirror.listPendingDeletions() ?? [];
  }

  /** Put UI-deletion notices back that were drained into a payload the model never
   * received. Nothing else re-arms a lost notice, so without this the model would
   * keep believing a deleted artefact exists for the rest of the session. */
  requeueCanvasDeletions(sessionId: string, notices: readonly PendingDeletionNotice[]): void {
    if (notices.length === 0) return;
    this.sessions.get(sessionId)?.canvasMirror.requeueDeletionNotices(notices);
  }

  /** Record a UI-initiated step selection (capability `agent-harness`, Requirement:
   * Host-Set Step Focus from the Canvas UI): move the exclusive focus in the step
   * mirror AND arm the focus notice so the next lecturer turn discloses it to the
   * agent. Dispatches nothing and appends no turn. No-op for an unknown session. */
  recordStepFocus(sessionId: string, step: number, label?: string): void {
    this.sessions.get(sessionId)?.stepMirror.recordUiFocus(step, label);
  }

  /** The pending UI focus notice, read BEFORE composing so a payload the model never
   * receives can give it back. Unknown session → null. */
  pendingStepFocus(sessionId: string): PendingFocusNotice | null {
    return this.sessions.get(sessionId)?.stepMirror.pendingFocus() ?? null;
  }

  /** Prefix the pending UI focus notice for one session to the given payload
   * (drained). One machine-readable line ahead of the text; nothing pending → text
   * unchanged. Called by the prompt handler. */
  composePromptWithStepFocus(sessionId: string, text: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return text;
    return composePayloadWithFocusNotice(s.stepMirror.drainFocusNotice(), text);
  }

  /** Put a focus notice back that was drained into a payload the model never
   * received — the mirror drops it again if the lecturer has selected another step
   * since, because that newer selection is the current truth. */
  requeueStepFocus(sessionId: string, notice: PendingFocusNotice | null): void {
    if (!notice) return;
    this.sessions.get(sessionId)?.stepMirror.requeueFocusNotice(notice);
  }

  /**
   * Record atoms a wiki ingestion landed in one COURSE (capability `agent-harness`,
   * Requirement: *Newly Ingested Wiki Atoms Are Disclosed on the Next Lecturer
   * Turn*). Course-scoped rather than session-scoped because ingestion runs in the
   * main process against the active course, not through a `cbe_*` tool in a
   * conversation; `getByCourse` resolves the one open session, and a course with no
   * open conversation simply has nothing to disclose to.
   *
   * Two effects, deliberately: it arms the notice the next lecturer turn carries,
   * AND it clears the session's delivered-index state, so the first atom read after
   * the ingestion is served from a re-read index. The second half is deterministic
   * and holds whether or not the model acts on the first. An empty list is a no-op —
   * a run in which every document failed discloses nothing and invalidates nothing.
   */
  recordWikiAtoms(courseId: string, atoms: readonly string[]): void {
    if (atoms.length === 0) return;
    this.getByCourse(courseId)?.wikiIndexGate.recordIngestedAtoms(atoms);
  }

  /** The pending wiki-atoms notice, read BEFORE composing so a payload the model
   * never receives can give it back. Unknown session → null. */
  pendingWikiAtoms(sessionId: string): PendingWikiAtomsNotice | null {
    return this.sessions.get(sessionId)?.wikiIndexGate.pendingAtoms() ?? null;
  }

  /** Prefix the pending wiki-atoms notice for one session to the given payload
   * (drained). One machine-readable line ahead of the text; nothing pending → text
   * unchanged. Called by the prompt handler. */
  composePromptWithWikiAtoms(sessionId: string, text: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return text;
    return composePayloadWithWikiAtomsNotice(s.wikiIndexGate.drainAtomsNotice(), text);
  }

  /** Put a wiki-atoms notice back that was drained into a payload the model never
   * received. Atoms landed since then are kept — the restored ids rejoin the queue
   * rather than replacing it. */
  requeueWikiAtoms(sessionId: string, notice: PendingWikiAtomsNotice | null): void {
    if (!notice) return;
    this.sessions.get(sessionId)?.wikiIndexGate.requeueAtomsNotice(notice);
  }

  /**
   * The host-derived substance / provenance / staleness state of one session's
   * reading (capability `agent-harness`, Requirement: Host-Side Design-Substance
   * and Revision Signal). Read by the hydration snapshot, by the live
   * `maturity_state` event, and by the panel's framing. Null for an unknown
   * session.
   */
  maturityState(sessionId: string): MaturityDerivedState | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return deriveMaturityState(s.maturityMirror, s.designSignal);
  }

  /**
   * Record a completed material ingestion as a settled design change (capability
   * `agent-harness`, Requirement: Host-Side Design-Substance and Revision
   * Signal). This is the one settled change the mirrors cannot observe on their
   * own: ingestion runs in the main process, not through a `cbe_*` tool. An
   * ingested document is BOTH a substance clause on its own and a categorical
   * change to the evidence base, so it makes a recorded reading stale at once.
   */
  recordIngestion(sessionId: string, filename: string): void {
    this.sessions.get(sessionId)?.designSignal.record("ingestion", { label: filename });
  }

  /** Take back ingestions recorded for a payload the model never received, so the
   * counter, the document count and the staleness enumeration match what actually
   * reached the conversation. Symmetric to `recordIngestion` and to the requeue
   * paths beside it — the lecturer's retry re-sends the same attachments and they
   * are counted exactly once. */
  unrecordIngestions(sessionId: string, count: number): void {
    if (count <= 0) return;
    this.sessions.get(sessionId)?.designSignal.unrecordIngestions(count);
  }

  /**
   * Prefix the STANDING staleness notice for one session to the given payload
   * (capability `agent-harness`, Requirement: Stale-Maturity Disclosure on the
   * Next Lecturer Turn). At most one line per lecturer turn; a current reading,
   * an empty mirror, or `unknown` provenance yields the text unchanged.
   *
   * Deliberately NOT a drain: the notice is DERIVED, so a payload Pi refuses
   * consumes nothing and needs no requeue, and the notice keeps coming until a
   * valid `cbe_maturity` call re-stamps the mirror at the current revision —
   * never because the model asserted it had re-assessed. Which reading governs
   * that decision is `governingStaleness`, the one place the rule lives — the
   * panel's derived state reads it through the same helper.
   */
  composePromptWithMaturityStaleness(sessionId: string, text: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return text;
    return composePayloadWithStalenessNotice(governingStaleness(s.maturityMirror, s.designSignal), text);
  }

  /** The lecturer-wide support preference's current snapshot when it is due for this
   * session (capability `agent-harness`, Requirement: *Separate Lecturer-Wide Support
   * Preference*): the shared service's revision moved past what this session saw, or
   * a compaction may have dropped it. Null when nothing is due or the session is
   * unknown. DERIVED — reading it consumes nothing. */
  async pendingSupport(sessionId: string): Promise<LecturerSupportDue | null> {
    const s = this.sessions.get(sessionId);
    return s ? s.supportDisclosure.pending() : null;
  }

  /** The payload carrying a support snapshot reached the model. Called only then, so a
   * prompt Pi refuses leaves the snapshot due for the lecturer's retry. */
  markSupportDelivered(sessionId: string, due: LecturerSupportDue): void {
    this.sessions.get(sessionId)?.supportDisclosure.markDelivered(due.snapshot.revision, due.generation);
  }

  /** Prefix the pending post-compaction retained-state handover for one session to
   * the given payload (drained, one-shot). Nothing pending, or nothing recorded to
   * hand over → text unchanged. Called by the prompt handler; the block is rendered
   * from the LIVE mirrors at this moment, so it states the current truth. */
  composePromptWithRetainedState(sessionId: string, text: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return text;
    return composePayloadWithRetainedState(s.retainedStateHandover.drain(), text);
  }

  /** True while a compaction handover is armed and undelivered. Read by the prompt
   * handler BEFORE composing, so a payload that never reaches the model can be
   * distinguished from one that did. */
  hasPendingRetainedState(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.retainedStateHandover.isPending() ?? false;
  }

  /** Re-arm a handover that was drained into a payload the model never received.
   * The drain is one-shot by design, so without this the block would be consumed
   * by a prompt Pi refused and the lecturer's retry would carry nothing. Idempotent
   * — re-arming an already pending handover still yields exactly one block. */
  rearmRetainedState(sessionId: string): void {
    this.sessions.get(sessionId)?.retainedStateHandover.markCompacted();
  }

  /** Slash commands for the renderer autocomplete (unfiltered; the IPC layer
   * applies the UI allowlist). Empty list for an unknown session. */
  getCommands(id: string): CbeSlashCommand[] {
    return this.sessions.get(id)?.session.getCommands() ?? [];
  }

  get(id: string): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  /** The open session of one course, if any. Load-bearing for boot-hydration's
   * re-attach branch (capability `desktop-app`, Requirement: Renderer
   * Boot-Hydration from the Main Process) — the invariant "at most one open
   * session per course" is enforced by `conversationOpen`'s single-flight. */
  getByCourse(courseId: string): ActiveSession | undefined {
    if (!courseId) return undefined;
    for (const s of this.sessions.values()) {
      if (s.courseId === courseId) return s;
    }
    return undefined;
  }

  private metaOf(s: ActiveSession): Omit<SessionMeta, "closedAt"> {
    return {
      sessionId: s.id,
      modelId: s.modelId,
      skillVersion: s.skillVersion,
      environmentProfile: s.env.profile,
      createdAt: s.createdAt,
    };
  }

  /**
   * Turn-boundary snapshot: completed turns ONLY — a pending partial draft is
   * NOT flushed (capability `agent-harness`, Requirement: Sessions as Local
   * Markdown/JSON Files, "Turn boundaries persist completed turns only"). Used
   * by the per-turn flush; `dump()` remains the closing flush.
   */
  snapshot(id: string): SessionFlushSnapshot | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      meta: this.metaOf(s),
      turns: [...s.transcript],
      sessionsDir: s.sessionsDir,
      ...(s.didacticChecks ? { didacticChecks: s.didacticChecks } : {}),
      ...designStateOf(s),
    };
  }

  dump(id: string): SessionFlushSnapshot | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    // Closing flush: a pending streaming draft IS persisted as a final assistant
    // turn so nothing the lecturer saw is lost on quit (spec: "the closing flush
    // additionally persists any partially streamed assistant text").
    //
    // It carries the stopped marker when the run it belongs to was stopped by
    // the lecturer (capability `agent-harness`, Requirement: *A Lecturer Can
    // Stop a Running Turn*). This is the promotion that happens while the prompt
    // is still PENDING — the timed-out stop's force-close, and a quit over a run
    // the runtime never released — so without the marker those paths would
    // archive a stopped half-answer as a complete turn in both sidecars.
    //
    // It passes NO stopped placeholder (design decision D5b): this flush appended
    // no turn at all for a stop that streamed nothing, and it keeps appending
    // none. A cards-only turn is seed-neutral for the same reason the placeholder
    // is not — `seedableTurns` drops an assistant turn whose text is empty.
    const promoted = promotedAssistantTurn(s.draft, s.turnStop.stoppedForCurrentRun(), s.cardRecorder.take(), {
      stoppedNote: chrome().exportStoppedTurnNote,
    });
    if (promoted) {
      s.transcript.push(promoted);
      s.draft = "";
    }
    return {
      meta: this.metaOf(s),
      turns: [...s.transcript],
      // Sidecars go to the folder of the course the session was STARTED in —
      // a later active-course switch must not re-home a running session.
      sessionsDir: s.sessionsDir,
      ...(s.didacticChecks ? { didacticChecks: s.didacticChecks } : {}),
      ...designStateOf(s),
    };
  }

  listIds(): string[] {
    return [...this.sessions.keys()];
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.session.dispose();
    this.sessions.delete(id);
  }

  closeAll(): void {
    for (const [id, s] of this.sessions) {
      s.session.dispose();
      this.sessions.delete(id);
    }
  }
}
