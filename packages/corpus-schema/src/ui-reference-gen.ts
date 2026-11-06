import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveUiEntryLabels, uiElementRegistryEntrySchema, type UiElementRegistryEntry } from "./ui-registry.js";

/**
 * Generator for the UI reference artifact (capability `ui-reference-generation`,
 * Requirement: Generated UI Reference Artifact). Collects all UI element
 * registry entries from `*.ui-registry.ts` files colocated with the renderer
 * components and renders the single generated Markdown reference
 * `skills/cbe/references/ui-guide.md`. Follows the `index-gen.ts` precedent:
 * typed source of truth → validated → committed generated artifact.
 *
 * Registry modules are loaded via dynamic import — Node >= 22.19 (the repo's
 * engines floor) strips erasable TypeScript syntax natively, so the compiled
 * CLI can import the app's `.ui-registry.ts` sources directly. Registry files
 * therefore stay plain data modules: object literals plus type-only imports.
 */

export const UI_REGISTRY_FILE_SUFFIX = ".ui-registry.ts";

/** The command a human runs to regenerate the artifact — named in the
 * generated header (Scenario: Generated file is marked as generated) and in
 * the freshness-test failure message. */
export const UI_REFERENCE_REGEN_COMMAND = "npm run ui:reference";

/**
 * Where the generator reads the REFERENCE-language chrome catalogue from
 * (capability `ui-reference-generation`, Requirement: *Generated UI Reference
 * Artifact* — "Label placeholders resolve against the reference language").
 *
 * The generated file is a committed artefact compared byte-for-byte by the
 * freshness check, so its content MUST be a pure function of the registry and the
 * catalogues and MUST NOT depend on any runtime setting. It resolves against
 * English and emits ONE label per entry, never one per shipped language.
 */
export const DEFAULT_UI_LABEL_CATALOGUE = "packages/app/src/shared/i18n/en.ts";

/**
 * The catalogue that belongs to a registry root, derived from the ROOT rather
 * than from the working directory: the registry lives at `<app>/src/renderer` and
 * its catalogue at `<app>/src/shared/i18n`. A cwd-relative default worked only
 * when the generator happened to run from the repo root, which is not how the
 * package's own tests invoke it.
 */
export function catalogueFor(rootDir: string): string {
  return path.join(path.resolve(rootDir), "..", "shared", "i18n", "en.ts");
}

/** The reference language whose labels the committed artefact shows. */
export const UI_REFERENCE_LANGUAGE = "English";

/**
 * Load the reference catalogue and return a key lookup over its STRING entries.
 * Function-valued entries are parametrised copy and are never a control label, so
 * they are deliberately not resolvable — naming one is the same build error as
 * naming a key that does not exist at all.
 */
export async function loadLabelLookup(cataloguePath: string): Promise<(key: string) => string | undefined> {
  const resolvedPath = path.resolve(cataloguePath);
  if (!existsSync(resolvedPath)) {
    // A registry root with no catalogue beside it (a test fixture tree) resolves
    // nothing, and an entry that names a key then fails loudly with the key in the
    // message — which is the same build error a missing key would raise.
    return () => undefined;
  }
  const mod = (await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>;
  const catalogue = Object.values(mod).find((v) => v !== null && typeof v === "object") as
    | Record<string, unknown>
    | undefined;
  if (!catalogue) throw new Error(`${cataloguePath}: no exported chrome-string catalogue object found`);
  return (key: string) => (typeof catalogue[key] === "string" ? (catalogue[key] as string) : undefined);
}

const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git"]);

async function walkRegistryFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await walkRegistryFiles(full)));
    } else if (entry.name.endsWith(UI_REGISTRY_FILE_SUFFIX)) {
      out.push(full);
    }
  }
  return out;
}

export interface CollectedUiRegistry {
  entries: UiElementRegistryEntry[];
  fileCount: number;
}

/**
 * Find every `*.ui-registry.ts` under `rootDir`, import it, and validate all
 * exported entry arrays. Any export whose value is an array is treated as a
 * list of registry entries; each element must satisfy the entry schema.
 * Entries are returned in a deterministic order (area, then id) so the
 * generated artifact is byte-stable across runs — the freshness check
 * depends on that.
 */
