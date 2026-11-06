/**
 * Workbook extraction (capability `desktop-app`, Requirement: *Material Ingestion Stub
 * into the Chat Context* — the six workbook decisions, the two size caps, and the named
 * legacy-Excel refusal).
 *
 * WHAT THIS FILE IS GUARDING AGAINST. A lecturer's Excel timetable was refused; a PPTX
 * holding a screenshot of the same timetable was ACCEPTED and yielded nothing, with
 * nobody told. So a green "an .xlsx produced some text" would be worth nothing here. The
 * four cases where a naive extractor quietly produces NONSENSE are the point of the
 * file: a multi-sheet workbook (whose sheet names carry the semester), a formula cell
 * (whose serialised value is a formula, not a number), an empty cell (whose omission
 * shifts every later column left) and a date cell (whose stored value is a five-digit
 * serial the lecturer never saw).
 *
 * The fixtures are BUILT here rather than committed as binaries, so every assertion sits
 * beside the XML that produces it and a reader can see exactly which OOXML shape is
 * being claimed.
 *
 * Scenario mapping:
 *  - *An Excel timetable reaches the conversation as a grid* → the grid shape block.
 *  - *Every sheet is named, hidden sheets included* → the sheet-heading assertions.
 *  - *An empty cell keeps its column* → "an empty cell keeps its column" and its
 *    row-wise twin, "an interior empty row is likewise preserved".
 *  - *A formula cell shows what the lecturer sees* → the formula/error block.
 *  - *A date cell is not a serial number* → the date block.
 *  - *A merged heading covers its columns and says so* → the merge block.
 *  - *A merge declared beyond the sheet's cells does not enlarge it* → the two
 *    over-declared-merge cases, the ordinary whole-column one and the whole-sheet one.
 *  - *A workbook too large to extract whole says which part is missing* → the caps block.
 *  - *A workbook with no cells lands on the no-usable-text notice* → the empty block.
 *  - *A legacy Excel file is refused by name* → the refusal block.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractText } from "../src/main/ingestion.js";
import { MAX_CELLS_PER_WORKBOOK, MAX_COLUMNS_PER_SHEET, columnLetters } from "../src/main/xlsx-extract.js";
import { en } from "../src/shared/i18n/en.js";

interface SheetSpec {
  name: string;
  hidden?: boolean;
  /** Raw `<row>…</row>` XML for the sheet's `sheetData`. */
  rows: string;
  /** Raw `<mergeCell/>` entries, without the wrapping element. */
  merges?: string;
}

