# Curation Guidelines for the CBE Toolbox Corpus

Version: 1.3.0 | Last updated: 2026-11-06 | Maintained by: CBE Toolbox corpus maintainers

---

## Purpose and scope

### What the corpus is

The CBE Toolbox corpus is a curated set of authoritative Markdown documents that the CBE skill reads when answering questions from lecturers using Challenge Based Learning. It is the epistemic ground truth for the skill: when a lecturer asks "how does the Investigate phase work?" or "what does the literature say about learner agency?", the skill retrieves one or more corpus documents, synthesises the relevant content, and returns an answer. The quality of every answer is bounded by the quality of the corpus.

Documents are organized into five categories: **methodology**, **case-study**, **foundations**, **vocabulary**, and **template**. Each category has a distinct purpose, a typical length, and a different bar for citation rigour. Section 3 defines each category in detail.

The corpus is a single versioned content artifact. There is one set of documents, one schema, and one notion of currency. Document files live under `corpus/content/` (organized into per-category subdirectories). The index manifest (`index.json`), the changelog (`CHANGELOG.md`), and this guidelines file live at the corpus root in `corpus/`.

The corpus is not a database. It does not contain every paper ever written on CBL. It contains the documents that are most useful to a lecturer who needs practical, well-grounded guidance — and nothing else.

### What the corpus is not

The corpus is not a research archive. Papers that are relevant to CBL scholarship but do not directly serve a lecturer's practical questions do not belong here. A bibliographic database serves that need.

It is not a personal note collection. Observations, hypotheses, and synthesis notes that have not been grounded in primary sources and reviewed by a peer are not corpus documents. They may be useful inputs during the writing process, but they do not enter the corpus in unreviewed form.

It is not a teaching artefact designed for students. Documents are written for lecturers who are designing or running CBL experiences. Vocabulary should be precise and occasionally technical. The skill will adapt the register for the end user; the corpus does not need to do that job.

### Corpus version and currency

Currency is a property of the corpus as a whole, not of individual documents. It is expressed at the manifest level as a `corpus-version` field in `index.json`, written in `YYYY-MM` form (e.g. `2026-06`). The version is derived deterministically: the index generator reads `corpus/CHANGELOG.md`, takes the newest `## YYYY-MM` heading, and writes that value into `index.json` as `corpus-version`. To cut a new version, add a new `## YYYY-MM` section to the top of the changelog describing what changed, then regenerate the index.

There is no per-document currency or revision-state marker beyond the informational `version` field (see Section 2). A lecturer asking "how current is this content?" is answered at the corpus level, by `corpus-version`.

### Authority is established per version

Authority is established per corpus version, not per document. Before a corpus version is flagged for public release, it is reviewed and signed off **as a whole** by BFH/PIONEER. Once a version is released, **every document in that version is authoritative for that version**. There is no per-document authority marker, no per-document review state, and no separate "this document is endorsed" flag — release of the version is the endorsement.

This keeps the contract simple: a released `corpus-version` is a coherent, approved snapshot, and the skill can treat any document it reads from a released version as authoritative.

### Responsibility boundaries

The canonical CBE Toolbox maintainers own the schema, validation tooling, CLI, CI pipeline and delivery mechanism. BFH/PIONEER owns content authority: PIONEER experts decide what is accurate, what is current and what serves lecturers, and they sign off each corpus version before public release.

After a version is publicly released, content updates — corrections, additions, the next version — are initiated and approved by BFH/PIONEER, who own released content. Tooling maintainers do not make unilateral changes to released content.

If a schema change is needed, tooling maintainers and BFH/PIONEER coordinate: schema changes may require a migration pass over existing documents. Coordination happens before the schema change lands on the canonical branch.

---

## Mandatory frontmatter fields

Every corpus document begins with a YAML frontmatter block delimited by `---`. The schema is unified — every document, in every category, uses the same set of fields. The required fields are `id`, `title`, `category`, `version`, `sources`, `license`, `updated`, and `tags`; `short-description` is optional. Those nine fields are the complete schema — there are no track, review-state, or per-document-reviewer fields. The Zod schema enforces these constraints at commit time and in CI; a document that fails any of them will be rejected.

A minimal valid frontmatter block looks like this:

```yaml
---
id: methodology-001
title: "The Challenge Based Learning Three-Phase Framework"
category: methodology
version: "0.1.0"
sources:
  - author: "Nichols, M., Cator, K., and Torres, M."
    year: 2016
    title: "Challenge Based Learner User Guide"
    url: "https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf"
    license: "CC BY"
    pages: "11-13"
license: "CC-BY 4.0 — BFH/PIONEER"
updated: "2026-05-21"
tags: [engage, investigate, act, framework, phases]
---
```

### `id`

**Definition.** A stable, machine-readable identifier for this document. The skill resolves citations by `id`; the index maps `id` to a file path. Once a document has shipped in a released corpus version, its `id` must not change. If a later version revises the document, the revised document keeps the same `id`.

**Format.** Kebab-case: lowercase ASCII letters, digits, and hyphens. No spaces, no underscores, no uppercase.

**Zod rule.** `z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case")`

**Good examples.**
```yaml
id: methodology-001
id: case-study-example
id: vocabulary-big-idea
```

**Bad examples.**
```yaml
id: Methodology_001        # uppercase, underscore
id: methodology 001        # space
id: -methodology           # leading hyphen
```

**Why it matters.** The `id` is the stable key that citations resolve against across versions. If you rename an `id` after a version has shipped, the skill loses the ability to resolve citations that referenced the old `id`. Treat `id` as immutable once the document has shipped in a released index.

### The filename carries the `id`

