import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/renderer/App.js";
import { ChatPanel, HELP_TOKEN } from "../src/renderer/components/ChatPanel.js";
import { AppHeader } from "../src/renderer/components/AppHeader.js";
import {
  FirstUseOverview,
  firstUseContent,
  missingFirstUseContent,
} from "../src/renderer/components/FirstUseOverview.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { setActiveLanguage } from "../src/renderer/chrome.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";
import { en } from "../src/shared/i18n/en.js";
import { useCbe } from "../src/renderer/state/store.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import type { ConversationOpenResult, OnboardingStateEvent } from "../src/shared/ipc-contract.js";

const conversation = (): ConversationOpenResult => ({
  session: testSession("onboarding-session", "course-a"),
  turns: [],
  agentRunning: false,
  canvas: [],
  maturity: {},
});

function seedPending() {
  useCbe.getState().reset();
  seedConversation({ session: testSession("onboarding-session", "course-a") });
  useCbe.setState({
    configured: true,
    hydration: "ready",
    onboardingStatus: "pending",
    onboardingIssue: null,
  });
}

const overview = () => screen.getByRole("region", { name: en.onboardingHeading });
const composer = () => screen.getByRole("textbox", { name: en.chatComposerFieldLabel }) as HTMLTextAreaElement;

beforeEach(seedPending);
afterEach(() => {
  cleanup();
  useCbe.getState().reset();
});

