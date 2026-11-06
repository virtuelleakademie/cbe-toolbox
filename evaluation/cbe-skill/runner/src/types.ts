/**
 * Shared types for the CBE skill evaluation harness.
 *
 * The verdict vocabulary is the single canonical enum used by every checker
 * (deterministic + judge) and by aggregate scoring — see spec requirement
 * "Canonical checkpoint verdict vocabulary".
 */

export type Verdict = "pass" | "fail" | "partial" | "not-assessable" | "error";

/** Verdicts a deterministic (code) check may emit. */
export const DETERMINISTIC_VERDICTS: readonly Verdict[] = ["pass", "fail", "not-assessable", "error"];
/** Verdicts the LLM judge may emit. */
export const JUDGE_VERDICTS: readonly Verdict[] = ["pass", "fail", "partial", "not-assessable"];

export type CheckpointType = "deterministic" | "judge";

export type DeterministicKind =
  | "cite_all"
  | "cite_none_outside_corpus"
  | "tool_called"
  | "tool_not_called"
  // Added by `format-canvas-artefacts-in-markdown`. `tool_called` sees only THAT a tool
  // was invoked, and the judge is handed tool NAMES and never their arguments — so what
  // a mirroring tool actually WROTE was unmeasurable in either checker. This one reads
  // one named argument off the call, which is where a canvas value lives.
  | "tool_arg_matches"
  | "contains"
  | "not_contains"
  // Added by `rebuild-skill-prompt-and-eval`. Each exists because a judge CANNOT
  // make the call: it sees only the emitted text.
  | "cite_provenance"
  | "reply_language"
  | "no_trailing_menu"
  // Added by `catch-sham-citations-and-substituted-sources`. `cite_provenance`
  // governs the tokens that WERE emitted; this one governs the attributions that
  // were made without one — a document id in prose, or a token-shaped string the
  // canonical pattern does not even match.
  | "cite_no_sham_attribution"
  // Added by `verify-hand-written-citation-tokens`. The product ruling of
  // 2026-08-10 makes the hand-written token lawful; what it loses is the section
  // check `cbe_cite` performs, so the section is checked here instead of the route.
  | "cite_section_resolves"
  // Added by `show-target-and-derive-overall-maturity`. Both read the SHAPE of a
  // `cbe_maturity` payload, which no other kind can: `tool_arg_matches` reads one
  // named STRING argument, and the aggregate and the capping marker live inside
  // the `readings` array or beside a `criterion` key. A judge is handed tool names
  // and never their arguments, so without these the two rules the change turns on
  // had no instrument at all.
  //
  // `maturity_no_pushed_aggregate` — the aggregate achieved level is derived by
  // the host, so a call that sets `current` on the `overall` record is a rule
  // violation the host silently corrects; only this sees that it was attempted.
  | "maturity_no_pushed_aggregate"
  // `maturity_cap_marked` — where the lecturer leaves a finding standing, the
  // affected criterion is recorded with the capping marker, which is what keeps
  // the derived aggregate from overtaking it.
  | "maturity_cap_marked";

/**
 * The kinds the checker actually implements. A checkpoint typed `deterministic`
 * naming a kind outside this set is rejected AT LOAD (capability
 * `cbe-skill-eval-harness`, Requirement: *A Deterministic Checkpoint Is Backed by an
 * Implemented Check*) — never left as a check the runner silently cannot make.
 */
export const IMPLEMENTED_DETERMINISTIC_KINDS: readonly DeterministicKind[] = [
  "cite_all",
  "cite_none_outside_corpus",
  "tool_called",
  "tool_not_called",
  "tool_arg_matches",
  "contains",
  "not_contains",
  "cite_provenance",
  "reply_language",
  "no_trailing_menu",
  "cite_no_sham_attribution",
  "cite_section_resolves",
  "maturity_no_pushed_aggregate",
  "maturity_cap_marked",
];

export interface DeterministicCheck {
  kind: DeterministicKind;
  /** Corpus ids required (cite_all). */
  ids?: string[];
  /** Tool name (tool_called / tool_not_called / tool_arg_matches). */
  tool?: string;
  /** Argument name read off the tool call (tool_arg_matches), e.g. `value`. */
  arg?: string;
  /** String or regex source (contains / not_contains); expected language tag for
   *  `reply_language` ("en" | "de"), or omitted there to mean "mirror the user turn". */
  pattern?: string;
}

/**
 * Where the behaviour a checkpoint tests is GOVERNED (capability
 * `cbe-skill-eval-harness`, Requirement: *Scenario files carry a machine-executable
 * checkpoint block*).
 *
 * A checkpoint without an anchor DOES NOT SHIP. The previous suite ran with 234 of 296
 * checkpoints unanchored: a failure could not be routed to the text that caused it, so
 * every red checkpoint cost a fresh investigation to decide whether the skill, the
 * rubric or the scenario was wrong.
 *
 * The anchor space covers all three instruction channels (capability `agent-harness`,
 * Requirement: *Instruction Channel Boundary*), because a checkpoint may now be governed
 * by any of them.
 */
