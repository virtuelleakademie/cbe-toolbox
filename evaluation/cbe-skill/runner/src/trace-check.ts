/**
 * Traceability coverage check (capability `cbe-skill-traceability`).
 *
 * Validates `evaluation/cbe-skill/traceability.json` — the checkpoint ↔
 * requirement ↔ skill-anchor map — against the live scenario suite and the
 * live skill tree. Pure: no LLM, no network; safe to run inside `npm test`.
 *
 * Reported findings:
 * - unmapped checkpoints (a scenario checkpoint with no map entry) — FAIL
 * - stale entries (checkpoint id or anchor file/heading no longer exists) — FAIL
 * - duplicate / invalid entries — FAIL
 * - unclear-instructed checkpoints (no anchor, not `scenario-flaw`) — report only
 * - untested skill sections (heading no checkpoint maps to) — report only
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { loadCorpusIds, loadProbesFromFile } from "./loader.js";

export const CLASSIFICATIONS = ["satisfied", "real-gap", "suspect-check", "scenario-flaw", "unmeasured"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * An anchor names the passage that GOVERNS a checkpoint, in one of the three instruction
 * channels (capability `agent-harness`, Requirement: *Instruction Channel Boundary*).
 *
 * The anchor space covers all three because a checkpoint may now be governed by any of
 * them: a rule that left the skill body for a tool description did not stop being
 * testable, it stopped being anchorable in the old, skill-only space.
 */
export interface SkillAnchor {
  /** `skill` — a file under `skills/cbe/`; `prompt` — the identity prompt; `tool` — a
   *  named `cbe_*` tool's description + parameter descriptions. Defaults to `skill` for
   *  a legacy entry that carries only `file`/`heading`. */
  channel?: "skill" | "prompt" | "tool";
  /** `skill`: path relative to `skills/cbe/` (normally `SKILL.md`).
   *  `prompt`: `identity-prompt`. `tool`: the tool name, e.g. `cbe_picker`. */
  file: string;
  /** A markdown/prompt heading in that channel, or a unique marker string. */
  heading: string;
}

export interface TraceEntry {
  /** Suite-unique checkpoint id, e.g. `07.7a.1` (scenario file number + probe-qualified checkpoint id). */
  checkpoint: string;
  anchors: SkillAnchor[];
  /** Owning spec requirement (capability, optionally `capability / Requirement Name`). */
  requirement: string;
  classification: Classification;
  note?: string;
}

/** A markdown file under `skills/cbe/`: its headings and full text (for marker anchors). */
export interface SkillFile {
  headings: string[];
  content: string;
}

/** The live skill tree: file path (relative to `skills/cbe/`) → headings + content. */
export type SkillTree = Map<string, SkillFile>;

export interface StaleAnchorFinding {
  checkpoint: string;
  anchor: SkillAnchor;
  reason: "missing-file" | "missing-heading";
}

export interface UntestedSection {
  file: string;
  heading: string;
}

export interface TraceReport {
  /** Scenario checkpoints with no map entry. Failing. */
  unmappedCheckpoints: string[];
  /** Map entries whose checkpoint id no longer exists in the suite. Failing (stale). */
  staleCheckpoints: string[];
  /** Map entries whose anchor references a missing skill file or heading/marker. Failing (stale). */
  staleAnchors: StaleAnchorFinding[];
  /** Checkpoint ids appearing in more than one map entry. Failing. */
  duplicateEntries: string[];
  /** Entries that violate the schema (bad classification, missing fields). Failing. */
  invalidEntries: string[];
  /** Entries with NO anchor. FAILING since the change `rebuild-skill-prompt-and-eval`:
   *  it was report-only before, and the report was ignored for 234 entries. */
  unanchored: string[];
  /** Anchored entries awaiting classification from a measurement run. */
  unmeasured: string[];
  /** Skill sections (file + heading) no checkpoint maps to. Report only. */
  untestedSections: UntestedSection[];
  /** False when any failing finding is present. */
  ok: boolean;
}

