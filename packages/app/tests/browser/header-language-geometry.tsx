import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/renderer/styles.css";
import { AppHeader } from "../../src/renderer/components/AppHeader.js";
import { Workspace } from "../../src/renderer/components/Workspace.js";
import { setActiveLanguage } from "../../src/renderer/chrome.js";
import { useCbe } from "../../src/renderer/state/store.js";

const LONG_TITLE =
  "ChallengeBasedEducationModuleWithAnExtremelyLongUnbrokenCourseIdentityForHeaderGeometryVerification";

declare global {
  interface Window {
    __headerHarness: {
      setConfigured(value: boolean): void;
      setLanguage(code: string): void;
      setPanels(leftCollapsed: boolean, rightCollapsed: boolean): void;
      setUnsaved(value: boolean): void;
    };
  }
}

function Harness() {
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    useCbe.setState({
      courses: [{ id: "geometry", title: LONG_TITLE, path: "/geometry" }],
      activeCourseId: "geometry",
      leftPanelCollapsed: true,
      panelCollapsed: true,
      hydration: "error",
    });
    window.__headerHarness = {
      setConfigured,
      setLanguage: setActiveLanguage,
      setPanels(leftCollapsed, rightCollapsed) {
        useCbe.setState({ leftPanelCollapsed: leftCollapsed, panelCollapsed: rightCollapsed });
      },
      setUnsaved(value) {
        useCbe.getState().setSettingsDirtyGroup(value ? "model" : null);
      },
    };
  }, []);

  return (
    <div className="app-root">
      <AppHeader workspaceVisible={configured} configured={configured} />
      <Workspace>
        <div className="left-panel" data-testid="left" />
        <main className="chat" data-testid="chat" />
        <div className="right-panel" data-testid="right" />
      </Workspace>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
