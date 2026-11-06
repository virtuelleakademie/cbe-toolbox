import { BrowserWindow, ipcMain, safeStorage, app, dialog, shell } from "electron";
import {
  Channels,
  type InterfaceLanguageSetResult,
  type OnboardingReadResult,
  type OnboardingAcknowledgeResult,
  type OnboardingStateEvent,
  EmptyApiKeyError,
  EndpointChangedKeyRequiredError,
  type PromptPayload,
  type PromptAbortPayload,
  type PromptAbortResult,
  type ConversationFreshPayload,
  type ConversationListEntry,
  type ConversationListPayload,
  type ConversationListResult,
  type ConversationResumePayload,
  type ProviderConfigDto,
  type ProviderStatus,
  type ConfigSetResult,
  type AgentEvent,
  type CitationDetail,
  type CitationVerification,
  type CitationVerifyRequest,
  type StartSessionResult,
  type ConversationOpenResult,
  type SlashCommand,
  type IngestOutcome,
  type LecturerProfileOverridePayload,
  type LecturerProfileOverrideResult,
  type LecturerProfile,
  type LecturerIdentity,
  type LecturerIdentitySetPayload,
  type LecturerIdentitySetResult,
  type CourseSummary,
  type CourseDeleteResult,
  type CourseListResult,
  type CourseRevealTarget,
  type WikiIngestProgressEvent,
  type WikiIngestResult,
  type WikiIngestStartPayload,
  type WikiListResult,
  type WikiAtomSummary,
  type CanvasDeletePayload,
  type StepFocusPayload,
  type ConfigEraseResult,
  type ConnectionTestResult,
  type NativeMenuAvailability,
  WIKI_CITATION_PREFIX,
} from "../shared/ipc-contract.js";
import { isProfileDimension, CONFIDENCE_LEVELS } from "@cbe/pi-bridge/lecturer-profile";
import { resolveCanvasAddress } from "@cbe/pi-bridge/canvas-addressing";
import { filterUiCommands } from "../shared/slash-commands.js";
import type { AboutInfo, ReasoningEffort } from "../shared/ipc-contract.js";
import { ingestPaths, SUPPORTED_EXTENSIONS } from "./ingestion.js";
import { seedDefaultConnectionConfig, type SeedOutcome } from "./default-connection.js";
import {
  AgentManager,
  COURSES_ROOT,
  WORKSPACE_STATE_PATH,
  resolveResource,
  lecturerProfileService,
  lecturerIdentityService,
  currentCorpusDir,
  resetCorpusCaches,
  CORPUS_UPDATER_PATHS,
  SKILL_UPDATER_PATHS,
  currentSkillMdPath,
  type CourseSessionContext,
  type CompactionWiring,
} from "./agent.js";
import { corpusInfo, refreshSignedCorpus } from "./corpus-updater.js";
import { refreshSignedSkill, skillInfo, skillUpdateStatus } from "./skill-updater.js";
import { readSkillIdentity } from "./skill-meta.js";
import { citationMarkdownBody } from "./citation-body.js";
import { loadWikiCitationDetail } from "./wiki-citation-detail.js";
import {
  createCourse,
  courseMdPath,
  deleteCourse,
  courseSessionsDir,
  courseWikiDir,
  ensureActiveCourse,
  readActiveCourseId,
  readCourse,
  readCourseContext,
  readLecturerStateLayers,
  renameCourse,
  scanCourses,
  writeActiveCourseId,
} from "./courses.js";
import {
  composePromptWithProfileNotes,
  profileEstimateRejectedNote,
  profileOverrideNote,
} from "./lecturer-profile-store.js";
import { lecturerIdentityChangeNote } from "./lecturer-identity-store.js";
import { probeConnection, probeReasoningSupport } from "./model-metadata.js";
import { composePromptWithUiReference } from "./ui-reference-prompt.js";
import { applyLoopVerdict } from "./tool-loop-remediation.js";
import { completionEndSignalOf, CutOffSettlement } from "./truncation-remediation.js";
import { AssistantTextBoundary } from "./assistant-text-boundary.js";
import { promotedAssistantTurn } from "../shared/turn-stop.js";
import {
  writeSessionMd,
  writeSessionJson,
  resolveCanonicalConversation,
  listStoredSessions,
  readSessionJson,
  type SessionJson,
} from "./sessions.js";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import {
  applyTruncationVerdict,
  createCitationResolver,
  verifyCitation,
  createPiAtomizationSessionFactory,
  normalizePickerParams,
  type PickerToolParams,
  readWikiSkillVersion,
  runAtomization,
  ToolLoopDetector,
  TruncationDetector,
  type CanvasMirror,
  type CitationResolver,
  type MaturityMirror,
  type ProviderConfig,
  type StepMirror,
  buildDesignDocument,
  designDocumentFilename,
  type StepCoverageEntry,
  type MaturitySnapshot,
  occupancyChanged,
  isAbortOriginatedStreamError,
} from "@cbe/pi-bridge";
import { composePayloadWithSupportNotice } from "@cbe/pi-bridge/lecturer-support";
import type { DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import { validateDirectory, type WikiAtom } from "@cbe/corpus-schema";
import { extractorId, ingestIntoCourse, setRawStatus, writeReflectionLog } from "./wiki-store.js";

/**
 * The renderer draws the Picker from the `tool_execution_start` args, so this
 * forwarding boundary is where the picker spec is normalised: a free-text
 * ("other") option the model shipped in `options[]` is collapsed into
 * `otherLabel`, leaving exactly ONE free-text surface in the lecturer's own
 * language (capability `desktop-app`, Requirement: Collected UX-3 Fixes
 * (Wave 1)). Every other tool's args pass through untouched.
 */
export function pickerArgsForRenderer(toolName: string, args: unknown): unknown {
  if (toolName !== "cbe_picker" || args == null || typeof args !== "object") return args;
  const spec = args as Partial<PickerToolParams>;
  if (!Array.isArray(spec.options) || typeof spec.question !== "string") return args;
  try {
    return normalizePickerParams(spec as PickerToolParams);
  } catch {
    // Never let normalisation break the emission — a malformed payload keeps
    // flowing to the renderer's own structural sanity check.
    return args;
  }
}

let resolverCache: Promise<CitationResolver> | null = null;
function getResolver(): Promise<CitationResolver> {
  if (!resolverCache) {
    // Through the bundle updater: a verified downloaded corpus takes precedence
    // over the copy shipped with the app (capability `distribution`).
    resolverCache = createCitationResolver(currentCorpusDir());
  }
  return resolverCache;
}

function appBuildTime(): Date {
  try {
    return statSync(process.execPath).mtime;
  } catch {
    return new Date(0);
  }
}

async function runCorpusRefresh() {
  const result = await refreshSignedCorpus({
    paths: CORPUS_UPDATER_PATHS,
    installedAppVersion: app.getVersion(),
    appBuildTime: appBuildTime(),
  });
  if (result.status === "updated") {
    // New sessions and citation lookups must see the new tree immediately —
    // no app restart required (distribution spec, bundle requirement).
    resolverCache = null;
    resetCorpusCaches();
  }
  return result;
}

/** Startup check (fire-and-forget from index.ts): pointer-first, cheap when up
 * to date (Scenario: App fetches a new corpus version on startup); every
 * failure mode is a value and stays silent at startup. */
export async function corpusStartupRefresh(): Promise<void> {
  try {
    await runCorpusRefresh();
  } catch {
    console.error("corpus startup refresh failed with a redacted internal error");
  }
}

/** Startup check for the skill channel (distribution spec, Requirement: Skill
 * Distribution as Versioned Bundle) — same fire-and-forget semantics as the
 * corpus one. An `updated` result needs no cache reset: skill resolution goes
 * through `currentSkillDir()` per session start, so the NEXT session picks up
 * the adopted state and the About group's version reading follows it — a
 * running session is never retro-fitted. Offline, the last adopted state
 * simply keeps working (Scenario: Offline, the last known skill state keeps
 * working). A rejected bundle is logged — the About group keeps showing the
 * unchanged active version, which is the auditable surface. */
export async function skillStartupRefresh(): Promise<void> {
  try {
    const result = await refreshSignedSkill({
      paths: SKILL_UPDATER_PATHS,
      installedAppVersion: app.getVersion(),
      appBuildTime: appBuildTime(),
    });
    if (result.status === "refused" || result.status === "unavailable") {
      console.error(`skill update ${result.status}: ${result.code}`);
    }
  } catch {
    console.error("skill startup refresh failed with a redacted internal error");
  }
}

import {
  FileInterfaceLanguageStore,
  activeInterfaceLanguage,
  chrome,
  resolveInterfaceLanguage,
  setActiveInterfaceLanguage,
} from "./interface-language.js";
import { REFERENCE_LANGUAGE, isInterfaceLanguage } from "../shared/i18n/index.js";
import { designDocumentLabels } from "./design-document-labels.js";
import { FileOnboardingStore } from "./onboarding-store.js";
import { registerPioneerSiteIpc } from "./pioneer-site.js";

const agentManager = new AgentManager();
const CONFIG_PATH = path.join(app.getPath("userData"), "cbe-config.json");
/** The interface language's own record, BESIDE the provider config rather than
 * inside it: it is a lecturer preference, not a connection setting, and merging
 * the two would make an appearance change rewrite the credential record
 * (capability `desktop-app`, Requirement: *Every String the App Renders Is
 * English* — "The setting"). */
const INTERFACE_LANGUAGE_PATH = path.join(app.getPath("userData"), "interface-language.json");
const interfaceLanguageStore = new FileInterfaceLanguageStore(INTERFACE_LANGUAGE_PATH);
/** Dedicated first-use marker beside, never inside, provider/course/profile
 * records (Requirement: First-Use Orientation Acknowledgment and Persistence). */
const ONBOARDING_PATH = path.join(app.getPath("userData"), "onboarding.json");
const onboardingStore = new FileOnboardingStore(ONBOARDING_PATH);

/**
 * Resolve the interface language once, BEFORE the window opens (called from
 * `index.ts`): the preload reads it synchronously while the window loads, so a
 * later resolution would paint the first frame in the wrong language. A stored
 * choice outranks the operating-system locale; anything with no shipped
 * catalogue renders the reference language and the stored value is left alone.
 */
export async function initInterfaceLanguage(): Promise<string> {
  try {
    const stored = await interfaceLanguageStore.load();
    return setActiveInterfaceLanguage(resolveInterfaceLanguage(stored, app.getLocale()));
  } catch {
    // Language resolution MUST NEVER be able to fail the app's start.
    return setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
  }
}

/** First-run seed of the provider record from the build-time default key
 * (capability `desktop-app`, Requirement: Build-Time Default Connection
 * Configuration). Called from index.ts BEFORE the window opens so the
 * renderer's configured-state check already sees the seeded record. Writes only
 * when no `cbe-config.json` exists; the bundled file resolves to the repo root
 * in dev, where it does not exist, so dev stays unconfigured. Never throws and
 * never logs the key. */
export async function seedDefaultConnection(): Promise<SeedOutcome> {
  try {
    return await seedDefaultConnectionConfig({
      configPath: CONFIG_PATH,
      defaultsPath: resolveResource(path.join("defaults", "default-llm.json")),
      encryptKey: (apiKey) =>
        safeStorage.isEncryptionAvailable()
          ? { apiKeyCipher: safeStorage.encryptString(apiKey).toString("base64") }
          : { apiKeyPlain: apiKey },
    });
  } catch (err) {
    console.error("[cbe:config] default connection seed failed, app starts unconfigured:", err);
    return "no-defaults";
  }
}

/** Main-side refusal for close/fresh while a turn is in flight (capability
 * `course-workspace`, Scenario: Fresh conversation is refused while a turn is
 * running). UI-disable is not authorization — the IPC layer enforces it too. */
export function turnInFlightNotice(): string {
  return chrome().mainTurnInFlightNotice;
}

/** Main-side refusal for a resume whose target pair is missing or unreadable
 * (capability `course-workspace`, Scenario: An unknown or unreadable conversation
 * id fails safely). Raised BEFORE anything is closed — the current conversation
 * stays open and untouched. */
export function resumeUnavailableNotice(): string {
  return chrome().mainResumeUnavailableNotice;
}

/** Main-side refusal for a resume OR a New Session fresh start arriving while
 * another conversation resolution for the same course is still resolving.
 * Unlike `conversationOpen`, neither is idempotent, so a concurrent resolution
 * is refused rather than raced or coalesced (capability `course-workspace`,
 * Requirement: Stored Conversations Are Resumable — "a second conversation
 * resolution … MUST be refused"). The guard is `conversationOpeningFor` — the
 * SAME question the course-deletion guard asks — because `conversationInflight`
 * alone misses the tail of the New Session reset: `startFreshConversation`
 * registers in `pendingSessionStarts` with the outgoing session already closed,
 * and a resume racing it would leave the course with TWO live sessions. The
 * fresh handler carries the mirror-image guard AND registers its own resolution
 * in `conversationInflight` synchronously behind that check, so the window
 * before `pendingSessionStarts` becomes visible (the closing flush, the config
 * and course reads) refuses a resume too; a resume in turn holds
 * `conversationInflight` for its whole resolution, refusing a fresh start. */
export function resumeWhileOpeningNotice(): string {
  return chrome().mainResumeWhileOpeningNotice;
}

/** Main-side busy refusal for `cbe:prompt` (Requirement: Canvas Dialogue-Steering
 * Dispatches Respect the Run Lock). Thrown BEFORE the transcript push so a busy
 * race leaves no phantom user turn in the persisted transcript. Carries the
 * classifiable "already processing" phrase without naming runtime API concepts. */
export function promptBusyNotice(): string {
  return chrome().mainPromptBusyNotice;
}

// Pending canvas carry-over per course (capability `agent-harness`, Requirement:
// Session-Start Canvas Artefact Injection): the snapshot is taken from the
// OUTGOING session's host-side mirror BEFORE the close. If the fresh start then
// fails, the outgoing session is already gone — this map keeps the snapshot so a
// retry re-attempts the start with the SAME carried-over artefacts. Cleared on
// success.
const pendingCanvasCarryOver = new Map<string, ReturnType<CanvasMirror["list"]>>();

// Pending decision-artefact carry-over per course (capability `desktop-app`,
// Requirement: Decision Artefacts Are Per-Conversation State): New Session is a
// CONTEXT reset, not a data reset — the decision artefacts are carried onto the
// fresh session exactly like the canvas artefacts above. Same retry semantics:
// snapshotted before the close, kept here so a retry after a failed fresh start
// carries the SAME value, cleared on success.
const pendingDidacticCarryOver = new Map<string, DidacticChecks>();
/** Step coverage + maturity reading carried across a New Session reset, kept per
 * course so a retry after a failed fresh start carries the SAME values (capability
 * `desktop-app`, Requirement: New Session Control With Canvas Carry-Over). */
/** Readable reason for an export with nothing to export yet. */
export function exportEmptyNotice(): string {
  return chrome().mainExportEmptyNotice;
}

/** Atomic write for the export: a failed write must leave any existing file untouched
 * and must not leave a partial file behind. */
async function writeFileAtomicExport(target: string, content: string): Promise<void> {
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, target);
}

const pendingRetainedCarryOver = new Map<string, { stepCoverage: StepCoverageEntry[]; maturity: MaturitySnapshot }>();

// Per-course in-flight conversationOpen promise (capability `desktop-app`,
// Requirement: Renderer Boot-Hydration from the Main Process, single-flight).
// Concurrent calls (double-mounted boot effect in React StrictMode, boot racing a
// course switch) coalesce onto ONE resolution — otherwise two racing calls would
// both take the resume/create branch and re-mint the orphaned-session event bleed
// this model exists to kill. Also inherits the original start-session guard's
// job: the first session start may take ~2 min (pi lazy-installs its npm
// sidecar); two concurrent installs shred each other's files (ENOTEMPTY).
const conversationInflight = new Map<string, Promise<ConversationOpenResult>>();

// Per-course session starts currently running, counted (an open's fresh branch
// and a New Session reset can overlap, and the LAST one to finish releases the
// course). Registered at the one point every fresh start funnels through —
// `startFreshConversation` — because the New Session path reaches it WITHOUT a
// `conversationInflight` entry and with the outgoing session already closed, so
// for the length of that start (up to ~2 min on an app run's first start) the
// course would otherwise look completely idle.
const pendingSessionStarts = new Map<string, number>();

/** Is a conversation being opened or started for this course? The two entry
 * paths — the single-flighted `conversationOpen`, and a fresh start from the
 * New Session reset — are the same question for anyone asking whether the
 * course's folder is about to be written into. */
