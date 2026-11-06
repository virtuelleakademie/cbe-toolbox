import { z } from "zod";

export const CategoryEnum = z.enum(["methodology", "case-study", "template", "foundations", "vocabulary"]);

export const SourceSchema = z.object({
  author: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  title: z.string().min(1),
  url: z.string().url(),
  license: z.string().min(1),
  /** Optional page anchor(s) of this source the document draws on — a free-form
   * string (e.g. `"11-13"` or `"24, 27"`). Human/model verification metadata;
   * nothing machine-reads the ranges. See `corpus-curation` Requirement:
   * Primary-source page anchoring. */
  pages: z.string().min(1).optional(),
});

// The corpus is purely versioned content. There is no per-document authority
// state: no `corpus-track`, no `review-status`, no `reviewers`. Authority is
// established once per corpus version (see `corpus-curation` Requirement:
// Released version sign-off before public release). The document-level `version`
// below is an informational revision marker only; the authoritative currency is
// the manifest-level `corpus-version` (`YYYY-MM`) in index.json.
export const CorpusDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
    title: z.string().min(1),
    category: CategoryEnum,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "semantic version required"),
    sources: z.array(SourceSchema),
    license: z.string().min(1),
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD"),
    tags: z.array(z.string()),
    "short-description": z.string().min(1).max(200, "short-description must be ≤ 200 characters").optional(),
  })
  .strict();

export type CorpusDocument = z.infer<typeof CorpusDocumentSchema>;

// ---------------------------------------------------------------------------
// Wiki schema variant (capability `lecturer-wiki`, Requirement: Atom
// Frontmatter Schema). The wiki shares the validation ENGINE with the corpus
// (Requirement: Validator Alignment with the Corpus Schema Discipline), not the
// schema itself — atoms carry lecturer-relevant fields the corpus does not.
// ---------------------------------------------------------------------------

export const ConfidenceEnum = z.enum(["high", "medium", "low"]);

/**
 * ISO date field tolerant of YAML's native date parsing: an unquoted
 * `updated: 2026-07-07` reaches the schema as a JS Date (js-yaml core schema),
 * a quoted one as a string. Wiki atoms are written by the agent and edited by
 * lecturers in arbitrary editors, so both spellings MUST validate.
 */
const isoDateString = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD")
);

/**
 * Publication year of a wiki source, normalised at the ONE place where the
 * value enters the system (capability `lecturer-wiki`, Requirement: Atom Source
 * Year Normalisation).
 *
 * Wiki atoms are written by the atomization subagent as Markdown files, so the
 * year arrives exactly as the model spelled it in the YAML frontmatter: an
 * unquoted `year: 2023` reaches the schema as a number, a quoted `year: "2023"`
 * as a string. Both denote the same year, and a plain `z.number()` rejected the
 * quoted spelling — which cost the WHOLE atom, since the ingestion runner rolls
 * back every rejected atom (`packages/pi-bridge/src/ingestion-runner.ts`).
 *
 * The rule: a clean four-digit year inside 1900–2100 — number or digit-only
 * string, surrounding whitespace tolerated — normalises to that number. EVERY
 * other value (empty, `n.d.`, `circa 2020`, `2023-04`, out-of-range, non-scalar)
 * normalises to "no year", exactly as if the field had been omitted, and the
 * citation layer renders it as `n.d.` (`packages/pi-bridge/src/citations.ts`
 * already maps a missing year to `null`; `cite-tool.ts` renders `n.d.`). A
 * cosmetic metadata defect must never cost the lecturer an atom.
 *
 * The corpus variant deliberately keeps its strict `z.number()`: corpus
 * documents are hand-curated and validated in CI (`npm run corpus:validate`),
 * where a loud rejection is the useful behaviour.
 */
const wikiSourceYear = z.preprocess((v) => {
  const n = typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1900 || n > 2100) return undefined;
  return n;
}, z.number().int().min(1900).max(2100).optional());

/**
 * Source URL of a wiki source, held to the SAME strict URL grammar as the
 * corpus — but a value that does not hold costs the field, never the atom
 * (capability `lecturer-wiki`, Requirement: Atom Source URL Loss-Avoidance).
 *
 * Same origin as the year above: the atomization subagent writes the atom
 * Markdown itself and nothing constrains how it spells `url`, so `n/a`, a bare
 * `www.example.org` or a course-relative path reach the schema verbatim. `url`
 * is already optional — "no url" is an intended state the citation layer models
 * first-class (`citations.ts` maps a missing url to `null`, the wiki-precedence
 * lookup simply does not match on it) — so an unusable value is treated as an
 * omitted field instead of rejecting the whole atom.
 *
 * Deliberately NOT a repair: no guessing, no scheme-prepending, no resolving of
 * relative paths. Which spellings should be accepted and how they convert is a
 * product question; this is loss-avoidance only. The drop is not silent — the
 * validator reports it as a notice, which the ingestion runner carries into its
 * per-run feedback.
 */
const wikiSourceUrl = z.preprocess((v) => {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return z.string().url().safeParse(trimmed).success ? trimmed : undefined;
}, z.string().url().optional());

