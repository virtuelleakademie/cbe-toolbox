import { useState } from "react";
import { MarkdownView } from "./MarkdownView.js";
import { ActionIcon } from "./ActionIcon.js";
import { useChrome } from "../chrome.js";

/**
 * DecisionChecklist — the second concrete Generative UI component.
 *
 * The skill emits it as a Tool Result with a `presentation` mode chosen at
 * emission time: a vertical **Checklist** (discrete decisions / heterogeneous
 * tasks) or a horizontal **Progress Bar** (sequential phases). The lecturer
 * toggles items done; on commit, the updated state flows back as the next user
 * turn. After commit the component freezes into an ANSWERED state, mirroring the
 * Picker.
 *
 * Like the Picker, this component is PURE — it does not know how the response
 * flows back. The parent provides `onSubmit(doneIds)` and the component calls it
 * once.
 *
 * Covers `specs/desktop-app/spec.md`, Requirement *Generative UI — Decision
 * Checklist (dual presentation)*.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  done?: boolean;
}

export interface DecisionChecklistSpec {
  title?: string;
  presentation: "checklist" | "progress-bar";
  items: ChecklistItem[];
}

export function DecisionChecklist({
  spec,
  onSubmit,
}: {
  spec: DecisionChecklistSpec;
  onSubmit: (doneIds: string[]) => void;
}) {
  const t = useChrome();
  const [done, setDone] = useState<Set<string>>(() => new Set(spec.items.filter((it) => it.done).map((it) => it.id)));
  const [answered, setAnswered] = useState(false);

  function toggle(id: string) {
    if (answered) return;
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
  }

  function commit() {
    if (answered) return;
    setAnswered(true);
    onSubmit(spec.items.filter((it) => done.has(it.id)).map((it) => it.id));
  }

  const isProgress = spec.presentation === "progress-bar";
  // For the progress bar, the "current" phase is the first not-yet-done marker.
  const currentIndex = spec.items.findIndex((it) => !done.has(it.id));

  return (
    <div
      className={`decision-checklist dc-${spec.presentation} ${answered ? "dc-answered" : ""}`}
      role="group"
      aria-label={t.checklistGroupLabel}
    >
      <header className="dc-head">
        {spec.title && (
          <div className="dc-title">
            <MarkdownView text={spec.title} />
          </div>
        )}
        {answered && (
          <span className="dc-badge mono" aria-label={t.checklistAnsweredLabel}>
            {t.checklistAnsweredBadge}
          </span>
        )}
      </header>

      {isProgress ? (
        <ol className="dc-progress">
          {spec.items.map((it, i) => {
            const isDone = done.has(it.id);
            const isCurrent = i === currentIndex;
            return (
              <li key={it.id} className="dc-progress-step">
                <button
                  type="button"
                  className={`dc-marker ${isDone ? "dc-marker-done" : ""} ${isCurrent ? "dc-marker-current" : ""}`}
                  aria-pressed={isDone}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-disabled={answered}
                  title={it.description}
                  onClick={() => toggle(it.id)}
                >
                  <span className="dc-marker-dot" aria-hidden="true" />
                  <span className="dc-marker-label">{it.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <ul className="dc-list">
          {spec.items.map((it) => {
            const isDone = done.has(it.id);
            return (
              <li key={it.id} className="dc-item">
                <button
                  type="button"
                  className={`dc-checkbox ${isDone ? "dc-checkbox-done" : ""}`}
                  role="checkbox"
                  aria-checked={isDone}
                  aria-disabled={answered}
                  title={it.description}
                  onClick={() => toggle(it.id)}
                >
                  <span className="dc-check" aria-hidden="true">
                    {isDone ? <ActionIcon kind="check" /> : null}
                  </span>
                  <span className="dc-item-label">{it.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!answered && (
        <div className="dc-footer">
          <button type="button" className="dc-submit" onClick={commit}>
            {t.checklistSubmitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