describe("Proactive First-Use Product Orientation", () => {
  it.each(["pending", "acknowledged"] as const)("owns the chat rows including notices with onboarding %s", (status) => {
    useCbe.setState({ onboardingStatus: status });
    const { container } = render(<ChatPanel />);
    const rows = [".conv-header", ".first-use-row", ".chat-scroll", ".chat-notices", ".composer"].map(
      (selector) => container.querySelector(selector)!
    );
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].compareDocumentPosition(rows[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(rows[1].hasAttribute("hidden")).toBe(status === "acknowledged");
    expect(rows[1].parentElement).toBe(rows[4].parentElement);
    // jsdom has no grid layout. Pin row ownership here; the Electron lane proves
    // geometry with hidden/visible onboarding, not just DOM order.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderer/styles.css"), "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    expect(rule(".conv")).toContain("grid-template-rows: auto auto minmax(0, 1fr) auto auto");
    for (const [selector, row] of [
      [".conv-header", 1],
      [".first-use-row", 2],
      [".chat-scroll", 3],
      [".chat-notices", 4],
      [".composer", 5],
    ] as const) {
      expect(rule(selector)).toContain(`grid-row: ${row}`);
    }
    expect(rule(".chat-scroll")).toContain("overflow-y: auto");
  });

  it("A ready workspace explains its value without becoming a gate", () => {
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const { container } = render(<ChatPanel />);

    const card = overview();
    const row = card.closest(".first-use-row")!;
    expect(row.previousElementSibling?.getAttribute("aria-live")).toBe("polite");
    expect(row.nextElementSibling).toBe(container.querySelector(".chat-scroll"));
    expect(
      container.querySelector(".conv-header")!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelector(".composer")!.contains(card)).toBe(false);
    expect(container.querySelector(".chat-scroll")!.contains(card)).toBe(false);
    expect(card.getAttribute("aria-modal")).toBeNull();
    expect(card.querySelectorAll("h2")).toHaveLength(1);
    expect(card.querySelectorAll("li")).toHaveLength(3);
    expect(composer().disabled).toBe(false);
    fireEvent.change(composer(), { target: { value: "My own starting point" } });
    expect(composer().value).toBe("My own starting point");
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useCbe.getState().turns).toHaveLength(0);
  });

  it("locates course management, stored Chats, Wiki, conversation, Canvas and Maturity in one bounded reading", () => {
    render(<ChatPanel />);
    const card = overview();
    const text = card.textContent ?? "";
    const content = firstUseContent(en);

    for (const unit of Object.values(content)) expect(text).toContain(unit);
    expect(card.querySelectorAll('[data-onboarding-unit="course"]')).toHaveLength(1);
    expect(card.querySelectorAll('[data-onboarding-unit="wiki"]')).toHaveLength(1);
    expect(card.querySelectorAll('[data-onboarding-unit="design"]')).toHaveLength(1);
    expect(text).toContain(en.coursesTabChats);
    expect(text).toContain(en.coursesTabWiki);
    expect(text).toContain("CBE Process Canvas");
    expect(text).toContain("CBE Maturity");
    expect(text).not.toMatch(/Project|certified knowledge|all Wiki material/i);
  });

  it("Wiki material is explained without importing, retrieving, dispatching or consuming a pending attachment", async () => {
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    const ingestFile = vi
      .spyOn(window.cbe, "ingestFile")
      .mockResolvedValue([{ ok: true, filename: "module.pdf", docType: "pdf", text: "material body" }]);
    const listWikiAtoms = vi.spyOn(window.cbe, "listWikiAtoms");
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel })));
    expect(screen.getByText(/module\.pdf/)).toBeTruthy();
    const wikiBullet = overview().querySelector('[data-onboarding-unit="wiki"]')!;
    expect(wikiBullet.textContent).toContain(firstUseContent(en).wikiReuse);
    expect(wikiBullet.textContent).toContain(firstUseContent(en).wikiGrounding);
    expect(wikiBullet.textContent).toContain(firstUseContent(en).attachmentDistinction);
    expect(ingestFile).toHaveBeenCalledTimes(1);
    expect(listWikiAtoms).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(screen.getByText(/module\.pdf/)).toBeTruthy();
  });

  it.each([en.onboardingBegin, en.onboardingSkip])("Begin and skip hand into unchanged work: %s", async (action) => {
    const acknowledge = vi.spyOn(window.cbe, "acknowledgeOnboarding").mockResolvedValue({
      acknowledged: true,
      persisted: true,
    });
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, filename: "draft.pdf", docType: "pdf", text: "body" },
    ]);
    render(<ChatPanel />);
    fireEvent.change(composer(), { target: { value: "Unfinished lecturer draft" } });
    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel })));
    const before = {
      session: useCbe.getState().session,
      artifacts: useCbe.getState().artifacts,
      steps: useCbe.getState().steps,
      maturity: useCbe.getState().maturity,
    };

    await act(async () => fireEvent.click(screen.getByRole("button", { name: action })));

    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    expect(document.activeElement).toBe(composer());
    expect(composer().value).toBe("Unfinished lecturer draft");
    expect(screen.getByText(/draft\.pdf/)).toBeTruthy();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useCbe.getState()).toMatchObject(before);
    expect(useCbe.getState().turns).toHaveLength(0);
  });

  it("accepted attachment-only work dismisses with the exact unchanged payload", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, filename: "review.pdf", docType: "pdf", text: "EXACT BODY" },
    ]);
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockImplementation(async (_id, _text, _display) => {
      useCbe.getState().acknowledgeOnboarding();
      return { ok: true };
    });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.chatSendLabel })));

    expect(sendPrompt).toHaveBeenCalledWith("onboarding-session", expect.stringContaining("EXACT BODY"), {
      text: "",
      attachments: [{ filename: "review.pdf", docType: "pdf" }],
    });
    expect(sendPrompt.mock.calls[0]![1]).not.toContain(en.onboardingHeading);
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
  });

  it("the one shared Help route acknowledges only after acceptance and keeps its byte-identical payload", async () => {
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockImplementation(async () => {
      useCbe.getState().acknowledgeOnboarding();
      return { ok: true };
    });
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.headerHelpLabel })));
    expect(sendPrompt).toHaveBeenCalledWith("onboarding-session", HELP_TOKEN, { text: en.chatHelpDisplayText });
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
  });

  it("a rejected Help dispatch leaves the same pending offer available", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(new Error("Agent is already processing"));
    render(
      <>
        <AppHeader workspaceVisible configured />
        <ChatPanel />
      </>
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.headerHelpLabel })));
    expect(overview()).toBeTruthy();
    expect(useCbe.getState().onboardingStatus).toBe("pending");
  });

  it("a rejected ordinary dispatch keeps the offer and restores an attachment", async () => {
    vi.spyOn(window.cbe, "sendPrompt").mockRejectedValue(new Error("Agent is already processing"));
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue([
      { ok: true, filename: "retry.pdf", docType: "pdf", text: "body" },
    ]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.chatPlusMenuLabel }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: en.chatUploadEntryLabel })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.chatSendLabel })));

    expect(overview()).toBeTruthy();
    expect(screen.getByRole("button", { name: en.chatRemoveAttachmentLabel({ filename: "retry.pdf" }) })).toBeTruthy();
    expect(useCbe.getState().onboardingStatus).toBe("pending");
  });

  it("unready, visible-busy and modal states defer without consuming; a background run does not", () => {
    const { rerender } = render(<ChatPanel />);
    expect(overview()).toBeTruthy();

    act(() => useCbe.getState().setDispatchPending(true));
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    expect(useCbe.getState().onboardingStatus).toBe("pending");
    act(() => useCbe.getState().setDispatchPending(false));
    expect(overview()).toBeTruthy();

    act(() => useCbe.getState().showSettingsSurface("settings"));
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    act(() => useCbe.getState().closeSettingsSurface());
    expect(overview()).toBeTruthy();

    act(() => useCbe.getState().setModalSurfaceOpen(true));
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    act(() => useCbe.getState().setModalSurfaceOpen(false));
    expect(overview()).toBeTruthy();

    seedBackgroundConversation("background", "course-b", { live: { ...useCbe.getState().live, streaming: true } });
    rerender(<ChatPanel />);
    expect(overview()).toBeTruthy();
  });

  it("announces availability once without focus theft or global Escape dismissal", () => {
    const { container, rerender } = render(<ChatPanel />);
    composer().focus();
    expect(document.activeElement).toBe(composer());
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(en.onboardingAvailability);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(overview()).toBeTruthy();
    rerender(<ChatPanel />);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(en.onboardingAvailability);
    expect(useCbe.getState().onboardingAnnounced).toBe(true);
  });
});

