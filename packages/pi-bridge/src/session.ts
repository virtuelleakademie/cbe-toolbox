/**
 * CBE session orchestrator.
 *
 * ADAPTATION NOTES (verified against @earendil-works/pi-coding-agent@1.3.0 source):
 *
 * 1. `createAgentSession` has NO `systemPromptAddendum` option.
 *    We REPLACE the default pi-coding-agent system prompt entirely via
 *    `DefaultResourceLoaderOptions.systemPrompt` (CBE identity, see cbe-system-prompt.ts).
 *    The host's environment descriptor is APPENDED via `appendSystemPromptOverride`.
 *    The default coding-agent wording never appears in the final system prompt.
 *
 * 2. `SessionManager.fromDirectory(dir)` does NOT exist.
 *    The real API is `SessionManager.create(cwd, customDir?)`.
 *    We use `SessionManager.create(cwd, opts.sessionsDir)` so sessions are stored
 *    in the configured directory, not the cwd default.
 *
 * 3. The BYO provider is registered on the session's public `ModelRuntime`
 *    (`ModelRuntime.registerProvider(name, ProviderConfigInput)`). See provider.ts.
 *
 * 4. `Skill.disableModelInvocation`, `Skill.baseDir`, `Skill.sourceInfo` — all VERIFIED
 *    as real fields in the Skill type (packages/coding-agent/src/core/skills.ts).
 *    `createSyntheticSourceInfo` is also VERIFIED as a real export.
 *
 * 5. Model/auth ownership is one public `ModelRuntime` per session (no
 *    `models.json`, auth file under `agentDir`), built by the shared primitive
 *    `runtime/pi-model.ts`; settings and resource discovery are explicit
 *    (`runtime/pi-config.ts`), so no process-global environment is needed.
 *
 * 7. The model-visible prompt text is CBE's (`runtime/legacy-system-prompt.ts`),
 *    forced onto every request by `runtime/request-parity-extension.ts`, which
 *    also keeps Pi's derived output-token cap off agent requests.
 *
 * 6. This module is a Pi ADAPTER module (capability `agent-harness`, Requirement:
 *    *Pi Runtime Is Hidden Behind a CBE-Owned Port*): the Pi session it builds
 *    never leaves it. The host receives the CBE-owned `CbeSessionPort`
 *    (`runtime/contracts.ts`) with normalized events — see `runtime/pi-session-port.ts`.
 */

import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  SessionManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  buildEnvironmentDescriptor,
  type EnvironmentDescriptor,
  type EnvironmentProfile,
  type LecturerStateLayers,
  type PathBindings,
} from "./environment.js";
import type { ProviderConfig } from "./provider.js";
import type { CbeSessionPort } from "./runtime/contracts.js";
import { createPiModelBinding } from "./runtime/pi-model.js";
import { CBE_RESOURCE_POLICY, createCbeSettingsManager } from "./runtime/pi-config.js";
import { composeLegacySystemPrompt } from "./runtime/legacy-system-prompt.js";
import { createRequestParityExtension, REQUEST_PARITY_HOOK } from "./runtime/request-parity-extension.js";
import { adaptPiSession } from "./runtime/pi-session-port.js";
import { buildCbeSkillBlock, cbeIdentityPrompt } from "./cbe-system-prompt.js";
import { createPickerTool } from "./picker-tool.js";
import { createCanvasTool } from "./canvas-tool.js";
import { StepMirror, type StepCoverageEntry } from "./step-mirror.js";
import { PendingAnswerGate, coherenceGatePassed } from "./pending-answer-gate.js";
import type { MaturitySnapshot } from "./maturity-mirror.js";
import { CanvasMirror, type CanvasArtefactEntry } from "./canvas-mirror.js";
import { createCiteTool } from "./cite-tool.js";
import { profileTool } from "./profile-tool.js";
import { createStepTool } from "./step-tool.js";
import { createMaturityTool } from "./maturity-tool.js";
import { MaturityMirror, withDerivedOverall } from "./maturity-mirror.js";
import { DesignSignal } from "./design-substance.js";
import { RetainedStateHandover } from "./retained-state-handover.js";
import { replayMaturityMirror } from "./maturity-replay.js";
import type { LecturerProfile } from "./lecturer-profile.js";
import type { LecturerIdentity } from "./lecturer-identity.js";
import {
  InMemoryLecturerSupportStore,
  LecturerSupportDisclosure,
  LecturerSupportService,
  type LecturerSupportHost,
} from "./lecturer-support.js";
import { createSupportTool } from "./support-tool.js";
import { createCitationResolver, type CitationResolver } from "./citations.js";
import { createCbeCommandsExtension, type CbeCommandsConfig, type CbeSlashCommand } from "./cbe-commands-extension.js";
import {
  COMPACTION_COMPANION_HOOK,
  createCompactionCompanionExtension,
  type CompactionCompanionConfig,
  type CompanionPhase,
} from "./compaction-companion-extension.js";
import { createPayloadHardeningExtension, PAYLOAD_HARDENING_HOOK } from "./payload-hardening-extension.js";
import { createWikiPrecedenceLookup } from "./wiki-retrieval.js";
import { createWikiCitationResolver } from "./wiki-citation.js";
import { WikiRetrievalGate } from "./wiki-index.js";
import { createWikiTool } from "./wiki-tool.js";
import { TurnStopController } from "./turn-stop.js";
import { createFencedFileToolsExtension, type WritableRoots } from "./write-fence.js";
import { CBE_CUSTOM_TOOL_NAMES, CBE_TOOL_ALLOWLIST } from "./skill-compatibility.js";
export { CBE_TOOL_ALLOWLIST } from "./skill-compatibility.js";

