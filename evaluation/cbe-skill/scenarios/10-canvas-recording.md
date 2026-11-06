# S10 — Recording what settles

Governing passage: skill § _How a session runs · 2. The ten steps_ for the recording
trigger and the id table; the `cbe_canvas` tool prose for what may not be recorded — since
2026-08-18 that rule sits in the `value` parameter description rather than the tool
`description`, which is where the anchor of `10c` resolves.

> **One settle trigger since `settle-only-on-a-lecturer-decision` (2026-08-18).** The
> ten-steps section used to name two — a decision the lecturer states **or** their acceptance
> of a proposal the assistant made — and the second was a widening the canonical spec never
> established, contradicting the rules that forbid the assistant to author a formulated
> artefact for the lecturer's own module. It is gone, and the `cbe_canvas` `value` description
> no longer says "never a proposal the lecturer has not accepted", whose converse read as a
> licence for an accepted one; it now names the value's SOURCE, so acceptance changes nothing.
> `10c` measures exactly what it always did and its rubric is untouched — a turn carrying only
> candidates records nothing — but the prose below is stated in the single trigger, so this
> scenario does not go on describing a two-trigger skill. **Nothing here was measured:** no run
> is part of that change (product decision 2026-08-18).

> **Why this scenario exists.** The obligation to record at all lived ONLY in the
> `cbe_canvas` / `cbe_step` descriptions, which are ~80 % guardrails against fabrication
> and half a sentence of trigger. The model therefore called correctly but far too rarely
> — across the 2026-08-03 / 08-04 sessions 17 of 25 `cbe_step` calls carried no `focus` at
> all. The trigger moved into the ten-steps section; this scenario is what measures it.

> **Two failure modes the checker cannot see, deliberately dropped.** "Step never set to
> active on a step change" and "moved on while the previous step's card is still empty"
> both need the tool's ARGUMENTS, and `checker-deterministic.ts` sees only WHETHER a tool
> was called. Extending the runner for them was weighed and rejected: neither is
> expressible in a small self-contained check the way `cite_provenance`'s `readPath` is.
> The host already refuses both mechanically (`step-tool.ts`, the ladder and slot guards),
> so the eval is not the only thing standing between them and the lecturer.

> **Depth correctness is out of scope, by decision.** No checkpoint here asserts that a
> `rough` / `refined` / `detailed` claim is the RIGHT one. The corpus describes three
> design rounds, not per-step thresholds; there is no criterion to grade against, and
> inventing one would make the scenario measure the rubric writer.

## Setup

- **Environment profile:** app — the `canvas` and `step` affordances are on, so a missing
  call is a real miss rather than an unavailable surface.
- **Probes:** a turn in which the lecturer explicitly fixes the module frame (step 1,
  canonical id `moduleframe`), then a turn that asks only for directions to react to.

## Pass criteria

- [ ] **10a** When something settles, it is put on its step's card in that same turn.
- [ ] **10b** That same turn also records the step's progress and where the work now sits.
- [ ] **10c** A turn that carries only candidates the lecturer has not decided on records
      nothing — the trigger is a decision they state, and there is no second one.
- [ ] **10d** The settled result goes on the card and the reply refers to it in a clause —
      neither a second full copy of the frame, nor a reply that never mentions it at all.
- [ ] **10e** A settled artefact with three parts reaches the card as structured Markdown —
      a list or a table — rather than one undifferentiated prose block.

## Failure modes to watch for

- A settled decision acknowledged in prose with no recording call behind it — the
  behaviour the tool descriptions alone did not produce.
- Recording the step's progress but not the artefact, or the reverse.
- Mirroring a candidate the lecturer has not decided on, to fill the slot — including a
  formulation the assistant produced itself and then read the lecturer's reaction as a
  settlement.
- Reproducing the whole card content in the reply, so the lecturer reads it twice.
- Recording the frame and then saying nothing about it — the lecturer sees a card change
  with no word in the conversation that it happened.
- Three settled learning outcomes arriving on the card as one run-on sentence, so the
  lecturer reads the document their module is becoming in its least legible form.

