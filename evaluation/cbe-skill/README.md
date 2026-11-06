# CBE skill evaluation

This directory holds everything we use to **evaluate** the CBE skill — scripted manual test scenarios, multi-paragraph lecturer briefs, and the session logs that capture how the skill actually performed during a run. It is **not** part of the shipped skill artifact: the runtime in `packages/pi-bridge/` eagerly includes `skills/cbe/SKILL.md` in every system prompt and registers `skills/cbe/` as the skill's `baseDir`, and only that subtree should be readable by the model at run time. Keeping evaluation material in a sibling top-level folder (`evaluation/`) instead of nesting it under `skills/` prevents two failure modes:

1. **Disk bloat in the shipped app** — `packages/app/package.json` bundles `skills/` into the macOS/Windows/Linux build via `extraResources`. Anything inside `skills/cbe/tests/` would have shipped with the signed binary. After the move that is no longer possible.
2. **Semantic contamination** — the test briefs intentionally contain _wrong_ lecturer statements (paternalistic challenge framings, content-delivery scaffolds, anti-sycophancy bait). If the model loaded them while reading the skill it could mistake the seeded reibungspunkte for canonical examples and drift in the wrong direction.

## Layout

```
evaluation/cbe-skill/
  scenarios/         ten scripted scenarios, one file each (S1..S10), several probes per file
  test-modules/      fuller multi-paragraph lecturer briefs (one-to-two pages, four of them)
  fixtures/negative/ synthetic answers that MUST fail their checkpoint (see "Hardening the instrument")
  fixtures/gold/     hand-labelled judge-calibration triples (see "Hardening the instrument")
  traceability.json  checkpoint ↔ anchor ↔ requirement map (see "Traceability map" below)
  ACCEPTANCE.md      how to read a run: the standing practice, equal-ranked scenarios, the run-level metrics, no baseline
  README.md          this file
```

## What lives where

**Ten scenarios** — nine of them replaced wholesale by the change
`rebuild-skill-prompt-and-eval`, plus S10 from `anchor-canvas-contract-and-ungate-eval`. The
previous 36 scenarios / 296 checkpoints were deleted, not migrated: they drove the same
`startCbeSession` path as the product and therefore graded a skill body of which the model
received **62.3 %** (pi truncates a `read` at 50 KB), and **234 of their 296 checkpoints
carried no anchor**, so a failure could not be routed to the text that caused it. One of
them rewarded the fabrication path the skill's own wording invited.

| File                        | Scenario                                     |
| --------------------------- | -------------------------------------------- |
| `01-opening.md`             | S1 — Opening                                 |
| `02-ten-steps.md`           | S2 — The ten steps                           |
| `03-competency-check.md`    | S3 — The competency check                    |
| `04-challenging.md`         | S4 — Challenging (incl. the delegation lens) |
| `05-closing.md`             | S5 — Closing                                 |
| `06-citing.md`              | S6 — Citing                                  |
| `07-non-negotiables.md`     | S7 — The non-negotiables                     |
| `08-safety.md`              | S8 — The safety floor                        |
| `09-language-and-stance.md` | S9 — Language and stance                     |
| `10-canvas-recording.md`    | S10 — Recording what settles                 |

**Every scenario is equal-ranked** (product decision 2026-08-07): the suite MEASURES, and
a red checkpoint never fails the run. The gate/trend column that stood here is gone; what
routes a red checkpoint is its anchor, not a role label. Every checkpoint is anchored.
Read `ACCEPTANCE.md` before reading a run.

### Every checkpoint carries an anchor

An anchor names the **channel** plus the passage within it that governs the behaviour, in
one of the three instruction channels (capability `agent-harness`, Requirement:
_Instruction Channel Boundary_):

```yaml
anchor: "skill:SKILL.md#Never mirror praise" # the eagerly-included skill body
anchor: "prompt:identity-prompt#Corpus grounding" # the identity prompt
anchor: "tool:cbe_cite#NEVER HAND-WRITE A (corpus:…) TOKEN" # a tool description
```

The object form (`{channel, file, heading}`) is equivalent. A checkpoint may carry
**several** anchors where a behaviour genuinely has two halves with different homes — S6's
provenance check is read-before-claim in the prompt AND token production in `cbe_cite`.
That is not a rule stated twice; it is two rules, each stated once.

**A checkpoint with no anchor does not load.** The loader rejects it, and
`npm run trace:check` fails on an unanchored map entry — not downgradable to a warning.

- **`test-modules/01-03`** — full module-design conversations. The skill works on one of
  these the way it would on a real lecturer's brief; each comes with a tester checklist.

## Writing or editing a scenario

- **Never put a literal code fence inside a probe turn.** The loader's `FENCED_YAML` regex
  ends the `eval:` block at the first fence it meets, so the whole scenario silently stops
  loading — no error, just a missing block. Write each backtick as a `\u0060` escape
  instead; YAML parsing restores it.
- **Every checkpoint needs an anchor** (above) and, when `deterministic`, a check **kind
  the runner implements**. An unknown kind is rejected at load rather than scored `error`
  after the model calls have been paid for. Implemented kinds: `cite_all`,
  `cite_none_outside_corpus`, `tool_called`, `tool_not_called`, `contains`,
  `not_contains`, `cite_provenance`, `reply_language`, `no_trailing_menu`,
  `cite_no_sham_attribution`.
- **Keep the prose pass-criteria count equal to the checkpoint count** — the loader warns
  on a mismatch, which is how a silently dropped checkpoint gets noticed.
