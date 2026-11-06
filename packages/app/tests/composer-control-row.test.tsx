/**
 * The composer control row (change `reshape-the-composer-in-the-llama-cpp-look`;
 * capability `desktop-app`, Requirement: Composer Control Row). One test per
 * Scenario of that requirement:
 *
 * - The "+" opens a two-entry menu rather than a file dialog
 * - The menu closes on the three lecturer-initiated paths and returns focus
 * - A run starting or ending does not close the menu or move focus
 * - A disabled entry's reason is reachable by keyboard and assistive technology
 * - The menu and the slash-command panel are mutually exclusive
 * - The menu is not clipped at the narrowest legal chat width
 * - The menu is keyboard-operable
 * - With ingestion off the menu carries Help alone
 * - The model pill shows the configured model and opens the Model group
 * - The pill offers no model switching
 * - A blank persisted model id still renders a pill that leads to the fix
 * - A long model id truncates instead of breaking the row
 * - The model id is rendered as plain text
 * - The pill's accessible name says where it leads
 * - The pill stays enabled while the agent is running
 * - The slot renders send when idle and stop whenever the composer is locked
 *
 * The last of those replaced the retired _Send is a round up-arrow button under
 * unchanged rules_ when `stop-a-running-turn` gave the slot its second state.
 * What the stop LEAVES BEHIND — the marked turn, the released lock, the
 * unrestored attachments, the compaction refusal, the timed-out recovery — is in
 * `stop-a-running-turn.test.tsx`, one test per scenario there.
 *
 * jsdom performs no layout, so the clipping and no-wrap scenarios are asserted
 * as the DECLARATIONS that produce them (the popover is absolutely positioned
 * and therefore consumes no layout box; the row declares `flex-wrap: nowrap`;
 * the pill is the only shrinkable element), following the precedent
 * `jump-to-latest.test.tsx` set for its own centring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChatPanel,
  MODEL_PILL_LABEL_MAX,
  MODEL_PILL_TITLE_MAX,
  capModelId,
} from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { emitAgentEvent } from "./helpers/agent-events.js";
import { seedConversation, testSession } from "./helpers/conversation.js";
import {
  MODEL_PILL_NAME,
  composerField,
  entryDisabled,
  openPlusMenu,
  plusButton,
  sendButton,
  sendSlotState,
  stopButton,
} from "./helpers/composer.js";

const STYLES = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderer/styles.css"), "utf8");

function seed(affordances: Record<string, boolean> = { ingestion: true }, modelId = "gemma4-31b") {
  seedConversation({ session: { ...testSession(), affordances } });
  useCbe.setState({
    hydration: "ready",
    providerStatus: { baseURL: "https://llm.example/v1", modelId, hasKey: true },
  });
}

/** The declaration block for a selector, as text, so a rule can be asserted
 * without a layout engine. */
function ruleFor(selector: string): string {
  const at = STYLES.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return STYLES.slice(at, STYLES.indexOf("}", at));
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

describe("Scenario: The '+' opens a two-entry menu rather than a file dialog", () => {
  it("opens a menu with exactly the upload and help entries, no chevrons, no file dialog", () => {
    const dialog = vi.spyOn(window.cbe, "ingestFile").mockResolvedValue(null);
    render(<ChatPanel />);
    const plus = plusButton();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(plus);
    expect(dialog).not.toHaveBeenCalled();
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual([en.chatUploadEntryLabel, en.chatHelpEntryLabel]);
    // No submenus, so no disclosure affordance on either entry.
    for (const item of items) {
      expect(item.getAttribute("aria-haspopup")).toBeNull();
      expect(item.querySelector("svg")).toBeNull();
      expect(item.textContent).not.toMatch(/[›▸▾>]/);
    }
    // The "+" carries its pressed state for as long as the menu is open.
    expect(plus.className).toContain("composer-plus-open");
    const pressed = ruleFor(".composer-plus.composer-plus-open,\n.composer-plus.composer-plus-open:hover");
    expect(pressed).toMatch(/background:\s*var\(--accent\)/);
    // The glyph stays legible on the filled circle. A menu is opened by a click,
    // which leaves the pointer ON the button, so the pressed rule must also
    // apply while hovered — otherwise `:hover` paints the glyph in the accent the
    // circle is filled with and it disappears.
    expect(pressed).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(pressed).toContain(".composer-plus.composer-plus-open:hover");
  });
});

describe("Scenario: The menu closes on the three lecturer-initiated paths and returns focus", () => {
  it("closes on Escape and returns focus to the '+'", () => {
    render(<ChatPanel />);
    const menu = openPlusMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(plusButton().className).not.toContain("composer-plus-open");
    expect(document.activeElement).toBe(plusButton());
  });

  it("closes on activating an entry and returns focus to the '+'", async () => {
    vi.spyOn(window.cbe, "ingestFile").mockResolvedValue(null);
    render(<ChatPanel />);
    const menu = openPlusMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: en.chatUploadEntryLabel }));
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(plusButton());
  });

  it("closes on a click outside and returns focus to the '+'", () => {
    render(<ChatPanel />);
    openPlusMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(plusButton().className).not.toContain("composer-plus-open");
    expect(document.activeElement).toBe(plusButton());
  });
});