export interface CheckpointAnchor {
  /** `skill` — the eagerly-included body; `prompt` — the identity prompt; `tool` — a
   *  named `cbe_*` tool description. */
  channel: "skill" | "prompt" | "tool";
  /** `skill`: path under `skills/cbe/` (normally `SKILL.md`). `prompt`: `identity-prompt`.
   *  `tool`: the tool name, e.g. `cbe_picker`. */
  file: string;
  /** A heading in that channel, or a unique marker string within it. */
  heading: string;
}

export interface Checkpoint {
  id: string;
  type: CheckpointType;
  /** At least one anchor. Enforced by the loader; an empty list is not a valid state. */
  anchors: CheckpointAnchor[];
  /** Present when type === "deterministic". */
  check?: DeterministicCheck;
  /** Present when type === "judge". */
  rubric?: string;
  /** Optional 0-based turn index this checkpoint targets; default: the last turn. */
  turn?: number;
}

/** A probe's support-preference seed (see `ProbeSetup.lecturerSupport`). Mirrors
 * `LecturerSupportRecord` / `SupportStorageScope` in pi-bridge, restated here because
 * the runner's type surface deliberately does not import pi-bridge. */
export interface ProbeLecturerSupport {
  preference: "guided" | "collaborative" | "concise" | null;
  revision?: number;
  scope?: "lecturer-wide" | "session-local";
}

export interface ProbeSetup {
  profile: "app" | "headless";
  /** Explicit affordance overrides; merged onto the profile defaults by the runner. */
  affordances?: Record<string, boolean>;
  /** Corpus ids the probe expects to be citable; validated against corpus/index.json. */
  corpus?: string[];
  /** Lecturer profile injected at session start as a prior (capability
   * `agent-harness`, Requirement: Session-Start Profile Injection). Probes use
   * this to simulate a returning lecturer; pi-bridge validates the shape. */
  lecturerProfile?: Record<string, unknown>;
  /** Lecturer IDENTITY record injected at session start as a `lecturer-identity`
   * block (capability `agent-harness`, Requirement: Session-Start Identity
   * Injection — eval exercisability). A SEPARATE prior from `lecturerProfile`
   * above: `{ name?, formOfAddress? }`, both optional, both free text, and neither
   * a lecturer-state dimension. Omit — or pass a record with nothing recorded — and
   * the descriptor is byte-identical to a probe run without the feature, which is
   * exactly what the no-question direction has to measure. */
  lecturerIdentity?: Record<string, unknown>;
  /** The lecturer's separate SUPPORT PREFERENCE at session start (capability
   * `agent-harness`, Requirement: Separate Lecturer-Wide Support Preference — eval
   * exercisability). Seeds the probe's OWN isolated in-memory store, through which
   * the registered `cbe_support` tool also writes, so no probe and no production
   * record is ever shared. `preference` is one of guided|collaborative|concise or
   * null; `revision` defaults to 0; `scope` defaults to what the profile's host
   * reports (app → lecturer-wide, headless → session-local). The loader rejects any
   * other shape. Omitted → the probe still gets an isolated store with nothing
   * recorded, exactly as the app always passes its service. */
  lecturerSupport?: ProbeLecturerSupport;
  /** Wiki fixture provisioned into an isolated course-wiki directory before the
   * session starts (capability `lecturer-wiki`): wiki-relative path → file
   * content. The runner passes the directory as `paths.wiki`. */
  wikiFixture?: Record<string, string>;
  /** Raw `course.md` content injected at session start (capability
   * `course-workspace`, Requirement: Course Context in course.md). */
  courseContext?: string;
  /** Carried-over canvas artefacts seeded at session start as a `canvas prior`
   * (capability `agent-harness`, Requirement: Session-Start Canvas Artefact
   * Injection). Each entry mirrors the host-side mirror shape: step, phase?,
   * id, label?, value, state. */
  canvasArtefacts?: Array<Record<string, unknown>>;
  /** Carried-over design-flow step coverage, rendered as a `step-coverage prior`
   * (capability `agent-harness`, Requirement: Session-Start Retained-State
   * Injection — eval exercisability). */
  stepCoverage?: Array<Record<string, unknown>>;
  /** Carried-over maturity reading, rendered as a `maturity prior`. */
  maturity?: Record<string, unknown>;
  /** The two Lecturer-State layers (capability `course-workspace`, Requirement:
   * Lecturer-State as Global Profile plus Per-Course Overlay), rendered as the
   * `lecturer-state layers` block (capability `cbe-skill-eval-harness`,
   * Requirement: A Probe Reproduces the App's Session Priors, and Every
   * Divergence Is Declared). All four fields are required strings — the loader
   * rejects any other shape at load, before a model call is paid for. */
  lecturerState?: { globalPath: string; globalContent: string; overlayPath: string; overlayContent: string };
  /** Recorded decision artefacts, pre-summarised to one compact line and
   * rendered as a `decisions prior` block (same requirement as above). */
  decisionsSummary?: string;
}

