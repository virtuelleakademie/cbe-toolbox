/**
 * Tests for the material ingestion stub (capability `desktop-app`, Requirement:
 * Material Ingestion Stub into the Chat Context).
 *
 * DOCX/PPTX fixtures are generated in-memory with JSZip — no binary blobs are
 * committed. PDF parsing is exercised in-app (a valid PDF binary is impractical
 * to hand-build in a unit test); the dispatch + the other four formats + the
 * unsupported path are covered here.
 *
 * Scenarios covered:
 *  - Supported document is read into the chat context (txt, md, docx, pptx)
 *  - Unsupported format is reported without crashing
 *  - Stub does not atomize or write to the wiki (the module only returns text;
 *    there is no wiki/atomization code path to exercise)
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractText, extensionToDocType, ingestPaths, SUPPORTED_EXTENSIONS } from "../src/main/ingestion.js";

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  const xml = `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}

async function makePptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((runs, i) => {
    const body = runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    );
  });
  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}

describe("extractText — plaintext / Markdown", () => {
  it("returns the raw UTF-8 text of a .txt file", async () => {
    const r = await extractText("notes.txt", Buffer.from("Hallo Welt\nZeile zwei", "utf8"));
    expect(r).toEqual({ ok: true, text: "Hallo Welt\nZeile zwei" });
  });

  it("returns the raw text of a .md file", async () => {
    const r = await extractText("syllabus.md", Buffer.from("# Titel\n\nInhalt", "utf8"));
    expect(r.ok && r.text).toContain("# Titel");
  });
});

describe("extractText — DOCX", () => {
  it("extracts paragraph text from a .docx", async () => {
    const buf = await makeDocx(["Erstes Lernziel", "Zweites Lernziel"]);
    const r = await extractText("modul.docx", buf);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("Erstes Lernziel");
      expect(r.text).toContain("Zweites Lernziel");
      // paragraph boundary preserved as a newline
      expect(r.text).toBe("Erstes Lernziel\nZweites Lernziel");
    }
  });

  it("decodes XML entities in DOCX runs", async () => {
    const buf = await makeDocx(["Theorie &amp; Praxis"]);
    const r = await extractText("x.docx", buf);
    expect(r.ok && r.text).toBe("Theorie & Praxis");
  });
});

describe("extractText — PPTX", () => {
  it("extracts text from every slide in order", async () => {
    const buf = await makePptx([["Folie eins"], ["Folie zwei", "Bullet"]]);
    const r = await extractText("deck.pptx", buf);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("Folie eins");
      expect(r.text).toContain("Folie zwei");
      expect(r.text.indexOf("Folie eins")).toBeLessThan(r.text.indexOf("Folie zwei"));
    }
  });
});

describe("extractText — unsupported", () => {
  it("reports a non-fatal message naming the supported formats", async () => {
    const r = await extractText("image.png", Buffer.from([0x89, 0x50]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unsupported).toBe(true);
      expect(r.message).toContain(".pdf");
      expect(r.message).toContain("png");
    }
  });

  it("treats a file without an extension as unsupported", async () => {
    const r = await extractText("README", Buffer.from("x"));
    expect(r.ok).toBe(false);
  });

  it("exposes the supported-extension set", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".pdf");
    expect(SUPPORTED_EXTENSIONS).toContain(".docx");
    expect(SUPPORTED_EXTENSIONS).toContain(".pptx");
    expect(SUPPORTED_EXTENSIONS).toContain(".txt");
    expect(SUPPORTED_EXTENSIONS).toContain(".md");
    expect(SUPPORTED_EXTENSIONS).toContain(".csv");
  });
});

/**
 * Scenarios: *A CSV timetable reaches the conversation unchanged* and *A German-Excel
 * CSV keeps its umlauts* (capability `desktop-app`, Requirement: Material Ingestion Stub
 * into the Chat Context).
 *
 * The defect these exist for: the assistant advised converting an Excel timetable to CSV
 * and the app refused the CSV as well. The rule that came out of it is that a CSV is
 * handed over RAW — so what is asserted here is byte-for-byte identity of the rows, not
 * a reformatting.
 */
