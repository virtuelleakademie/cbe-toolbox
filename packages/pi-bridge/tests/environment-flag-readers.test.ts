/**
 * Every emitted affordance flag has a NAMED READER (capability `agent-harness`,
 * Requirement: *Environment Descriptor for the Skill*, Scenario: *A flag with no reader
 * is removed*).
 *
 * WHY THIS TEST EXISTS. A descriptor field that no rule consults is not merely inert.
 * `citations` was emitted `true` in the app and `false` headless, no rule read it — and
 * the two rules that DO exist ("never offer a capability the environment has not
 * reported" and "a missing field is treated as `false`") licensed the inference that
 * citations were unavailable, which would switch off the product's central discipline.
 * A flag that steers nothing can still steer something.
 *
 * The assertion is LIST-BASED on purpose: adding a flag means adding a line here and
 * naming who reads it. That is the deliberate step; a generic heuristic would let a
 * reader-less flag slip in behind a coincidental substring match.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvironmentDescriptor } from "../src/environment.js";
import { cbeIdentityPrompt, stripFrontmatter } from "../src/cbe-system-prompt.js";
import { pickerTool } from "../src/picker-tool.js";
import { canvasTool } from "../src/canvas-tool.js";
import { stepTool } from "../src/step-tool.js";
import { maturityTool } from "../src/maturity-tool.js";
import { UI_AFFORDANCE_KEYS } from "@cbe/corpus-schema";
import { readdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillBody = stripFrontmatter(readFileSync(path.resolve(__dirname, "../../../skills/cbe/SKILL.md"), "utf8"));

/**
 * Affordance keys the app's UI-element registry entries actually gate on, read from the
 * colocated `<Component>.ui-registry.ts` sources. Read rather than imported: pi-bridge
 * does not depend on the app package, and a hand-copied list would be exactly the stale
 * mirror this requirement exists to prevent.
 */
const APP_UI_REGISTRY_AFFORDANCES: string[] = (() => {
  const dir = path.resolve(__dirname, "../../app/src/renderer/components");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ui-registry.ts"))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/affordance:\s*"([A-Za-z]+)"/g)) out.add(m[1]!);
  }
  return [...out];
})();

/**
 * The deliberate ledger: flag → the channel passage that consults it.
 *
 * Two reader kinds count, and only these two:
 *  - `tool`     — the flag is named in that tool's `description`, so the model branches
 *                 on it before calling (e.g. "only when the descriptor reports `step`").
 *  - `ui-entry` — the flag gates at least one app-UI reference entry, and the skill
 *                 body's Help rule consults that gating ("withholding an entry the
 *                 environment does not report").
 */
const READERS: Record<string, { kind: "tool"; description: string } | { kind: "ui-entry" }> = {
  canvas: { kind: "tool", description: canvasTool.description ?? "" },
  picker: { kind: "tool", description: pickerTool.description ?? "" },
  step: { kind: "tool", description: stepTool.description ?? "" },
  maturity: { kind: "tool", description: maturityTool.description ?? "" },
  ingestion: { kind: "ui-entry" },
  profilePanel: { kind: "ui-entry" },
  courseWorkspace: { kind: "ui-entry" },
};

describe("environment descriptor — every emitted flag has a named reader", () => {
  const emitted = Object.keys(buildEnvironmentDescriptor({ profile: "app" }).affordances);

  it("the emitted flag set equals the ledger's flag set", () => {
    expect(emitted.slice().sort()).toEqual(Object.keys(READERS).sort());
  });

  for (const [flag, reader] of Object.entries(READERS)) {
    it(`${flag} is consulted by its named reader`, () => {
      if (reader.kind === "tool") {
        expect(reader.description, `no branch on \`${flag}\` in its tool description`).toContain(`\`${flag}\``);
      } else {
        expect(
          APP_UI_REGISTRY_AFFORDANCES,
          `no app-UI reference entry gates on \`${flag}\`, so nothing consults it`
        ).toContain(flag);
      }
    });
  }

  it("the retired flags are gone from the descriptor AND from every channel", () => {
    // `citations` — emitted, never read, and licensing a dangerous inference.
    // `corpusAccess` — constant `true` in both profiles; a constant flag steers nothing.
    // `bash` — went with the tool (Requirement: Tool Allowlist Excluding Shell Execution).
    for (const gone of ["citations", "corpusAccess", "bash"]) {
      expect(emitted, `\`${gone}\` is still emitted`).not.toContain(gone);
      expect(cbeIdentityPrompt).not.toContain(gone);
      expect(skillBody).not.toContain(gone);
      expect([...UI_AFFORDANCE_KEYS] as string[]).not.toContain(gone);
    }
  });

  it("the app-UI registry declares exactly the descriptor's flags", () => {
    // The registry list MUST stay the FULL descriptor key set: a key the descriptor
    // emits but the list rejects makes a real control undocumentable.
    expect([...UI_AFFORDANCE_KEYS].sort()).toEqual(emitted.slice().sort());
  });
});

describe("environment descriptor — it reports state, it is not a rule channel", () => {
  // Scenario: *The descriptor carries no overriding rule text*.
  const block = buildEnvironmentDescriptor({ profile: "app", paths: { corpus: "/c" } }).toSystemPromptBlock();

  it("ends at its own END marker, with no trailing rule", () => {
    expect(block.trimEnd().endsWith("--- END ---")).toBe(true);
  });

  it("claims no precedence over the identity prompt or the skill body", () => {
    expect(block).not.toMatch(/hard rule/i);
    expect(block).not.toMatch(/overrides every/i);
  });
});
