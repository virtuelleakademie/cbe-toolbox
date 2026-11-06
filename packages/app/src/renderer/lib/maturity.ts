/**
 * Renderer-owned canonical maturity tables (capability `desktop-app`,
 * Requirement: Maturity Panel).
 *
 * The RENDERER owns the canonical criterion key→label mapping for the seven
 * PIONEER criteria and the level vocabulary — the skill's reference material
 * mirrors THIS mapping, not the other way round. The labels, level terms and
 * per-cell glosses themselves are **chrome** and therefore live in the
 * interface-language catalogue (Requirement: *Each Rendered Chrome String Has
 * Exactly One Owner*); what lives here is the key → catalogue-entry mapping and
 * the framework's structure.
 *
 * The English entries are the fixed framework wording of `methodology-007` §4.4
 * Table 1 (PIONEER WP4, validated 4.2.1); another catalogue renders them for a
 * lecturer who reads that language. The stable identity of a criterion is its
 * KEY, which is why the model-facing Discuss token carries the key AND the
 * reference-language label: what the assistant reads never moves when the
 * lecturer changes the interface language.
 */
import type { MaturityCriterionKey, MaturityLevel } from "@cbe/pi-bridge/maturity";
import { MATURITY_CRITERIA } from "@cbe/pi-bridge/maturity";
import type { MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import { REFERENCE_LANGUAGE, stringsFor, type ChromeCatalogue, type ChromeStringKey } from "../../shared/i18n/index.js";

export { MATURITY_CRITERIA };
export type { MaturityCriterionKey, MaturityLevel };

/** Canonical criterion key → catalogue entry (methodology-007 Table 1). */
const CRITERION_LABEL_KEYS: Record<MaturityCriterionKey, ChromeStringKey> = {
  "societal-challenge": "maturityCriterionSocietalChallenge",
  "stakeholder-involvement": "maturityCriterionStakeholderInvolvement",
  interdisciplinarity: "maturityCriterionInterdisciplinarity",
  "student-agency": "maturityCriterionStudentAgency",
  "iterative-process": "maturityCriterionIterativeProcess",
  "value-reflection": "maturityCriterionValueReflection",
  "societal-impact": "maturityCriterionSocietalImpact",
};

const LEVEL_SHORT_KEYS: Record<MaturityLevel, ChromeStringKey> = {
  1: "maturityLevelShort1",
  2: "maturityLevelShort2",
  3: "maturityLevelShort3",
};

const LEVEL_FULL_KEYS: Record<MaturityLevel, ChromeStringKey> = {
  1: "maturityLevelFull1",
  2: "maturityLevelFull2",
  3: "maturityLevelFull3",
};

/** Per-cell maturity cues — the criterion × level cells of Table 1, shown as the
 * gloss in the level disclosure. */
const CELL_GLOSS_KEYS: Record<MaturityCriterionKey, Record<MaturityLevel, ChromeStringKey>> = {
  "societal-challenge": {
    1: "maturityGlossSocietalChallenge1",
    2: "maturityGlossSocietalChallenge2",
    3: "maturityGlossSocietalChallenge3",
  },
  "stakeholder-involvement": {
    1: "maturityGlossStakeholderInvolvement1",
    2: "maturityGlossStakeholderInvolvement2",
    3: "maturityGlossStakeholderInvolvement3",
  },
  interdisciplinarity: {
    1: "maturityGlossInterdisciplinarity1",
    2: "maturityGlossInterdisciplinarity2",
    3: "maturityGlossInterdisciplinarity3",
  },
  "student-agency": {
    1: "maturityGlossStudentAgency1",
    2: "maturityGlossStudentAgency2",
    3: "maturityGlossStudentAgency3",
  },
  "iterative-process": {
    1: "maturityGlossIterativeProcess1",
    2: "maturityGlossIterativeProcess2",
    3: "maturityGlossIterativeProcess3",
  },
  "value-reflection": {
    1: "maturityGlossValueReflection1",
    2: "maturityGlossValueReflection2",
    3: "maturityGlossValueReflection3",
  },
  "societal-impact": {
    1: "maturityGlossSocietalImpact1",
    2: "maturityGlossSocietalImpact2",
    3: "maturityGlossSocietalImpact3",
  },
};

export function criterionLabel(key: MaturityCriterionKey, t: ChromeCatalogue): string {
  return t[CRITERION_LABEL_KEYS[key]] as string;
}

/** Defined short-form level token (compact row display). */
export function levelShort(level: MaturityLevel, t: ChromeCatalogue): string {
  return t[LEVEL_SHORT_KEYS[level]] as string;
}

/** Full framework term (disclosure + accessible text). */
export function levelFull(level: MaturityLevel, t: ChromeCatalogue): string {
  return t[LEVEL_FULL_KEYS[level]] as string;
}

export function cellGloss(key: MaturityCriterionKey, level: MaturityLevel, t: ChromeCatalogue): string {
  return t[CELL_GLOSS_KEYS[key][level]] as string;
}

/**
 * Machine token of the per-criterion Discuss dispatch — key AND label, so the
 * skill needs no label-to-key back-translation.
 *
 * The label is the REFERENCE language's, deliberately and unconditionally: this
 * is a model-facing payload, and the corpus the assistant grounds a maturity
 * answer in carries the framework's English criterion names. The lecturer's
 * interface language decides what is on SCREEN, never what the model reads.
 */
export function maturityDiscussToken(key: MaturityCriterionKey): string {
  const reference = criterionLabel(key, stringsFor(REFERENCE_LANGUAGE));
  return `[maturity discuss · criterion ${key} ("${reference}")]`;
}

/** Human display projection of the Discuss dispatch (persisted; the raw token
 * never renders in the chat). */
export function maturityDiscussDisplay(key: MaturityCriterionKey, t: ChromeCatalogue): string {
  return t.maturityDiscussDisplay({ label: criterionLabel(key, t) });
}

/** Machine token of the Assess dispatch. */
export const MATURITY_ASSESS_TOKEN = "[maturity assess]";

/**
 * The Assess token extended with the HOST's substance and staleness state
 * (capability `desktop-app`, Requirement: Maturity Panel Substance and Staleness
 * Framing — "panel-originated dispatch carries the host state in the payload
 * only").
 *
 * The skill then receives the deterministic state in the turn it is answering
 * instead of inferring it. Payload only: the visible user turn and the persisted
 * display projection keep the display projection unchanged, so the annotated
 * token never renders in the chat — not live, not after reload or resume.
 */
export function maturityAssessToken(state: MaturityDerivedState | undefined): string {
  if (!state) return MATURITY_ASSESS_TOKEN;
  const parts = [`substance ${state.substance}`];
  const e = state.evidence;
  parts.push(`material ${e.ingestedDocuments}, artefacts ${e.artefacts}, step groups ${e.stepGroups}`);
  if (state.stale) {
    parts.push(
      `reading stale: recorded at revision ${state.stale.recordedAtRevision}, now ${state.stale.currentRevision}`
    );
  }
  return `[maturity assess · ${parts.join(" · ")}]`;
}
