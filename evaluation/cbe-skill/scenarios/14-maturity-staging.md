# S14 — Maturity staging

Governing passage: skill § _Maturity_ — the achieved reading has a STARTING POINT since the
change `stage-the-maturity-reading-behind-the-coherence-gate`, and it is the coherence gate
after step 3. Before the gate the seven criteria have no subject to be read against, so an
empty raster is the expected state; from the gate the existing rule applies unchanged and the
reading runs with the work.

> **Why this scenario exists.** § _Maturity_ said when the reading RUNS and never when it
> BEGINS. The host filled that gap by demanding a full seven-criterion establishment on every
> accepted mirroring write, from the very first card — so a lecturer working through steps 1
> to 3 got a maturity paragraph in every turn, read off a design that had no frame, outcomes
> and assessment held against each other yet. The rule is now stated in the skill and enforced
> by the host (`coherenceGatePassed`, `packages/pi-bridge/src/pending-answer-gate.ts`); the two
> probes below measure the two sides of it, because a rule that only ever holds in one
> direction is a rule nobody has tested.

> **What this scenario does NOT measure, since `close-the-flow-when-the-cards-are-full`
> (2026-08-11):** the reading now has a second occasion — the end-of-flow close owes one
> whether or not a critical review was accepted. The staging is unchanged by that (nothing
> before the gate; established from it), and no checkpoint here encodes anything about a
> close. The close's reading is measured in `05-closing.md`, probes `S5c` / `S5d`.

> **Both probes carry a recorded overall target.** That is what makes the measurement clean:
> with the ambition already on record, ANY `cbe_maturity` call before the gate is an achieved
> reading and nothing else, and after the gate the establishment is the only thing left to do.
> Remove the target from either fixture and `14b` starts failing a model that is correctly
> recording an ambition it just elicited.

## Setup

- **Environment profile:** app
- **S14 — before the gate:** the frame and the learning outcomes are on their cards, step 3
  (assessment) is untouched, and the lecturer asks for an overall assessment of where the
  module stands.
- **S14b — past the gate:** the same design with the assessment blueprint settled as well, so
  steps 1 to 3 are all off `open` and the gate is passed. No achieved reading exists yet.
- **S14c — past the gate, with a finding the lecturer keeps:** steps 1 to 3 are settled, but
  the only assessment is a written exam against two performance outcomes, and the lecturer
  says in their own turn that they have heard the mismatch and are keeping the exam. The
  finding is therefore NAMED and STANDING in the turn the reading is asked for — which a cold
  probe cannot otherwise establish, since nothing was raised in an earlier turn.

## Pass criteria

- [ ] **14a** — asked where the design stands before the gate, the response names the recorded
      target, says the achieved reading is not due yet and what has to be settled first, and
      delivers no seven-criterion raster read off the two cards that exist.
- [ ] **14b** — and it records none either: no `cbe_maturity` call before the gate, since the
      target it would carry is already on record.
- [ ] **14c** — past the gate the reading is recorded, not only reasoned about.
- [ ] **14d** — and it reaches the lecturer as a reading: levels named per criterion in the
      lecturer's terms, with no level asserted that the design does not carry.
- [ ] **14e** — and the reading rests on the raster rather than on the model's own notion of
      the criteria: the turn cites `methodology-007`, which the session can only do honestly
      by opening it.
- [ ] **14f** — and it records CRITERIA: no `cbe_maturity` record sets an achieved level on
      the `overall` row, which the host derives from the criterion levels.
- [ ] **14g** — S14c: where the lecturer expressly leaves an alignment finding standing, the
      criterion it holds down is recorded as capped by that reservation, so the derived
      aggregate cannot overtake it.

## Failure modes to watch for

- A seven-criterion raster read off a frame and a set of outcomes, because the question was
  asked.
- Refusing the question outright instead of answering it with the target, the reason, and the
  missing piece — the lecturer asked something legitimate and gets a straight answer.
- Re-asking for the target ambition that the descriptor reports as recorded.
- Past the gate: a reading described in prose while the panel stays empty, or an establishment
  that fabricates levels for criteria the design carries no evidence for.
- Past the gate: crossing the gate, narrating the coherence check, declaring it passed — and
  then answering "where do we stand?" with a step-coverage list. That is what
  `run-2026-08-10T06-50-15-314Z` recorded, with `methodology-007` never opened.

> **Why `14e` exists (ADDED 2026-08-10).** In that run S14b read `corpus/index.json` and
> `methodology-012`, and never the raster § _Maturity_ points at. With only `14c` and `14d` on
> the probe, a red pair cannot be read: it is either a model that would not deliver a reading,
> or a model that never held the instrument to read one with. `14e` separates the two. It is
> the deterministic pair to `11c` and rests on the same argument — a citation is a stricter
> demand than a read, and the product asks for it here anyway (the `cbe_maturity` description
> requires a surfaced reading to carry its `methodology-007` citation). Its known limit: a
> well-formed token written from memory would pass it without a read, because no implemented
> deterministic kind asserts that a NAMED document was `read` (`readACorpusDocument` is a
> run-level metric, not a check kind). If that hole ever shows in a transcript, the cheap
> closure is a `cite_provenance` companion on the same probe.

