/**
 * Credential resolution for the eval harness.
 *
 * The harness never contains key material and never asks an operator to source
 * a file into their shell — that `set -a` step was the project's most-documented
 * tripwire, because a plain `source` sets shell variables that the `node` child
 * process spawned by `npm run eval` never sees.
 *
 * Resolution order (spec: "Model and judge configuration carries no secrets"):
 *
 *   1. an environment variable that is ALREADY set — always wins, never overwritten
 *   2. $CBE_EVAL_SECRETS                                   (explicit operator override)
 *   3. <repo>/evaluation/cbe-skill/runner/.eval-secrets    (checkout-local slot)
 *   4. ${XDG_CONFIG_HOME:-~/.config}/cbe-eval/secrets      (machine-local, outside any repo)
 *
 * Every file in the list is consulted in order, and each may only fill variables
 * that are still unset. So a partial file composes with a later one, while the
 * precedence above stays exactly as written.
 *
 * Only the variables the resolved configuration NAMES are imported. The
 * machine-local slot is typically a symlink into a secret store that holds far
 * more than the two `CBE_LLM_*` entries; every extra pair copied into
 * `process.env` would be inherited by the child processes the harness spawns —
 * the Claude CLI judge and the pi eval session that runs the model under test.
 * The filter is an explicit name list, not a prefix: a prefix would silently
 * adopt whatever future variable happens to match it.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface SecretsResolution {
  /** Every path consulted, in resolution order — quoted verbatim in error messages. */
  searched: string[];
  /** The paths that existed and contributed at least one variable. */
  loaded: string[];
  /**
   * The paths that existed and parsed cleanly but supplied none of the wanted
   * variables — a secrets file naming its entries differently, or one carrying
   * only variables the environment had already set. Distinct from `loaded`:
   * both were READ, which is what separates "add a line to the file you have"
   * from "create a file", but only `loaded` actually filled something.
   */
  parsedWithoutMatch: string[];
}

/**
 * Parse a `KEY=VALUE` secrets file. Tolerates an `export ` prefix, single or
 * double quotes around the value, `#` comment lines and blank lines. Inline
 * comments are NOT stripped: `#` is a legal character inside an API key, and
 * silently truncating a credential is a far worse failure than carrying a
 * trailing comment nobody writes.
 */
export function parseSecretsFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const assignment = line.replace(/^export\s+/, "");
    const eq = assignment.indexOf("=");
    if (eq <= 0) continue;
    const key = assignment.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = assignment.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** The config directory used for the machine-local slot, honouring XDG. */
function configHome(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return xdg;
  const home = env.HOME?.trim() || homedir();
  return path.join(home, ".config");
}

/** Every secrets-file location, in resolution order. */
export function secretsSearchPaths(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const paths: string[] = [];
  const explicit = env.CBE_EVAL_SECRETS?.trim();
  if (explicit) paths.push(path.resolve(explicit));
  paths.push(path.join(repoRoot, "evaluation", "cbe-skill", "runner", ".eval-secrets"));
  paths.push(path.join(configHome(env), "cbe-eval", "secrets"));
  return paths;
}

/**
 * Fill still-unset credential variables in `env` from the first secrets files
 * that supply them. Mutates `env`; never overwrites a variable that is already
 * set, which is what makes an exported environment take real precedence rather
 * than merely happening to be checked first.
 *
 * `wanted` is the exact set of variable names the resolved configuration
 * references. Anything else in a secrets file is read past and never assigned.
 */
export function loadSecretsIntoEnv(
  repoRoot: string,
  wanted: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
  onWarn: (message: string) => void = (m) => console.warn(m)
): SecretsResolution {
  const searched = secretsSearchPaths(repoRoot, env);
  const explicit = env.CBE_EVAL_SECRETS?.trim();
  const wantedNames = new Set(wanted);
  const loaded: string[] = [];
  const parsedWithoutMatch: string[] = [];
  for (const file of searched) {
    if (!existsSync(file)) {
      // An explicit pointer that resolves to nothing is an operator mistake, not
      // an absent optional file — say so instead of falling through in silence.
      if (explicit && file === path.resolve(explicit)) {
        onWarn(`[warn] $CBE_EVAL_SECRETS points at a file that does not exist: ${file}`);
      }
      continue;
    }
    let parsed: Record<string, string>;
    try {
      parsed = parseSecretsFile(readFileSync(file, "utf8"));
    } catch (err) {
      // "exists but unreadable" must not read as "nothing was there". Path only,
      // never contents.
      onWarn(`[warn] secrets file exists but could not be read: ${file} (${(err as Error).message})`);
      continue;
    }
    let contributed = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (!wantedNames.has(key)) continue;
      if (env[key] === undefined || env[key] === "") {
        env[key] = value;
        contributed = true;
      }
    }
    if (contributed) loaded.push(file);
    else parsedWithoutMatch.push(file);
  }
  return { searched, loaded, parsedWithoutMatch };
}

/**
 * The "where do I put it" half of a missing-credential error. Names paths, not
 * just variables — a worker who only learns the variable name still has to read
 * source to find out where a file would be picked up from.
 *
 * It also distinguishes the two failures that otherwise read identically: no
 * secrets file exists anywhere, versus a file was found and parsed but did not
 * carry THIS variable. Those call for opposite fixes — create a file, or add a
 * line to the one you already have — so every path that was actually read is
 * named too. That includes a file which supplied nothing at all: a slot
 * symlinked into a secret store whose entries carry other names is exactly the
 * case where "place one at a path above" would be the wrong advice (paths only;
 * the never-print-contents rule holds here as everywhere).
 */
export function describeSecretsSearch(res: SecretsResolution): string {
  const read = new Set([...res.loaded, ...res.parsedWithoutMatch]);
  const readPaths = [...new Set(res.searched.filter((p) => read.has(p)))];
  const lead =
    readPaths.length > 0
      ? `No secrets file supplied it. These were read but did not carry it:\n` +
        readPaths.map((p) => `  - ${p}`).join("\n") +
        `\nAlso searched, in order:\n`
      : `No secrets file supplied it. Searched, in order:\n`;
  const remedy =
    readPaths.length > 0
      ? `\nEither export the variable, point $CBE_EVAL_SECRETS at a KEY=VALUE file, or add the missing line to a file listed above.`
      : `\nEither export the variable, point $CBE_EVAL_SECRETS at a KEY=VALUE file, or place one at a path above.`;
  return lead + res.searched.map((p) => `  - ${p}`).join("\n") + remedy;
}
