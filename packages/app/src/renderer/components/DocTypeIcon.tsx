import type { DocType } from "../../shared/ipc-contract.js";

/** Short label rendered inside the page glyph so each format reads at a glance and
 * two formats are visibly distinct (capability `desktop-app`, scenario _The doc-type
 * icon matches the document format_). */
const TYPE_LABELS: Record<DocType, string> = {
  pdf: "PDF",
  docx: "DOC",
  pptx: "PPT",
  xlsx: "XLS",
  txt: "TXT",
  md: "MD",
  csv: "CSV",
};

/**
 * Inline-SVG doc-type icon (capability `desktop-app`, Requirement: Ingested Documents
 * Render as Doc Chips). No icon-library dependency; themed via `currentColor` so it
 * inherits the chip/pill colour. Decorative — the chip/pill carries the accessible
 * name, so the SVG is `aria-hidden`. The `data-doctype` attribute is the stable hook
 * for selecting the per-format variant in tests.
 */
export function DocTypeIcon({ type }: { type: DocType }) {
  return (
    <svg
      className="doc-type-icon"
      data-doctype={type}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 2.75h7.5L18 7.25V20.5a.75.75 0 0 1-.75.75H6.75A.75.75 0 0 1 6 20.5v-17a.75.75 0 0 1 .75-.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M13.5 2.75V7.25H18" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="6.2"
        fontFamily="ui-monospace, Menlo, monospace"
        fill="currentColor"
      >
        {TYPE_LABELS[type]}
      </text>
    </svg>
  );
}
