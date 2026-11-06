/**
 * Renderer tests for the `clarify-and-erase-credentials` change — one per
 * Scenario in its `desktop-app` spec delta (renderer halves; the main-process
 * halves live in ipc-erase-and-test.test.ts):
 *
 * - Credential Erasure with Confirmation (delete control + locality statement)
 * - Settings Save Feedback and Unsaved-Changes Indication
 * - Credential Presence Indicator and Connection Verifiability
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";

function seedProviderStatus(overrides: Partial<{ hasKey: boolean }> = {}) {
  useCbe.setState({
    providerStatus: {
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "Qwen3.6-35B-A3B-4bit",
      hasKey: true,
      ...overrides,
    },
  });
  // The settings surface is a one-open-at-a-time accordion that opens on
  // Appearance (Requirement: Settings Panel (Phase 1 scaffold)), and a closed
  // group's body is `hidden` — out of the tab order and out of the accessibility
  // tree. Everything below exercises the Model group, so it is opened first, the
  // one click the requirement expressly prices in.
  useCbe.getState().setSettingsOpenGroup("model");
}

/** The Model group has TWO levels since
 * `split-llm-settings-into-standard-and-advanced` (Requirement: Settings Panel
 * (Phase 1 scaffold)): the erasure control lives behind an Advanced disclosure
 * INSIDE the group, because destroying a credential is not part of getting
 * connected. The presence indicator, the test-connection affordance and the
 * locality statement deliberately do NOT — they are asserted below to need no
 * expansion at all. */
function expandAdvanced() {
  const header = screen.getByRole("button", { name: /^advanced$/i });
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
}

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("SettingsPanel — credential erasure with confirmation", () => {
  // Covers Scenario: *Lecturer erases the stored API key and sees confirmation*
  // (renderer half): the delete control arms an inline confirmation, the
  // confirmed erase calls the main-process erase path once, the surface confirms
  // the erasure, and the configured-state indicator flips to "no key set".
  it("erases the stored API key after confirmation and shows the erasure confirmation", async () => {
    seedProviderStatus();
    const eraseSpy = vi.fn().mockResolvedValue({ ok: true, hadKey: true });
    Object.assign(window.cbe, { eraseApiKey: eraseSpy });

    render(<SettingsPanel />);
    expect(screen.getByText("An API key is set")).toBeTruthy();
    // The erasure control is not on the default view — it is one disclosure away.
    expect(screen.queryByRole("button", { name: /delete api key/i })).toBeNull();
    expandAdvanced();

    // Arming the delete does NOT erase yet.
    fireEvent.click(screen.getByRole("button", { name: /delete api key/i }));
    expect(eraseSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/delete the stored api key from this device\?/i)).toBeTruthy();

    // Confirming erases exactly once and confirms it.
    fireEvent.click(screen.getByRole("button", { name: /^delete key$/i }));
    await waitFor(() => {
      expect(screen.getByText(/api key erased from this device/i)).toBeTruthy();
    });
    expect(eraseSpy).toHaveBeenCalledTimes(1);
    // Configured-state check now reports no key present.
    expect(screen.getByText("No API key set")).toBeTruthy();
    expect(useCbe.getState().providerStatus?.hasKey).toBe(false);
  });

  it("cancelling the confirmation never calls the erase path", () => {
    seedProviderStatus();
    const eraseSpy = vi.fn().mockResolvedValue({ ok: true, hadKey: true });
    Object.assign(window.cbe, { eraseApiKey: eraseSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /delete api key/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(eraseSpy).not.toHaveBeenCalled();
    expect(screen.getByText("An API key is set")).toBeTruthy();
    // The armed confirmation is gone; the delete control is back.
    expect(screen.queryByText(/delete the stored api key from this device\?/i)).toBeNull();
    expect(screen.getByRole("button", { name: /delete api key/i })).toBeTruthy();
  });

  // Covers Scenario: *Settings states credentials never leave the machine except
  // to the configured endpoint*.
  it("states credentials never leave the machine except to the configured endpoint", () => {
    seedProviderStatus();
    render(<SettingsPanel />);
    // The lecturer VIEWS the group: this duty is discharged without expanding
    // anything, so the statement stays outside Advanced.
    expect(screen.getByRole("button", { name: /^advanced$/i }).getAttribute("aria-expanded")).toBe("false");
    const note = screen.getByText(/stored locally on this device/i);
    expect(note.textContent).toMatch(/sent only to the LLM endpoint you configured/i);
    expect(note.textContent).toMatch(/no CBE or other third-party server/i);
  });
});

describe("SettingsPanel — save feedback and unsaved-changes indication", () => {
  // Covers Scenario: *Unsaved edits are visibly indicated*.
  it("indicates unsaved edits visibly while a field differs from the persisted state", () => {
    seedProviderStatus();
    render(<SettingsPanel />);

    // Pristine section: no unsaved marker.
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "edited-model" } });
    expect(screen.getByText(/unsaved changes — press save/i)).toBeTruthy();

    // Reverting the edit clears the unsaved state again.
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "Qwen3.6-35B-A3B-4bit" } });
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
  });

  // Covers Scenario: *Successful save shows an explicit confirmation*.
  it("shows an explicit Saved confirmation on a successful save and clears the unsaved state", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "edited-model" } });
    expect(screen.getByText(/unsaved changes/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/^Saved\.$/)).toBeTruthy();
    });
    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    // The unsaved-changes state cleared — saved and unsaved are mutually exclusive.
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
  });
});

