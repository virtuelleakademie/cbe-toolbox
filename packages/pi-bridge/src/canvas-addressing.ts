/**
 * Shared canvas artefact ADDRESSING resolution (capability `agent-harness`,
 * Requirement: cbe_canvas Generative-UI Tool — "the addressing rules are defined
 * ONCE and applied identically by the renderer reducer and the host-side mirror").
 *
 * The final 4.2.1 canvas is organized along the ten design steps. An artefact is
 * addressed by an optional `step` group key (1..10) plus, for Step 6's learning
 * journey, a `phase` journey element (engage | investigate | act | reflect). Legacy
 * phase-only calls (no `step`) stay valid via a seeded-id → home table.
 *
 * This module is the SINGLE authority: pi-bridge's `CanvasMirror` and the renderer's
 * `applyCanvasUpdate`/`clearCanvasArtefact` both resolve addresses through
 * `resolveCanvasAddress` so a phase-only call and its step-keyed equivalent can never
 * land in two different rows. It is pure (no I/O, no renderer imports) so both the
 * host and the renderer can import it.
 */

/** The four Step-6 learning-journey elements of the final 4.2.1 (the fourth,
 * `reflect` = "Reflect and present", is new relative to the three-phase canvas). */
export type JourneyPhase = "engage" | "investigate" | "act" | "reflect";

export const JOURNEY_PHASES: readonly JourneyPhase[] = ["engage", "investigate", "act", "reflect"];

/** A fully-resolved canvas address: the step group (1..10) and, for Step 6 only,
 * the journey element. Non-journey steps carry no `phase`. */
export interface ResolvedCanvasAddress {
  step: number;
  phase?: JourneyPhase;
}

/** The raw addressing fields a `cbe_canvas` call may carry. */
export interface CanvasAddressInput {
  step?: unknown;
  phase?: unknown;
  id?: unknown;
}

export function isJourneyPhase(v: unknown): v is JourneyPhase {
  return typeof v === "string" && (JOURNEY_PHASES as readonly string[]).includes(v);
}

/** A valid step group key is an integer 1..10. */
export function isValidStep(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10;
}

/**
 * The seeded (canonical) CBL artefacts and their step-group HOME after the
 * ten-step restructure. Only these ids can be reached by a legacy phase-only call;
 * their canonical ids are UNCHANGED (capability `desktop-app`, Requirement:
 * Artifacts Tab / Canvas — "canonical ids unchanged").
 *
 * - The challenge ladder (`bigidea`, `eq`, `challenge`) → Step 4.
 * - The four phase-plan slices of Step 6, one per journey element: `es` → Engage,
 *   `is` → Investigate, `as` → Act, `rs` → Reflect.
 *
 * The classic CBL learner-time artefacts (`gq`, `ar`, `syn`, `sc`, `sd`, `ie`) are NOT in
 * this table: they are no longer canonical anywhere, so there is no row for a legacy call
 * to reach. An unknown id carrying a `phase` now follows that phase (rule 2 below) instead
 * of being re-homed by this table.
 */
export const SEEDED_ARTEFACT_HOME: Readonly<Record<string, ResolvedCanvasAddress>> = {
  bigidea: { step: 4 },
  eq: { step: 4 },
  challenge: { step: 4 },
  es: { step: 6, phase: "engage" },
  is: { step: 6, phase: "investigate" },
  as: { step: 6, phase: "act" },
  rs: { step: 6, phase: "reflect" },
};