export interface StartSessionOptions {
  profile: EnvironmentProfile;
  skillDir: string;
  sessionsDir: string;
  /**
   * The host's session id. When set, Pi's session record is PINNED to it (the
   * session JSONL is named `<timestamp>_<sessionId>.jsonl`), which makes the
   * session's own record discoverable — the same-session maturity-mirror rebuild
   * on resume depends on it (capability `agent-harness`, Requirement: Host-Side
   * Session Maturity Mirror). Omit (headless/tests) for a Pi-generated id.
   */
  sessionId?: string;
  /** App-isolated pi-coding-agent home (e.g. <userData>/pi-agent). MUST be set by the host
   * so pi-coding-agent never touches the user's global ~/.pi/ installation. */
  agentDir: string;
  cwd?: string;
  /**
   * Targeted affordance overrides merged onto the profile defaults (capability
   * `agent-harness`, Requirement: cbe_canvas Generative-UI Tool — eval
   * exercisability). The eval harness uses this to enable the `canvas` affordance
   * in the environment descriptor so the explicit-clear / ambiguous-clear
   * scenarios are exercisable end-to-end. Omit in the app (profile defaults win).
   */
  affordances?: Partial<import("./environment.js").Affordances>;
  /**
   * On-disk paths surfaced to the model via the environment descriptor block.
   * `workspace` defaults to `cwd` if omitted. Corpus + wiki must be passed by the host
   * if you want the model to see them — there is no auto-discovery on the bridge side.
   */
  paths?: Partial<PathBindings>;
  provider: ProviderConfig;
  /**
   * Optional slash-command wiring. When provided, an app-authored Pi extension is
   * registered (via `extensionFactories`) that exposes `/cite`. Omit
   * in headless contexts that don't surface a composer. See cbe-commands-extension.ts.
   */
  commands?: CbeCommandsConfig;
  /**
   * Persisted per-lecturer profile loaded by the host (capability `agent-harness`,
   * Requirement: Session-Start Profile Injection). When present and non-empty it is
   * rendered as a `lecturer-profile prior` block in the environment descriptor so a
   * returning lecturer is not re-scaffolded from zero. Omit for cold start.
   */
  lecturerProfile?: LecturerProfile;
  /**
   * Per-lecturer IDENTITY record loaded by the host (capability `agent-harness`,
   * Requirement: Session-Start Identity Injection): the lecturer's name and their
   * preferred form of address, both optional. Rendered as a `lecturer-identity`
   * block in the environment descriptor when at least one field is recorded, with
   * both values inert-encoded.
   *
   * NOT a sixth lecturer-state dimension and deliberately a separate option from
   * `lecturerProfile`: these are facts the lecturer stated about themselves, carry
   * no confidence / evidence / provenance, and no tool can write them. Omit — or
   * pass a record with nothing recorded — and the descriptor is byte-identical to
   * the one composed without the feature.
   */
  lecturerIdentity?: LecturerIdentity;
  /**
   * The lecturer's separate support-preference service (capability `agent-harness`,
   * Requirement: Separate Lecturer-Wide Support Preference). The desktop app passes
   * its ONE lecturer-wide, file-backed service, shared by every open session so a
   * change in one conversation reaches the others; `cbe_support` writes through it
   * and its current snapshot is rendered as the descriptor's `lecturer-support`
   * block. Omit and the session gets its own in-memory service reporting
   * `session-local` storage — the tool and the block are registered uniformly
   * either way, so a headless or eval session has the app's surface.
   */
  lecturerSupportService?: LecturerSupportHost;
  /**
   * Raw `course.md` content of the active course (capability `course-workspace`,
   * Requirement: Course Context in course.md). When present it is rendered as a
   * course-context block in the environment descriptor so the skill begins the
   * substantive work from the persisted course facts instead of re-eliciting them.
   */
  courseContext?: string;
  /**
   * Canvas artefacts carried over from the previous conversation (capability
   * `agent-harness`, Requirement: Session-Start Canvas Artefact Injection). The
   * host snapshots them from the OUTGOING session's host-side canvas mirror
   * (Requirement: Host-Side Canvas Artefact Mirror) — never from the renderer
   * store. When present with at least one non-empty value they are rendered as a
   * defensively encoded, size-capped `canvas prior` block in the environment
   * descriptor AND pre-seeded into the fresh session's mirror (so the renderer
   * re-hydrates the kept panel from `canvasMirror.list()` and a second reset
   * carries them again). Omit (or pass empty) for a cold start — the descriptor
   * is then byte-identical to today's.
   */
  canvasArtefacts?: ReadonlyArray<CanvasArtefactEntry>;
  /**
   * Design-flow step coverage carried over by a New Session reset (capability
   * `desktop-app`, Requirement: New Session Control With Canvas Carry-Over). Same
   * discipline as `canvasArtefacts`: snapshotted host-side from the OUTGOING
   * session's step mirror, pre-seeded into the fresh session's mirror and rendered
   * as a `step-coverage prior` block (capability `agent-harness`, Requirement:
   * Session-Start Retained-State Injection). Omit for a cold start.
   */
  stepCoverage?: ReadonlyArray<StepCoverageEntry>;
  /**
   * Seed the host's initial step orientation (capability `agent-harness`,
   * Requirement: *Host-Set Initial Step Focus*): a design with no recorded work is
   * at step 1, the host knows that with certainty, and routing a certainty through
   * the model turns it into a request.
   *
   * The host passes it for a genuinely fresh start, and for an ordinary
   * resume/reopen whose durable design state is empty — a sidecar or conversation
   * created merely by opening the course is not design work. Never for a New
   * Session carry-over (even an empty one) and never for a transcript-only
   * restore such as replay/import, which bring their own state or supply none to
   * inspect. It is applied to the session's own mirror through
   * `StepMirror.seedInitialFocus()`, so the mirror KNOWS the focus is a default:
   * the descriptor's step prior and the renderer's hydration carry it, while the
   * persisted course record and the post-compaction handover — both of which mean
   * recorded work — read `recordedList()` and see nothing. The prior's own wording
   * needs no flag: the descriptor derives "no coverage recorded yet" from a step
   * list in which every depth is still `open`. Ignored when `stepCoverage` carries
   * real state.
   */
  initialStepFocus?: boolean;
  /** Maturity reading carried over by a New Session reset — seeded into the fresh
   * session's mirror AND rendered as a `maturity prior` block. */
  maturity?: Record<string, { current?: unknown; target?: unknown; note?: string }>;
  /** Decision artefacts carried over, pre-summarised to one compact line for the
   * `decisions prior` block. */
  decisionsSummary?: string;
  /**
   * The two Lecturer-State layers (capability `course-workspace`, Requirement:
   * Lecturer-State as Global Profile plus Per-Course Overlay), read by the host at
   * session start. Rendered as a `lecturer-state layers` block in the descriptor.
   */
  lecturerState?: LecturerStateLayers;
  /**
   * Resume a stored session (capability `course-workspace`, Requirement: Project
   * View Lists Stored Sessions and Supports Resume): the prior conversation —
   * read by the host from the session's JSON sidecar — is seeded turn by turn
   * into the fresh pi session's SessionManager BEFORE the agent session is
   * created, so `createAgentSession` picks it up as existing conversation
   * context (pi's own continue-session mechanism; `buildSessionContext()`
   * resolves the seeded messages). Omit for a fresh session.
   */
  resume?: { turns: ReadonlyArray<ResumeTurn> };
  /**
   * Compaction-companion host wiring (capability `agent-harness`, Requirement:
   * Compaction Companion — Artefact Consolidation Before Context Compaction).
   * The companion extension itself is ALWAYS registered (app + headless,
   * uniform surface); this option only binds the host-side accessors: the
   * per-lecturer profile store reader (defaults to the session-start
   * `lecturerProfile` snapshot), the companion-phase signal for renderer
   * visibility, and the documented small-context error surface.
   *
   * `getMaturity`, `onCompacted` and `onCompactionRefused` are NOT host-supplied:
   * the bridge binds them to this session's own maturity mirror and to the
   * retained-state handover it returns. The host reaches the handover through
   * `StartCbeSessionResult`. `getDecisionsSummary` is host-supplied (the
   * didactic-check store lives in the app) and feeds the handover's decisions
   * section.
   */
  compaction?: Omit<
    CompactionCompanionConfig,
    "canvasMirror" | "getMaturity" | "onCompacted" | "onCompactionRefused"
  > & {
    /** Recorded decision artefacts, pre-summarised to one compact line — the same
     *  shape the session-start `decisions prior` carries. Read at handover time. */
    getDecisionsSummary?: () => string | null | undefined;
  };
  /**
   * Is a lecturer turn dispatched and not yet resolved (capability
   * `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn* — the
   * pre-run latch)? The host's own in-flight flag, which is engaged from the
   * moment the prompt is dispatched, whereas the runtime's own streaming flag
   * only rises at `agent_start`. The stop needs the WIDER window: the gap
   * between the two is exactly where a lecturer changes their mind.
   *
   * Omit in headless contexts and the bridge falls back to the runtime's
   * streaming flag, so a stop there is still correct — only blind to that gap.
   */
  hasPendingTurn?: () => boolean;
  /** Bound for the stop's wait on the run end (tests). Defaults to
   * `TURN_STOP_TIMEOUT_MS`. */
  turnStopTimeoutMs?: number;
  /**
   * The session's writable roots for the file-mutation tools (capability
   * `agent-harness`, Requirement: Path-Fenced File Mutation Tools). `write` and
   * `edit` are ALWAYS registered behind the host-built path fence — never as
   * pi's unfenced built-ins — and the fence is deny-by-default: a host that
   * omits this gets a session in which every `write`/`edit` call is refused.
   * Built by application code from host arguments only; no model-reachable
   * channel (prompt, tool argument, ingested content, file inside the Space)
   * contributes to it, and the set is fixed for the life of the session.
   */
  writableRoots?: WritableRoots;
}

