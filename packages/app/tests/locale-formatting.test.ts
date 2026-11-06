/**
 * Number and date formatting follows the interface language (capability
 * `desktop-app`, Requirement: *Locale-Dependent Formatting Follows the Interface
 * Language*).
 *
 * The load-bearing assertion is the LAST one: choosing English must leave every
 * formatted figure byte-identical to what the app rendered before the setting
 * existed. That is what makes the change invisible to a lecturer who stays in
 * English, and it is checked against the two sources this change replaced — the
 * ring's `NUMBER_LOCALE = "en-US"` constant and the ambient system locale the two
 * date surfaces used to read.
 */
import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  REFERENCE_LANGUAGE,
  formatDateTime,
  formatNumber,
  formatTimestamp,
} from "../src/shared/i18n/index.js";

/** The tag the ring's module constant named before this change. */
const RING_NUMBER_LOCALE = "en-US";
/** The options the course-detail conversation stamps already used. */
const STAMP_OPTIONS = { dateStyle: "medium", timeStyle: "short" } as const;
const SAMPLE = new Date("2026-08-25T14:07:00Z");

describe("every shipped language declares its own formatting tag", () => {
  it("formats a number by the active catalogue's tag, not by the host's default", () => {
    // Scenario: The context ring's figures follow the interface language — the two
    // readings differ in separator, not in value.
    expect(formatNumber("en", 41000)).toBe((41000).toLocaleString("en-US"));
    expect(formatNumber("de", 41000)).toBe((41000).toLocaleString("de"));
    expect(formatNumber("en", 41000)).not.toBe(formatNumber("de", 41000));
    // Same VALUE, different presentation — the separator moves, the number does not.
    expect(formatNumber("de", 41000).replace(/\D/g, "")).toBe("41000");
  });

  it("formats a date by the active catalogue's tag", () => {
    // Scenarios: Conversation timestamps follow the interface language, not the
    // system locale; The corpus cache date follows the interface language.
    expect(formatDateTime("de", SAMPLE)).toBe(SAMPLE.toLocaleString("de", STAMP_OPTIONS));
    expect(formatTimestamp("de", SAMPLE)).toBe(SAMPLE.toLocaleString("de"));
    expect(formatDateTime("de", SAMPLE)).not.toBe(formatDateTime("en", SAMPLE));
  });

  it("declares a plain language tag for German, and states why in the catalogue", () => {
    // A REGIONAL tag is chosen only deliberately: the governing rule is that a
    // figure agrees with the sentence around it, not that it matches a country's
    // convention, and this app has no basis for choosing a region for a lecturer.
    expect(LANGUAGES.de!.formattingLocale).toBe("de");
    expect(LANGUAGES.de!.formattingLocale).not.toBe("de-CH");
  });
});

describe("choosing English changes no formatted figure at all", () => {
  // Scenario: Choosing English leaves today's formatting unchanged.
  it("groups numbers exactly as the ring's retired module constant did", () => {
    for (const value of [0, 7, 1000, 41000, 128000, 1234567]) {
      expect(formatNumber(REFERENCE_LANGUAGE, value)).toBe(value.toLocaleString(RING_NUMBER_LOCALE));
    }
    expect(formatNumber(REFERENCE_LANGUAGE, 41000)).toBe("41,000");
    // The Swiss grouping the repo removed on purpose stays removed.
    expect(formatNumber(REFERENCE_LANGUAGE, 41000)).not.toContain("'");
    expect(formatNumber(REFERENCE_LANGUAGE, 41000)).not.toContain("’");
  });

  it("formats both date surfaces exactly as the ambient-locale call did", () => {
    // The two surfaces read `toLocaleString(undefined, …)` before this change. In
    // the test environment the ambient locale IS en-US, so this pins the English
    // reading to the very call it replaced — the comparison a lecturer staying in
    // English would make.
    expect(formatDateTime(REFERENCE_LANGUAGE, SAMPLE)).toBe(SAMPLE.toLocaleString(undefined, STAMP_OPTIONS));
    expect(formatTimestamp(REFERENCE_LANGUAGE, SAMPLE)).toBe(SAMPLE.toLocaleString());
  });
});

describe("no component names a locale of its own", () => {
  it("routes every formatted figure through the catalogue's declared tag", async () => {
    // The rule the requirement states as "no component may name a locale literal".
    // A source sweep is the only thing that can see it: a hardcoded "en-US" is a
    // string like any other.
    const { readCode, repoPath, sourceFiles } = await import("./helpers/source-scan.js");
    const LOCALE_LITERAL = /toLocale\w*\(\s*("[a-z]{2}(-[A-Z]{2})?"|'[a-z]{2}(-[A-Z]{2})?')/;
    const offenders: string[] = [];
    for (const file of sourceFiles(["packages/app/src/renderer", "packages/app/src/main"], /\.(ts|tsx)$/)) {
      readCode(file)
        .split("\n")
        .forEach((line, i) => {
          if (LOCALE_LITERAL.test(line)) offenders.push(`${repoPath(file)}:${i + 1} — ${line.trim().slice(0, 90)}`);
        });
    }
    expect(
      offenders,
      "a component names a locale literal; format through `formatNumber`/`formatDateTime` instead, " +
        "which read the active catalogue's declared tag"
    ).toEqual([]);
  });
});
