/**
 * The composer's context-usage ring (change `show-context-usage-in-the-composer`;
 * capability `desktop-app`, Requirement: Context-Usage Ring in the Composer
 * Control Row). One test per Scenario.
 *
 * The contrast scenario is asserted as the DECLARATIONS that produce it — the
 * tokens each state paints with, and the non-colour differentiator each carries
 * — because jsdom neither lays out nor resolves a computed colour, following the
 * same precedent the centring change's tests set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import {
  COMPACTION_RESERVE_TOKENS,
  DEGENERATE_NEAR_FULL_FRACTION,
  nearFullThreshold,
} from "../src/shared/context-usage.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedBackgroundConversation, seedConversation, testSession } from "./helpers/conversation.js";
import { MODEL_PILL_NAME, plusButton, sendButton } from "./helpers/composer.js";
import { explanationFor, labelFor } from "../src/renderer/components/ContextUsageRing.strings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(resolve(HERE, "../src/renderer/styles.css"), "utf8");

const APP_DEFAULT_WINDOW = 131072;

function seed() {
  seedConversation({ session: { ...testSession(), affordances: { ingestion: true } } });
  useCbe.setState({
    hydration: "ready",
    providerStatus: { baseURL: "https://llm.example/v1", modelId: "gemma4-31b", hasKey: true },
  });
}

/** The ring, by its role — a role that carries a value, not a bare focusable. */
const ring = () => screen.getByRole("meter") as HTMLElement;
/** Its accessible description — the text alternative. */
const explanation = () => document.getElementById(ring().getAttribute("aria-describedby") ?? "") as HTMLElement;

/** Report an occupancy for the visible conversation. */
function report(used: number | null, window?: number) {
  emitAgentEvent({ type: "context_usage", data: window === undefined ? { used } : { used, window } } as never);
}

beforeEach(() => {
  useCbe.getState().reset();
  seed();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCbe.getState().reset();
});

