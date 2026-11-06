import type { DisplayAttachment, DocType } from "../../shared/ipc-contract.js";
import { DocTypeIcon } from "./DocTypeIcon.js";
import { useChrome } from "../chrome.js";

/**
 * Collapse control characters (newlines, CR, tab, …) in a filename so a multi-line or
 * control-laden name cannot break the chip/pill layout. Display hygiene only — the
 * envelope's own filename sanitisation in `@cbe/pi-bridge/ingest-envelope` is what
 * protects the model payload from boundary forgery.
 */
export function displayFilename(filename: string): string {
  return Array.from(filename)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const TYPE_NAME: Record<DocType, string> = {
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
  txt: "TXT",
  md: "MD",
  csv: "CSV",
};

/**
 * Compact, inert doc chip shown in the transcript for an ingested document
 * (capability `desktop-app`, Requirement: Ingested Documents Render as Doc Chips).
 *
 * NOT expandable — no click handler, no disclosure control, and the document body is
 * never passed in (the `DisplayAttachment` type has no body field), so the innards are
 * absent from the DOM. `role="img"` + `aria-label` give the whole chip one accessible
 * name conveying the filename and type; the decorative icon is `aria-hidden`.
 */
export function DocChip({ filename, docType }: DisplayAttachment) {
  const t = useChrome();
  const name = displayFilename(filename);
  return (
    <span
      className="doc-chip"
      data-doctype={docType}
      role="img"
      aria-label={t.docChipLabel({ name, type: TYPE_NAME[docType] })}
    >
      <DocTypeIcon type={docType} />
      <span className="doc-chip-name" title={name}>
        {name}
      </span>
    </span>
  );
}
