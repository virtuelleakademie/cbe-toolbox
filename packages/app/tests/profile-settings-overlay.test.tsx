/**
 * The Profile-and-Settings overlay (capability `desktop-app`, Requirement:
 * Profile-and-Settings Overlay). One test per Scenario of that requirement:
 *
 *   - The gear and the user affordance open one overlay at their own section
 *   - The overlay closes three ways and returns focus
 *   - The overlay is modal and traps focus
 *   - An unsaved settings edit survives a dismissal
 *   - The overlay takes no layout width from the workspace
 *   - A running turn is neither blocked by nor closes the overlay
 *   - A course switch leaves the overlay open and re-resolves the profile
 *
 * plus the two showing-level branches of Requirement: Settings Panel (Phase 1
 * scaffold) that only the overlay can drive — Scenarios *A later open with
 * nothing pending still opens on Appearance* and *Re-opening after a dismissal
 * shows the group holding the unsaved edit* — and the re-homed Scenario of
 * Requirement: Profile Panel, *The profile is reached from the user affordance,
 * not from a panel tab*.
 *
 * (Replaces `settings-bridge.test.tsx`, deleted with the stage-1 bridge.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { de } from "../src/shared/i18n/de.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { App } from "../src/renderer/App.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import { ProfileSettingsOverlay } from "../src/renderer/components/ProfileSettingsOverlay.js";
import { applyProfileFromToolResult } from "../src/renderer/components/ChatPanel.js";
import type { ConversationOpenResult, LecturerProfile } from "../src/shared/ipc-contract.js";

const PROVIDER = { baseURL: "http://127.0.0.1:8000/v1", modelId: "test-model", hasKey: true };

const CONVERSATION: ConversationOpenResult = {
  session: {
    sessionId: "conv-overlay",
    environmentProfile: "app",
    affordances: {},
    paths: { workspace: "/w", corpus: "/c" },
    courseId: "cbe-101",
  },
  turns: [],
  agentRunning: false,
  canvas: [],
  maturity: {},
};

beforeEach(() => {
  useCbe.getState().reset();
  useCbe.setState({ providerStatus: PROVIDER, configured: true });
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

/** Header + overlay: the pair a lecturer actually operates. */
function renderChrome() {
  return render(
    <>
      <AppHeader workspaceVisible configured />
      <ProfileSettingsOverlay />
    </>
  );
}

const gear = () => document.querySelector('[data-tab="settings"]')!.closest("button") as HTMLButtonElement;
const userAffordance = () => screen.getByRole("button", { name: "Open profile" });
const dialog = () => screen.queryByRole("dialog");

