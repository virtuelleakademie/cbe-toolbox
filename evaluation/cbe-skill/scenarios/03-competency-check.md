# S3 — The competency check

Governing passage: skill § _Competency check_.

> **Split 2026-08-08, product decision.** Competency and alignment are capabilities of
> their own, each bound to its place in the flow, so they no longer share a scenario: this
> file is the competency check, alignment moves to `12-alignment-check.md`. The delegation
> probe that also lived here (former 3a — a delegation question raised before outcomes are
> settled defers) belongs to the delegation check and moves to `11-delegation-check.md`.

> **PROBE REPAIRED 2026-08-09.** The lecturer's goal statement was turn 1 — the session
> opening — and `3b` demanded the competency check there. The skill forbids exactly that
> twice over: § _How a session runs_ says "nothing else claims the opening turn", and
> § _Competency check_ opens with "the method of step 2 — **never the opening move**". Both
> candidates were failed on the first run for obeying the rule; gemma oriented and asked one
> question, which is what the opening demands. A warm-up turn now precedes the goal
> statement, `3b` judges turn 2 and `3c` turn 3. **The 2026-08-09 red verdict on `3b` is void
> for both candidates.**

## Setup

- **Environment profile:** app
- **Probes:** a pair of domain-general goals; the lecturer insisting on their own wording.

## Pass criteria

- [ ] Two domain-general goals are flagged **per goal**, both sharpening questions are
      asked, and no replacement goal is proposed in any framing.
- [ ] When the lecturer keeps their original formulation, the skill records the
      reservation and continues — it does not block or condition further help.

## Failure modes to watch for

- One combined remark instead of a flag per goal.
- Offering "a sharper version could be …" — substitute-goal authorship in any framing.
- Making further help conditional on sharpening the goal.
- Any text presenting a third check, a check pipeline, or two distinct alignment checks.
  The skill body is guarded against that statically
  (`packages/pi-bridge/tests/skill-body-contract.test.ts`, _no anchor into a retired
  structure_), so it is a reading cue here rather than its own checkpoint.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S3b"
      setup:
        profile: "app"
      turns:
        - "Ich ueberarbeite ein Modul in Verfahrenstechnik, drittes Semester, 20 Studierende."
        - "Die Studierenden sollen kritisches Denken und Teamfähigkeit lernen."
        - "Ich bleibe bei meiner Formulierung."
      checkpoints:
        - id: "3b"
          type: "judge"
          anchor: "skill:SKILL.md#Competency check"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            SECOND assistant turn ONLY — turn 1 is the session opening, which the skill
            reserves for the mode, the target maturity and the profile, and where the
            competency check is explicitly NOT due. The lecturer states two domain-general
            goals in turn 2. PASS requires BOTH goals to be flagged separately as not
            designable as stated, and BOTH sharpening questions to be asked — which
            subject-specific ways of thinking and working the challenge should build, AND
            how far beyond the module they should carry. FAIL if the two goals are collapsed
            into one remark, if only one sharpening question is asked, or if the response
            proposes, illustrates or exemplifies ANY replacement goal (including "a sharper
            version could be …").
        - id: "3c"
          type: "judge"
          anchor: "skill:SKILL.md#record the reservation and carry on"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the
            THIRD assistant turn ONLY; the others are context only.
            The response records the reservation and continues the work with the
            lecturer's own wording. FAIL if it blocks, repeats the demand to sharpen, or
            conditions further help on a sharper goal.
```
