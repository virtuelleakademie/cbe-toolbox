/**
 * Editor agent: proposes a targeted change to one `skills/cbe/` file to address
 * failing checkpoints. Enforces three guards before a change can be kept:
 *   1. target_file allowlist (only SKILL.md or references/*.md under skills/cbe/)
 *   2. only the named target_file actually changes on disk
 *   3. didactic non-negotiables / anti-sycophancy / citation-grounding survive
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CheckResult } from "./types.js";
import type { LlmClient } from "./judge-client.js";
import type { SkillIO } from "./skill-io.js";

export interface EditorProposal {
  target_file: string;
  change: string;
  editor_reasoning: string;
}

export type EditorOutcome = { ok: true; proposal: EditorProposal } | { ok: false; reason: string };

const SYSTEM = "You are a careful skill editor. You output only the requested delimited reply.";

const BEGIN = "---BEGIN FILE CONTENT---";
const END = "---END FILE CONTENT---";

/**
 * Parse the editor's delimited reply. The full file content lives between
 * BEGIN/END sentinels rather than inside a JSON string, so arbitrary characters
 * (quotes, braces, newlines) survive without escaping — the failure mode that
 * broke a JSON-embedded `change` field. Returns null if the markers are missing.
 */
export function parseEditorReply(reply: string): EditorProposal | null {
  const begin = reply.indexOf(BEGIN);
  const end = reply.indexOf(END, begin + BEGIN.length);
  if (begin === -1 || end === -1) return null;
  const header = reply.slice(0, begin);
  const tm = /TARGET_FILE:[ \t]*(.+)/.exec(header);
  if (!tm) return null;
  const target_file = tm[1]!.trim();
  const rm = /EDITOR_REASONING:[ \t]*([\s\S]*)/.exec(header);
  const editor_reasoning = rm ? rm[1]!.trim() : "";
  const contentStart = reply.indexOf("\n", begin) + 1;
  // Drop exactly one newline separating the content from the END marker line.
  const change = reply.slice(contentStart, end).replace(/\r?\n$/, "");
  return { target_file, change, editor_reasoning };
}

let cachedTemplate: string | undefined;
export function loadEditorTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const here = path.dirname(fileURLToPath(import.meta.url));
  cachedTemplate = readFileSync(path.join(here, "..", "templates", "editor-prompt.md"), "utf8");
  return cachedTemplate;
}

/** Allowlist: SKILL.md or any references/*.md, and never an escaping path. */
export function isAllowedTarget(rel: string): boolean {
  if (rel.includes("..") || path.isAbsolute(rel)) return false;
  const norm = rel.replace(/\\/g, "/");
  return norm === "SKILL.md" || /^references\/.+\.md$/.test(norm);
}

const GUARDED_SKILL_SECTIONS = ["## Non-negotiables", "## Citing", "## Stance"];
const MIN_SECTION_CHARS = 150;

