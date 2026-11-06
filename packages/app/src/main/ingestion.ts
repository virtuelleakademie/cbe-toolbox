import path from "node:path";
import JSZip from "jszip";
import { ingestExtensionList, SUPPORTED_EXTENSIONS } from "@cbe/pi-bridge/ingest-formats";
import type { DocType, IngestOutcome } from "../shared/ipc-contract.js";
import { chrome } from "./interface-language.js";
import { extractXlsx } from "./xlsx-extract.js";

/**
 * Material ingestion stub (capability `desktop-app`, Requirement: Material
 * Ingestion Stub into the Chat Context).
 *
 * Extracts plain text from PDF / DOCX / PPTX / XLSX / plaintext / Markdown / CSV so the lecturer
 * can bring an existing teaching document into the working session without
 * copy-pasting. This is the STUB stage ONLY: it extracts text and hands it back
 * to be surfaced in the chat context. It deliberately does NOT atomize the
 * document, does NOT write to the Lecturer's Wiki, and does NOT persist anything —
 * the full workflow is the separate capability `lecturer-wiki`.
 */

/**
 * The accepted-extension set, RE-EXPORTED — this module deliberately declares none of
 * its own (capability `desktop-app`, Requirement: *Material Ingestion Stub into the
 * Chat Context* — "The set of accepted extensions MUST have exactly one owner").
 *
 * The one declaration is `@cbe/pi-bridge/ingest-formats`, because the renderer's
 * tooltip and the environment descriptor need the same set and neither can import a
 * main-only module. Re-exporting rather than copying is what makes the property
 * mechanical: `packages/app/tests/ingest-format-authority.test.ts` asserts IDENTITY
 * with the shared constant, which no hand-maintained copy can satisfy.
 */
export { SUPPORTED_EXTENSIONS };

/** The one place file extensions become doc types (capability `desktop-app`,
 * Requirement: Ingested Documents Render as Doc Chips). Co-located with the
 * `extractText` extension switch, and covering exactly `SUPPORTED_EXTENSIONS` —
 * `tests/ingest-format-authority.test.ts` holds the three in step, so an extension
 * can never be accepted without both a dispatch branch and an entry here; the
 * renderer consumes the result and never re-parses the filename. Only ever called
 * for a successfully extracted (therefore supported) file. */
const EXT_TO_DOCTYPE: Record<string, DocType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".txt": "txt",
  ".md": "md",
  ".csv": "csv",
};

export function extensionToDocType(filename: string): DocType {
  const ext = path.extname(filename).toLowerCase();
  const docType = EXT_TO_DOCTYPE[ext];
  if (!docType) throw new Error(`No doc type for extension "${ext}" (file "${filename}")`);
  return docType;
}

export type IngestResult = { ok: true; text: string } | { ok: false; unsupported: true; message: string };

/** Human-readable, non-fatal message for an unsupported file. Composed in the
 * interface language: the pipeline runs in the main process but its messages are
 * rendered to the lecturer, so they are chrome like any other (capability
 * `desktop-app`, Requirement: *Every String the App Renders Is English*). It names
 * the supported formats, so the message is actionable rather than only a refusal. */
function unsupportedMessage(ext: string): string {
  const t = chrome();
  return t.ingestUnsupportedFormat({ ext: ext || t.ingestNoExtension, supported: ingestExtensionList() });
}

/**
 * The legacy and variant Excel workbook extensions, refused BY NAME (capability
 * `desktop-app`, Requirement: *Material Ingestion Stub into the Chat Context*).
 *
 * `.xls` and `.xlsb` are binary formats; nothing here reads them. `.xlsm` is the same
 * OOXML container as `.xlsx` and would parse — it is refused as a deliberate POLICY
 * choice, so the app does not invite a macro-carrying workbook when the remedy costs one
 * Save As. Either way the generic refusal would be actively misleading here: it lists
 * `.xlsx`, so a lecturer holding an `.xls` would read it as "Excel is unsupported".
 */
const LEGACY_EXCEL_EXTENSIONS = new Set([".xls", ".xlsb", ".xlsm"]);

function legacyExcelMessage(ext: string): string {
  return chrome().ingestLegacyExcelFormat({ ext });
}

