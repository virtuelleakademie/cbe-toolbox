/**
 * Tests for the `add-chat-text-size-and-trim-settings` change — one per
 * Scenario in its `desktop-app` spec delta (Requirement: Settings Panel,
 * Phase 1 scaffold):
 *
 * - Chat text size applies to the transcript and persists
 * - Settings panel contains no redundant lecturer-profile section
 *
 * jsdom applies no stylesheet, so the "applies to the transcript" half is
 * verified as (a) the data-attribute binding on the chat scroll container and
 * (b) a regression guard on the styles.css block that maps each discrete size
 * to a font-size variable the transcript text consumes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { seedConversation } from "./helpers/conversation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS_PATH = resolve(__dirname, "../src/renderer/styles.css");

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ chatTextSize: "medium" });
  localStorage.clear();
});

describe("Settings — chat text size", () => {
  // Covers Scenario: *Chat text size applies to the transcript and persists*.
  it("applies the chosen size to the transcript immediately and persists it", () => {
    seedConversation();
    const { container, unmount } = render(
      <>
        <SettingsPanel />
        <ChatPanel />
      </>
    );

    const scroll = () => container.querySelector(".chat-scroll") as HTMLElement;
    // Default: medium.
    expect(scroll().getAttribute("data-chat-text-size")).toBe("medium");

    // Changing the control re-renders the transcript container at the chosen
    // size immediately (data attribute → font-size variable in styles.css).
    const group = screen.getByRole("group", { name: "Chat text size" });
    fireEvent.click(within(group).getByRole("button", { name: "Large" }));
    expect(useCbe.getState().chatTextSize).toBe("large");
    expect(scroll().getAttribute("data-chat-text-size")).toBe("large");

    // Persistence substrate for the app-restart hydration (App.tsx reads the
    // same key with the CHAT_TEXT_SIZES allowlist).
    expect(localStorage.getItem("cbe-chat-text-size")).toBe("large");

    // A remount reflects the persisted choice (control pressed + container size).
    unmount();
    const remounted = render(
      <>
        <SettingsPanel />
        <ChatPanel />
      </>
    );
    const largeBtn = within(screen.getByRole("group", { name: "Chat text size" })).getByRole("button", {
      name: "Large",
    });
    expect(largeBtn.getAttribute("aria-pressed")).toBe("true");
    expect((remounted.container.querySelector(".chat-scroll") as HTMLElement).getAttribute("data-chat-text-size")).toBe(
      "large"
    );
  });

  it("offers the discrete sizes Small / Medium / Large with Medium as the default", () => {
    render(<SettingsPanel />);
    const group = screen.getByRole("group", { name: "Chat text size" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Small", "Medium", "Large"]);
    expect(within(group).getByRole("button", { name: "Medium" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("styles.css maps each discrete size to a font-size variable the transcript consumes", () => {
    const css = readFileSync(STYLES_CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const sizeOf = (name: string): number => {
      // Attribute-only selector: the size variable is no longer scoped to the
      // transcript container — the composer carries the same attribute since
      // `harden-canvas-determinism-and-ux2-fixes` (Scenario: *The composer input
      // follows the chat text-size setting*). The guard here stays what it always
      // was: each discrete size maps to a strictly increasing font-size variable.
      const m = css.match(
        new RegExp(`\\[data-chat-text-size="${name}"\\]\\s*\\{[^}]*--chat-font-size:\\s*([\\d.]+)px`)
      );
      if (!m) throw new Error(`no --chat-font-size rule for size "${name}"`);
      return Number(m[1]);
    };
    // Discrete, strictly increasing sizes.
    expect(sizeOf("small")).toBeLessThan(sizeOf("medium"));
    expect(sizeOf("medium")).toBeLessThan(sizeOf("large"));
    // The transcript text consumes the variable.
    expect(css).toMatch(
      /\.chat-scroll\[data-chat-text-size\]\s+\.msg-text\s*\{[^}]*font-size:\s*var\(--chat-font-size/
    );
  });
});

describe("Settings — no redundant lecturer-profile section", () => {
  // Covers Scenario: *Settings panel contains no redundant lecturer-profile
  // section*.
  it("contains no lecturer-profile section — the estimate is reached through the Profile Panel only", () => {
    const { container } = render(<SettingsPanel />);
    expect(screen.queryByText(/lecturer profile/i)).toBeNull();
    expect(screen.queryByText(/five-dimensional estimate/i)).toBeNull();
    const labels = Array.from(
      container.querySelectorAll(".settings-panel > .set-group > .set-acc-header > .set-label")
    ).map((n) => n.textContent);
    // "Corpus" is the distribution capability's version surface (Scenario:
    // Corpus version auditable from the app) — not a lecturer-profile section.
    // The estimate lives in the overlay's SIBLING Profile section, which is what
    // makes the rule structural rather than a prohibition to remember.
    expect(labels).toEqual(["Model", "Appearance", "About", "Corpus"]);
  });
});
