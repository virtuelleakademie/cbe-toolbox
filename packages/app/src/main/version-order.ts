/**
 * Version ordering for the delivery channels (capability `distribution`).
 *
 * Both bundle channels adopt a remote bundle only when the pointer advertises
 * a version *newer* than the local state (Scenarios: App fetches a new corpus
 * version on startup / Newer skill version is adopted for new sessions). A
 * bare inequality check would also adopt an OLDER pointer — a portal whose
 * publish step lags an app release would then permanently downgrade every
 * installation to the stale bundle and report that version as the truth. The
 * comparison therefore needs a real ordering, and each channel versions its
 * content differently: the skill carries a semver frontmatter version, the
 * corpus a zero-padded date-style `YYYY-MM`.
 *
 * Both comparators return the usual sign convention: > 0 when `a` is newer
 * than `b`, < 0 when older, 0 when the two are equal.
 */

/** Ordering for the corpus channel's zero-padded date-style versions
 * (`2026-07` < `2026-08` < `2026-10`), where lexical order IS chronological. */
export function compareLexicalVersions(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function comparePreRelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  // A version WITHOUT a pre-release outranks the same core WITH one.
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
      continue;
    }
    // Numeric identifiers always rank below alphanumeric ones.
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Ordering for the skill channel's semver versions (`0.9.0` < `0.10.0`, which
 * a lexical comparison gets wrong). A version either side cannot parse as
 * semver falls back to the lexical ordering — still a total order, so an
 * unparseable version can never be adopted as a silent downgrade.
 */
export function compareSemverVersions(a: string, b: string): number {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) return compareLexicalVersions(a, b);
  for (let i = 1; i <= 3; i += 1) {
    const l = Number(left[i]);
    const r = Number(right[i]);
    if (l !== r) return l < r ? -1 : 1;
  }
  return comparePreRelease(left[4], right[4]);
}