/**
 * Decode a plain-text document (`.txt`, `.md`, `.csv`) to a string.
 *
 * Two defects it exists for, both in the same helper because they are the same defect
 * for all three formats (capability `desktop-app`, Requirement: *Material Ingestion Stub
 * into the Chat Context*):
 *
 *   1. **Encoding.** `data.toString("utf8")` on Windows-1252 bytes replaces every umlaut
 *      with U+FFFD, unrecoverably. A German Excel CSV export is the common case; a `.txt`
 *      saved from Notepad as ANSI is the identical bug on a format already accepted.
 *      The answer is a deterministic either/or, NOT a heuristic charset sniff: decode
 *      strict UTF-8 (`fatal: true`); only bytes that are not valid UTF-8 — which the old
 *      call was already mangling — take the Windows-1252 branch. Valid UTF-8 therefore
 *      decodes exactly as before, so no currently-working file changes.
 *   2. **BOM.** Excel's "CSV UTF-8" writes a byte order mark, and a BOM is content in
 *      none of the three formats.
 *
 * `windows-1252` is requested through `TextDecoder` and falls back to `latin1` where the
 * runtime's ICU build does not carry the legacy label. The two agree on every accented
 * Latin-1 letter and differ only in the 0x80–0x9F punctuation range.
 *
 * The result is the file's characters and nothing else — no parsing, no re-delimiting,
 * no reformatting. For CSV that is deliberate: a correct parser has to handle quoted
 * fields containing the delimiter, doubled quotes, embedded newlines and both `,` and
 * `;`, and a partial one silently corrupts a timetable rather than merely presenting it
 * plainly. Because nothing interprets the delimiter, a semicolon export arrives exactly
 * as intact as a comma one.
 */
function decodeTextDocument(data: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    try {
      text = new TextDecoder("windows-1252").decode(data);
    } catch {
      text = data.toString("latin1");
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Decode the small set of XML entities that appear in OOXML text runs. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pull the text of every `<prefix:t>…</prefix:t>` run out of an OOXML part,
 * inserting newlines at paragraph boundaries so the result stays readable. */
function textFromOoxml(xml: string, runTag: string, paragraphTag: string): string {
  const withBreaks = xml.replace(new RegExp(`</${paragraphTag}>`, "g"), "\n");
  const runs: string[] = [];
  const re = new RegExp(`<${runTag}[^>]*>([\\s\\S]*?)</${runTag}>`, "g");
  for (const m of withBreaks.matchAll(re)) {
    runs.push(decodeXmlEntities(m[1]!));
  }
  // Re-join: paragraph breaks were turned into \n in `withBreaks`, but matchAll
  // lost them. Simplest faithful approach: strip ALL tags from the break-annotated
  // string and collapse whitespace — keeps paragraph newlines, drops markup.
  const stripped = withBreaks
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeXmlEntities(line).trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return stripped || runs.join(" ");
}

async function extractDocx(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  return textFromOoxml(await doc.async("string"), "w:t", "w:p");
}

async function extractPptx(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  // Slides are ppt/slides/slide1.xml, slide2.xml, … — order numerically.
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
  const parts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name)!.async("string");
    const text = textFromOoxml(xml, "a:t", "a:p");
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

async function extractPdf(data: Buffer): Promise<string> {
  // Legacy build runs headless in the Electron main (node) process — no worker,
  // no canvas. Text extraction does not need rendering.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false, isEvalSupported: false })
    .promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+\n/g, "\n")
      .trim();
    if (text) pages.push(text);
  }
  await doc.destroy();
  return pages.join("\n\n");
}

/**
 * Extract plain text from an ingested document. Dispatches by file extension.
 * Returns `{ ok: false, unsupported: true }` with a non-fatal message for any
 * format outside the supported set — the caller surfaces it without crashing.
 */
export async function extractText(filename: string, data: Buffer): Promise<IngestResult> {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".md":
    // A CSV is text and rides the same branch: it is handed over raw, never parsed.
    case ".csv":
      return { ok: true, text: decodeTextDocument(data) };
    case ".docx":
      return { ok: true, text: await extractDocx(data) };
    case ".pptx":
      return { ok: true, text: await extractPptx(data) };
    case ".xlsx":
      return { ok: true, text: await extractXlsx(data) };
    case ".pdf":
      return { ok: true, text: await extractPdf(data) };
    default:
      return LEGACY_EXCEL_EXTENSIONS.has(ext)
        ? { ok: false, unsupported: true, message: legacyExcelMessage(ext) }
        : { ok: false, unsupported: true, message: unsupportedMessage(ext) };
  }
}

/**
 * Extract a batch of files (one multiselect dialog pass) into per-file outcomes,
 * in input order. Each file is processed independently: an unsupported, unreadable,
 * or otherwise failing file yields its own failure outcome and never discards the
 * rest of the batch. `read` is injected so the loop is testable without fs access.
 */
export async function ingestPaths(
  filePaths: readonly string[],
  read: (filePath: string) => Promise<Buffer>
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = [];
  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    try {
      const data = await read(filePath);
      const out = await extractText(filename, data);
      // docType is display-only (drives the chip icon); derived from the same supported
      // extension extractText dispatched on, so it never fails on the ok branch.
      outcomes.push(
        out.ok ? { ok: true, text: out.text, filename, docType: extensionToDocType(filename) } : { ...out, filename }
      );
    } catch (err) {
      outcomes.push({
        ok: false,
        unsupported: true,
        filename,
        message: chrome().ingestUnreadableFile({
          filename,
          detail: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  }
  return outcomes;
}
