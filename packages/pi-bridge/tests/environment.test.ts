import { describe, it, expect } from "vitest";
import { UI_AFFORDANCE_KEYS } from "@cbe/corpus-schema";
import { buildEnvironmentDescriptor } from "../src/environment.js";

// ui-reference-generation spec, Requirement: UI Element Registry — Scenario:
// Every descriptor affordance key is declarable. This is the only package that
// can see both sides (corpus-schema owns the registry, pi-bridge the
// descriptor), so the parity assertion lives here. Drift in either direction is
// a defect: an extra registry key gates on something the descriptor never
// reports, a missing one makes a real control undocumentable.
describe("UI registry affordance keys mirror the environment descriptor", () => {
  it("declares exactly the descriptor's affordance keys", () => {
    const descriptorKeys = Object.keys(buildEnvironmentDescriptor({ profile: "app" }).affordances).sort();
    expect([...UI_AFFORDANCE_KEYS].sort()).toEqual(descriptorKeys);
  });
});

describe("buildEnvironmentDescriptor", () => {
  it("returns the app profile with all phase-1 affordances on", () => {
    const env = buildEnvironmentDescriptor({ profile: "app" });
    expect(env.profile).toBe("app");
    expect(env.affordances.canvas).toBe(true);
    expect(env.affordances.picker).toBe(true); // Phase 2 generative UI
    expect(env.affordances.step).toBe(true); // Design-Flow Canvas step-coverage tool (cbe_step)
    expect(env.affordances.ingestion).toBe(true); // Phase 2 — stub (Task 3.3) freigeschaltet
    // Scenario (desktop-app, Profile Panel): Profile-panel affordance is reported
    expect(env.affordances.profilePanel).toBe(true); // shipped with add-lecturer-profile-panel
    expect(env.affordances.courseWorkspace).toBe(true); // shipped with add-lecturer-wiki-and-course-workspace
  });

  it("returns the headless profile with no UI affordances", () => {
    const env = buildEnvironmentDescriptor({ profile: "headless" });
    expect(env.profile).toBe("headless");
    expect(env.affordances.canvas).toBe(false);
    expect(env.affordances.picker).toBe(false); // CLI cannot render React picker
    expect(env.affordances.step).toBe(false); // no canvas headers to feed in headless
    expect(env.affordances.profilePanel).toBe(false); // no panel without the app shell
  });

  // Scenario (agent-harness, cbe_step Generative-UI Tool): Descriptor exposes the step
  // affordance per tool convention.
  it("Descriptor exposes the step affordance per tool convention", () => {
    const app = buildEnvironmentDescriptor({ profile: "app" });
    const headless = buildEnvironmentDescriptor({ profile: "headless" });
    expect(app.affordances.step).toBe(true);
    expect(headless.affordances.step).toBe(false);
    // The affordance is rendered as its own boolean key in the descriptor block.
    expect(app.toSystemPromptBlock()).toContain("step: true");
    expect(headless.toSystemPromptBlock()).toContain("step: false");
  });

  // Scenario (agent-harness, cbe_step Generative-UI Tool): Eval harness can enable the
  // step affordance headless — the override enables `step` for one run without changing
  // the headless default.
  it("Eval harness can enable the step affordance headless", () => {
    const overridden = buildEnvironmentDescriptor({ profile: "headless", affordances: { step: true } });
    const plain = buildEnvironmentDescriptor({ profile: "headless" });
    expect(overridden.affordances.step).toBe(true); // override enables it for this run
    expect(plain.affordances.step).toBe(false); // default unchanged
  });

  it("formats as a system-prompt-ready block", () => {
    const env = buildEnvironmentDescriptor({ profile: "app" });
    const s = env.toSystemPromptBlock();
    expect(s).toContain("ENVIRONMENT DESCRIPTOR");
    expect(s).toContain("profile: app");
    expect(s).toContain("canvas: true");
  });

  it("surfaces workspace and corpus paths near the top of the block", () => {
    const env = buildEnvironmentDescriptor({
      profile: "app",
      paths: { workspace: "/u/work", corpus: "/u/corpus" },
    });
    const s = env.toSystemPromptBlock();
    expect(s).toContain("paths:");
    expect(s).toContain("workspace: /u/work");
    expect(s).toContain("corpus:    /u/corpus");
    // The paths block must appear BEFORE the affordances block so the model
    // sees it first when scanning the descriptor.
    expect(s.indexOf("paths:")).toBeLessThan(s.indexOf("affordances:"));
  });

  it("marks an absent wiki path explicitly as not yet provisioned", () => {
    const env = buildEnvironmentDescriptor({
      profile: "app",
      paths: { workspace: "/u/work", corpus: "/u/corpus" },
    });
    const s = env.toSystemPromptBlock();
    expect(s).toContain("wiki:");
    expect(s).toContain("not yet provisioned");
  });

  it("carries no mode line and no modeSelector affordance (mode channel retired)", () => {
    // REMOVED requirement: Active operation mode in the environment descriptor
    // (change internalize-operation-modes). The descriptor block must carry
    // neither a mode line nor a modeSelector affordance key.
    const env = buildEnvironmentDescriptor({ profile: "app" });
    const s = env.toSystemPromptBlock();
    expect(s).not.toMatch(/^mode:/m);
    expect(s).not.toContain("modeSelector");
    expect("modeSelector" in env.affordances).toBe(false);
    const headless = buildEnvironmentDescriptor({ profile: "headless" });
    expect(headless.toSystemPromptBlock()).not.toMatch(/^mode:/m);
  });

  it("injects the course.md content as a course-context block and tells the model not to re-elicit it", () => {
    const courseMd = [
      "---",
      'title: "Datenbanken HS26"',
      'discipline: "Informatik"',
      "learning-objectives:",
      "  - SQL-Abfragen formulieren",
      "---",
      "",
      "Free-form course notes.",
    ].join("\n");
    const env = buildEnvironmentDescriptor({ profile: "app", courseContext: courseMd });
    expect(env.courseContext).toBe(courseMd);
    const s = env.toSystemPromptBlock();
    expect(s).toContain("course-context");
    expect(s).toContain('title: "Datenbanken HS26"');
    expect(s).toContain("SQL-Abfragen formulieren");
    expect(s).toContain("Free-form course notes.");
    expect(s).toMatch(/do not re-elicit/i);
  });

  it("renders no course-context block when the host loaded none", () => {
    const withNone = buildEnvironmentDescriptor({ profile: "app" }).toSystemPromptBlock();
    const withEmpty = buildEnvironmentDescriptor({ profile: "app", courseContext: "   \n" }).toSystemPromptBlock();
    expect(withNone).not.toContain("course-context");
    // Whitespace-only context is treated as absent — byte-identical descriptor.
    expect(withEmpty).toBe(withNone);
  });

  // course-workspace, Requirement: Lecturer-State as Global Profile plus Per-Course Overlay
  describe("lecturer-state layers", () => {
    const layers = {
      globalPath: "/space/lecturer-profile.md",
      globalContent: "CBE fluency: high — has run two CBL modules.",
      overlayPath: "/space/courses/datenbanken/lecturer-state.md",
      overlayContent: "Familiar with the SQL exercise pool.",
    };

    // Scenario: Both layers are read and composed at session start
    it("composes both layers into the descriptor with the overlay refining the global picture", () => {
      const s = buildEnvironmentDescriptor({ profile: "app", lecturerState: layers }).toSystemPromptBlock();
      expect(s).toContain("lecturer-state layers");
      expect(s).toContain("/space/lecturer-profile.md");
      expect(s).toContain("/space/courses/datenbanken/lecturer-state.md");
      expect(s).toContain("CBE fluency: high — has run two CBL modules.");
      expect(s).toContain("Familiar with the SQL exercise pool.");
      expect(s).toMatch(/overlay refines the global picture/i);
      expect(s).toMatch(/do not re-elicit familiarity/i);
    });

    // Scenario: Revisions are persisted to the correct layer (the deterministic
    // harness half: the descriptor names both absolute paths and instructs the
    // layer routing; the behavioural half is covered by the skill eval).
    it("instructs the model to persist revisions to the correct layer", () => {
      const s = buildEnvironmentDescriptor({ profile: "app", lecturerState: layers }).toSystemPromptBlock();
      expect(s).toMatch(/cross-course CBE fluency and[\s\S]*scaffolding-fade revisions go to the global profile/i);
      expect(s).toMatch(/material, discipline, or cohort goes to the[\s#]*course overlay/i);
    });

    // Scenario: Global fade carries across courses, overlay stays scoped
    it("marks an empty overlay explicitly while still carrying the global profile", () => {
      const s = buildEnvironmentDescriptor({
        profile: "app",
        lecturerState: { ...layers, overlayContent: "" },
      }).toSystemPromptBlock();
      expect(s).toContain("CBE fluency: high — has run two CBL modules.");
      expect(s).toContain("(empty — nothing recorded yet)");
      expect(s).toMatch(/empty overlay means no[\s#]*course-specific familiarity is assumed/i);
    });

    // Scenario: Lecturer inspects and overrides persisted state
    it("declares both files lecturer-editable with manual edits winning", () => {
      const s = buildEnvironmentDescriptor({ profile: "app", lecturerState: layers }).toSystemPromptBlock();
      expect(s).toMatch(/inspect and override/i);
      expect(s).toMatch(/manual edit wins/i);
    });

    it("renders no lecturer-state block when the host loaded no layers", () => {
      const s = buildEnvironmentDescriptor({ profile: "app" }).toSystemPromptBlock();
      expect(s).not.toContain("lecturer-state layers");
    });
  });
});
