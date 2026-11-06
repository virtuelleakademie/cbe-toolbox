/**
 * The Design-Flow Canvas seed structure (capability `desktop-app`, Requirement:
 * Design-Flow Canvas; final 4.2.1 §4.6).
 *
 * The canvas is organized along the TEN design steps as groups, each carrying its
 * step's named output artefact row(s). The existing CBL artefact canvas is mounted in:
 * Step 4 hosts the challenge ladder (Big Idea / Essential Question / Challenge —
 * canonical seeded ids UNCHANGED: `bigidea` / `eq` / `challenge`) and Step 6 hosts the
 * four-element learning journey (Engage / Investigate / Act–prototype / Reflect and
 * present), each element carrying seeded rows of its own. The seed supplies labels and
 * structure only; a cold session strips values to empty and every state to `open` (see
 * `seedArtifacts` in state/store.ts).
 *
 * The seeded artefact ids are NOT declared here: they are DERIVED from the shared
 * canonical slot table `CANONICAL_SLOTS` in `@cbe/pi-bridge/canvas-addressing`, which
 * the harness tools enforce (capability `agent-harness`, Requirement: Deterministic
 * Tool-Boundary Enforcement for Canvas Ids …). One authority, two consumers — the seed
 * and the tool cannot drift apart.
 *
 * The display copy (step names, journey-element names, artefact labels) is NOT declared
 * here either any more: it is chrome, so it is resolved from the interface-language
 * catalogue at seed time (capability `desktop-app`, Requirement: *Each Rendered Chrome
 * String Has Exactly One Owner*). Only the id → catalogue-key MAPPING lives here.
 * Because the seed writes resolved labels into per-conversation state, a language change
 * re-derives them through the store's `relabelSeededChrome` rather than re-seeding.
 */
