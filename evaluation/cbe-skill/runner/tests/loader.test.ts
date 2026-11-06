import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { parseProbes, countProseCheckboxes, EvalValidationError, loadCorpusPaths } from "../src/loader.js";

const CORPUS = new Set(["vocabulary-001", "foundations-005"]);

const WELL_FORMED = `# 07 Kompetenz Check

Pass criteria:

- [ ] cites the vocabulary anchor
- [ ] judge confirms the competence framing

\`\`\`yaml
eval:
  probes:
    - probe: "7a"
      setup:
        profile: app
        corpus: [vocabulary-001, foundations-005]
      turns:
        - "Design a CBE module on water scarcity."
      checkpoints:
        - id: "7a.1"
          type: deterministic
          anchor: "skill:SKILL.md#Citing"
          check:
            kind: cite_all
            ids: [vocabulary-001, foundations-005]
        - id: "7a.2"
          type: judge
          anchor:
            channel: prompt
            file: identity-prompt
            heading: Corpus grounding
          rubric: "Does the answer frame competences explicitly?"
\`\`\`
`;

describe("loader", () => {
  it("resolves corpus ids to the canonical paths declared by the index", () => {
    const indexPath = fileURLToPath(new URL("../../../../corpus/index.json", import.meta.url));
    expect(loadCorpusPaths(indexPath).get("methodology-001")).toBe(
      fileURLToPath(
        new URL("../../../../corpus/content/methodology/methodology-001-cbl-three-phase-framework.md", import.meta.url)
      )
    );
  });

  // spec: Well-formed eval block loads into a typed probe
  it("loads a well-formed eval block into a typed probe", () => {
    const probes = parseProbes(WELL_FORMED, "07-kompetenz-check.md", CORPUS, { onWarn: () => {} });
    expect(probes).toHaveLength(1);
    const p = probes[0]!;
    expect(p.probe).toBe("7a");
    expect(p.setup.profile).toBe("app");
    expect(p.turns).toEqual(["Design a CBE module on water scarcity."]);
    expect(p.checkpoints.map((c) => c.id)).toEqual(["7a.1", "7a.2"]);
    expect(p.checkpoints[0]!.type).toBe("deterministic");
    expect(p.checkpoints[0]!.check?.kind).toBe("cite_all");
    expect(p.checkpoints[1]!.type).toBe("judge");
    expect(p.checkpoints[1]!.rubric).toContain("competence");
    // Every checkpoint carries at least one anchor; both the compact string form and
    // the object form parse to the same shape.
    expect(p.checkpoints[0]!.anchors).toEqual([{ channel: "skill", file: "SKILL.md", heading: "Citing" }]);
    expect(p.checkpoints[1]!.anchors).toEqual([
      { channel: "prompt", file: "identity-prompt", heading: "Corpus grounding" },
    ]);
  });

  // Change `address-the-lecturer-as-they-ask`: the identity prior is stated through
  // `ProbeSetup` like every other prior, and a probe that states none must parse to
  // `undefined` rather than to an empty record — an empty record would still be a
  // record, and the no-question direction has to run under today's exact descriptor.
  it("parses a probe's lecturerIdentity, and leaves it undefined when unstated", () => {
    const withIdentity = WELL_FORMED.replace(
      "        profile: app\n",
      '        profile: app\n        lecturerIdentity:\n          name: "Anna Béringer-Oduya"\n          formOfAddress: "Frau Professorin Béringer"\n'
    );
    const p = parseProbes(withIdentity, "09.md", CORPUS, { onWarn: () => {} })[0]!;
    expect(p.setup.lecturerIdentity).toEqual({
      name: "Anna Béringer-Oduya",
      formOfAddress: "Frau Professorin Béringer",
    });

    const bare = parseProbes(WELL_FORMED, "09.md", CORPUS, { onWarn: () => {} })[0]!;
    expect(bare.setup.lecturerIdentity).toBeUndefined();
  });

  // Requirement: *Scenario files carry a machine-executable checkpoint block*,
  // Scenario: *An unanchored checkpoint is rejected*. The previous suite ran with 234
  // of 296 checkpoints unanchored: a failure could not be routed to the text that
  // caused it, so every red checkpoint cost a fresh investigation.
  it("rejects a checkpoint with no anchor, naming the file and the checkpoint id", () => {
    const noAnchor = WELL_FORMED.replace('          anchor: "skill:SKILL.md#Citing"\n', "");
    expect(() => parseProbes(noAnchor, "07.md", CORPUS, { onWarn: () => {} })).toThrow(EvalValidationError);
    expect(() => parseProbes(noAnchor, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/07\.md.*"7a\.1".*no anchor/s);
  });

  it("rejects an anchor whose named channel passage does not exist", () => {
    expect(() =>
      parseProbes(WELL_FORMED, "07.md", CORPUS, {
        onWarn: () => {},
        resolveAnchor: (anchor) => (anchor.heading === "Citing" ? "missing-heading" : null),
      })
    ).toThrow(/07\.md.*"7a\.1".*skill:SKILL\.md#Citing.*missing-heading/s);
  });

  it("rejects an anchor naming an unknown channel", () => {
    const badChannel = WELL_FORMED.replace('"skill:SKILL.md#Citing"', '"corpus:index.json#anything"');
    expect(() => parseProbes(badChannel, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/unknown channel "corpus"/);
  });

  it("rejects a malformed compact anchor", () => {
    const malformed = WELL_FORMED.replace('"skill:SKILL.md#Citing"', '"SKILL.md Citing"');
    expect(() => parseProbes(malformed, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/malformed anchor/);
  });

  // Requirement: *A Deterministic Checkpoint Is Backed by an Implemented Check*,
  // Scenario: *An unknown deterministic kind is rejected at load*. Rejected HERE rather
  // than scored `error` at run time, i.e. after the model calls have been paid for.
  it("rejects a deterministic checkpoint naming a kind the checker does not implement", () => {
    const unknownKind = WELL_FORMED.replace("kind: cite_all", "kind: vibes_ok");
    expect(() => parseProbes(unknownKind, "07.md", CORPUS, { onWarn: () => {} })).toThrow(EvalValidationError);
    expect(() => parseProbes(unknownKind, "07.md", CORPUS, { onWarn: () => {} })).toThrow(
      /unknown check kind "vibes_ok"/
    );
  });

  it("accepts every kind the checker implements", () => {
    for (const kind of ["cite_provenance", "reply_language", "no_trailing_menu"]) {
      const src = WELL_FORMED.replace("kind: cite_all", `kind: ${kind}`);
      expect(() => parseProbes(src, "07.md", CORPUS, { onWarn: () => {} })).not.toThrow();
    }
  });

  // spec: Malformed or unknown-corpus-id block is rejected
  it("rejects a block that is not valid YAML, naming the file", () => {
    const broken = '```yaml\neval:\n  probes:\n  - probe: "x\n```';
    expect(() => parseProbes(broken, "bad.md", CORPUS, { onWarn: () => {} })).toThrow(EvalValidationError);
    expect(() => parseProbes(broken, "bad.md", CORPUS, { onWarn: () => {} })).toThrow(/bad\.md/);
  });

  it("rejects a missing required field, naming the field", () => {
    const noTurns = `\`\`\`yaml
eval:
  probes:
    - probe: "7a"
      setup: { profile: app }
      checkpoints:
        - id: "7a.1"
          type: judge
          rubric: "x"
\`\`\``;
    expect(() => parseProbes(noTurns, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/turns/);
  });

  it("rejects an unknown corpus id, naming the id", () => {
    const unknownId = `\`\`\`yaml
eval:
  probes:
    - probe: "7a"
      setup: { profile: app, corpus: [does-not-exist-999] }
      turns: ["hi"]
      checkpoints:
        - id: "7a.1"
          type: judge
          rubric: "x"
\`\`\``;
    expect(() => parseProbes(unknownId, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/does-not-exist-999/);
  });

  // spec: Prose-checkpoint count mismatch emits a warning
  it("emits a warning but still returns the probe on prose/checkpoint mismatch", () => {
    // WELL_FORMED has 2 prose checkboxes and 2 checkpoints — make them mismatch by adding a checkbox.
    const mismatched = WELL_FORMED.replace(
      "Pass criteria:\n",
      "Pass criteria:\n\n- [ ] an extra unmatched criterion\n"
    );
    const onWarn = vi.fn();
    const probes = parseProbes(mismatched, "07-kompetenz-check.md", CORPUS, { onWarn });
    expect(probes).toHaveLength(1);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toMatch(/expected 3 checkpoints matching prose, found 2/);
  });

  it("loads the shell-capability obligation as a semantic judge checkpoint", () => {
    const source = readFileSync(new URL("../../scenarios/08-safety.md", import.meta.url), "utf8");
    const probes = parseProbes(source, "08-safety.md", CORPUS, { onWarn: () => {} });
    const checkpoint = probes.find((probe) => probe.probe === "S8c")?.checkpoints[0];
    expect(checkpoint?.type).toBe("judge");
    expect(checkpoint?.rubric).toMatch(/must not claim, promise, or imply/i);
    expect(checkpoint?.rubric).toContain("Ich werde das Skript ausführen");
  });

  it("does not count checkboxes inside the fenced eval block as prose", () => {
    // The eval block contains no `- [ ]` lines, but ensure fenced content is skipped generally.
    expect(countProseCheckboxes(WELL_FORMED)).toBe(2);
  });
});

// Change `express-app-priors-in-probe-setup` (capability `cbe-skill-eval-harness`,
// Requirement: *A Probe Reproduces the App's Session Priors, and Every Divergence Is
// Declared*): the two priors a probe could not express — the two-layer lecturer state
// and the recorded decisions summary — parse through `ProbeSetup`, and an invalid
// shape is rejected AT LOAD, before any candidate token is spent (Scenario: *An
// invalid prior is rejected before any model call*).
describe("loader — lecturerState and decisionsSummary priors", () => {
  const LECTURER_STATE_YAML =
    "        lecturerState:\n" +
    '          globalPath: "/data/lecturer-state/global.md"\n' +
    '          globalContent: "CBE fluency: proven across two courses."\n' +
    '          overlayPath: "/data/courses/algo/lecturer-state.md"\n' +
    '          overlayContent: "Cohort: 2nd-semester CS."\n';

  it("parses a probe's lecturerState and decisionsSummary", () => {
    const withPriors = WELL_FORMED.replace(
      "        profile: app\n",
      "        profile: app\n" +
        LECTURER_STATE_YAML +
        '        decisionsSummary: "Kompetenz-Check: bestanden (2 Runden)"\n'
    );
    const p = parseProbes(withPriors, "07.md", CORPUS, { onWarn: () => {} })[0]!;
    expect(p.setup.lecturerState).toEqual({
      globalPath: "/data/lecturer-state/global.md",
      globalContent: "CBE fluency: proven across two courses.",
      overlayPath: "/data/courses/algo/lecturer-state.md",
      overlayContent: "Cohort: 2nd-semester CS.",
    });
    expect(p.setup.decisionsSummary).toBe("Kompetenz-Check: bestanden (2 Runden)");
  });

  // Scenario: *A probe that declares neither prior is unchanged* — parse level:
  // an unstated prior is `undefined`, never an empty record, so the descriptor
  // downstream stays byte-identical to today's.
  it("leaves both undefined when the probe declares neither", () => {
    const p = parseProbes(WELL_FORMED, "07.md", CORPUS, { onWarn: () => {} })[0]!;
    expect(p.setup.lecturerState).toBeUndefined();
    expect(p.setup.decisionsSummary).toBeUndefined();
  });

  it("rejects a lecturerState missing one of the four layer fields", () => {
    const missingField = WELL_FORMED.replace(
      "        profile: app\n",
      "        profile: app\n" +
        "        lecturerState:\n" +
        '          globalPath: "/g.md"\n' +
        '          globalContent: "x"\n' +
        '          overlayPath: "/o.md"\n'
    );
    expect(() => parseProbes(missingField, "07.md", CORPUS, { onWarn: () => {} })).toThrow(EvalValidationError);
    expect(() => parseProbes(missingField, "07.md", CORPUS, { onWarn: () => {} })).toThrow(
      /"7a".*setup\.lecturerState.*two-layer/s
    );
  });

  it("rejects a lecturerState whose field is not a string", () => {
    const wrongType = WELL_FORMED.replace(
      "        profile: app\n",
      "        profile: app\n" + LECTURER_STATE_YAML.replace('"Cohort: 2nd-semester CS."', "42")
    );
    expect(() => parseProbes(wrongType, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/setup\.lecturerState/);
  });

  it("rejects a lecturerState carrying an unknown field", () => {
    const extraField = WELL_FORMED.replace(
      "        profile: app\n",
      "        profile: app\n" + LECTURER_STATE_YAML + '          extra: "nope"\n'
    );
    expect(() => parseProbes(extraField, "07.md", CORPUS, { onWarn: () => {} })).toThrow(
      /unknown setup\.lecturerState field "extra"/
    );
  });

  it("rejects a non-object lecturerState", () => {
    const scalar = WELL_FORMED.replace(
      "        profile: app\n",
      '        profile: app\n        lecturerState: "just a string"\n'
    );
    expect(() => parseProbes(scalar, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/setup\.lecturerState/);
  });

  it("rejects a non-string decisionsSummary", () => {
    const wrong = WELL_FORMED.replace(
      "        profile: app\n",
      "        profile: app\n        decisionsSummary: [not, a, string]\n"
    );
    expect(() => parseProbes(wrong, "07.md", CORPUS, { onWarn: () => {} })).toThrow(/setup\.decisionsSummary/);
  });
});
