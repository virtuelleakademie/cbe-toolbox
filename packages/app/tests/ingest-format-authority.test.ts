/**
 * The accepted-format list has exactly one owner, and every surface derives from it
 * (capability `desktop-app`, Requirement: *Material Ingestion Stub into the Chat
 * Context*; capability `agent-harness`, Requirement: *Environment Descriptor for the
 * Skill*; capability `lecturer-wiki`, Requirement: *Ingestion of Existing Teaching
 * Materials*).
 *
 * WHAT WENT WRONG, and what this file therefore has to prove. A lecturer tried to
 * upload an Excel timetable; the assistant suggested converting it to CSV; the app
 * refused the CSV too. Two independent halves: CSV was not accepted, and NOTHING told
 * the model which formats were. So a green `toContain(".csv")` is not enough — the
 * property that matters is that the four surfaces which name the set (tooltip, OS
 * dialog filter, refusal message, environment descriptor) cannot drift apart, and that
 * nothing can be advertised without extraction behind it.
 *
 * Scenario mapping:
 *  - *Every named surface derives the accepted-format list from one owner* → the
 *    identity lock plus the two source sweeps below.
 *  - *The descriptor names the formats ingestion accepts* / *A host without ingestion
 *    is told nothing about formats* → the descriptor block assertions.
 *  - *An accepted extension always has an extractor behind it* → the dispatch sweep.
 *  - *A CSV reaches the raw layer through the same one extractor* → the wiki-path test,
 *    which is what proves BOTH entry points are covered by construction.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SUPPORTED_EXTENSIONS as SHARED_EXTENSIONS,
  ingestExtensionList,
  ingestFormatNames,
} from "@cbe/pi-bridge/ingest-formats";
import { buildEnvironmentDescriptor } from "@cbe/pi-bridge";
import { extensionToDocType, extractText, ingestPaths, SUPPORTED_EXTENSIONS } from "../src/main/ingestion.js";
import { extractorId, ingestIntoCourse } from "../src/main/wiki-store.js";
import { en } from "../src/shared/i18n/en.js";
import { LANGUAGES, stringsFor } from "../src/shared/i18n/index.js";

/**
 * Locate the checkout by walking up until a landmark file is there. The working
 * directory differs between `npm test` and a direct `vitest --root` invocation, and
 * jsdom's `import.meta.url` is not a file URL — a source sweep that silently reads
 * nothing would be worse than no sweep, so this throws rather than resolving to a
 * plausible wrong path.
 */
function repoRoot(): string {
  const landmark = path.join("packages", "pi-bridge", "src", "environment.ts");
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, landmark))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`repo root not found above ${process.cwd()}`);
    dir = parent;
  }
}

const REPO_ROOT = repoRoot();
const ENVIRONMENT_TS = path.join(REPO_ROOT, "packages", "pi-bridge", "src", "environment.ts");
const INGESTION_TS = path.join(REPO_ROOT, "packages", "app", "src", "main", "ingestion.ts");
const IPC_TS = path.join(REPO_ROOT, "packages", "app", "src", "main", "ipc.ts");
const CHAT_UI_REGISTRY = path.join(
  REPO_ROOT,
  "packages",
  "app",
  "src",
  "renderer",
  "components",
  "ChatPanel.ui-registry.ts"
);

