import { useCbe } from "../state/store.js";
import type { DerivedOverallMaturity, MaturityCriterionState, MaturityLevel } from "@cbe/pi-bridge/maturity";
import { deriveOverallMaturity } from "@cbe/pi-bridge/maturity";
import type { DesignChange, MaturityDerivedState } from "@cbe/pi-bridge/design-substance";
import {
  MATURITY_CRITERIA,
  cellGloss,
  criterionLabel,
  levelFull,
  levelShort,
  maturityAssessToken,
  maturityDiscussDisplay,
  maturityDiscussToken,
  type MaturityCriterionKey,
} from "../lib/maturity.js";
import { promptFailureNotice, runLockedReason } from "../util/errors.js";
import { useChrome } from "../chrome.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";

/**
 * Right-panel Maturity tab (capability `desktop-app`, Requirement: Maturity
 * Panel): the skill's PIONEER maturity reading as a read-only 3×7 raster —
 * current level vs target per criterion, unassessed, uncertain and capped
 * readings explicit, gap hints as plain text.
 *
 * The panel OPENS with a header block carrying the two things the lecturer's
 * question actually is — "where do we want to be, and where are we": the
 * design's declared TARGET (settled once, the level every recommendation is
 * measured against) and the derived overall ACHIEVED reading. Two distinct
 * elements, separately labelled and separately announced, neither styled as an
 * eighth criterion; the seven criterion rows follow below and no aggregate row
 * is left at the bottom. Until change `show-target-and-derive-overall-maturity`
 * both lived in one `overall` row under the raster, which made a settled
 * ambition look like a property of an eighth criterion.
 *
 * The achieved reading is DERIVED HERE from the recorded criteria by the shared
 * `deriveOverallMaturity` — the same pure function the host mirror uses
 * (capability `agent-harness`, Requirement: Host-Derived Overall Maturity
 * Level) — so the panel can never show an aggregate that disagrees with the
 * seven readings above it, and there is no aggregate to hydrate, persist, or
 * lose. With no criterion assessed there is NO achieved level at all: not L1,
 * not a zero, not an empty indicator, only the not-yet-due statement and any
 * recorded limitation note.
 *
 * Fed exclusively by validated `cbe_maturity` result details (store slice
 * `maturity`, hydrated from the host-side session maturity mirror). READ-ONLY
 * for levels: the maturity scale is never lecturer-self-classified — the
 * interactive affordances are exactly the per-criterion "Discuss in chat"
 * handoff and "Assess maturity", both structured user-turn dispatches with a
 * display/payload split under the run lock.
 *
 * Since `ground-maturity-assessment-in-substance` the panel also FRAMES the
 * reading with the host's evidence provenance (thin substance, provisional,
 * stale, unknown) and carries the Assess control in BOTH states — it is the
 * named refresh path for a stale reading, not only the empty state's entry
 * point. The control's disabled condition stays the run lock and nothing else.
 *
 * Panel chrome follows the interface language; `hint`/`note` are agent content in
 * the lecturer's conversation language and are outside that rule. Both are
 * rendered as plain text nodes only — never through MarkdownView or any
 * HTML-interpreting sink.
 */
