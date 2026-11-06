/**
 * Tests for SettingsPanel — pinning the partial-update affordance + the
 * autoComplete invariant introduced by `fix-provider-config-persistence`.
 *
 * Each Scenario in `specs/desktop-app/spec.md` that touches SettingsPanel has
 * a matching test here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SETTINGS_GROUPS, useCbe } from "../src/renderer/state/store.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { ACCENTS } from "../src/renderer/theme/catppuccin.js";

function seedProviderStatus() {
  useCbe.setState({
    providerStatus: {
      baseURL: "http://127.0.0.1:8000/v1",
      modelId: "Qwen3.6-35B-A3B-4bit",
      hasKey: true,
    },
  });
  openModelGroup();
}

/** The settings surface is a one-open-at-a-time accordion opening on Appearance
 * (Requirement: Settings Panel (Phase 1 scaffold)), and a closed group's body is
 * `hidden` — out of the tab order and the accessibility tree. Tests that exercise
 * the Model group open it first: the one click the requirement expressly prices
 * in for reaching the connection settings. */
function openModelGroup() {
  useCbe.getState().setSettingsOpenGroup("model");
}

/** The Model group has TWO levels since
 * `split-llm-settings-into-standard-and-advanced` (Requirement: Settings Panel
 * (Phase 1 scaffold)): the context-length field, the reasoning controls and the
 * erasure control sit behind an Advanced disclosure INSIDE the group. Tests that
 * reach one of them expand it first — a second disclosure step, no behaviour
 * change: what those controls do, and what a save built from them carries, is
 * asserted below exactly as before the split. */
function expandAdvanced() {
  const header = screen.getByRole("button", { name: /^advanced$/i });
  if (header.getAttribute("aria-expanded") !== "true") fireEvent.click(header);
}