describe("one owner for the accepted-format set", () => {
  // The strongest form available: IDENTITY, not deep equality. A hand-maintained copy
  // in `main/ingestion.ts` could satisfy `toEqual` while drifting on the next edit;
  // only a re-export satisfies `toBe`.
  it("the app's SUPPORTED_EXTENSIONS is the shared declaration itself, not a copy", () => {
    expect(SUPPORTED_EXTENSIONS).toBe(SHARED_EXTENSIONS);
  });

  it("CSV is in the set — the format the assistant recommended and the app refused", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".csv");
  });

  // XLSX was the standing trap: it is what the lecturer actually held, and adding it
  // without an extractor would have made the app advertise a format that yields nothing.
  // It is in the set now, and the assertion that matters is the second half of that
  // sentence — the sweep below proves the extractor is really there.
  it("XLSX is in the set — the format the lecturer actually held", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".xlsx");
  });

  // The variant Excel extensions are the new standing trap: `.xlsm` would PARSE (it is
  // the same OOXML container), so nothing but this assertion keeps it out of a set the
  // OS dialog and the model both read as an invitation.
  it("the legacy and variant Excel extensions stay out of the set", () => {
    for (const ext of [".xls", ".xlsb", ".xlsm"]) expect(SUPPORTED_EXTENSIONS).not.toContain(ext);
  });

  it("every accepted extension is dispatched by the extractor and carries a doc type", () => {
    const dispatch = readFileSync(INGESTION_TS, "utf8");
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(dispatch, `extractText has no case for ${ext}`).toContain(`case "${ext}":`);
      expect(() => extensionToDocType(`material${ext}`), `no doc type for ${ext}`).not.toThrow();
    }
  });
});

describe("the model is told which formats the app accepts", () => {
  // Scenario: *The descriptor names the formats ingestion accepts*.
  it("the app-profile descriptor reports the accepted formats, rendered from the declaration", () => {
    const block = buildEnvironmentDescriptor({ profile: "app" }).toSystemPromptBlock();
    expect(block).toContain(`ingest formats: ${ingestExtensionList()}`);
    for (const ext of SUPPORTED_EXTENSIONS) expect(block).toContain(ext);
  });

  // Scenario: *A host without ingestion is told nothing about formats*. Byte identity
  // against a rendering with the line's gate off is the only assertion that proves the
  // headless descriptor did not merely lose the words but the whole line.
  it("a host without the ingestion affordance carries no format line at all", () => {
    const headless = buildEnvironmentDescriptor({ profile: "headless" }).toSystemPromptBlock();
    expect(headless).not.toContain("ingest formats:");
    expect(headless).not.toContain(".docx");
    const overridden = buildEnvironmentDescriptor({
      profile: "headless",
      affordances: { ingestion: true },
    }).toSystemPromptBlock();
    expect(overridden).toContain("ingest formats:");
  });

  // The descriptor is REPORTED STATE, not a rule channel. Its named reader is the
  // identity prompt's conduct floor ("Never offer a control, feature or capability the
  // environment has not reported"), so this line must not carry an instruction of its
  // own — see `packages/pi-bridge/tests/` for the requirement-level guard on that.
  it("the format line states a fact and gives no instruction", () => {
    const block = buildEnvironmentDescriptor({ profile: "app" }).toSystemPromptBlock();
    const line = block.split("\n").find((l) => l.startsWith("ingest formats:"))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\b(MUST|never|do not|always)\b/i);
  });
});

