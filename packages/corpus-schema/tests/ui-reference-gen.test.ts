import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  UI_REFERENCE_REGEN_COMMAND,
  collectUiRegistryEntries,
  generateUiReference,
  renderUiReference,
} from "../src/ui-reference-gen.js";

// ui-reference-generation spec, Requirement: Generated UI Reference Artifact.

const FIXTURE_ROOT = resolve(__dirname, "fixtures-ui-registry");
/** The fixture's own catalogue: an entry's label is a catalogue KEY, so the
 * generator needs one to resolve against. Passed explicitly rather than derived
 * from the registry root, because this fixture tree is not an app. */
const FIXTURE_CATALOGUE = resolve(__dirname, "fixtures-ui-catalogue", "en.ts");

describe("ui-reference generator", () => {
  // Scenario: Generator produces the committed reference file
  it("produces the reference file from registry entries", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "ui-ref-")), "ui-guide.md");
    const res = await generateUiReference(FIXTURE_ROOT, out, FIXTURE_CATALOGUE);
    expect(res.entryCount).toBe(2);
    expect(res.fileCount).toBe(1);
    const body = await readFile(out, "utf8");
    expect(body).toContain("## Fixture area");
    expect(body).toContain("### Sample button (`sample-button`)");
    expect(body).toContain("**How to use.** Click the sample button.");
    // Affordance-gated entry carries its availability line; ungated does not.
    expect(body).toContain(
      "**Availability:** only when the session's environment descriptor reports the `profilePanel` affordance as `true`."
    );
    const sampleSection = body.slice(body.indexOf("### Sample button"), body.indexOf("### Gated panel"));
    expect(sampleSection).not.toContain("**Availability:**");
  });

  // Scenario: Generated file is marked as generated
  it("marks the file as generated and names the regenerating command", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "ui-ref-")), "ui-guide.md");
    await generateUiReference(FIXTURE_ROOT, out, FIXTURE_CATALOGUE);
    const body = await readFile(out, "utf8");
    expect(body).toMatch(/GENERATED FILE — DO NOT HAND-EDIT/);
    expect(UI_REFERENCE_REGEN_COMMAND).toBe("npm run ui:reference");
    expect(body).toContain(`\`${UI_REFERENCE_REGEN_COMMAND}\``);
  });

  // Scenario: Empty registry produces a valid, empty reference
  it("produces a valid, entry-less reference from an empty registry", async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), "ui-ref-empty-src-"));
    const out = join(await mkdtemp(join(tmpdir(), "ui-ref-empty-")), "ui-guide.md");
    const res = await generateUiReference(emptyRoot, out, FIXTURE_CATALOGUE);
    expect(res.entryCount).toBe(0);
    const body = await readFile(out, "utf8");
    expect(body).toMatch(/GENERATED FILE — DO NOT HAND-EDIT/);
    expect(body).toContain("No controls are documented yet");
    expect(body).not.toContain("### ");
  });

  it("collects entries in deterministic (area, id) order", async () => {
    const { entries } = await collectUiRegistryEntries(FIXTURE_ROOT);
    expect(entries.map((e) => e.id)).toEqual(["gated-panel", "sample-button"]);
    // Rendering is a pure function of the sorted list — same input, same bytes.
    expect(renderUiReference(entries)).toBe(renderUiReference(entries));
  });
});
