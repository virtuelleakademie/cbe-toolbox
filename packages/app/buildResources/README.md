# Build resources

electron-builder reads packaging inputs from this directory
(`build.directories.buildResources` in `package.json`).

## Application icon

The sole artwork source is the approved package-owned
`packages/app/icon-source/cbe-toolbox-icon.svg`; its organization-level provenance,
authorized use and exact SHA256 are recorded in
`packages/app/icon-source/provenance.json`. Do not edit,
redraw or replace generated files by hand.

```sh
npm run icons:generate --workspace packages/app
npm run icons:check --workspace packages/app
```

Generation uses the exact pinned `sharp` build-time dependency and writes the
committed macOS `icon.icns`, Windows `icon.ico`, runtime `icon.png`, Linux size
set under `icons/`, and `icon-manifest.json`. The check validates source intake,
formats and dimensions, regenerates outside the checkout, and compares every
byte without rewriting this directory. A changed source requires a separately
approved master before regeneration.

`packages/app/package.json` names these resources explicitly for the current
macOS DMG/ZIP, Windows NSIS and Linux AppImage targets. The runtime window,
development Dock and in-app About identity reuse the generated PNG.

## Code signing

An icon provides visual identity only. The protected macOS release job supplies
the Developer ID identity and notarization key out-of-band; nothing confidential
is committed here. `entitlements.mac.plist` and
`entitlements.mac.inherit.plist` deliberately grant only Electron's required V8
JIT exception. Do not add a Hardened Runtime entitlement without a concrete app
capability and a signed-build verification proving it is necessary. Windows
publisher signing remains separate outstanding work. See
`docs/build-and-release.md` and `.github/workflows/build.yml`.