describe("Scenario: The ring sits in the indicator slot and performs nothing", () => {
  it("is left of the pill, is not a button, carries a value role, and takes one tab stop", () => {
    const { container } = render(<ChatPanel />);
    const row = container.querySelector(".composer-row-right") as HTMLElement;
    const r = ring();
    // Right side, immediately left of the model pill.
    expect(row.contains(r)).toBe(true);
    const pill = within(row).getByRole("button", { name: MODEL_PILL_NAME });
    expect(r.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not a button, and no action.
    expect(r.tagName.toLowerCase()).not.toBe("button");
    expect(r.getAttribute("role")).toBe("meter");
    expect(r.closest("button")).toBeNull();
    // One tab stop, between the "+" and the pill.
    expect(r.getAttribute("tabindex")).toBe("0");
    const focusables = [...container.querySelectorAll<HTMLElement>('[tabindex="0"], button:not([disabled])')];
    const order = focusables.filter((e) => e === plusButton() || e === r || e === pill);
    expect(order).toEqual([plusButton(), r, pill]);
    // The row still carries exactly THREE actions.
    const rowEl = container.querySelector(".composer-row") as HTMLElement;
    expect(within(rowEl).getAllByRole("button")).toHaveLength(3);
    // Activating it performs nothing.
    const before = useCbe.getState().overlaySection;
    fireEvent.click(r);
    expect(useCbe.getState().overlaySection).toBe(before);
  });
});

describe("Scenario: A measured occupancy fills the ring proportionally", () => {
  it("fills in proportion, with a minimum visible fill, and names both figures", () => {
    const { container } = render(<ChatPanel />);
    report(65536, APP_DEFAULT_WINDOW);
    expect(ring().className).toContain("ctx-ring-measured");
    const fill = container.querySelector(".ctx-ring-fill") as SVGCircleElement;
    expect(fill).toBeTruthy();
    const [drawn, circumference] = (fill.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
    expect(drawn! / circumference!).toBeCloseTo(0.5, 2);
    // The text alternative carries the percentage AND the token figures.
    expect(explanation().textContent).toContain("50 %");
    expect(explanation().textContent).toMatch(/65[’'  .,]?536/);
    expect(explanation().textContent).toMatch(/131[’'  .,]?072/);

    // A genuinely low, non-zero occupancy still draws something.
    report(12, APP_DEFAULT_WINDOW);
    const low = container.querySelector(".ctx-ring-fill") as SVGCircleElement;
    const [lowDrawn] = (low.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
    expect(lowDrawn!).toBeGreaterThan(0);
  });
});

describe("Scenario: A fresh conversation shows 'not yet measured', never zero", () => {
  it("draws an unfilled track and claims neither 0 % nor a zero token count", () => {
    const { container } = render(<ChatPanel />);
    expect(ring().className).toContain("ctx-ring-fresh");
    expect(container.querySelector(".ctx-ring-fill")).toBeNull();
    const text = `${ring().getAttribute("aria-label")} ${explanation().textContent}`;
    expect(text).toContain(labelFor("fresh", null, en));
    expect(text).not.toMatch(/\b0\s*%/);
    expect(text).not.toMatch(/\b0 (of|tokens)/);
    // A meter with no value reports none rather than reporting zero.
    expect(ring().getAttribute("aria-valuenow")).toBeNull();
  });
});

describe("Scenario: A resumed conversation is not shown as an empty one", () => {
  it("is visually and textually distinct from fresh, and resolves once a message completes", () => {
    render(<ChatPanel />);
    const freshLabel = ring().getAttribute("aria-label");
    const freshClass = ring().className;
    const freshText = explanation().textContent;

    // A resumed conversation: the harness reports the occupancy as unknown, but
    // the conversation has been measured before.
    report(41000, APP_DEFAULT_WINDOW);
    report(null, APP_DEFAULT_WINDOW);
    expect(ring().className).toContain("ctx-ring-carried");
    expect(ring().className).not.toBe(freshClass);
    expect(ring().getAttribute("aria-label")).not.toBe(freshLabel);
    expect(explanation().textContent).not.toBe(freshText);
    // It says the conversation CARRIES context — never that it is empty.
    expect(explanation().textContent).toBe(explanationFor("carried", null, en));
    expect(explanation().textContent).toMatch(/carries context/);
    expect(explanation().textContent).not.toMatch(/\bempty\b/);

    // …and resolves to the measured state once the next message completes.
    report(52000, APP_DEFAULT_WINDOW);
    expect(ring().className).toContain("ctx-ring-measured");
  });
});

describe("Scenario: An unconfigured context window is shown as unknown, not as a fraction", () => {
  it("draws no fill, is distinct from both unmeasured states, and points at the Model group", () => {
    const { container } = render(<ChatPanel />);
    report(41000);
    expect(ring().className).toContain("ctx-ring-window-unknown");
    expect(ring().className).not.toContain("ctx-ring-fresh");
    expect(ring().className).not.toContain("ctx-ring-carried");
    expect(container.querySelector(".ctx-ring-fill")).toBeNull();
    expect(ring().getAttribute("aria-valuenow")).toBeNull();
    const text = explanation().textContent ?? "";
    // The token figure, the statement that no window is configured, and the
    // pointer to the Settings section's Model group — quoted verbatim, via the
    // pill beside it.
    expect(text).toMatch(/41[’'  .,]?000/);
    expect(text).toMatch(/has not been recorded/);
    expect(text).toContain('"Model" group');
    expect(text).toMatch(/model pill/);
    // No fraction of the provider's assumed high default anywhere.
    expect(text).not.toMatch(/\d+\s*%/);
  });
});

describe("Scenario: The ring goes pending for a compaction and is always released", () => {
  it("shows pending for the sequence and leaves it on completing, on failing, and on an early failure", () => {
    render(<ChatPanel />);
    report(90000, APP_DEFAULT_WINDOW);

    // (a) A sequence that COMPLETES.
    emitAgentEvent({ type: "compaction_phase", data: { phase: "consolidating" } } as never);
    expect(ring().className).toContain("ctx-ring-pending");
    emitAgentEvent({ type: "compaction_phase", data: { phase: "compacting" } } as never);
    expect(ring().className).toContain("ctx-ring-pending");
    emitAgentEvent({ type: "compaction_phase", data: { phase: "idle" } } as never);
    expect(ring().className).not.toContain("ctx-ring-pending");

    // (b) One that FAILS early.
    emitAgentEvent({ type: "compaction_phase", data: { phase: "compacting" } } as never);
    expect(ring().className).toContain("ctx-ring-pending");
    emitAgentEvent({ type: "compaction_phase", data: { phase: "error" } } as never);
    expect(ring().className).not.toContain("ctx-ring-pending");

    // (c) One that ends WITHOUT a terminal phase at all — an early return inside
    // the companion. `agent_end` is the boundary the runtime always reaches, and
    // it releases the ring rather than stranding it.
    emitAgentEvent({ type: "compaction_phase", data: { phase: "consolidating" } } as never);
    expect(ring().className).toContain("ctx-ring-pending");
    emitAgentEvent({ type: "agent_end", data: {} } as never);
    expect(ring().className).not.toContain("ctx-ring-pending");
  });

  it("leaves the compaction lifecycle visible in the shared disclosure", () => {
    const { container } = render(<ChatPanel />);
    emitAgentEvent({ type: "compaction_phase", data: { phase: "consolidating" } } as never);
    expect(container.querySelectorAll(".working-disclosure")).toHaveLength(1);
    emitAgentEvent({ type: "compaction_phase", data: { phase: "compacting" } } as never);
    expect(container.querySelectorAll(".working-disclosure")).toHaveLength(1);
    emitAgentEvent({ type: "compaction_phase", data: { phase: "error" } } as never);
    expect(container.querySelector(".working-disclosure")).toBeNull();
    expect(useCbe.getState().chatNotice?.text).toMatch(/compaction failed/i);
  });
});

describe("Scenario: The near-full band engages at the configured model's compaction point", () => {
  it("engages relative to each window's own compaction point, with the fallback only in the degenerate case", () => {
    render(<ChatPanel />);
    // The boundaries come from the requirement's rule, never from a literal here.
    const cases = [
      { window: APP_DEFAULT_WINDOW, branch: "ordinary" },
      { window: 32768, branch: "ordinary" },
      // Between the reserve and 32k: the compaction point sits WELL BELOW half
      // the window, so a fraction-of-window floor would put the band above it.
      { window: 24576, branch: "ordinary" },
      // At or below the reserve: the compaction point is zero or negative.
      { window: 8192, branch: "degenerate" },
    ] as const;

    for (const { window, branch } of cases) {
      const threshold = nearFullThreshold(window);
      if (branch === "ordinary") {
        expect(threshold).toBe(window - COMPACTION_RESERVE_TOKENS);
      } else {
        expect(threshold).toBe(window * DEGENERATE_NEAR_FULL_FRACTION);
      }
      // Just below the threshold: not near full.
      report(Math.floor(threshold) - 1, window);
      expect(ring().className, `below threshold at ${window}`).not.toContain("ctx-ring-near-full");
      // At it: near full.
      report(Math.ceil(threshold), window);
      expect(ring().className, `at threshold at ${window}`).toContain("ctx-ring-near-full");
    }

    // A fixed 90 % band would never be reached at the app's default window,
    // whose compaction point is 87.5 % of it.
    expect(nearFullThreshold(APP_DEFAULT_WINDOW) / APP_DEFAULT_WINDOW).toBeLessThan(0.9);
    // A fraction-of-window FLOOR would place the band above the compaction point
    // at 24576, i.e. after the conversation had already been summarised.
    expect(nearFullThreshold(24576)).toBeLessThan(24576 * DEGENERATE_NEAR_FULL_FRACTION);
    // …and in the degenerate branch a fresh conversation's first turn is NOT
    // near full.
    report(200, 8192);
    expect(ring().className).not.toContain("ctx-ring-near-full");
  });
});

describe("Scenario: The near-full state explains itself and gates nothing", () => {
  it("says what will happen and that the work is kept, and blocks nothing", () => {
    const { container } = render(<ChatPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: en.chatComposerFieldLabel }), { target: { value: "weiter" } });
    report(nearFullThreshold(APP_DEFAULT_WINDOW) + 1000, APP_DEFAULT_WINDOW);
    expect(ring().className).toContain("ctx-ring-near-full");
    const text = explanation().textContent ?? "";
    expect(text).toMatch(/summarised automatically/);
    for (const kept of ["CBE Process Canvas", "decisions", "design steps", "CBE Maturity"]) {
      expect(text, `does not name ${kept}`).toContain(kept);
    }
    // It asks the lecturer to do nothing and cannot be dismissed.
    expect(text).not.toMatch(/please (delete|start|end)/i);
    expect(within(container.querySelector(".ring-wrap") as HTMLElement).queryAllByRole("button")).toHaveLength(0);
    // Nothing is gated: send is still enabled, the "+" menu still opens, and no
    // compaction was triggered.
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(plusButton());
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(useCbe.getState().live.companionPhase).toBeNull();
  });
});

describe("Scenario: No ring state relies on colour alone", () => {
  it("gives each state a non-colour differentiator and paints from contrast-carrying tokens", () => {
    const { container } = render(<ChatPanel />);
    // Fresh: a plain, unfilled track.
    expect(container.querySelector(".ctx-ring-track")?.getAttribute("stroke-dasharray")).toBeNull();
    // Carried: the track is DASHED — distinguishable from fresh without hue.
    report(1000, APP_DEFAULT_WINDOW);
    report(null, APP_DEFAULT_WINDOW);
    expect(container.querySelector(".ctx-ring-track")?.getAttribute("stroke-dasharray")).toBe("3 2.4");
    // Window unknown: the track is DOTTED — a third, distinct pattern.
    report(1000);
    expect(container.querySelector(".ctx-ring-track")?.getAttribute("stroke-dasharray")).toBe("1 2.6");
    // Measured: an arc appears, which no unmeasured state has.
    report(1000, APP_DEFAULT_WINDOW);
    expect(container.querySelector(".ctx-ring-fill")).toBeTruthy();
    expect(container.querySelector(".ctx-ring-mark")).toBeNull();
    // Near full: a MARK on top of the colour change.
    report(nearFullThreshold(APP_DEFAULT_WINDOW), APP_DEFAULT_WINDOW);
    expect(container.querySelector(".ctx-ring-mark")).toBeTruthy();
    // Pending: an animation, not merely another hue.
    emitAgentEvent({ type: "compaction_phase", data: { phase: "compacting" } } as never);
    expect(STYLES).toMatch(/\.ctx-ring-pending \.ctx-ring-track \{[^}]*animation:/s);

    // Track and fill paint from the theme tokens that carry contrast against the
    // card surface in BOTH themes and on the tinted locked card — never a
    // hard-coded colour and never a transparency that would let the surface
    // through.
    const ringRules = STYLES.slice(STYLES.indexOf(".ctx-ring {"), STYLES.indexOf(".set-tooltip-overlay {"));
    expect(ringRules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ringRules).not.toMatch(/rgba?\(/);
    for (const token of ["var(--border-2)", "var(--muted)", "var(--fg)", "var(--accent)"]) {
      expect(ringRules, `does not paint with ${token}`).toContain(token);
    }
  });
});

describe("Scenario: The explanation is available on hover and on keyboard focus, without reflowing the row", () => {
  it("reveals the same text both ways from the shared tooltip in its overlay placement", () => {
    const { container } = render(<ChatPanel />);
    report(50000, APP_DEFAULT_WINDOW);
    const wrap = container.querySelector(".ring-wrap") as HTMLElement;
    const tip = explanation();
    // The SHARED component, in its overlay placement.
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.className).toContain("set-tooltip");
    expect(tip.getAttribute("data-placement")).toBe("overlay");
    expect(tip.getAttribute("data-open")).toBe("false");

    // Hover reveals it, and it stays while the pointer remains.
    fireEvent.mouseEnter(wrap);
    expect(explanation().getAttribute("data-open")).toBe("true");
    const hoverText = explanation().textContent;
    // Dismissable without moving pointer or focus.
    fireEvent.keyDown(wrap, { key: "Escape" });
    expect(explanation().getAttribute("data-open")).toBe("false");
    fireEvent.mouseLeave(wrap);

    // Keyboard focus reveals the SAME explanation.
    fireEvent.focus(ring());
    expect(explanation().getAttribute("data-open")).toBe("true");
    expect(explanation().textContent).toBe(hoverText);

    // The overlay placement consumes no layout box, so the row cannot reflow.
    const overlay = STYLES.slice(STYLES.indexOf(".set-tooltip-overlay {"));
    expect(overlay).toMatch(/position:\s*absolute/);
    expect(overlay.slice(0, overlay.indexOf("}"))).toMatch(/z-index:\s*\d+/);
    // The graphic itself is hidden from assistive technology.
    expect(ring().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Scenario: A background conversation's occupancy does not render in the visible one", () => {
  it("keeps the visible ring unchanged and shows the background one's own report on switching", () => {
    render(<ChatPanel />);
    report(50000, APP_DEFAULT_WINDOW);
    const visible = ring().getAttribute("aria-label");

    seedBackgroundConversation("bg-session", "other-course");
    emitAgentEvent({
      type: "context_usage",
      sessionId: "bg-session",
      data: { used: 120000, window: APP_DEFAULT_WINDOW },
    } as never);
    expect(ring().getAttribute("aria-label")).toBe(visible);

    // Switching to that conversation shows ITS occupancy.
    const bg = useCbe.getState().conversations["bg-session"]!;
    expect(bg.contextUsage).toEqual({ used: 120000, window: APP_DEFAULT_WINDOW });
    expect(useCbe.getState().conversations["test-session"]!.contextUsage).toEqual({
      used: 50000,
      window: APP_DEFAULT_WINDOW,
    });
  });
});

describe("Scenario: A fresh session returns the ring to its unmeasured state", () => {
  it("returns to fresh even though the canvas work is carried over", async () => {
    render(<ChatPanel />);
    report(90000, APP_DEFAULT_WINDOW);
    expect(ring().className).toContain("ctx-ring-measured");

    // The New Session reset hands back a fresh conversation with no occupancy.
    vi.spyOn(window.cbe, "freshConversation").mockResolvedValue({
      session: { ...testSession("fresh-session"), affordances: { ingestion: true } },
      turns: [],
      agentRunning: false,
      canvas: [],
      maturity: {},
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    await screen.findByRole("textbox", { name: en.chatComposerFieldLabel });
    expect(ring().className).toContain("ctx-ring-fresh");
    expect(explanation().textContent).toBe(explanationFor("fresh", null, en));
  });
});

describe("Scenario: No tokens-per-second readout is rendered", () => {
  it("shows no generation-speed figure in any state", () => {
    const { container } = render(<ChatPanel />);
    const row = () => (container.querySelector(".composer-row") as HTMLElement).textContent ?? "";
    const states: Array<() => void> = [
      () => {},
      () => report(50000, APP_DEFAULT_WINDOW),
      () => report(null, APP_DEFAULT_WINDOW),
      () => report(50000),
      () => emitAgentEvent({ type: "compaction_phase", data: { phase: "compacting" } } as never),
    ];
    for (const enter of states) {
      enter();
      expect(row()).not.toMatch(/tok\/s|tokens\/s|t\/s|pro Sekunde/i);
    }
  });
});
