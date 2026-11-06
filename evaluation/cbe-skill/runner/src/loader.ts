/**
 * Scenario loader: extracts the fenced ```yaml``` block keyed `eval:` from a
 * scenario `.md`, validates it, and returns typed `Probe`s. Corpus ids are
 * resolved against `corpus/index.json`. A prose-vs-eval drift warning fires when
 * the number of prose pass-criteria checkboxes differs from the checkpoint count.
 *
 * No LLM, no network — pure parsing, safe to run inside `npm test`.
 */

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { extractHeadings } from "@cbe/pi-bridge/citation-verification";
import type { Checkpoint, CheckpointAnchor, DeterministicKind, Probe, ProbeSetup } from "./types.js";
import { IMPLEMENTED_DETERMINISTIC_KINDS } from "./types.js";

export class EvalValidationError extends Error {
  constructor(
    message: string,
    readonly file: string
  ) {
    super(`${file}: ${message}`);
    this.name = "EvalValidationError";
  }
}

const FENCED_YAML = /```ya?ml\s*\n([\s\S]*?)```/g;
const CHECKBOX_LINE = /^\s*[-*]\s+\[[ xX]\]/;

interface CorpusIndexDocument {
  id: string;
  path: string;
}

function loadCorpusIndex(corpusIndexPath: string): CorpusIndexDocument[] {
  const idx = JSON.parse(readFileSync(corpusIndexPath, "utf8")) as { documents?: CorpusIndexDocument[] };
  return idx.documents ?? [];
}

/** Load the set of valid corpus ids from a corpus index.json. */
export function loadCorpusIds(corpusIndexPath: string): Set<string> {
  return new Set(loadCorpusIndex(corpusIndexPath).map((d) => d.id));
}

/** Resolve each corpus id to the canonical absolute document path declared by the index. */
export function loadCorpusPaths(corpusIndexPath: string): Map<string, string> {
  const corpusRoot = dirname(corpusIndexPath);
  return new Map(loadCorpusIndex(corpusIndexPath).map((d) => [d.id, resolve(corpusRoot, d.path)]));
}

/**
 * Resolve each corpus id to its document's ATX headings, read once at startup.
 *
 * Feeds `cite_section_resolves` (capability `cbe-skill-eval-harness`, Requirement: *An
 * Invented Citation Section Is Caught Deterministically*). The extraction is the SHARED
 * one `cbe_cite`'s section gate uses, so a section the tool would accept can never be
 * failed by the eval — hence the pure `@cbe/pi-bridge/citation-verification` subpath,
 * which carries no Pi import and so does not pull the runtime into the checker.
 *
 * An unreadable document yields an empty heading list rather than throwing: a corpus
 * file the loader cannot open is a corpus problem, and it must not abort a whole run.
 */
export function loadCorpusHeadings(corpusIndexPath: string): Map<string, string[]> {
  const corpusRoot = dirname(corpusIndexPath);
  const out = new Map<string, string[]>();
  for (const doc of loadCorpusIndex(corpusIndexPath)) {
    let raw: string;
    try {
      raw = readFileSync(resolve(corpusRoot, doc.path), "utf8");
    } catch {
      out.set(doc.id, []);
      continue;
    }
    out.set(doc.id, extractHeadings(stripFrontmatter(raw)));
  }
  return out;
}

/**
 * Drop a leading `---` frontmatter block so a `#`-prefixed line inside it cannot be
 * read as a heading. Deliberately NOT gray-matter: the runner must stay dependency-light
 * and this is the same rule `packages/corpus-schema/src/validate.ts` applies.
 */
