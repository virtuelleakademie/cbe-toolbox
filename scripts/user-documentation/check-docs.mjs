#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DocsCheckError, runDocumentationChecks } from "./docs-check-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const release = process.argv.includes("--release");
const productOnly = process.argv.includes("--product-only");
const unknown = process.argv.slice(2).filter((arg) => !["--release", "--product-only"].includes(arg));
if (unknown.length > 0) {
  process.stderr.write(`Unknown docs check option: ${unknown.join(" ")}\n`);
  process.exitCode = 2;
} else {
  try {
    const result = await runDocumentationChecks({ repoRoot, release, ownership: !productOnly });
    process.stdout.write(
      `Documentation check passed: ${result.pages} Markdown entry/pages, ${result.topics} governed topics, ${result.screenshots} hashed screenshots.\n`
    );
    process.stdout.write(
      "Pixel recapture was not impersonated: run npm run docs:screenshots:check on the required Linux/Xvfb lane.\n"
    );
    if (result.reviewsPending > 0) {
      process.stdout.write(
        `First-review draft: ${result.reviewsPending} named human review roles remain pending; --release rejects this state.\n`
      );
    }
  } catch (error) {
    const message = error instanceof DocsCheckError || error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
