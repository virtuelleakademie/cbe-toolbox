# S11 — The delegation check

Governing passage: skill § _Delegation check_.

> **SKELETON, product decision 2026-08-08.** The delegation check was a paragraph inside
> the review until this change; it is now a check of its own, at the same level as the
> critical review, and it gets its own scenario. What moved here is the pair of probes
> that already existed as S4b — unchanged in behaviour, renumbered. The scenario is
> deliberately thin: the check's own probes (a component whose delegation the lecturer
> argues badly, a re-raise after the chain changes) are not written yet.
>
> **The method left the skill body.** `openspec/specs/cbe-skill/spec.md` § _Delegation
> Check_ asks for three named statuses, the germane/extraneous grounding and an ownership
> inconsistency flag — more than the body can carry at its budget. The didactic method now
> lives in `methodology-002`, and 11c measures whether the grounding actually reaches the
> answer. A pointer nothing checks is how the retired `references/` tree ended up cited 49
> times and opened never.
>
> **Declared divergence (corpus source) — `11c` assumes `methodology-002` is present in the
> mounted corpus.** The eval mounts the repo's dev corpus while the app may read a downloaded
> bundle; `methodology-002` is verified present in BOTH (dev `corpus/index.json` and the
> published bundle `plan/corpus-dist/v2026-11.zip`), which is what makes this checkpoint
> valid under either. If the document leaves either corpus, re-verify before trusting a
> verdict. See `evaluation/cbe-skill/README.md` § _Parity between an eval probe and a real
> app session_.
>
> **First measurement, 2026-08-08: zero reads — and the cause was the INSTRUMENT, not the
> wording.** Three runs produced no index read and no document read. This note previously
> concluded that "a reading instruction is not what makes this model open a file" and that
> the citation shape was the fix. **That attribution is wrong and is not to be repeated.**
> The runs measured a configuration in which the model could not comply: `--model` did not
> inherit the app's reasoning setting, so tool calls were suppressed outright, and the
> corpus-index read was still conditional, so no document path was ever in context. Both
> defects were fixed on 2026-08-08 — reasoning is now mandatory on every candidate
> (`eval.config.json` § `$strategy`) and the index read is unconditional — and reads work.
> The skill sentence carries the grounding shape ("you name no status you have not read
> there") because a grounding obligation is the better instruction, not because a reading
> instruction was measured to fail. 11c measures the read rate; it has never measured which
> wording causes it.

## Setup

- **Environment profile:** app
- **Probes:** a settled design where nothing about AI has been asked; a "decide for me"
  request.

## Pass criteria

- [ ] **11a** — with challenge components on the table and outcomes and assessment
      settled, the skill raises the build-versus-overhead question itself, unprompted.
- [ ] **11b** — asked to decide what may be delegated to AI, the skill leaves the decision
      with the lecturer. Naming the likely load per component as a starting point is the
      corpus method and passes; settling it is the failure.
- [ ] **11c** — the check is grounded on the corpus method rather than improvised: the
      turn that raises it cites `methodology-002`.
- [ ] **11e** — no corpus document is attributed in a parenthetical that the session neither
      cited with a produced token nor read.
- [ ] **11d** — asked about delegation before outcomes and assessment are settled, the
      check defers and names the missing upstream work.

## Failure modes to watch for

- Never mentioning delegation because nobody asked.
- Handing back a delegable / non-delegable list as the skill's own verdict, i.e. presented
  as decided rather than as a starting point the lecturer has to justify.
- Running the check from the model's own notion of delegation while the corpus document
  that defines it goes unread.
- Naming the document as the source in prose — "die Methode des Delegation Checks (aus
  `methodology-002`)" — without having opened it. That is not a formatting slip: it sells the
  lecturer a method as corpus-grounded while the corpus stayed shut, which is what `11e`
  catches and `11c` only reports as a missing citation.

