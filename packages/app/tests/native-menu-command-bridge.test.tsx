import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeMenuAvailability, NativeMenuCommand } from "../src/shared/ipc-contract.js";
import { NativeMenuBridge, nativeMenuAvailability } from "../src/renderer/components/NativeMenuBridge.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";
import { ChatPanel, HELP_TOKEN } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { seedConversation } from "./helpers/conversation.js";
import { helpEntry } from "./helpers/composer.js";

let nativeCommand: ((command: NativeMenuCommand) => void) | null;
let availabilityReports: NativeMenuAvailability[];

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation();
  useCbe.setState({ configured: true, hydration: "ready" });
  nativeCommand = null;
  availabilityReports = [];
  Object.assign(window.cbe, {
    onNativeMenuCommand: (listener: (command: NativeMenuCommand) => void) => {
      nativeCommand = listener;
      return () => {
        nativeCommand = null;
      };
    },
    setNativeMenuAvailability: async (availability: NativeMenuAvailability) => {
      availabilityReports.push(availability);
      return { ok: true as const };
    },
  });
});

function invoke(command: NativeMenuCommand) {
  act(() => nativeCommand?.(command));
}

describe("Scenario: Commands no-op safely without an eligible renderer", () => {
  it("projects not-ready, busy and modal gates from the same renderer state", () => {
    expect(
      nativeMenuAvailability({
        configured: false,
        hydration: "idle",
        hasSession: false,
        streaming: false,
        dispatchPending: false,
        modalSurfaceOpen: false,
        overlayOpen: false,
      })
    ).toEqual({
      settings: { enabled: false, reason: "not-ready" },
      about: { enabled: false, reason: "not-ready" },
      help: { enabled: false, reason: "not-ready" },
    });
    expect(
      nativeMenuAvailability({
        configured: true,
        hydration: "ready",
        hasSession: true,
        streaming: true,
        dispatchPending: false,
        modalSurfaceOpen: false,
        overlayOpen: false,
      }).help
    ).toEqual({ enabled: false, reason: "busy" });
    expect(
      nativeMenuAvailability({
        configured: true,
        hydration: "ready",
        hasSession: true,
        streaming: false,
        dispatchPending: false,
        modalSurfaceOpen: true,
        overlayOpen: false,
      })
    ).toEqual({
      settings: { enabled: false, reason: "modal" },
      about: { enabled: false, reason: "modal" },
      help: { enabled: false, reason: "modal" },
    });
  });

  it("reports readiness and refuses a residual command while a modal or run gate is active", () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<NativeMenuBridge />);
    expect(availabilityReports.at(-1)).toEqual({
      settings: { enabled: true, reason: null },
      about: { enabled: true, reason: null },
      help: { enabled: true, reason: null },
    });

    act(() => useCbe.setState({ modalSurfaceOpen: true, dispatchPending: true }));
    expect(availabilityReports.at(-1)).toEqual({
      settings: { enabled: false, reason: "modal" },
      about: { enabled: false, reason: "modal" },
      help: { enabled: false, reason: "modal" },
    });
    invoke("open-settings");
    invoke("open-about");
    invoke("request-help");
    expect(useCbe.getState().overlaySection).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Scenario: Settings and About reuse the overlay without losing work", () => {
  it("opens About directly over a dirty Model field, then generic Settings recovers that field", () => {
    render(
      <>
        <NativeMenuBridge />
        <ProfileSettingsOverlay />
      </>
    );
    invoke("open-settings");
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    const model = screen.getByPlaceholderText("model-id") as HTMLInputElement;
    fireEvent.change(model, { target: { value: "half-typed-native-menu-model" } });
    expect(useCbe.getState().settingsDirtyGroup).toBe("model");
    act(() => useCbe.getState().closeSettingsSurface());

    invoke("open-about");
    expect(useCbe.getState().overlaySection).toBe("settings");
    expect(useCbe.getState().settingsOpenGroup).toBe("about");
    expect(useCbe.getState().settingsDirtyGroup).toBe("model");
    act(() => useCbe.getState().closeSettingsSurface());

    invoke("open-settings");
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
    expect((screen.getByPlaceholderText("model-id") as HTMLInputElement).value).toBe("half-typed-native-menu-model");
  });

  it("preserves the composer draft while direct About opens and closes", () => {
    render(
      <>
        <NativeMenuBridge />
        <ChatPanel />
        <ProfileSettingsOverlay />
      </>
    );
    const composer = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "draft survives native About" } });
    composer.focus();
    invoke("open-about");
    expect(screen.getByRole("button", { name: /^about$/i }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(composer.value).toBe("draft survives native About");
    expect(document.activeElement).toBe(composer);
  });
});

describe("Scenario: Native overlay commands restore renderer focus", () => {
  it("falls back to the workspace focus target when the preserved element disappears", () => {
    let removeOpener = () => {};
    function Harness() {
      const [showOpener, setShowOpener] = useState(true);
      removeOpener = () => setShowOpener(false);
      return (
        <>
          {showOpener && (
            <button type="button" data-testid="temporary-opener">
              Temporary
            </button>
          )}
          <NativeMenuBridge />
          <ChatPanel />
          <ProfileSettingsOverlay />
        </>
      );
    }
    render(<Harness />);
    const temporary = screen.getByTestId("temporary-opener");
    temporary.focus();
    invoke("open-settings");
    act(() => removeOpener());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message" }));
  });
});

describe("Scenario: Help menu item is the existing locked Help dispatch", () => {
  it("dispatches byte-identical payload/display/rollback ownership from native menu and composer", async () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const native = render(<NativeMenuBridge />);
    await act(async () => nativeCommand?.("request-help"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const nativeArgs = send.mock.calls[0];
    native.unmount();

    useCbe.getState().reset();
    seedConversation();
    useCbe.setState({ configured: true, hydration: "ready" });
    render(<ChatPanel />);
    const composerHelp = helpEntry();
    await act(async () => fireEvent.click(composerHelp));
    const composerArgs = send.mock.calls[1];
    expect(nativeArgs).toEqual(composerArgs);
    expect(nativeArgs).toEqual(["test-session", HELP_TOKEN, { text: "Help requested" }]);
  });

  it("is reported busy from the shared dispatch-pending state and queues nothing", () => {
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<NativeMenuBridge />);
    act(() => useCbe.getState().setDispatchPending(true));
    expect(availabilityReports.at(-1)?.help).toEqual({ enabled: false, reason: "busy" });
    invoke("request-help");
    expect(send).not.toHaveBeenCalled();
  });
});
