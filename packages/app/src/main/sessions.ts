import { chrome } from "./interface-language.js";
import { REFERENCE_LANGUAGE, stringsFor } from "../shared/i18n/index.js";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile, readFile, readdir, unlink, rename, stat } from "node:fs/promises";
import matter from "gray-matter";
import { isDidacticChecks, type DidacticChecks } from "@cbe/pi-bridge/didactic-checks";
import {
  isCanvasArtefactEntry,
  isStepCoverageEntry,
  sanitizeMaturitySnapshot,
  type CanvasArtefactEntry,
  type StepCoverageEntry,
  type MaturitySnapshot,
} from "@cbe/pi-bridge";
import type { DisplayAttachment } from "../shared/ipc-contract.js";
import { sanitizeToolCards, type PersistedToolCard } from "../shared/design-cards.js";
import { stripTerminalAssistantControlTokens } from "./assistant-text-boundary.js";

/**
 * Atomic file write: write to a temp file in the SAME directory, then rename over
 * the destination (capability `agent-harness`, Requirement: Sessions as Local
 * Markdown/JSON Files, "Write discipline"). With turn-boundary persistence the
 * sidecars are rewritten on every turn — a plain in-place writeFile would make
 * every turn a chance to truncate the canonical conversation on crash/power loss,
 * and a torn canonical JSON silently disconnects the lecturer from their
 * conversation (Scenario: A crash during a flush cannot tear the previous sidecar
 * state).
 */
async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, data, "utf8");
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export interface SessionMeta {
  sessionId: string;
  /** Legacy field from the retired operation-mode model. Read-tolerated on old
   * sidecars (kept in the frontmatter parse), never written to new ones, never
   * branched on. */
  mode?: string;
  modelId: string;
  skillVersion: string;
  environmentProfile: string;
  createdAt: string;
  closedAt: string;
}

/** Display projection of a user turn (capability `agent-harness`, Requirement:
 * Sessions as Local Markdown/JSON Files, "Display projection on user turns"):
 * what the lecturer actually SAW — their instruction plus attachment chips —
 * as opposed to `text`, the lossless model payload (which may carry ingest
 * envelopes and bracketed system notes). Optional and additive: older sidecars
 * without it stay fully readable. */
export interface TurnDisplay {
  text: string;
  attachments?: DisplayAttachment[];
}

export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
  /** Present on user turns whose displayed form differs from the model payload. */
  display?: TurnDisplay;
  /**
   * Present on an ASSISTANT turn the lecturer stopped (capability
   * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files*,
   * "Stopped marker on an assistant turn"). Optional and additive on exactly the
   * terms `display` establishes: older sidecars without it remain fully
   * readable, its absence means the turn is complete, and a malformed value is
   * treated as absent — it never invalidates the sidecar.
   *
   * The turn itself is a COMPLETED one: a stop promotes the streamed content to
   * the run's assistant turn, so the "turn boundaries persist completed turns
   * only" guarantee needs no exception for it.
   */
  stopped?: boolean;
  /**
   * The Markdown archive's stopped-turn note as it read when this turn was
   * recorded, frozen with the turn on exactly the terms `display` establishes.
   *
   * `writeSessionMd` regenerates the whole archive on every turn-boundary flush,
   * so resolving the note at write time would re-render it for every turn in the
   * file — a turn stopped while the interface was English would grow a German
   * note under its English body after a language change. A turn recorded before
   * this field existed carries none and reads the reference language, which is
   * the only language such a sidecar was ever written in.
   */
  stoppedNote?: string;
  /**
   * Present on an ASSISTANT turn that made DESIGN-RECORD tool calls — the calls
   * whose effect is a change to state the course keeps (capability
   * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files*,
   * "Design-record tool cards on an assistant turn"). Optional and additive on
   * exactly the terms `display` and `stopped` establish: an older sidecar
   * without it stays fully readable, its absence means the turn recorded no such
   * call, and a malformed value is treated as absent — a bad entry costs the
   * turn its cards, never the lecturer their transcript.
   *
   * Its scope, its render-only shape and why it carries no `details` payload are
   * decided in `shared/design-cards.ts`.
   */
  cards?: PersistedToolCard[];
}

/** Course design state carried in the sidecar beside the decision artefacts
 * (capability `agent-harness`, Requirement: Course Design-State Store). Optional
 * throughout: an absent field means "nothing was recorded", never an established
 * but empty value — the load path must not materialise anything from absence. */
