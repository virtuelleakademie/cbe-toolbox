import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Installer extensions whose SHA256 we publish alongside the artifacts.
const DISTRIBUTABLE_EXT = new Set([".dmg", ".zip", ".exe", ".appimage"]);

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function isDistributable(fileName) {
  return DISTRIBUTABLE_EXT.has(path.extname(fileName).toLowerCase());
}

// entries: Array<{ name: string, sha256: string }>
// Mirrors the `sha256sum` text format (`<hash>  <name>`), sorted by name for
// reproducible output across platforms.
export function formatChecksumFile(entries) {
  return (
    [...entries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.sha256}  ${e.name}`)
      .join("\n") + "\n"
  );
}

async function main() {
  const dir = process.argv[2] ?? "release";
  const names = await readdir(dir);
  const entries = [];
  for (const name of names) {
    if (!isDistributable(name)) continue;
    const full = path.join(dir, name);
    if (!(await stat(full)).isFile()) continue;
    entries.push({ name, sha256: sha256Hex(await readFile(full)) });
  }
  const out = formatChecksumFile(entries);
  await writeFile(path.join(dir, "SHA256SUMS.txt"), out);
  process.stdout.write(out);
}

// Run as CLI only when invoked directly (not when imported by tests).
// Compare real filesystem paths — string-building `file://` + argv breaks on
// paths with spaces/special chars (import.meta.url percent-encodes them).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