/** Where a failing checkpoint's fix belongs, routed by the entry's classification. */
export type FixRoute =
  | { kind: "skill-anchor"; targets: SkillAnchor[] }
  | { kind: "requirement"; target: string }
  | { kind: "scenario"; target: string }
  | { kind: "none" };

/**
 * Route a failing checkpoint to its fix (spec scenario: "An entry routes a
 * failing checkpoint to its fix"): `real-gap` → edit the skill anchors,
 * `suspect-check` → amend the spec requirement/rubric, `scenario-flaw` → fix
 * the scenario turns (the checkpoint's scenario file).
 */
export function routeFix(entry: TraceEntry, scenarioFileByCheckpoint: Map<string, string>): FixRoute {
  switch (entry.classification) {
    case "real-gap":
      return { kind: "skill-anchor", targets: entry.anchors };
    case "suspect-check":
      return { kind: "requirement", target: entry.requirement };
    case "scenario-flaw":
      return { kind: "scenario", target: scenarioFileByCheckpoint.get(entry.checkpoint) ?? "" };
    default:
      return { kind: "none" };
  }
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** Extract markdown headings (outside fenced code blocks) from a skill file. */
export function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m) headings.push(m[1]!.trim());
  }
  return headings;
}

/**
 * An anchor resolves when the channel passage it names exists and its heading matches a
 * heading or occurs as a marker string.
 *
 * The `prompt` and `tool` channels are resolved against the TEXT of their source files
 * rather than by importing `@cbe/pi-bridge`: importing it would pull the pi runtime into
 * `npm test`, which this whole runner is deliberately built to avoid. Reading the source
 * answers exactly the question the check asks — does this marker exist in that channel.
 */
/** The `SkillTree` key an anchor addresses. `skill` anchors key on the bare relative
 *  path (legacy-compatible); the other channels are namespaced. */
export function anchorKey(anchor: SkillAnchor): string {
  const channel = anchor.channel ?? "skill";
  return channel === "skill" ? anchor.file : `${channel}:${anchor.file}`;
}

export function resolveAnchor(anchor: SkillAnchor, skill: SkillTree): StaleAnchorFinding["reason"] | null {
  const file = skill.get(anchorKey(anchor));
  if (!file) return "missing-file";
  if (file.headings.includes(anchor.heading)) return null;
  if (file.content.includes(anchor.heading)) return null;
  return "missing-heading";
}

/**
 * Derive the suite-unique checkpoint id: `<scenario-number>.<checkpoint-id>`,
 * probe-qualified when the checkpoint id does not already start with the probe
 * id (e.g. `07.7a.1`, but `31.31b.bigidea`).
 */
export function fullCheckpointId(scenarioNumber: string, probeId: string, checkpointId: string): string {
  return checkpointId.startsWith(`${probeId}.`)
    ? `${scenarioNumber}.${checkpointId}`
    : `${scenarioNumber}.${probeId}.${checkpointId}`;
}

