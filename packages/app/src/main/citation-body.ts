import matter from "gray-matter";

/**
 * Prepares a corpus document for the citation detail's Markdown renderer
 * (capability `desktop-app`, Requirement: *The Citation Detail Renders the Cited Source
 * as Markdown*).
 *
 * Two steps, both of which exist because the modal's HEAD already presents this
 * information in rendered form:
 *
 *  1. **Strip the YAML frontmatter.** `CitationResolver.loadBody` is deliberately a
 *     faithful raw-file loader — `resolveSources` and `resolveHeadings` need the
 *     frontmatter — so the block arrives here intact and would otherwise be shown a
 *     second time, as raw YAML, under a head that already renders its contents. The
 *     strip happens in the MAIN process on purpose: frontmatter is a corpus file-format
 *     concern, and the renderer must not acquire a YAML parser to display a document.
 *     `gray-matter` THROWS a `YAMLException` on a malformed block, and a throw here
 *     rejects the `loadCitation` IPC call and leaves the modal on "Loading…" forever —
 *     the lecturer would lose a document they could previously read. Nothing about a
 *     broken frontmatter block makes the prose below it unreadable, so the parse is
 *     guarded and falls back to a purely textual fence strip.
 *
 *  2. **Drop a leading `# <title>` that repeats the head's title.** Every corpus
 *     document opens with a level-1 heading identical to its `title`, so rendering the
 *     body verbatim prints the title twice within a few pixels of itself. The rule is
 *     title-MATCHED, not "drop the first heading": no schema mandates the convention, so
 *     a body opening with a different heading — or with anything that is not a level-1
 *     heading — is returned unchanged. Being wrong about the convention then costs
 *     nothing.
 *
 * Kept as a pure function in its own module so it is testable without importing
 * `main/ipc.ts`, which pulls the whole main-process module graph.
 */
export function citationMarkdownBody(raw: string, title: string): string {
  return dropTitleHeading(stripFrontmatter(raw), title);
}

/**
 * Frontmatter removal that cannot fail. The YAML parser is the accurate route and stays
 * the first one; when it throws, the block is removed by DELIMITER alone — no parse, no
 * interpretation of what is between the fences — so a document with a broken header is
 * still delivered and still read as Markdown. A document whose opening fence is never
 * closed is returned whole: showing a stray YAML block beats swallowing the text.
 */
function stripFrontmatter(raw: string): string {
  try {
    // The options argument is what keeps this function pure: `gray-matter` maintains a
    // module-global cache keyed on the input string, and it stores the file object
    // BEFORE parsing it — so once a document has thrown, every later call for the same
    // text returns the cached, UNSTRIPPED file without throwing, and the frontmatter
    // would reach the reader on the second opening of the same citation. Passing options
    // takes the uncached path (`matter()` only caches when called without them), so the
    // same input always produces the same output.
    return matter(raw, {}).content;
  } catch {
    return stripFrontmatterFence(raw);
  }
}

function stripFrontmatterFence(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length === 0 || lines[0]!.trimEnd() !== "---") return raw;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (line === "---" || line === "...") return lines.slice(i + 1).join("\n");
  }
  return raw;
}

/** Normalise for comparison only — never for output. Collapses runs of whitespace so a
 * heading wrapped or double-spaced differently from the index title still matches. */
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dropTitleHeading(content: string, title: string): string {
  const wanted = normalise(title);
  if (wanted.length === 0) return content;

  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim().length === 0) i++;
  if (i >= lines.length) return content;

  // ATX level-1 heading only (`# Text`, optional closing `#`s). A setext underline or a
  // deeper level is not the duplication this rule is about.
  const m = /^#\s+(.*?)\s*#*\s*$/.exec(lines[i]!);
  if (!m || normalise(m[1]!) !== wanted) return content;

  // Drop the heading and the blank lines that separated it, so the body starts at its
  // next real block rather than at a gap.
  let j = i + 1;
  while (j < lines.length && lines[j]!.trim().length === 0) j++;
  return lines.slice(j).join("\n");
}
