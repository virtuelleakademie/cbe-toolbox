import type { UiElementRegistryEntry } from "../../src/ui-registry.js";

/** Fixture registry for the ui-reference generator tests. */
export const sampleUiRegistry: UiElementRegistryEntry[] = [
  {
    id: "sample-button",
    area: "Fixture area",
    label: "sampleButtonLabel",
    description: "A documented fixture control.",
    howToUse: "Click the sample button.",
  },
  {
    id: "gated-panel",
    area: "Fixture area",
    label: "gatedPanelLabel",
    description: "A fixture panel gated behind the profilePanel affordance.",
    howToUse: "Open the gated panel from the fixture area.",
    affordance: "profilePanel",
  },
];
