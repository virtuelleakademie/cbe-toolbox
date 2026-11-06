import type { SlashCommand } from "./ipc-contract.js";

/**
 * Slash-command UI allowlist + matching helpers (capability `desktop-app`,
 * Requirement: Slash Commands via Pi-First Architecture).
 *
 * Lives in `shared/` so the main process (filtering pi's raw command list before
 * it crosses IPC) and the renderer (matching the `/`-prefix) use one source of truth.
 */

/** Pi built-ins that make sense in the Electron UI. CLI-specific built-ins
 * (`settings`, `model`, `login`, `hotkeys`, `quit`, …) are excluded because the
 * app has its own UIs for those concerns. */
export const PI_BUILTIN_ALLOWLIST = ["compact", "new", "session"] as const;

/** Filter pi's full command list to what the composer should offer: every
 * app-registered extension command (e.g. `/cite`) PLUS the allowlisted
 * pi built-ins. Everything else (CLI-only built-ins) is dropped. */
export function filterUiCommands(all: SlashCommand[]): SlashCommand[] {
  const allow = new Set<string>(PI_BUILTIN_ALLOWLIST);
  return all.filter((c) => c.source === "extension" || allow.has(c.name));
}

/** Match the `/`-autocomplete query (the text after the slash, before any space)
 * against command names. Prefix matches rank above substring matches; ties keep
 * the source order. Case-insensitive. An empty query returns all commands. */
export function matchCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const prefix: SlashCommand[] = [];
  const substring: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (name.includes(q)) substring.push(c);
  }
  return [...prefix, ...substring];
}
