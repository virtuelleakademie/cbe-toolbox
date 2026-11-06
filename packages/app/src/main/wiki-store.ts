import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { extractText } from "./ingestion.js";

/**
 * Three-layer wiki store (capability `lecturer-wiki`, Requirement: Three-Layer
 * Store — inbox, raw, wiki):
 *
 *   1. `inbox/`  — immutable originals, append-only (never edited or deleted).
 *   2. `raw/`    — immutable, regenerable Markdown extraction with provenance
 *                  frontmatter (`source` / `extracted_from` / `extractor` /
 *                  `captured` / `status`).
 *   3. `wiki/`   — agent-maintained atoms, compiled from `raw/` by the
 *                  atomization workflow.
 *
 * Extraction REUSES the app's ingestion implementation (`ingestion.ts`) — the
 * ONE extraction authority shared with the in-session material-ingestion stub.
 * There is deliberately no second extractor here (design.md D3).
 */

/** The one extraction authority for the raw layer — the same function the
 * in-session ingestion stub calls. Exported so tests can lock the identity
 * (Scenario: Wiki extraction and stub extraction share one implementation). */
export const RAW_EXTRACTION_AUTHORITY = extractText;

/** Extractor identifier recorded in raw frontmatter: implementation + version. */
export function extractorId(appVersion: string): string {
  return `cbe-app-ingestion@${appVersion}`;
}

export interface RawProvenance {
  source: string;
  extracted_from: string;
  extractor: string;
  captured: string;
  status: "raw" | "compiled";
}

export interface RawFileInfo {
  /** Course-relative path, e.g. `raw/skript.md`. */
  relPath: string;
  provenance: RawProvenance;
}

function inboxDir(courseDirAbs: string): string {
  return path.join(courseDirAbs, "inbox");
}

function rawDir(courseDirAbs: string): string {
  return path.join(courseDirAbs, "raw");
}

/** Split a filename into stem + extension (extension includes the dot). */
function splitName(filename: string): { stem: string; ext: string } {
  const ext = path.extname(filename);
  return { stem: filename.slice(0, filename.length - ext.length), ext };
}

/**
 * Store an original document in `inbox/` — append-only: an existing file is
 * NEVER overwritten; a name collision gets a numeric suffix so both originals
 * survive. Returns the course-relative inbox path.
 */
export async function storeInInbox(courseDirAbs: string, filename: string, data: Buffer): Promise<string> {
  const dir = inboxDir(courseDirAbs);
  await mkdir(dir, { recursive: true });
  const { stem, ext } = splitName(path.basename(filename));
  let candidate = `${stem}${ext}`;
  for (let n = 2; ; n++) {
    try {
      await writeFile(path.join(dir, candidate), data, { flag: "wx" });
      return path.posix.join("inbox", candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      candidate = `${stem}-${n}${ext}`;
    }
  }
}

/** Deterministic raw filename for an inbox document: same stem, `.md`. The inbox
 * name is already collision-free, so the raw name is too. */
export function rawPathForInbox(inboxRelPath: string): string {
  const { stem } = splitName(path.basename(inboxRelPath));
  return path.posix.join("raw", `${stem}.md`);
}

export type ExtractToRawResult = { ok: true; rawRelPath: string } | { ok: false; message: string };

/**
 * Deterministically extract an inbox original into `raw/` with provenance
 * frontmatter and `status: raw`. Re-running on the same inbox document
 * reproduces an equivalent raw file (Scenario: Raw layer is regenerable from
 * inbox) — the extraction is deterministic and `raw/` never carries manual
 * edits, so deleting and re-extracting loses nothing.
 */
export async function extractToRaw(
  courseDirAbs: string,
  inboxRelPath: string,
  opts: { extractor: string; capturedDate?: string }
): Promise<ExtractToRawResult> {
  const originalName = path.basename(inboxRelPath);
  const data = await readFile(path.join(courseDirAbs, inboxRelPath));
  const result = await RAW_EXTRACTION_AUTHORITY(originalName, data);
  if (!result.ok) return { ok: false, message: result.message };

  const rawRelPath = rawPathForInbox(inboxRelPath);
  const provenance: RawProvenance = {
    source: originalName,
    extracted_from: inboxRelPath,
    extractor: opts.extractor,
    captured: opts.capturedDate ?? new Date().toISOString().slice(0, 10),
    status: "raw",
  };
  const frontmatter = [
    "---",
    `source: ${JSON.stringify(provenance.source)}`,
    `extracted_from: ${JSON.stringify(provenance.extracted_from)}`,
    `extractor: ${JSON.stringify(provenance.extractor)}`,
    `captured: ${JSON.stringify(provenance.captured)}`,
    `status: ${provenance.status}`,
    "---",
  ].join("\n");
  await mkdir(rawDir(courseDirAbs), { recursive: true });
  await writeFile(path.join(courseDirAbs, rawRelPath), `${frontmatter}\n\n${result.text}\n`, "utf8");
  return { ok: true, rawRelPath };
}

/** Read one raw file's provenance frontmatter. Returns null for a file without
 * the mandatory fields (not a raw-layer file). */
export async function readRawProvenance(courseDirAbs: string, rawRelPath: string): Promise<RawProvenance | null> {
  try {
    const parsed = matter(await readFile(path.join(courseDirAbs, rawRelPath), "utf8"));
    const d = parsed.data as Record<string, unknown>;
    if (typeof d.source !== "string" || typeof d.extracted_from !== "string") return null;
    const status = d.status === "compiled" ? "compiled" : "raw";
    return {
      source: d.source,
      extracted_from: d.extracted_from,
      extractor: typeof d.extractor === "string" ? d.extractor : "",
      captured: typeof d.captured === "string" ? d.captured : String(d.captured ?? ""),
      status,
    };
  } catch {
    return null;
  }
}

/** List the raw layer (course-relative paths + provenance), skipping files that
 * do not carry raw frontmatter. */
export async function listRawFiles(courseDirAbs: string): Promise<RawFileInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(rawDir(courseDirAbs));
  } catch {
    return [];
  }
  const infos: RawFileInfo[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".md")) continue;
    const relPath = path.posix.join("raw", name);
    const provenance = await readRawProvenance(courseDirAbs, relPath);
    if (provenance) infos.push({ relPath, provenance });
  }
  return infos;
}

