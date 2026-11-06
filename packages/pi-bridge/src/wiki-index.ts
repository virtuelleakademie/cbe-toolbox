/**
 * Stage-1 wiki retrieval and the per-session gate that forces it (capability
 * `agent-harness`, Requirement: *cbe_wiki Wiki-Retrieval Tool with a Forced
 * Index-First Route*; capability `lecturer-wiki`, Requirement: *Wiki Index for
 * Stage-1 Retrieval*).
 *
 * Two things live here, and they are deliberately separate from the tool that uses
 * them:
 *
 *   1. The filesystem half — reading `wiki/index.md`, listing the atom ids it
 *      carries, and reading one atom body through a containment check. No policy.
 *   2. `WikiRetrievalGate` — the session state that makes the ordering a FACT
 *      rather than an instruction: whether the index has been handed to this
 *      session, and the notice queue for atoms an ingestion lands mid-session.
 *
 * Why a gate at all: before this route existed, no instruction channel named the
 * wiki index, the atoms or the wiki at all, and an agent asked about the lecturer's
 * own material read the imported extraction under `raw/` — the one file it can find
 * without guidance. A sentence asking for index-first can be skipped; a route that
 * serves no atom body before the index cannot.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

/** The index as stage 1 delivers it. `text` is the file exactly as the atomization
 * run wrote it; `atomIds` are the wiki-relative stems it references. */
export interface WikiIndexRead {
  /** Absent wiki path, missing `index.md`, or unreadable file → false. */
  present: boolean;
  text: string;
  atomIds: string[];
}

/** Course-relative layers that are NOT retrieval targets: `inbox/` holds the
 * untouched original, `raw/` its deterministic extraction. The atoms outrank both
 * (capability `lecturer-wiki`, Requirement: Wiki Index for Stage-1 Retrieval). */
export const IMPORT_LAYERS = ["raw", "inbox"] as const;

/** How many atom bodies one call may return. Selection happens against the index;
 * the wiki is never loaded wholesale. */
export const WIKI_ATOMS_PER_CALL = 5;

/**
 * How much atom body one call may return, summed over the served bodies and measured
 * in characters of the file text.
 *
 * Why a size bound beside the count. Atom size is unbounded in practice: the wiki
 * skill atomises a repeat entity by MERGING it — appending a `## From <source-title>`
 * section to the atom that already exists — so an atom a course re-ingests across a
 * semester grows monotonically, and the files are lecturer-editable besides. Five
 * such atoms is a legal call under the count cap alone, and it would put tens of
 * thousands of tokens of material into a turn that also has to carry the
 * conversation. That is not a rare combination; it is the ordinary end state of a
 * well-used course, and it would land on the lecturer who invested the most.
 *
 * 24,000 is a JUDGEMENT, not a measured threshold — roughly six thousand tokens, a
 * minority share of the smallest context this product ships against, while still
 * holding several ordinary atoms whole. Nothing in this repository ties the value to
 * observed behaviour; whoever moves it states a new basis.
 *
 * The budget never truncates. A body is served whole or not at all, and what is not
 * served is named — a cut atom is the same uncurated fragment as the `raw/`
 * extraction this route exists to replace, reached from the other side.
 */
export const WIKI_BODY_CHARS_PER_CALL = 24000;

/**
 * How long the stage-1 index payload may be before it is COMPACTED, measured in
 * characters of the index text.
 *
 * The body budget's shape does NOT transfer here, and that is the whole point. For a
 * body, naming the atoms it withheld preserves completeness — the model still knows
 * they exist and asks for them in a further call. For the index there is no such
 * line, because naming what is missing IS the index. A partial index means the model
 * selects from an incomplete list, which destroys the one property this route exists
 * to create: the selection is made from what exists instead of from a guess. So the
 * index is never cut, never paginated and never sectioned. It is COMPACTED — the
 * description text may degrade, the set of reachable ids may not.
 *
 * The rule that outranks the budget: an atom id is never dropped. If even the
 * id-only compact form is over budget it is served whole anyway; this number governs
 * whether the prose comes with the ids, not whether the ids come at all.
 *
 * 12,000 is a JUDGEMENT, not a measured threshold — half the body budget, on the
 * reasoning that stage 1 is the one call the route forces on every session and
 * re-forces after every ingestion, so it should cost less than a selection the model
 * chose to make. Nothing in this repository ties the value to observed behaviour.
 */
export const WIKI_INDEX_CHARS_PER_CALL = 12000;

/** Normalise an atom reference to a wiki-relative stem: strip a `.md` suffix, a
 * `[[…]]` wrapper and surrounding whitespace, and use forward slashes. */
export function normaliseAtomId(raw: string): string {
  return raw
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\.\//, "")
    .trim();
}

