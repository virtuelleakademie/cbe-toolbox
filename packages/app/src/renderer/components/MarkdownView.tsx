import { memo, useMemo, type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { citationRemarkPlugin, CITATION_URL_PREFIX } from "../util/citation-plugin.js";
import { WIKI_CITATION_PREFIX } from "../../shared/ipc-contract.js";
import { mathDollarGuardPlugin } from "../util/math-dollar-guard.js";
import { CitationLink } from "./CitationLink.js";
// KaTeX's stylesheet travels WITH the app: a bare package import, resolved from
// node_modules and emitted by the bundler together with the 60 font files it
// references relatively (`url(fonts/KaTeX_*.woff2)`). No CDN URL enters the renderer —
// a packaged app may have no network at all, and an Electron renderer fetching its
// styling at runtime is a remote dependency we have no reason to take on.
// (`desktop-app`, Requirement: Markdown Rendering in the Chat View — "Local assets only".)
import "katex/dist/katex.min.css";

// Most models do NOT emit the bare `(corpus:<id> …)` / `(wiki:<atomId> …)` token the
// skill asks for — trained on Markdown, they wrap citations in link syntax
// `[label](corpus:<id>)`, `[label](wiki:<atomId>)` or `[label](cbe-citation://<id>)`.
// All of our schemes must survive react-markdown's defaultUrlTransform, which otherwise
// whitelists only http/https/mailto/tel and strips every other scheme to "" — silently
// turning a citation into a dead `<a href="">`. We pass our schemes through; the
// components.a override below relies on the scheme prefix being present to swap in the
// CitationLink.
const RAW_CORPUS_PREFIX = "corpus:";
const RAW_WIKI_PREFIX = WIKI_CITATION_PREFIX;

function urlTransform(url: string, key: string, node: unknown): string {
  if (url.startsWith(CITATION_URL_PREFIX)) return url;
  if (url.startsWith(RAW_CORPUS_PREFIX)) return url;
  if (url.startsWith(RAW_WIKI_PREFIX)) return url;
  return defaultUrlTransform(url, key, node);
}

// Extract the store-qualified citation id from any citation scheme:
//   cbe-citation://<id>   (emitted by the remark plugin for bare tokens; `<id>` keeps
//                          the `wiki:` prefix for an atom and is bare for corpus)
//   corpus:<id>           (a model-authored Markdown-link citation — prefix stripped,
//                          corpus ids travel bare)
//   wiki:<atomId>         (a model-authored Markdown-link citation — kept WHOLE, the
//                          prefix is what marks the id as a wiki atom downstream)
// Returns null for any other href so normal links fall through unchanged.
function citationIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith(CITATION_URL_PREFIX)) return href.slice(CITATION_URL_PREFIX.length).trim() || null;
  if (href.startsWith(RAW_WIKI_PREFIX)) return href.trim().slice(RAW_WIKI_PREFIX.length).trim() ? href.trim() : null;
  if (href.startsWith(RAW_CORPUS_PREFIX)) return href.slice(RAW_CORPUS_PREFIX.length).trim() || null;
  return null;
}

/**
 * KaTeX runs on MODEL-authored input, so every option below is set against that, and
 * none of them is the library default. Rationale per line (design.md § *Options KaTeX
 * runs with, and why each is not the default*):
 */
const KATEX_OPTIONS = {
  // Do not throw. A throw would escape rehype-katex into MarkdownView's try/catch and
  // replace the ENTIRE turn with the <pre> fallback — one bad \frac would flatten a
  // whole answer. With this off, the bad expression alone renders as its own marked-up
  // source and the surrounding paragraphs are untouched.
  throwOnError: false,
  // Warn, do not fail, on unknown or non-standard constructs. The alternative turns a
  // minor dialect difference between what the model writes and what KaTeX knows into a
  // broken message.
  strict: false,
  // The math is untrusted input, so link-producing commands (\href, \url) stay
  // unavailable — KaTeX renders them as an unsupported-command marker instead of an
  // anchor. This is the same posture `skipHtml` takes on the surrounding Markdown, and
  // it must not be loosened quietly.
  trust: false,
  // NOT SET, on purpose: `maxExpand` / `maxSize`. Their KaTeX defaults are the guard
  // against a pathological macro expansion from untrusted input; raising or lowering
  // either needs its own reason, and this change has none.
} as const;

/**
 * MarkdownView renders pi-agent output as GitHub-flavoured markdown with citation
 * links and syntax-highlighted code. It is designed to be safe to call on partial
 * streams: react-markdown re-parses on every render, but the result of stable input
 * is memoised so React only diffs the final tree.
 *
 * Streaming hardening:
 *   - skipHtml=true: no raw HTML passes through the parser (safety + simpler tree).
 *   - try/catch around the render: if a malformed half-token throws, fall back to
 *     a <pre> with the original text rather than blanking the chat bubble.
 *   - useMemo: identical `text` returns the identical tree, so list/table layouts
 *     don't get re-mounted and lose scroll position when only siblings re-render.
 *   - math survives half-arrived text: a delta ending mid-expression (`$\rightar`)
 *     leaves an unterminated span, which remark-math leaves as literal text. The noise
 *     lasts one delta and resolves on the next.
 *
 * This is the app's ONLY Markdown stack, so everything wired here — GFM, citations,
 * highlighting, math — reaches every surface that renders assistant content, the canvas
 * artefact cards included. That is the single-stack rule, not a second implementation.
 */
function MarkdownViewImpl({ text }: { text: string }) {
  return useMemo(() => {
    try {
      return (
        <div className="md">
          <ReactMarkdown
            skipHtml
            // Order matters: remarkMath contributes the `$…$` / `$$…$$` syntax, the
            // guard then declines the single-dollar spans that are prose rather than
            // math and restores their source as text — which the citation plugin must
            // see as text to linkify a token that sat inside one.
            remarkPlugins={[remarkGfm, remarkMath, mathDollarGuardPlugin, citationRemarkPlugin]}
            rehypePlugins={[
              [rehypeHighlight, { detect: true, ignoreMissing: true }],
              [rehypeKatex, KATEX_OPTIONS],
            ]}
            urlTransform={urlTransform}
            components={{
              a: ({ href, children, ...rest }: ComponentProps<"a">) => {
                const id = citationIdFromHref(href);
                if (id) {
                  const raw =
                    typeof children === "string"
                      ? children
                      : Array.isArray(children)
                        ? children.join("")
                        : // The last-resort label: a wiki id already carries its store
                          // prefix, a corpus id travels bare and gets it re-attached.
                          `(${id.startsWith(WIKI_CITATION_PREFIX) ? id : `corpus:${id}`})`;
                  return <CitationLink id={id} raw={raw} />;
                }
                return (
                  <a href={href} {...rest} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      );
    } catch (err) {
      console.warn("[MarkdownView] render failed, falling back to plain text", err);
      return (
        <div className="md md-fallback">
          <pre>{text}</pre>
        </div>
      );
    }
  }, [text]);
}

export const MarkdownView = memo(MarkdownViewImpl);