/** Assemble the minimum set of OOXML parts the extractor reads. */
async function workbook(opts: {
  sheets: SheetSpec[];
  sharedStrings?: string[];
  /** `cellXfs` entries, index-aligned with the `s="…"` attributes used in the rows. */
  cellXfs?: string[];
  numFmts?: string;
  date1904?: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  const sheetTags = opts.sheets
    .map(
      (s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`
    )
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook>${opts.date1904 ? '<workbookPr date1904="1"/>' : ""}` +
      `<sheets>${sheetTags}</sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships>${opts.sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`
  );
  opts.sheets.forEach((s, i) => {
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0"?><worksheet><sheetData>${s.rows}</sheetData>` +
        (s.merges ? `<mergeCells>${s.merges}</mergeCells>` : "") +
        `</worksheet>`
    );
  });
  if (opts.sharedStrings) {
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst>${opts.sharedStrings.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`
    );
  }
  if (opts.cellXfs) {
    zip.file(
      "xl/styles.xml",
      `<?xml version="1.0"?><styleSheet>${opts.numFmts ?? ""}` +
        `<cellXfs count="${opts.cellXfs.length}">${opts.cellXfs.join("")}</cellXfs></styleSheet>`
    );
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function extract(data: Buffer, filename = "stundenplan.xlsx"): Promise<string> {
  const result = await extractText(filename, data);
  expect(result.ok, "extraction refused a supported .xlsx").toBe(true);
  return result.ok ? result.text : "";
}

/** Every rendered table row of a workbook's output, so a test can assert how far the grid
 * really runs rather than only what it contains. */
function emittedRows(text: string): string[] {
  return text.split("\n").filter((l) => /^\| \d+ \|/.test(l));
}

/** The rendered table row for a spreadsheet row number, without the trailing pipe noise. */
function tableRow(text: string, rowNumber: number): string {
  const line = text.split("\n").find((l) => l.startsWith(`| ${rowNumber} |`));
  expect(line, `no rendered row ${rowNumber} in:\n${text}`).toBeDefined();
  return line!;
}

// ─────────────────────── the realistic timetable workbook ────────────────────

/**
 * One workbook carrying every trap at once, because that is how they arrive: a timetable
 * sheet with a merged title, a date column, a gap in a row, a gap of a whole row, a
 * formula that was calculated, a formula that was not, and a broken reference — plus a
 * second, hidden sheet.
 *
 * Serial 45915 is 2025-09-15; 45922.5625 is 2025-09-22 13:30.
 */
async function timetable(): Promise<string> {
  const data = await workbook({
    sharedStrings: ["Stundenplan HS25", "Woche", "Datum", "Raum", "Einstieg"],
    numFmts: '<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/>',
    cellXfs: ['<xf numFmtId="0"/>', '<xf numFmtId="164"/>', '<xf numFmtId="165"/>'],
    sheets: [
      {
        name: "Herbstsemester 25",
        merges: '<mergeCell ref="A1:D1"/>',
        rows:
          '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c>' +
          '<c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>3</v></c></row>' +
          // C3 is deliberately absent: the gap a naive extractor closes.
          '<row r="3"><c r="A3"><v>1</v></c><c r="B3" s="1"><v>45915</v></c>' +
          '<c r="D3" t="inlineStr"><is><t>A101</t></is></c></row>' +
          '<row r="4"><c r="A4"><v>2</v></c><c r="B4" s="2"><v>45922.5625</v></c>' +
          // A formula WITH its cached result, a formula WITHOUT one, and an error.
          '<c r="C4"><f>CONCATENATE(A4," Wochen")</f><v>2 Wochen</v></c>' +
          '<c r="D4"><f>SUM(A3:A4)</f></c></row>' +
          '<row r="5"><c r="A5" t="e"><v>#REF!</v></c><c r="D5" t="b"><v>1</v></c></row>' +
          // Row 6 is deliberately absent while row 7 exists: the interior empty ROW, the
          // other half of the property the empty CELL guards one axis of.
          '<row r="7"><c r="A7" t="inlineStr"><is><t>Semesterende</t></is></c></row>',
      },
      { name: "Notizen", hidden: true, rows: "" },
    ],
  });
  return extract(data);
}

describe("an Excel timetable reaches the conversation as a grid", () => {
  it("renders each sheet as a pipe table addressed by the spreadsheet's own row numbers and column letters", async () => {
    const text = await timetable();
    // The header names the SPREADSHEET's columns, not a guessed header row — so nothing
    // in the file is promoted to a header it never declared.
    expect(text).toContain("| row | A | B | C | D |");
    expect(text).toContain("| --- | --- | --- | --- | --- |");
    // A GFM table needs a blank line ahead of it. Without one the heading and the merge
    // notice absorb the grid into a paragraph, and the format chosen BECAUSE models read
    // tables well stops being a table.
    expect(text).toContain("\n\n| row | A | B | C | D |");
    expect(tableRow(text, 2)).toBe("| 2 | Woche | Datum | Einstieg | Raum |");
  });

  it("names every sheet with its own name and position, hidden sheets included", async () => {
    const text = await timetable();
    expect(text).toContain('## Sheet 1/2: "Herbstsemester 25"');
    expect(text).toContain('## Sheet 2/2: "Notizen" (hidden)');
    expect(text).toContain("Workbook: 2 sheets.");
  });

  it("an empty cell keeps its column", async () => {
    const text = await timetable();
    // C3 is absent in the file. It has to arrive as an empty POSITION: if it were
    // skipped, "A101" would slide from D into C and every later column with it.
    expect(tableRow(text, 3)).toBe("| 3 | 1 | 2025-09-15 |  | A101 |");
  });

  it("an interior empty row is likewise preserved", async () => {
    const text = await timetable();
    // The file carries no row 6 at all, and row 7 after it. Dropping row 6 would renumber
    // nothing visibly — the rendered rows would simply run 5, 7 — but a reader counting
    // weeks down the column would land one week out, which is the row-wise twin of the
    // column shift above.
    expect(tableRow(text, 6)).toBe("| 6 |  |  |  |  |");
    expect(tableRow(text, 7)).toContain("Semesterende");
  });

  it("a formula cell shows what the lecturer sees, and an unevaluated one shows its formula", async () => {
    const text = await timetable();
    const row = tableRow(text, 4);
    // Cached result wins — that is the value in front of the lecturer in Excel.
    expect(row).toContain("2 Wochen");
    // No cached result: the formula itself, never an empty cell.
    expect(row).toContain("=SUM(A3:A4)");
  });

  it("an Excel error and a boolean stay visible as themselves", async () => {
    const text = await timetable();
    const row = tableRow(text, 5);
    expect(row).toContain("#REF!");
    expect(row).toContain("TRUE");
  });

  it("a date cell is an ISO date, not the serial number", async () => {
    const text = await timetable();
    expect(text).not.toContain("45915");
    expect(tableRow(text, 3)).toContain("2025-09-15");
    // A date-time format keeps its clock.
    expect(tableRow(text, 4)).toContain("2025-09-22 13:30");
  });

  it("a merged heading covers its columns and the merge is declared", async () => {
    const text = await timetable();
    expect(text).toContain("merged: A1:D1");
    // The file stores the title in A1 alone. Unfolded, the row labels all four columns
    // instead of leaving three blanks the model would read as unlabelled.
    expect(tableRow(text, 1)).toBe("| 1 | Stundenplan HS25 | Stundenplan HS25 | Stundenplan HS25 | Stundenplan HS25 |");
  });

  it("a whole-sheet merge is unfolded within the sheet rather than hanging the app", async () => {
    // THE HAZARD: `ref="A1:XFD1048576"` is what Excel writes for one Ctrl+A followed by
    // Merge & Center — an everyday gesture, not a hostile file. Unfolding it cell by cell
    // is ~1.7e10 synchronous Map writes in the main process, so the app hangs with nothing
    // on screen and the lecturer is told nothing: the exact silent failure this module was
    // written against. The sheet below holds cells through D3 and nothing else, so the
    // merge covers 12 positions — everything past them is a declaration, not content.
    const data = await workbook({
      sharedStrings: ["Alles verschmolzen"],
      sheets: [
        {
          name: "Ganzblatt",
          merges: '<mergeCell ref="A1:XFD1048576"/>',
          rows:
            '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>eigen</t></is></c>' +
            '<c r="D2" t="inlineStr"><is><t>rand</t></is></c></row>' +
            '<row r="3"><c r="B3" t="inlineStr"><is><t>mitte</t></is></c></row>',
        },
      ],
    });
    const text = await extract(data);
    // The declaration reports the range AS WRITTEN. That line is what makes the repetition
    // reversible, so it must never report the clamp instead of the file.
    expect(text).toContain("merged: A1:XFD1048576");
    // The grid is the sheet's own: three rows, four columns, and NOT one truncation line —
    // a sheet holding cells through D3 is missing nothing, so a notice here would be the
    // false statement.
    expect(text).not.toContain("[truncated]");
    expect(emittedRows(text)).toHaveLength(3);
    expect(text).toContain("| row | A | B | C | D |");
    // A cell that carries its own value is never overwritten by the merge above it.
    expect(tableRow(text, 2)).toBe("| 2 | eigen | Alles verschmolzen | Alles verschmolzen | rand |");
    expect(tableRow(text, 3)).toBe("| 3 | Alles verschmolzen | mitte | Alles verschmolzen | Alles verschmolzen |");
  });

  it("a merge declared beyond the sheet's cells does not enlarge it", async () => {
    // The ORDINARY case, and the one that matters: selecting column A and hitting Merge &
    // Center writes `ref="A1:A1048576"`. Before the unfold was held to the cells that
    // actually exist, that single formatting gesture made a four-row timetable emit
    // thousands of near-empty rows, spend the whole workbook cell budget and announce a
    // truncation — for a sheet from which nothing was missing.
    const data = await workbook({
      sharedStrings: ["Woche 1"],
      sheets: [
        {
          name: "Spalte",
          merges: '<mergeCell ref="A1:A1048576"/>',
          rows:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Einstieg</t></is></c></row>' +
            '<row r="2"><c r="B2" t="inlineStr"><is><t>Vertiefung</t></is></c></row>' +
            '<row r="3"><c r="B3" t="inlineStr"><is><t>Abschluss</t></is></c></row>',
        },
      ],
    });
    const text = await extract(data);
    expect(text).toContain("merged: A1:A1048576");
    expect(text).not.toContain("[truncated]");
    expect(emittedRows(text)).toHaveLength(3);
    // The merge still does its job inside the sheet: the week label labels all three rows.
    expect(tableRow(text, 2)).toBe("| 2 | Woche 1 | Vertiefung |");
  });

  it("uses the workbook's own epoch when it is the 1904 system", async () => {
    const data = await workbook({
      date1904: true,
      numFmts: '<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>',
      cellXfs: ['<xf numFmtId="0"/>', '<xf numFmtId="164"/>'],
      sheets: [{ name: "Mac", rows: '<row r="1"><c r="A1" s="1"><v>0</v></c></row>' }],
    });
    expect(await extract(data)).toContain("1904-01-01");
  });

  it("a number that is not date-formatted stays a number", async () => {
    const data = await workbook({
      cellXfs: ['<xf numFmtId="0"/>', '<xf numFmtId="2"/>'],
      sheets: [{ name: "Zahlen", rows: '<row r="1"><c r="A1" s="1"><v>45915</v></c></row>' }],
    });
    expect(await extract(data)).toContain("| 1 | 45915 |");
  });
});

// ───────────────────────────── the two size caps ─────────────────────────────

describe("a workbook too large to extract whole says which part is missing", () => {
  it("names the column cut and what the file really holds", async () => {
    const wide = 70;
    const cells = Array.from(
      { length: wide },
      (_, i) => `<c r="${columnLetters(i + 1)}1" t="inlineStr"><is><t>c${i + 1}</t></is></c>`
    ).join("");
    const text = await extract(await workbook({ sheets: [{ name: "Breit", rows: `<row r="1">${cells}</row>` }] }));
    expect(text).toContain(`[truncated] Sheet "Breit": ${wide} columns in the file`);
    expect(text).toContain(`columns A-${columnLetters(MAX_COLUMNS_PER_SHEET)} extracted`);
    expect(text).toContain(`| row | A |`);
    // The cut is real, not only announced.
    expect(text).not.toContain(`c${wide}`);
  });

  it("names the row cut and every sheet the cell budget never reached", async () => {
    // 4000 rows x 4 columns = 16,000 cells against a 10,000-cell budget, so the budget
    // is spent inside the first sheet and the second is never opened.
    const rows = Array.from(
      { length: 4000 },
      (_, r) =>
        `<row r="${r + 1}">` +
        ["A", "B", "C", "D"].map((c) => `<c r="${c}${r + 1}"><v>${r + 1}</v></c>`).join("") +
        `</row>`
    ).join("");
    const text = await extract(
      await workbook({
        sheets: [
          { name: "Gross", rows },
          { name: "Anhang", rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>spaet</t></is></c></row>' },
        ],
      })
    );
    expect(text).toContain('[truncated] Sheet "Gross": 4000 rows in the file');
    expect(text).toContain(`the workbook cell budget (${MAX_CELLS_PER_WORKBOOK} cells) ran out`);
    // The second sheet was never opened — and is NAMED, which is the whole point: a
    // silently half-read workbook reads exactly like a whole one.
    expect(text).toContain("[truncated] Sheets not extracted");
    expect(text).toContain('"Anhang"');
    expect(text).not.toContain("spaet");
  });
});

describe("a workbook with no cells lands on the no-usable-text notice", () => {
  it("yields empty text rather than a page of headings", async () => {
    // The workbook a lecturer produces by pasting a screenshot of the timetable: sheets
    // exist, cells do not. Empty text is what routes it to the app's existing
    // no-usable-text notice instead of accepting content the file does not have.
    const data = await workbook({ sheets: [{ name: "Tabelle1", rows: "" }] });
    const result = await extractText("screenshot.xlsx", data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text.trim()).toBe("");
  });

  it("a file that is not a workbook at all fails rather than pretending", async () => {
    // A `.xlsx` that is a valid zip but carries no workbook part.
    const zip = new JSZip();
    zip.file("readme.txt", "not a workbook");
    const data = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const result = await extractText("kaputt.xlsx", data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("");
  });
});

// ──────────────────────── the named legacy-Excel refusal ─────────────────────

describe("a legacy Excel file is refused by name", () => {
  for (const ext of [".xls", ".xlsb", ".xlsm"]) {
    it(`refuses ${ext} by naming the format and the remedy, not by listing the accepted set`, async () => {
      const result = await extractText(`stundenplan${ext}`, Buffer.from("\xd0\xcf\x11\xe0", "binary"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toBe(en.ingestLegacyExcelFormat({ ext }));
      expect(result.message).toContain(ext);
      expect(result.message).toContain(".xlsx");
      // The generic refusal would list every accepted format; this one must not, or the
      // lecturer is back to inferring that Excel is unsupported.
      expect(result.message).not.toContain(".docx");
      expect(result.message).not.toContain(".pdf");
    });
  }
});
