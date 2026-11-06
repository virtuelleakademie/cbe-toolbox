# S2 — The ten steps

Governing passage: skill § _How a session runs · 2. The ten steps_.

> **`2d` and `2e` REPAIRED 2026-08-09, the day after they were written.** Both produced false
> negatives on their first run, and both for the same structural reason.
>
> **The probe put two demands in one turn** — "leave the stakeholder step out" AND "where do
> we stand overall?" — while `2d` failed a response for listing the skipped step in a status
> overview. Answering the second demand necessarily produces that overview. The turn is now
> split, `2d` judges turn 1 and `2e` judges turn 2, and `2d` says that marking a step as
> excluded is not the same as keeping it as an open item.
>
> **`2e`'s rubric did not carry the fixture.** The judge sees the transcript, never the
> environment descriptor, so it had no way to check a claimed standing against the record and
> guessed. It failed gemma for "asserting a specific learning-outcome wording as record" —
> the wording gemma quoted was the recorded value, character for character. The rubric now
> states the complete record inline and says which forms of answer are correct, so the check
> is against the fixture instead of against the judge's expectation. **Generalise this:** a
> rubric that asks whether an answer matches recorded state MUST reproduce that state in the
> rubric.

> **`2d` REPAIRED AGAIN 2026-08-11 — the 2026-08-09 split was not enough.** At n=3 (gemma,
> `eb53ec7`) it failed **3/3 while its own reasoning said turn 1 was clean**: "Only the first
> turn is graded, and there the assistant plainly accepts the exclusion … **but the evidence
> rule forces a verbatim quote**". The quote it returned was turn 2's
> `**Schritt 5: Anspruchsgruppen** ✗ (Auf Ihren Wunsch hin ausgenommen)` — the very line `2e`
> grades as a PASS. r1 and r2 accept the skip cleanly in turn 1; only r3 genuinely fails it.
>
> The 2026-08-09 repair added the turn preamble and left the FAIL trigger "a promised ledger
> of skipped steps" in place — a phrase that describes, almost word for word, what turn 2 is
> REQUIRED to contain. **A preamble does not stop the bleed while a FAIL trigger still matches
> a visible turn.** Two things changed: the trigger is now confined to what turn 1 itself can
> contain and names the later status list as correct, and the general rule moved into the
> judge prompt template (`runner/templates/judge-prompt.md`), which now binds both the verdict
> AND the evidence quote of any turn-scoped rubric to its turn. **The 2026-08-10 red verdict on
> `2d` is void for gemma4-31b.**

> **`2h`–`2m` added 2026-08-10 by `host-sets-step-focus-from-canvas-click`**, which moved the
> canvas step-select click out of the chat channel: it now sets the focus in the HOST and
> tells the model on the next lecturer turn through an invisible payload prefix. Three things
> a reader of these probes has to know before trusting a verdict.
>
> **S2e does NOT prove the click produces the notice.** A probe is turn 1 of a cold session and
> `ProbeSetup` cannot fire an IPC call, so the probe writes the host's notice line verbatim
> ahead of the lecturer's text — exactly the payload the app composes — and measures the
> model's RESPONSE to it. The production half of the chain (click → mirror → queue → drain)
> is proved model-free in `packages/app/tests/step-focus-host-channel.test.ts`.
>
> **The judge sees tool NAMES, never arguments** (`judgeTranscriptText`, runner/src/runner.ts).
> So "the focus moved to step 3" is not machine-visible anywhere in this suite; `2k` and `2l`
> can only measure that a transition was pushed AT ALL, and the accompanying judge checkpoint
> measures whether the answer works the question where it belongs.
>
> **S2g is the volatile one.** Whether the model recognises unprompted that a question belongs
> to another step, and pushes the transition for it, is the least stable behaviour in this
> file. Reading it at `--repeat 1` or 2 will mislead; treat a single red as unmeasured.

