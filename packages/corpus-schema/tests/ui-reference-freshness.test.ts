import { describe, it, expect } from "vitest";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UI_REFERENCE_REGEN_COMMAND, generateUiReference } from "../src/ui-reference-gen.js";

// ui-reference-generation spec, Requirement: UI Reference Freshness Check.
// The committed `skills/cbe/references/ui-guide.md` must byte-match a fresh
// regeneration from the current registry — a registry change without a
// matching `npm run ui:reference` run fails here instead of silently
// shipping a stale reference.

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const REGISTRY_ROOT = join(REPO_ROOT, "packages", "app", "src", "renderer");
const COMMITTED_GUIDE = join(REPO_ROOT, "skills", "cbe", "references", "ui-guide.md");
/** The REFERENCE-language catalogue the committed guide resolves its labels
 * against. Named explicitly here because the stale-copy case below regenerates
 * from a COPY of the registry, which carries no catalogue beside it. */
const CATALOGUE = join(REPO_ROOT, "packages", "app", "src", "shared", "i18n", "en.ts");

describe("ui-guide.md freshness check", () => {
  // Scenario: Regenerated file passes the freshness check. This is the live
  // gate: it regenerates from the real registry into a temp path and diffs
  // against the committed file.
  it("committed ui-guide.md matches a fresh regeneration from the current registry", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "ui-guide-fresh-")), "ui-guide.md");
    await generateUiReference(REGISTRY_ROOT, out, CATALOGUE);
    const regenerated = await readFile(out, "utf8");
    const committed = await readFile(COMMITTED_GUIDE, "utf8");
    expect(
      committed,
      `skills/cbe/references/ui-guide.md is stale relative to the UI element registry — run \`${UI_REFERENCE_REGEN_COMMAND}\` and commit the result`
    ).toBe(regenerated);
  });

  // Scenario: Stale generated file fails the test suite. Demonstrated on a
  // copy: a registry edit without regeneration produces different bytes than
  // the committed file, which is exactly what makes the gate above fail.
  it("a registry change without regeneration produces a mismatch against the committed file", async () => {
    const editedRegistry = await mkdtemp(join(tmpdir(), "ui-guide-stale-reg-"));
    await cp(REGISTRY_ROOT, editedRegistry, {
      recursive: true,
      filter: (src) => !/\/(node_modules|dist|out)(\/|$)/.test(src),
    });
    await writeFile(
      join(editedRegistry, "components", "Extra.ui-registry.ts"),
      [
        `import type { UiElementRegistryEntry } from "../../../../corpus-schema/src/ui-registry.js";`,
        "",
        "export const extraUiRegistry: UiElementRegistryEntry[] = [",
        "  {",
        `    id: "extra-control",`,
        `    area: "Fixture area",`,
        `    label: "chatSendLabel",`,
        `    description: "A control added without regenerating the guide.",`,
        `    howToUse: "Click it.",`,
        "  },",
        "];",
        "",
      ].join("\n"),
      "utf8"
    );
    const out = join(await mkdtemp(join(tmpdir(), "ui-guide-stale-")), "ui-guide.md");
    await generateUiReference(editedRegistry, out, CATALOGUE);
    const regenerated = await readFile(out, "utf8");
    const committed = await readFile(COMMITTED_GUIDE, "utf8");
    expect(regenerated).toContain("extra-control");
    expect(regenerated).not.toBe(committed);
  });
});
