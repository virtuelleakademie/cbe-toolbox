/**
 * Path fence for the file-mutation tools `write` and `edit` (capability
 * `agent-harness`, Requirement: Path-Fenced File Mutation Tools; change
 * `fence-agent-file-writes`, design.md D2–D7).
 *
 * With the shell de-registered on every platform (Requirement: Tool Allowlist
 * Excluding Shell Execution), these two tools are the harness's ENTIRE remaining
 * write surface — and pi exposes them with default path resolution: an absolute
 * `path` argument is honoured verbatim, `~` expands to the lecturer's home, and
 * `../` traversal needs no trick at all. This module is the only write-side
 * enforcement mechanism the harness has.
 *
 * INJECTION SAFETY IS STRUCTURAL, NOT BEHAVIOURAL (design.md D7): the writable
 * roots are captured HERE, at session creation, from arguments the host
 * application passes. This module reads no config file — not from the Space,
 * not from the agent dir, not from the cwd — and nothing in the prompt, the
 * tool arguments, or any file the model can write feeds into the root set. A
 * prompt-injected "add a writable root" therefore has no mechanism by which it
 * could take effect.
 *
 * DENY-BY-DEFAULT (design.md D4): a host that configures no roots gets no write
 * capability at all — the fenced tools are still registered (replacing the
 * unfenced built-ins) and refuse every call. There is no fallback to the cwd.
 */
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

/**
 * The writable roots a host grants a session. Built by APPLICATION CODE at
 * session creation from host arguments only — never from a config file inside
 * the Space, prompt text, a tool argument, or ingested document content.
 */
export interface WritableRoots {
  /** Directory roots: every path resolving inside one of these is writable. */
  dirs?: readonly string[];
  /**
   * Individual permitted FILES (design.md, "Why files, not just directories"):
   * the two Lecturer-State layers sit beside host-owned state, so admitting
   * their parent directories would re-open exactly what the fence is for. A
   * file entry admits the named file and nothing else in its directory.
   */
  files?: readonly string[];
}

export interface FenceOptions {
  /**
   * Compare with the platform's case semantics (spec point 4): a macOS or
   * Windows volume is case-insensitive, so a case-variant spelling names the
   * SAME file there — while on a case-sensitive Linux volume the same variant
   * names a DIFFERENT path, and folding case would let it slip the fence.
   * Defaults to the current platform; injectable for tests.
   */
  caseInsensitive?: boolean;
  /** `~` expansion base; defaults to the real home directory. Test seam. */
  homeDir?: string;
}

export type FenceVerdict =
  | { allowed: true; resolvedPath: string }
  | { allowed: false; resolvedPath: string; reason: string };

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function defaultCaseInsensitive(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Mirror pi's own argument normalisation (`resolveToCwd`, options
 * `normalizeUnicodeSpaces` + `stripAtPrefix` + tilde expansion), so the fence
 * decides on the same path the delegate would have written to. The decision is
 * then made EFFECTIVE by construction: the fenced tool hands the delegate the
 * fully resolved path, never the raw argument.
 */
function lexicalResolve(rawPath: string, cwd: string, homeDir: string): string {
  let normalized = rawPath.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (normalized === "~") normalized = homeDir;
  else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    normalized = path.join(homeDir, normalized.slice(2));
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(cwd, normalized);
}

/**
 * Cap on readlink hops while resolving an entry that exists but cannot be
 * `realpath`ed (a dangling or looping link chain). 40 mirrors the Linux
 * kernel's ELOOP limit; exceeding it makes the path unresolvable, which the
 * caller turns into a refusal — never into the lexical-ancestor fallback.
 */
const SYMLINK_HOP_CAP = 40;

/**
 * Thrown when a path cannot be brought to a real location (symlink loop over
 * the hop cap, or an existing entry whose link cannot be read). The policy
 * function converts it into a deny-by-default refusal.
 */
export class UnresolvableWritePathError extends Error {
  constructor(public readonly attemptedPath: string) {
    super(`path could not be safely resolved through its symlinks: ${attemptedPath}`);
  }
}

function entryExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve symlinks over the WHOLE path, final component included (spec point 4;
 * design.md D5 — both branches):
 *
 * - the final component EXISTS and `realpath` resolves it: an existing file
 *   inside a root that is itself a link out of the roots is decided on the
 *   link's REAL TARGET, not on the link's own location;
 * - the final component EXISTS but `realpath` fails (a DANGLING link, or a
 *   loop): the link is followed one `readlink` level at a time, capped at
 *   `SYMLINK_HOP_CAP`, and resolution continues on the target — a dangling
 *   `workspace/notes.md → ~/.ssh/authorized_keys` is decided on the target
 *   pi's `writeFile` would create, never on the link's own in-root location.
 *   An entry that exists yet stays unresolvable (loop over the cap, unreadable
 *   link) throws `UnresolvableWritePathError` rather than falling back;
 * - the final component does NOT exist (the ordinary `write` case): the nearest
 *   existing ancestor is resolved and the not-yet-existing suffix is appended
 *   lexically — none of the suffix components exist, so none can be a link.
 *
 * An ancestor-only rule would miss the first two branches: `workspace/notes.md`
 * as a link to `cbe-config.json` has a parent that resolves inside a root, and
 * pi's `writeFile` would follow the link straight out of the roots.
 */
function resolveWholePathThroughSymlinks(absolutePath: string): string {
  let current = absolutePath;
  const suffix: string[] = [];
  let hops = 0;
  for (;;) {
    try {
      const real = realpathSync(current);
      return suffix.length > 0 ? path.join(real, ...suffix) : real;
    } catch {
      if (entryExists(current)) {
        hops += 1;
        if (hops > SYMLINK_HOP_CAP) throw new UnresolvableWritePathError(absolutePath);
        let target: string;
        try {
          target = readlinkSync(current);
        } catch {
          throw new UnresolvableWritePathError(absolutePath);
        }
        current = path.resolve(path.dirname(current), target);
        continue;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return suffix.length > 0 ? path.join(current, ...suffix) : current;
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function fold(p: string, caseInsensitive: boolean): string {
  return caseInsensitive ? p.toLowerCase() : p;
}

/** Segment-boundary containment: `<root>-backup` is NOT inside `<root>`. */
function isInsideDir(resolved: string, rootDir: string, caseInsensitive: boolean): boolean {
  const a = fold(resolved, caseInsensitive);
  const b = fold(rootDir, caseInsensitive);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/**
 * Canonicalise a DIRECTORY root: full symlink resolution, final component
 * included. The call path is fully resolved before comparison, so an
 * uncanonicalised root (e.g. macOS `/var` vs `/private/var`) would never match
 * anything and silently kill its own root.
 */
function canonicalDirRoot(root: string): string {
  return resolveWholePathThroughSymlinks(path.resolve(root));
}

/**
 * Canonicalise a FILE root: the PARENT is fully resolved, the final component
 * is kept literal — deliberately NOT `realpath`ed (design.md D5, ruled): a
 * permitted single file that a lecturer replaces with a symlink out of the
 * roots must make the write a refusal, not re-point the boundary to wherever
 * the link goes. Admitting the link's target would make the write boundary
 * depend on precisely the symlink the fence exists to stop following.
 */
function canonicalFileRoot(root: string): string {
  const abs = path.resolve(root);
  return path.join(resolveWholePathThroughSymlinks(path.dirname(abs)), path.basename(abs));
}

/** Human-readable root list for the refusal text (spec point 6). */
export function describeRoots(roots: WritableRoots): string {
  const entries = [
    ...(roots.dirs ?? []).map((d) => `${d} (directory)`),
    ...(roots.files ?? []).map((f) => `${f} (single file)`),
  ];
  return entries.length > 0 ? entries.join(", ") : "none — this session has no writable locations";
}

/**
 * The policy function (spec point 4): decide whether `rawPath` may be written,
 * on the FULLY RESOLVED path — after `~` expansion, `..` normalisation,
 * absolute-path resolution, and symlink resolution of the whole path including
 * the final component. Pure in-process TypeScript; identical code on macOS,
 * Windows and Linux — no OS sandbox mechanism.
 */
export function resolveAgainstRoots(
  rawPath: string,
  cwd: string,
  roots: WritableRoots,
  opts?: FenceOptions
): FenceVerdict {
  const caseInsensitive = opts?.caseInsensitive ?? defaultCaseInsensitive();
  const homeDir = opts?.homeDir ?? homedir();
  const lexical = lexicalResolve(rawPath, cwd, homeDir);
  let resolved: string;
  try {
    resolved = resolveWholePathThroughSymlinks(lexical);
  } catch {
    return {
      allowed: false,
      resolvedPath: lexical,
      reason: "the path could not be safely resolved through its symlinks (loop or unreadable link)",
    };
  }

  const dirRoots = roots.dirs ?? [];
  const fileRoots = roots.files ?? [];
  if (dirRoots.length === 0 && fileRoots.length === 0) {
    return {
      allowed: false,
      resolvedPath: resolved,
      reason: "no writable roots are configured for this session (deny-by-default)",
    };
  }

  for (const dir of dirRoots) {
    let canonical: string;
    try {
      canonical = canonicalDirRoot(dir);
    } catch {
      continue;
    }
    if (isInsideDir(resolved, canonical, caseInsensitive)) {
      return { allowed: true, resolvedPath: resolved };
    }
  }
  for (const file of fileRoots) {
    let canonical: string;
    try {
      canonical = canonicalFileRoot(file);
    } catch {
      continue;
    }
    if (fold(resolved, caseInsensitive) === fold(canonical, caseInsensitive)) {
      return { allowed: true, resolvedPath: resolved };
    }
  }
  return {
    allowed: false,
    resolvedPath: resolved,
    reason: "the resolved path is outside every writable root",
  };
}

/**
 * The refusal, thrown BEFORE any delegate call so it precedes every filesystem
 * effect (spec point 5): pi's agent loop converts a thrown tool error into an
 * error tool result (`isError: true`) and CONTINUES the run — the mutation
 * tools belong to the non-terminating family (design.md D6), so the model can
 * redirect the write to a permitted location within the same turn. The message
 * names the rejected path and the permitted roots (spec point 6) and carries no
 * success text.
 */
function refuse(
  toolName: string,
  rawPath: string,
  verdict: FenceVerdict & { allowed: false },
  roots: WritableRoots
): never {
  throw new Error(
    `${toolName} refused: "${rawPath}" resolves to "${verdict.resolvedPath}" — ${verdict.reason}. ` +
      `Writable roots: ${describeRoots(roots)}. ` +
      `Nothing was written. Redirect the ${toolName} to a permitted location.`
  );
}

/**
 * Extension factory that REPLACES pi's built-in `write` and `edit` tools with
 * path-fenced variants, through the public tool-replacement route (spec point
 * 7): `pi.registerTool` under the built-in's name — the same route the
 * sandboxed `bash` used before the shell was de-registered. The fence runs
 * BEFORE the wrapped `execute()` is ever called, and on a permitted call the
 * delegate receives the fence's fully resolved path, so the location decided on
 * IS the location written to — a symlink between the two cannot re-route the
 * bytes.
 */
export function createFencedFileToolsExtension(
  cwd: string,
  roots: WritableRoots,
  opts?: FenceOptions
): ExtensionFactory {
  // Capture an immutable copy at session creation: nothing the model reaches
  // can mutate the arrays afterwards (design.md D7).
  const frozenRoots: WritableRoots = Object.freeze({
    dirs: Object.freeze([...(roots.dirs ?? [])]),
    files: Object.freeze([...(roots.files ?? [])]),
  });

  return (pi: ExtensionAPI) => {
    const writeTool = createWriteToolDefinition(cwd);
    const editTool = createEditToolDefinition(cwd);

    pi.registerTool({
      ...writeTool,
      label: "write (fenced)",
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const verdict = resolveAgainstRoots(params.path, cwd, frozenRoots, opts);
        if (!verdict.allowed) refuse("write", params.path, verdict, frozenRoots);
        return writeTool.execute(toolCallId, { ...params, path: verdict.resolvedPath }, signal, onUpdate, ctx);
      },
    });

    pi.registerTool({
      ...editTool,
      label: "edit (fenced)",
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const verdict = resolveAgainstRoots(params.path, cwd, frozenRoots, opts);
        if (!verdict.allowed) refuse("edit", params.path, verdict, frozenRoots);
        return editTool.execute(toolCallId, { ...params, path: verdict.resolvedPath }, signal, onUpdate, ctx);
      },
    });
  };
}
