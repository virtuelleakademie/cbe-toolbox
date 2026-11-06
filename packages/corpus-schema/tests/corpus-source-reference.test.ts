// capability `corpus-curation`, Requirement: Corpus Sources and References Are Distinct.
// Reads the governed corpus itself, so a document that slips a licence note into its
// References, adds a "Further reading" list, or promotes a discussed work into
// `sources[]` fails here rather than in review.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";

const corpusRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "corpus");
const contentRoot = path.join(corpusRoot, "content");

// A licence annotation in a References entry: a parenthesised licence label, or an
// explicit licence/rights field. Kept narrow on purpose so plain bibliographic text
// (titles, publishers, URLs) never trips it.
const LICENCE_ANNOTATION =
  /\((?:CC[ -]?BY[^)]*|CC0|public[- ]domain[^)]*|fair[- ]use[^)]*|MIT|©[^)]*)\)|\blicen[cs]e\s*:|\brights\s*:/iu;

async function documents(): Promise<Array<{ file: string; text: string }>> {
  const out: Array<{ file: string; text: string }> = [];
  for (const category of await fs.readdir(contentRoot)) {
    for (const name of (await fs.readdir(path.join(contentRoot, category))).sort()) {
      if (!name.endsWith(".md")) continue;
      const file = path.join(category, name);
      out.push({ file, text: await fs.readFile(path.join(contentRoot, file), "utf8") });
    }
  }
  return out;
}

function section(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /u.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function sourcesOf(text: string): Array<{ author: string; license: string }> {
  const { data } = matter(text);
  return (data as { sources: Array<{ author: string; license: string }> }).sources;
}

describe("corpus Sources and References are distinct", () => {
  it("strips licence annotations from References while sources keep their license", async () => {
    const docs = await documents();
    let referenceSections = 0;
    for (const { file, text } of docs) {
      for (const source of sourcesOf(text)) expect(source.license, `${file} sources[].license`).toBeTruthy();
      const references = section(text, "References");
      if (references === null) continue;
      referenceSections += 1;
      for (const entry of references.split("\n").filter((line) => line.trim().length > 0)) {
        expect(LICENCE_ANNOTATION.exec(entry)?.[0] ?? null, `${file}: ${entry}`).toBeNull();
      }
    }
    expect(referenceSections).toBeGreaterThan(0);
  });

  it("lists a discussed work as a reference, not a source", async () => {
    const text = await fs.readFile(
      path.join(contentRoot, "foundations", "foundations-001-experiential-learning-roots.md"),
      "utf8"
    );
    expect(sourcesOf(text).map((source) => source.author)).toEqual(["Nichols, M., Cator, K., and Torres, M."]);
    const references = section(text, "References") ?? "";
    for (const work of [
      "Nichols, M., Cator, K., and Torres, M. (2016)",
      "Dewey, J. (1938)",
      "Kolb, D. A. (1984)",
      "Vygotsky, L. S. (1978)",
    ]) {
      expect(references, work).toContain(work);
    }
  });

  it("lists the CBL Guide and the PIONEER document as the sources of methodology-012", async () => {
    const text = await fs.readFile(
      path.join(contentRoot, "methodology", "methodology-012-ten-step-module-design-flow.md"),
      "utf8"
    );
    expect(sourcesOf(text).map((source) => source.author)).toEqual([
      "PIONEER Project Team",
      "Nichols, M., Cator, K., and Torres, M.",
    ]);
    expect(text).not.toMatch(/^## Source discipline$/mu);
  });

  it("carries no further-reading section", async () => {
    for (const { file, text } of await documents()) {
      expect(/^#{1,6}\s*further reading\b/imu.test(text), file).toBe(false);
    }
  });

  it("leaves the retired foundations-004 out of the corpus and its index", async () => {
    const docs = await documents();
    expect(docs.some(({ file }) => path.basename(file).startsWith("foundations-004"))).toBe(false);
    for (const { file, text } of docs) expect(text, file).not.toContain("foundations-004");
    const index = await fs.readFile(path.join(corpusRoot, "index.json"), "utf8");
    expect(index).not.toContain("foundations-004");
    expect(index).not.toContain("Intelligent Tutoring");
  });
});