/** Pure core: validate map entries against checkpoint ids and the skill tree. */
export function checkTraceability(
  entries: TraceEntry[],
  checkpointIds: Set<string>,
  skill: SkillTree,
  options: { requireClassified?: boolean } = {}
): TraceReport {
  const seen = new Set<string>();
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];
  const staleCheckpoints: string[] = [];
  const staleAnchors: StaleAnchorFinding[] = [];
  const unanchored: string[] = [];
  const unmeasured: string[] = [];
  const anchoredSections = new Set<string>();

  for (const entry of entries) {
    if (typeof entry.checkpoint !== "string" || entry.checkpoint.length === 0) {
      invalidEntries.push(`(missing checkpoint id) ${JSON.stringify(entry)}`);
      continue;
    }
    if (seen.has(entry.checkpoint)) duplicateEntries.push(entry.checkpoint);
    seen.add(entry.checkpoint);

    if (!CLASSIFICATIONS.includes(entry.classification)) {
      invalidEntries.push(`${entry.checkpoint}: invalid classification "${String(entry.classification)}"`);
    } else if (entry.classification === "unmeasured") {
      unmeasured.push(entry.checkpoint);
    }
    if (!Array.isArray(entry.anchors)) {
      invalidEntries.push(`${entry.checkpoint}: anchors must be an array`);
      continue;
    }
    if (typeof entry.requirement !== "string" || entry.requirement.trim().length === 0) {
      invalidEntries.push(`${entry.checkpoint}: requirement must be a non-empty string`);
    }

    if (!checkpointIds.has(entry.checkpoint)) staleCheckpoints.push(entry.checkpoint);

    for (const anchor of entry.anchors) {
      const reason = resolveAnchor(anchor, skill);
      if (reason) {
        staleAnchors.push({ checkpoint: entry.checkpoint, anchor, reason });
      } else {
        anchoredSections.add(`${anchorKey(anchor)}\x00${anchor.heading}`);
      }
    }
    // AN ANCHOR IS MANDATORY (capability `cbe-skill-traceability`, Requirement:
    // *Checkpoint-to-skill traceability map*). The previous anchorless classification
    // state is removed: it was the DEFAULT, 234 of 296 entries sat in it, and that made
    // the map a list rather than a routing table. A checkpoint whose governing passage
    // cannot be named is not ready to ship — either the behaviour is instructed nowhere
    // (then the checkpoint measures the model's prior knowledge) or nobody has looked
    // (then the first failure pays for it).
    if (entry.anchors.length === 0) unanchored.push(entry.checkpoint);
  }

  const unmappedCheckpoints = [...checkpointIds].filter((id) => !seen.has(id)).sort();

  const untestedSections: UntestedSection[] = [];
  for (const [file, { headings }] of skill) {
    for (const heading of headings) {
      if (!anchoredSections.has(`${file}\x00${heading}`)) untestedSections.push({ file, heading });
    }
  }

  const ok =
    unmappedCheckpoints.length === 0 &&
    staleCheckpoints.length === 0 &&
    staleAnchors.length === 0 &&
    duplicateEntries.length === 0 &&
    invalidEntries.length === 0 &&
    // Not downgradable to a warning — that is the whole point of the change.
    unanchored.length === 0 &&
    (!options.requireClassified || unmeasured.length === 0);

  return {
    unmappedCheckpoints,
    staleCheckpoints,
    staleAnchors,
    duplicateEntries,
    invalidEntries,
    unanchored,
    unmeasured,
    untestedSections,
    ok,
  };
}

async function walkMarkdown(dir: string, root: string, out: string[]): Promise<void> {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) await walkMarkdown(path, root, out);
    else if (dirent.name.endsWith(".md")) out.push(path);
  }
}

/** Prompt-section headings (`# X`) inside the identity prompt's template literal. */
function extractPromptHeadings(content: string): string[] {
  return [...content.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)].map((m) => m[1]!.trim());
}

function sourceFile(content: string): ts.SourceFile {
  return ts.createSourceFile("channel.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function staticValue(
  node: ts.Node | undefined,
  resolve: (name: string) => unknown,
  locals: ReadonlyMap<string, unknown> = new Map()
): unknown {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return staticValue(node.expression, resolve, locals);
  }
  if (ts.isIdentifier(node)) return locals.has(node.text) ? locals.get(node.text) : resolve(node.text);
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map((element) => staticValue(element, resolve, locals));
    return values.some((value) => value === undefined) ? undefined : values;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      const item = staticValue(property.initializer, resolve, locals);
      if (name === null || item === undefined) return undefined;
      value[name] = item;
    }
    return value;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticValue(span.expression, resolve, locals);
      if (expression === undefined) return undefined;
      value += String(expression) + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticValue(node.left, resolve, locals);
    const right = staticValue(node.right, resolve, locals);
    return left === undefined || right === undefined ? undefined : String(left) + String(right);
  }
  if (ts.isElementAccessExpression(node)) {
    const target = staticValue(node.expression, resolve, locals);
    const key = staticValue(node.argumentExpression, resolve, locals);
    if (
      (Array.isArray(target) || (target && typeof target === "object")) &&
      (typeof key === "string" || typeof key === "number")
    ) {
      return (target as Record<string | number, unknown>)[key];
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const target = staticValue(node.expression, resolve, locals);
    return target && typeof target === "object" ? (target as Record<string, unknown>)[node.name.text] : undefined;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const target = staticValue(node.expression.expression, resolve, locals);
    const method = node.expression.name.text;
    if (method === "join" && Array.isArray(target)) {
      const separator = staticValue(node.arguments[0], resolve, locals);
      return separator === undefined && node.arguments.length > 0 ? undefined : target.join(String(separator ?? ","));
    }
    if (method === "map" && Array.isArray(target) && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      const arrow = node.arguments[0];
      const parameter = arrow.parameters[0];
      if (!parameter || !ts.isIdentifier(parameter.name) || ts.isBlock(arrow.body)) return undefined;
      const parameterName = parameter.name.text;
      const mapped = target.map((item) =>
        staticValue(arrow.body, resolve, new Map([...locals, [parameterName, item]]))
      );
      return mapped.some((item) => item === undefined) ? undefined : mapped;
    }
  }
  return undefined;
}

