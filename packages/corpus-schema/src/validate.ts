import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
  CorpusDocumentSchema,
  WikiAtomSchema,
  droppedRelatedEntries,
  type CorpusDocument,
  type SchemaVariant,
  type WikiAtom,
} from "./schema.js";

export type ValidateResultFor<TDoc> =
  | { ok: true; path: string; doc: TDoc; body: string; notices: string[] }
  | { ok: false; path: string; errors: string[] };

export type ValidateResult = ValidateResultFor<CorpusDocument | WikiAtom>;

/**
 * Wiki-Corpus isolation invariant (capability `corpus-curation` AND
 * `lecturer-wiki`, Requirement: Wiki-Corpus Isolation Invariant): the two
 * stores are siblings — no data-layer cross-references in either direction.
 * Cross-references live ONLY in generated artifacts (chat turns, canvas docs).
 *
 * Enforced here per variant:
 *  - corpus documents must not carry `(wiki:…)` body tokens or `wiki-*`
 *    frontmatter keys;
 *  - wiki atoms must not carry `(corpus:…)` body tokens or `corpus-*`
 *    frontmatter keys.
 *
 * Wiki-internal `[[wikilinks]]` — including cross-course ones — are NOT an
 * isolation violation; the invariant constrains wiki↔corpus only.
 */
function isolationErrors(variant: SchemaVariant, data: Record<string, unknown>, body: string): string[] {
  const errors: string[] = [];
  const foreign = variant === "corpus" ? "wiki" : "corpus";
  const keyRe = new RegExp(`^${foreign}[-_]`, "i");
  for (const key of Object.keys(data)) {
    if (keyRe.test(key)) {
      errors.push(
        `${key}: isolation invariant — a ${variant === "corpus" ? "corpus document" : "wiki atom"} must not carry ` +
          `${foreign}-store references in its frontmatter (Wiki-Corpus Isolation Invariant); ` +
          `cross-store references live only in generated artifacts`
      );
    }
  }
  const tokenRe = new RegExp(`\\(${foreign}:`);
  if (tokenRe.test(body)) {
    errors.push(
      `<body>: isolation invariant — \`(${foreign}:…)\` citation tokens are not allowed inside a ` +
        `${variant === "corpus" ? "corpus document" : "wiki atom"} (Wiki-Corpus Isolation Invariant); ` +
        `cross-store references live only in generated artifacts`
    );
  }
  return errors;
}

/**
 * Notices for the wiki fields the schema normalises away instead of rejecting
 * (capability `lecturer-wiki`, Requirements: Atom Source Year Normalisation,
 * Atom Source URL Loss-Avoidance, Atom Related-Wikilink Spelling
 * Normalisation).
 *
 * Keeping the atom is the point — but the loss must not be silent: an atom that
 * validates while quietly having lost its source url looks identical to one that
 * never had one. The verdict therefore names every dropped value, and the
 * ingestion runner carries the notices into the feedback it already reports per
 * run.
 */
function normalisationNotices(data: Record<string, unknown>, doc: WikiAtom): string[] {
  const notices: string[] = [];
  // A `related[]` entry no parse recovers is a lost cross-reference — the atom
  // survives, so the loss has to be named here or nobody ever learns of it.
  for (const { index, value } of droppedRelatedEntries(data.related)) {
    notices.push(
      `related.${index}: ${JSON.stringify(value)} is not a usable wikilink — ` +
        `the relation is dropped (the atom is not rejected over it)`
    );
  }
  const given = data.sources;
  if (!Array.isArray(given)) return notices;
  doc.sources.forEach((source, i) => {
    const before = given[i];
    if (before === null || typeof before !== "object") return;
    for (const field of ["year", "url"] as const) {
      const value = (before as Record<string, unknown>)[field];
      if (value === undefined || value === null || source[field] !== undefined) continue;
      notices.push(
        `sources.${i}.${field}: ${JSON.stringify(value)} is not a usable ${field} — ` +
          `the source is kept without it (the atom is not rejected over it)`
      );
    }
  });
  return notices;
}