describe("Scenario: The gear and the user affordance open one overlay at their own section", () => {
  it("opens the SAME surface at Settings and at Profile, and moves between them without closing", () => {
    renderChrome();
    // Never open on a fresh mount, and nothing rendered before the first open.
    expect(dialog()).toBeNull();

    fireEvent.click(gear());
    expect(dialog()!.getAttribute("aria-label")).toBe("Settings");
    expect(screen.getByRole("button", { name: /^model$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(userAffordance());
    const profileOpen = dialog()!;
    expect(profileOpen.getAttribute("aria-label")).toBe("Profile");

    // Moving between sections inside the overlay does not close and re-open it:
    // it is the same DOM node, still open, now naming the other section.
    fireEvent.click(within(profileOpen).getByRole("tab", { name: "Settings" }));
    expect(dialog()).toBe(profileOpen);
    expect(profileOpen.getAttribute("aria-label")).toBe("Settings");
    expect(useCbe.getState().overlaySection).toBe("settings");
  });

  it("carries the two sections as SIBLINGS — the profile is never nested inside Settings", () => {
    renderChrome();
    fireEvent.click(gear());
    const settingsSection = document.querySelector("#overlay-section-settings")!;
    const profileSection = document.querySelector("#overlay-section-profile")!;
    expect(settingsSection.contains(profileSection)).toBe(false);
    expect(profileSection.contains(settingsSection)).toBe(false);
    expect(settingsSection.parentElement).toBe(profileSection.parentElement);
  });
});

describe("Scenario: The overlay closes three ways and returns focus", () => {
  it.each([
    ["Escape", () => fireEvent.keyDown(dialog()!, { key: "Escape" })],
    ["the dismiss affordance", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["a click on the backdrop", () => fireEvent.mouseDown(screen.getByTestId("overlay-backdrop"))],
  ])("closes on %s and hands focus back to the affordance that opened it", (_label, dismiss) => {
    renderChrome();
    gear().focus();
    fireEvent.click(gear());
    expect(dialog()).not.toBeNull();
    // Focus moved INTO the overlay on open.
    expect(dialog()!.contains(document.activeElement)).toBe(true);

    dismiss();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(gear());
  });

  it("returns focus to the user affordance when that is what opened it", () => {
    renderChrome();
    userAffordance().focus();
    fireEvent.click(userAffordance());
    fireEvent.keyDown(dialog()!, { key: "Escape" });
    expect(document.activeElement).toBe(userAffordance());
  });

  it("closes on Escape after a click on dead space inside the surface", () => {
    renderChrome();
    gear().focus();
    fireEvent.click(gear());
    const d = dialog()!;
    // A click on a non-focusable area (a read-only row, a label, the padding
    // between fields) lands on the surface, which takes focus itself instead of
    // dropping it — jsdom performs no focus fixup, so the attribute that makes
    // that true is asserted directly, and the drop is then forced anyway.
    expect(d.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(d);
    act(() => (document.activeElement as HTMLElement | null)?.blur());

    // Worst case: focus sits on <body>, so the press never travels through the
    // surface's own handler and only the document listener can close it.
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(gear());
  });

  it("an Escape that dismisses a settings-field tooltip does not also close the overlay", () => {
    renderChrome();
    gear().focus();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    const field = screen.getByPlaceholderText("model-id");
    act(() => field.focus());
    // The explanation is revealed by activating the field's `?` help control —
    // focusing the field no longer reveals anything (Requirement: Collected UX
    // Polish, since `split-llm-settings-into-standard-and-advanced`). The
    // carve-out under test is unchanged: an Escape that dismisses a revealed
    // explanation stops there.
    const tooltip = document.getElementById(field.getAttribute("aria-describedby")!)!;
    expect(tooltip.dataset.open).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "What is Model ID?" }));
    act(() => field.focus());
    expect(tooltip.dataset.open).toBe("true");

    // WCAG 1.4.13: the press dismisses the explanation and stops there. The
    // document listener is on the BUBBLE phase precisely so this carve-out holds.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(tooltip.dataset.open).toBe("false");
    expect(dialog()).not.toBeNull();

    // With nothing left to dismiss, the next press reaches the overlay.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(gear());
  });

  it("a drag that starts inside the surface and ends on the backdrop does not close it", () => {
    renderChrome();
    fireEvent.click(gear());
    // The press starts on the surface, so the backdrop's own mousedown never
    // fires with itself as the target — selecting text to the edge is not a
    // dismissal.
    fireEvent.mouseDown(dialog()!);
    expect(dialog()).not.toBeNull();
  });
});

describe("Scenario: The overlay is modal and traps focus", () => {
  it("exposes role=dialog, aria-modal and a name identifying the open section", () => {
    renderChrome();
    fireEvent.click(gear());
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-label")).toBe("Settings");
    fireEvent.click(within(d).getByRole("tab", { name: "Profile" }));
    expect(d.getAttribute("aria-label")).toBe("Profile");
  });

  // Two mechanisms, one per test: Tab wraps at both ends (below), and anything
  // that reaches a control behind the backdrop by another route is recovered by
  // the document-level `focusin` guard (the test after it). The keydown handler
  // deliberately no longer carries a pull-back branch — a key pressed inside the
  // surface cannot be the case where focus has already left it.
  it("wraps focus at both ends instead of letting it leave the overlay", () => {
    renderChrome();
    fireEvent.click(gear());
    const d = dialog()!;
    const stops = Array.from(d.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")).filter(
      (el) => el.closest("[hidden]") === null
    );
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;

    last.focus();
    fireEvent.keyDown(d, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(d, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back in when it has escaped the overlay", () => {
    renderChrome();
    fireEvent.click(gear());
    const d = dialog()!;
    // A control behind the backdrop takes focus by its own route — no key press
    // involved, which is exactly the case a Tab handler can never see.
    gear().focus();
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(gear());
  });

  // The skipped restore is the INTENDED carve-out, not a gap: a close that has
  // already placed focus somewhere on purpose must not be overridden by the
  // hand-back. Do not "fix" the guard to restore the opener here.
  it("does not override a close that moved focus on purpose", () => {
    renderChrome();
    gear().focus();
    fireEvent.click(gear());
    const outside = userAffordance();
    // A dismissal that deliberately parks focus elsewhere: the store is already
    // closed when the move happens, so the guard neither pulls it back nor
    // overrides it with the opener.
    act(() => {
      useCbe.getState().closeSettingsSurface();
      outside.focus();
    });
    expect(document.activeElement).toBe(outside);
  });

  it("does not count a control in the section that is not shown as a tab stop", () => {
    renderChrome();
    fireEvent.click(userAffordance()); // Profile shown, Settings hidden
    const d = dialog()!;
    const settingsSection = d.querySelector("#overlay-section-settings") as HTMLElement;
    expect(settingsSection.hasAttribute("hidden")).toBe(true);
    // Its headers are still mounted (that is how an unsaved edit survives) but
    // they are out of the accessibility tree, so a role query cannot reach them.
    expect(within(d).queryByRole("button", { name: /^model$/i })).toBeNull();
    expect(settingsSection.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});

describe("Scenario: The overlay is modal and traps focus — nothing behind the backdrop keeps its keyboard", () => {
  it("suppresses the composer's slash popup while the overlay is open, so Escape still closes it and focus never lands on the composer", async () => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => CONVERSATION,
      getCommands: async () => [{ name: "cite", description: "Insert a citation", source: "extension" }],
    });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    const composer = screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "/ci" } });
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy());

    fireEvent.click(gear());
    // The popup owns a capture-phase document keydown listener, so leaving it
    // rendered behind the backdrop would let it swallow Escape and pull focus
    // onto the composer on Enter.
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(composer);

    // Nothing was lost by stepping aside: the draft is intact and the popup is
    // back the moment the overlay closes.
    expect(composer.value).toBe("/ci");
    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
  });
});

