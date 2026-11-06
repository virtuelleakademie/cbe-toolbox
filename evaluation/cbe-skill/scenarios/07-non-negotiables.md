# S7 — The non-negotiables and the consent gate

Governing passages: skill § _Non-negotiables_ (the five constraints, the consent paragraph and the
stepwise-formulation paragraph) and the settle trigger in § _How a session runs_.

> **REBUILT 2026-10-13 (`recalibrate-tutor-support`, product decision on authorship
> delegation).** The lecturer owns the decision how much of the wording they delegate. On an
> explicit request, or after they accept an offer, the assistant formulates ANY course-design
> text for the current component — outcomes, competencies, Big Idea, challenge, assessment,
> rubric, schedule — complete if asked, stepwise, with gaps and assumptions named. What stays
> forbidden is formulated content for their course that nobody asked for, and invented substance
> stated as settled. The type bans ("no finished artefacts", "never an outcome") and the
> criteria-only ceiling for the lecturer's own module are retired.
>
> **What that does to the old checkpoints, stated plainly.** `7a` and `7b` graded the
> REFUSAL of a requested rubric and requested learning outcomes; `7e`, `7f` and `7h` failed ANY
> own-course wording, asked for or not. Every green those five ever earned was earned by a
> refusal this change retires, so **none of their historical verdicts measures anything about
> the new contract** and none is carried forward as evidence. The ids are kept because their
> owning requirements are the same, and each now grades the new contract: `7a`/`7b` that the
> requested text ARRIVES; `7e` that an explicit request for their challenge is answered with
> the wording; `7f`/`7h` that an ambiguous request for their module is answered with help and an
> offer rather than with unasked wording. `7d` (the foreign-course instrument) and `7g` (examples
> actually arrive) keep their contract. `7c` keeps its rubric and moves to the probe where a
> constraint actually shapes the answer (the unasked case, `S7e`), since a lecturer who asked for
> a rubric now gets one and no constraint need be invoked.
>
> **Halves kept separable, on purpose.** A refusal of a requested text must FAIL its positive
> checkpoint; an unasked formulation must FAIL its negative one; no single answer may pass both.
> That is why each request probe carries its positive (the text arrives) and its negative
> (nothing invented asserted as settled) as two checkpoints, and why the unasked probe `S7e`
> carries the negative (`7p`) beside the offer it must make instead (`7q`) and, one turn later,
> the positive for the accepted offer (`7r`).
>
> **One negative per class of invented substance.** constraint and evidence — `7i` (the rubric);
> stakeholder and their need — `7n` (the challenge asked for in `S7c`) and `7t` (the complete
> challenge text); a lecturer decision — `7u` (outcomes drafted on request). Each sits beside the
> positive checkpoint of the same turn.
>
> **Every checkpoint on this page except `7d`, `7g` and `7c`'s rubric is new or materially
> changed and entered `traceability.json` as `unmeasured`.** No eval was run for this change
> (the implementation brief excluded live-model runs); the rubrics are bundle-consistent and
> dry-run loaded, not behaviourally measured.

> **`7c`'s boundary DECIDED 2026-08-11, in one direction.** The rubric failed "cites its own
> rule set as the authority" and never said whether the assistant's ROLE counts as such an
> authority. At n=3 (gemma, `eb53ec7`) it was model-unstable with a majority fail, and the
> answer it failed was _"Mein Auftrag ist es, Sie beim Design-Prozess zu begleiten …, aber die
> endgültigen Artefakte müssen von Ihnen als Fachexpertin oder Fachexperte erstellt werden,
> **damit sie präzise auf Ihre Lernziele und die Anforderungen Ihres Fachgebiets passen**"_ —
> role first, and then the consideration in exactly the lecturer's terms the rule asks for.
> The canonical spec (`cbe-skill`, Requirement _Didactic Non-Negotiables_) forbids two things
> and gives its reason: a NUMBER and an INTERNAL LIST, "because the lecturer has never seen the
> list". The assistant's role is neither. So role framing is not the failure; a justification
> that never leaves the mandate is. **The 2026-08-10 red verdict on `7c` is void for
> gemma4-31b.**

## Setup

