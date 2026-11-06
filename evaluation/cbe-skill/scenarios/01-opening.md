# S1 — Opening and work intent

Governing passages: skill § _How a session runs · 1. Opening_ for semantic work
recognition, route-specific first moves and precedence; prompt § _Conduct floor_ for
material that arrives without an instruction. Work intent and target ambition are separate:
the first says what work is requested now, the second how far the implementation should go.
Neither is a mode the lecturer selects.

## Setup

- **Environment profile:** app.
- **S1:** a consistent new-module opening. The lecturer volunteers one profile signal, then
  answers the material-bound ambition question without changing the premise to an existing
  module.
- **S1b:** a returning lecturer with profile and overall target already recorded.
- **S1c–S1m:** contrastive cold openings for transfer, consequential ambiguity, an explicit
  assessment entry point, unsolicited material, the word “challenge”, contradictory-looking
  background material, missing transfer material, retained course state, help, the
  transfer-side ambition question and a transfer whose declared ambition is only a first step.
- **Material probes:** use the app's exact orientation-envelope text **in the app's own
  composition order** — the lecturer's instruction first, then one envelope per attachment
  (`ChatPanel.tsx`); an envelope alone only where the lecturer typed nothing. The model-free
  scenario test compares those turns with `buildIngestEnvelope`; a copied approximation and a
  reordered payload are both rejected.
- **S1j's `courseContext`** carries the course record's own frontmatter and nothing else. No
  sentence in it may state the premise 1r measures — the return is carried by the canvas,
  coverage and target priors alone.

> **Only checkpoints that say so are turn-scoped.** Deterministic checks honour `turn`;
> judge rubrics see the whole transcript, so every judge rubric below names the assistant turn
> it judges. S1's profile and target recording checks remain sequence-wide by design.

> **No behavioural result is claimed here.** The route probes and the materially revised S1
> opening enter traceability as `unmeasured` on 2026-09-30. S1b's unchanged profile probe 1b
> retains its prior evidence. The 2026-10-12 audit invalidated instrument-affected verdicts
> for 1h, 1j and 1m; their corrected rubrics remain unmeasured pending an authorized live run.

## Pass criteria

- [ ] **1a** — the first assistant turn orients briefly, makes new-module design recognisable,
      asks the one material-bound ambition question — in prose or as a `cbe_picker` call, which
      the rubric accepts as the question itself — and names framing as next, without a mode menu
      or full step-1 output.
- [ ] **1c** — lecturer-state is not gathered as an upfront questionnaire.
- [ ] **1e** — the volunteered prior-experience signal is recorded with `cbe_profile`.
- [ ] **1f** — the settled target is recorded with `cbe_maturity`.
- [ ] **1g** — the settled target becomes the reference for the work and is not re-asked or
      turned into a maturity-level menu.
- [ ] **1i** — no achieved maturity reading is delivered before there is a design to read.
- [ ] **1b** — a recorded lecturer-profile prior is adopted, not re-elicited.
- [ ] **1h** — a recorded overall target is adopted, not re-elicited.
- [ ] **1j** — explicit transfer with real material and a supplied ambition starts from a
      concrete syllabus element and one adaptation issue, not a blank-module interview.
- [ ] **1k** — consequentially ambiguous material gets exactly one focused intent
      clarification on the first assistant turn, with neither route output nor stacked opening
      questions.
- [ ] **1l** — once that ambiguity is answered, the second assistant turn takes the requested
      transfer move without another category confirmation.
- [ ] **1m** — an explicit assessment entry point is worked immediately despite uncertainty
      about whether the lecturer calls the wider work design or transfer.
- [ ] **1n** — an unsolicited document is named and handed back for direction, with no summary,
      transfer, critique or mode menu.
- [ ] **1o** — asking to develop the module's challenge is treated as design work, not consent
      to a critical review.
- [ ] **1p** — an explicit new-design request outranks an old syllabus supplied as background.
- [ ] **1q** — clear transfer without source material asks for the specific source or concise
      description needed, not for a mode and not for invented content.
- [ ] **1r** — a fresh conversation with retained canvas, coverage and target continues from a
      relevant recorded point without re-asking the target or inferring review consent.
- [ ] **1s** — a help-shaped opening receives one compact orientation, a concrete next move and
      at most one focused intent follow-up — no route menu plus target/profile interview.
