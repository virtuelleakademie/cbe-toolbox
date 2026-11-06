/**
 * `cbe_wiki` — read-only retrieval over the active course's wiki, with the
 * index-first order built into the ROUTE (capability `agent-harness`, Requirement:
 * *cbe_wiki Wiki-Retrieval Tool with a Forced Index-First Route*).
 *
 * Why this is a tool and not a sentence in an instruction channel: an instruction
 * can be skipped, and in this repository instructions of exactly this kind have
 * been, repeatedly — the retired `references/` tree was pointed at 49 times and
 * opened essentially never, and three successive rewrites of a corpus-read
 * instruction measured zero reads. The gate makes the ordering a fact: no atom body
 * is returned in a session that has not been handed the index.
 *
 * Like `cbe_cite` this tool is NOT deferred — it answers synchronously and does not
 * terminate the tool batch, because it accompanies substantive work in the same
 * turn (Requirement: *The Agent Run Ends on a Deferred-Answer Tool Call*).
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  readWikiIndex,
  resolveAtomPath,
  readAtomBody,
  compactIndexText,
  WIKI_ATOMS_PER_CALL,
  WIKI_BODY_CHARS_PER_CALL,
  WIKI_INDEX_CHARS_PER_CALL,
  type WikiRetrievalGate,
} from "./wiki-index.js";

const WikiParamsSchema = Type.Object({
  atoms: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description:
        "Wiki-relative atom ids exactly as the index writes them (e.g. `concept/cognitive-load`). Omit, or pass an empty array, to receive the index. At most 5 per call — select from the index; the wiki is never loaded wholesale.",
    })
  ),
});

export type WikiToolParams = Static<typeof WikiParamsSchema>;

// Exported for the schema-contract unit tests.
export { WikiParamsSchema };

function textResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

/** The ids the index carries, rendered for a refusal. Bounded so a large wiki does
 * not turn one mistyped id into a wall of text. */
