/**
 * Context occupancy reported to the host (capability `agent-harness`,
 * Requirement: Context Occupancy Reported to the Host). One test per Scenario
 * of that requirement that this module owns; the emission-point scenarios that
 * need a running session are exercised in `packages/app/tests/` against the IPC
 * layer that owns them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContextOccupancyTracker,
  occupancyChanged,
  type CbeContextUsage,
  type ContextUsageSource,
} from "../src/context-occupancy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../src/context-occupancy.ts"), "utf8");

/** A stand-in for the CBE session port, exposing only its context-usage accessor. */
function source(usage: CbeContextUsage | undefined): ContextUsageSource {
  return { getContextUsage: () => usage };
}

describe("Scenario: The reported figure is the runtime's own", () => {
  it("returns exactly what the runtime's accessor gives, and never sums usage fields by hand", () => {
    const t = new ContextOccupancyTracker();
    t.noteAssistantMessageCompleted();
    expect(t.read(source({ tokens: 41234, contextWindow: 131072, percent: 31 }), 131072)).toEqual({
      used: 41234,
      window: 131072,
    });
    // The code path contains no reconstruction of a token count: no arithmetic
    // over the per-message usage fields, whose disjointness is a property of the
    // provider's own normalisation rather than of this requirement.
    for (const field of ["cacheRead", "cacheWrite", "totalTokens"]) {
      expect(SOURCE, `re-derives ${field}`).not.toContain(`.${field}`);
    }
    expect(SOURCE).not.toMatch(/tokens\s*[+*/-]\s*/);
    expect(SOURCE).toContain("getContextUsage()");
  });
});

describe("Scenario: An unconfigured context length is reported as no window, not as the high default", () => {
  it("omits `window` entirely where the lecturer configured none", () => {
    const t = new ContextOccupancyTracker();
    t.noteAssistantMessageCompleted();
    // The provider still registers its high default — the runtime's own
    // `contextWindow` here is 131072 — but the report never speaks it.
    const report = t.read(source({ tokens: 900, contextWindow: 131072, percent: 1 }), undefined);
    expect(report).toEqual({ used: 900 });
    expect("window" in report).toBe(false);
    // A zero or negative configured value is not a window either.
    expect("window" in t.read(source({ tokens: 900, contextWindow: 131072, percent: 1 }), 0)).toBe(false);
  });
});

describe("Scenario: Before the first completed message the occupancy is unknown, not zero", () => {
  it("reports unknown while nothing has completed, whatever the runtime says", () => {
    const t = new ContextOccupancyTracker();
    // Even if the runtime already offered a number, nothing has completed on
    // this leg, so it does not describe the conversation.
    expect(t.read(source({ tokens: 512, contextWindow: 32768, percent: 2 }), 32768)).toEqual({
      used: null,
      window: 32768,
    });
    // …and with no usage at all it is likewise unknown, never `0`.
    expect(t.read(source(undefined), 32768).used).toBeNull();
  });
});

describe("Scenario: A resumed session does not report the seeded zeros as an occupancy", () => {
  it("reports unknown until the first assistant message of the resumed leg completes", () => {
    const t = new ContextOccupancyTracker();
    // A resumed session seeds its prior turns with a ZEROED usage object, so the
    // runtime's estimate is derived from zeros; the tracker refuses it.
    const seeded = source({ tokens: 0, contextWindow: 131072, percent: 0 });
    expect(t.read(seeded, 131072).used).toBeNull();
    // It becomes a measured figure only once a message completes.
    t.noteAssistantMessageCompleted();
    expect(t.read(source({ tokens: 88000, contextWindow: 131072, percent: 67 }), 131072).used).toBe(88000);
  });
});

describe("Scenario: A completed compaction reports unknown, not a fabricated reduced figure", () => {
  it("returns to unknown at the compaction boundary and stays there until the next message", () => {
    const t = new ContextOccupancyTracker();
    t.noteAssistantMessageCompleted();
    expect(t.read(source({ tokens: 120000, contextWindow: 131072, percent: 92 }), 131072).used).toBe(120000);
    t.noteCompactionBoundary();
    // The newest usage record still describes the PRE-compaction context.
    expect(t.read(source({ tokens: 120000, contextWindow: 131072, percent: 92 }), 131072).used).toBeNull();
    // pi itself reports null there too; either way the answer is unknown.
    expect(t.read(source({ tokens: null, contextWindow: 131072, percent: null }), 131072).used).toBeNull();
    t.noteAssistantMessageCompleted();
    expect(t.read(source({ tokens: 9000, contextWindow: 131072, percent: 7 }), 131072).used).toBe(9000);
  });
});

describe("Scenario: A failed or aborted compaction still produces a report", () => {
  it("the boundary is recorded whatever ended the compaction", () => {
    // The tracker draws no distinction between a completed, a failed and an
    // aborted compaction: each is a boundary after which the occupancy is not
    // knowable, and each therefore yields a report the host can emit rather than
    // leaving a pending state waiting for one that never comes.
    for (const _ending of ["completed", "failed", "aborted"]) {
      const t = new ContextOccupancyTracker();
      t.noteAssistantMessageCompleted();
      t.noteCompactionBoundary();
      const report = t.read(source({ tokens: 120000, contextWindow: 131072, percent: 92 }), 131072);
      expect(report).toEqual({ used: null, window: 131072 });
    }
  });
});

describe("Scenario: A live provider swap re-reports the window", () => {
  it("reads the window from the value handed in, including when it is cleared", () => {
    const t = new ContextOccupancyTracker();
    t.noteAssistantMessageCompleted();
    const s = source({ tokens: 5000, contextWindow: 32768, percent: 15 });
    expect(t.read(s, 32768)).toEqual({ used: 5000, window: 32768 });
    // A swap to a different configured window.
    expect(t.read(s, 8192)).toEqual({ used: 5000, window: 8192 });
    // …and one that CLEARS it, so the high default applies again and no window
    // is reported at all.
    expect(t.read(s, undefined)).toEqual({ used: 5000 });
  });
});

describe("Scenario: The report is host-facing only", () => {
  it("touches no instruction channel and triggers nothing", () => {
    // By construction: the module imports nothing, reads one accessor and
    // returns a plain object. Nothing here can prompt, compact or write.
    expect(SOURCE).not.toMatch(/^import /m);
    for (const forbidden of ["prompt", "compact", "systemPrompt", "descriptor", "SKILL", "description"]) {
      expect(SOURCE.toLowerCase(), `mentions ${forbidden}`).not.toContain(`${forbidden.toLowerCase()}(`);
    }
  });
});

describe("occupancyChanged", () => {
  it("is true for the first report and for any moved figure", () => {
    expect(occupancyChanged(null, { used: null })).toBe(true);
    expect(occupancyChanged({ used: 10, window: 100 }, { used: 10, window: 100 })).toBe(false);
    expect(occupancyChanged({ used: 10, window: 100 }, { used: 11, window: 100 })).toBe(true);
    expect(occupancyChanged({ used: 10, window: 100 }, { used: 10 })).toBe(true);
    expect(occupancyChanged({ used: null }, { used: 0 })).toBe(true);
  });
});