function conversationOpeningFor(courseId: string): boolean {
  return conversationInflight.has(courseId) || pendingSessionStarts.has(courseId);
}

// Global first-start gate (capability `desktop-app`, Requirement: Renderer
// Boot-Hydration from the Main Process, "Global first-start gate"): the FIRST
// `agentManager.start` of an app run may lazily install the agent runtime (pi's
// npm sidecar, ~2 min). The per-course single-flight above cannot stop two
// DIFFERENT courses from starting concurrently, and two concurrent installs
// shred each other's files (ENOTEMPTY on rmdir). Session starts are therefore
// serialised through one promise chain until a first start has COMPLETED once;
// after that, per-course starts run concurrently as before.
let firstStartComplete = false;
let firstStartChain: Promise<void> = Promise.resolve();

function gatedSessionStart<T>(start: () => Promise<T>): Promise<T> {
  if (firstStartComplete) return start();
  const run = firstStartChain.then(async () => {
    const result = await start();
    firstStartComplete = true;
    return result;
  });
  // The chain never rejects: a failed first start must not poison later ones —
  // the next queued start simply becomes the new "first" attempt.
  firstStartChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Per-session flush chain (capability `agent-harness`, Requirement: Sessions as
// Local Markdown/JSON Files, "Write discipline"): all sidecar writes for one
// sessionId are serialised so a turn-boundary flush can never interleave with
// close / fresh-conversation / teardown writes to the same pair.
const flushChains = new Map<string, Promise<void>>();

/**
 * Dual-write both sidecars for one session, serialised per session and atomic
 * per file (see sessions.ts). `closing: false` (turn boundary) snapshots
 * completed turns only; `closing: true` uses `dump()`, which additionally
 * flushes a partially streamed draft as the final assistant turn. Failures are
 * logged and non-fatal — the next boundary rewrites the full state.
 */
function flushSession(sessionId: string, opts: { closing: boolean }): Promise<string | undefined> {
  const prev = flushChains.get(sessionId) ?? Promise.resolve();
  const run = prev.then(async (): Promise<string | undefined> => {
    const dumped = opts.closing ? agentManager.dump(sessionId) : agentManager.snapshot(sessionId);
    if (!dumped) return undefined;
    const meta = { ...dumped.meta, closedAt: new Date().toISOString() };
    const mdPath = await writeSessionMd(dumped.sessionsDir, meta, dumped.turns);
    // Write the session's decision artefacts BACK. Omitting them here used to
    // destroy previously persisted state: `writeSessionJson` replaces the file
    // atomically, so a flush without the field silently dropped it at the first
    // turn boundary after a resume (Requirement: Decision Artefacts Are
    // Per-Conversation State — "survives a restart in its own course").
    // All four states go back on EVERY flush — the write replaces the file
    // atomically, so an omitted field is a deletion (capability `agent-harness`,
    // Requirement: Course Design-State Store).
    await writeSessionJson(dumped.sessionsDir, meta, dumped.turns, dumped.didacticChecks, {
      canvas: dumped.canvas,
      steps: dumped.steps,
      maturity: dumped.maturity,
    });
    return mdPath;
  });
  // The chain never rejects (a failed flush must not poison later flushes).
  flushChains.set(
    sessionId,
    run.then(
      () => undefined,
      (err) => {
        console.error(`[cbe:flush] sidecar flush failed for session ${sessionId}:`, err);
      }
    )
  );
  return run;
}

/**
 * Populate a freshly started session's host mirrors from the course's own sidecar
 * (capability `agent-harness`, Requirement: Course Design-State Store).
 *
 * Materialises nothing: a missing field leaves its mirror empty, a criterion
 * stored as "unassessed" stays unassessed, a step stored at `open` stays `open`.
 *
 * The record was already sanitised on read (`sanitizeDesignState` in sessions.ts):
 * a malformed entry never reaches here, and a wholly unreadable field arrives as
 * absent, so the course presents that state as empty rather than as a half-parsed
 * fragment. The guards below are the second line for that contract, not the first.
 */
function restoreCourseDesignState(
  active: { canvasMirror: CanvasMirror; stepMirror: StepMirror; maturityMirror: MaturityMirror },
  json: SessionJson
): void {
  try {
    if (Array.isArray(json.canvas)) active.canvasMirror.restore(json.canvas);
  } catch (err) {
    console.error("[cbe:design-state] canvas restore failed, course opens without it:", err);
  }
  try {
    if (Array.isArray(json.steps)) active.stepMirror.restore(json.steps);
  } catch (err) {
    console.error("[cbe:design-state] step restore failed, course opens without it:", err);
  }
  try {
    if (json.maturity && typeof json.maturity === "object") active.maturityMirror.seed(json.maturity);
  } catch (err) {
    console.error("[cbe:design-state] maturity restore failed, course opens without it:", err);
  }
}

interface PersistedConfig {
  baseURL: string;
  modelId: string;
  apiKeyCipher?: string; // base64 of safeStorage.encryptString result
  apiKeyPlain?: string; // fallback if safeStorage is unavailable
  contextLength?: number; // real context window of the model, in tokens
  reasoning?: boolean; // send reasoning_effort for this model
  reasoningEffort?: ReasoningEffort; // effort level when reasoning is enabled
}

async function loadConfig(): Promise<{
  baseURL: string;
  modelId: string;
  apiKey: string;
  contextLength?: number;
  reasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
} | null> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as PersistedConfig;
    let apiKey: string;
    if (raw.apiKeyCipher && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyCipher, "base64"));
    } else if (raw.apiKeyPlain) {
      apiKey = raw.apiKeyPlain;
    } else {
      return null;
    }
    return {
      baseURL: raw.baseURL,
      modelId: raw.modelId,
      apiKey,
      contextLength: raw.contextLength,
      reasoning: raw.reasoning,
      reasoningEffort: raw.reasoningEffort,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the on-disk record WITHOUT decrypting. Used by `saveConfig`'s
 * preserve-existing-key branch: when the caller omits `apiKey`, we read the
 * existing `apiKeyCipher` / `apiKeyPlain` field and reuse it verbatim — no
 * Keychain round-trip, no chance of a decrypt-then-re-encrypt rewriting the
 * cipher with a different IV.
 */
async function loadRawConfig(): Promise<PersistedConfig | null> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as PersistedConfig;
  } catch {
    return null;
  }
}

// Strips whitespace and a single matched pair of surrounding quotes (", ', `).
// Defends against copy-paste of values that include the source quotes (a real
// cause of 400-class provider errors — see desktop-app spec, Provider Configuration Input Hygiene).
function sanitiseField(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      v = v.slice(1, -1).trim();
    }
  }
  return v;
}

async function saveConfig(cfg: ProviderConfigDto): Promise<void> {
  const baseURL = sanitiseField(cfg.baseURL);
  const modelId = sanitiseField(cfg.modelId);
  // Single read of the on-disk record — reused for both the apiKey-preserve and
  // contextLength-preserve branches so a partial update keeps untouched fields.
  const existing = await loadRawConfig();

  // Endpoint identity = the sanitised baseURL (exact compare). A save that
  // CHANGES the baseURL relative to the persisted record must NOT let
  // endpoint-calibrated state silently follow the lecturer to the new host:
  // the API key must be re-entered (refused below before any I/O or probe), and
  // reasoning / contextLength are reset rather than preserved (handled in their
  // respective branches). Same-endpoint partial updates keep today's
  // omit-to-preserve behaviour byte-for-byte. First-ever save (no `existing`) is
  // not an endpoint *change*. See desktop-app spec, Requirement: Provider
  // Configuration Input Hygiene / Provider Reasoning Configuration / Provider
  // Context Window Configuration.
  const endpointChanged = existing != null && existing.baseURL !== baseURL;

  // A changed baseURL with an omitted key is refused with a typed error BEFORE
  // any persistence or probe call — the stored key is never sent to the new host.
  if (endpointChanged && cfg.apiKey === undefined) {
    throw new EndpointChangedKeyRequiredError();
  }

  // Three states (see DTO docs in ipc-contract.ts):
  //   - cfg.apiKey === undefined → preserve existing cipher/plain field
  //   - cfg.apiKey === ""        → discipline violation, throw before I/O
  //   - cfg.apiKey: non-empty    → encrypt and overwrite
  let apiKeyField: Pick<PersistedConfig, "apiKeyCipher" | "apiKeyPlain">;
  if (cfg.apiKey === undefined) {
    if (existing?.apiKeyCipher) {
      apiKeyField = { apiKeyCipher: existing.apiKeyCipher };
    } else if (existing?.apiKeyPlain) {
      apiKeyField = { apiKeyPlain: existing.apiKeyPlain };
    } else {
      throw new Error("No existing apiKey to preserve; provide one in the DTO");
    }
  } else {
    const apiKey = sanitiseField(cfg.apiKey);
    if (apiKey === "") throw new EmptyApiKeyError();
    apiKeyField = safeStorage.isEncryptionAvailable()
      ? { apiKeyCipher: safeStorage.encryptString(apiKey).toString("base64") }
      : { apiKeyPlain: apiKey };
  }

  // contextLength: undefined in the DTO → preserve existing ONLY on a
  // same-endpoint save; a baseURL change clears it so the new endpoint starts on
  // the high-default path instead of inheriting a window calibrated for a
  // different model. A positive number → persist; anything else (0 / NaN /
  // negative) → drop so the provider falls back to its high default rather than a
  // nonsensical tiny window.
  const contextLength =
    cfg.contextLength === undefined
      ? endpointChanged
        ? undefined
        : existing?.contextLength
      : Number.isFinite(cfg.contextLength) && cfg.contextLength > 0
        ? cfg.contextLength
        : undefined;

  // reasoning / reasoningEffort follow the same omit-to-preserve contract as
  // apiKey / contextLength: undefined in the DTO preserves the persisted value.
  // An EXPLICIT lecturer choice (true/false) always wins. Only when the lecturer
  // has NOT set the control AND no value is persisted do we attempt the
  // best-effort metadata default (capability `desktop-app`, Requirement: Provider
  // Reasoning Configuration). NEVER name-based.
  // A baseURL change CLEARS the persisted reasoning state before this cascade: a
  // reasoning setting calibrated for one endpoint (e.g. OpenRouter, where gpt-oss
  // accepts reasoning_effort) MUST NOT silently follow the lecturer to a different
  // endpoint (e.g. a strict LiteLLM proxy that 400s on the unknown parameter). On
  // an endpoint change the preserve branch is skipped and the probe re-runs
  // against the NEW endpoint with the just-entered key.
  let reasoning: boolean | undefined;
  let reasoningEffort: ReasoningEffort | undefined;
  if (cfg.reasoning !== undefined) {
    // Explicit choice from the lecturer.
    reasoning = cfg.reasoning;
    reasoningEffort = cfg.reasoningEffort ?? (endpointChanged ? undefined : existing?.reasoningEffort);
  } else if (!endpointChanged && existing?.reasoning !== undefined) {
    // Preserve the persisted value (same-endpoint partial update, control untouched).
    reasoning = existing.reasoning;
    reasoningEffort = cfg.reasoningEffort ?? existing.reasoningEffort;
  } else {
    // No explicit choice and nothing persisted (or the persisted value was just
    // cleared by an endpoint change) → best-effort capability default. The probe
    // reuses the just-resolved key against the NEW baseURL; failure/timeout is
    // non-fatal and falls back to the conservative default (OFF) + the runtime
    // safety net.
    const apiKeyForProbe = await resolveApiKeyForProbe(apiKeyField, cfg);
    const supports = apiKeyForProbe ? await probeReasoningSupport(baseURL, modelId, apiKeyForProbe) : false;
    if (supports) {
      reasoning = true;
      reasoningEffort = "medium";
    } else {
      reasoning = undefined; // conservative default: OFF (field omitted)
      reasoningEffort = cfg.reasoningEffort ?? (endpointChanged ? undefined : existing?.reasoningEffort);
    }
  }

  const payload: PersistedConfig = { baseURL, modelId, ...apiKeyField };
  if (contextLength !== undefined) payload.contextLength = contextLength;
  if (reasoning !== undefined) payload.reasoning = reasoning;
  if (reasoningEffort !== undefined && reasoning) payload.reasoningEffort = reasoningEffort;
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Resolves the plaintext API key to use for the best-effort `/models` capability
 * probe. Prefers the freshly-entered DTO key; otherwise decrypts/reads the
 * just-resolved persisted field. Returns undefined if no key is available — the
 * probe is then skipped (non-fatal). NEVER throws.
 */
async function resolveApiKeyForProbe(
  apiKeyField: Pick<PersistedConfig, "apiKeyCipher" | "apiKeyPlain">,
  cfg: ProviderConfigDto
): Promise<string | undefined> {
  try {
    if (cfg.apiKey !== undefined) {
      const k = sanitiseField(cfg.apiKey);
      return k === "" ? undefined : k;
    }
    if (apiKeyField.apiKeyCipher && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(apiKeyField.apiKeyCipher, "base64"));
    }
    if (apiKeyField.apiKeyPlain) return apiKeyField.apiKeyPlain;
  } catch {
    // Non-fatal: a decrypt failure just skips the probe.
  }
  return undefined;
}

/**
 * Resolve the active course, enforcing the exactly-one-active-course invariant
 * (capability `course-workspace`, Requirement: Active Course and Course
 * Switching): falls back / auto-creates via `ensureActiveCourse` and persists
 * the pointer whenever it changed.
 */
async function resolveActiveCourse(): Promise<CourseSummary> {
  const persisted = await readActiveCourseId(WORKSPACE_STATE_PATH);
  const active = await ensureActiveCourse(COURSES_ROOT, persisted);
  if (active.id !== persisted) {
    await writeActiveCourseId(WORKSPACE_STATE_PATH, active.id);
  }
  return active;
}

export interface RegisterIpcHostActions {
  updateNativeMenuAvailability?: (win: BrowserWindow, availability: unknown) => boolean;
  refreshNativeMenu?: () => void;
}

