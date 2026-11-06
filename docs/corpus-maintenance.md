# Corpus maintenance — tooling guide

How to change, validate, version and publish the PIONEER corpus. Audience:
corpus maintainers working under BFH/PIONEER content authority. The editorial rules
— what belongs in the corpus, citation rigour, category definitions, review
flow — live in `corpus/CURATION_GUIDELINES.md`; this guide covers the tooling.

## Layout

```
corpus/
  content/<category>/<slug>.md   the atoms (YAML frontmatter + Markdown body)
  index.json                     generated manifest — never edit by hand
  CHANGELOG.md                   corpus versions (## YYYY-MM sections)
  CURATION_GUIDELINES.md         editorial rules
```

All tooling is the `cbe-corpus` CLI in `packages/corpus-schema` (build it once
with `npm run build --workspace packages/corpus-schema`); the root package.json
wires the standard invocations as npm scripts.

## The edit cycle

1. **Edit or add atoms** under `corpus/content/<category>/`. Frontmatter must
   satisfy the schema (`packages/corpus-schema/src/schema.ts`): kebab-case
   `id`, `title`, `category`, semver `version`, `sources[]` (author, year,
   title, url, license, optional `pages` anchors), `license`, ISO `updated`,
   `tags`, optional `short-description` (≤ 200 chars).

2. **Validate** — schema check over every atom:

   ```sh
   npm run corpus:validate
   ```

   The pre-commit hook (`.husky/pre-commit`) runs the same validator
   automatically whenever a staged change touches `corpus/**/*.md` — an
   invalid atom cannot be committed. This is the corpus linting path.

3. **Cut a version** (when the content change should become current): add a
   new `## YYYY-MM` section at the top of `corpus/CHANGELOG.md` describing the
   change. The index generator derives `corpus-version` from the newest
   heading.

4. **Regenerate the index** — never edit `index.json` by hand:

   ```sh
   npm run corpus:index
   ```

5. **Commit** atoms + `CHANGELOG.md` + `index.json` together. Example commits
   from the history (German, conventional-commit prefix):
   - `feat(corpus): methodology-012 PIONEER Zehn-Schritte-Design-Flow (§4.6)`
   - `feat(corpus): Release-Mechanik 2026-07 — Seitenanker-Richtlinie, CHANGELOG-Eintrag, Index regeneriert`
   - `fix(corpus): Quellen-Reihenfolge in methodology-001 beibehalten`

## Publishing a corpus version

Two build-time artifacts are generated from the same `corpus/` tree:

- **Versioned download bundle** (what the app consumes for corpus refresh):

  ```sh
  npm run corpus:bundle    # → plan/corpus-dist/v<version>.zip + latest.json
  ```

  Produces a reproducible `v<corpus-version>.zip` (index.json + content tree)
  plus a `latest.json` pointer carrying version, SHA256 and size. The command
  refuses to bundle a corpus that fails validation. The app checks the pointer
  at startup and via the refresh control in the settings overlay's corpus
  group, verifies the SHA256
  and swaps the corpus in place — no app release needed. This unsigned bundle
  feeds only the legacy keyed route (`/delivery/corpus/…`) during the
  historical-client migration window; signed-capable builds consume the signed
  `/delivery/v2/corpus/…` channel, produced with `npm run content:bundle` and
  published by the protected workflow (`docs/delivery-channel.md`).

- **Browse view** (the public proof of what the app knows):

  ```sh
  npm run corpus:browse    # → plan/corpus/*.html
  ```

  One static page per atom (title, body, frontmatter, clickable `sources[]`
  links) plus a category-grouped index. Deployed as part of the stories portal
  behind its Basic Auth gate, permanently: the browse view is for named
  stakeholders, and the earlier promise that the gate would drop once a corpus
  version was flagged for public release was withdrawn on 2026-08-26. The page's
  own subtitle still reads "preview, not yet public" — it is emitted by
  `packages/corpus-schema/src/browse-gen.ts` and correcting it is a code change,
  tracked as a Phase 4 item.

After regenerating either artifact into `plan/`, deploy the portal. The wrapper
mirrors the live signed content-pack channels into `plan/` first and refuses to
deploy if that mirror fails (`docs/delivery-channel.md` § _Persistence of the
signed tree_):

```sh
npm run plan:deploy
```

## Tests

The tooling is covered by `packages/corpus-schema/tests/` (schema, validator,
index generator, bundle reproducibility + integrity, browse-view rendering):

```sh
npm test --workspace packages/corpus-schema
```