/** One stored conversation turn to seed into a resumed session. */
export interface ResumeTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * The agent's tool allowlist: the file-system operations the lecturer's wiki and
 * course workspace need, plus the registered CBE customTools — AND NO SHELL
 * (capability `agent-harness`, Requirement: *Tool Allowlist Excluding Shell
 * Execution*).
 *
 * `bash` is absent on EVERY platform. It was introduced for wiki tooling that in
 * the end does not need it: no use case for shell execution is documented in the
 * skill, the prompt or any spec, and every eval scenario ran with the shell off,
 * so the branch that existed in production was the one never measured. What DID
 * exist in production was a contradiction — the identity prompt stated
 * unconditionally that there is no shell while the tool schema and the descriptor
 * reported one. Removing the capability makes that sentence true again, which is
 * the cheaper and safer of the two repairs.
 *
 * `cbe_decision_checklist` is likewise absent (product decision, 2026-08-06): it
 * carried no trigger rule in any instruction channel and appeared in no scenario,
 * so it cost schema on every request for undefined behaviour. Its tool module and
 * its renderer component STAY in the tree — a progress surface for the ten-step
 * flow may still want them.
 *
 * The list is profile-independent: the same tools are exposed in the app and
 * headless profiles so a headless eval rerun reproduces the live app's prompt
 * surface exactly.
 */
