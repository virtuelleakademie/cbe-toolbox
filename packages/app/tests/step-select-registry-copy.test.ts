import { describe, it, expect } from "vitest";
import { artifactsPanelUiRegistry } from "../src/renderer/components/ArtifactsPanel.ui-registry.js";

// Guards the lecturer-facing copy for the step-select affordance against the two
// claims the archived `host-sets-step-focus-from-canvas-click` made false. That
// change turned the click from a chat dispatch into a HOST action: it sets the
// focus in `StepMirror` directly, appends no user turn, and — because nothing is
// dispatched — is deliberately NOT bound to the run lock
// (`ArtifactsPanel.tsx`, the `step-select` button; agent-harness, Requirement:
// Host-Set Step Focus from the Canvas UI).
//
// The registry text outlived that change by four days and shipped both retired
// claims to lecturers AND to the model, since `npm run ui:reference` renders this
// same string into `skills/cbe/references/ui-guide.md`. A stale sentence here is
// therefore help that is actively wrong, which is the exact defect the whole UI
// reference exists to prevent — hence a test rather than a careful edit.

const stepSelectEntry = () => {
  const entry = artifactsPanelUiRegistry.find((e) => e.id === "design-flow-canvas");
  if (!entry) throw new Error("registry entry `design-flow-canvas` is missing");
  return entry;
};

describe("step-select affordance copy in the canvas UI registry", () => {
  it("does not claim the step click steers or sends anything to the conversation", () => {
    const howToUse = stepSelectEntry().howToUse;
    expect(howToUse).not.toMatch(/steer the conversation/i);
    expect(howToUse).toMatch(/nothing is added to the conversation/i);
  });

  it("does not claim the affordance is locked while the assistant is working", () => {
    const howToUse = stepSelectEntry().howToUse;
    expect(howToUse).not.toMatch(/locked while the assistant/i);
    expect(howToUse).toMatch(/stays available while the assistant is working/i);
  });

  it("still describes the affordance the panel actually renders", () => {
    const howToUse = stepSelectEntry().howToUse;
    // The arrow button itself was not removed by that change — only its wiring.
    expect(howToUse).toContain("→");
    expect(howToUse).toMatch(/focus/i);
  });
});
