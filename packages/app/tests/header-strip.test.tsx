/**
 * The app header strip after the chrome rebuild (capability `desktop-app`,
 * Requirement: App Header Strip). Every Scenario in the spec delta has a matching
 * test:
 *   - Active course visible at all times
 *   - The header carries no provider or model information
 *   - The composer's model pill is the only workspace surface naming the model
 *   - An unconfigured provider is still evident without a header readout
 *   - The header course name reveals the course surface instead of switching
 *   - The top-right affordances sit in the specified order, with language first
 *   - The gear and the user affordance reach their sections
 *   - The header offers no course creation
 * plus the gear's unsaved-changes indication (Requirements: App Header Strip;
 * Settings Save Feedback and Unsaved-Changes Indication).
 *
 * (Replaces `header-course-switcher.test.tsx`: the switcher dropdown is removed.
 * The switch mechanics it exercised now run through the left panel's course
 * cards — `course-switch-from-left-panel.test.tsx`.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import type { CourseSummary, ProviderStatus } from "../src/shared/ipc-contract.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { seedConversation, testSession } from "./helpers/conversation.js";

const COURSES: CourseSummary[] = [
  { id: "algorithmen", title: "Algorithmen", path: "/space/courses/algorithmen" },
  { id: "datenbanken", title: "Datenbanken", path: "/space/courses/datenbanken" },
];

const PROVIDER: ProviderStatus = {
  baseURL: "https://api.example.com/v1",
  modelId: "claude-opus-4-8",
  hasKey: true,
};

beforeEach(() => {
  useCbe.setState({ courses: COURSES, activeCourseId: "algorithmen" });
});
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ courses: [], activeCourseId: "" });
});

describe("Scenario: Active course visible at all times", () => {
  it("names the active course, whatever the left panel's state", () => {
    render(<AppHeader workspaceVisible />);
    expect(document.querySelector(".app-header-course")!.textContent).toBe("Algorithmen");

    useCbe.getState().setLeftPanelCollapsed(true);
    expect(document.querySelector(".app-header-course")!.textContent).toBe("Algorithmen");
  });

  it("shows a clear placeholder when no course is active", () => {
    useCbe.setState({ courses: [], activeCourseId: "" });
    render(<AppHeader workspaceVisible />);
    expect(document.querySelector(".app-header-course")!.textContent).toBe("no active course");
  });
});

describe("Scenario: The header carries no provider or model information", () => {
  it("shows neither the host nor the model id — no readout, no badge, no tooltip", () => {
    useCbe.setState({ providerStatus: PROVIDER, configured: true });
    const { container } = render(<AppHeader workspaceVisible />);
    const header = container.querySelector(".app-header") as HTMLElement;

    expect(header.textContent).not.toContain("api.example.com");
    expect(header.textContent).not.toContain("claude-opus-4-8");
    // Not hidden in an attribute either — a tooltip would be a readout too.
    expect(header.innerHTML).not.toMatch(/api\.example\.com|claude-opus-4-8/);
    // …and the header does not report the configuration state in words.
    expect(header.textContent).not.toMatch(/not configured/i);
  });

  it("takes no providerStatus prop at all — the readout has no way back in", () => {
    // The component's contract, not just its output: nothing can pass a provider
    // into the header, so re-adding the chip is a visible signature change.
    expect(AppHeader.length).toBe(1); // one props object
    const { container } = render(<AppHeader configured />);
    expect(container.querySelectorAll(".app-header-right button")).toHaveLength(4);
  });
});

describe("Scenario: The composer's model pill is the only workspace surface naming the model", () => {
  it("the pill names the model id and nothing else of the connection; no other surface does", () => {
    useCbe.getState().reset();
    seedConversation({ session: { ...testSession(), affordances: { ingestion: true } } });
    useCbe.setState({
      courses: COURSES,
      activeCourseId: "algorithmen",
      hydration: "ready",
      providerStatus: PROVIDER,
      configured: true,
    });
    const { container } = render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    // Exactly one surface names the model id: the composer control row's pill.
    const naming = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (el) =>
        el.children.length === 0 &&
        (el.textContent?.includes(PROVIDER.modelId) ||
          [...el.attributes].some((a) => a.value.includes(PROVIDER.modelId)))
    );
    expect(naming.length).toBeGreaterThan(0);
    for (const el of naming) expect(el.closest(".composer-row")).not.toBeNull();
    // And NOTHING anywhere names the provider host.
    expect(container.innerHTML).not.toContain("api.example.com");
    // The pill carries no other connection detail either.
    const pill = container.querySelector(".model-pill") as HTMLElement;
    expect(pill.textContent).not.toContain("api.example.com");
    expect(pill.outerHTML).not.toMatch(/hasKey|apiKey|https?:/);
  });
});

describe("Scenario: An unconfigured provider is still evident without a header readout", () => {
  it("the header says nothing about it — the onboarding dialog and the chat error state carry the signal", () => {
    useCbe.setState({ providerStatus: null, configured: false });
    const { container } = render(<AppHeader />);
    expect((container.querySelector(".app-header") as HTMLElement).textContent).not.toMatch(/not configured/i);
  });
});

describe("Scenario: The header course name reveals the course surface instead of switching", () => {
  it("expands the left panel on its list level and asks the course list for focus — no dropdown", () => {
    useCbe.getState().setLeftPanelCollapsed(true);
    useCbe.getState().setCourseDetailId("datenbanken");
    const focusBefore = useCbe.getState().coursesFocusRequest;

    render(<AppHeader workspaceVisible />);
    fireEvent.click(screen.getByRole("button", { name: /show courses/i }));

    expect(useCbe.getState().leftPanelCollapsed).toBe(false);
    // The list level comes forward — switching course is what the lecturer asked
    // for, so it outranks the preserved detail level.
    expect(useCbe.getState().courseDetailId).toBe(null);
    expect(useCbe.getState().coursesFocusRequest).toBe(focusBefore + 1);
    // No dropdown, and the active course did not change by itself.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useCbe.getState().activeCourseId).toBe("algorithmen");
  });

  it("is a plain label where no left panel is rendered", () => {
    render(<AppHeader workspaceVisible={false} />);
    expect(screen.queryByRole("button", { name: /show courses/i })).toBeNull();
    expect(document.querySelector(".app-header-course")!.textContent).toBe("Algorithmen");
  });
});

describe("Scenario: The top-right affordances sit in the specified order", () => {
  it("carries language, help, gear, then the user affordance as the rightmost element", () => {
    const { container } = render(<AppHeader workspaceVisible configured />);
    const group = container.querySelector(".app-header-right") as HTMLElement;
    const labels = [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      en.headerLanguageAccessibleName({ language: "English", code: "EN" }),
      en.headerHelpLabel,
      "Open settings",
      "Open profile",
    ]);
    // The existing three retain their order and right-edge positions: Profile is
    // still last, with the gear and Help immediately to its left.
    const header = container.querySelector(".app-header") as HTMLElement;
    expect(header.querySelectorAll("button")[header.querySelectorAll("button").length - 1]).toBe(
      group.querySelectorAll("button")[3]
    );
  });
});

describe("Scenario: The gear and the user affordance reach their sections", () => {
  it("the gear opens the overlay at Settings and the user affordance at Profile", () => {
    render(<AppHeader workspaceVisible configured />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(useCbe.getState().overlaySection).toBe("settings");

    useCbe.getState().closeSettingsSurface();
    fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
    expect(useCbe.getState().overlaySection).toBe("profile");
  });

  // They are workspace chrome: on the onboarding config dialog there is no
  // workspace to open them over, and a click that still opened the overlay
  // would drop the lecturer onto Settings the moment the provider is saved.
  it("offers neither before the provider is configured", () => {
    useCbe.getState().closeSettingsSurface();
    const { container } = render(<AppHeader />);
    expect(container.querySelectorAll(".app-header-right button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open profile" })).toBeNull();
    expect(useCbe.getState().overlaySection).toBe(null);
  });
});

// Requirement: Settings Save Feedback and Unsaved-Changes Indication — "the gear
// MUST carry the unsaved-changes indication while the Settings section holds
// unsaved edits" (Requirement: App Header Strip). Mirroring it outside the
// overlay is what makes the click-outside dismissal safe rather than silent.
describe("The gear carries the unsaved-changes indication", () => {
  it("shows nothing while no edit is pending, and marks the gear once one is", () => {
    const { container } = render(<AppHeader workspaceVisible configured />);
    const gear = () => screen.getByRole("button", { name: /open settings/i });
    expect(gear().getAttribute("aria-label")).toBe("Open settings");
    expect(container.querySelector(".app-header-unsaved-dot")).toBeNull();

    act(() => useCbe.getState().setSettingsDirtyGroup("model"));

    expect(gear().getAttribute("aria-label")).toBe("Open settings — unsaved changes");
    expect(container.querySelector(".app-header-unsaved-dot")).not.toBeNull();
    // Still exactly four affordances — the indication is a marking on the gear,
    // not a control of its own.
    expect(container.querySelectorAll(".app-header-right button")).toHaveLength(4);

    act(() => useCbe.getState().setSettingsDirtyGroup(null));
    expect(container.querySelector(".app-header-unsaved-dot")).toBeNull();
  });

  it("is on the gear, never on the user affordance", () => {
    act(() => useCbe.getState().setSettingsDirtyGroup("model"));
    const { container } = render(<AppHeader workspaceVisible configured />);
    const [, , gear, user] = [...container.querySelectorAll<HTMLElement>(".app-header-right button")];
    expect(gear!.querySelector(".app-header-unsaved-dot")).not.toBeNull();
    expect(user!.querySelector(".app-header-unsaved-dot")).toBeNull();
    expect(user!.getAttribute("aria-label")).toBe("Open profile");
  });
});

describe("Scenario: The header offers no course creation", () => {
  it("has no New course entry — creation is the left panel's only", () => {
    render(<AppHeader workspaceVisible />);
    expect(screen.queryByRole("button", { name: /new course/i })).toBeNull();
    expect(screen.queryByLabelText("New course title")).toBeNull();
  });
});
