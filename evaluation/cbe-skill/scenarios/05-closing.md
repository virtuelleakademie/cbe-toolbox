# S5 — Closing

Governing passage: skill § _How a session runs · 3. Closing_.

> **`5b` REPAIRED 2026-08-09, the day after it was written.** It contradicted `5c`. `5c`
> REQUIRES the critical review to be offered at the close; `5b` failed a response that
> "proposes further design work". gemma did exactly what the pair demands — closed cleanly and
> offered the review — and scored green on `5c` and red on `5b` for the same sentence. `5b`
> now exempts the review offer by name. Two checkpoints on one turn must not be able to
> contradict each other; when they can, the pair is the defect, not the model.

> **The two closes are different obligations since `close-the-flow-when-the-cards-are-full`
> (2026-08-11).** The three parts are unchanged and the EARLY close owes nothing beyond
> them — `5a` says so by name, so it cannot drift toward the end-of-flow contract. The
> END-OF-FLOW close additionally carries a maturity reading against the recorded target and
> the open inventory in full. `S5c` and `S5d` measure those two additions; `S5` and `S5b`
> measure the unchanged behaviour and are not touched by them.

> **`5i` ADDED and `5b` RE-EXEMPTED 2026-08-18 (`decouple-rounds-from-the-maturity-target`).**
> The rounds are no longer a dependent quantity of the maturity target, so a further pass is
> the lecturer's own option at any target — and § _3. Closing_ now says the close names one as
> AVAILABLE and never as outstanding, with stopping a legitimate end. That collides with `5b`
> in exactly the way `5b` once collided with `5c`: `5b` fails a close that "proposes further
> design work", and the new behaviour deliberately mentions further work. `5b` therefore gains
> a second named exemption, and `5i` grades the same sentence from the other side — available
> passes, outstanding fails. The two were written together; a run that reds both at once is a
> pair defect, not two findings.
>
> **NOTHING WAS MEASURED.** No eval run is part of that change (product decision 2026-08-18),
> so `5i` enters the map `unmeasured` and the change claims no effect on `5b` or on any other
> checkpoint in either direction. Whoever next runs scenario 5 reads `5b` and `5i` together.

## Setup

- **Environment profile:** app
- **S5 — early close:** the lecturer wraps up mid-design, before the draft is coherent — so
  the early-close branch is the one under test, which is where a prose-only recap is most
  tempting.
- **S5b — the full backbone:** every card on record and no request to stop, so the skill has
  to come to the close by itself and offer the review there.
- **S5c — end of flow, target recorded:** steps 1 to 8 are worked, steps 9 and 10 carry
  nothing, an overall target ambition is on record, and the lecturer struck the formative
  interim presentation in the previous turn knowing what it costs. That fixture is what makes
  the two additions measurable at once: something to compare the reading against, two empty
  cards and one standing reservation to inventory. No critical review is ever accepted — the
  whole point is that the confrontation must not depend on one.
- **S5d — end of flow, no target ever recorded:** the same design with the maturity prior
  removed, so the close has an absence to name rather than an ambition to compare against.

## Pass criteria

- [ ] **5a** The closing names what stands, what is open, and what comes next — with the
      next steps phrased as the lecturer's own decisions and preparations, never as
      artefacts the skill authored for them. Nothing further is owed: this is an early close.
- [ ] **5b** With every card of the backbone filled and no request to stop, the skill moves
      to the close of its own accord instead of proposing further design work.
- [ ] **5i** _(new 2026-08-18, unmeasured)_ A further pass is treated as available rather
      than outstanding, and stopping where the design stands is not called unfinished.
- [ ] **5c** The critical review is offered at the close — § _Critical review_ regulates
      what happens after an offer is accepted, so without the offer that path never fires.
- [ ] **5d** At the end of the flow the close states where the design landed and holds that
      against the recorded overall target — without waiting for a review to be accepted.