export function registerIpc(win: BrowserWindow, hostActions: RegisterIpcHostActions = {}): void {
  const sendOnboardingState = (event: OnboardingStateEvent) => {
    // Short-circuit: reading `win.webContents` on a destroyed window throws, and
    // this runs from a deferred `then` that can settle after the window is gone.
    if (typeof win.isDestroyed === "function" && win.isDestroyed()) return;
    const contents = win.webContents;
    if (!contents) return;
    if (typeof contents.isDestroyed === "function" && contents.isDestroyed()) return;
    contents.send(Channels.onboardingChanged, event);
  };
  // The persistence failure is reported ONCE per main-process lifetime. Without
  // this the notice the lecturer closed would return on every accepted dispatch
  // (Requirement: *First-Use Orientation Acknowledgment and Persistence* —
  // Scenario: Failed persistence cannot trap or repeatedly interrupt the
  // lecturer).
  let failureAnnounced = false;
  /** Start the idempotent marker write without putting disk latency in front of
   * a prompt. Memory is raised synchronously by the store; renderer dismissal is
   * broadcast immediately, and the settled event carries the truthful notice. */
  const acknowledgeOnboarding = (options?: { retryPersistence?: boolean }): Promise<OnboardingAcknowledgeResult> => {
    const result = onboardingStore.acknowledge(options);
    sendOnboardingState({ acknowledged: true, persistence: "saving" });
    void result.then((outcome) => {
      if (outcome.persisted) {
        failureAnnounced = false;
        sendOnboardingState({ acknowledged: true, persistence: "saved" });
        return;
      }
      if (failureAnnounced) return;
      failureAnnounced = true;
      sendOnboardingState({ acknowledged: true, persistence: "failed" });
    });
    return result;
  };

  // The synchronous read the preload performs while the window loads. `ipcMain.on`
  // with `returnValue`, deliberately: an `invoke` here would be a promise the
  // preload cannot await before it exposes the bridge.
  ipcMain.on(Channels.interfaceLanguageGetSync, (e) => {
    e.returnValue = activeInterfaceLanguage();
  });

  ipcMain.handle(Channels.interfaceLanguageSet, async (_e, language: string): Promise<InterfaceLanguageSetResult> => {
    // A code with no shipped catalogue is REFUSED rather than coerced: coercing
    // and then persisting would rewrite the lecturer's stored choice, which the
    // unshipped-catalogue scenario forbids.
    if (!isInterfaceLanguage(language)) return { ok: false, language: activeInterfaceLanguage() };
    const applied = setActiveInterfaceLanguage(language);
    await interfaceLanguageStore.save(applied);
    // Broadcast, not a return value: every rendered surface switches at once,
    // and the renderer never decides which language is active.
    win.webContents.send(Channels.interfaceLanguageChanged, applied);
    // Labels are app chrome too. Replace the one active native menu atomically
    // from the same catalogue now in force.
    hostActions.refreshNativeMenu?.();
    return { ok: true, language: applied };
  });

  ipcMain.handle(Channels.nativeMenuAvailability, async (event, availability: NativeMenuAvailability) => {
    // A window can report only its own state; another webContents cannot arm a
    // custom item for the owned application window.
    if (event.sender !== win.webContents || !hostActions.updateNativeMenuAvailability?.(win, availability)) {
      throw new Error("Native menu availability was refused");
    }
    return { ok: true as const };
  });

  registerPioneerSiteIpc(win);

  ipcMain.handle(Channels.onboardingRead, async (): Promise<OnboardingReadResult> => onboardingStore.read());
  ipcMain.handle(
    Channels.onboardingAcknowledge,
    // The explicit route — Begin, Skip and the About overview's Close. It is the
    // only one the spec lets retry a failed write; the implicit accepted-dispatch
    // route below never does.
    async (): Promise<OnboardingAcknowledgeResult> => acknowledgeOnboarding({ retryPersistence: true })
  );

  ipcMain.handle(Channels.configGet, async (): Promise<ProviderStatus | null> => {
    const cfg = await loadConfig();
    return cfg
      ? {
          baseURL: cfg.baseURL,
          modelId: cfg.modelId,
          hasKey: !!cfg.apiKey,
          contextLength: cfg.contextLength,
          reasoning: cfg.reasoning,
          reasoningEffort: cfg.reasoningEffort,
        }
      : null;
  });

  ipcMain.handle(Channels.configSet, async (_e, cfg: ProviderConfigDto): Promise<ConfigSetResult> => {
    await saveConfig(cfg);
    // Apply the PERSISTED provider (sanitised, preserved-key, resolved contextLength —
    // NOT the raw DTO) to every running session so the active chat continues against
    // the new model with its transcript intact (capability `desktop-app`, Requirement:
    // Live Provider Swap into the Running Session on Settings Save). No active session
    // → activeSwap omitted; the new values are picked up at the next session start.
    const persisted = await loadConfig();
    const ids = agentManager.listIds();
    if (!persisted || ids.length === 0) return { ok: true };
    const provider: ProviderConfig = {
      baseURL: persisted.baseURL,
      apiKey: persisted.apiKey,
      modelId: persisted.modelId,
      contextLength: persisted.contextLength,
      reasoning: persisted.reasoning,
      reasoningEffort: persisted.reasoningEffort,
    };
    let activeSwap: ConfigSetResult["activeSwap"];
    for (const id of ids) {
      const res = await agentManager.updateProvider(id, provider);
      activeSwap = res;
      // The registered model's effective context window may have changed —
      // including being CLEARED so the provider's high default applies again, in
      // which case the report omits `window`. Re-report unconditionally, so
      // nothing keeps dividing by the previous denominator (Requirement: Context
      // Occupancy Reported to the Host).
      if (res.ok) reportContextUsage(id, { force: true });
      // A failed swap on any session is the user-relevant signal — report it and stop.
      if (!res.ok) break;
    }
    return { ok: true, activeSwap };
  });

  // Credential erasure (capability `desktop-app`, Requirement: Credential Erasure
  // with Confirmation): REMOVE the persisted `apiKeyCipher` / `apiKeyPlain` field
  // from the config record — never write an empty-string cipher, which the
  // input-hygiene contract treats as a corrupt configured-state. `baseURL` /
  // `modelId` stay persisted; after erasure `loadConfig()` returns null, so the
  // configured-state check reports no key and the next session start requires a
  // re-entered key.
  ipcMain.handle(Channels.configErase, async (): Promise<ConfigEraseResult> => {
    const existing = await loadRawConfig();
    if (!existing || (existing.apiKeyCipher === undefined && existing.apiKeyPlain === undefined)) {
      return { ok: true, hadKey: false };
    }
    delete existing.apiKeyCipher;
    delete existing.apiKeyPlain;
    await writeFile(CONFIG_PATH, JSON.stringify(existing, null, 2), "utf8");
    return { ok: true, hadKey: true };
  });

  // Test-connection probe (capability `desktop-app`, Requirement: Credential
  // Presence Indicator and Connection Verifiability): verify the PERSISTED
  // configuration via `GET {baseURL}/models`. Non-blocking (async IPC + hard
  // timeout inside probeConnection), never throws, result never carries the key.
  ipcMain.handle(Channels.configTest, async (): Promise<ConnectionTestResult> => {
    const cfg = await loadConfig();
    if (!cfg) return { ok: false, cause: "not-configured" };
    return probeConnection(cfg.baseURL, cfg.apiKey);
  });

  /** Assemble the per-course session-start context for one course id. */
  async function courseSessionContext(courseId: string): Promise<CourseSessionContext> {
    return {
      id: courseId,
      sessionsDir: courseSessionsDir(COURSES_ROOT, courseId),
      wikiDir: courseWikiDir(COURSES_ROOT, courseId),
      courseContext: (await readCourseContext(COURSES_ROOT, courseId)) ?? undefined,
      // Two-layer Lecturer-State (capability `course-workspace`): global profile
      // at the Space root + this course's overlay, read fresh on every start.
      lecturerState: await readLecturerStateLayers(app.getPath("userData"), COURSES_ROOT, courseId),
    };
  }

  type ActiveSessionRef = Awaited<ReturnType<AgentManager["start"]>>;

  // Compaction-companion visibility (capability `desktop-app`, Requirement:
  // Compaction Visibility in the Renderer). The bridge's phase signal becomes
  // the `compaction_phase` AgentEvent — the renderer uses it to span ONE
  // continuous working state over the whole companion sequence (consolidation
  // + Pi's compaction, including the steered cycle's abort/re-trigger gap).
  // The documented small-context error (Requirement: Documented Error
  // Behaviour) rides the existing `error` event surface, so it renders through
  // the same readable error path as every other harness error. Both callbacks
  // arrive on the bridge's compaction path — never let a dead webContents
  // (window closing) wedge it.
  /**
   * Report this session's context occupancy to the renderer (capability
   * `agent-harness`, Requirement: Context Occupancy Reported to the Host). The
   * figure is the runtime's own, read through pi's public accessor; nothing here
   * computes, estimates or reconstructs a token count. Observation only: it
   * triggers no compaction, alters no threshold, gates no prompt, and reaches no
   * instruction channel.
   *
   * `force` emits even when the report is unchanged — used at the boundaries the
   * requirement names (a compaction ending, a live provider swap), where the
   * host must speak whether or not the number moved.
   */
  function reportContextUsage(sessionId: string, opts?: { force?: boolean }): void {
    const s = agentManager.get(sessionId);
    if (!s) return;
    const report = s.contextOccupancy.read(s.session, s.configuredContextLength);
    if (!opts?.force && !occupancyChanged(s.lastOccupancy ?? null, report)) return;
    s.lastOccupancy = report;
    try {
      const evt: AgentEvent = { type: "context_usage", sessionId, data: report };
      win.webContents.send(Channels.agentEvents, evt);
    } catch {
      /* renderer gone — a host-facing figure is best-effort */
    }
  }

  const compactionWiring: CompactionWiring = {
    onPhase: (sessionId, phase) => {
      try {
        const evt: AgentEvent = { type: "compaction_phase", sessionId, data: { phase } };
        win.webContents.send(Channels.agentEvents, evt);
      } catch {
        /* renderer gone — visibility is best-effort, compaction is not */
      }
      // A compaction ENDING, for any reason: "idle" is a completed one, "error"
      // a failed or bound-refused one. The newest usage record still describes
      // the pre-compaction context, so the report normally carries `unknown` —
      // which is the point: a host showing a pending state on the strength of a
      // running compaction is always released by a report rather than waiting
      // for one that never comes.
      if (phase === "idle" || phase === "error") {
        const s = agentManager.get(sessionId);
        s?.contextOccupancy.noteCompactionBoundary();
        reportContextUsage(sessionId, { force: true });
      }
    },
    onContextWindowTooSmall: (sessionId, message) => {
      try {
        const evt: AgentEvent = { type: "error", sessionId, data: { message } };
        win.webContents.send(Channels.agentEvents, evt);
      } catch {
        /* renderer gone — visibility is best-effort, compaction is not */
      }
    },
  };

  /** Start a fresh conversation in a course and make its identity durable on
   * disk immediately (empty pair) — canonicality must survive a crash before the
   * first turn (capability `course-workspace`, Requirement: One Canonical
   * Conversation per Course, "dual-written immediately at mint time"). */
  async function startFreshConversation(
    courseId: string,
    cfg: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
    /** Canvas artefacts carried over from the outgoing session's host-side
     * mirror (capability `agent-harness`, Requirement: Session-Start Canvas
     * Artefact Injection). Only the New Session reset passes this. */
    canvasArtefacts?: ReturnType<CanvasMirror["list"]>,
    /** Decision artefacts carried over from the outgoing session (Requirement:
     * Decision Artefacts Are Per-Conversation State). New Session resets the
     * CONTEXT, not the artefacts. Only the New Session reset passes this. */
    didacticChecks?: DidacticChecks,
    /** Step coverage + maturity carried over by the New Session reset. */
    retained?: { stepCoverage?: StepCoverageEntry[]; maturity?: MaturitySnapshot }
  ): Promise<ActiveSessionRef> {
    const course = await courseSessionContext(courseId);
    // Named residual risk, deliberately left open (capability `course-workspace`,
    // Requirement: Course Deletion from the Detail View, Reversible via the OS
    // Trash): the few milliseconds between entering a start and this
    // registration are not covered. Closing them would mean a SECOND
    // registration site in the callers, and multiplying the places that must
    // stay in sync is the larger damage — this is the one point both callers
    // pass through.
    pendingSessionStarts.set(courseId, (pendingSessionStarts.get(courseId) ?? 0) + 1);
    try {
      const active = await gatedSessionStart(() =>
        agentManager.start(cfg, course, undefined, canvasArtefacts, compactionWiring, didacticChecks, retained)
      );
      wireSessionEvents(active);
      await flushSession(active.id, { closing: false });
      return active;
    } finally {
      const left = (pendingSessionStarts.get(courseId) ?? 1) - 1;
      if (left > 0) pendingSessionStarts.set(courseId, left);
      else pendingSessionStarts.delete(courseId);
    }
  }

  function conversationResultOf(
    active: ActiveSessionRef,
    extras?: Partial<Pick<ConversationOpenResult, "notice">>
  ): ConversationOpenResult {
    // Host-derived framing state for the reading below (capability
    // `agent-harness`, Requirement: Host-Side Design-Substance and Revision
    // Signal). Read through the manager, which owns the session's signal.
    const maturityState = agentManager.maturityState(active.id);
    return {
      session: startSessionResultOf(active),
      // Completed turns only — a partially streamed draft is a live-stream
      // concern, not transcript state. `display` rides along where present.
      turns: [...active.transcript],
      agentRunning: active.inFlight,
      canvas: active.canvasMirror.list(),
      // Step coverage rides along with the canvas: both mirrors are restored from
      // the course record on open, so a cold course open must render the recorded
      // step headers instead of the all-`open` seed (capability `agent-harness`,
      // Requirement: Course Design-State Store — "the canvas, step headers,
      // Maturity panel and Decisions section present exactly what the course had").
      // `list()`, deliberately not `recordedList()`: this snapshot is also the only
      // route the host's initial step-1 focus takes to the renderer's first frame
      // (see the field's doc in `shared/ipc-contract.ts`).
      steps: active.stepMirror.list(),
      maturity: active.maturityMirror.snapshot(),
      // The session-start occupancy rides THIS snapshot rather than the event
      // channel: `wireSessionEvents` runs after the session is created, so an
      // event emitted at start has no subscriber, and a renderer reload
      // re-attaching to a live session has the same gap (capability
      // `agent-harness`, Requirement: Context Occupancy Reported to the Host).
      contextUsage: active.contextOccupancy.read(active.session, active.configuredContextLength),
      // Host-derived framing state for that reading (capability `agent-harness`,
      // Requirement: Host-Side Design-Substance and Revision Signal). Always
      // present: even an empty reading carries the session's substance signal,
      // which is what the panel's empty-state framing names.
      ...(maturityState ? { maturityState } : {}),
      // Decision artefacts read off the LIVE session, exactly like the maturity
      // mirror above — so re-attaching to an open session (renderer reload)
      // reports them instead of stranding the panel in the empty state
      // (Requirement: Decision Artefacts Are Per-Conversation State). Omitted
      // when the session never entered the Check Pipeline, which keeps the
      // trivial payload shape.
      ...(active.didacticChecks ? { didacticChecks: active.didacticChecks } : {}),
      ...(extras?.notice ? { notice: extras.notice } : {}),
    };
  }

  /**
   * Resolve-or-create the active course's ONE conversation (capability
   * `desktop-app`, Requirement: Renderer Boot-Hydration from the Main Process):
   * re-attach the open session / resume the canonical sidecar pair / start
   * fresh. The active course is resolved MAIN-side — the renderer passes no
   * possibly-stale course id at boot.
   */
  async function conversationOpenImpl(courseId: string): Promise<ConversationOpenResult> {
    const cfg = await loadConfig();
    if (!cfg) throw new Error(chrome().mainProviderNotConfigured);

    // Branch 1: re-attach — never disturb an open session (invariant: at most
    // one open session per course, guaranteed by the single-flight wrapper).
    const open = agentManager.getByCourse(courseId);
    if (open) return conversationResultOf(open);

    // Branch 2: resume the canonical conversation from disk. A legacy sidecar
    // `mode` field (retired operation-mode model) is ignored read-tolerantly:
    // resolution never fails, warns, or branches over it, and the file is not
    // rewritten (capability `desktop-app`, Requirement: Renderer Boot-Hydration
    // from the Main Process).
    const canonical = await resolveCanonicalConversation(courseSessionsDir(COURSES_ROOT, courseId));
    if (canonical.kind === "resumable") {
      const course = await courseSessionContext(courseId);
      const active = await gatedSessionStart(() =>
        agentManager.start(
          cfg,
          course,
          {
            sessionId: canonical.json.meta.sessionId,
            createdAt: canonical.json.meta.createdAt,
            turns: canonical.json.turns,
            designState: canonical.json,
            // Carry this course's decision artefacts onto the live session so
            // every later flush rewrites them instead of dropping the field.
            ...(canonical.json.didacticChecks ? { didacticChecks: canonical.json.didacticChecks } : {}),
          },
          undefined,
          compactionWiring
        )
      );
      // Restore this course's design state into the host mirrors BEFORE the first
      // hydration snapshot is served, so the canvas, step headers and Maturity
      // panel come back as the course left them (capability `agent-harness`,
      // Requirement: Course Design-State Store). Exactly what was stored: an
      // absent field restores nothing rather than an empty-but-established value.
      restoreCourseDesignState(active, canonical.json);
      wireSessionEvents(active);
      return conversationResultOf(active);
    }

    // Branch 3: fresh conversation. An unreadable canonical pair surfaces a
    // visible notice and NEVER silently falls back to an older pair (capability
    // `course-workspace`, Scenario: Unreadable newest pair never silently
    // resurrects an older conversation).
    const active = await startFreshConversation(courseId, cfg);
    return conversationResultOf(active, {
      ...(canonical.kind === "unreadable"
        ? {
            notice: chrome().mainArchiveUnreadable,
          }
        : {}),
    });
  }

  /** The single-flight wrapper around `conversationOpenImpl` — the ONE place a
   * course's conversation resolution is registered, so every entry into it
   * (the IPC handler, the re-open after a failed deletion) coalesces onto one
   * resolution and is visible to `conversationOpeningFor`. */
  function openConversationForCourse(courseId: string): Promise<ConversationOpenResult> {
    const inflight = conversationInflight.get(courseId);
    if (inflight) return inflight;
    const run = conversationOpenImpl(courseId).finally(() => {
      conversationInflight.delete(courseId);
    });
    conversationInflight.set(courseId, run);
    return run;
  }

  /**
   * Undo the session close of a deletion that then FAILED (capability
   * `course-workspace`, Requirement: Course Deletion from the Detail View —
   * a failed trash operation "reports the failure and leaves the course in
   * place"). The course folder is untouched, so its canonical pair — just
   * rewritten by the closing flush — resumes under the same sessionId the
   * renderer still holds, and the next prompt works instead of reporting a
   * session that no longer exists.
   *
   * Best-effort by construction: the failure the lecturer must read is the trash
   * failure, so a re-open that fails on its own is logged and never replaces it.
   */
  async function reopenAfterFailedDeletion(courseId: string): Promise<void> {
    try {
      await openConversationForCourse(courseId);
    } catch (err) {
      console.error(
        `[cbe:course:delete] could not re-open the conversation of ${courseId} after a failed delete:`,
        err
      );
    }
  }

  ipcMain.handle(Channels.conversationOpen, async (): Promise<ConversationOpenResult> => {
    const activeCourse = await resolveActiveCourse();
    return openConversationForCourse(activeCourse.id);
  });

  /**
   * List a course's stored conversations for the detail view's Chats tab
   * (capability `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki).
   * Newest first by creation (the order key and its rationale live at
   * `listStoredSessions` — deliberately NOT the canonical scan's key);
   * `openSessionId` lets the renderer mark the open row instead of guessing.
   * Renderer-relevant fields only — absolute paths stay main-side.
   */
  /** Renderer-supplied course ids cross the same IPC trust boundary session ids
   * do and are joined into filesystem paths — anything path-shaped is refused
   * outright, and the id must name an existing course, exactly like the sibling
   * course handlers (`courseSetActive` / `courseReveal` / `courseDelete`). */
  async function requireKnownCourse(courseId: string): Promise<void> {
    const pathShaped = courseId.includes("/") || courseId.includes("\\") || courseId.includes("..");
    if (pathShaped || !(await readCourse(COURSES_ROOT, courseId))) {
      throw new Error(`Course not found: ${courseId}`);
    }
  }

  ipcMain.handle(
    Channels.conversationList,
    async (_e, payload: ConversationListPayload): Promise<ConversationListResult> => {
      await requireKnownCourse(payload.courseId);
      const stored = await listStoredSessions(courseSessionsDir(COURSES_ROOT, payload.courseId));
      const conversations: ConversationListEntry[] = stored.map((s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        closedAt: s.closedAt,
        resumable: s.resumable,
        ...(s.reason ? { reason: s.reason } : {}),
        ...(s.turnCount !== undefined ? { turnCount: s.turnCount } : {}),
        ...(s.snippet ? { snippet: s.snippet } : {}),
      }));
      const open = agentManager.getByCourse(payload.courseId);
      return { conversations, ...(open ? { openSessionId: open.id } : {}) };
    }
  );

  /**
   * Resume a stored conversation as THE course's open conversation (capability
   * `course-workspace`, Requirement: Stored Conversations Are Resumable). Order
   * matters and each step is load-bearing:
   *
   *  1. no-op re-attach on the open id — a resume of the open conversation must
   *     never close and re-open it;
   *  2. in-flight refusal — switching the open conversation closes the running
   *     one, the same destruction the fresh-conversation guard refuses;
   *  3. the target pair is validated BEFORE the open session is closed, so a
   *     failed resume never costs the lecturer the conversation they were in;
   *  4. the outgoing session goes through the regular close path;
   *  5. the resumed session starts on the stored pair's identity with its design
   *     state restored — the same resume path the canonical boot resolution uses;
   *  6. one immediate non-closing flush re-stamps the resumed pair, so the
   *     UNCHANGED scan-only canonical resolution picks it after a restart — the
   *     durable selection needs no pointer file.
   */
  async function conversationResumeImpl(courseId: string, sessionId: string): Promise<ConversationOpenResult> {
    await requireKnownCourse(courseId);
    const cfg = await requireConfig();
    const open = agentManager.getByCourse(courseId);
    if (open && open.id === sessionId) return conversationResultOf(open);
    if (open?.inFlight) throw new Error(turnInFlightNotice());
    // The id came over IPC and is joined into a filesystem path below. Real
    // stems never carry a separator (they derive from `readdir` basenames), so
    // anything path-like is refused as unknown rather than resolved.
    if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("..")) {
      throw new Error(resumeUnavailableNotice());
    }
    const stored = await readSessionJson(courseSessionsDir(COURSES_ROOT, courseId), sessionId);
    if (!stored) throw new Error(resumeUnavailableNotice());
    if (open) {
      await flushSession(open.id, { closing: true });
      agentManager.close(open.id);
    }
    const course = await courseSessionContext(courseId);
    const active = await gatedSessionStart(() =>
      agentManager.start(
        cfg,
        course,
        {
          sessionId: stored.meta.sessionId,
          createdAt: stored.meta.createdAt,
          turns: stored.turns,
          designState: stored,
          ...(stored.didacticChecks ? { didacticChecks: stored.didacticChecks } : {}),
        },
        undefined,
        compactionWiring
      )
    );
    restoreCourseDesignState(active, stored);
    wireSessionEvents(active);
    await flushSession(active.id, { closing: false });
    return conversationResultOf(active);
  }

  ipcMain.handle(
    Channels.conversationResume,
    async (_e, payload: ConversationResumePayload): Promise<ConversationOpenResult> => {
      const { courseId, sessionId } = payload;
      // Registered in the SAME per-course in-flight map the open path uses, so
      // the course-deletion guard (`conversationOpeningFor`) sees a resolving
      // resume — and gated on that same question: `conversationOpeningFor`
      // covers BOTH a resolving open (`conversationInflight`) and a resolving
      // fresh start (`pendingSessionStarts`), which `conversationInflight`
      // alone misses (see `resumeWhileOpeningNotice`).
      if (conversationOpeningFor(courseId)) throw new Error(resumeWhileOpeningNotice());
      const run = conversationResumeImpl(courseId, sessionId).finally(() => {
        conversationInflight.delete(courseId);
      });
      conversationInflight.set(courseId, run);
      return run;
    }
  );

  /**
   * Export the active course's design document (capability `course-workspace`,
   * Requirement: Deterministic Design-Document Export from Host State).
   *
   * Built ONLY from host state — the canvas mirror, the step mirror and the maturity
   * mirror — so identical state always yields an identical document and the agent is
   * never the mechanism by which a file reaches the lecturer's disk. Returns null when
   * the lecturer cancels the save dialog.
   */
  ipcMain.handle(Channels.exportDesignDocument, async (): Promise<{ path: string } | null> => {
    const activeCourse = await resolveActiveCourse();
    const open = agentManager.getByCourse(activeCourse.id);
    if (!open) throw new Error(chrome().mainNoOpenConversation);

    const artefacts = open.canvasMirror.list();
    if (!artefacts.some((a) => typeof a.value === "string" && a.value.trim().length > 0)) {
      throw new Error(exportEmptyNotice());
    }

    const markdown = buildDesignDocument({
      courseTitle: activeCourse.title,
      ...(activeCourse.courseContext ? { courseContext: activeCourse.courseContext } : {}),
      artefacts,
      stepCoverage: open.stepMirror.list(),
      maturity: open.maturityMirror.snapshot() as Record<
        string,
        { current?: unknown; target?: unknown; note?: string }
      >,
      generatedAt: new Date().toISOString(),
      labels: designDocumentLabels(),
    });

    const defaultPath = path.join(activeCourse.path, designDocumentFilename(activeCourse.title));
    const picked = await dialog.showSaveDialog(win, {
      title: chrome().mainExportDialogTitle,
      defaultPath,
      filters: [{ name: chrome().mainExportFilterMarkdown, extensions: ["md"] }],
    });
    if (picked.canceled || !picked.filePath) return null;

    // Never inside the app bundle — user-writable data only (repo convention).
    const target = path.resolve(picked.filePath);
    if (target.startsWith(path.resolve(app.getAppPath()))) {
      throw new Error(chrome().mainExportInsideApp);
    }

    try {
      await writeFileAtomicExport(target, markdown);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(chrome().mainExportWriteFailed({ reason }));
    }
    return { path: target };
  });

  async function conversationFreshImpl(
    courseId: string,
    payload?: ConversationFreshPayload
  ): Promise<ConversationOpenResult> {
    const open = agentManager.getByCourse(courseId);
    // Main-side refusal: a fresh conversation mid-turn would abort the run and
    // lose its output. Destructive actions on a RUNNING conversation stay
    // refused even though course switching no longer is — navigating away is
    // permitted, destroying the running conversation is not (capability
    // `course-workspace`, Scenario: Fresh conversation is still refused while
    // that conversation's turn runs).
    //
    // `force` is the one documented way past it, and it exists for exactly one
    // caller: the recovery on a stop that timed out (capability `desktop-app`,
    // Requirement: *Composer Control Row*). There the run is one the runtime
    // will not release, the composer is locked over it and New Session is
    // itself disabled while a run is in flight — so refusing here would leave
    // the lecturer a dead end whose only exit is quitting the app. The closing
    // flush below still runs first, so nothing the lecturer saw is lost.
    if (open?.inFlight && payload?.force !== true) throw new Error(turnInFlightNotice());
    // Snapshot the carry-over from the OUTGOING session's host-side canvas
    // mirror BEFORE closing it (capability `agent-harness`, Requirement:
    // Session-Start Canvas Artefact Injection — snapshot source; never the
    // renderer store). When there is no open session (retry after a failed
    // fresh start), fall back to the pending snapshot kept from that attempt.
    const canvasArtefacts = open ? open.canvasMirror.list() : (pendingCanvasCarryOver.get(courseId) ?? []);
    // Same snapshot-before-close treatment for the decision artefacts: New
    // Session is a CONTEXT reset, so they are RETAINED across it (Requirement:
    // Decision Artefacts Are Per-Conversation State).
    const didacticChecks = open ? open.didacticChecks : pendingDidacticCarryOver.get(courseId);
    // New Session is a CONTEXT reset, not a data reset: the step coverage and the
    // maturity reading survive it exactly like the canvas artefacts do.
    const retainedPending = pendingRetainedCarryOver.get(courseId);
    // `recordedList()`, not `list()`: a course on which no work has happened holds
    // only the host's initial step-focus seed, and carrying a default across as
    // COVERAGE is what would make the fresh session persist it into the course
    // record and hand it back after a compaction. The reset is a carry-over, so the
    // seed is not re-applied either — an untouched course comes back from New
    // Session with no focus until the first real transition.
    const retained = open
      ? { stepCoverage: open.stepMirror.recordedList(), maturity: open.maturityMirror.snapshot() }
      : { stepCoverage: retainedPending?.stepCoverage ?? [], maturity: retainedPending?.maturity ?? {} };
    if (open) {
      await flushSession(open.id, { closing: true });
      agentManager.close(open.id);
      // From here the outgoing session is gone — remember the snapshot so a
      // retry after a failed fresh start carries the SAME artefacts.
      pendingCanvasCarryOver.set(courseId, canvasArtefacts);
      pendingRetainedCarryOver.set(courseId, retained);
      if (didacticChecks) pendingDidacticCarryOver.set(courseId, didacticChecks);
      else pendingDidacticCarryOver.delete(courseId);
    }
    let active: ActiveSessionRef;
    try {
      active = await startFreshConversation(courseId, await requireConfig(), canvasArtefacts, didacticChecks, retained);
    } catch {
      // Failure path (capability `desktop-app`, Requirement: New Session Control
      // With Canvas Carry-Over): the outgoing sidecars are already written —
      // nothing persisted is lost. Surface the fixed recoverable notice; the
      // pending snapshot stays for the retry.
      throw new Error(chrome().mainFreshStartFailedNotice);
    }
    pendingCanvasCarryOver.delete(courseId);
    pendingDidacticCarryOver.delete(courseId);
    pendingRetainedCarryOver.delete(courseId);
    return conversationResultOf(active);
  }

  ipcMain.handle(
    Channels.conversationFresh,
    async (_e, payload?: ConversationFreshPayload): Promise<ConversationOpenResult> => {
      const activeCourse = await resolveActiveCourse();
      // Mirror-image of the resume handler's guard (see
      // `resumeWhileOpeningNotice`): a fresh start racing a resolving resume
      // would pass the open-session checks in the impl and leave the course with
      // two live sessions. `force` deliberately does not bypass this — it exists
      // for a stuck RUN (timed-out stop), a state in which no resolution is
      // resolving, and a resolving resolution always releases the guard.
      if (conversationOpeningFor(activeCourse.id)) throw new Error(resumeWhileOpeningNotice());
      // Registered SYNCHRONOUSLY behind the guard check, in the SAME map the
      // resume handler uses: `startFreshConversation`'s own registration in
      // `pendingSessionStarts` only becomes visible AFTER the closing flush and
      // the config/course reads have completed, and a resume passing its guard
      // inside that window would race this reset into two live sessions. The
      // registration cannot trip this handler's own guard (the check above ran
      // first), and a boot open coalescing onto this entry resolves to the
      // course's fresh hydration snapshot, which is the correct answer.
      const run = conversationFreshImpl(activeCourse.id, payload).finally(() => {
        conversationInflight.delete(activeCourse.id);
      });
      conversationInflight.set(activeCourse.id, run);
      return run;
    }
  );

  async function requireConfig(): Promise<NonNullable<Awaited<ReturnType<typeof loadConfig>>>> {
    const cfg = await loadConfig();
    if (!cfg) throw new Error(chrome().mainProviderNotConfigured);
    return cfg;
  }

  function startSessionResultOf(active: ActiveSessionRef): StartSessionResult {
    return {
      sessionId: active.id,
      environmentProfile: active.env.profile,
      affordances: active.env.affordances as unknown as Record<string, boolean>,
      // Forward the runtime path anchors so the renderer can render tool-call
      // arguments as `corpus/…` / `workspace/…` instead of leaking the user's
      // absolute filesystem layout into tool cards.
      paths: {
        workspace: active.env.paths.workspace,
        corpus: active.env.paths.corpus,
        wiki: active.env.paths.wiki,
      },
      courseId: active.courseId,
    };
  }

  /**
   * Push the host-derived maturity framing state to the renderer (capability
   * `agent-harness`, Requirement: Host-Side Session Maturity Mirror — the derived
   * state accompanies live mirror updates, not just hydration). Called from every
   * host-side path that can move substance, the revision counter, or the reading's
   * stamp: an accepted `cbe_canvas` / `cbe_step` / `cbe_maturity` call, a UI
   * canvas deletion, and a completed material ingestion. No-op for a session that
   * is no longer open.
   */
  function emitMaturityState(sessionId: string): void {
    const state = agentManager.maturityState(sessionId);
    if (!state) return;
    win.webContents.send(Channels.agentEvents, {
      type: "maturity_state",
      sessionId,
      data: state,
    } satisfies AgentEvent);
  }

  function wireSessionEvents(active: ActiveSessionRef): void {
    // Bridge the CBE-owned runtime events (capability `agent-harness`,
    // Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*) to the
    // renderer through one channel. The runtime's own event shapes are decoded
    // once, in pi-bridge; each branch here maps a normalized event to its IPC
    // counterpart and runs the host's domain reactions.
    //
    // Two error surfaces are merged here:
    //   - `stream_error` — a provider stream that terminated in error;
    //   - `message_end` — fallback: when the provider returns 4xx before any stream
    //     tokens arrive, only `message_end` is emitted with `stopReason === "error"`.
    const send = (e: AgentEvent) => win.webContents.send(Channels.agentEvents, e);
    const thinkingBuf = new Map<number, string>();
    // Provider-independent protocol boundary (Requirement: Agent Activity
    // Visibility in the Renderer). Pi's raw event/session record stays untouched;
    // only the app-owned copy feeding renderer + sidecars is sanitized.
    const assistantText = new AssistantTextBoundary();
    const emitAssistantText = (text: string) => {
      if (!text) return;
      active.draft += text;
      send({ type: "text_delta", sessionId: active.id, data: { delta: text } });
    };
    const finishAssistantMessage = () => emitAssistantText(assistantText.finish());

    // Tool-Call Loop Remediation (capability `agent-harness`). The detector
    // accumulates tool calls across one agent run (`agent_start`…`agent_end`) and
    // tells us when a model is looping on the same call. `toolCallArgs` pairs the
    // args seen at `tool_execution_start` with the `isError` seen at `_end`.
    // `turnRemediating` guards against acting twice once we have aborted a run.
    const loopDetector = new ToolLoopDetector();
    const toolCallArgs = new Map<string, unknown>();
    let turnRemediating = false;

    // Truncated-Completion Detection and Remediation (capability `agent-harness`;
    // renderer surface: `desktop-app`, Requirement: Response-Cut-Off State with
    // One-Click Continue and Retry). The pure detector is fed every completed
    // assistant message; `continue` verdicts steer the still-running session
    // host-side (public surface, no renderer involvement), a `surface` verdict —
    // continue budget exhausted — is forwarded as the `truncation_cutoff` event
    // so the renderer shows the cut-off state instead of presenting the partial
    // answer as final. Per-run state resets at the `agent_start` boundary.
    const truncationDetector = new TruncationDetector();
    // A surfaced cut-off is DEFERRED to the run's settled end (capability
    // `agent-harness`, Requirement: *Accepted Pi 1.3 Runtime Semantics Are
    // Explicit Contracts* — truncation). Once the continue budget is spent, Pi
    // 1.x may still recover the answer itself (omit the truncated attempt,
    // compact, retry once); a later completed answer in the same run supersedes
    // the cut-off, so the state is announced only if the run settles truncated.
    const cutOff = new CutOffSettlement();

    // The lecturer's stop TAKING EFFECT (capability `agent-harness`,
    // Requirement: *A Lecturer Can Stop a Running Turn*). Announced here rather
    // than from the stop's own IPC call, because that call resolves only once
    // the run END is observed — by which time the renderer has already
    // finalised the assistant turn from `agent_end` and the marker would arrive
    // too late to be put on it.
    active.turnStop.observeStopTakingEffect(() => {
      send({ type: "turn_stopped", sessionId: active.id, data: {} });
    });

    active.session.subscribe((event) => {
      switch (event.type) {
        case "agent_start":
          // This runtime event is the shared ACCEPTED-DISPATCH boundary: every
          // renderer prompt route reaches it with its byte-identical payload,
          // while a precheck/Pi busy refusal emits no run start. Persist before
          // provider work completes, so a later provider error cannot resurrect
          // onboarding.
          void acknowledgeOnboarding();
          // New agent run (one user prompt) → clear loop-detection state so a loop
          // never leaks across user messages; within the run it accumulates.
          loopDetector.reset();
          // A new run means the lecturer's turn has landed, so any question
          // rendered in the previous run is answered (or abandoned) — the
          // outstanding-answer gate reopens (Requirement: Deterministic
          // Tool-Boundary Enforcement…).
          active.pendingAnswerGate.reset();
          truncationDetector.reset();
          cutOff.reset();
          toolCallArgs.clear();
          turnRemediating = false;
          send({ type: "agent_start", sessionId: active.id, data: {} });
          // Run boundary for the lecturer stop as well (capability
          // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*):
          // it spends the previous run's end claim and its stopped fact, and it
          // is where a stop issued BEFORE the run started is honoured — the
          // latch fires here rather than being discarded as "nothing running".
          //
          // AFTER the `agent_start` forward, deliberately. A latch fires its
          // stop announcement again as it takes effect, and the renderer resets
          // its per-run state on `agent_start` — announcing first would have the
          // run boundary wipe the very marker the latch just re-established, and
          // the stopped turn would come out looking complete.
          active.turnStop.noteRunStart();
          break;
        case "agent_end": {
          // Fallback for providers that terminate without `message_end`: release
          // an incomplete candidate, or drop a complete protocol-only suffix.
          finishAssistantMessage();
          // This is the CBE-owned SETTLED end (capability `agent-harness`,
          // Requirement: *Run Completion Uses Pi Settled State*): the adapter
          // emits it once per run, from Pi `agent_settled`, after every retry,
          // recovery or continuation. Pi's low-level ends never reach the host,
          // so every effect below runs exactly once per run.
          //
          // The stop is complete when the run's END is observed, not when
          // `abort()` resolves (Requirement: *A Lecturer Can Stop a Running
          // Turn*).
          active.turnStop.noteRunEnd();
          // The deferred cut-off, if the run settled truncated — just before the
          // end, the same relative order the renderer has always received. A
          // lecturer stop never carries one (the detector is disarmed for it).
          const cutOffNote = cutOff.settle(active.turnStop.stoppedForCurrentRun());
          if (cutOffNote !== null)
            send({ type: "truncation_cutoff", sessionId: active.id, data: { note: cutOffNote } });
          send({ type: "agent_end", sessionId: active.id, data: {} });
          // The run boundary the runtime ALWAYS reaches. A companion sequence
          // that ended without emitting a terminal phase (an early-return
          // failure inside `session_before_compact`) leaves no other signal, and
          // a host waiting on one would sit in its pending state forever.
          reportContextUsage(active.id, { force: true });
          break;
        }
        case "turn_start":
          send({ type: "turn_start", sessionId: active.id, data: {} });
          break;
        case "turn_end":
          send({ type: "turn_end", sessionId: active.id, data: {} });
          break;
        case "message_start":
          // Defensive boundary between assistant messages if a provider omitted
          // the preceding `message_end`.
          finishAssistantMessage();
          send({ type: "message_start", sessionId: active.id, data: {} });
          break;
        case "tool_execution_start": {
          // Remember the args so we can pair them with isError at _end for the
          // loop detector (args are only on the start event).
          toolCallArgs.set(event.toolCallId, event.args);
          // Open the card for a DESIGN-RECORD call, at its position in the text
          // streamed so far (capability `agent-harness`, Requirement: *Sessions
          // as Local Markdown/JSON Files* — "Design-record tool cards on an
          // assistant turn"). The recorder ignores every other tool, so the scope
          // decision lives in one place. Offset taken at START, which is where
          // the lecturer saw the card appear between two text segments.
          active.cardRecorder.start(event.toolCallId, event.toolName, event.args, active.draft.length);
          send({
            type: "tool_execution_start",
            sessionId: active.id,
            data: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: pickerArgsForRenderer(event.toolName, event.args),
            },
          });
          break;
        }
        case "tool_execution_update":
          send({
            type: "tool_execution_update",
            sessionId: active.id,
            data: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              partialResult: event.partialResult,
            },
          });
          break;
        case "tool_execution_end": {
          send({
            type: "tool_execution_end",
            sessionId: active.id,
            data: {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              isError: event.isError,
            },
          });

          // Close the compatible design-call record opened at `_start`. Normal
          // chat does not replay it after terminal completion; the record remains
          // available to existing sidecar/diagnostic readers.
          active.cardRecorder.end(event.toolCallId, event.result, event.isError, chrome().toolExecutionFailed);

          // Tool-Call Loop Remediation: feed the completed call to the detector.
          // On `steer` we inject a correction mid-run via the public steering API;
          // on `abort` we stop the runaway run, keep the session open, and append a
          // neutral assistant note so the next prompt continues cleanly (Variant B).
          //
          // NO verdict may be issued from ANY event of a run the lecturer
          // stopped (Requirement: *A Lecturer Can Stop a Running Turn*). This is
          // the detector that actually bites: the abort manufactures an error
          // result for every not-yet-started call in the batch, which is enough
          // repeated failure to reach the loop threshold and steer a correction
          // into — or raise a second abort on — the run the lecturer just
          // stopped. The flag is raised AT THE STOP, synchronously, before the
          // abort is issued, so those manufactured results never reach the
          // detector at all. It is deliberately a second flag rather than a
          // reuse of `turnRemediating`: a stop is not a remediation and their
          // lifetimes differ.
          if (!turnRemediating && !active.turnStop.stoppedForCurrentRun()) {
            const verdict = loopDetector.record({
              toolName: event.toolName,
              args: toolCallArgs.get(event.toolCallId),
              isError: event.isError,
            });
            if (verdict.action !== "none") {
              console.warn(`[loop-breaker] ${verdict.action} session ${active.id}: ${verdict.reason}`);
            }
            turnRemediating = applyLoopVerdict(verdict, {
              session: active.session,
              transcript: active.transcript,
              emitError: (message) => send({ type: "error", sessionId: active.id, data: { message } }),
              clearDraft: () => {
                active.draft = "";
                // The abort discards the runaway run's partial record, and the
                // cards go with the text: keeping them would append a second
                // assistant turn AFTER the abort note carrying calls made BEFORE
                // it. The design state those calls produced is not lost — it
                // lives in the mirrors and the course design-state record.
                active.cardRecorder.clear();
              },
              // The lecturer's stop claims the same run end. First claim wins:
              // a refused claim makes this abort branch a complete no-op.
              claimRunEnd: () => active.turnStop.claimRunEnd("loop-breaker"),
            });
          }
          toolCallArgs.delete(event.toolCallId);

          // Live derived maturity state (capability `agent-harness`, Requirement:
          // Host-Side Session Maturity Mirror — "the same derived state MUST
          // accompany live mirror updates"). The three tools below are the only
          // model-reachable ones that can move substance, the revision counter,
          // or the reading's stamp, so a panel that is ALREADY open sees a
          // reading go stale — or a fresh reading lose its provisional marking —
          // without a reload. The mirrors have already consumed the result at
          // this point, so this reads the post-call truth.
          if (event.toolName === "cbe_canvas" || event.toolName === "cbe_step" || event.toolName === "cbe_maturity") {
            emitMaturityState(active.id);
          }

          // Persist accepted `cbe_profile` updates to the per-lecturer store
          // (capability `agent-harness`, Requirement: cbe_profile Generative-UI
          // Tool — "the host can persist the record"). Refusals carry
          // kind === "profile-refusal" and are skipped. The service protects
          // lecturer overrides (only a lecturer-confirmed estimate replaces one);
          // a rejected estimate is surfaced to the agent at the next turn
          // boundary instead of being dropped silently.
          if (event.toolName === "cbe_profile" && !event.isError) {
            const details = (
              event.result as {
                details?: {
                  kind?: unknown;
                  dimension?: unknown;
                  value?: unknown;
                  confidence?: unknown;
                  evidence?: unknown;
                  lecturerConfirmed?: unknown;
                };
              }
            )?.details;
            if (
              details?.kind === "profile-update" &&
              isProfileDimension(details.dimension) &&
              typeof details.value === "string" &&
              (CONFIDENCE_LEVELS as readonly unknown[]).includes(details.confidence) &&
              typeof details.evidence === "string"
            ) {
              const dimension = details.dimension;
              const value = details.value;
              void lecturerProfileService
                .applyEstimate({
                  dimension,
                  value,
                  confidence: details.confidence as (typeof CONFIDENCE_LEVELS)[number],
                  evidence: details.evidence,
                  ...(details.lecturerConfirmed === true && { lecturerConfirmed: true }),
                })
                .then((result) => {
                  if (result.outcome === "rejected-override") {
                    agentManager.queueProfileNote(profileEstimateRejectedNote(dimension, value));
                  }
                })
                .catch((err) => console.error("[cbe:profile] failed to persist estimate:", err));
            }
          }
          break;
        }
        case "compaction_start":
          send({ type: "compaction_start", sessionId: active.id, data: { reason: event.reason } });
          break;
        case "compaction_end":
          send({
            type: "compaction_end",
            sessionId: active.id,
            data: {
              reason: event.reason,
              aborted: event.aborted,
              willRetry: event.willRetry,
              errorMessage: event.errorMessage,
            },
          });
          break;
        case "auto_retry_start":
          send({
            type: "auto_retry_start",
            sessionId: active.id,
            data: {
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
              errorMessage: event.errorMessage,
            },
          });
          break;
        case "auto_retry_end":
          send({
            type: "auto_retry_end",
            sessionId: active.id,
            data: {
              success: event.success,
              attempt: event.attempt,
              finalError: event.finalError,
            },
          });
          break;
        case "text_delta":
          emitAssistantText(assistantText.push(event.delta));
          break;
        case "thinking_start":
          thinkingBuf.set(event.contentIndex, "");
          send({ type: "thinking_start", sessionId: active.id, data: { contentIndex: event.contentIndex } });
          break;
        case "thinking_delta": {
          const prev = thinkingBuf.get(event.contentIndex) ?? "";
          thinkingBuf.set(event.contentIndex, prev + event.delta);
          send({
            type: "thinking_delta",
            sessionId: active.id,
            data: { contentIndex: event.contentIndex, delta: event.delta },
          });
          break;
        }
        case "thinking_end": {
          const content = thinkingBuf.get(event.contentIndex) ?? "";
          thinkingBuf.delete(event.contentIndex);
          send({
            type: "thinking_end",
            sessionId: active.id,
            data: { contentIndex: event.contentIndex, content },
          });
          break;
        }
        case "stream_error": {
          finishAssistantMessage();
          const msg = event.errorMessage ?? `Provider error (reason: ${event.reason})`;
          // A stop is not a failure. The runtime terminates an aborted
          // stream with an error carrying an aborted reason, and the
          // ordinary mapping below would render a deliberate stop as
          // "Provider error (reason: aborted)" (Requirement: *A Lecturer Can
          // Stop a Running Turn* — "A stopped run MUST NOT surface as a
          // provider error"). Recognised by the runtime's own reason
          // vocabulary, not by the message text, which is provider-authored.
          // The raw detail still goes to the session log.
          if (isAbortOriginatedStreamError(event.reason) && active.turnStop.stoppedForCurrentRun()) {
            console.info(`[agent] stream aborted by the lecturer's stop for session ${active.id}: ${msg}`);
            break;
          }
          console.error(`[agent] message_update error for session ${active.id}: ${msg}`);
          send({ type: "error", sessionId: active.id, data: { message: msg } });
          break;
        }
        case "message_end": {
          const msg = event.message;
          finishAssistantMessage();
          send({ type: "message_end", sessionId: active.id, data: {} });
          if (msg.role === "assistant" && msg.stopReason !== "error") {
            // A COMPLETED assistant message: from here the runtime's occupancy
            // figure describes this leg of the conversation, so the report can
            // carry a measured number instead of `unknown`. Emitted only when it
            // actually moved (Requirement: Context Occupancy Reported to the Host).
            active.contextOccupancy.noteAssistantMessageCompleted();
            reportContextUsage(active.id);
          }
          if (msg.role === "assistant" && msg.stopReason === "error") {
            const text = msg.errorMessage ?? "Provider error (no message)";
            if (active.turnStop.stoppedForCurrentRun()) {
              // Same reasoning as the stream-error branch above: the failure
              // the lecturer caused deliberately is not a provider failure.
              console.info(`[agent] message ended in error under the lecturer's stop, session ${active.id}: ${text}`);
            } else {
              console.error(`[agent] message_end with stopReason=error for session ${active.id}: ${text}`);
              send({ type: "error", sessionId: active.id, data: { message: text } });
            }
          } else if (msg.role === "assistant" && !turnRemediating && !active.turnStop.stoppedForCurrentRun()) {
            // Truncated-completion check on every completed assistant message
            // (error/abort stops keep their own paths above; a loop-aborted run
            // is not additionally steered). The steer enqueue is synchronous, so
            // a `continue` lands before the run loop would end.
            //
            // A LECTURER-STOPPED run is carved out of this requirement
            // (Requirement: *Truncated-Completion Detection and Remediation*):
            // a stopped answer is unfinished by the lecturer's decision, and
            // both remediations work against it — a continuation would restart
            // the answer they just stopped, and a surfaced cut-off state would
            // offer them a one-click button to undo their own action.
            // `isTruncatedCompletion` already ignores an aborted stop reason;
            // the guard above is kept anyway so the rule does not depend on that
            // implementation detail.
            const verdict = truncationDetector.record(completionEndSignalOf(msg));
            if (verdict.action !== "none") {
              console.warn(`[truncation] ${verdict.action} session ${active.id}: ${verdict.reason}`);
            } else {
              cutOff.observeUntruncated(msg);
            }
            applyTruncationVerdict(verdict, {
              session: active.session,
              notifyCutOff: (note) => cutOff.surface(note),
            });
          }
          break;
        }
        default:
          break;
      }
    });
  }

  ipcMain.handle(Channels.prompt, async (_e, payload: PromptPayload): Promise<{ ok: true }> => {
    const s = agentManager.get(payload.sessionId);
    if (!s) throw new Error(`Session not found: ${payload.sessionId}`);
    // Busy precheck BEFORE the transcript push (capability `desktop-app`,
    // Requirement: Canvas Dialogue-Steering Dispatches Respect the Run Lock —
    // no phantom turns): a prompt racing into an in-flight turn is refused
    // here, so no user turn ever enters s.transcript for it. The message keeps
    // the classifiable "already processing" phrase the renderer catalog maps.
    if (s.inFlight) throw new Error(promptBusyNotice());
    // Mark the turn in flight HERE, not just before `session.prompt` — the flag
    // is what the lecturer stop's pre-run latch reads (capability
    // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*). A
    // stop arriving while this handler is still composing the payload must
    // latch, not report "nothing running": the composer has been locked since
    // the click, and the run is on its way. Everything from here to the prompt
    // call is guarded so a composition failure cannot strand the flag.
    agentManager.setInFlight(payload.sessionId, true);
    try {
      return await runPrompt(s, payload);
    } finally {
      // Turn is over (success or error) — back to an idle boundary where a
      // deferred provider swap can be safely applied before the next prompt.
      agentManager.setInFlight(payload.sessionId, false);
    }
  });

  /** The prompt turn itself, from payload composition to the turn-boundary
   * flush. Split out of the handler above only so the in-flight flag can be
   * raised before composition and released by one `finally`. */
  async function runPrompt(
    s: NonNullable<ReturnType<AgentManager["get"]>>,
    payload: PromptPayload
  ): Promise<{ ok: true }> {
    // Profile Panel overrides queued since the last turn become a bracketed system
    // note prepended to this prompt — the next-turn-boundary visibility required by
    // capability `desktop-app`, Requirement: Profile Panel (no mid-turn mutation).
    // The composed text goes to the model AND into s.transcript: the transcript is
    // never lossy w.r.t. the model payload; the renderer displays its own user turn.
    // Every prefix below is drained from a host-side queue BEFORE the payload is
    // dispatched, so each drained batch is held here: a prompt Pi refuses never
    // reaches the model, and the queues must be restored with it (see the pop
    // branch in the catch).
    const profileNotes = agentManager.drainProfileNotes(payload.sessionId);
    const withProfileNotes = composePromptWithProfileNotes(profileNotes, payload.text);
    // UI-deletion notices (capability `agent-harness`, Requirement: Host-Side Canvas
    // Artefact Mirror): any canvas artefact the lecturer deleted via the delete control
    // since the last turn is disclosed to the model as a machine-readable notice prefixed
    // to THIS payload. Like the profile note, it goes to the model AND into s.transcript
    // (lossless); the renderer displays only the lecturer's own user turn (display/payload
    // split). Notices accumulate across several deletions between two turns.
    const canvasDeletions = agentManager.pendingCanvasDeletions(payload.sessionId);
    const withCanvasDeletions = agentManager.composePromptWithCanvasDeletions(payload.sessionId, withProfileNotes);
    // UI step focus (capability `agent-harness`, Requirement: Host-Set Step Focus
    // from the Canvas UI): a step the lecturer selected in the canvas since the last
    // turn is disclosed here as a machine-readable notice, so the model works there
    // instead of re-asserting a focus the host has already recorded. Same
    // display/payload split as the notices above: it goes to the model AND into
    // s.transcript, never into the rendered user turn. At most ONE line — focus is
    // exclusive, so a later selection superseded any earlier one in the mirror.
    const stepFocusNotice = agentManager.pendingStepFocus(payload.sessionId);
    const withStepFocus = agentManager.composePromptWithStepFocus(payload.sessionId, withCanvasDeletions);
    // Newly ingested wiki atoms (capability `agent-harness`, Requirement: Newly
    // Ingested Wiki Atoms Are Disclosed on the Next Lecturer Turn): material that
    // landed in the course wiki since the last turn is disclosed here, so it does
    // not wait for the next cold session. Same display/payload split as the notices
    // above, and drained the same way — a payload Pi refuses gives it back below.
    const wikiAtomsNotice = agentManager.pendingWikiAtoms(payload.sessionId);
    const withWikiAtoms = agentManager.composePromptWithWikiAtoms(payload.sessionId, withStepFocus);
    // Post-compaction retained-state handover (capability `agent-harness`,
    // Requirement: Post-Compaction Retained-State Handover): if a compaction
    // completed since the last turn, the host's record of the maturity reading,
    // step coverage and decision artefacts is prefixed here — the summary may not
    // carry it, and the panels would otherwise keep asserting state the model can
    // no longer see. Same display/payload split as the two notices above: it goes
    // to the model AND into s.transcript, never into the rendered user turn.
    // The drain is one-shot, so remember whether it consumed one: a payload Pi
    // refuses never reaches the model and must give the handover back (below).
    const handoverWasPending = agentManager.hasPendingRetainedState(payload.sessionId);
    const withRetainedState = agentManager.composePromptWithRetainedState(payload.sessionId, withWikiAtoms);
    // App-UI reference (capability `desktop-app`, Requirement: App-UI Reference
    // Injected on the Help-Token Turn): when the RENDERER-AUTHORED payload is the
    // help token, the documented controls of this app are prefixed as an inert
    // data block, filtered against this session's affordances. The rule telling
    // the model to read `references/ui-guide.md` itself fired 0 times in 201
    // recorded log entries — what the host knows, the host hands over. Derived,
    // not drained: a payload Pi refuses consumes nothing and needs no requeue.
    // (Same cast as `startSessionResultOf`: `Affordances` is an interface, so it
    // carries no implicit index signature.)
    const withUiReference = composePromptWithUiReference(
      payload.text,
      s.env.affordances as unknown as Record<string, boolean>,
      withRetainedState
    );
    // Completed material ingestion (capability `agent-harness`, Requirement:
    // Host-Side Design-Substance and Revision Signal): a turn carrying attachment
    // chips IS the moment material reaches the conversation. Recorded BEFORE the
    // staleness notice is composed, so an ingestion makes the reading stale on
    // the very turn that brings the material in — it is a categorical change to
    // the evidence base, not an increment. The filenames come from the display
    // projection and are treated as data everywhere they are rendered.
    const ingested = payload.display?.attachments ?? [];
    for (const attachment of ingested) {
      agentManager.recordIngestion(payload.sessionId, attachment.filename);
    }
    if (ingested.length > 0) emitMaturityState(payload.sessionId);
    // Standing stale-maturity disclosure (capability `agent-harness`,
    // Requirement: Stale-Maturity Disclosure on the Next Lecturer Turn): while
    // the recorded reading lags the current design revision, EVERY lecturer turn
    // carries one machine-readable notice ahead of the lecturer's text. Same
    // display/payload split as the three prefixes above. Unlike them it is
    // DERIVED rather than drained, so a payload Pi refuses consumes nothing and
    // the notice needs no requeue below — it simply returns on the next turn,
    // and only a recorded `cbe_maturity` call ends it.
    const withStaleness = agentManager.composePromptWithMaturityStaleness(payload.sessionId, withUiReference);
    // Lecturer-wide support preference (capability `agent-harness`, Requirement:
    // Separate Lecturer-Wide Support Preference): when the shared service's revision
    // moved past what THIS session saw — a change or clear made in another open
    // conversation — or a compaction may have dropped it, the current saved snapshot
    // is prefixed here as one data-only line. Same display/payload split as above.
    // DERIVED like the staleness notice: a payload Pi refuses consumes nothing, and
    // only a delivered payload marks it seen (below), so the retry carries it again.
    const supportDue = await agentManager.pendingSupport(payload.sessionId);
    const promptText = composePayloadWithSupportNotice(supportDue?.snapshot ?? null, withStaleness);
    // The optional display projection records what the lecturer SAW (instruction
    // + attachment chips) so re-entry renders the conversation as experienced —
    // `text` stays the lossless model payload (agent-harness, Requirement:
    // Sessions as Local Markdown/JSON Files, display projection). Persisted only
    // when it actually differs from the composed payload.
    const display =
      payload.display && (payload.display.text !== promptText || (payload.display.attachments?.length ?? 0) > 0)
        ? payload.display
        : undefined;
    const userTurn = { role: "user" as const, text: promptText, ...(display ? { display } : {}) };
    s.transcript.push(userTurn);
    s.draft = "";
    // Run-scoped, exactly like the draft: whatever a previous run left unpromoted
    // must not attach itself to this turn.
    s.cardRecorder.clear();
    // Idle boundary: apply any provider swap that was deferred while a previous turn
    // was running, so this prompt already routes to the new model. The in-flight
    // flag is already raised by the caller (a swap requested during the turn is
    // therefore deferred rather than applied mid-run, unchanged).
    await agentManager.applyPendingProvider(payload.sessionId);
    try {
      await s.session.prompt(promptText);
    } catch (err) {
      // Diagnostic instrumentation for the reported picker failure:
      //   "Cannot continue from message role: assistant"
      // This throw originates from the runtime's internal continue running on a
      // transcript whose last message is an assistant turn. It could not be
      // reproduced in isolation (see packages/pi-bridge/tests/picker-roundtrip-repro.test.ts),
      // so capture the state the next time it happens: the full stack plus the
      // tail of the HOST transcript (role + length + whether the turn carried
      // design cards). The runtime's own message list is deliberately not read:
      // it sits behind the CBE-owned port (capability `agent-harness`,
      // Requirement: *Pi Runtime Is Hidden Behind a CBE-Owned Port*). Remove once
      // the trigger is pinned.
      const msg = err instanceof Error ? err.message : String(err);
      if (/continue from message role/i.test(msg)) {
        try {
          const tail = s.transcript.slice(-8).map((t) => ({
            role: t.role,
            chars: t.text.length,
            cards: t.role === "assistant" && t.cards?.length ? t.cards.length : undefined,
          }));
          console.error(
            "[cbe:prompt] continue-from-assistant failure. transcript tail:",
            JSON.stringify(tail, null, 2),
            "\nstack:",
            err instanceof Error ? err.stack : err
          );
        } catch (logErr) {
          console.error("[cbe:prompt] failed to capture diagnostic state:", logErr);
        }
      }
      // Belt-and-braces phantom guard: if Pi itself refused the prompt as busy
      // (the payload never reached the model), take the just-pushed user turn
      // back out so no surface persists it. A mid-run failure (payload WAS
      // delivered) must NOT pop — the turn is real.
      const refusedBeforeModel = /already processing/i.test(msg) && s.transcript[s.transcript.length - 1] === userTurn;
      // A mid-run failure means the payload — and any support snapshot on it — reached
      // the model; a refusal means it did not, and the snapshot simply stays due.
      if (!refusedBeforeModel && supportDue) agentManager.markSupportDelivered(payload.sessionId, supportDue);
      if (refusedBeforeModel) {
        s.transcript.pop();
        // The same reasoning covers every host-authored prefix the payload
        // carried: profile notes, canvas UI-deletion notices and the
        // retained-state handover were all drained for a turn the model never
        // saw, so all three go back — in order, exactly once — and the
        // lecturer's retry composes the same payload again.
        agentManager.requeueProfileNotes(payload.sessionId, profileNotes);
        agentManager.requeueCanvasDeletions(payload.sessionId, canvasDeletions);
        // Same reasoning for the UI focus notice, with one narrowing the others do
        // not need: the mirror refuses the requeue if the lecturer has selected
        // another step in the meantime, because that newer selection is the truth
        // and a stale one must not be disclosed over it.
        agentManager.requeueStepFocus(payload.sessionId, stepFocusNotice);
        // Same reasoning for the wiki-atoms notice: the atoms landed on disk either
        // way, but the model was never told, so the disclosure rides the next
        // payload instead of being lost with this one.
        agentManager.requeueWikiAtoms(payload.sessionId, wikiAtomsNotice);
        if (handoverWasPending) agentManager.rearmRetainedState(payload.sessionId);
        // Same reasoning for the ingestions recorded above: the payload never
        // reached the model, so no material actually entered the conversation.
        // Leaving them recorded would count every attachment twice once the
        // lecturer retries — in the counter, in the panel's document count and in
        // the staleness enumeration.
        if (ingested.length > 0) {
          agentManager.unrecordIngestions(payload.sessionId, ingested.length);
          emitMaturityState(payload.sessionId);
        }
      }
      // Error-path turn-boundary flush (agent-harness, Requirement: Sessions as
      // Local Markdown/JSON Files): completed turns only — the partially
      // streamed draft stays in memory and is persisted only by a closing flush
      // (Scenario: Error-path flush excludes the partial draft, close includes it).
      void flushSession(payload.sessionId, { closing: false });
      throw err;
    }
    // After prompt resolves, flush the draft as the assistant turn, then persist
    // the now-completed turn pair at this boundary (turn-boundary dual-write).
    // Fire-and-forget: failures are logged inside flushSession and the next
    // boundary rewrites the full state by construction.
    //
    // A LECTURER-STOPPED run resolves here like any other (capability
    // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*), and
    // this is where its two retention rules are applied:
    //
    //   - partial content is KEPT and marked — the lecturer watched it arrive,
    //     and deleting it would contradict what they saw with their own eyes;
    //   - a stop that left NOTHING streamed still appends a short neutral
    //     synthetic message, following the loop-abort precedent, so the history
    //     ends on a completed assistant turn and the next prompt does not hit
    //     "Cannot continue from message role: assistant".
    //
    // Either way the turn is COMPLETED, so the turn-boundary flush below needs
    // no exception to "completed turns only" — the marker rides the completed
    // turn into both sidecars.
    if (supportDue) agentManager.markSupportDelivered(payload.sessionId, supportDue);
    const stoppedByLecturer = s.turnStop.stoppedForCurrentRun();
    // `promotedAssistantTurn` covers every shape this boundary can leave: the
    // streamed draft, the neutral synthetic message for a stop that streamed
    // nothing — which THIS path owns and no other one does (design decision D5b),
    // so it is passed in rather than synthesised there — and, the shape this
    // branch used to swallow, a run whose whole output was design-record tool
    // calls. A stop that streamed nothing but recorded calls is now the first two
    // together: the placeholder keeps the resume seed byte-identical to what this
    // path always produced, and the cards ride it instead of vanishing.
    const promoted = promotedAssistantTurn(s.draft, stoppedByLecturer, s.cardRecorder.take(), {
      stoppedPlaceholder: chrome().chatStoppedTurnPlaceholder,
      stoppedNote: chrome().exportStoppedTurnNote,
    });
    if (promoted) {
      s.transcript.push(promoted);
      s.draft = "";
    }
    void flushSession(payload.sessionId, { closing: false });
    return { ok: true };
  }

  /**
   * The lecturer's stop on a running turn (capability `agent-harness`,
   * Requirement: *A Lecturer Can Stop a Running Turn*).
   *
   * Its own channel: it dispatches no prompt, creates no user turn and never
   * enters the dispatch lock. It NAMES its session, so a run in a background
   * conversation is untouched — and a session id the host does not hold is the
   * same silent no-op as "no run in flight", because nothing failed.
   *
   * Everything else is the controller's: the compaction refusal, the pre-run
   * latch, idempotence, the single claim on the run's end and the bounded wait.
   * The handler contributes the process boundary and the one host-side effect
   * the controller cannot reach — announcing the stop to the renderer BEFORE the
   * run's end event, so the renderer marks the turn it is about to finalise.
   */
  ipcMain.handle(Channels.promptAbort, async (_e, payload: PromptAbortPayload): Promise<PromptAbortResult> => {
    const sessionId = payload?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) return { status: "not-running" };
    const s = agentManager.get(sessionId);
    // Unknown session: a no-op, never an error. The renderer may hold a session
    // the main process has already retired (a course deletion, a fresh-session
    // reset), and nothing about that is a failure the lecturer must read.
    if (!s) return { status: "not-running" };
    const outcome = await s.turnStop.stop();
    if (outcome.status === "timed-out" || outcome.status === "error") {
      console.error(`[cbe:stop] stop for session ${sessionId} reported "${outcome.status}"`);
    }
    return outcome;
  });

  // UI-initiated canvas artefact deletion (capability `desktop-app`, Requirement:
  // Canvas Artefact Delete Control; stakeholder directive 2026-07-07, D2). A confirmed
  // deletion from the per-artefact delete control routes here: it removes the mirror
  // entry exactly like a skill-emitted clear AND enqueues a deletion notice so the next
  // lecturer turn discloses it to the agent. Renderer applies the equivalent clear
  // locally; the mirror/notice are the host-side half of the ONE deletion pipeline.
  ipcMain.handle(Channels.canvasDelete, async (_e, payload: CanvasDeletePayload): Promise<{ ok: true }> => {
    if (
      payload &&
      typeof payload.sessionId === "string" &&
      typeof payload.id === "string" &&
      payload.id.trim().length > 0
    ) {
      // Resolve the address through the SAME shared rule the mirror/renderer use, so a
      // UI deletion drops exactly the entry the skill would have cleared. An unresolvable
      // address is a safe no-op.
      const addr = resolveCanvasAddress({ step: payload.step, phase: payload.phase, id: payload.id });
      if (addr) {
        agentManager.recordCanvasDeletion(
          payload.sessionId,
          addr,
          payload.id,
          typeof payload.label === "string" ? payload.label : undefined
        );
        // A deletion is a categorical change to the evidence base, so the reading
        // can go stale on this very interaction — push the derived state so the
        // open panel marks it without waiting for a reload.
        emitMaturityState(payload.sessionId);
      }
    }
    return { ok: true };
  });

  // UI-initiated step focus (capability `agent-harness`, Requirement: Host-Set Step
  // Focus from the Canvas UI; capability `desktop-app`, Requirement: Design-Flow
  // Canvas). The lecturer selecting a step group is an action they have ALREADY
  // performed, so the host records it rather than asking the model for it: the step
  // mirror takes the exclusive focus at once and arms the focus notice the next
  // lecturer turn discloses. Deliberately NOT the prompt channel — nothing is
  // dispatched, no user turn is created, and nothing appears in the chat. The
  // renderer applies the equivalent focus locally; the mirror/notice are the
  // host-side half of the ONE focus pipeline.
  ipcMain.handle(Channels.stepFocus, async (_e, payload: StepFocusPayload): Promise<{ ok: true }> => {
    if (payload && typeof payload.sessionId === "string") {
      // An out-of-range or non-integer step is dropped by the mirror itself
      // (`isValidStepNumber`), which arms no notice for it either.
      agentManager.recordStepFocus(
        payload.sessionId,
        payload.step,
        typeof payload.label === "string" ? payload.label : undefined
      );
    }
    return { ok: true };
  });

  // Profile Panel surface (capability `desktop-app`, Requirement: Profile Panel).
  // `get` returns the persisted record ({} on cold start); `override` persists a
  // per-dimension lecturer override (provenance `override`, wins over estimates)
  // and queues a system note so every running session learns about it at its next
  // turn boundary.
  ipcMain.handle(Channels.lecturerProfileGet, async (): Promise<LecturerProfile> => {
    return (await lecturerProfileService.current()) ?? {};
  });

  ipcMain.handle(
    Channels.lecturerProfileOverride,
    async (_e, payload: LecturerProfileOverridePayload): Promise<LecturerProfileOverrideResult> => {
      if (!isProfileDimension(payload?.dimension) || typeof payload?.value !== "string") {
        return { ok: false, profile: (await lecturerProfileService.current()) ?? {} };
      }
      const profile = await lecturerProfileService.applyOverride(payload.dimension, payload.value);
      const applied =
        profile[payload.dimension]?.provenance === "override" && profile[payload.dimension]?.value === payload.value;
      if (applied) {
        agentManager.queueProfileNote(profileOverrideNote(payload.dimension, payload.value));
      }
      return { ok: applied, profile };
    }
  );

  // Per-lecturer IDENTITY record (capability `desktop-app`, Requirement: Lecturer
  // Identity in the User/Profile Area). A SEPARATE record from the profile above:
  // no dimension, no confidence, no provenance, no estimate path — the lecturer is
  // the only writer, and the assistant only ever reads the result through the
  // environment descriptor.
  ipcMain.handle(Channels.lecturerIdentityGet, async (): Promise<LecturerIdentity> => {
    return (await lecturerIdentityService.current()) ?? {};
  });

  ipcMain.handle(
    Channels.lecturerIdentitySet,
    async (_e, payload: LecturerIdentitySetPayload): Promise<LecturerIdentitySetResult> => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { ok: false, identity: (await lecturerIdentityService.current()) ?? {} };
      }
      const result = await lecturerIdentityService.write({
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        ...(typeof payload.formOfAddress === "string" ? { formOfAddress: payload.formOfAddress } : {}),
      });
      if (result.outcome === "rejected-too-long") {
        // Refused whole, with a reason the surface can show. Nothing was stored —
        // no silently shortened value ever reaches the record.
        return { ok: false, identity: result.identity, reason: "too-long" };
      }
      // Every running session learns about the change at its NEXT TURN BOUNDARY,
      // through the same queued-note seam a Profile Panel override uses — never
      // mid-turn. The note inert-encodes the value (see `lecturerIdentityChangeNote`).
      // Only a write that actually moved the record is worth a note: a Save click
      // that changed nothing is not news, and the button is always clickable.
      if (result.changed) {
        agentManager.queueProfileNote(lecturerIdentityChangeNote(result.identity));
      }
      return { ok: true, identity: result.identity };
    }
  );

  // Course workspace (capability `course-workspace`): create / list / rename /
  // switch. Discovery is a pure folder scan of <userData>/courses/ — no index.
  ipcMain.handle(Channels.courseList, async (): Promise<CourseListResult> => {
    const active = await resolveActiveCourse();
    const courses = await scanCourses(COURSES_ROOT);
    return { courses, activeCourseId: active.id };
  });

  ipcMain.handle(Channels.courseCreate, async (_e, title: string): Promise<CourseSummary> => {
    return createCourse(COURSES_ROOT, title);
  });

  ipcMain.handle(Channels.courseRename, async (_e, payload: { id: string; title: string }): Promise<CourseSummary> => {
    return renameCourse(COURSES_ROOT, payload.id, payload.title);
  });

  ipcMain.handle(Channels.courseSetActive, async (_e, id: string): Promise<CourseListResult> => {
    const course = await readCourse(COURSES_ROOT, id);
    if (!course) throw new Error(`Course not found: ${id}`);
    await writeActiveCourseId(WORKSPACE_STATE_PATH, id);
    const courses = await scanCourses(COURSES_ROOT);
    return { courses, activeCourseId: id };
  });

  // Open-in-file-manager affordance (Requirement: Local Location Shown as an
  // Open Affordance, Not a Raw Path): reveal the course folder (course.md
  // selected) or the course's wiki folder in the platform file manager.
  // Currently caller-less: the course detail view dropped its reveal controls
  // (change `resume-course-conversations`), and the IPC surface deliberately
  // stays for the conditional requirement — do not remove it as dead code.
  ipcMain.handle(Channels.courseReveal, async (_e, payload: { id: string; target: CourseRevealTarget }) => {
    const course = await readCourse(COURSES_ROOT, payload.id);
    if (!course) throw new Error(`Course not found: ${payload.id}`);
    const target =
      payload.target === "wiki" ? courseWikiDir(COURSES_ROOT, payload.id) : courseMdPath(COURSES_ROOT, payload.id);
    shell.showItemInFolder(target);
    return { ok: true as const };
  });

  // Wiki-ingestion run state, declared ahead of the course-delete handler that
  // reads it. The abort controller drives `cbe:wiki:ingest-abort`; the run
  // registry scopes each run to the course it writes into — an ingestion
  // resolves its target paths at WRITE time, so a deletion mid-run would
  // recreate the trashed folder at its old location.
  //
  // A COUNT per course, not a single slot: overlapping runs are reachable, and
  // with one slot the second run's cleanup cleared the registration of the first
  // while it was still writing. A guard a later run can tidy away is no guard —
  // every run releases exactly its own registration. Same shape as
  // `pendingSessionStarts`. The count stays although the start guard below now
  // makes a same-course overlap unreachable from this handler: the release, not
  // the guard, is what the count is for.
  //
  // This registry is ALSO the start guard (capability `lecturer-wiki`,
  // Requirement: An Ingest Belongs to the Course It Was Started In). It is
  // registered at handler entry and released in the run's `finally`, so it spans
  // the whole run and is scoped to the course the run belongs to — where the
  // abort controller it replaced in that role covered the atomization phase only
  // and refused across courses.
  const wikiIngestRuns = new Map<string, number>();

  // Live runs, one entry per run and never one slot for the process (capability
  // `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It Was Started
  // In). Runs in two courses can be in flight together once the lecturer
  // activates another course and ingests there, and with a single slot the
  // second run overwrote the first's controller while the first's cleanup then
  // cleared the second's: one course's abort control ended another course's run,
  // and the surviving run became unabortable for the rest of its life.
  //
  // The KEY is minted here, per run, and is deliberately NOT the caller's token:
  // the token is an assertion the caller may omit, and every tokenless run would
  // otherwise collide on the empty string and reproduce that same single-slot
  // loss. The token travels beside the controller instead, and only a non-empty
  // one resolves — a tokenless abort names nothing, so it reaches nothing.
  //
  // An entry exists only for the atomization phase, which is the only phase
  // holding something to signal — an abort naming a run that is not in the map
  // is undelivered, exactly as before, and the closing-notice rule that reads
  // `delivered` is unchanged.
  const wikiIngestAborts = new Map<number, { token: string; controller: AbortController }>();
  let wikiIngestAbortKeySeq = 0;

  function wikiIngestRunStarted(courseId: string): void {
    wikiIngestRuns.set(courseId, (wikiIngestRuns.get(courseId) ?? 0) + 1);
  }

  function wikiIngestRunFinished(courseId: string): void {
    const left = (wikiIngestRuns.get(courseId) ?? 1) - 1;
    if (left > 0) wikiIngestRuns.set(courseId, left);
    else wikiIngestRuns.delete(courseId);
  }

  /**
   * The deletion precondition (capability `course-workspace`, Requirement:
   * Course Deletion from the Detail View, Reversible via the OS Trash): returns
   * the refusal notice when something is still writing into this course's
   * folder, `null` when the deletion may proceed.
   *
   * Three sources, one check, all scoped to the course being deleted — work in a
   * DIFFERENT (background) course is none of this deletion's business:
   *
   *  1. A turn in flight in this course. The in-flight assistant turn is only
   *     persisted at the turn boundary, and its sidecars live in the very folder
   *     we are about to trash.
   *  2. A wiki ingestion running for this course. Its writes (atoms, raw status
   *     transitions, reflection logs) resolve paths at write time and would
   *     recreate the folder after the move.
   *  3. A conversation being opened OR started for this course — boot/switch
   *     hydration and the New Session reset alike (`conversationOpeningFor`).
   *     The session only becomes visible to `getByCourse` once `start` has
   *     resolved; inside that window the finishing start writes its sidecars —
   *     minted durable immediately — into the trashed folder. Deliberately no
   *     wait-and-recheck — a refusal the lecturer resolves by retrying beats a
   *     re-entrant path.
   */
  function courseDeleteRefusal(id: string): string | null {
    // Trashing the folder mid-run would take the sidecars the turn is about to be
    // flushed into — an in-flight assistant turn is only persisted at the turn
    // boundary (Requirement: Course Deletion from the Detail View, Reversible via
    // the OS Trash). Same family as `turnInFlightNotice`, worded for this action.
    if (agentManager.getByCourse(id)?.inFlight) return chrome().mainCourseDeleteInFlightNotice;
    // An ingestion resolves its target paths at write time, so trashing the folder
    // mid-run would recreate it at the old location and write atoms the trashed copy
    // never carries. The run is never cancelled implicitly — the lecturer confirmed a
    // course deletion, not the loss of minutes of reading work.
    if (wikiIngestRuns.has(id)) return chrome().mainCourseDeleteIngestingNotice;
    // The session only becomes visible to the in-flight check once it has started;
    // deleting inside that window would let the finishing start write its sidecars
    // back into the trashed folder. Resolves on its own, so the notice points at
    // simply trying again.
    if (conversationOpeningFor(id)) return chrome().mainCourseDeleteOpeningNotice;
    return null;
  }

  // Course deletion (capability `course-workspace`, Requirement: Course Deletion
  // from the Detail View, Reversible via the OS Trash). Reachable only from the
  // detail view — but UI placement is not authorization, so every guard the
  // requirement names is enforced HERE, immediately before the folder moves:
  //
  //  1. `courseDeleteRefusal` above — a running turn, a running ingestion or a
  //     conversation still opening in THIS course refuses the deletion. It is
  //     evaluated TWICE: once on entry, so a course that is already busy is
  //     never dumped-and-flushed for a deletion that cannot happen, and once
  //     after the flush, which is a real disk write the lecturer can act during.
  //     The second evaluation is the authoritative one — it is the one that sits
  //     immediately before the folder moves. What it buys, exactly: a writer
  //     that begins during the flush on its OWN path — a turn started, an
  //     ingestion begun, a conversation opened — can land its registration
  //     before this evaluation reads it, and then it refuses. None of those
  //     registrations is synchronous, so this is a race it can win, not a
  //     guarantee. And one path it can NEVER catch: a New Session reset for this
  //     course flushes the SAME session, per-session flushes are serialised, so
  //     its body — and its registration — is ordered strictly after this
  //     handler's continuation. See the requirement text; the arrangement as a
  //     whole is open (the `add-course-deletion` proposal).
  //  2. An idle open session is flushed and closed BEFORE the trash call, so the
  //     trashed folder carries the complete conversation (reversibility is only
  //     worth something if what comes back is whole) and no file handle is left
  //     open on a folder being moved. The CLOSE happens after the re-check, so a
  //     refusal does not take the conversation it just refused to delete — with
  //     one known, unfixed exception: the flush below runs with closing
  //     semantics, which promotes a pending partial draft into the live
  //     transcript, and after a refusal that session keeps running with it (see
  //     the requirement's "known defect"). A trash call that REJECTS re-opens
  //     the session, because "the operation failed" and "your session is gone"
  //     must not arrive together.
  //  3. The active course is RE-RESOLVED afterwards — `resolveActiveCourse`
  //     already encodes the exactly-one-active-course invariant (fall back to a
  //     remaining course, create a default one for an emptied Space) and
  //     persists the pointer. Deleting the active course is precisely the
  //     "persisted id no longer exists" case it was written for.
  //
  // A failed `shell.trashItem` REJECTS out of this handler; it is never
  // downgraded to an irreversible delete (see `deleteCourse`).
  ipcMain.handle(Channels.courseDelete, async (_e, id: string): Promise<CourseDeleteResult> => {
    const armed = courseDeleteRefusal(id);
    if (armed) throw new Error(armed);
    const open = agentManager.getByCourse(id);
    // Flush only — the session stays open across the re-check below.
    if (open) await flushSession(open.id, { closing: true });
    const refusal = courseDeleteRefusal(id);
    if (refusal) throw new Error(refusal);
    if (open) agentManager.close(open.id);
    let trashed: boolean;
    try {
      ({ trashed } = await deleteCourse(COURSES_ROOT, id, (target) => shell.trashItem(target)));
    } catch (err) {
      // Nothing moved, so nothing may stay changed. The closing flush above
      // wrote the session's sidecars, and a resume re-enters them under the
      // SAME sessionId — the id the renderer is still holding.
      if (open) await reopenAfterFailedDeletion(id);
      throw err;
    }
    // Carry-over snapshots keyed on the deleted course would otherwise outlive it
    // and be handed to a same-slug course created later.
    pendingCanvasCarryOver.delete(id);
    pendingDidacticCarryOver.delete(id);
    pendingRetainedCarryOver.delete(id);
    const active = await resolveActiveCourse();
    const courses = await scanCourses(COURSES_ROOT);
    return { courses, activeCourseId: active.id, trashed };
  });

  // Wiki ingestion (capability `lecturer-wiki`): original → inbox/, deterministic
  // extraction → raw/ (one extraction authority), atomization in ISOLATED
  // subagent sessions (never the lecturer's conversation), validator-gated atoms,
  // status raw→compiled on success, reflection log per run.
  // `token` names the RUN: the renderer generates it for the record it just
  // created, and every progress event of this run carries it back, so a late
  // event from a run the lecturer already ended cannot be applied to its
  // successor (capability `lecturer-wiki`, Requirement: An Ingest That Cannot
  // Reach the Model Fails Visibly and Stays Retryable).
  //
  // The COURSE is still resolved HERE and deliberately not accepted from the
  // caller — a surface may not decide where material is written. The payload's
  // `courseId` is an ASSERTION about the course the caller recorded the run
  // under, and the host's only use for it is to refuse a mismatch (capability
  // `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It Was Started
  // In). UI placement is not authorization: the wiki surface of a non-active
  // course no longer offers a start control, and this check is what makes that
  // a rule rather than a layout, including in the one window the layout cannot
  // cover — the lecturer switching course between their click and this line.
  ipcMain.handle(
    Channels.wikiIngest,
    async (_e, payload?: WikiIngestStartPayload): Promise<WikiIngestResult[] | null> => {
      const token = typeof payload?.token === "string" ? payload.token : "";
      const claimedCourseId = typeof payload?.courseId === "string" ? payload.courseId : "";
      const cfg = await loadConfig();
      if (!cfg) throw new Error(chrome().mainProviderNotConfigured);
      const activeCourse = await resolveActiveCourse();
      if (claimedCourseId && claimedCourseId !== activeCourse.id) {
        throw new Error(chrome().mainIngestWrongCourse({ course: activeCourse.title }));
      }
      // Per COURSE and for the WHOLE run — a run in another course refuses
      // nothing, which is what lets the lecturer ingest into the course they have
      // just activated while the previous course's run finishes. No `await` sits
      // between this check and the registration below, so the pair is atomic.
      if (wikiIngestRuns.has(activeCourse.id)) throw new Error(chrome().mainIngestAlreadyRunning);
      // Registered for the WHOLE run, not just the atomization phase: the
      // inbox/raw extraction below already writes into the course folder, so the
      // deletion guard has to see the run from here on. The id is captured in a
      // const so the `finally` releases THIS run's registration even when the
      // active course has moved on.
      const runCourseId = activeCourse.id;
      wikiIngestRunStarted(runCourseId);
      try {
        // Every path this run touches derives from the course captured at entry —
        // nothing below re-reads the active course, so activating another course
        // mid-run leaves the run exactly where it started.
        const courseDir = activeCourse.path;
        const wikiDir = courseWikiDir(COURSES_ROOT, runCourseId);

        const picked = await dialog.showOpenDialog(win, {
          title: chrome().mainIngestDialogTitle,
          properties: ["openFile", "multiSelections"],
          filters: [
            { name: chrome().mainIngestFilterMaterial, extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1)) },
          ],
        });
        if (picked.canceled || picked.filePaths.length === 0) return null;

        // Pre-flight (capability `lecturer-wiki`, Requirement: An Ingest That
        // Cannot Reach the Model Fails Visibly and Stays Retryable). Positioned
        // after the picker and BEFORE anything is copied into `inbox/` or
        // extracted into `raw/`: an ingest started with the inference server
        // stopped used to leave those documents behind for an atomization that
        // never happened, and this is the last point at which that costs nothing.
        // Running it ahead of the dialog instead would put up to four silent
        // seconds between the lecturer's click and the OS picker, which reads as
        // the hang this change removes.
        //
        // Only a DEFINITE NEGATIVE refuses, and the principle is one question:
        // an answer was received and the answer is no — as against no answer yet.
        // Everything else proceeds, and the two directions are load-bearing in
        // opposite ways (design.md D4):
        //
        //  - `unauthorized` and `http-error` — a minimal local server that answers
        //    `/chat/completions` but serves no `/models` route is the live case —
        //    mean something DID answer; those are facts about the endpoint's shape
        //    and credentials, not about reachability.
        //  - SLOWNESS IS NEVER A REFUSAL. `probeConnection`'s window elapsing says
        //    the endpoint has not answered YET, and a local model loading its
        //    weights is exactly that. Refusing on it would make the pre-flight a
        //    timer that fails the one case the silence deadline was sized to
        //    tolerate; that verdict belongs to the deadline, not here.
        //
        // An endpoint that dies a second after this probe is the deadline's
        // business too.
        const reachable = await probeConnection(cfg.baseURL, cfg.apiKey);
        if (!reachable.ok && reachable.cause === "unreachable" && reachable.definiteNegative) {
          throw new Error(chrome().mainIngestEndpointUnreachable({ baseURL: cfg.baseURL }));
        }

        // Stamped from the run's OWN course, captured at entry — never from the
        // course that happens to be active when the row lands. Both identities
        // travel with every event and answer different questions: the course says
        // which record the row belongs to, the token which run.
        const sendProgress = (p: Omit<WikiIngestProgressEvent, "courseId" | "token">) =>
          win.webContents.send(Channels.wikiIngestProgress, {
            courseId: runCourseId,
            token,
            ...p,
          } satisfies WikiIngestProgressEvent);

        // Layers 1+2: inbox + raw (app-side, deterministic — design.md D3).
        const files = await Promise.all(
          picked.filePaths.map(async (p) => ({ filename: path.basename(p), data: await readFile(p) }))
        );
        for (const f of files) sendProgress({ filename: f.filename, rawRelPath: "", status: "extracting" });
        const stored = await ingestIntoCourse(courseDir, files, { extractor: extractorId(app.getVersion()) });

        const results: WikiIngestResult[] = [];
        const docs: Array<{ rawRelPath: string; filename: string }> = [];
        for (const outcome of stored) {
          if (outcome.ok) {
            docs.push({ rawRelPath: outcome.rawRelPath, filename: outcome.filename });
          } else {
            results.push({ ok: false, filename: outcome.filename, status: "unsupported", error: outcome.message });
            sendProgress({ filename: outcome.filename, rawRelPath: "", status: "failed", error: outcome.message });
          }
        }

        // Layer 3: atomization in isolated subagent sessions (bounded parallel fan-out).
        // The controller is registered under a key minted for THIS run and
        // released under the same key, so an abort naming another run cannot
        // reach it and its own release cannot clear another's — including when
        // the caller supplied no token at all.
        const abortController = new AbortController();
        const abortKey = ++wikiIngestAbortKeySeq;
        wikiIngestAborts.set(abortKey, { token, controller: abortController });
        try {
          const factory = createPiAtomizationSessionFactory({
            courseDir,
            wikiDir,
            wikiSkillDir: resolveResource(path.join("skills", "wiki")),
            agentDir: path.join(app.getPath("userData"), "pi-agent"),
            provider: cfg,
          });
          const filenameByRaw = new Map(docs.map((d) => [d.rawRelPath, d.filename]));
          const outcomes = await runAtomization(
            docs.map((d) => ({ rawRelPath: d.rawRelPath })),
            factory,
            {
              courseDir,
              wikiDir,
              signal: abortController.signal,
              onProgress: (p) =>
                sendProgress({
                  filename: filenameByRaw.get(p.rawRelPath) ?? p.rawRelPath,
                  rawRelPath: p.rawRelPath,
                  status: p.status,
                  error: p.error,
                }),
            }
          );

          const skillVersion = await readWikiSkillVersion(resolveResource(path.join("skills", "wiki")));
          const date = new Date().toISOString().slice(0, 10);
          for (const o of outcomes) {
            const filename = filenameByRaw.get(o.rawRelPath) ?? o.rawRelPath;
            // Reflection log for every run — success and failure alike (Requirement:
            // Reflection Logs per Atomization and Session).
            await writeReflectionLog(courseDir, {
              date,
              rawRelPath: o.rawRelPath,
              skillVersion,
              status: o.status,
              summary: o.summary ?? "",
              atoms: o.atoms,
              notices: o.notices,
              error: o.error,
            }).catch((err) => console.error("[wiki] reflection log failed:", err));
            if (o.status === "done") {
              // raw → compiled ONLY on success; failures stay `raw` so the run can
              // be retried without duplicate atoms.
              await setRawStatus(courseDir, o.rawRelPath, "compiled").catch((err) =>
                console.error("[wiki] status transition failed:", err)
              );
              results.push({ ok: true, filename, rawRelPath: o.rawRelPath, atoms: o.atoms });
              // Disclose the landed atoms to the course's open conversation on its next
              // lecturer turn, and invalidate the index that conversation already holds
              // (capability `agent-harness`, Requirement: Newly Ingested Wiki Atoms Are
              // Disclosed on the Next Lecturer Turn). Successful outcomes only: a failed
              // or aborted document wrote no atom, so it has nothing to disclose.
              agentManager.recordWikiAtoms(runCourseId, o.atoms);
            } else {
              results.push({
                ok: false,
                filename,
                rawRelPath: o.rawRelPath,
                status: o.status,
                error:
                  o.error ??
                  (o.status === "aborted" ? chrome().mainIngestAborted : chrome().mainIngestAtomizationFailed),
              });
            }
          }
          return results;
        } finally {
          wikiIngestAborts.delete(abortKey);
        }
      } finally {
        wikiIngestRunFinished(runCourseId);
      }
    }
  );

  ipcMain.handle(
    Channels.wikiIngestAbort,
    async (
      _e,
      runToken?: string
    ): Promise<{
      ok: true;
      delivered: boolean;
    }> => {
      // Kills only the ingestion sessions of the run NAMED — the lecturer's
      // session is untouched, and so is every other run (capability
      // `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It Was
      // Started In). A run in another course is none of this abort's business:
      // ending it here is the loss rule 2 forbids, and it happened whenever two
      // runs shared the one controller slot this registry replaced.
      //
      // `delivered` reports whether there was anything to signal. A run holds a
      // controller only for its atomization phase, so an abort dispatched during
      // the pre-flight or the inbox/raw extraction reaches nothing and that run
      // keeps going; so does an abort naming a run that has already finished. The
      // renderer ends its record either way — that is the recovery guarantee —
      // but it must not tell the lecturer the ingest was aborted when it was not
      // (capability `lecturer-wiki`, Requirement: An Ingest That Cannot Reach the
      // Model Fails Visibly and Stays Retryable).
      //
      // A token is what NAMES a run, so an empty or missing one names nothing and
      // must not fall through to some arbitrary run.
      const wanted = typeof runToken === "string" ? runToken : "";
      let controller: AbortController | undefined;
      if (wanted) {
        for (const held of wikiIngestAborts.values()) {
          if (held.token === wanted) {
            controller = held.controller;
            break;
          }
        }
      }
      controller?.abort();
      return { ok: true, delivered: controller !== undefined };
    }
  );

  // Wiki browse/search surface (Requirement: Wiki Is Browsable and Searchable
  // in the App): scan the active course's wiki via the shared validator engine.
  ipcMain.handle(Channels.wikiList, async (_e, courseId: string): Promise<WikiListResult> => {
    const wikiDir = courseWikiDir(COURSES_ROOT, courseId);
    let scanned;
    try {
      scanned = await validateDirectory(wikiDir, "wiki");
    } catch {
      return { atoms: [], invalid: [] };
    }
    const atoms: WikiAtomSummary[] = [];
    const invalid: WikiListResult["invalid"] = [];
    for (const r of scanned) {
      const relPath = path.relative(wikiDir, r.path).split(path.sep).join("/");
      if (!r.ok) {
        invalid.push({ relPath, errors: r.errors });
        continue;
      }
      const doc = r.doc as WikiAtom;
      atoms.push({
        relPath,
        title: path.basename(relPath, ".md"),
        type: doc.type,
        aliases: doc.aliases,
        related: doc.related,
        confidence: doc.confidence,
        updated: doc.updated,
        body: r.body,
      });
    }
    atoms.sort((a, b) => a.title.localeCompare(b.title));
    return { atoms, invalid };
  });

  ipcMain.handle(Channels.loadCitation, async (_e, id: string): Promise<CitationDetail | null> => {
    // ONE channel, two stores, discriminated by the id the renderer carried through:
    // a `wiki:`-prefixed id names an atom of the ACTIVE course's wiki — the same
    // course/wiki resolution the wiki handlers use — and a bare id stays corpus. An
    // unresolvable id in either store answers `null`, which the overlay's not-found
    // state covers (capability `desktop-app`, Requirement: *A Wiki Citation Token
    // Renders as the Same Citation Link and Opens the Shared Overlay Unverified*).
    if (id.startsWith(WIKI_CITATION_PREFIX)) {
      const activeCourse = await resolveActiveCourse();
      return loadWikiCitationDetail(courseWikiDir(COURSES_ROOT, activeCourse.id), id);
    }
    const resolver = await getResolver();
    const hit = resolver.resolve(id);
    if (!hit) return null;
    // `loadBody` hands back the raw file. The detail is a READING surface, so the
    // payload carries the prepared Markdown body instead — frontmatter stripped, the
    // head's own title not repeated as a leading heading (capability `desktop-app`,
    // Requirement: *The Citation Detail Renders the Cited Source as Markdown*).
    const body = await resolver.loadBody(id);
    return {
      store: "corpus",
      hit,
      "corpus-version": resolver.getVersion(),
      body: citationMarkdownBody(body ?? "", hit.title),
    };
  });

  // Citation verification (capability `desktop-app`, Requirement: *A Citation Token Is
  // Verified Against the Corpus Before It Is Linked*).
  //
  // WHY THIS IS A MAIN-PROCESS OBLIGATION. The corpus lives on the filesystem and the
  // renderer never touches it. And why it is answered LAZILY per token rather than
  // stamped onto the turn: assistant text STREAMS, so a token is only complete at turn
  // end, and a persisted turn re-rendered on session reopen would carry no verdict
  // unless the verdict were persisted too — which would put a derived fact into the
  // sidecar, where it goes stale against the next corpus version.
  //
  // The identity prompt routes every token through `cbe_cite` and licenses no
  // self-written one (product decision 2026-08-18, superseding the ruling of
  // 2026-08-10), so this handler is the backstop for the tokens that arrive without a
  // call behind them anyway. `cbe_cite` checks the section for the tokens it produces,
  // and this checks it for the ones it did not. Both go through the SAME verifier, so
  // the two can never disagree.
  ipcMain.handle(Channels.verifyCitation, async (_e, req: CitationVerifyRequest): Promise<CitationVerification> => {
    const resolver = await getResolver();
    const hit = resolver.resolve(req.id);
    // `null` headings means "no such document", which the verifier reports as
    // `unknown-id` — distinct from a document that simply has no headings.
    const headings = hit ? await resolver.resolveHeadings(req.id) : null;
    return verifyCitation(req.id, req.section, headings);
  });

  ipcMain.handle(Channels.ingestFile, async (): Promise<IngestOutcome[] | null> => {
    // File access stays in the main process — the renderer never touches the fs.
    // Stub stage only: extract text and hand it back; no atomization, no wiki write.
    const picked = await dialog.showOpenDialog(win, {
      title: chrome().mainIngestFileDialogTitle,
      properties: ["openFile", "multiSelections"],
      filters: [{ name: chrome().mainIngestFilterMaterial, extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1)) }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    // One outcome per selected file, in selection order; per-file isolation
    // lives in ingestPaths.
    return ingestPaths(picked.filePaths, readFile);
  });

  ipcMain.handle(Channels.getCommands, async (_e, sessionId: string): Promise<SlashCommand[]> => {
    // pi merges built-ins + our extension commands in one list; filter to the
    // UI-relevant set (allowlisted built-ins + app extension commands) before it
    // crosses to the renderer. No renderer-side command registry exists.
    return filterUiCommands(agentManager.getCommands(sessionId));
  });

  ipcMain.handle(Channels.closeSession, async (_e, sessionId: string): Promise<{ ok: true; path?: string }> => {
    // Main-side in-flight guard: no IPC path may dispose a running run — the
    // in-flight assistant turn would be aborted and lost. A course switch no
    // longer routes through here (the outgoing session stays open in the
    // background); this guard protects against EXPLICIT closes of a running
    // conversation (capability `course-workspace`, Requirement: Active Course
    // and Course Switching).
    const s = agentManager.get(sessionId);
    if (s?.inFlight) throw new Error(turnInFlightNotice());
    // Closing flush: dual write through the serialised, atomic path (capability
    // `agent-harness`, Requirement: Sessions as Local Markdown/JSON Files) —
    // includes a pending partial draft as the final assistant turn. Sidecars land
    // in the folder of the course the session was started in. The returned path
    // is the Markdown one (the human-readable face).
    const writtenPath = await flushSession(sessionId, { closing: true });
    agentManager.close(sessionId);
    return writtenPath ? { ok: true, path: writtenPath } : { ok: true };
  });

  // Corpus bundle channel (capability `distribution`, Requirement: Corpus
  // Distribution as Downloadable Bundle / Scenario: Corpus version auditable
  // from the app).
  ipcMain.handle(Channels.corpusInfo, async () => corpusInfo(CORPUS_UPDATER_PATHS));

  ipcMain.handle(Channels.corpusRefresh, async () => runCorpusRefresh());

  // Read-only facts behind the settings About group (capability `desktop-app`,
  // Requirement: Settings Panel (Phase 1 scaffold)). Both figures are read from
  // their real sources here — the packaged app version and the loaded skill's
  // frontmatter — so neither can be stated by a literal in the renderer.
  ipcMain.handle(Channels.aboutInfo, async (): Promise<AboutInfo> => {
    const skill = await readSkillIdentity(currentSkillMdPath());
    const distributed = await skillInfo(SKILL_UPDATER_PATHS);
    return {
      appVersion: app.getVersion(),
      skillName: skill.name,
      skillVersion: skill.version,
      skillUpdate: skillUpdateStatus(),
      ...(distributed.pack ? { skillPack: distributed.pack } : {}),
    };
  });
}

export async function teardownIpc(): Promise<void> {
  const ids = agentManager.listIds();
  for (const id of ids) {
    try {
      // Closing flush through the same serialised, atomic path as an explicit
      // close — teardown must not interleave with a still-queued turn flush.
      await flushSession(id, { closing: true });
    } catch (err) {
      console.error(`Failed to write session ${id}:`, err);
    }
  }
  agentManager.closeAll();
}