/**
 * The filename convention (capability `corpus-curation`, Requirement: Unified
 * Markdown schema for all corpus documents): a corpus document's basename is
 * `<id>-<slug>.md`.
 *
 * The corpus is read by people as well as by the app, and NOTHING resolves a
 * document by filename — `citations.ts` joins the corpus root with the manifest
 * `path`, and the skill is forbidden from assembling a path at all. That is
 * exactly why the names drifted into three conventions at once (`<id>-<slug>.md`,
 * a bare `<id>.md`, and a slug with no id): nothing broke when they were wrong,
 * so a reader looking for `methodology-007` on disk found nothing.
 *
 * A bare `<id>.md` fails deliberately — it carries the id and tells the reader
 * nothing about the content. The check is corpus-only; wiki atoms have their own
 * naming rules, and `validateDirectory` already skips the wiki's non-atom files.
 */
function filenameErrors(filePath: string, id: string): string[] {
  const base = path.basename(filePath);
  const expected = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`);
  if (expected.test(base)) return [];
  return [
    `<filename>: "${base}" does not carry its id — a corpus document is named ` +
      `\`<id>-<slug>.md\`, so this one must be "${id}-<slug>.md" (a bare "${id}.md" is not enough). ` +
      `Rename it with \`git mv\` and regenerate the index.`,
  ];
}

/**
 * Validate one Markdown file against the given schema variant. ONE engine for
 * both stores (Requirement: Validator Alignment with the Corpus Schema
 * Discipline): identical parse path, identical error shape, identical
 * fail-on-invalid behaviour — only the Zod schema differs.
 */
export async function validateFile(filePath: string, variant?: "corpus"): Promise<ValidateResultFor<CorpusDocument>>;
export async function validateFile(filePath: string, variant: "wiki"): Promise<ValidateResultFor<WikiAtom>>;
export async function validateFile(filePath: string, variant: SchemaVariant): Promise<ValidateResult>;
export async function validateFile(filePath: string, variant: SchemaVariant = "corpus"): Promise<ValidateResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    return { ok: false, path: filePath, errors: [`<io>: ${(err as Error).message}`] };
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { ok: false, path: filePath, errors: [`<yaml>: ${(err as Error).message}`] };
  }
  // Isolation errors take precedence over generic strict-schema unknown-key
  // errors so the message points at the invariant, not at "unrecognized key".
  const isolation = isolationErrors(variant, parsed.data as Record<string, unknown>, parsed.content);
  if (isolation.length > 0) {
    return { ok: false, path: filePath, errors: isolation };
  }
  const schema = variant === "wiki" ? WikiAtomSchema : CorpusDocumentSchema;
  const result = schema.safeParse(parsed.data);
  if (!result.success) {
    return {
      ok: false,
      path: filePath,
      errors: result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
    };
  }
  if (variant === "corpus") {
    const filename = filenameErrors(filePath, (result.data as CorpusDocument).id);
    if (filename.length > 0) return { ok: false, path: filePath, errors: filename };
  }
  const notices =
    variant === "wiki" ? normalisationNotices(parsed.data as Record<string, unknown>, result.data as WikiAtom) : [];
  return { ok: true, path: filePath, doc: result.data, body: parsed.content, notices };
}

export async function validateDirectory(dir: string, variant?: "corpus"): Promise<ValidateResultFor<CorpusDocument>[]>;
export async function validateDirectory(dir: string, variant: "wiki"): Promise<ValidateResultFor<WikiAtom>[]>;
export async function validateDirectory(dir: string, variant: SchemaVariant): Promise<ValidateResult[]>;
export async function validateDirectory(dir: string, variant: SchemaVariant = "corpus"): Promise<ValidateResult[]> {
  const out: ValidateResult[] = [];
  await walk(dir, async (file) => {
    if (!file.endsWith(".md")) return;
    // The wiki's `index.md` (stage-1 retrieval source) and lint reports are not
    // atoms — they carry no atom frontmatter and are skipped by the atom schema.
    if (variant === "wiki") {
      const base = path.basename(file);
      if (base === "index.md" || base.startsWith("_")) return;
    }
    out.push(await validateFile(file, variant));
  });
  return out;
}

async function walk(dir: string, fn: (file: string) => Promise<void>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, fn);
    else await fn(full);
  }
}