**Rule.** A document's filename is **`<id>-<slug>.md`**, where `<slug>` is a short kebab-case shorthand for the title. The id comes first, so a directory listing sorts by id and prefix completion (`methodology-007<tab>`) finds the file.

**Good.**
```
content/methodology/methodology-007-cbe-maturity-continuum.md     # id: methodology-007
content/foundations/foundations-005-pioneer-cbe-definition.md     # id: foundations-005
```

**Bad.**
```
content/methodology/cbe-maturity-continuum.md   # slug only — the id is invisible on disk
content/methodology/methodology-012.md          # id only — tells the reader nothing
```

**Enforced.** `npm run corpus:validate` fails a document whose basename does not begin with its `id` followed by a hyphen and a non-empty slug, and that validation is what the pre-commit hook and the corpus CI workflow run. The error names the expected prefix.

**Why it matters.** Nothing in the code resolves a document by filename — the skill and the app go through `index.json` — so a wrong filename breaks nothing and therefore drifts. The cost is human: everything else in this project addresses a document by its id (`methodology-007` is the maturity raster the skill points at and the app glosses), and until 2026-08-10 a reader looking for that id on disk found nothing, because the file was called `cbe-maturity-continuum.md`.

**Renaming.** Use `git mv <old-path> <new-path>` so history is preserved, keep the `id` unchanged, and regenerate `index.json` (`npm run corpus:index`) so only the `path` value moves. Citations keep resolving because they resolve by id.

### `title`

**Definition.** The human-readable title displayed in the UI and cited by the skill. Must be non-empty.

**Zod rule.** `z.string().min(1)`

**Good examples.**
```yaml
title: "CBL Foundational Ideas and Design Principles"
title: "The Challenge Based Learning Three-Phase Framework"
```

**Bad examples.**
```yaml
title: ""                 # empty string — validation fails
title: "draft"            # not descriptive; will confuse retrieval
```

**Why it matters.** The skill surfaces document titles in responses. A vague title like "draft" or "notes" gives the lecturer no signal about whether the cited source is relevant to their question.

### `category`

**Definition.** One of five enumerated values: `methodology`, `case-study`, `template`, `foundations`, `vocabulary`. Determines how the skill uses the document and how retrieval is scoped. Section 3 defines each category in detail.

**Zod rule.** `z.enum(["methodology", "case-study", "template", "foundations", "vocabulary"])`

**Good example.**
```yaml
category: methodology
```

**Bad examples.**
```yaml
category: method          # not a valid enum value
category: "Case Study"    # wrong case and format
```

**Why it matters.** Category-scoped retrieval allows the skill to answer "show me a case study" without pulling in methodology documents. Miscategorised documents degrade retrieval precision.

### `version`

**Definition.** An informational semantic version `MAJOR.MINOR.PATCH` tracking the document's own revision history. This marker is advisory and human-facing only; it is distinct from the corpus-level `corpus-version` (Section 1) that establishes currency and authority. Nothing in the skill or the index keys off this field.

- **PATCH** (e.g. `0.1.0` → `0.1.1`): typo fixes, clarifications that do not change the document's meaning or add new content.
- **MINOR** (e.g. `0.1.0` → `0.2.0`): new sections, added examples, expanded coverage that is additive but does not change existing positions.
- **MAJOR** (e.g. `0.1.0` → `1.0.0` or `1.0.0` → `2.0.0`): structural reorganisation, stance change, or removal of previously stated content.

**Zod rule.** `z.string().regex(/^\d+\.\d+\.\d+$/, "semantic version required")`

**Good example.**
```yaml
version: "0.1.0"
version: "1.2.3"
```

**Bad examples.**
```yaml
version: "1.0"       # missing PATCH segment
version: "v1.0.0"    # leading "v" not permitted
```

**Why it matters.** Version numbers give a reader a signal about how much changed between edits of this particular document. A MAJOR bump warrants re-reading the document; a PATCH bump may require only a diff review. Authority and currency, however, come from the released `corpus-version`, not from this field.

### `sources`

**Definition.** Array of source objects. Every authoritative claim in the body must trace back to a `sources[]` entry. The array may be empty for pure template documents that contain no authoritative claims, but should almost never be empty for methodology, foundations, case-study, or vocabulary documents.

Each source entry must have five sub-fields:
- `author`: the author(s) in citation form.
- `year`: integer year of publication.
- `title`: the title of the work cited.
- `url`: a resolvable URL (DOI, stable archive link, or publisher page). Must pass URL validation.
- `license`: the licence under which the source is used.

A source entry MAY additionally carry:
- `pages`: a free-form string naming the page or page ranges of the source the document draws on (e.g. `"11-13"` or `"24, 27"`). Required whenever the source is a paginated primary document backing substantive claims — see "Page-anchored primary-source citations" in Section 4.

**Zod rule.**
```
z.array(z.object({
  author: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  title: z.string().min(1),
  url: z.string().url(),
  license: z.string().min(1),
  pages: z.string().min(1).optional()
}))
```

**Good example.**
```yaml
sources:
  - author: "Sweller, J."
    year: 1988
    title: "Cognitive Load During Problem Solving: Effects on Learning"
    url: "https://doi.org/10.1207/s15516709cog1202_4"
    license: "fair-use academic citation"
```

**Bad examples.**
```yaml
sources:
  - author: "Sweller, J."
    year: 1988
    title: "Cognitive Load During Problem Solving"
    url: "sweller1988"             # not a valid URL — validation fails

sources:
  - author: ""                     # empty author — min(1) fails
    year: 88                       # two-digit year — min(1900) fails
```

**Why it matters.** The `sources[]` array is the citation contract. Section 4 explains how inline references in the body must map to entries in this array. A claim without a corresponding `sources[]` entry is either improperly cited or unsubstantiated — the latter must be flagged explicitly in the body (see Section 4).

