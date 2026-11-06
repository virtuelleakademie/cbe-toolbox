import { useEffect, useRef, useState } from "react";
import { useCbe } from "../state/store.js";
import {
  STEP_ORDER,
  depthLabel,
  referenceArtefactLabel,
  referenceStepName,
  stateLabel,
  type StepId,
  type StepGroup,
  type JourneyElement,
  type ArtefactItem,
} from "../mocks/artifacts.js";
import type { JourneyPhase } from "@cbe/pi-bridge/canvas-addressing";
import { DecisionsSection } from "./DecisionsSection.js";
import { MarkdownView } from "./MarkdownView.js";
import { buildIterationPayload } from "../util/annotations.js";
import { promptFailureNotice, runLockedReason } from "../util/errors.js";
import { useChrome } from "../chrome.js";

/**
 * `↻ Iterate` toolbar — sits above the artifacts. Gathers the current
 * annotation layer into a structured payload and sends it as the next user turn
 * (Requirement: Artifact Annotation and Iteration Loop). Disabled when there are
 * no annotations, so no empty turn is sent and no model call is wasted.
 */
/**
 * Export control (capability `desktop-app`, Requirement: Collected UX-2 Fixes;
 * capability `course-workspace`, Requirement: Deterministic Design-Document Export
 * from Host State).
 *
 * A HOST affordance, not a model improvisation: activating it builds the document
 * from the host-side mirrors. Run-lock aware in the established idiom, and it states
 * its reason when unavailable instead of being silently inert.
 */
