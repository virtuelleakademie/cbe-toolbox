import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { openSync } from "fontkit";

export const DOCUMENTATION_FONT_SHA256 = "c3c7ca00b4538cc10906a5d4d921aab2369b2bee781168ef2ca695f3a5805760";

// Representative of the English/German capture text and app chrome: German,
// Western-European accents, punctuation, arrows, and symbols all need to come
// from the fixture font rather than a host fallback.
export const DOCUMENTATION_GLYPH_SAMPLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 " +
  "ÄÖÜäöüß ÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕØŒÙÚÛÝ àáâãåæçèéêëìíîïñòóôõøœùúûýÿ " +
  "€£¥§©®™°±×÷−–—…“”„‘’‚‹›«»•· ←↑→↓↔↻ ─ ✓⚠";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const uniqueCharacters = (text) => [...new Set([...text])];

export function missingGlyphs(fontPath, text = DOCUMENTATION_GLYPH_SAMPLE) {
  const font = openSync(fontPath);
  return uniqueCharacters(text).filter((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)));
}

export function assertDocumentationFontCoverage(fontPath, { expectedSha256 = DOCUMENTATION_FONT_SHA256 } = {}) {
  const bytes = readFileSync(fontPath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Documentation fixture font hash differs: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const missing = missingGlyphs(fontPath);
  if (missing.length > 0) {
    const labels = missing.map(
      (character) =>
        `${JSON.stringify(character)} (U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`
    );
    throw new Error(`Documentation fixture font lacks representative glyphs: ${labels.join(", ")}`);
  }
  return { sha256: actualSha256, glyphs: uniqueCharacters(DOCUMENTATION_GLYPH_SAMPLE).length };
}
