/**
 * The context-usage ring's copy, composed from the interface-language catalogue
 * (capability `desktop-app`, Requirements: *Context-Usage Ring in the Composer
 * Control Row*; *Each Rendered Chrome String Has Exactly One Owner*). Written for
 * a lecturer who does not know what a context window is.
 *
 * The WORDING moved into the catalogue with the owner requirement's second axis;
 * what stays here is the state machine that decides which entry a ring state
 * resolves to. The token figures are grouped by the CHROME language rather than
 * by a regional locale — a figure formatted for one language inside a sentence
 * written in another is a seam a lecturer reads as a bug. This module names no
 * locale of its own any more, and it takes none from the ambient active language
 * either: the tag is declared by the very catalogue whose wording it is grouping
 * figures inside, so a caller handing it a catalogue gets that catalogue's
 * grouping too (Requirement: *Locale-Dependent Formatting Follows the Interface
 * Language*).
 */
import { isNearFull, occupancyPercent, type ContextUsageReport, type RingState } from "../../shared/context-usage.js";
import { formatNumberIn, type ChromeCatalogue } from "../../shared/i18n/index.js";

/** The explanation revealed on hover and on keyboard focus. */
export function explanationFor(state: RingState, report: ContextUsageReport | null, t: ChromeCatalogue): string {
  switch (state) {
    case "pending":
      return t.ringExplanationPending;
    case "fresh":
      return t.ringExplanationFresh;
    case "carried":
      return t.ringExplanationCarried;
    case "window-unknown":
      return t.ringExplanationWindowUnknown({ used: formatNumberIn(t, report?.used ?? 0) });
    case "measured": {
      const used = report?.used ?? 0;
      const window = report?.window ?? 0;
      const base = t.ringExplanationMeasured({
        percent: occupancyPercent(used, window),
        used: formatNumberIn(t, used),
        window: formatNumberIn(t, window),
      });
      if (!isNearFull(used, window)) return base;
      // The near-full state says what will happen, in the lecturer's words. It
      // asks for nothing, blocks nothing and is not dismissable.
      return `${base} ${t.ringExplanationNearFull}`;
    }
  }
}

/** The short label assistive technology reads as the indicator's own text. */
export function labelFor(state: RingState, report: ContextUsageReport | null, t: ChromeCatalogue): string {
  switch (state) {
    case "pending":
      return t.ringLabelPending;
    case "fresh":
      return t.ringLabelFresh;
    case "carried":
      return t.ringLabelCarried;
    case "window-unknown":
      return t.ringLabelWindowUnknown;
    case "measured":
      return t.ringLabelMeasured({ percent: occupancyPercent(report?.used ?? 0, report?.window ?? 0) });
  }
}
