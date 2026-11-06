/**
 * `cbe_maturity` — a fire-and-forget generative-UI tool the skill calls to mirror
 * its PIONEER maturity reading as structured data onto the renderer's Maturity
 * Panel. See capability `agent-harness`, Requirement *cbe_maturity Generative-UI
 * Tool*, capability `desktop-app`, Requirement *Maturity Panel*, and capability
 * `cbe-skill`, Requirement *Maturity Raster Assessment and Lecturer-Facing
 * Surfacing*.
 *
 * Like `cbe_step`/`cbe_profile` this tool is NOT deferred: the skill pushes ONE
 * reading update and continues — there is no next-user-turn roundtrip (the
 * lecturer's discuss/assess actions travel the other way, as structured user
 * turns dispatched by the renderer). `execute` returns a small synchronous
 * acknowledgement with `details.kind: "maturity-update"`; the renderer consumes
 * the validated result details through the `tool_execution` event path, and a
 * bound host-side `MaturityMirror` records them for hydration. When a mirror is
 * bound, the acknowledgement additionally carries the host-computed divergence
 * summary over the post-update raster (`below`/`at`/`above`/`unassessed`/
 * `no-target` per recorded criterion plus the counts, with the `overall`
 * aggregate in its own clause) — model-facing text only, so the
 * review's ambition-vs-achievement confrontation quotes host arithmetic rather
 * than re-deriving the gap.
 *
 * A call is exactly ONE of three shapes:
 *   1. criterion update — `criterion` (one of the seven PIONEER keys) plus at
 *      least one of `current: 1|2|3|"unassessed"` / `target: 1|2|3|null`, and
 *      optionally `uncertain` / `capped` (each only alongside a numeric
 *      `current`) and `hint`;
 *   2. overall update — `criterion: "overall"` plus at least one of
 *      `target: 1|2|3|null` / `note` (`"unassessed"`, `uncertain`, `capped` and
 *      `hint` are invalid on `overall`);
 *   3. batched raster — `readings`: each of the seven criterion keys exactly
 *      once plus at most one `overall` record; validated ATOMICALLY (one bad
 *      record rejects the whole call, nothing is applied).
 *
 * `overall.current` is the ONE field that is neither applied nor fatal: the
 * overall achieved level is DERIVED by the host from the criterion readings
 * (capability `agent-harness`, Requirement: *Host-Derived Overall Maturity
 * Level*), so a call carrying one has that field dropped, everything else
 * applied, and `OVERALL_CURRENT_NOTICE` returned on the result. Refusing the
 * whole call would throw away the seven criterion readings that travelled with
 * it — a much worse outcome than ignoring one now host-owned field.
 *
 * `hint`/`note` are free text from the model: the validator enforces the length
 * cap and REJECTS ASCII/C0+C1 control characters, Unicode bidi controls, and
 * zero-width characters. Content discipline (target cap, grounding) is owned by
 * the skill. A degenerate payload is a corrective no-op result, never a crash.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  MATURITY_CRITERIA,
  computeMaturityDivergence,
  formatMaturityDivergence,
  hasMaturityDivergence,
  isMaturityCriterionKey,
  isMaturityRecordKey,
  type MaturityMirror,
  type MaturityReadingRecord,
  type MaturityToolDetails,
} from "./maturity-mirror.js";

export type { MaturityToolDetails };

/** Hard length cap (characters) for the free-text `hint` and `note` fields —
 * the panel is a glance surface, one short sentence each. */
export const MATURITY_FREETEXT_MAX = 240;

