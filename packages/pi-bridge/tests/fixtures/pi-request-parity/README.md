# Pi request-parity goldens

The `/chat/completions` request bodies the CBE bridge sent with **Pi 0.75.5**
(HEAD `71d05de`, built against `@earendil-works/pi-coding-agent@0.75.5`), captured on
2026-10-18 by `../../helpers/request-capture.mjs` against a local mock server:

| File                       | Session                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `request.json`             | app profile, one lecturer prompt, no reasoning                                        |
| `request-reasoning.json`   | the same with `reasoning: true`, effort `medium`                                      |
| `resume-request.json`      | a resumed conversation: five seeded turns (one empty assistant turn), then one prompt |
| `atomization-request.json` | first request of one wiki atomization run                                             |

Placeholders: `<ROOT>` (the run's temporary directory), `<REPO>` (the checkout),
`<DATE>` (the prompt's local date).

`../../request-parity.test.ts` runs the same capture against the current bridge and
requires byte equality apart from the documented, accepted Pi tool-schema drift
(change `adopt-settled-pi-runtime-lifecycle`). Regenerate these files only from a
pre-upgrade build and only by a deliberate decision — they are the reference the
upgrade is measured against, not a snapshot to refresh.