describe("SettingsPanel — apiKey persistence on edit", () => {
  // Covers Scenario: *Settings save with a re-entered apiKey overwrites the
  // existing cipher*. A non-empty value in the apiKey field is sent as the
  // DTO's `apiKey` field; the main process encrypts and overwrites.
  it("a non-empty re-entered apiKey reaches setConfig as a non-empty field", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);

    const apiKeyInput = screen.getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "fresh-key-9876543210" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const args = setConfigSpy.mock.calls[0][0];
    expect(args.apiKey).toBe("fresh-key-9876543210");
    expect(args.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(args.modelId).toBe("Qwen3.6-35B-A3B-4bit");
  });

  // Covers Scenario: *Settings save preserves the existing apiKey when the field
  // is left blank and the endpoint is unchanged*. Editing only the modelId (the
  // baseURL stays equal to the persisted one) with the apiKey field blank sends
  // the DTO with `apiKey` OMITTED — the main process preserves the persisted
  // cipher. (A CHANGED baseURL with a blank key now keeps Save disabled — see the
  // endpoint-identity-reset describe block below.)
  it("editing only modelId with the apiKey field blank sends the DTO without apiKey (same-endpoint partial update)", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);

    const modelInput = screen.getByPlaceholderText("model-id") as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: "edited-model" } });
    // baseURL unchanged; apiKey input deliberately left blank.

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const args = setConfigSpy.mock.calls[0][0];
    expect(args.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(args.modelId).toBe("edited-model");
    expect("apiKey" in args, "the apiKey field MUST be omitted from the DTO, not present as empty string").toBe(false);
  });

  // Defence in depth: an apiKey field with only matched quotes sanitises to
  // empty. The partial-update branch is keyed on `cleanKey` (the sanitised
  // value), so quote-only input behaves identically to a blank field — the
  // DTO omits `apiKey` rather than carrying an empty string. This guarantees
  // `EmptyApiKeyError` cannot be triggered from SettingsPanel.
  it("apiKey field containing only matched quotes results in DTO without apiKey, not empty string", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: '""' } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect("apiKey" in setConfigSpy.mock.calls[0][0]).toBe(false);
  });

  // Covers Scenario: *Both credential inputs declare autoComplete="off", whatever
  // their type*. The settings key field is deliberately LEGIBLE rather than
  // masked, so it is checked as a credential input — no field escapes the rule by
  // no longer being `type="password"`.
  it("the credential input declares autoComplete='off' whatever its type (defence against Chromium autofill races)", () => {
    seedProviderStatus();
    render(<SettingsPanel />);
    const apiKeyInput = screen.getByLabelText("API key") as HTMLInputElement;
    expect(apiKeyInput.getAttribute("autocomplete")).toBe("off");
    expect(apiKeyInput.type).not.toBe("password");
  });

  // The omit-to-preserve affordance used to be announced by a standing note under
  // the input row. No help prose stands on the surface any more (Requirement:
  // Collected UX Polish), so the sentence moved into the API key field's own
  // explanation — same contract, reached through the field's `?`.
  it("the omit-to-preserve affordance is stated in the API key field's help text, not as standing prose", () => {
    seedProviderStatus();
    render(<SettingsPanel />);
    expect(screen.queryByText(/leave blank to keep the current key/i)).toBeNull();

    const explanation = document.getElementById(
      screen.getByLabelText("API key").getAttribute("aria-describedby")!
    ) as HTMLElement;
    expect(explanation.getAttribute("role")).toBe("tooltip");
    expect(explanation.getAttribute("data-open")).toBe("false");
    expect(explanation.textContent).toMatch(/leaving it blank keeps whatever key is already stored/i);

    fireEvent.click(screen.getByRole("button", { name: "What is API key?" }));
    expect(explanation.getAttribute("data-open")).toBe("true");
  });

  // The `stored` / `required` marker the field's hint used to carry is not
  // duplicated into the help text: the credential-presence row is already a
  // first-class statement of it, and it stays in the default view.
  it("whether a key is stored is stated by the presence row, with no hint line on the field", () => {
    useCbe.setState({
      providerStatus: { baseURL: "http://127.0.0.1:8000/v1", modelId: "x", hasKey: false },
    });
    openModelGroup();
    const { container } = render(<SettingsPanel />);
    expect(screen.getByText("No API key set")).toBeTruthy();
    expect(screen.queryByText(/^required$/i)).toBeNull();
    expect(container.querySelectorAll(".llm-conn .rk small").length).toBe(0);
  });
});

describe("SettingsPanel — live provider swap into the running session", () => {
  afterEach(() => cleanup());

  // Covers Scenario: *Saving a new model mid-conversation switches the active chat live*.
  // setConfig reports a successful live re-bind; the panel confirms the new model and
  // sends the sanitised modelId in the DTO.
  it("confirms the active chat switched models and sends the sanitised modelId", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true, activeSwap: { ok: true, modelId: "new-model-7b" } });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "new-model-7b" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect(setConfigSpy.mock.calls[0][0].modelId).toBe("new-model-7b");
    expect(screen.getByText(/active chat now on new-model-7b/i)).toBeTruthy();
  });

  // Covers Scenario: *Save with a blank apiKey applies the preserved key to the running
  // session*. Changing only the modelId with a blank apiKey omits apiKey from the DTO
  // (preserve-existing), and the live swap is still confirmed.
  it("omits apiKey from the DTO when blank, and still confirms the live swap", async () => {
    seedProviderStatus();
    const setConfigSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, activeSwap: { ok: true, modelId: "preserved-key-model" } });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "preserved-key-model" } });
    // apiKey deliberately left blank.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect("apiKey" in setConfigSpy.mock.calls[0][0]).toBe(false);
    expect(screen.getByText(/active chat now on preserved-key-model/i)).toBeTruthy();
  });

  // Covers Scenario: *A failed live swap surfaces an error without breaking the chat*.
  it("shows a recoverable error note when the live swap fails, and does not show the plain Saved note", async () => {
    seedProviderStatus();
    const setConfigSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, activeSwap: { ok: false, error: "No API key for byo-llm/new-model-7b" } });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "new-model-7b" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/could not switch models/i)).toBeTruthy();
    expect(screen.getByText(/stays on the previous model/i)).toBeTruthy();
    expect(screen.queryByText(/^Saved\.$/)).toBeNull();
  });

  // Covers Scenario: *Saving with no active session is a no-op for the live swap*.
  it("shows a plain Saved note (no model line) when no session was active (activeSwap omitted)", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "later-start-model" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/^Saved\.$/)).toBeTruthy();
    expect(screen.queryByText(/active chat now on/i)).toBeNull();
  });
});