export interface Probe {
  /** Sub-probe id such as "7a". Unique across the suite. */
  probe: string;
  /** Source scenario file (absolute or repo-relative path). */
  scenarioFile: string;
  setup: ProbeSetup;
  turns: string[];
  checkpoints: Checkpoint[];
}

export interface ToolInvocation {
  name: string;
  callId?: string;
  /**
   * The call's arguments, as surfaced on `tool_execution_start`. Needed by
   * `cite_provenance`, which has to see WHICH document a `read` opened and which id a
   * `cbe_cite` call carried — a judge reads only the emitted text, and the emitted text
   * of a fabricated token is indistinguishable from a grounded one. That is exactly how
   * the previous suite came to reward the fabrication path.
   */
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; callId?: string; args?: unknown }
  | { type: "tool_end"; name: string; callId?: string; result?: unknown; isError: boolean };

export interface TurnTranscript {
  user: string;
  assistant: string;
  tools: ToolInvocation[];
  events?: TurnEvent[];
}

export interface Transcript {
  probe: string;
  model: string;
  turns: TurnTranscript[];
}

export interface CheckResult {
  id: string;
  type: CheckpointType;
  verdict: Verdict;
  /** Verbatim transcript substring backing the verdict. */
  evidence?: string;
  reasoning?: string;
  /** The checkpoint's pass criterion (judge rubric), surfaced for the editor. */
  rubric?: string;
}

/**
 * Aggregate pass count, excluding `not-assessable` items in both directions.
 * This is the metric the improvement loop compares across iterations.
 */
export function passCount(results: CheckResult[]): number {
  return results.filter((r) => r.verdict === "pass").length;
}

/** A checkpoint counts as failing (and triggers the editor) when fail or partial. */
export function isFailing(verdict: Verdict): boolean {
  return verdict === "fail" || verdict === "partial";
}

/** Ordering for the keep-or-revert delta. not-assessable/error are unranked (excluded). */
const VERDICT_RANK: Partial<Record<Verdict, number>> = { fail: 0, partial: 1, pass: 2 };

export interface VerdictDelta {
  /** Targeted checkpoints whose verdict moved up the ordering. */
  improved: string[];
  /** Decision-set checkpoints whose verdict moved down the ordering. */
  regressed: string[];
}

/**
 * Classify the per-checkpoint verdict change between two iterations for the
 * keep-or-revert gate. Improvement is counted only over `targeted` ids; regression
 * over the whole `inScope` decision set. Transitions touching `not-assessable`/
 * `error` on either side are neither (unranked) — the caller may log them.
 */
export function classifyVerdictDelta(
  prev: CheckResult[],
  next: CheckResult[],
  opts: { targeted: Set<string>; inScope: Set<string> }
): VerdictDelta {
  const nextById = new Map(next.map((r) => [r.id, r.verdict]));
  const improved: string[] = [];
  const regressed: string[] = [];
  for (const p of prev) {
    const before = VERDICT_RANK[p.verdict];
    const afterVerdict = nextById.get(p.id);
    const after = afterVerdict === undefined ? undefined : VERDICT_RANK[afterVerdict];
    if (before === undefined || after === undefined) continue; // not-assessable/error either side
    if (opts.targeted.has(p.id) && after > before) improved.push(p.id);
    if (opts.inScope.has(p.id) && after < before) regressed.push(p.id);
  }
  return { improved, regressed };
}

/**
 * Reduce N repeated runs of the same probes to one verdict per checkpoint by
 * majority. Ties and otherwise are broken toward the more conservative (lower-ranked)
 * verdict, so a stochastic upward flip never wins a tie. The first occurrence of the
 * WINNING verdict supplies its evidence/reasoning; borrowing a losing run's explanation
 * can turn an ordinary fail into an apparent N/A with contradictory reasoning.
 */
export function majorityVerdict(runs: CheckResult[][]): CheckResult[] {
  const order: string[] = [];
  const byId = new Map<
    string,
    { template: CheckResult; counts: Map<Verdict, number>; representatives: Map<Verdict, CheckResult> }
  >();
  for (const run of runs) {
    for (const r of run) {
      let entry = byId.get(r.id);
      if (!entry) {
        entry = { template: r, counts: new Map(), representatives: new Map() };
        byId.set(r.id, entry);
        order.push(r.id);
      }
      entry.counts.set(r.verdict, (entry.counts.get(r.verdict) ?? 0) + 1);
      if (!entry.representatives.has(r.verdict)) entry.representatives.set(r.verdict, r);
    }
  }
  const rankOf = (v: Verdict): number => VERDICT_RANK[v] ?? -1;
  return order.map((id) => {
    const { template, counts, representatives } = byId.get(id)!;
    let best: Verdict = template.verdict;
    let bestCount = -1;
    for (const [verdict, count] of counts) {
      if (count > bestCount || (count === bestCount && rankOf(verdict) < rankOf(best))) {
        best = verdict;
        bestCount = count;
      }
    }
    return { ...representatives.get(best)! };
  });
}
