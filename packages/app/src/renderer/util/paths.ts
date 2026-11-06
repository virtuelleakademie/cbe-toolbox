import type { SessionPaths } from "../../shared/ipc-contract.js";

/**
 * Rewrite an absolute path against the session's known anchors so the lecturer
 * sees `corpus/content/foundations/abc.md` instead of `/Users/<name>/.../corpus/dev/…`.
 * Without this, file reads expose the user's home directory and project layout
 * — fine for a coding agent, alarming for a lecturer-facing tool.
 *
 * Anchor order matters: when two anchors are nested, the LONGER prefix wins so
 * `wiki/` inside `workspace/` resolves to `wiki/…` not `workspace/wiki/…`.
 * Paths that don't match any anchor fall back to a "…/last-3-segments" form so
 * we never paste a full absolute path into the chat.
 */
export function shortenAgentPath(absolute: string, paths: SessionPaths | null): string {
  if (!absolute) return absolute;
  if (!paths) return absolute;
  const anchors: { dir: string; label: string }[] = [
    { dir: paths.corpus, label: "corpus" },
    { dir: paths.workspace, label: "workspace" },
  ];
  if (paths.wiki) anchors.push({ dir: paths.wiki, label: "wiki" });
  anchors.sort((a, b) => b.dir.length - a.dir.length);
  for (const { dir, label } of anchors) {
    if (!dir) continue;
    if (absolute === dir) return label;
    if (absolute.startsWith(dir + "/")) return `${label}/${absolute.slice(dir.length + 1)}`;
  }
  const segs = absolute.split("/").filter(Boolean);
  if (absolute.startsWith("/") && segs.length > 3) {
    return "…/" + segs.slice(-3).join("/");
  }
  return absolute;
}
