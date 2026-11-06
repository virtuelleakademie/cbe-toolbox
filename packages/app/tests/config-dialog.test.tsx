/**
 * Tests for ConfigDialog (onboarding) — pinning down the provider-config
 * persistence path that was the subject of the
 * `fix-provider-config-persistence` change.
 *
 * Each Scenario in `specs/desktop-app/spec.md` that touches ConfigDialog
 * has a matching test here. The third test in this file used to FAIL as a
 * diagnostic seed during Phase-1 of the systematic-debugging investigation;
 * after the sanitised-`ready`-check fix it asserts the opposite behaviour
 * (Save button stays disabled — desired) and passes.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfigDialog } from "../src/renderer/components/ConfigDialog.js";

describe("ConfigDialog — apiKey is transferred to setConfig", () => {
  it("passes the typed apiKey to window.cbe.setConfig on save", async () => {
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<ConfigDialog />);

    const baseUrlInput = screen.getByPlaceholderText("https://your-llm-endpoint/v1") as HTMLInputElement;
    const apiKeyInput = screen.getByPlaceholderText("sk-…") as HTMLInputElement;
    const modelIdInput = screen.getByPlaceholderText("gemma-3-27b-it") as HTMLInputElement;

    fireEvent.change(baseUrlInput, { target: { value: "http://127.0.0.1:8000/v1" } });
    fireEvent.change(apiKeyInput, { target: { value: "test-key-1234567890" } });
    fireEvent.change(modelIdInput, { target: { value: "Qwen3.6-35B-A3B-4bit" } });

    const saveButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled, "Save enables when all three fields are non-empty").toBe(false);

    fireEvent.click(saveButton);
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect(setConfigSpy).toHaveBeenCalledWith({
      baseURL: "http://127.0.0.1:8000/v1",
      apiKey: "test-key-1234567890",
      modelId: "Qwen3.6-35B-A3B-4bit",
    });
  });

  it("preserves the typed apiKey when surrounded by quotes pasted from a password manager", async () => {
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<ConfigDialog />);

    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "http://127.0.0.1:8000/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: '"sk-quote-wrapped-1234567890"' } });
    fireEvent.change(screen.getByPlaceholderText("gemma-3-27b-it"), { target: { value: "Qwen3.6-35B-A3B-4bit" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect(setConfigSpy.mock.calls[0][0].apiKey).toBe("sk-quote-wrapped-1234567890");
  });

  // Covers Scenario: *Save button stays disabled when the typed apiKey
  // sanitises to an empty string*. A paste of `""` (two quotes — a common
  // "no real key needed" placeholder for local LLM endpoints) sanitises to
  // empty; the dialog's `ready` predicate validates the sanitised value, so
  // the Save button must NOT enable in this case.
  it("Save button stays disabled when the typed apiKey is only matched quotes (sanitises to empty)", async () => {
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<ConfigDialog />);

    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "http://127.0.0.1:8000/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: '""' } });
    fireEvent.change(screen.getByPlaceholderText("gemma-3-27b-it"), { target: { value: "Qwen3.6-35B-A3B-4bit" } });

    const saveButton = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled, "Save must stay disabled when apiKey sanitises to empty").toBe(true);

    // Defence in depth: even if a future regression enables the button, the
    // click must not produce a setConfig call carrying an empty apiKey.
    fireEvent.click(saveButton);
    await Promise.resolve();
    await Promise.resolve();
    expect(setConfigSpy, "no IPC call when sanitised apiKey is empty").not.toHaveBeenCalled();
  });

  // Covers Scenario: *Both password inputs declare autoComplete="off"*.
  it("the password input declares autoComplete='off' (defence against Chromium autofill races)", () => {
    render(<ConfigDialog />);
    const apiKeyInput = screen.getByPlaceholderText("sk-…") as HTMLInputElement;
    expect(apiKeyInput.getAttribute("autocomplete"), "autoComplete must be 'off' on the password input").toBe("off");
    expect(apiKeyInput.type).toBe("password");
  });
});

describe("ConfigDialog — non-blocking endpoint guidance", () => {
  // Covers Scenario: *Azure resource URL without the v1 path gets an actionable hint*.
  it("Azure resource URL without the v1 path gets an actionable hint (and Save is not blocked by it)", () => {
    Object.assign(window.cbe, { setConfig: vi.fn().mockResolvedValue({ ok: true }) });
    render(<ConfigDialog />);

    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "https://myresource.openai.azure.com" },
    });
    expect(screen.getByText(/myresource\.openai\.azure\.com\/openai\/v1/)).toBeTruthy();

    // The hint never blocks Save: with all three fields filled, Save is enabled.
    fireEvent.change(screen.getByPlaceholderText("sk-…"), { target: { value: "sk-azure-key-123" } });
    fireEvent.change(screen.getByPlaceholderText("gemma-3-27b-it"), { target: { value: "gpt-4o" } });
    expect((screen.getByRole("button", { name: /save/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Covers Scenario: *Plain-http non-loopback URL gets a cleartext warning*.
  it("Plain-http non-loopback URL gets a cleartext warning; loopback shows none", () => {
    Object.assign(window.cbe, { setConfig: vi.fn().mockResolvedValue({ ok: true }) });
    const { rerender } = render(<ConfigDialog />);

    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "http://llm.example.org/v1" },
    });
    expect(screen.getByText(/travel unencrypted/i)).toBeTruthy();

    // A loopback http URL shows no cleartext warning.
    rerender(<ConfigDialog />);
    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "http://localhost:11434/v1" },
    });
    expect(screen.queryByText(/travel unencrypted/i)).toBeNull();
  });
});
