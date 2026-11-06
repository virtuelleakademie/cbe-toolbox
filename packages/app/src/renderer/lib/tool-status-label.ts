/**
 * Human-readable labels for tool rows inside deliberately opened current-turn
 * technical detail, in the active interface language. The compact Working
 * disclosure itself is intentionally generic and never consumes these labels.
 * The label is `<fixed verb phrase> "<optional sanitised detail>"`:
 *
 * - The verb is derived ONLY from `toolName` (the trusted tool identity), never
 *   from `args` — so a crafted argument can neither become nor precede the action
 *   verb (Verb integrity / anti-spoofing).
 * - The optional detail is derived defensively from a known-safe field, sanitised
 *   (control / bidi / zero-width collapsed) and truncated, and rendered in a
 *   delimited (quoted) position.
 *
 * Presentation-only: this module reads already-reduced live state at render time
 * and never mutates the activity stream, the persisted turn, or the model prompt
 * (design D4).
 */
import type { CBE_TOOL_ALLOWLIST } from "@cbe/pi-bridge";
import type { ToolStatus } from "../components/ToolCard.js";
import type { ChromeCatalogue, ChromeStringKey } from "../../shared/i18n/index.js";
import { depthLabel, isStepDepth } from "../mocks/artifacts.js";

/**
 * The agent tool allowlist as a string-literal union, linked at COMPILE TIME to
 * pi-bridge's `CBE_TOOL_ALLOWLIST`. Adding an allowlist tool turns the `LABELS`
 * map below into a type error until a bespoke label exists (design D2). This is a
 * **type-only** import — no runtime coupling, no IPC change, no Pi patching.
 */
type ToolName = (typeof CBE_TOOL_ALLOWLIST)[number];

/** Catalogue key of the generic, non-empty fallback for a tool name not in
 * `LABEL_KEYS` (design D2). */
export const FALLBACK_LABEL_KEY: ChromeStringKey = "toolFallbackLabel";

/** Hard cap on the arg-derived detail (characters) before the trailing ellipsis. */
export const MAX_DETAIL_CHARS = 60;

/**
 * Fixed, verb-led, present-tense verb phrase per allowlist tool, resolved from the
 * interface-language catalogue. The key
 * type is `ToolName`, so a new allowlist tool is a compile error here until it
 * gets a bespoke label. The verb NEVER comes from `args`.
 */
const LABEL_KEYS: Record<ToolName, ChromeStringKey> = {
  read: "toolReadLabel",
  write: "toolWriteLabel",
  edit: "toolEditLabel",
  grep: "toolGrepLabel",
  find: "toolFindLabel",
  ls: "toolLsLabel",
  cbe_picker: "toolPickerLabel",
  cbe_decision_checklist: "toolChecklistLabel",
  cbe_cite: "toolCiteLabel",
  cbe_canvas: "toolCanvasLabel",
  cbe_profile: "toolProfileLabel",
  cbe_step: "toolStepLabel",
  cbe_maturity: "toolMaturityLabel",
  cbe_wiki: "toolWikiLabel",
  cbe_support: "toolSupportLabel",
};

/**
 * Characters collapsed to a single space by `safeDetail` before truncation:
 * C0 + DEL + C1 controls (incl. newlines, U+0000–U+001F / U+007F–U+009F), Unicode
 * bidi controls (U+202A–U+202E embeddings/overrides, U+2066–U+2069 isolates), and
 * zero-width chars (U+200B–U+200D, U+FEFF). These matter because `cbe_cite.claim`
 * and `cbe_canvas.label` are free text the model emits from lecturer input — a
 * naive "strip \n" would leave a U+202E that visually reorders the label.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Make an arg-derived snippet safe for a one-line label: collapse every unsafe
 * character class AND runs of whitespace to single spaces, trim, then truncate to
 * `MAX_DETAIL_CHARS` with a trailing ellipsis. Never throws; empty input → "".
 */
export function safeDetail(raw: string): string {
  const collapsed = raw.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_DETAIL_CHARS) return collapsed;
  return collapsed.slice(0, MAX_DETAIL_CHARS) + "…";
}

/** Last non-empty path segment, splitting on BOTH `/` and `\` (cross-platform).
 *  Reads `args.path ?? args.file_path` (pi built-ins are not uniform). A
 *  non-string, empty, or otherwise unusable path yields "" → bare verb. */
function fileBasename(args: unknown): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const p = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : "";
  if (!p) return "";
  const segments = p.split(/[/\\]/).filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : "";
}

