/**
 * A fixture chrome-string catalogue for the generator tests.
 *
 * The generator resolves an entry's `label` and its `{{key}}` prose placeholders
 * against a catalogue (capability `ui-reference-generation`, Requirement:
 * *Generated UI Reference Artifact*). These tests are about the GENERATOR, not
 * about the app's copy, so they carry their own catalogue rather than reaching
 * into `packages/app` — which also keeps this package free of a dependency on the
 * desktop shell, exactly as the entry type is.
 */
export const fixtureCatalogue = {
  sampleButtonLabel: "Sample button",
  gatedPanelLabel: "Gated panel",
  extraControlLabel: "Extra control",
};
