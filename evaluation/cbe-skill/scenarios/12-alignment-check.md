# S12 — The alignment check

Governing passage: skill § _Alignment check_.

> **NEW 2026-08-08, product decision.** Alignment shared a scenario with the competency
> check while both were halves of a "Two checks — in this order" block. They are
> capabilities of their own now, each bound to its place in the flow, so each gets its own
> scenario. Alignment had **no probe at all** before this file: the suite measured that the
> skill _describes_ the check and never that it runs one.
>
> **Skeleton.** Two of the check's three triggers are probed here — the unprompted re-check
> when something in the chain changes, and the deferral when there are no stated outcomes
> to work against. The third, the full run at step 9, needs a design carried far enough to
> reach it and is not written yet.
>
> **NEW 2026-08-09 — the method left the body.** `methodology-003` carries six
> mis-alignment patterns; the skill body carried two of them inline ("a goal with no
> assessment is a finding; so is an assessment with no goal") and therefore ran a silently
> narrowed check. The catalogue is now delegated to the corpus, and `12d` is what keeps the
> pointer honest — without it the relocation is a deletion, the way the retired
> `references/` tree was pointed at 49 times and opened essentially never. It is shaped like
> `11c` — a `cite_all` rather than a read probe — because a citation is the stricter
> evidence and is what the lecturer sees. It is NOT justified by the 2026-08-08 zero-read
> measurement: those runs had two instrument defects (reasoning suppressed by `--model`, a
> still-conditional index read), both fixed since, and they say nothing about which wording
> produces a read.
>
> **Declared divergence (corpus source) — `12d` assumes `methodology-003` is present in the
> mounted corpus.** The eval mounts the repo's dev corpus while the app may read a downloaded
> bundle; `methodology-003` is verified present in BOTH (dev `corpus/index.json` and the
> published bundle `plan/corpus-dist/v2026-11.zip`), which is what makes this checkpoint
> valid under either. If the document leaves either corpus, re-verify before trusting a
> verdict. See `evaluation/cbe-skill/README.md` § _Parity between an eval probe and a real
> app session_.
>
> **`12e` REPAIRED 2026-08-09, same day it was written.** Its first run produced a FALSE
> NEGATIVE on gemma, and the judge said so itself: "strictly judging turn 1 alone, the naming
> and refusal to advance are present, so the failure arises only from the later capitulation."
> The rubric carried the standard turn preamble, but its PASS condition said "stay there" — a
> phrase about behaviour ACROSS TIME, handed to a judge that always sees the whole transcript
> (`AGENTS.md` § _Check the instrument_, item 2: `turn:` is inert on a judge checkpoint). The
> later change of position is not merely permitted here, it is REQUIRED: turn 2 is the express
> override, which `12f` grades. The condition is now turn-1-local and names the sibling
> checkpoint, so the judge knows the continuation is measured elsewhere. **The 2026-08-09 red
> verdict on `12e` is void for both candidates.**
>
> **`12c` REPAIRED 2026-08-11 — its FAIL list forbade what its own PASS clause described.**
> The PASS text asked for "coarse and early over challenge, outcomes and assessment, then
> complete and late across activities and deliverables"; the FAIL list forbade "separate
> names". At n=3 (gemma, `eb53ec7`) r3 opened _"Ja, es ist dieselbe Prüfung, aber in einer
> anderen **Tiefe** und mit einem anderen **Umfang**"_ and then delivered precisely that
> contrast — and was failed for it, because it used the product's own two labels and handed
> the moments different scopes. The canonical spec REQUIRES the contrast (`cbe-skill`,
> Scenario _The coherence gate and step 9 are the same check_) and the skill body carries both
> labels, so neither can be a failure condition. r2 is untouched by the repair and still fails
> ("Ja, das ist eine grundlegend andere Prüfung"). **The 2026-08-11 red verdict on `12c` is
> void for gemma4-31b.**
>
> **NEW 2026-08-17 — the trigger is now surfaced by the HOST, and no checkpoint moved.**
> `surface-the-alignment-recheck-from-canvas-state` carries the finding this scenario produced
> (task 10.1 of `archive/2026-08-15-repair-eval-rubrics-and-the-sham-check-boundary`): `12a`
> reached one direction of the check because `methodology-003` — which carries the six-pattern
> catalogue, orphan assessment among them — was never in the session, which is what `12d`
> measured at 0/3. The repair is NOT an enumeration in the skill body: the canonical requirement
> forbids one, and `govern-the-flow-by-canvas-state-and-profile` task 2.2 removed exactly that
> inlined pair. Instead an accepted `cbe_canvas` set that CHANGES a triad corner — step 2
> `learningoutcomes`, 3 `assessmentblueprint`, 7 `activityplan`, while the goals corner and one
> other are on record — now carries an `[alignment]` notice on its result, naming the corner that
> moved, the re-check as due in that response over the whole triad on record, and
> `methodology-003` as the catalogue to read in this session. A re-push the mirror already holds
> carries none, and the demand is stated with the sharp-outcomes condition on it, so it does not
> foreclose the deferral the canonical check requires where outcomes are on record but not yet
> sharp. On S12b's design nothing is on record at all, so no notice fires there and `12b` measures
> the same behaviour it always did.
>
> **No checkpoint in this file changed, deliberately** — only this note. `12a` and `12d` already
> measure exactly the outcome, their anchors still point at the rule — which stays in the skill, and a tool RESULT is
> none of the three anchor channels — and the probe already provokes a canvas write by changing
> an activity in a design that carries all three corners. What changed is what a verdict MEANS.
> Pre-2026-08-17 verdicts describe a session in which nothing surfaced the trigger at all.
> Afterwards: a red `12d` says the notice did not fire, and the first thing to check is whether
> the turn contained an accepted corner write that actually MOVED the corner — the notice rides
> such a write, so a change the model discusses and never mirrors gets none, and neither does a
> re-push of a card the mirror already holds unchanged. A green `12d` with a red `12a` would be a
> genuine one-directional-check finding for the first time, with the catalogue demonstrably in the
> session. **Read `12a` and `12d` together; `12a` alone cannot be attributed.**

> **NEW 2026-08-09.** `12c` measures the one-concept rule. The skill states "one check at
> two depths" in exactly one place now — until this date the flow section carried a second
> copy of the statement, and _nothing measured whether the model actually treats the two
> moments as one check._ The probe has to PROVOKE the answer: a checkpoint that merely
> watches for the model calling them two different checks would pass by absence in every
> transcript that never mentions step 9 at all.

## Setup

- **Environment profile:** app
- **Canvas prior (S12):** a design carried as far as step 7 — frame with the initial
  challenge idea, challenge, outcomes, assessment, activities — deliberately mismatched: one
  outcome the assessment never evidences, and one assessment component no outcome asks for.
  Both directions are findings under the skill. **The frame and the challenge were added
  2026-08-09**: the first version held only steps 2, 3 and 7, which is a state a real design
  cannot be in, and it left the check with no challenge to hold the outcomes against — the
  very artefact the coherence gate compares. The mismatch itself is unchanged, so `12a`
  measures exactly what it measured before.
- **Probes:** the lecturer changes an activity in a design that already carries goals and
  an assessment; and a bare request for the check with nothing stated yet.

## Pass criteria

- [ ] **12a** — the check runs without being asked when something in the chain changes,
      and reports both directions: a goal with no assessment, and an assessment with no
      goal.
- [ ] **12b** — with no stated outcomes to work against, the check is deferred and the
      missing upstream work is named rather than half-answered.
- [ ] **12c** — asked outright how the check after step 3 relates to the alignment check at
      step 9, the answer is one check at two depths — coarse and early, complete and late —
      not two different checks.
- [ ] **12d** — the findings are grounded on the corpus catalogue rather than improvised:
      the turn that reports them cites `methodology-003`.
- [ ] **12e** — with steps 1–3 incoherent and no instruction from the lecturer about how to
      proceed, the skill names the break and stays there; it does not propose step 4.
- [ ] **12f** — when the lecturer hears the break and expressly decides to work elsewhere
      anyway, the skill works there AND the open break lands in the maturity reading.

## Failure modes to watch for

- Waiting to be asked after the lecturer changes a goal, an activity or an assessment.
- Reporting only the goals that lack an assessment and staying silent on the assessment
  that no goal asks for — the check runs in both directions.
- Running the check against an empty goal set and producing a verdict anyway.
- Naming a mis-alignment pattern from training while `methodology-003`, which defines the
  catalogue, goes unread — the same failure the retired `references/` tree died of.
- Proposing step 4 as the next step over an incoherent 1–3, or naming the break and
  deepening on top of it in the same turn.
- Holding the lecturer at the gate after they expressly decided to move on — the corpus
  addresses a design team reviewing its own work, not an assistant refusing a user.
- Following the override and letting the break evaporate: no maturity consequence anywhere.
- Treating the coarse gate after step 3 and the full run at step 9 as two different
  checks — presenting them as two concepts, giving them separate purposes, or announcing
  that a second, other check follows later.
- The mirror-image over-correction, which `12c` must NOT fail: naming the two moments with
  the product's own labels ("Coherence Gate", "Alignment Check") and contrasting their depth
  and scope, while stating they are the same check. The canonical spec REQUIRES that
  contrast — "the early one coarse over challenge, outcomes and assessment, the late one
  complete with the matrix" — and the skill body carries both labels itself.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S12"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Gebaeudetechnik, 5. Semester, 6 ECTS, 24 Studierende, Praesenz. Erste Idee: Studierende begleiten die energetische Sanierung eines Quartierschulhauses, Anspruchsgruppe ist die Liegenschaftsverwaltung."
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Erarbeitet fuer das Schulhaus Feldegg eine Sanierungsempfehlung und vertretet sie vor der Liegenschaftsverwaltung."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "1) Studierende erstellen und interpretieren eine Energiebilanz. 2) Studierende moderieren eine Aushandlung mit Anspruchsgruppen."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Individuelles Auswertungsprotokoll zur Energiebilanz, benotet. Zusaetzlich ein Reflexionsjournal ueber die eigene Lernstrategie, benotet."
            state: "done"
          - step: 7
            id: "activityplan"
            label: "Aktivitaeten"
            value: "Zwei Vorlesungen zu Energiebilanzen, eine Rechenuebung."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "refined"
            focus: false
          - step: 2
            depth: "refined"
            focus: false
          - step: 3
            depth: "refined"
            focus: false
          - step: 4
            depth: "refined"
            focus: false
          - step: 7
            depth: "rough"
            focus: true
      turns:
        - "Ich streiche die Rechenuebung und ersetze sie durch eine Exkursion ins Gebaeudemanagement."
      checkpoints:
        - id: "12a"
          type: "judge"
          anchor: "skill:SKILL.md#where practised, where shown"
          rubric: >-
            The lecturer changed an activity and asked for nothing else. Unprompted, the
            response checks goals against activities and assessment and reports BOTH
            directions on the recorded design: the moderation outcome that no assessment
            evidences, AND the reflection journal that no stated outcome asks for. PASS
            requires both findings and no request from the lecturer to run the check.
            FAIL if the check is only offered rather than run, if only one direction is
            reported, or if the response simply accepts the swap and moves on.
        - id: "12d"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#a pattern you did not read there"
          check:
            kind: "cite_all"
            ids: ["methodology-003"]
    - probe: "S12b"
      setup:
        profile: "app"
      turns:
        - "Kannst du mal pruefen, ob mein Modul in sich stimmig ist?"
      checkpoints:
        - id: "12b"
          type: "judge"
          anchor: "skill:SKILL.md#name the missing upstream check and take that first"
          rubric: >-
            Nothing is on record: no outcomes, no assessment, no design. The response says
            the check has nothing to work against yet, names the missing upstream work
            (the stated outcomes, and how each is assessed), and takes that first. FAIL if
            it produces a coherence verdict anyway, invents a design to check, or asks a
            battery of questions instead of naming the one thing that is missing.
    - probe: "S12c"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Nachhaltige Logistik, 4. Semester, 6 ECTS, 24 Studierende, Praesenz. Erste Idee: Studierende arbeiten an der Warenanlieferung eines lokalen Spitals."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "1) Studierende bewerten eine Lieferkette anhand von Nachhaltigkeitskriterien. 2) Studierende verhandeln Zielkonflikte mit Anspruchsgruppen."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Bewertungsbericht zur Lieferkette, benotet. Protokollierte Aushandlungssitzung mit dem Spital, formativ mit Feedback."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "refined"
            focus: false
          - step: 2
            depth: "refined"
            focus: false
          - step: 3
            depth: "refined"
            focus: true
      turns:
        - "Rahmen, Lernziele und Assessment stehen. Was schaust du dir an, bevor wir zur Challenge weitergehen?"
        - "In Schritt 9 steht ja auch nochmal ein Alignment-Check. Ist das dann eine andere Pruefung als die, die du gerade gemacht hast?"
      checkpoints:
        - id: "12c"
          type: "judge"
          anchor: "skill:SKILL.md#one check at two depths"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            second assistant turn; the others are context only. The lecturer asked outright
            whether the check at step 9 is a different one from what just ran after step 3.
            PASS requires the answer to state that the two moments are ONE check, and to
            describe the difference between them as one of depth or scope — coarse and early
            over challenge, outcomes and assessment, then complete and late across activities
            and deliverables.
            DESCRIBING THAT DIFFERENCE IS REQUIRED, NOT A FAILURE. Saying the later pass adds
            the activities, adds the matrix, goes into more detail, or covers more of the
            design is exactly the PASS. Using the product's own labels for the two moments —
            "Coherence Gate" for the early one, "Alignment Check" for the late one — is
            likewise a PASS, provided the answer states they are the same check: the skill
            itself carries both labels, so a label cannot be the failure.
            FAIL on any ONE of three things: the answer presents them as two different checks
            or two concepts (for example "das ist eine grundlegend andere Prüfung"); it gives
            them separate purposes in a way that makes them different audits rather than the
            same audit at different depths; or it says only "yes, at step 9 we check again"
            without stating that it is the same check, deepened.
    - probe: "S12d"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Digitale Fertigung, 5. Semester, 6 ECTS, 30 Studierende. Erste Idee: Studierende begleiten die Umstellung einer Werkstatt auf additive Fertigung."
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
          - step: 3
            depth: "refined"
            focus: true
      turns:
        - "Rahmen, Lernziele und Assessment stehen so weit. Machen wir mit der Challenge weiter."
        - "Verstanden, aber ich will das jetzt nicht aufrollen. Ich moechte heute an der Challenge arbeiten."
      checkpoints:
        - id: "12e"
          type: "judge"
          anchor: "skill:SKILL.md#never move past it on your own"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Everything the assistant says in turn 2 or later is
            OUTSIDE this checkpoint and MUST NOT influence the verdict — in this probe the
            lecturer expressly overrides in turn 2 and the assistant is REQUIRED to follow
            there, which checkpoint 12f grades. A later change of position is therefore
            correct behaviour here, never evidence against turn 1.
            The recorded design cannot cohere: both outcomes are performance outcomes
            (leading a team through a changeover, justifying material decisions to the
            workshop lead) while the only assessment is a written end-of-term exam. The
            lecturer asked to move on to the challenge and gave no instruction about the
            break. Judging turn 1 in isolation, PASS requires two things IN THAT TURN: it
            names that the assessment cannot evidence those outcomes, and it does not work
            step 4 in that same turn. FAIL only on what turn 1 contains — it proposes or
            works the challenge, it names the break and deepens into step 4 anyway, or it
            merely offers to check coherence at some later point instead of naming the
            break now.
        - id: "12f"
          type: "judge"
          anchor: "skill:SKILL.md#decides to go on anyway, you follow"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn; the others are context only. The lecturer has heard the
            break and expressly decided to work on the challenge today regardless. PASS
            requires BOTH: the response works the challenge with the lecturer (it does not
            hold them at the break, does not re-argue it, does not condition the work on
            resolving it first), AND it states that the open break limits how far the design
            can be read as developed — a capped or provisional maturity reading, or an
            explicitly recorded limitation. FAIL if it refuses or stalls, and FAIL if it
            simply complies and the break disappears from the answer with no consequence
            named.
```