/** Corpus reference for `cbe_cite`, from the always-present identity fields
 *  (`id`/`section`); a present `claim` is appended but its absence MUST NOT empty
 *  the detail. Never reads any other field. */
function citeReference(args: unknown): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const id = typeof a.id === "string" ? a.id : "";
  if (!id) return "";
  const section = typeof a.section === "string" && a.section ? ` § ${a.section}` : "";
  const claim = typeof a.claim === "string" && a.claim.trim() ? ` – ${a.claim.trim()}` : "";
  return `${id}${section}${claim}`;
}

/** Artefact name for `cbe_canvas`: `label ?? id`, NEVER the artefact `value`
 *  (which may be a long paragraph). */
function canvasArtefact(args: unknown): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (typeof a.label === "string" && a.label.trim()) return a.label;
  if (typeof a.id === "string" && a.id.trim()) return a.id;
  return "";
}

/** Maturity reference for `cbe_maturity`: the criterion key, optionally with the
 *  level; a batched `readings` call is labelled as the raster update. NEVER the
 *  free-text `hint`/`note` fields. */
function maturityReference(args: unknown, t: ChromeCatalogue): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (Array.isArray(a.readings)) return t.toolDetailFullRaster;
  if (typeof a.criterion !== "string" || !a.criterion.trim()) return "";
  const level =
    typeof a.current === "number" && Number.isFinite(a.current)
      ? ` – L${a.current}`
      : a.current === "unassessed"
        ? ` – ${t.toolDetailUnassessed}`
        : "";
  return `${a.criterion}${level}`;
}

/** Step reference for `cbe_step`: the step number, optionally with the depth when
 *  present. The depth is rendered through the SAME catalogue entries the canvas
 *  panel beside it uses, so the two cannot disagree. NEVER the free-text `note`
 *  field. */
function stepReference(args: unknown, t: ChromeCatalogue): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (typeof a.step !== "number" || !Number.isFinite(a.step)) return "";
  const raw = typeof a.depth === "string" ? a.depth.trim() : "";
  // A `cbe_step` payload is model-supplied, so a token the canvas does not name
  // reaches the indicator as it arrived rather than as nothing — a detail the
  // lecturer cannot read is worse than an untranslated one.
  const named = isStepDepth(raw) ? depthLabel(raw, t) : raw;
  return `${t.toolDetailStep({ step: a.step })}${named ? ` – ${named}` : ""}`;
}

/**
 * Raw (pre-sanitisation) detail for a tool, or "" when the tool gets none. Only
 * file tools (`read`/`write`/`edit`), `cbe_cite`, and `cbe_canvas` derive a
 * detail (design D3); every other tool renders the bare verb.
 */
function rawDetail(toolName: string, args: unknown, t: ChromeCatalogue): string {
  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return fileBasename(args);
    case "cbe_cite":
      return citeReference(args);
    case "cbe_canvas":
      return canvasArtefact(args);
    case "cbe_step":
      return stepReference(args, t);
    case "cbe_maturity":
      return maturityReference(args, t);
    default:
      return "";
  }
}

/**
 * The single source of human-readable tool labels. Total: every input returns a
 * non-empty string; a malformed/absent `args` degrades to the bare verb and never
 * throws. An unknown tool name returns the generic fallback.
 */
export function toolStatusLabel(toolName: string, args: unknown, t: ChromeCatalogue): string {
  const key = (LABEL_KEYS as Record<string, ChromeStringKey | undefined>)[toolName] ?? FALLBACK_LABEL_KEY;
  const verb = t[key] as string;
  const detail = safeDetail(rawDetail(toolName, args, t));
  return detail ? `${verb} "${detail}"` : verb;
}

/**
 * Catalogue key per tool-row lifecycle state. The `ToolStatus` union itself stays
 * the internal English token — it is reduced from events, stored and compared —
 * and this map is the only place it becomes something a lecturer reads, so a new
 * state is a compile error here until it has copy in every language.
 */
const STATUS_KEYS: Record<ToolStatus, ChromeStringKey> = {
  running: "toolStatusRunning",
  done: "toolStatusDone",
  error: "toolStatusError",
};

/**
 * The lifecycle state as the active interface language renders it — in the row and
 * in the row's accessible name, which read the SAME value so the two cannot drift.
 * Total: a token no state names degrades to itself rather than to nothing, the same
 * way an unnamed step depth does above.
 */
export function toolStatusText(status: string, t: ChromeCatalogue): string {
  const key = (STATUS_KEYS as Record<string, ChromeStringKey | undefined>)[status];
  return key ? (t[key] as string) : status;
}
