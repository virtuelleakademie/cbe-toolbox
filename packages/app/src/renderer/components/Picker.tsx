import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownView } from "./MarkdownView.js";
import { useChrome } from "../chrome.js";

/**
 * Picker — the first concrete Generative UI component.
 *
 * The skill emits a Picker as a Tool Result; the renderer shows pill-shaped
 * options the lecturer chooses from. Single-select auto-submits the moment one
 * pill is picked; multi-select waits for an explicit `Submit` click (or Enter
 * on the submit button). Once submitted, the picker freezes into the ANSWERED
 * state — pills become static, no further changes possible. A re-do requires
 * a new picker emission from the skill.
 *
 * The free-text option (when enabled) reveals a single-line input on selection
 * so the lecturer can answer outside the offered pill set. There is exactly ONE
 * such option and its label follows the lecturer's language via
 * `spec.otherLabel` — see Requirement: Collected UX-3 Fixes (Wave 1).
 *
 * Keyboard model:
 *   Tab / Shift+Tab — cycle focus through pills (wraps at ends)
 *   Space / Enter   — toggle the focused pill
 *   Esc             — blur (returns focus to the surrounding chat scroll)
 *
 * The component is intentionally PURE — it does not know how the response
 * flows back to the skill. The parent provides `onSubmit(response)` and the
 * Picker calls it once. This keeps the component testable in isolation and
 * lets the same Picker work for both tool-result emission paths and any
 * future preview / scripted-demo paths.
 *
 * Covers `specs/desktop-app/spec.md`, *Generative UI — Picker (single and
 * multi-select)*.
 */

export interface PickerOption {
  /** Stable identifier used in `PickerResponse.selectedIds`. */
  id: string;
  /** Visible pill text. Plain text only — kept short. */
  label: string;
}

export interface PickerSpec {
  /** The question shown above the pill list. Markdown-formatted; rendered via MarkdownView. */
  question: string;
  /** Required-marker flag — renders a small red asterisk next to the question. */
  required?: boolean;
  /** Pill options in display order. */
  options: PickerOption[];
  /** Single-select (radio) vs multi-select (checkbox). Spec payload flag. */
  multiSelect?: boolean;
  /** Whether to append the free-text option that reveals a text input. Default true. */
  otherEnabled?: boolean;
  /** Label of the free-text option, supplied by the skill in the lecturer's own
   * language (capability `cbe-skill`, Requirement: Response Language Mirrors the
   * Lecturer). Falls back to the catalogue entry `pickerOtherLabelFallback`
   * when the skill omits it. */
  otherLabel?: string;
}

export interface PickerResponse {
  /** Ids of all selected pills (excluding the synthetic "other" pill). */
  selectedIds: string[];
  /** Free-text answer when "Other" was selected; undefined otherwise. */
  otherText?: string;
}

const OTHER_ID = "__other__";