- [ ] **5e** — and it records the reading rather than only reasoning about it.
- [ ] **5f** The open inventory is stated once and in full immediately before the next steps:
      the empty cards AND the finding the lecturer left standing.
- [ ] **5g** The close stays a close — not an eleventh step, and no authored artefact content
      for the lecturer's own module.
- [ ] **5h** Where no overall target was ever recorded, the close names that absence instead
      of substituting a modest ambition for it.

## Failure modes to watch for

- A prose recap of the conversation with no open points and no next steps.
- "Next steps" delivered as a drafted Big Idea, an authored task text, or a rubric.
- Declining to close because the work is unfinished.
- Proposing an eleventh step, or a fresh design topic, on a backbone that is complete.
- Closing without ever offering the review, so its acceptance rule can never be reached.
- At the end of the flow: a reading delivered in prose while the panel stays empty, or a
  comparison made conditional on the lecturer accepting the review first.
- The inventory dissolved into passing clauses across the three parts, or moved behind the
  next steps where it can no longer inform them.
- A missing target quietly replaced by a modest one, so the design is measured against an
  ambition nobody ever declared.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S5"
      setup:
        profile: "app"
      turns:
        - "Ich will ein Modul zu nachhaltiger Logistik aufbauen, ein erster Schritt. Die Studierenden sollen Lieferketten bewerten können."
        - "Lass uns hier aufhören für heute."
      checkpoints:
        - id: "5a"
          type: "judge"
          anchor: "skill:SKILL.md#3. Closing"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the second assistant turn; the others are context only.
            The closing delivers all THREE parts — what stands, what is still open, and
            what comes next — drawn from the session so far, in compact form. The
            "what comes next" part names preparations and decisions that stay in the
            lecturer's authority. FAIL if it is a prose recap without open points or next
            steps, if any of the three parts is missing, or if the next steps hand over
            authored content (a drafted Big Idea, a written task brief, a rubric).
            THIS IS AN EARLY CLOSE and owes nothing beyond the three parts: a maturity
            reading against the declared target and a full inventory of every empty card
            are obligations of the END-OF-FLOW close only (probes S5c and S5d). Their
            absence here is not a failure, and their presence is not one either.
    - probe: "S5b"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Verkehrsplanung, 5. Semester, 6 ECTS, 20 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende entwickeln und begruenden ein Erschliessungskonzept fuer ein Quartier."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Konzeptdossier benotet, Zwischenpraesentation formativ mit Feedback."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Mobilitaet als Voraussetzung von Teilhabe."
            state: "done"
          - step: 4
            id: "eq"
            label: "Leitfrage"
            value: "Wie erreichen wir ein Quartier ohne eigenes Auto?"
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Entwickelt fuer das Quartier Gaertnerweg ein Erschliessungskonzept und stellt es dem Stadtplanungsamt vor."
            state: "done"
          - step: 5
            id: "stakeholderplan"
            label: "Anspruchsgruppen"
            value: "Stadtplanungsamt: Kickoff, Zwischenreview, Schlusspraesentation."
            state: "done"
          - step: 6
            phase: "engage"
            id: "es"
            label: "Engage Sequence"
            value: "Wochen 1-2: Quartierbegehung, Schaerfung der Challenge, Teambildung."
            state: "done"
          - step: 6
            phase: "investigate"
            id: "is"
            label: "Investigate Sequence"
            value: "Wochen 3-6: Wegetagebuecher, Zaehlungen und Interviews, Auswertung zum Bedarfsprofil je Bewohnendengruppe."
            state: "done"
          - step: 6
            phase: "act"
            id: "as"
            label: "Act Sequence"
            value: "Wochen 7-11: Varianten fuer Bus, Velo und Sharing ausarbeiten, bevorzugte Variante mit Kostenschaetzung, Testwoche im Quartier."
            state: "done"
          - step: 6
            phase: "reflect"
            id: "rs"
            label: "Reflect Sequence"
            value: "Wochen 12-14: Auswertung der Testwoche und Schlusspraesentation vor dem Stadtplanungsamt."
            state: "done"
          - step: 7
            id: "activityplan"
            label: "Aktivitaeten"
            value: "Feldwoche, zwei Werkstattbloecke, Coaching-Termine."
            state: "done"
          - step: 8
            id: "deliverablesmap"
            label: "Abgaben"
            value: "Bedarfsprofil Woche 5, Variantenvergleich Woche 9, Dossier Woche 14."
            state: "done"
          - step: 9
            id: "alignmentmatrix"
            label: "Alignment"
            value: "Erschliessungskonzept: geuebt in Werkstattbloecken, gezeigt im Dossier."
            state: "done"
          - step: 10
            id: "readinesschecklist"
            label: "Bereitschaft"
            value: "Raeume gebucht, Amt zugesagt, Datenschutz geklaert."
            state: "done"
        stepCoverage:
          - step: 10
            depth: "detailed"
            focus: true
      turns:
        - "Danke, die Bereitschaftsliste passt so."
      checkpoints:
        - id: "5b"
          type: "judge"
          anchor: "skill:SKILL.md#once the cards are full"
          rubric: >-
            Every card of the ten-step backbone is on record and the lecturer has just
            confirmed the last one. They did NOT ask to stop. PASS requires the response to
            move to the close of its own accord — naming what stands, what is open and what
            comes next. FAIL if it proposes an eleventh design step, opens a new design
            topic, or merely acknowledges the confirmation and waits for instructions.
            EXPLICIT EXEMPTION: offering a critical review of the finished design, and asking
            whether to run it, is REQUIRED here and is graded by 5c — it is never "further
            design work" for this checkpoint, and a closing that contains it still passes.
            SECOND EXPLICIT EXEMPTION: naming that the design could be taken through another
            pass, as something AVAILABLE to the lecturer, is likewise never "further design
            work" here and is graded by 5i. A closing that mentions a further pass still
            passes this checkpoint. What still FAILS is proposing a specific next design step
            to work on now, which is a different act from saying another pass is open.
        - id: "5i"
          type: "judge"
          anchor: "skill:SKILL.md#Another pass is available, never outstanding"
          rubric: >-
            The whole backbone is filled and the lecturer has just confirmed the last card.
            Judge ONE thing: how the response treats the possibility of working the design
            further. PASS if it either says nothing about a further pass at all, or names one
            as AVAILABLE — something the lecturer may take up if they want it — while
            treating stopping here as a legitimate end. FAIL if a further pass is presented
            as work still owed: the design called unfinished or incomplete, a recommendation
            to go another round, a close made conditional on more work, or the state reached
            characterised as a shortfall the lecturer ought to repair. Naming what is still
            open, or a shortfall against a recorded maturity target, is NOT a failure — those
            are separate obligations (5f, 5d) and this checkpoint judges only whether the
            response presses the lecturer onward.
        - id: "5c"
          type: "judge"
          anchor: "skill:SKILL.md#Offer the critical review here"
          rubric: >-
            The design is complete and the session is closing. PASS requires the response to
            OFFER a critical review of the finished design — an examination from the
            students' side — as something the lecturer can take up. FAIL if no review is
            offered at all. Performing the review uninvited also passes, as long as the
            lecturer is not left without the option.
    - probe: "S5c"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Verkehrsplanung, 5. Semester, 6 ECTS, 20 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende entwickeln und begruenden ein Erschliessungskonzept fuer ein Quartier."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Konzeptdossier benotet, Zwischenpraesentation formativ mit Feedback."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Mobilitaet als Voraussetzung von Teilhabe."
            state: "done"
          - step: 4
            id: "eq"
            label: "Leitfrage"
            value: "Wie erreichen wir ein Quartier ohne eigenes Auto?"
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Entwickelt fuer das Quartier Gaertnerweg ein Erschliessungskonzept und stellt es dem Stadtplanungsamt vor."
            state: "done"
          - step: 5
            id: "stakeholderplan"
            label: "Anspruchsgruppen"
            value: "Stadtplanungsamt: Kickoff, Zwischenreview, Schlusspraesentation."
            state: "done"
          - step: 6
            phase: "engage"
            id: "es"
            label: "Engage Sequence"
            value: "Wochen 1-2: Quartierbegehung, Schaerfung der Challenge, Teambildung."
            state: "done"
          - step: 6
            phase: "investigate"
            id: "is"
            label: "Investigate Sequence"
            value: "Wochen 3-6: Wegetagebuecher, Zaehlungen und Interviews, Auswertung zum Bedarfsprofil je Bewohnendengruppe."
            state: "done"
          - step: 6
            phase: "act"
            id: "as"
            label: "Act Sequence"
            value: "Wochen 7-11: Varianten fuer Bus, Velo und Sharing ausarbeiten, bevorzugte Variante mit Kostenschaetzung, Testwoche im Quartier."
            state: "done"
          - step: 6
            phase: "reflect"
            id: "rs"
            label: "Reflect Sequence"
            value: "Wochen 12-14: Auswertung der Testwoche und Schlusspraesentation vor dem Stadtplanungsamt."
            state: "done"
          - step: 7
            id: "activityplan"
            label: "Aktivitaeten"
            value: "Feldwoche, zwei Werkstattbloecke, Coaching-Termine."
            state: "done"
          - step: 8
            id: "deliverablesmap"
            label: "Abgaben"
            value: "Bedarfsprofil Woche 5, Variantenvergleich Woche 9, Dossier Woche 14."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "detailed"
            focus: false
          - step: 3
            depth: "detailed"
            focus: false
          - step: 4
            depth: "detailed"
            focus: false
          - step: 5
            depth: "refined"
            focus: false
          - step: 6
            depth: "refined"
            focus: false
          - step: 7
            depth: "refined"
            focus: false
          - step: 8
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 3
      turns:
        - "Die Zwischenpraesentation streiche ich, das wird sonst zu viel. Dass damit das formative Feedback wegfaellt, ist mir bewusst — ich mache es trotzdem so."
        - "Gut, mehr machen wir hier nicht. Lass uns abschliessen."
      checkpoints:
        - id: "5d"
          type: "judge"
          anchor: "skill:SKILL.md#name that reading against the recorded overall target"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn; the first is context only. The lecturer has just ended a
            flow that is worked through steps 1 to 8, and an overall target ambition is on
            record in the session priors. No critical review was ever requested or accepted.
            PASS requires the closing turn to state where the design now stands in maturity
            terms AND to hold that against the recorded overall ambition — an explicit
            comparison, however briefly phrased ("reaches roughly X, you were aiming at Y",
            "still short of what you set out for"). FAIL if the close delivers no assessment
            of the reached maturity at all, if it reports a reading without ever relating it
            to the recorded ambition, or if it makes the comparison conditional on the
            lecturer first accepting a critical review. Whether the reading was also mirrored
            to the panel is a separate checkpoint and is not yours to grade.
        - id: "5e"
          type: "deterministic"
          turn: 1
          anchor: "skill:SKILL.md#record with `cbe_maturity` what moved"
          check:
            kind: "tool_called"
            tool: "cbe_maturity"
        - id: "5f"
          type: "judge"
          anchor: "skill:SKILL.md#as the last thing before what comes next"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn. Two things are open in this design and the close has to
            name both: the alignment matrix (step 9) and the readiness checklist (step 10)
            carry nothing yet, and the lecturer removed the formative interim presentation
            in the previous turn while acknowledging the lost feedback — a reservation left
            standing. PASS requires the closing turn to name what is still empty across the
            flow AND the standing reservation, gathered in ONE place and positioned
            immediately before the next steps. FAIL if the open points are missing, if only
            one of the two kinds is named, if they are scattered as passing clauses through
            the summary instead of stated once in full, or if they come after the next steps
            rather than before them.
        - id: "5g"
          type: "judge"
          anchor: "skill:SKILL.md#Neither is an eleventh step and neither authors anything"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn. PASS requires it to read as a CLOSE: the maturity reading
            and the open inventory are delivered as a reading and an inventory, and the next
            steps are preparations and decisions the lecturer takes. FAIL if the turn
            presents itself as a further step of the design flow (an eleventh step, a new
            stage, a re-opening of the sequence), or if it hands over authored artefact
            content for the lecturer's own module — a drafted alignment matrix, a written
            readiness checklist, a formulated Big Idea, essential question or challenge.
            Naming WHAT the lecturer still has to produce is not authoring it.
    - probe: "S5d"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Verkehrsplanung, 5. Semester, 6 ECTS, 20 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende entwickeln und begruenden ein Erschliessungskonzept fuer ein Quartier."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Konzeptdossier benotet, Zwischenpraesentation formativ mit Feedback."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Mobilitaet als Voraussetzung von Teilhabe."
            state: "done"
          - step: 4
            id: "eq"
            label: "Leitfrage"
            value: "Wie erreichen wir ein Quartier ohne eigenes Auto?"
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Entwickelt fuer das Quartier Gaertnerweg ein Erschliessungskonzept und stellt es dem Stadtplanungsamt vor."
            state: "done"
          - step: 5
            id: "stakeholderplan"
            label: "Anspruchsgruppen"
            value: "Stadtplanungsamt: Kickoff, Zwischenreview, Schlusspraesentation."
            state: "done"
          - step: 6
            phase: "engage"
            id: "es"
            label: "Engage Sequence"
            value: "Wochen 1-2: Quartierbegehung, Schaerfung der Challenge, Teambildung."
            state: "done"
          - step: 6
            phase: "investigate"
            id: "is"
            label: "Investigate Sequence"
            value: "Wochen 3-6: Wegetagebuecher, Zaehlungen und Interviews, Auswertung zum Bedarfsprofil je Bewohnendengruppe."
            state: "done"
          - step: 6
            phase: "act"
            id: "as"
            label: "Act Sequence"
            value: "Wochen 7-11: Varianten fuer Bus, Velo und Sharing ausarbeiten, bevorzugte Variante mit Kostenschaetzung, Testwoche im Quartier."
            state: "done"
          - step: 6
            phase: "reflect"
            id: "rs"
            label: "Reflect Sequence"
            value: "Wochen 12-14: Auswertung der Testwoche und Schlusspraesentation vor dem Stadtplanungsamt."
            state: "done"
          - step: 7
            id: "activityplan"
            label: "Aktivitaeten"
            value: "Feldwoche, zwei Werkstattbloecke, Coaching-Termine."
            state: "done"
          - step: 8
            id: "deliverablesmap"
            label: "Abgaben"
            value: "Bedarfsprofil Woche 5, Variantenvergleich Woche 9, Dossier Woche 14."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "detailed"
            focus: false
          - step: 3
            depth: "detailed"
            focus: false
          - step: 4
            depth: "detailed"
            focus: false
          - step: 5
            depth: "refined"
            focus: false
          - step: 6
            depth: "refined"
            focus: false
          - step: 7
            depth: "refined"
            focus: false
          - step: 8
            depth: "rough"
            focus: true
      turns:
        - "So, mehr machen wir hier nicht. Lass uns abschliessen."
      checkpoints:
        - id: "5h"
          type: "judge"
          anchor: "skill:SKILL.md#where no target was ever recorded"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn. The design is worked through steps 1 to 8 and the lecturer
            is closing, but NO overall target ambition was ever recorded — the session priors
            carry a canvas and step coverage and no maturity target at all. PASS requires the
            close to name that absence explicitly: it says no target ambition is on record,
            or asks the lecturer for it while saying the comparison cannot be made without
            it. FAIL if the response supplies a target itself — asserting or implying that
            the module was aiming at a first step, a modest ambition, or any particular level
            — or if it silently compares the design against an ambition nobody recorded, or
            if the missing target simply never comes up while a reading is delivered as
            though it had a reference point.
```
