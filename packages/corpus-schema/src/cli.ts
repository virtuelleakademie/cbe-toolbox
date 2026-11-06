#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { validateDirectory } from "./validate.js";
import { generateIndex } from "./index-gen.js";
import { createCorpusBundle } from "./bundle.js";
import { generateBrowseView } from "./browse-gen.js";
import { DEFAULT_UI_LABEL_CATALOGUE, generateUiReference } from "./ui-reference-gen.js";

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "validate") {
    // Same engine for both stores (lecturer-wiki, Requirement: Validator
    // Alignment): `--schema wiki` switches the schema variant, nothing else.
    const schemaFlag = args.indexOf("--schema");
    const variant = schemaFlag >= 0 ? (args[schemaFlag + 1] ?? "corpus") : "corpus";
    if (variant !== "corpus" && variant !== "wiki") {
      console.error(`Unknown schema variant "${variant}" — use corpus or wiki`);
      process.exit(2);
    }
    const positional = schemaFlag >= 0 ? args.filter((_a, i) => i !== schemaFlag && i !== schemaFlag + 1) : args;
    const dir = path.resolve(positional[0] ?? "corpus");
    const results = await validateDirectory(dir, variant);
    const failures = results.filter((r) => !r.ok);
    for (const r of results) {
      if (r.ok) console.log(`OK   ${r.path}`);
      else console.error(`FAIL ${r.path}\n  - ${(r as { errors: string[] }).errors.join("\n  - ")}`);
    }
    if (failures.length > 0) {
      console.error(`\n${failures.length} file(s) failed validation`);
      process.exit(1);
    }
    console.log(`\n${results.length} document(s) valid`);
    return;
  }
  if (cmd === "index") {
    const dir = path.resolve(args[0] ?? "corpus");
    const out = path.resolve(args[1] ?? path.join(dir, "index.json"));
    // Manifest paths are corpus-root-relative (relative to the directory containing
    // index.json): resolvable as <paths.corpus>/<path> wherever the corpus bundle
    // lands (repo checkout, extraResources, CDN).
    const idx = await generateIndex(dir, out, { pathsRelativeTo: path.dirname(out) });
    console.log(`Wrote ${out} (${idx["document-count"]} documents)`);
    return;
  }
  if (cmd === "bundle") {
    // Versioned corpus bundle + latest.json pointer (distribution spec,
    // Requirement: Corpus Distribution as Downloadable Bundle).
    const dir = path.resolve(args[0] ?? "corpus");
    const out = path.resolve(args[1] ?? "dist/corpus-dist");
    const res = await createCorpusBundle(dir, out);
    console.log(`Wrote ${path.join(res.outDir, res.file)} (${res.fileCount} files, ${res.size} bytes)`);
    console.log(`Wrote ${path.join(res.outDir, "latest.json")} (version ${res.version}, sha256 ${res.sha256})`);
    return;
  }
  if (cmd === "browse") {
    // Static browse view: one HTML page per atom + category-grouped index
    // (distribution spec, Requirement: Corpus Browse View on the Landing Page).
    const dir = path.resolve(args[0] ?? "corpus");
    const out = path.resolve(args[1] ?? "dist/corpus-browse");
    const res = await generateBrowseView(dir, out);
    console.log(`Wrote ${res.pageCount} pages (corpus version ${res.version}) to ${out}`);
    return;
  }
  if (cmd === "ui-reference") {
    // Generated app-UI reference from the colocated `*.ui-registry.ts` files
    // (ui-reference-generation spec, Requirement: Generated UI Reference
    // Artifact). Committed like corpus/index.json, guarded by a freshness test.
    const dir = path.resolve(args[0] ?? "packages/app/src/renderer");
    const out = path.resolve(args[1] ?? "skills/cbe/references/ui-guide.md");
    // The reference-language catalogue the entries' label keys and prose
    // placeholders resolve against (ui-reference-generation spec, Requirement:
    // Generated UI Reference Artifact).
    const catalogue = path.resolve(args[2] ?? DEFAULT_UI_LABEL_CATALOGUE);
    const res = await generateUiReference(dir, out, catalogue);
    console.log(`Wrote ${res.outFile} (${res.entryCount} UI element entries from ${res.fileCount} registry file(s))`);
    return;
  }
  console.error("Usage: cbe-corpus <validate|index|bundle|browse|ui-reference> [dir] [out]");
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