function stripFrontmatter(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text : text.slice(end + 4);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Find the single fenced yaml block whose top-level key is `eval`. */
function extractEvalBlock(content: string, file: string): Record<string, unknown> {
  const matches: Record<string, unknown>[] = [];
  for (const m of content.matchAll(FENCED_YAML)) {
    let parsed: unknown;
    try {
      parsed = yaml.load(m[1]!);
    } catch (err) {
      // A fenced yaml block that fails to parse is only an error if it is meant
      // to be the eval block — but we cannot know without parsing. If it textually
      // contains an `eval:` key, treat the parse failure as fatal.
      if (/^\s*eval\s*:/m.test(m[1]!)) {
        throw new EvalValidationError(`eval: block is not valid YAML (${(err as Error).message})`, file);
      }
      continue;
    }
    if (isObject(parsed) && "eval" in parsed) matches.push(parsed);
  }
  if (matches.length === 0) {
    throw new EvalValidationError("no fenced ```yaml``` block with an `eval:` key found", file);
  }
  if (matches.length > 1) {
    throw new EvalValidationError("more than one `eval:` block found; expected exactly one", file);
  }
  return matches[0]!;
}

function requireField<T>(value: T | undefined, field: string, file: string, probe?: string): T {
  if (value === undefined || value === null) {
    const where = probe ? `probe "${probe}"` : "eval block";
    throw new EvalValidationError(`${where} is missing required field "${field}"`, file);
  }
  return value;
}

const ANCHOR_CHANNELS = new Set(["skill", "prompt", "tool"]);

/**
 * Parse a checkpoint's anchors. AT LEAST ONE IS MANDATORY (capability
 * `cbe-skill-eval-harness`, Requirement: *Scenario files carry a machine-executable
 * checkpoint block*): "A checkpoint without an anchor does not ship."
 *
 * Accepts the compact string form `"<channel>:<file>#<heading>"` as well as the object
 * form, because a scenario file is hand-written YAML and the compact form keeps the
 * block readable.
 */
function validateAnchors(raw: unknown, id: string, file: string, probeId: string): CheckpointAnchor[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  if (list.length === 0) {
    throw new EvalValidationError(
      `checkpoint "${id}" carries no anchor — every checkpoint must name the channel and passage that governs it ` +
        `(the previous suite ran with 234 of 296 unanchored, so a failure could not be routed to its cause)`,
      file
    );
  }
  return list.map((entry) => {
    let channel: unknown;
    let anchorFile: unknown;
    let heading: unknown;
    if (typeof entry === "string") {
      const m = /^([a-z]+):([^#]+)#(.+)$/.exec(entry.trim());
      if (!m) {
        throw new EvalValidationError(
          `checkpoint "${id}" has a malformed anchor "${entry}" (expected "<channel>:<file>#<heading>")`,
          file
        );
      }
      [, channel, anchorFile, heading] = m;
    } else if (isObject(entry)) {
      ({ channel, file: anchorFile, heading } = entry as Record<string, unknown>);
    } else {
      throw new EvalValidationError(`checkpoint "${id}" has a non-object, non-string anchor`, file);
    }
    if (typeof channel !== "string" || !ANCHOR_CHANNELS.has(channel)) {
      throw new EvalValidationError(
        `checkpoint "${id}" anchor names unknown channel "${String(channel)}" (expected skill|prompt|tool)`,
        file
      );
    }
    if (typeof anchorFile !== "string" || anchorFile.length === 0) {
      throw new EvalValidationError(`checkpoint "${id}" anchor is missing its file/tool name`, file);
    }
    if (typeof heading !== "string" || heading.length === 0) {
      throw new EvalValidationError(`checkpoint "${id}" anchor is missing its heading/marker`, file);
    }
    void probeId;
    return { channel: channel as CheckpointAnchor["channel"], file: anchorFile, heading };
  });
}

function validateCheckpoint(raw: unknown, probeId: string, file: string, corpusIds: Set<string>): Checkpoint {
  if (!isObject(raw)) throw new EvalValidationError(`probe "${probeId}" has a non-object checkpoint`, file);
  const id = requireField(raw.id as string | undefined, "checkpoint.id", file, probeId);
  const type = requireField(raw.type as string | undefined, `checkpoint "${id}".type`, file, probeId);
  if (type !== "deterministic" && type !== "judge") {
    throw new EvalValidationError(`checkpoint "${id}" has invalid type "${type}" (expected deterministic|judge)`, file);
  }
  const cp: Checkpoint = { id, type, anchors: validateAnchors(raw.anchor ?? raw.anchors, id, file, probeId) };
  if (typeof raw.turn === "number") cp.turn = raw.turn;
  if (type === "deterministic") {
    const check = requireField(
      raw.check as Record<string, unknown> | undefined,
      `checkpoint "${id}".check`,
      file,
      probeId
    );
    const kind = requireField(check.kind as string | undefined, `checkpoint "${id}".check.kind`, file, probeId);
    // Requirement: *A Deterministic Checkpoint Is Backed by an Implemented Check*. A
    // deterministic checkpoint whose kind the runner does not know would score `error`
    // at run time — after the model calls have been paid for — so it is rejected here.
    if (!(IMPLEMENTED_DETERMINISTIC_KINDS as readonly string[]).includes(kind)) {
      throw new EvalValidationError(
        `checkpoint "${id}" is deterministic with unknown check kind "${kind}" — ` +
          `implement the kind or type the checkpoint "judge" (implemented: ${IMPLEMENTED_DETERMINISTIC_KINDS.join(", ")})`,
        file
      );
    }
    cp.check = {
      kind: kind as DeterministicKind,
      ids: Array.isArray(check.ids) ? (check.ids as string[]) : undefined,
      tool: typeof check.tool === "string" ? check.tool : undefined,
      arg: typeof check.arg === "string" ? check.arg : undefined,
      pattern: typeof check.pattern === "string" ? check.pattern : undefined,
    };
    // `tool_arg_matches` reads ONE named argument off ONE tool. Without both names the
    // check would silently compare `undefined` and fail every run, so it is rejected at
    // load rather than after the model calls have been paid for.
    if (cp.check.kind === "tool_arg_matches" && (!cp.check.tool || !cp.check.arg || !cp.check.pattern)) {
      throw new EvalValidationError(
        `checkpoint "${id}" is tool_arg_matches and needs check.tool, check.arg and check.pattern`,
        file
      );
    }
    // cite_all ids must reference real corpus documents.
    for (const cid of cp.check.ids ?? []) {
      if (!corpusIds.has(cid)) {
        throw new EvalValidationError(`checkpoint "${id}" references unknown corpus id "${cid}"`, file);
      }
    }
  } else {
    cp.rubric = requireField(raw.rubric as string | undefined, `checkpoint "${id}".rubric`, file, probeId);
  }
  return cp;
}

/**
 * Validate a probe's `setup.lecturerState` — the two-layer Lecturer-State prior
 * (capability `cbe-skill-eval-harness`, Requirement: *A Probe Reproduces the App's
 * Session Priors, and Every Divergence Is Declared*). An invalid shape is rejected
 * HERE, at load, before any candidate token is spent — the same discipline as an
 * unknown deterministic check kind. All four fields are required strings, mirroring
 * `LecturerStateLayers` in `packages/pi-bridge/src/environment.ts`.
 */
function validateLecturerState(raw: unknown, file: string, probeId: string): ProbeSetup["lecturerState"] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const fields = ["globalPath", "globalContent", "overlayPath", "overlayContent"] as const;
  if (!isObject(raw) || !fields.every((f) => typeof raw[f] === "string")) {
    throw new EvalValidationError(
      `probe "${probeId}" has an invalid setup.lecturerState — expected the two-layer shape ` +
        `{ ${fields.join(", ")} }, all four strings (global profile plus per-course overlay)`,
      file
    );
  }
  const known = new Set<string>(fields);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new EvalValidationError(
        `probe "${probeId}" has an unknown setup.lecturerState field "${key}" (expected only ${fields.join(", ")})`,
        file
      );
    }
  }
  return raw as ProbeSetup["lecturerState"];
}