export function MaturityPanel() {
  const t = useChrome();
  const maturity = useCbe((s) => s.maturity);
  // Host-derived framing (capability `desktop-app`, Requirement: Maturity Panel
  // Substance and Staleness Framing). The panel RENDERS this state; it never
  // recomputes substance or staleness, so the marking cannot disagree with the
  // evidence the host observed.
  const maturityState = useCbe((s) => s.maturityState);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  const running = useCbe((s) => s.agentRunning);
  const appendUserTurn = useCbe((s) => s.appendUserTurn);
  const removeLastUserTurn = useCbe((s) => s.removeLastUserTurn);
  const setChatNotice = useCbe((s) => s.setChatNotice);
  const setDispatchPending = useCbe((s) => s.setDispatchPending);

  const locked = !sessionId || running;

  /** Dialogue-steering dispatch with display/payload split (the Help-me / iteration
   * toolbar precedent): the machine token is the model payload AND the persisted
   * transcript text; the visible user turn and the persisted display projection
   * carry the human rendering, so the raw token never renders — not live and not
   * after reload/resume. A rejected dispatch rolls the optimistic turn back. */
  function dispatch(machine: string, display: string) {
    if (locked) return; // run lock: disabled affordance, activation is a no-op
    appendUserTurn(display);
    setDispatchPending(true);
    void window.cbe
      .sendPrompt(sessionId!, machine, { text: display })
      .catch((err: unknown) => {
        removeLastUserTurn();
        setChatNotice(promptFailureNotice(err instanceof Error ? err.message : String(err)));
      })
      .finally(() => setDispatchPending(false));
  }

  // Why the control is unavailable — the run lock and the no-session case are
  // different situations and the lecturer must be able to tell them apart
  // (Requirement: Collected UX-2 Fixes).
  const assessDisabledReason = running
    ? t.maturityAssessLockedReason({ runLocked: runLockedReason() })
    : !sessionId
      ? t.maturityAssessNoSession
      : null;

  /* The Assess control, identical in every substance state. `disabled` is the run
     lock and NOTHING else — the substance signal never enters it (the product authority's
     decision: "der Button muss bleiben"). Substance produces FRAMING beside a live
     control, never a dead grey one the lecturer cannot interpret; that confusion is
     the defect this replaces.

     The disabled reason must be discoverable on hover AND on keyboard focus
     (WCAG 1.4.13, the settings-tooltip precedent), and must distinguish the two
     lock causes — an unexplained greyed-out button was a UX-2 finding.
     `aria-describedby` + a rendered reason line cover the keyboard path; `title`
     covers the pointer path. A disabled button is not focusable, so the reason is
     rendered as text rather than hidden behind focus alone. */
  const assessControl = (
    <>
      <button
        type="button"
        className="maturity-assess"
        disabled={locked}
        title={assessDisabledReason ?? t.maturityAssessTitle}
        {...(assessDisabledReason ? { "aria-describedby": "maturity-assess-reason" } : {})}
        // Payload carries the host state; the display projection does not.
        onClick={() => dispatch(maturityAssessToken(maturityState), t.maturityAssessDisplay)}
      >
        {t.maturityAssessLabel}
      </button>
      {assessDisabledReason && (
        <p className="maturity-assess-reason" id="maturity-assess-reason">
          {assessDisabledReason}
        </p>
      )}
    </>
  );

  const empty = Object.keys(maturity).length === 0;
  if (empty) {
    return (
      <div className="maturity-panel maturity-empty">
        <div className="panel-intro">{t.maturityPanelIntroEmpty}</div>
        <ThinSubstanceNote state={maturityState} closing={t.maturityThinClosingEmpty} />
        {assessControl}
      </div>
    );
  }

  // A recorded overall target with no criterion record at all is NOT the empty
  // state (the ambition is settled long before the coherence gate) — but it is
  // equally not a raster: seven "not yet assessed" rows would read as a completed
  // assessment with a low result. The header block carries the state instead.
  const rasterRecorded = MATURITY_CRITERIA.some((key) => maturity[key] !== undefined);

  return (
    <div className="maturity-panel">
      {/* Assumption framing: the reading is the skill's assumption from material
          and dialogue — the conversation (Discuss) is the named correction path. */}
      <div className="panel-intro">{rasterRecorded ? t.maturityPanelIntroRaster : t.maturityPanelIntroNoRaster}</div>
      {/* Ambition and current standing, above the raster and against each other:
          the lecturer answers both halves of the question in one glance. */}
      <MaturityHeaderBlock state={maturity.overall} derived={deriveOverallMaturity(maturity)} />
      {/* Thin substance is named wherever the host reports it — the duty follows
          the CURRENT signal, not the visible reading's stamp, so a reading taken
          under a fuller base still says what the base is missing now. */}
      <ThinSubstanceNote state={maturityState} closing={t.maturityThinClosingPopulated} />
      <ProvenanceFraming state={maturityState} />
      {rasterRecorded &&
        MATURITY_CRITERIA.map((key) => (
          <CriterionRow
            key={key}
            criterion={key}
            state={maturity[key]}
            locked={locked}
            running={running}
            onDiscuss={() => dispatch(maturityDiscussToken(key), maturityDiscussDisplay(key, t))}
          />
        ))}
      {/* The refresh path IS the Assess control — named wherever a reading is
          marked stale, and present in the populated panel for that reason. */}
      <div className="maturity-refresh">{assessControl}</div>
    </div>
  );
}

