# CBE Toolbox

This repository is a generated source snapshot. It is not the canonical development or release repository.

- The exact source commit and export-policy identity are recorded in `MIRROR_PROVENANCE.json`.
- Direct commits and pull requests in this repository are not accepted as product changes and are never synchronized upstream.
- Official installers remain available from the [CBE Toolbox download page](https://cbe-toolbox.pages.dev/#download).
- Application updates and signed Skill/corpus content continue to use the established canonical delivery services.

The snapshot is the buildable, sanitized source of the CBE Toolbox and the community's entry point for contributions through issues. It is intended for inspection, local development and unsigned local packaging. It contains no canonical release, deployment or publication workflow. Official downloads, application updates, Skill/corpus OTA delivery and release ownership stay with the canonical project.

## Install the application

Download the application from the [official download page](https://cbe-toolbox.pages.dev/#download). Choose the installer for macOS, Windows or Linux, then follow the platform instructions in the [installation guide](https://cbe-toolbox.pages.dev/docs/#en/installation-and-local-it/installation-current-build).

## Build from source

Use Node.js **22.19 or newer** (the `engines` field in `package.json`) and the npm that ships with it. On Linux or macOS:

```sh
git clone https://github.com/virtuelleakademie/cbe-toolbox
cd cbe-toolbox
npm ci
npm run build
npm test
```

The repository's `.gitattributes` keeps every text file LF on checkout, whatever the local Git line-ending setting is, including the Git for Windows default `core.autocrlf=true`. Build scripts, tests and pinned hashes rely on those LF bytes, so no local Git configuration is needed. A working tree checked out before this rule existed keeps its CRLF files until they are checked out again; a fresh clone is the simplest way to get LF.

## Build and verify a Windows installer (institutional IT)

The supported path uses two machines and one exact commit:

| Machine                                            | Proves                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Linux, a Linux VM or WSL                           | the complete code verification: clean install, build and the full test suite |
| Native Windows (build machine)                     | compilation, NSIS packaging and the installer checksum                       |
| A clean Windows VM or device (can be the same box) | installation, start-up and bounded smoke checks of that exact installer      |

The full test suite is not a supported gate on native Windows (see [Why two platforms](#why-two-platforms)). Do not run it there in place of the Linux run, and do not accept red tests from any run. A red test on the supported Linux run is a failure; report it as an issue in this repository.

### 1. Full code verification on Linux, a Linux VM or WSL

Choose the commit to build (normally the head of `main`), paste its full SHA into the first line and use the same SHA on both machines. Under WSL, clone into the Linux filesystem (for example `~/src`), not under `/mnt/c`: the Windows-drive mount brings back the Windows file semantics the suite does not support and is much slower.

```sh
COMMIT=PASTE-THE-FULL-COMMIT-SHA
mkdir -p ~/src && cd ~/src
git clone https://github.com/virtuelleakademie/cbe-toolbox
cd cbe-toolbox
git checkout --detach "$COMMIT"
git rev-parse HEAD
sha256sum package-lock.json
node --version
npm --version
npm ci
npm run build
npm test
```

Every test must pass. `npm run verify:mirror` runs the same lane the release runs for this repository (build, tests, lint and generated-file freshness). The Electron layout tests run only where `xvfb-run` and Electron's system libraries are installed and are skipped otherwise.

### 2. Compile and package on native Windows

Install Git for Windows and Node.js 22.19 or newer (x64). In PowerShell, use the identical commit:

```powershell
$Commit = "PASTE-THE-FULL-COMMIT-SHA"
git clone https://github.com/virtuelleakademie/cbe-toolbox C:\src\cbe-toolbox
cd C:\src\cbe-toolbox
git checkout --detach $Commit
git rev-parse HEAD
(Get-FileHash package-lock.json -Algorithm SHA256).Hash.ToLower()
node --version
npm --version
npm ci
npm run build
Remove-Item Env:CBE_DEFAULT_LLM_API_KEY -ErrorAction SilentlyContinue
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run dist:win --workspace packages/app
npm run checksums --workspace packages/app
Get-Content packages\app\release\SHA256SUMS.txt
```

The installer is written to `packages\app\release\CBE-Toolbox-<version>-x64.exe`, next to `SHA256SUMS.txt`. No signing certificate, Apple or Windows signing credential, release token or default LLM secret is needed: the result is an unsigned installer without a preconfigured model key, so the first start shows the one-time provider setup. Your installer is not expected to be byte-identical to the official release asset; its checksum binds the file you built to the file you install.

### 3. Install and smoke-check on a clean Windows VM or device

1. Copy the EXE and `SHA256SUMS.txt` to a Windows VM or device without a previous CBE Toolbox installation.
2. Verify the checksum: `Get-FileHash .\CBE-Toolbox-*-x64.exe -Algorithm SHA256`. It must match the line for that file in `SHA256SUMS.txt`.
3. Run the installer. A per-user installation needs no administrator rights. Because the installer is unsigned, SmartScreen may warn; choose **More info** → **Run anyway**, or apply your institution's allow-listing.
4. Start CBE Toolbox from the Start menu. The first start shows the one-time provider setup.
5. Enter your institution's endpoint, model ID and key, save, and use the connection test in the same settings group. Send one short chat message and confirm that an answer arrives.
6. Close and restart the app; the saved connection is still there.
7. Optionally uninstall through Windows' installed-apps list and confirm the program is removed.

These checks prove that this installer installs, starts and reaches your model service on Windows. They do not replace the Linux code verification, and the Linux run does not prove the installer.

### 4. Compare the records

Keep one record for the build and compare it across both machines:

| Item                                       | Expected                                                |
| ------------------------------------------ | ------------------------------------------------------- |
| Commit SHA (`git rev-parse HEAD`)          | identical on Linux and Windows                          |
| `package-lock.json` SHA-256                | identical on Linux and Windows                          |
| `sourceCommit` in `MIRROR_PROVENANCE.json` | identical (it follows from the commit)                  |
| Node.js and npm versions                   | 22.19 or newer on both; ideally the same version        |
| Installer SHA-256                          | identical on the build machine and on the target device |

If the commit or the lockfile hash differs, the Linux test result does not cover the installer; rebuild from the matching commit.

### Why two platforms

The canonical release pipeline works the same way: its full test suite runs on Linux, and the native Windows job installs, builds and packages the identical commit and publishes the installer checksum. This repository's own snapshots are validated the same way, and no record claims a native Windows test-suite pass.

The test suite was written for and is run on Linux. On native Windows it used to fail for reasons in the tests' own assumptions rather than in the application: POSIX file modes and permissions, symbolic links, `/` path separators and locale-dependent output. The application defects found while investigating those failures, line endings on checkout and a file flush during Skill/corpus activation, are fixed, and host-independent regression tests for them run in the Linux suite. Native Windows `npm test` is therefore not part of the evidence in either direction: the two green runs above are.

## Application documentation

See the [CBE Toolbox application documentation](https://cbe-toolbox.pages.dev/docs/).

## Issues

Issues opened in this mirror repository are read and triaged. Relevant reports may be handled in canonical development and appear in a later generated snapshot, but not every issue will necessarily be implemented. Direct commits and pull requests remain non-canonical.