describe("Scenario: A run starting or ending does not close the menu or move focus", () => {
  it("updates the entries in place in both directions, leaving the menu open and focus untouched", () => {
    render(<ChatPanel />);
    const menu = openPlusMenu();
    // The lecturer put focus on the second entry; nothing may move it.
    const help = within(menu).getByRole("menuitem", { name: en.chatHelpEntryLabel });
    help.focus();
    expect(document.activeElement).toBe(help);

    // A run starts from somewhere OTHER than the composer.
    emitAgentEvent({ type: "agent_start" });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(plusButton().className).toContain("composer-plus-open");
    expect(document.activeElement).toBe(help);
    for (const item of within(screen.getByRole("menu")).getAllByRole("menuitem")) {
      expect(entryDisabled(item)).toBe(true);
      expect(document.getElementById(item.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
        en.chatComposerLockedReason
      );
    }

    // …and the run ends while the menu is still open.
    emitAgentEvent({ type: "agent_end" });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(plusButton().className).toContain("composer-plus-open");
    expect(document.activeElement).toBe(help);
    for (const item of within(screen.getByRole("menu")).getAllByRole("menuitem")) {
      expect(entryDisabled(item)).toBe(false);
    }
  });
});

describe("Scenario: A disabled entry's reason is reachable by keyboard and assistive technology", () => {
  it("uses aria-disabled, stays focusable, exposes the reason as a description, and does nothing", () => {
    const dialog = vi.spyOn(window.cbe, "ingestFile").mockResolvedValue(null);
    const send = vi.spyOn(window.cbe, "sendPrompt").mockResolvedValue({ ok: true });
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start" });
    const menu = openPlusMenu();
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.hasAttribute("disabled")).toBe(false);
      item.focus();
      expect(document.activeElement).toBe(item);
      const reason = document.getElementById(item.getAttribute("aria-describedby") ?? "");
      expect(reason?.textContent).toBe(en.chatComposerLockedReason);
      fireEvent.click(item);
    }
    expect(dialog).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Scenario: The menu and the slash-command panel are mutually exclusive", () => {
  it("opening either closes the other", async () => {
    vi.spyOn(window.cbe, "getCommands").mockResolvedValue([
      { name: "cite", source: "extension", description: "Insert a citation" },
    ]);
    render(<ChatPanel />);
    // The slash panel opens on a matching token…
    fireEvent.change(composerField(), { target: { value: "/ci" } });
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy());
    // …and activating the "+" closes it.
    fireEvent.click(plusButton());
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    // The other direction: the menu is still open from the click above, and a
    // slash token opening the panel closes it.
    fireEvent.change(composerField(), { target: { value: "" } });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.change(composerField(), { target: { value: "/ci" } });
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy());
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Scenario: The menu is not clipped at the narrowest legal chat width", () => {
  it("is declared as an overlay that consumes no layout box and is not clipped by any ancestor", () => {
    render(<ChatPanel />);
    openPlusMenu();
    // Drawn OVER the surrounding surface: absolutely positioned above the "+",
    // so it takes no width and no height from the row, the card or the column —
    // nothing can reflow, at 420px or at any other width.
    const menu = ruleFor(".composer-menu");
    expect(menu).toMatch(/position:\s*absolute/);
    expect(menu).toMatch(/bottom:\s*calc\(100% \+ \d+px\)/);
    expect(menu).toMatch(/z-index:\s*\d+/);
    // It floats clear ABOVE the card rather than opening inside it over the text
    // area: the anchor is deliberately NOT a positioning context, so `bottom`
    // resolves against the CARD, whose top edge the menu therefore clears.
    expect(ruleFor(".composer-menu-anchor")).toMatch(/position:\s*static/);
    expect(ruleFor(".composer-box")).toMatch(/position:\s*relative/);
    // Sized to fit its labels rather than to a fixed width, so neither label
    // truncates at any column width.
    expect(menu).toMatch(/min-width:\s*max-content/);
    expect(ruleFor(".composer-menu-item")).toMatch(/white-space:\s*nowrap/);
    // No ancestor in the chain clips it.
    for (const selector of [".composer", ".composer-box", ".composer-row", ".composer-menu-anchor"]) {
      expect(ruleFor(selector)).not.toMatch(/overflow[^:]*:\s*(hidden|clip|auto|scroll)/);
    }
  });
});

describe("Scenario: The menu is keyboard-operable", () => {
  it("opens with Enter/Space, moves with the arrows, and exposes the ARIA menu-button wiring", () => {
    render(<ChatPanel />);
    const plus = plusButton();
    expect(plus.getAttribute("aria-haspopup")).toBe("menu");
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    // A <button> turns Enter and Space into a click, which is what opens it.
    fireEvent.click(plus);
    expect(plusButton().getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    const [upload, help] = within(menu).getAllByRole("menuitem");
    // Opening focuses the first entry (the ARIA menu-button pattern).
    expect(document.activeElement).toBe(upload);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(help);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(upload);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(help);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(plusButton().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Scenario: With ingestion off the menu carries Help alone", () => {
  it("keeps the '+' and renders Help as the only entry — the upload entry is absent, not disabled", () => {
    cleanup();
    useCbe.getState().reset();
    seed({ ingestion: false });
    render(<ChatPanel />);
    expect(plusButton()).toBeTruthy();
    const menu = openPlusMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual([en.chatHelpEntryLabel]);
    expect(menu.textContent).not.toContain(en.chatUploadEntryLabel);
  });
});

/** The pill, by its rendered accessible name — which names its purpose first. */
const pill = () => screen.getByRole("button", { name: MODEL_PILL_NAME }) as HTMLButtonElement;

describe("Scenario: The model pill shows the configured model and opens the Model group", () => {
  it("renders a cube icon plus the id, with no badge, no chevron and no host, and opens Settings → Model", () => {
    render(<ChatPanel />);
    const p = pill();
    expect(p.querySelector("svg.model-pill-icon")).toBeTruthy();
    expect(p.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(p.textContent).toContain("gemma4-31b");
    // No size badge, no chevron, no provider host.
    expect(p.querySelectorAll("svg")).toHaveLength(1);
    expect(p.textContent).not.toContain("llm.example");
    expect(p.textContent).not.toMatch(/\d+\s*B\b/);
    fireEvent.click(p);
    expect(useCbe.getState().overlaySection).toBe("settings");
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
  });
});

describe("Scenario: The pill offers no model switching", () => {
  it("renders no list, issues no request for one, and changes nothing when activated", () => {
    // Every IPC surface the renderer has; none of them is a model enumeration,
    // and none may be reached by rendering or activating the pill.
    const calls = vi.fn();
    for (const key of Object.keys(window.cbe)) {
      const fn = (window.cbe as unknown as Record<string, unknown>)[key];
      if (typeof fn === "function" && key !== "onAgentEvent") {
        vi.spyOn(window.cbe as never, key as never).mockImplementation(((...a: unknown[]) => {
          calls(key, ...a);
          return Promise.resolve(undefined);
        }) as never);
      }
    }
    render(<ChatPanel />);
    const before = useCbe.getState().providerStatus?.modelId;
    fireEvent.click(pill());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(calls.mock.calls.map((c) => c[0])).not.toContain("setConfig");
    expect(useCbe.getState().providerStatus?.modelId).toBe(before);
  });
});

describe("Scenario: A blank persisted model id still renders a pill that leads to the fix", () => {
  it("says so in plain words instead of hiding, and still opens the Model group", () => {
    cleanup();
    useCbe.getState().reset();
    seed({ ingestion: true }, "   ");
    render(<ChatPanel />);
    const p = pill();
    expect(p.textContent).toContain(en.chatModelPillBlankLabel);
    fireEvent.click(p);
    expect(useCbe.getState().overlaySection).toBe("settings");
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
  });
});

describe("Scenario: A long model id truncates instead of breaking the row", () => {
  it("caps both the rendered and the accessible form, and the row never wraps", () => {
    const long = "a-very-long-locally-served-model-identifier-".repeat(6);
    cleanup();
    useCbe.getState().reset();
    seed({ ingestion: true }, long);
    const { container } = render(<ChatPanel />);
    const p = pill();
    const shown = p.querySelector(".model-pill-name")?.textContent ?? "";
    expect(shown.length).toBeLessThanOrEqual(MODEL_PILL_LABEL_MAX);
    expect(shown.endsWith("…")).toBe(true);
    // The hover / accessible form is longer but still bounded — never unbounded.
    const label = p.getAttribute("aria-label") ?? "";
    expect(label).toBe(p.getAttribute("title"));
    expect(label).toContain(capModelId(long, MODEL_PILL_TITLE_MAX));
    expect(label.length).toBeLessThan(long.length);
    // The row does not wrap, and the pill is the only element permitted to shrink.
    expect(ruleFor(".composer-row")).toMatch(/flex-wrap:\s*nowrap/);
    expect(ruleFor(".model-pill")).toMatch(/flex:\s*0 1 auto/);
    expect(ruleFor(".model-pill-name")).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleFor(".composer-plus")).toMatch(/flex:\s*0 0 30px/);
    expect(ruleFor(".send")).toMatch(/flex:\s*0 0 auto/);
    // The cube icon keeps its footprint too.
    expect(ruleFor(".model-pill-icon")).toMatch(/flex:\s*none/);
    expect(container.querySelector(".composer-row")).toBeTruthy();
  });
});

describe("Scenario: The model id is rendered as plain text", () => {
  it("renders Markdown-significant characters literally and folds a newline", () => {
    const nasty = "_x_ [a](b) `c`\nzweite";
    cleanup();
    useCbe.getState().reset();
    seed({ ingestion: true }, nasty);
    const { container } = render(<ChatPanel />);
    const name = container.querySelector(".model-pill-name") as HTMLElement;
    // Never through the Markdown pipeline: no elements, just a text node.
    expect(name.querySelector("em, strong, a, code")).toBeNull();
    expect(name.children).toHaveLength(0);
    expect(name.textContent).toContain("_x_ [a](b) `c`");
    // The newline is folded, so the row's layout is unaffected.
    expect(name.textContent).not.toContain("\n");
  });
});

describe("Scenario: The pill's accessible name says where it leads", () => {
  it("names the destination first, with the id as the value it reports", () => {
    render(<ChatPanel />);
    const label = pill().getAttribute("aria-label") ?? "";
    expect(label).toBe(en.chatModelPillAccessibleName({ purpose: en.chatModelPillPurpose, modelId: "gemma4-31b" }));
    expect(label).toContain("gemma4-31b");
    expect(label).not.toBe("gemma4-31b");
    // It names the Settings group exactly as that surface renders it.
    expect(label).toContain('"Model" group');
  });
});

describe("Scenario: The pill stays enabled while the agent is running", () => {
  it("is not governed by the composer's run lock", () => {
    render(<ChatPanel />);
    emitAgentEvent({ type: "agent_start" });
    // The slot beside it IS governed by the lock — it is the stop control now.
    expect(sendSlotState()).toBe("stop");
    expect(pill().disabled).toBe(false);
    fireEvent.click(pill());
    expect(useCbe.getState().overlaySection).toBe("settings");
    expect(useCbe.getState().settingsOpenGroup).toBe("model");
    // The run is undisturbed.
    expect(useCbe.getState().live.streaming).toBe(true);
  });
});

describe("Scenario: The slot renders send when idle and stop whenever the composer is locked", () => {
  it("renders send while idle, stop for the whole locked window, and send again at the end", () => {
    render(<ChatPanel />);
    const send = sendButton();
    expect(send.getAttribute("aria-label")).toBe(en.chatSendLabel);
    // The arrow is an inline SVG, never a character in the forbidden ranges.
    const svg = send.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(send.textContent?.trim()).toBe("");
    expect(ruleFor(".send")).toMatch(/border-radius:\s*50%/);
    // Idle: disabled only when the field is empty with no pending attachment.
    expect(send.disabled).toBe(true);
    fireEvent.change(composerField(), { target: { value: "Los geht's" } });
    expect(sendButton().disabled).toBe(false);

    // Locked: the SAME slot is the stop control — never both rendered.
    emitAgentEvent({ type: "agent_start" });
    expect(sendSlotState()).toBe("stop");
    const stop = stopButton();
    expect(stop.getAttribute("aria-label")).toBe(en.chatStopLabel);
    expect(stop.getAttribute("aria-disabled")).toBeNull();
    const stopSvg = stop.querySelector("svg");
    expect(stopSvg).toBeTruthy();
    expect(stopSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(stop.textContent?.trim()).toBe("");
    // Same footprint, so the row does not shift at either transition: the stop
    // shares `.send`'s sizing rule and only overrides the corner radius.
    expect(stop.classList.contains("send")).toBe(true);
    expect(ruleFor(".send.stop")).toMatch(/border-radius:/);
    expect(ruleFor(".send.stop")).not.toMatch(/width:|height:/);
    // Theme tokens, never literal colours…
    const stopRule = ruleFor(".send.stop");
    expect(stopRule).toMatch(/var\(--/);
    expect(stopRule).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    // …and every token it names must actually EXIST. `var(--typo)` resolves to
    // nothing, which renders the control transparent rather than failing — the
    // stop shipped invisible once, on a token name that was never defined.
    // Checked against the light-theme block, which declares the full set.
    const lightTokens = STYLES.slice(STYLES.indexOf(":root,"), STYLES.indexOf('html[data-theme="dark"]'));
    const referenced = [...stopRule.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const token of referenced) {
      expect(lightTokens, `${token} is referenced by .send.stop but defined nowhere`).toContain(`${token}:`);
    }

    // An INERT stop reads as inert at rest, not only on hover: both ways the
    // control can be `aria-disabled` — settling, and refused during the
    // compaction companion sequence — dim it by the same amount, so a sighted
    // lecturer is never shown a fully active-looking button that does nothing.
    const pendingRule = ruleFor(".send.stop-pending");
    const refusedRule = ruleFor('.send.stop[aria-disabled="true"]');
    const dim = /opacity:\s*0\.55/;
    expect(pendingRule).toMatch(dim);
    expect(refusedRule).toMatch(dim);
    expect(refusedRule).toMatch(/cursor:\s*default/);

    // The run ends: back to send.
    emitAgentEvent({ type: "agent_end" });
    expect(sendSlotState()).toBe("send");
  });
});

describe("Actions and indicators are different slots", () => {
  it("the control row carries exactly the three actions and no hint line anywhere", () => {
    const { container } = render(<ChatPanel />);
    const row = container.querySelector(".composer-row") as HTMLElement;
    const actions = within(row).getAllByRole("button");
    expect(actions).toHaveLength(3);
    expect(actions[0]).toBe(plusButton());
    expect(actions[1]).toBe(pill());
    expect(actions[2]).toBe(sendButton());
    // Nothing the retired hint/status line held was moved INTO the row to
    // compensate: the row's width budget stays three actions plus the ring.
    expect(row.querySelector(".composer-meta, .composer-status, .composer-hint")).toBeNull();
    expect(container.querySelector(".composer-hint, .composer-meta, .composer-status")).toBeNull();
  });
});
