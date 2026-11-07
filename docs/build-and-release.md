# Build & release guide

How a CBE Toolbox build becomes a release. Audience: canonical release
maintainers. Downstream source snapshots support local unsigned packaging only.

## Local development

```sh
npm install        # once
npm run dev        # Electron app in dev mode (renderer hot-reloads)
npm run build                              # build all workspaces (required before packaging)
npm test                                   # full suite — must be green before any release
npm run icons:check --workspace packages/app  # generated branding is byte-fresh
npm run docs:check                          # Markdown, parity, sources, evidence and committed assets
npm run docs:screenshots:check              # canonical Linux/Xvfb lane for screenshot updates
```

Line endings: the root `.gitattributes` (`* text=auto eol=lf`) keeps every
text file LF on checkout, including under the Git for Windows default
`core.autocrlf=true`; committed binaries and the approved icon master are
`-text` and stay byte-exact. Scripts, tests and pinned hashes depend on those
LF bytes. `packages/app/tests/line-ending-checkout.test.ts` holds the guarantee.

Note: the app's main process consumes `@cbe/pi-bridge` and
`@cbe/corpus-schema` from their built `dist/` — after changing those packages,
rebuild and restart dev so the app does not keep stale workspace output in memory.

## Local packaging (unsigned)

```sh
npm run dist:mac --workspace packages/app     # dmg + zip (current arch)
npm run dist:win --workspace packages/app     # nsis installer
npm run dist:linux --workspace packages/app   # AppImage
npm run checksums --workspace packages/app    # SHA256SUMS.txt over release/
```

Output lands in `packages/app/release/`. Branding is generated only from the
approved `packages/app/icon-source/cbe-toolbox-icon.svg` and its package-owned
provenance/use record:

```sh
npm run icons:generate --workspace packages/app  # after a separately approved source revision
npm run icons:check --workspace packages/app     # intake, formats, inventory and byte freshness
```

The generated, committed macOS ICNS, Windows ICO, Linux PNG set and runtime PNG
live under `packages/app/buildResources/`; `packages/app/package.json` names them
for every current target. Never hand-convert or edit a platform variant.

## Windows: package natively, verify on Linux

The full test suite is a Linux gate. It assumes POSIX file semantics (file
modes and permissions, symbolic links, `/` path separators, locale-dependent
output) and is not a supported native Windows workload; under WSL it runs from
the Linux filesystem, not from `/mnt/c`. Native Windows proves compilation,
NSIS packaging and the installer checksum. Both halves use the identical
commit and `package-lock.json`, and their records (commit SHA, lockfile
SHA-256, Node/npm versions, installer SHA-256) must agree. The release
pipeline below is built exactly that way: `test` runs `npm test` on Linux,
`build-other (windows-latest, win)` runs `npm ci`, the build, `dist:win` and
`checksums` and never the suite. Do not answer a red native Windows `npm test`
by telling anyone to ignore it.

The product defects a native Windows run once exposed are fixed and covered by
host-independent tests in the Linux suite: CRLF checkouts
(`.gitattributes`, `packages/app/tests/line-ending-checkout.test.ts`) and the
read-only-handle flush during content-pack activation
(`packages/app/tests/content-pack-windows-flush.test.ts`).

Institutional IT gets the copy-paste version of this path, including the
clean-VM smoke checks, in the bilingual
[installation guide](user/en/installation-and-local-it.md) and in the source
mirror's generated README (`mirror/templates/README.md`, exported with every
snapshot).

## CI release pipeline

Workflow: `.github/workflows/build.yml`.

1. **Trigger**: push a tag matching `v*` (or run the workflow manually via
   `workflow_dispatch` — a manual run builds every platform and exercises the
   real macOS signing/notarization path, but publishes nothing and leaves no
   downloadable files behind).
2. **Test gate**: the full workspace suite runs on Linux. It includes
   `npm run docs:check`, which checks the Markdown, bilingual parity, current
   owners/evidence, version, screenshot references and committed screenshot
   hashes without pretending that it recaptured pixels. Cross-host PNG byte
   differences do not block installer packaging.
3. **Prepare release** (tag runs only): first checks the release metadata —
   `node packages/app/scripts/release-notes.mjs --tag <tag>` refuses a tag that
   names another version than `packages/app/package.json`, a version without its
   `CHANGELOG.md` section, stale user-documentation sources/screenshots, or a
   portal page still presenting the previous release — then creates the GitHub
   **pre-release** for the tag as a
   **draft**. Its body is that version's `CHANGELOG.md` section followed by
   `docs/closed-testing.md`. Draft
   first, because the portal and the updater feed both serve the newest
   _non-draft_ release — a half-filled release must stay invisible while the
   matrix is still packaging. A re-run adopts the existing release instead of
   creating a second one, and never demotes a published one back to draft.
