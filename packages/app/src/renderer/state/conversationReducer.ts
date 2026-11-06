/**
 * Per-session conversation state and its pure reducer (capability `desktop-app`,
 * Requirement: Background Conversations and Per-Session Event Demultiplexing).
 *
 * The renderer models conversation state PER SESSION: transcript, live activity
 * stream, canvas artefact state, step coverage, and pending notices each live in
 * their session's `ConversationState` slice. `reduceConversation` applies ONE
 * agent event to ONE slice and never touches anything else — the no-bleed
 * property ("a background conversation's events MUST NOT mutate the visible
 * conversation's state") holds by construction and is testable as a pure
 * function. The app-level demux (`state/agentEvents.ts` → store action
 * `ingestAgentEvent`) picks the slice by `event.sessionId` and drops events for
 * unknown session ids.
 *
 * Extracted from the former ChatPanel-local reducer usage so a background
 * session's stream survives the panel unmounting on a course switch.
 */
import type {
  AgentEvent,
  ContextUsageReport,
  DisplayAttachment,
  StartSessionResult,
} from "../../shared/ipc-contract.js";
import { liveReducer, INITIAL_LIVE, type LiveTurnState } from "./liveReducer.js";
import type { ActivityItem } from "./activity.js";
import {
  isStepDepth,
  seedItemIds,
  seededArtefactLabel,
  stepGroups,
  stepLabels,
  STEP_ORDER,
  type StepGroup,
  type StepId,
  type StepDepth,
  type ArtefactItem,
  type ArtefactState,
} from "../mocks/artifacts.js";
import { chrome } from "../chrome.js";
import { resolveCanvasAddress, type ResolvedCanvasAddress } from "@cbe/pi-bridge/canvas-addressing";
import {
  applyMaturityDetails,
  parseMaturityDetails,
  type MaturitySnapshot,
  type MaturityToolDetails,
} from "@cbe/pi-bridge/maturity";
import type { MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import { emptyDidacticChecks, type CheckName, type DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import { isNoToolCallSignature } from "../../shared/reasoning-remediation.js";
import { providerErrorNotice } from "../util/errors.js";

/**
 * Persisted-turn shape.
 *
 * User turns carry plain text (Phase 1 doesn't render user-side Markdown) plus an
 * optional `attachments` list — display-only metadata for ingested documents, rendered
 * as doc chips (capability `desktop-app`, Requirement: Ingested Documents Render as Doc
 * Chips). The chips are a DISPLAY concern: the full envelope still travels to the model
 * via the unchanged prompt text, and persistence is unchanged; `attachments` carries no
 * body text. Turns without it (the common case) render exactly as before.
 * Assistant turns carry a chronological `ActivityItem[]` — text segments, tool
 * activity and thinking interleaved in the exact order they streamed in. Normal
 * chat projects passive technical items out after terminal completion; retaining
 * chronology here supports active inspection and existing state consumers.
 */
export type Turn =
  | { role: "user"; text: string; attachments?: DisplayAttachment[] }
  | {
      role: "assistant";
      activity: ActivityItem[];
      /** The lecturer stopped the run that produced this turn (capability
       * `desktop-app`, Requirement: *Composer Control Row* — "the partial answer
       * stays in the transcript, visibly marked as stopped"). Optional and
       * additive: absent means the turn is complete. It survives a renderer
       * reload and a session re-entry because the persisted turn carries it
       * (capability `agent-harness`, Requirement: *Sessions as Local
       * Markdown/JSON Files*), so a stopped answer is never re-read later as a
       * short complete one. */
      stopped?: boolean;
    };

/** Per-step coverage state rendered on a step-group header (capability `desktop-app`,
 * Requirement: Design-Flow Canvas). Fed live from `cbe_step` tool-calls. */
export interface StepCoverage {
  step: StepId;
  label: string;
  depth: StepDepth;
  focus: boolean;
}

/** One conversation's whole renderer state, keyed by its `sessionId` in the store.
 * The slice belonging to the active course is the VISIBLE conversation; every other
 * slice is a background conversation that keeps accumulating state while not shown. */
/** Soft inline chat notice (recoverable failures — Requirement: Tiered Error
 * Surfacing). `hint` is an optional smaller second line. */
export interface ChatNotice {
  text: string;
  hint?: string;
}

export interface ConversationState {
  session: StartSessionResult;
  turns: Turn[];
  /** Live activity stream of the current run — buffered here (app lifetime), so an
   * in-app course switch loses nothing of the stream. `live.streaming` doubles as
   * the slice's running flag. */
  live: LiveTurnState;
  /** Non-fatal, dismissible notice (unreadable archive,
   * background provider error) — rendered as a banner when the slice is visible. */
  notice: string | null;
  /** True from a prompt dispatch until its `agent_start` event lands (or the
   * dispatch settles) — closes the click-to-event race the streaming flag alone
   * leaves open (Requirement: Canvas Dialogue-Steering Dispatches Respect the
   * Run Lock). Shared by every dispatch surface of this conversation. */
  dispatchPending: boolean;
  /** Soft inline chat notice for recoverable failures (Requirement: Tiered
   * Error Surfacing) — the non-alarm surface, rendered inside the chat column. */
  chatNotice: ChatNotice | null;
  /** Set on the settled `agent_end` (one per run) of a NON-visible slice;
   * cleared when the course becomes visible. */
  unseenCompletion: boolean;
  /** The Artifacts tab of THIS conversation carries unseen artefact changes
   * (capability `desktop-app`, Requirement: Panel Follows the Agent's Artefact
   * Work). Raised by an artefact write that lands while the canvas is not the
   * visible surface; cleared the moment it becomes visible. Per conversation, so
   * a background course's write can never mark the visible one's tab. */
  artifactsAttention: boolean;
  /** Live Canvas state (Requirement: Live Canvas Population from Skill Tool-Calls;
   * Design-Flow Canvas) — per conversation, so background `cbe_canvas` calls land
   * in their own course's canvas. */
  artifacts: StepGroup[];
  /** Per-step coverage headers, fed live from `cbe_step` (per conversation). */
  steps: StepCoverage[];
  /** Recorded maturity raster (Requirement: Maturity Panel) — per conversation,
   * fed live from validated `cbe_maturity` result details and hydrated from the
   * host-side session maturity mirror. Empty object = no reading (empty state).
   * Never written to any persistence layer. */
  maturity: MaturitySnapshot;
  /** Host-derived framing state for the reading above (capability `desktop-app`,
   * Requirement: Maturity Panel Substance and Staleness Framing) — per
   * conversation, exactly like `maturity` itself. The renderer NEVER computes
   * substance or staleness: this arrives whole from the host, on hydration and on
   * every live `maturity_state` event. */
  maturityState: MaturityDerivedState;
  /** Didactic-check outcomes backing the canvas "Decisions" section (Requirement:
   * Decision Artefacts Are Per-Conversation State) — per conversation, exactly like
   * `artifacts` / `steps` / `maturity`, so a course switch can never leave another
   * course's decisions on screen. Empty = the section's empty state. */
  didacticChecks: DidacticChecks;
  /** Checks invalidated by an upstream goal revision (goal-revision propagation),
   * scoped to the same conversation as `didacticChecks`. */
  invalidatedChecks: CheckName[];
  /** Reasoning-remediation observation (capability `agent-harness`, Requirement:
   * Reasoning Remediation for Tool-Call-Gated Models): the signature is evaluated
   * per session on its opening exchange. */
  hadExchange: boolean;
  runHadTool: boolean;
  runHadError: boolean;
  offerReasoningRemediation: boolean;
  /** Surfaced "response was cut off" state (Requirement: Response-Cut-Off State
   * with One-Click Continue and Retry): the harness's cut-off note from a
   * `truncation_cutoff` event, or null. Cleared at the next `agent_start`. */
  cutOffNote: string | null;
  /** This conversation's context occupancy, as the harness last reported it
   * (capability `desktop-app`, Requirement: Context-Usage Ring in the Composer
   * Control Row). Held PER SLICE so a background conversation's report never
   * renders in the visible one. `null` = nothing reported yet. */
  contextUsage: ContextUsageReport | null;
  /** Has this conversation ever carried a MEASURED occupancy? It is what
   * separates the ring's fresh state from its carried-but-unmeasured one: a
   * resumed conversation reports `used: unknown` exactly like a brand-new one,
   * and presenting the two the same way would show a nearly full resumed context
   * with a brand-new conversation's empty ring. Set by a resumed/hydrated report
   * as well as by a measured one. */
  contextEverMeasured: boolean;
  /** The lecturer stopped THIS conversation's current run (capability
   * `agent-harness`, Requirement: *A Lecturer Can Stop a Running Turn*). Raised
   * by the `turn_stopped` event — which the host emits BEFORE the run's end, so
   * it is already set when the run's turn is finalised — and spent by that
   * finalisation. While it is set the slice also refuses the two states a stop
   * must not produce: the cut-off notice and the provider-error state. */
  runStopped: boolean;
  /** A lecturer stop on THIS conversation's run reported `timed-out` and the
   * runtime has not released the run since (capability `desktop-app`,
   * Requirement: *Composer Control Row*). Per slice rather than per panel: the
   * composer's run lock lives here and survives a course switch, while the
   * ChatPanel is unmounted for the switch's hydration — a panel-local flag would
   * take the notice and its force-close recovery down with it and leave exactly
   * the dead end the recovery exists for. Raised only by a `timed-out` outcome;
   * cleared at a run boundary, which is the honest signal that the run is over. */
  stopTimedOut: boolean;
  /** Is a compaction companion sequence running for this conversation? The
   * ring's pending state. Kept SEPARATE from `live.companionPhase`, which the
   * shared Working disclosure consumes: this flag is additionally released by
   * `agent_end`, the boundary the runtime always reaches, so an early-return
   * companion failure cannot strand it. */
  contextPending: boolean;
}

/**
 * Readable error state for a failed companion sequence, in the interface
 * language (capability
 * `desktop-app`, Requirement: Compaction Visibility in the Renderer, failure
 * path). Rendered as the soft inline chat notice when a `compaction_phase`
 * "error" arrives — the working status has already cleared by then, so the
 * lecturer never faces a permanently stuck "Consolidating…"/"Compacting
 * context…". The loop-bound trip additionally surfaces its own specific
 * message through the `error` event (Requirement: Documented Error Behaviour).
 */
export function compactionFailedNotice(): ChatNotice {
  const t = chrome();
  return { text: t.chatCompactionFailedText, hint: t.chatCompactionFailedHint };
}

const CANVAS_STATES = new Set<string>(["done", "active", "draft", "open"]);

/** Seed for a conversation's artifacts: the ten design-step groups (final 4.2.1 §4.6)
 * with their labels and structure — but empty values and every artefact state `open`. */
export function seedArtifacts(): StepGroup[] {
  return stepGroups(chrome());
}

/** Seed for the step-coverage slice: all ten steps `open`, none in focus. */
export function seedSteps(): StepCoverage[] {
  const labels = stepLabels(chrome());
  return STEP_ORDER.map((step) => ({ step, label: labels[step], depth: "open" as const, focus: false }));
}

/**
 * Project the host-side step-coverage snapshot of a course open onto the ten-step
 * scaffold (capability `agent-harness`, Requirement: Course Design-State Store).
 *
 * The mirror stores only steps that moved off their default, so the seed supplies
 * the labels and the rest of the ladder; a step the snapshot does not mention stays
 * `open` and unfocused. Nothing is promoted or invented, and focus stays exclusive:
 * a snapshot naming several focused steps keeps the first, exactly as the mirror
 * and the reducer's own `cbe_step` path do.
 */
export function stepsFromSnapshot(
  entries: readonly { step: number; depth: StepDepth; focus: boolean }[]
): StepCoverage[] {
  const byStep = new Map<number, { depth: StepDepth; focus: boolean }>();
  let focusTaken = false;
  for (const e of entries) {
    if (!STEP_ORDER.includes(e.step as StepId)) continue;
    if (!isStepDepth(e.depth)) continue;
    const focus = e.focus === true && !focusTaken;
    if (focus) focusTaken = true;
    byStep.set(e.step, { depth: e.depth, focus });
  }
  return seedSteps().map((s) => {
    const rec = byStep.get(s.step);
    return rec ? { ...s, depth: rec.depth, focus: rec.focus } : s;
  });
}

/** Immutable upsert of one artefact into a container by id (replace or append). */
export function upsertItem(
  items: ArtefactItem[],
  id: string,
  patch: { label?: string; value: string; state?: ArtefactState }
): ArtefactItem[] {
  const idx = items.findIndex((it) => it.id === id);
  if (idx >= 0) {
    const cur = items[idx]!;
    const next: ArtefactItem = {
      ...cur,
      ...(typeof patch.label === "string" && patch.label.length ? { label: patch.label } : {}),
      value: patch.value,
      state: patch.state ?? cur.state,
    };
    return items.map((it, i) => (i === idx ? next : it));
  }
  return [
    ...items,
    {
      id,
      label: patch.label && patch.label.length ? patch.label : id,
      value: patch.value,
      state: patch.state ?? "draft",
    },
  ];
}

/** The SEED container for a resolved address — the source of truth for whether an id is
 * a seeded artefact (clear reverts) or an inserted one (clear removes). It resolves the
 * label in the ACTIVE language, because a revert restores the seeded label the lecturer
 * is currently reading. */
function seedContainerFor(addr: ResolvedCanvasAddress): readonly ArtefactItem[] {
  if (!STEP_ORDER.includes(addr.step as StepId)) return [];
  const strings = chrome();
  const key = addr.phase ? `${addr.step}/${addr.phase}` : `${addr.step}`;
  return seedItemIds(key).map((id) => ({
    id,
    label: seededArtefactLabel(id, strings),
    state: "open" as const,
    value: "",
  }));
}

/** Map an artefact-container transform over the group addressed by `addr`. */
export function mapContainerAt(
  groups: StepGroup[],
  addr: ResolvedCanvasAddress,
  fn: (items: ArtefactItem[]) => ArtefactItem[]
): StepGroup[] {
  return groups.map((g) => {
    if (g.step !== addr.step) return g;
    if (addr.phase && g.journey) {
      return { ...g, journey: g.journey.map((el) => (el.phase === addr.phase ? { ...el, items: fn(el.items) } : el)) };
    }
    return { ...g, items: fn(g.items) };
  });
}

/** Whether an artefact id currently exists at the resolved address. */
export function itemExistsAt(groups: StepGroup[], addr: ResolvedCanvasAddress, id: string): boolean {
  const g = groups.find((sg) => sg.step === addr.step);
  if (!g) return false;
  const container = addr.phase ? (g.journey?.find((el) => el.phase === addr.phase)?.items ?? []) : g.items;
  return container.some((it) => it.id === id);
}

/** Apply one canvas SET to an artifacts tree (shared by the reducer and the
 * legacy visible-slice store action). Unresolvable addresses are ignored. */
export function applyCanvasSet(
  artifacts: StepGroup[],
  step: number | undefined,
  phase: string | undefined,
  id: string,
  patch: { label?: string; value: string; state?: ArtefactState }
): StepGroup[] {
  const addr = resolveCanvasAddress({ step, phase, id });
  if (!addr) return artifacts;
  return mapContainerAt(artifacts, addr, (items) => upsertItem(items, id, patch));
}

/** Apply one canvas CLEAR to an artifacts tree: a seeded artefact reverts to its
 * seed/open presentation; an inserted non-seed artefact is removed entirely; an
 * absent id or unresolvable address is a no-op. */
export function applyCanvasClear(
  artifacts: StepGroup[],
  step: number | undefined,
  phase: string | undefined,
  id: string
): StepGroup[] {
  const addr = resolveCanvasAddress({ step, phase, id });
  if (!addr) return artifacts;
  if (!itemExistsAt(artifacts, addr, id)) return artifacts;
  const seed = seedContainerFor(addr).find((it) => it.id === id);
  return mapContainerAt(artifacts, addr, (items) => {
    if (seed) {
      return items.map((it) => (it.id === id ? { ...it, label: seed.label, value: "", state: "open" as const } : it));
    }
    return items.filter((it) => it.id !== id);
  });
}

/** Apply one `cbe_step` update to a step-coverage list. Degenerate payloads
 * (step out of 1..10, unknown depth, neither depth nor focus) are ignored;
 * setting focus on one step clears every other step's focus (exclusive). */
export function applyStepPatch(
  steps: StepCoverage[],
  step: number,
  patch: { depth?: StepDepth; focus?: boolean }
): StepCoverage[] {
  if (!Number.isInteger(step) || step < 1 || step > 10) return steps;
  const hasDepth = isStepDepth(patch.depth);
  const hasFocus = typeof patch.focus === "boolean";
  if (!hasDepth && !hasFocus) return steps;
  const settingFocus = hasFocus && patch.focus === true;
  return steps.map((sc) => {
    if (sc.step === step) {
      return {
        ...sc,
        ...(hasDepth ? { depth: patch.depth! } : {}),
        ...(hasFocus ? { focus: patch.focus! } : {}),
      };
    }
    return settingFocus && sc.focus ? { ...sc, focus: false } : sc;
  });
}

/** Parsed, validated `cbe_canvas` result details (post-Pi-validation), or null
 * for errors, refusals, other tools' results, and malformed payloads. */
export function parseCanvasDetails(
  result: unknown,
  isError: boolean
):
  | { action: "clear"; step: number; phase?: string; id: string }
  | {
      action: "set";
      step: number;
      phase?: string;
      id: string;
      label?: string;
      value: string;
      state?: ArtefactState;
      /** Step whose focus the host DERIVED from this write (Requirement: Deterministic
       * Tool-Boundary Enforcement…). Applied to the step slice so the visible header
       * follows the work even when the skill never sent an explicit focus call. */
      focusStep?: number;
    }
  | null {
  if (isError || !result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== "canvas-update") return null; // ignore refusals and other tools' results
  if (typeof d.step !== "number") return null; // execute() always carries the resolved step
  if (typeof d.id !== "string" || d.id.trim().length === 0) return null;
  const phase = typeof d.phase === "string" ? d.phase : undefined;
  if (d.action === "clear") {
    return { action: "clear", step: d.step, ...(phase !== undefined ? { phase } : {}), id: d.id };
  }
  // A set (action: "set" or, for back-compat, omitted) needs a non-empty value.
  if (typeof d.value !== "string" || d.value.trim().length === 0) return null;
  return {
    action: "set",
    step: d.step,
    ...(phase !== undefined ? { phase } : {}),
    id: d.id,
    value: d.value,
    ...(typeof d.label === "string" ? { label: d.label } : {}),
    ...(typeof d.state === "string" && CANVAS_STATES.has(d.state) ? { state: d.state as ArtefactState } : {}),
    ...(typeof d.focusStep === "number" ? { focusStep: d.focusStep } : {}),
  };
}

/**
 * Parsed, validated `cbe_maturity` result details, or null (same contract as
 * `parseCanvasDetails`: errors, refusals, other tools' results, and malformed
 * payloads are ignored). The heavy lifting — including the batch-shape guard —
 * lives in pi-bridge's `parseMaturityDetails`, the SAME function the host-side
 * mirror uses, so renderer state and mirror can never diverge.
 */
export function parseMaturityToolDetails(result: unknown, isError: boolean): MaturityToolDetails | null {
  if (isError || !result || typeof result !== "object") return null;
  return parseMaturityDetails((result as { details?: unknown }).details);
}

/**
 * Apply one validated `cbe_maturity` update to a conversation's maturity state
 * (Requirement: Maturity Panel — state semantics). Thin, named wrapper over the
 * SHARED record semantics (`applyMaturityDetails`): batch replaces, single
 * updates merge per-field, `target: null` clears, hint/uncertain/capped are
 * replaced per update, no ratchet, later calls win.
 *
 * A `current` on the `overall` record is DROPPED by those shared semantics, so
 * the reducer never accepts a model-pushed overall achieved level from any event
 * — the aggregate is derived from the criteria this state holds (capability
 * `agent-harness`, Requirement: Host-Derived Overall Maturity Level). The rule
 * lives once, in pi-bridge, so the host mirror and this reducer cannot diverge.
 */
export function applyMaturityUpdate(maturity: MaturitySnapshot, details: MaturityToolDetails): MaturitySnapshot {
  return applyMaturityDetails(maturity, details);
}

/**
 * How the panel answers ONE artefact write (capability `desktop-app`, Requirement:
 * *Panel Follows the Agent's Artefact Work*). Pure, so the escalation is decidable
 * without a DOM: the caller supplies what it sees and applies what comes back.
 *
 * The three outcomes are mutually exclusive by construction:
 *   - the canvas is already the visible surface  → nothing to do (the change is on
 *     screen), but the one-time reveal is spent — the lecturer has seen the panel;
 *   - the canvas is hidden and the reveal is still armed → reveal it, once;
 *   - the canvas is hidden and the reveal is spent or disarmed → the quiet marker.
 *
 * Spending the reveal is not one of the outcomes because it is unconditional: EVERY
 * write for the visible conversation disarms, so a burst of writes cannot move the
 * panel repeatedly. The caller applies that itself.
 */
export function panelResponseToArtefactWrite(input: { canvasVisible: boolean; revealArmed: boolean }): {
  reveal: boolean;
  mark: boolean;
} {
  const reveal = !input.canvasVisible && input.revealArmed;
  const mark = !input.canvasVisible && !input.revealArmed;
  return { reveal, mark };
}

/** Parsed, validated `cbe_step` result details, or null (same contract as
 * `parseCanvasDetails`).
 *
 * One refusal shape DOES carry state: a `step-refusal` whose DEPTH was refused while the
 * call's navigation half was applied anyway reports the focused step as `focusStep`
 * (capability `agent-harness`, Requirement: *Deterministic Tool-Boundary Enforcement…*,
 * Scenario *A refused but ladder-legal depth still moves the focus to the addressed step*). It yields a
 * focus-only patch — never a depth. A bare refusal (structurally-invalid payload) keeps
 * yielding `null`, so the reducer applies nothing. */
export function parseStepDetails(
  result: unknown,
  isError: boolean
): { step: number; depth?: StepDepth; focus?: boolean } | null {
  if (isError || !result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (d.kind === "step-refusal") {
    return typeof d.focusStep === "number" ? { step: d.focusStep, focus: true } : null;
  }
  if (d.kind !== "step-update") return null;
  if (typeof d.step !== "number") return null;
  const out: { step: number; depth?: StepDepth; focus?: boolean } = { step: d.step };
  if (isStepDepth(d.depth)) out.depth = d.depth;
  if (typeof d.focus === "boolean") out.focus = d.focus;
  if (out.depth === undefined && out.focus === undefined) return null;
  return out;
}

/**
 * Decide whether the just-finished run matches the no-tool-call reasoning
 * signature and a remediation should be offered (capability `agent-harness`,
 * Requirement: Reasoning Remediation for Tool-Call-Gated Models).
 *
 * The renderer observes the run as a set of structural flags — never the model
 * id. We only offer the remediation on the OPENING exchange (the first prompt of
 * the session, where the mandatory-read protocol is in force), when reasoning is
 * not already enabled, and the run ended cleanly (`stopReason: "stop"` — surfaced
 * here as "agent_end without a preceding error"). Exported for unit testing.
 */
export function shouldOfferReasoningRemediation(obs: {
  /** This was the session's opening exchange (first prompt). */
  isOpeningExchange: boolean;
  /** Reasoning is already enabled for the active provider (then nothing to remediate). */
  reasoningAlreadyOn: boolean;
  /** A tool ran at any point during the run. */
  anyToolRan: boolean;
  /** The run ended with an error event (then it is not the clean `stopReason: "stop"` signature). */
  endedWithError: boolean;
}): boolean {
  if (!obs.isOpeningExchange || obs.reasoningAlreadyOn) return false;
  return isNoToolCallSignature({
    // For a CBE session the tool allowlist is always non-empty and the opening
    // mandatory-read protocol is always in force — both are session invariants,
    // asserted here rather than re-derived from the model.
    toolAllowlistNonEmpty: true,
    mandatoryReadProtocolInForce: obs.isOpeningExchange,
    toolUseCount: obs.anyToolRan ? 1 : 0,
    stopReason: obs.endedWithError ? "error" : "stop",
  });
}

/** Build a fresh conversation slice. `running: true` seeds the live state as an
 * already-started run (re-attach to an in-flight session: the composer lock and
 * working indicator arm until the run's real `agent_end` arrives). */
/**
 * Cold-start framing state: thin substance over zero evidence, and a reading
 * whose provenance is `unknown`. It is deliberately the most CAUTIOUS shape —
 * nothing is claimed about a reading the host has not described yet, so a
 * conversation cannot briefly present a reading as current or as provisional
 * before the first snapshot arrives.
 */
export function emptyMaturityState(): MaturityDerivedState {
  return {
    substance: "thin",
    evidence: { ingestedDocuments: 0, artefacts: 0, stepGroups: 0 },
    reading: { kind: "unknown" },
  };
}

export function newConversation(
  session: StartSessionResult,
  opts?: {
    turns?: Turn[];
    running?: boolean;
    artifacts?: StepGroup[];
    /** Design-flow coverage restored from THIS course's record. Absent ⇒ the
     * all-`open` seed — never another course's coverage (capability
     * `agent-harness`, Requirement: Course Design-State Store). */
    steps?: StepCoverage[];
    maturity?: MaturitySnapshot;
    /** Host-derived framing state for that reading. Absent ⇒ the cold-start
     * default below: thin substance over zero evidence and `unknown` reading
     * provenance. Nothing is materialised from absence — an unknown provenance
     * asserts neither provisional nor stale. */
    maturityState?: MaturityDerivedState;
    /** Decision artefacts restored from THIS course's canonical sidecar. Absent
     * (or malformed, rejected upstream) ⇒ the empty state — never another
     * conversation's value (Requirement: Decision Artefacts Are Per-Conversation
     * State). */
    didacticChecks?: DidacticChecks;
    /** The session-start context occupancy, delivered with the boot-hydration
     * snapshot (capability `agent-harness`, Requirement: Context Occupancy
     * Reported to the Host). Absent ⇒ the ring's unmeasured state. */
    contextUsage?: ContextUsageReport;
    notice?: string | null;
  }
): ConversationState {
  return {
    session,
    turns: opts?.turns ?? [],
    live: opts?.running ? liveReducer(INITIAL_LIVE, { type: "agent_start" }) : INITIAL_LIVE,
    notice: opts?.notice ?? null,
    dispatchPending: false,
    chatNotice: null,
    unseenCompletion: false,
    artifactsAttention: false,
    artifacts: opts?.artifacts ?? seedArtifacts(),
    steps: opts?.steps ?? seedSteps(),
    maturity: opts?.maturity ?? {},
    maturityState: opts?.maturityState ?? emptyMaturityState(),
    didacticChecks: opts?.didacticChecks ?? emptyDidacticChecks(),
    invalidatedChecks: [],
    hadExchange: false,
    runHadTool: false,
    runHadError: false,
    offerReasoningRemediation: false,
    cutOffNote: null,
    runStopped: false,
    stopTimedOut: false,
    contextUsage: opts?.contextUsage ?? null,
    // A hydrated report that carries a number means this conversation has been
    // measured before; one that carries `unknown` while the conversation has
    // prior turns means it CARRIES context that is not knowable right now.
    contextEverMeasured: (opts?.contextUsage?.used ?? null) !== null || (opts?.turns?.length ?? 0) > 0,
    contextPending: false,
  };
}

/**
 * Persist the slice's live activity stream as a finalised assistant turn and
 * reset the live state. Empty snapshots are a no-op (safe to call twice).
 *
 * A run the lecturer STOPPED is finalised here too, and this is where its marker
 * is put on the turn (capability `desktop-app`, Requirement: *Composer Control
 * Row*). The two shapes mirror what the host persists, so the live view and a
 * later re-entry agree:
 *
 *   - text already streamed → that activity becomes the turn, marked stopped;
 *   - nothing streamed → the same short neutral message the host appends, so the
 *     transcript does not simply swallow a turn the lecturer watched start.
 */
export function finalizeConversationRun(c: ConversationState): ConversationState {
  const stopped = c.runStopped;
  if (c.live.items.length === 0) {
    if (!stopped) return c.live === INITIAL_LIVE ? c : { ...c, live: liveReducer(c.live, { type: "reset" }) };
    return {
      ...c,
      turns: [
        ...c.turns,
        {
          role: "assistant",
          activity: [{ kind: "text", id: crypto.randomUUID(), text: chrome().chatStoppedTurnPlaceholder }],
          stopped: true,
        },
      ],
      runStopped: false,
      live: liveReducer(c.live, { type: "reset" }),
    };
  }
  return {
    ...c,
    turns: [...c.turns, { role: "assistant", activity: c.live.items, ...(stopped ? { stopped: true } : {}) }],
    runStopped: false,
    live: liveReducer(c.live, { type: "reset" }),
  };
}

export interface ReduceContext {
  /** Whether this slice is the VISIBLE conversation (its course is active). */
  visible: boolean;
  /** Whether reasoning is already enabled for the active provider (global). */
  reasoningOn: boolean;
}

/**
 * Apply ONE agent event to ONE conversation slice. Pure: returns the next slice
 * state and touches nothing outside it. Global side effects (the red error
 * banner for the visible conversation, `cbe_profile` persistence) live in the
 * store's `ingestAgentEvent`, not here.
 */
export function reduceConversation(c: ConversationState, evt: AgentEvent, ctx: ReduceContext): ConversationState {
  switch (evt.type) {
    case "text_delta":
      return { ...c, live: liveReducer(c.live, { type: "text_delta", data: { delta: evt.data.delta } }) };
    case "error": {
      // Finalize whatever streamed before the error so it is not wiped by the
      // next run's reset. The failure surfaces as the readable classified chat
      // error state (Requirement: Collected UX Polish, readable provider-error
      // surfacing): display-state on the slice — rendered by the chat panel,
      // never the alarm banner, never the raw payload, never a transcript turn.
      // A background slice carries the same notice; it shows when its course
      // becomes visible. Full raw detail stays in the session log (agent-harness,
      // Documented Error Behaviour).
      const finalized = finalizeConversationRun({ ...c, runHadError: true });
      // ...EXCEPT for a run the lecturer stopped: a stop is not a failure, and
      // no provider-error state is shown for it (capability `desktop-app`,
      // Requirement: *Composer Control Row*). The host already keeps the abort's
      // own stream error off this channel; this is the surface's own half of the
      // rule, so the state cannot appear even if one slipped through.
      if (c.runStopped) return finalized;
      return { ...finalized, chatNotice: providerErrorNotice(evt.data.message) };
    }
    case "agent_start":
      // New run boundary: reset the per-run signature observations. The
      // dispatch-in-flight flag hands over to the streaming flag here. A
      // surfaced cut-off state clears — whatever the lecturer dispatched
      // (Continue, Retry, or their own message) supersedes it.
      return {
        ...c,
        runHadTool: false,
        runHadError: false,
        dispatchPending: false,
        cutOffNote: null,
        // A new run is not the stopped one. (A stop LATCHED before the run
        // started re-announces itself right after this boundary, so it is not
        // lost here — see the harness controller's latch.)
        runStopped: false,
        // A new run means the previous one is over, whatever the runtime did
        // with it — the timed-out stop's dead end has ended too.
        stopTimedOut: false,
        live: liveReducer(c.live, { type: "agent_start" }),
      };
    case "agent_end": {
      // The run boundary the runtime ALWAYS reaches. The ring's pending state is
      // released here as well as on a terminal companion phase, so a companion
      // sequence that failed before emitting one cannot strand it (the banner's
      // own state is untouched).
      const next = { ...c, contextPending: false, live: liveReducer(c.live, { type: "agent_end" }) };
      // The host's `agent_end` is the SETTLED end — one per run, after every
      // retry, recovery or continuation — so it always finalizes.
      const finalized = finalizeConversationRun(next);
      // Reasoning-remediation detection on the OPENING exchange (per session).
      const offer = shouldOfferReasoningRemediation({
        isOpeningExchange: !c.hadExchange,
        reasoningAlreadyOn: ctx.reasoningOn,
        anyToolRan: c.runHadTool,
        endedWithError: c.runHadError,
      });
      return {
        ...finalized,
        hadExchange: true,
        // The runtime finally released the run: a stop that had reported
        // `timed-out` over it has nothing left to report.
        stopTimedOut: false,
        ...(offer ? { offerReasoningRemediation: true } : {}),
        // Unseen-completion marker: a background run reached its terminal end
        // while its course was not visible (Requirement: Background Conversations
        // and Per-Session Event Demultiplexing).
        ...(ctx.visible ? {} : { unseenCompletion: true }),
      };
    }
    case "turn_start":
      return { ...c, live: liveReducer(c.live, { type: "turn_start" }) };
    case "turn_end":
      return { ...c, live: liveReducer(c.live, { type: "turn_end" }) };
    case "tool_execution_start":
      return {
        ...c,
        runHadTool: true,
        live: liveReducer(c.live, { type: "tool_start", data: evt.data }),
      };
    case "tool_execution_update":
      return {
        ...c,
        live: liveReducer(c.live, {
          type: "tool_update",
          data: { toolCallId: evt.data.toolCallId, partialResult: evt.data.partialResult },
        }),
      };
    case "tool_execution_end": {
      let next: ConversationState = {
        ...c,
        live: liveReducer(c.live, { type: "tool_end", data: evt.data }),
      };
      // cbe_canvas / cbe_step are fire-and-forget: apply the VALIDATED result
      // details to THIS slice's canvas / step headers once the call completes —
      // a background session's calls land in its own course's canvas.
      const canvas = parseCanvasDetails(evt.data.result, evt.data.isError);
      if (canvas) {
        next = {
          ...next,
          artifacts:
            canvas.action === "clear"
              ? applyCanvasClear(next.artifacts, canvas.step, canvas.phase, canvas.id)
              : applyCanvasSet(next.artifacts, canvas.step, canvas.phase, canvas.id, canvas),
        };
        // Host-derived focus rides on the canvas result, so the step header follows
        // the step that actually received content — the same transition the host-side
        // step mirror recorded, applied here rather than re-derived.
        if (canvas.action === "set" && typeof canvas.focusStep === "number") {
          next = { ...next, steps: applyStepPatch(next.steps, canvas.focusStep, { focus: true }) };
        }
      }
      const step = parseStepDetails(evt.data.result, evt.data.isError);
      if (step) {
        next = { ...next, steps: applyStepPatch(next.steps, step.step, step) };
      }
      // cbe_maturity is fire-and-forget too: apply the VALIDATED result details
      // to THIS slice's maturity raster — a background session's calls land in
      // its own conversation's state, never the visible panel's.
      const maturity = parseMaturityToolDetails(evt.data.result, evt.data.isError);
      if (maturity) {
        next = { ...next, maturity: applyMaturityUpdate(next.maturity, maturity) };
      }
      return next;
    }
    case "thinking_start":
      return {
        ...c,
        live: liveReducer(c.live, { type: "thinking_start", data: { contentIndex: evt.data.contentIndex } }),
      };
    case "thinking_delta":
      return { ...c, live: liveReducer(c.live, { type: "thinking_delta", data: evt.data }) };
    case "thinking_end":
      return {
        ...c,
        live: liveReducer(c.live, { type: "thinking_end", data: { contentIndex: evt.data.contentIndex } }),
      };
    case "compaction_start":
      return { ...c, live: liveReducer(c.live, { type: "compaction_start", data: { reason: evt.data.reason } }) };
    case "compaction_end":
      return { ...c, live: liveReducer(c.live, { type: "compaction_end" }) };
    case "compaction_phase": {
      // Companion sequence visibility (Requirement: Compaction Visibility in
      // the Renderer): the phase drives the continuous working state in the
      // live slice; a failure ("error") clears it there and surfaces the
      // readable error state as the soft inline chat notice — chat
      // history untouched either way.
      const next = {
        ...c,
        live: liveReducer(c.live, { type: "compaction_phase", data: { phase: evt.data.phase } }),
        // The ring's own pending flag (Requirement: Context-Usage Ring…): armed
        // while the sequence runs, released on it ending for ANY reason. The
        // banner's state above is untouched.
        contextPending: evt.data.phase === "consolidating" || evt.data.phase === "compacting",
      };
      return evt.data.phase === "error" ? { ...next, chatNotice: compactionFailedNotice() } : next;
    }
    case "auto_retry_start":
      return {
        ...c,
        live: liveReducer(c.live, {
          type: "retry_start",
          data: { attempt: evt.data.attempt, maxAttempts: evt.data.maxAttempts },
        }),
      };
    case "auto_retry_end":
      return { ...c, live: liveReducer(c.live, { type: "retry_end" }) };
    case "maturity_state":
      // Host-derived substance / provenance / staleness, pushed whenever a
      // settled design change or a `cbe_maturity` call moved it (capability
      // `desktop-app`, Requirement: Maturity Panel Substance and Staleness
      // Framing). Stored per slice like the raster itself, so a background
      // conversation's reading going stale never reframes the visible panel.
      // Taken WHOLE — the renderer recomputes none of it.
      return { ...c, maturityState: evt.data };
    case "context_usage":
      // The harness's occupancy report for THIS session (capability
      // `agent-harness`, Requirement: Context Occupancy Reported to the Host).
      // Stored per slice; the renderer computes no figure of its own.
      return {
        ...c,
        contextUsage: evt.data,
        contextEverMeasured: c.contextEverMeasured || evt.data.used !== null,
      };
    case "truncation_cutoff":
      // The harness surfaced a truncated completion it can no longer
      // auto-continue (Requirement: Response-Cut-Off State with One-Click
      // Continue and Retry). Recorded per slice — a background conversation's
      // cut-off shows when its course becomes visible.
      //
      // Never for a run the lecturer stopped: offering to continue an answer
      // they just stopped would undo the action they took. The carve-out is
      // written into the harness requirement that PRODUCES this event, and the
      // cut-off state keeps governing genuine truncations untouched.
      return c.runStopped ? c : { ...c, cutOffNote: evt.data.note };
    case "turn_stopped":
      // The lecturer's stop took effect (capability `agent-harness`,
      // Requirement: *A Lecturer Can Stop a Running Turn*). It arrives BEFORE
      // the run's end, which is what lets the turn this run produces be
      // finalised already marked instead of being committed as complete and
      // corrected afterwards.
      return { ...c, runStopped: true };
    default:
      return c;
  }
}