/**
 * Validate `setup.lecturerSupport` — the separate support-preference seed (capability
 * `agent-harness`, Requirement: *Separate Lecturer-Wide Support Preference*). Rejected
 * HERE, at load, like every other prior: a value outside the fixed set, a malformed
 * revision, an unknown scope or a foreign key would otherwise surface as a session
 * whose descriptor silently says "none recorded", and the probe would grade the wrong
 * condition. `preference` must be present (null states "nothing recorded" explicitly).
 */
function validateLecturerSupport(
  raw: unknown,
  file: string,
  probeId: string
): ProbeSetup["lecturerSupport"] | undefined {
  if (raw === undefined) return undefined;
  const fields = ["preference", "revision", "scope"] as const;
  const fail = (why: string): never => {
    throw new EvalValidationError(`probe "${probeId}" has an invalid setup.lecturerSupport — ${why}`, file);
  };
  if (!isObject(raw)) return fail("expected an object { preference, revision?, scope? }");
  for (const key of Object.keys(raw)) {
    if (!(fields as readonly string[]).includes(key))
      fail(`unknown field "${key}" (expected only ${fields.join(", ")})`);
  }
  if (!("preference" in raw)) fail("preference is required (guided|collaborative|concise, or null for none)");
  const preference = raw.preference;
  if (preference !== null && !["guided", "collaborative", "concise"].includes(preference as string)) {
    fail(`preference "${String(preference)}" is not one of guided|collaborative|concise|null`);
  }
  const revision = raw.revision;
  if (revision !== undefined && !(typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0)) {
    fail(`revision must be a non-negative integer, got ${JSON.stringify(revision)}`);
  }
  const scope = raw.scope;
  if (scope !== undefined && scope !== "lecturer-wide" && scope !== "session-local") {
    fail(`scope "${String(scope)}" is not lecturer-wide|session-local`);
  }
  return raw as unknown as ProbeSetup["lecturerSupport"];
}

