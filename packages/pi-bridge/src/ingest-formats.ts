/**
 * The ONE declaration of the file formats material ingestion accepts (capability
 * `desktop-app`, Requirement: *Material Ingestion Stub into the Chat Context* —
 * "The set of accepted extensions MUST have exactly one owner").
 *
 * Four surfaces name this set and every one of them derives from here:
 *
 *   1. the OS file dialog's filter and the extraction dispatch (Electron **main**,
 *      `packages/app/src/main/ingestion.ts`, which re-exports the constant below
 *      under its own long-standing name rather than declaring one);
 *   2. the refusal message for an unsupported file (main, same module);
 *   3. the tooltip on the composer's ingestion entry (**renderer**);
 *   4. the environment descriptor's `ingest formats:` line (**this package**,
 *      `environment.ts` — capability `agent-harness`, Requirement: *Environment
 *      Descriptor for the Skill*).
 *
 * WHY IT LIVES HERE rather than beside the extractor: those three readers do not
 * share a module graph. `main/ingestion.ts` is main-only (the renderer cannot import
 * it — that is why `DocType` sits in `shared/ipc-contract.ts`), and this package
 * cannot import from `packages/app` at all, since the dependency runs the other way.
 * `pi-bridge` is the one place all three reach. `ingest-envelope.ts` is the precedent:
 * same domain, same reason, pure string construction with no runtime dependencies, so
 * it is safe to import from the renderer bundle via the package subpath
 * `@cbe/pi-bridge/ingest-formats`.
 *
 * WHAT THIS FILE IS NOT: a capability claim. An extension belongs here only where
 * extraction for it exists — `packages/app/tests/ingest-format-authority.test.ts`
 * holds the two apart by asserting that every entry is dispatched by `extractText`
 * and carries a doc type. An accepted format that yields nothing is worse than a clear
 * refusal, and that has been paid for once already: a PPTX holding only a screenshot
 * was accepted and extracted to nothing, with nobody told.
 *
 * WHERE THE EXCEL BOUNDARY RUNS. `.xlsx` is in, with a real grid extractor behind it
 * (`packages/app/src/main/xlsx-extract.ts`). `.xls` and `.xlsb` are binary formats no
 * extractor here reads, and `.xlsm` is the same container as `.xlsx` but is refused as
 * a deliberate policy choice — the app does not invite a macro-carrying workbook when
 * the remedy costs one Save As. All three are refused BY NAME rather than by the generic
 * list, so a lecturer holding an `.xls` is not left inferring that Excel is unsupported
 * while `.xlsx` sits in the list beside it (capability `desktop-app`, Requirement:
 * *Material Ingestion Stub into the Chat Context*).
 *
 * The defect that produced this file: the descriptor reported a bare `ingestion: true`
 * and no channel named a single format, so the assistant advised a lecturer to convert
 * an Excel timetable to CSV — a format the app then refused as well.
 */

/**
 * Accepted ingest extensions, lowercase and dot-prefixed, in the order every surface
 * renders them. PDF / OOXML first, then the plain-text family.
 */
export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md", ".csv"] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Machine-facing rendering: `.pdf, .docx, …`. Used by the environment descriptor and
 * by the unsupported-format refusal message, both of which talk about file names.
 */
export function ingestExtensionList(): string {
  return SUPPORTED_EXTENSIONS.join(", ");
}

/**
 * Lecturer-facing rendering: `PDF / DOCX / …`. The format names are the same tokens in
 * every interface language — the sentence around them is what each chrome catalogue
 * owns, which is why this returns the list alone and never a phrase.
 */
export function ingestFormatNames(): string {
  return SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1).toUpperCase()).join(" / ");
}