export interface StartCbeSessionResult {
  /**
   * The CBE-owned session port (capability `agent-harness`, Requirement: *Pi
   * Runtime Is Hidden Behind a CBE-Owned Port*): prompt, steer, abort, dispose,
   * normalized event subscription, context usage, provider re-bind and command
   * enumeration — and no way back to the Pi session underneath.
   */
  session: CbeSessionPort;
  env: EnvironmentDescriptor;
  skillBody: string;
  /**
   * Host-side canvas artefact mirror (capability `agent-harness`, Requirement:
   * Host-Side Canvas Artefact Mirror). Updated from every valid `cbe_canvas` call
   * and from UI-initiated deletions; queryable by harness features. The host wires
   * the UI-deletion path (canvas delete control) into `recordUiDeletion` and drains
   * its pending notices onto the next lecturer turn's payload.
   */
  canvasMirror: CanvasMirror;
  /** Host-side step-coverage mirror (capability `agent-harness`, Requirement:
   * Deterministic Tool-Boundary Enforcement…). Feeds the depth-ladder guard, the
   * derived focus, and the step-coverage prior of a New Session carry-over. */
  stepMirror: StepMirror;
  /** Per-run outstanding-question gate. The host resets it at the `agent_start`
   * boundary; while a picker/checklist emitted in the current run is unanswered,
   * mirroring writes are refused (Requirement: Deterministic Tool-Boundary
   * Enforcement…). */
  pendingAnswerGate: PendingAnswerGate;
  /**
   * Host-side session maturity mirror (capability `agent-harness`, Requirement:
   * Host-Side Session Maturity Mirror). Fed by every valid `cbe_maturity` call;
   * its snapshot rides the renderer boot-hydration / `conversationOpen` payload.
   * On resume (`opts.resume` + `opts.sessionId`) it is rebuilt by replaying the
   * session's own persisted `cbe_maturity` calls before this result is returned —
   * the migration fallback for a course predating the design-state record.
   * In-memory and the runtime authority; the reading itself is COURSE-scoped: the
   * host restores it on course open and writes the snapshot back at every turn
   * boundary (Requirement: Course Design-State Store). The mirror never writes to
   * disk itself.
   */
  maturityMirror: MaturityMirror;
  /**
   * Host-side design-substance and revision signal (capability `agent-harness`,
   * Requirement: Host-Side Design-Substance and Revision Signal). The single
   * authority for the substance verdict, the design-revision counter, and the
   * staleness derivation. The host reads it for the hydration snapshot's derived
   * state, the Maturity Panel's framing, and the standing staleness notice; it
   * also records a completed material ingestion into it (the one settled design
   * change the mirrors cannot observe on their own).
   */
  designSignal: DesignSignal;
  /**
   * Post-compaction retained-state handover (capability `agent-harness`,
   * Requirement: Post-Compaction Retained-State Handover). Armed by every
   * COMPLETED compaction; the host drains it into the next lecturer turn's
   * payload, alongside the canvas deletion notices. Renders from the live mirrors
   * at drain time, so it hands over the current truth and N compactions before
   * one turn yield exactly one block.
   */
  retainedStateHandover: RetainedStateHandover;
  /**
   * The lecturer's stop on a running turn (capability `agent-harness`,
   * Requirement: *A Lecturer Can Stop a Running Turn*). Built on pi's public
   * `abort()` + `clearQueue()`; the host drives its run boundaries
   * (`noteRunStart` / `noteRunEnd`) from the `agent_start` / terminal
   * `agent_end` events it already subscribes to, and reads
   * `stoppedForCurrentRun()` to disarm the detectors, keep the abort's own
   * stream error off the provider-error path, and mark the persisted turn.
   *
   * The loop breaker (Requirement: *Tool-Call Loop Remediation*) claims the same
   * run end through `claimRunEnd("loop-breaker")`, which is what keeps the two
   * aborts distinguishable and yields exactly ONE run end and one recovery.
   */
  turnStop: TurnStopController;
  /**
   * This session's wiki retrieval gate (capability `agent-harness`, Requirement:
   * *cbe_wiki Wiki-Retrieval Tool with a Forced Index-First Route*). The host holds
   * it to arm the newly-ingested-atoms notice and to invalidate a delivered index
   * when material lands mid-session; `cbe_wiki` reads it on every call.
   */
  wikiIndexGate: WikiRetrievalGate;
  /**
   * This session's next-prompt disclosure of the support preference (capability
   * `agent-harness`, Requirement: Separate Lecturer-Wide Support Preference). The
   * host asks it before each lecturer prompt whether the store's revision has moved
   * past what this session saw (or a compaction may have dropped it), prefixes the
   * current snapshot when due, and marks it delivered once the payload reached the
   * model. Derived, so a refused prompt consumes nothing.
   */
  supportDisclosure: LecturerSupportDisclosure;
  /** The support service this session reads and writes — the host's shared one, or
   *  the session's own in-memory one when the host supplied none. */
  lecturerSupportService: LecturerSupportHost;
}