/**
 * Characters REJECTED in `hint`/`note`: C0 + DEL + C1 controls (incl. newlines),
 * Unicode bidirectional controls (U+202A–U+202E, U+2066–U+2069), and zero-width
 * characters (U+200B–U+200D, U+FEFF). Rejected rather than stripped — the skill
 * re-emits a clean sentence; silent mutation would desync prose and panel.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/;

const LEVEL_UNION = [Type.Literal(1), Type.Literal(2), Type.Literal(3)];

const readingFields = {
  criterion: Type.Optional(
    Type.String({
      description:
        "This record's key: one of the seven PIONEER criterion keys " +
        `(${MATURITY_CRITERIA.join(" | ")}) or "overall" for the design's target and limitation note.`,
    })
  ),
  current: Type.Optional(
    Type.Union([...LEVEL_UNION, Type.Literal("unassessed")], {
      description:
        'Assessed maturity level (1 = CBE light, 2 = good practice, 3 = full-fledged), or "unassessed" for a ' +
        "no-evidence criterion (never fabricate a level). Invalid on overall: the host derives that level.",
    })
  ),
  target: Type.Optional(
    Type.Union([...LEVEL_UNION, Type.Null()], {
      description: "Established target level (1|2|3); null CLEARS a recorded target. Omit to leave it unchanged.",
    })
  ),
  uncertain: Type.Optional(
    Type.Boolean({
      description:
        "Weak-evidence conservative reading. Only alongside a numeric current level in the same call; invalid on overall. Absent clears.",
    })
  ),
  capped: Type.Optional(
    Type.Boolean({
      description:
        "A finding the lecturer left standing holds this criterion down, so the host's derived aggregate cannot exceed it. Not `uncertain` (weak evidence) — this is a substantive finding. Same rules; absent clears.",
    })
  ),
  hint: Type.Optional(
    Type.String({
      description:
        "One short lecturer-facing sentence naming what would move this criterion toward its target — from the methodology-007 per-cell cues, never beyond the elicited target. Absent clears. Invalid on overall.",
    })
  ),
  note: Type.Optional(
    Type.String({
      description: 'Limitation note, OVERALL record only (e.g. "only 3 of 7 assessed"). Absent clears.',
    })
  ),
};

const MaturityParamsSchema = Type.Object({
  ...readingFields,
  readings: Type.Optional(
    Type.Array(Type.Object(readingFields), {
      description:
        "Batched establishment raster: one record per criterion — each of the seven criterion keys exactly once (unassessed criteria included explicitly) — plus at most one overall record. Validated atomically.",
    })
  ),
});

export type MaturityToolParams = Static<typeof MaturityParamsSchema>;

// Exported for the schema-contract unit tests.
export { MaturityParamsSchema };

type RecordValidation =
  | { ok: true; record: MaturityReadingRecord; droppedOverallCurrent?: boolean; empty?: boolean }
  | { ok: false; reason: string };

/**
 * The corrective notice a dropped `overall.current` carries back (capability
 * `agent-harness`, Requirement: *Host-Derived Overall Maturity Level*). House
 * idiom: a refusal is an instruction — it names what WOULD be accepted, and the
 * rest of the call is applied rather than thrown away with it.
 */
export const OVERALL_CURRENT_NOTICE =
  "The overall achieved level was IGNORED: it is derived by the host from the criterion readings you record, " +
  "so `overall` accepts `target` and `note` only. Record each criterion's own level, mark a criterion `capped` " +
  "where a standing finding holds it down, and the host computes the aggregate from those.";

/** Validate ONE record (criterion or overall). Enforces key enum, level ranges,
 * field exclusivity per shape, the free-text caps, and character sanitisation. */
