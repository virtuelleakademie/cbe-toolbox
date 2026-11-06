/**
 * Didactic-check session state — the `didactic-checks` sidecar object.
 *
 * Records, per challenge or unit, the state of the three ordered checks
 * (Kompetenz → Alignment → Delegation; see capability `cbe-skill`,
 * Requirement: Check Execution Order), the operative goal set the checks ran
 * against, and the per-component delegation decisions with lecturer reasoning.
 *
 * This module owns the SHAPE and the pure state transitions. Persistence (round
 * trip through the JSON sidecar) lives in `packages/app/src/main/sessions.ts`;
 * the skill behaviour that drives the transitions lives in `skills/cbe/`.
 * Keeping the reducers here makes the ordering invariant and the
 * goal-change-resets-downstream rule testable without booting the app or a model.
 */

export type CheckStatus = "not-started" | "in-progress" | "completed";

/** The three checks, in execution order. Index in this array = pipeline position. */
export const CHECK_ORDER = ["kompetenz", "alignment", "delegation"] as const;
export type CheckName = (typeof CHECK_ORDER)[number];

export type GoalSharpness = "sharp" | "pending-sharpening";

export interface OperativeGoal {
  /** Stable id so downstream findings/decisions can reference a goal across revisions. */
  id: string;
  /** The operative formulation — the refined version once the lecturer sharpens it. */
  text: string;
  sharpness: GoalSharpness;
  /** Citation tokens the Kompetenz Check used to challenge sharpness. */
  citations?: string[];
}

export type AlignmentStatus = "aligned" | "flagged";

export interface AlignmentFinding {
  /** References an OperativeGoal.id from the Kompetenz check. */
  goalId: string;
  status: AlignmentStatus;
  /** The named mis-alignment pattern when status === "flagged". */
  pattern?: string;
  /** Deep-link hint into the affected phase-side artifact (e.g. "investigate:assessment"). */
  affectedArtifact?: string;
}

export type DelegationStatus = "student-generated" | "hybrid" | "delegable";

export interface DelegationDecision {
  /** Challenge component, e.g. "Essential Question formulation". */
  component: string;
  status: DelegationStatus;
  /** The lecturer's stated reasoning — recorded verbatim, never authored by the skill. */
  reasoning: string;
  /** A germane-vs-extraneous inconsistency the skill raised, if any. */
  inconsistencyFlag?: string;
}

export interface KompetenzState {
  status: CheckStatus;
  goals: OperativeGoal[];
}

export interface AlignmentState {
  status: CheckStatus;
  findings: AlignmentFinding[];
}

export interface DelegationState {
  status: CheckStatus;
  decisions: DelegationDecision[];
}

/** Dev-marked behaviour outputs — artifact-level dev-marked until PIONEER review. */
export interface HeterogeneityState {
  fired: boolean;
  notes?: string;
}

export interface SoftSkillState {
  fired: boolean;
  anchors?: { goal: string; anchor: string | null }[];
}

export interface DidacticChecks {
  kompetenz: KompetenzState;
  alignment: AlignmentState;
  delegation: DelegationState;
  /** Dev-marked, optional — only present once the behaviour fires. */
  heterogeneity?: HeterogeneityState;
  /** Dev-marked, optional — only present once the behaviour fires. */
  softSkill?: SoftSkillState;
}

/** A fresh, empty check state — all three checks not-started, no goals/findings/decisions. */
export function emptyDidacticChecks(): DidacticChecks {
  return {
    kompetenz: { status: "not-started", goals: [] },
    alignment: { status: "not-started", findings: [] },
    delegation: { status: "not-started", decisions: [] },
  };
}

/**
 * The ordering gate. Returns true iff the Delegation Check is allowed to run —
 * i.e. both Kompetenz and Alignment are completed. The skill consults this before
 * entering Delegation; if false it defers and runs the missing upstream check
 * (see Requirement: Check Execution Order, refusal-and-defer scenario).
 */
export function canEnterDelegation(state: DidacticChecks): boolean {
  return state.kompetenz.status === "completed" && state.alignment.status === "completed";
}

/**
 * Goal-change-resets-downstream. When the lecturer modifies an operative goal
 * AFTER a downstream check has run, the affected downstream checks reset to
 * not-started and their findings/decisions clear — they ran against a goal set
 * that no longer holds. The reset propagates in pipeline order: a Kompetenz
 * revision resets Alignment AND Delegation; an Alignment revision resets
 * Delegation. Returns a new state object; the input is not mutated.
 *
 * @param changed the check whose operative-goal input the lecturer revised.
 */
export function resetDownstreamOnGoalChange(state: DidacticChecks, changed: CheckName): DidacticChecks {
  const changedIdx = CHECK_ORDER.indexOf(changed);
  const next: DidacticChecks = {
    kompetenz: { ...state.kompetenz, goals: [...state.kompetenz.goals] },
    alignment: { ...state.alignment, findings: [...state.alignment.findings] },
    delegation: { ...state.delegation, decisions: [...state.delegation.decisions] },
    ...(state.heterogeneity ? { heterogeneity: { ...state.heterogeneity } } : {}),
    ...(state.softSkill ? { softSkill: { ...state.softSkill } } : {}),
  };
  // Every check strictly downstream of `changed` resets.
  if (CHECK_ORDER.indexOf("alignment") > changedIdx) {
    next.alignment = { status: "not-started", findings: [] };
  }
  if (CHECK_ORDER.indexOf("delegation") > changedIdx) {
    next.delegation = { status: "not-started", decisions: [] };
  }
  return next;
}

/** Names the downstream checks that a revision to `changed` invalidates (for UI signalling). */
export function downstreamChecks(changed: CheckName): CheckName[] {
  const changedIdx = CHECK_ORDER.indexOf(changed);
  return CHECK_ORDER.filter((_, i) => i > changedIdx);
}

/** Runtime type guard — used by the sidecar reader to reject malformed `didactic-checks` blobs. */
export function isDidacticChecks(value: unknown): value is DidacticChecks {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const checkBlock = (b: unknown, arrayKey: string): boolean => {
    if (!b || typeof b !== "object") return false;
    const rec = b as Record<string, unknown>;
    if (rec.status !== "not-started" && rec.status !== "in-progress" && rec.status !== "completed") return false;
    return Array.isArray(rec[arrayKey]);
  };
  if (!checkBlock(v.kompetenz, "goals")) return false;
  if (!checkBlock(v.alignment, "findings")) return false;
  if (!checkBlock(v.delegation, "decisions")) return false;
  // heterogeneity / softSkill are optional; if present they must carry a boolean `fired`.
  if (v.heterogeneity !== undefined) {
    const h = v.heterogeneity as Record<string, unknown>;
    if (!h || typeof h !== "object" || typeof h.fired !== "boolean") return false;
  }
  if (v.softSkill !== undefined) {
    const s = v.softSkill as Record<string, unknown>;
    if (!s || typeof s !== "object" || typeof s.fired !== "boolean") return false;
  }
  return true;
}
