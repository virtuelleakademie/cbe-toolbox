import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

/**
 * Corpus browse-view generator (capability `distribution`, Requirement: Corpus
 * Browse View on the Landing Page; capability `corpus-curation`, Requirement:
 * Corpus Browsable on the Distribution Website). Emits one static HTML page
 * per corpus atom — title, body, frontmatter metadata, clickable `sources[]`
 * links — plus a category-grouped index page. Pure build-time output for a
 * static host; no dynamic backend. Access gating is the HOST's concern (the
 * stories portal wraps everything in Basic Auth until the public release).
 */

interface IndexedDocument {
  id: string;
  title: string;
  category: string;
  version: string;
  path: string;
  tags: string[];
  "short-description"?: string;
}

interface CorpusIndex {
  "corpus-version": string;
  documents: IndexedDocument[];
}

interface SourceEntry {
  author?: string;
  year?: number;
  title?: string;
  url?: string;
  license?: string;
  pages?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * One `sources[]` entry as HTML: `author year — title` linked to `url`; if the
 * url is missing the same fields render as plain text (Scenario: Source-text
 * links are clickable on each atom page).
 */
export function renderSource(src: SourceEntry): string {
  const label = escapeHtml(
    `${src.author ?? "Unknown"} ${src.year ?? ""} — ${src.title ?? "Untitled"}`.replace(/\s+/g, " ").trim()
  );
  const pages = src.pages ? ` <span class="pages">(pp. ${escapeHtml(src.pages)})</span>` : "";
  if (src.url) {
    return `<a href="${escapeHtml(src.url)}" target="_blank" rel="noreferrer">${label}</a>${pages}`;
  }
  return `<span>${label}</span>${pages}`;
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem 1rem; line-height: 1.6; background: #fafafa; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #1e1e2e; color: #cdd6f4; } a { color: #89b4fa; } .meta, .pages { color: #a6adc8; } .card, th, td { border-color: #45475a !important; } }
  main { max-width: 46rem; margin: 0 auto; }
  .meta { color: #666; font-size: 0.85rem; }
  .backlink { display: inline-block; margin-bottom: 1rem; font-size: 0.9rem; }
  table.frontmatter { border-collapse: collapse; font-size: 0.85rem; margin: 1rem 0; }
  table.frontmatter th, table.frontmatter td { border: 1px solid #ddd; padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
  ul.sources li { margin-bottom: 0.3rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 0.8rem; }
  .card h3 { margin: 0 0 0.3rem; font-size: 1rem; }
  h2.category { margin-top: 2rem; text-transform: capitalize; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { overflow-x: auto; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

// YAML's core schema parses an unquoted `updated: 2026-07-01` as a JS Date —
// normalise both spellings back to the ISO day (same tolerance as the schema).
function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "string" ? v : "";
}

function frontmatterTable(doc: IndexedDocument, fm: Record<string, unknown>): string {
  const rows: Array<[string, string]> = [
    ["id", doc.id],
    ["category", doc.category],
    ["version", doc.version],
    ["updated", isoDay(fm.updated)],
    ["license", typeof fm.license === "string" ? fm.license : ""],
    ["tags", doc.tags.join(", ")],
  ];
  const tr = rows
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("\n");
  return `<table class="frontmatter">\n${tr}\n</table>`;
}

async function renderAtomPage(corpusDir: string, doc: IndexedDocument, corpusVersion: string): Promise<string> {
  const raw = await readFile(path.join(corpusDir, doc.path), "utf8");
  const { content, data } = matter(raw);
  const bodyHtml = await marked.parse(content);
  const sources = Array.isArray(data.sources) ? (data.sources as SourceEntry[]) : [];
  const sourcesHtml =
    sources.length > 0
      ? `<h2>Sources</h2>\n<ul class="sources">\n${sources.map((s) => `<li>${renderSource(s)}</li>`).join("\n")}\n</ul>`
      : "";
  return page(
    doc.title,
    [
      `<a class="backlink" href="./index.html">&larr; Corpus index</a>`,
      `<h1>${escapeHtml(doc.title)}</h1>`,
      `<p class="meta">Corpus version ${escapeHtml(corpusVersion)}</p>`,
      frontmatterTable(doc, data),
      bodyHtml,
      sourcesHtml,
    ].join("\n")
  );
}

function renderIndexPage(index: CorpusIndex): string {
  const byCategory = new Map<string, IndexedDocument[]>();
  for (const doc of [...index.documents].sort((a, b) => a.title.localeCompare(b.title))) {
    const list = byCategory.get(doc.category) ?? [];
    list.push(doc);
    byCategory.set(doc.category, list);
  }
  const sections = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([category, docs]) =>
        `<h2 class="category">${escapeHtml(category)}</h2>\n` +
        docs
          .map(
            (d) =>
              `<div class="card"><h3><a href="./${escapeHtml(d.id)}.html">${escapeHtml(d.title)}</a></h3>` +
              (d["short-description"] ? `<p class="meta">${escapeHtml(d["short-description"])}</p>` : "") +
              `</div>`
          )
          .join("\n")
    )
    .join("\n");
  return page(
    "PIONEER Corpus — Browse",
    [
      `<a class="backlink" href="/">&larr; Portal</a>`,
      `<h1>PIONEER Corpus</h1>`,
      `<p class="meta">Corpus version ${escapeHtml(index["corpus-version"])} · ${index.documents.length} documents · preview, not yet public</p>`,
      sections,
    ].join("\n")
  );
}

export interface BrowseGenResult {
  pageCount: number;
  version: string;
}

export async function generateBrowseView(corpusDir: string, outDir: string): Promise<BrowseGenResult> {
  const index = JSON.parse(await readFile(path.join(corpusDir, "index.json"), "utf8")) as CorpusIndex;
  await mkdir(outDir, { recursive: true });
  for (const doc of index.documents) {
    await writeFile(path.join(outDir, `${doc.id}.html`), await renderAtomPage(corpusDir, doc, index["corpus-version"]));
  }
  await writeFile(path.join(outDir, "index.html"), renderIndexPage(index));
  return { pageCount: index.documents.length + 1, version: index["corpus-version"] };
}
