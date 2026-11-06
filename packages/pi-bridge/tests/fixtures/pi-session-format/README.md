# Pi session-format fixtures

Two REAL Pi session records, one per runtime generation, written on 2026-10-18 by
`startCbeSession` for the same scripted exchange — one lecturer prompt, one
`cbe_maturity` establishment call, one closing answer — against a local mock
provider:

| File              | Runtime                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `pi-0.75.5.jsonl` | HEAD `71d05de` bridge on `@earendil-works/pi-coding-agent@0.75.5` (session id `legacy-leg`) |
| `pi-1.3.0.jsonl`  | the upgraded bridge on `@earendil-works/pi-coding-agent@1.3.0` (session id `current-leg`)   |

Only the temporary directory and the checkout path were replaced
(`/fixture-root`, `/fixture-repo`). The 1.3.0 record differs in shape the way
real user data will: it carries a transcript `message` entry with role `system`.

`../../session-format-compat.test.ts` proves CBE's one reader of these files,
the legacy maturity replay, reads both generations — and tolerates the further
1.x entry types (`context_edit`, `compaction`) — without rewriting a file.
