/**
 * Tests for the three-layer wiki store (capability `lecturer-wiki`,
 * Requirement: Three-Layer Store — inbox, raw, wiki).
 *
 * Scenario mapping:
 *  - "Ingested PDF lands in all three layers" → pipeline test with a minimal PDF
 *    (inbox original + raw extraction with provenance; the wiki layer is the
 *    atomization workflow's job and is asserted at its integration site).
 *  - "Raw layer is regenerable from inbox" → delete raw, re-extract, equivalent.
 *  - "Wiki extraction and stub extraction share one implementation" → identity
 *    lock on the extraction authority.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import matter from "gray-matter";
import { extractText } from "../src/main/ingestion.js";
import {
  RAW_EXTRACTION_AUTHORITY,
  extractorId,
  extractToRaw,
  ingestIntoCourse,
  listPendingRaws,
  listRawFiles,
  rawPathForInbox,
  readRawProvenance,
  setRawStatus,
  storeInInbox,
} from "../src/main/wiki-store.js";

let courseDir: string;

beforeEach(async () => {
  courseDir = await mkdtemp(path.join(tmpdir(), "cbe-wiki-store-"));
});

afterEach(async () => {
  await rm(courseDir, { recursive: true, force: true });
});

const EXTRACTOR = extractorId("0.1.2-test");

/** Minimal single-page PDF carrying one text run — enough for pdfjs. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj + "\n";
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function docxWith(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("lecturer-wiki: Three-Layer Store — inbox, raw, wiki", () => {
  it("ingested PDF lands in all three layers (inbox original + raw extraction with provenance)", async () => {
    const pdf = minimalPdf("Kognitive Last");
    const [outcome] = await ingestIntoCourse(courseDir, [{ filename: "skript.pdf", data: pdf }], {
      extractor: EXTRACTOR,
    });
    expect(outcome).toMatchObject({ ok: true, inboxRelPath: "inbox/skript.pdf", rawRelPath: "raw/skript.md" });

    // Inbox holds the original byte-for-byte.
    const stored = await readFile(path.join(courseDir, "inbox/skript.pdf"));
    expect(stored.equals(pdf)).toBe(true);

    // Raw carries the extraction plus full provenance frontmatter.
    const raw = await readFile(path.join(courseDir, "raw/skript.md"), "utf8");
    const parsed = matter(raw);
    expect(parsed.data.source).toBe("skript.pdf");
    expect(parsed.data.extracted_from).toBe("inbox/skript.pdf");
    expect(parsed.data.extractor).toBe(EXTRACTOR);
    expect(parsed.data.status).toBe("raw");
    expect(String(parsed.data.captured)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.content).toContain("Kognitive Last");
  });

  it("DOCX is processed with identical pipeline behaviour", async () => {
    const [outcome] = await ingestIntoCourse(
      courseDir,
      [{ filename: "modul.docx", data: await docxWith("Constructive Alignment") }],
      { extractor: EXTRACTOR }
    );
    expect(outcome!.ok).toBe(true);
    const raw = await readFile(path.join(courseDir, "raw/modul.md"), "utf8");
    expect(raw).toContain("Constructive Alignment");
  });

  it("raw layer is regenerable from inbox", async () => {
    const inboxRel = await storeInInbox(courseDir, "notes.md", Buffer.from("# Thema\n\nInhalt A", "utf8"));
    const first = await extractToRaw(courseDir, inboxRel, { extractor: EXTRACTOR, capturedDate: "2026-07-07" });
    expect(first.ok).toBe(true);
    const firstContent = await readFile(path.join(courseDir, "raw/notes.md"), "utf8");

    // Delete raw and re-extract from the untouched inbox original.
    await unlink(path.join(courseDir, "raw/notes.md"));
    const second = await extractToRaw(courseDir, inboxRel, { extractor: EXTRACTOR, capturedDate: "2026-07-07" });
    expect(second.ok).toBe(true);
    const secondContent = await readFile(path.join(courseDir, "raw/notes.md"), "utf8");
    expect(secondContent).toBe(firstContent);
  });

  it("wiki extraction and stub extraction share one implementation", () => {
    // The raw layer's extraction authority IS the ingestion stub's extractText —
    // one module, no second implementation that could drift (design.md D3).
    expect(RAW_EXTRACTION_AUTHORITY).toBe(extractText);
  });

  it("inbox is append-only: a name collision never overwrites the earlier original", async () => {
    const a = await storeInInbox(courseDir, "skript.pdf", Buffer.from("first"));
    const b = await storeInInbox(courseDir, "skript.pdf", Buffer.from("second"));
    expect(a).toBe("inbox/skript.pdf");
    expect(b).toBe("inbox/skript-2.pdf");
    expect((await readFile(path.join(courseDir, "inbox/skript.pdf"))).toString()).toBe("first");
    expect((await readFile(path.join(courseDir, "inbox/skript-2.pdf"))).toString()).toBe("second");
    expect(rawPathForInbox(b)).toBe("raw/skript-2.md");
  });

  it("status transition raw → compiled preserves body and other frontmatter byte-for-byte", async () => {
    const inboxRel = await storeInInbox(courseDir, "thema.md", Buffer.from("## Abschnitt\n\nText", "utf8"));
    await extractToRaw(courseDir, inboxRel, { extractor: EXTRACTOR, capturedDate: "2026-07-07" });
    const before = await readFile(path.join(courseDir, "raw/thema.md"), "utf8");

    await setRawStatus(courseDir, "raw/thema.md", "compiled");
    const after = await readFile(path.join(courseDir, "raw/thema.md"), "utf8");
    expect(after).toBe(before.replace("status: raw", "status: compiled"));

    const prov = await readRawProvenance(courseDir, "raw/thema.md");
    expect(prov?.status).toBe("compiled");
    expect(await listPendingRaws(courseDir)).toEqual([]);
    expect((await listRawFiles(courseDir)).map((r) => r.relPath)).toEqual(["raw/thema.md"]);
  });

  it("a failing file in a batch does not discard the others", async () => {
    const outcomes = await ingestIntoCourse(
      courseDir,
      [
        { filename: "gut.md", data: Buffer.from("ok", "utf8") },
        { filename: "bild.png", data: Buffer.from([0x89, 0x50]) },
      ],
      { extractor: EXTRACTOR }
    );
    expect(outcomes[0]!.ok).toBe(true);
    expect(outcomes[1]!.ok).toBe(false);
    // The unsupported original is still inboxed? No — a failed extraction keeps the
    // original OUT of raw/, and the inbox keeps what was stored before the failure.
    const rawEntries = await readdir(path.join(courseDir, "raw")).catch(() => []);
    expect(rawEntries).toEqual(["gut.md"]);
  });
});

// lecturer-wiki, Requirement: Reflection Logs per Atomization and Session —
// Scenario: Reflection log after atomization; and Requirement: Atomization
// Implementation via Existing Wiki Skill — Scenario: Wiki-skill version
// recorded in the reflection log.
describe("reflection logs", () => {
  it("reflection log after atomization records date, skill version, and decision summary", async () => {
    const { writeReflectionLog } = await import("../src/main/wiki-store.js");
    const file = await writeReflectionLog(courseDir, {
      date: "2026-07-07",
      rawRelPath: "raw/skript.md",
      skillVersion: "0.1.0",
      status: "done",
      summary: "Created 3 atoms; merged 1 into cognitive-load.",
      atoms: ["concept/cognitive-load.md"],
    });
    expect(file).toContain(path.join("reflections", "2026-07-07-atomization-skript.md"));
    const content = await readFile(file, "utf8");
    expect(content).toContain('wiki-skill-version: "0.1.0"');
    expect(content).toContain("Created 3 atoms");
    expect(content).toContain("- concept/cognitive-load.md");
    expect(content).toContain("lecturer annotations");
  });

  it("a retried run never overwrites an earlier reflection log", async () => {
    const { writeReflectionLog } = await import("../src/main/wiki-store.js");
    const entry = {
      date: "2026-07-07",
      rawRelPath: "raw/skript.md",
      skillVersion: "0.1.0",
      status: "failed" as const,
      summary: "",
      atoms: [],
      error: "provider exploded",
    };
    const first = await writeReflectionLog(courseDir, entry);
    const second = await writeReflectionLog(courseDir, entry);
    expect(second).not.toBe(first);
    expect(await readFile(first, "utf8")).toContain("provider exploded");
  });
});
