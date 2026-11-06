/**
 * LaTeX math in the shared Markdown pipeline (change `render-latex-math-in-markdown`).
 *
 * Observed 2026-08-11: the assistant wrote `$\rightarrow$` and the lecturer saw
 * `$\rightarrow$`. There is exactly ONE Markdown stack in this app, so math is wired
 * into `MarkdownView` and every surface that renders assistant content gains it —
 * chat and canvas artefact cards alike.
 *
 * Covers, in `specs/desktop-app/spec.md`, Requirement *Markdown Rendering in the Chat
 * View*, scenarios:
 *   - Inline and display math render as math
 *   - The math assets are bundled, not fetched
 *   - A malformed expression does not flatten the message
 *   - Link-producing math commands are not honoured
 *   - Currency amounts are not parsed as math
 *   - A half-streamed expression is literal text, not a crash
 *   - Math follows the chat text-size setting
 * (*Math renders on a canvas artefact card too* lives in `canvas-artefact-markdown.test.tsx`,
 * next to the rest of the canvas Markdown guards.)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownView } from "../src/renderer/components/MarkdownView.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(__dirname, "../src/renderer");
const STYLES_CSS_PATH = resolve(RENDERER, "styles.css");
const MARKDOWN_VIEW_PATH = resolve(RENDERER, "components/MarkdownView.tsx");
const KATEX_CSS_PATH = resolve(__dirname, "../../../node_modules/katex/dist/katex.min.css");

/**
 * KaTeX emits the expression twice: a MathML branch (`.katex-mathml`, which carries the
 * `<annotation encoding="application/x-tex">` with the ORIGINAL source) and a visual
 * HTML branch marked `aria-hidden`. Reading the visible text therefore means reading the
 * HTML branch only — otherwise every assertion sees the LaTeX source through MathML and
 * "no LaTeX command names remain visible" would be false for correct output.
 */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const hidden of Array.from(clone.querySelectorAll(".katex-mathml"))) hidden.remove();
  return clone.textContent ?? "";
}

