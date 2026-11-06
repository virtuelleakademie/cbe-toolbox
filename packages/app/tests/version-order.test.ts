import { describe, it, expect } from "vitest";
import { compareLexicalVersions, compareSemverVersions } from "../src/main/version-order";

// Distribution spec, Requirements: Corpus Distribution as Downloadable Bundle
// / Skill Distribution as Versioned Bundle — a bundle is adopted only when the
// pointer advertises a version NEWER than the local state, which needs an
// ordering rather than an inequality.

describe("compareLexicalVersions (corpus date-style versions)", () => {
  it("orders zero-padded date versions chronologically", () => {
    expect(compareLexicalVersions("2026-08", "2026-07")).toBeGreaterThan(0);
    expect(compareLexicalVersions("2026-07", "2026-08")).toBeLessThan(0);
    expect(compareLexicalVersions("2026-10", "2026-09")).toBeGreaterThan(0);
    expect(compareLexicalVersions("2027-01", "2026-12")).toBeGreaterThan(0);
  });

  it("reports equal versions as equal", () => {
    expect(compareLexicalVersions("2026-07", "2026-07")).toBe(0);
  });
});

describe("compareSemverVersions (skill versions)", () => {
  it("orders by numeric precedence, not lexically", () => {
    expect(compareSemverVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareSemverVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.3.0", "0.3.0")).toBe(0);
  });

  it("ranks a pre-release below the release of the same core version", () => {
    expect(compareSemverVersions("0.4.0-rc.1", "0.4.0")).toBeLessThan(0);
    expect(compareSemverVersions("0.4.0", "0.4.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.4.0-rc.2", "0.4.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.4.0-alpha", "0.4.0-beta")).toBeLessThan(0);
    expect(compareSemverVersions("0.4.0-rc.1", "0.4.0-rc.1")).toBe(0);
  });

  it("ignores build metadata and an optional leading v", () => {
    expect(compareSemverVersions("0.4.0+build.7", "0.4.0")).toBe(0);
    expect(compareSemverVersions("v0.4.0", "0.3.0")).toBeGreaterThan(0);
  });

  it("falls back to a lexical ordering for an unparseable version, never to 'newer'", () => {
    // Whatever the fallback decides, it stays a total order: a version can be
    // adopted in one direction only, so garbage cannot cause a downgrade.
    expect(compareSemverVersions("not-a-version", "0.3.0")).toBeGreaterThan(0);
    expect(compareSemverVersions("0.3.0", "not-a-version")).toBeLessThan(0);
    expect(compareSemverVersions("not-a-version", "not-a-version")).toBe(0);
  });
});