function staticBindings(content: string, seed: ReadonlyMap<string, unknown> = new Map()): Map<string, unknown> {
  const declarations = new Map<string, ts.Expression>();
  for (const statement of sourceFile(content).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer)
        declarations.set(declaration.name.text, declaration.initializer);
    }
  }
  const values = new Map(seed);
  const resolving = new Set<string>();
  const resolve = (name: string): unknown => {
    if (values.has(name)) return values.get(name);
    const declaration = declarations.get(name);
    if (!declaration || resolving.has(name)) return undefined;
    resolving.add(name);
    const value = staticValue(declaration, resolve);
    resolving.delete(name);
    if (value !== undefined) values.set(name, value);
    return value;
  };
  for (const name of declarations.keys()) resolve(name);
  return values;
}

function staticText(node: ts.Node | undefined, bindings: ReadonlyMap<string, unknown> = new Map()): string | null {
  const value = staticValue(node, (name) => bindings.get(name));
  return typeof value === "string" ? value : null;
}

function propertyNamed(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return node.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name))
  );
}

export function extractIdentityPromptSource(content: string): string | null {
  for (const statement of sourceFile(content).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "cbeIdentityPrompt") {
        return staticText(declaration.initializer);
      }
    }
  }
  return null;
}

export function extractToolBindingSource(
  content: string,
  toolName: string,
  importedBindings: ReadonlyMap<string, unknown> = new Map()
): string | null {
  const file = sourceFile(content);
  const bindings = staticBindings(content, importedBindings);

  const findDefinition = (node: ts.Node): ts.ObjectLiteralExpression | null => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineTool" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const candidate = node.arguments[0];
      if (staticText(propertyNamed(candidate, "name")?.initializer, bindings) === toolName) return candidate;
    }
    for (const child of node.getChildren()) {
      const found = findDefinition(child);
      if (found) return found;
    }
    return null;
  };
  const definition = findDefinition(file);
  if (!definition) return null;

  const parts: string[] = [];
  const description = staticText(propertyNamed(definition, "description")?.initializer, bindings);
  if (description) parts.push(description);

  const seen = new Set<ts.Node>();
  const collectDescriptions = (node: ts.Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const value = bindings.get(node.text);
      if (value && typeof value === "object") ts.forEachChild(node, collectDescriptions);
      const declaration = file.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === node.text);
      if (declaration?.initializer) collectDescriptions(declaration.initializer);
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyNamed(node.parent as ts.ObjectLiteralExpression, "description") === node
    ) {
      const text = staticText(node.initializer, bindings);
      if (text) parts.push(text);
      return;
    }
    ts.forEachChild(node, collectDescriptions);
  };
  const parameters = propertyNamed(definition, "parameters")?.initializer;
  if (parameters) collectDescriptions(parameters);
  return parts.join("\n");
}

/**
 * Load the live CHANNEL tree: every markdown file under `skills/cbe/` (keyed by its
 * relative path), plus `prompt:identity-prompt` and one `tool:<name>` entry per
 * registered `cbe_*` tool.
 *
 * `bridgeSrcDir` defaults to `packages/pi-bridge/src` relative to the skill dir's repo
 * root, so the ordinary call site needs no extra argument.
 */