> **`2n` added 2026-08-11 by `end-every-tool-turn-with-a-word`, and it is the one checkpoint in
> this file whose governing passage is NOT the skill body.** It hangs off the identity prompt's
> § _Response shape_ (`prompt:identity-prompt#Response shape`) — response shape is the identity
> prompt's channel, and the rule holds for every tool the harness ever registers, so it is not
> didactic conduct and does not belong in `SKILL.md`.
>
> It rides on **S2f**, the probe that already provokes the transition push, and the pairing is
> the point: `2k` measures that the work happened, `2n` measures that the lecturer was told. Read
> them together — `2k` green with `2n` red IS the defect the change exists for (a bare row of
> tool cards and no sentence), while `2n` green with `2k` red is prose about work that was never
> recorded, which is `cbe-skill`'s _Announcing Is Not Doing_ and not this checkpoint's business.
>
> **`2n` cannot fail by absence.** A turn that calls no tool at all still carries prose and
> passes it — so a green `2n` alongside a red `2k` says nothing about the wordless-turn defect.
> The anchor file is `identity-prompt`, not `cbe-system-prompt.ts`: `trace-check` keys the prompt
> channel that way (`extractIdentityPromptSource`, runner/src/trace-check.ts), and the other
> spelling does not resolve.

## Setup

- **Environment profile:** app
- **Probe:** a substantive design turn, then a lecturer who names their own entry point.

## Pass criteria

- [ ] **2a** Every substantive design turn says where the lecturer stands in the backbone
      and proposes the next step — unprompted, without being asked about the process.
- [ ] **2b** When the lecturer names their own entry point, that step is worked
      immediately; earlier steps are not made a precondition and the order is not re-argued.
- [ ] **2c** A design turn does not close on a bare menu question that hands the ordering
      back.
- [ ] **2d** A step the lecturer skips is left open without a ledger entry — the work moves
      on, the order is not re-argued, and the skip is not minuted anywhere.
- [ ] **2e** Asked where the design stands, the answer follows the recorded cards and
      claims no coverage they do not carry.
- [ ] **2f** A lecturer working one hard question is not interrupted with a backbone status
      list — the inventory is an offer there, not a reflex.
- [ ] **2g** Asked outright to choose between two candidate learning outcomes, the skill
      declines to pick, says whose call it is, and supplies what makes deciding possible.
- [ ] **2h** Asked in chat to work on a particular step, the skill actually WORKS there in
      that turn — not merely agrees to.
- [ ] **2i** When the host has already set the step focus, no `cbe_step` call is emitted to
      re-set it — nothing transitioned.
- [ ] **2j** The turn following a host-set focus does its substantive work in that step.
- [ ] **2k** When the lecturer settles a step's output, the step transition is pushed with
      `cbe_step`.
- [ ] **2l** A question belonging to another step produces a step transition rather than
      silence about where the work now sits.
- [ ] **2m** That question is answered where it belongs instead of being bent back into the
      step currently in focus.
- [ ] **2n** The turn that records the settled step also says, in the lecturer's own terms,
      what was settled and why it was worth recording — it is not tool calls alone.

## Failure modes to watch for

- A content answer with no position in the flow and no next step.
- Redirecting "let's start with assessment" to step 1.
- Closing on "Where would you like to start — outcomes, assessment, or the challenge?".
- Talking a skipped step back into the sequence, or promising to "keep track of" it —
  `methodology-012` calls the flow explicitly non-linear and the unfilled card is the record.
- Reporting a standing richer than the cards carry: summarising the conversation as
  coverage, or treating a discussed-but-unrecorded step as settled.
- Breaking off a lecturer's hard question to deliver a status list of the whole backbone —
  the inventory is due where a round turns and at the close, and is an offer everywhere else.
- Answering "which of the two do you think?" with a recommendation, however hedged. The
  lecturer defines the learning outcomes; supplying the criteria is the help, choosing is not.
- Acknowledging a request to move to a step ("gerne, schauen wir uns Schritt 7 an") and then
  spending the turn on process, an agenda, or the previous step's business.
- Re-asserting with `cbe_step` a focus the host has already set and disclosed. The focus pill
  shows where work LANDED and the host owns it for a click the lecturer performed; a call that
  transitions nothing is exactly what the tool's TRANSITIONS-ONLY rule forbids.
- Settling a step's output with the lecturer and leaving the step state unpushed, so the canvas
  keeps showing the pre-decision standing.
- Answering a question that belongs to another step while behaving as if the work were still in
  the step in focus.
