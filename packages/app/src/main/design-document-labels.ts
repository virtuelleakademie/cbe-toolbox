import type { DesignDocumentLabels } from "@cbe/pi-bridge";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";
import type { ChromeCatalogue, ChromeStringKey } from "../shared/i18n/index.js";
import { chrome } from "./interface-language.js";

/**
 * The design-document export's own headings, in the active interface language
 * (capability `desktop-app`, Requirement: *Every String the App Renders Is
 * English* — an app-authored export heading is a string the app writes for the
 * lecturer, so it follows the setting like any other).
 *
 * The builder itself lives in pi-bridge and must not depend on the desktop shell,
 * so the labels are INJECTED (`DesignDocumentLabels`). The step and journey names
 * are the very entries the CBE Process Canvas panel renders — one owner, two
 * surfaces, so an exported document and the panel can never name a step
 * differently.
 */
const STEP_NAME_KEYS: Record<number, ChromeStringKey> = {
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

const PHASE_NAME_KEYS: Record<JourneyPhase, ChromeStringKey> = {
  engage: "canvasJourneyEngage",
  investigate: "canvasJourneyInvestigate",
  act: "canvasJourneyAct",
  reflect: "canvasJourneyReflect",
};

export function designDocumentLabels(t: ChromeCatalogue = chrome()): DesignDocumentLabels {
  return {
    documentTitle: (courseTitle) => t.exportDocumentTitle({ course: courseTitle }),
    generatedAt: (stamp) => t.exportGeneratedAt({ stamp }),
    courseContextHeading: t.exportCourseContextHeading,
    stepHeading: (step, name) => t.exportStepHeading({ step, name }),
    stepName: (step) => {
      const key = STEP_NAME_KEYS[step];
      return key ? (t[key] as string) : String(step);
    },
    phaseName: (phase) => t[PHASE_NAME_KEYS[phase]] as string,
    coverage: (depth) => t.exportCoverage({ depth }),
    openArtefact: t.exportOpenArtefact,
    maturityHeading: t.exportMaturityHeading,
    columnCriterion: t.exportMaturityColumnCriterion,
    columnCurrent: t.exportMaturityColumnCurrent,
    columnTarget: t.exportMaturityColumnTarget,
    unassessed: t.exportMaturityUnassessed,
    limitation: (note) => t.exportMaturityLimitation({ note }),
    overallNotDue: t.maturityAchievedNotDue,
    // The export's derivation wording is its OWN — the panel's uses "·" separators
    // and names the capped level, which a table cell has no room for. Only
    // `overallNotDue` is deliberately word-for-word the panel's entry.
    derivation: (contributing, total, mean) => t.exportMaturityDerivation({ contributing, total, mean }),
    derivationCapped: (base, criterion) => t.exportMaturityDerivationCapped({ base, criterion }),
  };
}