function knownIdsLine(atomIds: readonly string[]): string {
  if (atomIds.length === 0) return "The index carries no atoms.";
  const shown = atomIds.slice(0, 40);
  const rest = atomIds.length - shown.length;
  return `The index carries: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

/** Said when the index was handed over compacted, so the missing per-entry notes are
 * never read as missing atoms. The route itself is not restated — that is the
 * description's business. */
const INDEX_COMPACTED =
  "[index compacted] The index is too long to hand over as the atomisation wrote it, so this is every atom id it " +
  "carries, grouped by page type, with the per-entry notes dropped. No atom is missing from this list.";

const NO_WIKI =
  "This course has no wiki index, so it carries no atoms you can ground in. Say that the lecturer's own material does not cover this, rather than treating the wiki as covered.";

/**
 * Build the `cbe_wiki` tool bound to one session's retrieval gate and the active
 * course's wiki directory. An undefined `wikiDir` (no course wiki bound in this
 * profile) leaves the tool registered and answering with the empty-wiki result —
 * the tool set stays uniform across profiles (Requirement: *Tool Allowlist
 * Excluding Shell Execution*).
 */
export function createWikiTool(gate: WikiRetrievalGate, wikiDir: string | undefined) {
  return defineTool({
    name: "cbe_wiki",
    label: "Wiki",
    description:
      "Read the lecturer's own wiki — their teaching material, atomised into one-topic pages. THE ROUTE IS INDEX-FIRST AND CANNOT BE SHORT-CUT: call with no `atoms` to receive the index, the list of every atom this course holds; call again with the ids you picked from it to receive those atom bodies. A call asking for bodies before the index has been delivered returns the index and no bodies, so a selection is always made from what exists instead of from a guess. THE ATOMS ARE THE UNIT: one atom is one topic and carries its own sources, and it is the atom you ground in. THEY OUTRANK THE IMPORTED ORIGINAL: `raw/` and `inbox/` hold the undigested import, this tool serves neither, and reaching for one with a file tool grounds you in what nobody curated. A REFUSAL IS AN INSTRUCTION, NOT AN ERROR MESSAGE: an id the index does not carry comes back with the ids it does — correct your selection and re-call. An index with no atoms means this course has none yet: say so, and do not present the wiki as covering the question.",
    promptSnippet:
      "Use cbe_wiki() to take the wiki index, then cbe_wiki({ atoms: [...] }) for the atom bodies you selected from it.",
    // NOTE: `promptSnippet` / `promptGuidelines` are DISCARDED in this app — pi's
    // `buildSystemPrompt` returns early on its `customPrompt` branch, which
    // `startCbeSession` always takes. Kept accurate for hosts on pi's default
    // prompt; every binding rule lives in `description` / parameter descriptions.
    promptGuidelines: [
      "Call cbe_wiki with no arguments to take the wiki index before asking for any atom body.",
      "Select atom ids from the index and pass them to cbe_wiki; never read a wiki atom, a raw/ extraction or an inbox/ original with a file tool instead.",
      "If cbe_wiki refuses an id, correct your selection from the ids it returns and re-call.",
    ],
    parameters: WikiParamsSchema,
    async execute(_toolCallId, params: WikiToolParams) {
      const requested = (params.atoms ?? []).filter((a) => typeof a === "string" && a.trim().length > 0);
      const index = await readWikiIndex(wikiDir);

      // No wiki, no index, or an index with no atoms — reported as a gap, never as a
      // silent empty result, and no gate transition (there is nothing to deliver).
      if (!wikiDir || !index.present || index.atomIds.length === 0) {
        return textResult(NO_WIKI, { kind: "wiki-empty", atomCount: 0 });
      }

      // The ONE stage-1 renderer, shared by the plain call and the index-first
      // refusal, so the two paths cannot diverge into a compacted index on one and a
      // verbatim one on the other. Within budget the atomisation's own text goes over
      // untouched; over budget it degrades to ids alone. A compact index is still the
      // index, so it satisfies the gate exactly as the verbatim one does.
      const indexResult = (reason: "stage-1" | "index-first") => {
        gate.markIndexDelivered();
        const compacted = index.text.length > WIKI_INDEX_CHARS_PER_CALL;
        const body = compacted ? `${INDEX_COMPACTED}\n\n${compactIndexText(index.atomIds)}` : index.text;
        return textResult(
          reason === "index-first"
            ? `Index first: no atom body is served before the index. Here is the index — select from it and call again.\n\n${body}`
            : body,
          { kind: "wiki-index", atomCount: index.atomIds.length, servedBodies: 0, reason, compacted }
        );
      };

      if (requested.length === 0) return indexResult("stage-1");

      // Refusal order (design D3): containment, then the per-call cap, then per-id
      // resolution. A call mixing an import path with a valid id is refused for the
      // path rather than half-served, and neither structural refusal consumes the
      // gate transition.
      // The two refusal kinds are DIFFERENT mistakes and get different corrections: an
      // absolute path is the right material named the wrong way, an import path is the
      // wrong material. Collapsing them would answer a descriptor path with a lecture
      // about `raw/`, which is not what the model did wrong.
      const refused = requested
        .map((a) => ({ ref: a, resolved: resolveAtomPath(wikiDir, a) }))
        .filter((r) => !r.resolved.ok);
      if (refused.length > 0) {
        const absolute = refused.filter((r) => !r.resolved.ok && r.resolved.refusal === "absolute").map((r) => r.ref);
        const outside = refused.filter((r) => !r.resolved.ok && r.resolved.refusal === "outside").map((r) => r.ref);
        const parts: string[] = [];
        if (absolute.length > 0) {
          parts.push(
            `Not an atom id: ${absolute.join(", ")}. This tool takes a wiki-relative id exactly as the index ` +
              `writes it (e.g. \`concept/cognitive-load\`), never a filesystem path — the wiki directory is ` +
              `already bound here.`
          );
        }
        if (outside.length > 0) {
          parts.push(
            `Not an atom: ${outside.join(", ")}. \`raw/\` holds the deterministic extraction and \`inbox/\` the ` +
              `untouched original; neither is served here, and neither stands in for the atomisation.`
          );
        }
        parts.push(knownIdsLine(index.atomIds));
        return textResult(parts.join(" "), {
          kind: "wiki-refusal",
          reason: outside.length > 0 ? "outside-wiki" : "not-an-atom-id",
          refused: refused.map((r) => r.ref),
        });
      }

      if (requested.length > WIKI_ATOMS_PER_CALL) {
        return textResult(
          `Too many atoms in one call (${requested.length}; at most ${WIKI_ATOMS_PER_CALL}). Select the ones the ` +
            `question actually needs from the index and call again. ${knownIdsLine(index.atomIds)}`,
          { kind: "wiki-refusal", reason: "over-cap", requested: requested.length, cap: WIKI_ATOMS_PER_CALL }
        );
      }

      if (gate.requiresIndex()) return indexResult("index-first");

      // Bodies are assembled in the order requested against a per-call character
      // budget. WHOLE ATOMS ONLY: a body that does not fit is not served, and is
      // never cut — a truncated atom is the same uncurated fragment the `raw/`
      // extraction is, reached from the other side. What is not served is NAMED, so
      // the model can never be left believing it received everything.
      const served: Array<{ id: string; body: string }> = [];
      const missing: string[] = [];
      const deferred: string[] = [];
      const tooLarge: string[] = [];
      let spent = 0;

      // Deduplicated by RESOLVED id, keeping first occurrence, because the request
      // order is the model's own priority order and `concept/a` and `concept/a.md`
      // are the same atom. Without this an id could be served on one pass and
      // deferred on the next, landing in `served` and `notServed` at once, and could
      // spend the budget twice for one body. The count cap above deliberately counts
      // the ids AS REQUESTED, not the deduplicated ones — a repeat buys no room.
      const selected: Array<{ id: string; path: string }> = [];
      const seen = new Set<string>();
      for (const ref of requested) {
        const resolved = resolveAtomPath(wikiDir, ref);
        // Unreachable — the containment check above already refused every non-ok
        // reference — but the narrowing keeps the branch total rather than asserted.
        if (!resolved.ok) {
          missing.push(ref);
          continue;
        }
        if (seen.has(resolved.id)) continue;
        seen.add(resolved.id);
        selected.push({ id: resolved.id, path: resolved.path });
      }

      for (const resolved of selected) {
        const body = index.atomIds.includes(resolved.id) ? await readAtomBody(resolved.path) : null;
        if (body === null) {
          missing.push(resolved.id);
        } else if (body.length > WIKI_BODY_CHARS_PER_CALL) {
          tooLarge.push(resolved.id);
          deferred.push(resolved.id);
        } else if (spent + body.length > WIKI_BODY_CHARS_PER_CALL) {
          deferred.push(resolved.id);
        } else {
          spent += body.length;
          served.push({ id: resolved.id, body });
        }
      }

      const blocks = served.map((s) => `--- ATOM ${s.id} ---\n${s.body}`);
      const notices: string[] = [];
      if (missing.length > 0) notices.push(`Not in the index: ${missing.join(", ")}. ${knownIdsLine(index.atomIds)}`);
      const budgetDeferred = deferred.filter((id) => !tooLarge.includes(id));
      if (budgetDeferred.length > 0) {
        notices.push(
          `Not served in this call: ${budgetDeferred.join(", ")} — the per-call body budget of ` +
            `${WIKI_BODY_CHARS_PER_CALL} characters was reached. Nothing was cut; ask for them in a further call.`
        );
      }
      if (tooLarge.length > 0) {
        notices.push(
          `Too large for one call: ${tooLarge.join(", ")} — each exceeds the per-call body budget of ` +
            `${WIKI_BODY_CHARS_PER_CALL} characters on its own. An atom is never truncated, so this route cannot ` +
            `hand it over whole; say so rather than treating it as read.`
        );
      }
      return textResult([...notices, ...blocks].join("\n\n"), {
        kind: served.length > 0 ? "wiki-atoms" : "wiki-refusal",
        servedBodies: served.length,
        served: served.map((s) => s.id),
        servedChars: spent,
        bodyBudget: WIKI_BODY_CHARS_PER_CALL,
        ...(missing.length > 0 ? { missing } : {}),
        ...(deferred.length > 0 ? { notServed: deferred } : {}),
        ...(tooLarge.length > 0 ? { tooLarge } : {}),
      });
    },
  });
}
