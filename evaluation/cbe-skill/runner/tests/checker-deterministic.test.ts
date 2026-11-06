import { describe, it, expect } from "vitest";
import { checkDeterministic } from "../src/checker-deterministic.js";
import type { Checkpoint, Probe, Transcript } from "../src/types.js";

const CORPUS = new Set(["vocabulary-001", "foundations-005", "methodology-001"]);

function tx(assistant: string, tools: string[] = []): Transcript {
  return { probe: "p", model: "m", turns: [{ user: "u", assistant, tools: tools.map((name) => ({ name })) }] };
}
function probe(setup: Partial<Probe["setup"]> = {}, turns = ["t"]): Probe {
  return { probe: "p", scenarioFile: "f.md", setup: { profile: "app", ...setup }, turns, checkpoints: [] };
}
// Bare canonical token (change `version-corpus-replace-dev-track`): author/year
// form for a document WITH sources[], no suffix or status marker.
const CANON = (id: string) => `(corpus:${id} § Phase 1: Engage, Nichols et al. 2016)`;
// Source-less bare form: a document without sources[] (methodology-002…006) is
// cited without the author/year element — still a fully canonical token.
const SOURCELESS = (id: string) => `(corpus:${id} § Mis-alignment-pattern catalogue)`;

describe("deterministic checker", () => {
  // spec: Required corpus ids missing fails a cite_all checkpoint
  it("cite_all fails and names the missing id when a required corpus id is absent", () => {
    const cp: Checkpoint = {
      id: "c1",
      type: "deterministic",
      check: { kind: "cite_all", ids: ["vocabulary-001", "foundations-005"] },
    };
    const r = checkDeterministic(cp, tx(`We rely on ${CANON("vocabulary-001")} here.`), probe(), CORPUS);
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("foundations-005");
  });

  it("cite_all passes when all required ids are cited canonically", () => {
    const cp: Checkpoint = {
      id: "c1",
      type: "deterministic",
      check: { kind: "cite_all", ids: ["vocabulary-001", "foundations-005"] },
    };
    const r = checkDeterministic(cp, tx(`${CANON("vocabulary-001")} and ${CANON("foundations-005")}`), probe(), CORPUS);
    expect(r.verdict).toBe("pass");
  });

  it("cite_all fails when an id is cited only in non-canonical short form", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "cite_all", ids: ["vocabulary-001"] } };
    const r = checkDeterministic(cp, tx("see (corpus:vocabulary-001)"), probe(), CORPUS);
    expect(r.verdict).toBe("fail");
  });

  it("cite_none_outside_corpus fails and names an id absent from the corpus", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "cite_none_outside_corpus" } };
    const r = checkDeterministic(
      cp,
      tx(`real ${CANON("vocabulary-001")} but also (corpus:ghost-999 § X, Y 2020)`),
      probe(),
      CORPUS
    );
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toContain("ghost-999");
  });

  // change `version-corpus-replace-dev-track`: a source-less document is cited
  // as a bare token without the author/year element — still fully canonical.
  it("cite_all recognises a source-less id cited via the bare token", () => {
    const corpus = new Set([...CORPUS, "methodology-003"]);
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "cite_all", ids: ["methodology-003"] } };
    const r = checkDeterministic(cp, tx(`see ${SOURCELESS("methodology-003")}`), probe(), corpus);
    expect(r.verdict).toBe("pass");
  });

  it("cite_none_outside_corpus passes for a source-less id present in the corpus", () => {
    const corpus = new Set([...CORPUS, "methodology-003"]);
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "cite_none_outside_corpus" } };
    const r = checkDeterministic(cp, tx(`${SOURCELESS("methodology-003")}`), probe(), corpus);
    expect(r.verdict).toBe("pass");
  });

  // spec: Picker-not-called checkpoint passes when no picker was emitted
  it("tool_not_called passes when no picker was emitted", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "tool_not_called", tool: "cbe_picker" } };
    const r = checkDeterministic(cp, tx("plain markdown bullets, no picker"), probe(), CORPUS);
    expect(r.verdict).toBe("pass");
  });

  it("tool_called passes when the tool was invoked", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "tool_called", tool: "cbe_picker" } };
    const r = checkDeterministic(cp, tx("asking", ["cbe_picker"]), probe(), CORPUS);
    expect(r.verdict).toBe("pass");
  });

  it("contains / not_contains match assistant text", () => {
    const refusal: Checkpoint = {
      id: "c1",
      type: "deterministic",
      check: { kind: "contains", pattern: "I can't fabricate" },
    };
    expect(checkDeterministic(refusal, tx("Sorry, I can't fabricate a citation."), probe(), CORPUS).verdict).toBe(
      "pass"
    );
    const forbidden: Checkpoint = {
      id: "c2",
      type: "deterministic",
      check: { kind: "not_contains", pattern: "as an AI" },
    };
    expect(checkDeterministic(forbidden, tx("as an AI language model"), probe(), CORPUS).verdict).toBe("fail");
  });

  // spec: Checkpoint the probe cannot exercise is marked not-assessable
  it("marks a tool_called(cbe_picker) checkpoint not-assessable on a headless probe", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", check: { kind: "tool_called", tool: "cbe_picker" } };
    const r = checkDeterministic(cp, tx("headless markdown answer"), probe({ profile: "headless" }), CORPUS);
    expect(r.verdict).toBe("not-assessable");
    expect(r.reasoning).toMatch(/picker affordance/);
  });

  it("marks a checkpoint targeting an undeclared turn not-assessable", () => {
    const cp: Checkpoint = { id: "c1", type: "deterministic", turn: 2, check: { kind: "contains", pattern: "x" } };
    const r = checkDeterministic(cp, tx("only one turn"), probe({}, ["only turn"]), CORPUS);
    expect(r.verdict).toBe("not-assessable");
    expect(r.reasoning).toMatch(/turn/);
  });
});