/**
 * One `related[]` entry — a wikilink to another atom, normalised at the ONE
 * place where the value enters the system (capability `lecturer-wiki`,
 * Requirement: Atom Related-Wikilink Spelling Normalisation).
 *
 * An entry denotes ONE wikilink and is therefore ONE string: `WikiBrowser.tsx`
 * strips `[[`/`]]` off a string, the knowledge graph maps one entry to one edge,
 * and the IPC contract types the field `string[]`. That declaration is right and
 * is NOT widened here.
 *
 * What is wrong is the spelling the atomization instructions ask for. Written
 * unquoted as `skills/wiki/SKILL.md` shows it, `[[concept/x]]` is not a string
 * at all — YAML reads it as a nested flow sequence, and `z.array(z.string())`
 * rejected the whole atom. The ingestion runner rolls back every rejected atom
 * (`packages/pi-bridge/src/ingestion-runner.ts`), so a cosmetic spelling defect
 * cost the lecturer their material — the same failure the year and url
 * normalisations above exist for.
 *
 * How deep the nesting is depends on layout and link count, which is why BOTH
 * depths are recovered. `related:\n  - [[x]]` and `related: [[[x]], [[y]]]`
 * deliver each entry doubly nested (`[["x"]]`), while the single link in flow
 * form — `related: [[x]]`, where the outer sequence IS the value of the field —
 * delivers its one entry singly nested (`["x"]`). Recovering only the deeper
 * shape made a single link survive in block form and vanish in flow form: an
 * arbitrary wart nobody can predict from the instructions.
 *
 * The rule: **recover the parse, never guess the intent.**
 *  - a string is kept exactly as written;
 *  - a one-element sequence holding a string, at either depth, is restored to
 *    the string `[[x]]` — byte for byte the source text the author wrote, and
 *    exactly as deterministic at one level as at two;
 *  - EVERY other entry counts as no relation and is dropped, exactly as an
 *    unusable url costs the field rather than the atom. `[[a, b]]` parses to
 *    `[["a", "b"]]`, and re-joining it would invent a separator — that is
 *    repair, not recovery, and it is deliberately not done.
 *
 * The trade the one-level rule accepts: `- [x]` (a block item written with ONE
 * bracket pair) has the same parse as a single unquoted `[[x]]` in flow form,
 * so it is recovered to `[[x]]` and gains a bracket pair its author did not
 * write. That collision is the price of not dropping the flow form; it is
 * pinned by a test rather than hidden.
 *
 * The drop is not silent: `validate.ts` names every dropped entry as a notice,
 * which the ingestion runner carries into its per-run feedback.
 */
function recoverWikilink(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!Array.isArray(entry) || entry.length !== 1) return undefined;
  const inner = entry[0];
  if (typeof inner === "string") return `[[${inner}]]`;
  if (!Array.isArray(inner) || inner.length !== 1 || typeof inner[0] !== "string") return undefined;
  return `[[${inner[0]}]]`;
}

const wikiRelated = z.preprocess((v) => {
  if (!Array.isArray(v)) return v;
  return v.map(recoverWikilink).filter((entry): entry is string => entry !== undefined);
}, z.array(z.string()));

/**
 * Reports which `related[]` entries the normalisation above dropped, by their
 * index in the ORIGINAL frontmatter array — the validator turns these into
 * notices so the loss is visible instead of silent.
 */
export function droppedRelatedEntries(given: unknown): Array<{ index: number; value: unknown }> {
  if (!Array.isArray(given)) return [];
  const dropped: Array<{ index: number; value: unknown }> = [];
  given.forEach((entry, index) => {
    if (recoverWikilink(entry) === undefined) dropped.push({ index, value: entry });
  });
  return dropped;
}

/**
 * Bibliographic source entry on a wiki atom — the CBE citation model, same
 * shape as corpus sources but with relaxed requiredness: an ingested document
 * registers at minimum its filename (as `title`) plus the ingestion date;
 * `author` / `year` / `url` / `license` are added when derivable from document
 * metadata. The wiki-wins precedence rule (capability `cbe-skill`, Citation
 * Grounding) matches on `url` when present.
 */
export const WikiSourceSchema = z
  .object({
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    year: wikiSourceYear,
    url: wikiSourceUrl,
    license: z.string().min(1).optional(),
    /** ISO date the source document was ingested (set by the ingestion pipeline). */
    ingested: isoDateString.optional(),
  })
  .strict();

/**
 * Wiki atom frontmatter. `sources` (bibliographic) and `raw` (mechanical
 * provenance: `raw/<...>` paths) are BOTH mandatory — self-authored atoms carry
 * explicit empty arrays, never omitted fields: "no sources" is a deliberate
 * statement, and downstream rendering can distinguish "deliberately
 * self-authored" from "field forgotten".
 */
export const WikiAtomSchema = z
  .object({
    type: z.string().min(1),
    aliases: z.array(z.string()),
    sources: z.array(WikiSourceSchema),
    raw: z.array(z.string().min(1)),
    related: wikiRelated,
    confidence: ConfidenceEnum,
    updated: isoDateString,
  })
  .strict();

export type WikiAtom = z.infer<typeof WikiAtomSchema>;
export type WikiSource = z.infer<typeof WikiSourceSchema>;

/** Which schema the shared validation engine enforces (ONE engine, two schema
 * variants — never two parallel implementations that drift). */
export type SchemaVariant = "corpus" | "wiki";
