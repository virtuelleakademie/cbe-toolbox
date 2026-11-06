# Closed testing — installing a CBE Toolbox release build

These builds are release candidates for the authenticated testing circle and
for the public download surface. The macOS build is signed with an Apple
Developer ID and notarized by Apple, so it opens without the historical
quarantine-removal command. Windows remains unsigned: Edge may block the
download and SmartScreen may warn before the first run (see section 3). Linux
remains an unsigned AppImage by design. Verify every downloaded installer
against the published checksum before running it.

## 1. Download

Open the latest **pre-release** under the repository's
[Releases](../../releases) page and download:

- macOS (Apple Silicon only, `arm64`): `CBE-Toolbox-<version>-arm64.dmg` — the
  `.zip` beside it exists only if a browser or IT policy blocks disk images
- Windows: `CBE-Toolbox-<version>-<arch>.exe`
- Linux: `CBE-Toolbox-<version>-<arch>.AppImage`
- `SHA256SUMS.txt`

## 2. Verify integrity (recommended)

Compare the hash of your download against `SHA256SUMS.txt`:

- **macOS / Linux:** `shasum -a 256 CBE-Toolbox-*.dmg`
- **Windows (PowerShell):** `Get-FileHash CBE-Toolbox-*.exe -Algorithm SHA256`

The printed hash must match the line for that file in `SHA256SUMS.txt`. If it
does not, delete the download — do not run it.

## 3. Install and handle platform warnings

### macOS — signed and notarized

The macOS build is Apple Silicon only (arm64). The `.dmg` is the normal route;
use the `.zip` only if a browser or IT policy blocks disk images.

1. Open the `.dmg` and drag **CBE Toolbox** into **Applications**.
2. Launch it from Applications. The app is signed and notarized, so no Terminal
   command or Gatekeeper bypass is required.

### Windows — SmartScreen

**The download itself may be blocked by Edge.** In Edge's download menu click
**...** on the blocked entry, then **Keep** → **Show more** → **Keep anyway**.
Alternatively, download the file with Firefox, which does not object.

**Method 1 — Unblock the file (preferred):**

1. Right-click the downloaded `.exe` (on Windows 11 choose **Show more options**
   first) and open **Properties**.
2. At the bottom of the **General** tab, a **Security** note says the file
   "came from another computer and might be blocked".
3. Tick **Unblock**, click **OK**, then run the file.

**Method 2 — SmartScreen override:** if the **Unblock** checkbox is not there,
run the file anyway. On the "Windows protected your PC" dialog click
**More info**, then **Run anyway** (bottom right). If **Run anyway** does not
appear, click **Don't run** and try Method 1 again.

The installer then asks whether to install for the current user only or for
anyone who uses this computer. Both work; **installing for the current user
only is fully sufficient and needs no administrator rights** — prefer it.

The first launch after installation can take a while (10–30 seconds). That is
normal.

If neither method works and the **Unblock** checkbox never appears, access is
most likely restricted by your organization's policy. That cannot be resolved
during the test phase; for the main rollout, information for IT departments to
vet and roll out the toolbox will be provided.

### Linux — AppImage

Linux builds are distributed as an unsigned AppImage (by design — verify the
SHA256 instead). Make it executable, then run it:

```
chmod +x CBE-Toolbox-*.AppImage
./CBE-Toolbox-*.AppImage
```

## 4. Connect a model provider

Public builds from v0.1.18 onward contain no default LLM API key. A fresh installation shows the existing one-time provider setup; use connection details supplied by your institution or your own approved OpenAI-compatible provider.

An update preserves the existing local provider configuration and encrypted key unchanged. A machine that previously ran v0.1.17 may therefore retain the credential stored by that installation until the provider owner separately revokes it. v0.1.18 does not erase or migrate the record because it cannot reliably distinguish an earlier bundled credential from one entered by the lecturer.

## Notes

- These builds are temporary — pre-releases stay until they are removed.
- Report issues against the build version the app shows: open the settings
  overlay from the gear at the top right of the window and select the
  information group — the read-only one listing what is installed. Its
  app-version row is the one to quote; the skill-version row beside it is the
  CBE skill's own version, not the app's.