- Verify with `npm run eval -- --dry-run` (no model calls) and `npm run trace:check`.

## How to run a scenario or a test module

**Through the Electron app (the primary runner).** Configure a BYO-LLM connection in Settings, start a new session (no mode selector — the brief's first turn states the work intent), copy the lecturer voice from the brief (everything between the horizontal rules in the file), paste as the first user turn, and let the conversation run until it stabilises or visibly fails.

**Through `cbe-headless` CLI.** This runs the same eager skill body through the headless profile. Invocation:

```
cbe-headless "<opening prompt>"
```

with `CBE_LLM_BASE_URL`, `CBE_LLM_API_KEY`, `CBE_LLM_MODEL_ID` set.

**Through Claude Code / Claude Desktop.** Load `skills/cbe/SKILL.md` as the system context, run the opening prompt. Useful for quick spot checks without booting the Electron app.

## Presenting a run to a human

**This is the required shape. Product decision 2026-08-09.** A run reported as "22 of 57 red"
tells the reader nothing they can act on: nobody knows what `12e` measures by heart, and a
percentage hides which findings are the model's and which are the skill's. Report a run as
**one table per scenario, one row per checkpoint, with four columns**:

| Column           | Content                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CP               | the checkpoint id                                                                                                      |
| Was geprüft wird | **one line, in plain language, of what this checkpoint actually tests** — derived from the rubric, not from the anchor |
| _model A_        | the verdict for that candidate                                                                                         |
| _model B_        | the verdict for the next candidate, or `—` where that scenario was not run                                             |

Rules that go with the shape:

- **Mark the checkpoints a change introduced** (this repo uses `✱`), so a reader can see at a
  glance whether the new probes fire at all. A new checkpoint that is green on its first run
  deserves the question of whether it can fail.
- **State the run conditions above the table**: candidate, `--repeat`, and which scenarios each
  column covers. Columns from runs of different scope are not comparable and must say so.
- **Never lead with a percentage.** The per-probe findings are the result; the ratio is a
  by-product. `ACCEPTANCE.md` is authoritative on why.
- **`—` means not measured, and is not a pass.** A blank column reads as "fine" unless the
  legend says otherwise.
- **A one-line summary per red checkpoint** follows the tables — what the model actually did,
  not a restatement of the rubric.
- Verdicts stay in the harness's own vocabulary (`pass` / `fail` / `partial` / `not-assessable`
  / `error`); do not collapse `partial` into either neighbour.

The same shape works for a single-model run: one verdict column and no comparison. Keep
`RUN-LOG.md` as the durable record — it is prose for the archive, this table is for the reader
in the room.

## Recording verdicts