describe("Record loading and accepted dispatch races", () => {
  it.each(["seeded", "manual"] as const)("%s provider setup leads to the same offer", async (route) => {
    useCbe.getState().reset();
    Object.assign(window.cbe, {
      readOnboarding: async () => ({ acknowledged: false }),
      onOnboardingChanged: () => () => {},
      getConfig: async () =>
        route === "seeded" ? { baseURL: "http://localhost:1", modelId: "model", hasKey: true } : null,
      listCourses: async () => ({ courses: [], activeCourseId: "course-a" }),
      openConversation: async () => conversation(),
    });
    render(<App />);
    if (route === "manual") {
      await waitFor(() => expect(useCbe.getState().configured).toBe(false));
      act(() => {
        useCbe.getState().setProviderStatus({ baseURL: "http://localhost:1", modelId: "model", hasKey: true });
        useCbe.getState().setConfigured(true);
      });
    }
    expect(await screen.findByRole("region", { name: en.onboardingHeading })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
  });

  it("offers an existing stored conversation without mutating its turns", async () => {
    useCbe.getState().reset();
    const existing = conversation();
    existing.turns = [
      { role: "user", text: "Existing lecturer content" },
      { role: "assistant", text: "Existing assistant content" },
    ];
    Object.assign(window.cbe, {
      readOnboarding: async () => ({ acknowledged: false }),
      onOnboardingChanged: () => () => {},
      getConfig: async () => ({ baseURL: "http://localhost:1", modelId: "model", hasKey: true }),
      listCourses: async () => ({ courses: [], activeCourseId: "course-a" }),
      openConversation: async () => existing,
    });
    render(<App />);
    expect(await screen.findByRole("region", { name: en.onboardingHeading })).toBeTruthy();
    expect(screen.getByText("Existing lecturer content")).toBeTruthy();
    expect(useCbe.getState().turns).toHaveLength(2);
  });

  it("surfaces unreadable and unwritable preference outcomes without blocking work", async () => {
    useCbe.getState().reset();
    Object.assign(window.cbe, {
      readOnboarding: async () => ({ acknowledged: false, issue: "unreadable" as const }),
      acknowledgeOnboarding: async () => ({ acknowledged: true as const, persisted: false }),
      onOnboardingChanged: () => () => {},
      getConfig: async () => ({ baseURL: "http://localhost:1", modelId: "model", hasKey: true }),
      listCourses: async () => ({ courses: [], activeCourseId: "course-a" }),
      openConversation: async () => conversation(),
    });
    render(<App />);
    expect(await screen.findByText(en.onboardingReadFailure)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.onboardingSkip })));
    expect(await screen.findByText(en.onboardingWriteFailure)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: en.chatComposerFieldLabel })).toBeTruthy();
  });

  it("keeps the card hidden while the record is unknown and never lets a late read reverse accepted work", async () => {
    useCbe.getState().reset();
    let resolveRead!: (value: { acknowledged: boolean }) => void;
    let stateListener: ((event: OnboardingStateEvent) => void) | undefined;
    const readOnboarding = vi.fn(() => new Promise<{ acknowledged: boolean }>((resolve) => (resolveRead = resolve)));
    const sendPrompt = vi.fn(async (_id: string, text: string, display?: unknown) => {
      expect(text).toBe("My exact payload");
      expect(display).toEqual({ text: "My exact payload" });
      stateListener?.({ acknowledged: true, persistence: "saving" });
      return { ok: true as const };
    });
    Object.assign(window.cbe, {
      readOnboarding,
      onOnboardingChanged: (listener: (event: OnboardingStateEvent) => void) => {
        stateListener = listener;
        return () => {};
      },
      getConfig: async () => ({ baseURL: "http://localhost:1", modelId: "model", hasKey: true }),
      listCourses: async () => ({ courses: [], activeCourseId: "course-a" }),
      openConversation: async () => conversation(),
      sendPrompt,
    });

    render(<App />);
    await screen.findByRole("textbox", { name: en.chatComposerFieldLabel });
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    fireEvent.change(composer(), { target: { value: "My exact payload" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: en.chatSendLabel })));
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    act(() => resolveRead({ acknowledged: false }));
    await waitFor(() => expect(readOnboarding).toHaveBeenCalled());
    expect(useCbe.getState().onboardingStatus).toBe("acknowledged");
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
  });
});

