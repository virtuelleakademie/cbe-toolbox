/**
 * Tests for the slash-command filter + match helpers (capability `desktop-app`,
 * Requirement: Slash Commands via Pi-First Architecture). The main process uses
 * `filterUiCommands` before commands cross IPC; the composer uses `matchCommands`
 * for the `/`-prefix autocomplete.
 */
import { describe, it, expect } from "vitest";
import { filterUiCommands, matchCommands, PI_BUILTIN_ALLOWLIST } from "../src/shared/slash-commands.js";
import type { SlashCommand } from "../src/shared/ipc-contract.js";

const cmds: SlashCommand[] = [
  { name: "compact", source: "prompt" },
  { name: "new", source: "prompt" },
  { name: "session", source: "prompt" },
  { name: "settings", source: "prompt" }, // CLI-only — must be dropped
  { name: "quit", source: "prompt" }, // CLI-only — must be dropped
  { name: "mode", source: "extension", description: "Switch mode" },
  { name: "cite", source: "extension", description: "Cite a corpus doc" },
];

describe("filterUiCommands", () => {
  it("keeps allowlisted pi built-ins plus all extension commands", () => {
    const out = filterUiCommands(cmds)
      .map((c) => c.name)
      .sort();
    expect(out).toEqual(["cite", "compact", "mode", "new", "session"]);
  });

  it("drops CLI-only built-ins (settings, quit, …) not in the allowlist", () => {
    const names = filterUiCommands(cmds).map((c) => c.name);
    expect(names).not.toContain("settings");
    expect(names).not.toContain("quit");
  });

  it("keeps an extension command even if its name is not in the built-in allowlist", () => {
    expect(filterUiCommands([{ name: "mode", source: "extension" }])).toHaveLength(1);
    expect(PI_BUILTIN_ALLOWLIST).not.toContain("mode" as never);
  });
});

describe("matchCommands", () => {
  const list: SlashCommand[] = [
    { name: "compact", source: "prompt" },
    { name: "cite", source: "extension" },
    { name: "mode", source: "extension" },
  ];

  it("returns all commands for an empty query", () => {
    expect(matchCommands(list, "").map((c) => c.name)).toEqual(["compact", "cite", "mode"]);
  });

  it("prefix-matches case-insensitively", () => {
    expect(matchCommands(list, "c").map((c) => c.name)).toEqual(["compact", "cite"]);
    expect(matchCommands(list, "MO").map((c) => c.name)).toEqual(["mode"]);
  });

  it("ranks prefix matches above substring matches", () => {
    // "ode" is a substring of "mode"; "co"/"ci" prefix nothing here, so only mode matches.
    expect(matchCommands(list, "ode").map((c) => c.name)).toEqual(["mode"]);
  });
});