### `license`

**Definition.** The licence under which the document itself is distributed. This is the licence for the corpus document, not for the sources it cites (those are recorded in `sources[].license`).

The licence is determined by BFH/PIONEER policy. Prefer `CC-BY 4.0` or `CC-BY-SA 4.0` for documents that will be redistributed. See Section 5 for guidance.

**Zod rule.** `z.string().min(1)`

**Good examples.**
```yaml
license: "CC-BY 4.0 — BFH/PIONEER"
license: "CC-BY-SA 4.0 — BFH/PIONEER"
```

**Bad example.**
```yaml
license: ""     # empty string — validation fails
```

**Why it matters.** If production corpus documents are served via CDN and downstream tools embed them, the licence must be clear. An empty or absent licence field creates legal ambiguity.

### `updated`

**Definition.** The ISO date `YYYY-MM-DD` of the most recent substantive edit. This field is load-bearing: the index generator reads the `updated` field of every document and sets the index's `generated` value to the maximum `updated` across all documents. This makes change tracking deterministic.

**Zod rule.** `z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD")`

**Good example.**
```yaml
updated: "2026-05-21"
```

**Bad examples.**
```yaml
updated: "21.05.2026"    # European date format — fails regex
updated: "2026-5-21"     # single-digit month — fails regex
```

**Why it matters.** If you edit a document and forget to update this field, the index `generated` timestamp will not reflect the change. Downstream consumers that cache by `generated` date may miss the update.

### `tags`

**Definition.** A free-form array of lowercase strings used for full-text search and retrieval scoping. No controlled vocabulary is enforced; use terms that a lecturer would naturally use when looking for this document.

**Zod rule.** `z.array(z.string())`

**Good example.**
```yaml
tags: [engage, investigate, act, framework, phases, documentation, reflection]
```

**Acceptable but weaker example.**
```yaml
tags: []    # valid schema-wise, but provides no retrieval signal
```

**Convention.** Prefer lowercase, hyphen-separated multi-word tags (`design-thinking`, not `DesignThinking`). Duplicate terms across documents is fine; the retrieval layer uses this for relevance scoring.

### `short-description` (optional)

**Definition.** An optional one-sentence summary of what the document covers, surfaced in retrieval previews and listings. Omit it rather than padding it: a vague or redundant `short-description` is worse than none.

**Zod rule.** `z.string().min(1).optional()`

**Good example.**
```yaml
short-description: "The Engage–Investigate–Act three-phase structure and how each phase hands off to the next."
```

**Convention.** Keep it to a single sentence, written for a lecturer scanning a list of candidate documents. Do not repeat the `title` verbatim, and do not make authoritative claims here — the body, with its `sources[]`, carries claims.

---

## Categories — when to use which

### `methodology`

**Definition.** A methodology document describes a structured process, framework, or approach that practitioners apply when designing or running a CBL experience. It answers the question "how do you do this?" It is procedural and prescriptive in the sense that it articulates steps, phases, or principles that guide action. Claims in methodology documents must be grounded in the primary CBL literature or in peer-reviewed pedagogical research.

**Typical length.** 800–1500 words.

**Examples in the corpus.**
- `methodology-001` (`content/methodology/methodology-001-cbl-three-phase-framework.md`): describes the three-phase Engage–Investigate–Act structure as documented in the CBL Guide 2016 (Nichols, Cator and Torres). Clear phase-by-phase structure, source-grounded.

**A further example might be:** a document describing facilitator moves for the Engage phase, with specific facilitation techniques drawn from empirical practitioner research.

**Anti-example.** A document that is primarily a narrative of how one institution implemented CBL belongs in `case-study`, not `methodology`. The difference: methodology is generalisable guidance; case-study is a specific instance. If a document reports "at this institution, participants did X", it is a case study. If it says "when facilitating the Engage phase, practitioners should do X", it is methodology.

---

### `foundations`

**Definition.** A foundations document establishes the conceptual or theoretical basis for CBL or for a claim the skill makes. It answers the question "why does this work?" or "where does this idea come from?" Foundations documents situate CBL within broader educational theory: experiential learning, constructivism, cognitive load theory, self-determination theory, etc. They are the documents the skill draws on when a lecturer challenges the theoretical basis of CBL.

**Typical length.** 800–1500 words.

**Examples in the corpus.**
- `foundations-002` (`content/foundations/foundations-002-foundational-ideas-design-principles.md`): explains the twelve foundational ideas, records the Guide-backed historical development of the framework, and surfaces structural tensions between the principles. Mechanism-rich, balanced.
- `foundations-001` (`content/foundations/foundations-001-experiential-learning-roots.md`): roots CBL in Dewey, Kolb, and Vygotsky, with clear conceptual lineage.

**Anti-example.** A document that explains cognitive load theory in full, without connecting it to CBL design choices, is a general educational-psychology foundations document — not a corpus document. Include only the theoretical content that has direct bearing on how CBL works or how the tool should behave.

---

### `case-study`

**Definition.** A case-study document is a documented instance of CBL in practice at a specific institution, with specific learners, in a specific domain. It answers the question "how has this been done, and what happened?" Case studies provide evidence of what CBL looks like in practice, what challenges practitioners encountered, and what outcomes were observed. They are descriptive, not prescriptive. Claims about outcomes must cite the source; anecdotal observations must be flagged.

**Typical length.** 1000–2500 words.

**Current corpus state.** The category may contain zero documents while approved best-practice examples are being prepared. Do not create a placeholder: validation, indexing, browsing, and bundling must remain coherent when the category is absent.

**Anti-example.** A case study that begins to generalise from one institution's experience into prescriptive guidance ("this shows that CBL always works best when…") has crossed into methodology territory. The case-study document should report what happened; a separate methodology document can draw prescriptive conclusions from a body of evidence.