/** Raw files still awaiting atomization (`status: raw`). */
export async function listPendingRaws(courseDirAbs: string): Promise<RawFileInfo[]> {
  return (await listRawFiles(courseDirAbs)).filter((r) => r.provenance.status === "raw");
}

/**
 * Flip a raw file's `status` — the ONLY permitted mutation of the raw layer
 * (`raw → compiled` after a successful atomization; back to `raw` never happens
 * in practice but the transition is symmetric for retry bookkeeping). The body
 * and every other frontmatter field are preserved byte-for-byte.
 */
export async function setRawStatus(
  courseDirAbs: string,
  rawRelPath: string,
  status: "raw" | "compiled"
): Promise<void> {
  const file = path.join(courseDirAbs, rawRelPath);
  const raw = await readFile(file, "utf8");
  // Frontmatter-only line edit — no gray-matter re-serialisation, so field
  // order, quoting, and the body stay untouched.
  const updated = raw.replace(/^status:\s*(raw|compiled)\s*$/m, `status: ${status}`);
  if (updated === raw && !new RegExp(`^status: ${status}$`, "m").test(raw)) {
    throw new Error(`no status field found in ${rawRelPath}`);
  }
  await writeFile(file, updated, "utf8");
}

export type WikiIngestOutcome =
  | { ok: true; filename: string; inboxRelPath: string; rawRelPath: string }
  | { ok: false; filename: string; message: string };

/**
 * Run the first two layers of the ingestion pipeline for a batch of documents:
 * original → `inbox/` (immutable), deterministic extraction → `raw/`
 * (`status: raw`). Per-file isolation: one failing file never discards the
 * others. Atomization (`raw/` → `wiki/`) is the subagent workflow's job
 * (Requirement: Ingestion Runs in Isolated Subagent Sessions).
 */
export async function ingestIntoCourse(
  courseDirAbs: string,
  files: ReadonlyArray<{ filename: string; data: Buffer }>,
  opts: { extractor: string }
): Promise<WikiIngestOutcome[]> {
  const outcomes: WikiIngestOutcome[] = [];
  for (const f of files) {
    try {
      const inboxRelPath = await storeInInbox(courseDirAbs, f.filename, f.data);
      const extracted = await extractToRaw(courseDirAbs, inboxRelPath, { extractor: opts.extractor });
      outcomes.push(
        extracted.ok
          ? { ok: true, filename: f.filename, inboxRelPath, rawRelPath: extracted.rawRelPath }
          : { ok: false, filename: f.filename, message: extracted.message }
      );
    } catch (err) {
      outcomes.push({
        ok: false,
        filename: f.filename,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/**
 * Reflection log per atomization run (capability `lecturer-wiki`, Requirement:
 * Reflection Logs per Atomization and Session): a dated Markdown file under
 * `<course>/reflections/` recording the wiki-skill bundle version that produced
 * the atoms and a summary of the run's decisions. Available for PIONEER
 * research analysis only with explicit opt-in — nothing here leaves the machine.
 */
export interface ReflectionEntry {
  /** ISO date of the run (YYYY-MM-DD). */
  date: string;
  rawRelPath: string;
  /** Adapted wiki-skill bundle version (skills/wiki SKILL.md frontmatter). */
  skillVersion: string;
  status: "done" | "failed" | "aborted";
  /** Decision summary emitted by the atomization session. */
  summary: string;
  /** Wiki-relative paths of atoms that passed the validator. */
  atoms: string[];
  /** Metadata the validator normalised away on landed atoms (e.g. an unusable
   * source url) — the atom survived, but the loss is written down rather than
   * swallowed. */
  notices?: string[];
  error?: string;
}

export async function writeReflectionLog(courseDirAbs: string, entry: ReflectionEntry): Promise<string> {
  const dir = path.join(courseDirAbs, "reflections");
  await mkdir(dir, { recursive: true });
  const stem = path.basename(entry.rawRelPath, ".md");
  let file = path.join(dir, `${entry.date}-atomization-${stem}.md`);
  // Never overwrite an earlier run's log — suffix on collision (retries).
  for (let n = 2; ; n++) {
    try {
      const lines = [
        "---",
        `date: ${JSON.stringify(entry.date)}`,
        `operation: atomization`,
        `raw: ${JSON.stringify(entry.rawRelPath)}`,
        `wiki-skill-version: ${JSON.stringify(entry.skillVersion)}`,
        `status: ${entry.status}`,
        "---",
        "",
        "## Decision summary",
        "",
        entry.summary || "_(no summary emitted)_",
        "",
        "## Atoms",
        "",
        ...(entry.atoms.length ? entry.atoms.map((a) => `- ${a}`) : ["_(none)_"]),
        ...(entry.notices?.length ? ["", "## Notices", "", ...entry.notices.map((n) => `- ${n}`)] : []),
        ...(entry.error ? ["", "## Error", "", entry.error] : []),
        "",
        "<!-- Optional lecturer annotations below this line. -->",
        "",
      ];
      await writeFile(file, lines.join("\n"), { encoding: "utf8", flag: "wx" });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      file = path.join(dir, `${entry.date}-atomization-${stem}-${n}.md`);
    }
  }
}
