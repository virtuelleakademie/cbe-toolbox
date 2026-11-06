/**
 * The skill body's contract (change `rebuild-skill-prompt-and-eval`).
 *
 * Replaces `skill-bundle.test.ts`, `skill-recut-budget.test.ts`,
 * `skill-design-flow-bundle.test.ts`, `skill-host-action.test.ts`,
 * `skill-picker-multiselect.test.ts`, `no-announcement-rule.test.ts`,
 * `help-token-bundle.test.ts`, `skill-corpus-index-path.test.ts` and
 * `skill-reflective-questions.test.ts` — every one of which asserted a structure the
 * rebuild removed (the reference tree and its catalogue, the Roaster, working postures,
 * tool mechanics in the body, the corpus-path instruction that is now prompt-only).
 *
 * What is asserted here:
 *   1. the single documented budget                    — Eager Skill-Body Instruction Budget
 *   2. no tool name in the body                        — Instruction Channel Boundary
 *   3. no reference pointer                            — Modular Skill References (REMOVED)
 *   4. no complete, copy-pasteable citation token      — Skill-Bundle Citation Examples…
 *   5. no lecturer-facing output string                — Response Language Mirrors the Lecturer
 *   6. one content anchor per instructed rule family   — the MODIFIED/ADDED requirements
 *   7. no anchor into a retired structure              — decisions A/B/C
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_BODY_BUDGET, stripFrontmatter } from "../src/cbe-system-prompt.js";
import { CANONICAL_SLOTS } from "../src/canvas-addressing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD = path.resolve(__dirname, "../../../skills/cbe/SKILL.md");
const raw = readFileSync(SKILL_MD, "utf8");
/** Exactly what the harness injects (`buildCbeSkillBlock`). */
const body = stripFrontmatter(raw);

describe("skill body — the single documented budget", () => {
  // Requirement: Eager Skill-Body Instruction Budget, Scenario: *Body stays within the
  // single documented cap*. ONE number, ONE assertion — no separate floor and no
  // headroom subtraction that would make the documented cap unreachable.
  //
  // THE NUMBER IS A JUDGEMENT RATCHET, NOT A MEASURED DEGRADATION POINT. Nothing in
  // this repository ties any value of it to observed instruction-following
  // degradation, and nothing automated guards the value itself — this test enforces
  // the budget, not its correctness. Whoever raises it states the basis.
  it("stays under the documented cap, measured the way the harness injects it", () => {
    expect(body.length).toBeLessThan(SKILL_BODY_BUDGET);
  });

  it("reports its measured size, so a relocation between channels is visible in the diff", () => {
    // Companion to the tool-prose budget test, which prints all three channel totals.
    // A rule moving OUT of the body must show up as the body shrinking there.
    expect(body.length).toBeGreaterThan(0);
    console.info(`[budget] skill body: ${body.length} / ${SKILL_BODY_BUDGET} chars`);
  });
});

