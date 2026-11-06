import { useEffect, useState } from "react";
import { CitationDetail } from "./CitationDetail.js";
import { sectionFromToken } from "../util/citation-plugin.js";
import { WIKI_CITATION_PREFIX, type CitationVerification } from "../../shared/ipc-contract.js";
import { useChrome } from "../chrome.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";
import { useCbe } from "../state/store.js";

/**
 * A citation token, verified against the corpus before it is presented as a checked
 * citation (capability `desktop-app`, Requirement: *A Citation Token Is Verified Against
 * the Corpus Before It Is Linked*).
 *
 * WHY THIS EXISTS. Since the product ruling of 2026-08-10 the model may write a
 * `(corpus:…)` token directly instead of obtaining it from `cbe_cite` — the lecturer
 * gets the same working link either way. What the hand-written route loses is the
 * check `cbe_cite` performs on the `§` section against the document's real headings.
 * A hand-typed `§ Phase 1: Engage` on a document with no such heading is WORSE than a
 * missing section, because it looks precise. So the host runs that same check here.
 *
 * THREE STATES, AND ONLY THE EXCEPTION IS MARKED:
 *   - verified          → exactly as before, no extra chrome. Marking the norm would
 *                         train the lecturer to ignore the marker within one session.
 *   - unverified        → marked AND still clickable. The link is the lecturer's own
 *                         means of checking, so removing it in precisely the case where
 *                         she most needs to check would be backwards.
 *   - unresolved (id)   → marked and NOT a link. There is no document to open, and a
 *                         link that opens "Citation not found" is a worse answer than a
 *                         mark that says so before the click.
 *
 * PENDING RENDERS UNMARKED. Pessimistic marking that later clears would flash
 * "unverified" on every citation at first paint. The window is one local lookup on an
 * already-cached resolver; a failed IPC is a host fault and must not be shown to the
 * lecturer as a citation defect.
 *
 * WIKI TOKENS ARE NEVER VERIFIED. A `wiki:`-prefixed id names an atom of the lecturer's
 * OWN wiki: `cbe_cite` validated the token against the wiki index at production time,
 * and the three-state machinery above exists as a backstop for a shared store the
 * lecturer does not curate. So a wiki citation makes no verification IPC call, carries
 * no marker in any state, and stays clickable unconditionally — a bad atom id costs one
 * click and lands in the overlay's not-found state (capability `desktop-app`,
 * Requirement: *A Wiki Citation Token Renders as the Same Citation Link and Opens the
 * Shared Overlay Unverified*).
 */

/** Cache keyed `id\u0000section` — a re-render, and a second identical token in the
 * same conversation, cost nothing. Module-level on purpose: the corpus does not change
 * within a session, and the resolver behind the IPC is itself cached. */
const cache = new Map<string, Promise<CitationVerification>>();

function verify(id: string, section: string | null): Promise<CitationVerification> {
  const key = `${id}\u0000${section ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = window.cbe.verifyCitation({ id, section });
  cache.set(key, pending);
  return pending;
}

/** Test seam: a suite that changes the stubbed corpus must not read a stale verdict. */
export function __resetCitationVerificationCache(): void {
  cache.clear();
}

/** One line the lecturer can read without clicking, in the interface language. */
function explain(v: CitationVerification, t: ChromeCatalogue): string {
  switch (v.status) {
    case "unknown-id":
      return t.citationUnknownId({ id: v.id });
    case "missing-section":
      return t.citationMissingSection({ id: v.id });
    case "unknown-section":
      return t.citationUnknownSection({ section: v.section, id: v.id });
    default:
      return "";
  }
}

export function CitationLink({ id, raw }: { id: string; raw: string }) {
  const t = useChrome();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<CitationVerification | null>(null);
  const section = sectionFromToken(raw);
  const isWiki = id.startsWith(WIKI_CITATION_PREFIX);

  // Readiness hides (but never acknowledges) first-use orientation while this
  // existing modal owns focus. The modal itself remains locally owned here.
  useEffect(
    () => () => {
      if (open) useCbe.getState().setModalSurfaceOpen(false);
    },
    [open]
  );

  useEffect(() => {
    // Wiki tokens skip the verify path entirely — no call, so no verdict ever lands
    // and none of the marked branches below can fire (see the header comment).
    if (isWiki) return;
    let cancelled = false;
    void verify(id, section)
      .then((v) => {
        if (!cancelled) setVerdict(v);
      })
      // A host-side failure is not a citation defect: leave the token unmarked.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, section, isWiki]);

  const unresolved = verdict?.status === "unknown-id";
  const unverified = verdict?.status === "missing-section" || verdict?.status === "unknown-section";
  const note = verdict && verdict.status !== "verified" ? explain(verdict, t) : "";

  if (unresolved) {
    // Not a link: there is nothing behind it to open.
    return (
      <span className="cite cite-unresolved" title={note} aria-label={note} data-citation-state="unresolved">
        {raw}
        <span className="cite-flag" aria-hidden="true">
          {t.citationUnresolvedFlag}
        </span>
      </span>
    );
  }

  return (
    <>
      <button
        className={unverified ? "cite cite-unverified" : "cite"}
        type="button"
        onClick={() => {
          useCbe.getState().setModalSurfaceOpen(true);
          setOpen(true);
        }}
        title={
          note ||
          (isWiki
            ? t.citationOpenWikiAtom({ id: id.slice(WIKI_CITATION_PREFIX.length) })
            : t.citationOpenCorpusDocument({ id }))
        }
        {...(unverified ? { "aria-label": note } : {})}
        // "wiki" is a STEADY state — the token is not waiting for a verdict that will
        // never be requested, so "pending" would misdescribe it.
        data-citation-state={isWiki ? "wiki" : unverified ? "unverified" : verdict ? "verified" : "pending"}
      >
        {raw}
        {unverified && (
          <span className="cite-flag" aria-hidden="true">
            {t.citationUnverifiedFlag}
          </span>
        )}
      </button>
      {open && (
        <CitationDetail
          id={id}
          onClose={() => {
            useCbe.getState().setModalSurfaceOpen(false);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
