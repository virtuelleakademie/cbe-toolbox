# Upgrading the embedded Pi runtime

The CBE Toolbox embeds `@earendil-works/pi-coding-agent` as its agent runtime,
pinned to one reviewed, exact version set (capability `agent-harness`,
Requirement: _Embedded Pi Runtime Configuration Is Explicit and Versioned_). A
Pi release can change what CBE relies on without changing a single CBE file, so
a new version is evaluated by a **contract harness** before anyone touches the
manifests (Requirement: _Pi Upgrades Are Proven Through a Public Contract
Harness_). This page is the operator's guide to that harness: the commands,
what a green result is worth, who owns a red one, and what it does not prove.

It is a local, explicit gate. It is not a dependency bot: nothing in this
repository watches for new Pi releases or tries `latest` on a schedule, and it
replaces none of the product, Electron or skill evaluations.

## The two commands

| Command                                                 | What it does                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run pi:contracts`                                  | Runs every contract group against the Pi version currently installed in this checkout.                                      |
| `npm run pi:contracts -- --group lifecycle`             | Runs one group (repeat `--group`, or `--group a,b`). `--list` prints groups, owners and files.                              |
| `npm run pi:candidate -- --pi 1.4.0`                    | Evaluates a candidate: every declared Pi package at `1.4.0`, in an isolated copy of the committed tree.                     |
| `npm run pi:candidate -- --set <pkg>@<v> …`             | Names the set package by package (also `typebox`), for a release whose packages do not share one version.                   |
| `npm run pi:candidate -- --pi 1.4.0 --group compaction` | Restricts the candidate run to named groups — useful while diagnosing; a candidate is only accepted on a run of all groups. |

`pi:candidate` also takes `--ref <commit>` (default `HEAD`), `--report <file>`
(a JSON result, written outside the repository), `--tmp-root <dir>` and
`--keep` (leave the temporary copy for inspection; you remove it).

**Build first** for `pi:contracts`: the `lifecycle` and `compaction` groups
include app tests, and app tests read the built `dist/` of the other
workspaces (see the dev rebuild rule in `CLAUDE.md`). `pi:candidate` builds its
own copy, so it needs no prior build.

## The contract groups

The matrix is `packages/pi-bridge/tests/contracts/groups.json`: one group per
failure domain, one owner per group, every file in exactly one group, and every
scenario of the requirement mapped to the tests that discharge it.
`contract-matrix.test.ts` fails when that file drifts from the tree — a listed
file disappears, a new test starts a real Pi session without being placed, or a
mapped test title no longer exists.

| Group             | A red result means …                                                                                   | Owner (start reading here)                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `construction`    | the session is no longer built from explicit home/settings/resources, or its prompt or tool set moved  | `session.ts`, `atomization-session.ts`, `runtime/pi-config.ts`             |
| `provider`        | BYO registration, reasoning, context window or live/failed re-bind changed; or the scripted seam broke | `provider.ts`, `runtime/pi-model.ts`, `tests/helpers/scripted-provider.ts` |
| `lifecycle`       | run chronology, retry, continuation, abort/stop or exactly-once settlement changed                     | `runtime/pi-events.ts`, `runtime/pi-session-port.ts`, `turn-stop.ts`       |
| `deferred-answer` | a picker no longer ends its run in one request, or its answer no longer continues cleanly              | `picker-tool.ts`, `pending-answer-gate.ts`                                 |
| `compaction`      | Pi's compaction hooks, the steered re-trigger, the bound or the retained-state handover changed        | `compaction-companion-extension.ts`, `retained-state-handover.ts`          |
| `persistence`     | resume seeding, the pinned session id, or reading either Pi JSONL generation fail-soft changed         | `session.ts`, `maturity-replay.ts`, `tests/fixtures/pi-session-format/`    |
| `security`        | the write/edit fence, the absence of a shell, or the ephemeral atomization policy changed              | `write-fence.ts`, `atomization-session.ts`, the allowlist in `session.ts`  |
| `guards`          | a structural rule broke: boundary imports, private/deep Pi access, patches, versions, declarations     | `tests/helpers/pi-upgrade-guards.ts`, `pi-boundary.test.ts`, `groups.json` |

Every group drives the real Pi runtime. Deterministic model output comes from
one scripted provider (`tests/helpers/scripted-provider.ts`), registered
through Pi's public API-provider registry; scripts carry text, thinking, tool
calls, errors, usage, stop reasons and controlled delays, and real Pi decides
everything else — prompts, tools, retries, compaction, queues, persistence and
events. Contract assertions read the CBE-owned `CbeSessionPort` and the
normalized `CbeRuntimeEvent` union; only adapter-edge tests look behind the
port, through `tests/helpers/pi-adapter-access.ts`. The `provider` group proves
the whole thing runs with the network refused (`tests/helpers/no-network.ts`).

## The guards and their negative controls

`pi-boundary.test.ts` and `pi-upgrade-guards.test.ts` run five structural
guards over the repository. Each one has a deliberate violation under
`packages/pi-bridge/tests/fixtures/pi-upgrade-guards/` that it must report —
a guard nobody has seen fail is not evidence.

| Guard              | Fails on                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| boundary           | a Pi import or Pi runtime type outside the approved adapter modules and adapter tests                                                    |
| private access     | `session.agent`, `streamFn`, the extension runner or an underscore member, in any file that can reach Pi                                 |
| deep import        | a Pi subpath the package's `exports` does not publish (`…/dist/…`), or a `node_modules/@earendil-works` path                             |
| installed patch    | a patch directory or tool, a lifecycle script editing installed packages, a Pi override, an installed version that is not the locked one |
| version alignment  | a non-exact Pi/`typebox` declaration, two Pi versions, a stray nested Pi copy, more than one `typebox` copy                              |
| direct declaration | a package pi-bridge imports that its manifest does not declare; a Pi/`typebox` import arriving transitively elsewhere                    |

The guards pin the **shape** of the set — exact, aligned, one copy — and read
the reviewed version from the manifests, which is what lets the candidate gate
run them unchanged against a candidate set.

## What `pi:candidate` does

1. Refuses — before touching anything — a floating version (`latest`, a tag, a
   range), a set that does not name every declared Pi package, and a package no
   workspace declares (exit `2`).
2. Fingerprints your checkout: HEAD, branch, index, status, worktree and stash
   lists, and the bytes of the lockfile, every manifest and every dirty path.
3. Exports the committed tree at `--ref` with `git archive` into a fresh
   temporary directory. No worktree, no branch, nothing written to your `.git`.
   **Uncommitted changes are not part of the candidate** — commit or check out
   what you want evaluated.
4. Writes the candidate versions into that copy's manifests, drops the Pi
   entries from that copy's lockfile so npm resolves the whole Pi family afresh
   (everything else stays locked), and runs `npm install --ignore-scripts`
   there (no lifecycle script, so no hook installer can reach a git
   configuration). It then checks that every declaring workspace resolves
   exactly the requested versions (exit `3` otherwise).
5. Builds `corpus-schema` → `pi-bridge` → the eval runner → `app` in that
   order (exit `4` names the workspace — an API the candidate removed or
   changed shows up here).
6. Runs the contract groups (exit `1` names each red group and its owner — a
   behaviour the candidate changed shows up here).
7. Removes the temporary directory (unless `--keep`) and re-checks your
   fingerprint. Any difference is exit `5`, whatever the candidate's result.

Exit `6` means the isolated copy could not be created at all. The gate's own
self-test (`npm run pi:candidate:self-test`, part of `npm test`) proves every
one of these paths offline against a throwaway repository with a fake npm,
including a clean and a dirty caller hashed byte for byte, `.git` included,
and a negative control in which the run deliberately touches the caller.

## Accepting a green candidate

A green candidate run is the entry ticket, not the acceptance. Accepting the
version is an ordinary OpenSpec change:

1. set the same exact versions in the manifests and run `npm install`;
2. commit manifests and lockfile **together**;
3. run the separate validations below, and fix or explicitly accept every
   behaviour change under the requirement it touches
   (_Accepted Pi 1.3 Runtime Semantics Are Explicit Contracts_ is the precedent
   for writing such acceptances down).

## What a green result does not prove

Both commands print this list on every run, because it is the part most easily
forgotten:

- the full builds and suites: `npm run build`, `npm test`;
- the real Electron renderer: `npm run test:electron --workspace packages/app`;
- lint and formatting: `npm run lint`;
- specs and traceability: `openspec validate --all --strict`, `npm run trace:check`,
  `npm run archive:check`;
- wire behaviour against a real provider endpoint, and model or skill
  behaviour: a live-model `npm run eval` wherever an instruction or
  model-visible surface changed (the scripted provider is not a model, and the
  `request-parity` goldens pin the request body, not what a model does with it);
- the integrity of installed files beyond their version identity — the patch
  guard sees patch mechanisms and version drift, not a hand-edited file inside
  `node_modules`.

## Cleanup

`pi:contracts` writes only vitest's JSON reports into a temporary directory it
removes. `pi:candidate` keeps everything under one `cbe-pi-candidate-*`
directory in the system temp folder (or `--tmp-root`) and removes it in every
outcome except `--keep`. If a run is killed mid-way (a signal skips the
cleanup), remove leftover `cbe-pi-candidate-*` directories by hand; nothing else
was written.