describe("Scenario: An unsaved settings edit survives a dismissal", () => {
  it("keeps the edit and translated gear mark through a header language change, then re-opens it", async () => {
    renderChrome();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "half-typed-model" } });

    // Dismiss by clicking outside — the dismissal that would be unsafe if
    // anything were lost by it.
    fireEvent.mouseDown(screen.getByTestId("overlay-backdrop"));
    expect(dialog()).toBeNull();

    // The gear carries the unsaved-changes indication so the lecturer can see
    // they left an edit behind.
    expect(gear().getAttribute("aria-label")).toBe("Open settings — unsaved changes");

    Object.assign(window.cbe, {
      setInterfaceLanguage: vi.fn().mockResolvedValue({ ok: true, language: "de" }),
    });
    fireEvent.click(document.querySelector(".header-language-trigger") as HTMLElement);
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    await waitFor(() => expect(gear().getAttribute("aria-label")).toBe(de.headerOpenSettingsUnsaved));
    expect(useCbe.getState().settingsDirtyGroup).toBe("model");

    fireEvent.click(gear());
    // The single exception to the Appearance default: the group holding the
    // pending edit is the open one, so the edit is ON SCREEN rather than behind
    // a closed header.
    expect(screen.getByRole("button", { name: /^modell$/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /darstellung/i }).getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByPlaceholderText(de.settingsModelIdPlaceholder) as HTMLInputElement).value).toBe(
      "half-typed-model"
    );
  });

  // Scenario (Settings Panel): *A later open with nothing pending still opens on
  // Appearance* — no "last-open group" memory exists, and none may be introduced.
  it("a later open with nothing pending opens on Appearance again, not on the group last used", () => {
    renderChrome();
    fireEvent.click(gear());
    expect(screen.getByRole("button", { name: /appearance/i }).getAttribute("aria-expanded")).toBe("true");

    // Open Model (Appearance closes), change nothing, close.
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    fireEvent.keyDown(dialog()!, { key: "Escape" });
    expect(useCbe.getState().settingsDirtyGroup).toBe(null);
    expect(gear().getAttribute("aria-label")).toBe("Open settings");

    fireEvent.click(gear());
    const state = Array.from(document.querySelectorAll(".settings-panel .set-acc-header")).map((h) => [
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

  it("a pending edit survives a trip through the Profile section too", () => {
    renderChrome();
    fireEvent.click(gear());
    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    fireEvent.change(screen.getByPlaceholderText("model-id"), { target: { value: "still-here" } });

    fireEvent.click(within(dialog()!).getByRole("tab", { name: "Profile" }));
    fireEvent.click(within(dialog()!).getByRole("tab", { name: "Settings" }));

    expect((screen.getByPlaceholderText("model-id") as HTMLInputElement).value).toBe("still-here");
  });
});

describe("Scenario: The overlay takes no layout width from the workspace", () => {
  beforeEach(() => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => CONVERSATION,
    });
  });

  it("leaves both panels' widths and states untouched, and offers no resize or collapse of its own", async () => {
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    // Expand the left panel so BOTH panels are expanded when the overlay opens.
    act(() => useCbe.getState().setLeftPanelCollapsed(false));

    const workspace = () => document.querySelector(".workspace") as HTMLElement;
    const before = {
      columns: workspace().style.gridTemplateColumns,
      left: workspace().dataset.leftCollapsed,
      right: workspace().dataset.collapsed,
    };
    const handlesBefore = document.querySelectorAll(".panel-resize-handle").length;

    fireEvent.click(gear());

    // Drawn OVER an unchanged workspace: same track widths, same collapse
    // states, still mounted and still laid out (no `workspace-hidden` idiom).
    expect(workspace().style.gridTemplateColumns).toBe(before.columns);
    expect(workspace().dataset.leftCollapsed).toBe(before.left);
    expect(workspace().dataset.collapsed).toBe(before.right);
    expect(document.querySelectorAll(".panel-resize-handle").length).toBe(handlesBefore);
    expect(workspace().className).not.toContain("hidden");

    // The overlay itself carries neither affordance.
    const d = dialog()!;
    expect(d.querySelector(".panel-resize-handle")).toBeNull();
    expect(within(d).queryByRole("button", { name: /collapse|expand/i })).toBeNull();
  });

  it("keeps a half-typed composer draft, because the chat column is never torn down", async () => {
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;
    fireEvent.change(composer(), { target: { value: "Wie formuliere ich die Leitfrage" } });

    fireEvent.click(gear());
    fireEvent.keyDown(dialog()!, { key: "Escape" });

    expect(composer().value).toBe("Wie formuliere ich die Leitfrage");
  });
});