describe("extractText — CSV", () => {
  it("hands a comma-separated CSV over verbatim", async () => {
    const csv = 'Woche,Thema,Raum\n1,"Einstieg, Ueberblick",A101\n2,Projektstart,B204\n';
    const r = await extractText("stundenplan.csv", Buffer.from(csv, "utf8"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(csv);
  });

  it("hands a semicolon-separated CSV over verbatim too — the delimiter is never interpreted", async () => {
    const csv = "Woche;Thema;Raum\n1;Einstieg;A101\n";
    const r = await extractText("stundenplan.csv", Buffer.from(csv, "utf8"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(csv);
  });

  it('strips a UTF-8 BOM, which Excel\'s "CSV UTF-8" export writes', async () => {
    const csv = "Woche,Thema\n1,Einstieg\n";
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf8")]);
    const r = await extractText("stundenplan.csv", withBom);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(csv);
  });

  it("decodes a Windows-1252 export instead of mangling its umlauts", async () => {
    // A German Excel CSV: semicolon-separated, single-byte encoded. 0xE4/0xFC/0xDF are
    // ae/ue/sz in Windows-1252 and are NOT valid UTF-8, so `toString("utf8")` would
    // replace each of them with U+FFFD.
    const bytes = Buffer.from([
      0x57, 0x6f, 0x63, 0x68, 0x65, 0x3b, 0x54, 0x68, 0x65, 0x6d, 0x61, 0x0a, 0x31, 0x3b, 0x47, 0x65, 0x62, 0xe4, 0x75,
      0x64, 0x65, 0x20, 0x66, 0xfc, 0x72, 0x20, 0x53, 0x70, 0x61, 0x0a,
    ]);
    const r = await extractText("stundenplan.csv", bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe("Woche;Thema\n1;Gebäude für Spa\n");
      expect(r.text).not.toContain("\uFFFD");
    }
  });

  it("leaves a valid UTF-8 file on the UTF-8 branch — the fallback is an either/or, not a sniff", async () => {
    const text = "Woche;Thema\n1;Gebäude für Spätaufsteher\n";
    const r = await extractText("stundenplan.csv", Buffer.from(text, "utf8"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(text);
  });

  it("applies the same decoding to .txt and .md — the defect was never CSV-specific", async () => {
    const bytes = Buffer.from([0x53, 0x70, 0xe4, 0x74]); // "Spät" in Windows-1252
    for (const name of ["notiz.txt", "notiz.md"]) {
      const r = await extractText(name, bytes);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.text).toBe("Spät");
    }
  });
});

describe("extensionToDocType — single derivation site", () => {
  it("maps each supported extension to its doc type (case-insensitive)", () => {
    expect(extensionToDocType("modul.pdf")).toBe("pdf");
    expect(extensionToDocType("modul.docx")).toBe("docx");
    expect(extensionToDocType("deck.PPTX")).toBe("pptx");
    expect(extensionToDocType("notes.txt")).toBe("txt");
    expect(extensionToDocType("syllabus.MD")).toBe("md");
    expect(extensionToDocType("stundenplan.CSV")).toBe("csv");
  });
});

describe("ingestPaths — multiselect batch with per-file isolation", () => {
  // Scenario: A failing file in a multiselect batch does not discard the others
  it("returns per-file outcomes in input order; an unreadable file fails alone", async () => {
    const read = async (filePath: string): Promise<Buffer> => {
      if (filePath.endsWith("kaputt.txt")) throw new Error("EACCES: permission denied");
      return Buffer.from(`content of ${filePath}`, "utf8");
    };
    const outcomes = await ingestPaths(["/mat/a.txt", "/mat/kaputt.txt", "/mat/b.md"], read);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toMatchObject({ ok: true, filename: "a.txt", docType: "txt", text: "content of /mat/a.txt" });
    expect(outcomes[1]).toMatchObject({ ok: false, unsupported: true, filename: "kaputt.txt" });
    expect((outcomes[1] as { message: string }).message).toContain("kaputt.txt");
    expect(outcomes[2]).toMatchObject({ ok: true, filename: "b.md", docType: "md" });
  });

  it("an unsupported extension in the batch yields its own failure outcome carrying the filename", async () => {
    const read = async (): Promise<Buffer> => Buffer.from("x", "utf8");
    const outcomes = await ingestPaths(["/mat/bild.png", "/mat/notes.txt"], read);
    expect(outcomes[0]).toMatchObject({ ok: false, unsupported: true, filename: "bild.png" });
    expect((outcomes[0] as { message: string }).message).toContain("Unsupported format");
    expect(outcomes[1]).toMatchObject({ ok: true, filename: "notes.txt" });
  });
});