export async function collectUiRegistryEntries(rootDir: string): Promise<CollectedUiRegistry> {
  const files = (await walkRegistryFiles(path.resolve(rootDir))).sort();
  const entries: UiElementRegistryEntry[] = [];
  const seenIds = new Map<string, string>();
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const exportedArrays = Object.entries(mod).filter((kv): kv is [string, unknown[]] => Array.isArray(kv[1]));
    if (exportedArrays.length === 0) {
      throw new Error(`${file}: no exported registry entry array found`);
    }
    for (const [exportName, values] of exportedArrays) {
      for (const [i, value] of values.entries()) {
        const parsed = uiElementRegistryEntrySchema.safeParse(value);
        if (!parsed.success) {
          const detail = parsed.error.issues.map((iss) => `${iss.path.join(".") || "(entry)"}: ${iss.message}`);
          throw new Error(`${file} (${exportName}[${i}]): invalid registry entry\n  - ${detail.join("\n  - ")}`);
        }
        const dup = seenIds.get(parsed.data.id);
        if (dup) {
          throw new Error(`${file}: duplicate registry id "${parsed.data.id}" (already declared in ${dup})`);
        }
        seenIds.set(parsed.data.id, file);
        entries.push(parsed.data);
      }
    }
  }
  const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  entries.sort((a, b) => byCodeUnit(a.area, b.area) || byCodeUnit(a.id, b.id));
  return { entries, fileCount: files.length };
}

/**
 * Render the generated Markdown reference. Pure function of the entry list,
 * with a machine-generated-file header naming the regeneration command and
 * the skill-facing grounding rules (affordance gating, no-fabrication).
 * An empty registry renders a valid, entry-less document (Scenario: Empty
 * registry produces a valid, empty reference).
 */
export function renderUiReference(entries: UiElementRegistryEntry[]): string {
  const lines: string[] = [
    "<!--",
    "  GENERATED FILE — DO NOT HAND-EDIT.",
    "  Generated from the UI element registry (`*.ui-registry.ts` files colocated",
    "  with the renderer components in `packages/app/src/renderer/`).",
    `  Regenerate with \`${UI_REFERENCE_REGEN_COMMAND}\` after any registry change; a stale`,
    "  copy of this file fails the freshness test in packages/corpus-schema.",
    "",
    `  The control labels below are the ${UI_REFERENCE_LANGUAGE} catalogue's. The app renders its`,
    "  chrome in the lecturer's configured interface language, and the host-injected",
    "  `app-ui reference` block carries the labels of the language actually running —",
    "  that block is authoritative whenever it is present. A label read from THIS file",
    "  may therefore not be the one on the lecturer's screen; say where a control is",
    "  rather than quoting a label you cannot see.",
    "-->",
    "",
    "# CBE Toolbox — App UI Guide",
    "",
    "What each documented lecturer-facing control of the desktop app is and how to use it. Grounding rules: answer app-UI help questions from the entries below, never from invented UI behaviour. An entry with an **Availability** line is gated on the named affordance — when the session's environment descriptor does not report that affordance `true`, do not present the control as available (conservative default, `references/environment-awareness.md`). A control with no entry here is undocumented — say so instead of guessing.",
    "",
  ];
  if (entries.length === 0) {
    lines.push("No controls are documented yet — the registry is empty.", "");
    return lines.join("\n");
  }
  let currentArea: string | null = null;
  for (const entry of entries) {
    if (entry.area !== currentArea) {
      currentArea = entry.area;
      lines.push(`## ${entry.area}`, "");
    }
    lines.push(`### ${entry.label} (\`${entry.id}\`)`, "");
    lines.push(entry.description, "");
    lines.push(`**How to use.** ${entry.howToUse}`, "");
    if (entry.affordance) {
      lines.push(
        `**Availability:** only when the session's environment descriptor reports the \`${entry.affordance}\` affordance as \`true\`.`,
        ""
      );
    }
  }
  return lines.join("\n");
}

export interface GenerateUiReferenceResult {
  entryCount: number;
  fileCount: number;
  outFile: string;
}

/** Collect the registry under `rootDir` and write the rendered reference to
 * `outFile` (creating parent directories as needed). */
export async function generateUiReference(
  rootDir: string,
  outFile: string,
  cataloguePath: string = catalogueFor(rootDir)
): Promise<GenerateUiReferenceResult> {
  const { entries, fileCount } = await collectUiRegistryEntries(rootDir);
  // Resolve every label and prose placeholder against the reference catalogue.
  // A key no catalogue declares throws here — the build error the registry
  // requirement demands, raised where a human is running the generator.
  const lookup = await loadLabelLookup(cataloguePath);
  const resolvedEntries = entries.map((entry) => resolveUiEntryLabels(entry, lookup));
  const rendered = renderUiReference(resolvedEntries);
  const target = path.resolve(outFile);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, rendered, "utf8");
  return { entryCount: entries.length, fileCount, outFile: target };
}
