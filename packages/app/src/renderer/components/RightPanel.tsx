import { useEffect } from "react";
import { useCbe, type PanelTab } from "../state/store.js";
import { ArtifactsPanel } from "./ArtifactsPanel.js";
import { MaturityPanel } from "./MaturityPanel.js";
import { PanelTabIcon, PanelChevronIcon } from "./PanelTabIcon.js";
import { useChrome } from "../chrome.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";

/** The panel's tab inventory and ORDER, governed by Requirement: Collapsible
 * Right Panel. Exactly two, both of them course-scoped work surfaces. The ids are
 * the untouched store slice keys; the labels are the surfaces the lecturer reads —
 * the retired word "Artifacts" is not a label any more. */
function tabs(t: ChromeCatalogue): { id: PanelTab; label: string }[] {
  return [
    { id: "artifacts", label: t.panelCanvasTab },
    { id: "maturity", label: t.panelMaturityTab },
  ];
}

const PANEL_ID = "right-panel-content";

/**
 * Right-panel container. Exactly two tabs, in this order:
 *   - CBE Process Canvas (the design-flow canvas)
 *   - CBE Maturity       (PIONEER maturity raster — current vs target per criterion)
 *
 * **The panel holds only what belongs to the course.** Course management is the
 * LEFT panel's (`LeftPanel.tsx`), and the lecturer profile and the application
 * settings are reached from two of the header's top-right affordances — none of
 * the three may be reintroduced as a tab here (capability `desktop-app`, Requirement:
 * Collapsible Right Panel).
 *
 * The panel is collapsible and starts **expanded** on the canvas tab (product authority
 * decision 2026-08-14 — the workspace opens on the design work, with navigation one
 * click away in the left rail). Clicking a rail icon expands the panel AND selects
 * that tab; the edge toggle collapses/expands without changing the active tab.
 * Collapse state is session-scoped (store default `false`), never persisted — it
 * re-defaults on every fresh mount exactly as before the default was swapped.
 *
 * The `defaultTab` only applies on first mount — subsequent navigation is preserved in
 * the store while the renderer stays alive. (`panelTab` resets on page reload because
 * the store hydrates from defaults, not from localStorage.)
 *
 * The panel also FOLLOWS the agent's artefact work (Requirement: Panel Follows the
 * Agent's Artefact Work): the CBE Process Canvas tab carries an attention marker — on
 * the tab button and on the rail icon, so it survives a collapsed panel — while
 * artefact changes have not been seen. Every deliberate navigation here is reported to
 * the store, which disarms the one-time reveal; the mount-time `defaultTab` hydration
 * is deliberately NOT such a navigation.
 */
export function RightPanel({ defaultTab = "artifacts" }: { defaultTab?: PanelTab }) {
  const t = useChrome();
  const TABS = tabs(t);
  const panelTab = useCbe((s) => s.panelTab);
  const setPanelTab = useCbe((s) => s.setPanelTab);
  const collapsed = useCbe((s) => s.panelCollapsed);
  const setPanelCollapsed = useCbe((s) => s.setPanelCollapsed);
  const togglePanelCollapsed = useCbe((s) => s.togglePanelCollapsed);
  const attention = useCbe((s) => s.artifactsAttention);
  const notePanelNavigation = useCbe((s) => s.notePanelNavigation);
  const clearArtifactsAttention = useCbe((s) => s.clearArtifactsAttention);

  // Hydrate default tab on first mount only.
  useEffect(() => {
    setPanelTab(defaultTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The marker clears the moment the canvas IS the visible surface — by whichever
  // route it got there (tab click, rail click, edge toggle, course switch, or the
  // one-time reveal itself). One effect covers them all.
  const canvasVisible = !collapsed && panelTab === "artifacts";
  useEffect(() => {
    if (canvasVisible && attention) clearArtifactsAttention();
  }, [canvasVisible, attention, clearArtifactsAttention]);

  return (
    <aside className="panel" data-collapsed={collapsed} aria-label={t.panelRightLabel}>
      <button
        type="button"
        className="panel-edge-toggle"
        aria-expanded={!collapsed}
        aria-controls={PANEL_ID}
        aria-label={collapsed ? t.panelExpandRight : t.panelCollapseRight}
        title={collapsed ? t.panelExpandRight : t.panelCollapseRight}
        onClick={() => {
          notePanelNavigation();
          togglePanelCollapsed();
        }}
      >
        <PanelChevronIcon direction={collapsed ? "left" : "right"} />
      </button>

      {collapsed ? (
        <nav className="panel-rail" aria-label={t.panelRightTabsLabel}>
          {TABS.map((tab) => {
            const marked = tab.id === "artifacts" && attention;
            return (
              <button
                key={tab.id}
                type="button"
                className="panel-rail-btn"
                aria-label={marked ? t.panelOpenTabUnseen({ label: tab.label }) : t.panelOpenTab({ label: tab.label })}
                title={marked ? t.panelTabUnseenTitle({ label: tab.label }) : tab.label}
                aria-current={panelTab === tab.id ? "true" : undefined}
                data-attention={marked ? "true" : undefined}
                onClick={() => {
                  notePanelNavigation();
                  setPanelTab(tab.id);
                  setPanelCollapsed(false);
                }}
              >
                <PanelTabIcon tab={tab.id} />
                {marked && <span className="panel-attention-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </nav>
      ) : (
        <>
          <div className="panel-tabs" role="tablist">
            {TABS.map((tab) => (
              <PanelTabButton
                key={tab.id}
                id={tab.id}
                active={panelTab}
                setActive={(id) => {
                  notePanelNavigation();
                  setPanelTab(id);
                }}
                label={tab.label}
                attention={tab.id === "artifacts" && attention}
              />
            ))}
          </div>
          <div className="panel-content" id={PANEL_ID}>
            {/* Each surface names itself in full. The heading is visually hidden
                because the tab bar directly above already carries the same label
                on screen — repeating it visually would be chrome noise, while a
                real heading gives assistive technology the surface name and a
                navigable landmark. */}
            <h2 className="visually-hidden">{TABS.find((tab) => tab.id === panelTab)?.label}</h2>
            {panelTab === "artifacts" && <ArtifactsPanel />}
            {panelTab === "maturity" && <MaturityPanel />}
          </div>
        </>
      )}
    </aside>
  );
}

function PanelTabButton({
  id,
  active,
  setActive,
  label,
  attention = false,
}: {
  id: PanelTab;
  active: PanelTab;
  setActive: (t: PanelTab) => void;
  label: string;
  /** Unseen artefact changes on this tab — a dot plus an accessible suffix, never
   * colour alone (Requirement: Panel Follows the Agent's Artefact Work). */
  attention?: boolean;
}) {
  const t = useChrome();
  return (
    <button
      type="button"
      role="tab"
      className="panel-tab"
      aria-current={active === id ? "true" : undefined}
      aria-selected={active === id}
      aria-label={attention ? t.panelTabUnseenLabel({ label }) : undefined}
      data-attention={attention ? "true" : undefined}
      onClick={() => setActive(id)}
    >
      {label}
      {attention && <span className="panel-attention-dot" aria-hidden="true" />}
    </button>
  );
}
