/**
 * Deterministic design-document export (capability `course-workspace`, Requirement:
 * *Deterministic Design-Document Export from Host State*).
 *
 * The document is built ONLY from state the host already holds — the canvas artefact
 * mirror, the recorded step coverage, and the session maturity mirror. The agent is
 * never the mechanism by which a design document reaches the lecturer's disk.
 *
 * Why: on 2026-08-03 the lecturer asked "we are done? … What can I do now with the
 * artifacts?", the assistant claimed it had compiled `module-design.md` while emitting
 * NO tool call at all, the lecturer answered "mhh ich sehe kein File…", and only then
 * did the model write the file through the generic `write` tool with a self-chosen
 * path, filename and layout. Generating from host state removes both failures at once:
 * the file always exists, and identical state always yields an identical document.
 *
 * Format v1 is Markdown (decided 2026-08-03). The content contract below is
 * format-independent, so an additional format does not have to reopen it.
 *
 * **The document's own headings are chrome and follow the app's interface
 * language** (capability `desktop-app`, Requirement: *Every String the App Renders
 * Is English* — an app-authored export heading is a string the app writes for the
 * lecturer). They reach this builder as an injected `labels` object rather than by
 * importing the app's catalogue, because pi-bridge is the RUNTIME and must not
 * depend on the desktop shell. The defaults below are the reference language's, so
 * a caller that passes none — every existing test — gets exactly today's bytes.
 * The artefact VALUES are content and are exported as recorded.
 */
import type { CanvasArtefactEntry } from "./canvas-mirror.js";
import type { StepCoverageEntry } from "./step-mirror.js";
import { JOURNEY_PHASES, type JourneyPhase } from "./canvas-addressing.js";
import {
  MATURITY_CRITERIA,
  deriveOverallMaturity,
  sanitizeMaturitySnapshot,
  type DerivedOverallMaturity,
} from "./maturity-mirror.js";

/** Every heading and marker the builder authors itself. A host supplies these from
 * its own chrome-string catalogue; the defaults are the reference language's. */
export interface DesignDocumentLabels {
  documentTitle: (courseTitle: string) => string;
  generatedAt: (stamp: string) => string;
  courseContextHeading: string;
  stepHeading: (step: number, name: string) => string;
  stepName: (step: number) => string;
  phaseName: (phase: JourneyPhase) => string;
  coverage: (depth: string) => string;
  openArtefact: string;
  maturityHeading: string;
  columnCriterion: string;
  columnCurrent: string;
  columnTarget: string;
  unassessed: string;
  limitation: (note: string) => string;
  overallNotDue: string;
  derivation: (contributing: number, total: number, mean: string) => string;
  derivationCapped: (base: string, criterion: string) => string;
}

/** Display names of the ten design steps, in flow order. */
const STEP_NAMES: Record<number, string> = {
  1: "Set the Frame",
  2: "Learning Outcomes",
  3: "Assessment",
  4: "Challenge",
  5: "Stakeholder",
  6: "Learning Journey",
  7: "Activities",
  8: "Deliverables",
  9: "Alignment Check",
  10: "Prepare",
};

const PHASE_NAMES: Record<JourneyPhase, string> = {
  engage: "Engage",
  investigate: "Investigate",
  act: "Act / Prototype",
  reflect: "Reflect and present",
};

export const DEFAULT_DESIGN_DOCUMENT_LABELS: DesignDocumentLabels = {
  documentTitle: (courseTitle) => `${courseTitle} — CBE Module Design`,
  generatedAt: (stamp) => `_Exported ${stamp} from the recorded canvas state._`,
  courseContextHeading: "Course context",
  stepHeading: (step, name) => `Step ${step} — ${name}`,
  stepName: (step) => STEP_NAMES[step] ?? String(step),
  phaseName: (phase) => PHASE_NAMES[phase],
  coverage: (depth) => `_Coverage: ${depth}_`,
  openArtefact: "_(open — not yet decided)_",
  maturityHeading: "CBE Maturity",
  columnCriterion: "Criterion",
  columnCurrent: "Current",
  columnTarget: "Target",
  unassessed: "unassessed",
  limitation: (note) => `**Limitation:** ${note}`,
  // What the export states while no criterion has been assessed. There is no
  // aggregate then — not L1, not a zero, not a dash a reader could take for a
  // placeholder — so the row states the absence instead. Deliberately dash-free,
  // and word-for-word the panel's own `maturityAchievedNotDue`: the two surfaces
  // describe the one state in the one phrasing.
  overallNotDue: "The achieved reading is not yet due: no criterion has been assessed.",
  derivation: (contributing, total, mean) => `derived from ${contributing} of ${total} assessed criteria, mean ${mean}`,
  derivationCapped: (base, criterion) => `${base}; capped by the open finding on ${criterion}`,
};