---

### `vocabulary`

**Definition.** A vocabulary document defines the precise meaning of a term as used within CBL — particularly terms that are used differently across the broader educational literature or within CBL itself. Vocabulary documents answer the question "what exactly does this term mean here?" They are the documents the skill draws on when a lecturer asks for a definition or when a term could be misunderstood.

**Typical length.** 200–600 words per defined term. A single vocabulary document may contain multiple terms.

**Example in the corpus.**
- `vocabulary-001` (`content/vocabulary/vocabulary-001-cbl-core-vocabulary.md`): defines Big Idea, Essential Question, Challenge Statement, Guiding Questions, and related terms, while flagging where usage is contested (e.g., "meta-skills" vs. "durable skills").

**Anti-example.** A vocabulary document is not a glossary of general educational jargon. Terms like "constructivism" or "formative assessment" do not need their own vocabulary entries unless they are used in a CBL-specific sense that differs from standard usage.

---

### `template`

**Definition.** A template document provides a reusable structural scaffold — a blank or partially filled framework that a lecturer or student can fill in. Templates do not make authoritative claims about CBL; they provide form. Examples: a Challenge Statement template, a Guiding Questions worksheet, a solution documentation scaffold.

**Typical length.** 500–1000 words (mostly structural content, not prose).

**Example.** A document providing a fillable template for the three-phase framework, with prompts for each phase. The frontmatter would have `sources: []` (the template makes no empirical claims); the prompts must still be verified as pedagogically sound before the version that contains the template is released.

**Anti-example.** A template that includes instructional prose explaining why each section matters has drifted into methodology territory. Templates should be lean; if explanatory content is needed, it belongs in a methodology document that the template cross-references.

---

## Citation requirements

### General principle

Every authoritative substantive claim in a corpus document must trace back to a `sources[]` entry in the frontmatter. "Authoritative substantive claim" means any factual assertion that a lecturer might rely on — descriptions of outcomes, characterisations of frameworks, theoretical explanations, quantitative findings.

This is not a formality. The skill will cite corpus documents as sources. If the corpus document makes an ungrounded claim and the skill repeats it, a lecturer may act on false information. Citation discipline in the corpus is the primary mechanism that keeps the skill from hallucinating authoritative-sounding content.

### How corpus documents are cited

When the skill cites a corpus document, it emits a bare citation token of the form:

```
(corpus:<id> § <section>, <author year>)
```

For example, `(corpus:methodology-001 § Investigate, Nichols, M., Cator, K., and Torres, M. 2016)`. The `<author year>` part is drawn from the relevant `sources[]` entry of the cited document. A document that carries no `sources[]` entries (for example, a template) is cited without the author-year tail:

```
(corpus:<id> § <section>)
```

The token is deliberately bare — no surrounding prose, no confidence hedging baked in. This keeps citations machine-checkable and traceable back to a specific document `id` and section, which is the property the next subsections rely on.

### Inline reference styles

Two styles are acceptable. Use one consistently within a document.

**Footnote-style** (numeric references resolved at the end of the document):
```markdown
The three-phase framework organises the CBL experience into Engage, Investigate, and Act phases [1].

## References
[1] Nichols, M., Cator, K., and Torres, M. (2016) Challenge Based Learner User Guide. Redwood City, CA: Digital Promise. https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf
```

**Named-reference style** (author-year inline):
```markdown
Sweller (1988) §3 establishes that problem-solving with high intrinsic load inhibits schema acquisition.
```

Either style is acceptable. The `sources[]` array must contain a corresponding entry regardless of which inline style you use.

### Sources versus References

A corpus document distinguishes two bibliographic lists, and they are not interchangeable:

- **Sources** are the frontmatter `sources[]` entries. They are the citation contract: the works the document's authoritative claims are grounded in and that a citation token may name in its `<author year>` element. Each entry carries its `license`, and a paginated primary source carries its `pages`.
- **References** are the body's `## References` section. It lists the bibliographic details of works the document names or discusses — including every source and any further work the text mentions — in plain citation form. A reference carries **no licence metadata**: no licence annotation, licence field or rights note. The licence of a source is recorded once, in its `sources[]` entry.

A work the document only discusses (for example, a theorist in a lineage) belongs under References, not under Sources. Do not add a `## Further reading` section or any other list of unverified or pending candidate literature: an incomplete list reads as a recommendation the corpus cannot stand behind. Literature still to be verified stays outside the corpus until it is verified and either grounds a claim (Sources) or is named in the text (References).

### Page-anchored primary-source citations

When a document's substantive claims derive from a source that is available as a **paginated primary document** (e.g. the CBL Guide 2016 — Nichols, Cator & Torres, Digital Promise), page-precise anchoring is mandatory, in two places:

1. **Frontmatter:** the corresponding `sources[]` entry carries a `pages` field summarising the pages the document draws on (e.g. `pages: "11-13, 31-43"`).
2. **Body:** each claim backed by the primary document cites its page or page range inline at the claim site, e.g. `(CBL Guide 2016, p. 24)` or `(CBL Guide 2016, pp. 11–13)`.

A paginated primary source in `sources[]` must NOT serve as a blanket citation: a claim the primary document does not back either traces inline to a different `sources[]` entry or is explicitly flagged as a practice observation (next subsection). If you cannot locate a claim in the primary document, do not keep it silently — correct it, re-source it, or flag it.

`pages` is optional schema-wise (web pages and unpaginated sources have no meaningful page anchor) but required by curation policy for paginated primary documents. The reviewer check: pick two or three inline page citations per document and confirm the cited page actually supports the claim.

### Flagging unsubstantiated practice observations