describe("no surface holds a hand-written copy of the list", () => {
  /** The extension tokens a drifting copy would have to spell out. */
  const EXTENSION_LITERALS = SUPPORTED_EXTENSIONS.map((e) => e.slice(1));

  // The descriptor's own source: if the list were spelled out in the renderer, adding a
  // format to the declaration would silently stop reaching the model — the exact defect.
  // Scoped to the rendering function, so an unrelated `.md` elsewhere in the module
  // neither passes nor fails this on accident.
  it("the descriptor renders the list from the declaration and spells out no format", () => {
    const src = readFileSync(ENVIRONMENT_TS, "utf8");
    const start = src.indexOf("function ingestFormatsLines(");
    expect(start, "ingestFormatsLines not found in environment.ts").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toContain("ingestExtensionList()");
    for (const bare of EXTENSION_LITERALS) {
      expect(body, `the descriptor renderer spells out "${bare}"`).not.toMatch(new RegExp(bare, "i"));
    }
  });

  // The lecturer-facing tooltip: parameterised in EVERY shipped language, so a format
  // can never be added for the model and forgotten for the lecturer. Asserted on what
  // the entry RENDERS, not on its source line: a source-line sweep goes red for the
  // wrong reason as soon as prettier wraps the entry (the English one is already 115
  // characters against a printWidth of 120), and a longer language would wrap sooner.
  it("no chrome catalogue hard-codes the format list, in any shipped language", () => {
    for (const code of Object.keys(LANGUAGES)) {
      const rendered = stringsFor(code).chatIngestFormatsHint({ formats: "SENTINEL-FORMATS" });
      expect(rendered, `${code} drops the formats it is handed`).toContain("SENTINEL-FORMATS");
      // Nothing of the real list may survive when the entry is handed a sentinel.
      for (const ext of SUPPORTED_EXTENSIONS) {
        expect(rendered, `${code} hard-codes "${ext}"`).not.toMatch(new RegExp(ext.slice(1), "i"));
      }
    }
  });

  it("the tooltip renders every accepted format when fed from the declaration", () => {
    const hint = en.chatIngestFormatsHint({ formats: ingestFormatNames() });
    for (const ext of SUPPORTED_EXTENSIONS) expect(hint).toContain(ext.slice(1).toUpperCase());
  });

  // The OS file dialogs are the fourth surface the scenario names, and the one no
  // behavioural test can reach (they are Electron `showOpenDialog` calls). Both of
  // them — the composer's ingest and the wiki's — must derive from the declaration:
  // swapping either `SUPPORTED_EXTENSIONS.map(...)` for a literal array would
  // otherwise leave every test in this repository green.
  it("both OS file-dialog filters derive from the declaration", () => {
    const src = readFileSync(IPC_TS, "utf8");
    const filters = src.split("\n").filter((l) => l.includes("mainIngestFilterMaterial"));
    // One for the composer ingest, one for the wiki ingest.
    expect(filters, "expected exactly two ingest file-dialog filters").toHaveLength(2);
    for (const line of filters) {
      expect(line, "a file-dialog filter does not derive from SUPPORTED_EXTENSIONS").toContain(
        "SUPPORTED_EXTENSIONS.map("
      );
      for (const ext of SUPPORTED_EXTENSIONS) {
        expect(line, `a file-dialog filter spells out "${ext}"`).not.toMatch(new RegExp(ext.slice(1), "i"));
      }
    }
  });

  // The app-UI registry entry was the third copy. It is help-turn-only and the
  // descriptor now carries the same fact on every turn, so it was removed rather than
  // derived — this pins that it does not creep back.
  it("the app-UI registry entry does not name formats", () => {
    const src = readFileSync(CHAT_UI_REGISTRY, "utf8");
    const entry = src.slice(src.indexOf('id: "material-upload"'), src.indexOf('id: "new-session"'));
    const prose = entry
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(prose).not.toMatch(/PDF|DOCX|PPTX/i);
  });
});

