/**
 * CLI for the traceability coverage check: `npm run trace:check` (repo root).
 *
 * Exits non-zero on failing findings: unmapped checkpoints, UNANCHORED checkpoints,
 * stale entries, duplicates, invalid entries. Untested passages stay a report — that is
 * information about coverage, not a defect. `--require-classified` additionally fails on
 * the honest pre-measurement `unmeasured` state and is the archive-readiness gate.
 *
 * An unanchored checkpoint FAILS the check since `rebuild-skill-prompt-and-eval`. It was
 * report-only before, and the report was ignored for 234 of 296 entries.
 */

import { resolve } from "node:path";
import { checkTraceability, collectSuiteCheckpoints, loadSkillTree, loadTraceabilityMap } from "./trace-check.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requireClassified = args.includes("--require-classified");
  const rootArg = args.find((arg) => arg !== "--require-classified");
  const root = resolve(rootArg ?? process.cwd());
  const scenariosDir = resolve(root, "evaluation/cbe-skill/scenarios");
  const mapPath = resolve(root, "evaluation/cbe-skill/traceability.json");
  const skillDir = resolve(root, "skills/cbe");
  const corpusIndexPath = resolve(root, "corpus/index.json");

  const [entries, suite, skill] = await Promise.all([
    loadTraceabilityMap(mapPath),
    collectSuiteCheckpoints(scenariosDir, corpusIndexPath),
    loadSkillTree(skillDir),
  ]);
  const report = checkTraceability(entries, suite.ids, skill, { requireClassified });

  const classCounts = new Map<string, number>();
  for (const e of entries) {
    classCounts.set(e.classification, (classCounts.get(e.classification) ?? 0) + 1);
  }

  console.log(`Traceability coverage — ${entries.length} map entries, ${suite.ids.size} suite checkpoints`);
  console.log(
    `Classification: ${[...classCounts.entries()]
      .sort()
      .map(([k, n]) => `${k}=${n}`)
      .join("  ")}`
  );

  const fail = (title: string, lines: string[]): void => {
    if (lines.length === 0) return;
    console.log(`\n✗ ${title} (${lines.length}):`);
    for (const line of lines) console.log(`  - ${line}`);
  };

  fail("Unmapped checkpoints (add a map entry)", report.unmappedCheckpoints);
  fail("Stale checkpoints (id no longer in the suite)", report.staleCheckpoints);
  fail(
    "Stale anchors (skill file/heading no longer exists)",
    report.staleAnchors.map((s) => `${s.checkpoint} → ${s.anchor.file} § ${s.anchor.heading} (${s.reason})`)
  );
  fail("Duplicate entries", report.duplicateEntries);
  fail("Invalid entries", report.invalidEntries);
  fail("UNANCHORED checkpoints (name the channel + passage that governs them; not downgradable)", report.unanchored);
  if (requireClassified) {
    fail("UNMEASURED checkpoints (measure and classify before archive)", report.unmeasured);
  } else {
    console.log(`\nUnmeasured checkpoints (allowed before measurement): ${report.unmeasured.length}`);
  }

  console.log(`\nUntested passages (no checkpoint maps to them): ${report.untestedSections.length}`);
  for (const s of report.untestedSections) console.log(`  - ${s.file} § ${s.heading}`);

  if (report.ok) {
    console.log(
      requireClassified
        ? "\ntrace:check OK — every suite checkpoint is mapped, anchored, and classified; archive gate clear."
        : "\ntrace:check OK — every suite checkpoint is mapped and anchored, no stale entries."
    );
  } else {
    console.log("\ntrace:check FAILED — fix the findings marked ✗ above.");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