Not all useful content is empirically grounded. Practitioners have observations that are valuable but that have not been published or peer-reviewed. These observations belong in the corpus only if they are clearly flagged.

Use this blockquote convention:

```markdown
> Practice observation, not empirically grounded. In facilitator sessions at BFH, the Engage phase typically runs 2–3 times longer than the framework guide suggests when learners are unfamiliar with open-ended questioning.
```

A flagged practice observation must NOT contribute a `sources[]` entry that implies empirical authority. Do not add the facilitator's name as an author in `sources[]`.

An observation that is presented as fact without either a citation or an explicit flag is a writing error. Curators must reject documents containing unflagged, uncited substantive claims.

### Fabricated citations

Fabricated or hallucinated citations are a hard reject in review. This is not an abstract concern: generative AI tools, if used to assist writing, will sometimes produce plausible-looking but non-existent citations. Do not use AI tools to generate the `sources[]` entries without independently verifying that the source exists and says what the document claims.

**Example of the pattern to watch for:**

*Offending text:*
```markdown
Cognitive overload during the Investigate phase reduces transfer performance by up to 40% (Sweller, 1991).
```
```yaml
sources:
  - author: "Sweller, J."
    year: 1991
    title: "Cognitive Overload and Educational Technology"
    url: "https://doi.org/10.1016/fake.1991.sweller"
    license: "fair-use academic citation"
```

The problems: (1) the 1991 paper does not exist; Sweller's foundational cognitive load work appeared in 1988 and 1994; (2) the DOI is fabricated; (3) the "40%" figure is invented.

*Corrected text:*
```markdown
Cognitive load theory holds that working memory is limited and that instruction design should minimise extraneous load (Sweller, 1988 §3).
```
```yaml
sources:
  - author: "Sweller, J."
    year: 1988
    title: "Cognitive Load During Problem Solving: Effects on Learning"
    url: "https://doi.org/10.1207/s15516709cog1202_4"
    license: "fair-use academic citation"
```

The correction drops the quantitative claim (which was fabricated), anchors the theoretical claim to the correct year and section, and provides a real DOI.

**Reviewer check.** When reviewing, paste each `url` in `sources[]` into a browser and confirm it resolves to a document that matches the `title` and `author` fields. If a URL is a DOI, check https://doi.org directly. If you cannot verify a source, the document should not be approved.

### URL guidance

Prefer permanent identifiers in this order:
1. DOI (`https://doi.org/...`) — the most stable identifier for academic papers.
2. Archive.org stable link — for web resources that may disappear.
3. JSTOR stable URL — for journal articles accessible via JSTOR.
4. Publisher page — acceptable if no DOI or archive copy is available.

If a source has no public URL (e.g., a book without a DOI), note this in the `license` field: `"fair-use academic citation — no public URL"`. Do not invent a URL. A missing URL is far less harmful than a fabricated one.

---

## Licensing — what counts as compatible

### Source licensing

The sources a corpus document cites may be covered by:

- **Creative Commons licences (CC-BY, CC-BY-SA, CC-BY-ND, CC-BY-NC):** Academic papers and reports published under CC licences. CC-BY and CC-BY-SA are the most permissive; CC-ND and CC-NC impose restrictions that matter for redistribution.
- **Fair-use academic citation:** Standard in academic practice. Short quotations and summaries of published works for educational or research purposes. Use this for papers from commercial publishers.
- **MIT, BSD, or public domain:** Primarily for software-adjacent sources, though rarely applicable to educational research documents.
- **Explicit author permission:** If an author has agreed in writing that their unpublished work may appear in the corpus, record this in `license`.

A source whose licence is a problem for redistribution must be removed before the version that contains it is released.

### Document licensing for redistribution

Each corpus document's own `license` must be compatible with how the corpus will be delivered. The key question: will the corpus be served from a public source (e.g. a CDN) accessible by any tool or user? If yes, redistribution is occurring.

**Prefer:**
- **CC-BY 4.0** — attribution required, no other restriction. Redistribution permitted.
- **CC-BY-SA 4.0** — attribution required, derivatives must use the same licence. Redistribution permitted but creates a licence inheritance obligation.
- **Public domain (CC0)** — no restrictions.

**Use with caution:**
- **CC-BY-ND** — no derivatives. If the corpus document synthesises or summarises the source, creating a derivative is the point. ND licences are incompatible with synthesis.
- **CC-BY-NC** — non-commercial. If the corpus is served by a university tool used in fee-paying courses, this may constitute commercial use. Consult BFH's legal team before including CC-NC sources.

**Avoid for redistribution:**
Do not redistribute full PDFs of OECD reports, publisher-owned academic papers, or any document whose licence does not permit redistribution. Cite the source with a DOI for authority; do not host the content.

### Three concrete examples

**DO: cite Sweller (1988) with the JSTOR DOI.**
```yaml
- author: "Sweller, J."
  year: 1988
  title: "Cognitive Load During Problem Solving: Effects on Learning"
  url: "https://doi.org/10.1207/s15516709cog1202_4"
  license: "fair-use academic citation"
```
Citing a journal article for its theoretical content, with a permanent identifier, under standard fair-use. The PDF is not hosted; the corpus document contains a summary and quotations, not a reproduction.

**DON'T: re-host an OECD report PDF on the CDN.**
The OECD publishes reports under specific terms. Hosting a copy of an OECD PDF on a CDN without explicit permission is a licence violation, regardless of whether the content is educational. Cite the report with its DOI and link to the OECD's own distribution page.

