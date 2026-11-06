# S4 — Critical review, transitions and handback

Governing passages: skill § _Critical review_ for the review method and its close, and
§ _How a session runs · 1. Opening_ for immediate review service, ordered work, redirects
and the starting-point distinction. Review is a bounded requested activity, not a late-only
stage or a persistent route.

> **The delegation probes remain elsewhere.** The delegation check is a check of its own;
> its probes live in `11-delegation-check.md` as 11a/11b.

> **Warm and cold review are separate obligations.** S4 retains the established warm probe
> with recorded cards, coverage and target. S4b adds the cold opening the canonical contract
> now promises: a supplied draft and explicit request must be reviewed immediately rather
> than deflected into onboarding. Neither substitutes for the other.

> **Transitions preserve state, not a route.** S4d orders review before revision. S4e changes
> from transfer to review mid-session and pairs a positive review checkpoint with a
> deterministic no-canvas-call check on that turn. S4f ends a review that interrupted design work. S4b's
> second turn covers the other handback direction: no interrupted step exists.

> **No behavioural result is claimed.** New checkpoints enter traceability as `unmeasured`
> on 2026-09-30. Existing warm S4 checkpoints and their evidence remain unchanged.

## Setup

- **Environment profile:** app.
- **S4 warm prior:** the draft is already on cards, steps 1–4 are worked, and overall target
  3 was settled earlier. Three criteria carry achieved levels; the rest remain unassessed.
- **S4b–S4f:** cold review with real supplied material; missing material; ordered review then
  revision; transfer-to-review redirection; and handback with and without interrupted work.

> **What 4e and 4f each see.** The recorded state reaches the model as plain text in the
> environment descriptor, so READING the target needs no tool call — 4f grades the reading.
> RECORDING the achieved level does need the call, which is 4e.

## Pass criteria

- [ ] **4a** The warm review works through the overwhelmed, unmotivated and ambitious student,
      with a mechanism per finding and findings organised by student.
- [ ] **4e** Its maturity reading is recorded rather than only reasoned about.
- [ ] **4f** It closes by comparing reached design with the recorded target, without remedies
      beyond that target.
- [ ] **4b** The lecturer's unsupported contentment does not retire the finding.
- [ ] **4g** An explicit cold-opening review begins within a weakness-first answer; no mode
      confirmation, design interview, repeated offer or target prerequisite delays it.
- [ ] **4h** When that opening review ends, the response names the next concrete decision the
      findings expose, without inventing an interrupted step or launching a redesign.
- [ ] **4i** A clear review request without a design asks for the relevant draft or part, not
      for a mode and not with invented findings.
- [ ] **4j** Review-first-then-revise begins with review, not ambiguity or early revision.
- [ ] **4k** Once the review closes, the next turn takes the promised design revision without
      another category confirmation.
- [ ] **4l** A transfer-to-review change begins review on the second assistant turn without
      finishing transfer first, resetting state or re-asking the target.
- [ ] **4m** That redirect emits no `cbe_canvas` call at all on the redirect turn — that turn
      carries nothing recordable, so any call there would be a reset or replacement, and
      `tool_not_called` is honest about what it reads: the absence of the call, not the intent
      behind one. Should the turn ever gain recordable substance, this checkpoint needs an
      argument-reading kind, not a re-reading of the same result. The positive 4l checkpoint
      prevents silence from passing the probe.
- [ ] **4n** A review that interrupted design hands back to its actual recorded step rather
      than imposing a generic redesign or permanent review mode.

## Failure modes to watch for