/**
 * What is missing, in the host's own counts — never a generic "not enough data".
 * Reads the evidence the substance verdict was computed from, so the sentence
 * cannot claim more or less than the host observed.
 */
function thinSubstanceGap(state: MaturityDerivedState, t: ChromeCatalogue): string {
  const { ingestedDocuments, artefacts, stepGroups } = state.evidence;
  const have = [
    ingestedDocuments === 0 ? t.maturityThinNoMaterial : t.maturityThinDocuments({ count: ingestedDocuments }),
    t.maturityThinArtefacts({ count: artefacts }),
    t.maturityThinSteps({ count: stepGroups }),
  ].join(", ");
  return t.maturityThinGap({ have });
}

/** Thin-substance explanation attached to the still-operable control. Never a
 * blocking message, never a bare disabled control. The counts it quotes are the
 * host's CURRENT ones — this is the one place they are true, which is why the
 * provisional marking below speaks about the recording moment instead. */
function ThinSubstanceNote({ state, closing }: { state: MaturityDerivedState; closing: string }) {
  const t = useChrome();
  if (state.substance !== "thin") return null;
  return (
    <p className="maturity-provenance maturity-thin" data-substance="thin">
      <strong>{t.maturityThinHeading}</strong> {thinSubstanceGap(state, t)} {closing}
    </p>
  );
}

/** One stale-reading change, described in the ACTIVE interface language. The host
 * hands the panel STRUCTURED changes precisely so this wording can follow the
 * setting; the label, the artefact id and the step number are content and pass
 * through untranslated. The result is rendered as a plain text node, never
 * through MarkdownView or any other HTML-interpreting sink. The model-facing
 * `[maturity-stale]` enumeration is a separate, reference-language path
 * (`stalenessNoticeLine`) and does not move with this setting. */
function staleChangeText(c: DesignChange, t: ChromeCatalogue): string {
  const label = c.label && c.label.trim().length > 0 ? c.label : undefined;
  if (c.kind === "ingestion") return t.maturityStaleChangeIngestion({ label });
  if (c.kind === "step-depth") return t.maturityStaleChangeStepDepth({ step: c.step });
  const entry =
    c.kind === "canvas-deletion"
      ? t.maturityStaleChangeArtefactDeleted
      : c.kind === "canvas-clear"
        ? t.maturityStaleChangeArtefactCleared
        : t.maturityStaleChangeArtefactSet;
  return entry({ label, id: c.id, step: c.step });
}

/**
 * Provenance framing for a VISIBLE reading (capability `desktop-app`,
 * Requirement: Maturity Panel Substance and Staleness Framing). Levels stay
 * rendered in every case — an outdated level presented as current is worse than
 * an honestly marked stale one, and hiding the levels loses information the
 * lecturer still needs.
 *
 * Three mutually exclusive states, each derived from the HOST stamp:
 * - `unknown` provenance → say exactly that; assert neither provisional nor stale.
 * - stale → name what changed and the refresh path.
 * - recorded under thin substance → mark provisional, described as the RECORDING
 *   moment. It must not quote the host's live counts: those describe the session
 *   now, and where the base has since become sufficient they would contradict the
 *   very sentence they were meant to support. The concrete current gap belongs to
 *   `ThinSubstanceNote`, which renders exactly while it is still true.
 */
function ProvenanceFraming({ state }: { state: MaturityDerivedState }) {
  const t = useChrome();
  if (state.reading.kind === "unknown") {
    return (
      <p className="maturity-provenance maturity-unknown-provenance" data-provenance="unknown">
        {t.maturityUnknownProvenance}
      </p>
    );
  }
  if (state.stale) {
    const changes = state.stale.changes.map((c) => staleChangeText(c, t)).join("; ");
    const more = state.stale.omitted > 0 ? t.maturityStaleMore({ omitted: state.stale.omitted }) : "";
    return (
      <p className="maturity-provenance maturity-stale" data-provenance="stale">
        <strong>{t.maturityStaleHeading}</strong> {t.maturityStaleBody({ changes, more })}
      </p>
    );
  }
  if (state.reading.recordedUnderSubstance === "thin") {
    return (
      <p className="maturity-provenance maturity-provisional" data-provenance="provisional">
        <strong>{t.maturityProvisionalHeading}</strong> {t.maturityProvisionalBody}{" "}
        {state.substance === "sufficient" ? t.maturityProvisionalSufficient : ""}
      </p>
    );
  }
  return null;
}