**DO: cite the CBL Guide 2016 with its CC BY licence and page anchors.**
```yaml
- author: "Nichols, M., Cator, K., and Torres, M."
  year: 2016
  title: "Challenge Based Learner User Guide"
  url: "https://www.challengebasedlearning.org/wp-content/uploads/2019/02/CBL_Guide2016.pdf"
  license: "CC BY"
  pages: "11-13, 31-43"
```
The guide's copyright page (p. 2) grants a Creative Commons Attribution licence conditioned on this citation form: `Nichols, M., Cator, K., and Torres, M. (2016) Challenge Based Learner User Guide. Redwood City, CA: Digital Promise.` The corpus may quote from it, adapt it, and link to the direct authoritative PDF URL above; verify reachability before the version that cites it is released.

---

## Curation workflow

There is no per-document review state. Quality is assured at two levels: per-edit checks that every document keeps passing, and a per-version sign-off that gates public release. The schema records no review metadata; the record of who signed off a version lives in `CHANGELOG.md` and the version's release process, not in document frontmatter.

### Writing or revising a document

A curator writes a new corpus document or substantially revises an existing one. Before committing:

1. Set `updated` to today's date (`YYYY-MM-DD`). Bump the document's informational `version` if appropriate (Section 2).
2. Run `npm run corpus:validate` locally. This builds the schema package and validates all documents under `corpus/content/`. The command must report `N document(s) valid` with no failures before the commit proceeds.
3. If the index needs updating (e.g., a new document was added or frontmatter changed), run `npm run corpus:index` before staging, then stage the updated `corpus/index.json` alongside the document.
4. Commit. The pre-commit hook will re-run `corpus:validate` automatically. If validation fails, the commit is blocked.

### Per-edit quality checks

Whether reviewing your own work before committing or another curator's pull request, check the following on every changed document:

- Every `url` in `sources[]` resolves to a real document that matches the stated `author`, `year`, and `title`.
- Every authoritative claim in the body has a corresponding `sources[]` entry or is explicitly flagged as a practice observation.
- The body does not contain fabricated or exaggerated statistics.
- Language is non-sycophantic (see Section 7).
- The schema validates (`npm run corpus:validate` passes).

These checks keep `corpus/content/` continuously shippable. They do not, by themselves, make content authoritative — that happens only at version sign-off.

### Per-version sign-off (the release gate)

Authority is granted to a corpus version as a whole, not to individual documents. Before a `corpus-version` is flagged for public release:

1. BFH/PIONEER review the version's contents as a coherent snapshot.
2. The per-edit quality checks above hold for every document in the version.
3. A new `## YYYY-MM` section is added to the top of `CHANGELOG.md` describing what the version contains and noting the BFH/PIONEER sign-off.
4. `npm run corpus:index` is run so `index.json` carries the matching `corpus-version`, and the index is staged.

Once the version is released, every document in it is authoritative for that version. There is no separate per-document approval step and no reviewer field to populate.

### What happens when you open a PR with a new document

A curator creates a new document (e.g., `content/methodology/methodology-013-cbl-assessment-rubrics.md`), stages it, and opens a pull request:

1. Before staging, the curator runs `npm run corpus:index` to regenerate `corpus/index.json` with the new document included. The updated `index.json` is staged alongside the new `.md` file.
2. On `git commit`, the pre-commit hook fires. It detects that files matching `^corpus/.*\.md$` are staged, builds `@cbe/corpus-schema`, and runs `corpus:validate`. If any document under `corpus/content/` fails validation, the commit is blocked.
3. On the PR, the CI workflow (`.github/workflows/corpus-validate.yml`) runs. It installs dependencies (`npm ci`), builds the schema package, runs `corpus:validate`, and additionally checks that `corpus/index.json` is up to date by regenerating the index in a temp directory and diffing against the committed version. If the index is stale, CI fails with the message "index.json out of date — run 'npm run corpus:index' and commit".
4. A reviewer is assigned to the PR. They apply the per-edit quality checks above and either approve or request changes.
5. On merge, the document becomes part of `corpus/content/`. It becomes authoritative only when it ships in a signed-off corpus version.

Note: if you are migrating an existing document to a new path (e.g., renaming a file), use `git mv <old-path> <new-path>` rather than deleting and re-creating, so that git history is preserved.

---

## Writing style guidance for anti-sycophancy

### Why this matters

The corpus is the ground truth the CBE skill draws on. If the corpus is sycophantic — if it uncritically endorses every practice, papers over disagreements, and frames CBL as an obviously superior approach — the skill will reproduce that sycophancy in every answer it gives a lecturer. A lecturer who asks "are there situations where CBL does not work well?" deserves an honest answer. If the corpus contains none, the skill cannot give one.

Write as you would write a peer-reviewed methodology section: precisely, with claims grounded in evidence, with limitations surfaced alongside strengths.

### Six anti-patterns to avoid

**1. Positive framing of examples without evidence.**
Do not write "This is an excellent example of learner agency in action." The corpus is not a praise document. Describe what happened; let the lecturer judge.

**2. Consensus claims stated as universal truths without dissent.**
Statements like "CBL has been shown to improve student motivation universally" suppress the studies that found null or negative results, the contexts where CBL underperforms, and the replication concerns common in educational research. If the evidence is mixed, say so.

**3. Reporting only positive outcomes from cited studies.**
Studies have limitations sections for a reason. If a case study found improved outcomes but also found that the approach required double the preparation time and was rated poorly by students with low autonomy orientation, the corpus document should include those findings.

**4. Using "obvious" or "of course" to imply the reader should already know.**
These phrases are condescending and create pressure to accept claims without scrutiny. Remove them.

**5. Bias confirmation without a source.**
Phrases like "As we know…", "It is well-established that…", and "Research consistently shows…" without a citation are assertions, not evidence. Either attach a source or rephrase as a position: "The CBL framework assumes…" or "The design principle here holds that…".

