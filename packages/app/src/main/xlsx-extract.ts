import JSZip from "jszip";

/**
 * XLSX workbook extraction (capability `desktop-app`, Requirement: *Material Ingestion
 * Stub into the Chat Context* — the six workbook decisions and the two size caps).
 *
 * WHY THIS FILE EXISTS AT ALL. A lecturer handed the app his timetable as an Excel
 * workbook and the app refused it. He then put a screenshot of the same timetable into
 * a PPTX; the app ACCEPTED that file, extraction returned nothing, and nobody was told.
 * That second failure is the one this module is written against: the job here is not to
 * return "some text for an .xlsx", it is to return a grid a model can still read as a
 * grid — or to say plainly which part is missing.
 *
 * WHY NO LIBRARY. `jszip` is already a direct dependency and is already how this repo
 * extracts DOCX and PPTX (`main/ingestion.ts`); an `.xlsx` is the same kind of OOXML
 * zip. `xlsx` (SheetJS) is no longer maintained through the npm registry and its last
 * registry versions carry known advisories; `exceljs` is a write-oriented tree this app
 * has no other use for. Both would also decide for us what a cell IS, and those
 * decisions are the substance of the requirement — see the numbered comments below.
 *
 * WHAT THE OUTPUT LOOKS LIKE (model-facing, neutral English — the lecturer never sees
 * it, an ingested document renders as a doc chip):
 *
 *     Workbook: 2 sheets.
 *
 *     ## Sheet 1/2: "Herbstsemester 25"
 *     merged: A1:D1
 *
 *     | row | A | B | C | D |
 *     | --- | --- | --- | --- | --- |
 *     | 1 | Stundenplan HS25 | Stundenplan HS25 | Stundenplan HS25 | Stundenplan HS25 |
 *     | 2 | Woche | Datum | Thema | Raum |
 *     | 3 | 1 | 2025-09-15 | Einstieg | A101 |
 *
 *     ## Sheet 2/2: "Notizen" (hidden)
 *     (no cells)
 */

// ─────────────────────────────── the two caps ────────────────────────────────

/**
 * Per-sheet column cap (decision: *bounded on two axes*).
 *
 * BASIS: 64 columns is column BL. A spreadsheet a human authored and reads on a screen
 * does not run past it — a 15-week timetable is six to twelve columns, a competence
 * matrix twenty. Beyond BL a sheet is machine-generated, and the cells out there are
 * overwhelmingly the padding a producer wrote rather than anything the lecturer typed.
 * Cutting there costs a real document nothing and bounds the row width, which is what
 * keeps a single row from being unreadably long once the grid is rendered.
 */
export const MAX_COLUMNS_PER_SHEET = 64;

/**
 * Whole-workbook cell budget, spent in sheet order (decision: *bounded on two axes*).
 *
 * BASIS: 10,000 emitted cells is roughly a 150-row full-width sheet or a 1,600-row
 * six-column list — about 30k tokens once rendered, which is already a large share of a
 * small model's context and the point past which one more cell buys the lecturer less
 * than the context it costs. Every real timetable is two orders of magnitude below it,
 * so this is a backstop rather than a routine event. Empty cells count: they cost text
 * exactly as filled ones do, and pretending otherwise would let a sparse million-cell
 * sheet through.
 */
export const MAX_CELLS_PER_WORKBOOK = 10_000;

/** How many merge ranges / unreached sheet names a notice lists before it says "+N more". */
const MAX_LISTED = 50;

// ──────────────────────────── small XML helpers ──────────────────────────────

/** Decode the XML entities that appear in OOXML text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Read one attribute off an element's opening tag. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeEntities(m[1]!) : undefined;
}

/** Concatenate every `<…:t>` run inside a fragment, dropping phonetic (`rPh`) runs,
 * which are furigana and not content. Used for shared strings and inline strings. */
function textRuns(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    out += decodeEntities(m[1]!);
  }
  return out;
}

// ───────────────────────── column letters ↔ indices ──────────────────────────

/** `A` → 1, `Z` → 26, `AA` → 27. */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 → `A`, 27 → `AA`. Exported so the truncation notice and the tests speak the same
 * addresses the lecturer sees in Excel. */