describe("skill body — the channel boundary is enforced mechanically", () => {
  // Requirement: Instruction Channel Boundary, Scenario: *The skill body names no tool*.
  //
  // The rationale is empirical, not aesthetic: when the new skeleton was first
  // extended, two of four additions reached for tool mechanics although the brief was
  // explicitly host-neutral. The mechanism is more present to a writer than the rule
  // behind it, so the judgement is made once, here, instead of every time.
  //
  // ONE narrowing, product decision 2026-08-07: a tool whose TRIGGER is didactic conduct
  // is named in the section that describes that conduct — the ten steps name `cbe_canvas`
  // and `cbe_step`, § Maturity names `cbe_maturity`. The obligation to RECORD at all
  // existed only in those tool descriptions, which are ~80 % guardrails against
  // fabrication and half a sentence of trigger — so the model called correctly but far too
  // rarely (17 of 25 `cbe_step` calls carried no `focus`; see `step-tool.ts`). The trigger
  // belongs where the behaviour happens; the MECHANICS (no fabrication, revision-in-place,
  // refusal handling) stay in the descriptions and must not be restated here. The general
  // tools (`cbe_picker`, `cbe_profile`, `cbe_cite`) are not bound to one part of the flow
  // and are named in the identity prompt instead. Any OTHER tool name in the body, and any
  // permitted name outside its own section, is still rejected.
  //
  // Each entry: the tool name → the section span(s) that may name it, as [start, end)
  // markers (`end: null` means "to the end of that section", i.e. the next `\n## `).
  const BODY_MAY_NAME: Record<string, { start: string; end: string | null }[]> = {
    cbe_canvas: [{ start: "**2. The ten steps.**", end: "**Coherence gate after step 3.**" }],
    cbe_step: [{ start: "**2. The ten steps.**", end: "**Coherence gate after step 3.**" }],
    cbe_maturity: [
      { start: "## Maturity", end: null },
      // Product decision, 2026-08-08: the review is a SECOND behaviour site, not a caller
      // of the first. § Maturity owns the reading; § Critical review owns the
      // confrontation that closes a review, and it has to record what the design reached
      // to make that comparison. Trigger only; the mechanics stay in the tool description.
      { start: "## Critical review", end: null },
      // Change `close-the-flow-when-the-cards-are-full`, 2026-08-11: the end-of-flow close
      // is a THIRD behaviour site, by the same reasoning as the second. The review is an
      // OFFER, so a lecturer who declines it would otherwise leave a completed design never
      // having been told where it landed against the ambition they named at the opening —
      // the close therefore owns a confrontation of its own and has to record what the
      // design reached to make it. Trigger only, one clause; the mechanics (batched
      // establishment, the record shape, refusal handling) stay in the tool description.
      { start: "**3. Closing.**", end: "## Competency check" },
    ],
    // Product decision, 2026-08-07: the profile estimate is not an opening formality but a
    // running obligation, so § Calibration — where the five dimensions live — names the
    // tool that carries it.
    cbe_profile: [{ start: "## Calibration", end: null }],
  };

  /** The `[from, to)` span a permitted name may appear in — both markers guarded. */
  const spanOf = ({ start, end }: { start: string; end: string | null }): [number, number] => {
    const from = body.indexOf(start);
    expect(from, `missing section marker: ${start}`).toBeGreaterThan(-1);
    let to: number;
    if (end === null) {
      const rest = body.slice(from + start.length);
      const next = rest.search(/\n## /);
      to = next === -1 ? body.length : from + start.length + next;
    } else {
      to = body.indexOf(end);
    }
    expect(to, `missing section marker: ${end ?? "end of section"}`).toBeGreaterThan(from);
    return [from, to];
  };

  /** The body with every permitted section span cut out. */
  const outsideAllPermittedSections = (): string => {
    const spans = Object.values(BODY_MAY_NAME).flat().map(spanOf);
    spans.sort((a, b) => a[0] - b[0]);
    let out = "";
    let cursor = 0;
    for (const [from, to] of spans) {
      if (from > cursor) out += body.slice(cursor, from);
      cursor = Math.max(cursor, to);
    }
    return out + body.slice(cursor);
  };

  it("names no cbe_* tool beyond the four the sections may carry", () => {
    const hits = [...new Set(body.match(/cbe_[a-z_]*/g) ?? [])].filter((t) => !(t in BODY_MAY_NAME));
    expect(hits, `skill body names tools: ${hits.join(", ")} — tool mechanics belong in the tool description`).toEqual(
      []
    );
  });

  it("names each permitted tool only inside its own section", () => {
    // Nothing at all outside the permitted spans…
    expect(outsideAllPermittedSections().match(/cbe_[a-z_]*/g) ?? []).toEqual([]);
    // …and no permitted name has wandered into a sibling's span.
    for (const [tool, spans] of Object.entries(BODY_MAY_NAME)) {
      const own = spans.map(spanOf).sort((a, b) => a[0] - b[0]);
      let elsewhere = "";
      let cursor = 0;
      for (const [from, to] of own) {
        if (from > cursor) elsewhere += body.slice(cursor, from);
        cursor = Math.max(cursor, to);
      }
      elsewhere += body.slice(cursor);
      const where = spans.map((s) => s.start).join(", ");
      expect(elsewhere.includes(tool), `\`${tool}\` is named outside its own section(s) (${where})`).toBe(false);
    }
  });

  it("does not restate the tool descriptions' own guardrails", () => {
    // The point of the skill-side passage is the TRIGGER. A rule about how the tool is
    // operated has exactly one home, and it is not this file.
    // (`affordance` is not listed: § Register names it as a word that must not reach
    // the lecturer, which is a different rule with a different home.)
    expect(body).not.toMatch(/fire-and-forget/i);
    expect(body).not.toMatch(/refusal is an instruction/i);
    expect(body).not.toMatch(/edits? in place/i);
  });

  it("contains no reference-file pointer", () => {
    // The reference tree left the bundle (REMOVED: Modular Skill References for Context
    // Hygiene). 313 KB in 26 files, pointed at 49 times, opened essentially never.
    const hits = body.match(/references\/[^\s`)]+/g) ?? [];
    expect(hits, `skill body still points at reference files: ${hits.join(", ")}`).toEqual([]);
  });

  it("names no affordance flag that the descriptor does not emit", () => {
    // The body speaks about the environment only in the abstract ("where the host
    // supplies…"); it must not hardcode a descriptor key, which is how the previous
    // body came to document seven affordances against ten emitted.
    expect(body).not.toMatch(/affordances\s*[.:]/);
  });
});

describe("skill body — no emittable citation token, no fabrication path", () => {
  // Requirement: Skill-Bundle Citation Examples Match Corpus Ground Truth, Scenario:
  // *The bundle carries no copy-pasteable token*.
  //
  // The old body showed two complete `(corpus:… § …, author year)` tokens AND ordered
  // them copied verbatim into a response. That made the fabrication path the cheapest
  // path — the model could satisfy the instruction by pasting, without reading the
  // document — while the rules forbidding it sat behind the 50 KB read truncation.
  it("contains no complete (corpus:…) token", () => {
    const hits = body.match(/\(corpus:[^)]*\)/g) ?? [];
    expect(hits, `skill body carries emittable citation tokens: ${hits.join(", ")}`).toEqual([]);
  });

  it("points at a grounding by naming the source, never by shape", () => {
    // Where the body needs a grounding it names the document in prose. Since 2026-08-09
    // EVERY direct corpus reference carries a read instruction as well — the eval showed
    // both relocated methods going uncited when their check ran unprompted (`11c`, `12d`,
    // gemma and qwen alike), so the pointer states the read and the grounding obligation.
    // Each direct corpus pointer has a read-before-use instruction. Maturity's
    // shorter imperative keeps the same ordering after the opening-input re-cut.
    for (const id of ["methodology-012", "methodology-003", "methodology-007", "methodology-002"]) {
      expect(body, `body must name the corpus document ${id}`).toContain(`\`${id}\``);
    }
    expect(
      body.match(/read it before you|Read `methodology-007` for the criteria before a reading/gi) ?? [],
      "every direct corpus reference carries a read instruction"
    ).toHaveLength(4);
    expect(body).toMatch(/defined in the corpus/i);
  });
});

describe("skill body — carries no lecturer-facing output string", () => {
  // Requirement: Response Language Mirrors the Lecturer; Worked Examples Are
  // Language-Neutral, Scenario: *The bundle carries no hardcoded lecturer-facing
  // string*. The two retired refusal sentences are asserted by absence, so a
  // reintroduction fails rather than shipping — one of them told the lecturer she was
  // talking to "this skill".
  const RETIRED_REFUSALS = [
    "This skill supports lecturers in designing",
    "I can't help with that",
    "falls outside what this skill",
  ];

  it("does not carry either retired English refusal sentence", () => {
    for (const s of RETIRED_REFUSALS) {
      expect(body.includes(s), `retired refusal string reintroduced: "${s}"`).toBe(false);
    }
  });

  it("never refers to itself as a skill, a prompt, or a tool in lecturer-facing terms", () => {
    // § Register forbids the harness register reaching the lecturer; the body must not
    // model the violation it forbids.
    expect(body).not.toMatch(/\bthis skill\b/i);
  });
});

describe("skill body — every instructed rule family has an anchor", () => {
  // One assertion per rule family the MODIFIED/ADDED requirements instruct. These are
  // the anchors the eval's checkpoints point at (evaluation/cbe-skill/traceability.json);
  // deleting a line without deliberately updating its test is what this catches.
  const section = (heading: string): string => {
    const i = body.indexOf(heading);
    expect(i, `missing section: ${heading}`).toBeGreaterThan(-1);
    const rest = body.slice(i + heading.length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
  };

  // Change `guide-the-work-by-lecturer-intent`: the retired mode heading and its
  // design / transfer / sharpen taxonomy are replaced by semantic readings of the work.
  // Work intent is revisable conversation context, not a mode the lecturer selects or a
  // value the host persists. The one-first-turn rule now composes intent clarification,
  // explicit entry points and the existing ambition/profile obligations in one owner.
  it("Opening: work intent is semantic, revisable and subordinate to one first-turn owner", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/design makes or revises CBE decisions/i);
    expect(s).toMatch(/transfer adapts existing teaching/i);
    expect(s).toMatch(/review examines weaknesses on request or accepted offer/i);
    expect(s).toMatch(/No modes/i);
    expect(s).toMatch(/Latest request outranks prior readings and material shape/i);
    expect(s).toMatch(/work an ordered combination in order/i);
    expect(s).toMatch(/If plausible readings would change that action materially/i);
    expect(s).toMatch(/ask one focused intended-result question/i);
    expect(s).toMatch(/If the next move is shared, take it/i);
    expect(s).toMatch(/One thing owns the first substantive turn/i);
    expect(s).toMatch(/never as a questionnaire/i);
    expect(s).toMatch(/What is already on record you adopt/i);
    expect(s).toMatch(/Nothing is a gate/i);
    expect(s).not.toMatch(/\(1\) The mode|sharpen a finished design/i);
  });

  it("Ten steps: orientation each turn, the lecturer's entry point, no bare menu", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/1 Set the frame `moduleframe` · 2 Learning outcomes `learningoutcomes`/);
    expect(s).toMatch(/where the lecturer stands and propose the next step, unprompted/i);
    expect(s).toMatch(/you work there immediately/i);
    expect(s).toMatch(/never ends on a bare menu question/i);
    expect(s).toMatch(/read it before you lead that step/i);
  });

  it("Ten steps: the step list carries every canonical canvas id, verbatim", () => {
    // The ids are the addressing contract (`CANONICAL_SLOTS` in
    // `packages/pi-bridge/src/canvas-addressing.ts`). Documented nowhere the model could
    // read them before this, so it learned them by collecting refusals.
    const s = section("## How a session runs");
    for (const [container, ids] of Object.entries(CANONICAL_SLOTS)) {
      for (const id of ids) {
        expect(s, `step list is missing the canonical id \`${id}\` of container ${container}`).toContain(`\`${id}\``);
      }
    }
  });

  // Until `seed-step-6-journey-slots` the Step-6 `engage` / `reflect` elements seeded
  // nothing, and the body mitigated that hole in the addressing table with a "mint a
  // stable id yourself" sentence. The table is the machine-readable authority: every
  // container now carries canonical ids, so the mitigation is gone and the body names the
  // cards for all four journey elements like every other step.
  it("Ten steps: every Step-6 journey element carries named cards, none is self-minted", () => {
    const s = section("## How a session runs");
    for (const phase of ["engage", "investigate", "act", "reflect"]) {
      expect(CANONICAL_SLOTS[`6/${phase}`]?.length, `6/${phase} seeds no canonical id`).toBeGreaterThan(0);
      expect(s, `the step list does not name the ${phase} element`).toMatch(new RegExp(`${phase} \`\\w`));
    }
    expect(s).not.toMatch(/mint a stable id/i);
    expect(s).not.toMatch(/have no card named for them/i);
  });

  // Scenario: The step list names no retired learner-time id (change
  // `harmonise-canvas-slots-with-the-ten-step-outputs`, capability `cbe-skill`,
  // Requirement: The Step List Is the Model-Readable Home of the Canvas Addressing Contract).
  it("Ten steps: the step list names no retired learner-time id", () => {
    // `gq` / `ar` / `syn` / `sc` / `sd` / `ie` are `methodology-001`'s LEARNER-time
    // activities, not canvas slots. Word-boundary match so a coincidental substring
    // (`ie` inside "field", `ar` inside "carry") does not false-positive.
    for (const id of ["gq", "ar", "syn", "sc", "sd", "ie"]) {
      expect(body, `the skill body still names the retired learner-time id \`${id}\``).not.toMatch(
        new RegExp(`\\b${id}\\b`)
      );
    }
  });

  it("Ten steps: recording is triggered by name, and the corpus source is read first", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/record it on its card with `cbe_canvas`/);
    expect(s).toMatch(/with `cbe_step`/);
    expect(s).toMatch(/instead of restating its content/i);
    expect(s).toMatch(/`methodology-012`/);
    expect(s).toMatch(/rough then refined then detailed/i);
  });

  // Change `decouple-rounds-from-the-maturity-target`, 2026-08-18. capability `cbe-skill`,
  // Requirement: *A Revisited Step Carries Its Recorded Level Along*, Scenario: *A step
  // worked again carries its level along*. The section already carried the SETTLE trigger;
  // nothing said what happens when a step already on the flow is worked a second time, so a
  // deepening could live entirely in the reply while the flow still showed the level the
  // step had before — a report the surface contradicts. The duty is a TRIGGER and therefore
  // conduct, which is why it sits here and not in `cbe_step`'s description (the sibling
  // assertion in `tool-description-coverage.test.ts` holds the other half of that boundary).
  it("Ten steps: a step worked again carries its recorded level along", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/Work a step again and mark its new level in that turn/i);
    // A trigger, not mechanics: the ladder, the refusal and the affordance gate stay in the
    // tool channel, and no further `cbe_*` token enters the section.
    expect(s).not.toMatch(/one rung|refus\w+|affordance/i);
  });

  // Change `settle-only-on-a-lecturer-decision`, 2026-08-18. Until it, the same sentence
  // carried a SECOND settle trigger — "or accepts a proposal you made" — which the
  // canonical spec never established and which contradicted the two rules that forbid the
  // assistant to author a formulated artefact for the lecturer's own module
  // (§ Non-negotiables; the identity prompt's conduct floor). The contradiction was
  // operative rather than theoretical: asked to self-assess after delivering three such
  // artefacts, the model identified the violation correctly and then proposed to leave the
  // contents on record "since you accepted them" — the literal application of the clause.
  // Requirement: The Ten-Steps Section Carries the Recording Trigger, Scenario: *The body
  // names the lecturer's stated decision as the only settle trigger*.
  it("Ten steps: the lecturer's stated decision is the only settle trigger", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/settled the moment the lecturer states a decision — that is the trigger/);
    // Body-wide, not section-scoped: the licence must not survive anywhere.
    expect(body).not.toMatch(/accepts a proposal/i);
  });

  // Requirement: The Ten-Steps Section Carries the Recording Trigger, Scenario: *A proposal
  // the assistant made does not settle a step output*. Distinct from the assertion above:
  // that one pins the surviving wording, this one closes the framings a later editor could
  // re-introduce the licence in while believing they were clarifying. Behaviour is NOT
  // measured here — this asserts only that the body carries no warrant for it.
  it("Ten steps: no restatement of the licence survives in any framing", () => {
    expect(body).not.toMatch(/proposal you (made|offered)/i);
    expect(body).not.toMatch(/(accept|agree)\w*\s+(to\s+)?(your|the assistant'?s?)\s+(proposal|formulation|draft)/i);
  });

  // Change `recalibrate-tutor-support` (product decision 2026-10-13). The trigger stays ONE
  // — a decision the lecturer states — and the lecturer's yes to wording THEY asked for is a
  // form of it, owing no paraphrase. What settles nothing is the absence of a decision: an
  // unanswered draft or the assistant's own preference. Scenarios: *The body names the
  // lecturer's stated decision as the only settle trigger*; *Accepted wording is recorded
  // without demanded re-authorship*; *A recorded acceptance does not settle a named gap*;
  // *An unaccepted proposal is not recorded*.
  it("Ten steps: acceptance of requested wording settles; an unanswered draft or your preference does not", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/their yes to wording they asked for counts, owing no paraphrase/);
    expect(s).toMatch(/an unanswered draft or your preference settles nothing and a named gap stays open/);
    // The retired rule that bare acceptance cannot settle must not return.
    expect(body).not.toMatch(/bare acceptance/i);
  });

  // Requirement: The Ten-Steps Section Carries the Recording Trigger, Scenario: *The body
  // says what an unfilled card is*. The section lists which card each step fills and makes
  // the unfilled card the record of what is open, and until this change it never stated the
  // meaning of an empty one. A named, empty field with no stated meaning reads as a defect,
  // and a defect invites repair — which is the pull the assistant resolves towards
  // usefulness when it hands over a formulated artefact. Section-scoped on purpose: a copy
  // drifting into another section still fails.
  it("Ten steps: the body says what an unfilled card is", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/An empty card is no defect to repair/);
    expect(s).toMatch(/a question the lecturer has not answered/i);
    expect(s).toMatch(/removes the answer, not the gap/i);
  });

  // The flow NAMES the moment and points at the section that owns the check; § Alignment
  // check carries the one-concept statement ("one check at two depths"), asserted in its
  // own test below. Until 2026-08-09 both places stated the concept, so the body carried
  // the same rule twice and the second copy silently narrowed over time.
  // `methodology-012` puts the initial challenge idea in STEP 1 — "get the big picture of
  // the challenge clear (theme, issue, stakeholder)" before the outcomes are defined — and
  // step 4 develops it into the challenge statement. The body's step list names step 4 as
  // "Choose the challenge" and said nothing about step 1, so the gate after step 3 demanded
  // an artefact the body's own ordering had not produced yet. Stated since 2026-08-09.
  it("Ten steps: step 1 carries the initial challenge idea the gate needs", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/Step 1 also settles the initial idea of the challenge/i);
    expect(s).toMatch(/step 4 develops that idea into the challenge itself/i);
    expect(s).toMatch(/the check after step 3 has nothing to hold the outcomes and the assessment against/i);
  });

  // RESTORED 2026-08-09, product decision, after measurement. The dedup earlier that day
  // removed this sentence from the flow, on the argument that § Alignment check states the
  // concept once and a second copy had silently narrowed over time. Two full runs then
  // showed the model presenting the two moments as two checks with separate names and
  // purposes — gemma "grobe Plausibilitätsprüfung / Strategie" against "vollständiges
  // Alignment-Audit / Umsetzung", qwen "Kohärenz-Check" against "Alignment-Check", "Makro"
  // against "Mikro". Twice, on two models, is not variance. The pointer stays AND the
  // sentence comes back: one rule belongs in one place, but this one has to be readable at
  // the moment it applies. Measured by eval checkpoint 12c.
  it("Coherence gate: named in the flow, with the one-concept statement restored", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/Coherence gate after step 3/);
    expect(s).toMatch(/§ Alignment check/);
    expect(s).toMatch(/early, coarse form of the step-9 alignment check, not a second check/i);
  });

  // `methodology-012` §4.6 states the stop verbatim ("do not move on before you make sure
  // that the initial challenge, learning outcomes and assessment blueprint are coherent"),
  // so the corpus, not a consistency argument, decides that the gate holds. What the corpus
  // does NOT license is holding a lecturer there: it addresses a development team reviewing
  // its own work. The stop binds the skill's initiative; an express decision is followed
  // and the open break is carried by § Maturity.
  it("Coherence gate: the stop binds the skill, the express override is followed and costs", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/name the break and stay there/i);
    expect(s).toMatch(/never move past it on your own/i);
    expect(s).toMatch(/decides to go on anyway, you follow/i);
    expect(s).toMatch(/stays with the maturity reading/i);
  });

  // The flow is not a mandatory linear sequence (`methodology-012`), and the record of what
  // is done is the CANVAS, not the transcript — which is also what makes the open-point
  // inventory possible at all. The inventory fires on situations, never on a turn count: a
  // counter is unmeasurable in a probe and produces a nag nobody asked for.
  it("Ten steps: the order is the lecturer's, the cards are the record, the inventory is situational", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/The order is theirs/i);
    expect(s).toMatch(/skipped, deferred or reopened/i);
    expect(s).toMatch(/the unfilled card is the record/i);
    expect(s).toMatch(/what the cards hold, not what the conversation remembers/i);
    expect(s).toMatch(/what is still empty across the whole flow/i);
    // Product decision 2026-08-09: the inventory is DUE where a round turns and at the
    // close, and is an OFFER everywhere else. The retired "when the work circles one step"
    // trigger made it an obligation, and the checkpoint built on it failed a model that was
    // correctly staying with the lecturer's own question three turns into hard work.
    expect(s).toMatch(/an offer, never a reflex/i);
    expect(s).toMatch(/is not interrupted with a status list/i);
    expect(s).not.toMatch(/circles one step/i);
    expect(s).toMatch(/never on a count of turns/i);
  });

  // Two triggers were missing: the run being complete, and the review OFFER — § Critical
  // review regulated what happens after an offer was accepted while nothing said when to
  // offer, so the acceptance path could never fire on the skill's own initiative.
  it("Closing: three triggers, and the review offer lives here", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/once the cards are full/i);
    expect(s).toMatch(/not with an eleventh step/i);
    expect(s).toMatch(/Offer the critical review here/i);
    expect(s).toMatch(/unoffered there is nothing to accept/i);
  });

  // Change `decouple-rounds-from-the-maturity-target`, 2026-08-18. capability `cbe-skill`,
  // Requirement: *Closing*, Scenarios: *A further pass is presented as available, not as
  // outstanding* and *Stopping where the design stands is a legitimate end*. The close owes
  // an inventory of what is still empty and a reading against the recorded target, and both
  // of those are one step away from reading as "you are not finished yet". They are not: the
  // rounds are the lecturer's own axis (§ Calibration), so another pass is an option and
  // never an outstanding item, and stopping is an end rather than an unfinished condition.
  // The eval side of this pair is `5i`, and `5b`'s "proposes further design work" rubric
  // carries the exemption that keeps the two from contradicting each other.
  it("Closing: a further pass is available, never outstanding, and stopping is an end", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/Another pass is available, never outstanding/i);
    expect(s).toMatch(/stopping where the design stands is a legitimate end/i);
    // The permission must not turn into a push: no recommendation, no condition.
    expect(s).not.toMatch(/you should take another (pass|round)/i);
    expect(s).not.toMatch(/not (yet )?finished|still unfinished/i);
  });

  // Product decision, 2026-08-08: the review LEFT the session sequence. It used to sit at
  // position 3 of "1. Opening → 2. The ten steps → 3. Challenging → 4. Closing", and a
  // thing at position 3 of a sequence reads as a stage, while its own text said "hand back
  // to the ongoing work when the review ends" — which only makes sense for a capability.
  // The model resolved the contradiction the wrong way: in the 2026-08-08 run it announced
  // "wechsle ich in den Review-Modus" and never closed, so the confrontation had no place
  // to land. It is now a section of its own, beside § Two checks and § Maturity.
  it("Critical review: a bounded activity, not a mode and not a stage", () => {
    const s = section("## Critical review");
    expect(s).toMatch(/not a mode or flow stage/i);
    expect(s).toMatch(/whenever the lecturer asks or accepts your offer/i);
    expect(s).toMatch(/hand back to the work it interrupted/i);
    // …and the session sequence is three, with no review in it.
    const flow = section("## How a session runs");
    expect(flow).toMatch(/\*\*3\. Closing\.\*\*/);
    expect(flow).not.toMatch(/\*\*4\. /);
  });

  it("Critical review: three perspectives, mechanism per finding, the finding survives", () => {
    const s = section("## Critical review");
    expect(s).toMatch(/at least three student perspectives/i);
    expect(s).toMatch(/overwhelmed, unmotivated, ambitious/i);
    expect(s).toMatch(/names the mechanism/i);
    // Product decision 2026-08-08: the "It's fine" worked example is gone. It taught one
    // phrasing instead of the rule, and the 2026-08-08 run walked straight past it by
    // saying the review was finished. The rule is now stated plainly and about the
    // LECTURER, not about a sentence they might use.
    expect(s).toMatch(/Be critical of the lecturer too/i);
    expect(s).toMatch(/contentment or contradiction alone does not retire a finding/i);
    expect(s).not.toMatch(/"It's fine"/);
    // Product decision 2026-08-08, the middle path. Holding a finding is NOT repeating it
    // until the lecturer yields — § Two checks tells the skill to "record the reservation
    // and carry on", and the 2026-08-08 run followed that rule and was failed for it. What
    // was missing was the COST: the reservation went on the record with no content. So the
    // finding survives by naming what it costs, once, and the lecturer's decision stands.
    expect(s).toMatch(/say once what it costs/i);
    expect(s).toMatch(/then carry on with their decision standing/i);
    expect(s).toMatch(/drops the finding politely/i);
  });

  it("Critical review: assess, record, THEN compare — and that is the last thing", () => {
    // Requirement: *Adversarial Review Confronts Declared Ambition Against Achieved
    // Maturity* — a structural slot of every review, not a conditional step.
    //
    // The three verbs were a list before ("read …, record …, and name …"), and the
    // 2026-08-08 run read and named while skipping the record in the middle. They are an
    // ORDER now, with the reason attached: nothing to compare without the reading.
    const s = section("## Critical review");
    expect(s).toMatch(/Close on the gap in order/i);
    // Named as behaviour, not mechanics: "each criterion the review moved" is the same
    // trigger § Maturity states for the running reading. The batched establishment form
    // stays the tool description's business.
    expect(s).toMatch(/record with `cbe_maturity` each criterion the review moved/);
    expect(s).toMatch(/without that reading there is nothing to compare/i);
    expect(s).toMatch(/name the recorded target against what the design reaches/i);
    expect(s).toMatch(/if none is declared, name the absence/i);
    expect(s).toMatch(/keep every remedy at or below the target/i);
    expect(s).toMatch(/the review's last act/i);
    // "per criterion" is gone: the target is ONE overall level, and an unassessed
    // criterion is unmeasurable rather than a shortfall (§ Maturity).
    expect(s).not.toMatch(/per criterion/i);
  });

  it("Delegation check: its own section, raised unprompted, decided by the lecturer", () => {
    // Product decision 2026-08-08, two parts.
    //
    // (1) Lifted out of § Critical review to the same level: it is its own check with its
    //     own probe, not a paragraph of the review.
    // (2) METHOD MOVED TO THE CORPUS. `openspec/specs/cbe-skill/spec.md` § *Delegation
    //     Check* asks for far more than the body carried — three named statuses, the
    //     germane/extraneous grounding, and the ownership inconsistency flag. Writing all
    //     of that into the body would grow a channel already over its cap, so the didactic
    //     method lives in `methodology-002` and the body keeps the read obligation — the
    //     same shape the ten steps use for `methodology-012`.
    //
    // WHAT MUST NOT FOLLOW IT OUT: the refusal and the authority boundary. Those hold even
    // when the model never opens the document, the same reason "what you have not read,
    // you do not cite" lives here rather than in a tool description.
    const s = section("## Delegation check");
    expect(s).toMatch(/you raise it yourself — it does not wait to be asked/i);
    expect(s).toMatch(/`methodology-002`/);
    // The pointer carries BOTH halves since 2026-08-09: an explicit read instruction and a
    // grounding obligation. CORRECTION of what stood here — the 2026-08-08 zero-read runs
    // were an INSTRUMENT artefact (`--model` suppressed reasoning, the corpus-index read was
    // still conditional), both fixed since; they attribute nothing to the wording of an
    // instruction, and this comment previously claimed they did.
    expect(s).toMatch(/read it before you raise the question/i);
    expect(s).toMatch(/You name no status and no load judgement you have not read there/);
    expect(s).toMatch(/as ungrounded as an unread citation/i);
    expect(s).toMatch(/You never issue the decision/);
    expect(s).toMatch(/that is theirs, and you say so/i);
    // CORRECTED 2026-08-09. "supply no default" stood here and in the 11b rubric, and it
    // existed nowhere else in the repo — no spec carries it. It contradicted the very
    // document the section delegates to: `methodology-002` § Per-component heuristic is a
    // table whose third column is headed "Delegation default (LECTURER TO JUSTIFY)", with
    // "The table is a starting point for the lecturer's reasoning, never a verdict the skill
    // issues on its own". The forbidden act is issuing the DECISION, not naming the likely
    // load. The over-strict wording most probably survived the merge of the retired
    // requirement "Delegation Check — Build-versus-Overhead Decided by the Lecturer" into
    // "Challenging", a rename the traceability map still pointed at.
    expect(s).toMatch(/starting from the likely load the corpus names/i);
    expect(s).toMatch(/theirs to justify, not yours to settle/i);
    expect(s).not.toMatch(/supply no default/i);
    expect(s).toMatch(/no referent until outcomes and assessment are settled/i);
    // The per-component heuristic itself is the corpus document's job now.
    expect(s).not.toMatch(/overhead around that competence/i);
  });

  it("Closing: what stands, what is open, what comes next — and the early close", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/What stands, what is open, what comes next/);
    expect(s).toMatch(/never content you author in their place/i);
    expect(s).toMatch(/early close yields the same three parts/i);
  });

  // Change `close-the-flow-when-the-cards-are-full`. capability `cbe-skill`,
  // Requirement: *Closing* — Scenarios: *The end-of-flow close reads the design against
  // the declared target*; *A missing target is named as an absence at the close*; *The
  // end-of-flow close inventories what is still empty*; *The close is still not an
  // eleventh step*; *An early close still yields the three parts*.
  //
  // Until this change both closes were the same three parts, so a lecturer who had worked
  // all ten steps got the same compact wrap-up as one who stopped after step 4. What the
  // full flow additionally owes is a maturity reading against the declared target and the
  // open inventory in full — the reading because the critical review is an OFFER and an
  // unaccepted offer leaves the one comparison the maturity apparatus exists to produce
  // undelivered.
  it("Closing: the end-of-flow close is distinguished from the early one, read from the cards", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/A close at the end of the flow owes two things more/);
    // The condition is the canvas state (or the lecturer's own signal past the gate) —
    // never a turn counter, which is the same defect § 2 already forbids one level down.
    expect(s).toMatch(/You read that end from the cards/i);
    expect(s).toMatch(/no canonical slot left empty/i);
    expect(s).toMatch(/after the coherence gate with the flow substantially worked/i);
    expect(s).toMatch(/never from a count of turns/i);
  });

  it("Closing: the end-of-flow close reads and records the design against the recorded target", () => {
    const s = section("## How a session runs");
    // Named as behaviour, not mechanics — the same trigger shape § Critical review uses.
    expect(s).toMatch(/read it as § Maturity defines it/i);
    expect(s).toMatch(/record with `cbe_maturity` what moved/);
    expect(s).toMatch(/name that reading against the recorded overall target/i);
    // Why it does not live in the review alone: an offer can be declined.
    expect(s).toMatch(/The review is an offer and can be declined/i);
    expect(s).toMatch(/this reading never waits on one/i);
    // The reading is DEFINED once, in § Maturity; the close is a second occasion for it.
    expect(s).not.toMatch(/seven criteria|methodology-007/);
  });

  it("Closing: a target that was never recorded is named as an absence", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/where no target was ever recorded/i);
    expect(s).toMatch(/name that absence rather than reading it as a modest one/i);
  });

  it("Closing: the full inventory is the last thing before what comes next", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/as the last thing before what comes next/i);
    expect(s).toMatch(/say in full what is still empty across the flow/i);
    expect(s).toMatch(/which findings the lecturer left standing/i);
  });

  it("Closing: the additions are still a close, not an eleventh step and not authorship", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(/Neither is an eleventh step and neither authors anything/i);
    expect(s).toMatch(/a reading is a reading, an inventory is an inventory/i);
    // …and the flow is still three numbered parts, with no fourth.
    expect(s).not.toMatch(/\*\*4\. /);
  });

  // The early close is UNCHANGED by the additions above, and stated as unchanged: before
  // the coherence gate the criteria have no subject (capability `agent-harness`,
  // Requirement: *The Maturity Demands Are Staged Across the Session*) and a compact close
  // is the whole point of it. This assertion exists so a future edit cannot quietly fold
  // the two closes together.
  it("Closing: the early close owes nothing beyond the three parts", () => {
    const s = section("## How a session runs");
    expect(s).toMatch(
      /An early close yields the same three parts, compact, from what the session has, and owes nothing beyond them/
    );
    // The two obligations are attached to the end-of-flow close, never to "a close".
    expect(s).not.toMatch(/every close (also )?(carries|owes)/i);
  });

  // Product decision 2026-08-08: competency and alignment are CAPABILITIES, each bound to
  // its own place in the flow, not two halves of a "Two checks — in this order" block. The
  // body now carries four of them at the same level — competency (step 2), alignment (the
  // gate after step 3 and step 9), the critical review, the delegation check — and the
  // structure says what each one is instead of a preamble defending the count.
  it("Competency check: the method of step 2, no substitute goal, no blocking", () => {
    const s = section("## Competency check");
    expect(s).toMatch(/method of step 2/i);
    expect(s).toMatch(/flag that per goal/i);
    // Change `recalibrate-tutor-support`: a replacement goal is withheld UNASKED only — on
    // the lecturer's request § Non-negotiables' consent paragraph permits drafting one.
    expect(s).toMatch(/Propose no replacement goal unless asked, not even as an example/i);
    expect(s).toMatch(/record the reservation and carry on/i);
  });

  it("Alignment check: two depths, unprompted on change, deferred without outcomes", () => {
    const s = section("## Alignment check");
    expect(s).toMatch(/where practised, where shown/i);
    expect(s).toMatch(/one check at two depths/i);
    expect(s).toMatch(/Three moments, and you take them yourself/i);
    expect(s).toMatch(/whenever a goal, activity or assessment changes/i);
    // How a change is RECOGNISED — the missing half of the trigger until 2026-08-09. The
    // rule said to run the check when something changes and never said the lecturer's own
    // statement, read against the card, is what makes the change visible.
    expect(s).toMatch(/departs from what its card holds IS that change/);
    expect(s).toMatch(/run the check without being asked/i);
    expect(s).toMatch(/name the missing upstream check and take that first/i);
  });

  // 2026-08-09: the METHOD left the body. `methodology-003` carries six mis-alignment
  // patterns; the body carried two of them inline and therefore ran a silently narrowed
  // check. The pointer is shaped like § Delegation check's — one grounding obligation, one
  // shape, so the two relocated methods read alike. Measured by eval checkpoint 12d
  // (`cite_all`); a pointer nothing measures is a rule that has been deleted.
  it("Alignment check: the pattern catalogue lives in the corpus, not in the body", () => {
    const s = section("## Alignment check");
    expect(s).toMatch(/`methodology-003`/);
    expect(s).toMatch(/read it before you run the check/i);
    expect(s).toMatch(/name no pattern you have not read there/i);
    expect(s).toMatch(/cite it where you use it/i);
  });

  it("skill body names no mis-alignment pattern of its own", () => {
    // Any of these in the body is a second, drifting copy of the corpus catalogue.
    expect(body).not.toMatch(/no assessment is a finding/i);
    expect(body).not.toMatch(/orphan assessment/i);
    expect(body).not.toMatch(/process goal, product assessment/i);
    expect(body).not.toMatch(/verb.{0,3}deliverable/i);
    expect(body).not.toMatch(/granularity mismatch/i);
    expect(body).not.toMatch(/unassessed goal/i);
  });

  it("the four capabilities sit at the same level", () => {
    for (const h of ["## Competency check", "## Alignment check", "## Critical review", "## Delegation check"]) {
      expect(body, `missing capability section: ${h}`).toContain(h);
    }
  });

  it("Maturity: read from the material, kept current, provisional, divergence named", () => {
    // Product decision 2026-08-08: the reading RUNS WITH THE WORK, the way the
    // lecturer-state estimates do. "Once per course, not per session" said the opposite —
    // establish once and work from it — which leaves the panel behind the design and the
    // closing without its data. The lecturer can also trigger a fresh reading from the
    // app at any time (the Maturity panel's Assess control dispatches it as a turn).
    const s = section("## Maturity");
    expect(s).toMatch(/not their claim/i);
    // Every direct corpus reference carries a read instruction (2026-08-09): the raster is
    // a corpus document like any other, and naming a level unread is the same defect as
    // naming a mis-alignment pattern unread.
    expect(s).toMatch(/`methodology-007`/);
    expect(s).toMatch(/Read `methodology-007` for the criteria before a reading/i);
    expect(s).toMatch(/name no unread level/i);
    expect(s).not.toMatch(/Once per course/i);
    expect(s).toMatch(/runs with the work/i);
    // "runs with the work" is now the rule that applies FROM the gate, not from the
    // opening — the reading has a starting point, asserted in its own test below.
    expect(s).toMatch(/From the gate it runs with the work/);
    expect(s).toMatch(/record the new level in the turn it moves/i);
    expect(s).toMatch(/ask for the reading at any moment/i);
    // "Kept current, the closing has the whole picture." was CUT on 2026-08-10 to fund
    // the establishment sentence below (the body is over budget, so § Maturity pays for
    // its own additions). It was motivation, not conduct: no canonical scenario asks for
    // it, and the operative half — re-record in the turn a criterion moves — is asserted
    // one line above. Do not reinstate it without funding it from this section again.
    expect(s).not.toMatch(/closing has the whole picture/i);
    // The elicited ambition is ONE level for the whole design, not seven.
    expect(s).toMatch(/one level for the design as a whole/i);
    expect(s).toMatch(/never a recorded dimension/i);
    expect(s).toMatch(/mark it provisional/i);
    expect(s).toMatch(/never assessed is unmeasurable, not a shortfall/i);
    expect(s).toMatch(/gone stale, re-check it in that same reply/i);
    expect(s).toMatch(/a finding, not an encouragement/i);
    expect(s).toMatch(/stay within the declared target/i);
  });

  // Change `stage-the-maturity-reading-behind-the-coherence-gate`. capability
  // `cbe-skill`, Requirement: *Maturity Raster Assessment and Lecturer-Facing
  // Surfacing* — Scenarios: *No reading before the coherence gate*; *The reading begins
  // at the gate and then runs with the work*.
  //
  // The section said when the reading RUNS and never when it BEGINS, so the host filled
  // the gap by demanding it as early as it could: a full seven-criterion establishment
  // was asked for on every accepted mirror write, from the first card onwards, against
  // a design that had no frame, outcomes or assessment to be read against yet. The
  // starting point is a didactic decision and belongs here — the host only enforces it
  // (`pending-answer-gate.ts`, `coherenceGatePassed`). Do not restate the host's
  // mechanics here; the gate itself is already named in the ten-steps section.
  it("Maturity: the achieved reading starts at the coherence gate after step 3", () => {
    const s = section("## Maturity");
    expect(s).toMatch(/achieved reading starts at the coherence gate after step 3/i);
    expect(s).toMatch(/before it the criteria have no subject/i);
    // An empty raster before the gate is the expected state, not a debt.
    expect(s).toMatch(/an empty raster is expected, not a gap/i);
    // …and what the skill answers when asked for a reading too early: the target
    // stands, the reading is not due, and no raster is read off the first cards.
    expect(s).toMatch(/Asked earlier, you name the recorded target/i);
    expect(s).toMatch(/not yet due and what has to settle first/i);
    expect(s).toMatch(/read none off the first cards/i);
    // The starting point is stated ONCE, in the section that owns the reading.
    expect(section("## Critical review")).not.toMatch(/coherence gate/i);
  });

  // Change `stage-the-maturity-reading-behind-the-coherence-gate`, second correction
  // (2026-08-10). capability `cbe-skill`, Requirement: *Maturity Raster Assessment and
  // Lecturer-Facing Surfacing* — Scenario: *The reading begins at the gate and then runs
  // with the work*; *The raster is read where the reading is established*.
  //
  // "Starts at" is DESCRIPTIVE and "runs with the work" is a CONTINUITY rule; neither
  // says that passing the gate is itself the moment to bring the reading into being. Run
  // `run-2026-08-10T06-50-15-314Z`, probe S14b: the model crossed the gate, narrated the
  // coherence check, declared it passed — and answered "where do we stand?" with a
  // step-coverage list. `cbe_maturity` was never called and `methodology-007` never read.
  // Both halves are asserted here: the EVENT (passing the gate opens the reading) and the
  // REDEMPTION of the corpus pointer at that event (the raster is read there, not at some
  // unnamed later moment).
  //
  // The threshold is deliberately LOW — "thin as they stand". The gate is crossed in the
  // turn the lecturer just brought something new; demanding a full seven-criterion raster
  // in that same turn is the very defect this change removed from the host notice. The
  // provisional rule in the paragraph below carries the thin first reading.
  it("Maturity: the reading begins at the gate, and the raster is read where it is established", () => {
    const s = section("## Maturity");
    expect(s).toMatch(/Passing the gate opens the reading/);
    expect(s).toMatch(/you read `methodology-007` there and establish the levels/);
  });

  it("Maturity: the first reading may be thin", () => {
    const s = section("## Maturity");
    expect(s).toMatch(/thin as they stand/);
    // The low threshold rests on the provisional rule below rather than restating it —
    // that is also what keeps the addition net-zero in a section over its budget.
    expect(s).toMatch(/mark it provisional/i);
    // …and nothing here demands a full raster in the turn the gate is crossed.
    expect(s).not.toMatch(/seven criteria|all seven/i);
  });

  // The maturity reading is what makes an overridden finding COST something instead of
  // being a polite exit. It applies to every finding the lecturer leaves standing — the
  // overridden coherence break, an open step-9 alignment finding, a waved-away review
  // finding — and `overall.note` is what carries it across the session boundary.
  it("Maturity: a finding left standing caps the reading and is stated in the limitation", () => {
    const s = section("## Maturity");
    expect(s).toMatch(/finding the lecturer leaves standing/i);
    expect(s).toMatch(/not read above what the open finding supports/i);
    // Change `show-target-and-derive-overall-maturity`: "the overall level never
    // overtakes that criterion" was an instruction to the skill about a number
    // the skill no longer produces — the host derives the aggregate and applies
    // the cap. What stays the skill's is the didactic JUDGEMENT that a finding
    // holds a criterion down, which it now MARKS so the arithmetic can respect it.
    expect(s).toMatch(/mark that criterion as capped by the reservation/i);
    expect(s).toMatch(/no aggregate overtakes it/i);
    expect(s).toMatch(/limitation names the reservation/i);
    // The cap is not the uncertainty flag — two markers, two statements.
    expect(s).toMatch(/A cap is not an uncertainty flag/i);
  });

  // Change `show-target-and-derive-overall-maturity`. capability `cbe-skill`,
  // Requirement: *Maturity Raster Assessment and Lecturer-Facing Surfacing* —
  // Scenario: *The skill records criteria and the target, not the aggregate*.
  //
  // The overall achieved level used to be a second, independent judgement the
  // skill pushed, able to disagree with the seven readings displayed beside it.
  // It is now derived by the host from the criterion levels the skill records —
  // and where nothing derives one, saying where the design stands overall stays
  // entirely the skill's job, in prose.
  it("Maturity: the skill reads criteria; the aggregate is derived from them", () => {
    const s = section("## Maturity");
    expect(s).toMatch(/Overall achievement derives from recorded criteria/i);
    expect(s).toMatch(/yours at the aggregate are that target and the limitation note/i);
    // …and where no host derives one, saying it stays the skill's job, in prose.
    expect(s).toMatch(/With nothing to derive it, state it in prose/i);
  });

  // FIVE since 2026-08-09. The list is a set of PRINCIPLES the skill can hold up to the
  // lecturer as a stance; the retired third item ("if a goal, task or assessment changes,
  // re-check the chain") was the only PROCEDURAL rule among them, and it duplicated the
  // trigger § Alignment check carries as the check's own operating rule. One rule, one
  // home: the trigger belongs to the check, not to the value list.
  // Change `recalibrate-tutor-support` (product decision 2026-10-13): item 2 no longer bans
  // artefacts by type. The first two constraints say WHO DECIDES — the lecturer, by asking,
  // correcting and accepting — so the list forbids unasked formulation and invented
  // substance, not wording the lecturer asked for. capability `cbe-skill`, Requirement:
  // *Didactic Non-Negotiables*.
  it("Non-negotiables: five, who decides, named in substance not by number", () => {
    const s = section("## Non-negotiables");
    for (const n of ["1.", "2.", "3.", "4.", "5."]) expect(s).toContain(`\n${n} `);
    expect(s).not.toContain("\n6. ");
    // The re-check trigger lives in § Alignment check and nowhere else.
    expect(s).not.toMatch(/re-check the chain/i);
    expect(s).toMatch(/\n2\. Nothing formulated for their course unasked; nothing invented stated as settled\./);
    expect(s).toMatch(/The first two say who decides: the lecturer, by asking, correcting, accepting/);
    expect(s).toMatch(/Never cite a number from this list/i);
    // Announcing Is Not Doing.
    expect(s).toMatch(/needs the work in the same turn/i);
  });

  // The retired boundary must not survive in any framing (Scenarios: *A requested
  // learning-outcome formulation is worked, not refused*; *An explicit request for a
  // finished rubric is formulated step by step*; *Repeated difficulty changes the scaffold
  // without taking over*). Each pattern is a sentence the pre-change body carried: the type
  // ban, the refusal of an explicit request, the criteria-only ceiling, the goal exclusion.
  it("Non-negotiables: no type ban, no refusal of a request, no criteria-only ceiling", () => {
    expect(body).not.toMatch(/No finished artefacts/i);
    expect(body).not.toMatch(/even when the lecturer explicitly asks/i);
    expect(body).not.toMatch(/decline with the reason/i);
    expect(body).not.toMatch(/For their own module the ceiling/i);
    expect(body).not.toMatch(/however often or directly asked/i);
    expect(body).not.toMatch(/formulated artefact for their course is never the answer/i);
    expect(body).not.toMatch(/never reaches a learning outcome or a competency formulation/i);
    expect(body).not.toMatch(/you do not build it for them/i);
  });

  // Scenarios: *Explicit formulation help delivers the text that was asked for*; *A requested
  // complete formulation of the current component is not cut down*. The consent gate and the
  // formulation scope sit in ONE sentence: any course-design text type, complete if asked.
  it("Co-construction: an explicit request or an accepted offer is consent to formulate any text type", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(/Their explicit request, or their yes to your offer, is consent/);
    expect(s).toMatch(/formulate or rewrite any course-design text for the current component/);
    for (const t of ["outcomes", "competencies", "Big Idea", "challenge", "assessment", "rubric", "schedule"]) {
      expect(s, `formulation scope must name: ${t}`).toContain(t);
    }
    expect(s).toMatch(/in full if asked/);
  });

  // Scenarios: *Unasked outcome wording stays unwritten*; *An unasked own-course formulation
  // does not follow from a guided default*; *Evidenced stuckness gets a foothold and an
  // offer, not formulated content*. Consent is an act, never an inference: every named
  // non-consent signal is a reason to OFFER, answerable with no.
  it("Co-construction: preference, knowledge, capacity, silence and difficulty are no consent", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(
      /A preference, low knowledge or capacity, silence, a short reply, an empty card or difficulty is no consent, only a reason to offer, answerable with no/
    );
    // Stuck: the foothold and the offer, not the formulation.
    expect(s).toMatch(/Stuck, they get what is usable and missing, an open structure, one question and that offer/);
  });

  // Scenarios: *Candidate options are offered when the lecturer is stuck on a design
  // artefact*; *"What exactly do I have to do here" is answered from a foreign course*. The
  // foreign-course instrument survives; an ambiguous request for examples is resolved by
  // OFFERING the own-course formulation beside it, never by giving nothing.
  it("Co-construction: examples come from a foreign course, with the own-module offer beside them", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(/asked what a step requires/i);
    expect(s).toMatch(/imagined course from another discipline/i);
    expect(s).toMatch(/cannot be lifted/i);
    expect(s).toMatch(/asked for examples, add the offer for their module/);
  });

  // The consent gate and the foreign-course instrument are ONE paragraph, so the bounded and
  // the permissive half cannot drift into two rules for one situation again (the 2026-08-09
  // run obeyed the nearer, more permissive one of two adjacent paragraphs).
  it("Co-construction: the consent gate and the foreign-course instrument are ONE paragraph", () => {
    const s = section("## Non-negotiables");
    const paragraphs = s.split(/\n{2,}/);
    const gate = paragraphs.filter((p) => /is consent/.test(p));
    expect(gate, "the consent gate must appear in exactly one paragraph").toHaveLength(1);
    expect(gate[0]).toMatch(/imagined course from another discipline/i);
    expect(paragraphs.filter((p) => /imagined course from another discipline/i.test(p))).toHaveLength(1);
  });

  // Scenarios: *A whole-course request is worked stepwise rather than handed over*; *A partial
  // attempt is used rather than discarded*. The stepwise loop — not a document-type ban — is
  // what keeps a whole-course handover out of reach.
  it("Co-construction: formulation is stepwise, and everything-at-once works the current component", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(
      /Formulate stepwise: restate what you understood, draft the current component, name gaps and assumptions, ask to correct or accept, refine/
    );
    expect(s).toMatch(/Asked for everything, work the current component and name the next/);
  });

  // Requirement *Co-Construct CBL Artefacts…*, § Unknown substance is named, never invented.
  // Every class of invented substance the spec names appears, and so does each lawful form.
  it("Co-construction: invented substance is never stated as settled", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(
      /State no invented stakeholder, need, constraint, evidence or decision as settled: leave a named gap, alternatives, a placeholder or a labelled assumption/
    );
  });

  // Scenario: *A requested goal formulation is drafted and then interrogated*. Bound by
  // reference, not by a second copy of the sharpness questions.
  it("Co-construction: a drafted goal gets the competency check's questions", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(/A goal you draft gets § Competency check's questions/);
  });

  // § Unrequested commentary stays commentary: rewording the lecturer's OWN text so they can
  // compare is help with their text, never a route to an unasked replacement.
  it("Co-construction: rewording the lecturer's own text is help, not a replacement", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(/Rewording their own text to compare is help, not a replacement/);
  });

  // Scenario: *The unasked example is licensed in one place only*. This section OWNS the
  // unasked example now — licence, trigger and condition in one paragraph.
  //
  // Change `disentangle-the-scaffolding-dial`. Until it, the two halves of the rule sat in
  // two sections that each deferred to the other: this one said "unasked only as
  // § Calibration allows" while § Calibration's lowest rung said "offer the worked example
  // unasked" and carried no condition on what the example may be. Neither passage held the
  // bound, so an unasked example had, in effect, no bound at all — the same collision
  // mechanics that produced `13b`'s 2/3 red and, one turn earlier in the flow, the product authority's
  // own case: formulated Big-Idea options for HIS module from the Big Idea onwards.
  //
  // The condition is now self-contained and locks onto the dial WITHOUT naming it: an unasked
  // example is permitted "while you explain the step", and "you explain the step" is literally
  // the lowest rung's own behaviour in § Calibration. The `prior knowledge` prohibition below
  // is what keeps that lock from turning back into a second copy of the dial.
  it("owns the unasked example: licence, trigger and condition in one place", () => {
    const s = section("## Non-negotiables");
    expect(s).toMatch(/unasked only while you explain the step/i);
    // The old circular hand-off must not come back in either direction.
    expect(s).not.toMatch(/as § Calibration allows/i);
    // The dial itself stays in § Calibration; this section must not carry a second copy.
    expect(s).not.toMatch(/prior knowledge/i);
  });

  it("Citing: index then document, no unread citation, gap stated, wiki wins", () => {
    const s = section("## Citing");
    expect(s).toMatch(/Read the index, then the document/i);
    expect(s).toMatch(/What you have not read, you do not cite/i);
    expect(s).toMatch(/Do not bulk-load the corpus or enumerate its directory/i);
    expect(s).toMatch(/ungrounded practice observation/i);
    expect(s).toMatch(/the wiki wins/i);
  });

  it("Stance: weakness first, no mirrored praise, the summary does not undo the scan", () => {
    const s = section("## Stance");
    expect(s).toMatch(/satisfaction is not a finding/i);
    expect(s).toMatch(/weakness comes first/i);
    expect(s).toMatch(/half a sentence of framing/i);
    expect(s).toMatch(/Never mirror praise/i);
    expect(s).toMatch(/does not collapse into "solid" or "needs polish"/i);
  });

  it("Calibration: the five recorded dimensions incl. the didactic stance, readings unrecorded", () => {
    const s = section("## Calibration");
    for (const d of ["PBL prior knowledge", "CBE prior knowledge", "didactic stance", "attitude", "capacity"]) {
      expect(s, `calibration must name the recorded dimension: ${d}`).toContain(d);
    }
    expect(s).toMatch(/never record and never reference as though they were recorded/i);
    // Change `disentangle-the-scaffolding-dial`: CAPACITY joins the exclusion list. The list
    // named attitude and stance only, so a low capacity reading leaked into the scaffolding
    // dial and raised support for a lecturer whose prior knowledge put him at the top rung.
    expect(s).toMatch(/Scaffolding follows PBL and CBE prior knowledge — never attitude, stance or capacity/i);
    expect(s).toMatch(/more cautious setting/i);
    expect(s).toMatch(/stands over your inference/i);
    expect(s).toMatch(/make the adjustment visible/i);
  });

  // The dimension already decided WHAT drives scaffolding; nothing said what more or less
  // of it looks like, so the rule instructed nothing observable. Three intensities, stated
  // as behaviour rather than as level names — a name would be internal vocabulary and § Register
  // forbids it reaching the lecturer.
  //
  // Change `decouple-rounds-from-the-maturity-target`, 2026-08-18. Until it, this section
  // said the depth "comes from the target" — a derivation the product invented and PIONEER
  // never states. capability `cbe-skill`, Requirement: *Adaptive Behaviour Calibration*,
  // Scenario: *The round is not derived from the declared target*. The rounds are a property
  // of the PROCESS and the maturity target one of the RESULT: a low target forbids no second
  // pass and three passes guarantee no high level, so neither reads off the other. What this
  // assertion pins is the INDEPENDENCE — a rewording back into "the target sets the depth",
  // however softened, reintroduces exactly the coupling the change removed.
  it("Calibration: the support scale is behaviour, and the rounds are an independent axis", () => {
    const s = section("## Calibration");
    expect(s).toMatch(/It shows in how a step is led/i);
    // Change `disentangle-the-scaffolding-dial`: the lowest rung used to read "offer the
    // worked example unasked and put one question" — a licence with no condition attached,
    // in a section that owns neither the instrument nor the ceiling. It now POINTS at the
    // owner instead, and the ladder still distinguishes its three rungs by where an example
    // sits (referred out · on request · none).
    expect(s).toMatch(/you explain the step and put one question, an example as § Non-negotiables allows/i);
    expect(s).toMatch(/keep the example for when it is asked/i);
    expect(s).toMatch(/no example, take several steps in one turn/i);
    expect(s).toMatch(/separate axis: neither this dial nor the target sets it/i);
    // …and the derivation must not come back in any framing, anywhere in the body.
    expect(body).not.toMatch(/comes from the target/i);
    expect(body).not.toMatch(/(depth|round|pass)\w*\s+(is\s+)?(set|decided|determined|derived)\s+by\s+the\s+target/i);
    // The intensities are described, never named — an internal label must not be a token
    // the model can hand the lecturer.
    expect(body).not.toMatch(/\banleitend\b|\bbegleitend\b|\bsparring\b/i);
    expect(body).not.toMatch(/support level (one|two|three|1|2|3)/i);
  });

  // THE MOTIVATING CASE, PINNED. Change `disentangle-the-scaffolding-dial`; capability
  // `cbe-skill`, Requirement: *Adaptive Behaviour Calibration*, Scenario: *Pronounced prior
  // knowledge with limited capacity yields the criterion, not an example*.
  //
  // Observed: a lecturer whose recorded profile is PRONOUNCED PBL and CBE prior knowledge with
  // LIMITED capacity was served formulated content he never asked for from the Big Idea
  // onwards — "ja gut übernehmen, zack, ist der Schritt erledigt". Asked about it, the
  // assistant said it had over-weighted the limited capacity and ignored the pronounced
  // knowledge. Recording the step after he stated that decision is CORRECT and is not what
  // this pins; the defect is upstream, that the offer for his own module was produced at all.
  //
  // Three sentences wired it, and this test holds all four halves of the repair together,
  // because any one of them alone lets the case come back:
  //   (a) capacity is off the dial, so a low capacity cannot lower the rung;
  //   (b) pronounced knowledge lands on the top rung, which offers NO example;
  //   (c) the more-cautious tie-breaker cannot resolve a knowledge-vs-capacity conflict
  //       toward more scaffolding or toward content;
  //   (d) § Calibration licenses no unasked example of its own.
  // Without this assertion the next rewording of the passage undoes the repair unnoticed —
  // which is how three previous tightenings of the prohibition prose left the behaviour intact.
  it("pronounced prior knowledge with limited capacity: the criterion in a sentence, no worked example", () => {
    const s = section("## Calibration");

    // (a) capacity does not drive scaffolding — it is named on the exclusion list…
    expect(s).toMatch(/Scaffolding follows PBL and CBE prior knowledge — never attitude, stance or capacity/i);
    // …and what it DOES buy is stated, bounded, and stops short of serving content.
    expect(s).toMatch(
      /Saturated capacity gets a shorter path and a named triage, never a shorter truth, no content in their place/i
    );
    // The pre-change wording ended at the truth clause and said nothing about content.
    expect(s).not.toMatch(/named triage, never a shorter truth\./i);

    // (b) pronounced knowledge is the top rung, and the top rung offers no example.
    expect(s).toMatch(/with much, you state the criterion in a sentence, offer no example/i);

    // (c) the tie-breaker reaches the finding, the disagreement and the source — and stops.
    expect(s).toMatch(
      /the more cautious setting is for the finding, the disagreement and the source, never for scaffolding or content/i
    );
    // It must never be re-attached to the dial, in this or any later framing. The immediate
    // predecessor said exactly that: "This governs the scaffolding dial, which is the only
    // dial calibration sets" (change `decouple-rounds-from-the-maturity-target`).
    expect(body).not.toMatch(/more cautious[\s\S]{0,120}scaffolding dial/i);
    expect(body).not.toMatch(/(governs|sets|drives) the scaffolding dial/i);

    // (d) § Calibration licenses no unasked example of its own — the licence lives in
    // § Non-negotiables, and this section only refers to it.
    expect(s).not.toMatch(/unasked/i);
    expect(s).toMatch(/§ Non-negotiables/);
  });

  // Change `recalibrate-tutor-support`, Requirement *Adaptive Behaviour Calibration*. The
  // profile sets the DEFAULT; a stated preference overrides it without touching a dimension and
  // is never consent to formulate. Scenarios: *Explicit preference overrides competence
  // without rewriting it*; *A support preference is proactively invited without delaying the
  // work*; *An unanswered invitation does not become a gate*; *A local help request is not a
  // lasting preference*; *Ambiguous duration does not delay local help*; *Support fades after
  // demonstrated competence*; *Acceptance and brevity are not competence evidence*.
  it("Calibration: the profile sets a default; a stated preference overrides it and is no consent", () => {
    const s = section("## Calibration");
    expect(s).toMatch(/By default scaffolding follows PBL and CBE prior knowledge/);
    expect(s).toMatch(
      /Their stated preference — step by step, help with their draft, or brief — overrides the default, changes no dimension and is no consent/
    );
  });

  it("Calibration: one invitation at the first component's hand-back, never re-asked", () => {
    const s = section("## Calibration");
    expect(s).toMatch(
      /With none recorded, make your one question at the first component's hand-back how much help they want/
    );
    // Scope comes from what the environment reports (lecturer-wide in the app, session-local
    // in a headless host), and the lecturer can change or clear it.
    expect(s).toMatch(/saying how long it lasts as the environment reports and that they can change or clear it/);
    expect(s).toMatch(/unanswered, never re-ask/);
    // The invitation describes the choices in plain words and names no internal preference
    // value (scoped to this section: "concise" is ordinary prose elsewhere in the body).
    expect(s).not.toMatch(/\b(guided|collaborative|concise)\b/);
  });

  it("Calibration: local help is not a preference; need gets help; independence fades the scaffold", () => {
    const s = section("## Calibration");
    expect(s).toMatch(/One example now is local help, not a preference; unclear, help, then ask/);
    expect(s).toMatch(/Need gets help at any level/);
    expect(s).toMatch(/independent work ends the temporary scaffold, not help they ask for/);
    expect(s).toMatch(/asking lowers no estimate, a yes raises none/);
  });

  // Change `recalibrate-tutor-support` re-cut § Calibration and the ten-steps settle sentence;
  // the RETAINED scenarios of the replaced requirements must survive that re-cut verbatim in
  // substance (Requirement *Eager Skill-Body Instruction Budget*, Scenario: *A re-cut is
  // behaviour-preserving*). One assertion per retained scenario whose sentence the re-cut touched
  // or sat beside: stance picks the example type, pushback is reframed, capacity buys triage, the
  // tie-breaker stops at the finding, the rounds stay their own axis, and the settled result is
  // referred to rather than written out twice.
  it("Calibration and recording: the retained scenarios survive the consent re-cut", () => {
    const cal = section("## Calibration");
    // *The stance changes which example, not whether there is one*.
    expect(cal).toMatch(
      /Instruction-trained lecturers get structure and assessment examples, facilitators process and coaching ones/
    );
    // *Pushback is reframed, not turned down*.
    expect(cal).toMatch(/Sceptics get evidence and mechanism, enthusiasts risks rather than amplification/);
    // *Low capacity triggers triage, not a shorter truth*.
    expect(cal).toMatch(/Saturated capacity gets a shorter path and a named triage, never a shorter truth/);
    // *The tie-breaker does not resolve toward scaffolding*.
    expect(cal).toMatch(/never for scaffolding or content/);
    // *The round is not derived from the declared target* / *A second pass at a low target is ordinary work*.
    expect(cal).toMatch(/How far the work is taken is a separate axis: neither this dial nor the target sets it/);
    // *Explicit preference overrides competence without rewriting it*: the five dimensions are unchanged.
    expect(cal).toMatch(
      /^Five recorded dimensions: PBL prior knowledge, CBE prior knowledge, didactic stance, attitude, capacity\./m
    );
    const steps = section("## How a session runs");
    // *The settled result is not written out twice*.
    expect(steps).toMatch(/refer to the card in a clause instead of restating its content/);
    // *A substantive adaptation settles only what the lecturer decided* — record what was decided.
    expect(steps).toMatch(/name what was decided → record it on its card/);
  });

  // Scenario: *The unasked example is licensed in one place only*. The failure this guards is
  // structural rather than lexical: two passages each licensing the unasked example while
  // deferring its condition to the other, so the model follows whichever is less bounded.
  // Asserted over the WHOLE body, not one section, because the pair can reappear anywhere.
  it("no passage licenses an unasked example while deferring its condition elsewhere", () => {
    // Two halves, because either one alone mis-reads the body. UNASKED: the synonym set is the
    // body's own and the canonical spec's ("a worked example offered unprompted"), so a re-cut
    // writing "offer the worked example unprompted" trips this guard instead of walking past it.
    // EXAMPLE: both words also occur far from any example — § Orientation's "propose the next
    // step, unprompted" and § Stance's "unprompted where the substance requires it" — so the
    // paragraph must also name the instrument. It is named by its vehicle rather than by the word
    // "example": the owning paragraph licenses an "imagined course from another discipline" and
    // never says "example" at all, which is why the subject side is not just /examples?/.
    const licenses = /\b(unasked|unprompted)\b/i;
    const worksAnExample = /\bexamples?\b|\bimagined course\b|\bworked\b/i;
    const licensing = body
      .split(/\n{2,}/)
      .filter((p) => licenses.test(p) && worksAnExample.test(p) && !p.startsWith("## "));
    // Exactly one paragraph may license an unasked example at all.
    expect(licensing).toHaveLength(1);
    const owner = licensing[0];
    // …and it is the one that also carries the instrument and its distance condition.
    expect(owner).toMatch(/imagined course from another discipline/i);
    expect(owner).toMatch(/cannot be lifted/i);
    // A licence that hands its condition to another section is the defect itself.
    expect(owner).not.toMatch(/as § \w+[- ]?\w* allows/i);
  });

  it("Register: no internal vocabulary reaches the lecturer", () => {
    const s = section("## Register");
    expect(s).toMatch(/machine tokens the host injects/i);
    expect(s).toMatch(/numbers from any internal list/i);
    expect(s).toMatch(/glossed once on first use/i);
    expect(s).toMatch(/never echo it/i);
  });

  it("Help: one compact turn, anchored in recorded state, no invented control", () => {
    const s = section("## Help");
    expect(s).toMatch(/one compact turn/i);
    expect(s).toMatch(/at most one follow-up question/i);
    expect(s).toMatch(/Anchor it in course state/i);
    expect(s).toMatch(/withholding an entry the environment does not report/i);
    expect(s).toMatch(/Never invent a control/i);
  });
});