describe("SettingsPanel — credential presence indicator and connection verifiability", () => {
  // Covers Scenario: *Settings indicates whether an API key is set*.
  it("indicates whether an API key is set without displaying the stored key", () => {
    seedProviderStatus({ hasKey: true });
    const { unmount } = render(<SettingsPanel />);
    expect(screen.getByText("An API key is set")).toBeTruthy();
    // The stored key value is never rendered: the field stays empty, and it is
    // legible rather than masked — which reveals nothing, because the persisted
    // key never reaches the renderer.
    const field = screen.getByLabelText("API key") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.type).not.toBe("password");
    unmount();

    seedProviderStatus({ hasKey: false });
    render(<SettingsPanel />);
    expect(screen.getByText("No API key set")).toBeTruthy();
  });

  // Covers Scenario: *Test connection verifies the configuration and reports the
  // outcome* (renderer half): the affordance runs the probe, reports a clear
  // success, names the failure cause (unauthorized vs. unreachable), and never
  // blocks the rest of the panel while running.
  it("reports a successful test connection", async () => {
    seedProviderStatus();
    const testSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { testConnection: testSpy });

    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/connection ok — the endpoint responded and accepted the key/i)).toBeTruthy();
    });
    expect(testSpy).toHaveBeenCalledTimes(1);
  });

  it("names the failure cause: unauthorized vs. unreachable, without revealing the key", async () => {
    seedProviderStatus();
    const testSpy = vi.fn().mockResolvedValue({ ok: false, cause: "unauthorized", status: 401 });
    Object.assign(window.cbe, { testConnection: testSpy });

    const { unmount } = render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/unauthorized — the endpoint rejected the api key/i)).toBeTruthy();
    });
    unmount();

    seedProviderStatus();
    Object.assign(window.cbe, { testConnection: vi.fn().mockResolvedValue({ ok: false, cause: "unreachable" }) });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/endpoint unreachable — check the base url and your network/i)).toBeTruthy();
    });
  });

  it("is non-blocking: the panel stays usable while the probe runs", async () => {
    seedProviderStatus();
    let resolveProbe: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolveProbe = r;
    });
    Object.assign(window.cbe, { testConnection: vi.fn().mockReturnValue(pending) });

    render(<SettingsPanel />);
    const testBtn = screen.getByRole("button", { name: /test connection/i }) as HTMLButtonElement;
    fireEvent.click(testBtn);

    // Only the Test button itself is disabled while the probe is in flight; the
    // inputs and Save stay interactive (a slow probe never freezes Settings).
    expect((screen.getByRole("button", { name: /testing…/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(false);
    const modelInput = screen.getByPlaceholderText("model-id") as HTMLInputElement;
    expect(modelInput.disabled).toBe(false);
    fireEvent.change(modelInput, { target: { value: "still-editable" } });
    expect(modelInput.value).toBe("still-editable");

    resolveProbe({ ok: true });
    await waitFor(() => {
      expect(screen.getByText(/connection ok/i)).toBeTruthy();
    });
  });

  // Covers Scenario: *The presence indicator and the connection check need no
  // Advanced expansion*. An indicator a lecturer has to go looking for tells them
  // nothing at a glance, so both duties stay in the group's default view.
  it("the presence indicator and the connection check are usable without expanding Advanced", async () => {
    seedProviderStatus({ hasKey: true });
    const testSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { testConnection: testSpy });

    render(<SettingsPanel />);
    expect(screen.getByRole("button", { name: /^advanced$/i }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("An API key is set")).toBeTruthy();

    const testBtn = screen.getByRole("button", { name: /test connection/i }) as HTMLButtonElement;
    expect(testBtn.disabled).toBe(false);
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(screen.getByText(/connection ok/i)).toBeTruthy();
    });
    // Still collapsed: neither duty needed the disclosure.
    expect(screen.getByRole("button", { name: /^advanced$/i }).getAttribute("aria-expanded")).toBe("false");
  });

  // Covers Scenario: *The legible key field starts empty and never carries the
  // persisted credential*.
  it("the legible key field starts empty although a key is persisted, and a value appears only by typing", () => {
    seedProviderStatus({ hasKey: true });
    render(<SettingsPanel />);

    const field = screen.getByLabelText("API key") as HTMLInputElement;
    expect(field.type).toBe("text");
    expect(field.value).toBe("");
    // The presence indication is the only statement the surface makes about the
    // stored key — no code path renders the credential itself.
    expect(screen.getByText("An API key is set")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sk-[A-Za-z0-9]/);

    fireEvent.change(field, { target: { value: "sk-typed-now" } });
    expect(field.value).toBe("sk-typed-now");
  });
});