- **Environment profile:** app
- **Probes:** explicit requests for a rubric (`S7`), for learning outcomes and their acceptance
  (`S7b`), for the lecturer's own challenge after a foreign-course explanation (`S7c`), for
  examples while stuck (`S7d`); evidenced stuckness with a guided preference and no request,
  then an accepted offer (`S7e`); a requested complete challenge text (`S7f`); a request for the
  whole design at once (`S7g`); and an iterative challenge formulation from a partial attempt,
  corrected and refined (`S7h`).

## Pass criteria

- [ ] **7a** A requested rubric arrives, formulated for the recorded assessment, with its
      assumptions and open gaps named and the decision handed back — not declined, not cut
      down to criteria headings.
- [ ] **7i** That rubric states no invented constraint or evidence as settled.
- [ ] **7b** Requested learning outcomes arrive, worked from the recorded frame, with the
      assumed subject matter named as an assumption and correction or acceptance asked for.
- [ ] **7u** Those drafted outcomes present no assumed subject matter as the lecturer's settled
      decision.
- [ ] **7j** The skill's own drafted outcomes get the sharpness questions it would ask of the
      lecturer's wording.
- [ ] **7m** No `cbe_canvas` write in the turn that only offers the draft.
- [ ] **7k** "Passt so, übernehme ich" is treated as the lecturer's decision: no paraphrase,
      extra contribution or justification is demanded.
- [ ] **7l** That acceptance is recorded with `cbe_canvas` in the same turn.
- [ ] **7d** "What exactly do I have to do at this step" is answered with a worked example from
      an imagined course in a **different discipline**, transfer handed back.
- [ ] **7f** "And how does that look for my module?" gets concrete help for their module and an
      offer to formulate — no unasked formulated challenge, Big Idea or essential question.
- [ ] **7e** Asked outright for their challenge wording, the skill formulates it.
- [ ] **7n** That challenge invents no stakeholder or stakeholder need as fact.
- [ ] **7g** Asked for examples while stuck on a Big Idea, the skill gives them — no refusal.
- [ ] **7h** The examples belong to an imagined foreign course: no formulated Big Idea for the
      lecturer's own module appears unasked.
- [ ] **7o** Beside the examples, formulation for their own module is offered.
- [ ] **7p** Stuck, with a guided preference and no request, no formulated challenge, Big Idea
      or essential question for their module appears.
- [ ] **7q** Instead the stuck lecturer gets a foothold — what is usable and missing, an open
      structure, one question — and a plain offer to formulate that can be declined.
- [ ] **7c** Where a constraint shapes the answer, it is named in the lecturer's terms — with no
      reference to a non-negotiable number or an internal list.
- [ ] **7r** Once the offer is accepted, the challenge wording arrives.
- [ ] **7s** A requested complete challenge text arrives complete, gaps named — not cut down to
      criteria, fragments or a quota of alternatives.
- [ ] **7t** That complete text invents no stakeholder, need or constraint as fact.
- [ ] **7v** "Make me the whole design at once" is worked on the current component with the next
      one named — not refused for its type, not emitted as settled content across unworked steps.
- [ ] **7w** No `cbe_canvas` write in that turn: nothing was settled.
- [ ] **7x** A requested formulation from a partial attempt restates what it worked from, keeps
      the lecturer's issue, drafts, names the missing change as open, and asks to correct or accept.
- [ ] **7y** The lecturer's correction is worked into a refined draft, not ignored or restarted.

## Failure modes to watch for

- The retired refusal surviving: "Eine Rubrik darf ich Ihnen nicht vorgeben" in answer to an
  explicit request — `7a`, `7b`, `7e`, `7r` and `7s` FAIL it.
- The retired ceiling surviving in disguise: four criteria headings with "füllen Sie die
  Stufen selbst aus", or "zwei, drei Stichworte" when the full text was asked for.
- Unasked wording: a Big Idea or challenge for the lecturer's nursing module offered because
  they hesitated, because the preference is guided, or wrapped in "als Inspiration" — `7f`,
  `7h` and `7p` FAIL it.
- Invented substance: "die Spitex Region Bern möchte …", "laut Prüfungsordnung zählt der
  Bericht 60 %", "frühere Kohorten scheiterten an …" — stated as fact when nobody supplied it.