function validateRecord(raw: unknown): RecordValidation {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "record must be an object" };
  const r = raw as Record<string, unknown>;
  if (!isMaturityRecordKey(r.criterion)) {
    return { ok: false, reason: `criterion must be one of ${MATURITY_CRITERIA.join("|")} or "overall"` };
  }
  const overall = r.criterion === "overall";
  const rec: MaturityReadingRecord = { criterion: r.criterion };

  // A `current` on the aggregate is DROPPED, not refused: the host derives that
  // level, and refusing the whole call over one now host-owned field would
  // discard the criterion readings that travelled with it — a far worse outcome
  // than ignoring the field and saying so.
  let droppedOverallCurrent = false;
  if ("current" in r && r.current !== undefined) {
    if (overall) {
      droppedOverallCurrent = true;
    } else {
      const currentOk = r.current === 1 || r.current === 2 || r.current === 3 || r.current === "unassessed";
      if (!currentOk) return { ok: false, reason: 'current must be 1|2|3|"unassessed"' };
      rec.current = r.current as MaturityReadingRecord["current"];
    }
  }
  if ("target" in r && r.target !== undefined) {
    if (!(r.target === 1 || r.target === 2 || r.target === 3 || r.target === null)) {
      return { ok: false, reason: "target must be 1|2|3|null" };
    }
    rec.target = r.target;
  }

  if ("uncertain" in r && r.uncertain !== undefined) {
    if (overall) return { ok: false, reason: "uncertain is invalid on overall" };
    if (typeof r.uncertain !== "boolean") return { ok: false, reason: "uncertain must be boolean" };
    if (typeof rec.current !== "number") {
      return { ok: false, reason: "uncertain is valid only alongside a numeric current level" };
    }
    rec.uncertain = r.uncertain;
  }
  if ("capped" in r && r.capped !== undefined) {
    if (overall)
      return { ok: false, reason: "capped is invalid on overall (mark the criterion the finding holds down)" };
    if (typeof r.capped !== "boolean") return { ok: false, reason: "capped must be boolean" };
    if (typeof rec.current !== "number") {
      return { ok: false, reason: "capped is valid only alongside a numeric current level" };
    }
    rec.capped = r.capped;
  }

  const freeText = (field: "hint" | "note", value: unknown): string | { ok: false; reason: string } => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, reason: `${field} must be a non-empty string` };
    }
    if (value.length > MATURITY_FREETEXT_MAX) {
      return { ok: false, reason: `${field} exceeds the ${MATURITY_FREETEXT_MAX}-character cap` };
    }
    if (UNSAFE_TEXT.test(value)) {
      return { ok: false, reason: `${field} contains control, bidi, or zero-width characters` };
    }
    return value;
  };
  if ("hint" in r && r.hint !== undefined) {
    if (overall) return { ok: false, reason: "hint is invalid on overall (use note)" };
    const v = freeText("hint", r.hint);
    if (typeof v !== "string") return v;
    rec.hint = v;
  }
  if ("note" in r && r.note !== undefined) {
    if (!overall) return { ok: false, reason: "note is valid only on the overall record" };
    const v = freeText("note", r.note);
    if (typeof v !== "string") return v;
    rec.note = v;
  }

  // Checked LAST, because what counts as an updatable field depends on the
  // fields validated above: on `overall` the limitation note now qualifies on
  // its own — with the achieved level host-derived, a note-only revision is the
  // ordinary shape, and rejecting it would throw away exactly the sentence the
  // panel must keep rendering while no aggregate exists.
  if (rec.current === undefined && rec.target === undefined && !(overall && rec.note !== undefined)) {
    // A record whose ONLY field was the now host-derived overall level is not a
    // malformed payload but a correctable one: there is nothing left to apply,
    // and the caller answers with the correction instead of a rejection.
    if (droppedOverallCurrent) return { ok: true, record: rec, droppedOverallCurrent, empty: true };
    return {
      ok: false,
      reason: overall
        ? "an overall record needs at least one of target/note"
        : "a record needs at least one of current/target",
    };
  }
  return droppedOverallCurrent ? { ok: true, record: rec, droppedOverallCurrent } : { ok: true, record: rec };
}

export type MaturityValidation =
  | { ok: true; details: MaturityToolDetails; batch: boolean; notice?: string }
  | { ok: false; message: string };

/**
 * Validate a full `cbe_maturity` call — the load-bearing validation (Pi's schema
 * pass is defence in depth only). Batched calls are validated ATOMICALLY: one
 * invalid record rejects the whole call. Exported for the mirror/replay tests.
 *
 * A `current` on the `overall` record is the one field that is neither applied
 * nor fatal: it is dropped, the rest of the call applies unchanged, and `notice`
 * carries the correction back to the model.
 */
