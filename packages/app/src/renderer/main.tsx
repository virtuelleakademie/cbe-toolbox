import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { wireAgentEvents } from "./state/agentEvents.js";
import { wireWikiIngestEvents } from "./state/wikiIngest.js";
import { applyLayoutVariables } from "./util/layoutVariables.js";
import { wireInterfaceLanguage } from "./state/interfaceLanguage.js";

// One application-level agent-event subscription, demuxed by sessionId into the
// store's conversation slices (never a component effect — see state/agentEvents.ts).
wireAgentEvents();

// One application-level wiki-ingest subscription, for the same reason: the left
// panel unmounts its body when collapsed and the progress stream has no replay,
// so a component-scoped listener would lose a running ingest's events outright
// (capability `lecturer-wiki`, Requirement: Ingest Progress Outlives the Surface
// That Shows It).
wireWikiIngestEvents();

// One application-level interface-language subscription. The main process owns
// the setting and broadcasts every change; this adopts it and re-derives the
// chrome labels the canvas seeded into per-conversation state (see
// state/interfaceLanguage.ts). Never a component effect — a collapsed panel
// unmounts its body, and a torn-down listener would miss the broadcast.
wireInterfaceLanguage();

// Publish the content column's declared figures to the stylesheet before the
// first render, so `shared/layout.ts` stays their single source (Requirement:
// One Centred Content Column for the Conversation).
applyLayoutVariables();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
