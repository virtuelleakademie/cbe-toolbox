# CBE Skill — Acceptance model

How to read a run. Rewritten by the change `rebuild-skill-prompt-and-eval`, which replaced
the 36-scenario / 296-checkpoint suite wholesale.

## Evaluation is a standing practice

**The evaluation of this skill has no terminal state.** It is not a milestone that some run
finally clears; it is the standing way the skill's behaviour is established, and it runs for
as long as the skill is maintained. Nothing in this repository declares the evaluation of the
skill complete, finished, or signed off — and nothing may. The requirement is canonical:
`openspec/specs/cbe-skill-eval-harness/spec.md`, _Evaluation Is a Standing Practice, Not a
Change That Completes_.

Three consequences a reader needs before reading any run below.

**A run's finding is bounded.** A completed run establishes a per-checkpoint finding about
one skill version, with one candidate model, at one repeat count, on one date. It says nothing
about a later skill version, a different candidate, or a checkpoint it did not exercise. Those
four bounds are exactly what `RUN-LOG.md` records per entry, and `runs/` is git-ignored, so an
unlogged run is indistinguishable from no run at all.

**A change to a measured surface reopens the question.** That is why every change touching
behaviour the suite measures carries an eval-sync obligation in its `tasks.md` (`AGENTS.md`
§ _Eval-Sync rule_ holds the operational detail: which capabilities count, how to find the
affected scenarios through `traceability.json`). A scenario left grading the behaviour a change
replaced fails a correct implementation or passes an obsolete one.

**An outstanding run does not hold a delivered change open.** When a change has met its spec,
code and test obligations and discharged its eval-sync task, the remaining measurement belongs
to the standing requirement, not to that change. The change is archive-ready with the run item
left open and _named_ as open — which is what this repository already did for
`add-early-close-checklist` (task 2.2), `add-target-ambition-maturity-calibration` (task 5.1)
and `add-ten-step-design-flow` (task 7.3). Continuing measurement is not incomplete delivery.

## The suite measures; it does not gate

**Every scenario is equal-ranked** (product decision 2026-08-07). There is no gate subset,
no "green", and no per-scenario bar to clear — a run reports what it found and exits `0`
whatever the checkpoints did. The gate/trend split that stood here is gone, and so is the
tier taxonomy it replaced; both mixed a routing question ("where does this fix go?") into a
verdict question ("did we pass?") that this suite deliberately no longer asks.

What a reader does with a run is therefore always the same thing: take each non-passing
checkpoint and route it through `traceability.json` (§ _Triaging a red checkpoint_ below).

A scoped run names the scenarios its change touched — look them up in `traceability.json`,
never a fixed subset, since no subset carries more weight than another:

```bash
npm run eval -- --model <shipped> --scenarios S4,S10 --repeat 3
```

The ten scenarios: S1 opening, S2 the ten steps, S3 the two ordered checks, S4
challenging, S5 closing, S6 citing, S7 the six non-negotiables, S8 the safety floor,
S9 language and stance, S10 recording what settles.

### The one thing that still aborts a run: the instrument

A run whose `index.json` carries `judgeCalibration.status: "unreliable"` (equivalently:
exit code `4`, or an `unreliable` line in the findings header) is **not readable in either
direction** — neither for closure nor against it. Either the judge missed more than one in
five unambiguous gold-set cases, or triples went unscored, which depresses the same rates
but is a judge-backend or judge-model fault. Read which one off `gold-set.md` before
acting: an unscored triple is never a labelling problem. Fix that cause and re-run; do not
triage the checkpoints of such a run. See `evaluation/cbe-skill/README.md` § "Hardening the
instrument". Despite its name, `calibrationGateFor` is not a bar on the skill — it
establishes that the measuring instrument holds before the first candidate token.

## The report carries no aggregate percentage

Deliberately. A flat rate over checkpoints that differ in kind is the number that let 234
untraceable checkpoints look like coverage. `index.json` carries one entry per probe and
`metrics` as its own object; `run-summary.md` renders the per-probe table plus the explicit
list of non-passing checkpoints, and neither carries a suite-wide figure.

The cross-model matrix (`--compare`) does carry a per-candidate rate. That number ranks
candidates **against each other on one probe set** — it is not a bar, and it is not
comparable across probe sets.

## Two run-level metrics, on every run

Reported for every run, scoped or full:

- **Corpus-document reads** — the share of sessions in which at least one corpus
  _document body_ (not just the index) was read. This exists because eager skill
  inclusion removes the model's main reason to touch the filesystem at all: the last time
  the body was eager, corpus retrieval collapsed board-wide (~2/20 probes read anything).
  The regression is invisible per-checkpoint and obvious here. **If it collapses, the fix
  is in the prompt** — strengthen the corpus half of the opening protocol — not a return
  to lazy load, which costs 38 % of the body to a 50 KB `read` truncation.
- **Unprovenanced `(corpus:…)` tokens** — target **0**. A token counts as unprovenanced
  when the document it names was not `read` in the session, or when no `cbe_cite` call
  produced it.

## There is no baseline

**By decision, not omission.** What the previous suite could report was a percentage over
296 checkpoints of which 234 could not be traced to any text — and it graded a skill body
the model received 62.3 % of, because pi truncates a `read` at 50 KB. One of its
checkpoints rewarded the exact fabrication path the skill's own wording invited.

Numbers produced that way cannot serve as a baseline, and comparing against them would
import the noise. Read a run at n=3 (`--repeat 3`) and route what is red; there is no
number to clear. Every run record states this.

## How many runs an assertion needs

Two runs of the same probe, same model, same skill version, seven minutes apart: **five of
seven checkpoints flipped** with nothing changed in between. A single run measures noise.

| Question                           | Runs                                            | Why                                                                 |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| "Does my scenario load and parse?" | `--dry-run`, n=0                                | no model involved                                                   |
| "Is this checkpoint really red?"   | **n=3** (`--repeat 3`)                          | pass/fail verdicts are stable; a majority of 3 absorbs an outlier   |
| "Did my change move a number?"     | **n≈10–15**                                     | below that, report nothing as an improvement                        |
| "Is there a regression anywhere?"  | full run, n=3, A/B against the pre-change skill | same candidate set before and after, or the comparison is worthless |

`--repeat` majority-votes each checkpoint and writes one transcript per run. Ties fall to
the **worse** verdict — and `not-assessable` ranks _below_ `fail`, so at an even
`--repeat` it beats everything else in a tie. Use odd values.

## Triaging a red checkpoint

Every checkpoint carries an **anchor** — the channel plus the passage that governs it
(`traceability.json`). That is the routing table:

| Classification  | Where the fix goes                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- |
| `real-gap`      | edit the anchored passage — the skill body, the identity prompt, or the tool description |
| `suspect-check` | amend the spec requirement or the rubric                                                 |
| `scenario-flaw` | fix the scenario's turns                                                                 |

An **unanchored checkpoint fails `npm run trace:check`** and cannot ship. That is not
downgradable to a warning: it was report-only before, and the report was ignored for 234
entries.

## What replaced the tier taxonomy — and then the gate

Tiers 1 / 2 / D went first: they mixed three different distinctions — contract versus
quality, production versus dev-draft, gate versus report — into one label, and Tier D
existed only because six scenarios rested on dev-draft corpus stubs whose behaviours the
rebuild retired. The gate/trend split that replaced them kept one of those distinctions,
and it went too: a suite built to measure has no use for a subset whose redness stops the
process. Nothing replaces it. The anchor in `traceability.json` is what a red checkpoint
is read through.