export interface SessionDesignState {
  canvas?: CanvasArtefactEntry[];
  steps?: StepCoverageEntry[];
  maturity?: MaturitySnapshot;
}

function sanitizedAssistantTurn(turn: SessionTurn): SessionTurn {
  if (turn.role !== "assistant") return turn;
  const text = stripTerminalAssistantControlTokens(turn.text);
  return text === turn.text ? turn : { ...turn, text };
}

export interface SessionJson {
  meta: SessionMeta;
  turns: SessionTurn[];
  /**
   * Optional didactic-check state (capability `cbe-skill`, Requirement: Check
   * Execution Order). Present once any of the three checks has run. Omitted on
   * sessions that never entered the Check Pipeline so older sidecars stay
   * forward-readable. The Decisions section on the Canvas rehydrates from here on
   * resume (capability `desktop-app`, Requirement: Decision Artifacts).
   */
  didacticChecks?: DidacticChecks;
  canvas?: CanvasArtefactEntry[];
  steps?: StepCoverageEntry[];
  maturity?: MaturitySnapshot;
}

/**
 * Markdown sidecar — the human-readable archive. Lecturer can open it in any
 * editor after the app closes; the Markdown headings are intentionally simple
 * (`## user` / `## assistant`) so the file remains skim-readable even with
 * minimal tooling. The MD is intentionally LOSSY in the parsing direction —
 * if turn content itself contains a `##` heading, MD parsing back to turns
 * becomes ambiguous. The JSON sidecar is what the app reads back for
 * resume; the MD is the human face.
 *
 * Being the human face is why a turn carrying a `display` projection is rendered
 * from it (plus its attachment chips) rather than from `text`: `text` is the
 * model payload, and the host-prefix chain has grown from one-line notices to
 * bodies of machine text — the `app-ui reference` block alone is several
 * kilobytes on every Help-me activation. `display` is written exactly when the
 * two differ. Nothing is lost: the JSON sidecar keeps `text` verbatim and is the
 * audit face (capability `agent-harness`, Requirement: Sessions as Local
 * Markdown/JSON Files, display projection).
 */