export async function loadSkillTree(skillDir: string, bridgeSrcDir?: string): Promise<SkillTree> {
  const files: string[] = [];
  await walkMarkdown(skillDir, skillDir, files);
  const tree: SkillTree = new Map();
  for (const path of files.sort()) {
    const rel = relative(skillDir, path).replace(/\\/g, "/");
    // `references/ui-guide.md` is a GENERATED artefact of the untouched capability
    // `ui-reference-generation`, not an instruction channel: the skill body's pointer to
    // it was removed with the reference tree. Including it here would report each of its
    // 20 generated headings as an untested passage on every run.
    if (rel.startsWith("references/")) continue;
    const content = await readFile(path, "utf8");
    tree.set(rel, { headings: extractHeadings(content), content });
  }

  const bridge = bridgeSrcDir ?? join(skillDir, "..", "..", "packages", "pi-bridge", "src");
  const readOr = async (p: string): Promise<string | null> => {
    try {
      return await readFile(p, "utf8");
    } catch {
      return null;
    }
  };

  const promptSource = await readOr(join(bridge, "cbe-system-prompt.ts"));
  if (promptSource !== null) {
    const prompt = extractIdentityPromptSource(promptSource);
    if (prompt !== null) {
      tree.set("prompt:identity-prompt", { headings: extractPromptHeadings(prompt), content: prompt });
    }
  }

  // One entry per REGISTERED tool. `cbe_decision_checklist` is deliberately absent: it
  // is de-registered, so a checkpoint may not anchor into it.
  const TOOLS: Record<string, string> = {
    cbe_picker: "picker-tool.ts",
    cbe_canvas: "canvas-tool.ts",
    cbe_step: "step-tool.ts",
    cbe_maturity: "maturity-tool.ts",
    cbe_profile: "profile-tool.ts",
    cbe_cite: "cite-tool.ts",
    // Change `recalibrate-tutor-support`: S13's preference probes anchor into the support
    // tool's operating rules (explicit-instruction-only writes, one-off vs lasting).
    cbe_support: "support-tool.ts",
  };
  for (const [name, fileName] of Object.entries(TOOLS)) {
    const src = await readOr(join(bridge, fileName));
    if (src === null) continue;
    let importedBindings = new Map<string, unknown>();
    for (const statement of sourceFile(src).statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const dependency = await readOr(join(bridge, specifier.replace(/^\.\//, "").replace(/\.js$/, ".ts")));
      if (dependency !== null) importedBindings = staticBindings(dependency, importedBindings);
    }
    const bindingSource = extractToolBindingSource(src, name, importedBindings);
    if (bindingSource !== null) tree.set(`tool:${name}`, { headings: [], content: bindingSource });
  }
  return tree;
}

export interface SuiteCheckpoints {
  ids: Set<string>;
  scenarioFileByCheckpoint: Map<string, string>;
}

/** Collect suite-unique checkpoint ids from the live scenario files via the runner loader. */
export async function collectSuiteCheckpoints(
  scenariosDir: string,
  corpusIndexPath: string
): Promise<SuiteCheckpoints> {
  const corpusIds = loadCorpusIds(corpusIndexPath);
  const ids = new Set<string>();
  const scenarioFileByCheckpoint = new Map<string, string>();
  const files = (await readdir(scenariosDir)).filter((f) => f.endsWith(".md")).sort();
  for (const file of files) {
    const scenarioNumber = /^(\d+)/.exec(file)?.[1];
    if (!scenarioNumber) continue;
    const probes = await loadProbesFromFile(join(scenariosDir, file), corpusIds, { onWarn: () => {} });
    for (const probe of probes) {
      for (const cp of probe.checkpoints) {
        const id = fullCheckpointId(scenarioNumber, probe.probe, cp.id);
        ids.add(id);
        scenarioFileByCheckpoint.set(id, file);
      }
    }
  }
  return { ids, scenarioFileByCheckpoint };
}

/** Load and validate the map file. */
export async function loadTraceabilityMap(mapPath: string): Promise<TraceEntry[]> {
  const raw = JSON.parse(await readFile(mapPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${mapPath}: traceability map must be a JSON array of entries`);
  return raw as TraceEntry[];
}
