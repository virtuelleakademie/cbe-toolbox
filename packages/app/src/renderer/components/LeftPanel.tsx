import { backgroundCourseActivity, useCbe, wikiIngestActivity } from "../state/store.js";
import { CoursesPanel } from "./CoursesPanel.js";
import { PanelTabIcon, PanelChevronIcon } from "./PanelTabIcon.js";
import { useChrome } from "../chrome.js";

const PANEL_ID = "left-panel-content";

/**
 * Left-panel container — the course-management surface (capability `desktop-app`,
 * Requirements: Collapsible Left Panel; Course Management in the UI).
 *
 * **A peer of the right panel, not a lesser sibling.** Every capability the right
 * panel has, this one has under the SAME rule: two states and no third, an icon
 * rail carrying the lecturer's accent, an edge toggle with `aria-expanded`, the
 * open LEVEL preserved across any number of collapse cycles, a session-scoped
 * collapse state that is never persisted, a width that IS persisted, and keyboard
 * operability throughout. The two are independent — neither one's state changes as
 * a side effect of the other's, except under the width arbitration of Requirement:
 * The Chat Column Survives Two Flanking Panels.
 *
 * **Default: collapsed** (product decision 2026-08-14). The workspace opens on the
 * design work with navigation one click away. That costs no reachability, because
 * the header's active-course name is a third path into this panel (Requirement: App
 * Header Strip) — which is exactly why removing the header's switcher dropdown and
 * collapsing this panel by default do not compound into a navigation dead end.
 *
 * The panel's LEVEL (course list vs. a course's detail) lives in the store rather
 * than in `CoursesPanel`'s local state: the body is not rendered while collapsed,
 * so a component-local level would be lost on every collapse cycle.
 */
export function LeftPanel() {
  const t = useChrome();
  const collapsed = useCbe((s) => s.leftPanelCollapsed);
  const toggleLeftPanelCollapsed = useCbe((s) => s.toggleLeftPanelCollapsed);
  const setLeftPanelCollapsed = useCbe((s) => s.setLeftPanelCollapsed);
  const conversations = useCbe((s) => s.conversations);
  const activeCourseId = useCbe((s) => s.activeCourseId);
  const wikiIngest = useCbe((s) => s.wikiIngest);

  // A collapsed panel must not hide a background completion — the removed header
  // dropdown used to cover that case (Requirement: Background Conversations and
  // Per-Session Event Demultiplexing).
  const aggregate = backgroundCourseActivity(conversations, activeCourseId);
  const aggregateNote = aggregate.running
    ? t.panelAgentRunningElsewhere
    : aggregate.unseen
      ? t.panelRunFinishedElsewhere
      : null;

  // …and it must not hide a RUNNING INGEST either: collapsing a panel cancels
  // nothing, and the interface must not suggest otherwise (capability
  // `lecturer-wiki`, Requirement: Ingest Progress Outlives the Surface That Shows
  // It). It rides THIS marker rather than getting a second progress surface of
  // its own — two surfaces rendering one run drift apart — and its count is a
  // pure derivation over the same records the expanded panel lists row by row.
  const ingest = wikiIngestActivity(wikiIngest);
  const ingestNote = ingest.running ? t.panelIngestRunning({ settled: ingest.settled, total: ingest.total }) : null;
  // Both halves, in a fixed order with a fixed separator, so the accessible name
  // stays one readable sentence when both apply.
  const railNote = [ingestNote, aggregateNote].filter(Boolean).join(" — ") || null;

  return (
    <aside className="panel panel-left" data-collapsed={collapsed} aria-label={t.panelLeftLabel}>
      <button
        type="button"
        className="panel-edge-toggle panel-edge-toggle-left"
        aria-expanded={!collapsed}
        aria-controls={PANEL_ID}
        aria-label={collapsed ? t.panelExpandLeft : t.panelCollapseLeft}
        title={collapsed ? t.panelExpandLeft : t.panelCollapseLeft}
        onClick={() => toggleLeftPanelCollapsed()}
      >
        <PanelChevronIcon direction={collapsed ? "right" : "left"} />
      </button>

      {collapsed ? (
        <nav className="panel-rail" aria-label={t.panelLeftLabel}>
          <button
            type="button"
            className="panel-rail-btn"
            // One icon, and it is always the surface this rail opens — so it always
            // carries the lecturer's accent, the treatment the right rail gives its
            // selected tab. `data-current` rather than `aria-current`: with a set of
            // one there is no "current item among others" to announce.
            data-current="true"
            data-attention={railNote ? "true" : undefined}
            aria-label={railNote ? t.panelOpenCoursesWithNote({ note: railNote }) : t.panelOpenCourses}
            title={railNote ? t.panelCoursesTitleWithNote({ note: railNote }) : t.panelCoursesTitle}
            onClick={() => setLeftPanelCollapsed(false)}
          >
            <PanelTabIcon tab="courses" />
            {railNote && <span className="panel-attention-dot" aria-hidden="true" />}
          </button>
        </nav>
      ) : (
        <div className="panel-content" id={PANEL_ID}>
          <h2 className="visually-hidden">{t.panelCoursesTitle}</h2>
          <CoursesPanel />
        </div>
      )}
    </aside>
  );
}
