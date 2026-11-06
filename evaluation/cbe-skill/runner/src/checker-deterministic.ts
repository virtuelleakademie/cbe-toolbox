/**
 * Deterministic checkpoint scoring — pure code, no LLM. Emits only the verdicts
 * a deterministic check may produce: pass / fail / not-assessable / error.
 */

import { posix } from "node:path";
import type { Checkpoint, CheckResult, Probe, ToolInvocation, Transcript, TurnTranscript } from "./types.js";
import { allToolNames, fullAssistantText } from "./runner.js";
import { allCitedIds, canonicalCitedIds, isWellFormedToken } from "./check-canonical.js";
// The SHARED verifier — the same normalisation and heading match `cbe_cite`'s section
// gate uses, so a section the tool would accept can never be failed here. Imported from
// the pure subpath, which carries no Pi import (the package root would pull the runtime).
import { parseCitationToken, verifyCitation } from "@cbe/pi-bridge/citation-verification";

/** Tools whose emission depends on a UI affordance. `cbe_decision_checklist` is gone:
 *  it is de-registered and can no longer be emitted at all. */
const TOOL_AFFORDANCE: Record<string, string> = {
  cbe_picker: "picker",
  cbe_canvas: "canvas",
  cbe_step: "step",
  cbe_maturity: "maturity",
};

function affordanceEnabled(probe: Probe, affordance: string): boolean {
  const override = probe.setup.affordances?.[affordance];
  if (typeof override === "boolean") return override;
  // Profile default: the app exposes picker/canvas; headless does not.
  return probe.setup.profile === "app";
}

/**
 * Reason a checkpoint cannot be exercised by the probe as declared, or null if
 * it can. Covers: (a) a checkpoint targeting a turn the probe does not declare,
 * (b) a positive tool expectation whose affordance is disabled in the profile.
 */
export function notAssessableReason(cp: Checkpoint, probe: Probe): string | null {
  if (typeof cp.turn === "number" && cp.turn >= probe.turns.length) {
    return "checkpoint targets a turn the probe does not declare in turns[]";
  }
  if (cp.type === "deterministic" && (cp.check?.kind === "tool_called" || cp.check?.kind === "tool_arg_matches")) {
    const tool = cp.check.tool;
    const affordance = tool ? TOOL_AFFORDANCE[tool] : undefined;
    if (tool && affordance && !affordanceEnabled(probe, affordance)) {
      return `tool "${tool}" requires the ${affordance} affordance, which is disabled in this probe's profile`;
    }
  }
  return null;
}

/** Assistant text for the checkpoint's target turn (or all turns if unscoped). */
function scopedText(cp: Checkpoint, t: Transcript): string {
  if (typeof cp.turn === "number" && t.turns[cp.turn]) return t.turns[cp.turn]!.assistant;
  return fullAssistantText(t);
}

function scopedTools(cp: Checkpoint, t: Transcript): string[] {
  if (typeof cp.turn === "number" && t.turns[cp.turn]) return t.turns[cp.turn]!.tools.map((x) => x.name);
  return allToolNames(t);
}

/** Every invocation of `tool` in the checkpoint's scope, arguments included. */
function scopedInvocations(cp: Checkpoint, t: Transcript, tool: string): ToolInvocation[] {
  const turns = typeof cp.turn === "number" && t.turns[cp.turn] ? [t.turns[cp.turn]!] : t.turns;
  return turns.flatMap((turn) => turn.tools.filter((x) => x.name === tool));
}

/** One reading record off a `cbe_maturity` call, as the model wrote it. */
interface MaturityCallRecord {
  criterion?: unknown;
  current?: unknown;
  capped?: unknown;
}

/**
 * Flatten every `cbe_maturity` invocation into the reading records it carried.
 *
 * A call is either a batched `readings` array or ONE record whose fields sit at
 * the top level, and the rules these kinds measure hold for both — a model that
 * pushed an aggregate in a single call has broken the same rule as one that put
 * it in the batch. Nothing is validated here: the host validator is what accepts
 * or drops a field, and what this reads is what the model ATTEMPTED.
 */