describe("Scenario: A running turn is neither blocked by nor closes the overlay", () => {
  it("stays open through a turn and reflects a cbe_profile call live", async () => {
    renderChrome();
    fireEvent.click(userAffordance());
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));

    act(() => useCbe.setState({ agentRunning: true }));
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute("aria-label")).toBe("Profile");

    act(() =>
      applyProfileFromToolResult(
        {
          details: {
            kind: "profile-update",
            dimension: "cbe-prior-knowledge",
            value: "some",
            confidence: "medium",
            evidence: "named a CBE module they co-taught",
          },
        },
        false
      )
    );

    // The turn continues undisturbed, the overlay stays open, the section updates.
    expect(useCbe.getState().agentRunning).toBe(true);
    expect(dialog()).not.toBeNull();
    expect(screen.getByText("named a CBE module they co-taught")).toBeTruthy();
  });
});

describe("Scenario: A course switch leaves the overlay open and re-resolves the profile", () => {
  it("stays open and shows the newly active course's lecturer state", async () => {
    const first: LecturerProfile = {
      capacity: {
        value: "limited",
        confidence: "medium",
        evidence: "first course's overlay",
        provenance: "override",
        lastRevised: "2026-08-14T09:00:00.000Z",
      },
    };
    Object.assign(window.cbe, { getLecturerProfile: async () => first });

    renderChrome();
    fireEvent.click(userAffordance());
    await waitFor(() => expect(screen.getByText("first course's overlay")).toBeTruthy());

    // A switch by any other path (the left panel is behind the focus trap) —
    // the host rewrites the profile slice for the newly active course.
    act(() =>
      useCbe.setState({
        activeCourseId: "other-course",
        lecturerProfile: {
          capacity: {
            value: "generous",
            confidence: "high",
            evidence: "second course's overlay",
            provenance: "estimate",
            lastRevised: "2026-08-14T09:30:00.000Z",
          },
        },
      })
    );

    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute("aria-label")).toBe("Profile");
    expect(screen.getByText("second course's overlay")).toBeTruthy();
    expect(screen.queryByText("first course's overlay")).toBeNull();
  });
});

