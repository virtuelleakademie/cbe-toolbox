/**
 * The citation detail renders its source as Markdown (capability `desktop-app`,
 * Requirement: *The Citation Detail Renders the Cited Source as Markdown*).
 *
 * The defect this guards: clicking a citation opened the source, and the body arrived as
 * naked Markdown — `##`, `**`, `|` and the raw `---` frontmatter, all verbatim in a
 * `<pre>` — while the metadata head above it looked finished.
 *
 * Each test walks the REAL path a lecturer walks: render a turn containing a citation
 * token, click it, let the modal resolve its payload. Nothing here renders
 * `CitationDetail` in isolation, because the point is that the surface the lecturer
 * reaches is on the shared stack.
 *
 * Covered scenarios:
 *   - The source body renders as Markdown, not as literal characters
 *   - The cited source is rendered by the shared component, not a second one
 *   - Raw HTML in a cited source is not honoured
 * (The two body-preparation scenarios — frontmatter stripping and the duplicated title —
 * are main-process behaviour and live in `citation-body.test.ts`.)
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarkdownView } from "../src/renderer/components/MarkdownView.js";
import { __resetCitationVerificationCache } from "../src/renderer/components/CitationLink.js";
import type { CitationDetail as CitationDetailDto } from "../src/shared/ipc-contract.js";

const ID = "methodology-001";
const TITLE = "The Challenge Based Learning Three-Phase Framework";

function detail(body: string): CitationDetailDto {
  return {
    store: "corpus",
    hit: { id: ID, title: TITLE, path: `content/methodology/${ID}.md`, tags: ["framework"] },
    "corpus-version": "2026-11",
    body,
  };
}

/**
 * Open the citation detail the way a lecturer does and hand back the dialog element.
 * `body` is what the MAIN process would have prepared — frontmatter already stripped —
 * so these tests measure the rendering, not the preparation.
 */
async function openDetail(body: string): Promise<HTMLElement> {
  __resetCitationVerificationCache();
  vi.spyOn(window.cbe, "verifyCitation").mockImplementation(async (req) => ({
    status: "missing-section",
    id: req.id,
  }));
  vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(detail(body));

  render(<MarkdownView text={`As reported (corpus:${ID}).`} />);
  fireEvent.click(screen.getByTitle(`Open corpus document ${ID}`));

  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(within(dialog).queryByText("Loading…")).toBeNull());
  return dialog;
}

/** The rendered document body — the container the modal puts the Markdown subtree in. */
function bodyOf(dialog: HTMLElement): HTMLElement {
  const el = dialog.querySelector(".md-body");
  expect(el, "the modal has no document body container").not.toBeNull();
  return el as HTMLElement;
}

/** KaTeX renders the expression twice; the MathML branch carries the LaTeX source, so
 * "what the lecturer sees" means the tree with that branch removed. */
function visibleText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const hidden of Array.from(clone.querySelectorAll(".katex-mathml"))) hidden.remove();
  return clone.textContent ?? "";
}

describe("The source body renders as Markdown, not as literal characters", () => {
  const SOURCE = [
    "## Summary",
    "",
    "The framework connects **Engage**, Investigate, and Act.",
    "",
    "- Phase: Engage",
    "- Purpose: Define an actionable Challenge",
    "",
    "| Phase | Duration |",
    "| ----- | -------- |",
    "| Engage | 2 weeks |",
    "",
    "> Document, reflect, and share throughout the process.",
    "",
    "```ts",
    "const phase = 'engage';",
    "```",
  ].join("\n");

  it("renders headings, lists, emphasis and tables as real elements", async () => {
    const body = bodyOf(await openDetail(SOURCE));

    // Structure, not a raw string: this is what "rendered" means.
    const h2 = body.querySelector("h2");
    expect(h2?.textContent).toBe("Summary");
    expect(body.querySelector("strong")?.textContent).toBe("Engage");
    expect(body.querySelectorAll("ul > li")).toHaveLength(2);
    expect(body.querySelector("table")).not.toBeNull();
    expect(body.querySelectorAll("table th")).toHaveLength(2);
    expect(body.querySelectorAll("table tbody tr")).toHaveLength(1);
    expect(body.querySelector("blockquote")).not.toBeNull();
    expect(body.querySelector("pre code")).not.toBeNull();
  });

  it("leaves no Markdown punctuation behind as literal text", async () => {
    const body = bodyOf(await openDetail(SOURCE));
    const text = visibleText(body);

    expect(text).toContain("Summary");
    expect(text).toContain("The framework connects Engage, Investigate, and Act.");
    // The characters that gave the defect away when the body sat in a <pre>.
    expect(text).not.toContain("## ");
    expect(text).not.toContain("**");
    expect(text).not.toContain("|");
    expect(text).not.toContain("> Document");
    expect(text).not.toContain("```");
  });

  it("no longer parks the body in a verbatim <pre> of its own", async () => {
    const dialog = await openDetail(SOURCE);
    // A fenced code block legitimately produces a <pre>; the body container itself must
    // not BE one, which is exactly what the old `<pre className="md-body">` was.
    expect(dialog.querySelector("pre.md-body")).toBeNull();
    expect(bodyOf(dialog).tagName).toBe("DIV");
  });
});