**6. Marketing-flavoured concluding statements.**
Ending a section with "This makes CBL the natural choice for educators who want to develop 21st-century skills" is marketing copy, not academic guidance. Conclusions should summarise what was shown, not sell a product.

### Worked example

**Sycophantic version:**
> CBL has transformed higher education by empowering learners to take ownership of their education. Research consistently shows that CBL produces better outcomes than traditional instruction, and it is widely regarded as the gold standard for developing durable skills. Of course, when students take genuine ownership, motivation soars and learning becomes authentic. This makes CBL the obvious choice for any institution serious about preparing learners for the 21st century.

**Neutral version:**
> The CBL Guide describes Engage as a progression from a broad Big Idea through Essential Questioning to a concrete, actionable Challenge (Nichols et al., 2016, pp. 31–35). It also advises slowing the process after the Challenge is identified rather than moving immediately to solutions (p. 35).
>
> These claims describe the documented framework. They do not establish comparative learning outcomes, which would require separate evidence.

The neutral version makes specific claims, grounds them in a cited primary source, and states the limit of what that source establishes.

---

## Good and bad examples

### Exemplary documents in the corpus

Two corpus documents illustrate the writing and citation standards every document should meet.

**`content/methodology/methodology-001-cbl-three-phase-framework.md` (`methodology-001`)**

This document is a strong methodology example for several reasons:
- Clean three-part structure (Engage, Investigate, Act) that maps directly to the official framework.
- Each section cites the primary source (Nichols et al., 2016).
- A corpus annotation at the end explicitly flags where the official documentation is silent on a term ("meta-skills"), rather than assuming coverage. This is the correct handling of an absence: document it explicitly so the skill does not fabricate a position the source does not hold.
- No outcome claims that go beyond what the sources support.

**`content/foundations/foundations-002-foundational-ideas-design-principles.md` (`foundations-002`)**

This document is a strong foundations example for several reasons:
- Mechanism-rich: each of the twelve foundational ideas is explained in terms of what design function it serves, not just listed.
- Balanced: Section "Structural Tensions Worth Noting" explicitly surfaces three pairs of foundational ideas that are in creative tension with each other. This is anti-sycophantic — the document does not pretend the framework is internally coherent on every dimension.
- The corpus annotation at the end flags the gap between the official framework's implicit meta-skills orientation and the explicit meta-skills focus the CBE tool requires. This is the correct handling of a scope gap.

### Inline bad example — do not create this as a corpus document

The following is an annotated example of writing that would be rejected in review. It is included here so curators can pattern-match against it.

```markdown
---
id: foundations-meta-skills
title: "Meta-Skills in CBL: The Research Evidence"
category: foundations
version: "0.1.0"
sources:
  - author: "Sweller, J."
    year: 1991                         # BAD: no Sweller 1991 paper; foundational work was 1988 and 1994
    title: "Cognitive Overload and Meta-Cognitive Skill Development"
    url: "https://doi.org/10.1016/fake.1991.sweller"  # BAD: fabricated DOI — reviewer check would catch this
    license: "fair-use academic citation"
  - author: "Johnson, R. T. & Johnson, D. W."
    year: 2015
    title: "CBL and Meta-Skills: A Systematic Review"
    url: "https://www.cbl-meta-skills-review.edu/2015"  # BAD: URL does not exist
    license: "fair-use academic citation"
license: "CC-BY 4.0 — BFH/PIONEER"
updated: "2026-05-21"
tags: [meta-skills, cognitive-load, systematic-review]
---

# Meta-Skills in CBL: The Research Evidence

CBL is clearly the best framework for developing meta-cognitive skills in higher education.  # BAD: no citation; "clearly" = bias confirmation; "best" = marketing

As we know, students who engage in CBL consistently outperform peers in traditional courses  # BAD: "as we know" + no source
on all measures of self-regulation and metacognition. Research shows a 35% improvement     # BAD: invented statistic; no source
in meta-cognitive awareness after one semester of CBL (Sweller, 1991).                     # BAD: cites the fabricated source above

CBL also naturally builds collaborative meta-skills — this is obvious from the framework.  # BAD: "obvious" — no source; "naturally" — no mechanism given

Of course, any institution that adopts CBL will see improvements in learner autonomy.      # BAD: "of course" + unsupported universal claim
```

What this example gets wrong, annotation by annotation:

- Sweller's 1991 paper does not exist. The DOI is fabricated. Pasting it into https://doi.org returns an error.
- The "35% improvement" statistic has no source; it is invented.
- "As we know", "clearly", "naturally", "of course" are all sycophantic framing without evidentiary support.
- "Best framework" is marketing language, not a finding.

A reviewer who pastes each URL into a browser would catch the fabricated sources in under five minutes.

---

## Build and CI flow

### `npm run corpus:validate`

**What it does.** Reads every `.md` file under `corpus/content/` recursively, parses the YAML frontmatter using `gray-matter`, and validates the parsed object against the Zod schema in `packages/corpus-schema/src/schema.ts`. For each file, it prints either `OK   <path>` or `FAIL <path>` followed by the validation errors. At the end, it prints the total count (`N document(s) valid`) or exits with a non-zero code if any file failed.

**When it runs.**
- Locally: run manually before committing whenever you change frontmatter.
- Pre-commit: the `.husky/pre-commit` hook runs it automatically when any `.md` file under `corpus/` is staged.
- CI: the `corpus-validate` workflow runs it on every push to `main` and on every pull request that touches files under `corpus/**` or `packages/corpus-schema/**`.

**To run locally:**
```bash
npm run corpus:validate
```