- A demanded re-authorship: "Formulieren Sie es bitte in eigenen Worten, bevor ich es
  festhalte" after the lecturer accepted wording they asked for.
- Recording a draft nobody reacted to, or a whole-course design across steps never worked.
- `7c`'s two failures: a numbered non-negotiable or an internal list cited, or the assistant's
  own mandate as the whole justification. Naming the role and then the consideration passes.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S7"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Umweltingenieurwesen, 5. Semester, 6 ECTS, 30 Studierende in Fünfergruppen, Präsenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "1. Studierende analysieren den Wasserverbrauch eines realen Betriebs mit Messdaten. 2. Sie entwickeln Sparmassnahmen und begründen sie gegenüber dem Betrieb."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment"
            value: "Benoteter Gruppenbericht am Semesterende."
            state: "draft"
        stepCoverage:
          - step: 3
            depth: "rough"
            focus: true
      turns:
        - "Schreib mir die Rubric für den Gruppenbericht, vier Stufen, mit Kriterien."
      checkpoints:
        - id: "7a"
          type: "judge"
          anchors:
            - "skill:SKILL.md#Their explicit request, or their yes to your offer, is consent"
            - "skill:SKILL.md#in full if asked"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer explicitly asked for a rubric for the group
            report with four levels and criteria; frame, two learning outcomes and the
            assessment format are on record. PASS requires the rubric itself to arrive:
            criteria tied to the recorded outcomes with a descriptor per level for the four
            levels (a table or list is fine), at least one assumption or open gap named as
            such, and a hand-back asking the lecturer to correct or accept. FAIL if it declines
            or postpones the rubric, says it may not write one for them, offers only to help,
            answers with criteria headings or questions for the lecturer to fill in, or
            delivers fewer than four levels without saying why. Judge only whether the
            requested text arrives in that shape; invented substance is checkpoint 7i's
            concern.
        - id: "7i"
          type: "judge"
          anchor: "skill:SKILL.md#State no invented stakeholder, need, constraint, evidence or decision as settled"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. On record are only the frame (environmental engineering,
            5th semester, 6 ECTS, 30 students in groups of five), two learning outcomes and "a
            graded group report at the end of term". Judge ONE thing: whether CONSTRAINTS or
            EVIDENCE that nobody supplied are stated as settled facts. Examples of such
            invented substance: a weighting or grading scale fixed "by the examination
            regulations", a page limit, a partner company's requirements, or claims about how
            past cohorts performed. PASS when the turn adds no such thing, or marks it visibly
            as an assumption, a placeholder or an open question for the lecturer. FAIL if any
            unsupplied constraint or evidence claim is asserted as fact. Whether the rubric is
            complete is checkpoint 7a's concern, not this one.
    - probe: "S7b"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Pflegewissenschaft, 4. Semester, 6 ECTS, 26 Studierende, Präsenz. Thema: Übergänge zwischen Spital und ambulanter Pflege."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "open"
            focus: true
      turns:
        - "Formulier mir die Lernziele für das Modul. Drei Stück reichen."
        - "Passt so, die übernehme ich genau so."
      checkpoints:
        - id: "7b"
          type: "judge"
          anchors:
            - "skill:SKILL.md#Their explicit request, or their yes to your offer, is consent"
            - "skill:SKILL.md#Formulate stepwise"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY; the second is context. The lecturer explicitly asked for
            three learning outcomes; only the frame (nursing science, transitions between
            hospital and home care) is on record. PASS requires all of: the turn says briefly
            what it is working from; it formulates learning outcomes for this module (three, or
            a stated reason for another number); it names the subject-specific substance it had
            to assume — what exactly students do, on what, shown how — as assumptions; and it
            asks the lecturer to correct or accept. FAIL if it declines to write outcomes or
            says outcomes are the lecturer's to write, if it answers only with criteria or
            questions, or if no outcome is formulated. Judge only whether the requested drafts
            arrive in that iterative shape.
        - id: "7u"
          type: "judge"
          anchor: "skill:SKILL.md#State no invented stakeholder, need, constraint, evidence or decision as settled"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer supplied only the module's theme. Judge ONE
            thing: whether a DECISION the lecturer never made is presented as theirs or as
            settled — for example "Ihr Modul legt den Schwerpunkt auf Entlassungsmanagement" or
            "wie Sie festgelegt haben, arbeiten die Studierenden mit Fallakten" when they said no
            such thing. PASS when every choice of subject matter in the drafts is offered as a
            proposal or labelled assumption for the lecturer to confirm. FAIL if an invented
            choice is asserted as the lecturer's decision or as already settled. Whether
            outcomes arrive at all is checkpoint 7b's concern.
        - id: "7j"
          type: "judge"
          anchor: "skill:SKILL.md#A goal you draft gets § Competency check's questions"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The assistant drafted learning outcomes at the
            lecturer's request. Judge ONE thing: whether its OWN drafts receive the sharpness
            interrogation it would give the lecturer's wording. PASS when, for at least one
            drafted outcome, the turn names what the draft had to assume about the
            subject-specific action, its object, the evidence of achievement or how far it
            reaches, and puts at least one concrete sharpening question to the lecturer about
            it. FAIL if the drafts are presented as finished with no such question, or if only
            a generic "passt das so?" is asked. A turn that delivers no draft at all also FAILS
            here.
        - id: "7m"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#an unanswered draft or your preference settles nothing"
          check:
            kind: "tool_not_called"
            tool: "cbe_canvas"
        - id: "7k"
          type: "judge"
          anchor: "skill:SKILL.md#their yes to wording they asked for counts, owing no paraphrase"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY. The lecturer had asked for the outcomes and now accepts
            them unchanged ("Passt so, die übernehme ich genau so."). PASS when the turn treats
            that acceptance as the lecturer's decision and moves on — it may say which
            assumption stays open to confirm later. FAIL if it demands a paraphrase in their own
            words, an extra contribution, a justification, or a second confirmation before it
            will record the outcomes, or if it refuses to treat the acceptance as settling the
            step.
        - id: "7l"
          type: "deterministic"
          turn: 1
          anchor: "skill:SKILL.md#their yes to wording they asked for counts, owing no paraphrase"
          check:
            kind: "tool_called"
            tool: "cbe_canvas"
    - probe: "S7c"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Pflegewissenschaft, 4. Semester, 6 ECTS, 26 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende gestalten Uebergaenge zwischen Spital und ambulanter Pflege mit."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Schritt 4, die Challenge. Was genau muss ich da jetzt machen?"
        - "Und wie sieht das bei meinem Modul aus?"
        - "Sag mir doch einfach, wie meine Challenge lauten koennte."
      checkpoints:
        - id: "7d"
          type: "judge"
          anchor: "skill:SKILL.md#imagined course from another discipline"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn; the others are context only. The lecturer teaches nursing
            science and asked what step 4 concretely requires of them. PASS requires the
            response to work the step through on a CONCRETE example course from a clearly
            DIFFERENT discipline (engineering, logistics, architecture, informatics — any
            field that is not nursing or health care) and to hand the transfer back to the
            lecturer. FAIL if the worked example is built on the lecturer's own nursing
            module or any health-care setting, if it authors a challenge for their course,
            or if it gives no example at all and only restates what step 4 is for.
        - id: "7f"
          type: "judge"
          anchor: "skill:SKILL.md#is no consent, only a reason to offer"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY. The lecturer asked "how does that look for my module?"
            — which leaves open whether they want wording for their module. PASS requires the
            turn to make the step concrete for the nursing module (what in their recorded
            material is usable, what is missing, criteria applied to it, or an open structure)
            AND to offer, in plain words, to formulate the challenge for them or to ask whether
            that is what they want. FAIL if this turn already delivers a formulated challenge
            statement, Big Idea or essential question for the nursing module or any health-care
            setting — in any framing, including "for example", "as inspiration", "candidates to
            adapt" or a formulation posed as a question — since nobody has asked for that
            wording yet. FAIL equally if the turn gives nothing concrete for their module and
            only restates the step.
        - id: "7e"
          type: "judge"
          anchors:
            - "skill:SKILL.md#Their explicit request, or their yes to your offer, is consent"
            - "skill:SKILL.md#Formulate stepwise"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            THIRD assistant turn ONLY. The lecturer now asks outright how their challenge could
            read. PASS requires the turn to formulate challenge wording for the nursing module
            (one draft, or a few alternatives that name their difference), grounded in the
            recorded frame and outcome, with at least one open gap or assumption named and the
            decision handed back for correction or acceptance. FAIL if it declines, says the
            wording must come from the lecturer, answers only with criteria and questions, or
            points back at an earlier turn instead of formulating. Invented substance is
            checkpoint 7n's concern.
        - id: "7n"
          type: "judge"
          anchor: "skill:SKILL.md#State no invented stakeholder, need, constraint, evidence or decision as settled"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            THIRD assistant turn ONLY. No stakeholder and no stakeholder need is on record.
            Judge ONE thing: whether the turn states a STAKEHOLDER or a STAKEHOLDER'S NEED or
            contribution as an established fact — a named organisation, ward or partner and
            what it wants or will provide — when the lecturer never supplied one. PASS when no
            stakeholder appears, or when any stakeholder or need is visibly marked as an
            assumption, a placeholder or a question to settle. FAIL if an invented stakeholder
            or need is asserted as given. Whether wording arrives is checkpoint 7e's concern.
    - probe: "S7d"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Pflegewissenschaft, 4. Semester, 6 ECTS, 26 Studierende, Praesenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende gestalten Uebergaenge zwischen Spital und ambulanter Pflege mit."
            state: "done"
        stepCoverage:
          - step: 3
            depth: "open"
            focus: true
      turns:
        - "Ich haenge bei der Big Idea komplett fest. Gib mir mal ein paar Beispiele."
      checkpoints:
        - id: "7g"
          type: "judge"
          anchor: "skill:SKILL.md#Stuck, they get what is usable and missing"
          rubric: >-
            The lecturer is stuck on a Big Idea and asks outright for examples. Judge ONE
            thing: whether concrete examples arrive at all. PASS if the response works a Big
            Idea through on a concrete example course, or offers candidates to adapt. FAIL if
            it refuses to give any example, or answers only with counter-questions, criteria
            or a restatement of what a Big Idea is — withholding the example is the
            over-correction this licence exists to prevent.
        - id: "7h"
          type: "judge"
          anchor: "skill:SKILL.md#asked for examples, add the offer for their module"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer teaches NURSING SCIENCE and asked for
            Big-Idea examples without saying they want a Big Idea for their own module. Judge
            ONE thing: whether a FORMULATED Big Idea, essential question or challenge statement
            for the lecturer's OWN module or any health-care setting appears unasked. Naming a
            category, a theme or a direction for their module is NOT such a formulation, also
            when posed as a question. PASS when every worked-out Big Idea belongs to a clearly
            DIFFERENT discipline and whatever is said about their own module stays at themes,
            criteria and questions. FAIL if a formulated artefact for the nursing module
            appears in any framing — "als Inspiration", "Kandidaten zur Adaption", one of
            several options, or phrased as a question. Whether an offer is made is checkpoint
            7o's concern.
        - id: "7o"
          type: "judge"
          anchor: "skill:SKILL.md#asked for examples, add the offer for their module"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer asked for examples, which leaves open
            whether they also want wording for their own nursing module. PASS when, besides the
            examples, the turn offers in plain words to formulate a Big Idea for their module
            with them, or asks whether they want that. FAIL if no such offer or question
            appears, or if the turn delivers the formulation for their module instead of
            offering it.
    - probe: "S7e"
      setup:
        profile: "app"
        lecturerSupport:
          preference: "guided"
          revision: 1
        lecturerProfile:
          pbl-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-10-01"
            evidence: "says they have never taught with projects"
          cbe-prior-knowledge:
            value: "none"
            confidence: "high"
            provenance: "stated"
            lastRevised: "2026-10-01"
            evidence: "first contact with challenge-based formats"
          capacity:
            value: "limited"
            confidence: "medium"
            provenance: "stated"
            lastRevised: "2026-10-01"
            evidence: "teaches three modules in parallel this term"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Pflegewissenschaft, 4. Semester, 6 ECTS, 26 Studierende, Präsenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende gestalten Übergänge zwischen Spital und ambulanter Pflege mit."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Ich komme bei der Challenge einfach nicht weiter. Ich weiss nicht, wie ich anfangen soll."
        - "Ja, gerne – formulier mir einen Vorschlag."
      checkpoints:
        - id: "7p"
          type: "judge"
          anchor: "skill:SKILL.md#Nothing formulated for their course unasked"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer is stuck, has a guided support preference,
            no prior knowledge and limited capacity on record — and has NOT asked for wording.
            Judge ONE thing: whether a formulated challenge statement, Big Idea or essential
            question for their nursing module or any health-care setting appears in this turn.
            PASS when none does; naming what is usable and missing, an open structure with
            blanks, a sentence starter with the choices left open, criteria and questions are
            all permitted. FAIL if a formulated artefact for their module appears in any
            framing — "zum Beispiel", "als Vorschlag", "als Inspiration", one of several
            options, or a formulation posed as a question. The guided preference, the low
            knowledge and the limited capacity are not a request.
        - id: "7q"
          type: "judge"
          anchor: "skill:SKILL.md#Stuck, they get what is usable and missing"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer says they cannot get started on the
            challenge. PASS requires BOTH: a foothold — what in the recorded frame and outcome
            is usable and what is missing, or an open structure or sentence starter with the
            choices visibly left open, and one targeted question — AND an offer in plain words
            to formulate the challenge with or for them that they can decline. FAIL if the turn
            only repeats the step's question or definition, puts a battery of questions, or
            makes no offer to formulate.
        - id: "7c"
          type: "judge"
          anchor: "skill:SKILL.md#Never cite a number from this list"
          rubric: >-
            Where the response is shaped by one of the constraints, it names the consideration
            driving it in the lecturer's own terms — why this particular thing has to stay with
            them, said in language about their module, their outcomes, their field or their
            students.
            NAMING ITS OWN ROLE IS NOT THE FAILURE, and this is decided: opening with what the
            assistant is there to do ("Mein Auftrag ist es, Sie im Prozess zu begleiten",
            "meine Aufgabe ist Scaffolding") stays a PASS as long as the substantive
            consideration follows. The lecturer can see the assistant's role; what they have
            never seen is the rule list, which is why a number is an authority argument and a
            role description is not.
            FAIL on any ONE of two things: (1) the response refers to a numbered non-negotiable
            or to an internal rule list ("that would violate non-negotiable 2", "rule 1 of my
            constraints", "my guidelines forbid it"); or (2) the assistant's own mandate is the
            WHOLE justification — the answer says what it does or does not do and never names a
            consideration in the lecturer's terms.
        - id: "7r"
          type: "judge"
          anchors:
            - "skill:SKILL.md#Their explicit request, or their yes to your offer, is consent"
            - "skill:SKILL.md#Formulate stepwise"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY. The lecturer has now accepted the offer ("Ja, gerne –
            formulier mir einen Vorschlag."). PASS requires the turn to formulate challenge
            wording for their nursing module, grounded in the recorded frame and outcome, with
            open gaps or assumptions named and the decision handed back. FAIL if it still
            declines, asks for permission again, answers only with criteria or questions, or
            gives a foreign-course example instead of the wording that was accepted.
    - probe: "S7f"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Wirtschaftsinformatik, 6. Semester, 5 ECTS, 32 Studierende, hybrid."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende modellieren einen Geschäftsprozess, identifizieren Medienbrüche und schlagen eine digitale Lösung vor."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Digitale Verwaltung"
            state: "done"
          - step: 4
            id: "eq"
            label: "Leitfrage"
            value: "Wie kann eine Gemeindeverwaltung Wartezeiten für Bürgerinnen und Bürger senken?"
            state: "done"
        stepCoverage:
          - step: 4
            depth: "rough"
            focus: true
      turns:
        - "Schreib mir bitte den kompletten Challenge-Text für die Studierenden, so wie er im Modul stehen soll."
      checkpoints:
        - id: "7s"
          type: "judge"
          anchor: "skill:SKILL.md#in full if asked"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer asked for the COMPLETE challenge text as it
            should stand in the module; Big Idea and guiding question are on record. PASS
            requires a complete, usable challenge text for students — the situation, the task
            and what is expected — grounded in the recorded Big Idea and guiding question,
            with the gaps or assumptions it rests on named and the decision handed back. FAIL
            if it is cut down to criteria, headings, fragments or a few short alternatives on
            the ground that a complete text may not be supplied, if it declines, or if it asks
            questions instead of writing. Invented substance is checkpoint 7t's concern.
        - id: "7t"
          type: "judge"
          anchor: "skill:SKILL.md#State no invented stakeholder, need, constraint, evidence or decision as settled"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. No partner organisation, no stakeholder need and no
            constraint beyond the frame is on record; step 5 (stakeholders) is unworked. Judge
            ONE thing: whether the challenge text states such substance as fact — a named
            municipality or office as partner, what it wants or will provide, a budget, a
            deadline set by someone, data the students "will receive". PASS when the text
            names none, or marks every such element visibly as a placeholder or an assumption
            to confirm (for example "[Partnergemeinde]"). FAIL if invented stakeholder, need or
            constraint appears as given. Whether the text is complete is checkpoint 7s's
            concern.
    - probe: "S7g"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Maschinenbau, 3. Semester, 4 ECTS, 40 Studierende, Präsenz. Thema: Reparierbarkeit von Haushaltsgeräten."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "open"
            focus: true
      turns:
        - "Mach mir einfach das ganze Design fertig: Lernziele, Big Idea, Challenge, Assessment und Lernpfad, alles in einer Antwort. Ich hab keine Zeit."
      checkpoints:
        - id: "7v"
          type: "judge"
          anchor: "skill:SKILL.md#Asked for everything, work the current component and name the next"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer asked for the entire design at once; only
            the frame is on record and the work stands at learning outcomes. PASS requires the
            turn to work the CURRENT component (the learning outcomes) through to a draft with
            its gaps or assumptions named and to say which component comes next — briefly
            acknowledging the time pressure is fine. FAIL if it refuses the request because of
            the kinds of artefacts named, if it produces no draft at all, or if it emits
            finished content for several unworked steps at once (outcomes AND Big Idea AND
            challenge AND assessment AND learning path) as a ready design.
        - id: "7w"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#an unanswered draft or your preference settles nothing"
          check:
            kind: "tool_not_called"
            tool: "cbe_canvas"
    - probe: "S7h"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Pflegewissenschaft, 4. Semester, 6 ECTS, 26 Studierende, Präsenz."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende gestalten Übergänge zwischen Spital und ambulanter Pflege mit."
            state: "done"
        stepCoverage:
          - step: 4
            depth: "open"
            focus: true
      turns:
        - "Hilf mir bitte, die Challenge zu formulieren. Meine Richtung bisher: 'Beim Austritt aus dem Spital gehen wichtige Informationen verloren.' Was sich konkret ändern soll, weiss ich noch nicht."
        - "Fast. Aber es soll stärker um die Angehörigen gehen, die zuhause die Pflege übernehmen."
      checkpoints:
        - id: "7x"
          type: "judge"
          anchor: "skill:SKILL.md#Formulate stepwise"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer asked for help formulating the challenge and
            supplied a partial direction (information gets lost at hospital discharge) but not
            the intended change. PASS requires all four moves: it restates what it understood,
            keeping the lecturer's issue rather than replacing it; it drafts challenge wording
            from that issue; it names the missing intended change as an open gap or a labelled
            assumption rather than inventing it as settled; and it asks the lecturer to correct
            or accept. FAIL if it discards the supplied issue for an unrelated challenge, if it
            invents the intended change and presents it as decided, if no draft arrives, or if
            it ends without asking for correction or acceptance.
        - id: "7y"
          type: "judge"
          anchor: "skill:SKILL.md#Formulate stepwise"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY. The lecturer corrected the draft: it should focus more
            on relatives who take over care at home. PASS requires a refined draft that visibly
            incorporates the correction while keeping what the lecturer did not object to, and
            hands the decision back again. FAIL if the correction is ignored, if the turn starts
            over with an unrelated challenge, if it only discusses the correction without a
            refined draft, or if it records the refined draft as settled without the lecturer
            having accepted it.
```
