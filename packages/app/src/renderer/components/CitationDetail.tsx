import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CitationDetail as CitationDetailDto } from "../../shared/ipc-contract.js";
// This import closes the module cycle MarkdownView -> CitationLink -> CitationDetail ->
// MarkdownView. It is safe only because every cross-reference sits inside a component
// body, evaluated after all three modules have finished initialising. A MODULE-LEVEL use
// of MarkdownView here — a default prop, a wrapper `memo()` over it, a constant derived
// from it — would read the binding during initialisation and hit its TDZ, depending on
// which module the bundler enters first.
import { MarkdownView } from "./MarkdownView.js";
import { useChrome } from "../chrome.js";

export function CitationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useChrome();
  const [data, setData] = useState<CitationDetailDto | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await window.cbe.loadCitation(id);
      if (!cancelled) setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Portal the dialog DOM to document.body so it does NOT render as a descendant
  // of the paragraph that holds the citation button. Two reasons:
  //   (1) HTML forbids a block-level <div> inside a <p>; the parser will lift
  //       the <div> out, restructure the DOM unpredictably, and React emits a
  //       validateDOMNesting warning.
  //   (2) Paragraph-scoped CSS (line-height, max-width, font-size) and any
  //       parent stacking context would otherwise bleed into the modal, making
  //       z-index, click-outside, and focus-trap behaviour non-deterministic.
  //
  // Covered by spec scenario *Citation detail modal is portalled out of the
  // chat content* in `specs/desktop-app/spec.md`.
  return createPortal(
    <div className="cite-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cite-modal-body" onClick={(e) => e.stopPropagation()}>
        <header className="cite-modal-head">
          {data === "loading" && <h3>{t.citationLoading}</h3>}
          {data === null && <h3>{t.citationNotFound({ id })}</h3>}
          {data && data !== "loading" && (
            <>
              <h3>{data.hit.title}</h3>
              {/* Corpus-only chrome (corpus version, tags) is ABSENT for a wiki atom —
                  the payload union carries no such fields for that store, so nothing is
                  rendered as an empty placeholder (capability `desktop-app`,
                  Requirement: *A Wiki Citation Token Renders as the Same Citation Link
                  and Opens the Shared Overlay Unverified*). */}
              <div className="cite-modal-meta">
                {data.store === "wiki" ? (
                  <code>wiki:{data.hit.id}</code>
                ) : (
                  <>
                    <code>{data.hit.id}</code> ·{" "}
                    {t.citationCorpusMeta({
                      version: String(data["corpus-version"]),
                      tags: data.hit.tags.join(", "),
                    })}
                  </>
                )}
                <br />
                {t.citationPathLabel} <code>{data.hit.path}</code>
              </div>
            </>
          )}
          <button className="cite-modal-close" type="button" onClick={onClose} aria-label={t.citationCloseLabel}>
            {t.citationCloseLabel}
          </button>
        </header>
        {/* The cited source is a document, so it is READ as one: the body goes through
            MarkdownView — the app's single Markdown stack — and inherits its GFM, math,
            code highlighting, citation links and raw-HTML refusal rather than being
            dumped as source into a <pre>. The payload's `body` arrives already prepared
            by the main process (frontmatter stripped, the head's own title not repeated).
            Covered by spec Requirement *The Citation Detail Renders the Cited Source as
            Markdown* in `specs/desktop-app/spec.md`. */}
        {data && data !== "loading" && (
          <div className="md-body">
            <MarkdownView text={data.body} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
