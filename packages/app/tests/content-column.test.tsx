/**
 * The conversation's content column (change
 * `centre-the-conversation-on-wide-screens`; capability `desktop-app`,
 * Requirement: One Centred Content Column for the Conversation). One test per
 * Scenario.
 *
 * **jsdom performs no layout.** Element rectangles are all zero, so a scenario
 * asserted as a pixel measurement is untestable on this stack. Every test below
 * asserts the DECLARATION the change owns — the class/wrapper is applied, the
 * rule resolves, the constant is the single source — which is exactly how the
 * scenarios are written. The pixel result is confirmed by inspection, following
 * the precedent Requirement: *Jump-to-Latest Affordance in the Chat Panel*
 * already set for its own centring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatPanel } from "../src/renderer/components/ChatPanel.js";
import { useCbe } from "../src/renderer/state/store.js";
import { applyLayoutVariables } from "../src/renderer/util/layoutVariables.js";
import {
  CHAT_MIN,
  CONTENT_COLUMN_GUTTER,
  CONTENT_COLUMN_MAX,
  HANDLE_WIDTH,
  PANEL_MIN,
  RAIL_WIDTH,
  SCROLLBAR_RESERVE,
  TURN_MAX,
  capEngagesAtChatWidth,
  contentColumnWidth,
  gutterPerSide,
  likeEdgeOffset,
  sharedContentBox,
} from "../src/shared/layout.js";
import { seedConversation, testSession } from "./helpers/conversation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(resolve(HERE, "../src/renderer/styles.css"), "utf8");
const LAYOUT_TS = readFileSync(resolve(HERE, "../src/shared/layout.ts"), "utf8");

/** The declaration block for a selector, as text. */
function ruleFor(selector: string): string {
  const at = STYLES.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return STYLES.slice(at, STYLES.indexOf("}", at));
}

/** The whole stylesheet with comments stripped, so a literal quoted in a comment
 * never counts as a rule repeating it. */
const CSS_RULES = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

/** The one rule that reserves a scrollbar width on the surfaces outside the
 * scroll region. Named here so every test reads the same declaration. */
const RESERVATION_RULE = ruleFor(".composer,\n.conv-header,\n.conv-row");