4. **Platform builds**: the dedicated macOS arm64 job enters the protected
   `release-signing` environment, signs the app and every nested code object,
   notarizes and staples the app, submits the final DMG and ZIP to Apple, staples
   the DMG, then verifies the distributed copies with `codesign`, `spctl`,
   `stapler`, and `notarytool`. Windows x64 (NSIS) and Linux x64 (AppImage) stay
   in a separate unsigned matrix and never receive the Apple environment or its
   secrets. Each platform job attaches its installers plus
   `latest*.yml`/`*.blockmap` update metadata straight to the draft release (no
   artifact store in the path). Its per-platform `SHA256SUMS.txt` stays in the
   build log only — all three share that file name.
5. **Release job**: pulls the installers back off the release, regenerates ONE
   combined `SHA256SUMS.txt` across all platforms, attaches it, and publishes
   the release. If a platform job failed the release stays a draft rather than
   going live incomplete.

### Canonical documentation screenshot lane

Workflow: `.github/workflows/docs-screenshots.yml` (manual
`workflow_dispatch`, Linux/Xvfb). It installs the lockfile dependencies, builds
all workspaces, then runs the strict `npm run docs:screenshots:check` real-app
recapture and byte comparison. A mismatch is reported there with its diagnostic
artifact, but does not control app packaging or publication.

Run this canonical lane and complete human screenshot review before accepting
an update to the committed documentation screenshots. It is not a prerequisite
for every app release when `npm run docs:check` confirms that documentation
source, version, manifest, references and screenshot-owner fingerprints remain
fresh.

### Optional preconfigured LLM connection (controlled builds only)

The packaging toolchain retains an explicit opt-in seam for a separately
controlled build. When an operator supplies `CBE_DEFAULT_LLM_API_KEY` directly
to the packaging process, `packages/app/scripts/default-llm-config.mjs` (run
first by every `dist:*` / `pack:*` script) writes it to the git-ignored
`packages/app/build-defaults/default-llm.json`, bundled as
`resources/defaults/default-llm.json`. Endpoint and model are plain code
defaults in `packages/app/src/main/default-connection.ts` — OpenRouter,
`google/gemma-4-31b-it`, reasoning on at `medium`, context length 131072.

The public GitHub Actions workflow deliberately never maps this variable from a
repository or environment secret. Public tag and manual builds therefore run
the script with the variable absent, remove any stale generated defaults file,
and start a fresh installation unconfigured in the existing one-time
BYO-provider setup. Do not add the variable to `.github/workflows/build.yml`.

On first start a controlled build seeds `cbe-config.json` **only when no record
exists**. An existing configuration — including an encrypted key or a record
whose key was erased — is never touched. This also means a v0.1.17 installation
may retain its locally persisted credential after updating; the credential owner must
revoke that provider key separately if required because current records cannot
reliably distinguish a bundled default from a user-entered credential.

- **Controlled opt-in**: provide the variable through the approved private build
  environment, never through the public release workflow. Rotation needs no
  code change.
- **Default/off-switch**: omit or blank the variable. The script removes any
  stale file, the build succeeds, and the app starts unconfigured.
- Local packaging without the variable behaves the same; `npm run dev` never
  reads the bundled file (it resolves to the repo root, where it does not exist).
- The script prints only whether a key was embedded, never the key.

Testers reach the build through the stories portal
(`https://cbe-stories.pages.dev/build/`), which proxies the newest release's
assets behind Basic Auth. The app's auto-updater reads the same release via
`/update/*` — see `docs/auto-update.md`.

## Cutting a release, step by step

1. `npm test` green on `main`; working tree clean.
2. Bump `packages/app/package.json` `version` — **increment the last digit**
   (`0.1.4` → `0.1.5`), and the `@cbe/app` entry in `package-lock.json` with it.
   A release is not promoted to a minor bump because it happens to carry
   features; only the release owner decides to move a digit further left.
3. Move the `Unreleased` items in `CHANGELOG.md` under a new
   `## [X.Y.Z] — YYYY-MM-DD` heading, leaving `[Unreleased]` in place and empty
   for the next cycle. Account for every lecturer-visible change merged since
   the last tag (`git log vPREV..HEAD`), not only the PRs that wrote an entry.