export function columnLetters(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ───────────────────────────── number formats ────────────────────────────────

/** Builtin `numFmtId`s that are date, time, or date-time formats (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 45, 46, 47]);
const BUILTIN_TIME_ONLY_FORMATS = new Set([18, 19, 20, 21, 45, 46, 47]);

type DateKind = "none" | "date" | "time" | "datetime";

/**
 * Classify a number-format code as date / time / date-time.
 *
 * The token test runs on the code with its QUOTED literals, its bracketed sections
 * (`[$-409]`, `[Red]`, `[h]`) and its backslash escapes removed first — otherwise a
 * currency format carrying the literal `"m"` or a colour tag reads as a month.
 */
function classifyFormatCode(code: string): DateKind {
  const bare = code
    .replace(/\\./g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "");
  const hasDate = /[yd]/i.test(bare) || /m{3,}/i.test(bare);
  const hasClock = /[hs]/i.test(bare);
  // A lone `m`/`mm` is month only when a date token stands beside it; next to `h` or `s`
  // it is minutes, which is Excel's own disambiguation rule.
  const hasMonth = /m/i.test(bare) && hasDate;
  if ((hasDate || hasMonth) && hasClock) return "datetime";
  if (hasDate || hasMonth) return "date";
  if (hasClock) return "time";
  return "none";
}

/** `styleIndex → DateKind`, built from `xl/styles.xml`. Index into `cellXfs`. */
function buildStyleDateKinds(stylesXml: string | undefined): DateKind[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1]!, "numFmtId"));
    const code = attr(m[1]!, "formatCode");
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const cellXfsBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const kinds: DateKind[] = [];
  for (const m of cellXfsBlock.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attr(m[1]!, "numFmtId") ?? "0");
    const code = custom.get(id);
    if (code !== undefined) kinds.push(classifyFormatCode(code));
    else if (BUILTIN_TIME_ONLY_FORMATS.has(id) && !BUILTIN_DATE_FORMATS.has(id)) kinds.push("time");
    else if (BUILTIN_DATE_FORMATS.has(id)) kinds.push(id >= 45 ? "time" : id === 22 ? "datetime" : "date");
    else kinds.push("none");
  }
  return kinds;
}

/**
 * Excel serial number → ISO 8601.
 *
 * Two epochs exist. The default 1900 system counts serial 1 as 1900-01-01 but also
 * contains a phantom 1900-02-29 at serial 60, so everything from serial 61 on is
 * "days since 1899-12-30" while everything below 60 is "days since 1899-12-31"; serial
 * 60 itself is the artefact and is rendered as the date Excel shows for it. The 1904
 * system (older Mac workbooks, `date1904="1"` in `xl/workbook.xml`) counts from
 * 1904-01-01 and needs no such correction.
 */
