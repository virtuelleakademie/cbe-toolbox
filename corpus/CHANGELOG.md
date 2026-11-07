# Corpus Changelog

The corpus is versioned content. The newest `## YYYY-MM` heading below is the
authoritative `corpus-version` stamped into `index.json` by the index generator
(`packages/corpus-schema/src/index-gen.ts`).

## 2026-12

- **CBE best-practice collection.** Added eleven real module case studies with stable `case-study-003` through `case-study-013` identities and field-level citation headings.
- **Illustrative maturity profiles.** Added one explicitly fictional methodology document with separate Level 1, Level 2 and Level 3 profiles.
- **Faithful maturity and source-gap handling.** Preserved the supplied holistic PIONEER labels and rationales, directional qualifiers, empty Source metadata, unresolved template gaps and only verified named external references.

## 2026-11

- **Corpus content and metadata refresh.** Refreshed governed content and regenerated corpus metadata and distribution artifacts.
- **Editorial cleanup.** Separated cited sources from bibliographic references (references carry no licence metadata), removed incomplete further-reading lists, and retired one foundations document.
- **foundations-005 source-discipline note removed.** Removed the closing "Source discipline" section from `foundations-005`; the definition, the seven PIONEER criteria with their maturity cues, the multi-actor ecosystem, the SDG11 orientation and the recorded 4.2.1 provenance are unchanged.

## 2026-07

- **Re-grounding on the CBL Guide 2016 (primary source).** All corpus documents
  making substantive claims about the CBL framework were verified claim by claim
  against the primary document `CBL_Guide2016.pdf` (Nichols, M., Cator, K., &
  Torres, M. (2016). *Challenge Based Learner User Guide*. Redwood City, CA:
  Digital Promise) and page-anchored: the guide's `sources[]` entries now carry a
  `pages` field and each guide-backed claim cites its page inline. The guide
  source is normalized everywhere — canonical URL
  `https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf`
  (the previously cited digitalpromise.org page is 404) and licence `CC BY`
  (guide p. 2), replacing the earlier "educational reuse" hedge. Touched:
  `methodology-001`, `foundations-001` (sweep hit), `foundations-002`,
  `foundations-003`, and `vocabulary-001`.
  Notable corrections, per the guide: Investigate's third step is **Analysis**
  (not "Synthesis"); foundational idea #5 is **"Content and 21st Century
  Skills"** ("durable skills" does not occur in the guide); the guide's set is
  called **foundational ideas** ("Key Ideas" is website wording); the
  Content/Activity/Conceptual guiding-question taxonomy is **not** in the guide
  (learners build their own categories); "learn how to learn" does not occur
  (the guide's phrase is "developing a framework for life-long learning", p. 4).
  Uncovered claims are re-sourced or explicitly flagged as practice
  observations. Full audit trail:
  `openspec/changes/reground-corpus-on-cbl-guide-2016/discrepancy-log.md`.
  Document ids, titles, categories, and paths are unchanged.
- **PIONEER foundations (Phase A ingestion).** Adds two documents sourced from
  the validated PIONEER Working Package 4 document *4.2.1 Sub-Task Didactical
  Toolbox — Train-the-Trainer* (FINAL version received 2026-07-06; the validated
  content source for all corpus work per the stakeholder directive of
  2026-07-07):
  - `foundations-005` — the PIONEER-Alliance definition of CBE (§§4.1–4.3): the
    CBE-vs-PBL/PjBL distinction, the seven operationalised PIONEER criteria with
    their three-stage maturity cues, the multi-actor ecosystem, and the SDG11
    impact orientation.
  - `methodology-007` — the CBE maturity continuum (§4.4 Table 1 + §4.5): three
    maturity levels with the full synonym mapping, the 3×7 raster, the
    developmental-continuum framing, the toolbox mandate, and the
    minimum-standards vs excellence-criteria vocabulary.
  - `methodology-012` — the PIONEER ten-step CBE module design flow (§4.6) as a
    citable methodology document: the ten steps in order, each with its named
    output artefact; the backward-design rationale (learning outcomes and
    assessment evidence settled before the challenge is detailed — evidence
    first); the explicit coherence gate after step 3 (do not move on before
    challenge, learning outcomes and assessment blueprint are coherent); the
    iterative three-round use (rough → refined → detailed, not a mandatory
    linear sequence); the step-4 ladder (theme/big idea → key question →
    concrete challenge); and step 6's four-element learning journey (Engage,
    Investigate, Act/prototype, Reflect and present), with the designer-time
    flow vs learner-time journey orthogonality note. Same validated 4.2.1 WP4
    source and `CC-BY-4.0 (pending)` licence framing as the entries above.
- **Licence.** Both documents record `CC-BY-4.0 (pending)`: the 4.2.1 source
  lines state the WP4 content is an Open Educational Resource "TBC under OER
  CC-BY 4.0" — planned OER CC-BY 4.0, status to be confirmed. Update to the bare
  `CC-BY-4.0` once the TBC is resolved by the stakeholder.

## 2026-06

- Mechanism baseline for the switch to pure date-based corpus versioning
  (change `version-corpus-replace-dev-track`): the `corpus-track` /
  `review-status` / `reviewers` frontmatter fields and all per-citation authority
  markers are removed; the document tree moved from `corpus/dev/` to
  `corpus/content/`. Document content is unchanged in this version — only the
  mechanism. Authority is established per version (every released version is
  signed off as a whole before public release).