export async function writeSessionMd(dir: string, meta: SessionMeta, turns: SessionTurn[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const lines: string[] = [];
  lines.push("---");
  lines.push(`sessionId: ${meta.sessionId}`);
  lines.push(`modelId: ${meta.modelId}`);
  lines.push(`skillVersion: ${meta.skillVersion}`);
  lines.push(`environmentProfile: ${meta.environmentProfile}`);
  lines.push(`createdAt: ${meta.createdAt}`);
  lines.push(`closedAt: ${meta.closedAt}`);
  lines.push("---");
  lines.push("");
  for (const t of turns) {
    lines.push(`## ${t.role}`);
    lines.push("");
    lines.push(t.display?.text ?? sanitizedAssistantTurn(t).text);
    const attachments = t.display?.attachments ?? [];
    if (attachments.length > 0) {
      lines.push("");
      lines.push(`Attachments: ${attachments.map((a) => a.filename).join(", ")}`);
    }
    // A stopped assistant turn says so in the archive too (Requirement:
    // Sessions as Local Markdown/JSON Files, "Stopped marker on an assistant
    // turn"): the archive is the face a lecturer opens in an editor, and an
    // unmarked half-answer there is the same untruth as an unmarked one in the
    // app.
    if (t.role === "assistant" && t.stopped === true) {
      lines.push("");
      lines.push(t.stoppedNote ?? stringsFor(REFERENCE_LANGUAGE).exportStoppedTurnNote);
    }
    // A turn that recorded design-record calls names them here, in the shape the
    // attachment line above already uses (Requirement: Sessions as Local
    // Markdown/JSON Files, "The Markdown archive names the recorded actions").
    // Tool NAMES only: the archive must not freeze the app's rendered chrome or
    // its language. Without this line a run that streamed no text would show as a
    // bare `## assistant` heading, which is the same untruth for a turn that did
    // work as an unmarked half-answer is for a stopped one.
    if (t.role === "assistant" && t.cards && t.cards.length > 0) {
      lines.push("");
      lines.push(`Recorded: ${t.cards.map((c) => c.toolName).join(", ")}`);
    }
    lines.push("");
  }
  const outFile = path.join(dir, `${meta.sessionId}.md`);
  await writeFileAtomic(outFile, lines.join("\n"));
  return outFile;
}

/**
 * JSON sidecar — the lossless reload source-of-truth. Written alongside the
 * Markdown archive on every close. Phase 3 (capability `course-workspace`,
 * Requirement: Project View Lists Stored Sessions and Supports Resume)
 * reads this file back to reconstruct the conversation state when the
 * lecturer reopens a stored session from the Project View. The shape stays
 * trivial — { meta, turns } — so a future schema bump only adds optional
 * fields; older sidecars stay forward-readable.
 */
export async function writeSessionJson(
  dir: string,
  meta: SessionMeta,
  turns: SessionTurn[],
  didacticChecks?: DidacticChecks,
  design?: SessionDesignState
): Promise<string> {
  await mkdir(dir, { recursive: true });
  // Only attach fields when present, so sessions that never entered the Check
  // Pipeline and never produced design state keep the trivial { meta, turns }
  // shape and older readers stay happy.
  //
  // Every caller MUST pass everything it holds: this write replaces the file
  // atomically, so a call that omits a field DELETES previously persisted state
  // (capability `agent-harness`, Requirement: Course Design-State Store). That
  // failure already occurred once for `didacticChecks`.
  const payload: SessionJson = {
    meta,
    turns: turns.map(sanitizedAssistantTurn),
    ...(didacticChecks ? { didacticChecks } : {}),
    ...(design?.canvas?.length ? { canvas: design.canvas } : {}),
    ...(design?.steps?.length ? { steps: design.steps } : {}),
    ...(design?.maturity && Object.keys(design.maturity).length > 0 ? { maturity: design.maturity } : {}),
  };
  const outFile = path.join(dir, `${meta.sessionId}.json`);
  await writeFileAtomic(outFile, JSON.stringify(payload, null, 2) + "\n");
  return outFile;
}

/**
 * The stored turns a resume may seed into the fresh pi session (capability
 * `agent-harness`, Requirement: *Sessions as Local Markdown/JSON Files* — "The
 * resume seed skips an assistant turn with no text").
 *
 * An assistant turn whose `text` is empty is a turn whose whole output was
 * design-record tool calls. It exists in the sidecar so the lecturer reads their
 * conversation back complete; it is NOT seeded, because before such turns were
 * persisted nothing about them reached a resumed model, and persistence must not
 * change what the model is seeded with. Flattened into a pi message it would
 * also be an assistant message whose only content block is an empty string.
 *
 * `cards` never reaches the model at all — the seed reads `text`, and the resume
 * turn shape carries nothing else.
 */
export function seedableTurns(turns: readonly SessionTurn[]): SessionTurn[] {
  return turns.filter((t) => t.role !== "assistant" || t.text.length > 0);
}

/**
 * Read a session sidecar back from disk. Used by the Phase-3 resume flow.
 * Returns null when the file is missing or malformed — the caller (Project
 * View) decides whether to show an error or skip the entry.
 */
export async function readSessionJson(dir: string, sessionId: string): Promise<SessionJson | null> {
  const file = path.join(dir, `${sessionId}.json`);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isSessionJson(parsed)) return null;
    // A malformed `display` value is treated as absent — it never invalidates the
    // sidecar (Requirement: Sessions as Local Markdown/JSON Files, display projection).
    let cardsDropped = 0;
    for (const t of parsed.turns) {
      if (t.role === "assistant") t.text = stripTerminalAssistantControlTokens(t.text);
      if (t.display !== undefined && !isTurnDisplay(t.display)) delete t.display;
      // Same terms for the stopped marker: absent means the turn is complete, a
      // malformed value is treated as absent, and neither invalidates the
      // sidecar. `false` is normalised away so "absent" is the only shape a
      // complete turn ever has downstream.
      if (t.stopped !== true) delete t.stopped;
      // The frozen note rides the marker: it is meaningless without it, and a
      // value that is not a non-empty string reads as absent rather than as copy.
      if (t.stopped !== true || typeof t.stoppedNote !== "string" || t.stoppedNote.length === 0) {
        delete t.stoppedNote;
      }
      // Same terms again for the recorded cards: malformed entries are dropped
      // and a wholly unreadable field is deleted, which reads downstream as "this
      // turn recorded nothing". The turn — and the sidecar — survive either way.
      if (t.cards !== undefined) {
        const { cards, dropped } = sanitizeToolCards(t.cards);
        if (dropped > 0) cardsDropped += dropped;
        if (cards.length > 0) t.cards = cards;
        else delete t.cards;
      }
    }
    if (cardsDropped > 0) {
      console.error(
        `[cbe:design-cards] ${cardsDropped} malformed tool-card record(s) in ${path.basename(file)} treated as absent`
      );
    }
    sanitizeDesignState(parsed, file);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Make the sidecar's design-state fields safe to hand on, in place (capability
 * `agent-harness`, Requirement: Course Design-State Store — "Corruption is not
 * fatal").
 *
 * This is the SINGLE choke point: every reader of a sidecar goes through
 * `readSessionJson`, so no consumer — the mirrors, the hydration payload, the
 * renderer — can be reached by an entry that was never validated. Malformed
 * entries are dropped and the fault is logged; a field that is wholly unreadable
 * (wrong container type, or every entry invalid) is DELETED, which makes it read
 * as "nothing recorded" and opens the course empty for that state.
 *
 * It deliberately does not invalidate the sidecar the way a malformed
 * `didacticChecks` does: a corrupt design-state field must cost the course its
 * design state, not its transcript. Same precedent as `display` above.
 */
function sanitizeDesignState(json: SessionJson, file: string): void {
  const dropped: string[] = [];

  if (json.canvas !== undefined) {
    const kept = Array.isArray(json.canvas) ? json.canvas.filter(isCanvasArtefactEntry) : [];
    const before = Array.isArray(json.canvas) ? json.canvas.length : -1;
    if (kept.length !== before)
      dropped.push(`canvas (${before < 0 ? "not an array" : `${before - kept.length} entries`})`);
    if (kept.length > 0) json.canvas = kept;
    else delete json.canvas;
  }

  if (json.steps !== undefined) {
    const kept = Array.isArray(json.steps) ? json.steps.filter(isStepCoverageEntry) : [];
    const before = Array.isArray(json.steps) ? json.steps.length : -1;
    if (kept.length !== before)
      dropped.push(`steps (${before < 0 ? "not an array" : `${before - kept.length} entries`})`);
    if (kept.length > 0) json.steps = kept;
    else delete json.steps;
  }

  if (json.maturity !== undefined) {
    const kept = sanitizeMaturitySnapshot(json.maturity);
    const before =
      json.maturity && typeof json.maturity === "object" && !Array.isArray(json.maturity)
        ? Object.keys(json.maturity).length
        : -1;
    if (Object.keys(kept).length !== before) {
      dropped.push(`maturity (${before < 0 ? "not an object" : `${before - Object.keys(kept).length} records`})`);
    }
    if (Object.keys(kept).length > 0) json.maturity = kept;
    else delete json.maturity;
  }

  if (dropped.length > 0) {
    console.error(
      `[cbe:design-state] malformed design state in ${path.basename(file)} treated as absent: ${dropped.join(", ")}`
    );
  }
}

function isTurnDisplay(value: unknown): value is TurnDisplay {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string") return false;
  if (v.attachments === undefined) return true;
  if (!Array.isArray(v.attachments)) return false;
  return v.attachments.every(
    (a) =>
      a &&
      typeof a === "object" &&
      typeof (a as Record<string, unknown>).filename === "string" &&
      typeof (a as Record<string, unknown>).docType === "string"
  );
}

/** One-line reason shown when the resume action is disabled (Scenario: Missing
 * JSON sidecar disables resume but keeps the entry listed). */
export function resumeDisabledReason(): string {
  return chrome().mainResumeDisabledReason;
}

/** One stored conversation as listed by the course detail view's Chats tab
 * (capability `course-workspace`, Requirement: One Canonical Conversation per
 * Course; capability `desktop-app`, Requirement: Course Detail Tabs: Chats and
 * Wiki). Meta comes from the JSON sidecar's `meta` block; when that sidecar is
 * missing or malformed the Markdown frontmatter fills in the display fields and
 * `resumable` is false with a one-line `reason`. */
export interface StoredSessionSummary {
  sessionId: string;
  modelId: string;
  skillVersion: string;
  createdAt: string;
  closedAt: string;
  resumable: boolean;
  reason?: string;
  /** Absolute path of the Markdown sidecar when present — the reveal target. */
  mdPath?: string;
  /** Completed turns in the JSON sidecar. Absent when the sidecar is unreadable. */
  turnCount?: number;
  /** First line of the first user turn's DISPLAYED form (`display.text` over the
   * raw model payload with its host prefixes), truncated — the human handle on a
   * row of UUID-named files. Absent when the sidecar is unreadable or the
   * conversation has no user turn yet. */
  snippet?: string;
}

/** Longest snippet the list carries — one line that still reads on a panel row. */
const SNIPPET_MAX_CHARS = 96;

function firstUserSnippet(turns: SessionTurn[]): string | undefined {
  const first = turns.find((t) => t.role === "user");
  if (!first) return undefined;
  const line = (first.display?.text ?? first.text)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > SNIPPET_MAX_CHARS ? `${line.slice(0, SNIPPET_MAX_CHARS - 1)}…` : line;
}

/** Best-effort display meta from the Markdown sidecar's frontmatter. */
async function readMdMeta(dir: string, sessionId: string): Promise<Partial<SessionMeta> | null> {
  try {
    const raw = await readFile(path.join(dir, `${sessionId}.md`), "utf8");
    const data = matter(raw).data as Record<string, unknown>;
    // The writer emits the ISO stamps unquoted, which the YAML parser reads back
    // as Date objects — accept both forms, or a Markdown-only pair carries no
    // date and drops out of the list's historical order.
    const pick = (k: string) => {
      const v = data[k];
      if (typeof v === "string") return v;
      if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
      return undefined;
    };
    return {
      mode: pick("mode"),
      modelId: pick("modelId"),
      skillVersion: pick("skillVersion"),
      createdAt: pick("createdAt"),
      closedAt: pick("closedAt"),
    };
  } catch {
    return null;
  }
}

/**
 * Enumerate the stored sessions of one course's `sessions/` folder by scanning
 * for sidecars on disk — no central database or index is consulted. Every
 * `<id>.json` with a valid meta block yields a resumable entry; an `<id>.md`
 * without a usable JSON sidecar stays listed (the lecturer can still recover
 * via the editor) with resume disabled and a one-line reason.
 */
export async function listStoredSessions(dir: string): Promise<StoredSessionSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const stems = new Set<string>();
  for (const name of entries) {
    if (name.endsWith(".json")) stems.add(name.slice(0, -".json".length));
    else if (name.endsWith(".md")) stems.add(name.slice(0, -".md".length));
  }
  const sessions: StoredSessionSummary[] = [];
  for (const sessionId of stems) {
    const hasMd = entries.includes(`${sessionId}.md`);
    const mdPath = hasMd ? path.join(dir, `${sessionId}.md`) : undefined;
    const json = await readSessionJson(dir, sessionId);
    if (json) {
      const snippet = firstUserSnippet(json.turns);
      sessions.push({
        sessionId,
        modelId: json.meta.modelId,
        skillVersion: json.meta.skillVersion,
        createdAt: json.meta.createdAt,
        closedAt: json.meta.closedAt,
        resumable: true,
        mdPath,
        turnCount: json.turns.length,
        ...(snippet ? { snippet } : {}),
      });
    } else {
      const mdMeta = hasMd ? await readMdMeta(dir, sessionId) : null;
      sessions.push({
        sessionId,
        modelId: mdMeta?.modelId ?? "",
        skillVersion: mdMeta?.skillVersion ?? "",
        createdAt: mdMeta?.createdAt ?? "",
        closedAt: mdMeta?.closedAt ?? "",
        resumable: false,
        reason: resumeDisabledReason(),
        mdPath,
      });
    }
  }
  // Stable historical order: newest first by the CREATION stamp (capability
  // `desktop-app`, Requirement: Course Detail Tabs: Chats and Wiki). Deliberately
  // NOT the key the canonical scan orders on — `closedAt` is the activity stamp
  // the post-resume flush re-writes so a restart re-enters the resumed pair, and
  // ordering the list on it made a resume jump its row to the top. A resume
  // never moves a row; only the open marking moves. Ties break on the
  // codepoint-wise larger sessionId (the canonical scan's tie rule); entries
  // without any stamp sort last.
  const stampOf = (s: StoredSessionSummary) => s.createdAt || "";
  sessions.sort((a, b) => {
    const byStamp = stampOf(b).localeCompare(stampOf(a));
    if (byStamp !== 0) return byStamp;
    return a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0;
  });
  return sessions;
}

