/**
 * Unit tests for the render-order helper.
 *
 * The stored activity stream is chronological (see liveReducer.test.ts). At
 * render time, interactive generative-UI cards (`cbe_picker`,
 * `cbe_decision_checklist`) are pinned to the END of the assistant turn — they
 * are calls-to-action the lecturer answers, so they belong below the
 * explanatory text regardless of where the model emitted the tool call. Passive
 * tool cards keep their chronological position. Covers desktop-app spec,
 * Scenario "Interactive generative-UI cards render pinned to the bottom of the
 * assistant turn".
 */
import { describe, it, expect } from "vitest";
import { orderItemsForRender, isPhantomToolItem, type ActivityItem } from "../src/renderer/state/activity.js";

const text = (id: string, t: string): ActivityItem => ({ kind: "text", id, text: t });
const tool = (id: string, toolName: string): ActivityItem => ({
  kind: "tool",
  id,
  data: { toolCallId: id, toolName, args: {}, status: "done" },
});
describe("orderItemsForRender — interactive cards pin to the bottom", () => {
  it("pins a decision checklist below trailing explanatory text", () => {
    // chronological: tool call FIRST, then explanation streams after
    const items = [tool("c1", "cbe_decision_checklist"), text("t1", "Wir sind im Design-Modus…")];
    const ordered = orderItemsForRender(items);
    expect(ordered.map((i) => i.id)).toEqual(["t1", "c1"]);
  });

  it("pins a picker below trailing explanatory text", () => {
    const items = [tool("p1", "cbe_picker"), text("t1", "Hier die Optionen, kurz erklärt…")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["t1", "p1"]);
  });

  it("keeps passive tool cards (read/grep) in chronological position", () => {
    const items = [text("t0", "intro"), tool("r1", "read"), text("t1", "narration"), tool("g1", "grep")];
    // no interactive card → order unchanged (and same reference for the common case)
    expect(orderItemsForRender(items)).toBe(items);
  });

  it("pins the interactive card last even when passive cards follow it chronologically", () => {
    const items = [tool("d1", "cbe_decision_checklist"), text("t1", "explanation"), tool("r1", "read")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["t1", "r1", "d1"]);
  });

  it("keeps multiple interactive cards in their relative order at the bottom", () => {
    const items = [tool("a1", "cbe_picker"), text("t1", "x"), tool("a2", "cbe_decision_checklist")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["t1", "a1", "a2"]);
  });
});

describe("orderItemsForRender — empty-named phantom tool suppression", () => {
  // Covers desktop-app spec, Requirement: Suppression of Empty-Named Phantom Tool
  // Calls > Scenario "Empty-named phantom tool card is not rendered".
  it("omits an empty-named phantom tool item while keeping real tools, text, and order", () => {
    const items = [text("t0", "intro"), tool("c1", "cbe_cite"), tool("x1", ""), tool("c2", "cbe_cite")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["t0", "c1", "c2"]);
  });

  it("treats a whitespace-only tool name as a phantom and omits it", () => {
    const items = [tool("c1", "cbe_cite"), tool("x1", "   ")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["c1"]);
    expect(isPhantomToolItem(items[1]!)).toBe(true);
  });

  it("still pins interactive cards last after dropping phantoms", () => {
    const items = [tool("x1", ""), tool("p1", "cbe_picker"), text("t1", "explain")];
    expect(orderItemsForRender(items).map((i) => i.id)).toEqual(["t1", "p1"]);
  });

  it("returns the same array reference when there are no phantoms and no interactive cards", () => {
    const items = [text("t0", "intro"), tool("r1", "read")];
    expect(orderItemsForRender(items)).toBe(items);
  });
});
