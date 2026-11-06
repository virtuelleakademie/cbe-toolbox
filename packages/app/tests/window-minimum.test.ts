/**
 * The application window enforces the layout floor (capability `desktop-app`,
 * Requirement: The Chat Column Survives Two Flanking Panels, Scenario: The window
 * cannot be made narrow enough to break the chat).
 *
 * The floor is a rule, so it is asserted as the ARITHMETIC the requirement states
 * — chat minimum + one panel minimum + one rail + one handle — rather than as the
 * number it currently evaluates to. A test that hard-codes 775 would keep passing
 * after someone changed the rail width and left the window behind.
 *
 * `WINDOW_BOUNDS` is imported directly instead of booting Electron: the value is
 * the thing under test, and `main/index.ts` spreads it into `new BrowserWindow`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_MIN, HANDLE_WIDTH, PANEL_MIN, RAIL_WIDTH, WINDOW_MIN_WIDTH } from "../src/shared/layout.js";
import { WINDOW_BOUNDS } from "../src/main/window.js";

describe("window minimum width", () => {
  it("is the stated arithmetic, not a magic number", () => {
    expect(WINDOW_MIN_WIDTH).toBe(CHAT_MIN + PANEL_MIN + RAIL_WIDTH + HANDLE_WIDTH);
    expect(WINDOW_BOUNDS.minWidth).toBe(WINDOW_MIN_WIDTH);
  });

  it("guarantees the chat its minimum with one panel expanded and the other at its rail", () => {
    const chat = WINDOW_BOUNDS.minWidth - RAIL_WIDTH - (PANEL_MIN + HANDLE_WIDTH);
    expect(chat).toBe(CHAT_MIN);
    expect(chat).toBeGreaterThanOrEqual(CHAT_MIN);
  });

  it("is what the BrowserWindow is actually constructed with", () => {
    // The one thing importing `WINDOW_BOUNDS` cannot prove: that `main/index.ts`
    // still uses it. Electron cannot be instantiated in this suite, so the wiring
    // is asserted structurally — and the assertion is deliberately about the
    // SYMBOL, so a literal reintroduced here fails.
    const source = readFileSync(resolve(__dirname, "..", "src", "main", "index.ts"), "utf8");
    expect(source).toMatch(/\.\.\.WINDOW_BOUNDS/);
    expect(source).not.toMatch(/minWidth:\s*\d/);
  });
});
