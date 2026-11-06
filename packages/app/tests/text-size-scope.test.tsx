/**
 * The chat text-size setting is a reading-comfort setting, not a per-element
 * decoration: it MUST also reach Markdown tables and the composer input (change
 * `harden-canvas-determinism-and-ux2-fixes`, capability `desktop-app`, Requirement:
 * Collected UX-2 Fixes).
 *
 * jsdom applies no stylesheet, so — like the existing `chat-text-size` tests — the
 * behaviour is verified as (a) the data-attribute binding on the carrier element and
 * (b) a regression guard on the styles.css rules, which is where the defect lived: an
 * absolute `px` font-size shadowing the setting.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCbe } from "../src/renderer/state/store.js";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel.js";
import { seedConversation } from "./helpers/conversation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS_PATH = resolve(__dirname, "../src/renderer/styles.css");

/** styles.css with comments stripped — a rule must hold in the CSS, not in prose. */
function css(): string {
  return readFileSync(STYLES_CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}
/** The declaration block of the first rule whose selector matches. */
function block(selector: string): string {
  const m = css().match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for selector ${selector}`);
  return m[1];
}

afterEach(() => {
  cleanup();
  useCbe.getState().reset();
  useCbe.setState({ chatTextSize: "medium" });
  localStorage.clear();
});

describe("Chat text size — scope", () => {
  // Scenario: Markdown tables follow the chat text-size setting
  it("Markdown tables follow the chat text-size setting", () => {
    const table = block("\\.md table");
    // No absolute px may shadow the setting …
    expect(table).not.toMatch(/font-size:\s*[\d.]+px/);
    // … the size is relative, so it moves with the surrounding paragraph text in the
    // same direction and proportion.
    expect(table).toMatch(/font-size:\s*[\d.]+em/);
  });

  it("Markdown code blocks follow the chat text-size setting", () => {
    const pre = block("\\.md pre");
    expect(pre).not.toMatch(/font-size:\s*[\d.]+px/);
    expect(pre).toMatch(/font-size:\s*[\d.]+em/);
  });

  // Scenario: The composer input follows the chat text-size setting
  it("The composer input follows the chat text-size setting", () => {
    const textarea = block("\\.composer-box textarea");
    expect(textarea).not.toMatch(/font-size:\s*[\d.]+px/);
    expect(textarea).toMatch(/font-size:\s*var\(--chat-font-size/);
    // The variable must actually reach the composer: the size-variable selectors are
    // attribute-scoped, not `.chat-scroll`-scoped.
    for (const size of ["small", "medium", "large"]) {
      expect(css()).toMatch(new RegExp(`(^|[\\s,])\\[data-chat-text-size="${size}"\\]\\s*\\{`, "m"));
    }
  });

  it("binds the chosen size onto the composer, not only the transcript", () => {
    seedConversation();
    const { container } = render(
      <>
        <SettingsPanel />
        <ChatPanel />
      </>
    );
    const composer = () => container.querySelector(".composer") as HTMLElement;
    expect(composer().getAttribute("data-chat-text-size")).toBe("medium");

    const group = screen.getByRole("group", { name: "Chat text size" });
    fireEvent.click(within(group).getByRole("button", { name: "Large" }));

    expect(composer().getAttribute("data-chat-text-size")).toBe("large");
    // The transcript keeps its binding — one setting, both surfaces.
    expect((container.querySelector(".chat-scroll") as HTMLElement).getAttribute("data-chat-text-size")).toBe("large");
  });
});