export function serialToIso(serial: number, kind: DateKind, date1904: boolean): string {
  const whole = Math.floor(serial);
  const frac = serial - whole;
  let epochDays: number;
  if (date1904) epochDays = whole + 1462;
  // Serial 60 is Excel's phantom 1900-02-29. There is no such day; it is rendered as
  // 1900-02-28 rather than shifting every other date to hide one impossible one.
  else if (whole === 60) epochDays = 60;
  else epochDays = whole >= 61 ? whole : whole + 1;
  // Days since the Unix epoch: 25569 is 1970-01-01 in the (corrected) 1900 serial system.
  const ms = Math.round((epochDays - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const datePart = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const totalSeconds = Math.round(frac * 86_400);
  const hh = Math.floor(totalSeconds / 3600) % 24;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const ss = totalSeconds % 60;
  const timePart = ss > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(hh)}:${pad(mm)}`;
  if (kind === "time") return timePart;
  if (kind === "datetime") return `${datePart} ${timePart}`;
  return datePart;
}

// ─────────────────────────────── cell rendering ──────────────────────────────

/** Make a value safe to sit inside a Markdown pipe table cell: a `|` would end the
 * cell, and a newline would end the row. Neither is a loss of content — the character
 * survives, escaped or as a space — but an unescaped one would silently reshape the grid. */
function cellSafe(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

interface SheetEntry {
  name: string;
  hidden: boolean;
  part: string;
}

/** Read the sheet list in workbook order, resolving each `r:id` through the workbook
 * rels rather than guessing `sheetN.xml` — producers do not guarantee that mapping, and
 * guessing it silently pairs a sheet's NAME with another sheet's CELLS. */
function readSheetIndex(workbookXml: string, relsXml: string | undefined): SheetEntry[] {
  const targets = new Map<string, string>();
  if (relsXml) {
    for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attr(m[1]!, "Id");
      const target = attr(m[1]!, "Target");
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }
  const sheets: SheetEntry[] = [];
  let fallback = 0;
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const tag = m[1]!;
    fallback += 1;
    const rid = attr(tag, "r:id") ?? attr(tag, "relationships:id");
    const target = (rid && targets.get(rid)) || `worksheets/sheet${fallback}.xml`;
    sheets.push({
      name: attr(tag, "name") ?? `Sheet${fallback}`,
      hidden: (attr(tag, "state") ?? "visible") !== "visible",
      part: `xl/${target}`,
    });
  }
  return sheets;
}

interface SheetGrid {
  /** `rowNumber → (columnIndex → rendered value)`. Sparse on purpose: the used range is
   * derived from what is here, never from the file's declared `dimension`. */
  rows: Map<number, Map<number, string>>;
  maxRow: number;
  maxCol: number;
  merges: string[];
}

function parseSheet(xml: string, sharedStrings: string[], styleKinds: DateKind[], date1904: boolean): SheetGrid {
  const rows = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxCol = 0;

  // Decision 6 — merges. Read them first: the unfold happens after the cells are in,
  // because a merge's covered cells simply are not in the file.
  const merges: string[] = [];
  const mergeBlock = xml.match(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/)?.[1] ?? "";
  for (const m of mergeBlock.matchAll(/<mergeCell\b([^>]*)\/?>/g)) {
    const ref = attr(m[1]!, "ref");
    if (ref) merges.push(ref);
  }

  let impliedRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowTag = rowMatch[1]!;
    const body = rowMatch[2] ?? "";
    const declared = Number(attr(rowTag, "r"));
    const rowNumber = Number.isFinite(declared) && declared > 0 ? declared : impliedRow + 1;
    impliedRow = rowNumber;

    let impliedCol = 0;
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellTag = cellMatch[1]!;
      const cellBody = cellMatch[2] ?? "";
      const ref = attr(cellTag, "r");
      const colIdx = ref ? columnIndex(ref.replace(/\d+$/, "")) : impliedCol + 1;
      impliedCol = colIdx;

      const rendered = renderCell(cellTag, cellBody, sharedStrings, styleKinds, date1904);
      if (rendered === "") continue; // an absent value is an empty POSITION, held by the grid

      let row = rows.get(rowNumber);
      if (!row) {
        row = new Map<number, string>();
        rows.set(rowNumber, row);
      }
      row.set(colIdx, rendered);
      if (rowNumber > maxRow) maxRow = rowNumber;
      if (colIdx > maxCol) maxCol = colIdx;
    }
  }

  // Decision 6, second half — unfold each merge across the cells it covers, so a heading
  // merged over four columns labels all four instead of leaving three blanks beside it.
  //
  // The unfold stays INSIDE the used range computed above from the cells the file actually
  // holds. Decision 3 makes those cells the authority precisely because a producer's
  // declaration overstates the sheet, and a merge `ref` is a declaration of that kind:
  // selecting a column and hitting Merge & Center writes `ref="A1:A1048576"`, which is an
  // ordinary gesture on a timetable rather than a hostile file. Were it allowed to enlarge
  // the sheet, a five-row timetable would spend the whole workbook cell budget on empty
  // rows, starve every later sheet, and report a truncation for content that is not
  // missing. The range itself is still listed on the `merged:` line exactly as the file
  // wrote it — that is what keeps the repetition visible and reversible — it simply does
  // not decide what exists.
  //
  // The two caps clamp the other direction: a sheet whose REAL cells reach the end of the
  // spreadsheet would otherwise materialise ~1.7e10 cells in a synchronous loop in the
  // Electron main process, hanging the app with nothing on screen — the silent failure
  // this module exists to remove. Nothing beyond what emission could print is ever built.
  const usedRow = maxRow;
  const usedCol = maxCol;
  let unfoldBudget = MAX_COLUMNS_PER_SHEET * MAX_CELLS_PER_WORKBOOK;
  for (const ref of merges) {
    const m = ref.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
    if (!m) continue;
    const c1 = columnIndex(m[1]!);
    const r1 = Number(m[2]);
    const value = rows.get(r1)?.get(c1);
    if (value === undefined) continue; // a merge whose top-left holds nothing repeats nothing

    const c2 = Math.min(columnIndex(m[3]!), usedCol, MAX_COLUMNS_PER_SHEET);
    const affordableRows = Math.max(r1, Math.floor(MAX_CELLS_PER_WORKBOOK / Math.max(1, c2)));
    const r2 = Math.min(Number(m[4]), usedRow, affordableRows);
    for (let r = r1; r <= r2 && unfoldBudget > 0; r++) {
      for (let c = c1; c <= c2 && unfoldBudget > 0; c++) {
        if (r === r1 && c === c1) continue;
        unfoldBudget -= 1;
        let row = rows.get(r);
        if (!row) {
          row = new Map<number, string>();
          rows.set(r, row);
        }
        if (!row.has(c)) row.set(c, value); // a cell carrying its own value is never overwritten
      }
    }
  }

  return { rows, maxRow, maxCol, merges };
}

/** Decision 4 — what one cell becomes. Returns "" for a cell that genuinely holds
 * nothing; the caller turns that into an empty position rather than a skipped column. */
function renderCell(
  cellTag: string,
  cellBody: string,
  sharedStrings: string[],
  styleKinds: DateKind[],
  date1904: boolean
): string {
  const type = attr(cellTag, "t") ?? "n";
  const rawValue = cellBody.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
  const value = rawValue === undefined ? undefined : decodeEntities(rawValue);

  if (type === "inlineStr") {
    const is = cellBody.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "";
    return cellSafe(textRuns(is));
  }
  if (type === "s") {
    const idx = Number(value);
    return cellSafe(Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "");
  }
  if (type === "e") return cellSafe(value ?? ""); // an Excel error stays visible as an error
  if (type === "b") return value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
  if (type === "d") return cellSafe(value ?? ""); // already ISO 8601 (ECMA-376 2nd ed.)
  if (type === "str") {
    if (value !== undefined && value !== "") return cellSafe(value);
    return formulaFallback(cellBody);
  }

  // Numeric (or untyped). A cached result wins; where the producer wrote none, the
  // FORMULA is emitted, because an unevaluated formula is information and an empty cell
  // in its place is a silent loss.
  if (value === undefined || value === "") return formulaFallback(cellBody);
  const num = Number(value);
  if (!Number.isFinite(num)) return cellSafe(value);

  // Decision 5 — a date is a date, not the serial number the lecturer never saw.
  const styleIndex = Number(attr(cellTag, "s") ?? "-1");
  const kind = styleIndex >= 0 ? (styleKinds[styleIndex] ?? "none") : "none";
  if (kind !== "none" && num >= 0) return serialToIso(num, kind, date1904);
  return cellSafe(value);
}

function formulaFallback(cellBody: string): string {
  const f = cellBody.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1];
  if (f === undefined) return "";
  const text = decodeEntities(f).trim();
  return text === "" ? "" : cellSafe(`=${text}`);
}

// ─────────────────────────────── the extractor ───────────────────────────────

/** Join a list for a notice, capped so a pathological workbook cannot write a page. */
function listCapped(items: readonly string[]): string {
  if (items.length <= MAX_LISTED) return items.join(", ");
  return `${items.slice(0, MAX_LISTED).join(", ")}, +${items.length - MAX_LISTED} more`;
}

/**
 * Extract an `.xlsx` workbook as a grid. Returns "" where the workbook holds no cell at
 * all, so the caller's existing no-usable-text path handles it — that is the honest
 * outcome for a workbook containing only a pasted screenshot, and it is exactly what the
 * PPTX case should have produced.
 */
export async function extractXlsx(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) return "";
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const stylesXml = await zip.file("xl/styles.xml")?.async("string");
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");

  const date1904 = /date1904\s*=\s*"(?:1|true)"/i.test(workbookXml);
  const styleKinds = buildStyleDateKinds(stylesXml);

  const sharedStrings: string[] = [];
  if (sharedXml) {
    for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sharedStrings.push(textRuns(m[1]!));
  }

  const sheets = readSheetIndex(workbookXml, relsXml);
  const blocks: string[] = [];
  const notReached: string[] = [];
  let cellBudget = MAX_CELLS_PER_WORKBOOK;
  let anyCells = false;

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    const heading = `## Sheet ${i + 1}/${sheets.length}: "${sheet.name}"${sheet.hidden ? " (hidden)" : ""}`;

    // The budget is spent in sheet order. A sheet reached with nothing left is never even
    // decompressed — which is what keeps a many-sheet workbook cheap — and is NAMED, so
    // the omission is legible rather than silent.
    if (cellBudget <= 0) {
      notReached.push(sheet.name);
      continue;
    }

    const xml = await zip.file(sheet.part)?.async("string");
    if (xml === undefined) {
      blocks.push(`${heading}\n(sheet part missing from the file)`);
      continue;
    }

    const grid = parseSheet(xml, sharedStrings, styleKinds, date1904);
    if (grid.maxRow === 0 || grid.maxCol === 0) {
      blocks.push(`${heading}\n(no cells)`);
      continue;
    }

    const lines: string[] = [heading];
    if (grid.merges.length > 0) lines.push(`merged: ${listCapped(grid.merges)}`);

    // Decision: bounded on two axes — columns first.
    const colCount = Math.min(grid.maxCol, MAX_COLUMNS_PER_SHEET);
    if (grid.maxCol > MAX_COLUMNS_PER_SHEET) {
      lines.push(
        `[truncated] Sheet "${sheet.name}": ${grid.maxCol} columns in the file ` +
          `(through ${columnLetters(grid.maxCol)}); columns A-${columnLetters(colCount)} extracted.`
      );
    }

    // …then the workbook cell budget. Whole rows only, so a row is never half a row.
    const rowsAffordable = Math.max(1, Math.floor(cellBudget / colCount));
    const rowCount = Math.min(grid.maxRow, rowsAffordable);
    if (rowCount < grid.maxRow) {
      lines.push(
        `[truncated] Sheet "${sheet.name}": ${grid.maxRow} rows in the file; ` +
          `rows 1-${rowCount} extracted — the workbook cell budget (${MAX_CELLS_PER_WORKBOOK} cells) ran out.`
      );
    }

    // A GFM table needs a blank line ahead of it, or the heading and the notices above
    // absorb it into one paragraph and the grid stops being a grid to whatever reads it.
    lines.push("");
    const header: string[] = ["row"];
    for (let c = 1; c <= colCount; c++) header.push(columnLetters(c));
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);

    for (let r = 1; r <= rowCount; r++) {
      const row = grid.rows.get(r);
      const cells: string[] = [String(r)];
      // Decision 3 — every column is emitted, empty or not. Skipping an empty cell would
      // shift every later cell one column left and the row would read correctly while
      // being wrong in every one of its columns.
      for (let c = 1; c <= colCount; c++) cells.push(row?.get(c) ?? "");
      lines.push(`| ${cells.join(" | ")} |`);
    }

    cellBudget -= rowCount * colCount;
    anyCells = true;
    blocks.push(lines.join("\n"));
  }

  if (!anyCells && notReached.length === 0) return "";

  const head = `Workbook: ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}.`;
  const tail =
    notReached.length > 0
      ? `\n\n[truncated] Sheets not extracted — the workbook cell budget ` +
        `(${MAX_CELLS_PER_WORKBOOK} cells) was spent before them: ${listCapped(notReached.map((n) => `"${n}"`))}.`
      : "";
  return `${head}\n\n${blocks.join("\n\n")}${tail}`;
}
