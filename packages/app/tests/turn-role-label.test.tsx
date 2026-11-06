/**
 * The transcript's role labels (change `hide-the-turn-role-labels`; capability
 * `desktop-app`, Requirement: The Turn Role Label Is Hidden From View, Not From
 * Assistive Technology). One test per Scenario.
 *
 * **jsdom applies no stylesheet**, so a computed-visibility assertion is not
 * available on this stack — `styles.css` is never loaded into the document. The
 * DOM tests therefore assert the MECHANISM (the element is present, carries the
 * `visually-hidden` treatment, keeps its text, and is not removed from the
 * accessibility tree), and the stylesheet tests assert what that treatment and
 * the surviving visual carriers actually declare. Same split the
 * `content-column` suite already uses for its own geometry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { seedConversation, testSession } from "./helpers/conversation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(resolve(HERE, "../src/renderer/styles.css"), "utf8");

/** The declaration block for a selector, as text. */
function ruleFor(selector: string): string {
  const at = STYLES.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return STYLES.slice(at, STYLES.indexOf("}", at));
}

/** The stylesheet with comments stripped — a selector merely NAMED in a comment
 * must never count as a live rule. */
const CSS_RULES = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

/** Render one lecturer turn, one completed assistant turn and the streaming
 * assistant bubble in a single transcript. */
function renderAllThreeTurnKinds() {
  useCbe.setState({
    turns: [
      { role: "user", text: "eine Frage" },
      { role: "assistant", activity: [{ kind: "text", id: "1", text: "eine Antwort" }] },
    ] as never,
    live: { ...useCbe.getState().live, streaming: true } as never,
  });
  return render(<ChatPanel />);
}

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation({ session: testSession() });
  useCbe.setState({
    hydration: "ready",
    providerStatus: { baseURL: "https://llm.example/v1", modelId: "gemma4-31b", hasKey: true },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCbe.getState().reset();
});

describe("Scenario: The role label is not visible above any turn", () => {
  it("hides the label on the lecturer turn, the completed skill turn and the streaming bubble", () => {
    const { container } = renderAllThreeTurnKinds();
    const labels = [...container.querySelectorAll(".msg-role")] as HTMLElement[];
    // All three call sites render — lecturer, completed assistant, streaming.
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.classList.contains("visually-hidden"), label.textContent ?? "").toBe(true);
    }
    // …and the label's own selector declares nothing visual any more, so the
    // treatment is the utility's and only the utility's.
    expect(CSS_RULES).not.toContain(".msg-role {");
    expect(CSS_RULES).not.toContain(".msg-lecturer .msg-role {");
  });
});

describe("Scenario: The role label is still announced to assistive technology", () => {
  it("keeps every label in the DOM with its speaker name, un-hidden from the accessibility tree", () => {
    const { container } = renderAllThreeTurnKinds();
    const labels = [...container.querySelectorAll(".msg-role")] as HTMLElement[];
    expect(labels.map((l) => l.textContent)).toEqual(["Lecturer", "CBE skill", "CBE skill"]);
    for (const label of labels) {
      expect(label.getAttribute("aria-hidden")).toBeNull();
      expect(label.hasAttribute("hidden")).toBe(false);
      // Nothing between the label and the transcript hides the subtree either.
      expect(label.closest("[aria-hidden='true']")).toBeNull();
      expect(label.closest("[hidden]")).toBeNull();
    }
    // The label sits inside its own turn, so the announcement stays attached to
    // the turn it names rather than floating at the top of the transcript.
    expect(labels[0].closest(".msg-lecturer")).toBeTruthy();
    expect(labels[1].closest(".msg-skill")).toBeTruthy();
    expect(labels[2].closest(".msg-skill")).toBeTruthy();
  });
});

describe("Scenario: The hiding does not fall back on display removal", () => {
  it("clips the label off-flow while keeping it rendered, and never displays it away", () => {
    const rule = ruleFor(".visually-hidden");
    // Rendered, but off-flow and clipped to nothing.
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/width:\s*1px/);
    expect(rule).toMatch(/height:\s*1px/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/clip:\s*rect\(/);
    // The two treatments that would also take it out of the accessibility tree.
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
    // No OTHER rule reaches the label with one of them either.
    for (const [selector, body] of [...CSS_RULES.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      (m) => [m[1].trim(), m[2]] as const
    )) {
      if (!selector.includes(".msg-role")) continue;
      expect(body, selector).not.toMatch(/display:\s*none/);
      expect(body, selector).not.toMatch(/visibility:\s*hidden/);
    }
  });
});

describe("Scenario: A lecturer turn stays distinguishable from an assistant turn without its label", () => {
  it("keeps all three carriers on the lecturer turn and none of them on the assistant turn", () => {
    const { container } = renderAllThreeTurnKinds();
    expect(container.querySelector(".msg-lecturer")).toBeTruthy();
    expect(container.querySelector(".msg-skill")).toBeTruthy();

    // 1. Alignment — the lecturer turn is pushed to the inline end of the column,
    //    under the shared turn cap; the assistant turn is not.
    expect(ruleFor(".msg-lecturer")).toMatch(/margin-left:\s*auto/);
    expect(ruleFor(".msg")).toMatch(/max-width:\s*var\(--turn-max\)/);
    expect(ruleFor(".msg-skill .msg-text")).not.toMatch(/margin-left:\s*auto/);

    // 2. Fill — a raised, padded bubble against unfilled body text.
    const lecturerText = ruleFor(".msg-lecturer .msg-text");
    expect(lecturerText).toMatch(/background:\s*var\(--raise\)/);
    expect(lecturerText).toMatch(/padding:/);
    expect(ruleFor(".msg-skill .msg-text")).not.toMatch(/background:/);

    // 3. Shape — an asymmetric radius (the tail on the inline-end bottom corner)
    //    against no bubble at all.
    const radius = /border-radius:\s*([^;]+);/.exec(lecturerText)?.[1].trim();
    expect(radius, "the lecturer bubble declares a radius").toBeTruthy();
    const corners = (radius as string).split(/\s+/);
    expect(corners).toHaveLength(4);
    expect(new Set(corners).size, "the radius is asymmetric").toBeGreaterThan(1);
    expect(ruleFor(".msg-skill .msg-text")).not.toMatch(/border-radius:/);
  });
});