/** Validate `setup.decisionsSummary`: a string, or absent. Same load-time discipline. */
function validateDecisionsSummary(raw: unknown, file: string, probeId: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new EvalValidationError(
      `probe "${probeId}" has an invalid setup.decisionsSummary — expected a string (the pre-summarised decisions line)`,
      file
    );
  }
  return raw;
}

function validateProbe(raw: unknown, file: string, corpusIds: Set<string>): Probe {
  if (!isObject(raw)) throw new EvalValidationError("a probe entry is not an object", file);
  const probeId = requireField(raw.probe as string | undefined, "probe", file);
  const setupRaw = requireField(raw.setup as Record<string, unknown> | undefined, "setup", file, probeId);
  const profile = requireField(setupRaw.profile as string | undefined, "setup.profile", file, probeId);
  if (profile !== "app" && profile !== "headless") {
    throw new EvalValidationError(`probe "${probeId}" has invalid setup.profile "${profile}"`, file);
  }
  const setup: ProbeSetup = {
    profile,
    affordances: isObject(setupRaw.affordances) ? (setupRaw.affordances as Record<string, boolean>) : undefined,
    corpus: Array.isArray(setupRaw.corpus) ? (setupRaw.corpus as string[]) : undefined,
    lecturerProfile: isObject(setupRaw.lecturerProfile)
      ? (setupRaw.lecturerProfile as Record<string, unknown>)
      : undefined,
    lecturerIdentity: isObject(setupRaw.lecturerIdentity)
      ? (setupRaw.lecturerIdentity as Record<string, unknown>)
      : undefined,
    lecturerSupport: validateLecturerSupport(setupRaw.lecturerSupport, file, probeId),
    wikiFixture: isObject(setupRaw.wikiFixture) ? (setupRaw.wikiFixture as Record<string, string>) : undefined,
    courseContext: typeof setupRaw.courseContext === "string" ? setupRaw.courseContext : undefined,
    canvasArtefacts:
      Array.isArray(setupRaw.canvasArtefacts) && setupRaw.canvasArtefacts.every(isObject)
        ? (setupRaw.canvasArtefacts as Array<Record<string, unknown>>)
        : undefined,
    stepCoverage:
      Array.isArray(setupRaw.stepCoverage) && setupRaw.stepCoverage.every(isObject)
        ? (setupRaw.stepCoverage as Array<Record<string, unknown>>)
        : undefined,
    maturity: isObject(setupRaw.maturity) ? (setupRaw.maturity as Record<string, unknown>) : undefined,
    lecturerState: validateLecturerState(setupRaw.lecturerState, file, probeId),
    decisionsSummary: validateDecisionsSummary(setupRaw.decisionsSummary, file, probeId),
  };
  for (const cid of setup.corpus ?? []) {
    if (!corpusIds.has(cid)) {
      throw new EvalValidationError(`probe "${probeId}" references unknown corpus id "${cid}"`, file);
    }
  }
  const turnsRaw = requireField(raw.turns as unknown[] | undefined, "turns", file, probeId);
  if (!Array.isArray(turnsRaw) || turnsRaw.length === 0 || !turnsRaw.every((t) => typeof t === "string")) {
    throw new EvalValidationError(`probe "${probeId}".turns must be a non-empty list of strings`, file);
  }
  const checkpointsRaw = requireField(raw.checkpoints as unknown[] | undefined, "checkpoints", file, probeId);
  if (!Array.isArray(checkpointsRaw) || checkpointsRaw.length === 0) {
    throw new EvalValidationError(`probe "${probeId}".checkpoints must be a non-empty list`, file);
  }
  const checkpoints = checkpointsRaw.map((c) => validateCheckpoint(c, probeId, file, corpusIds));
  const seen = new Set<string>();
  for (const cp of checkpoints) {
    if (seen.has(cp.id))
      throw new EvalValidationError(`probe "${probeId}" has duplicate checkpoint id "${cp.id}"`, file);
    seen.add(cp.id);
  }
  return { probe: probeId, scenarioFile: file, setup, turns: turnsRaw as string[], checkpoints };
}