describe("The cited source is rendered by the shared component, not a second one", () => {
  it("renders the body inside the shared component's own `.md` subtree", async () => {
    const body = bodyOf(await openDetail("## Summary\n\nText."));
    // `.md` is MarkdownView's container class — its presence is what says the shared
    // stack drew this, rather than a second renderer that happens to produce tags.
    expect(body.querySelector(":scope > .md")).not.toBeNull();
  });

  it("typesets math and highlights code exactly as an assistant turn would", async () => {
    const body = bodyOf(await openDetail("Engage $\\rightarrow$ Investigate\n\n```ts\nconst a = 1;\n```\n"));

    expect(body.querySelector(".katex")).not.toBeNull();
    expect(body.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe("\\rightarrow");
    const visible = visibleText(body);
    expect(visible).toContain("→");
    expect(visible).not.toContain("$");

    const code = body.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("hljs");
  });

  it("linkifies a citation token inside the cited document, using the same CitationLink", async () => {
    const dialog = await openDetail("See also (corpus:methodology-001) on the phases.");
    // Asserted on the component's own markup rather than on its title text: the title
    // changes once the async verification verdict lands, so matching it would race.
    const link = bodyOf(dialog).querySelector("button.cite");
    expect(link, "the nested citation token was not linkified").not.toBeNull();
    expect(link!.textContent).toContain("(corpus:methodology-001)");
  });
});

/** Open the citation detail from a WIKI token. `payload` is what the main process's
 * wiki branch would answer — an atom detail, or `null` for an atom the index does not
 * carry. */
async function openWikiDetail(payload: CitationDetailDto | null): Promise<HTMLElement> {
  __resetCitationVerificationCache();
  vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(payload);

  render(<MarkdownView text={"Grounded in (wiki:concept/cognitive-load § From skript)."} />);
  fireEvent.click(screen.getByTitle("Open wiki atom concept/cognitive-load"));

  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(within(dialog).queryByText("Loading…")).toBeNull());
  return dialog;
}

const ATOM: CitationDetailDto = {
  store: "wiki",
  hit: { id: "concept/cognitive-load", title: "cognitive-load", path: "concept/cognitive-load.md" },
  body: "## From skript\n\nWorking memory holds **few** elements at once.",
};

// Scenario: Clicking a wiki citation opens the shared overlay without corpus chrome
describe("A wiki atom opens the shared overlay without corpus chrome", () => {
  it("renders the atom's title and Markdown body through the shared stack", async () => {
    const dialog = await openWikiDetail(ATOM);
    expect(within(dialog).getByRole("heading", { level: 3 }).textContent).toBe("cognitive-load");
    const body = bodyOf(dialog);
    // The shared component drew this — same `.md` subtree as an assistant turn.
    expect(body.querySelector(":scope > .md")).not.toBeNull();
    expect(body.querySelector("h2")?.textContent).toBe("From skript");
    expect(body.querySelector("strong")?.textContent).toBe("few");
  });

  it("carries the atom's id and path but no corpus version and no tags", async () => {
    const dialog = await openWikiDetail(ATOM);
    const meta = dialog.querySelector(".cite-modal-meta");
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain("wiki:concept/cognitive-load");
    expect(meta!.textContent).toContain("concept/cognitive-load.md");
    // The corpus-only chrome is ABSENT, not rendered as empty placeholders.
    expect(meta!.textContent).not.toContain("· corpus");
  });
});

// Scenario: An unknown atom id falls back to the overlay's not-found state
describe("An unknown atom id falls back to the overlay's not-found state", () => {
  it("shows the existing not-found state and marks nothing", async () => {
    const dialog = await openWikiDetail(null);
    expect(within(dialog).getByRole("heading", { level: 3 }).textContent).toBe(
      "Citation not found: wiki:concept/cognitive-load"
    );
    // No error dialog beside the overlay, no body container, and the token in the
    // transcript stays an unmarked, clickable wiki citation.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog.querySelector(".md-body")).toBeNull();
    const token = document.querySelector('[data-citation-state="wiki"]');
    expect(token).not.toBeNull();
    expect(token!.querySelector(".cite-flag")).toBeNull();
  });
});

describe("Raw HTML in a cited source is not honoured", () => {
  it("produces no element from a raw <script> or inline <img> in the body", async () => {
    const body = bodyOf(
      await openDetail('Before.\n\n<script>window.x = 1;</script>\n\n<img src="x" onerror="y()">\n\nAfter.')
    );

    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    // The surrounding prose still renders — refusing the markup is not blanking the page.
    // Asserted as paragraphs, not as text: a verbatim <pre> would also contain no <script>
    // and no <img>, so a text-only assertion here could not fail and would be a placebo.
    const paragraphs = Array.from(body.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs).toContain("Before.");
    expect(paragraphs).toContain("After.");
  });
});
