/**
 * change `harmonise-canvas-slots-with-the-ten-step-outputs`, tasks 4.1 / 4.2.
 *
 * Task 4.2 asked for a reading to be PROVEN or DISPROVEN before the fixture was rewritten:
 * a `canvasArtefacts` entry carrying `step: 6` with **no** `phase` keys at `6/<id>`
 * (`CanvasMirror.keyOf`, `packages/pi-bridge/src/canvas-mirror.ts`), while the fill readers go
 * the other way — `stepEmptySlots(6, mirror)` expands step 6 into its four journey containers
 * and asks for `6/<phase>/<id>` (`packages/pi-bridge/src/canvas-addressing.ts`). The keys never
 * meet, so such an entry is invisible to the host's fill state.
 *
 * The first test PROVES the mechanism; the second guards the rebuilt fixture against the
 * defect coming back. Both are model-free and belong to `npm test`, not to an eval run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CanvasMirror } from "../../../../packages/pi-bridge/src/canvas-mirror.js";
import { stepEmptySlots, stepCanonicalSlots } from "../../../../packages/pi-bridge/src/canvas-addressing.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SCENARIO = path.join(REPO_ROOT, "evaluation", "cbe-skill", "scenarios", "05-closing.md");

describe("a step-6 canvas entry without a phase never reaches the host's fill state", () => {
  it("keys at 6/<id> and leaves every one of step 6's four slots empty", () => {
    const mirror = new CanvasMirror();
    // Exactly the shape the pre-rebuild S5b/S5c/S5d fixtures used: `step: 6`, no `phase`.
    mirror.applySet({ step: 6, id: "is", label: "Investigate Sequence", value: "Weeks 4-7.", state: "done" });
    mirror.applySet({ step: 6, id: "as", label: "Act Sequence", value: "Weeks 8-11.", state: "done" });

    // The entries ARE in the mirror — this is not a rejected write …
    expect(mirror.size()).toBe(2);
    // … but they sit under the bare-step key, which no fill reader ever asks for.
    expect(mirror.get({ step: 6 }, "is")?.value).toBe("Weeks 4-7.");
    expect(mirror.get({ step: 6, phase: "investigate" }, "is")).toBeUndefined();
    // Consequence: step 6 reads as completely unfilled, so the close gate still blocks.
    expect(stepEmptySlots(6, mirror)).toEqual(stepCanonicalSlots(6));

    // The phase-qualified entry is the one that lands.
    mirror.applySet({
      step: 6,
      phase: "investigate",
      id: "is",
      label: "Investigate Sequence",
      value: "Weeks 4-7.",
      state: "done",
    });
    expect(stepEmptySlots(6, mirror)).not.toContain("investigate/is");
  });
});

describe("05-closing.md writes its step-6 canvas fixture phase-qualified", () => {
  const RETIRED = ["gq", "ar", "syn", "sc", "sd", "ie"];

  /** Every `- step: 6` fixture entry of the scenario file, as its own block of `key: value`
   * lines. Read from the raw file rather than through the loader, because `canvasArtefacts`
   * is carried verbatim as `Array<Record<string, unknown>>` and the defect is in the KEYS. */
  function step6Entries(): Array<Record<string, string>> {
    const lines = readFileSync(SCENARIO, "utf8").split("\n");
    const entries: Array<Record<string, string>> = [];
    for (let i = 0; i < lines.length; i++) {
      const head = /^(\s*)- step: 6\s*$/.exec(lines[i]);
      if (!head) continue;
      const indent = head[1].length + 2;
      const entry: Record<string, string> = { step: "6" };
      for (let j = i + 1; j < lines.length; j++) {
        const kv = new RegExp(`^\\s{${indent}}([a-zA-Z]+): (.*)$`).exec(lines[j]);
        if (!kv) break;
        entry[kv[1]] = kv[2].replace(/^"|"$/g, "");
      }
      // `stepCoverage` entries also open with `- step: 6`; only canvas artefacts carry an `id`.
      if (entry.id) entries.push(entry);
    }
    return entries;
  }

  it("qualifies every step-6 entry with its journey element", () => {
    const entries = step6Entries();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.phase, `step-6 entry \`${e.id}\` carries no phase — it would key at 6/${e.id}`).toBeTruthy();
      expect(["engage", "investigate", "act", "reflect"]).toContain(e.phase);
    }
  });

  it("names only the four canonical sequence ids, never a retired learner-time id", () => {
    const expected: Record<string, string> = { engage: "es", investigate: "is", act: "as", reflect: "rs" };
    for (const e of step6Entries()) {
      expect(RETIRED, `retired learner-time id \`${e.id}\` still in the fixture`).not.toContain(e.id);
      expect(e.id, `step-6 ${e.phase} entry`).toBe(expected[e.phase]);
    }
  });
});
