import { describe, it, expect } from "vitest";
import { resolveUiEntryLabels } from "@cbe/corpus-schema";
import { LANGUAGES } from "../src/shared/i18n/index.js";

/**
 * Every entry with its label and prose placeholders resolved in one shipped
 * language. An entry's `label` is a catalogue KEY now, so a test about what the
 * lecturer READS has to resolve it — and the panel-vocabulary rule binds every
 * language equally, which is why the retirement check below runs over all of them.
 */
function resolvedIn(
  code: string
): { id: string; area: string; label: string; description: string; howToUse: string }[] {
  const strings = LANGUAGES[code]!.strings as unknown as Record<string, unknown>;
  const lookup = (key: string): string | undefined =>
    typeof strings[key] === "string" ? (strings[key] as string) : undefined;
  return APP_UI_REGISTRY.map((entry) => resolveUiEntryLabels(entry, lookup));
}
import { resolve } from "node:path";
import { collectUiRegistryEntries } from "@cbe/corpus-schema";
import { APP_UI_REGISTRY, LOAD_BEARING_UI_IDS } from "../src/shared/ui-registry.js";

// ui-reference-generation spec, Requirements:
//   - Registry Aggregate Consumable by the Main Process
//   - UI Element Registry (Scenario: The load-bearing work surfaces are documented)

const RENDERER_ROOT = resolve(__dirname, "..", "src", "renderer");

