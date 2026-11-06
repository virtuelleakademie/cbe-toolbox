import { useId } from "react";
import { useCbe } from "../state/store.js";
import { ExplanationTooltip, useExplanationReveal } from "./ExplanationTooltip.js";
import { fillFraction, isNearFull, occupancyPercent, ringState } from "../../shared/context-usage.js";
import { explanationFor, labelFor } from "./ContextUsageRing.strings.js";
import { useChrome } from "../chrome.js";

/**
 * The composer control row's context-usage ring (capability `desktop-app`,
 * Requirement: Context-Usage Ring in the Composer Control Row). It shows how
 * much of the model's context window the visible conversation occupies.
 *
 * **Its figures come from the harness and from nowhere else** — `used` and
 * `window` are the harness's occupancy report (capability `agent-harness`,
 * Requirement: Context Occupancy Reported to the Host); nothing here computes or
 * estimates either. Its PENDING state is the one thing it reads elsewhere: the
 * compaction signal, because an occupancy report cannot produce it.
 *
 * **It is an indicator, not an action.** It performs nothing, opens nothing, is
 * not a button, and adds no fourth action to the row. It exposes `role="meter"`
 * — a role that carries a value to assistive technology — occupies exactly one
 * tab stop between the "+" and the model pill, and is focusable solely so its
 * explanation can be revealed without a pointer.
 *
 * Its copy is resolved from the interface-language catalogue through
 * `ContextUsageRing.strings.ts` — one owner per string, per language — and names
 * the Settings section's **Model** group exactly as that surface renders it.
 */

const SIZE = 18;
const STROKE = 2.4;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function ContextUsageRing() {
  const report = useCbe((s) => s.contextUsage);
  const everMeasured = useCbe((s) => s.contextEverMeasured);
  const pending = useCbe((s) => s.contextPending);
  const { open, revealProps } = useExplanationReveal();
  const t = useChrome();
  const explanationId = useId();

  const state = ringState(report, { pending, everMeasured });
  const measured = state === "measured";
  const used = report?.used ?? 0;
  const window = report?.window ?? 0;
  const fraction = measured ? fillFraction(used, window) : 0;
  const nearFull = measured && isNearFull(used, window);
  const label = labelFor(state, report, t);

  return (
    <span className="ring-wrap" {...revealProps}>
      <span
        className={`ctx-ring ctx-ring-${state}${nearFull ? " ctx-ring-near-full" : ""}`}
        // A role that carries a VALUE, not a focusable element with no role.
        // The meter reports the fraction where one is known; where none is, the
        // range is omitted and the label carries the state in words.
        role="meter"
        aria-label={label}
        aria-describedby={explanationId}
        {...(measured
          ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": occupancyPercent(used, window) }
          : {})}
        // One tab stop, between the "+" and the model pill — focusable solely so
        // the explanation is reachable without a pointer.
        tabIndex={0}
      >
        {/* The graphic itself is hidden from assistive technology; the indicator
            above exposes the state in words. */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true" focusable="false">
          <circle
            className="ctx-ring-track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            {...(state === "carried" ? { strokeDasharray: "3 2.4" } : {})}
            {...(state === "window-unknown" ? { strokeDasharray: "1 2.6", strokeLinecap: "round" as const } : {})}
          />
          {fraction > 0 && (
            <circle
              className="ctx-ring-fill"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
          {/* The near-full state's NON-COLOUR differentiator: a mark at the top
              of the ring, so the state is distinguishable without hue. */}
          {nearFull && (
            <path
              className="ctx-ring-mark"
              d={`M ${SIZE / 2} ${SIZE / 2 - 3.2} v 4.2`}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          )}
        </svg>
      </span>
      {/* Revealed on hover AND on keyboard focus, from the app's shared tooltip
          component in its OVERLAY placement — an in-flow reveal would reflow the
          control row, which both requirements forbid. */}
      <ExplanationTooltip id={explanationId} open={open} placement="overlay">
        {explanationFor(state, report, t)}
      </ExplanationTooltip>
    </span>
  );
}
