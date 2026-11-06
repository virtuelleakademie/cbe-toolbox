#!/usr/bin/env node
/**
 * `npm run pi:candidate -- --pi <exact version> [--group <name>]… [--ref <commit>]
 *                         [--set <package>@<exact version>]… [--report <file>]
 *                         [--tmp-root <dir>] [--keep]`
 *
 * Evaluates ONE intentionally selected, exact Pi version set in an isolated
 * copy of the committed tree and leaves the caller's checkout untouched
 * (`gate.mjs` documents the phases, docs/pi-upgrades.md the operator's view).
 *
 * Exit codes: 0 green · 1 a contract group red · 2 usage (nothing touched) ·
 * 3 install / resolution · 4 build · 5 the caller's checkout changed ·
 * 6 the isolated checkout could not be created.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, UsageError, runCandidate } from "./gate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function main(argv = process.argv.slice(2), { repo = REPO, log = console.log } = {}) {
  try {
    return runCandidate({ repo, argv, log }).exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      log(`pi:candidate: ${err.message}`);
      return EXIT.usage;
    }
    log(`pi:candidate: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT.checkout;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
