import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripFrontmatter } from "../src/cbe-system-prompt.js";

/**
 * App-UI help after the rebuild (capability `cbe-skill`, MODIFIED Requirement: *App-UI
 * Help Grounded in the Generated UI Reference*).
 *
 * WHAT CHANGED. The rule used to have TWO paths: the host-injected `app-ui reference`
 * block, and a fallback in which the model `read` the generated
 * `references/ui-guide.md` itself. The fallback is REMOVED — "There is no fallback path
 * into a bundled UI document: none exists, and the previous pointer to one was
 * unreachable." Across 201 recorded log entries from two test sessions the model opened
 * that file ZERO times, and the reference tree it lived in left the bundle with this
 * change. So the skill body carries the DUTIES (answer only from the injected block,
 * withhold an unreported entry, never invent a control) and no pointer at all.
 *
 * The generated artefact itself STAYS at `skills/cbe/references/ui-guide.md`: the
 * untouched capability `ui-reference-generation` requires it at that path and a
 * freshness test guards it. What went away is the skill's pointer to it, not the file.
 */
const SKILL_ROOT = resolve(__dirname, "..", "..", "..", "skills", "cbe");
const skillBody = stripFrontmatter(readFileSync(join(SKILL_ROOT, "SKILL.md"), "utf-8"));
const uiGuide = readFileSync(join(SKILL_ROOT, "references", "ui-guide.md"), "utf-8");

describe("app-UI help — the duties live in the skill body, the pointer is gone", () => {
  // Scenario: *The injected block grounds the app half of an orientation*.
  it("answers app-UI questions only from the host-supplied reference", () => {
    expect(skillBody).toMatch(/Where the host supplies a reference to the application's interface/i);
    expect(skillBody).toMatch(/answer interface questions only from it/i);
    expect(skillBody).toMatch(/naming controls as the lecturer sees them/i);
  });

  // Scenario: *Affordance-gated entry is withheld* — the conservative default.
  it("withholds an entry whose gate the environment does not report", () => {
    expect(skillBody).toMatch(/withholding an entry the environment does not report/i);
  });

  // Scenario: *An unknown control is named as unknown*.
  // The pronoun, not the duty, moved: the sentence read "ask what the lecturer wants to
  // achieve" until the body was tightened against its size cap, and now leans on the
  // "lecturer" named in the clause before it. Match the duty and stay loose on the pronoun,
  // so a later trim of the same kind does not read as a lost obligation.
  it("names an unknown control as unknown instead of fabricating one", () => {
    expect(skillBody).toMatch(/say you cannot locate it and ask what (they|the lecturer) wants? to achieve/i);
    expect(skillBody).toMatch(/Never invent a control, a menu path or a shortcut/i);
  });

  it("carries NO pointer into a bundled UI document", () => {
    // The removed fallback. A pointer here would re-open the path the model never took.
    expect(skillBody).not.toMatch(/ui-guide/i);
    expect(skillBody).not.toMatch(/references\//);
  });

  it("composes app-UI help with the working-process orientation rather than replacing it", () => {
    // Both duties sit in the same § Help section, so a help turn covers both halves.
    const help = skillBody.slice(skillBody.indexOf("## Help"));
    expect(help).toMatch(/one compact turn/i);
    expect(help).toMatch(/interface questions/i);
  });
});

describe("the generated UI reference survives as an artefact of ui-reference-generation", () => {
  // NOT a skill channel any more — asserted here so the retirement of the reference
  // tree cannot silently take the generated file with it.
  it("exists, with the machine-generated header naming its regen command", () => {
    expect(uiGuide).toMatch(/GENERATED FILE — DO NOT HAND-EDIT/);
    expect(uiGuide).toContain("`npm run ui:reference`");
  });

  it("documents the registry set", () => {
    for (const id of ["wiki-browser", "profile-panel", "settings-panel", "material-upload", "new-session", "help-me"]) {
      expect(uiGuide, `ui-guide.md must carry an entry for ${id}`).toContain(`(\`${id}\`)`);
    }
  });

  it("tags affordance-gated entries with an Availability line naming the descriptor key", () => {
    expect(uiGuide).toContain(
      "**Availability:** only when the session's environment descriptor reports the `profilePanel` affordance as `true`."
    );
    expect(uiGuide).toContain(
      "**Availability:** only when the session's environment descriptor reports the `ingestion` affordance as `true`."
    );
    expect(uiGuide).toMatch(/do not present the control as available \(conservative default/);
  });
});