4. Update the portal's release presentation: the "What's new" card on
   `plan/build/index.html` and the release row on `plan/index.html`, each
   marked `data-release-version="X.Y.Z"`. Leave download links alone — the
   build page reads them from `/builds/latest.json`.
5. Refresh the bilingual [lecturer documentation](user/README.md) to the app
   version without overstating its review status. For the established unsigned
   closed prerelease, a clearly labelled first-review draft may ship in the
   repository; it is not a hosted public documentation site or final editorial
   approval. Run `npm test` and `npm run docs:check`. The metadata test fails
   until package, lockfile, top `CHANGELOG.md` section and both portal markers
   name the same version. Adding `--docs-release` to the release-notes command
   selects the stricter public-release gate, which refuses pending named human
   reviews.
6. Keep release copy aligned with the platform trust boundary: macOS is signed
   and notarized through the protected `release-signing` environment, Windows
   remains unsigned, and Linux remains an unsigned AppImage. For public builds,
   also state that a fresh installation needs BYO-provider setup and that an
   update preserves an existing local provider credential unchanged.
7. Commit (`chore(release): App-Version auf X.Y.Z bumpen`), then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

   **A pushed `v*` tag IS the release trigger — do not tag experimentally.**

8. CI publishes the pre-release; verify the assets and `SHA256SUMS.txt` appear.
9. Deploy the portal so its release notes match the build it now serves (the
   wrapper mirrors the live signed content-pack channels first):

   ```sh
   npm run plan:deploy
   ```

10. For a public (non-test) release, first pass the stricter documentation gate
    (`node packages/app/scripts/release-notes.mjs --tag <tag> --docs-release`),
    then edit the release: uncheck "pre-release" and replace the body using
    `docs/release-notes-template.md`.

## macOS Developer ID signing and notarization

Branding is visual identity only. macOS trust comes from the dedicated
`build-mac` job in `.github/workflows/build.yml`; Windows Authenticode remains
separate outstanding work. The macOS job alone enters the GitHub Actions
environment `release-signing` and reads these environment secrets:

- `MAC_CERTIFICATE_P12_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `APPLE_TEAM_ID`

The P12 must contain exactly one currently valid **Developer ID Application**
identity whose team matches `APPLE_TEAM_ID`. The P8 must be an App Store Connect
API key belonging to the configured issuer. Missing, malformed, expired,
revoked, mismatched, or rejected material is a hard macOS build failure; the
workflow never falls back to an unsigned artifact.

The setup step decodes the P12 and P8 only below `$RUNNER_TEMP` with mode `0600`,
imports the certificate into a random-password temporary keychain, and grants
Apple signing tools non-interactive access. The signed-release electron-builder
configuration enables Hardened Runtime and only Electron's required
`com.apple.security.cs.allow-jit` entitlement for the app and inherited code.
electron-builder 25's own strict-verification switch is disabled because it
renders the invalid `codesign --strict=true`; the workflow instead runs the
valid explicit `codesign --verify --deep --strict --verbose=2` check against
every distributed app copy. electron-builder signs nested code and
notarizes/staples the app before it
creates the DMG and ZIP. The workflow then submits both final artifacts with
`notarytool --wait`, staples the DMG (ZIP files do not support stapling), and
verifies the app in the unpacked output, ZIP, and mounted DMG before hashes or
uploads. Because stapling mutates the DMG, the job removes its now-stale
blockmap/`latest-mac.yml` entry after confirming that the ZIP metadata still
matches; Squirrel.Mac uses that signed ZIP as its update artifact. An `always()`
cleanup step deletes the keychain and every decoded or
extracted temporary file on success, failure, or cancellation.

### Operator contract

- A pushed `v*` tag is publishing intent. The macOS asset cannot reach the draft
  release until Apple has accepted every submission and all local verification
  commands pass.
- `workflow_dispatch` is the mandatory non-publishing proof lane. It runs the
  same protected environment, signing, notarization, stapling, and verification,
  but every release creation/upload/publish step is tag-gated. It deliberately
  leaves no downloadable workflow artifact.
- Environment protection may require an authorized reviewer. Approval is an
  operational prerequisite, not a reason to weaken or move the secrets.
- Keep all six values as environment secrets, never repository variables, files,
  workflow inputs, logs, or committed configuration. Windows/Linux/test jobs do
  not enter the environment and must remain unable to reference them.
- Local `npm run dist:mac --workspace packages/app` remains an unsigned developer
  package. CI alone loads `electron-builder.mac-release.cjs`; do not use that
  release configuration without the protected signing environment.

### Rotation and expiry

Review the Developer ID certificate expiry before each planned release. Rotate
it before expiry by exporting a replacement Developer ID Application identity as
P12, then update `MAC_CERTIFICATE_P12_BASE64` and
`MAC_CERTIFICATE_PASSWORD` together in the `release-signing` environment. Run a
manual workflow proof immediately; keep the previous P12 available only through
the organization's approved credential backup until the replacement is proven,
then revoke/archive it according to Apple policy.

App Store Connect API keys do not have a certificate-style expiry, but Apple can
revoke them and the P8 can be downloaded only once. To rotate, create a new key
with notarization access, securely retain its P8, then update
`APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and (if changed)
`APPLE_API_ISSUER_ID` together. Prove the new key with `workflow_dispatch` before
revoking the old one. `APPLE_TEAM_ID` changes only when the signing identity
moves to another Apple Developer team; rotate the certificate and API-key set as
one operation in that case.