describe("Accessible and Localised First-Use Orientation", () => {
  it("derives every shipped language and renders the exact reviewed semantic units in both locations", () => {
    for (const language of Object.values(LANGUAGES)) {
      cleanup();
      setActiveLanguage(language.code);
      const content = firstUseContent(language.strings);
      expect(missingFirstUseContent(content), language.code).toEqual([]);
      render(
        <>
          <FirstUseOverview id={`auto-${language.code}`} mode="automatic" onBegin={() => {}} onSkip={() => {}} />
          <FirstUseOverview id={`about-${language.code}`} mode="reread" onClose={() => {}} />
        </>
      );
      const regions = screen.getAllByRole("region", { name: content.heading });
      expect(regions).toHaveLength(2);
      for (const region of regions) {
        expect(region.querySelectorAll("h2")).toHaveLength(1);
        expect(region.querySelectorAll("li")).toHaveLength(3);
        for (const unit of Object.values(content)) expect(region.textContent).toContain(unit);
        expect(region.textContent).toContain(language.strings.coursesTabChats);
        expect(region.textContent).toContain(language.strings.coursesTabWiki);
      }
    }
  });

  it("updates both visible locations immediately when the selected registry language changes", () => {
    const languages = Object.values(LANGUAGES);
    const first = languages[0]!;
    const next = languages.find((language) => language.code !== first.code)!;
    setActiveLanguage(first.code);
    render(
      <>
        <FirstUseOverview id="live-auto" mode="automatic" onBegin={() => {}} onSkip={() => {}} />
        <FirstUseOverview id="live-about" mode="reread" onClose={() => {}} />
      </>
    );
    expect(screen.getAllByRole("region", { name: first.strings.onboardingHeading })).toHaveLength(2);

    act(() => setActiveLanguage(next.code));
    expect(screen.getAllByRole("region", { name: next.strings.onboardingHeading })).toHaveLength(2);
    expect(screen.queryByRole("region", { name: first.strings.onboardingHeading })).toBeNull();
  });

  it("fails the same coverage check when course management, Wiki explanation or attachment distinction is omitted", () => {
    const complete = firstUseContent(en);
    for (const key of ["courseNavigation", "wikiReuse", "attachmentDistinction"] as const) {
      expect(missingFirstUseContent({ ...complete, [key]: "" })).toContain(key);
    }
  });

  it("About rereading is inline, closes locally, acknowledges, and never dispatches Help", async () => {
    const acknowledge = vi.spyOn(window.cbe, "acknowledgeOnboarding").mockResolvedValue({
      acknowledged: true,
      persisted: true,
    });
    const sendPrompt = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    useCbe.setState({ overlaySection: "settings", settingsOpenGroup: "about" });
    render(<SettingsPanel />);
    const trigger = screen.getByRole("button", { name: en.onboardingReread });
    fireEvent.click(trigger);
    const region = overview();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(region.id);
    expect(region.closest('[role="dialog"]')).toBeNull();
    expect(useCbe.getState().settingsOpenGroup).toBe("about");

    await act(async () => fireEvent.click(within(region).getByRole("button", { name: en.onboardingClose })));
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(sendPrompt).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("About rereading remains available during a run, hydration failure and installed-info failure", async () => {
    Object.assign(window.cbe, { getAboutInfo: async () => Promise.reject(new Error("unreadable")) });
    useCbe.setState({
      overlaySection: "settings",
      settingsOpenGroup: "about",
      hydration: "error",
      agentRunning: true,
    });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.onboardingReread }));
    expect(overview()).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(en.settingsAboutUnavailable)).toHaveLength(4));
  });

  it("the About trigger toggles what aria-expanded announces, and collapsing there acknowledges nothing", () => {
    const acknowledge = vi.spyOn(window.cbe, "acknowledgeOnboarding");
    useCbe.getState().reset();
    useCbe.setState({ overlaySection: "settings", settingsOpenGroup: "about" });
    render(<SettingsPanel />);
    const trigger = screen.getByRole("button", { name: en.onboardingReread });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(overview()).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(useCbe.getState().onboardingStatus).not.toBe("acknowledged");
  });

  it("collapsing About clears rereading without acknowledging", () => {
    const acknowledge = vi.spyOn(window.cbe, "acknowledgeOnboarding");
    useCbe.setState({ overlaySection: "settings", settingsOpenGroup: "about" });
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: en.onboardingReread }));
    expect(overview()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.settingsGroupAppearance }));
    expect(screen.queryByRole("region", { name: en.onboardingHeading })).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