/**
 * The CANONICAL seeded slots per canvas container (capability `agent-harness`,
 * Requirement: Deterministic Tool-Boundary Enforcement for Canvas Ids, Step Coverage
 * and Unfed Surfaces — "the set of seeded artefact ids per step group … MUST live in
 * the shared addressing module that both the harness tools and the renderer import").
 *
 * A container is a step group (`"3"`) or, for Step 6, a journey element (`"6/act"`).
 * The ids mirror `skills/cbe/SKILL.md` § _2. The ten steps_ — this
 * table is the machine-readable authority for the same contract, and the renderer's
 * canvas seed (`packages/app/src/renderer/mocks/artifacts.ts`) is derived from it so
 * the tool and the display can never disagree about which id is canonical. Labels are
 * display copy and stay renderer-side.
 *
 * EVERY container seeds canonical ids, and the table carries ONE seeded slot per NAMED
 * STEP OUTPUT — never a slot for a learner-time activity.
 *
 * WHY step 6 is symmetric, since it once was not and the asymmetry read as deliberate:
 *
 * - `methodology-012` § Step 6 names a SINGLE output — "Phase plan / module timeline",
 *   "a simple timeline with phases and checkpoints" — and lists no artefacts under any of
 *   its four journey elements. Each element therefore seeds exactly one slot holding THAT
 *   ELEMENT'S SLICE of the one plan: `es` = Engage Sequence, `is` = Investigate Sequence,
 *   `as` = Act Sequence, `rs` = Reflect Sequence. One card each, because the plan for a
 *   phase is one plan.
 * - `6/investigate` and `6/act` used to seed the classic CBL phase artefacts of
 *   `methodology-001` (`gq`, `ar`, `syn`; `sc`, `sd`, `ie`). Those are defined there in
 *   LEARNER voice ("Learners identify resources…", "learners analyze the accumulated
 *   data…", "Learners develop prototypes…") — learner time, not design time. Seeding
 *   them made the canvas demand six design-time cards the design flow never asks for,
 *   exactly the substitution `methodology-012` § _Designer-time flow vs learner-time
 *   journey_ warns against. They are RETIRED from this table and keep their meaning in the
 *   corpus, where they belong. The cost was not cosmetic: `stepCanonicalSlots(6)`
 *   aggregates over all four containers, so every step-level consumer — the depth guards,
 *   the close gate, the outstanding-slot echo — measured a finished phase plan as six
 *   cards short.
 * - Step 4's THREE slots (`bigidea`, `eq`, `challenge`) are the one deliberate exception to
 *   "one slot per named output" and are NOT the same kind of drift: the argument, with its
 *   corpus sources, lives in capability `agent-harness`, Requirement: Deterministic
 *   Tool-Boundary Enforcement for Canvas Ids, Step Coverage and Unfed Surfaces. Read it
 *   there before removing them.
 */
export const CANONICAL_SLOTS: Readonly<Record<string, readonly string[]>> = {
  "1": ["moduleframe"],
  "2": ["learningoutcomes"],
  "3": ["assessmentblueprint"],
  "4": ["bigidea", "eq", "challenge"],
  "5": ["stakeholderplan"],
  "6/engage": ["es"],
  "6/investigate": ["is"],
  "6/act": ["as"],
  "6/reflect": ["rs"],
  "7": ["activityplan"],
  "8": ["deliverablesmap"],
  "9": ["alignmentmatrix"],
  "10": ["readinesschecklist"],
};

/** Stable key of a resolved address' CONTAINER (step group, or step-6 journey element)
 * — the key `CANONICAL_SLOTS` is indexed by. */
export function canvasContainerKey(addr: ResolvedCanvasAddress): string {
  return addr.phase ? `${addr.step}/${addr.phase}` : `${addr.step}`;
}

/** The canonical seeded ids of a resolved address' container; empty for a container
 * that seeds nothing (and for an unknown container, which cannot happen for a resolved
 * address but keeps the helper total). */
export function canonicalSlots(addr: ResolvedCanvasAddress): readonly string[] {
  return CANONICAL_SLOTS[canvasContainerKey(addr)] ?? [];
}

/** Separator- and case-insensitive comparison key for an artefact id: `Assessment-
 * Blueprint`, `assessment_blueprint` and `assessmentblueprint` all fold onto the same
 * value. Deliberately NOT a fuzzy match — a different WORD (`essentialquestion` vs
 * `eq`) must stay distinguishable so the tool can refuse it. */
function foldArtefactId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalise an artefact id against its container's canonical slots. Returns the
 * canonical id when `id` is a separator/case VARIANT of one of them (`assessment-
 * blueprint` → `assessmentblueprint`), and `null` when it is not a spelling of any
 * canonical id (`essentialquestion`, `module-meta-info`) or already canonical.
 *
 * Pure: it decides spelling only. Whether a non-normalisable id is acceptable is a
 * separate question, answered from the container's fill state (`emptySeededSlots`).
 */
export function normaliseArtefactId(addr: ResolvedCanvasAddress, id: string): string | null {
  const slots = canonicalSlots(addr);
  if (slots.includes(id)) return null;
  const folded = foldArtefactId(id);
  if (folded.length === 0) return null;
  return slots.find((slot) => foldArtefactId(slot) === folded) ?? null;
}

/** The minimal read surface `emptySeededSlots` needs — structurally satisfied by
 * `CanvasMirror` (declared here so this module keeps its no-imports purity). */
export interface CanvasFillLookup {
  get(addr: ResolvedCanvasAddress, id: string): { value?: string } | undefined;
}

/**
 * The container's canonical seeded ids that carry no content yet, in canonical order.
 * "Empty" means: no mirrored entry, or an entry whose value is blank. The renderer's
 * seed rows are never mirrored, so an unmirrored canonical id IS an empty slot.
 */