function sectionBody(content: string, header: string): string | null {
  const idx = content.indexOf(header);
  if (idx === -1) return null;
  const after = content.slice(idx + header.length);
  const next = after.search(/\n## /);
  return next === -1 ? after : after.slice(0, next);
}

/**
 * Reject changes that delete, empty, or weaken the non-negotiable guardrails.
 * Returns the list of violations (empty = ok).
 */
export function checkNonNegotiables(rel: string, newContent: string, oldContent: string): string[] {
  const norm = rel.replace(/\\/g, "/");
  const violations: string[] = [];
  if (norm === "SKILL.md") {
    for (const header of GUARDED_SKILL_SECTIONS) {
      const body = sectionBody(newContent, header);
      if (body === null) violations.push(`SKILL.md no longer contains "${header}"`);
      else if (body.trim().length < MIN_SECTION_CHARS)
        violations.push(`section "${header}" weakened below ${MIN_SECTION_CHARS} chars`);
    }
  } else if (/^references\/(non-negotiables|checks\/(anti-sycophancy|citation-grounding))/.test(norm)) {
    if (newContent.trim().length === 0) violations.push(`${norm} was emptied`);
    else if (newContent.length < oldContent.length * 0.5)
      violations.push(`${norm} shrank below half its original length`);
  }
  return violations;
}

/**
 * Surgical-edit guard. The editor returns the COMPLETE file, so an LLM "fixing" a
 * checkpoint tends to bloat it (restated rules, extra examples, whole-section
 * rewrites). A larger skill consumes the runtime model's context and degrades it,
 * so reject edits that grow a file beyond a surgical bound. Shrinking is always
 * allowed. Returns the list of violations (empty = ok).
 */
const MAX_EDIT_ADDED_CHARS = 1500;
const MAX_EDIT_GROWTH_FACTOR = 1.5;
const GROWTH_FACTOR_MIN_BASE = 1000; // only apply the ratio guard to non-tiny files

/**
 * The frontmatter-stripped body's documented budget (capability `agent-harness`,
 * Requirement: *Eager Skill-Body Instruction Budget*). Duplicated as a constant here
 * rather than imported from `@cbe/pi-bridge`, because importing that package pulls the
 * pi runtime into `npm test`, which this runner is deliberately built to avoid. The
 * value is asserted against the source of truth in `tests/editor.test.ts`.
 *
 * TEMPORARILY LIFTED to 18,000 alongside the harness constant (product decision
 * 2026-08-10); the basis is stated in full where it is declared, in
 * `packages/pi-bridge/src/cbe-system-prompt.ts`. Both values must move together or the
 * source-of-truth assertion fails. Raised to 19,000 with it on 2026-10-13
 * (`recalibrate-tutor-support`, product decision; basis at the harness declaration).
 */
export const SKILL_BODY_BUDGET = 19000;

/** Frontmatter-stripped length, measured the way the harness injects the body. */
function bodyLength(content: string): number {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized.length;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return normalized.length;
  return normalized.slice(end + 4).trim().length;
}

/**
 * Two APPLY-TIME GUARDS the rebuilt surface needs, because an editor can break its
 * invariants silently (capability `cbe-skill-eval-harness`, Requirement: *Editor edits
 * are surgical*).
 *
 *  1. An edit that pushes the body over its documented budget is rejected.
 *  2. An edit that introduces a `cbe_*` token into the body is rejected. An editor
 *     answering a failing tool-related checkpoint WILL reach for the tool name — that is
 *     the same pressure a human author is under, and the guard is the same answer
 *     (capability `agent-harness`, Requirement: *Instruction Channel Boundary*).
 *
 * A rejection reverts the edit, feeds the reason into the next attempt's prompt, and
 * continues within the iteration budget rather than aborting the campaign.
 */
export function checkChannelInvariants(rel: string, newContent: string): string[] {
  if (rel.replace(/\\/g, "/") !== "SKILL.md") return [];
  const violations: string[] = [];
  const len = bodyLength(newContent);
  if (len >= SKILL_BODY_BUDGET) {
    violations.push(
      `pushes the frontmatter-stripped skill body to ${len} chars, over its documented budget of ${SKILL_BODY_BUDGET}`
    );
  }
  const tools = [...new Set(newContent.match(/cbe_[a-z_]+/g) ?? [])];
  if (tools.length > 0) {
    violations.push(
      `introduces tool name(s) ${tools.join(", ")} into the skill body — the channel boundary keeps tool ` +
        `mechanics in the tool description, and the body names no tool`
    );
  }
  return violations;
}

export function checkEditSize(oldContent: string, newContent: string): string[] {
  const added = newContent.length - oldContent.length;
  if (added <= 0) return []; // shrinking / tightening is always surgical
  const violations: string[] = [];
  if (added > MAX_EDIT_ADDED_CHARS) {
    violations.push(`adds ${added} chars (max ${MAX_EDIT_ADDED_CHARS}); keep the edit surgical`);
  }
  if (oldContent.length >= GROWTH_FACTOR_MIN_BASE && newContent.length > oldContent.length * MAX_EDIT_GROWTH_FACTOR) {
    violations.push(
      `grows the file ${(newContent.length / oldContent.length).toFixed(1)}x (max ${MAX_EDIT_GROWTH_FACTOR}x); keep the edit surgical`
    );
  }
  return violations;
}

function renderFailures(failing: CheckResult[]): string {
  return failing.map((f) => `- ${f.id} (${f.verdict}): ${f.reasoning ?? f.evidence ?? ""}`).join("\n");
}

function renderSkillFiles(io: SkillIO): string {
  return io
    .list()
    .map((rel) => `### FILE: ${rel}\n\n${io.read(rel)}`)
    .join("\n\n");
}

export interface EditorDeps {
  client: LlmClient;
  template?: string;
}

/** Call the editor LLM, parse + allowlist-validate the proposal (does NOT apply it). */
export interface EditContext {
  /** Rejection reason from a prior attempt, fed back for a smaller retry. */
  priorRejection?: string;
  /** The targeted checkpoint's pass criterion. */
  rubric?: string;
  /** The candidate output that produced the failing verdict. */
  transcript?: string;
}

export async function proposeEdit(
  io: SkillIO,
  failing: CheckResult[],
  deps: EditorDeps,
  ctx: EditContext = {}
): Promise<EditorOutcome> {
  const template = deps.template ?? loadEditorTemplate();
  let user = template.replace("{{failures}}", renderFailures(failing)).replace("{{skill_files}}", renderSkillFiles(io));
  if (ctx.rubric) {
    user += `\n\n## What the targeted checkpoint requires (rubric)\n\n${ctx.rubric}`;
  }
  if (ctx.transcript) {
    user += `\n\n## What the candidate produced (this output FAILED the checkpoint)\n\n${ctx.transcript}`;
  }
  if (ctx.priorRejection) {
    user += `\n\n## Your previous attempt was REJECTED\n\n${ctx.priorRejection}\n\nProduce a SMALLER, strictly surgical edit that fixes the failing checkpoint without triggering this rejection.`;
  }
  let reply: string;
  try {
    reply = (await deps.client.complete(SYSTEM, user)).text;
  } catch (err) {
    return { ok: false, reason: `editor call failed: ${(err as Error).message}` };
  }
  const parsed = parseEditorReply(reply);
  if (!parsed) {
    return { ok: false, reason: "editor reply missing TARGET_FILE or BEGIN/END FILE CONTENT markers" };
  }
  if (!parsed.target_file || !parsed.change) {
    return { ok: false, reason: "editor proposal missing target_file or change content" };
  }
  if (!isAllowedTarget(parsed.target_file)) {
    return {
      ok: false,
      reason: `editor target_file "${parsed.target_file}" is out of bounds (only skills/cbe/ SKILL.md or references/*.md)`,
    };
  }
  return { ok: true, proposal: parsed };
}

export type ApplyOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Apply a validated proposal: enforce non-negotiables, write the target, and
 * verify ONLY the target changed. On any violation, restore and reject.
 */
export function applyEdit(io: SkillIO, proposal: EditorProposal): ApplyOutcome {
  if (!isAllowedTarget(proposal.target_file)) {
    return { ok: false, reason: `target_file "${proposal.target_file}" out of bounds` };
  }
  const before = io.snapshot();
  const old = io.read(proposal.target_file);
  const violations = checkNonNegotiables(proposal.target_file, proposal.change, old);
  if (violations.length) {
    return { ok: false, reason: `non-negotiable violation: ${violations.join("; ")}` };
  }
  const bloat = checkEditSize(old, proposal.change);
  if (bloat.length) {
    return { ok: false, reason: `edit not surgical: ${bloat.join("; ")}` };
  }
  const channel = checkChannelInvariants(proposal.target_file, proposal.change);
  if (channel.length) {
    return { ok: false, reason: `channel invariant violated: ${channel.join("; ")}` };
  }
  io.write(proposal.target_file, proposal.change);
  // Verify only the target changed.
  const after = io.snapshot();
  const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k));
  const addedOrRemoved = changed.length !== 1 || changed[0] !== proposal.target_file;
  if (addedOrRemoved) {
    io.restore(before);
    return { ok: false, reason: `edit changed files other than ${proposal.target_file}: ${changed.join(", ")}` };
  }
  return { ok: true };
}