Expected output for the current corpus:
```
OK   corpus/content/foundations/foundations-001-experiential-learning-roots.md
OK   corpus/content/foundations/foundations-002-foundational-ideas-design-principles.md
OK   corpus/content/foundations/foundations-003-implementation-scales.md
OK   corpus/content/methodology/methodology-001-cbl-three-phase-framework.md
OK   corpus/content/vocabulary/vocabulary-001-cbl-core-vocabulary.md
...

14 document(s) valid
```

### `npm run corpus:index`

**What it does.** Reads every valid document under `corpus/content/`, extracts the frontmatter fields used in the index (`id`, `title`, `category`, `path`, `tags`, optional `short-description`), sorts the documents deterministically, and writes `corpus/index.json`. It also reads `corpus/CHANGELOG.md`, takes the newest `## YYYY-MM` heading, and writes it into the index as `corpus-version`. The index's `generated` field is set to the maximum `updated` value across all documents — this is deterministic: the same content plus the same changelog always produces the same index.

**Path resolution.** Every `path` written to the index is corpus-root-relative — e.g. `content/methodology/methodology-001-cbl-three-phase-framework.md`, never `corpus/content/...`. Consumers join the path against the corpus root (the directory holding `index.json`). Do not hand-edit paths to include a leading `corpus/`.

**When to run.** After any change that touches frontmatter: adding a new document, changing an `id`, `title`, `category`, `tags`, `short-description`, or `updated` field. Also after adding a new `## YYYY-MM` section to `CHANGELOG.md`, so the index's `corpus-version` reflects the new version. If you edit only the body of an existing document without changing frontmatter, the index does not need regeneration (though bumping `updated` is good practice and will require a regeneration).

**Why the determinism matters.** Downstream consumers and CI can diff the index against a freshly generated copy to detect staleness. The CI workflow does exactly this (see below). A non-deterministic index would cause spurious CI failures.

**To run locally:**
```bash
npm run corpus:index
```

Then stage the updated `corpus/index.json` alongside your document changes.

### The pre-commit hook (`.husky/pre-commit`)

The hook inspects `git diff --cached --name-only --diff-filter=ACM` for files matching `^corpus/.*\.md$`. If any such file is staged, the hook:

1. Builds `@cbe/corpus-schema` (`npm run --silent build --workspace @cbe/corpus-schema`).
2. Runs `npm run --silent corpus:validate`.

If validation fails, the commit is blocked and the failure message is printed. The `|| true` guard on the `grep` command ensures that a commit with no corpus changes (empty grep match) does not trigger a false failure.

The hook does NOT validate `corpus/CURATION_GUIDELINES.md` or `corpus/CHANGELOG.md` because the validator targets `corpus/content/` only — both files sit at the corpus root, outside that scope. The hook fires (because the file path matches `^corpus/.*\.md$`), builds and runs the validator, and the validator finds the content documents valid and exits cleanly.

### The CI workflow (`.github/workflows/corpus-validate.yml`)

**Triggers.** Pushes to `main`; pull requests that touch `corpus/**`, `packages/corpus-schema/**`, or the workflow file itself.

**Steps.**
1. Checkout the repository.
2. Set up Node.js 22 with the npm cache.
3. `npm ci` — install dependencies from `package-lock.json`.
4. Build `@cbe/corpus-schema`.
5. `npm run corpus:validate` — validate all corpus documents.
6. Verify `index.json` is up to date: regenerate the index to a temp file (`$RUNNER_TEMP/index.tmp.json`) and diff against `corpus/index.json`. If they differ, CI fails with "index.json out of date — run 'npm run corpus:index' and commit".

**What it gates.** No PR can be merged to `main` with an invalid corpus document or a stale index. Both conditions must be clean.

### Lockfile guidance

Regenerate `package-lock.json` only if you have changed `package.json` or installed a new dependency. Committing a lockfile change alongside a corpus content change creates a confusing diff and may introduce unintended dependency updates. If you have not changed any `package.json`, leave `package-lock.json` alone.

---

## Delivery — the swappable source provider

### One corpus, swappable delivery

The corpus is delivered to the app through a swappable source provider. The provider is an implementation detail of where the bytes come from; the versioning logic is identical regardless of provider:

- **Bundled (shipped fallback).** The corpus ships inside the app and is what a fresh install runs on. The app reads `index.json`, takes `corpus-version`, and resolves each document by joining its corpus-root-relative `path` against the bundled corpus root.
- **Portal (production).** The same `index.json` and the same `content/` tree are served from the project portal's keyed delivery channel as a versioned bundle. The app fetches the version pointer, verifies the bundle, reads `corpus-version`, and resolves paths the same way. Channel contract, publishing steps and key rotation: `docs/delivery-channel.md`.

Because the index shape, the `corpus-version` semantics, and the path-resolution rules are the same in both cases, switching providers requires no change to the skill, the agent harness, or the citation tokens — only a change to where bytes are fetched from.

### Integrity binding for remote delivery

A remote provider (the portal channel) must verify content integrity bound to its version before trusting the corpus. The version a consumer trusts (`corpus-version`) and the bytes it actually fetched must be checked against each other — a mismatch (e.g. a stale or tampered `content/` tree served alongside a newer index) must be rejected rather than served. The bundled provider is trusted by construction; the remote provider is not, so it carries this verification burden.

### Checklist for cutting a corpus version

When preparing a `corpus-version` for release:

- [ ] Every document in the version passes the per-edit quality checks (Section 6).
- [ ] A new `## YYYY-MM` section is at the top of `CHANGELOG.md`, describing the version and noting BFH/PIONEER sign-off.
- [ ] `updated` on every changed document reflects its final edit date.
- [ ] `license` on every document reflects BFH/PIONEER policy.
- [ ] All `sources[]` URLs have been verified.
- [ ] `npm run corpus:validate` passes.
- [ ] `npm run corpus:index` has been run, `index.json` carries the new `corpus-version`, and it is staged.