**Automated `npm run eval` runs are logged in [`RUN-LOG.md`](RUN-LOG.md), always, in the session they were run** — see [Output and `runs/` policy](#output-and-runs-policy) for why. The two records below are for hand-run scenarios and test modules and do not replace it.

For scripted scenarios: capture a session log under `evaluation/cbe-skill/sessions/` named `YYYY-MM-DD-scenario-NN.md`. Include scenario id, date, runner, pass/fail per criterion (copy the checklist), failure modes seen, free-text surprises.

For test modules: write into the sibling `<N>-findings.md` file referenced above. The structure is looser than a scripted scenario — what mattered, what failed, what to change for the next skill version — in `skills/cbe/SKILL.md`, in the identity prompt, or in the tool description that owns the rule (`references/` no longer carries skill content).

## Automated harness (`npm run eval`)

The harness in `runner/` runs scenarios headlessly against a configured model, scores each checkpoint (deterministic code + LLM judge), and writes reports. It lives outside `skills/` so it is never bundled into the app.

**The point of the harness is not to rank models — it is to improve the skill.** Beyond a one-shot scored run (`--max-iterations 1`), the harness drives an _editor-agent improvement loop_: it evaluates the current `skills/cbe/` bundle, and on every failing checkpoint an editor LLM proposes a targeted edit to `SKILL.md` or `references/*.md`, re-evaluates, and **keeps the edit only if it improves a targeted checkpoint without regressing any checkpoint in the same scenario** — otherwise it reverts. Run repeatedly, this is how the skill is "trained": each campaign that you commit raises the baseline the next one starts from. See [The improvement loop](#the-improvement-loop--raising-the-pass-rate) below.

### CI vs on-demand boundary

- **`npm test`** runs the loader, schema validation, and the deterministic checkers as pure unit tests — **no network, no live model**. This is the commit gate.
- **`npm run eval`** runs the full live-LLM harness. It is **never** invoked by `npm test` and is never a commit blocker.

### Configuration (no secrets in git)

`eval.config.json` lives **in this directory** and is **versioned** — it carries no key material, because each model references its base URL and API key only **by environment-variable name** (`baseUrlEnv` / `apiKeyEnv`), resolved at runtime. The judge MUST NOT be one of the candidates. A missing env var fails fast, naming the variable and the paths searched, before any model is contacted.

The config path resolves in this order: `$CBE_EVAL_CONFIG` → `evaluation/cbe-skill/eval.config.json` → the legacy `runner/eval.config.json`. There is no example twin to fall back to — the real config is versioned, so every checkout carries it. If none of the three exists the harness exits naming every path it searched, and an explicit `$CBE_EVAL_CONFIG` that points at nothing aborts rather than degrading to the default board.

```
npm run build              # builds the runner to dist/
npm run eval -- --model qwen3.6-35b-a3b --scenarios 04

# A non-contiguous selection at n=3. --scenarios takes a single id, a range,
# or a comma-separated list; the `S` prefix is accepted.
npm run eval -- --model <shipped> --scenarios S3,S6,S7,S8 --repeat 3
```

#### Where the credentials come from (no sourcing required)

The runner reads a `KEY=VALUE` secrets file **itself**. Resolution order:

1. `CBE_LLM_BASE_URL` / `CBE_LLM_API_KEY` **already exported** — always wins, never overwritten
2. `$CBE_EVAL_SECRETS`
3. `<repo>/evaluation/cbe-skill/runner/.eval-secrets` (checkout-local, gitignored)
4. `${XDG_CONFIG_HOME:-~/.config}/cbe-eval/secrets` (machine-local, outside every repo tree)

Implementation: `runner/src/secrets.ts`. Files are parsed with an optional `export ` prefix, quotes, `#` comments and blank lines tolerated.

**Only the variables the resolved config NAMES are imported** (`baseUrlEnv` / `apiKeyEnv` of every candidate and the judge, plus `CBE_LLM_API_KEY` for the app-config candidate path). The machine-local slot is typically a symlink into a secret store that holds more than these; anything else in the file is read past and never enters `process.env`, so it is never inherited by the Claude CLI judge or the pi eval session running the model under test. A secrets file that exists but cannot be read, or a `$CBE_EVAL_SECRETS` pointing at nothing, produces a `[warn]` line naming the path — never the contents.

> **The old `set -a` trap is gone.** It used to be that `source runner/.eval-secrets` set _shell_ variables, not _environment_ variables, so the `node` child process never saw them and the run died with `environment variable CBE_LLM_BASE_URL is not set`. The runner now loads the file itself, so there is no sourcing step to get wrong. If you _do_ export the variables yourself, they take precedence and no file is read at all.

Secrets files stay gitignored and are never versioned. A credential copied into a checkout does **not** disappear when a Treehouse worktree is recycled — `tools/clean-worktree-secrets.sh` removes them. It is idempotent and exits `0` once the checkout is clean — including the case where there was nothing to remove. It removes everything it found **first** and only then exits non-zero, for either of two reasons: the scan itself was partially denied, or a located file could not be deleted (a match under a non-writable parent). The stderr message names which of the two fired, because neither can certify that no credential file remains. Whatever teardown mechanism calls it must treat that non-zero as "check by hand", not as "nothing was removed".

#### Do not mask the exit code with `tee`

`npm run eval ... | tee log` returns `tee`'s exit code (0), so a failed run looks like it "passed". Redirect to a file and read the runner's real exit code (list under "Flags" below).

#### Which model this suite is developed against, and why it is a small one

**The primary test candidate is `gemma4-31b`** (`google/gemma-4-31b-it`, the DENSE variant — not the MoE `gemma-4-26b-a4b-it`). Product decision, 2026-08-07.

The choice of a small model is deliberate and it is the point of the whole instrument. A large model finds its own way through a mediocre instruction; it will produce a good session out of politeness and general competence, and so it tells you **nothing** about whether the instruction carries. A small model complies only where the text actually forces the behaviour. **What holds on a small model holds on a large one. The converse is false** — which is why a green run on a strong model is never evidence that an instruction is good.

Qwen held this role until 2026-08-07 and lost it to variance, not to weakness: on identical scenarios it cited 6/6 with 13 `cbe_cite` calls in one run and 2/6 with zero calls in the next. Its swing was larger than any effect being measured. It stays on the board (`qwen3.6-35b-a3b`), together with `mistral-large-2512`, for runs across more than one model. `sonnet-5` is on the board as a **reference ceiling** and is never optimised against — it answers "instruction or model?", nothing else.

#### Every candidate carries thinking. No exceptions.

**No model without reasoning can carry the multi-step sequences this harness demands** — read the index, read the document, produce the token, record the artefact, in that order. Every entry in `eval.config.json` therefore carries `"reasoning": true` and a `"reasoningEffort"`, and **a new candidate is not added without them.**

This is not tuning, it is validity. A `--model <name>` run takes the candidate from `eval.config.json` and does **not** inherit the app's persisted reasoning setting, so an entry missing the field measures a configuration the product never ships — and its tool-related verdicts are evidence of nothing. Two concrete costs already paid: the A3B-class Qwen emits **no tool calls whatsoever** without `reasoning_effort`, and `gemma4-31b` ran without it for this entire suite until 2026-08-08, which voids every "tool was not invoked" verdict recorded for it before that date. The symptom is a wall of `fail`/`not-assessable` on the tool-dependent scenarios (S6, S10 above).

#### Adding a new OpenRouter candidate

Verify the exact slug against the live catalog before adding it (`curl -s https://openrouter.ai/api/v1/models -H "Authorization: Bearer $CBE_LLM_API_KEY"`) — near-identical variants are the norm, and Qwen alone ships `-35b-a3b`, `-27b`, `-flash`, `-plus` and `-max-preview`. Then give the entry both reasoning fields and a `$note` saying which of the four roles it holds: primary test candidate, board candidate, reference ceiling, or retired.

### Flags

| Flag                       | Meaning                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `--model <name>`           | evaluate one configured candidate                                                                 |
| `--compare`                | run all candidates, emit a per-candidate matrix + ranking (mutually exclusive with `--model`)     |
| `--scenarios <sel>`        | select scenarios: `03`, a range `01-04`, or a list `S3,S6,S7,S8` (default: all)                   |
| `--repeat N`               | **model** variance: full probe re-runs (new output AND new scoring), majority verdict (default 1) |
| `--judge-repeat N`         | **judge** variance: re-scorings of the SAME transcript, majority verdict (default 1)              |
| `--allow-unreliable-judge` | **eval-only:** continue after a failed gold-set calibration for diagnosis; still exits `4`        |
| `--max-iterations N`       | improvement-loop cycles; `1` = eval only, no editor (default 1)                                   |
| `--max-tokens N`           | cumulative token budget across all LLM calls (hard cap)                                           |
| `--parallel N`             | max probes in flight — also caps gold triples scored concurrently (default 2)                     |
| `--interactive`            | pause for operator keep/revert/abort after each editor change                                     |
| `--dry-run`                | parse scenarios, print the plan, write nothing, exit 0 — structure green, behaviour unverified    |
| `--output-dir <path>`      | where to write run artifacts                                                                      |

Exit codes: `0` the run completed — red checkpoints included, since a plain run measures rather than gates · `1` the improvement loop (`--max-iterations > 1`) still has failing items after its budget · `2` CLI/config error · `3` provider error · `4` judge calibration below threshold.

### Hardening the instrument — negative fixtures and the gold set

Three sources can produce a flipped verdict: the candidate model, the judge, or a checkpoint that never worked. The first is what the eval is for; the other two are instrument faults, and two model-free mechanisms separate them out.

**Negative fixtures (`fixtures/negative/*.yaml`) — is the checkpoint real?** Each fixture is a synthetic answer written to FAIL its checkpoint, scored by the real deterministic checker inside `npm test`. A checkpoint that returns anything but `fail` here is a placebo. Every supported check kind must carry one; adding a kind to `checker-deterministic.ts` without a fixture fails the suite.

To add one, write a YAML document with `id`, `note` (why this answer must fail), a self-contained `checkpoint`, a `setup`, and `turns[]`. It references no scenario file on purpose — a rewrite of the scenario suite must not invalidate the fixture set. Judge checkpoints are rejected here: a rubric needs a model, so they are calibrated by the gold set instead.

**Gold set (`fixtures/gold/*.yaml`) — is the judge real?** ~20 hand-labelled triples (`rubric`, `answer`, `expected`, `label`). Scored by the configured judge before any candidate token is spent (`--dry-run` contacts no model and therefore calibrates nothing); `--judge-repeat` folds each triple the same way it folds a checkpoint. The run reports agreement **per direction**, gated at `judgeCalibration.threshold` in `eval.config.json` (0.80). Below the threshold the run aborts before the first candidate token and exits `4`. The threshold is read from the config on **every** path, including the zero-endpoint default that loads no candidate board; the built-in 0.80 applies only to a checkout carrying no config file at all, and an explicit `$CBE_EVAL_CONFIG` pointing at nothing aborts here too rather than gating against the built-in value.

**Why per direction, and why 0.80.** Both directions must clear the gate separately, because a judge that answers `pass` to everything scores high on a pass-heavy set — overall agreement measures the set's composition, not the judge. The number itself is a **stated judgement, not a measurement**: below 80%, the instrument error is too large to trust any checkpoint verdict the run produces. With ~8 triples per direction that allows at most one miss (7/8 clears, 6/8 does not). Full argument: `openspec/changes/harden-eval-instrument/design.md` § 2. `borderline` triples are scored and reported as a drift signal but never gate — a borderline case is one where a careful human could argue either way, so gating on it would gate on our own label quality rather than on the judge.

To add a triple, pick a label: `clear-pass` / `clear-fail` for cases no careful human would argue about, `borderline` for one where they would. `expected` must not contradict the label. The set is balance-validated at load: at least five per unambiguous direction and at least one borderline.

**Reading `gold-set.md`.** The three-row table is the verdict: `clears` / `BELOW THRESHOLD` per direction, borderline marked "not gated". Read the lines **above** the Disagreements list first — "N of M triples were not scored" appears whenever the judge returned no verdict, and it names **which** fault, because the causes point in different directions:

| Line                                                           | What happened                                                                                               | Where to look                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| "the judge could not be reached"                               | the backend call itself failed — down, refused, rate-limited                                                | the judge **backend**                         |
| "the judge answered but could not produce a parseable verdict" | the backend answered; the judge did not honour the JSON contract on either attempt                          | the judge **model** — not the backend         |
| "the judge failed in an unrecognised way"                      | an `error` verdict matching neither shape (e.g. a `--judge-repeat` fold that kept a scored run's reasoning) | the per-triple `reasoning` in `gold-set.json` |

None of the three is a labelling problem: an unanswered triple disagrees with every hand label, so re-labelling can only move it in the wrong direction. Only when all three lines are absent does the Disagreements list mean what it says — each triple the judge got wrong together with the human note explaining the label, which is where a rubric ambiguity shows up first. `gold-set.json` is the machine-readable twin; the compact stamp (judge model, threshold, per-direction rates, `unscored` with its per-cause split, `status`) is repeated in `index.json`, in every findings header, and in each `iteration-N/verdicts.json`, so what graded a kept edit is on the record. The unscored split is also printed on the `[calibration]` console line and in the findings header **when the calibration passes**, so a partial outage that still clears the threshold is not announced as a clean OK.

A gold set that cannot be loaded at all — missing directory, unparseable file, failed balance validation — exits `2` (CLI/config) naming the file and the cause, not `4` and never `1`: nothing was scored, so it is the configuration that failed, not the judge and not a checkpoint.

**`--allow-unreliable-judge` is eval-only.** It completes a plain or `--compare` run for diagnosis (every artifact stamped `unreliable`, exit `4`). With `--max-iterations > 1` a failed calibration aborts regardless of the flag: the loop edits `skills/cbe/` in place and decides keep-or-revert from the same verdicts the calibration just declared unreadable, so it would leave permanent edits picked by a broken instrument. The loop path's gate is constructed without the diagnosis affordance (`calibrationGateFor`), so it is a mechanism and not a convention; passing the flag anyway prints the reason on stderr.

### The run measures the app's prompt surface, not the repo's

Every eval session's agent `cwd` is a per-session, initially empty workspace under the OS temp
directory — **outside the checkout** (`evalWorkspaceRoot` in `runner/src/session-pi.ts`), mirroring
the app's `<userData>/workspace`. This is load-bearing, not hygiene. Pi's `loadProjectContextFiles`
walks `cwd` **and every ancestor** for `AGENTS.md` / `CLAUDE.md` and inlines what it finds as
`<project_instructions>`. While the runner passed no `cwd`, `startCbeSession` fell back to
`process.cwd()` = the repo root, and every run fed the candidate this repository's own engineering
handbook: **41,936 characters, 73.1 % of a 57,214-character system prompt**, a surface the desktop
app never composes. Pinning `cwd` takes the composed prompt to **15,279 characters with no
`<project_instructions>` block**.

Two consequences worth carrying:

- **No run from before that pin is comparable to any run after it.** The prompt changed by 42 KB.
  There is no baseline; the first full run after the pin is the reference point.
- **A workspace under `evaluation/cbe-skill/runs/` would not have worked** — the walk reaches the
  repo root from any descendant of it. The derivation refuses a root inside the repository rather
  than silently composing the wrong prompt.

Guarded by `runner/tests/session-pi.test.ts` (the wiring) and
`packages/pi-bridge/tests/eval-workspace-prompt.test.ts` (the composed prompt, both directions).

### Parity between an eval probe and a real app session

Governed by capability `cbe-skill-eval-harness`, Requirement: _A Probe Reproduces the App's Session
Priors, and Every Divergence Is Declared_. The contract has two halves.

**Identical by construction.** The eval and the app both create sessions through `startCbeSession`,
so the identity prompt, the eagerly-included skill body, the registered tool set and the
environment-descriptor shape are the same on both paths. The runner composes none of that surface
itself. Guarded by `runner/tests/descriptor-parity.test.ts`, which asserts the descriptor-feeding
**key set** (parsed from `BuildEnvOptions`) is supplied identically by the app's `startCbeSession`
call and the runner's — keys, never values: the app injects real course content, a probe injects
fixtures, so value equality would fail for the right reasons.

**Expressible priors.** `ProbeSetup` can express every prior the app injects at session start:
`lecturerProfile`, `lecturerIdentity`, `courseContext`, `canvasArtefacts`, `stepCoverage`,
`maturity`, and — since `express-app-priors-in-probe-setup` — `lecturerState` (the two-layer global
profile + per-course overlay: `{ globalPath, globalContent, overlayPath, overlayContent }`, all four
strings) and `decisionsSummary` (the pre-summarised decisions line). Both travel through the same
prior mechanism as the canvas prior (same fenced-block shape, same defensive encoding, same size
cap); an absent prior emits no block, so a probe that declares neither is byte-identical to before
the fields existed. An invalid shape is rejected at load, before any model call is paid for.

**The support preference is a service, not a prior value** (since `recalibrate-tutor-support`).
The app passes its ONE lecturer-wide, file-backed support service to every session; the bridge
renders the `lecturer-support` block from its current snapshot and registers `cbe_support` to write
through it. The eval passes the same service type over an **isolated in-memory store per probe**,
seeded from `setup.lecturerSupport` (`{ preference: guided|collaborative|concise|null, revision?,
scope? }`; omitted means nothing recorded at revision 0). A probe's own `cbe_support` write lands in
that probe's store and nowhere else — never in another probe, never in a production record.
`descriptor-parity.test.ts` checks the service option on both paths (`FED_BY_WITH_REASON`), and
`runner/tests/support-probe-setup.test.ts` checks the load-time validation and the isolation.

**What still differs, and why each entry stands:**

- **Prior conversation.** The app seeds `resume: { turns }`; probes never do. A probe is always
  turn 1 of a cold session — no index read, no established profile, nothing carried. `ProbeSetup`
  has no `resume` field by decision (replaying turns means transcript fixtures and compaction
  interaction, and no scenario needs it); a probe that needs warm conditions states them through
  the priors above.
- **Corpus source.** There is ONE corpus. The eval passes `paths.corpus = <repo>/corpus`; the app
  calls `currentCorpusDir()` → `activeCorpusDir()`, which returns the downloaded cache only when
  `<userData>/corpus-cache/corpus/index.json` AND `meta.json` both exist, and otherwise falls back
  to `resolveResource("corpus")` — in a dev checkout that IS `<repo>/corpus`. So in dev without a
  downloaded bundle the two already read the same tree; they diverge only once a bundle has been
  downloaded, or in a packaged build. Named, not closed, by decision: pointing the eval at the
  production corpus would break the runs-from-any-checkout guarantee, pinning a fixture corpus
  would stop citation checkpoints measuring the documents lecturers actually have. A citation
  checkpoint is only as valid as the overlap, so check which case you are in before trusting one.
- **Skill source — the same divergence, same reasoning, since `connect-production-corpus`.** The
  eval passes `skillDir = <repo>/skills/cbe`; the app calls `currentSkillDir()` →
  `activeSkillDir()`, which prefers the downloaded skill cache (`<userData>/skill-cache/skill/`,
  marker `SKILL.md` + `meta.json`) over `resolveResource("skills/cbe")`. In dev without a synced
  skill bundle both read the repo tree; they diverge once a skill bundle has been adopted, or in a
  packaged build whose skill has synced past the shipped copy. A run therefore measures the
  repo's skill state, which is exactly what skill development wants — but a behaviour report about
  a PRODUCTION install must first check which skill version that install has adopted
  (Settings → About).
- **A step-6 `canvasArtefacts` entry MUST carry its `phase`, or it is invisible to the host's fill
  state.** `CanvasMirror.keyOf` derives the key from `entry.phase` when present and from the bare
  step otherwise, so `{ step: 6, id: "is" }` lands at `6/is` — while `stepEmptySlots(6, …)` expands
  step 6 into its four containers and asks for `6/investigate/is`. The keys never meet: the entry
  is accepted, is readable at `mirror.get({ step: 6 }, id)`, and step 6 still reads as completely
  unfilled, so the close gate keeps blocking. Three eval fixtures carried the defect silently until
  2026-08-18 (S5b/S5c/S5d in `scenarios/05-closing.md`, whose Setup prose claimed "every card on
  record"). Guarded model-free by `runner/tests/scenario-05-step6-fixture.test.ts`.
- **`paths.wiki`.** The app passes the active course's `wiki/`; a probe only gets one via
  `wikiFixture` — deliberately: an isolated fixture wiki is what makes the wiki-wins rule testable.
- **`writableRoots`.** The app passes the four fenced write destinations (workspace, active course
  `wiki/`, the two Lecturer-State files); the eval session factory deliberately passes none, so
  every `write`/`edit` call in a probe is refused (`agent-harness`, Requirement _Path-Fenced File
  Mutation Tools_ — deny-by-default; the omission is a design decision of `fence-agent-file-writes`,
  do not add roots there). Same tool set, different write capability; no current scenario exercises
  the mutation tools.
- **Support-preference durability.** An app-profile probe reports the app's scope
  (`lecturer-wide`, so the model words the invitation as the app would), but its store is in memory
  and ends with the probe. A probe therefore measures what the model says and which `cbe_support`
  call it makes, never that a preference survived a restart or reached another conversation: that
  durability is proved model-free by `packages/app/tests/lecturer-support-store.test.ts` and
  `support-preference-host-channel.test.ts`, not by an eval verdict.
- **Host wiring the app binds and the eval leaves unbound:** the `/cite` slash command
  (`commands.listCorpusIds`), the compaction companion's accessors, and the pinned `sessionId` that
  lets the maturity mirror rebuild on resume. None of these change an ordinary turn; they change
  resume, compaction and `/cite`, and no scenario exercises those today.

**A scenario that depends on a divergence declares it in the scenario file.** Where a checkpoint's
verdict turns on something a probe cannot reproduce — or on which corpus is mounted — the scenario
states that at the point of measurement (a short quoted note near the probe or checkpoint it
qualifies), so the caveat travels with the verdict instead of living in a handbook. Worked cases:
`11c` (`scenarios/11-delegation-check.md`, cites `methodology-002`) and `12d`
(`scenarios/12-alignment-check.md`, cites `methodology-003`) — both documents verified present in
the dev corpus (`corpus/index.json`) AND in the published bundle
(`plan/corpus-dist/v2026-11.zip`), which is why those checkpoints are valid under either corpus;
each scenario file states that assumption beside the checkpoint.

### Output and `runs/` policy

Each run writes `<probe>-findings.md` + `<probe>-report.json` + an aggregate `index.json` under `evaluation/cbe-skill/runs/run-<timestamp>/`, plus `gold-set.md` / `gold-set.json` for the judge calibration. With `--repeat` or `--judge-repeat` above 1, each report carries a `stability` block naming which checkpoints flipped on a fixed transcript (judge) and which only between transcripts (model). The improvement loop additionally preserves each cycle's skill snapshot, verdicts, and editor reasoning under `iteration-N/`.

`runs/` is **git-ignored** — runs are noisy and reproducible. To keep a milestone run, point `--output-dir` at a tracked path and commit it deliberately.

Because the artifacts are disposable, **every live-model run is logged in [`RUN-LOG.md`](RUN-LOG.md) in the session it was run** — date, candidates, repeat count, observed outcome, and the edits or reclassifications it justified. That file is the only durable evidence that a run happened; an unlogged run is indistinguishable from no run at all.

### The improvement loop — raising the pass rate

`--max-iterations N` turns a scored run into a training loop. The mechanics (`runner/src/loop.ts`):

- **Cycle 1 is eval-only** — a baseline, no editor. `--max-iterations 1` therefore disables the editor entirely (that is the plain scored run).
- **Cycles 2..N each run the editor.** For every failing checkpoint the editor LLM (the same `claude` CLI as the judge, or `--judge-model`) proposes one edit. The edit is bounded: it may only touch `SKILL.md` or `references/*.md` (`editor.ts` allowlist), it may **not** remove the guarded sections `## Non-negotiables`, `## Citing`, `## Stance` (`GUARDED_SKILL_SECTIONS`), and it must be **surgical** — an edit that grows a file beyond a small bound (~1500 added chars or >1.5x) is rejected, because a bloated skill eats the runtime model's context. The editor is given the targeted checkpoint's rubric and the failing transcript so it can target the actual gap. An out-of-bounds, guard-violating, or oversized edit is rejected and reverted.
- **Keep-or-revert is a probe-scoped no-regression gate.** After re-evaluating, the loop looks only at the probes that contained a targeted (failing) checkpoint — the **decision set**. It keeps the edit iff at least one targeted checkpoint improves (`fail → partial → pass`, so partial progress counts) and **no** checkpoint in the decision set regresses; otherwise it restores the previous snapshot. Checkpoints in unrelated scenarios are ignored, so suite-wide LLM-judge noise cannot revert a good local edit. (Use `--repeat N` to feed the gate majority verdicts and damp that noise further.) With `--interactive` you decide keep/revert/abort per edit instead.
- **Stops** when all checkpoints pass, when `--max-iterations` is reached, or when `--max-tokens` is exhausted.

> **Target edits via the traceability map.** Before editing for a failing checkpoint — whether you drive the loop's editor or hand-curate a hybrid fix — consult `evaluation/cbe-skill/traceability.json`: checkpoint X → anchor Y is the skill text to edit (see [Traceability map](#traceability-map-traceabilityjson-and-npm-run-tracecheck)). Blind editing is the documented failure mode (the board-01 loop landed 0 kept edits; the first hand edit for scenario 07 missed the governing text). And apply the 07 lesson at the anchor: **force the output shape, don't describe it** — a prose description of the expected behaviour loses to the model's helpfulness prior; write the anchor text as an explicit output contract (mandatory items, order, close). A `suspect-check` entry means amend the spec/rubric instead; a `scenario-flaw` entry means fix the scenario turns — don't bend the skill to a broken check.

> **⚠ Back up the skill before any `--max-iterations > 1` run.** The loop edits `skills/cbe/` **in place** (`FsSkillIO`). It has per-cycle revert and crash recovery via a marker file, but **no backup of the starting state** if a whole campaign ends badly or is killed uncleanly. Commit `skills/cbe/` (or branch) first, so the baseline is always recoverable:
>
> ```bash
> git add skills/cbe && git commit -m "chore: skill baseline before eval loop"
> ```

Each cycle is preserved under `iteration-N/` in the run dir: `skill-snapshot.json` (the full skill tree at that cycle), `verdicts.json` (`{ judgeCalibration, verdicts }` — the scored checkpoints plus the calibration stamp of the judge that produced them), and `editor-reasoning.txt` (why the editor proposed its change). That is the audit trail for what the loop changed and why.

Full run recipe (single model, the didactic checks, bounded budget):

```bash
git add skills/cbe && git commit -m "chore: skill baseline before eval loop"   # backup first
npm run build
npm run eval -- --model gpt-oss-120b --scenarios 07-09 --parallel 1 \
  --judge-model sonnet --max-iterations 5 --max-tokens 2000000 \
  --output-dir /tmp/eval-loop-0709
```

When the loop keeps edits you like, commit the now-modified `skills/cbe/`; that becomes the new baseline. To throw a campaign away, `git checkout skills/cbe`.

#### Board mode — optimize against multiple models, not one

Optimizing against a single model tunes the skill to that model's quirks. Pass `--panel <names>` (comma-separated candidate names) to optimize against the whole board: the loop keeps a per-checkpoint edit only if it is a **Pareto improvement** — it lifts the checkpoint on at least one panel model and regresses none (this includes lifting only the weakest model where stronger ones already pass — a clearer formulation is genuine improvement). Add `--holdout <name>` to validate against a model not optimized against (overfit guard).

```bash
npm run eval -- --scenarios 09 --max-iterations 2 --max-attempts 3 \
  --panel qwen3.5-35b-a3b,gemma4-31b,mistral-large-2512 --judge-model sonnet \
  --output-dir /tmp/board-09
```

**Cost:** a board run is **N× the per-attempt eval cost** (one candidate generation per panel model, plus the judge), even with scoped per-probe re-eval. Keep the panel small and the scenario count low; it is thorough, not fast.

### Encoding a scenario

Each scenario `.md` carries one fenced `yaml` block keyed `eval:` with `probes[]` (each with `setup`, `turns[]`, `checkpoints[]`). Deterministic checkpoints score in code; `judge` checkpoints carry a `rubric`. The implemented deterministic kinds are `IMPLEMENTED_DETERMINISTIC_KINDS` in `runner/src/types.ts` — that list is the authority, and each entry there states why it exists and what no other kind could see; the loader rejects a kind outside it. The loader warns if the checkpoint count drifts from the prose pass-criteria count.

### Traceability map (`traceability.json`) and `npm run trace:check`

`evaluation/cbe-skill/traceability.json` is the checkpoint ↔ anchor ↔ requirement map (capability `cbe-skill-traceability`). It closes the gap in the traceable chain: OpenSpec specs trace to scenarios, but the instruction surface is organised for the runtime model — the map is the overlay that says, per checkpoint, **which passage in which channel governs the behaviour**.

Since `rebuild-skill-prompt-and-eval` the anchor space covers **all three instruction channels** (capability `agent-harness`, Requirement: _Instruction Channel Boundary_): a rule that left the skill body for a tool description did not stop being testable, it stopped being anchorable in the old skill-only space.

**How to read an entry:**

```json
{
  "checkpoint": "06.S6.6a",
  "anchors": [
    { "channel": "prompt", "file": "identity-prompt", "heading": "Corpus grounding" },
    { "channel": "tool", "file": "cbe_cite", "heading": "NEVER HAND-WRITE A (corpus:…) TOKEN" }
  ],
  "requirement": "cbe-skill-eval-harness / Citation Provenance Is Checked Deterministically",
  "classification": "unmeasured",
  "note": "TWO anchors because the behaviour has two halves with different homes — not because one rule is stated twice."
}
```

- `checkpoint` — the suite-unique id: `<scenario-number>.<checkpoint-id>`, probe-qualified when the checkpoint id does not already start with the probe id (`07.7a.3`, but `31.31b.bigidea`).
- `anchors` — the passage(s) that govern the behaviour. **At least one is mandatory.** Each carries a `channel` (`skill` | `prompt` | `tool`), a `file` (a path relative to `skills/cbe/`; `identity-prompt`; or a `cbe_*` tool name), and a `heading` — a markdown/prompt heading _or_ a unique marker string the check can grep. Omitting `channel` means `skill`, for legacy entries.
- `requirement` — the owning spec requirement (`<capability> / <Requirement Name>`; bare capability where the scenario file does not name one).
- `classification` — routes a board-wide failure to its fix: `real-gap` → edit the anchored passage (and **force the output shape**, see below), `suspect-check` → amend the spec requirement/rubric, `scenario-flaw` → fix the scenario turns, `satisfied` → passes board-wide, `unmeasured` → not yet measured. The replacement suite ships entirely `unmeasured` — **by construction, not by neglect**: no measurement run has happened against the rebuilt surface yet, and a seeded classification would be a claim nobody made. `unmeasured` is no longer an escape from anchoring: an entry with no anchor fails the check whatever its classification. During the Measure phase, replace every entry from run evidence: board-wide passes become `satisfied`; failures receive their triaged route. A repeat-1 spot check is provisional and cannot justify `satisfied`; that classification requires the repeat-3 majority. No `unmeasured` entry may survive archive.
- `note` — free-text nuance, e.g. a secondary suspect-check candidate deferred until a capability lands.

**Provenance of the current map.** It was rebuilt from scratch with the nine replacement scenarios (29 entries) and has grown with the suite since — one entry per checkpoint, each anchored and each naming its owning requirement. The current size is whatever `npm run trace:check` prints; a number written down here goes stale on the next checkpoint added. The previous map is gone with the suite it described — 234 of its 296 entries sat in an anchorless default state, which made it a list rather than a routing table.

**`npm run trace:check`** (build first: `npm run build`) validates the map against the live scenario suite and the live channels — every markdown file under `skills/cbe/`, the identity prompt, and each registered tool description. It **fails (non-zero exit)** on:

- **unanchored checkpoints** — an entry with no anchor. **Not downgradable to a warning:** it was report-only before, and the report was ignored for 234 entries;
- unmapped checkpoints (a suite checkpoint with no entry);
- stale entries (a checkpoint id, channel passage, or marker that no longer exists);
- duplicates and schema violations.

It **reports without failing** untested passages — a channel heading no checkpoint maps to. That is information about coverage, not a defect: 60 checkpoints cannot test every rule, and this requirement does not ask them to. Before measurement, it also reports anchored `unmeasured` entries without failing. After the Measure phase, run the archive gate:

```bash
npm run trace:check -- --require-classified
```

That mode exits non-zero and names every remaining `unmeasured` checkpoint. It must pass before `openspec archive rebuild-skill-prompt-and-eval`.

Pure code — no LLM, no network; the logic is unit-tested in `runner/tests/trace-check.test.ts`.

> The prompt and tool channels are resolved statically from their source files without importing `@cbe/pi-bridge`: the checker extracts only the `cbeIdentityPrompt` template and each registered tool's `description` plus parameter descriptions. Comments, `promptSnippet`, `promptGuidelines`, and unrelated source text cannot satisfy an anchor.

**Keeping it in sync:** the map is derived-but-authoritative — update it in the same change whenever a checkpoint is added/renamed, a spec requirement moves, or a governing passage changes **in any of the three channels**, and run `trace:check` whenever spec, scenarios, `skills/cbe/`, the identity prompt, or a tool description change. A new checkpoint without a map entry, or a renamed skill heading with a stale anchor, is exactly what the failing exit code is for.

### Zero-endpoint default (Claude as judge, app LLM as candidate)

By default `npm run eval` needs **no judge endpoint and no eval.config.json**:

- **Candidate** = the LLM you configured in the CBE Toolbox app (`cbe-config.json` under `~/Library/Application Support/CBE Toolbox/`). Since the app stores the API key Keychain-encrypted, `CBE_LLM_API_KEY` must carry the same key — export it, let a secrets file supply it (this path resolves credentials the same way, see [Where the credentials come from](#where-the-credentials-come-from-no-sourcing-required)), or rely on `apiKeyPlain`. Override the config path with `--app-config`.
- **Judge + editor** = the local `claude` CLI (`claude -p --output-format json`). No judge API key. Pick its model with `--judge-model sonnet|opus`. Requires an authenticated `claude` CLI on PATH.

```bash
export CBE_LLM_API_KEY=...        # same key you entered in the app
npm run build
npm run eval -- --scenarios 07 --judge-model sonnet
```

`eval.config.json` is only needed for multi-model `--compare` / `--model` runs (those candidates still use `baseUrlEnv`/`apiKeyEnv`). The judge stays the Claude CLI in all modes.