describe("SettingsPanel — context length field", () => {
  it("sends a positive context length in the DTO", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    const ctxInput = screen.getByPlaceholderText("e.g. 65536") as HTMLInputElement;
    fireEvent.change(ctxInput, { target: { value: "65536" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect(setConfigSpy.mock.calls[0][0].contextLength).toBe(65536);
  });

  it("omits contextLength from the DTO when the field is left blank (preserve persisted value)", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    // context length field left blank; just re-save.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect("contextLength" in setConfigSpy.mock.calls[0][0]).toBe(false);
  });

  it("rejects a non-positive context length and does NOT call setConfig", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    const ctxInput = screen.getByPlaceholderText("e.g. 65536") as HTMLInputElement;
    fireEvent.change(ctxInput, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/positive whole number/i)).toBeTruthy();
  });
});

describe("SettingsPanel — reasoning toggle + effort", () => {
  afterEach(() => cleanup());

  // Covers Requirement: Settings Panel — "LLM connection editable from Settings"
  // (reasoning) + Provider Reasoning Configuration "Reasoning toggle and effort persist".
  it("enabling reasoning and selecting an effort sends reasoning + reasoningEffort in the DTO", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    fireEvent.click(screen.getByLabelText("Enable reasoning"));
    // The effort selector appears once reasoning is on.
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "high" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const args = setConfigSpy.mock.calls[0][0];
    expect(args.reasoning).toBe(true);
    expect(args.reasoningEffort).toBe("high");
  });

  // An untouched reasoning control omits `reasoning` from the DTO — the
  // omit-to-preserve / metadata-default contract (explicit choice always wins,
  // untouched preserves).
  it("an untouched reasoning control omits reasoning from the DTO (preserve / metadata default)", async () => {
    seedProviderStatus();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    // Only change the model id; do not touch the reasoning control.
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "some-model" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    const args = setConfigSpy.mock.calls[0][0];
    expect("reasoning" in args).toBe(false);
    expect("reasoningEffort" in args).toBe(false);
  });

  // Explicit OFF is preserved as a real choice: toggling a model that started ON
  // to OFF sends reasoning:false (so the metadata default can never re-enable it).
  it("explicitly turning reasoning OFF sends reasoning:false in the DTO", async () => {
    useCbe.setState({
      providerStatus: {
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "qwen-a3b",
        hasKey: true,
        reasoning: true,
        reasoningEffort: "medium",
      },
    });
    openModelGroup();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    const toggle = screen.getByLabelText("Enable reasoning") as HTMLInputElement;
    expect(toggle.checked).toBe(true); // reflects persisted ON
    fireEvent.click(toggle); // turn OFF
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();

    const args = setConfigSpy.mock.calls[0][0];
    expect(args.reasoning).toBe(false);
  });

  it("reflects a persisted reasoning ON state in the control on mount", () => {
    useCbe.setState({
      providerStatus: {
        baseURL: "http://127.0.0.1:8000/v1",
        modelId: "qwen-a3b",
        hasKey: true,
        reasoning: true,
        reasoningEffort: "high",
      },
    });
    openModelGroup();
    render(<SettingsPanel />);
    expandAdvanced();
    expect((screen.getByLabelText("Enable reasoning") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reasoning effort") as HTMLSelectElement).value).toBe("high");
  });
});

describe("SettingsPanel — endpoint-identity reset on baseURL change", () => {
  afterEach(() => cleanup());

  // Covers Scenario: *Changing the base URL keeps Save disabled until the key is
  // re-entered*.
  it("Changing the base URL keeps Save disabled until the key is re-entered", async () => {
    seedProviderStatus(); // baseURL http://127.0.0.1:8000/v1, hasKey true
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);

    const baseUrlInput = screen.getByPlaceholderText("https://your-llm-endpoint/v1") as HTMLInputElement;
    fireEvent.change(baseUrlInput, { target: { value: "https://inference.example.org/api/v1" } });
    // apiKey left blank.

    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled, "Save disabled while the endpoint changed and the key is blank").toBe(true);
    expect(screen.getByText(/key required for the new endpoint/i)).toBeTruthy();

    // Re-entering a key for the new endpoint enables Save.
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "new-endpoint-key" } });
    expect(saveBtn.disabled).toBe(false);

    // A clicked Save now carries the new endpoint + key.
    fireEvent.click(saveBtn);
    await Promise.resolve();
    await Promise.resolve();
    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const args = setConfigSpy.mock.calls[0][0];
    expect(args.baseURL).toBe("https://inference.example.org/api/v1");
    expect(args.apiKey).toBe("new-endpoint-key");
  });

  // Covers Scenario (renderer side): the reasoning control and context-length
  // field visibly show their cleared state after an endpoint-changing save.
  it("reasoning toggle and context-length field reflect the cleared state after an endpoint-changing save", async () => {
    useCbe.setState({
      providerStatus: {
        baseURL: "https://openrouter.ai/api/v1",
        modelId: "qwen/qwen3.6-35b-a3b",
        hasKey: true,
        reasoning: true,
        reasoningEffort: "high",
        contextLength: 65_536,
      },
    });
    openModelGroup();
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });

    render(<SettingsPanel />);
    expandAdvanced();
    // Pre-condition: controls reflect the persisted ON / 65536 state.
    expect((screen.getByLabelText("Enable reasoning") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText("e.g. 65536") as HTMLInputElement).value).toBe("65536");

    // Change endpoint, re-enter a key, leave the reasoning control untouched, and
    // blank the context-length field (the lecturer does not carry the old window
    // to the new model). The main process resets both on the baseURL change.
    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "https://inference.example.org/api/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "new-endpoint-key" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 65536"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // After the endpoint-changing save the controls show the cleared state
    // (the panel's useEffect reflects the reset providerStatus). The DTO omitted
    // contextLength (blank field) and reasoning (untouched), so the main process
    // cleared both for the new endpoint.
    await waitFor(() => {
      expect((screen.getByLabelText("Enable reasoning") as HTMLInputElement).checked).toBe(false);
    });
    expect((screen.getByPlaceholderText("e.g. 65536") as HTMLInputElement).value).toBe("");
    // The DTO carried the new endpoint + key, and omitted reasoning + contextLength.
    const dto = setConfigSpy.mock.calls[0][0];
    expect(dto.baseURL).toBe("https://inference.example.org/api/v1");
    expect("reasoning" in dto).toBe(false);
    expect("contextLength" in dto).toBe(false);
  });
});