export function Picker({ spec, onSubmit }: { spec: PickerSpec; onSubmit: (response: PickerResponse) => void }) {
  const t = useChrome();
  const otherEnabled = spec.otherEnabled !== false;
  const multiSelect = !!spec.multiSelect;
  // Exactly ONE free-text surface: the host collapses a model-supplied
  // "other" option into `otherLabel` before the spec reaches the renderer
  // (`packages/pi-bridge/src/picker-tool.ts`, `normalizePickerParams`), so this
  // append can never produce a second one.
  // The app's OWN last-resort label, used only where the skill supplied none: a
  // skill-supplied `otherLabel` is lecturer-language content passing through a
  // chrome surface and is rendered untouched, while the fallback is chrome and
  // follows the interface language (capability `desktop-app`, Requirement: *Every
  // String the App Renders Is English*, § "Values the skill supplies…").
  const otherLabel = spec.otherLabel?.trim() || t.pickerOtherLabelFallback;
  const allOptions: PickerOption[] = otherEnabled
    ? [...spec.options, { id: OTHER_ID, label: otherLabel }]
    : spec.options;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [answered, setAnswered] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const pillRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const otherSelected = selected.has(OTHER_ID);

  // When "Other" is freshly selected, focus its text input so the lecturer can
  // type immediately. The pill stays focusable via Tab for re-orientation.
  useEffect(() => {
    if (otherSelected && !answered) {
      otherInputRef.current?.focus();
    }
  }, [otherSelected, answered]);

  function commit(currentSelected: Set<string>, currentOtherText: string) {
    const selectedIds = Array.from(currentSelected).filter((id) => id !== OTHER_ID);
    const response: PickerResponse = { selectedIds };
    if (currentSelected.has(OTHER_ID) && currentOtherText.trim()) {
      response.otherText = currentOtherText.trim();
    }
    setAnswered(true);
    onSubmit(response);
  }

  function togglePill(id: string) {
    if (answered) return;
    if (multiSelect) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    } else {
      // Single-select: replace the set with just this id. Auto-submit unless
      // the "Other" pill was picked — that one needs the lecturer to type the
      // custom answer first AND press Enter / click submit.
      const next = new Set([id]);
      setSelected(next);
      if (id !== OTHER_ID) commit(next, otherText);
    }
  }

  function handleSubmitButton() {
    if (answered) return;
    if (selected.size === 0) return;
    // For "Other" selections, require non-empty text — otherwise the answer is
    // ambiguous ("the lecturer wanted to say something else but didn't say what").
    if (otherSelected && !otherText.trim()) {
      otherInputRef.current?.focus();
      return;
    }
    commit(selected, otherText);
  }

  function handlePillKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (answered) return;
    switch (e.key) {
      case "Tab": {
        // Cycle through pills with wrap. Outer Tab focus order is preserved
        // by NOT preventing default when we leave the picker via Tab from
        // the last pill while no further pills exist — but per spec, Tab
        // inside the picker cycles within the picker.
        e.preventDefault();
        const next = e.shiftKey ? (index - 1 + allOptions.length) % allOptions.length : (index + 1) % allOptions.length;
        setFocusedIndex(next);
        pillRefs.current[next]?.focus();
        break;
      }
      case " ":
      case "Enter": {
        e.preventDefault();
        togglePill(allOptions[index]!.id);
        break;
      }
      case "Escape": {
        e.preventDefault();
        e.currentTarget.blur();
        break;
      }
    }
  }

  return (
    <div className={`picker ${answered ? "picker-answered" : ""}`} role="group" aria-label={t.pickerGroupLabel}>
      <header className="picker-head">
        <div className="picker-question">
          <MarkdownView text={spec.question} />
          {spec.required && (
            <span className="picker-required" aria-label={t.pickerRequiredLabel}>
              *
            </span>
          )}
        </div>
        {answered && (
          <span className="picker-badge mono" aria-label={t.pickerAnsweredLabel}>
            {t.pickerAnsweredBadge}
          </span>
        )}
      </header>

      <ul className="picker-pills" role={multiSelect ? "group" : "radiogroup"}>
        {allOptions.map((opt, i) => {
          const isSelected = selected.has(opt.id);
          return (
            <li key={opt.id} className="picker-pill-row">
              <button
                ref={(el) => {
                  pillRefs.current[i] = el;
                }}
                type="button"
                className={`picker-pill ${isSelected ? "picker-pill-selected" : ""}`}
                role={multiSelect ? "checkbox" : "radio"}
                aria-checked={isSelected}
                aria-disabled={answered}
                tabIndex={i === focusedIndex ? 0 : -1}
                onClick={() => togglePill(opt.id)}
                onKeyDown={(e) => handlePillKeyDown(e, i)}
                onFocus={() => setFocusedIndex(i)}
              >
                {opt.label}
              </button>
              {opt.id === OTHER_ID && isSelected && !answered && (
                <input
                  ref={otherInputRef}
                  type="text"
                  className="picker-other-input mono"
                  // No visible placeholder: any wording here would be chrome text
                  // in ONE hardcoded language sitting inside a conversation that
                  // follows the lecturer's. The pill label above already says what
                  // to do; screen readers get the accessible name.
                  aria-label={otherLabel}
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSubmitButton();
                    }
                  }}
                />
              )}
              {opt.id === OTHER_ID && isSelected && answered && otherText.trim() && (
                <div className="picker-other-answer mono">{otherText.trim()}</div>
              )}
            </li>
          );
        })}
      </ul>

      {multiSelect && !answered && (
        <div className="picker-footer">
          <button
            type="button"
            className="picker-submit"
            onClick={handleSubmitButton}
            disabled={selected.size === 0 || (otherSelected && !otherText.trim())}
          >
            {t.pickerSubmitLabel}
          </button>
        </div>
      )}
    </div>
  );
}