export function validateMaturityParams(params: unknown): MaturityValidation {
  const p = (params ?? {}) as Record<string, unknown>;
  if (p.readings !== undefined) {
    if (p.criterion !== undefined || p.current !== undefined || p.target !== undefined) {
      return { ok: false, message: "a batched call carries ONLY readings — no top-level criterion fields" };
    }
    if (!Array.isArray(p.readings)) return { ok: false, message: "readings must be an array" };
    const records: MaturityReadingRecord[] = [];
    const seen = new Set<string>();
    let dropped = false;
    for (const raw of p.readings) {
      const v = validateRecord(raw);
      if (!v.ok) return { ok: false, message: `invalid record: ${v.reason}` };
      if (seen.has(v.record.criterion)) {
        return { ok: false, message: `duplicate record for "${v.record.criterion}"` };
      }
      seen.add(v.record.criterion);
      if (v.droppedOverallCurrent) dropped = true;
      // An `overall` record left with nothing to apply is omitted from the
      // batch — the seven criterion records still apply, which is the whole
      // point of dropping the field rather than refusing the call.
      if (!v.empty) records.push(v.record);
    }
    const missing = MATURITY_CRITERIA.filter((k) => !seen.has(k));
    if (missing.length > 0) {
      return {
        ok: false,
        message: `a batched raster must cover each criterion exactly once (missing: ${missing.join(", ")})`,
      };
    }
    const batch: MaturityValidation = {
      ok: true,
      details: { kind: "maturity-update", readings: records },
      batch: true,
    };
    return dropped ? { ...batch, notice: OVERALL_CURRENT_NOTICE } : batch;
  }
  const v = validateRecord(p);
  if (!v.ok) return { ok: false, message: v.reason };
  if (v.empty) {
    // The call carried ONLY the host-derived level: nothing is recorded, and the
    // result is the correction rather than a rejection.
    return { ok: true, details: { kind: "maturity-refusal" }, batch: false, notice: OVERALL_CURRENT_NOTICE };
  }
  const single: MaturityValidation = { ok: true, details: { kind: "maturity-update", ...v.record }, batch: false };
  return v.droppedOverallCurrent ? { ...single, notice: OVERALL_CURRENT_NOTICE } : single;
}

function levelToken(level: 1 | 2 | 3 | "unassessed" | null | undefined): string {
  if (level === undefined || level === null) return "—";
  return level === "unassessed" ? "unassessed" : `Level ${level}`;
}

/**
 * Build the `cbe_maturity` tool. When a `MaturityMirror` is supplied, every valid
 * call updates the host-side mirror. Omit it (headless / unit tests) and the tool
 * still returns the same acknowledgements — just without a mirror.
 */