/** Atom ids referenced by an index body — the `[[wikilink]]` form the wiki skill
 * writes, plus bare `path/to/atom.md` mentions, which the lint layer also accepts
 * when it checks index completeness.
 *
 * Every derived id passes the same servability policy the tool resolves against, so
 * the set the caller ADVERTISES and the set it can SERVE are identical. Without it
 * an index whose prose mentions its source ("compiled from raw/skript.md") would put
 * `raw/skript` on the list of ids a refusal offers as the correction — and that id
 * is refused by the very next call. */
export function atomIdsFromIndex(text: string): string[] {
  const ids = new Set<string>();
  const add = (raw: string) => {
    const id = normaliseAtomId(raw);
    if (id && atomIdRefusal(id) === null) ids.add(id);
  };
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) add(m[1] ?? "");
  for (const m of text.matchAll(/(?:^|[\s(])([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.md)\b/g)) add(m[1] ?? "");
  return [...ids];
}

/**
 * The index rendered as ids alone, grouped by page type — every id the index
 * references, in the order it references them, with the per-entry notes and the
 * surrounding narrative dropped.
 *
 * This is what an over-budget index degrades to (`WIKI_INDEX_CHARS_PER_CALL`). It
 * drops description, never an id: the grouping is kept because it costs one label per
 * page type and it helps selection, and it would be dropped before any id would be.
 * Ids that carry no page type are grouped under `.`, which no id can collide with —
 * `atomIdRefusal` rejects a `.` segment.
 */
export function compactIndexText(atomIds: readonly string[]): string {
  const groups = new Map<string, string[]>();
  for (const id of atomIds) {
    const slash = id.indexOf("/");
    const key = slash > 0 ? id.slice(0, slash) : ".";
    const bucket = groups.get(key);
    if (bucket) bucket.push(id);
    else groups.set(key, [id]);
  }
  return [...groups].map(([key, ids]) => `${key}: ${ids.join(", ")}`).join("\n");
}

/** Read `wiki/index.md`. A missing wiki, a missing index or an unreadable file all
 * yield `present: false` — the caller reports the gap, it never guesses. */
export async function readWikiIndex(wikiDir: string | undefined): Promise<WikiIndexRead> {
  if (!wikiDir) return { present: false, text: "", atomIds: [] };
  let text: string;
  try {
    text = await readFile(path.join(wikiDir, "index.md"), "utf8");
  } catch {
    return { present: false, text: "", atomIds: [] };
  }
  return { present: true, text, atomIds: atomIdsFromIndex(text) };
}

/** Why an atom reference cannot be served. The two are DIFFERENT mistakes and the
 * caller must be able to tell them apart: `outside` is reaching for something that is
 * not an atom (the import layers, or an escape from the wiki), while `absolute` is
 * handing over a filesystem path where a wiki-relative id belongs — which is what a
 * model trained to pass the descriptor's paths to the file tools verbatim will do. */
export type AtomPathRefusal = "outside" | "absolute";

/**
 * The servability policy for an atom id, independent of which wiki directory it would
 * resolve against: absolute paths, escapes, and the `raw/` / `inbox/` layers are not
 * atoms. `null` means servable.
 *
 * It is a separate function on purpose — `resolveAtomPath` and `atomIdsFromIndex`
 * both need it, and a second hand-written copy is how the advertised set and the
 * servable set drift apart.
 */
export function atomIdRefusal(atomId: string): AtomPathRefusal | null {
  const id = normaliseAtomId(atomId);
  if (!id) return "outside";
  if (path.isAbsolute(id) || /^[A-Za-z]:/.test(id)) return "absolute";
  const segments = id.split("/");
  if (segments.some((s) => s.length === 0 || s === "." || s === "..")) return "outside";
  if ((IMPORT_LAYERS as readonly string[]).includes(segments[0] ?? "")) return "outside";
  return null;
}

/**
 * Resolve a wiki-relative atom id to an absolute path INSIDE the wiki directory.
 * Returns a refusal instead of a path for anything absolute, anything escaping the
 * directory, and anything naming the `raw/` or `inbox/` layer beside it.
 */
export function resolveAtomPath(
  wikiDir: string,
  atomId: string
): { ok: true; path: string; id: string } | { ok: false; refusal: AtomPathRefusal } {
  const refusal = atomIdRefusal(atomId);
  if (refusal !== null) return { ok: false, refusal };
  const id = normaliseAtomId(atomId);
  const root = path.resolve(wikiDir);
  const target = path.resolve(root, `${id}.md`);
  // Belt and braces: the policy above already rejects every escape it can see, and
  // this re-checks the resolved path against the real root.
  if (target !== root && !target.startsWith(root + path.sep)) return { ok: false, refusal: "outside" };
  return { ok: true, path: target, id };
}

/** Read one atom body. Missing/unreadable file → null; the caller turns that into a
 * refusal that names the ids the index does carry. */
export async function readAtomBody(atomPath: string): Promise<string | null> {
  try {
    return await readFile(atomPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Atoms an ingestion landed since the last lecturer turn, awaiting disclosure
 * (capability `agent-harness`, Requirement: *Newly Ingested Wiki Atoms Are Disclosed
 * on the Next Lecturer Turn*). A QUEUE like `PendingDeletionNotice`, not an
 * exclusive slot like the step focus: two ingestions between two turns both landed
 * material, and neither makes the other irrelevant.
 */
export interface PendingWikiAtomsNotice {
  atoms: string[];
}

/** How many atom ids the notice names before it summarises the rest. The line is
 * machine-readable, not a listing surface. */
const NOTICE_NAMED_ATOMS = 5;

/**
 * One machine-readable wiki-atoms notice line. Deliberately structural, not
 * lecturer-facing — it is prefixed to the model payload, never rendered.
 *
 * It states the FACT (material landed, the index moved) and stops there: how the
 * wiki is read is the tool description's business, and restating it here would put
 * one rule in two channels.
 */
export function wikiAtomsNoticeLine(n: PendingWikiAtomsNotice): string {
  const named = n.atoms.slice(0, NOTICE_NAMED_ATOMS);
  const rest = n.atoms.length - named.length;
  const list = named.length > 0 ? `: ${named.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}` : "";
  const count = n.atoms.length === 1 ? "1 atom" : `${n.atoms.length} atoms`;
  return (
    `[wiki-atoms] An ingestion added ${count} to the lecturer's wiki since the last turn${list}. ` +
    `Your picture of the wiki index is out of date — take it again before you ground anything in their material.`
  );
}

/**
 * Prefix the pending wiki-atoms notice to the next lecturer turn's payload — one
 * line ahead of the lecturer's own text. No pending notice → text unchanged. The
 * composed text is what reaches the model AND the persisted transcript (lossless);
 * the renderer displays only the lecturer's own turn.
 */
export function composePayloadWithWikiAtomsNotice(notice: PendingWikiAtomsNotice | null, text: string): string {
  if (!notice || notice.atoms.length === 0) return text;
  return `${wikiAtomsNoticeLine(notice)}\n\n${text}`;
}

/**
 * The per-session retrieval state. Holds exactly two facts:
 *
 *   - `indexDelivered` — has this session been handed the index? The invariant the
 *     route enforces is narrow on purpose: no atom body may reach a session that has
 *     not seen the index. A stage-2 call made too early is answered WITH the index,
 *     which both teaches and unblocks, so the correction is one re-call away.
 *   - the pending-atoms notice — armed by the host when an ingestion lands atoms.
 *     Landing atoms also CLEARS `indexDelivered`: the index the model holds is stale
 *     the moment new atoms are written, and that half is deterministic — it holds
 *     whether or not the model reads the notice.
 */
export class WikiRetrievalGate {
  private indexDelivered = false;
  private pending: string[] = [];

  /** True while an atom body may not be served yet. */
  requiresIndex(): boolean {
    return !this.indexDelivered;
  }

  /** Record that the index text has been handed to this session. */
  markIndexDelivered(): void {
    this.indexDelivered = true;
  }

  /**
   * An ingestion landed atoms: arm the disclosure AND invalidate the delivered
   * index. Ids are deduplicated and order-preserving; an empty list is a no-op, so
   * a run in which every document failed arms nothing and touches no state.
   */
  recordIngestedAtoms(atoms: readonly string[]): void {
    const fresh = atoms.map((a) => normaliseAtomId(a)).filter((a) => a.length > 0);
    if (fresh.length === 0) return;
    for (const a of fresh) if (!this.pending.includes(a)) this.pending.push(a);
    this.indexDelivered = false;
  }

  /** The armed notice without consuming it — read BEFORE composing, so a payload the
   * model never receives can give it back. */
  pendingAtoms(): PendingWikiAtomsNotice | null {
    return this.pending.length > 0 ? { atoms: [...this.pending] } : null;
  }

  /** Take the armed notice for one payload. */
  drainAtomsNotice(): PendingWikiAtomsNotice | null {
    const notice = this.pendingAtoms();
    this.pending = [];
    return notice;
  }

  /** Put a notice back that was drained into a payload the model never received.
   * Ids landed since then are kept — the restored ones simply rejoin the queue. */
  requeueAtomsNotice(notice: PendingWikiAtomsNotice | null): void {
    if (!notice || notice.atoms.length === 0) return;
    const merged = [...notice.atoms];
    for (const a of this.pending) if (!merged.includes(a)) merged.push(a);
    this.pending = merged;
  }
}