function isLevel(v: unknown): v is MaturityLevel {
  return v === 1 || v === 2 || v === 3;
}

/** Target presentation: reached/exceeded is an explicit positive state — never a
 * negative gap, never an error (Scenario: Current above target renders as target
 * reached). */
function targetPresentation(state: MaturityCriterionState | undefined, t: ChromeCatalogue): string | null {
  if (!state || !isLevel(state.target)) return null;
  if (isLevel(state.current)) {
    if (state.current > state.target) return t.maturityTargetExceeded;
    if (state.current === state.target) return t.maturityTargetReached;
  }
  return t.maturityTargetLevel({ level: state.target });
}

/** The row's accessible text: criterion, full verbatim framework term of the
 * current level, target (or unassessed/reached), uncertainty, reservation. */
function accessibleRowText(label: string, state: MaturityCriterionState | undefined, t: ChromeCatalogue): string {
  const parts: string[] = [label];
  if (state && isLevel(state.current)) {
    parts.push(t.maturityCurrentPrefix({ level: levelFull(state.current, t) }));
  } else {
    parts.push(t.maturityNotYetAssessed);
  }
  const target = targetPresentation(state, t);
  if (target) parts.push(target);
  if (state?.uncertain) parts.push(t.maturityUncertainRow);
  // The two markers say different things and are named differently: weak
  // evidence for a reading against a substantive finding left standing.
  if (state?.capped) parts.push(t.maturityCappedRow);
  return parts.join(", ");
}

/** The three-segment level visual. Current = filled segments (plus the short
 * token beside it); target = outlined segment + text token — distinguished by
 * more than colour. Decorative: the row's accessible text carries the levels. */
function LevelSegments({ state }: { state: MaturityCriterionState | undefined }) {
  const current = state && isLevel(state.current) ? state.current : 0;
  const target = state && isLevel(state.target) ? state.target : 0;
  return (
    <span className="maturity-segments" aria-hidden="true">
      {([1, 2, 3] as const).map((lvl) => (
        <span
          key={lvl}
          className="maturity-seg"
          data-lit={lvl <= current ? "true" : undefined}
          data-target={lvl === target ? "true" : undefined}
        />
      ))}
    </span>
  );
}

function CriterionRow({
  criterion,
  state,
  locked,
  running,
  onDiscuss,
}: {
  criterion: MaturityCriterionKey;
  state: MaturityCriterionState | undefined;
  locked: boolean;
  running: boolean;
  onDiscuss: () => void;
}) {
  const t = useChrome();
  const label = criterionLabel(criterion, t);
  const assessed = state !== undefined && isLevel(state.current);
  const target = targetPresentation(state, t);
  return (
    <section className="maturity-row" data-criterion={criterion} aria-label={accessibleRowText(label, state, t)}>
      <div className="maturity-row-head">
        <span className="maturity-criterion">{label}</span>
        {state?.uncertain && <span className="profile-badge mono">{t.maturityUncertainBadge}</span>}
        {/* The reservation marker is NOT the uncertainty marker: a standing
            finding holding the criterion down, distinct in wording and in
            styling from a weak-evidence reading. */}
        {state?.capped && (
          <span className="profile-badge mono maturity-reservation" data-marker="reservation">
            {t.maturityCappedBadge}
          </span>
        )}
        <button
          type="button"
          className="maturity-discuss"
          aria-label={t.maturityDiscussAccessibleName({ label })}
          title={running ? runLockedReason() : t.maturityDiscussTitle}
          disabled={locked}
          onClick={onDiscuss}
        >
          {t.maturityDiscussLabel}
        </button>
      </div>
      <div className="maturity-row-levels">
        <LevelSegments state={state} />
        {assessed ? (
          // Keyboard-reachable disclosure (native <details>, not hover-only):
          // short token in the summary, full verbatim framework term + the fixed
          // per-cell gloss in the body, both from the catalogue.
          <details className="maturity-disclosure">
            <summary className="maturity-level mono">{levelShort(state!.current as MaturityLevel, t)}</summary>
            <p className="maturity-gloss">
              {levelFull(state!.current as MaturityLevel, t)} — {}
              {cellGloss(criterion, state!.current as MaturityLevel, t)}
            </p>
          </details>
        ) : (
          // Explicit unassessed state — never an empty cell, never a default level.
          <span className="maturity-level maturity-unassessed mono">{t.maturityNotYetAssessed}</span>
        )}
        {target && (
          <span
            className="maturity-target mono"
            data-reached={target === t.maturityTargetReached || target === t.maturityTargetExceeded ? true : undefined}
          >
            {target}
          </span>
        )}
      </div>
      {/* Gap hint: agent content (lecturer's language), escaped plain text only. */}
      {state?.hint && <div className="maturity-hint">{state.hint}</div>}
    </section>
  );
}