describe("main-process UI registry aggregate", () => {
  // Scenario: Aggregate matches what the generator collects. Same list, same
  // order — so the injected `app-ui reference` block and the generated
  // `ui-guide.md` cannot present different entries or a different sequence.
  it("deep-equals the entries the generator collects, in order", async () => {
    const { entries } = await collectUiRegistryEntries(RENDERER_ROOT);
    expect(APP_UI_REGISTRY).toEqual(entries);
    expect(APP_UI_REGISTRY.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  // Scenario: A new registry file left out of the aggregate fails the suite.
  // A registry file the aggregate never imports is, from the gate's point of
  // view, simply an entry the generator collects and the aggregate lacks — so
  // the demonstration adds exactly that to the collected side and shows the
  // comparison above rejecting it, naming the orphan.
  it("an entry the generator collects but the aggregate lacks fails the comparison", async () => {
    const { entries } = await collectUiRegistryEntries(RENDERER_ROOT);
    const withUnaggregated = [
      ...entries,
      {
        id: "unaggregated-control",
        area: "Fixture area",
        label: "Unaggregated control",
        description: "A control whose registry file was never imported by the aggregate.",
        howToUse: "Click it.",
      },
    ];
    expect(() => expect(APP_UI_REGISTRY).toEqual(withUnaggregated)).toThrow();
    const missing = withUnaggregated.filter((e) => !APP_UI_REGISTRY.some((a) => a.id === e.id));
    expect(missing.map((e) => e.id)).toEqual(["unaggregated-control"]);
  });
});

describe("registry coverage of the load-bearing work surfaces", () => {
  // Scenario: The load-bearing work surfaces are documented. The named ids are
  // the surfaces a lecturer actually works in — the orientation is app-blind
  // without them. Exhaustive coverage of every rendered control is explicitly
  // NOT required, so this list is the floor, not the ceiling. It is the same set
  // the host's size backstop discards last, deliberately: one definition of
  // "load-bearing", so coverage and truncation cannot disagree.
  const REQUIRED_IDS = [...LOAD_BEARING_UI_IDS];

  // The floor above is derived from the module it guards, so on its own it would
  // wave through a single edit that deletes an entry AND its id. These literals
  // are the independent half: the surfaces the spec names in prose (Requirement:
  // UI Element Registry — "the right panel and its expand/collapse affordance,
  // the left panel and its own expand/collapse affordance, the design-flow canvas
  // with its ten step groups and its artefact cards (including the
  // annotate/iterate loop and the artefact delete control), the CBE Maturity
  // panel, the course list and course detail levels of the left panel, and the
  // header strip's active-course name together with its four top-right
  // affordances (language, help, settings gear, user affordance)
  // — in addition to the composer's attach control, the session controls, the
  // Profile section and the Settings section … and the Wiki browser"). Removing
  // one of these is a spec change, not a refactor.
  const SPEC_NAMED_IDS = [
    "right-panel",
    "left-panel",
    "design-flow-canvas",
    "artifact-annotation",
    "artifact-delete",
    "maturity-panel",
    "courses-panel",
    "course-detail",
    "header-course-name",
    "header-interface-language",
    "header-help",
    "settings-gear",
    "user-affordance",
    "material-upload",
    "help-me",
    "new-session",
    "profile-panel",
    "settings-panel",
    "wiki-browser",
  ];

  it("keeps every spec-named surface in the shared load-bearing set", () => {
    const absent = SPEC_NAMED_IDS.filter((id) => !LOAD_BEARING_UI_IDS.has(id));
    expect(absent, "spec names these surfaces but LOAD_BEARING_UI_IDS does not carry them").toEqual([]);
  });

  for (const id of REQUIRED_IDS) {
    it(`documents "${id}" with lecturer-facing description and how-to-use text`, () => {
      const entry = APP_UI_REGISTRY.find((e) => e.id === id);
      expect(entry, `registry entry "${id}" is missing`).toBeDefined();
      expect(entry!.description.trim().length).toBeGreaterThan(0);
      expect(entry!.howToUse.trim().length).toBeGreaterThan(0);
      expect(entry!.label.trim().length).toBeGreaterThan(0);
    });
  }

  // Scenario: No entry sends the lecturer to a surface that moved
  it("locates no moved surface where it no longer is", () => {
    const text = (e: (typeof APP_UI_REGISTRY)[number]) => `${e.area} ${e.label} ${e.description} ${e.howToUse}`;

    // Course management, the profile and the settings surface are not tabs of
    // the right panel any more. An entry that still said so would produce a
    // confidently wrong answer — worse than no entry, which is answered honestly
    // as undocumented.
    for (const id of ["courses-panel", "course-detail", "profile-panel", "settings-panel"]) {
      const entry = APP_UI_REGISTRY.find((e) => e.id === id)!;
      expect(entry.area, `${id} still claims the right panel`).not.toMatch(/right panel/i);
      expect(text(entry), `${id} still sends the lecturer to a right-panel tab`).not.toMatch(
        /right panel and select|tab of the right panel/i
      );
    }

    // …and course switching is not described as a header dropdown. Scoped to the
    // co-occurrence rather than to the bare word: a form <select> is still called
    // a dropdown elsewhere in this registry, quite correctly.
    for (const entry of APP_UI_REGISTRY) {
      expect(text(entry), `${entry.id} describes course switching as a dropdown`).not.toMatch(
        /course[^.]*dropdown|dropdown[^.]*course/i
      );
    }
    expect(APP_UI_REGISTRY.some((e) => e.id === "course-switcher")).toBe(false);

    // The "where do I change the model?" answer names the gear and the settings
    // surface, so the question has a true answer at all.
    const settings = APP_UI_REGISTRY.find((e) => e.id === "settings-panel")!;
    expect(text(settings)).toMatch(/gear/i);
    expect(text(settings)).toMatch(/model/i);
  });

  // Scenario: Registry entries name the panels by their rendered labels
  it("names the two right-panel surfaces as the app renders them, never as Artifacts", () => {
    // The two surface names are PROPER NAMES: identical in every shipped
    // catalogue, and the retirement binds every language equally (capability
    // `desktop-app`, Requirement: *Every String the App Renders Is English*,
    // § Proper names are not translated).
    for (const code of Object.keys(LANGUAGES)) {
      const entries = resolvedIn(code);
      expect(entries.find((e) => e.id === "design-flow-canvas")!.label, code).toBe("CBE Process Canvas");
      expect(entries.find((e) => e.id === "maturity-panel")!.label, code).toBe("CBE Maturity");

      const all = entries.map((e) => `${e.area} ${e.label} ${e.description} ${e.howToUse}`).join("\n");
      // Artefact CARDS keep the word "artefact" — it is what they are. What is
      // retired is the surface NAME, so only the tab-name spellings are forbidden.
      expect(all, code).not.toMatch(/Artifacts tab|Artefacts tab|Artefakte/);
      expect(all, code).not.toMatch(/\bArtifacts\b(?! tab)/);
    }
  });

  it("gates the Maturity panel on the maturity affordance", () => {
    // The concrete entry the widened UI_AFFORDANCE_KEYS unblocked.
    expect(APP_UI_REGISTRY.find((e) => e.id === "maturity-panel")?.affordance).toBe("maturity");
  });

  // Scenario: A surface with no producer stays undocumented. The Decisions
  // section renders, but nothing emits `didacticChecks` — the tools that would
  // are the still-open change `add-kompetenz-alignment-delegation-checks`. An
  // entry for it would send the lecturer to a container guaranteed to stay
  // empty, which is the same class of untrue help this registry exists to stop.
  // Delete this guard together with the change that gives the section content.
  it("does not document the Decisions section while nothing can fill it", () => {
    const decisions = resolvedIn("en").filter((e) => /decisions/i.test(e.id) || /decisions/i.test(e.label));
    expect(decisions.map((e) => e.id)).toEqual([]);
  });
});