/**
 * Canonical-conversation resolution (capability `course-workspace`, Requirement:
 * One Canonical Conversation per Course): the newest sidecar pair in `dir` by meta
 * timestamps (`closedAt` falling back to `createdAt`). Ordering metadata comes
 * from the JSON sidecar; a pair whose JSON is missing or unreadable still
 * PARTICIPATES via its Markdown frontmatter timestamps, then file mtime — so a
 * torn newest pair can never silently resurrect an older conversation. Timestamp
 * ties are broken by the codepoint-wise larger sessionId (plain `>` comparison,
 * locale-independent).
 */
export type CanonicalConversation =
  | { kind: "resumable"; sessionId: string; json: SessionJson }
  | { kind: "unreadable"; sessionId: string }
  | { kind: "none" };

export async function resolveCanonicalConversation(dir: string): Promise<CanonicalConversation> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { kind: "none" };
  }
  const stems = new Set<string>();
  for (const name of entries) {
    if (name.endsWith(".json")) stems.add(name.slice(0, -".json".length));
    else if (name.endsWith(".md")) stems.add(name.slice(0, -".md".length));
  }
  if (stems.size === 0) return { kind: "none" };

  let best: { sessionId: string; stamp: string; json: SessionJson | null } | null = null;
  for (const sessionId of stems) {
    const json = await readSessionJson(dir, sessionId);
    let stamp = "";
    if (json) {
      stamp = json.meta.closedAt || json.meta.createdAt || "";
    } else {
      const mdMeta = await readMdMeta(dir, sessionId);
      stamp = mdMeta?.closedAt || mdMeta?.createdAt || "";
      if (!stamp) {
        // Last resort: file mtime (ISO, so it stays comparable with meta stamps).
        stamp = await fileMtimeIso(path.join(dir, `${sessionId}.json`), path.join(dir, `${sessionId}.md`));
      }
    }
    if (
      best === null ||
      stamp > best.stamp ||
      // Codepoint-wise tie-break: larger sessionId wins (stable, test-fixable).
      (stamp === best.stamp && sessionId > best.sessionId)
    ) {
      best = { sessionId, stamp, json };
    }
  }
  if (!best) return { kind: "none" };
  return best.json
    ? { kind: "resumable", sessionId: best.sessionId, json: best.json }
    : { kind: "unreadable", sessionId: best.sessionId };
}

