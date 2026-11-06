/**
 * Tests for the auto-update notice (capability `distribution`, Requirement:
 * Auto-update mechanism):
 * - Scenario: Update notice on a new version — non-blocking notification with
 *   version number, changelog link, and "install now / later / skip".
 * - Scenario: User can decline updates — "later"/"skip" close the notification
 *   without forcing updates or blocking any further functionality.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { UpdateBanner } from "../src/renderer/components/UpdateBanner.js";
import type { UpdateEvent } from "../src/shared/ipc-contract.js";

function mountWithUpdater() {
  const listeners: Array<(evt: UpdateEvent) => void> = [];
  const updateAction = vi.fn().mockResolvedValue({ ok: true });
  Object.assign(window.cbe, {
    onUpdateEvent: (listener: (evt: UpdateEvent) => void) => {
      listeners.push(listener);
      return () => {};
    },
    updateAction,
  });
  render(<UpdateBanner />);
  const emit = (evt: UpdateEvent) => act(() => listeners.forEach((l) => l(evt)));
  return { emit, updateAction };
}

describe("Update notice on a new version", () => {
  it("renders nothing until an update is available", () => {
    mountWithUpdater();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a non-blocking notice with version, changelog link and install now / later / skip", () => {
    const { emit } = mountWithUpdater();
    emit({ type: "available", version: "0.2.0", notesUrl: "https://cbe-stories.pages.dev/build/" });

    // role="status" (not a modal, not an alert) — the app stays usable.
    expect(screen.getByRole("status").textContent).toContain("Version 0.2.0 is available");
    expect((screen.getByRole("link", { name: /changelog/i }) as HTMLAnchorElement).href).toBe(
      "https://cbe-stories.pages.dev/build/"
    );
    expect(screen.getByRole("button", { name: /install now/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^later$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /skip this version/i })).toBeTruthy();
  });

  it("install now starts the download and flips to the downloaded state with a restart affordance", () => {
    const { emit, updateAction } = mountWithUpdater();
    emit({ type: "available", version: "0.2.0", notesUrl: "https://cbe-stories.pages.dev/build/" });

    fireEvent.click(screen.getByRole("button", { name: /install now/i }));
    expect(updateAction).toHaveBeenCalledWith({ action: "download", version: "0.2.0" });
    expect(screen.getByRole("status").textContent).toContain("Downloading update 0.2.0");

    emit({ type: "downloaded", version: "0.2.0" });
    fireEvent.click(screen.getByRole("button", { name: /restart and install/i }));
    expect(updateAction).toHaveBeenCalledWith({ action: "install", version: "0.2.0" });
  });
});

describe("User can decline updates", () => {
  it("later closes the notice without any update action", () => {
    const { emit, updateAction } = mountWithUpdater();
    emit({ type: "available", version: "0.2.0", notesUrl: "https://cbe-stories.pages.dev/build/" });

    fireEvent.click(screen.getByRole("button", { name: /^later$/i }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(updateAction).not.toHaveBeenCalled();
  });

  it("skip closes the notice and persists the skipped version via the main process", () => {
    const { emit, updateAction } = mountWithUpdater();
    emit({ type: "available", version: "0.2.0", notesUrl: "https://cbe-stories.pages.dev/build/" });

    fireEvent.click(screen.getByRole("button", { name: /skip this version/i }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(updateAction).toHaveBeenCalledWith({ action: "skip", version: "0.2.0" });
  });

  it("a background check error never raises a banner out of nowhere", () => {
    const { emit } = mountWithUpdater();
    emit({ type: "error", message: "offline" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