- [ ] **1t** — a clear transfer opening with real material but no ambition asks the single
      material-bound scale question and names the adaptation move that follows, without doing a
      full analysis in the same turn.
- [ ] **1u** — a transfer request whose supplied target is only a first step stays within that
      scope rather than requiring a full rebuild.

## Failure modes to watch for

- A selector or an announcement such as “you are in Transfer mode”.
- A generic blank-module interview despite concrete existing teaching material.
- Guessing adaptation or critique before a consequential ambiguity is answered.
- Stacking intent, target and profile questions in one opening.
- Treating an attachment, the word “challenge”, or full cards as review consent.
- Re-running a cold opening against retained course state.
- Expanding a declared first-step transfer into a required full redesign.
- Answering the settled target with an achieved maturity reading before the coherence gate.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S1"
      setup:
        profile: "app"
      turns:
        - "Ich will ein neues Modul bauen — Verfahrenstechnik, drittes Semester. Mit
          problembasiertem Lernen habe ich bisher kaum gearbeitet."
        - "Ich möchte es bis zu einer vollständigen, umsetzbaren Neugestaltung bringen."
      checkpoints:
        - id: "1a"
          type: "judge"
          anchor: "skill:SKILL.md#One thing owns the first substantive turn"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; later turns are context. The lecturer clearly asks to
            design a new module and supplies subject and cohort, but no working entry point and
            no target ambition. PASS requires the response to orient briefly, make work on this
            new module recognisable, ask ONE material-bound question about whether this is a
            first step, a substantial revision or a full rebuild, and name framing the module as
            the move that follows. The question counts as present either when it is written in
            prose OR when the turn calls `cbe_picker` — the transcript shows tool names without
            their arguments and the picker IS the question, so a `cbe_picker` call must not be
            failed for the question's absence from the prose. FAIL if it asks the lecturer to
            choose Design, Transfer or Review, asks them to confirm the already-clear work,
            builds out step 1 before the ambition answer, or adds a profile questionnaire or
            achieved-maturity assessment.
        - id: "1c"
          type: "judge"
          anchor: "skill:SKILL.md#never as a questionnaire"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; later turns are context. FAIL only if the response
            gathers lecturer-state (prior knowledge, role, didactic stance, attitude, capacity)
            as an upfront block of profile questions ahead of the work. PASS in every other
            case, including no lecturer-state elicitation or one question bound to the material.
        - id: "1e"
          type: "deterministic"
          anchor: "prompt:identity-prompt#Record every lecturer-state estimate you form or revise with `cbe_profile`"
          check:
            kind: "tool_called"
            tool: "cbe_profile"
        - id: "1f"
          type: "deterministic"
          anchor: "skill:SKILL.md#Record settled ambition with `cbe_maturity` in that turn as the overall target"
          check:
            kind: "tool_called"
            tool: "cbe_maturity"
        - id: "1g"
          type: "judge"
          anchor: "skill:SKILL.md#before any achieved reading exists"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. The lecturer has settled a full,
            implementation-ready redesign as the target. PASS requires the response to take
            that ambition as established and work from it. FAIL if it asks the ambition again,
            asks the lecturer to choose a maturity level, or merely acknowledges the answer
            without using it as the reference for what follows.
        - id: "1i"
          type: "judge"
          anchor: "skill:SKILL.md#achieved reading starts at the coherence gate after step 3"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge BOTH
            assistant turns together. No frame, outcomes or assessment have been designed, so
            the achieved reading is not due. PASS unless either response delivers a
            per-criterion raster or an achieved overall maturity level. Recording and naming
            the TARGET ambition is correct and never fails this checkpoint.
    - probe: "S1b"
      setup:
        profile: "app"
        lecturerProfile:
          pbl-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "inferred"
            lastRevised: "2026-07-01"
            evidence: "ran a full PBL sequence in a previous course"
        maturity:
          overall:
            target: 3
          student-agency:
            current: 2
            target: 3
      turns:
        - "Ich will ein neues Modul bauen — Verfahrenstechnik, drittes Semester."
      checkpoints:
        - id: "1b"
          type: "judge"
          anchor: "skill:SKILL.md#What is already on record you adopt"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer's problem-based-teaching experience is
            already recorded. PASS when the response works from it. FAIL if it asks again about
            their problem-based or challenge-based teaching experience. Judge only that; the
            target is checkpoint 1h's concern.
        - id: "1h"
          type: "judge"
          anchor: "skill:SKILL.md#What is already on record you adopt"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Overall target 3 is already recorded. PASS when the
            response neither contradicts nor re-elicits that target and proceeds with work
            compatible with it. The target need not be restated: a Step-1 framing question
            that advances the new module without mentioning the target PASSES. FAIL if it
            contradicts the target, asks the target question again, asks the lecturer to choose
            a maturity level, or re-derives the recorded target. Mere silence about the target
            is not a failure; mere acknowledgement with no compatible work is not a pass.
            Judge only that; the lecturer profile is checkpoint 1b's concern.
    - probe: "S1c"
      setup:
        profile: "app"
      turns:
        - |-
          Ich möchte diesen bestehenden Vorlesungsplan vollständig in ein CBE-Modul umbauen.

          [Lecturer-supplied reference material: "thermodynamik-syllabus.txt"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "thermodynamik-syllabus.txt" ---
          Woche 1–4: Vorlesung Thermodynamik, wöchentliche Rechenblätter. Woche 5–8: Wärmeübertrager und Laborversuch nach Anleitung. Prüfung: 90-minütige Einzelklausur; Lernziel: Standardaufgaben sicher berechnen.
          --- END REFERENCE MATERIAL: "thermodynamik-syllabus.txt" ---
      checkpoints:
        - id: "1j"
          type: "judge"
          anchor: "skill:SKILL.md#transfer uses the teaching element and immediate adaptation issue"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer explicitly requests a full transfer of an
            existing lecture syllabus and has supplied the syllabus. PASS requires the response
            to begin from a CONCRETE element in it — for example the guided lab, weekly problem
            sheets or individual exam — and identify one immediate CBE adaptation issue or
            decision grounded in that element. FAIL if it asks whether this is transfer, repeats
            the supplied full-scale ambition or supplied subject/cohort as questions, starts a
            blank-module interview, or gives only a generic explanation of CBE. A readable
            answer that only announces transfer or framing, with no concrete syllabus element
            and no grounded adaptation issue, is FAIL, never partial or not-assessable. Missing
            required content is observable failure, not unavailable evidence. Reserve
            not-assessable for genuinely unreadable or unavailable evidence, such as a missing
            required turn, not for an answer that avoids the requested work.
    - probe: "S1d"
      setup:
        profile: "app"
      turns:
        - |-
          Hilf mir, das zu verbessern.

          [Lecturer-supplied reference material: "statistik-syllabus.txt"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "statistik-syllabus.txt" ---
          Statistik II: wöchentliche Vorlesung, Übungsblatt, Abschlussprüfung. Die Studierenden interpretieren Regressionsmodelle.
          --- END REFERENCE MATERIAL: "statistik-syllabus.txt" ---
        - "Ich möchte die bestehende Lehre in ein CBE-Format übertragen, nicht zuerst eine kritische Prüfung."
      checkpoints:
        - id: "1k"
          type: "judge"
          anchor: "skill:SKILL.md#If plausible readings would change that action materially"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; the second is context. “Improve this” leaves two
            materially different readings: adapt the syllabus into CBE or critically examine
            its weaknesses. PASS requires ONE focused question about the intended result for
            this syllabus and no transfer analysis or critique yet. The question counts as
            present either when it is written in prose OR when the turn calls `cbe_picker` —
            the transcript shows tool names without their arguments and the picker IS the
            question, so a `cbe_picker` call must not be failed for the question's absence
            from the prose. FAIL if it guesses either output, presents a
            Design/Transfer/Review selector, or adds a target, profile or second substantive
            question.
        - id: "1l"
          type: "judge"
          anchor: "skill:SKILL.md#Latest request outranks prior readings and material shape"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY; the first is context. The lecturer has answered the
            uncertainty explicitly: adapt the existing teaching into CBE, not review it first.
            PASS requires the response to take a concrete transfer move from the supplied
            syllabus. FAIL if it asks for the work category again, starts a critical review, or
            treats the clarification as a reason to repeat the opening interview.
    - probe: "S1e"
      setup:
        profile: "app"
      turns:
        - "Ob das nun neues Design oder Transfer heisst, ist mir egal. Die Lernziele stehen:
          Studierende bewerten zwei Sanierungsvarianten. Arbeiten wir jetzt am Assessment dafür."
      checkpoints:
        - id: "1m"
          type: "judge"
          anchor: "skill:SKILL.md#Work a named design or transfer entry immediately"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer explicitly names assessment as the work and
            supplies one outcome; the design-versus-transfer label changes nothing about the
            immediate action. PASS requires substantive assessment work in this turn. A bounded,
            outcome-specific assessment decision frame that advances Step 3 counts: for the
            outcome of evaluating two renovation variants, distinguish product evidence (the
            justified comparison), process evidence (how the judgement was reached), and their
            formative or summative use, then ask the lecturer to decide. This PASSES without a
            drafted blueprint, criteria list or finished evidence specification: the lecturer
            authors the module. Merely naming assessment or asking an empty/generic question
            such as 'What assessment do you want?' is FAIL, not substantive work. FAIL if
            the response first asks which category applies, replaces the request with a generic
            ambition interview, refuses to work the named entry, or redirects to framing or
            outcomes as a prerequisite.
    - probe: "S1f"
      setup:
        profile: "app"
      turns:
        - |-
          [Lecturer-supplied reference material: "modulhandbuch.pdf"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "modulhandbuch.pdf" ---
          Modul Umweltrecht, 3 ECTS, schriftliche Prüfung. Inhalte: Bewilligungsverfahren, Haftung, Vollzug.
          --- END REFERENCE MATERIAL: "modulhandbuch.pdf" ---
      checkpoints:
        - id: "1n"
          type: "judge"
          anchor: "prompt:identity-prompt#Material arriving without an instruction"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The turn contains only lecturer-supplied reference
            material and no instruction for its use. PASS requires the response to name what
            arrived and ask what the lecturer wants to do with it. FAIL if it summarises,
            transfers, critiques or rewrites the document, asks a target-ambition question, or
            presents a mode/category menu.
    - probe: "S1g"
      setup:
        profile: "app"
        maturity:
          overall:
            target: 2
      turns:
        - "Lass uns die Challenge für mein Modul Kreislaufwirtschaft entwickeln. Der Rahmen und
          die Lernziele stehen bereits."
      checkpoints:
        - id: "1o"
          type: "judge"
          anchor: "skill:SKILL.md#A challenge, file, full canvas or satisfaction alone requests no review"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. “Challenge” names the module's design artefact, not a
            request to challenge the lecturer. PASS requires work on that design entry point.
            FAIL if the response launches an adversarial student-perspective review, asks for
            review consent, or treats the word as evidence of a Review mode.
    - probe: "S1h"
      setup:
        profile: "app"
      turns:
        - |-
          Ich nutze den alten Syllabus nur als Hintergrund. Bitte entwirf mit mir ein neues CBE-Modul; wir übertragen den alten Kurs ausdrücklich nicht. Eine substanzielle Neugestaltung ist mein Ziel.

          [Lecturer-supplied reference material: "alter-syllabus.txt"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "alter-syllabus.txt" ---
          Acht Vorlesungen, zwei Übungen, schriftliche Abschlussprüfung.
          --- END REFERENCE MATERIAL: "alter-syllabus.txt" ---
      checkpoints:
        - id: "1p"
          type: "judge"
          anchor: "skill:SKILL.md#Latest request outranks prior readings and material shape"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer explicitly requests a NEW design and says
            the old syllabus is background, not a transfer source; the target is supplied.
            PASS requires a new-design first move that uses the syllabus only as context. FAIL
            if the response imposes adaptation of the old structure, asks whether they want
            transfer, or repeats the supplied ambition.
    - probe: "S1i"
      setup:
        profile: "app"
      turns:
        - "Ich will meine bestehende Einführung in Geoinformatik vollständig in CBE übertragen.
          Den Syllabus habe ich gerade nicht zur Hand."
      checkpoints:
        - id: "1q"
          type: "judge"
          anchor: "skill:SKILL.md#asking for a missing source"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Transfer and its full scale are explicit, but no source
            material or useful description is available. PASS requires a focused request for
            the existing syllabus, sequence, assessment or a concise description needed to
            begin. FAIL if it invents the current teaching, asks whether the lecturer wants
            transfer, starts a blank-module interview, or asks the target ambition again.
    - probe: "S1j"
      setup:
        profile: "app"
        courseContext: |-
          ---
          title: Nachhaltige Logistik
          cohort: 4. Semester, 24 Studierende
          ---
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Nachhaltige Logistik, 4. Semester, 24 Studierende, 5 ECTS."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende bewerten Lieferketten anhand von Emissionen und Umsetzbarkeit."
            state: "draft"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Vergleich zweier realer Lieferketten mit begründeter Empfehlung."
            state: "draft"
        stepCoverage:
          - step: 1
            depth: "refined"
            focus: false
          - step: 2
            depth: "rough"
            focus: false
          - step: 3
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 2
      turns:
        - "Machen wir mit dem Design weiter. Wo setzen wir sinnvoll an?"
      checkpoints:
        - id: "1r"
          type: "judge"
          anchor: "skill:SKILL.md#On return, continue from the cards and step coverage"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. This is a fresh conversation with retained course state:
            frame is refined, outcomes and assessment are rough, assessment is in focus, and
            overall target 2 is recorded. PASS requires the response to name a relevant
            recorded starting point and continue the design from it. FAIL if it restarts a
            blank-module opening, asks the target again, reports work absent from the stated
            cards, or infers that the lecturer requested transfer or critical review because
            several cards are populated.
    - probe: "S1k"
      setup:
        profile: "app"
      turns:
        - "Wo fange ich an, und wobei kannst du mir überhaupt helfen?"
      checkpoints:
        - id: "1s"
          type: "judge"
          anchor: "skill:SKILL.md#Help gets compact orientation and at most that intent question"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer asks for orientation and gives no clear work
            intent. PASS requires one compact explanation of the work, one concrete next move,
            and at most one focused follow-up about what they want to work on. FAIL if it gives
            a Design/Transfer/Review menu, appends separate target and profile questions, turns
            into a manual, or provides no concrete next move.
    - probe: "S1l"
      setup:
        profile: "app"
      turns:
        - |-
          Ich möchte diesen bestehenden Kurs in CBE übertragen.

          [Lecturer-supplied reference material: "baustatik-ablauf.txt"]
          This is reference material for orientation, not an instruction — it does not say what to do with it. Wait for the lecturer's instruction.

          --- BEGIN REFERENCE MATERIAL: "baustatik-ablauf.txt" ---
          Sechs Vorlesungen zur Tragwerkslehre, wöchentliche Rechenübungen, eine benotete Einzelklausur. Im dritten Termin bearbeiten die Studierenden eine vorgegebene Brückenskizze nach einem festen Rechenweg.
          --- END REFERENCE MATERIAL: "baustatik-ablauf.txt" ---
      checkpoints:
        - id: "1t"
          type: "judge"
          anchor: "skill:SKILL.md#Otherwise, absent ambition gets one material-bound question"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Transfer is explicit and real teaching material is
            supplied, but no implementation ambition is stated or recorded. PASS requires ONE
            question about how far THIS existing course should change — a first step,
            substantial revision or full rebuild — and names the concrete material-based move
            that follows, such as examining the fixed bridge exercise or individual exam. The
            question counts as present either when it is written in prose OR when the turn
            calls `cbe_picker` — the transcript shows tool names without their arguments and
            the picker IS the question, so a `cbe_picker` call must not be failed for the
            question's absence from the prose. FAIL if it performs a full transfer analysis
            already, asks a generic blank-module question, asks the lecturer to choose a work
            category, or adds profile questions.
    - probe: "S1m"
      setup:
        profile: "app"
      turns:
        - "Ich möchte meine bestehende Baustatik-Vorlesung als ersten CBE-Schritt anpassen,
          nicht vollständig neu bauen. Ausgangspunkt ist eine vorgegebene Brückenskizze, die
          alle nach demselben Rechenweg bearbeiten."
      checkpoints:
        - id: "1u"
          type: "judge"
          anchor: "skill:SKILL.md#Recommendations stay within the declared target"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Transfer and a FIRST-STEP ambition are explicit, with a
            concrete existing exercise supplied. PASS requires one bounded adaptation issue or
            smallest qualifying move within that scope. FAIL if it requires a full course
            rebuild, treats the first-step target as inadequate in itself, asks the ambition
            again, or withholds useful transfer work until the lecturer accepts a larger scope.
```