// Requirement: Profile Panel — Scenario: *The profile is reached from the user
// affordance, not from a panel tab*.
describe("Scenario: The profile is reached from the user affordance, not from a panel tab", () => {
  it("shows the five dimensions with their override controls, and no Profile tab exists in the right panel", async () => {
    renderChrome();
    fireEvent.click(userAffordance());
    await waitFor(() => expect(screen.getAllByText("not yet estimated").length).toBe(5));
    for (const label of [
      "PBL prior knowledge",
      "CBE prior knowledge",
      "Didactic stance",
      "Attitude toward CBE",
      "Teaching load / capacity",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByLabelText(`Override ${label}`)).toBeTruthy();
    }
    expect(screen.queryByRole("tab", { name: /profile/i, hidden: false })).toBeTruthy();
    // …and nothing in the right panel: the overlay is the only home.
    expect(document.querySelector(".panel-tabs")).toBeNull();
  });
});

describe("The overlay is workspace chrome and does not outlive the workspace", () => {
  it("closes when the app falls back to the onboarding dialog", async () => {
    Object.assign(window.cbe, {
      getConfig: async () => PROVIDER,
      openConversation: async () => CONVERSATION,
    });
    render(<App />);
    await waitFor(() => expect(useCbe.getState().hydration).toBe("ready"));
    fireEvent.click(gear());
    expect(dialog()).not.toBeNull();

    // e.g. the credential erased from Settings.
    act(() => useCbe.getState().setConfigured(false));

    await waitFor(() => expect(useCbe.getState().overlaySection).toBe(null));
    expect(dialog()).toBeNull();
  });

  it("nothing of the stage-1 bridge survives", () => {
    renderChrome();
    fireEvent.click(gear());
    expect(document.querySelector(".settings-bridge")).toBeNull();
    expect(document.querySelector(".workspace-hidden")).toBeNull();
    expect(screen.queryByRole("button", { name: /back to the workspace/i })).toBeNull();
    expect("bridgeSurface" in useCbe.getState()).toBe(false);
  });
});

describe("The overlay is never open on a fresh mount", () => {
  it("renders nothing at all before the first open, and keeps no open state across a reset", () => {
    const { container } = render(<ProfileSettingsOverlay />);
    expect(container.firstChild).toBeNull();
    expect(useCbe.getState().overlaySection).toBe(null);

    act(() => useCbe.getState().showSettingsSurface("settings"));
    expect(dialog()).not.toBeNull();

    act(() => useCbe.getState().reset());
    expect(dialog()).toBeNull();
  });

  it("does not run the sections' mount work before it has been opened once", () => {
    const profileSpy = vi.fn().mockResolvedValue({});
    Object.assign(window.cbe, { getLecturerProfile: profileSpy });
    render(<ProfileSettingsOverlay />);
    expect(profileSpy).not.toHaveBeenCalled();

    act(() => useCbe.getState().showSettingsSurface("profile"));
    expect(profileSpy).toHaveBeenCalledTimes(1);
  });
});
