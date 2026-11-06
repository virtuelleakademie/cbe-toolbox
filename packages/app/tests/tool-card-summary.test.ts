/**
 * Tests for the ToolCard argument summary — specifically that a `cbe_cite` row
 * summarises the CITED SOURCE (id, section, author/year) rather than the generic
 * parameter-name fallback, so rows of one turn are distinguishable from one
 * another.
 *
 * The summary's only surface is the deliberately opened current-turn detail
 * (capability `desktop-app`, Requirement: Agent Activity Visibility in the
 * Renderer, § the opened technical panel); the former durable citation and
 * profile card requirements were removed with `separate-chat-from-tool-diagnostics`.
 */
import { describe, it, expect } from "vitest";
import { summariseArgs } from "../src/renderer/components/ToolCard.js";

const id = (p: string): string => p; // no path shortening needed for these cases

describe("summariseArgs — cbe_cite shows the cited source", () => {
  // Scenario: cbe_cite card summarises the cited source, not parameter names
  it("renders corpus:id § section with author and year", () => {
    expect(
      summariseArgs(
        "cbe_cite",
        { id: "vocabulary-001", section: "Durable Skills", author: "Nichols et al.", year: 2016 },
        id
      )
    ).toBe("corpus:vocabulary-001 § Durable Skills, Nichols et al. 2016");
  });

  it("omits the author/year tail when neither is supplied", () => {
    expect(summariseArgs("cbe_cite", { id: "foundations-001", section: "What CBL Adds to the Tradition" }, id)).toBe(
      "corpus:foundations-001 § What CBL Adds to the Tradition"
    );
  });

  it("never falls back to the parameter-name list for cbe_cite", () => {
    const out = summariseArgs("cbe_cite", { author: "X", id: "y-1", section: "Z" }, id);
    expect(out).not.toBe("author, id, section");
    expect(out).toContain("corpus:y-1");
  });

  // change `cite-the-lecturers-wiki`: the store rides on the id, so a `wiki:`-prefixed
  // id is the lecturer's own material and must not be labelled (or double-prefixed) as
  // corpus.
  it("labels a wiki atom by its own scheme rather than prefixing corpus:", () => {
    expect(
      summariseArgs(
        "cbe_cite",
        { id: "wiki:concept/cognitive-load", section: "Working memory", author: "Sweller", year: 1988 },
        id
      )
    ).toBe("wiki:concept/cognitive-load § Working memory, Sweller 1988");
  });

  it("keeps the corpus prefix for a bare id", () => {
    expect(summariseArgs("cbe_cite", { id: "methodology-002", section: "Load" }, id)).toBe(
      "corpus:methodology-002 § Load"
    );
  });

  it("produces distinct summaries for distinct sources (cards do not all look the same)", () => {
    const a = summariseArgs("cbe_cite", { id: "vocabulary-001", section: "Durable Skills" }, id);
    const b = summariseArgs("cbe_cite", { id: "foundations-002", section: "Learner Inspired", year: 2018 }, id);
    expect(a).not.toBe(b);
  });
});

describe("summariseArgs — cbe_profile shows the actual update", () => {
  // The profile row names the concrete update rather than the parameter names,
  // inside the opened current-turn detail (see the file header for the owner).
  it("renders dimension → value · confidence instead of parameter names", () => {
    expect(
      summariseArgs(
        "cbe_profile",
        {
          dimension: "didactic-stance",
          value: "instructor",
          confidence: "high",
          evidence: "turn 2: stated preference",
        },
        id
      )
    ).toBe("didactic-stance → instructor · high");
  });

  it("never falls back to the parameter-name list for cbe_profile", () => {
    const out = summariseArgs("cbe_profile", { dimension: "capacity", value: "limited", confidence: "medium" }, id);
    expect(out).not.toBe("dimension, value, confidence");
    expect(out).toBe("capacity → limited · medium");
  });

  it("degrades gracefully when fields are missing", () => {
    expect(summariseArgs("cbe_profile", { dimension: "attitude" }, id)).toBe("attitude");
    expect(summariseArgs("cbe_profile", {}, id)).toBe("cbe_profile");
  });
});

describe("summariseArgs — other tools keep their existing summaries", () => {
  it("a read still shows its (shortened) path", () => {
    expect(summariseArgs("read", { path: "corpus/dev/x.md" }, (p) => p.replace("corpus/dev/", "…/"))).toBe("…/x.md");
  });

  it("a grep still shows its pattern", () => {
    expect(summariseArgs("grep", { pattern: "Big Idea" }, id)).toBe("/Big Idea/");
  });
});
