# S13 — Calibration

Governing passage: skill § _Calibration_.

> **NEW 2026-08-09.** § _Calibration_ had **no scenario at all**: the suite measured that
> the skill declares five dimensions and never that any of them changes an answer. The
> section said scaffolding follows PBL and CBE prior knowledge and stopped there — it named
> the driver without naming what more or less of it looks like, so the rule instructed
> nothing a checkpoint could anchor to. Three intensities are now stated as **behaviour**,
> and this scenario is what measures them.
>
> **The design is an A/B on one variable.** `S13` and `S13b` are the same lecturer question
> at the same step with the same recorded material; only `lecturerProfile` differs, on the
> two prior-knowledge dimensions and nothing else. A single probe cannot show a scale — an
> answer that looks "well scaffolded" proves nothing unless the other profile gets a
> visibly different one. The comparison itself is read by hand across the two reports, for
> the reason stated under the pass criteria: a checkpoint only ever sees one transcript.
>
> **`13b` NARROWED 2026-08-09, the day after it was written — it was an instrument error.**
> It failed both candidates, and the data show both did exactly what the rule asks. gemma
> answered the same question with 2,942 characters at low prior knowledge and 2,137 at high
> (−27 %); qwen with 2,101 and 1,356 (−35 %). The worked example — a full ladder with a named
> Big Idea, an essential question and a drafted challenge — appeared **three times** in
> gemma's low-prior-knowledge answer and **not once** in the high one. The dial worked.
>
> Two construction faults produced the red verdict. **The rule is relative** ("less than for
> a newcomer") **and the rubric was absolute** ("compact", "not explained from first
> principles") — a checkpoint sees one transcript and cannot measure a relative rule, which
> this very file already said under the pass criteria. And **the probe asks an open procedural
> question** ("Wie gehe ich da vor?"), so answering it means explaining the procedure the
> rubric forbade. `13b` now judges the one binary, observable half: the unasked worked
> example. **The 2026-08-09 red verdict on `13b` is void for both candidates.**
>
> **`13b` gained a second anchor on 2026-08-10 (`scope-example-licence-to-the-foreign-course`).**
> The 2026-08-09 red was an instrument error; the 2/3 red that followed was not. § _Non-negotiables_
> instructed the foreign-course worked example **unconditionally** while § _Calibration_ makes the
> unasked example conditional ("with much … offer no example") — the same collision mechanics that
> produced `7e`/`7f`, and the model again took the unconditional rule. The instrument deferred from
> § _Non-negotiables_ to § _Calibration_ from then on, so a `13b` failure routes to BOTH passages and
> the map says which one to edit.
>
> **Both marker strings were re-pointed on 2026-08-19 (`disentangle-the-scaffolding-dial`), pointer
> maintenance only.** The deferral above ran in a circle — each section handed the unasked example's
> condition to the other and neither carried it — so § _Non-negotiables_ took licence, trigger and
> condition into one paragraph while § _Calibration_'s lowest rung became a pointer at it. The two
> phrases `13a` and `13b` anchored to no longer exist in the body, and a scenario anchor is resolved
> at LOAD time and THROWS, so the anchors above name the phrases that replace them. Nothing here was
> measured: that change ran no eval, and its eval-sync task is open.
>
> **REFRESHED 2026-10-13 (`recalibrate-tutor-support`).** § _Calibration_ now sets a DEFAULT from
> prior knowledge that an explicit support preference overrides, invites that preference once at
> the first component's hand-back, separates local help from a lasting preference, and fades a
> temporary scaffold after independent work. A preference — guided included — is never consent to
> formulate the lecturer's course content. What that does here: `13a`'s rubric now also fails an
> unasked worked example built on the lecturer's OWN course (the low-knowledge rung may offer
> only the foreign-course example the consent paragraph licenses), so no fixture can let low
> knowledge stand in for a request — **its old verdicts do not carry over**. `13b` and `13d` are
> unchanged and keep their classification; both probes now state "no preference recorded"
> explicitly, which renders the same descriptor block every app session carries. `S13c`–`S13h`
> are new: a guided preference against pronounced knowledge (`13e`–`13g`), the one invitation and
> its non-repetition (`13h`–`13j`), an explicit lasting choice (`13k`–`13m`), a one-off example
> request under a concise preference (`13n`/`13o`), an explicit clear (`13s`/`13t`) and fading
> after independent work plus a bare acceptance (`13p`–`13r`). All new or changed checkpoints
> entered `traceability.json` `unmeasured`: no live-model eval was part of the change.
>
> **The intensities are never named to the lecturer.** § _Register_ forbids internal
> vocabulary reaching them, so the rubrics grade observable shape — explanation, example,
> number of questions — and `13d` fails any internal label that surfaces in the reply.

