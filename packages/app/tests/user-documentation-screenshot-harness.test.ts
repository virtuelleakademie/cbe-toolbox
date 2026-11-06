import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertPngBytesMatch,
  captureCanonicalPng,
  captureScrollTarget,
} from "../../../scripts/user-documentation/electron-cdp.mjs";
import {
  assertBoundedMatrix,
  assertNoUnverifiedCitationResidue,
  VIEW_MATRIX,
} from "../../../scripts/user-documentation/screenshot-matrix.mjs";
import {
  assertDocumentationFontCoverage,
  DOCUMENTATION_FONT_SHA256,
  DOCUMENTATION_GLYPH_SAMPLE,
  missingGlyphs,
} from "../../../scripts/user-documentation/font-coverage.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureFont = path.join(repoRoot, "packages/app/tests/fixtures/user-documentation/fonts/DocumentationSans.woff2");

class FakeCdp {
  private captures: string[];

  constructor(captures: string[]) {
    this.captures = [...captures];
  }

  async send(method: string): Promise<unknown> {
    if (method === "Emulation.setDeviceMetricsOverride") return {};
    if (method === "Runtime.evaluate") {
      return { result: { value: { fonts: "loaded", width: 1440, height: 900, activeTag: "BODY" } } };
    }
    if (method === "Page.captureScreenshot") {
      const next = this.captures.shift();
      if (!next) throw new Error("fake capture queue exhausted");
      return { data: Buffer.from(next).toString("base64") };
    }
    throw new Error(`unexpected CDP method ${method}`);
  }
}

const viewport = { width: 1440, height: 900 };

describe("documentation screenshot fixture font", () => {
  it("covers the representative English/German glyph set without host fallback", () => {
    expect(DOCUMENTATION_GLYPH_SAMPLE).toContain("ÄÖÜäöüß");
    expect(DOCUMENTATION_GLYPH_SAMPLE).toContain("←↑→↓↔↻");
    expect(DOCUMENTATION_GLYPH_SAMPLE).toContain("€£¥§©®™°±×÷−–—…“”„‘’‚‹›«»•·");
    expect(missingGlyphs(fixtureFont)).toEqual([]);
    expect(assertDocumentationFontCoverage(fixtureFont)).toEqual({
      sha256: DOCUMENTATION_FONT_SHA256,
      glyphs: new Set([...DOCUMENTATION_GLYPH_SAMPLE]).size,
    });
  });

  it("rejects the previous KaTeX 0.16.47 fixture as a proven negative control", () => {
    const katexFont = path.join(repoRoot, "node_modules/katex/dist/fonts/KaTeX_SansSerif-Regular.woff2");
    const katexHash = crypto.createHash("sha256").update(readFileSync(katexFont)).digest("hex");
    expect(katexHash).toBe("68e8c73ef42afd3ccec58bf0fba302cce448938e7fc020a5e31f8a952eee1342");
    expect(missingGlyphs(katexFont)).toEqual(expect.arrayContaining(["Ä", "Ö", "Ü", "ä", "ö", "ü", "ß"]));
    expect(() =>
      assertDocumentationFontCoverage(katexFont, {
        expectedSha256: katexHash,
      })
    ).toThrow("lacks representative glyphs");
  });
});

describe("documentation screenshot content guard", () => {
  it("rejects a literal UNVERIFIED label or an unverified citation state", () => {
    expect(() =>
      assertNoUnverifiedCitationResidue({ visibleText: "Source UNVERIFIED", unverifiedCitationStates: 0 })
    ).toThrow("contains the literal UNVERIFIED");
    expect(() => assertNoUnverifiedCitationResidue({ visibleText: "Quelle", unverifiedCitationStates: 1 })).toThrow(
      "contains 1 citation(s) in an unverified state"
    );
    expect(assertNoUnverifiedCitationResidue({ visibleText: "Verified source", unverifiedCitationStates: 0 })).toBe(
      true
    );
  });
});

describe("documentation screenshot scroll contracts", () => {
  it("pins the background chat for views whose subject sits above it", () => {
    expect(captureScrollTarget("language-selector")).toBe(0);
    expect(captureScrollTarget("model-settings")).toBe(0);
    expect(captureScrollTarget("workspace-orientation")).toBeNull();
    expect(captureScrollTarget("profile")).toBeNull();
  });
});

describe("documentation screenshot highlight declarations", () => {
  it("rejects a highlight for an undeclared state or an empty box", () => {
    const base = VIEW_MATRIX.map((view) => ({ ...view }));
    const withUnknownState = base.map((view) =>
      view.id === "profile" ? { ...view, highlights: { ...view.highlights, missing: [[".x"]] } } : view
    );
    expect(() => assertBoundedMatrix(withUnknownState)).toThrow("highlights undeclared state missing");
    const withEmptyBox = base.map((view) => (view.id === "profile" ? { ...view, highlights: { entry: [[]] } } : view));
    expect(() => assertBoundedMatrix(withEmptyBox)).toThrow("declares an empty highlight box");
    expect(assertBoundedMatrix(base)).toBe(true);
  });
});

describe("documentation screenshot paint fence", () => {
  it("discards each cold screenshot and returns two byte-identical canonical captures", async () => {
    const cdp = new FakeCdp(["cold-first-paint", "canonical", "cold-second-paint", "canonical"]);
    const stages: string[] = [];

    const first = await captureCanonicalPng(cdp, viewport, {
      onStage: (stage: string, bytes: Buffer) => stages.push(`${stage}:${bytes.toString()}`),
    });
    const second = await captureCanonicalPng(cdp, viewport, {
      onStage: (stage: string, bytes: Buffer) => stages.push(`${stage}:${bytes.toString()}`),
    });

    expect(first.toString()).toBe("canonical");
    expect(second.toString()).toBe("canonical");
    expect(stages).toEqual([
      "warmup:cold-first-paint",
      "canonical:canonical",
      "warmup:cold-second-paint",
      "canonical:canonical",
    ]);
    expect(assertPngBytesMatch(first, second)).toBe(true);
  });

  it("still rejects two different canonical byte streams after warm-up", async () => {
    const cdp = new FakeCdp(["cold-first-paint", "canonical-a", "cold-second-paint", "canonical-b"]);
    const first = await captureCanonicalPng(cdp, viewport);
    const second = await captureCanonicalPng(cdp, viewport);

    expect(() => assertPngBytesMatch(first, second, "negative fixture")).toThrow(
      "negative fixture captures are not byte-identical"
    );
  });

  it("keeps the focused screenshot command on strict recapture and byte comparison", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const capture = readFileSync(path.join(repoRoot, "scripts/user-documentation/capture-screenshots.mjs"), "utf8");
    const checkPath = capture.slice(capture.indexOf("const committed = JSON.parse"));

    expect(pkg.scripts["docs:screenshots:check"]).toBe(
      "node scripts/user-documentation/capture-screenshots.mjs --check"
    );
    expect(checkPath).toMatch(/readFile\(path\.join\(temporary,[\s\S]*readFile\(path\.join\(docsRoot/);
    expect(checkPath).toContain(
      "if (!fresh.equals(expected)) throw new Error(`Screenshot bytes differ: ${asset.path}`)"
    );
    expect(checkPath).not.toMatch(/existsSync|file exists|hash-only/i);
  });
});