async function fileMtimeIso(...candidates: string[]): Promise<string> {
  for (const file of candidates) {
    try {
      return (await stat(file)).mtime.toISOString();
    } catch {
      // try the next candidate
    }
  }
  return "";
}

/**
 * Delete a stored session: removes BOTH sidecars (`<id>.md` AND `<id>.json`) in
 * one action (Scenario: Deleting a session removes both sidecars after
 * confirmation — the confirmation step lives in the renderer). An already-absent
 * sidecar is fine (nothing to remove); a failing removal aborts with a one-line
 * error and the surviving sidecar stays on disk.
 */
export async function deleteStoredSession(dir: string, sessionId: string): Promise<void> {
  const remove = async (file: string) => {
    try {
      await unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(`Could not delete ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await remove(path.join(dir, `${sessionId}.json`));
  await remove(path.join(dir, `${sessionId}.md`));
}

function isSessionJson(value: unknown): value is SessionJson {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.meta || typeof v.meta !== "object") return false;
  if (!Array.isArray(v.turns)) return false;
  const meta = v.meta as Record<string, unknown>;
  for (const k of ["sessionId", "modelId", "skillVersion", "environmentProfile", "createdAt", "closedAt"]) {
    if (typeof meta[k] !== "string") return false;
  }
  // Legacy read-tolerance: an old sidecar's `mode` field is accepted when it is
  // a string, absent on new sidecars — never required, never branched on.
  if (meta.mode !== undefined && typeof meta.mode !== "string") return false;
  for (const t of v.turns) {
    if (!t || typeof t !== "object") return false;
    const turn = t as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "assistant") return false;
    if (typeof turn.text !== "string") return false;
  }
  // didacticChecks is optional; when present it must be a well-formed check state,
  // otherwise the sidecar is malformed and resume should reject it (return null).
  if (v.didacticChecks !== undefined && !isDidacticChecks(v.didacticChecks)) return false;
  // `canvas`, `steps` and `maturity` are validated NON-fatally, in
  // `sanitizeDesignState` at read time: a malformed design-state field is treated as
  // absent (the course opens with that state empty and the fault is logged) rather
  // than invalidating the whole sidecar and costing the course its transcript
  // (capability `agent-harness`, Requirement: Course Design-State Store —
  // "Corruption is not fatal").
  return true;
}
