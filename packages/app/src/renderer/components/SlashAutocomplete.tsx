import { useEffect, useMemo, useState } from "react";
import type { SlashCommand } from "../../shared/ipc-contract.js";
import { matchCommands, PI_BUILTIN_ALLOWLIST } from "../../shared/slash-commands.js";
import { useChrome } from "../chrome.js";

/**
 * `/` slash-command autocomplete shown above the composer (capability
 * `desktop-app`, Requirement: Slash Commands via Pi-First Architecture).
 *
 * Populated from `window.cbe.getCommands()` (pi built-ins + the app's extension
 * commands — already filtered to the UI allowlist in the main process). This
 * component does NOT maintain a parallel command registry; it just renders +
 * matches the list it is handed.
 *
 * Keyboard: while open it owns a capture-phase `keydown` listener so Arrow keys
 * navigate, Enter accepts and Esc closes — intercepted BEFORE the composer
 * textarea's own handlers (which would otherwise insert a newline / submit).
 * Selection inserts the command into the composer; the command then dispatches
 * through pi's normal input pathway on submit (no renderer-side intercept).
 */

const SOURCE_LABEL: Record<string, string> = { extension: "app" };

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? "pi";
}

export function SlashAutocomplete({
  commands,
  query,
  onAccept,
  onClose,
}: {
  commands: SlashCommand[];
  query: string;
  onAccept: (cmd: SlashCommand) => void;
  onClose: () => void;
}) {
  const t = useChrome();
  const matched = useMemo(() => matchCommands(commands, query), [commands, query]);
  const [active, setActive] = useState(0);

  // Reset the highlight to the top whenever the filtered set changes.
  useEffect(() => {
    setActive(0);
  }, [query, commands]);

  useEffect(() => {
    if (matched.length === 0) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setActive((a) => (a + 1) % matched.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setActive((a) => (a - 1 + matched.length) % matched.length);
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          onAccept(matched[active]!);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    }
    // Capture phase + document so we intercept before the composer textarea's
    // bubble-phase React handlers (newline on Enter, etc.).
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [matched, active, onAccept, onClose]);

  if (matched.length === 0) return null;

  return (
    <ul className="slash-autocomplete" role="listbox" aria-label={t.chatSlashCommandsLabel}>
      {matched.map((cmd, i) => (
        <li
          key={`${cmd.source}:${cmd.name}`}
          role="option"
          aria-selected={i === active}
          className={`slash-item ${i === active ? "slash-item-active" : ""}`}
          // onMouseDown (not onClick) so the composer textarea does not blur first.
          onMouseDown={(e) => {
            e.preventDefault();
            onAccept(cmd);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="slash-name mono">/{cmd.name}</span>
          <span className={`slash-source slash-source-${sourceLabel(cmd.source)}`}>{sourceLabel(cmd.source)}</span>
          {cmd.description && <span className="slash-desc">{cmd.description}</span>}
        </li>
      ))}
    </ul>
  );
}

// Re-export so the composer can keep the allowlist in one place if it needs it.
export { PI_BUILTIN_ALLOWLIST };
