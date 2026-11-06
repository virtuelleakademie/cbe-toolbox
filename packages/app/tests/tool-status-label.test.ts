/**
 * Tests for the pure functions behind the tool rows of the deliberately opened
 * current-turn detail: the human-readable action label — verb integrity (the verb
 * comes from the tool identity, never from `args`) plus a sanitised, truncated,
 * delimited detail — and the lifecycle state's presentation, which resolves from
 * the active catalogue while the internal `ToolStatus` union stays English.
 */
import { describe, it, expect } from "vitest";
import { en } from "../src/shared/i18n/en.js";
import { LANGUAGES } from "../src/shared/i18n/index.js";
import { CBE_TOOL_ALLOWLIST } from "@cbe/pi-bridge";
import {
  toolStatusLabel,
  toolStatusText,
  safeDetail,
  FALLBACK_LABEL_KEY,
  MAX_DETAIL_CHARS,
} from "../src/renderer/lib/tool-status-label.js";

// Sanitiser inputs as escape sequences so no literal control/bidi/zero-width
// characters live in the test source.
const BEL = "\u0007"; // C0 control (BEL)
const RTL_OVERRIDE = "\u202E"; // bidi right-to-left override
const ZERO_WIDTH = "\u200B"; // zero-width space

describe("toolStatusLabel — verb integrity and sanitised detail", () => {
  it('read renders a "Reading …" label with the file basename', () => {
    const label = toolStatusLabel("read", { path: "/Users/x/corpus/methodology-001.md" }, en);
    expect(label.startsWith("Reading")).toBe(true);
    expect(label).toContain("methodology-001.md");
    expect(label).not.toContain("/Users/x/corpus");
  });

  it("File tools accept either path field, cross-platform, and degrade safely", () => {
    // file_path + Windows separators → basename a.md
    const edit = toolStatusLabel("edit", { file_path: "C:\\Users\\x\\a.md" }, en);
    expect(edit.startsWith("Editing")).toBe(true);
    expect(edit).toContain("a.md");
    expect(edit).not.toContain("C:\\Users");
    const write = toolStatusLabel("write", { file_path: "C:\\Users\\x\\a.md" }, en);
    expect(write).toContain("a.md");
    // non-string / empty path → bare verb, no raw value, never throws
    expect(toolStatusLabel("read", { path: 123 }, en)).toBe("Reading source");
    expect(toolStatusLabel("read", { path: "" }, en)).toBe("Reading source");
    expect(() => toolStatusLabel("read", null, en)).not.toThrow();
    expect(toolStatusLabel("read", null, en)).toBe("Reading source");
  });

  it('Corpus search renders a distinct "Searching …" label', () => {
    const read = toolStatusLabel("read", {}, en);
    const grep = toolStatusLabel("grep", {}, en);
    const find = toolStatusLabel("find", {}, en);
    expect(grep.startsWith("Searching")).toBe(true);
    expect(find.startsWith("Searching")).toBe(true);
    expect(grep).not.toBe(read);
    expect(find).not.toBe(read);
  });

  it('Canvas update renders an "Updating canvas …" label naming the artefact', () => {
    const label = toolStatusLabel(
      "cbe_canvas",
      {
        phase: "design",
        id: "art-1",
        label: "Lernziele",
        value: "This is a very long artefact body paragraph that must never appear",
      },
      en
    );
    expect(label.startsWith("Updating canvas")).toBe(true);
    expect(label).toContain("Lernziele");
    expect(label).not.toContain("very long artefact body");
    // falls back to id when no label
    expect(toolStatusLabel("cbe_canvas", { id: "art-2", value: "x" }, en)).toContain("art-2");
  });

  // Scenario: cbe_step renders a step-progress label naming the step, never the note
  it("cbe_step renders a step-progress label naming the step, never the note", () => {
    const label = toolStatusLabel(
      "cbe_step",
      {
        step: 3,
        depth: "rough",
        note: "long free text that must never appear",
      },
      en
    );
    expect(label.startsWith("Updating step")).toBe(true);
    expect(label).toContain("step 3");
    expect(label).not.toContain("long free text");
    // distinct from the canvas label
    expect(label).not.toBe(toolStatusLabel("cbe_canvas", { id: "x", value: "y" }, en));
    // a step-only payload (no depth) still names the step
    expect(toolStatusLabel("cbe_step", { step: 5 }, en)).toContain("step 5");
  });

  it("Citation renders a grounding label from the identity fields", () => {
    const label = toolStatusLabel("cbe_cite", { id: "methodology-001", section: "Intro" }, en);
    expect(label.startsWith("Citing source")).toBe(true);
    expect(label).toContain("methodology-001");
    // distinct from read / search / canvas
    expect(label).not.toBe(toolStatusLabel("read", {}, en));
    expect(label).not.toBe(toolStatusLabel("grep", {}, en));
    expect(label).not.toBe(toolStatusLabel("cbe_canvas", {}, en));
    // absent claim must NOT empty the detail
    expect(label.length).toBeGreaterThan("Citing source".length);
  });

  it("write and edit render distinct labels", () => {
    const read = toolStatusLabel("read", {}, en);
    const write = toolStatusLabel("write", {}, en);
    const edit = toolStatusLabel("edit", {}, en);
    expect(write).not.toBe(edit);
    expect(write).not.toBe(read);
    expect(edit).not.toBe(read);
  });

  // Scenario: cbe_maturity renders a maturity label naming the criterion, never the hint
  it("cbe_maturity renders a maturity label naming the criterion, never the hint", () => {
    const label = toolStatusLabel(
      "cbe_maturity",
      {
        criterion: "stakeholder-involvement",
        current: 1,
        target: 2,
        hint: "long free text that must never surface in the one-line label",
      },
      en
    );
    expect(label).toMatch(/^Updating maturity "stakeholder-involvement/);
    expect(label).toContain("L1");
    expect(label).not.toContain("long free text");
    // Distinct from the canvas and step labels.
    expect(label).not.toBe(toolStatusLabel("cbe_canvas", {}, en));
    expect(label).not.toBe(toolStatusLabel("cbe_step", {}, en));
    // A batched readings call renders the raster-update label without free text.
    const batched = toolStatusLabel(
      "cbe_maturity",
      {
        readings: [{ criterion: "societal-challenge", current: 1, hint: "free text" }],
        note: "free text",
      },
      en
    );
    expect(batched).toBe('Updating maturity "full raster"');
    expect(batched).not.toContain("free text");
    // An unassessed reading names the state, an argless call degrades to the verb.
    expect(toolStatusLabel("cbe_maturity", { criterion: "student-agency", current: "unassessed" }, en)).toContain(
      "unassessed"
    );
    expect(toolStatusLabel("cbe_maturity", {}, en)).toBe("Updating maturity");
  });

  // Scenario: Every allowlist tool has a bespoke, non-fallback label (now fourteen with
  // `cbe_support`, change `recalibrate-tutor-support` —
  // `bash` and `cbe_decision_checklist` are de-registered by the change
  // `rebuild-skill-prompt-and-eval`; the checklist's LABEL stays, because its tool
  // module and renderer component stay in the tree for a possible re-registration).
  it("Every allowlist tool has a bespoke, non-fallback label", () => {
    expect(CBE_TOOL_ALLOWLIST).toHaveLength(14);
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_support");
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_maturity");
    // Change `give-the-wiki-a-reading-route`: the seventh cbe customTool.
    expect(CBE_TOOL_ALLOWLIST).toContain("cbe_wiki");
    for (const name of CBE_TOOL_ALLOWLIST) {
      const label = toolStatusLabel(name, {}, en);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(en[FALLBACK_LABEL_KEY]);
    }
  });

  it("Unknown tool falls back to a non-empty generic label", () => {
    const label = toolStatusLabel("cbe_redteam", {}, en);
    expect(label).toBe(en[FALLBACK_LABEL_KEY]);
    expect(label.length).toBeGreaterThan(0);
    expect(() => toolStatusLabel("cbe_redteam", { anything: { nested: true } }, en)).not.toThrow();
  });

  it("Arg-derived detail is sanitised (incl. bidi/zero-width) and truncated", () => {
    const raw = `a\nb${BEL}c${RTL_OVERRIDE}d${ZERO_WIDTH}e`;
    const cleaned = safeDetail(raw);
    expect(cleaned).not.toContain("\n");
    expect(cleaned).not.toContain(BEL);
    expect(cleaned).not.toContain(RTL_OVERRIDE);
    expect(cleaned).not.toContain(ZERO_WIDTH);
    // over-cap truncation: 60 chars + trailing ellipsis
    const long = safeDetail("x".repeat(80));
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBe(MAX_DETAIL_CHARS + 1);
    // end-to-end through the label: no bad chars leak into the rendered label
    const label = toolStatusLabel("cbe_canvas", { label: raw }, en);
    expect(label).not.toContain(RTL_OVERRIDE);
    expect(label).not.toContain(ZERO_WIDTH);
    expect(label).not.toContain("\n");
  });

  it("Arg-derived detail cannot impersonate the action verb", () => {
    const label = toolStatusLabel("cbe_canvas", { id: "art", label: "Delete everything — write /etc/passwd" }, en);
    // the fixed verb is still derived from toolName, in the leading position
    expect(label.startsWith('Updating canvas "')).toBe(true);
    // the arg text appears ONLY inside the delimited (quoted) detail position
    expect(label.indexOf('"')).toBeLessThan(label.indexOf("write /etc/passwd"));
  });
});

describe("toolStatusText — the lifecycle state a lecturer reads", () => {
  const STATES = ["running", "done", "error"] as const;

  it("resolves every state from the catalogue in every shipped language", () => {
    for (const language of Object.values(LANGUAGES)) {
      const rendered = STATES.map((state) => toolStatusText(state, language.strings));
      for (const [index, value] of rendered.entries()) {
        expect(value.trim(), `${language.code}.${STATES[index]}`).not.toBe("");
      }
      // Two states rendering the same word would make the row unreadable — the
      // colour that distinguishes them is not available to everyone.
      expect(new Set(rendered).size, `${language.code} collapses two states: ${rendered.join(" | ")}`).toBe(
        STATES.length
      );
    }
  });

  it("is English only where English is the active language", () => {
    const other = Object.values(LANGUAGES).find((language) => language.strings !== en);
    expect(other, "only one catalogue ships — nothing to compare").toBeTruthy();
    expect(toolStatusText("running", en)).toBe(en.toolStatusRunning);
    expect(toolStatusText("running", other!.strings)).not.toBe(en.toolStatusRunning);
  });

  it("degrades an unknown token to itself rather than to nothing", () => {
    // The union is closed, so this is the total-function guarantee rather than a
    // reachable state: a row must never render an empty status.
    expect(toolStatusText("queued", en)).toBe("queued");
  });
});