function maturityRecords(calls: ToolInvocation[]): MaturityCallRecord[] {
  const out: MaturityCallRecord[] = [];
  for (const call of calls) {
    const args = call.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    const readings = (args as { readings?: unknown }).readings;
    if (Array.isArray(readings)) {
      for (const raw of readings) {
        if (raw && typeof raw === "object" && !Array.isArray(raw)) out.push(raw as MaturityCallRecord);
      }
      continue;
    }
    if ("criterion" in (args as Record<string, unknown>)) out.push(args as MaturityCallRecord);
  }
  return out;
}

function patternMatch(text: string, pattern: string): boolean {
  const re = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (re) return new RegExp(re[1]!, re[2]).test(text);
  return text.includes(pattern);
}

const result = (cp: Checkpoint, verdict: CheckResult["verdict"], extra: Partial<CheckResult> = {}): CheckResult => ({
  id: cp.id,
  type: "deterministic",
  verdict,
  ...extra,
});

export function checkDeterministic(
  cp: Checkpoint,
  transcript: Transcript,
  probe: Probe,
  corpusIds: Set<string>,
  corpusPaths: Map<string, string> = new Map(),
  corpusHeadings: Map<string, string[]> = new Map()
): CheckResult {
  const na = notAssessableReason(cp, probe);
  if (na) return result(cp, "not-assessable", { reasoning: na });

  const check = cp.check;
  if (!check) return result(cp, "error", { reasoning: "deterministic checkpoint has no check descriptor" });

  const text = scopedText(cp, transcript);

  switch (check.kind) {
    case "cite_all": {
      const cited = new Set(canonicalCitedIds(text));
      const missing = (check.ids ?? []).filter((id) => !cited.has(id));
      if (missing.length === 0) {
        return result(cp, "pass", { reasoning: `all required ids cited canonically: ${(check.ids ?? []).join(", ")}` });
      }
      return result(cp, "fail", { reasoning: `missing canonical citation(s): ${missing.join(", ")}` });
    }
    case "cite_none_outside_corpus": {
      const outside = [...new Set(allCitedIds(text).filter((id) => !corpusIds.has(id)))];
      if (outside.length === 0) return result(cp, "pass", { reasoning: "no cited id falls outside the corpus" });
      return result(cp, "fail", { reasoning: `cited id(s) absent from corpus: ${outside.join(", ")}` });
    }
    case "tool_called": {
      const tools = scopedTools(cp, transcript);
      return tools.includes(check.tool ?? "")
        ? result(cp, "pass", { evidence: check.tool, reasoning: `tool "${check.tool}" was invoked` })
        : result(cp, "fail", { reasoning: `tool "${check.tool}" was not invoked` });
    }
    case "tool_not_called": {
      const tools = scopedTools(cp, transcript);
      return tools.includes(check.tool ?? "")
        ? result(cp, "fail", { reasoning: `tool "${check.tool}" was invoked but should not have been` })
        : result(cp, "pass", { reasoning: `tool "${check.tool}" was not invoked` });
    }
    // A mirroring tool's SUBSTANCE, not merely its emission. `tool_called` cannot see
    // what was written and the judge is handed tool names only, so without this kind a
    // rule about the CONTENT of a canvas value had no instrument at all.
    case "tool_arg_matches": {
      const tool = check.tool ?? "";
      const arg = check.arg ?? "";
      const pattern = check.pattern ?? "";
      const calls = scopedInvocations(cp, transcript, tool);
      if (calls.length === 0) {
        return result(cp, "fail", { reasoning: `tool "${tool}" was not invoked, so its "${arg}" cannot match` });
      }
      const values = calls
        .map((call) => (call.args as Record<string, unknown> | undefined)?.[arg])
        .filter((v): v is string => typeof v === "string");
      if (values.length === 0) {
        // The tool ran but never carried the argument — a real miss, not an instrument
        // gap: a `cbe_canvas` set without a `value` is refused host-side anyway.
        return result(cp, "fail", { reasoning: `no "${tool}" call carried a string argument "${arg}"` });
      }
      const hit = values.find((v) => patternMatch(v, pattern));
      return hit === undefined
        ? result(cp, "fail", {
            evidence: values[0],
            reasoning: `no "${tool}" call's "${arg}" matched ${pattern} (${values.length} call(s) inspected)`,
          })
        : result(cp, "pass", { evidence: hit, reasoning: `"${tool}" argument "${arg}" matched ${pattern}` });
    }
    case "contains": {
      const pattern = check.pattern ?? "";
      return patternMatch(text, pattern)
        ? result(cp, "pass", { evidence: pattern })
        : result(cp, "fail", { reasoning: `expected pattern not found: ${pattern}` });
    }
    case "not_contains": {
      const pattern = check.pattern ?? "";
      return patternMatch(text, pattern)
        ? result(cp, "fail", { reasoning: `forbidden pattern present: ${pattern}` })
        : result(cp, "pass", { reasoning: `forbidden pattern absent: ${pattern}` });
    }
    // The two `cbe_maturity` payload-shape kinds (change
    // `show-target-and-derive-overall-maturity`). Both read the RECORDS a call
    // carried, in either shape — a batched `readings` array or a single record's
    // flat fields — because the rule holds for both and a model uses whichever
    // fits the turn.
    case "maturity_no_pushed_aggregate": {
      const records = maturityRecords(scopedInvocations(cp, transcript, "cbe_maturity"));
      const pushed = records.filter((r) => r.criterion === "overall" && r.current !== undefined);
      return pushed.length === 0
        ? result(cp, "pass", {
            reasoning: `no cbe_maturity call set an achieved level on the overall record (${records.length} record(s) inspected)`,
          })
        : result(cp, "fail", {
            evidence: JSON.stringify(pushed[0]),
            reasoning: `${pushed.length} overall record(s) carried a current level; the aggregate is derived by the host`,
          });
    }
    case "maturity_cap_marked": {
      const records = maturityRecords(scopedInvocations(cp, transcript, "cbe_maturity"));
      if (records.length === 0) {
        return result(cp, "fail", { reasoning: "cbe_maturity was not invoked, so no criterion could be marked" });
      }
      const capped = records.filter((r) => r.capped === true && r.criterion !== "overall");
      return capped.length > 0
        ? result(cp, "pass", {
            evidence: JSON.stringify(capped[0]),
            reasoning: `criterion "${String(capped[0]!.criterion)}" recorded as capped by a standing reservation`,
          })
        : result(cp, "fail", {
            reasoning: `no criterion carried the capping marker (${records.length} record(s) inspected)`,
          });
    }
    case "cite_section_resolves":
      return citeSectionResolves(cp, text, corpusHeadings);
    case "cite_provenance":
      return citeProvenance(cp, transcript, corpusPaths);
    case "cite_no_sham_attribution":
      return citeNoShamAttribution(cp, transcript, corpusIds, corpusPaths);
    case "reply_language":
      return replyLanguage(cp, transcript, check.pattern);
    case "no_trailing_menu": {
      const menu = trailingMenu(text);
      return menu
        ? result(cp, "fail", { evidence: menu, reasoning: `turn ends on a bare menu question: "${menu}"` })
        : result(cp, "pass", { reasoning: "the closing paragraph is not a bare menu question" });
    }
    default:
      // Unreachable in a loaded suite: the loader rejects an unimplemented kind
      // (Requirement: *A Deterministic Checkpoint Is Backed by an Implemented Check*).
      return result(cp, "error", { reasoning: `unknown deterministic kind "${(check as { kind?: string }).kind}"` });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// cite_section_resolves
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `(corpus:…)` token in a piece of text — the SECTION-TOLERANT enumeration.
 *
 * Neither `CORPUS_TOKEN` nor `ANY_CORPUS_TOKEN` can be reused. Both stop at the first
 * `)`, and the corpus really does carry a heading with parentheses
 * (`methodology-012 § "Step 3 — … (evidence first)"`), which `cbe_cite` puts into the
 * token verbatim — so both would truncate the very sections this check must read.
 * `corpusTokenOccurrences` balances the parentheses and is exactly right here.
 */
function citeSectionResolves(cp: Checkpoint, text: string, corpusHeadings: Map<string, string[]>): CheckResult {
  // No corpus headings at all means the caller never loaded them; the check would then
  // "pass" every token by ignoring it, which is a placebo. Say so instead.
  if (corpusHeadings.size === 0) {
    return result(cp, "not-assessable", {
      reasoning: "no corpus headings were loaded, so no section could be resolved",
    });
  }

  const failures: string[] = [];
  let checked = 0;

  for (const raw of corpusTokenOccurrences(text)) {
    const parsed = parseCitationToken(raw);
    if (!parsed) continue;
    const headings = corpusHeadings.get(parsed.id);
    // An id outside the corpus is `cite_none_outside_corpus`'s failure, not this one.
    // Double-reporting would make a single defect read as two independent findings.
    if (headings === undefined) continue;
    checked += 1;
    const verdict = verifyCitation(parsed.id, parsed.section, headings);
    if (verdict.status === "missing-section") {
      failures.push(`${parsed.id}: cited with no § section, so the claim cannot be located in the document`);
    } else if (verdict.status === "unknown-section") {
      failures.push(
        `${parsed.id} § "${verdict.section}": matches no heading in the document (actual: ${verdict.headings.join(" | ") || "(none)"})`
      );
    }
  }

  if (failures.length > 0) {
    return result(cp, "fail", {
      evidence: failures[0],
      reasoning: `unresolvable citation section(s) — ${[...new Set(failures)].join("; ")}`,
    });
  }
  return result(cp, "pass", {
    reasoning:
      checked === 0
        ? "no token naming a corpus document was emitted, so no section is unresolvable"
        : `all ${checked} token(s) naming a corpus document carry a § section that matches a heading in it`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// cite_provenance
// ─────────────────────────────────────────────────────────────────────────────

/** Every `(corpus:<id> …)` token in a piece of text, with its id. */
const CORPUS_TOKEN = /\(corpus:([a-z0-9-]+)\s*(?:§[^)]*)?\)/g;

/** Stringify a tool payload for checks that inspect result text. */
function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizedPath(value: string): string {
  return posix.normalize(value.replace(/\\/g, "/"));
}

function readPath(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? normalizedPath(path) : null;
}

/**
 * A `(corpus:…)` token is BACKED BY PROVENANCE in the same session when both hold:
 *   1. the id names a document that EXISTS in the loaded corpus — not a fabrication;
 *   2. that document was `read` — at or before the turn that emitted the token.
 *
 * THE `cbe_cite` CALL IS NO LONGER REQUIRED (product decision, 2026-08-07). There are two
 * legitimate routes to a citation and they are worth the same: obtain the token from
 * `cbe_cite`, or write the well-formed token yourself. What the lecturer needs is a
 * citation that names a real document the assistant actually read — and both routes give
 * her exactly that, including a working link, because the renderer linkifies any
 * well-formed token (`packages/app/src/renderer/util/citation-plugin.ts`). Requiring the
 * call graded the ROUTE rather than the result, and the evidence said the route is what
 * small models drop: `gemma4-31b` read the corpus eight times, called the tool zero times,
 * and wrote correct tokens by hand (run-2026-08-07T12-56-34-282Z).
 *
 * What survives is the part a judge cannot do. A judge sees only the emitted text, and the
 * text of a fabricated token is indistinguishable from a grounded one — which is how the
 * previous suite came to reward the fabrication path: its citation checks inspected token
 * STRINGS only, so pasting a well-formed token from the skill body passed every one of
 * them. Reading is provenance, and it is visible only in the transcript.
 *
 * The `cbe_cite` call count remains worth knowing and is read from the transcript as an
 * insight; it is deliberately not a pass criterion here.
 *
 * A transcript with no token at all PASSES: this checkpoint governs the tokens that were
 * emitted, and "cite something" is a different obligation with its own checkpoint.
 */
export function citeProvenance(cp: Checkpoint, t: Transcript, corpusPaths: Map<string, string>): CheckResult {
  const priorReads = new Set<string>();
  const failures: string[] = [];
  let tokensSeen = 0;
  const gradedTurn = typeof cp.turn === "number" ? cp.turn : null;
  const scoped: TurnTranscript[] =
    gradedTurn !== null && t.turns[gradedTurn] ? t.turns.slice(0, gradedTurn + 1) : t.turns;

  for (let i = 0; i < scoped.length; i++) {
    const turn = scoped[i]!;
    const starts = new Map<string, { name: string; args?: unknown }>();
    const reads = new Map<string, number>();
    let offset = 0;

    for (const event of turn.events ?? []) {
      if (event.type === "text") {
        offset += event.text.length;
      } else if (event.type === "tool_start") {
        starts.set(event.callId ?? `${event.name}:${starts.size}`, { name: event.name, args: event.args });
      } else if (!event.isError) {
        const start =
          starts.get(event.callId ?? "") ??
          [...starts.values()].reverse().find((candidate) => candidate.name === event.name);
        if (!start) continue;
        const path = start.name === "read" ? readPath(start.args) : null;
        if (path) reads.set(path, offset);
      }
    }

    if (gradedTurn === null || i === gradedTurn) {
      for (const m of turn.assistant.matchAll(CORPUS_TOKEN)) {
        const id = m[1]!;
        const token = m[0];
        const tokenOffset = m.index ?? 0;
        tokensSeen += 1;
        const canonicalPath = corpusPaths.get(id);
        const normalizedCanonicalPath = canonicalPath === undefined ? undefined : normalizedPath(canonicalPath);
        const wasRead =
          normalizedCanonicalPath !== undefined &&
          (priorReads.has(normalizedCanonicalPath) || (reads.get(normalizedCanonicalPath) ?? Infinity) <= tokenOffset);
        if (normalizedCanonicalPath === undefined)
          failures.push(`${id}: no such document in the loaded corpus — the id is fabricated`);
        else if (!wasRead) failures.push(`${id}: cited without a prior read of the document in this session`);
      }
    }

    for (const call of turn.tools) {
      const path = call.name === "read" && call.isError === false ? readPath(call.args) : null;
      if (path) priorReads.add(path);
    }
  }

  if (failures.length > 0) {
    return result(cp, "fail", {
      reasoning: `unprovenanced (corpus:…) token(s) — ${failures.join("; ")}`,
    });
  }
  return result(cp, "pass", {
    reasoning:
      tokensSeen === 0
        ? "no (corpus:…) token was emitted, so none is unprovenanced"
        : `all ${tokensSeen} emitted token(s) name a real corpus document that was read in this session`,
  });
}

/** Count of unprovenanced tokens in a transcript — the run-level metric. */
export function unprovenancedTokenCount(t: Transcript, corpusPaths: Map<string, string>): number {
  const probe: Checkpoint = { id: "_metric", type: "deterministic", anchors: [], check: { kind: "cite_provenance" } };
  const r = citeProvenance(probe, t, corpusPaths);
  if (r.verdict === "pass") return 0;
  return (r.reasoning ?? "").split(";").length;
}

/** True when at least one corpus DOCUMENT body (not the index) was read in the session. */
export function readACorpusDocument(t: Transcript, corpusPaths: Map<string, string>): boolean {
  const canonicalPaths = new Set([...corpusPaths.values()].map(normalizedPath));
  return t.turns.some((turn) =>
    turn.tools.some((call) => {
      const path = call.name === "read" && call.isError === false ? readPath(call.args) : null;
      return path !== null && canonicalPaths.has(path);
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// cite_no_sham_attribution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `(corpus:` occurrence, closed on its BALANCED `)` and bounded to one line.
 *
 * Neither existing pattern can be reused here. `CORPUS_TOKEN` matches only the bracketed
 * canonical shape, so the reproduced hand-written string
 * `(corpus:methodology-003, "…", "…" / "…")` is invisible to it. `ANY_CORPUS_TOKEN` stops
 * at the first `(`, and the corpus really does carry a section heading with parentheses
 * (`methodology-012 § "Step 3 — … (evidence first)"`), so it truncates the tool's own
 * output. Balancing handles both.
 *
 * An occurrence that never closes on its line is still returned, up to the line end: it
 * cannot have come from the tool and it is not well-formed, so it is a claim of
 * provenance that nothing backs — the one thing this check must not let through.
 */
export function corpusTokenOccurrences(text: string): string[] {
  const out: string[] = [];
  const NEEDLE = "(corpus:";
  for (let i = text.indexOf(NEEDLE); i !== -1; i = text.indexOf(NEEDLE, i + 1)) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "\n") break;
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(i, depth === 0 ? j + 1 : j));
  }
  return out;
}

const ID_AT_TOKEN_START = /^\(corpus:([a-z0-9]+(?:-[a-z0-9]+)*)/;
/**
 * The BARE token: an id and nothing else between the parentheses. Not this check's business
 * — see `citeNoShamAttribution`'s doc comment, clause 1.
 */
const BARE_TOKEN = /^\(corpus:[a-z0-9]+(?:-[a-z0-9]+)*\)$/;
/** A single-line parenthetical carrying no nested parentheses — the citation slot. */
const PARENTHETICAL = /\(([^()\n]*)\)/g;
/** Kebab-case word inside a parenthetical; membership in the corpus decides. */
const ID_SHAPED = /[a-z0-9]+(?:-[a-z0-9]+)+/g;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * A corpus document id is ATTRIBUTED without provenance when either holds:
 *   1. a corpus-token-shaped string is neither canonically well-formed nor present in a
 *      `cbe_cite` result of this session — the hand-written token; or
 *   2. the id sits in an attribution parenthetical (one that is not itself a corpus
 *      token) and the session carries no tool-produced token naming it.
 *
 * WHY THIS IS NOT `cite_provenance`. That check governs the tokens that were emitted, and
 * measured against the reproduced outputs it sees neither form: its pattern does not match
 * the hand-written string, and a bare id in prose is not a token at all. Worse,
 * `cite_none_outside_corpus` DOES see the hand-written string, resolves its id against the
 * corpus and passes it — so the suite scores a fabrication as a legitimate citation.
 *
 * WHAT CLAUSE 1 DOES NOT COVER: THE BARE `(corpus:<id>)` TOKEN. It fails `isWellFormedToken`,
 * but NEITHER reason above holds for it, and both are checkable rather than a matter of taste:
 *   - the renderer's `CITATION_RE` (`packages/app/src/renderer/util/citation-plugin.ts`) has an
 *     EMPTY-able metadata segment, so it matches the bare token and linkifies it — it is not a
 *     token "no renderer will linkify";
 *   - `cite_provenance`'s `CORPUS_TOKEN` makes the `§` element OPTIONAL, so that check does see
 *     it and does judge its provenance.
 * Its single defect is the missing section, and `cite_section_resolves` owns that failure and
 * names it accurately ("cited with no § section, so the claim cannot be located"). Reporting it
 * here as well made ONE behaviour read as two independent findings in the n=3 run of 2026-08-10
 * — `6d` and `6g` both fired on the same two tokens — and labelled a token whose document had
 * really been read (`6a` green, 12/12) a "sham". This is the same de-overlap `citeSectionResolves`
 * already performs for an id outside the corpus, in the other direction. Nothing escapes the
 * suite: an unread bare token still fails `cite_provenance`, and every bare token still fails
 * `cite_section_resolves`.
 *
 * WHY THE SECOND CLAUSE IS NARROW. A lecturer-facing sentence may legitimately name a
 * document when the assistant talks ABOUT the corpus rather than grounding a claim in it,
 * and code cannot read that difference from the sentence. What separates them is the
 * session: in the one captured transcript that cited correctly, every id it also named in
 * prose already carried a tool-produced token. So an id the session has cited is exempt,
 * and an id in running prose OUTSIDE a parenthetical is never flagged at all — catching
 * that would take a per-language list of attribution prepositions, which is the noisy rule
 * this check deliberately does not ship (change `catch-sham-citations-and-substituted-sources`,
 * design.md § 2).
 */
export function citeNoShamAttribution(
  cp: Checkpoint,
  t: Transcript,
  corpusIds: Set<string>,
  corpusPaths: Map<string, string> = new Map()
): CheckResult {
  // Ids whose document was actually READ in this session. Since the product decision of
  // 2026-08-07 a hand-written citation is a legitimate route, so what exempts an
  // attribution is the read, not the tool call. Without a corpusPaths map (older callers,
  // unit tests) this stays empty and the check behaves as before.
  const readIds = new Set<string>();
  if (corpusPaths.size > 0) {
    const pathToId = new Map([...corpusPaths].map(([id, p]) => [normalizedPath(p), id]));
    for (const turn of t.turns) {
      for (const call of turn.tools) {
        if (call.name !== "read" || call.isError === true) continue;
        const p = readPath(call.args);
        const id = p === null ? undefined : pathToId.get(p);
        if (id) readIds.add(id);
      }
    }
  }
  const gradedTurn = typeof cp.turn === "number" ? cp.turn : null;
  const scoped: TurnTranscript[] =
    gradedTurn !== null && t.turns[gradedTurn] ? t.turns.slice(0, gradedTurn + 1) : t.turns;
  const isGraded = (i: number) => gradedTurn === null || i === gradedTurn;

  // Everything a successful `cbe_cite` call returned in this session. Read from the
  // events when present and from the flat tool list otherwise, so a transcript captured
  // without events still resolves.
  const citeResults: string[] = [];
  for (const turn of scoped) {
    for (const event of turn.events ?? []) {
      if (event.type === "tool_end" && event.name === "cbe_cite" && !event.isError) {
        citeResults.push(valueText(event.result));
      }
    }
    for (const call of turn.tools) {
      if (call.name === "cbe_cite" && call.isError !== true && call.result !== undefined) {
        citeResults.push(valueText(call.result));
      }
    }
  }
  const toolProduced = (token: string) => citeResults.some((r) => r.includes(token));

  // Pass 1 — ids with a tool-produced token anywhere in the scoped session, and the
  // token-shaped strings that have neither the tool nor the canonical form behind them.
  const provenanced = new Set<string>();
  const shamTokens: string[] = [];
  scoped.forEach((turn, i) => {
    for (const token of corpusTokenOccurrences(turn.assistant)) {
      const id = ID_AT_TOKEN_START.exec(token)?.[1];
      if (toolProduced(token)) {
        if (id) provenanced.add(id);
      } else if (BARE_TOKEN.test(token) && id !== undefined && corpusIds.has(id)) {
        // Missing section only — `cite_section_resolves` reports it. See the doc comment.
        continue;
      } else if (!isWellFormedToken(token) && isGraded(i)) {
        shamTokens.push(token);
      }
    }
  });

  // Pass 2 — ids attributed in a parenthetical the session never cited. Runs after pass 1
  // so a token emitted in a later turn still exempts an earlier mention: the lenient
  // direction, chosen because a false positive here costs an investigation.
  const attributions: Array<{ id: string; where: string }> = [];
  scoped.forEach((turn, i) => {
    if (!isGraded(i)) return;
    for (const m of turn.assistant.matchAll(PARENTHETICAL)) {
      const inner = m[1]!;
      if (/^\s*corpus:/.test(inner)) continue; // a corpus token — pass 1 owns it
      for (const word of inner.match(ID_SHAPED) ?? []) {
        if (corpusIds.has(word) && !provenanced.has(word) && !readIds.has(word)) {
          attributions.push({ id: word, where: truncate(m[0], 120) });
        }
      }
    }
  });

  const failures = [
    ...shamTokens.map((token) => `malformed citation token, which no renderer will linkify: ${truncate(token, 160)}`),
    ...attributions.map(({ id, where }) => `${id}: attributed in ${where} without a token and without a read`),
  ];
  const unique = [...new Set(failures)];
  if (unique.length > 0) {
    return result(cp, "fail", {
      evidence: truncate(shamTokens[0] ?? attributions[0]?.where ?? "", 160),
      reasoning: `sham citation(s) — ${unique.join("; ")}`,
    });
  }
  return result(cp, "pass", {
    reasoning:
      provenanced.size === 0
        ? "no corpus document id was attributed in the assistant text"
        : `every attributed id rests on a tool-produced token (${[...provenanced].join(", ")})`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// reply_language
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic and today untested: a refusal copied verbatim from the skill's English
 * string passed every check the previous suite had, because none of them looked at the
 * language at all.
 *
 * Function-word frequency, not a library: the two languages the lecturer population uses
 * are English and German, and their closed-class words are disjoint enough that a
 * paragraph of either is unambiguous. Anything under the evidence floor is reported
 * `not-assessable` rather than guessed.
 */
const DE_WORDS = /\b(der|die|das|und|nicht|ist|ein|eine|sie|ich|wir|für|auf|mit|dass|sich|kann|werden|Ihre|Ihnen)\b/gi;
const EN_WORDS = /\b(the|and|not|is|a|an|you|we|for|on|with|that|can|will|your|this|of|to|it)\b/gi;

export function detectLanguage(text: string): "en" | "de" | "unknown" {
  const de = (text.match(DE_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (de + en < 4) return "unknown";
  if (de === en) return "unknown";
  return de > en ? "de" : "en";
}

function replyLanguage(cp: Checkpoint, t: Transcript, expected?: string): CheckResult {
  const turn = typeof cp.turn === "number" ? t.turns[cp.turn] : t.turns[t.turns.length - 1];
  if (!turn) return result(cp, "not-assessable", { reasoning: "no such turn in the transcript" });

  const got = detectLanguage(turn.assistant);
  if (got === "unknown") {
    return result(cp, "not-assessable", {
      reasoning: "the reply carries too little text to determine its language",
    });
  }
  // With no `pattern`, the expectation IS the user turn's language — the mirror rule.
  const want = expected ?? detectLanguage(turn.user);
  if (want === "unknown") {
    return result(cp, "not-assessable", {
      reasoning: "the user turn carries no language signal to mirror",
    });
  }
  return got === want
    ? result(cp, "pass", { reasoning: `reply is ${got}, as expected` })
    : result(cp, "fail", { reasoning: `reply is ${got}, expected ${want}` });
}

// ─────────────────────────────────────────────────────────────────────────────
// no_trailing_menu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A STRUCTURAL property of the last paragraph, not a quality judgement: a design turn
 * must not close on an open menu question that hands the ordering back to the lecturer
 * ("Where would you like to start — outcomes, assessment, or the challenge?").
 *
 * Returns the offending paragraph, or null. The test is deliberately narrow: the closing
 * paragraph must (a) be a question, and (b) offer a choice among alternatives without
 * proposing one. A question that proposes a next step and asks for confirmation is fine
 * — that is exactly what the backbone rule asks for.
 */
export function trailingMenu(text: string): string | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return null;
  // A trailing bullet list of options counts as the closing paragraph's tail.
  const closing = last.replace(/\s+/g, " ");
  if (!closing.endsWith("?")) return null;

  const OPENERS = /\b(where|which|what|womit|welche[rsnm]?|wo)\b[^?]*\?$/i;
  const CHOICE = /\b(or|oder)\b/i;
  const INVITES = /\b(would you like|do you want|möchten sie|wollen sie|shall we|sollen wir)\b/i;

  const looksLikeMenu = (OPENERS.test(closing) || INVITES.test(closing)) && CHOICE.test(closing);
  return looksLikeMenu ? closing.slice(0, 200) : null;
}
