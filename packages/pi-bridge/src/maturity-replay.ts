/**
 * Same-session maturity-mirror rebuild (capability `agent-harness`, Requirement:
 * Host-Side Session Maturity Mirror — resume replay).
 *
 * When the app resumes a persisted session after a restart, the in-memory
 * maturity mirror is gone. Its only legal repopulation source is the SAME
 * session's own record: Pi's session file persists every tool call and result
 * losslessly (JSONL of session entries; `toolResult` messages carry the
 * validated `details`). `startCbeSession` pins Pi's session id to the host's
 * `sessionId`, so every Pi session file belonging to one logical conversation —
 * including the files of earlier resume legs — is named
 * `<timestamp>_<sessionId>.jsonl` in the session's `sessionsDir` and is
 * discoverable without any dedicated maturity persistence.
 *
 * The rebuild replays the recorded `cbe_maturity` result details in call order
 * (files sorted by their timestamp prefix, lines in file order) through the SAME
 * record semantics the live path uses (`MaturityMirror.applyToolResult`), so a
 * resumed session yields exactly the post-revision state. Strictly same-session:
 * only files carrying this session's id are read, the mirror is never written to
 * disk, and a New Session (fresh id) finds no files and stays empty.
 *
 * Read-tolerant by construction: a missing directory, an unreadable file, a
 * malformed line, or a foreign entry shape is skipped silently — replay is a
 * best-effort reconstruction of display state, never a boot blocker.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MaturityMirror } from "./maturity-mirror.js";

export interface MaturityReplayOptions {
  /** The session-store directory Pi's SessionManager writes into. */
  sessionsDir: string;
  /** The host session id the Pi session files are pinned to. */
  sessionId: string;
  /** The mirror to rebuild (fed via its normal `applyToolResult` path). */
  mirror: MaturityMirror;
  /** The CURRENT leg's session file — excluded from replay (it is being written
   * by the resumed session itself). */
  excludeFile?: string;
}

/**
 * Rebuild a session's maturity mirror by replaying its persisted `cbe_maturity`
 * calls from the session record. Never throws.
 */
export async function replayMaturityMirror(opts: MaturityReplayOptions): Promise<void> {
  let files: string[];
  try {
    files = await readdir(opts.sessionsDir);
  } catch {
    return; // no session store yet — nothing to replay
  }
  const exclude = opts.excludeFile ? path.basename(opts.excludeFile) : null;
  const legs = files
    .filter((f) => f.endsWith(`_${opts.sessionId}.jsonl`) && f !== exclude)
    // The filename's ISO-derived timestamp prefix sorts lexicographically in
    // chronological order, so earlier legs replay before later ones.
    .sort();
  for (const leg of legs) {
    let raw: string;
    try {
      raw = await readFile(path.join(opts.sessionsDir, leg), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // torn/foreign line — skip, never fail the boot
      }
      const e = entry as { type?: unknown; message?: Record<string, unknown> };
      if (e.type !== "message" || !e.message || typeof e.message !== "object") continue;
      const m = e.message;
      if (m.role !== "toolResult" || m.toolName !== "cbe_maturity" || m.isError === true) continue;
      // `applyToolResult` re-validates the details' structure — a malformed or
      // refusal payload leaves the mirror untouched, exactly like the live path.
      //
      // The stamp is forced to `unknown`: the evidence that existed at each
      // historical call is NOT reconstructable (the revision counter is back at
      // zero and the substance signal describes the new session), so the harness
      // must not stamp a replayed record with the post-restore substance — which
      // would falsely mark a well-evidenced reading as thin — nor at the
      // post-restore revision, which would present it as freshly confirmed. The
      // first live `cbe_maturity` call replaces it with a real stamp.
      opts.mirror.applyToolResult(m.details, { kind: "unknown" });
    }
  }
}