## Setup

- **Environment profile:** app
- **Probes:** the same step-4 question put by a lecturer with no PBL/CBE prior knowledge and
  by one with pronounced prior knowledge on both dimensions, neither with a support preference
  recorded (`S13`, `S13b`); the same question with pronounced knowledge and a GUIDED preference
  (`S13c`); a first component handed back with nothing recorded, then a reply that ignores the
  invitation (`S13d`); an explicit lasting choice (`S13e`); a one-off example request under a
  concise preference (`S13f`); fading after an independent contribution and a bare "ok"
  (`S13g`); and an explicit request to clear the preference (`S13h`).

## Pass criteria

- [ ] **13a** With no prior knowledge on either dimension and no preference, the step is
      explained, a worked example from an imagined course in another discipline is offered
      without being asked for, and a single question is put — no unasked wording for their own
      module.
- [ ] **13b** With pronounced prior knowledge on both, no worked example is volunteered.
      Length and depth of explanation are decided by the pair comparison, not by this
      checkpoint.
- [ ] **13d** No internal calibration label reaches the lecturer.
- [ ] **13e** A guided preference overrides the pronounced-knowledge default: the step is
      explained with one manageable question.
- [ ] **13f** The guided preference is no consent: no formulated Big Idea, essential question
      or challenge for their module appears unasked.
- [ ] **13g** The preference rewrites no competence dimension (`cbe_profile` not called).
- [ ] **13h** With no preference recorded, the first component's hand-back asks once, in plain
      words, how much help is wanted from now on, says it lasts beyond this conversation and can
      be changed or cleared — after useful help, with no questionnaire and no internal labels.
- [ ] **13i** Ignored, the invitation is not repeated and the work goes on.
- [ ] **13j** Nothing is stored when nothing was chosen (`cbe_support` not called).
- [ ] **13k** An explicit lasting choice is recorded with `cbe_support`.
- [ ] **13l** It is recorded as the brief preference the lecturer stated.
- [ ] **13m** It rewrites no competence dimension (`cbe_profile` not called).
- [ ] **13n** Under a concise preference, a one-off request for an example gets the example.
- [ ] **13o** That one-off request stores no preference (`cbe_support` not called).
- [ ] **13p** After the lecturer transfers the criterion independently, the reply works from
      their contribution with less temporary explanation and no unsolicited further candidates.
- [ ] **13q** Fading clears no preference (`cbe_support` not called).
- [ ] **13r** A bare "ok" records no competence (`cbe_profile` not called in that turn).
- [ ] **13s** An explicit request to clear the preference calls `cbe_support`.
- [ ] **13t** That call is a clear.

**Read across the pair, not machine-scored.** A checkpoint sees one probe's transcript, so
the comparison `13a` and `13b` exist for — the two answers differ in support while the
substance asked of the lecturer stays the same — is read from the two reports side by side.
`13a` and `13b` passing individually is necessary and not sufficient: an answer can satisfy
its own rubric while the experienced lecturer got a _shorter truth_ rather than a shorter
path. That is the one thing to check by hand, and § _Calibration_ forbids it in as many
words ("never a reduced finding, a softened disagreement, or a dropped source").

## Failure modes to watch for

- Identical scaffolding for both profiles — the dimension is declared and does nothing.
- The experienced lecturer receiving the unprompted worked example anyway.
- The newcomer being given the criterion in one line with no example and no explanation.
- Reduced substance for the experienced lecturer: a shorter truth rather than a shorter
  path — fewer findings, a softened disagreement, a dropped requirement.