describe("MarkdownView — inline and display math render as math", () => {
  it("renders inline math as math, with no dollar delimiters or command names left visible", () => {
    const { container } = render(<MarkdownView text={"Engage $\\rightarrow$ Investigate"} />);

    const katex = container.querySelector(".katex");
    expect(katex).not.toBeNull();
    // The source survives in the MathML annotation — that is where the arrow came from.
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe("\\rightarrow");

    const visible = visibleText(container);
    expect(visible).toContain("Engage");
    expect(visible).toContain("Investigate");
    expect(visible).toContain("\u2192"); // typeset arrow, not the command name
    expect(visible).not.toContain("$");
    expect(visible).not.toContain("\\rightarrow");
  });

  it("renders a display block as its own centred block", () => {
    // The display form is `$$` on its own lines — the GitHub/Obsidian block dialect and
    // the only one `remark-math` treats as flow math. A single-line `$$ … $$` inside a
    // paragraph is still typeset, but inline (asserted separately below).
    const md = ["Weighting:", "", "$$", "\\frac{a}{b}", "$$", "", "and so on."].join("\n");
    const { container } = render(<MarkdownView text={md} />);

    const display = container.querySelector(".katex-display");
    expect(display).not.toBeNull();
    // Its own block, not nested inside the surrounding paragraph.
    expect(display!.closest("p")).toBeNull();
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe("\\frac{a}{b}");
    expect(visibleText(container)).not.toContain("$");
  });

  it("typesets a single-line $$…$$ span too, leaving no literal delimiters", () => {
    const { container } = render(<MarkdownView text={"The ratio $$ \\frac{a}{b} $$ matters."} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(visibleText(container)).not.toContain("$");
  });

  it("keeps math and the rest of the Markdown pipeline in the same tree", () => {
    // The single-stack rule: math must not cost GFM or citations.
    const md = ["| a | b |", "| - | - |", "| $x^2$ | (corpus:foundations-001) |"].join("\n");
    const { container } = render(<MarkdownView text={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("table .katex")).not.toBeNull();
    expect(container.querySelector("button.cite")).not.toBeNull();
  });
});

describe("MarkdownView — a malformed expression does not flatten the message", () => {
  it("renders the invalid expression as its own marked-up source and leaves the prose intact", () => {
    const md = ["A first paragraph of ordinary prose.", "", "Broken $\\frac{1}{$ here.", "", "A third paragraph."].join(
      "\n"
    );
    const { container } = render(<MarkdownView text={md} />);

    // No whole-turn fallback: the try/catch <pre> must not have fired.
    expect(container.querySelector(".md-fallback")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();

    // The bad expression is marked up locally, as its own source.
    const err = container.querySelector(".katex-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("\\frac{1}{");

    // Everything around it rendered normally.
    expect(container.querySelectorAll("p")).toHaveLength(3);
    expect(container.textContent).toContain("A first paragraph of ordinary prose.");
    expect(container.textContent).toContain("A third paragraph.");
  });

  it("surfaces no error banner or dialog to the lecturer", () => {
    const { container } = render(<MarkdownView text={"Broken $\\frac{1}{$ tail."} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("MarkdownView — link-producing math commands are not honoured", () => {
  /**
   * The attacker URL DOES survive as inert text: KaTeX echoes the rejected command's
   * source into the MathML `<annotation>`, and marks the command itself unsupported.
   * That is the correct outcome — the requirement is that no NAVIGABLE target is
   * produced, so the assertions are on elements and URL-bearing attributes, not on the
   * string appearing anywhere in the subtree.
   */
  function navigableTargets(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("*"))
      .flatMap((el) => ["href", "src", "xlink:href", "action", "formaction"].map((a) => el.getAttribute(a)))
      .filter((v): v is string => typeof v === "string");
  }

  it("produces no anchor from \\href in math", () => {
    const { container } = render(<MarkdownView text={"$\\href{https://attacker.example}{click}$"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(navigableTargets(container).join(" ")).not.toContain("attacker.example");
    // KaTeX's unsupported-command marker, i.e. the command was refused rather than run.
    expect(container.textContent).toContain("\\href");
  });

  it("produces no anchor from \\url in math either", () => {
    const { container } = render(<MarkdownView text={"$\\url{https://attacker.example}$"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(navigableTargets(container).join(" ")).not.toContain("attacker.example");
  });

  it("pins trust off at the call site so the posture cannot be loosened silently", () => {
    // The behaviour above is produced by ONE option. Guard the option itself: a future
    // `trust: true` (or a "just for \\href" carve-out) would pass the DOM assertions
    // only until someone writes a trusted command, so read it off the source. Comments
    // are stripped first so the rationale prose can name the options it does not set.
    const src = readFileSync(MARKDOWN_VIEW_PATH, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/trust:\s*false/);
    expect(src).not.toMatch(/trust:\s*true/);
    // Expansion bounds stay at their KaTeX defaults — the untrusted-input guard.
    expect(src).not.toMatch(/maxExpand\s*:/);
    expect(src).not.toMatch(/maxSize\s*:/);
  });
});

describe("MarkdownView — currency amounts are not parsed as math", () => {
  it("renders a sentence with two currency amounts as plain text with both dollar signs visible", () => {
    const sentence = "The materials budget is $200 and the excursion $150.";
    const { container } = render(<MarkdownView text={sentence} />);

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector(".katex-mathml")).toBeNull();
    expect(container.textContent).toBe(sentence);
  });

  it("declines a single-dollar span whose closing delimiter follows a space", () => {
    const sentence = "Room hire is $80 per day and catering $12 per head.";
    const { container } = render(<MarkdownView text={sentence} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe(sentence);
  });

  it("still accepts a tight single-dollar span in the same sentence shape", () => {
    // The rule must not be so blunt that it takes the feature back: `$…$` with no
    // whitespace against either delimiter is math, currency-looking neighbours or not.
    const { container } = render(<MarkdownView text={"A budget of $x_1$ per cohort."} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(visibleText(container)).not.toContain("$");
  });

  it("leaves an unpaired dollar sign alone", () => {
    const sentence = "The whole excursion costs $150.";
    const { container } = render(<MarkdownView text={sentence} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe(sentence);
  });
});

describe("MarkdownView — a half-streamed expression is literal text, not a crash", () => {
  const full = "Sequence: Engage $\\rightarrow$ Investigate $\\rightarrow$ Act.";

  it("renders every prefix of a math-carrying message without throwing or blanking it", () => {
    for (let i = 1; i <= full.length; i += 1) {
      const prefix = full.slice(0, i);
      expect(() => {
        const { container, unmount } = render(<MarkdownView text={prefix} />);
        // Never blank, and never the whole-turn <pre> fallback.
        expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
        expect(container.querySelector(".md-fallback")).toBeNull();
        unmount();
      }, `prefix length ${i}`).not.toThrow();
    }
  });

  it("shows the unterminated delimiter as literal text mid-stream", () => {
    const { container } = render(<MarkdownView text={"... Engage $\\rightar"} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$\\rightar");
  });

  it("resolves to typeset math once the closing delimiter arrives", () => {
    const { container } = render(<MarkdownView text={"... Engage $\\rightarrow$"} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(visibleText(container)).toContain("\u2192");
    expect(visibleText(container)).not.toContain("$");
  });
});

describe("Math assets are bundled, not fetched", () => {
  // jsdom loads no stylesheet, so the "no runtime network reference" guarantee is
  // asserted on what the bundler is given: a bare package specifier (resolved from
  // node_modules and emitted with the app) and a KaTeX stylesheet whose font URLs are
  // all relative. A CDN URL entering either is the failure this pins.
  const CDN_MARKERS = /(https?:)?\/\/(cdn\.|unpkg\.|jsdelivr|cdnjs|fonts\.googleapis)/i;

  it("imports the KaTeX stylesheet as a local package asset, not from a URL", () => {
    const src = readFileSync(MARKDOWN_VIEW_PATH, "utf8");
    expect(src).toContain('import "katex/dist/katex.min.css"');
    expect(src).not.toMatch(CDN_MARKERS);
  });

  it("introduces no CDN reference into the renderer stylesheet", () => {
    expect(readFileSync(STYLES_CSS_PATH, "utf8")).not.toMatch(CDN_MARKERS);
  });

  it("ships a KaTeX stylesheet whose font URLs are all relative, with the fonts present", () => {
    const css = readFileSync(KATEX_CSS_PATH, "utf8");
    const urls = Array.from(css.matchAll(/url\(([^)]+)\)/g)).map((m) => m[1]!.replace(/["']/g, ""));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, `font URL must be relative: ${url}`).toMatch(/^fonts\//);
      expect(url).not.toMatch(CDN_MARKERS);
    }
    // The relative URLs must resolve to files the bundler can emit.
    const woff2 = urls.find((u) => u.endsWith(".woff2"))!;
    expect(() => readFileSync(resolve(dirname(KATEX_CSS_PATH), woff2))).not.toThrow();
  });
});

describe("Math follows the chat text-size setting", () => {
  // Same guard style as the table/code-block text-size rules: jsdom applies no
  // stylesheet, so the rule itself is the assertion.
  const css = readFileSync(STYLES_CSS_PATH, "utf8");

  it("sizes math relative to the surrounding conversation text, never in absolute px", () => {
    const rule = css.match(/\.md \.katex\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/font-size:\s*[\d.]+em/);
    expect(rule![0]).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("keeps the chat text-size variable driving the surface math sits in", () => {
    // `.msg-text` is the carrier the setting binds to; math inherits through it via em.
    expect(css).toMatch(/\.chat-scroll\[data-chat-text-size\] \.msg-text\s*\{[^}]*font-size:\s*var\(--chat-font-size/);
  });

  it("scrolls a wide display block inside its own container", () => {
    expect(css).toMatch(/\.md \.katex-display\s*\{[^}]*overflow-x:\s*auto/);
  });
});