describe("the refusal names what does work", () => {
  // Scenario: *Unsupported format is reported without crashing*. The message is the
  // lecturer's only signpost after a refusal, so it names the accepted set — and takes
  // it from the same declaration, which is why CSV and XLSX appear there with no edit of
  // their own.
  it("an unsupported file is refused with the full accepted set", async () => {
    const r = await extractText("stundenplan.numbers", Buffer.from("PK"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(".numbers");
      for (const ext of SUPPORTED_EXTENSIONS) expect(r.message).toContain(ext);
    }
  });

  // Scenario: *A legacy Excel file is refused by name*. The generic message above lists
  // `.xlsx`, so an `.xls` refused THAT way reads as "Excel is unsupported" — which is
  // the whole reason this branch exists. Detail and the four-language wording live in
  // `xlsx-extraction.test.ts`; what belongs here is that the two refusals are distinct.
  it("a legacy Excel file is not swept into the generic refusal", async () => {
    const legacy = await extractText("stundenplan.xls", Buffer.from("\xd0\xcf", "binary"));
    const generic = await extractText("stundenplan.numbers", Buffer.from("PK"));
    expect(legacy.ok).toBe(false);
    expect(generic.ok).toBe(false);
    if (legacy.ok || generic.ok) return;
    expect(legacy.message).not.toBe(generic.message);
    expect(legacy.message).toContain(".xlsx");
    expect(legacy.message).not.toContain(".pdf");
  });
});

describe("both entry points carry a new format without a second edit", () => {
  let courseDir: string;

  beforeEach(async () => {
    courseDir = await mkdtemp(path.join(tmpdir(), "cbe-ingest-format-"));
  });
  afterEach(async () => {
    await rm(courseDir, { recursive: true, force: true });
  });

  const CSV = "Woche;Thema;Raum\n1;Einstieg;A101\n2;Projektstart;B204\n";

  /** The smallest real `.xlsx`: one sheet, two rows, an inline string and a number. */
  async function timetableXlsx(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="HS25" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      "<worksheet><sheetData>" +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Woche</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t>Raum</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>A101</t></is></c></row>' +
        "</sheetData></worksheet>"
    );
    return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  }

  // Entry point 1 — the composer.
  it("a CSV reaches the conversation through the composer path", async () => {
    const outcomes = await ingestPaths(["/mat/stundenplan.csv"], async () => Buffer.from(CSV, "utf8"));
    expect(outcomes[0]).toMatchObject({ ok: true, filename: "stundenplan.csv", docType: "csv", text: CSV });
  });

  // Entry point 2 — the Lecturer's Wiki. `RAW_EXTRACTION_AUTHORITY = extractText`, so
  // this needed no wiki-side edit at all; the assertion is what proves that claim
  // rather than asserting it in a comment.
  it("a CSV reaches the raw layer through the wiki path, unchanged", async () => {
    const outcomes = await ingestIntoCourse(
      courseDir,
      [{ filename: "stundenplan.csv", data: Buffer.from(CSV, "utf8") }],
      {
        extractor: extractorId("0.0.0-test"),
      }
    );
    expect(outcomes[0]).toMatchObject({ ok: true, rawRelPath: "raw/stundenplan.md" });
    const raw = await readFile(path.join(courseDir, "raw", "stundenplan.md"), "utf8");
    expect(raw).toContain(CSV.trimEnd());
    expect(raw).toContain('source: "stundenplan.csv"');
    // The original is kept byte-for-byte in the immutable inbox layer.
    const inbox = await readFile(path.join(courseDir, "inbox", "stundenplan.csv"), "utf8");
    expect(inbox).toBe(CSV);
  });

  // The format the lecturer actually held. Entry point 1 — the composer.
  it("an XLSX reaches the conversation through the composer path, as a grid", async () => {
    const data = await timetableXlsx();
    const outcomes = await ingestPaths(["/mat/stundenplan.xlsx"], async () => data);
    expect(outcomes[0]).toMatchObject({ ok: true, filename: "stundenplan.xlsx", docType: "xlsx" });
    const text = (outcomes[0] as { text: string }).text;
    expect(text).toContain('## Sheet 1/1: "HS25"');
    expect(text).toContain("| row | A | B |");
    expect(text).toContain("| 2 | 1 | A101 |");
  });

  // Entry point 2 — the Lecturer's Wiki. `RAW_EXTRACTION_AUTHORITY = extractText`, so a
  // new format needs no wiki-side edit at all; this asserts that claim rather than
  // restating it in a comment. Scenario: *An XLSX reaches the raw layer with its grid
  // intact*.
  it("an XLSX reaches the raw layer through the wiki path, with its grid intact", async () => {
    const data = await timetableXlsx();
    const outcomes = await ingestIntoCourse(courseDir, [{ filename: "stundenplan.xlsx", data }], {
      extractor: extractorId("0.0.0-test"),
    });
    expect(outcomes[0]).toMatchObject({ ok: true, rawRelPath: "raw/stundenplan.md" });
    const raw = await readFile(path.join(courseDir, "raw", "stundenplan.md"), "utf8");
    expect(raw).toContain('## Sheet 1/1: "HS25"');
    expect(raw).toContain("| 2 | 1 | A101 |");
    expect(raw).toContain('source: "stundenplan.xlsx"');
    // The workbook itself is kept byte-for-byte in the immutable inbox layer.
    const inbox = await readFile(path.join(courseDir, "inbox", "stundenplan.xlsx"));
    expect(inbox.equals(data)).toBe(true);
  });
});
