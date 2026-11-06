#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { createSkillBundle } from "@cbe/corpus-schema";
import { SKILL_COMPATIBILITY_CONTRACT } from "@cbe/pi-bridge/skill-compatibility";

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node scripts/skill-bundle.mjs <skill-directory> <output-directory>");
}
const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);

const result = await createSkillBundle(dir, out, {
  compatibility: SKILL_COMPATIBILITY_CONTRACT,
});

console.log(`Wrote ${path.join(result.outDir, result.file)} (${result.fileCount} files, ${result.size} bytes)`);
console.log(
  `Wrote ${path.join(result.outDir, "latest.json")} ` +
    `(version ${result.version}, sha256 ${result.sha256}, tool contract ${result.toolContractSha256})`
);
