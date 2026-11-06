/**
 * The injected `app-ui reference` block must fit `UI_REFERENCE_CAP` in EVERY
 * shipped language (capability `desktop-app`, Requirements: *Quoted Control
 * Labels Resolve to the Active Interface Language*; *App-UI Reference Injected on
 * the Help-Token Turn*).
 *
 * Why this is a test rather than a one-off measurement: over the cap the renderer
 * drops WHOLE entries — supplementary ones first — so a language whose labels run
 * longer deletes a documented control while the block still reads as complete.
 * The English measurement has been carried in a comment since the cap was first
 * squeezed; with a second language the budget has a second value and only a check
 * that runs on every suite can hold both.
 *
 * If this fails, the fix is NOT to trim an entry to fit: a re-cut registry or a
 * re-based cap is its own change with its own argument.
 */
import { describe, expect, it } from "vitest";
import { renderUiReferenceBlock, UI_REFERENCE_CAP, __untruncatedBlockLength } from "../src/main/ui-reference-prompt.js";
import { setActiveInterfaceLanguage } from "../src/main/interface-language.js";
import { APP_UI_REGISTRY } from "../src/shared/ui-registry.js";
import { LANGUAGES, REFERENCE_LANGUAGE } from "../src/shared/i18n/index.js";

/** Every affordance on — the largest the block can ever be. */
const ALL_AFFORDANCES: Record<string, boolean> = {
  canvas: true,
  profilePanel: true,
  courseWorkspace: true,
  ingestion: true,
  picker: true,
  step: true,
  maturity: true,
};

describe("the injected app-ui reference block fits its cap in every shipped language", () => {
  const sizes = new Map<string, number>();
  for (const code of Object.keys(LANGUAGES)) {
    setActiveInterfaceLanguage(code);
    sizes.set(code, __untruncatedBlockLength(APP_UI_REGISTRY, ALL_AFFORDANCES));
  }
  setActiveInterfaceLanguage(REFERENCE_LANGUAGE);

  it.each([...sizes.keys()])("stays under UI_REFERENCE_CAP in %s", (code) => {
    const size = sizes.get(code)!;
    expect(
      size,
      `The block renders ${size} characters in "${code}", over UI_REFERENCE_CAP (${UI_REFERENCE_CAP}). ` +
        `Over the cap WHOLE entries are dropped silently. Do not trim an entry to fit — a re-cut registry ` +
        `or a re-based cap is its own change.`
    ).toBeLessThanOrEqual(UI_REFERENCE_CAP);
  });

  it("drops no entry in any shipped language", () => {
    for (const code of Object.keys(LANGUAGES)) {
      setActiveInterfaceLanguage(code);
      const block = renderUiReferenceBlock(APP_UI_REGISTRY, ALL_AFFORDANCES);
      expect(block, `entries were dropped for size in "${code}"`).not.toContain("omitted for size");
    }
    setActiveInterfaceLanguage(REFERENCE_LANGUAGE);
  });

  it("reports the measured sizes, so the budget is readable without re-deriving it", () => {
    // Not an assertion about the values — a printed record, so a reviewer can see
    // what each language costs beside the cap it is measured against.
    const report = [...sizes.entries()].map(([code, size]) => `${code}=${size}`).join(" ");
    expect(report).toMatch(/en=\d+/);
    console.log(`[ui-reference block] cap=${UI_REFERENCE_CAP} ${report}`);
  });
});