describe("skill body — no anchor into a retired structure", () => {
  // Decisions A/B/C: there is no check pipeline, no third check, and exactly ONE
  // alignment check at two moments. The old body made two concepts of the alignment
  // check and then had to warn readers against confusing them; the warning was the
  // symptom, and it goes with the split.
  it("carries no third check and no pipeline", () => {
    // The defensive sentence "There is no third check and no pipeline" retired with the
    // block it defended: four sibling sections cannot read as a three-stage chain, so the
    // structure carries what the disclaimer used to. What stays asserted is the absence.
    expect(body).not.toMatch(/There is no third check/i);
    expect(body).not.toMatch(/Delegation Check/);
    expect(body).not.toMatch(/Kompetenz Check/);
    expect(body).not.toMatch(/check (execution )?order/i);
  });

  it("carries no warning against confusing two alignment checks", () => {
    expect(body).not.toMatch(/not the same as the .*[Aa]lignment/);
    expect(body).not.toMatch(/do not confuse/i);
  });

  it("carries no working-posture or Roaster machinery", () => {
    expect(body).not.toMatch(/\bRoaster\b/);
    expect(body).not.toMatch(/working posture/i);
    expect(body).not.toMatch(/transfer mode|design mode/i);
  });

  it("carries no once-per-session corpus-version rule", () => {
    // Retired as sediment: two contradictory triggers, zero checkpoints, no reader
    // would notice its absence.
    expect(body).not.toMatch(/corpus[- ]version/i);
  });
});
