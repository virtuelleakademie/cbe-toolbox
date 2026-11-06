/**
 * Tool-Call Loop Remediation (capability `agent-harness`).
 *
 * Deterministic, model-agnostic backstop that breaks within-turn tool-call loops.
 * It consumes the tool-call/result event stream (the same stream the host already
 * subscribes to) and, per turn, detects two signatures:
 *
 *  - identical-call loop  — K consecutive calls with the same (toolName, args);
 *  - same-failure loop     — K consecutive calls that fail with the same signature
 *                            (same toolName + target path, e.g. repeated ENOENT).
 *
 * On the first trigger for a signature it returns `steer` (the host injects the
 * returned correction mid-turn via the session's public steering API). If the same
 * signature keeps running past a hard cap it returns `abort` (the host aborts the
 * turn and recovers). Detection NEVER inspects the model id or name — only the
 * tool-call stream — and per-turn state is cleared at each turn boundary via
 * `reset()`.
 *
 * The detector is pure (no I/O, no time, no randomness): the same event sequence
 * always yields the same verdicts. The host owns the Pi-session side effects.
 */

/** Consecutive identical/failing calls that trigger a steering correction. */
export const LOOP_STEER_AT = 3;
/** Consecutive identical/failing calls that trigger a hard abort of the turn. */
export const LOOP_ABORT_AT = 6;

/** One completed tool call, as paired from `tool_execution_start` + `_end`. */
export interface ToolCallRecord {
  toolName: string;
  /** The tool arguments object (e.g. `{ path }` for `read`). */
  args: unknown;
  /** Whether the tool result was an error (from `tool_execution_end.isError`). */
  isError?: boolean;
}

export type LoopAction = "none" | "steer" | "abort";

export interface LoopVerdict {
  action: LoopAction;
  /** Diagnostic reason; present for steer/abort. */
  reason?: string;
  /** The loop signature that triggered; present for steer/abort. */
  signature?: string;
  /** The correction text to steer with; present only when action === "steer". */
  correction?: string;
}

/** Stable JSON: object keys sorted so argument order never changes the signature. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/** Extracts a string `path` argument if the tool carries one, else undefined. */
function extractPath(args: unknown): string | undefined {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const p = (args as Record<string, unknown>).path;
    if (typeof p === "string") return p;
  }
  return undefined;
}

/**
 * The unified loop signature for a record. A failing call with a path keys on
 * (toolName, path) so repeated same-path failures coalesce regardless of other
 * args; everything else keys on (toolName, canonical args). Identical signatures
 * in a row are "the same loop".
 */
function signatureOf(rec: ToolCallRecord): string {
  const path = extractPath(rec.args);
  if (rec.isError && path !== undefined) return `fail:${rec.toolName}:${path}`;
  return `same:${rec.toolName}:${canonicalJson(rec.args)}`;
}

function correctionFor(rec: ToolCallRecord, count: number): string {
  const path = extractPath(rec.args);
  const where = path !== undefined ? ` with the path \`${path}\`` : " with identical arguments";
  if (rec.isError && path !== undefined) {
    return (
      `You have now called \`${rec.toolName}\`${where} ${count} times and it keeps failing (e.g. ENOENT). ` +
      `Stop retrying that path. Use the EXACT \`<location>\` string from the \`<available_skills>\` block verbatim — ` +
      `do not shorten it, drop a segment, or reconstruct it. If you have already read the target successfully in this turn, ` +
      `stop reading and proceed to the next step of the opening protocol.`
    );
  }
  return (
    `You have called \`${rec.toolName}\`${where} ${count} times and already have the result. ` +
    `Do not call it again with the same arguments — proceed to the next step of the opening protocol.`
  );
}

/**
 * Incremental per-turn loop detector. The host calls `record()` once per completed
 * tool call and acts on the returned verdict, and calls `reset()` at each turn
 * boundary (`turn_start` / `turn_end`).
 */
export class ToolLoopDetector {
  private lastSig: string | null = null;
  private runLen = 0;
  private steeredSigs = new Set<string>();

  /** Clears per-turn state so loops never accumulate across turn boundaries. */
  reset(): void {
    this.lastSig = null;
    this.runLen = 0;
    this.steeredSigs.clear();
  }

  /**
   * Feed one completed tool call. Returns the action the host should take:
   *  - `abort` once a single signature has run for `LOOP_ABORT_AT` calls;
   *  - `steer` (with a `correction`) the first time a signature reaches
   *    `LOOP_STEER_AT`, at most once per signature per turn;
   *  - `none` otherwise.
   */
  record(rec: ToolCallRecord): LoopVerdict {
    const signature = signatureOf(rec);
    if (signature === this.lastSig) this.runLen += 1;
    else {
      this.lastSig = signature;
      this.runLen = 1;
    }

    if (this.runLen >= LOOP_ABORT_AT) {
      return {
        action: "abort",
        signature,
        reason: `tool call repeated ${this.runLen}× without converging (signature ${signature})`,
      };
    }
    if (this.runLen >= LOOP_STEER_AT && !this.steeredSigs.has(signature)) {
      this.steeredSigs.add(signature);
      return {
        action: "steer",
        signature,
        reason: `tool call repeated ${this.runLen}× (signature ${signature})`,
        correction: correctionFor(rec, this.runLen),
      };
    }
    return { action: "none" };
  }
}