export interface DesignDocumentInput {
  courseTitle: string;
  /** Raw `course.md` context, when the course records one. */
  courseContext?: string;
  artefacts: ReadonlyArray<CanvasArtefactEntry>;
  stepCoverage: ReadonlyArray<StepCoverageEntry>;
  /** The recorded raster as the mirror holds it. Deliberately loose: the builder
   * prints the criterion rows as recorded and narrows the raster with
   * `sanitizeMaturitySnapshot` before deriving the aggregate from it. */
  maturity?: Record<string, { current?: unknown; target?: unknown; capped?: unknown; note?: string }>;
  /** Stamped by the caller — the builder itself is pure, so the same state always
   * yields the same bytes apart from this one declared line. */
  generatedAt?: string;
  /** The document's own headings, in the host's active interface language. Absent
   * → the reference language's, which is byte-for-byte today's output. */
  labels?: DesignDocumentLabels;
}

function artefactLines(entries: ReadonlyArray<CanvasArtefactEntry>, labels: DesignDocumentLabels): string[] {
  const out: string[] = [];
  for (const a of entries) {
    const label = a.label && a.label.trim().length > 0 ? a.label : a.id;
    const value = typeof a.value === "string" ? a.value.trim() : "";
    out.push(`#### ${label}`, "");
    // An unfilled artefact is shown as explicitly open — never omitted, and never
    // filled with generated content.
    out.push(value.length > 0 ? value : labels.openArtefact, "");
  }
  return out;
}

/** How the derived aggregate names what it rests on — the contributing count,
 * the unrounded mean to one decimal, and the capping criterion where a standing
 * reservation actually held the band down. Mirrors the panel's `derivationText`. */
function derivationText(derived: DerivedOverallMaturity, labels: DesignDocumentLabels): string {
  const base = labels.derivation(derived.contributing, MATURITY_CRITERIA.length, derived.mean.toFixed(1));
  return derived.cappedBy ? labels.derivationCapped(base, derived.cappedBy) : base;
}

/**
 * The overall row's Current cell. The aggregate is derived here, from the very
 * criteria the rows above print, so the exported document rests on exactly the
 * arithmetic the panel shows. `sanitizeMaturitySnapshot` narrows the loose input
 * first: an unknown key or an out-of-range level never contributes to a reading.
 */
function overallCurrentCell(maturity: DesignDocumentInput["maturity"], labels: DesignDocumentLabels): string {
  const derived = deriveOverallMaturity(sanitizeMaturitySnapshot(maturity));
  return derived ? `L${derived.level} (${derivationText(derived, labels)})` : labels.overallNotDue;
}

/** Build the Markdown design document. Pure and deterministic. */
export function buildDesignDocument(input: DesignDocumentInput): string {
  const labels = input.labels ?? DEFAULT_DESIGN_DOCUMENT_LABELS;
  const lines: string[] = [`# ${labels.documentTitle(input.courseTitle)}`, ""];
  if (input.generatedAt) lines.push(labels.generatedAt(input.generatedAt), "");
  if (input.courseContext && input.courseContext.trim().length > 0) {
    lines.push(`## ${labels.courseContextHeading}`, "", input.courseContext.trim(), "");
  }

  const depthOf = (step: number) => input.stepCoverage.find((s) => s.step === step)?.depth ?? "open";

  for (let step = 1; step <= 10; step++) {
    lines.push(`## ${labels.stepHeading(step, labels.stepName(step))}`, "", labels.coverage(depthOf(step)), "");
    if (step === 6) {
      for (const phase of JOURNEY_PHASES) {
        const inPhase = input.artefacts.filter((a) => a.step === 6 && a.phase === phase);
        lines.push(`### ${labels.phaseName(phase)}`, "");
        if (inPhase.length === 0) lines.push(labels.openArtefact, "");
        else lines.push(...artefactLines(inPhase, labels));
      }
      continue;
    }
    const inStep = input.artefacts.filter((a) => a.step === step && a.phase === undefined);
    if (inStep.length === 0) lines.push(labels.openArtefact, "");
    else lines.push(...artefactLines(inStep, labels));
  }

  const maturityEntries = Object.entries(input.maturity ?? {});
  if (maturityEntries.length > 0) {
    const overall = (input.maturity ?? {}).overall;
    const targetCell = (target: unknown) => (target === undefined || target === null ? "—" : String(target));
    lines.push(
      `## ${labels.maturityHeading}`,
      "",
      `| ${labels.columnCriterion} | ${labels.columnCurrent} | ${labels.columnTarget} |`,
      "| --- | --- | --- |"
    );
    for (const [key, rec] of maturityEntries) {
      if (key === "overall") continue;
      const cur = rec?.current === undefined ? labels.unassessed : String(rec.current);
      lines.push(`| ${key} | ${cur} | ${targetCell(rec?.target)} |`);
    }
    // The aggregate row carries the HOST-DERIVED reading, never a stored one —
    // the same pure function the panel derives from, so the exported artefact and
    // the panel can never state different things. It carries its qualifier with
    // it: a reading over three criteria and one over seven are different claims.
    lines.push(`| overall | ${overallCurrentCell(input.maturity, labels)} | ${targetCell(overall?.target)} |`);
    lines.push("");
    if (overall?.note) lines.push(labels.limitation(overall.note), "");
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

/** Deterministic filename derived from the course title. */
export function designDocumentFilename(courseTitle: string): string {
  const slug =
    courseTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "course";
  return `${slug}-module-design.md`;
}
