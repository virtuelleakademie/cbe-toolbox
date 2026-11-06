export const CAPTURE_DEFINITION_FILES = Object.freeze([
  "scripts/user-documentation/capture-screenshots.mjs",
  "scripts/user-documentation/electron-cdp.mjs",
  "scripts/user-documentation/font-coverage.mjs",
  "scripts/user-documentation/screenshot-matrix.mjs",
  "scripts/user-documentation/scripted-provider.mjs",
]);

export function assertNoUnverifiedCitationResidue(
  { visibleText = "", unverifiedCitationStates = 0 } = {},
  relative = "documentation screenshot"
) {
  if (/\bunverified\b/i.test(visibleText)) {
    throw new Error(`${relative} contains the literal UNVERIFIED`);
  }
  if (unverifiedCitationStates !== 0) {
    throw new Error(`${relative} contains ${unverifiedCitationStates} citation(s) in an unverified state`);
  }
  return true;
}

export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  narrow: Object.freeze({ width: 775, height: 900 }),
});

/**
 * Harness-owned highlight decoration: one fixed, text-free box per entry, drawn
 * around the union of the entry's selectors. It is declared here (and therefore
 * part of the capture-definition fingerprint), never injected ad hoc.
 */
export const HIGHLIGHT_STYLE = Object.freeze({
  color: "#e8590c",
  borderWidth: 3,
  padding: 4,
  radius: 8,
});

/**
 * The bounded documentation tour. `setup` names a production-boundary driver in
 * capture-screenshots.mjs; `ready` is a semantic browser predicate, never a delay.
 * `highlights` (optional) maps a state to its declared highlight boxes; each box
 * is a list of selectors whose union rectangle is outlined.
 * A further view must be a deliberate spec change, not an ad-hoc capture.
 */
export const VIEW_MATRIX = Object.freeze([
  {
    id: "workspace-orientation",
    states: ["default"],
    viewports: ["desktop", "narrow"],
    setup: "workspace",
    ready: ".app-header, .chat-column, .panel-left, .workspace > .panel:not(.panel-left)",
    owners: [
      "packages/app/src/renderer/App.tsx",
      "packages/app/src/renderer/components/LeftPanel.tsx",
      "packages/app/src/renderer/components/RightPanel.tsx",
    ],
  },
  {
    id: "course-management",
    states: ["create-switch"],
    viewports: ["desktop"],
    setup: "courses",
    ready: ".proj-create-input, .proj",
    owners: ["packages/app/src/renderer/components/CoursesPanel.tsx"],
  },
  {
    id: "composer-plus-menu",
    states: ["default"],
    viewports: ["desktop"],
    setup: "composerMenu",
    ready: ".composer-menu",
    owners: ["packages/app/src/renderer/components/ChatPanel.tsx"],
  },
  {
    id: "first-use-orientation",
    states: ["default"],
    viewports: ["desktop", "narrow"],
    setup: "firstUse",
    ready: ".first-use-row:not([hidden])",
    owners: ["packages/app/src/renderer/components/FirstUseOverview.tsx"],
  },
  {
    id: "working-and-stop",
    states: ["default"],
    viewports: ["desktop"],
    setup: "working",
    ready: ".working-disclosure-trigger, .composer .send.stop",
    owners: ["packages/app/src/renderer/components/ChatPanel.tsx", "packages/app/src/renderer/state/agentEvents.ts"],
  },
  {
    id: "process-canvas",
    states: ["default"],
    viewports: ["desktop"],
    setup: "canvas",
    ready: ".step-group, .artifact",
    owners: ["packages/app/src/renderer/components/ArtifactsPanel.tsx"],
  },
  {
    id: "maturity-reading",
    states: ["default"],
    viewports: ["desktop"],
    setup: "maturity",
    ready: ".maturity-row",
    owners: ["packages/app/src/renderer/components/MaturityPanel.tsx", "packages/pi-bridge/src/maturity-mirror.ts"],
  },
  {
    id: "wiki-ingestion-progress",
    states: ["default"],
    viewports: ["desktop"],
    setup: "wikiProgress",
    ready: ".wiki-ingest-running, .wiki-ingest-done",
    owners: ["packages/app/src/renderer/components/WikiBrowser.tsx", "packages/app/src/renderer/state/wikiIngest.ts"],
  },
  {
    id: "wiki-browser",
    states: ["list", "graph"],
    viewports: ["desktop"],
    setup: "wikiBrowser",
    ready: ".wiki-browser",
    owners: ["packages/app/src/renderer/components/WikiBrowser.tsx"],
  },
  {
    id: "citation-source",
    states: ["default"],
    viewports: ["desktop"],
    setup: "citation",
    ready: ".cite-modal .md-body",
    owners: [
      "packages/app/src/renderer/components/CitationDetail.tsx",
      "packages/app/src/renderer/components/MarkdownView.tsx",
    ],
  },
  {
    id: "support-preference",
    states: ["default"],
    viewports: ["desktop"],
    setup: "support",
    ready: ".msg.msg-skill",
    owners: ["packages/pi-bridge/src/support-tool.ts", "packages/app/src/renderer/components/ChatPanel.tsx"],
  },
  {
    id: "language-selector",
    states: ["default"],
    viewports: ["desktop"],
    setup: "language",
    ready: ".header-language-listbox",
    owners: ["packages/app/src/renderer/components/AppHeader.tsx", "packages/app/src/shared/i18n/index.ts"],
  },
  {
    id: "attachment-and-wiki",
    states: ["overview"],
    viewports: ["desktop"],
    setup: "attachmentAndWiki",
    ready: ".composer-plus, .wiki-browser, .wiki-ingest-actions .pp-action",
    highlights: {
      overview: [[".composer-plus"], [".pp-tabs", ".wiki-browser"]],
    },
    owners: [
      "packages/app/src/renderer/components/ChatPanel.tsx",
      "packages/app/src/renderer/components/CoursesPanel.tsx",
      "packages/app/src/renderer/components/WikiBrowser.tsx",
    ],
  },
  {
    id: "profile",
    states: ["entry", "pane"],
    viewports: ["desktop"],
    setup: "profile",
    ready: ".app-header-right .app-header-affordance",
    highlights: {
      entry: [[".app-header-right > .app-header-affordance:last-child"]],
      pane: [
        [".profile-dim:has(.profile-dim-assumption) .profile-badge"],
        [".profile-dim:has(.profile-dim-assumption) .profile-dim-control"],
      ],
    },
    owners: [
      "packages/app/src/renderer/components/AppHeader.tsx",
      "packages/app/src/renderer/components/ProfilePanel.tsx",
      "packages/app/src/renderer/components/ProfileSettingsOverlay.tsx",
    ],
  },
  {
    id: "model-settings",
    states: ["example-values"],
    viewports: ["desktop"],
    setup: "modelSettings",
    ready: ".overlay-surface .settings-panel, .llm-conn-dirty",
    owners: [
      "packages/app/src/renderer/components/ProfileSettingsOverlay.tsx",
      "packages/app/src/renderer/components/SettingsPanel.tsx",
    ],
  },
]);

