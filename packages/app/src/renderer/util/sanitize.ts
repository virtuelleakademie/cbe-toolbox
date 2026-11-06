/**
 * Provider Configuration Input Hygiene — see desktop-app/spec.md.
 *
 * Trims whitespace and strips surrounding quote pairs from a single config field
 * before it is persisted via `setConfig`. Mismatched quotes are left alone.
 *
 * Applied on save, never on every keystroke — keeps the input editable while typing.
 */
export function sanitiseProviderField(s: string): string {
  let v = s.trim();
  for (const q of ['"', "'", "`"]) {
    if (v.length >= 2 && v.startsWith(q) && v.endsWith(q)) {
      v = v.slice(1, -1).trim();
    }
  }
  return v;
}
