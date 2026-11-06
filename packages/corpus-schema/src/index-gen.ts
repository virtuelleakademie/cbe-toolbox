import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { validateDirectory } from "./validate.js";
import type { CorpusDocument } from "./schema.js";

export interface CorpusIndex {
  // The corpus is purely versioned content. `corpus-version` (YYYY-MM) is the
  // authoritative currency of the loaded corpus; the skill surfaces it once per
  // session. There is no `corpus-track` and no per-document authority state.
  // See `corpus-curation` Requirement: Versioned corpus artifact.
  "corpus-version": string;
  generated: string;
  generator: string;
  "document-count": number;
  categories: Record<string, number>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    version: string;
    path: string;
    tags: string[];
    "short-description": string;
  }>;
}

export interface GenerateIndexOptions {
  /** Base directory the manifest `path` fields are written relative to.
   * Defaults to the directory containing the written manifest (`outFile`) — the
   * corpus root — so paths are corpus-root-relative (`methodology/…`, never
   * `corpus/methodology/…`) and consumers resolve `<corpus base>/<path>` without
   * compensation. See `corpus-curation` Requirement: Index manifest with
   * retrieval-ready metadata, Scenario: Manifest paths resolve against the corpus root. */
  pathsRelativeTo?: string;
  /** The corpus version (`YYYY-MM`) to stamp into the manifest. When omitted the
   * generator reads the newest `## YYYY-MM` heading from `<root>/CHANGELOG.md`,
   * and as a last resort derives it from the newest document `updated` month. */
  corpusVersion?: string;
}

const CORPUS_VERSION_RE = /^\d{4}-\d{2}$/;

/** Read the newest corpus version from `<root>/CHANGELOG.md` — the first
 * `## YYYY-MM` (optionally bracketed) heading. Returns null when absent. */
export async function readChangelogVersion(root: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+\[?(\d{4}-\d{2})\]?/);
    if (m && m[1]) return m[1];
  }
  return null;
}

export const SHORT_DESCRIPTION_MAX = 200;

/**
 * Derive a manifest short-description for a document.
 *
 * Priority: frontmatter `short-description:` override → first sentence of the
 * `## Summary` body block → null (caller MUST treat null as a hard error and
 * fail index generation; the manifest is what Stage-1 corpus retrieval reads,
 * and a document with no short-description silently degrades Stage-1 to a
 * tag/title pattern-match — covered by `corpus-curation` Requirement: Index
 * manifest with retrieval-ready metadata, Scenario: Missing short-description
 * fails validation.
 */
export function deriveShortDescription(doc: CorpusDocument, body: string): string | null {
  const override = doc["short-description"]?.trim();
  if (override && override.length > 0) {
    return override.length <= SHORT_DESCRIPTION_MAX ? override : override.slice(0, SHORT_DESCRIPTION_MAX);
  }
  const summary = extractSummaryBlock(body);
  if (!summary) return null;
  const sentence = firstSentence(summary);
  if (!sentence) return null;
  const stripped = stripMarkdownInline(sentence).trim();
  if (stripped.length === 0) return null;
  return stripped.length <= SHORT_DESCRIPTION_MAX ? stripped : stripped.slice(0, SHORT_DESCRIPTION_MAX);
}

function extractSummaryBlock(body: string): string | null {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^##\s+Summary\s*$/i.test(line)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const paragraph: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s+/.test(line)) break; // next heading ends the block
    if (line.trim().length === 0) {
      if (paragraph.length > 0) break; // first paragraph captured
      continue;
    }
    paragraph.push(line.trim());
  }
  const text = paragraph.join(" ").trim();
  return text.length > 0 ? text : null;
}

function firstSentence(text: string): string | null {
  // End at the first '.', '!' or '?' that is followed by whitespace + an
  // uppercase letter (next sentence) OR end-of-string. Avoids splitting on
  // abbreviations like "vs.", "e.g.", "z.B." that are followed by a lowercase
  // word.
  const match = text.match(/^(.+?[.!?])(?=\s+[A-ZÄÖÜ]|\s*$)/);
  if (match && match[1]) return match[1];
  return text.length > 0 ? text : null;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ");
}

export async function generateIndex(
  corpusDir: string,
  outFile: string,
  opts: GenerateIndexOptions = {}
): Promise<CorpusIndex> {
  const root = opts.pathsRelativeTo ?? path.dirname(path.resolve(outFile));
  const results = await validateDirectory(corpusDir);
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const detail = failures
      .map((f) => `${f.path}:\n  - ${(f as { errors: string[] }).errors.join("\n  - ")}`)
      .join("\n");
    throw new Error(`Cannot generate index: ${failures.length} file(s) fail validation:\n${detail}`);
  }
  const docs = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);

  const derived = docs.map((d) => ({ d, short: deriveShortDescription(d.doc, d.body) }));
  const missing = derived.filter((x) => x.short === null);
  if (missing.length > 0) {
    const detail = missing
      .map(
        (x) =>
          `${x.d.path}:\n  - no short-description: add a frontmatter \`short-description:\` field, or a \`## Summary\` block whose first sentence is suitable for Stage-1 corpus retrieval`
      )
      .join("\n");
    throw new Error(`Cannot generate index: ${missing.length} document(s) lack a short-description:\n${detail}`);
  }

  const categories: Record<string, number> = {};
  for (const d of docs) categories[d.doc.category] = (categories[d.doc.category] ?? 0) + 1;
  const latestUpdatedMonth =
    docs.length === 0
      ? new Date().toISOString().slice(0, 7)
      : docs
          .map((d) => d.doc.updated)
          .sort()
          .at(-1)!
          .slice(0, 7);
  const generated =
    docs.length === 0
      ? new Date().toISOString().slice(0, 10)
      : docs
          .map((d) => d.doc.updated)
          .sort()
          .at(-1)!;
  // corpus-version source of truth: explicit option → CHANGELOG.md top heading →
  // newest document `updated` month (fallback).
  const corpusVersion = opts.corpusVersion ?? (await readChangelogVersion(root)) ?? latestUpdatedMonth;
  if (!CORPUS_VERSION_RE.test(corpusVersion)) {
    throw new Error(`Cannot generate index: corpus-version "${corpusVersion}" is not in YYYY-MM form`);
  }
  const index: CorpusIndex = {
    "corpus-version": corpusVersion,
    generated,
    generator: "cbe-corpus-cli@0.1.0",
    "document-count": docs.length,
    categories,
    documents: derived.map(({ d, short }) => ({
      id: d.doc.id,
      title: d.doc.title,
      category: d.doc.category,
      version: d.doc.version,
      path: path.relative(root, d.path).replace(/\\/g, "/"),
      tags: d.doc.tags,
      "short-description": short as string,
    })),
  };
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}