export interface LoadOptions {
  /** Called once per drift warning. Defaults to console.warn. */
  onWarn?: (message: string) => void;
  resolveAnchor?: (anchor: CheckpointAnchor) => "missing-file" | "missing-heading" | null;
}

/** Parse the eval block of a scenario file into typed probes. */
export function parseProbes(content: string, file: string, corpusIds: Set<string>, opts: LoadOptions = {}): Probe[] {
  const block = extractEvalBlock(content, file);
  const evalSection = block.eval;
  if (!isObject(evalSection)) throw new EvalValidationError("`eval:` must be a mapping", file);
  const probesRaw = requireField(evalSection.probes as unknown[] | undefined, "eval.probes", file);
  if (!Array.isArray(probesRaw) || probesRaw.length === 0) {
    throw new EvalValidationError("eval.probes must be a non-empty list", file);
  }
  const probes = probesRaw.map((p) => validateProbe(p, file, corpusIds));
  if (opts.resolveAnchor) {
    for (const probe of probes) {
      for (const checkpoint of probe.checkpoints) {
        for (const anchor of checkpoint.anchors) {
          const reason = opts.resolveAnchor(anchor);
          if (reason) {
            throw new EvalValidationError(
              `checkpoint "${checkpoint.id}" anchor does not resolve: ${anchor.channel}:${anchor.file}#${anchor.heading} (${reason})`,
              file
            );
          }
        }
      }
    }
  }

  // Prose-vs-eval drift warning: compare prose checkbox count to checkpoint count.
  // Count checkboxes outside fenced code so the eval block's own lines never count.
  const proseCheckboxes = countProseCheckboxes(content);
  const checkpointTotal = probes.reduce((n, p) => n + p.checkpoints.length, 0);
  if (proseCheckboxes !== checkpointTotal) {
    const warn = opts.onWarn ?? ((m: string) => console.warn(m));
    warn(`${file}: expected ${proseCheckboxes} checkpoints matching prose, found ${checkpointTotal}`);
  }
  return probes;
}

/** Count `- [ ]` / `- [x]` checkbox lines that sit OUTSIDE any fenced code block. */
export function countProseCheckboxes(content: string): number {
  let inFence = false;
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && CHECKBOX_LINE.test(line)) count++;
  }
  return count;
}

/** Read + parse a scenario file from disk. */
export async function loadProbesFromFile(
  filePath: string,
  corpusIds: Set<string>,
  opts: LoadOptions = {}
): Promise<Probe[]> {
  const content = await readFile(filePath, "utf8");
  return parseProbes(content, filePath, corpusIds, opts);
}