> **Why `14f` and `14g` exist (ADDED by `show-target-and-derive-overall-maturity`).** The
> overall achieved level is no longer the skill's to produce: the host derives it from the
> criterion levels, so a pushed aggregate is a second judgement able to disagree with the
> seven readings beside it. `tool_called` sees only THAT `cbe_maturity` fired and the judge is
> handed tool names without their arguments, so both rules needed a checkpoint that reads the
> payload's shape — `maturity_no_pushed_aggregate` and `maturity_cap_marked`. `14g` gets its
> own probe rather than riding S14b: the capping marker is only due where a finding STANDS,
> and S14b's design carries none, so a checkpoint on it there would fail a compliant model.
> The mirror image of the same rule is `12f`, which grades in prose that the open break costs
> the reading something; `14g` measures that the cost was RECORDED.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S14"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Modulrahmen"
            value: "Umwelttechnik, 4. Semester, 7 Wochen, 30 Studierende. Thema: Trinkwasser in der Gemeinde."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende bewerten die Trinkwasserqualität einer Gemeinde und leiten begründete Massnahmen ab."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "refined"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Wo steht mein Modul denn jetzt insgesamt? Gib mir eine Einschätzung."
      checkpoints:
        - id: "14a"
          type: "judge"
          anchor: "skill:SKILL.md#achieved reading starts at the coherence gate after step 3"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            first assistant turn. The design has a frame and learning outcomes; the assessment
            (step 3) is untouched, so the coherence gate after step 3 has not been reached. An
            overall target ambition is already on record. PASS when the response does all
            three: it names the recorded ambition as established, it says the assessment of
            where the design stands is not due yet, and it names what still has to be settled
            for it to become possible. FAIL if it delivers a maturity reading anyway — a
            per-criterion raster, levels named across the criteria, or an overall level for the
            design — read off the two cards that exist. FAIL as well if it re-asks the target
            ambition that is already recorded, or if it simply declines the question without
            naming the target and the missing piece. Naming the seven criteria as what WILL be
            assessed later is not a reading and does not fail.
        - id: "14b"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#an empty raster is expected, not a gap"
          check:
            kind: "tool_not_called"
            tool: "cbe_maturity"
    - probe: "S14b"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Modulrahmen"
            value: "Umwelttechnik, 4. Semester, 7 Wochen, 30 Studierende. Thema: Trinkwasser in der Gemeinde."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende bewerten die Trinkwasserqualität einer Gemeinde und leiten begründete Massnahmen ab."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Gruppenbericht mit Zwischenpräsentation in Woche 4, plus individuelle Reflexion am Ende."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "refined"
            focus: false
          - step: 3
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Die Prüfungsform steht jetzt auch. Wo stehen wir?"
      checkpoints:
        - id: "14c"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#From the gate it runs with the work"
          check:
            kind: "tool_called"
            tool: "cbe_maturity"
        - id: "14d"
          type: "judge"
          anchor: "skill:SKILL.md#You read the achieved level from what the lecturer brings"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            first assistant turn. Frame, learning outcomes and assessment are all settled, so
            the design now carries a subject the criteria can be read against. PASS when the
            response delivers an assessment of where the design stands — levels named in the
            lecturer's own terms, per criterion or as an overall picture with the criteria
            behind it — and where the evidence is thin says so rather than asserting a level.
            FAIL if it delivers no assessment at all, if it only announces that it will assess
            later, or if it asserts levels the described design gives no basis for (a
            stakeholder or impact level, say, on a design that names neither). Whether the
            reading was also mirrored to the panel is a separate checkpoint and is not yours to
            grade.
        - id: "14e"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#Read `methodology-007` for the criteria before a reading"
          check:
            kind: "cite_all"
            ids: ["methodology-007"]
        - id: "14f"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#yours at the aggregate are that target and the limitation note"
          check:
            kind: "maturity_no_pushed_aggregate"
    - probe: "S14c"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Modulrahmen"
            value: "Digitale Fertigung, 5. Semester, 6 ECTS, 30 Studierende. Studierende begleiten die Umstellung einer Werkstatt auf additive Fertigung."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "1) Studierende leiten ein Fertigungsteam durch einen Umstellungsprozess. 2) Studierende begruenden Materialentscheidungen gegenueber der Werkstattleitung."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Schriftliche Einzelklausur am Semesterende, 90 Minuten, benotet. Sonst nichts."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "refined"
            focus: false
          - step: 3
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Sie haben mir gesagt, dass die Einzelklausur die beiden Lernziele nicht abdeckt. Das lasse ich bewusst so stehen, die Klausur bleibt. Wo stehen wir jetzt mit der Reife?"
      checkpoints:
        - id: "14g"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#mark that criterion as capped by the reservation"
          check:
            kind: "maturity_cap_marked"
```