> **`10e` and the probe S10b were added by `format-canvas-artefacts-in-markdown`.** The
> `cbe_canvas` `value` description used to name only the CONTENT of an artefact ("what the
> lecturer actually decided") and nothing about its FORM, while the renderer has passed
> canvas values through the shared GFM Markdown component since
> `harden-canvas-determinism-and-ux2-fixes`. A model told nothing about form writes a
> paragraph. `10e` is the only checkpoint in the suite that reads what a mirroring call
> actually WROTE: it uses the deterministic kind `tool_arg_matches`, added with it, because
> neither of the existing instruments could see the value — `tool_called` sees only THAT a
> tool ran, and `judgeTranscriptText` hands the judge tool NAMES and never their arguments
> (which is why `10d`'s rubric forbids deciding on the content of the card).
>
> **Why a probe of its own rather than a turn on S10.** S10 turn 0 settles the module
> frame, and a frame is defensibly one line — the same description subordinates form to
> substance, so "a one-line decision stays one line" would make a red verdict there
> unreadable. S10b settles three enumerated learning outcomes, where a list is the form the
> content actually has. Its fixture carries `maturity.overall.target` on purpose: the
> descriptor's opening target-ambition demand is documented above as crowding out the first
> turn of every probe that lacks one, and S10b has only a first turn.

> **`10d` REPAIRED 2026-08-11 — its PASS and FAIL clauses did not partition the answers.**
> At n=3 (gemma, `eb53ec7`) it failed 0/3 while `10a` and `10b` were green, so every repeat
> recorded. r1's reply was the literal PASS shape — _"Ich habe den Rahmen für das Modul
> „Nachhaltige Logistik" so fixiert."_ — and hit neither of the two stated FAIL modes. The
> verdict rested on the rubric's framing sentence ("the reply carries the reasoning — why the
> frame holds, what it constrains, what comes next"), which was not a graded condition; and
> its other half, that the reasoning is not written onto the card, is not observable at all,
> because the judge is handed tool NAMES and never their arguments. Both are gone from the
> criterion. r2 — a self-introduction plus a target-ambition question, with no reference to
> the frame anywhere — is now decided explicitly as a FAIL, following the anchored sequence
> whose first element is "name what was decided". **The 2026-08-11 red verdict on `10d` is
> void for gemma4-31b.**
>
> A second, cross-cutting cause of that 0/3 is NOT addressed here and stays open for the
> product authority: in every probe whose fixture carries no `maturity.overall.target`, the descriptor's
> opening target-ambition demand crowds out the first turn (S10 r1–r3, S11 r1, S12 r3,
> S12b r1–r3). That is a host/descriptor effect across four scenarios, not a rubric question.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S10"
      setup:
        profile: "app"
      turns:
        - "Ich lege den Rahmen jetzt verbindlich fest: Modul Nachhaltige Logistik, 24 Studierende im vierten Semester, 6 ECTS, ein Semester, Pflichtmodul im Bachelor. So bleibt das."
        - "Und wohin könnte die Big Idea gehen? Nenn mir ein paar Richtungen zum Reagieren — entscheiden will ich das noch nicht."
      checkpoints:
        - id: "10a"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#record it on its card with `cbe_canvas`"
          check:
            kind: "tool_called"
            tool: "cbe_canvas"
        - id: "10b"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#mark the step's progress and where the work now sits with `cbe_step`"
          check:
            kind: "tool_called"
            tool: "cbe_step"
        - id: "10c"
          type: "deterministic"
          turn: 1
          anchor: "tool:cbe_canvas#NEVER MIRROR WHAT THE LECTURER HAS NOT SETTLED"
          check:
            kind: "tool_not_called"
            tool: "cbe_canvas"
        - id: "10d"
          type: "judge"
          anchor: "skill:SKILL.md#The reasoning stays in the conversation"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the first assistant turn; the others are context only.
            The lecturer fixed the module frame: title Nachhaltige Logistik, 24 students in
            the fourth semester, 6 ECTS, one semester, compulsory bachelor module. The
            settled frame belongs on the card; the reply refers to it and does not reproduce
            it.
            PASS requires BOTH of these in the first assistant turn: (a) the reply refers to
            the settled frame — naming it, or confirming that it is recorded — and (b) that
            reference is brief, a sentence or a clause rather than a restatement.
            FAIL on any ONE of three things, and on nothing else: (1) the reply reproduces
            the frame as a second full copy — a bullet list or block repeating title, cohort,
            semester, ECTS and status — so the lecturer reads the same content twice; (2) the
            tool-calls line of that turn shows no recording call at all; (3) the reply never
            refers to the settled frame in any form, for instance because the turn is spent
            on a self-introduction and a question.
            Two things are explicitly NOT graded here. Whether the reply argues why the frame
            holds or what it constrains is not required — a bare confirmation plus a next
            step is a PASS. And what the recording call WROTE is invisible to you: the
            transcript carries tool names only, never their arguments, so never decide this
            checkpoint on the content of the card.
    - probe: "S10b"
      setup:
        profile: "app"
        canvasArtefacts:
          - step: 1
            id: "moduleframe"
            label: "Rahmen"
            value: "Nachhaltige Logistik, 4. Semester, 6 ECTS, 24 Studierende, Pflichtmodul."
            state: "done"
        stepCoverage:
          - step: 2
            depth: "rough"
            focus: true
        maturity:
          overall:
            target: 3
      turns:
        - "Die drei Lernergebnisse stehen jetzt fest, genau so übernehmen wir sie. Erstens: Die Studierenden analysieren eine reale Lieferkette und identifizieren die drei grössten Emissionstreiber. Zweitens: Sie bewerten zwei Reduktionsmassnahmen anhand von Kosten und Wirkung. Drittens: Sie entwerfen einen Umsetzungsvorschlag für einen Praxispartner und begründen ihn. Bitte festhalten."
      checkpoints:
        - id: "10e"
          type: "deterministic"
          turn: 0
          anchor: "tool:cbe_canvas#WRITE IT AS MARKDOWN"
          check:
            kind: "tool_arg_matches"
            tool: "cbe_canvas"
            arg: "value"
            # Structured Markdown as the renderer implements it: a bullet or numbered
            # list item, a table row, or a heading — each at the start of a line. A
            # single prose block matches none of them, which is the whole point.
            pattern: '/(^|\n)[ \t]*(?:[-*+][ \t]+\S|\d+[.)][ \t]+\S|\|[^\n]*\||#{1,6}[ \t]+\S)/'
```
