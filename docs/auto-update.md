# Auto-update — design findings and setup

Status: implemented against the interim update channel (Cloudflare worker
proxy). Spec: `distribution`, Requirement: Auto-update mechanism.

## Design spike: private repo + electron-updater

The obvious provider (`electron-updater`'s GitHub provider) does NOT work for
this project: the repository is **private**, so the updater would need a GitHub
token inside every installed app copy — a published credential. Rejected.

The chosen path is the **generic provider** against the Cloudflare Pages worker
that already proxies GitHub release assets for the tester build channel
(`plan/_worker.js`):

- electron-builder embeds `app-update.yml` with
  `https://cbe-stories.pages.dev/update` as the feed URL (see `build.publish`
  in `packages/app/package.json`).
- At runtime `electron-updater` requests `latest-mac.yml` / `latest.yml` /
  `latest-linux.yml` from that base URL, compares versions, then downloads the
  named installer artifact (zip / exe / AppImage, plus `.blockmap` for
  differential updates) from the same base.
- The worker's `/update/<filename>` route resolves the filename against the
  assets of the newest non-draft GitHub release and streams it — the same
  mechanism as `/builds/download/…`, addressed by name instead of asset id.
- CI attaches the `latest*.yml` and `*.blockmap` files to each release
  (`.github/workflows/build.yml`), which is all the generic provider needs.

**Auth trade-off (user decision, reversible):** `electron-updater` cannot
answer an interactive Basic Auth prompt, and baking the portal credentials into
the app would publish them. `/update/*` is therefore served **without** Basic
Auth, restricted to an allowlist (`latest*.yml`, `*.zip`, `*.exe`, `*.dmg`,
`*.AppImage`, `*.blockmap`). Consequence: anyone who knows the URL can download
the current installer (not the stories/reports — those stay gated). If that is
not acceptable, remove the `/update/` branch in `plan/_worker.js` and redeploy;
the app then reports "update check failed" and keeps working.

## Platform caveats

- **macOS requires a signed app for auto-update.** Squirrel.Mac validates the
  code signature before installing. `v0.1.16` and older test builds remain
  unsigned, so their download step fails with a non-blocking error note. The
  release pipeline now signs and notarizes every later macOS build before it can
  be uploaded; auto-update therefore becomes functional from the first release
  produced by that pipeline, with no updater code change.
- **Windows (NSIS)** and **Linux (AppImage)** auto-update work unsigned.

## UX contract (spec scenarios)

- Update found → non-blocking banner with the version number, a changelog link
  (the portal build page), and the options **Install now / Later / Skip** —
  Scenario: Update notice on a new version.
- **Later** dismisses the banner for this run; **Skip** persists the version
  (`<userData>/update-prefs.json`) so the same version is not offered again;
  nothing is ever forced or blocked — Scenario: User can decline updates.
- Install now → download; when downloaded, the banner offers
  **Restart and install** (or Later — installs on next quit).
- In dev (`!app.isPackaged`) the updater is inert.