export function createMaturityTool(mirror?: MaturityMirror) {
  return defineTool({
    name: "cbe_maturity",
    label: "Maturity",
    description:
      'Mirror your maturity reading onto the Maturity Panel as structured data. AT ESTABLISHMENT emit ONE batched call — `readings` with one record per criterion, all seven keys exactly once, a no-evidence criterion explicitly as current: "unassessed" and never as a fabricated level — plus one overall record carrying the elicited target and the limitation note ONLY — the achieved aggregate is the host\'s, derived from your criterion levels. ZERO-ASSESSMENT CASE: with no criterion assessed and no target, emit the seven "unassessed" records and OMIT the overall record. AFTERWARDS emit single-criterion (or overall) calls on TRANSITIONS ONLY — a level, target, hint, uncertainty or cap that actually changed, in either direction; never re-emit an unchanged reading — EXCEPT under a staleness notice, due even when nothing moved. Absent optional fields CLEAR the recorded ones: a revision re-states whatever still applies. WHEN THE HOST REPORTS THE READING HAS GONE STALE, answer it in the SAME turn WITH A CALL: re-check, mirror what changed, and where nothing changed re-emit the reading unchanged — only the recorded re-stamp ends the notice, never prose. READ THE RESULT. A refusal is an instruction, not an error message: it names what is wrong (a batch validates atomically — one bad record rejects the whole call), and you correct and re-issue in the SAME turn. Only call this when the environment descriptor reports the `maturity` affordance; where it does not, surface the reading conversationally and claim no recording.',
    promptSnippet:
      "Use cbe_maturity to mirror the maturity reading onto the Maturity Panel: one batched readings call at establishment (all seven criteria, unassessed explicit, plus the conditional overall record carrying the target and limitation note), then single-criterion calls on reading transitions only. The overall ACHIEVED level is host-derived, never sent. Fire-and-forget. Only when the `maturity` affordance is present.",
    // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app — pi's
    // `buildSystemPrompt` returns early on its `customPrompt` branch, which
    // `startCbeSession` always takes. Kept accurate for hosts on pi's default
    // prompt; every binding rule lives in `description` / parameter descriptions.
    promptGuidelines: [
      'criterion is one of societal-challenge|stakeholder-involvement|interdisciplinarity|student-agency|iterative-process|value-reflection|societal-impact, or "overall" for the design target and limitation note.',
      'At establishment emit ONE batched readings call covering all seven criteria exactly once — a no-evidence criterion as current: "unassessed", never a fabricated level — plus one overall record (elicited target + limitation note) when a target exists or a limitation has to be stated; with zero assessed criteria and no target, omit the overall record.',
      "The overall ACHIEVED level is derived by the host from the criterion levels and cannot be set: mark a criterion `capped` where a finding the lecturer left standing holds it down, and the host caps the aggregate at it.",
      "After establishment: single calls on TRANSITIONS ONLY (a level, target, hint, uncertainty or cap actually changed), in either direction — levels and targets may move down or fall back to unassessed. Never re-emit an unchanged reading — except under a staleness notice, where a call is due even when nothing moved: only the recorded re-stamp ends the notice.",
      "Absent hint/uncertain/capped fields CLEAR the recorded ones: a revision call re-states what still applies after the change.",
      "hint is one short sentence in the lecturer's language, only where current sits below the established target, drawn from the methodology-007 per-cell cues, and never pointing beyond the elicited target.",
      "Mirror only readings you surface conversationally in the same turn (named levels, methodology-007 citation) — the panel is a display record, the cited prose stays the authoritative surfacing.",
      "Do not call cbe_maturity when the environment descriptor does not report the `maturity` affordance.",
    ],
    parameters: MaturityParamsSchema,
    async execute(_toolCallId, params: MaturityToolParams) {
      // Defence in depth: Pi validates against the schema first, but a degenerate
      // payload MUST be a corrective no-op result, never a crash, and MUST NOT
      // corrupt or partially apply state (batch atomicity lives in the validator).
      const validation = validateMaturityParams(params);
      if (!validation.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `cbe_maturity: invalid payload (${validation.message}). No maturity reading recorded.`,
            },
          ],
          details: { kind: "maturity-refusal" } satisfies MaturityToolDetails as MaturityToolDetails,
        };
      }
      mirror?.applyToolResult(validation.details);
      // The ack states the reading was recorded FOR DISPLAY and stays silent about
      // anything beyond the session — there is no dedicated maturity store, and the
      // ack must not claim one (Scenario: cbe_maturity is fire-and-forget and does
      // not over-claim persistence).
      const text =
        validation.details.kind === "maturity-refusal"
          ? "cbe_maturity: the call carried nothing but an overall achieved level. No maturity reading recorded."
          : validation.batch
            ? `Maturity raster recorded for the session's Maturity Panel (${validation.details.readings!.length} records).`
            : `Maturity reading recorded for the session's Maturity Panel: ${validation.details.criterion}` +
              (validation.details.current !== undefined ? `, current ${levelToken(validation.details.current)}` : "") +
              ("target" in validation.details && validation.details.target !== undefined
                ? `, target ${levelToken(validation.details.target)}`
                : "") +
              ".";
      // The corrective notice travels on an APPLIED call (Requirement:
      // *Host-Derived Overall Maturity Level*) — the house idiom's "a refusal is
      // an instruction", here without discarding what else the call carried.
      const notice = validation.notice ? ` ${validation.notice}` : "";
      // The host-computed divergence summary over the POST-UPDATE raster (the
      // mirror was just fed above), so a consumer — notably the adversarial
      // review's ambition-vs-achievement confrontation — quotes host arithmetic
      // instead of re-deriving the gap from recollection. Without a mirror there
      // is no raster to classify, so the summary is OMITTED rather than faked
      // from the single call's params. The `details` payload the renderer
      // consumes is untouched: the summary is model-facing text only.
      const summary = mirror ? computeMaturityDivergence(mirror.snapshot()) : undefined;
      const divergence = summary && hasMaturityDivergence(summary) ? ` ${formatMaturityDivergence(summary)}` : "";
      return {
        // The notice sits LAST, after the divergence summary: that summary's
        // per-criterion buckets must not be preceded by the word `overall`
        // outside its own trailing aggregate clause, which is what keeps the
        // aggregate readably separate from the seven criteria.
        content: [{ type: "text" as const, text: `${text}${divergence}${notice}` }],
        details: validation.details,
      };
    },
  });
}

/** Default tool instance without a mirror — used by the schema-contract unit
 * tests and any caller that does not need the host-side mirror. */
export const maturityTool = createMaturityTool();