function ExportControl() {
  const t = useChrome();
  const running = useCbe((s) => s.agentRunning);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  const artifacts = useCbe((s) => s.artifacts);
  const setChatNotice = useCbe((s) => s.setChatNotice);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const hasContent = artifacts.some((g) =>
    [...g.items, ...(g.journey ?? []).flatMap((el) => el.items)].some((it) => it.value.trim().length > 0)
  );
  const reason = !sessionId
    ? t.canvasExportNoSession
    : running
      ? runLockedReason()
      : !hasContent
        ? t.canvasExportNothing
        : null;

  async function run() {
    if (reason || busy) return;
    setBusy(true);
    setDone(null);
    try {
      const res = await window.cbe.exportDesignDocument();
      if (res) setDone(res.path);
    } catch (err) {
      setChatNotice({ text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="artifacts-export">
      <button
        type="button"
        className="pp-action"
        disabled={reason !== null || busy}
        title={reason ?? t.canvasExportTitle}
        {...(reason ? { "aria-describedby": "artifacts-export-reason" } : {})}
        onClick={() => void run()}
      >
        {busy ? t.canvasExportBusy : t.canvasExportLabel}
      </button>
      {reason && (
        <span className="artifacts-export-reason" id="artifacts-export-reason">
          {reason}
        </span>
      )}
      {done && <span className="artifacts-export-done">{t.canvasExportDone({ path: done })}</span>}
    </div>
  );
}

function IterateToolbar() {
  const t = useChrome();
  const annotations = useCbe((s) => s.annotations);
  const clearAnnotations = useCbe((s) => s.clearAnnotations);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  // Run lock incl. the dispatch-to-agent_start window (Requirement: Canvas
  // Dialogue-Steering Dispatches Respect the Run Lock) — same lifecycle as the
  // composer; a mid-run iterate is a locked no-op, not an error.
  const running = useCbe((s) => s.agentRunning);
  const setChatNotice = useCbe((s) => s.setChatNotice);
  const setDispatchPending = useCbe((s) => s.setDispatchPending);
  const disabled = annotations.length === 0 || !sessionId || running;

  function handleIterate() {
    if (annotations.length === 0 || !sessionId || running) return;
    const text = buildIterationPayload(annotations);
    setDispatchPending(true);
    void window.cbe
      .sendPrompt(sessionId, text)
      .then(() => clearAnnotations())
      .catch((err: unknown) => setChatNotice(promptFailureNotice(err instanceof Error ? err.message : String(err))))
      .finally(() => setDispatchPending(false));
  }

  return (
    <div className="artifacts-toolbar">
      <button
        type="button"
        className="iterate-btn"
        onClick={handleIterate}
        disabled={disabled}
        title={running ? runLockedReason() : undefined}
      >
        {t.canvasIterateLabel}
      </button>
      <span className="annotation-count mono" aria-live="polite">
        {annotations.length === 0
          ? t.canvasNoAnnotationsLabel
          : t.canvasAnnotationCountLabel({ count: annotations.length })}
      </span>
      {/* Export shares this control row rather than sitting in a row of its own
          below the annotation area (Requirement: Collected UX-3 Fixes (Wave 1),
          scenario *Export sits in the CBE Process Canvas panel's control row*). */}
      <ExportControl />
    </div>
  );
}

/** An artifact row plus its inline annotate + delete affordances. `step`/`phase` locate
 * the artefact for the host-side deletion pipeline (mirror removal + deletion notice). */
function ArtifactRow({ item, step, phase }: { item: ArtefactItem; step: StepId; phase?: JourneyPhase }) {
  const t = useChrome();
  const annotations = useCbe((s) => s.annotations);
  const addAnnotation = useCbe((s) => s.addAnnotation);
  const removeAnnotation = useCbe((s) => s.removeAnnotation);
  const clearCanvasArtefact = useCbe((s) => s.clearCanvasArtefact);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  // Inline delete confirmation (Requirement: Canvas Artefact Delete Control). The control
  // appears only on a card that currently carries content; activating it opens an inline
  // confirmation, and only a confirm applies the deletion.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const mine = annotations.filter((a) => a.artifactId === item.id);
  // Only a card with content can be deleted — an empty seed-state card has nothing to delete.
  const hasContent = item.value.trim().length > 0;

  function save() {
    const trimmed = note.trim();
    if (!trimmed) return;
    addAnnotation(item.id, item.value, trimmed);
    setNote("");
    setAdding(false);
  }

  function confirmDelete() {
    // Route through the SAME host-side deletion pipeline as a skill-emitted clear
    // (mirror removal + next-turn deletion notice) AND apply the equivalent clear to
    // the local store — one lifecycle path, no renderer-only divergence.
    if (sessionId) {
      void window.cbe
        .deleteCanvasArtefact({
          sessionId,
          step,
          ...(phase ? { phase } : {}),
          id: item.id,
          // What the lecturer READS follows the interface language; what the MODEL
          // reads does not — the host quotes this label into the deletion notice.
          label: referenceArtefactLabel(item.id, item.label),
        })
        .catch(() => {
          /* host-side disclosure is best-effort; the local clear already applied */
        });
    }
    clearCanvasArtefact(step, phase, item.id);
    setConfirmingDelete(false);
  }

  return (
    <div className="artifact" data-state={item.state} data-artifact-id={item.id}>
      <div className="artifact-top">
        <span className="artifact-label mono">{item.label}</span>
        <span className="artifact-state mono">
          <span className="st-dot" />
          {stateLabel(item.state, t)}
        </span>
        {hasContent && !confirmingDelete && (
          <button
            type="button"
            className="artifact-delete"
            aria-label={t.canvasDeleteArtefactLabel({ label: item.label })}
            title={t.canvasDeleteArtefactTitle}
            onClick={() => setConfirmingDelete(true)}
          >
            ×
          </button>
        )}
      </div>
      {/* Artefact values are agent-authored Markdown, exactly like chat content, and go
          through the SAME shared Markdown component (skipHtml, GFM, citation
          linkification) — never a second rendering stack (Requirement: Collected UX-2
          Fixes, Scenario: *Canvas artefact values render as Markdown, not as raw text*).
          Wide content scrolls inside the card; see `.artifact-value .md` in styles.css. */}
      <div className="artifact-value">
        {item.value ? <MarkdownView text={item.value} /> : <span className="artifact-empty">{t.canvasEmptyValue}</span>}
      </div>

      {confirmingDelete && (
        <div
          className="artifact-delete-confirm"
          role="alertdialog"
          aria-label={t.canvasDeleteConfirmLabel({ label: item.label })}
        >
          {/* The confirmation names the card by its OWN label and says where the content
              goes from (Scenario: The delete confirmation names the card, not a retired
              category) — never the retired surface label. */}
          <span className="artifact-delete-msg">{t.canvasDeleteConfirmText({ label: item.label })}</span>
          <button type="button" className="artifact-delete-yes" onClick={confirmDelete}>
            {t.canvasDeleteAction}
          </button>
          <button type="button" className="artifact-delete-no" onClick={() => setConfirmingDelete(false)}>
            {t.chatCancel}
          </button>
        </div>
      )}

      {mine.length > 0 && (
        <ul className="annotation-list">
          {mine.map((a) => (
            <li key={a.id} className="annotation-item">
              <span className="annotation-note">{a.note}</span>
              <button
                type="button"
                className="annotation-remove"
                aria-label={t.canvasRemoveAnnotationLabel}
                onClick={() => removeAnnotation(a.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="annotation-editor">
          <input
            type="text"
            className="annotation-input"
            placeholder={t.canvasAnnotationInputPlaceholder}
            value={note}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                setAdding(false);
                setNote("");
              }
            }}
          />
          <button type="button" className="annotation-add" onClick={save} disabled={!note.trim()}>
            {t.canvasAnnotationAddLabel}
          </button>
        </div>
      ) : (
        <button type="button" className="annotate-toggle" onClick={() => setAdding(true)}>
          {t.canvasAnnotateToggleLabel}
        </button>
      )}
    </div>
  );
}

/** The Step-6 learning journey: four elements (Engage / Investigate / Act–prototype /
 * Reflect and present). Every element renders its name even while empty (Reflect and
 * present is new and often empty). */
function JourneyBody({ journey }: { journey: JourneyElement[] }) {
  const t = useChrome();
  return (
    <div className="journey-body">
      {journey.map((el) => (
        <div key={el.phase} className="journey-element" data-journey-phase={el.phase}>
          <div className="journey-element-head mono">{el.name}</div>
          {el.items.length > 0 ? (
            el.items.map((it) => <ArtifactRow key={it.id} item={it} step={6} phase={el.phase} />)
          ) : (
            <div className="journey-element-empty">{t.canvasEmptyValue}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Right-panel Artifacts tab — the Design-Flow Canvas: the ten §4.6 design-step groups as
 * an accordion, one expanded at a time (capability `desktop-app`, Requirement: Design-Flow
 * Canvas / Artifacts Tab). Step 4 carries the challenge ladder; Step 6 the four-element
 * learning journey. Step-group headers render the coverage depth + exclusive in-focus
 * marker. Selecting a step sets that focus in the host and adds nothing to the conversation
 * (see `selectStep`). The step chrome is always active — there is no mode state to
 * de-emphasize against.
 *
 * Artefacts come LIVE from the `artifacts` store slice; coverage from the `steps` slice.
 */
export function ArtifactsPanel() {
  const t = useChrome();
  const artifacts = useCbe((s) => s.artifacts);
  const steps = useCbe((s) => s.steps);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  // No run-lock state here: the step-select affordance dispatches no prompt and is
  // therefore outside Requirement: Canvas Dialogue-Steering Dispatches Respect the
  // Run Lock. The iteration toolbar keeps its own lock hooks.
  const applyStepUpdate = useCbe((s) => s.applyStepUpdate);
  const [open, setOpen] = useState<StepId>(1);

  const coverageByStep = new Map(steps.map((sc) => [sc.step, sc]));

  // The accordion FOLLOWS the focused step (Requirement: Panel Follows the Agent's
  // Artefact Work), so the artefact the agent just wrote is readable instead of
  // hidden in a collapsed group. It tracks the exclusive focus, not each write:
  // several writes into one step group leave `focused` unchanged and move nothing,
  // and a manual header click stands until the focus genuinely moves on.
  //
  // What "moves on" means is scoped to ONE conversation: `steps` is per-conversation
  // state the course switch swaps under a component that does not remount, so the
  // last-followed value is keyed to the conversation and a switch always re-derives the
  // accordion from the incoming conversation (its focused step, else the default
  // group) instead of leaving the outgoing course's group standing. Losing the focus
  // altogether resets the memory too, so re-focusing the same step re-opens it.
  //
  // The key is the COURSE plus the session, not the session alone. It was written when
  // a switch left `session` pointing at the OUTGOING course, so a session-only key
  // missed the switch entirely; the store now clears the whole mirror on that path
  // (`state/store.ts`, `emptyConversationMirror`), and the course component is kept
  // because it is still the honest answer to "which conversation is on screen": a
  // course entered before its conversation resolves has no session at all, and two
  // successive unresolved courses would otherwise share one key.
  const activeCourseId = useCbe((s) => s.activeCourseId);
  const focused = steps.find((sc) => sc.focus)?.step;
  const conversationKey = `${activeCourseId ?? ""} ${sessionId ?? ""}`;
  const lastFollowedFocus = useRef<{ key: string; step: number | undefined }>({
    key: conversationKey,
    step: undefined,
  });
  useEffect(() => {
    const prev = lastFollowedFocus.current;
    const switched = prev.key !== conversationKey;
    lastFollowedFocus.current = { key: conversationKey, step: focused };
    if (focused === undefined) {
      if (switched) setOpen(1);
      return;
    }
    if (!switched && focused === prev.step) return;
    if (STEP_ORDER.includes(focused as StepId)) setOpen(focused as StepId);
  }, [focused, conversationKey]);

  /**
   * Selecting a step group sets the step FOCUS — in the host, immediately, and
   * independently of the model (Requirement: Design-Flow Canvas; capability
   * `agent-harness`, Requirement: Host-Set Step Focus from the Canvas UI).
   *
   * The in-focus marker states where work LANDED, and a selection the lecturer just
   * performed is exactly that kind of fact — so it is not routed through the model as
   * a request. The local `applyStepUpdate` moves the marker in this frame; the host
   * call records the same focus in the step mirror and arms the notice that discloses
   * it to the agent on the NEXT lecturer turn, out of band.
   *
   * NOTHING enters the chat: no prompt, no user turn, no notice. The moving marker is
   * the feedback. This is why there is no run lock here (nothing is dispatched, so
   * nothing can race) and no failure surface (a failed host call leaves the marker
   * where the lecturer put it, and the mirror re-syncs on the next hydration).
   */
  function selectStep(g: StepGroup) {
    if (!sessionId) return;
    applyStepUpdate(g.step, { focus: true });
    void window.cbe
      .focusStep({ sessionId, step: g.step, label: referenceStepName(g.step, g.name) })
      .catch((err: unknown) => {
        console.error("[cbe] step focus could not be recorded in the host:", err);
      });
  }

  return (
    <div className="artifacts-panel">
      <IterateToolbar />
      {STEP_ORDER.map((key) => {
        const g = artifacts.find((sg) => sg.step === key)!;
        const isOpen = open === key;
        const cov = coverageByStep.get(key);
        return (
          <div
            key={key}
            className="phase-group step-group"
            data-step={key}
            data-focus={cov?.focus ? "true" : undefined}
          >
            <div className="step-head-row">
              <button
                type="button"
                className={`phase-head step-head ${cov?.focus ? "is-focus" : ""}`}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? open : key)}
              >
                <span className="phase-num mono">{key}</span>
                <span className="phase-name">{g.name}</span>
                {cov && (
                  <span className="step-coverage mono" data-depth={cov.depth}>
                    <span className="step-depth">{depthLabel(cov.depth, t)}</span>
                    {cov.focus && (
                      <span className="step-focus" aria-label={t.canvasFocusMarkerLabel}>
                        {`● ${t.canvasFocusMarkerText}`}
                      </span>
                    )}
                  </span>
                )}
                <span className="phase-chev">{isOpen ? "▾" : "▸"}</span>
              </button>
              {/* Step-select affordance — sets the focus in the host. It dispatches
                  no prompt, so it is NOT bound to the run lock and stays active
                  while the agent is streaming. */}
              <button
                type="button"
                className="step-select"
                aria-label={t.canvasStepFocusLabel({ step: key, name: g.name })}
                title={t.canvasStepFocusTitle}
                disabled={!sessionId}
                onClick={() => selectStep(g)}
              >
                →
              </button>
            </div>
            {isOpen && (
              <div className="phase-body step-body">
                {g.journey ? (
                  <JourneyBody journey={g.journey} />
                ) : (
                  g.items.map((it) => <ArtifactRow key={it.id} item={it} step={key} />)
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* Fourth, always-available container — orthogonal to the one-step-at-a-time
          accordion above. Its open state is internal. */}
      <DecisionsSection />
    </div>
  );
}