describe("SettingsPanel — non-blocking endpoint guidance", () => {
  afterEach(() => cleanup());

  // Covers Scenario: *Azure resource URL without the v1 path gets an actionable hint*.
  it("Azure resource URL without the v1 path gets an actionable hint", () => {
    seedProviderStatus();
    Object.assign(window.cbe, { setConfig: vi.fn().mockResolvedValue({ ok: true }) });
    render(<SettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("https://your-llm-endpoint/v1"), {
      target: { value: "https://myresource.openai.azure.com" },
    });
    expect(screen.getByText(/myresource\.openai\.azure\.com\/openai\/v1/)).toBeTruthy();
  });

  // Covers Scenario: *Plain-http non-loopback URL gets a cleartext warning*.
  it("Plain-http non-loopback URL gets a cleartext warning; loopback shows none", () => {
    seedProviderStatus();
    Object.assign(window.cbe, { setConfig: vi.fn().mockResolvedValue({ ok: true }) });
    render(<SettingsPanel />);
    const base = screen.getByPlaceholderText("https://your-llm-endpoint/v1");
    fireEvent.change(base, { target: { value: "http://llm.example.org/v1" } });
    expect(screen.getByText(/travel unencrypted/i)).toBeTruthy();
    fireEvent.change(base, { target: { value: "http://localhost:11434/v1" } });
    expect(screen.queryByText(/travel unencrypted/i)).toBeNull();
  });
});

