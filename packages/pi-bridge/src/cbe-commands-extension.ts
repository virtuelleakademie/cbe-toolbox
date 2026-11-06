/**
 * App-authored Pi extension that registers the CBE Toolbox's slash commands —
 * currently `/cite`. See `specs/desktop-app/spec.md`, Requirement *Slash
 * Commands via Pi-First Architecture*.
 *
 * This is the spec's "App-registered extension commands" channel: commands with
 * app-state side effects or app-data lookups (corpus ids) are registered via
 * Pi's native `pi.registerCommand`, NOT intercepted in the renderer. The
 * extension is supplied EXPLICITLY to the resource loader via
 * `extensionFactories` (no disk auto-discovery), which keeps the agent-harness
 * hardening intact (capability `agent-harness`, Requirement: App-Isolated …
 * "Skills and extensions MUST be supplied explicitly via … extensionsOverride").
 *
 * The host stays decoupled from Pi internals: `listCorpusIds` sources `/cite`
 * argument completions from `corpus/index.json`.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

// Host-facing slash-command DTO — the minimal shape the renderer needs to build
// its `/` autocomplete, mapped from pi's `SlashCommandInfo` at the bridge boundary
// so the app never imports pi's internal types. It is a CBE-owned runtime
// contract now; re-exported here for the existing importers.
import type { CbeSlashCommand } from "./runtime/contracts.js";
export type { CbeSlashCommand } from "./runtime/contracts.js";

export interface CbeCommandsConfig {
  /** Supplies the corpus ids for `/cite` argument completion (from corpus/index.json). */
  listCorpusIds: () => string[] | Promise<string[]>;
  /** Internal: startCbeSession injects this to capture a command-enumeration fn
   * (`() => pi.getCommands()`) once the extension is live, so the host can serve
   * the renderer's `agent.getCommands()` RPC. Hosts do not supply it. */
  onReady?: (getCommands: () => CbeSlashCommand[]) => void;
}

export function createCbeCommandsExtension(config: CbeCommandsConfig): ExtensionFactory {
  return (pi) => {
    // /cite <id> — expands to a corpus citation token and forwards it to the model.
    pi.registerCommand("cite", {
      description: "Insert a corpus citation: /cite <id> expands to (corpus:<id>).",
      getArgumentCompletions: async (prefix) => {
        const ids = await config.listCorpusIds();
        const p = prefix.trim().toLowerCase();
        return ids
          .filter((id) => id.toLowerCase().startsWith(p))
          .slice(0, 20)
          .map((id) => ({ value: id, label: `${id} — cite this corpus document` }));
      },
      handler: async (args) => {
        const id = args.trim();
        if (!id) return;
        // Expand to the citation token and send it as the user's turn — pi forwards
        // it to the model. The renderer's citation plugin renders it as a clickable link.
        pi.sendUserMessage(`(corpus:${id})`);
      },
    });

    // Expose a command-enumeration fn to the host so the renderer's `/` autocomplete
    // can list pi built-ins + our extension commands (mapped to the host-facing DTO).
    config.onReady?.(() =>
      pi.getCommands().map((c) => ({ name: c.name, description: c.description, source: c.source }))
    );
  };
}
