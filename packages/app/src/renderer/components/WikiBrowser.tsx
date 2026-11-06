import { useCallback, useEffect, useMemo, useState } from "react";
import type { WikiAtomSummary } from "../../shared/ipc-contract.js";
import { EMPTY_WIKI_INGEST_RUN, useCbe } from "../state/store.js";
import { abortWikiIngest, startWikiIngest } from "../state/wikiIngest.js";
import { MarkdownView } from "./MarkdownView.js";
import { ActionIcon } from "./ActionIcon.js";
import { useChrome } from "../chrome.js";

/**
 * Wiki browse / search / knowledge-graph surface for one course (capability
 * `lecturer-wiki`, Requirement: Wiki Is Browsable and Searchable in the App)
 * plus the ingestion entry point (Requirement: Ingestion of Existing Teaching
 * Materials — atomization runs in isolated subagent sessions with per-document
 * progress and an abort control).
 */
export function WikiBrowser({ courseId }: { courseId: string }) {
  const t = useChrome();
  const [atoms, setAtoms] = useState<WikiAtomSummary[]>([]);
  const [invalid, setInvalid] = useState<Array<{ relPath: string; errors: string[] }>>([]);
  const [query, setQuery] = useState("");
  const [openAtom, setOpenAtom] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");
  const [error, setError] = useState<string | null>(null);
  // Completion is application state, scoped to this course. A replacement
  // browser mounted mid-run observes the same revision as the instance that
  // started it; no component callback survives an unmount.
  const atomRevision = useCbe((s) => s.wikiAtomRevision[courseId] ?? 0);

  const refresh = useCallback(() => {
    void window.cbe
      .listWikiAtoms(courseId)
      .then((result) => {
        setAtoms(result.atoms);
        setInvalid(result.invalid);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [courseId]);

  useEffect(() => {
    refresh();
  }, [refresh, atomRevision]);

  // Search matches frontmatter (title, aliases, type) AND body content
  // (Scenario: Search for an atom in the app).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return atoms;
    return atoms.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        a.aliases.some((al) => al.toLowerCase().includes(q)) ||
        a.body.toLowerCase().includes(q)
    );
  }, [atoms, query]);

  const current = openAtom ? (atoms.find((a) => a.relPath === openAtom) ?? null) : null;

  if (current) {
    return (
      <div className="wiki-atom-detail">
        <button type="button" className="pp-back" onClick={() => setOpenAtom(null)}>
          {t.wikiBack}
        </button>
        <div className="pp-kicker mono">
          {t.wikiAtomMeta({ type: current.type, confidence: String(current.confidence), updated: current.updated })}
        </div>
        <h3 className="wiki-atom-title">{current.title}</h3>
        <MarkdownView text={current.body} />
        {current.related.length > 0 && (
          <div className="wiki-atom-related">
            <div className="pp-sub mono">{t.wikiRelated}</div>
            {current.related.map((r) => {
              const target = resolveWikilink(r, atoms);
              return target ? (
                <button key={r} type="button" className="pp-action" onClick={() => setOpenAtom(target.relPath)}>
                  {target.title}
                </button>
              ) : (
                <span key={r} className="wiki-atom-related-missing mono">
                  {r}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wiki-browser">
      <div className="wiki-toolbar">
        <input
          type="search"
          className="wiki-search"
          placeholder={t.wikiSearchPlaceholder}
          aria-label={t.wikiSearchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="pp-icon-btn"
          aria-label={view === "list" ? t.wikiKnowledgeGraph : t.wikiList}
          title={view === "list" ? t.wikiKnowledgeGraph : t.wikiList}
          onClick={() => setView(view === "list" ? "graph" : "list")}
        >
          <ActionIcon kind={view === "list" ? "graph" : "list"} />
        </button>
      </div>
      {error && (
        <div className="banner-error" role="alert">
          {error}
        </div>
      )}
      <WikiIngest courseId={courseId} />
      {invalid.length > 0 && (
        <div className="wiki-invalid" role="alert">
          {t.wikiInvalidAtoms({ count: invalid.length })}
        </div>
      )}
      {view === "graph" ? (
        <WikiGraph atoms={filtered} onOpen={setOpenAtom} />
      ) : filtered.length === 0 ? (
        <div className="pp-empty">{atoms.length === 0 ? t.wikiEmpty : t.wikiNoMatches}</div>
      ) : (
        filtered.map((a) => (
          <button key={a.relPath} type="button" className="wiki-atom-row" onClick={() => setOpenAtom(a.relPath)}>
            <span className="wiki-atom-row-title">{a.title}</span>
            <span className="wiki-atom-row-meta mono">{t.wikiAtomRowMeta({ type: a.type, updated: a.updated })}</span>
            <span className="wiki-atom-row-preview">{a.body.trim().slice(0, 120)}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** Resolve a `[[wikilink]]` (or plain reference) to a loaded atom. */
function resolveWikilink(link: string, atoms: WikiAtomSummary[]): WikiAtomSummary | null {
  const target = link.replace(/^\[\[|\]\]$/g, "").trim();
  const stem = target.split("/").pop() ?? target;
  return (
    atoms.find((a) => a.relPath === target || a.relPath === `${target}.md`) ??
    atoms.find((a) => a.title === stem) ??
    null
  );
}

/**
 * Knowledge-graph view (Scenario: Knowledge graph shows atom relationships):
 * atoms as nodes on a circle, `related:` wikilinks as edges, every node
 * clickable through to the atom.
 */
function WikiGraph({ atoms, onOpen }: { atoms: WikiAtomSummary[]; onOpen: (relPath: string) => void }) {
  const t = useChrome();
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 60;
  const positions = new Map(
    atoms.map((a, i) => {
      const angle = (2 * Math.PI * i) / Math.max(atoms.length, 1) - Math.PI / 2;
      return [a.relPath, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }] as const;
    })
  );
  const edges: Array<{ from: string; to: string }> = [];
  for (const a of atoms) {
    for (const link of a.related) {
      const target = resolveWikilink(link, atoms);
      if (target && target.relPath !== a.relPath) edges.push({ from: a.relPath, to: target.relPath });
    }
  }
  if (atoms.length === 0) {
    return <div className="pp-empty">{t.wikiNothingToGraph}</div>;
  }
  return (
    <svg className="wiki-graph" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t.wikiGraphLabel}>
      {edges.map((e, i) => {
        const from = positions.get(e.from)!;
        const to = positions.get(e.to)!;
        return (
          <line
            key={`${e.from}->${e.to}-${i}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className="wiki-graph-edge"
            data-testid="wiki-graph-edge"
          />
        );
      })}
      {atoms.map((a) => {
        const pos = positions.get(a.relPath)!;
        return (
          <g
            key={a.relPath}
            className="wiki-graph-node"
            role="button"
            tabIndex={0}
            aria-label={t.wikiOpenAtom({ title: a.title })}
            onClick={() => onOpen(a.relPath)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(a.relPath)}
          >
            <circle cx={pos.x} cy={pos.y} r={8} />
            <text x={pos.x} y={pos.y - 12} textAnchor="middle">
              {a.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Ingestion entry point + per-document progress + abort.
 *
 * A PURE READER of the run record (capability `lecturer-wiki`, Requirement:
 * Ingest Progress Outlives the Surface That Shows It). It owns none of the run's
 * state and subscribes to nothing: the record lives in the store and is fed by
 * the one application-level subscription in `state/wikiIngest.ts`, because this
 * component is unmounted — not hidden — whenever the left panel is collapsed.
 * What it renders is unchanged; what survives a collapse cycle is not.
 *
 * Reading and starting bind to DIFFERENT ids, and collapsing them back into one
 * reintroduces one of two defects:
 *
 *  - READ — `courseId`, the course this surface is rendered inside. A run belongs
 *    to the course it was started in for its whole life: the main process
 *    resolves the active course ONCE at handler entry and every progress event
 *    of that run carries that id, so a mid-run course switch misfiles nothing.
 *    Reading the live `activeCourseId` instead would detach this panel from its
 *    own running record the moment the lecturer activates another course —
 *    rows gone, abort withdrawn, the start button re-armed behind a run that is
 *    still going.
 *  - START — never this prop, and only ever offered where the two coincide.
 *    Material is ingested into the ACTIVE course and nowhere else (capability
 *    `lecturer-wiki`, Requirement: An Ingest Belongs to the Course It Was
 *    Started In), while opening a course's detail level does not activate it —
 *    so a non-active course's surface offers NO start control at all, and says
 *    that the course must be activated instead. Offering it disabled would be
 *    worse than useless: it would show a control whose only truthful action is
 *    elsewhere. `startWikiIngest` still takes the active course from the store
 *    itself, so the id the record is keyed by is the id the host will stamp.
 *
 * ABORT follows READ: it ends the record this panel is showing, which is the run
 * whose rows the lecturer is looking at. That is why the rows, the notice and
 * the abort control stay here for a course the lecturer has since DEACTIVATED —
 * its run goes on (rule 2), and this surface is the one place it is shown. Like
 * START it is driven from `state/wikiIngest.ts` rather than from here, and for
 * the same reason — the component is unmounted whenever the left panel is
 * collapsed.
 */
function WikiIngest({ courseId }: { courseId: string }) {
  const t = useChrome();
  const run = useCbe((s) => s.wikiIngest[courseId]) ?? EMPTY_WIKI_INGEST_RUN;
  const isActiveCourse = useCbe((s) => s.activeCourseId === courseId);

  return (
    <div className="wiki-ingest">
      <div className="wiki-ingest-actions">
        {isActiveCourse ? (
          <button type="button" className="pp-action" disabled={run.running} onClick={() => void startWikiIngest()}>
            {t.wikiIngestLabel}
          </button>
        ) : (
          // A deactivated course keeps its own running ingest on this very
          // surface — rows, closing notice and abort control — so the line has
          // to speak about starting a NEW run: "activate this course to ingest
          // into it" would contradict the run visibly ingesting into it right
          // beside it. It is never suppressed while a run is in flight, or the
          // lecturer loses the explanation in exactly the state most likely to
          // confuse them.
          <span className="wiki-ingest-inactive">{t.wikiIngestInactiveCourse}</span>
        )}
        {run.running && (
          <button
            type="button"
            className="pp-icon-btn pp-danger"
            aria-label={t.wikiIngestAbortLabel}
            title={t.wikiIngestAbortLabel}
            onClick={() => void abortWikiIngest(courseId)}
          >
            <ActionIcon kind="stop" />
          </button>
        )}
      </div>
      {run.docs.map((p) => (
        <div key={p.filename} className={`wiki-ingest-row wiki-ingest-${p.status}`}>
          <span className="wiki-ingest-name">{p.filename}</span>
          <span className="wiki-ingest-status mono">{p.status}</span>
          {p.error && <span className="wiki-ingest-error">{p.error}</span>}
        </div>
      ))}
      {run.notice && <div className="wiki-ingest-notice">{run.notice}</div>}
    </div>
  );
}