import { CANONICAL_SLOTS, JOURNEY_PHASES, type JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";
import {
  LANGUAGES,
  REFERENCE_LANGUAGE,
  stringsFor,
  type ChromeCatalogue,
  type ChromeStringKey,
} from "../../shared/i18n/index.js";

export type ArtefactState = "done" | "active" | "draft" | "open";

export interface ArtefactItem {
  id: string;
  label: string;
  state: ArtefactState;
  value: string;
}

/** Step-6 learning-journey element (Engage / Investigate / Act–prototype / Reflect and
 * present). Reflect renders even while empty. */
export interface JourneyElement {
  phase: JourneyPhase;
  name: string;
  items: ArtefactItem[];
}

/** A design-step group. Non-journey steps carry `items`; Step 6 carries `journey`. */
export interface StepGroup {
  step: StepId;
  /** Short header name, e.g. "Set the Frame". */
  name: string;
  items: ArtefactItem[];
  journey?: JourneyElement[];
}

export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const STEP_ORDER: readonly StepId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Coverage depth shown on a step-group header (fed by `cbe_step`). Not a ratchet. */
export type StepDepth = "open" | "rough" | "refined" | "detailed";

/** Catalogue key per design-step header. */
const STEP_NAME_KEYS: Record<StepId, ChromeStringKey> = {
  1: "canvasStep1Name",
  2: "canvasStep2Name",
  3: "canvasStep3Name",
  4: "canvasStep4Name",
  5: "canvasStep5Name",
  6: "canvasStep6Name",
  7: "canvasStep7Name",
  8: "canvasStep8Name",
  9: "canvasStep9Name",
  10: "canvasStep10Name",
};

/** Catalogue key per Step-6 journey element. */
const JOURNEY_NAME_KEYS: Record<JourneyPhase, ChromeStringKey> = {
  engage: "canvasJourneyEngage",
  investigate: "canvasJourneyInvestigate",
  act: "canvasJourneyAct",
  reflect: "canvasJourneyReflect",
};

/** Catalogue key per canonical artefact id. An id with no entry falls back to the id
 * itself, so adding a slot to the shared table never breaks the render.
 *
 * Labels and ids are governed separately, and a label correction never renames an id
 * (capability `desktop-app`, Requirement: Artifacts Tab / Canvas — "the retirement is a
 * display-copy rule and reaches nothing else"). */
const ARTEFACT_LABEL_KEYS: Record<string, ChromeStringKey> = {
  moduleframe: "canvasArtefactModuleframe",
  learningoutcomes: "canvasArtefactLearningoutcomes",
  assessmentblueprint: "canvasArtefactAssessmentblueprint",
  bigidea: "canvasArtefactBigidea",
  eq: "canvasArtefactEq",
  challenge: "canvasArtefactChallenge",
  stakeholderplan: "canvasArtefactStakeholderplan",
  es: "canvasArtefactEs",
  is: "canvasArtefactIs",
  as: "canvasArtefactAs",
  rs: "canvasArtefactRs",
  activityplan: "canvasArtefactActivityplan",
  deliverablesmap: "canvasArtefactDeliverablesmap",
  alignmentmatrix: "canvasArtefactAlignmentmatrix",
  readinesschecklist: "canvasArtefactReadinesschecklist",
};

/** The seeded label of an artefact id in one language, or the id where the slot table
 * carries a slot the catalogue does not name. */
export function seededArtefactLabel(id: string, strings: ChromeCatalogue): string {
  const key = ARTEFACT_LABEL_KEYS[id];
  return key ? (strings[key] as string) : id;
}

/** The seeded name of a design step in one language. */
export function seededStepName(step: StepId, strings: ChromeCatalogue): string {
  return strings[STEP_NAME_KEYS[step]] as string;
}

/** The seeded name of a Step-6 journey element in one language. */
export function seededJourneyName(phase: JourneyPhase, strings: ChromeCatalogue): string {
  return strings[JOURNEY_NAME_KEYS[phase]] as string;
}

/**
 * Is this display copy the SEED's, rather than something the skill wrote?
 *
 * A seeded label is data by the time anything looks at it — the seed resolved it
 * once, in whatever language was active — so the only way to recognise one is to
 * ask whether ANY shipped catalogue seeds exactly that wording for that slot.
 * Anything else came from the model through `cbe_canvas` and is lecturer-language
 * content that must survive untouched.
 *
 * One owner for the question, because two consumers ask it for opposite reasons:
 * the store re-derives a seeded label when the interface language moves, and the
 * canvas re-derives it the other way — back to the REFERENCE language — for the
 * label it hands the host, so the notices the model reads stay in one language.
 */
export function seededLabelInAnyLanguage(id: string, label: string): boolean {
  return Object.values(LANGUAGES).some((l) => seededArtefactLabel(id, l.strings) === label);
}

export function seededStepNameInAnyLanguage(step: StepId, name: string): boolean {
  return Object.values(LANGUAGES).some((l) => seededStepName(step, l.strings) === name);
}

export function seededJourneyNameInAnyLanguage(phase: JourneyPhase, name: string): boolean {
  return Object.values(LANGUAGES).some((l) => seededJourneyName(phase, l.strings) === name);
}

/**
 * The REFERENCE-language form of a label the lecturer is looking at, for the host
 * calls that put it in front of the MODEL (capability `desktop-app`, Requirement:
 * *Every String the App Renders Is English*).
 *
 * What the lecturer reads follows the interface language; what the model reads
 * does not. The host quotes these labels verbatim into the payload-prefix notices
 * (`stepFocusNoticeLine`, `canvasDeletionNoticeLine`), so a German seed label
 * would put German inside an otherwise-English machine notice — the same reason
 * the maturity Discuss token resolves through `stringsFor(REFERENCE_LANGUAGE)`.
 *
 * A label the skill supplied is passed through unchanged: it is lecturer content,
 * it is already the model's own wording, and translating it would be a claim the
 * app has no basis for.
 */
export function referenceArtefactLabel(id: string, label: string): string {
  return seededLabelInAnyLanguage(id, label) ? seededArtefactLabel(id, stringsFor(REFERENCE_LANGUAGE)) : label;
}

export function referenceStepName(step: StepId, name: string): string {
  return seededStepNameInAnyLanguage(step, name) ? seededStepName(step, stringsFor(REFERENCE_LANGUAGE)) : name;
}

function seedItems(containerKey: string, strings: ChromeCatalogue): ArtefactItem[] {
  return (CANONICAL_SLOTS[containerKey] ?? []).map((id) => ({
    id,
    label: seededArtefactLabel(id, strings),
    state: "open" as const,
    value: "",
  }));
}

/** The ten design-step groups in §4.6 flow order, seeded from the shared canonical
 * slot table (Step 6 carries the four journey elements instead of direct items), with
 * every label resolved in `strings`. */
export function stepGroups(strings: ChromeCatalogue): StepGroup[] {
  return STEP_ORDER.map((step) =>
    step === 6
      ? {
          step,
          name: seededStepName(step, strings),
          items: [],
          journey: JOURNEY_PHASES.map((phase) => ({
            phase,
            name: seededJourneyName(phase, strings),
            items: seedItems(`6/${phase}`, strings),
          })),
        }
      : { step, name: seededStepName(step, strings), items: seedItems(`${step}`, strings) }
  );
}

/** The canonical ids of one container, independent of language — the identity half of
 * the seed, used where only "is this a seeded slot?" matters. */
export function seedItemIds(containerKey: string): readonly string[] {
  return CANONICAL_SLOTS[containerKey] ?? [];
}

/** Short step-header labels keyed by step number (for the `steps` coverage slice). */
export function stepLabels(strings: ChromeCatalogue): Record<StepId, string> {
  return Object.fromEntries(STEP_ORDER.map((step) => [step, seededStepName(step, strings)])) as Record<StepId, string>;
}

export function stateLabel(state: ArtefactState, strings: ChromeCatalogue): string {
  const keys: Record<ArtefactState, ChromeStringKey> = {
    done: "canvasStateDone",
    active: "canvasStateActive",
    draft: "canvasStateDraft",
    open: "canvasStateOpen",
  };
  return strings[keys[state]] as string;
}

/** Catalogue key per coverage depth — the ONE runtime enumeration of the
 * `StepDepth` union, exhaustive by its own type. Everything that needs to know
 * which depths exist reads it through `depthLabel` or `isStepDepth`, so a fifth
 * depth added to the union is a compile error here and nowhere else. */
const STEP_DEPTH_KEYS: Record<StepDepth, ChromeStringKey> = {
  open: "canvasDepthOpen",
  rough: "canvasDepthRough",
  refined: "canvasDepthRefined",
  detailed: "canvasDepthDetailed",
};

/** Is this token one of the coverage depths the canvas knows? */
export function isStepDepth(value: unknown): value is StepDepth {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STEP_DEPTH_KEYS, value);
}

export function depthLabel(depth: StepDepth, strings: ChromeCatalogue): string {
  return strings[STEP_DEPTH_KEYS[depth]] as string;
}