describe("SettingsPanel — Appearance (theme / flavour / accent)", () => {
  // Covers Scenario: *Theme + flavour + accent apply immediately and persist*, plus
  // the requirement-body obligations (14 accents, the flavour set, single flat column
  // with no nested accordions, group order, read-only About). Backfills the
  // Test-per-Scenario obligation for task 3.8.
  beforeEach(() => {
    // The accordion default; stated rather than inherited, because the blocks
    // above deliberately leave the Model group open.
    useCbe.getState().setSettingsOpenGroup("appearance");
  });
  afterEach(() => {
    cleanup();
    // The store + DOM are document-global in jsdom; restore the defaults so a
    // theme/accent change in one test cannot leak into another.
    useCbe.setState({ theme: "dark", flavour: "macchiato", accent: "blue" });
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  it("changing the theme updates the store, persists to localStorage, and applies the palette immediately", () => {
    render(<SettingsPanel />);
    const themeGroup = screen.getByRole("group", { name: "Theme" });
    fireEvent.click(within(themeGroup).getByRole("button", { name: "Light" }));

    expect(useCbe.getState().theme).toBe("light");
    expect(localStorage.getItem("cbe-theme")).toBe("light");
    // applyPalette ran synchronously: the data-theme attribute + accent var are set.
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).not.toBe("");
  });

  it("changing the accent writes the --accent CSS var on <html> instantly (running renderer updates)", () => {
    render(<SettingsPanel />);
    const accentGroup = screen.getByRole("group", { name: "Accent colour" });
    fireEvent.click(within(accentGroup).getByTitle("green"));

    expect(useCbe.getState().accent).toBe("green");
    expect(localStorage.getItem("cbe-accent")).toBe("green");
    // Default dark + macchiato: green = #a6da95 (catppuccin.ts).
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#a6da95");
  });

  it("changing the flavour persists and re-applies the palette", () => {
    render(<SettingsPanel />);
    const flavourGroup = screen.getByRole("group", { name: "Catppuccin flavour" });
    fireEvent.click(within(flavourGroup).getByRole("button", { name: "Mocha" }));

    expect(useCbe.getState().flavour).toBe("mocha");
    expect(localStorage.getItem("cbe-flavour")).toBe("mocha");
    // Accent stays blue; mocha blue = #89b4fa.
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#89b4fa");
  });

  it("a persisted choice survives a remount (the control reflects the stored state)", () => {
    const { unmount } = render(<SettingsPanel />);
    const accentGroup = screen.getByRole("group", { name: "Accent colour" });
    fireEvent.click(within(accentGroup).getByTitle("peach"));
    unmount();

    // Re-mounting reads the persisted store state — the peach swatch is pressed.
    render(<SettingsPanel />);
    const peach = within(screen.getByRole("group", { name: "Accent colour" })).getByTitle("peach");
    expect(peach.getAttribute("aria-pressed")).toBe("true");
    // The persistence substrate (localStorage) carries it for the App-level restart hydration.
    expect(localStorage.getItem("cbe-accent")).toBe("peach");
  });

  it("offers all 14 Catppuccin accents", () => {
    render(<SettingsPanel />);
    const accentGroup = screen.getByRole("group", { name: "Accent colour" });
    expect(within(accentGroup).getAllByRole("button").length).toBe(14);
    expect(ACCENTS.length).toBe(14);
    // A few exact swatches by title, spanning the list ends.
    for (const a of ["rosewater", "blue", "lavender"]) {
      expect(within(accentGroup).getByTitle(a)).toBeTruthy();
    }
  });

  it("offers Frappé / Macchiato / Mocha flavour buttons in Dark mode", () => {
    render(<SettingsPanel />);
    const flavourGroup = screen.getByRole("group", { name: "Catppuccin flavour" });
    for (const label of ["Frappé", "Macchiato", "Mocha"]) {
      expect(within(flavourGroup).getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("replaces the flavour picker with a Latte note in Light mode", () => {
    useCbe.setState({ theme: "light" });
    render(<SettingsPanel />);
    expect(screen.queryByRole("group", { name: "Catppuccin flavour" })).toBeNull();
    expect(screen.getByText(/Latte palette/i)).toBeTruthy();
  });
});

describe("SettingsPanel — the four-group accordion", () => {
  /**
   * Covers Requirement: Settings Panel (Phase 1 scaffold) after the chrome
   * rebuild — Scenarios *Settings live in the overlay, in four groups, Model
   * first*, *Opening a settings group closes the one that was open* and *A
   * setting still applies immediately from whichever group is open*. The
   * showing-level branches (Appearance on arrival, the unsaved-edit exception)
   * are the overlay's to drive and are covered in
   * `profile-settings-overlay.test.tsx`.
   *
   * The Corpus group's own content belongs to capability `distribution`
   * (Requirement: Corpus Distribution as Downloadable Bundle); what is asserted
   * here is only that it is the fourth group.
   */
  beforeEach(() => {
    useCbe.getState().reset();
    seedProviderStatus();
    useCbe.getState().setSettingsOpenGroup("appearance");
  });
  afterEach(() => {
    cleanup();
    useCbe.getState().reset();
  });

  it("renders exactly four groups in the order Model, Appearance, About, Corpus", () => {
    const { container } = render(<SettingsPanel />);
    const labels = Array.from(
      container.querySelectorAll(".settings-panel > .set-group > .set-acc-header > .set-label")
    ).map((n) => n.textContent);
    expect(labels).toEqual(["Model", "Appearance", "About", "Corpus"]);
    // The store's SETTINGS_GROUPS is the authority for that order, so it is read
    // here rather than left to drift beside a hard-coded list of elements.
    const rendered = Array.from(container.querySelectorAll<HTMLElement>(".settings-panel > .set-group")).map(
      (n) => n.dataset.group
    );
    expect(rendered).toEqual([...SETTINGS_GROUPS]);
  });

  it("opens with Appearance and the other three closed — exactly one group open", () => {
    const { container } = render(<SettingsPanel />);
    const state = Array.from(container.querySelectorAll(".settings-panel .set-acc-header")).map((h) => [
      h.querySelector(".set-label")!.textContent,
      h.getAttribute("aria-expanded"),
    ]);
    expect(state).toEqual([
      ["Model", "false"],
      ["Appearance", "true"],
      ["About", "false"],
      ["Corpus", "false"],
    ]);
  });

  it("opening a group closes the one that was open, and never leaves two open", () => {
    const { container } = render(<SettingsPanel />);
    const appearanceHeader = screen.getByRole("button", { name: /appearance/i });
    const modelHeader = screen.getByRole("button", { name: /^model$/i });

    // Pre-condition: Appearance's content is reachable, the Model group's is not
    // — a closed body is `hidden`, so it is out of the accessibility tree.
    expect(screen.getByRole("group", { name: "Catppuccin flavour" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    fireEvent.click(modelHeader);

    expect(modelHeader.getAttribute("aria-expanded")).toBe("true");
    expect(appearanceHeader.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Catppuccin flavour" })).toBeNull();
    // At no point are two open.
    const open = Array.from(container.querySelectorAll(".set-acc-header")).filter(
      (h) => h.getAttribute("aria-expanded") === "true"
    );
    expect(open.length).toBe(1);
  });

  it("a closed group keeps its half-typed value — hidden, not thrown away", () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "half-typed-model" } });

    // A trip through another group and back must not cost the lecturer the edit:
    // the overlay's whole dismissal contract rests on nothing being lost.
    fireEvent.click(screen.getByRole("button", { name: /appearance/i }));
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));

    expect((screen.getByPlaceholderText("model-id") as HTMLInputElement).value).toBe("half-typed-model");
  });

  // Scenario: *A setting still applies immediately from whichever group is open*.
  it("a setting applies immediately from the open group, in Appearance and in Model", async () => {
    const setConfigSpy = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window.cbe, { setConfig: setConfigSpy });
    render(<SettingsPanel />);

    // Appearance is the open group: its control applies and persists at once.
    fireEvent.click(within(screen.getByRole("group", { name: "Accent colour" })).getByTitle("teal"));
    expect(useCbe.getState().accent).toBe("teal");
    expect(localStorage.getItem("cbe-accent")).toBe("teal");

    // Model is one click away, and being closed until then changed nothing about
    // whether its setting takes effect.
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "applied-model" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(setConfigSpy.mock.calls[0][0].modelId).toBe("applied-model");
  });

  // Covers Scenario: *The About group states the installed skill and the running
  // app version*. Three read-only rows, each value coming from the host — the
  // skill version and the app version separately labelled, no citation-track row.
  it("shows the About group as read-only skill / skill version / app version", async () => {
    Object.assign(window.cbe, {
      getAboutInfo: async () => ({ appVersion: "4.5.6-app", skillName: "cbe", skillVersion: "1.2.3-skill" }),
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^about$/i }));

    const name = await screen.findByText("cbe");
    expect(name.tagName).toBe("SPAN"); // read-only, not an input
    expect(screen.getByText("1.2.3-skill")).toBeTruthy();
    expect(screen.getByText("4.5.6-app")).toBeTruthy();
    // The row labels distinguish the two versions, so neither can be misread as
    // the other, and the retired citation-track row is gone. Scoped to this
    // group: the Corpus group has a "Version" row of its own, which is the
    // corpus's and stays.
    const about = document.querySelector('[data-group="about"]')!;
    const labels = Array.from(about.querySelectorAll(".rk")).map((n) => n.textContent);
    expect(labels).toEqual(["Skill", "Skill version", "App version", "Skill update status"]);
  });

  // Covers Scenario: *The About group states the installed skill and the running
  // app version* — the values are the host's, not literals in the component. A
  // hardcoded version is exactly how this group rotted to "0.1.0"; this test
  // fails the moment one is reintroduced.
  it("reads both versions from the host rather than from literals in the component", async () => {
    const getAboutInfo = vi
      .fn()
      .mockResolvedValue({ appVersion: "9.9.9-other", skillName: "other-skill", skillVersion: "8.8.8-other" });
    Object.assign(window.cbe, { getAboutInfo });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^about$/i }));

    expect(await screen.findByText("other-skill")).toBeTruthy();
    expect(screen.getByText("8.8.8-other")).toBeTruthy();
    expect(screen.getByText("9.9.9-other")).toBeTruthy();
    expect(getAboutInfo).toHaveBeenCalled();
    expect(screen.queryByText("0.1.0")).toBeNull();
  });

  // Covers Scenario: *An unavailable About value is stated, not substituted*.
  it("states plainly that a value is unavailable instead of showing a placeholder version", async () => {
    Object.assign(window.cbe, {
      getAboutInfo: async () => ({ appVersion: "9.9.9-app", skillName: null, skillVersion: null }),
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^about$/i }));

    await screen.findByText("9.9.9-app");
    expect(screen.getAllByText("unavailable")).toHaveLength(2);
  });

  it("states the rows as unavailable when the host call fails", async () => {
    Object.assign(window.cbe, { getAboutInfo: async () => Promise.reject(new Error("no host")) });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^about$/i }));

    await waitFor(() => expect(screen.getAllByText("unavailable")).toHaveLength(4));
  });
});