export async function startCbeSession(opts: StartSessionOptions): Promise<StartCbeSessionResult> {
  const cwd = opts.cwd ?? process.cwd();

  // Captured once the command extension is live (see onReady below). Stays the
  // empty-list default in headless / no-command contexts.
  let getCommands: () => CbeSlashCommand[] = () => [];

  // The shared construction primitive: one public ModelRuntime with the BYO
  // provider registered at runtime (see runtime/pi-model.ts).
  const modelBinding = await createPiModelBinding(opts.provider, opts.agentDir);
  const { modelRuntime, model, provider, modelId } = modelBinding;
  // Explicit, in-memory settings (runtime/pi-config.ts): no settings.json is read.
  const settingsManager = createCbeSettingsManager();

  // Load the SKILL.md body for reference (returned in result for downstream use)
  const skillBody = await readFile(path.join(opts.skillDir, "SKILL.md"), "utf8");

  const skill: Skill = {
    name: "cbe",
    description: "CBE skill v0.1",
    filePath: path.join(opts.skillDir, "SKILL.md"),
    baseDir: opts.skillDir,
    sourceInfo: createSyntheticSourceInfo(path.join(opts.skillDir, "SKILL.md"), { source: "cbe-toolbox" }),
    // The body is EAGERLY included in the system prompt below (capability
    // `agent-harness`, Requirement: *Eager Skill-Body Instruction Budget*), so no
    // session depends on the model `read`ing SKILL.md. Under the lazy load this
    // replaces, pi's `read` truncated at 50 KB and delivered 62.3 % of a
    // 79,977-character body — citation discipline, anti-sycophancy and the
    // student-data refusal all sat behind the cut, while the prompt simultaneously
    // forbade the continuation and a compaction threw the read away entirely.
    // The corpus-index read stays mandatory in the identity prompt: THAT is what
    // keeps the model touching the filesystem, which is the reason lazy load was
    // restored the last time the body was eager.
    // The skill stays REGISTERED so `/skill:cbe` and `baseDir` resolution keep working.
    disableModelInvocation: false,
  };

  const skillBlock = buildCbeSkillBlock({
    skillBody,
    name: skill.name,
    filePath: skill.filePath,
    baseDir: opts.skillDir,
  });

  // Created BEFORE the descriptor so the host's initial orientation is established
  // in time for the step prior of the very first session a lecturer sees — and so
  // the mirror that holds it knows it is a default rather than carried-over
  // coverage (capability `agent-harness`, Requirement: *Host-Set Initial Step
  // Focus*). Real carry-over wins; the seed only ever lands on a pristine mirror.
  const stepMirror = new StepMirror();
  if (opts.stepCoverage && opts.stepCoverage.length > 0) stepMirror.seed(opts.stepCoverage);
  else if (opts.initialStepFocus) stepMirror.seedInitialFocus();
  const seededStepFocus = stepMirror.holdsOnlySeededFocus() ? stepMirror.list() : null;

  // The support preference (Requirement: Separate Lecturer-Wide Support Preference).
  // Read once for the descriptor; the disclosure then starts at that revision, so an
  // already-current session gets no redundant notice on its first prompt.
  const lecturerSupportService =
    opts.lecturerSupportService ?? new LecturerSupportService(new InMemoryLecturerSupportStore(), "session-local");
  const supportSnapshot = await lecturerSupportService.current();
  const supportDisclosure = new LecturerSupportDisclosure(lecturerSupportService, supportSnapshot.revision);

  const env = buildEnvironmentDescriptor({
    profile: opts.profile,
    paths: { workspace: cwd, ...(opts.paths ?? {}) },
    lecturerProfile: opts.lecturerProfile,
    lecturerIdentity: opts.lecturerIdentity,
    lecturerSupport: supportSnapshot,
    courseContext: opts.courseContext,
    lecturerState: opts.lecturerState,
    affordances: opts.affordances,
    canvasArtefacts: opts.canvasArtefacts,
    stepCoverage: seededStepFocus ?? opts.stepCoverage,
    // The session-start prior carries the aggregate the HOST derives, not a
    // stored one (Requirement: *Host-Derived Overall Maturity Level*): the
    // derivation is applied to the carried raster on its way into the descriptor,
    // so it travels with the reading without ever being stored beside it. The
    // mirror below is seeded from `opts.maturity` UNDERIVED, and the record
    // semantics drop an aggregate level there in any case.
    maturity: opts.maturity ? withDerivedOverall(opts.maturity as MaturitySnapshot) : opts.maturity,
    decisionsSummary: opts.decisionsSummary,
  });

  // Host-side canvas artefact mirror, fed by every valid cbe_canvas call through the
  // tool instance below and by UI-initiated deletions via the host (recordUiDeletion).
  const canvasMirror = new CanvasMirror();
  // Pre-seed the mirror with the carried-over artefacts (Requirement: Session-Start
  // Canvas Artefact Injection; design.md "Mirror pre-seeding"): the renderer
  // re-hydrates the kept Canvas panel from canvasMirror.list(), and a SECOND New
  // Session must carry the same artefacts again — an unseeded mirror would repaint
  // the panel empty and silently drop the canvas on the next reset. The entries were
  // skill-pushed in the previous session, so the mirror's "only skill-pushed
  // artefacts" invariant holds (renderer seed rows still never enter it).
  for (const artefact of opts.canvasArtefacts ?? []) {
    if (typeof artefact.value === "string" && artefact.value.trim().length > 0) {
      canvasMirror.applySet({ ...artefact });
    }
  }
  // Host-side design-substance and revision signal (Requirement: Host-Side
  // Design-Substance and Revision Signal). Created AFTER the carry-over seeding
  // above so the counter starts at zero over the carried evidence: substance is a
  // live reading of what is on the table, the counter measures only what has
  // MOVED since this session began. Both mirrors report their settled changes
  // into it; the mirrors' restore/seed paths stay silent by construction.
  const designSignal = new DesignSignal(canvasMirror);
  canvasMirror.observe((change) => designSignal.record(change.kind, change));
  stepMirror.observe((change) => designSignal.record("step-depth", { step: change.step }));
  // The canvas tool derives step focus from an accepted write, so it needs the step
  // mirror as well — one derivation, read by the mirror and the renderer alike.
  const pendingAnswerGate = new PendingAnswerGate();
  // Read lazily on each tool call so the tools see the LIVE feed state of the
  // mirrored surfaces rather than a start-up snapshot.
  const surfaces = {
    get maturity() {
      return maturityMirror;
    },
    get maturityAffordance() {
      return env.affordances.maturity === true;
    },
    // The coherence gate after step 3, derived from the step mirror the host already
    // keeps — no second notion of design state (capability `agent-harness`,
    // Requirement: *The Maturity Demands Are Staged Across the Session*).
    get coherenceGate() {
      return coherenceGatePassed(stepMirror);
    },
  };
  const canvasTool = createCanvasTool(canvasMirror, stepMirror, pendingAnswerGate, surfaces);
  const stepTool = createStepTool(stepMirror, pendingAnswerGate, surfaces, canvasMirror);
  const pickerTool = createPickerTool(pendingAnswerGate);
  // Host-side maturity mirror (Requirement: Host-Side Session Maturity Mirror):
  // in-memory, fed by every valid cbe_maturity call through the tool instance
  // below. The mirror starts empty here and is filled from the COURSE's reading —
  // by the carry-over below on a New Session, and by the host's course-record
  // restore on a course open (Requirement: Course Design-State Store). It stays
  // empty only where the course has no recorded reading.
  // The stamp source is read at APPLY time, so the provenance a record carries is
  // the evidence the host actually observed at that moment — never a value the
  // model supplied and never a start-up snapshot.
  const maturityMirror = new MaturityMirror(() => ({
    substance: designSignal.substance(),
    revision: designSignal.currentRevision(),
  }));
  // New Session carry-over: seed the fresh session's mirror so the Maturity panel
  // stays populated across the reset and a SECOND reset carries the reading again
  // (capability `desktop-app`, Requirement: New Session Control With Canvas Carry-Over).
  // `seed` stamps the carried records `unknown` — the counter is back at zero, so
  // their evidence basis is not reconstructable and must not be invented.
  if (opts.maturity && Object.keys(opts.maturity).length > 0) {
    maturityMirror.seed(opts.maturity as MaturitySnapshot);
  }
  const maturityTool = createMaturityTool(maturityMirror);
  // Post-compaction retained-state handover (Requirement: Post-Compaction
  // Retained-State Handover). Bound to the mirrors, not to a snapshot: it renders
  // at drain time, so what the host hands back is the state as it stands when the
  // next lecturer turn is composed. The canvas is deliberately NOT a source — it
  // is already a queried consolidation store and far too large to prefix to a live
  // turn right after a compaction.
  const retainedStateHandover = new RetainedStateHandover({
    // Derived on the way out, exactly like the session-start prior: what the
    // host hands back after a compaction is the aggregate it computes now, not
    // an `overall` row the mirror would otherwise report as unassessed.
    getMaturity: () => withDerivedOverall(maturityMirror.snapshot()),
    // RECORDED coverage only: a session that established nothing MUST produce no
    // handover block at all (Requirement: *Post-Compaction Retained-State
    // Handover*, Scenario: *An empty retained state produces no handover at all*),
    // and the host's initial-focus seed establishes nothing.
    getStepCoverage: () => stepMirror.recordedList(),
    ...(opts.compaction?.getDecisionsSummary ? { getDecisionsSummary: opts.compaction.getDecisionsSummary } : {}),
  });
  const envBlock = env.toSystemPromptBlock();

  // Companion-sequence phase, tracked HERE rather than only forwarded to the
  // host: a lecturer stop is refused for the whole sequence (capability
  // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*), and the
  // sequence starts with artefact CONSOLIDATION — before the runtime's own
  // `isCompacting` has risen. Aborting between the two could leave the
  // consolidation half-applied, which the app has no recovery for.
  let companionPhase: CompanionPhase = "idle";

  // The CBE-identity prompt REPLACES the default pi-coding-agent system prompt entirely.
  // The eager skill body and the environment descriptor are then APPENDED below it via
  // `appendSystemPromptOverride` in exactly that order: identity prompt → skill body →
  // environment descriptor (state last, so nothing after it reads as a rule).
  // agentDir is explicitly the app-isolated path passed by the host — never the user's global
  // ~/.pi/ — so pi-coding-agent's default lazy-install / settings reading stays inside our sandbox.
  // The model-visible prompt text (runtime/legacy-system-prompt.ts): composed once,
  // with the date fixed at session composition exactly as it always was, and
  // forced onto every request by the request-parity extension below.
  const systemPromptText = composeLegacySystemPrompt({
    customPrompt: cbeIdentityPrompt,
    append: [skillBlock, envBlock],
    skills: [skill],
    hasRead: (CBE_TOOL_ALLOWLIST as readonly string[]).includes("read"),
    cwd,
    date: new Date(),
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: opts.agentDir,
    settingsManager,
    // Nothing is discovered from disk (runtime/pi-config.ts); every resource below
    // is supplied explicitly.
    ...CBE_RESOURCE_POLICY,
    systemPrompt: cbeIdentityPrompt,
    skillsOverride: () => ({ skills: [skill], diagnostics: [] }),
    // App-authored extensions are supplied EXPLICITLY here (no disk auto-discovery),
    // per agent-harness hardening. The payload-hardening extension is ALWAYS on (app
    // + headless) so the request surface is uniform; the CBE slash-command extension
    // (`/cite`) is added only when the host wires `opts.commands`.
    extensionFactories: [
      // Path fence on the file-mutation tools (Requirement: Path-Fenced File
      // Mutation Tools): REPLACES pi's built-in `write`/`edit` through the
      // public tool-replacement route, deny-by-default — with no host-supplied
      // roots every mutation call is refused and the unfenced built-ins are
      // never exposed. The root set is captured here, at session creation,
      // from host arguments only.
      createFencedFileToolsExtension(cwd, opts.writableRoots ?? {}),
      createRequestParityExtension({ systemPrompt: () => systemPromptText }),
      createPayloadHardeningExtension(),
      // Compaction companion (Requirement: Compaction Companion — Artefact
      // Consolidation Before Context Compaction): ALWAYS on, app + headless,
      // so compaction is accompanied uniformly. It queries the host-side
      // canvas mirror created above and the host's profile accessor — both
      // tool-persisted; no renderer round-trip, no store flush.
      createCompactionCompanionExtension({
        canvasMirror,
        getProfile: opts.compaction?.getProfile ?? (() => opts.lecturerProfile ?? null),
        // The recorded maturity reading is a durable store like the canvas and the
        // profile — a settled target ambition lives there, so the consolidation
        // check must see it rather than spending the single steering cycle on it.
        getMaturity: () => maturityMirror.snapshot(),
        // A COMPLETED compaction arms the retained-state handover; a refused one
        // disarms it again. The bound can only trip after earlier compactions
        // completed and armed it, so the wedged small-context path stays free of
        // the block only because of this second binding.
        onCompacted: () => {
          retainedStateHandover.markCompacted();
          // The summary may have dropped the support snapshot — or kept an obsolete
          // one — so the current saved state is due again before the next answer.
          supportDisclosure.invalidate();
        },
        onCompactionRefused: () => retainedStateHandover.cancelPending(),
        // Always bound: the phase is the stop's own refusal condition, so it is
        // tracked whether or not the host wired a visibility callback.
        onPhase: (phase: CompanionPhase) => {
          companionPhase = phase;
          opts.compaction?.onPhase?.(phase);
        },
        ...(opts.compaction?.onContextWindowTooSmall
          ? { onContextWindowTooSmall: opts.compaction.onContextWindowTooSmall }
          : {}),
        ...(opts.compaction?.maxConsecutiveCompactions !== undefined
          ? { maxConsecutiveCompactions: opts.compaction.maxConsecutiveCompactions }
          : {}),
      }),
      ...(opts.commands
        ? [
            createCbeCommandsExtension({
              ...opts.commands,
              onReady: (gc) => {
                getCommands = gc;
              },
            }),
          ]
        : []),
    ],
    // Defence in depth: keep ONLY our app-authored extensions — the command extension
    // (identified by the commands it registers) and the command-less payload-hardening
    // extension (identified by its before_provider_request handler) — and drop anything
    // a drifted settings.json might have auto-discovered from disk, so no runtime
    // tool/extension can sneak in.
    extensionsOverride: (base) => ({
      ...base,
      extensions: base.extensions.filter(
        (e) =>
          e.commands.has("cite") ||
          e.handlers.has(PAYLOAD_HARDENING_HOOK) ||
          // The request-parity extension is handler-only too (prompt text +
          // output-cap removal); retained via its before_agent_start hook.
          e.handlers.has(REQUEST_PARITY_HOOK) ||
          // The compaction-companion extension is handler-only; retain it via
          // its session_before_compact hook.
          e.handlers.has(COMPACTION_COMPANION_HOOK) ||
          // The fenced file-mutation tools, retained by the tool names they
          // register — the same shape of clause the sandboxed bash had before
          // the shell was de-registered (Requirement: Path-Fenced File
          // Mutation Tools).
          e.tools.has("write") ||
          e.tools.has("edit")
      ),
    }),
    // Discovered APPEND_SYSTEM.md files are ignored: the append is CBE's alone.
    appendSystemPromptOverride: () => [skillBlock, envBlock],
  });
  await loader.reload();

  // SessionManager.create(cwd, customDir?) — verified API.
  // `fromDirectory` does not exist in the SDK.
  //
  // `tools` is an explicit allowlist with NO shell on any platform. A
  // model-emitted `bash` call yields a tool-execution error and no process is
  // spawned. Register the cbe_picker generative-UI tool. The tool's execute() returns a
  // placeholder result immediately; the renderer picks up the spec from the
  // tool_execution_start event and renders the Picker component. The lecturer's
  // actual answer arrives as the next user turn — see picker-tool.ts and
  // specs/desktop-app/spec.md, "Generative UI — Picker".
  // Reasoning effort is configured per-model on the provider. In this pi version the
  // effort is a session-level "thinking level" passed as the per-call stream option
  // `reasoning`; the provider only emits `reasoning_effort` when the model's
  // `compat.supportsReasoningEffort` is also true (set in registerProvider). When
  // reasoning is disabled we omit `thinkingLevel` and pi keeps its default — i.e.
  // unchanged behaviour. "low"|"medium"|"high" are all valid ModelThinkingLevel values.
  const thinkingLevel = opts.provider.reasoning ? (opts.provider.reasoningEffort ?? "medium") : undefined;

  // Bind the deterministic `cbe_cite` tool to a corpus resolver. When the host
  // surfaced a corpus path we load it; otherwise the tool still registers (so the
  // prompt surface stays uniform across profiles) but every call refuses with
  // unknown-id because no corpus is loaded. See cite-tool.ts.
  let citeResolver: CitationResolver | null = null;
  if (opts.paths?.corpus) {
    try {
      citeResolver = await createCitationResolver(opts.paths.corpus);
    } catch {
      citeResolver = null;
    }
  }
  // Wiki-wins precedence gate (capability `cbe-skill`, Citation Grounding):
  // when the course wiki carries an atom sharing a source URL with a corpus
  // document, cbe_cite refuses the corpus token and points at the wiki: route.
  // The third argument is that route (capability `citation-tool`, Requirement:
  // *Citation Tool Produces a Wiki Citation Validated Against the Wiki Index*):
  // a `wiki:` id resolves against the course's wiki index and yields the wiki token.
  const citeTool = createCiteTool(
    citeResolver,
    createWikiPrecedenceLookup(opts.paths?.wiki),
    createWikiCitationResolver(opts.paths?.wiki)
  );

  // Wiki retrieval (capability `agent-harness`, Requirement: *cbe_wiki Wiki-Retrieval
  // Tool with a Forced Index-First Route*). The gate is per session and is handed to
  // the host on the result, which arms it when an ingestion lands atoms.
  const wikiIndexGate = new WikiRetrievalGate();
  const wikiTool = createWikiTool(wikiIndexGate, opts.paths?.wiki);

  // The support tool writes through the same service the descriptor read; a snapshot
  // the model reads in its result counts as disclosed to this session.
  const supportTool = createSupportTool(lecturerSupportService, (snapshot) =>
    supportDisclosure.markDelivered(snapshot.revision)
  );
  const customTools = [pickerTool, citeTool, canvasTool, profileTool, stepTool, maturityTool, wikiTool, supportTool];
  const registeredCustomNames = customTools.map((tool) => tool.name);
  if (
    registeredCustomNames.length !== CBE_CUSTOM_TOOL_NAMES.length ||
    registeredCustomNames.some((name, index) => name !== CBE_CUSTOM_TOOL_NAMES[index])
  ) {
    throw new Error("CBE custom tool registration differs from the compiled Skill compatibility contract");
  }

  // Resume support: seed the stored turns into the SessionManager BEFORE the
  // agent session is created — createAgentSession builds its LLM context from
  // the manager's existing entries (pi's continue-session path), so the model
  // sees the prior conversation natively, without stuffing it into a prompt.
  const sessionManager = SessionManager.create(cwd, opts.sessionsDir);
  // Pin Pi's session id to the host's sessionId (public NewSessionOptions API):
  // the session JSONL is then named `<timestamp>_<sessionId>.jsonl`, so the
  // session's own record — including earlier resume legs of the same logical
  // conversation — stays discoverable for the same-session mirror rebuild.
  if (opts.sessionId) {
    sessionManager.newSession({ id: opts.sessionId });
  }
  // Resume: rebuild the maturity mirror by replaying THIS session's persisted
  // cbe_maturity calls from its own record, before the first hydration snapshot
  // can be served (Requirement: Host-Side Session Maturity Mirror). The current
  // leg's file is excluded (it is the one being written from here on). Strictly
  // same-session; a fresh session skips this and starts empty.
  if (opts.resume && opts.sessionId) {
    await replayMaturityMirror({
      sessionsDir: opts.sessionsDir,
      sessionId: opts.sessionId,
      mirror: maturityMirror,
      excludeFile: sessionManager.getSessionFile(),
    });
  }
  if (opts.resume) {
    for (const turn of opts.resume.turns) {
      sessionManager.appendMessage(
        turn.role === "user"
          ? { role: "user", content: turn.text, timestamp: Date.now() }
          : {
              role: "assistant",
              content: [{ type: "text", text: turn.text }],
              api: "openai-completions",
              provider,
              model: modelId,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: Date.now(),
            }
      );
    }
  }

  const { session } = await createAgentSession({
    cwd,
    agentDir: opts.agentDir,
    model,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    modelRuntime,
    settingsManager,
    resourceLoader: loader,
    sessionManager,
    customTools,
    tools: [...CBE_TOOL_ALLOWLIST],
  });

  // The lecturer's stop, over pi's PUBLIC surface only (capability
  // `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*).
  // `abort()` already awaits idle; what it lacks is a failure mode, which is why
  // the controller bounds the wait and classifies a hang as a timeout.
  const turnStop = new TurnStopController({
    abort: () => session.abort(),
    clearQueue: () => session.clearQueue(),
    hasPendingTurn: opts.hasPendingTurn ?? (() => session.isStreaming),
    // The refusal covers the WHOLE companion sequence: the consolidation phase
    // above plus the runtime's own compaction / branch summarisation.
    isCompacting: () => companionPhase === "consolidating" || companionPhase === "compacting" || session.isCompacting,
    ...(opts.turnStopTimeoutMs !== undefined ? { timeoutMs: opts.turnStopTimeoutMs } : {}),
    log: (message, detail) => console.error(message, detail ?? ""),
  });

  // Runtime provider re-bind (capability `agent-harness`, Requirement:
  // Bring-Your-Own-LLM Configuration — runtime re-bind): re-register the
  // (constant-named) byo-llm provider with the new config — overwriting
  // baseURL/apiKey/model/contextLength on the same ModelRuntime — resolve
  // the new model, and swap it on the live session, preserving the transcript.
  // `registerProvider` validates the config before applying it, so an invalid
  // config throws without mutating the runtime; `setModel`'s auth check is
  // satisfied by the inline apiKey of the freshly registered provider on the
  // same ModelRuntime the session routes through. Rejects — leaving the session on its previous
  // provider — if the config is invalid, the model cannot be resolved, or the
  // model has no usable auth. Callers apply it at an idle boundary.
  async function updateProvider(next: ProviderConfig): Promise<void> {
    await session.setModel(modelBinding.resolve(next));
  }

  return {
    // The ONLY handle the host receives: the CBE-owned port. Commands are
    // enumerated through the extension's late-bound accessor.
    session: adaptPiSession(session, { updateProvider, getCommands: () => getCommands() }),
    env,
    skillBody,
    canvasMirror,
    stepMirror,
    pendingAnswerGate,
    maturityMirror,
    designSignal,
    retainedStateHandover,
    turnStop,
    wikiIndexGate,
    supportDisclosure,
    lecturerSupportService,
  };
}