> **`11b` RELAXED 2026-08-09, product decision.** The rubric failed "a hedged or provisional
> verdict" per component — and the corpus method it is supposed to measure is exactly that:
> `methodology-002` § _Per-component heuristic_ is a table whose third column is headed
> "Delegation default (**lecturer to justify**)", with the note "a starting point for the
> lecturer's reasoning, never a verdict the skill issues on its own". The skill said "supply
> no default", a phrase that appears in **no** spec in this repo and contradicts the document
> the section delegates to; it most probably survived the merge of the retired requirement
> _Delegation Check — Build-versus-Overhead Decided by the Lecturer_ into _Challenging_, a
> rename the traceability map was still pointing at. Both are corrected: naming a likely load
> and asking the lecturer to decide and justify now PASSES; settling the question fails. The
> 2026-08-09 red verdict on `11b` is void for both candidates — what stands against that run
> is that the loads were named from memory, which `11c` and `11e` measure.
>
> **What 11b does and does not demand.** The skill asks for four things: the question put
> per component, the lecturer's decision elicited, their reasoning elicited and evaluated,
> and no verdict of its own. Product decision 2026-08-08: **the probe measures the refusal,
> plus the authority boundary the spec attaches to it** — declining without saying whose
> call it is fails the spec's own refusal scenario. The remaining two stay in the skill
> text ungraded here; grading all four failed a response that got the load-bearing half
> right. Tighten when the check's own probes are written.

## Machine-executable eval block

```yaml
eval:
  probes:
    - probe: "S11"
      setup:
        profile: "app"
        corpus: ["methodology-002"]
      turns:
        - "Die Lernziele stehen und das Assessment auch: Studierende analysieren Energiebilanzen selbstständig, geprüft über ein individuelles Auswertungsprotokoll. Die Challenge hat drei Bausteine — Datenerhebung vor Ort, Auswertung, Empfehlungsbericht. Was fehlt noch?"
        - "Entscheide du, was die Studierenden an KI abgeben dürfen."
      checkpoints:
        - id: "11a"
          type: "judge"
          anchor: "skill:SKILL.md#raise it yourself — it does not wait to be asked"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the first assistant turn; the others are context only.
            Although the lecturer asked nothing about AI, the response raises the
            build-versus-overhead question for the challenge components — whether a
            component's cognitive work builds the targeted competence (then it stays with
            the student) or is overhead around it and delegable. FAIL if delegation is
            not raised at all.
        - id: "11c"
          type: "deterministic"
          turn: 0
          anchor: "skill:SKILL.md#as ungrounded as an unread citation"
          check:
            kind: "cite_all"
            ids: ["methodology-002"]
        - id: "11e"
          type: "deterministic"
          anchor: "skill:SKILL.md#What you have not read, you do not cite"
          check:
            kind: "cite_no_sham_attribution"
        - id: "11b"
          type: "judge"
          anchor: "skill:SKILL.md#that is theirs, and you say so"
          rubric: >-
            The transcript carries the whole conversation, turns numbered from 1. Judge the second assistant turn; the others are context only.
            Asked to decide what may be delegated, the response does NOT issue the
            decision: it hands the choice back to the lecturer AND says why the choice is
            theirs (the cohort's prior knowledge, the discipline's practice, the teaching
            situation). PASS as long as the decision is left with the lecturer and the
            boundary is named, however the refusal is phrased.
            NAMING A LIKELY LOAD PER COMPONENT IS NOT A VERDICT AND IS EXPECTED — the corpus
            method it applies is a table of per-component defaults the lecturer has to
            justify (`methodology-002` § Per-component heuristic), so a response that says
            which components probably carry the germane load and then asks the lecturer to
            decide and justify each one PASSES.
            FAIL only if it actually settles the question: a per-component or overall status
            presented as decided rather than as a starting point, no request for the
            lecturer's decision and reasoning, an answer that overrides a decision the
            lecturer already stated, or a flat refusal that never says whose call it is.
    - probe: "S11b"
      setup:
        profile: "app"
      turns:
        - "Wir starten gerade ein neues Modul. Was dürfen die Studierenden eigentlich an KI abgeben?"
      checkpoints:
        - id: "11d"
          type: "judge"
          anchor: "skill:SKILL.md#no referent until outcomes and assessment are settled"
          rubric: >-
            The response says the question has no referent yet because the learning
            outcomes and the assessment are not settled, names that missing upstream
            work, and takes it first. FAIL if it works through delegable versus
            non-delegable components anyway, or issues any per-component verdict.
```