- Generic findings with no student perspective or mechanism.
- Deflecting a cold explicit review into a route choice, ambition interview or second offer.
- Inventing findings when no draft is available.
- Withdrawing a finding on the lecturer's satisfaction alone.
- Reasoning about maturity while the panel stays empty, or closing without the target gap.
- Finishing transfer before obeying a changed review request, or clearing cards.
- Fabricating an interrupted step after an opening review, or automatically redesigning at
  either handback.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S4"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Modulrahmen"
            value: "Energietechnik, 4. Semester, 6 Wochen, 24 Studierende."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende erstellen und interpretieren eine Energiebilanz für ein reales Gebäude und leiten daraus Massnahmen ab."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Ein benoteter Gruppenbericht am Ende der 6 Wochen. Keine Zwischenprodukte, keine Einzelleistung."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Energieverbrauch im Hochschulgebäude."
            state: "done"
          - step: 4
            id: "eq"
            label: "Essential Question"
            value: "Wie können wir den Energieverbrauch unseres Gebäudes senken?"
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Die Studierenden entwickeln in 6 Wochen ein Konzept zur Reduktion des Energieverbrauchs im Hochschulgebäude."
            state: "done"
          - step: 6
            phase: "engage"
            id: "es"
            label: "Engage Sequence"
            value: "Zwei Vorlesungen zu Energiebilanzen zum Auftakt."
            state: "done"
        stepCoverage:
          - step: 1
            depth: "detailed"
            focus: false
          - step: 2
            depth: "refined"
            focus: false
          - step: 3
            depth: "refined"
            focus: false
          - step: 4
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 3
          societal-challenge:
            current: 2
          stakeholder-involvement:
            current: 1
          interdisciplinarity:
            current: 1
      turns:
        - "Schau dir den Entwurf kritisch an."
        - "Passt schon so."
      checkpoints:
        - id: "4a"
          type: "judge"
          anchor: "skill:SKILL.md#at least three student perspectives"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the first assistant turn; the others are context only.
            The review works through at least three student perspectives — the
            overwhelmed, the unmotivated and the ambitious — and each finding names the
            MECHANISM by which the design fails that student, not only that something is
            missing or weak. FAIL if fewer than three perspectives appear, or if the
            findings are symptom-level ("the Engage phase is weak") with no mechanism.
            FAIL as well if the critique is organised by design component — Engage,
            Assessment, coherence — and the students appear only as an aside or not at
            all: the perspectives must be what the findings are structured by.
        - id: "4e"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#record with `cbe_maturity` each criterion the review moved"
          check:
            kind: "tool_called"
            tool: "cbe_maturity"
        - id: "4f"
          type: "judge"
          anchor: "skill:SKILL.md#name the recorded target against what the design reaches"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the first assistant turn; the others are context only.
            The review closes on the gap between the declared target and what the design
            has actually reached. ONE target is on record — level 3 for the design as a
            whole — and the response must work from THAT: naming any other target level,
            or a per-criterion target the record does not carry, is a misread and FAILS.
            The reached side is read from the design; criteria with no assessed level need
            not be enumerated (an unassessed criterion is unmeasurable, not a shortfall).
            FAIL if the review ends on the per-student findings with no comparison at all,
            if it asks the lecturer for a target that is already recorded, or if a proposed
            remedy reaches beyond level 3.
        - id: "4b"
          type: "judge"
          anchor: "skill:SKILL.md#contentment or contradiction alone does not retire a finding"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the second assistant turn; the others are context only.
            The lecturer waves a finding away without an argument. PASS when the response
            keeps at least one earlier finding alive WITH ITS COST: it names who or what
            the weakness hits and what the design does not reach because of it, in
            substance and not only as a label. Letting the lecturer's decision stand
            afterwards is CORRECT and must not be failed — the skill records the
            reservation and carries on; it does not block, nag, or re-argue until the
            lecturer yields. FAIL only for the two collapses: withdrawing or softening the
            finding on the lecturer's contentment alone, or noting that it "remains" while
            supplying no reason and no consequence, which drops it politely.
    - probe: "S4b"
      setup:
        profile: "app"
      turns:
        - |-
          Prüfe diesen Entwurf jetzt kritisch aus Sicht der Studierenden. Mein Ziel ist eine vollständige, umsetzbare Neugestaltung.

          [Lecturer-supplied reference material: "entwurf-energielabor.txt"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "entwurf-energielabor.txt" ---
          Modul Energielabor, 4. Semester, 24 Studierende. Lernziel: Energiedaten eines Gebäudes auswerten und Massnahmen begründen. Assessment: benoteter Gruppenbericht am Ende; keine Zwischenprodukte und keine Einzelleistung. Challenge: Energieverbrauch des Campus senken. Lernweg: zwei Vorlesungen, danach vier Wochen Gruppenarbeit.
          --- END REFERENCE MATERIAL: "entwurf-energielabor.txt" ---
        - "Die kritische Prüfung ist damit abgeschlossen. Was ist jetzt die nächste konkrete Entscheidung?"
      checkpoints:
        - id: "4g"
          type: "judge"
          anchor: "skill:SKILL.md#Explicit review starts weakness-first"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; the second is context. The opening explicitly requests a
            critical review of an available draft and supplies the implementation ambition.
            PASS requires the response to BEGIN the examination in this turn and lead with a
            concrete weakness, with at most half a sentence of framing. FAIL if it asks the
            lecturer to choose or confirm a mode, asks the target again, replaces review with a
            design interview, offers to review later, or gives an introductory paragraph before
            the first weakness.
        - id: "4h"
          type: "judge"
          anchor: "skill:SKILL.md#if there was none, name the next concrete decision"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. This review was the session's first
            activity, so no interrupted design step exists. PASS requires the response to mark
            the review finished and name a concrete next decision exposed by its findings. FAIL
            if it invents an interrupted step, announces a permanent Review mode, automatically
            starts redesigning the module, or treats redesign as mandatory rather than the
            lecturer's next decision.
    - probe: "S4c"
      setup:
        profile: "app"
      turns:
        - "Prüfe meinen CBE-Entwurf kritisch auf Schwächen. Ich habe den Entwurf hier aber noch
          nicht eingefügt; das Ziel ist eine substanzielle Überarbeitung."
      checkpoints:
        - id: "4i"
          type: "judge"
          anchor: "skill:SKILL.md#if its design is absent, ask for the relevant part"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Critical review and its ambition are explicit, but no
            draft or recorded design exists. PASS requires a focused request for the design or
            the relevant part to examine. FAIL if the response invents findings, asks whether
            the lecturer wants review, presents a route selector, repeats the target question,
            or starts a blank design interview.
    - probe: "S4d"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Soziale Arbeit, 5. Semester, 20 Studierende, 6 ECTS."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende begründen eine Intervention für einen realen Fall."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Gruppenpräsentation eines Fallkonzepts; keine Einzelleistung."
            state: "draft"
        stepCoverage:
          - step: 3
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Prüfe den bisherigen Entwurf zuerst kritisch. Danach möchte ich mit dir das
          Assessment überarbeiten."
        - "Die Prüfung ist abgeschlossen. Gehen wir jetzt wie angekündigt an die Überarbeitung
          des Assessments."
      checkpoints:
        - id: "4j"
          type: "judge"
          anchor: "skill:SKILL.md#work an ordered combination in order"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; the second is context. The lecturer ordered two tasks:
            critical review first, assessment revision second. PASS requires the response to
            begin the review now and retain revision as the follow-on. FAIL if it asks which
            category the lecturer wants, starts revising before examining, or attempts both full
            activities at once.
        - id: "4k"
          type: "judge"
          anchor: "skill:SKILL.md#Latest request outranks prior readings and material shape"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. The requested review is now closed
            and the lecturer explicitly invokes the promised assessment revision. PASS requires
            substantive work on that revision. FAIL if it asks for a mode/category, restarts the
            review, re-asks the target, or treats the review as a permanent posture that must be
            exited before design work can resume.
    - probe: "S4e"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Betriebsökonomie, 3. Semester, bestehende Vorlesung, 30 Studierende."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Schriftliche Einzelprüfung über Vorlesungsinhalte."
            state: "draft"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Kostenstruktur eines lokalen Betriebs untersuchen."
            state: "draft"
        stepCoverage:
          - step: 3
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Wir übertragen gerade meine bestehende Vorlesung. Als Nächstes wollte ich die
          Einzelprüfung anpassen."
        - "Statt die Übertragung fortzusetzen: Prüfe den bisherigen Entwurf jetzt kritisch aus
          Sicht der Studierenden."
      checkpoints:
        - id: "4l"
          type: "judge"
          anchor: "skill:SKILL.md#When the request changes, acknowledge it and act in that turn"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. The lecturer explicitly redirects
            ongoing transfer work into a critical review of the recorded design. PASS requires
            a brief acknowledgement of that concrete change and the review to BEGIN in this
            same turn. FAIL if the response insists on finishing transfer, asks the target or
            category again, clears or ignores the recorded design, or merely promises a later
            review without examining it.
        - id: "4m"
          type: "deterministic"
          turn: 1
          anchor: "skill:SKILL.md#no reset, repeated target or forced finish"
          check:
            kind: "tool_not_called"
            tool: "cbe_canvas"
    - probe: "S4f"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Stadtplanung, 5. Semester, 18 Studierende, 5 ECTS."
            state: "done"
          - step: 4
            id: "challenge"
            label: "Challenge"
            value: "Entwickelt einen Vorschlag für einen hitzeresilienten Quartiersplatz."
            state: "draft"
        stepCoverage:
          - step: 4
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Unterbrechen wir die Arbeit an der Challenge kurz für eine kritische Prüfung des
          bisherigen Entwurfs."
        - "Damit ist die Prüfung beendet. Führen wir die Arbeit dort fort, wo wir sie
          unterbrochen haben."
      checkpoints:
        - id: "4n"
          type: "judge"
          anchor: "skill:SKILL.md#hand back to the work it interrupted"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. The review interrupted recorded
            work on step 4's challenge, which remains rough and in focus. PASS requires the
            response to mark review finished and hand back to that actual work with a concrete
            next challenge decision. FAIL if it invents another interrupted step, restarts a
            generic module opening, launches an automatic whole-design rewrite, or stays in a
            permanent Review mode.
```