### Failure recovery

- **Waiting for environment approval:** have an authorized reviewer approve the
  `release-signing` deployment. Do not retry with secrets copied to another job.
- **Certificate import/identity/team failure:** replace the P12/password pair or
  correct the team secret, then rerun. No artifact was uploaded.
- **Apple authentication failure:** verify the key id, issuer, P8, team access,
  and App Store Connect agreements; rotate the API key if needed, then rerun.
- **Apple rejects an artifact:** use the submission id from the failed step to
  retrieve Apple's diagnostic log with placeholders, never secret values:

  ```sh
  xcrun notarytool log <submission-id> \
    --key <path-to-AuthKey.p8> \
    --key-id <key-id> \
    --issuer <issuer-id>
  ```

  Correct the signing or bundle finding and rerun the failed workflow. On a tag
  run the GitHub release remains a draft until every platform succeeds; reruns
  adopt that draft and replace their own assets.

- **Stapler, `spctl`, or `codesign` failure after Apple acceptance:** treat it as
  a packaging failure. Do not upload manually; rerun after correcting the
  pipeline so the automated ordering remains intact.

### Post-build verification

After downloading the DMG on macOS, verify the exact distributed artifact:

```sh
xcrun stapler validate CBE-Toolbox-<version>-arm64.dmg
mkdir -p /tmp/cbe-toolbox-verify
hdiutil attach -readonly -nobrowse \
  -mountpoint /tmp/cbe-toolbox-verify CBE-Toolbox-<version>-arm64.dmg
codesign --verify --deep --strict --verbose=2 \
  "/tmp/cbe-toolbox-verify/CBE Toolbox.app"
xcrun stapler validate "/tmp/cbe-toolbox-verify/CBE Toolbox.app"
spctl --assess --type execute --verbose=2 \
  "/tmp/cbe-toolbox-verify/CBE Toolbox.app"
hdiutil detach /tmp/cbe-toolbox-verify
```

Assess the mounted app, not the DMG container: electron-builder deliberately
leaves the disk image itself unsigned, while Apple notarizes and staples that
container and Gatekeeper assesses the signed app inside it. A successful app
assessment reports a notarized Developer ID source. These checks complement,
rather than replace, the published SHA256 manifest.
Windows signing remains outstanding; even a future valid Authenticode/EV
signature names the publisher but cannot promise immediate SmartScreen
reputation.

## Public download channel

Testers download from `/builds/*` behind the portal's sign-in; the **public**
channel is the embeddable download widget a partner hosts on their own site
(`docs/download-widget.md`) — snippet, `WIDGET_KEYS` secret, rotation. It serves
whatever the newest release is, so a `v*` tag reaches the public page with no
further step. Its activation does not wait for code signing.

## Corpus and skill releases

Corpus content and the CBE skill roll out independently of app releases via the
portal's signed content-pack channel — see `docs/corpus-maintenance.md` for
producing a corpus version and `docs/delivery-channel.md` for signing,
publication order, trust provisioning and the legacy delivery-key route. Skill
publication is compatibility-bound to a compiled app/model/tool/Pi contract:
build first, produce the pack with `npm run content:bundle`, and never hand-edit
manifest or pointer fields. For v0.1.23 the committed Skill 0.4.2 pointer remains compatible and must
pass the deterministic compatibility suites before the tag is cut.

## Scope of delivery (handover note)

Included: the app + skill + corpus tooling in this repository, CI build
pipeline, documentation. **Not included** (separate maintenance contract):
hosting after release, bug fixes/maintenance, corpus content maintenance from
public release onwards, LLM API costs, languages other than EN/DE.
