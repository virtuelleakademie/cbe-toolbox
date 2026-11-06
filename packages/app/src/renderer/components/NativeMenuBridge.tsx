import { useEffect, useMemo, useRef } from "react";
import type { NativeMenuAvailability, NativeMenuCommand } from "../../shared/ipc-contract.js";
import { useCbe } from "../state/store.js";
import { useHelpDispatch } from "./ChatPanel.js";

export interface NativeMenuRendererState {
  configured: boolean;
  hydration: "idle" | "pending" | "ready" | "error";
  hasSession: boolean;
  streaming: boolean;
  dispatchPending: boolean;
  modalSurfaceOpen: boolean;
  overlayOpen: boolean;
}

/** The native menu is a projection of existing action gates, never another state owner. */
export function nativeMenuAvailability(state: NativeMenuRendererState): NativeMenuAvailability {
  const overlayBlocked = !state.configured
    ? { enabled: false as const, reason: "not-ready" as const }
    : state.modalSurfaceOpen
      ? { enabled: false as const, reason: "modal" as const }
      : { enabled: true as const, reason: null };

  const help =
    state.modalSurfaceOpen || state.overlayOpen
      ? { enabled: false as const, reason: "modal" as const }
      : !state.configured || !state.hasSession || state.hydration !== "ready"
        ? { enabled: false as const, reason: "not-ready" as const }
        : state.streaming || state.dispatchPending
          ? { enabled: false as const, reason: "busy" as const }
          : { enabled: true as const, reason: null };

  return { settings: overlayBlocked, about: overlayBlocked, help };
}

/**
 * One application-level bridge between Electron's menu and the existing renderer
 * actions. The listener is installed once; a ref supplies the current shared Help
 * dispatcher without tearing down and re-registering on every lock transition.
 */
export function NativeMenuBridge() {
  const configured = useCbe((state) => state.configured);
  const hydration = useCbe((state) => state.hydration);
  const session = useCbe((state) => state.session);
  const streaming = useCbe((state) => state.live.streaming);
  const dispatchPending = useCbe((state) => state.dispatchPending);
  const modalSurfaceOpen = useCbe((state) => state.modalSurfaceOpen);
  const overlayOpen = useCbe((state) => state.overlaySection !== null);

  const availability = useMemo(
    () =>
      nativeMenuAvailability({
        configured,
        hydration,
        hasSession: session !== null,
        streaming,
        dispatchPending,
        modalSurfaceOpen,
        overlayOpen,
      }),
    [configured, hydration, session, streaming, dispatchPending, modalSurfaceOpen, overlayOpen]
  );
  const { dispatchHelp, announcement } = useHelpDispatch(session?.sessionId ?? "", !availability.help.enabled);
  const dispatchHelpRef = useRef(dispatchHelp);
  dispatchHelpRef.current = dispatchHelp;

  useEffect(() => {
    void window.cbe.setNativeMenuAvailability(availability).catch(() => {
      // A window closing while this projection is in flight is a safe no-op.
    });
  }, [availability]);

  useEffect(() => {
    return window.cbe.onNativeMenuCommand((command: NativeMenuCommand) => {
      const state = useCbe.getState();
      const current = nativeMenuAvailability({
        configured: state.configured,
        hydration: state.hydration,
        hasSession: state.session !== null,
        streaming: state.live.streaming,
        dispatchPending: state.dispatchPending,
        modalSurfaceOpen: state.modalSurfaceOpen,
        overlayOpen: state.overlaySection !== null,
      });
      if (command === "open-settings" && current.settings.enabled) state.showSettingsSurface("settings");
      else if (command === "open-about" && current.about.enabled) state.showAboutSurface();
      else if (command === "request-help" && current.help.enabled) dispatchHelpRef.current();
    });
  }, []);

  return (
    <span className="visually-hidden" aria-live="polite" data-native-menu-announcement>
      {announcement}
    </span>
  );
}