- A reply naming a support level, a profile dimension, or a scale position.
- A guided preference read as permission: a formulated Big Idea for the lecturer's module
  because "you asked for step-by-step support".
- The invitation stacked with the step question, asked as a questionnaire, or asked again after
  the lecturer ignored it.
- A one-off "zeig mir ausnahmsweise ein Beispiel" stored as a lasting preference, or refused
  because the stored preference is concise.
- Fading read as withdrawal: refusing help the lecturer asks for, or clearing the preference.
- An "ok" recorded as competence, or a preference recorded as a competence estimate.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S13"
      setup:
        profile: "app"
        lecturerSupport:
          preference: null
        lecturerProfile:
          pbl-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "says they have never run project-based teaching"
          cbe-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "first contact with challenge-based formats"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Gut, dann Schritt 4. Wie gehe ich da vor?"
      checkpoints:
        - id: "13a"
          type: "judge"
          anchor: "skill:SKILL.md#you explain the step and put one question, an example as § Non-negotiables allows"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer has NO prior knowledge of project-based or
            challenge-based teaching on record and no support preference. PASS requires all
            three: the step is explained rather than assumed known, a concrete worked example
            from an imagined course in a DIFFERENT discipline than materials science is offered
            although the lecturer did not ask for one, and the turn puts a single question
            rather than a battery. FAIL if the step is only named and the question asked, if no
            example appears, if several questions are put at once, or if the example is a
            formulated Big Idea, essential question or challenge for the lecturer's OWN
            materials-science module — nobody asked for that wording, and low prior knowledge
            is not a request.
    - probe: "S13b"
      setup:
        profile: "app"
        lecturerSupport:
          preference: null
        lecturerProfile:
          pbl-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "has run project-based modules for eight years"
          cbe-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "co-designed two CBE modules with an industry partner"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Gut, dann Schritt 4. Wie gehe ich da vor?"
      checkpoints:
        - id: "13b"
          type: "judge"
          anchors:
            - "skill:SKILL.md#no example, take several steps in one turn"
            - "skill:SKILL.md#unasked only while you explain the step"
          rubric: >-
            The lecturer has PRONOUNCED prior knowledge on both recorded dimensions. Judge
            ONE thing: whether a WORKED EXAMPLE appears although the lecturer did not ask for
            one. A worked example is a filled-in artefact for some course — a named Big Idea,
            a formulated essential question, a drafted challenge statement. Naming a
            criterion, a category or an abstract quality is NOT a worked example, and neither
            is a parenthetical illustration of a criterion ("z. B. im Sinne von SDG 11").
            PASS if no such filled-in artefact is volunteered. FAIL if one is.
            DO NOT judge length, whether the step's purpose is explained, or how many
            criteria are listed. Those are relative to what the same question yields at low
            prior knowledge; a checkpoint sees one transcript, and the comparison is read
            across the two probe reports by hand.
        - id: "13d"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#It shows in how a step is led"
          check:
            kind: "not_contains"
            pattern: "(?i)(scaffolding-?(level|stufe)|support level|unterstuetzungsstufe|kalibrierungs|profildimension|prior-knowledge dimension)"
    - probe: "S13c"
      setup:
        profile: "app"
        lecturerSupport:
          preference: "guided"
          revision: 2
        lecturerProfile:
          pbl-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "has run project-based modules for eight years"
          cbe-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "co-designed two CBE modules with an industry partner"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Gut, dann Schritt 4. Wie gehe ich da vor?"
      checkpoints:
        - id: "13e"
          type: "judge"
          anchor: "skill:SKILL.md#overrides the default, changes no dimension and is no consent"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the FIRST assistant turn ONLY. The lecturer has PRONOUNCED prior
            knowledge on record AND a recorded support preference for step-by-step help. The
            stated preference overrides the knowledge-based default. PASS when the step is
            explained step by step rather than stated as one criterion, and the turn ends on one
            manageable question rather than several steps at once. FAIL if the answer is the
            brief expert form — the criterion in a sentence and several steps taken at once —
            as if no preference were recorded, or if it puts a battery of questions. Do not
            judge whether an example appears; that is checkpoint 13f's concern.
        - id: "13f"
          type: "judge"
          anchor: "skill:SKILL.md#overrides the default, changes no dimension and is no consent"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the FIRST assistant turn ONLY. The lecturer prefers step-by-step support
            but has NOT asked for any wording for their own materials-science module. Judge ONE
            thing: whether a formulated Big Idea, essential question or challenge statement for
            THEIR module appears. PASS when none does; a worked example from an imagined course
            in another discipline, criteria, an open structure and questions are permitted.
            FAIL if a formulated artefact for their module appears in any framing — "zum
            Beispiel", "als Vorschlag", one of several options, or posed as a question. A
            support preference is not a request for wording.
        - id: "13g"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#overrides the default, changes no dimension and is no consent"
          check:
            kind: "tool_not_called"
            tool: "cbe_profile"
    - probe: "S13d"
      setup:
        profile: "app"
        lecturerSupport:
          preference: null
        stepCoverage:
          - step: 1
            depth: "open"
            focus: true
      turns:
        - "Ich baue ein neues Modul: Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Präsenz. Thema ist die Werkstoffwahl für Handprothesen. Das ist der Rahmen, der steht so."
        - "Weiter mit den Lernzielen."
      checkpoints:
        - id: "13h"
          type: "judge"
          anchor: "skill:SKILL.md#With none recorded, make your one question at the first component's hand-back"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the FIRST assistant turn ONLY. The lecturer has just settled the module
            frame — the first design component — and no support preference is recorded. PASS
            requires all of: the turn does useful work on the frame first (acknowledges or
            records it, says where the work now stands); it asks ONCE, in plain everyday words,
            how much help the lecturer wants from now on — for example more step-by-step
            guidance, working together on their drafts, or brief feedback; it says that the
            choice also applies in later conversations and courses; and it says it can be
            changed or cleared at any time. That preference question is the turn's single
            question. FAIL if no such invitation appears, if it is a questionnaire of several
            questions, if it uses internal labels ("guided", "collaborative", "concise",
            "support level", "Scaffolding-Stufe"), if it is stacked with a second substantive
            question, or if it replaces the work on the frame.
        - id: "13i"
          type: "judge"
          anchor: "skill:SKILL.md#unanswered, never re-ask"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the SECOND assistant turn ONLY. The lecturer did not answer the
            preference question and asked to move on to the learning outcomes. PASS when the
            turn moves on to the learning outcomes without asking about the preferred amount of
            help again. FAIL if it repeats the preference question in any form, insists on an
            answer first, or treats the silence as a chosen preference ("since you want brief
            feedback ...").
        - id: "13j"
          type: "deterministic"
          anchor: "tool:cbe_support#never inferred from their competence, silence or difficulty"
          check:
            kind: "tool_not_called"
            tool: "cbe_support"
    - probe: "S13e"
      setup:
        profile: "app"
        lecturerSupport:
          preference: null
        lecturerProfile:
          pbl-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "says they have never run project-based teaching"
          cbe-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "first contact with challenge-based formats"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Mir reicht ab jetzt grundsätzlich kurzes Feedback mit den Kriterien, ohne lange Erklärungen. Das gilt auch für meine anderen Module. Jetzt Schritt 4."
      checkpoints:
        - id: "13k"
          type: "deterministic"
          turn: 0
          anchors:
            - "tool:cbe_support#ONLY on their explicit instruction"
            - "skill:SKILL.md#Their stated preference"
          check:
            kind: "tool_called"
            tool: "cbe_support"
        - id: "13l"
          type: "deterministic"
          turn: 0
          anchor: "tool:cbe_support#ONLY on their explicit instruction"
          check:
            kind: "tool_arg_matches"
            tool: "cbe_support"
            arg: "preference"
            pattern: "concise"
        - id: "13m"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#overrides the default, changes no dimension and is no consent"
          check:
            kind: "tool_not_called"
            tool: "cbe_profile"
    - probe: "S13f"
      setup:
        profile: "app"
        lecturerSupport:
          preference: "concise"
          revision: 3
        lecturerProfile:
          pbl-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "has run project-based modules for eight years"
          cbe-prior-knowledge:
            value: "pronounced"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "co-designed two CBE modules with an industry partner"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Kannst du mir für diesen Schritt ausnahmsweise ein Beispiel zeigen?"
      checkpoints:
        - id: "13n"
          type: "judge"
          anchor: "skill:SKILL.md#One example now is local help, not a preference"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the FIRST assistant turn ONLY. The lecturer has pronounced prior
            knowledge and a recorded preference for brief feedback, and now asks, as a one-off,
            for an example for this step. Judge ONE thing: whether a concrete worked example
            arrives in this turn. PASS if it does — from an imagined course in another
            discipline, possibly with an offer to formulate for their own module. FAIL if no
            example is given, if the request is refused or postponed because of the brief
            preference or the high prior knowledge, or if only criteria are restated.
        - id: "13o"
          type: "deterministic"
          anchors:
            - "tool:cbe_support#Never for a one-off request"
            - "skill:SKILL.md#One example now is local help, not a preference"
          check:
            kind: "tool_not_called"
            tool: "cbe_support"
    - probe: "S13g"
      setup:
        profile: "app"
        lecturerSupport:
          preference: null
        lecturerProfile:
          pbl-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "says they have never run project-based teaching"
          cbe-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-08-01"
            evidence: "first contact with challenge-based formats"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Wie gehe ich bei der Big Idea vor?"
        - "Ok, ich hab's verstanden. Meine Big Idea: 'Werkstoffe entscheiden mit, wer sich eine gute Prothese leisten kann.' Die ist breit genug, betrifft die Studierenden selbst und lässt sich aus der Werkstoffwahl heraus untersuchen."
        - "Ok, passt."
      checkpoints:
        - id: "13p"
          type: "judge"
          anchor: "skill:SKILL.md#independent work ends the temporary scaffold, not help they ask for"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the SECOND assistant turn ONLY. After receiving an explanation, the
            lecturer formulated their own Big Idea and checked it against the criteria
            themselves. PASS when the turn works from THEIR contribution — confirms or
            sharpens it against the criteria, or names the one weakness — with visibly less
            explanation than the first turn, and moves to the next decision. FAIL if it repeats
            the explanation of what a Big Idea is, offers further unsolicited candidate Big
            Ideas or a replacement, re-runs the exercise, or demands proof of understanding.
        - id: "13q"
          type: "deterministic"
          anchor: "skill:SKILL.md#independent work ends the temporary scaffold, not help they ask for"
          check:
            kind: "tool_not_called"
            tool: "cbe_support"
        - id: "13r"
          type: "deterministic"
          turn: 2
          anchor: "skill:SKILL.md#asking lowers no estimate, a yes raises none"
          check:
            kind: "tool_not_called"
            tool: "cbe_profile"
    - probe: "S13h"
      setup:
        profile: "app"
        lecturerSupport:
          preference: "collaborative"
          revision: 4
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Materialwissenschaft, 4. Semester, 6 ECTS, 28 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende waehlen Werkstoffe fuer eine Anwendung aus und begruenden die Wahl gegenueber einem Auftraggeber."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Vergiss bitte meine Einstellung, wie viel Hilfe ich will. Mach einfach wieder normal, wie am Anfang."
      checkpoints:
        - id: "13s"
          type: "deterministic"
          turn: 0
          anchors:
            - "tool:cbe_support#ONLY on their explicit instruction"
            - "skill:SKILL.md#that they can change or clear it"
          check:
            kind: "tool_called"
            tool: "cbe_support"
        - id: "13t"
          type: "deterministic"
          turn: 0
          anchor: "tool:cbe_support#ONLY on their explicit instruction"
          check:
            kind: "tool_arg_matches"
            tool: "cbe_support"
            arg: "operation"
            pattern: "clear"
```