export function emptySeededSlots(addr: ResolvedCanvasAddress, mirror: CanvasFillLookup): string[] {
  return canonicalSlots(addr).filter((id) => {
    const entry = mirror.get(addr, id);
    return !entry || typeof entry.value !== "string" || entry.value.trim().length === 0;
  });
}

/**
 * Every CONTAINER of a step, in canonical order: step 6 resolves to its four journey
 * elements, every other step to itself. Total — a step outside 1..10 simply yields a
 * container with no canonical slots.
 */
export function stepContainers(step: number): ResolvedCanvasAddress[] {
  return step === 6 ? JOURNEY_PHASES.map((phase) => ({ step, phase })) : [{ step }];
}

/** How a slot of a MULTI-container step must be addressed: qualified with its journey
 * element, because step 6 cannot be written without a `phase`. A single-container step's
 * ids stay bare, so no other step's refusal text changes. */
function qualifySlot(addr: ResolvedCanvasAddress, id: string, qualified: boolean): string {
  return qualified && addr.phase ? `${addr.phase}/${id}` : id;
}

/**
 * A STEP's canonical seeded ids, aggregated over all of its containers (capability
 * `agent-harness`, Requirement: Deterministic Tool-Boundary Enforcement … — "a step's
 * canonical slots and its empty slots MUST be aggregated across ALL of that step's
 * containers").
 *
 * The step-level consumers — the `cbe_step` depth guards and `outstandingSlotEcho` — ask
 * a STEP for its slots, and the flat container key `"6"` does not exist in
 * `CANONICAL_SLOTS`. Before this helper they therefore saw step 6 as seeding nothing and
 * skipped it entirely: `cbe_step({ step: 6, depth: "detailed" })` was accepted on a
 * completely empty canvas.
 */
export function stepCanonicalSlots(step: number): string[] {
  const containers = stepContainers(step);
  const qualified = containers.length > 1;
  return containers.flatMap((addr) => canonicalSlots(addr).map((id) => qualifySlot(addr, id, qualified)));
}

/** The step's canonical seeded ids that carry no content yet, aggregated over all of its
 * containers and named exactly as `stepCanonicalSlots` names them. */
export function stepEmptySlots(step: number, mirror: CanvasFillLookup): string[] {
  const containers = stepContainers(step);
  const qualified = containers.length > 1;
  return containers.flatMap((addr) => emptySeededSlots(addr, mirror).map((id) => qualifySlot(addr, id, qualified)));
}

/**
 * Resolve a `cbe_canvas` addressing payload to a canvas step group (and, for Step 6,
 * a journey element), or `null` when the address is not resolvable (a safe no-op for
 * the caller — never a crash). One rule, applied identically by the mirror and the
 * renderer reducer:
 *
 * 1. A valid `step` (integer 1..10) selects the step group. For **step 6** a valid
 *    `phase` selects the journey element; a step-6 call WITHOUT a valid `phase` is
 *    unresolvable (null). For steps other than 6 a present `phase` is ignored.
 * 2. **Legacy mapping** — a call with a `phase` but no valid `step`: when its `id`
 *    matches a seeded artefact it resolves to that artefact's seeded home (the ladder
 *    ids → Step 4); otherwise, when `phase` is a known journey phase, it lands under
 *    Step 6's matching journey element.
 * 3. Anything else (no valid step, no known phase; or a step-6 call missing its phase)
 *    is unresolvable → `null`.
 */
export function resolveCanvasAddress(input: CanvasAddressInput): ResolvedCanvasAddress | null {
  const { step, phase, id } = input;

  if (isValidStep(step)) {
    if (step === 6) {
      return isJourneyPhase(phase) ? { step: 6, phase } : null;
    }
    return { step };
  }

  // No valid step — legacy phase path. A seeded id resolves to its fixed home first
  // (an in-place update to a seeded artefact reaches the same row it always did).
  if (typeof id === "string") {
    const home = SEEDED_ARTEFACT_HOME[id];
    if (home) return { ...home };
  }

  if (isJourneyPhase(phase)) {
    return { step: 6, phase };
  }

  return null;
}

/** Stable key for a resolved address + artefact id — used by the host mirror so a
 * step-keyed set and its phase-only legacy equivalent collapse onto one entry. */
export function canvasEntryKey(addr: ResolvedCanvasAddress, id: string): string {
  return addr.phase ? `${addr.step}/${addr.phase}/${id}` : `${addr.step}/${id}`;
}