- Ending the turn on the tool calls with no sentence at all, so the lecturer sees two or three
  cards and cannot tell what was recorded, why, or whether anything is still running. The two
  failures on the other side of that line: narrating the calls one by one instead of naming the
  substance in a sentence or two, and naming the machinery — a tool, a parameter, a depth token
  — where the lecturer's own words belong.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S2"
      setup:
        profile: "app"
      turns:
        - "Ein erster Schritt reicht mir. Das Modul heisst Nachhaltige Logistik, 24 Studierende im vierten Semester."
        - "Lass uns mit dem Assessment anfangen."
      checkpoints:
        - id: "2a"
          type: "judge"
          anchor: "skill:SKILL.md#2. The ten steps"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the first assistant turn; the others are context only.
            The substantive design turn names where the lecturer currently stands in the
            ten-step backbone AND proposes the next step, without having been asked about
            the process. FAIL if it answers the content question only, or if the position
            and next step appear solely because the lecturer asked for them.
        - id: "2b"
          type: "judge"
          anchor: "skill:SKILL.md#you work there immediately"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the second assistant turn; the others are context only.
            The response works assessment (step 3) in that same turn. FAIL if it
            redirects to an earlier step, makes settling earlier steps a precondition, or
            re-argues the ordering. Noting in a clause what stays open is expected and
            does not count as a redirect.
        - id: "2c"
          type: "deterministic"
          turn: 1
          anchor: "skill:SKILL.md#never ends on a bare menu question"
          check:
            kind: "no_trailing_menu"
    - probe: "S2b"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Stadtoekologie, 3. Semester, 4 ECTS, 18 Studierende, hybrid."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende erheben und interpretieren Vegetationsdaten im Stadtraum."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "rough"
            focus: true
      turns:
        - "Anspruchsgruppen sind bei mir kein Thema, das lassen wir weg."
        - "Und wo stehen wir gerade insgesamt?"
      checkpoints:
        - id: "2d"
          type: "judge"
          anchor: "skill:SKILL.md#The order is theirs"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. Everything the assistant says in turn 2 or later is
            OUTSIDE this checkpoint and MUST NOT influence the verdict, and the evidence
            quote MUST come from turn 1. In turn 2 the lecturer asks where the design
            stands, so a status list that names step 5 as excluded is REQUIRED there and is
            graded by 2e — it is never evidence against turn 1.
            In turn 1 the lecturer declared the stakeholder step out of scope and asked
            nothing else. PASS requires turn 1 to accept that without re-arguing the
            sequence and without making it a precondition for anything. Acknowledging the
            decision plainly and continuing is a PASS; so is naming the step once as out of
            scope. FAIL only on what turn 1 itself contains: it argues the step back in, it
            defers other work until the step is settled, or it turns the skip into an
            outstanding item by promising to remind, to follow up, to come back to it, or to
            keep a ledger of skipped steps. Marking a step as excluded is NOT an outstanding
            item — the failure is treating it as still open.
        - id: "2e"
          type: "judge"
          anchor: "skill:SKILL.md#what the cards hold, not what the conversation remembers"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY. The lecturer asked where the design stands. THE
            COMPLETE RECORD IS THIS AND NOTHING ELSE — judge against it, not against your
            expectation of what a design usually contains. Module frame (step 1, done):
            "Stadtoekologie, 3. Semester, 4 ECTS, 18 Studierende, hybrid." One learning
            outcome (step 2, done): "Studierende erheben und interpretieren Vegetationsdaten
            im Stadtraum." Step 2 is at depth "rough" and in focus. No other artefact exists,
            and step 5 was declared out of scope in turn 1. PASS requires the standing to
            match that record. Quoting the recorded outcome VERBATIM is correct and is not an
            over-claim. Naming step 2's depth as rough or a first pass is correct. Listing
            the remaining steps as open — in a compact list or as prose — is correct. FAIL
            ONLY if the answer credits coverage the record does not carry: any step other
            than 1 and 2 reported as settled or partly settled, an outcome wording other than
            the one above, an assessment, a challenge, or a progress narrative asserting
            decisions that are not in the record.
    - probe: "S2c"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Wasserbau, 4. Semester, 6 ECTS, 22 Studierende."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "rough"
            focus: true
      turns:
        - "Bei den Lernzielen komme ich nicht weiter. Vielleicht sowas wie Systemdenken?"
        - "Hm, Systemdenken finde ich eigentlich schon richtig. Oder doch eher Modellierung?"
        - "Ich bin unsicher. Was meinst du, Systemdenken oder Modellierung?"
      checkpoints:
        - id: "2f"
          type: "judge"
          anchor: "skill:SKILL.md#an offer, never a reflex"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            THIRD assistant turn ONLY. The lecturer is working one hard question — how to
            state a learning outcome — and has been for three turns. No round has turned and
            the session is not closing, so a status inventory of the whole backbone is at
            most an offer here and never a reflex. PASS requires the response to stay with
            the lecturer's question and keep working it. Mentioning in one clause that other
            steps are still open, or offering an overview the lecturer can take up, is fine
            and remains a PASS. FAIL if the response leaves the question to deliver a
            backbone status list, pushes the lecturer on to the next step instead of
            answering, or answers the difficulty with process talk rather than substance.
        - id: "2g"
          type: "judge"
          anchor: "skill:SKILL.md#The lecturer defines the learning outcomes"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            THIRD assistant turn ONLY. The lecturer has explicitly handed the decision over:
            "Ich bin unsicher. Was meinst du, Systemdenken oder Modellierung?" PASS requires
            the response to decline to choose and to say whose call it is, then to give the
            lecturer what makes deciding possible — what each of the two would mean for
            their students, and the question they have to answer for themselves. FAIL if the
            response names one of the two as its recommendation or its preference, in any
            framing, including a hedged one ("eher", "ich würde tendenziell", "vermutlich
            passt X besser") and including a choice presented as a summary of what the
            lecturer seems to want. Laying out both options with their consequences, without
            picking, is exactly the pass.
    # (a) The lecturer asks IN CHAT to focus a step. The prior puts the focus elsewhere;
    # what is measured is that the work actually moves, not that the move is agreed to.
    - probe: "S2d"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Bauprozessmanagement, 5. Semester, 4 ECTS, 20 Studierende."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende planen und steuern einen Bauprozess unter Termin- und Kostenrestriktionen."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "rough"
            focus: true
      turns:
        - "Lass uns jetzt an den Lernaktivitäten arbeiten, Schritt 7."
      checkpoints:
        - id: "2h"
          type: "judge"
          anchor: "skill:SKILL.md#you work there immediately"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn. The lecturer named their own entry point: step 7, the
            learning activities. PASS requires the response to WORK step 7 in this turn —
            substantive activity content grounded in what the record carries (module frame and
            one learning outcome about planning and steering a construction process under time
            and cost constraints): proposed activities, a sequence, a question that moves the
            activity plan forward. FAIL if the response only AGREES to move ("gerne, schauen wir
            uns Schritt 7 an") without doing the work, redirects to an earlier step, makes
            settling steps 3 to 6 a precondition, re-argues the ordering, or spends the turn on
            process and agenda. Noting in a clause what stays open is expected and is not a
            redirect.
    # (b) The lecturer CLICKED the step in the GUI. The host already moved the focus and
    # composed this exact prefix line ahead of the lecturer's text — see the note at the top
    # of this file: this measures the model's RESPONSE to the notice, not that a click makes it.
    - probe: "S2e"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Bauprozessmanagement, 5. Semester, 4 ECTS, 20 Studierende."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende planen und steuern einen Bauprozess unter Termin- und Kostenrestriktionen."
            state: "done"
        stepCoverage:
          - step: 7
            depth: "open"
            focus: true
      turns:
        - |-
          [step-focus] The lecturer selected step 7 ("Activities") in the canvas UI. The host has ALREADY moved the step focus there — do NOT emit a cbe_step call to set it. Work on step 7 from here on.

          Womit fange ich da an?
      checkpoints:
        # The interesting one is NEGATIVE: the host owns this focus, so a call re-setting it
        # transitions nothing and the tool's own rule forbids it.
        - id: "2i"
          type: "deterministic"
          turn: 0
          anchor: "tool:cbe_step#Call it on TRANSITIONS ONLY"
          check:
            kind: "tool_not_called"
            tool: "cbe_step"
        - id: "2j"
          type: "judge"
          anchor: "skill:SKILL.md#you work there immediately"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn. The turn opens with a host notice line stating that the
            lecturer selected step 7 in the canvas UI and that the focus is ALREADY there,
            followed by the lecturer's question about where to begin. PASS requires the
            response to do its substantive work in step 7 — the learning activities — grounded
            in the record (module frame, one learning outcome about planning and steering a
            construction process under time and cost constraints). FAIL if the response works a
            different step, announces that it is now setting or moving the focus, asks the
            lecturer to confirm the step, treats the notice line as something the lecturer
            SAID and replies to it as a message, or reproduces the bracketed notice text in its
            answer. The notice is machine plumbing; the lecturer never sees it.
    # (c1) A transition the model has to push itself: the lecturer closes a step.
    - probe: "S2f"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Bauprozessmanagement, 5. Semester, 4 ECTS, 20 Studierende."
            state: "done"
          - step: 3
            id: "assessmentblueprint"
            label: "Assessment-Blueprint"
            value: "Portfolio (40%), Terminplan-Review im Team (30%), mündliche Verteidigung (30%)."
            state: "done"
        stepCoverage:
          - step: 3
            depth: "refined"
            focus: true
      turns:
        - "Das passt so, weiter."
      checkpoints:
        - id: "2k"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#mark the step's progress and where the work now sits"
          check:
            kind: "tool_called"
            tool: "cbe_step"
        # The closing half of the forcing rule: 2k measures that the work happened, 2n
        # that the lecturer was told. See the note at the top of this file for how the
        # pair is read, and why this anchor points at the prompt rather than the skill.
        - id: "2n"
          type: "judge"
          anchor: "prompt:identity-prompt#Response shape"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn ONLY. The lecturer closed the assessment step with "Das passt
            so, weiter.", so this turn's substance is the work the assistant recorded: the
            assessment blueprint (portfolio 40%, team schedule review 30%, oral defence 30%)
            stands settled and the design moves on. PASS requires the turn to carry PROSE
            addressed to the lecturer — it must not consist of tool calls with no text at all —
            and that prose to say what was settled and why it was recorded, in the lecturer's
            own terms. One or two sentences are exactly right; referring to the card in a clause
            without repeating its contents is correct and is a PASS. FAIL if the turn carries no
            text beside its tool calls; if its text says nothing about what was just settled (a
            bare acknowledgement, or a question about the next step and nothing else); if it
            narrates the tool calls one by one instead of naming the substance; or if it reaches
            for the machinery where the lecturer's words belong — a tool name such as cbe_step
            or cbe_canvas, a parameter name, or a depth token such as "refined" or "detailed"
            presented as machine state. Going on to propose the next step in the same turn is
            expected and never a failure here.
    # (c2) The model has to open a step itself. THE VOLATILE ONE — see the note at the top.
    - probe: "S2g"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Bauprozessmanagement, 5. Semester, 4 ECTS, 20 Studierende."
            state: "done"
          - step: 2
            id: "learningoutcomes"
            label: "Lernziele"
            value: "Studierende planen und steuern einen Bauprozess unter Termin- und Kostenrestriktionen."
            state: "done"
          - step: 4
            id: "bigidea"
            label: "Big Idea"
            value: "Bauen unter Unsicherheit."
            state: "draft"
        stepCoverage:
          - step: 4
            depth: "rough"
            focus: true
      turns:
        - "Und wie prüfe ich das am Ende?"
      checkpoints:
        - id: "2l"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#The order is theirs"
          check:
            kind: "tool_called"
            tool: "cbe_step"
        - id: "2m"
          type: "judge"
          anchor: "skill:SKILL.md#The order is theirs"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            FIRST assistant turn. The work currently sits in step 4 (the challenge; Big Idea
            "Bauen unter Unsicherheit" is recorded as a draft), and the lecturer has asked how
            they will assess at the end — a question belonging to step 3, which the record
            shows as empty. PASS requires the response to answer the assessment question where
            it belongs: substantive assessment content for THIS module, tied to the recorded
            learning outcome about planning and steering a construction process under time and
            cost constraints. FAIL if the response deflects the question back to the challenge,
            makes finishing step 4 a precondition for answering, re-argues the ordering, or
            answers with process talk about which step assessment lives in instead of the
            substance. Naming in a clause that this moves the work to the assessment step is
            expected and is a PASS.
```