/** One decimal, so the rounding is visible rather than hidden (design.md §1:
 *  the band rounds half DOWN and the panel shows what it rounded). */
function meanText(mean: number): string {
  return mean.toFixed(1);
}

/** How the derived aggregate names what it rests on — the contributing count and
 *  the unrounded mean, plus the capping criterion where a standing reservation
 *  held the band down. An aggregate over three criteria and one over seven are
 *  different claims, and a panel showing only "L2" hides which one it makes. */
function derivationText(derived: DerivedOverallMaturity, t: ChromeCatalogue): string {
  const base = t.maturityDerivation({
    contributing: derived.contributing,
    total: MATURITY_CRITERIA.length,
    mean: meanText(derived.mean),
  });
  if (!derived.cappedBy) return base;
  return t.maturityDerivationCapped({
    base,
    level: levelShort(derived.level, t),
    criterion: criterionLabel(derived.cappedBy, t),
  });
}

/**
 * The header block above the raster (capability `desktop-app`, Requirement:
 * Maturity Panel — "Target and achieved reading share one header block above
 * the raster").
 *
 * Two separately labelled, separately announced elements, because they are two
 * kinds of statement: a settled ambition and a moving reading. Hoisting them
 * together must not quietly re-merge them into one current-and-target row —
 * which is what the block replaces — so neither element carries the other's
 * value and neither is styled as a criterion row.
 */
function MaturityHeaderBlock({
  state,
  derived,
}: {
  state: MaturityCriterionState | undefined;
  derived: DerivedOverallMaturity | undefined;
}) {
  const t = useChrome();
  const target = state && isLevel(state.target) ? state.target : undefined;
  const note = state?.note;
  // The achieved element's accessible text carries the note in EVERY state — it
  // is the recorded limitation on this reading, and in the no-aggregate state it
  // is the only thing standing beside the not-yet-due statement.
  const noteSuffix = note ? t.maturityRecordedLimitation({ note }) : "";
  return (
    <div className="maturity-header">
      <section
        className="maturity-header-item maturity-ambition"
        aria-label={t.maturityHeaderTargetAccessible({
          value: target ? levelFull(target, t) : t.maturityTargetUnsettled,
        })}
      >
        <span className="maturity-header-label">{t.maturityHeaderTargetLabel}</span>
        {target ? (
          <span className="maturity-level mono">{levelShort(target, t)}</span>
        ) : (
          // Stated plainly — never an empty slot, a dash, or a defaulted level.
          <span className="maturity-unsettled">{t.maturityTargetUnsettled}</span>
        )}
      </section>
      <section
        className="maturity-header-item maturity-achieved"
        aria-label={
          derived
            ? t.maturityHeaderAchievedAccessible({
                value: levelFull(derived.level, t),
                derivation: derivationText(derived, t),
                note: noteSuffix,
              })
            : t.maturityHeaderNotDueAccessible({ value: t.maturityAchievedNotDue, note: noteSuffix })
        }
      >
        <span className="maturity-header-label">{t.maturityHeaderAchievedLabel}</span>
        {derived ? (
          <>
            <LevelSegments state={{ current: derived.level }} />
            <span className="maturity-level mono">{levelShort(derived.level, t)}</span>
            <span className="maturity-derivation">{derivationText(derived, t)}</span>
          </>
        ) : (
          // No assessed criterion means NO aggregate: no level token, no band, no
          // segment indicator, no zero, no dash, no placeholder — only the
          // statement, and the recorded limitation note beside it.
          <span className="maturity-not-due">{t.maturityAchievedNotDue}</span>
        )}
        {/* Limitation note: agent content, escaped plain text only, subordinate
            in both states — never reframed as a reading or a verdict. */}
        {note && <div className="maturity-hint maturity-note">{note}</div>}
      </section>
    </div>
  );
}