beforeEach(() => {
  useCbe.getState().reset();
  seedConversation({ session: { ...testSession(), affordances: { ingestion: true } } });
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

describe("Scenario: The turns and the composer are wrapped in one declared content column", () => {
  it("both carry the same content-column treatment, so they share one cap and one centre axis", () => {
    const { container } = render(<ChatPanel />);
    const turns = container.querySelector(".chat-column") as HTMLElement;
    const card = container.querySelector(".composer-box") as HTMLElement;
    expect(turns.classList.contains("content-column")).toBe(true);
    expect(card.classList.contains("content-column")).toBe(true);
    // …and that treatment is the capped min() width plus auto horizontal margins.
    const rule = ruleFor(".content-column");
    expect(rule).toMatch(/width:\s*min\(var\(--content-column-max\), 100% - var\(--content-column-gutter\)\)/);
    expect(rule).toMatch(/margin-inline:\s*auto/);
    // Neither is full-bleed while the other is centred.
    expect(turns.className).toContain("content-column");
    expect(card.className).toContain("content-column");
  });
});

describe("Scenario: The cap and the gutter come from the shared constants", () => {
  it("declares the four figures once beside the chat-column constants, at the stated values", () => {
    expect(CONTENT_COLUMN_MAX).toBe(760);
    expect(CONTENT_COLUMN_GUTTER).toBe(48);
    expect(TURN_MAX).toBe(660);
    expect(SCROLLBAR_RESERVE).toBe(9);
    // Alongside the constants the chat column already publishes, in one module.
    for (const name of [
      "CHAT_MIN",
      "PANEL_MIN",
      "RAIL_WIDTH",
      "HANDLE_WIDTH",
      "CONTENT_COLUMN_MAX",
      "CONTENT_COLUMN_GUTTER",
      "TURN_MAX",
      "SCROLLBAR_RESERVE",
    ]) {
      expect(LAYOUT_TS).toContain(`export const ${name} =`);
    }
    expect([CHAT_MIN, PANEL_MIN, RAIL_WIDTH, HANDLE_WIDTH]).toEqual([420, 300, 48, 7]);
  });

  it("the column rule, the reservation and the turn cap read the constants rather than a literal", () => {
    // None of the rules this change owns repeats one of the four values as a
    // literal. (Scoped to those rules on purpose: `48px` and `9px` are ordinary
    // spacing figures elsewhere in a 4000-line stylesheet, and a whole-file ban
    // would assert something the requirement does not say.)
    const owned = [
      ruleFor(".content-column"),
      RESERVATION_RULE,
      ruleFor(".chat-scroll"),
      ruleFor(".msg"),
      ruleFor("::-webkit-scrollbar"),
    ].join("\n");
    for (const literal of ["760px", "48px", "660px", "9px"]) {
      expect(owned, `a rule this change owns repeats the literal ${literal}`).not.toContain(literal);
    }
    // …it reads them as custom properties, published from the shared module.
    expect(ruleFor(".content-column")).toContain("var(--content-column-max)");
    expect(ruleFor(".msg")).toContain("var(--turn-max)");
    expect(ruleFor("::-webkit-scrollbar")).toContain("var(--scrollbar-reserve)");
    // And the publisher reads the constants, so there is exactly one source.
    const root = document.createElement("div");
    applyLayoutVariables(root);
    expect(root.style.getPropertyValue("--content-column-max")).toBe(`${CONTENT_COLUMN_MAX}px`);
    expect(root.style.getPropertyValue("--content-column-gutter")).toBe(`${CONTENT_COLUMN_GUTTER}px`);
    expect(root.style.getPropertyValue("--turn-max")).toBe(`${TURN_MAX}px`);
    expect(root.style.getPropertyValue("--scrollbar-reserve")).toBe(`${SCROLLBAR_RESERVE}px`);
  });
});

describe("Scenario: The column wrapper carries the gutter and the scroll region no longer double-pads", () => {
  it("withdraws the scroll region's former horizontal padding and adds none around the column", () => {
    // Vertical padding lives inside the scrollport so it cannot force a small
    // grid track over the composer at high zoom. Neither layer adds horizontal
    // padding; inline space still comes exclusively from scrollbar-gutter.
    const scroll = ruleFor(".chat-scroll");
    expect(scroll).toMatch(/min-height:\s*0/);
    expect(scroll).not.toMatch(/padding(?:-[a-z]+)?:/);
    const content = ruleFor(".chat-scroll > .chat-column");
    expect(content).toMatch(/padding-block:\s*24px 14px/);
    expect(content).not.toMatch(/padding(?:-inline|-left|-right)?:/);
    expect(scroll).toMatch(/scrollbar-gutter:\s*stable both-edges/);
    // The only horizontal padding around the column anywhere in the chain is the
    // symmetric reservation — the requirement's one stated exception.
    const reservation = RESERVATION_RULE;
    expect(reservation).toMatch(/padding-inline:\s*var\(--scrollbar-reserve\)/);
    // No surface OUTSIDE the column adds horizontal padding around it beside the
    // reservation. (A surface that IS the column — the notice, the composer card
    // — keeps its own inner padding: that sits inside the column and does not add
    // to the gutter, which the requirement states explicitly.)
    for (const selector of [".conv-header", ".composer", ".content-column", ".conv"]) {
      const rule = ruleFor(selector);
      expect(rule, selector).not.toMatch(/padding-inline:\s*(?!var\(--scrollbar-reserve\))/);
      expect(rule, selector).not.toMatch(/padding(-left|-right):/);
      expect(rule, selector).not.toMatch(/padding:\s*[^;]*\s\d+px(\s|;)/);
    }
    // Padding INSIDE the composer card is card internals, owned by
    // `reshape-the-composer-in-the-llama-cpp-look`, and is untouched here: it
    // sits inside the column and adds nothing to the gutter. (The horizontal
    // value is a custom property because the "+" menu reads it to line up with
    // the "+"; the figure is the card's, not this change's.)
    const box = ruleFor(".composer-box");
    expect(box).toMatch(/padding:\s*12px var\(--composer-card-pad\) 10px/);
    expect(box).toMatch(/--composer-card-pad:\s*14px/);
  });
});

describe("Scenario: Crossing the scrollable threshold in either direction changes no column geometry", () => {
  it("declares the reservation unconditionally — nothing keys off whether the transcript scrolls", () => {
    expect(ruleFor(".chat-scroll")).toMatch(/scrollbar-gutter:\s*stable both-edges/);
    // No rule, class or state anywhere in the chain is a function of the scroll
    // state — the only way a jsdom test can cover both directions of the
    // crossing, since jsdom neither lays out nor scrolls.
    expect(CSS_RULES).not.toMatch(/scrolled|is-scrolling|has-scrollbar|overflowing/i);
    const { container } = render(<ChatPanel />);
    const before = [...container.querySelectorAll<HTMLElement>(".content-column")].map((e) => e.className);
    // Scrolling changes no class on any column-carrying surface.
    fireEvent.scroll(container.querySelector(".chat-scroll") as HTMLElement, { target: { scrollTop: 5000 } });
    const after = [...container.querySelectorAll<HTMLElement>(".content-column")].map((e) => e.className);
    expect(after).toEqual(before);
  });
});

describe("Scenario: The scrollbar reservation is declared once and applied to every column-carrying surface", () => {
  it("is symmetric, read from one constant, and present on the scroll region and every surface outside it", () => {
    // Declared once, read by BOTH the scrollbar rule and the reservation.
    expect(ruleFor("::-webkit-scrollbar")).toMatch(/width:\s*var\(--scrollbar-reserve\)/);
    const reservation = RESERVATION_RULE;
    // `padding-inline` is symmetric by construction — one value, both edges.
    expect(reservation).toMatch(/padding-inline:\s*var\(--scrollbar-reserve\);/);
    expect(reservation).not.toMatch(/padding-inline:\s*var\(--scrollbar-reserve\)\s+\S/);

    // Inside the scroll region: `scrollbar-gutter: stable both-edges`.
    expect(ruleFor(".chat-scroll")).toMatch(/scrollbar-gutter:\s*stable both-edges/);

    // Outside it: every column-carrying surface, asserted BY NAME rather than by a
    // count, so a surface added later fails visibly rather than silently.
    useCbe.setState({ chatNotice: { text: "soft" }, cutOffNote: "cut off", offerReasoningRemediation: true });
    const { container } = render(<ChatPanel />);
    const conv = container.querySelector(".conv") as HTMLElement;
    const notices = conv.querySelector(".chat-notices")!;
    expect(notices.previousElementSibling?.classList.contains("chat-scroll")).toBe(true);
    expect(notices.nextElementSibling?.classList.contains("composer")).toBe(true);
    expect(notices.querySelectorAll(".conv-row")).toHaveLength(3);
    const surfaces: Record<string, HTMLElement | null> = {
      "conversation header row": conv.querySelector(":scope > .conv-header"),
      "response-cut-off notice": conv.querySelector(":scope > .chat-notices > .conv-row > .chat-notice-cutoff"),
      "reasoning-remediation notice": conv.querySelector(
        ":scope > .chat-notices > .conv-row > .chat-notice-remediation"
      ),
      "soft chat notice": conv.querySelector(
        ":scope > .chat-notices > .conv-row > .chat-notice:not(.chat-notice-cutoff):not(.chat-notice-remediation)"
      ),
      "composer row": conv.querySelector(":scope > .composer"),
    };
    for (const [name, el] of Object.entries(surfaces)) {
      expect(el, `surface missing: ${name}`).not.toBeNull();
      // The reservation sits on the ROW: the header and the composer are rows
      // themselves; each notice is wrapped in a `.conv-row`.
      const row =
        el!.classList.contains("conv-header") || el!.classList.contains("composer") ? el! : el!.parentElement!;
      expect(
        row.classList.contains("conv-row") ||
          row.classList.contains("conv-header") ||
          row.classList.contains("composer"),
        `surface not on a reserving row: ${name}`
      ).toBe(true);
      expect(row.parentElement, `unexpected reserving row owner: ${name}`).toBe(
        row.classList.contains("conv-row") ? notices : conv
      );
    }
    // The notice stack adds no horizontal space of its own.
    expect(ruleFor(".chat-notices")).not.toMatch(/padding|margin|width/);
    // The scroll region is a direct child of `.conv`; the compaction and retry
    // banners render INSIDE it and are covered by its `scrollbar-gutter`.
    expect(conv.querySelector(":scope > .chat-scroll")).not.toBeNull();
  });
});

describe("Scenario: The derived offset between a skill and a lecturer turn is bounded by the constants", () => {
  it("computes the derivation from the constants — no literal of its own", () => {
    // The like-edge offset is the column cap less the turn cap.
    expect(likeEdgeOffset()).toBe(CONTENT_COLUMN_MAX - TURN_MAX);
    // The column at the chat column's minimum is that minimum less the total
    // gutter and less one reservation per side.
    expect(contentColumnWidth(CHAT_MIN)).toBe(CHAT_MIN - 2 * SCROLLBAR_RESERVE - CONTENT_COLUMN_GUTTER);
    expect(sharedContentBox(CHAT_MIN)).toBe(CHAT_MIN - 2 * SCROLLBAR_RESERVE);
    // …so no turn can reach the chat column's edge at any width: the gutter per
    // side against the border box is strictly positive.
    expect(gutterPerSide()).toBe(CONTENT_COLUMN_GUTTER / 2 + SCROLLBAR_RESERVE);
    expect(gutterPerSide()).toBeGreaterThan(0);
    // The cap engages once the chat column is wide enough for it plus both.
    expect(capEngagesAtChatWidth()).toBe(CONTENT_COLUMN_MAX + CONTENT_COLUMN_GUTTER + 2 * SCROLLBAR_RESERVE);
    // Below the cap the column tracks the chat column; at and above it, it stops.
    expect(contentColumnWidth(capEngagesAtChatWidth())).toBe(CONTENT_COLUMN_MAX);
    expect(contentColumnWidth(capEngagesAtChatWidth() + 4000)).toBe(CONTENT_COLUMN_MAX);
    expect(contentColumnWidth(capEngagesAtChatWidth() - 100)).toBeLessThan(CONTENT_COLUMN_MAX);
    // Today's offset — the chat column's width less the turn cap — is unbounded,
    // which is what the bound above replaces.
    expect(capEngagesAtChatWidth() + 4000 - TURN_MAX).toBeGreaterThan(likeEdgeOffset());
  });
});

describe("Scenario: Nothing declares a horizontal overflow", () => {
  it("expresses the column with min() and declares no width that could exceed its container", () => {
    expect(ruleFor(".content-column")).toMatch(/width:\s*min\(/);
    // No element in the chain declares a fixed width.
    for (const selector of [".conv", ".chat-scroll", ".conv-header", ".composer", ".composer-box"]) {
      const rule = ruleFor(selector);
      expect(rule, `${selector} declares a fixed width`).not.toMatch(/^\s*width:\s*\d/m);
      expect(rule, `${selector} declares a min-width`).not.toMatch(/min-width:\s*\d/);
    }
    // The unreflowable elements carry their own horizontal-scroll container…
    expect(ruleFor(".md pre")).toMatch(/overflow-x:\s*auto/);
    expect(ruleFor(".md .katex-display")).toMatch(/overflow-x:\s*auto/);
    // …and a table reflows inside the column rather than exceeding it.
    expect(ruleFor(".md table")).toMatch(/width:\s*100%/);
  });
});

describe("Scenario: The column adds no breakpoint", () => {
  it("introduces no media query of its own", () => {
    // The column is expressed entirely through min() and auto margins.
    for (const rule of [ruleFor(".content-column"), RESERVATION_RULE, ruleFor(".chat-scroll"), ruleFor(".msg")])
      expect(rule).not.toContain("@media");
    // The existing breakpoint block is untouched (it is the panel arbitration's,
    // not this change's) and no second one joins it for the column.
    const media = [...CSS_RULES.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => m[1]);
    expect(media).toEqual(["1180"]);
  });
});

describe("Scenario: The left/right distinction survives the centring", () => {
  it("keeps skill turns on the column's left edge and lecturer turns on its right", () => {
    useCbe.setState({
      turns: [
        { role: "user", text: "eine Frage" },
        { role: "assistant", activity: [{ kind: "text", id: "1", text: "eine Antwort" }] },
      ] as never,
    });
    const { container } = render(<ChatPanel />);
    const lecturer = container.querySelector(".msg-lecturer") as HTMLElement;
    const skill = container.querySelector(".msg-skill") as HTMLElement;
    expect(lecturer).toBeTruthy();
    expect(skill).toBeTruthy();
    // Both live INSIDE the column…
    expect(lecturer.closest(".content-column")).toBeTruthy();
    expect(skill.closest(".content-column")).toBeTruthy();
    // …and the right-alignment is the lecturer turn's auto left margin, unchanged.
    expect(ruleFor(".msg-lecturer")).toMatch(/margin-left:\s*auto/);
    expect(ruleFor(".msg-skill .msg-text")).not.toMatch(/margin-left:\s*auto/);
    // The turn cap is measured inside the column now.
    expect(ruleFor(".msg")).toMatch(/max-width:\s*var\(--turn-max\)/);
  });
});

describe("Scenario: Collapsing a panel does not disturb the panel arbitration", () => {
  it("expresses the column relative to its container and takes width from nothing", () => {
    // `100%` of the chat column, never a viewport unit and never a fixed share
    // of the window — so it follows the chat's width and centre without
    // participating in the panels' arbitration.
    const rule = ruleFor(".content-column");
    expect(rule).toContain("100%");
    expect(rule).not.toMatch(/vw|vmin|vmax/);
    // The panel constants are untouched by this change.
    expect([CHAT_MIN, PANEL_MIN, RAIL_WIDTH, HANDLE_WIDTH]).toEqual([420, 300, 48, 7]);
  });
});

describe("Scenario: Every chat-level disclosure and notice joins the column", () => {
  it("gives the shared working disclosure and the three notices the column treatment", () => {
    useCbe.setState({
      chatNotice: { text: "soft" },
      cutOffNote: "cut off",
      offerReasoningRemediation: true,
      live: {
        ...useCbe.getState().live,
        companionPhase: "consolidating",
        retryAttempt: { attempt: 1, maxAttempts: 3 },
      } as never,
    });
    const { container } = render(<ChatPanel />);
    const disclosure = container.querySelector(".working-disclosure") as HTMLElement;
    expect(disclosure).toBeTruthy();
    expect(disclosure.closest(".content-column")).toBe(container.querySelector(".chat-column"));
    expect(container.querySelectorAll(".working-disclosure")).toHaveLength(1);
    expect(container.querySelector(".chat-banners")).toBeNull();
    for (const selector of [".chat-notice-cutoff", ".chat-notice-remediation"]) {
      const el = container.querySelector(selector) as HTMLElement;
      expect(el, `missing ${selector}`).toBeTruthy();
      expect(el.classList.contains("content-column"), `${selector} is full-bleed`).toBe(true);
    }
    const soft = [...container.querySelectorAll<HTMLElement>(".chat-notice")].find(
      (element) =>
        !element.classList.contains("chat-notice-cutoff") && !element.classList.contains("chat-notice-remediation")
    );
    expect(soft?.classList.contains("content-column")).toBe(true);
  });
});

describe("Scenario: The conversation header stays full-bleed with its contents aligned to the column", () => {
  it("keeps the row's border box full width while its contents carry the column", () => {
    const { container } = render(<ChatPanel />);
    const header = container.querySelector(".conv-header") as HTMLElement;
    // The row itself is NOT the column…
    expect(header.classList.contains("content-column")).toBe(false);
    // …its bottom border spans the chat column's full width…
    expect(ruleFor(".conv-header")).toMatch(/border-bottom:\s*1px solid/);
    // …and its CONTENTS carry it, so the control lines up with the turns' edges.
    const inner = header.querySelector(".conv-header-inner") as HTMLElement;
    expect(inner.classList.contains("content-column")).toBe(true);
    expect(screen.getByRole("button", { name: "New Session" }).closest(".content-column")).toBe(inner);
    // The row carries the reservation with the other four outside surfaces, so
    // the contents share the column's EDGES and not merely its axis.
    expect(RESERVATION_RULE).toMatch(/padding-inline:\s*var\(--scrollbar-reserve\)/);
  });
});

describe("Scenario: Every conversation row is owned by an explicit assignment", () => {
  it.each(["pending", "acknowledged"] as const)(
    "assigns every row by hand, keeps the scroll region the only flexible track and spaces it from the inside (onboarding %s)",
    (status) => {
      useCbe.setState({ onboardingStatus: status, chatNotice: { text: "soft" } });
      const { container } = render(<ChatPanel />);
      const conv = container.querySelector(".conv") as HTMLElement;

      // One explicit row per child, in document order — nothing auto-placed.
      const owners = [
        [".conv-header", 1],
        [".first-use-row", 2],
        [".chat-scroll", 3],
        [".chat-notices", 4],
        [".composer", 5],
      ] as const;
      for (const [selector, row] of owners) {
        expect(conv.querySelector(`:scope > ${selector}`), `not a conversation row: ${selector}`).not.toBeNull();
        expect(ruleFor(selector)).toMatch(new RegExp(`grid-row:\\s*${row};`));
      }
      // Every IN-FLOW child is one of those rows. The polite announcement span is
      // the one exception and is absolutely positioned, so it occupies no track.
      const inFlow = [...conv.children].filter((el) => !el.classList.contains("visually-hidden"));
      expect(inFlow).toHaveLength(owners.length);
      expect(conv.querySelectorAll(":scope > .visually-hidden")).toHaveLength(conv.children.length - owners.length);
      expect(ruleFor(".visually-hidden")).toContain("position: absolute");

      // The track list carries one track per owner and exactly one flexible one.
      const tracks = /grid-template-rows:([^;]+);/.exec(ruleFor(".conv"))![1].trim();
      expect(tracks.match(/minmax\(0, 1fr\)|1fr/g)).toHaveLength(1);
      expect(tracks.replace(/minmax\([^)]*\)/g, "minmax").split(/\s+/)).toHaveLength(owners.length);
      expect(tracks).toContain("minmax(0, 1fr)");

      // The hidden orientation row keeps its own track at zero height.
      expect(conv.querySelector(".first-use-row")!.hasAttribute("hidden")).toBe(status === "acknowledged");
      expect(ruleFor(".first-use-row[hidden]")).toContain("display: none");

      // Vertical spacing is declared on the column INSIDE the scroll region, so a
      // shrunken flexible track cannot be overflowed by the viewport's own padding.
      expect(ruleFor(".chat-scroll")).not.toMatch(/padding/);
      expect(ruleFor(".chat-scroll")).toContain("min-height: 0");
      expect(ruleFor(".chat-scroll > .chat-column")).toMatch(/padding-block:/);
    }
  );
});

describe("Scenario: The composer's narrowing is the accepted trade", () => {
  it("caps the card at the column while its auto-grow is unchanged", () => {
    const { container } = render(<ChatPanel />);
    expect((container.querySelector(".composer-box") as HTMLElement).classList.contains("content-column")).toBe(true);
    // Long-form input is carried by the HEIGHT, not by unbounded width.
    const textarea = ruleFor(".composer-box textarea");
    expect(textarea).toMatch(/max-height:\s*45vh/);
    expect(textarea).toMatch(/min-height:\s*calc\(3 \* 1\.55em/);
    expect(textarea).toMatch(/overflow-y:\s*auto/);
  });
});

describe("Regressions checked while implementing", () => {
  it("keeps the jump-to-latest pill anchored to the scroll viewport, outside the column", () => {
    useCbe.setState({ turns: Array.from({ length: 20 }, () => ({ role: "user", text: "x" })) as never });
    const { container } = render(<ChatPanel />);
    const scroll = container.querySelector(".chat-scroll") as HTMLElement;
    Object.defineProperty(scroll, "scrollHeight", { value: 9000, configurable: true });
    Object.defineProperty(scroll, "clientHeight", { value: 400, configurable: true });
    fireEvent.scroll(scroll, { target: { scrollTop: 0 } });
    const pill = screen.getByRole("button", { name: "Jump to latest message" });
    // A direct child of the scroll viewport, NOT of the column — its axis is the
    // viewport's, which is the same axis the column centres on.
    expect(pill.parentElement).toBe(scroll);
    expect(pill.closest(".content-column")).toBeNull();
    expect(ruleFor(".jump-to-latest")).toMatch(/position:\s*sticky/);
    expect(ruleFor(".jump-to-latest")).toMatch(/margin:\s*0 auto/);
  });

  it("keeps the chat text-size attribute on the scroll region and on the composer", () => {
    useCbe.setState({ chatTextSize: "large" });
    const { container } = render(<ChatPanel />);
    expect((container.querySelector(".chat-scroll") as HTMLElement).dataset.chatTextSize).toBe("large");
    expect((container.querySelector(".composer") as HTMLElement).dataset.chatTextSize).toBe("large");
  });
});