export const CAPTURE_EXECUTION_ORDER = Object.freeze([
  Object.freeze(["first-use-orientation", Object.freeze(["default"])]),
  Object.freeze(["workspace-orientation", Object.freeze(["default"])]),
  Object.freeze(["course-management", Object.freeze(["create-switch"])]),
  Object.freeze(["composer-plus-menu", Object.freeze(["default"])]),
  Object.freeze(["process-canvas", Object.freeze(["default"])]),
  Object.freeze(["maturity-reading", Object.freeze(["default"])]),
  Object.freeze(["citation-source", Object.freeze(["default"])]),
  Object.freeze(["support-preference", Object.freeze(["default"])]),
  Object.freeze(["working-and-stop", Object.freeze(["default"])]),
  Object.freeze(["attachment-and-wiki", Object.freeze(["overview"])]),
  Object.freeze(["profile", Object.freeze(["entry", "pane"])]),
  Object.freeze(["wiki-browser", Object.freeze(["list", "graph"])]),
  Object.freeze(["language-selector", Object.freeze(["default"])]),
  Object.freeze(["model-settings", Object.freeze(["example-values"])]),
  Object.freeze(["wiki-ingestion-progress", Object.freeze(["default"])]),
]);

export function assertCaptureIsolationOrder(order = CAPTURE_EXECUTION_ORDER) {
  const ids = order.map(([id]) => id);
  const working = ids.indexOf("working-and-stop");
  const wikiProgress = ids.indexOf("wiki-ingestion-progress");
  if (working < 0 || wikiProgress < 0 || working >= wikiProgress) {
    throw new Error("The held Working/Stop capture must precede the intentionally held Wiki-ingestion capture");
  }
  if (wikiProgress !== ids.length - 1) {
    throw new Error("The persistent Wiki-ingestion progress state must be the final logical capture");
  }
  if (new Set(ids).size !== VIEW_MATRIX.length || ids.length !== VIEW_MATRIX.length) {
    throw new Error("Capture execution order must cover every bounded logical view exactly once");
  }
  return true;
}

/** The declared highlight boxes for one view state (empty when it has none). */
export function highlightsFor(view, state) {
  return view.highlights?.[state] ?? [];
}

export function captureCases(locales = ["en", "de"]) {
  return VIEW_MATRIX.flatMap((view) =>
    view.states.flatMap((state) =>
      locales.flatMap((locale) =>
        view.viewports.map((viewport) => ({
          view,
          state,
          locale,
          viewport,
          filename: `${view.id}--${state}--${locale}--${viewport}.png`,
        }))
      )
    )
  );
}

export const BOUNDED_VIEW_COUNT = 15;

export function assertBoundedMatrix(matrix = VIEW_MATRIX) {
  const ids = matrix.map((view) => view.id);
  if (matrix.length !== BOUNDED_VIEW_COUNT || new Set(ids).size !== BOUNDED_VIEW_COUNT) {
    throw new Error(`Screenshot matrix must contain exactly fifteen unique logical views; got ${ids.join(", ")}`);
  }
  for (const view of matrix) {
    if (!view.states.length || !view.viewports.length || !view.owners.length || !view.setup || !view.ready) {
      throw new Error(`Incomplete screenshot declaration: ${view.id}`);
    }
    for (const viewport of view.viewports) if (!VIEWPORTS[viewport]) throw new Error(`Unknown viewport: ${viewport}`);
    for (const [state, boxes] of Object.entries(view.highlights ?? {})) {
      if (!view.states.includes(state)) throw new Error(`${view.id} highlights undeclared state ${state}`);
      if (!boxes.length || boxes.some((box) => !Array.isArray(box) || !box.length)) {
        throw new Error(`${view.id}:${state} declares an empty highlight box`);
      }
    }
  }
  assertCaptureIsolationOrder();
  return true;
}
