/**
 * Integration tests for MarkdownView.
 *
 * MarkdownView is the renderer that converts assistant text into the actual DOM
 * the lecturer sees. It is also the renderer that Generative UI Tool Results
 * will reuse later — so this stack is the only Markdown renderer in the app.
 *
 * These tests assert that:
 *   - Standard GitHub-flavoured Markdown (headings, code, tables, blockquotes,
 *     lists) maps to the expected HTML structure.
 *   - Citation tokens are intercepted by the remark plugin AND swapped for the
 *     `CitationLink` component via the `components.a` override.
 *   - Clicking a citation opens the citation detail (the resolver path).
 *
 * Covers spec scenarios *Headings, code, tables render as Markdown* and *Shared
 * renderer with Generative UI Tool Results* in `specs/desktop-app/spec.md`.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MarkdownView } from "../src/renderer/components/MarkdownView.js";

describe("MarkdownView — GFM rendering", () => {
  it("renders headings (h1, h2, h3) as the matching HTML tags", () => {
    render(<MarkdownView text={"# Title\n\n## Section\n\n### Subsection"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Subsection" })).toBeTruthy();
  });

  it("renders fenced code blocks with the language captured in a className", () => {
    const md = ["```ts", "const x: number = 1;", "```"].join("\n");
    const { container } = render(<MarkdownView text={md} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    // rehype-highlight applies language-ts and an "hljs" class. We only require
    // the language token to be present so the test is resilient to highlight
    // class shape changes.
    expect(code!.className).toMatch(/language-ts/);
    expect(code!.textContent).toBe("const x: number = 1;\n");
  });

  it("renders GFM tables as <table>", () => {
    const md = ["| h1 | h2 |", "| -- | -- |", "| a  | b  |"].join("\n");
    const { container } = render(<MarkdownView text={md} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("th")).toHaveLength(2);
    expect(table!.querySelectorAll("tbody tr td")).toHaveLength(2);
  });

  it("renders blockquotes as <blockquote>", () => {
    const { container } = render(<MarkdownView text={"> a quoted line"} />);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent?.trim()).toBe("a quoted line");
  });

  it("renders ordered and unordered lists with item-level children", () => {
    const md = ["- one", "- two", "", "1. first", "2. second"].join("\n");
    const { container } = render(<MarkdownView text={md} />);
    expect(container.querySelector("ul")?.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("ol")?.querySelectorAll("li").length).toBe(2);
  });

  it("strips raw HTML — skipHtml is enforced", () => {
    // Put the HTML block on its own line — per CommonMark, a Type-1 HTML block
    // swallows everything until a blank line, so `visible` must live in a
    // separate paragraph to survive skipHtml dropping the block.
    const { container } = render(<MarkdownView text={'<script>alert("xss")</script>\n\nvisible'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("visible");
  });
});

describe("MarkdownView — citation interception", () => {
  it("swaps a citation token for a CitationLink button (not a plain <a>)", () => {
    render(<MarkdownView text={"See (corpus:foundations-001 § Engage, Kolb 1984) for context."} />);
    // CitationLink renders a <button class="cite"> with the raw citation token
    // as its text — that text becomes the button's accessible name. The `title`
    // attribute carries the id but is NOT part of the accessible name; we
    // separately assert the title for the id wiring.
    const btn = screen.getByRole("button", {
      name: "(corpus:foundations-001 § Engage, Kolb 1984)",
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("cite");
    expect(btn.getAttribute("title")).toBe("Open corpus document foundations-001");
  });

  it("clicking the citation opens the citation detail and calls window.cbe.loadCitation", async () => {
    const loadSpy = vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(null);

    render(<MarkdownView text={"See (corpus:foundations-001) for context."} />);
    const btn = screen.getByTitle("Open corpus document foundations-001");
    fireEvent.click(btn);

    // The modal mounts and immediately calls loadCitation with the id.
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("foundations-001");
    // While the promise resolves, the modal shows "Loading…" — proving the
    // resolver path is wired, not just the URL scheme.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("heading")).toHaveProperty("textContent", "Loading…");
  });

  it("non-citation external links still render as plain <a> with safe rel/target", () => {
    const { container } = render(<MarkdownView text={"See [docs](https://example.com) for context."} />);
    const a = container.querySelector("a") as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    expect(a!.href).toBe("https://example.com/");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("multiple citations in the same paragraph each become an independent CitationLink", () => {
    const { container } = render(
      <MarkdownView text={"Compare (corpus:foundations-001) and (corpus:foundations-002)."} />
    );
    const btns = container.querySelectorAll("button.cite");
    expect(btns).toHaveLength(2);
    expect(btns[0]!.getAttribute("title")).toBe("Open corpus document foundations-001");
    expect(btns[1]!.getAttribute("title")).toBe("Open corpus document foundations-002");
  });
});

describe("MarkdownView — model-emitted citation variants (links rendered wrong bug)", () => {
  // Observed failure mode: most models do NOT emit the bare `(corpus:<id> …)`
  // token the skill asks for. Trained overwhelmingly on Markdown, they wrap the
  // citation in standard link syntax `[label](corpus:<id>)`. react-markdown then
  // parses that as a link node whose URL `corpus:<id>` is NOT in
  // defaultUrlTransform's whitelist (http/https/mailto/tel), so it is silently
  // stripped to "" — a dead `<a href="">`. The remark plugin never sees it
  // because it only visits text nodes. These tests pin that a Markdown-link
  // citation survives as a working CitationLink.

  it("renders a Markdown-link-style citation [label](corpus:id) as a CitationLink button", () => {
    render(<MarkdownView text={"See [the Engage phase](corpus:foundations-001) for context."} />);
    const btn = screen.getByRole("button", { name: "the Engage phase" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("cite");
    expect(btn.getAttribute("title")).toBe("Open corpus document foundations-001");
  });

  it("does NOT strip a corpus: Markdown-link into a dead <a href=''>", () => {
    const { container } = render(<MarkdownView text={"See [docs](corpus:methodology-001) here."} />);
    // The bug signature: a left-over anchor with an empty href. After the fix the
    // citation is a CitationLink button and there is no dead anchor.
    const deadAnchor = Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === "");
    expect(deadAnchor).toBeUndefined();
  });

  it("preserves the label as the button text and extracts the id from the corpus: scheme", () => {
    render(<MarkdownView text={"Grounded in [§ 4.2, Smith 2020](corpus:methodology-001)."} />);
    const btn = screen.getByRole("button", { name: "§ 4.2, Smith 2020" });
    expect(btn.getAttribute("title")).toBe("Open corpus document methodology-001");
  });

  it("renders a Markdown-link citation with the cbe-citation:// scheme as a CitationLink too", () => {
    render(<MarkdownView text={"See [Engage](cbe-citation://foundations-001) for more."} />);
    const btn = screen.getByRole("button", { name: "Engage" });
    expect(btn.getAttribute("title")).toBe("Open corpus document foundations-001");
  });

  it("still renders the canonical bare-token form (with the [dev-corpus, non-final] suffix) as a CitationLink", () => {
    render(
      <MarkdownView
        text={"Mechanism (corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016) [dev-corpus, non-final]."}
      />
    );
    const btn = screen.getByRole("button", {
      name: "(corpus:methodology-001 § Phase 1: Engage, Nichols et al. 2016)",
    });
    expect(btn.getAttribute("title")).toBe("Open corpus document methodology-001");
  });
});

describe("MarkdownView — wiki citation tokens reach the same CitationLink", () => {
  // Scenario: Bare wiki token linkifies to the citation link component
  it("swaps a bare wiki token for a CitationLink button with a wiki-worded tooltip", () => {
    render(<MarkdownView text={"Grounded in (wiki:concept/cognitive-load § Germane load, Sweller 1988) here."} />);
    const btn = screen.getByRole("button", {
      name: "(wiki:concept/cognitive-load § Germane load, Sweller 1988)",
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("cite");
    expect(btn.getAttribute("title")).toBe("Open wiki atom concept/cognitive-load");
  });

  // Scenario: Markdown-link-style wiki citation resolves the same way
  it("renders a Markdown-link-style citation [label](wiki:atomId) as a CitationLink button", () => {
    render(<MarkdownView text={"See [Cognitive load](wiki:concept/cognitive-load) for the atom."} />);
    const btn = screen.getByRole("button", { name: "Cognitive load" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("cite");
    expect(btn.getAttribute("title")).toBe("Open wiki atom concept/cognitive-load");
  });

  it("does NOT strip a wiki: Markdown-link into a dead <a href=''>", () => {
    const { container } = render(<MarkdownView text={"See [the atom](wiki:concept/cognitive-load) here."} />);
    // The sanitiser bug signature: a left-over anchor with an empty href.
    const deadAnchor = Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === "");
    expect(deadAnchor).toBeUndefined();
  });

  it("clicking a wiki citation opens the citation detail with the store-qualified id", () => {
    const loadSpy = vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(null);
    render(<MarkdownView text={"See (wiki:concept/cognitive-load § Sources) here."} />);
    fireEvent.click(screen.getByTitle("Open wiki atom concept/cognitive-load"));
    // The one loadCitation channel carries the `wiki:` prefix so the main process
    // routes the load to the wiki store.
    expect(loadSpy).toHaveBeenCalledWith("wiki:concept/cognitive-load");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("MarkdownView — citation modal portalling", () => {
  it("the citation detail dialog is mounted OUTSIDE the citation button's <p> ancestor", () => {
    vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(null);
    const { container } = render(<MarkdownView text={"Inline ref (corpus:foundations-001) inside a paragraph."} />);
    const btn = screen.getByTitle("Open corpus document foundations-001");
    fireEvent.click(btn);

    const dialog = screen.getByRole("dialog");
    // The button lives inside a <p>; the dialog must NOT live inside the same
    // <p> — otherwise we are back to the validateDOMNesting violation and the
    // CSS/stacking-context bleed the portal exists to prevent.
    const paragraphAncestor = btn.closest("p");
    expect(paragraphAncestor).not.toBeNull();
    expect(paragraphAncestor!.contains(dialog)).toBe(false);
    // Portal target is document.body; verify the dialog's chain leads there
    // without passing through the rendered MarkdownView container.
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("closing the dialog unmounts it from the portal target", () => {
    vi.spyOn(window.cbe, "loadCitation").mockResolvedValue(null);
    render(<MarkdownView text={"See (corpus:foundations-001) here."} />);
    fireEvent.click(screen.getByTitle("Open corpus document foundations-001"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // Backdrop click triggers onClose (the outer <div> is the backdrop).
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MarkdownView — streaming-safe fallback", () => {
  it("renders identical text from the same input deterministically (memoised)", () => {
    const { container: c1 } = render(<MarkdownView text={"# stable"} />);
    const { container: c2 } = render(<MarkdownView text={"# stable"} />);
    expect(c1.innerHTML).toBe(c2.innerHTML);
  });
});
