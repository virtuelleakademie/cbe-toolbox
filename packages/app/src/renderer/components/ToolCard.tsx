import { useState } from "react";
import { useCbe } from "../state/store.js";
import { promptFailureNotice } from "../util/errors.js";
import { shortenAgentPath } from "../util/paths.js";
import { toolStatusLabel, toolStatusText } from "../lib/tool-status-label.js";
import { Picker, type PickerResponse, type PickerSpec } from "./Picker.js";
import { DecisionChecklist, type DecisionChecklistSpec } from "./DecisionChecklist.js";
import { toolResultText } from "../../shared/design-cards.js";
import { useChrome } from "../chrome.js";
import type { ChromeCatalogue } from "../../shared/i18n/index.js";

export type ToolStatus = "running" | "done" | "error";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: ToolStatus;
  result?: unknown;
  errorMessage?: string;
}

export function summariseArgs(toolName: string, args: unknown, shorten: (p: string) => string): string {
  if (args == null || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  // cbe_cite is a citation lookup — summarise the CITED SOURCE (id, section, author/year)
  // so each card is distinguishable, not the generic parameter-name fallback. Without this
  // every cite card reads "author, id, section" and they all look identical.
  if (toolName === "cbe_cite") {
    const id = typeof a.id === "string" ? a.id : "";
    const section = typeof a.section === "string" ? a.section : "";
    const author = typeof a.author === "string" ? a.author.trim() : "";
    const year = typeof a.year === "number" ? String(a.year) : "";
    const src = [author, year].filter(Boolean).join(" ");
    // The store rides on the id: a bare id is a corpus document, a `wiki:`-prefixed one
    // an atom of the lecturer's own wiki. Prefixing `corpus:` unconditionally labelled
    // the lecturer's material as corpus AND doubled the scheme, so the card must derive
    // the head from the id rather than assume one store.
    const head = id ? (/^wiki:/i.test(id.trim()) ? id.trim() : `corpus:${id}`) : "cbe_cite";
    const sec = section ? ` § ${section}` : "";
    return src ? `${head}${sec}, ${src}` : `${head}${sec}`;
  }
  // cbe_profile records a lecturer-state estimate — summarise the ACTUAL update
  // (dimension → value · confidence) so the lecturer sees in the transcript which
  // dimension changed to which level, not the parameter names.
  if (toolName === "cbe_profile") {
    const dimension = typeof a.dimension === "string" ? a.dimension : "";
    const value = typeof a.value === "string" ? a.value : "";
    const confidence = typeof a.confidence === "string" ? a.confidence : "";
    const head = dimension && value ? `${dimension} → ${value}` : dimension || value || "cbe_profile";
    return confidence ? `${head} · ${confidence}` : head;
  }
  // Prefer the most natural human-readable arg for each tool. Paths win over patterns,
  // patterns win over generic keys — so a `read` shows "corpus/content/…" and a
  // `grep` shows the search pattern.
  if (typeof a.path === "string") return shorten(a.path);
  if (typeof a.file_path === "string") return shorten(a.file_path);
  if (typeof a.directory === "string") return shorten(a.directory);
  if (typeof a.pattern === "string") return `/${a.pattern}/`;
  if (typeof a.query === "string") return `"${a.query}"`;
  if (typeof a.command === "string") return a.command;
  const keys = Object.keys(a).slice(0, 3).join(", ");
  return keys || toolName;
}

// Hard safety cap so a pathological tool result (e.g. a `read` against a huge
// binary or a generated megabyte-blob) cannot blow up the renderer. The card
// body has CSS-side max-height + overflow-y, so the lecturer scrolls inside the
// cap — they are NOT meant to read every byte, just to see what the agent saw.
const TOOL_BODY_MAX_CHARS = 50_000;

function clampForBody(s: string): string {
  return s.length > TOOL_BODY_MAX_CHARS ? s.slice(0, TOOL_BODY_MAX_CHARS) + "\n\n… (truncated, exceeded body cap)" : s;
}

/** Returns technical result text for deliberately opened current-turn detail.
 * Newlines are preserved and pathological input is capped. The extraction lives
 * in `shared/design-cards.ts` because the compatible sidecar recorder already
 * owns the same bounded result-text projection. */
function bodyResultText(result: unknown): string {
  return clampForBody(toolResultText(result));
}

export function isRenderablePickerSpec(args: unknown): args is PickerSpec {
  if (args == null || typeof args !== "object") return false;
  const a = args as { question?: unknown; options?: unknown };
  if (typeof a.question !== "string" || a.question.trim().length === 0) return false;
  if (!Array.isArray(a.options) || a.options.length < 2 || a.options.length > 7) return false;
  return a.options.every((option) => {
    if (option == null || typeof option !== "object") return false;
    const opt = option as { id?: unknown; label?: unknown };
    return (
      typeof opt.id === "string" &&
      opt.id.trim().length > 0 &&
      typeof opt.label === "string" &&
      opt.label.trim().length > 0
    );
  });
}

export function isRenderablePickerCard(card: ToolCardData): boolean {
  return card.toolName === "cbe_picker" && card.status !== "error" && isRenderablePickerSpec(card.args);
}

/**
 * Defensive runtime sanity-check on a cbe_picker spec. Returns `null` if the
 * spec is renderable, or a human-readable defect message otherwise. The
 * caller replaces the Picker with safe recovery whenever this returns a message.
 * Without this, a placeholder / empty payload from the model would render as
 * visually empty pills.
 */
export function validatePickerSpec(args: unknown, t: ChromeCatalogue): string | null {
  const reject = (detail: string): string => t.toolPickerSpecRejected({ detail });
  if (args == null || typeof args !== "object") return reject(t.toolSpecDetailArgsMissing);
  const a = args as { question?: unknown; options?: unknown };
  if (typeof a.question !== "string" || a.question.trim().length === 0) {
    return reject(t.toolSpecDetailQuestionMissing);
  }
  if (!Array.isArray(a.options)) return reject(t.toolSpecDetailOptionsMissing);
  if (a.options.length < 2) return reject(t.toolSpecDetailOptionsTooFew({ count: a.options.length }));
  // Pi may emit `tool_execution_start` before its schema rejection reaches the
  // renderer. Mirror the schema's upper bound here so nine pills never flash.
  if (a.options.length > 7) return reject(t.toolPickerCallFailed);
  for (let i = 0; i < a.options.length; i++) {
    const opt = a.options[i] as { id?: unknown; label?: unknown };
    if (opt == null || typeof opt !== "object") return reject(t.toolSpecDetailOptionNotObject({ index: i }));
    if (typeof opt.id !== "string" || opt.id.trim().length === 0)
      return reject(t.toolSpecDetailOptionIdEmpty({ index: i }));
    if (typeof opt.label !== "string" || opt.label.trim().length === 0) {
      return reject(t.toolSpecDetailOptionLabelEmpty({ index: i }));
    }
  }
  return null;
}

/** Cap for the model-authored context a deferred answer echoes back — the
 * picker's question, the checklist's title. The same slice the host-side gate
 * applies to the question it remembers (`PendingAnswerGate.registerEmission`);
 * free text is bounded rather than embedded whole. */
const ENVELOPE_CONTEXT_MAX_CHARS = 160;

/** The answer payload is a line-structured envelope — one field per line — so a
 * model-authored question must not be able to contribute a second line. Its
 * whitespace is collapsed BEFORE the cap, otherwise a question containing a
 * newline plus `selected: …` would forge an envelope field in the model's own
 * next-turn context: the pre-emption the pending-answer gate exists to prevent. */
function envelopeField(value: string, maxChars: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/** Format a picker selection as the next user turn.
 *
 * The envelope carries the QUESTION the selection answers, and it carries it in
 * BOTH halves of the prompt IPC's display/payload split. A turn ending on a
 * picker produces no assistant text (capability `desktop-app`, Requirement: *A
 * Turn Ending on a Generative-UI Question Is a Complete Turn*) and the sidecar
 * records the DESIGN-RECORD tool calls only (`shared/design-cards.ts`), never a
 * deferred-answer one — so the question survives nowhere
 * else: without it the model, seeded from a reopened transcript, sees an answer
 * to no question, and the lecturer, reopening the conversation, reads the same
 * orphan. Duplication is not a risk: the display projection is rendered only on
 * hydration, when the card is gone; while the card is on screen the answer is
 * never appended as a live user turn, so the card stays the only place the
 * question appears.
 *
 * The envelope is therefore dispatched as BOTH `sendPrompt` arguments — payload
 * and display projection. The two are not redundant: the host prefixes machine
 * notices (stale-maturity, canvas deletions, queued profile overrides, the
 * post-compaction handover) onto the payload, and only the explicit projection
 * keeps those out of what a reopened conversation renders. Passing it costs
 * nothing when nothing was prefixed — `main/ipc.ts` persists a projection only
 * where it differs from the composed payload.
 */
function formatPickerAnswer(toolCallId: string, spec: PickerSpec, response: PickerResponse): string {
  const labelById = new Map<string, string>();
  for (const opt of spec.options) labelById.set(opt.id, opt.label);

  const picked = response.selectedIds.map((id) => {
    const label = labelById.get(id);
    return label ? `${id} ("${label}")` : id;
  });

  const lines: string[] = [`[picker answer · tool call ${toolCallId}]`];
  if (picked.length > 0) {
    lines.push(`selected: ${picked.join(", ")}`);
  } else if (!response.otherText) {
    lines.push(`selected: none`);
  }
  if (response.otherText) {
    lines.push(`other: ${response.otherText}`);
  }
  const question = typeof spec.question === "string" ? envelopeField(spec.question, ENVELOPE_CONTEXT_MAX_CHARS) : "";
  if (!question) return lines.join("\n");
  const [head, ...rest] = lines;
  return [head, `question: ${question}`, ...rest].join("\n");
}

/** Defensive runtime sanity check for a decision-checklist spec — mirrors
 * `validatePickerSpec`. Returns an error string when the spec is unrenderable,
 * else null. Guards against the broken-component failure mode even if pi's
 * schema validation lets a degenerate payload through. */
export function validateChecklistSpec(args: unknown, t: ChromeCatalogue): string | null {
  const reject = (detail: string): string => t.toolChecklistSpecRejected({ detail });
  if (args == null || typeof args !== "object") return reject(t.toolSpecDetailArgsMissing);
  const a = args as Record<string, unknown>;
  if (a.presentation !== "checklist" && a.presentation !== "progress-bar")
    return reject(t.toolSpecDetailPresentationInvalid);
  if (!Array.isArray(a.items)) return reject(t.toolSpecDetailItemsMissing);
  if (a.items.length < 2) return reject(t.toolSpecDetailItemsTooFew({ count: a.items.length }));
  for (let i = 0; i < a.items.length; i++) {
    const it = a.items[i];
    if (it == null || typeof it !== "object") return reject(t.toolSpecDetailItemNotObject({ index: i }));
    const item = it as Record<string, unknown>;
    if (typeof item.id !== "string" || item.id.length === 0) return reject(t.toolSpecDetailItemIdEmpty({ index: i }));
    if (typeof item.label !== "string" || item.label.length === 0)
      return reject(t.toolSpecDetailItemLabelEmpty({ index: i }));
  }
  return null;
}

/** Format the lecturer's checklist update as the next user-turn text. Carries the
 * toolCallId for correlation and lists done vs open items with ids + labels.
 *
 * A checklist call ends the run just like a picker call, so the same orphan
 * applies — see `formatPickerAnswer`. What the answer misses is narrower: every
 * item's id and label is already enumerated here, so only the checklist's TITLE
 * lives solely on the card. It rides the envelope when present, normalised and
 * bounded exactly like the picker's question; an untitled checklist needs
 * nothing, its items are the context. */
function formatChecklistAnswer(toolCallId: string, spec: DecisionChecklistSpec, doneIds: string[]): string {
  const doneSet = new Set(doneIds);
  const fmt = (it: DecisionChecklistSpec["items"][number]) => `${it.id} ("${it.label}")`;
  const done = spec.items.filter((it) => doneSet.has(it.id)).map(fmt);
  const open = spec.items.filter((it) => !doneSet.has(it.id)).map(fmt);
  const title = typeof spec.title === "string" ? envelopeField(spec.title, ENVELOPE_CONTEXT_MAX_CHARS) : "";
  return [
    `[checklist update · tool call ${toolCallId}]`,
    ...(title ? [`title: ${title}`] : []),
    `done: ${done.length ? done.join(", ") : "none"}`,
    `open: ${open.length ? open.join(", ") : "none"}`,
  ].join("\n");
}

/**
 * Assumption framing for `cbe_profile` cards (capability `desktop-app`,
 * Requirement: Inferred Calibration Framed as an Overridable Assumption). The
 * card head summarises WHAT changed (dimension → value · confidence); the
 * `toolProfileAssumptionNote` catalogue entry conveys HOW to read it — an
 * assumption inferred from the conversation, not a fixed determination — and
 * names where the override happens. Chrome; the agent's model output is untouched.
 */
export function ToolCard({ card, technicalDetail = false }: { card: ToolCardData; technicalDetail?: boolean }) {
  const t = useChrome();
  const [open, setOpen] = useState(technicalDetail);
  // Read session paths once per render so the args summary can show
  // `corpus/content/foundations/abc.md` instead of an absolute filesystem path.
  const sessionPaths = useCbe((s) => s.session?.paths ?? null);
  const sessionId = useCbe((s) => s.session?.sessionId ?? null);
  const setChatNotice = useCbe((s) => s.setChatNotice);

  // Generative-UI swap: when the tool is cbe_picker, render the Picker
  // component INSTEAD of the standard tool card body. The args payload is
  // the validated PickerSpec passed in via pi's customTools mechanism. On
  // submit, the answer flows back as a new user turn — pi's tool result
  // itself is just a placeholder (see packages/pi-bridge/src/picker-tool.ts).
  //
  // Defensive layer 2: never render the Picker with placeholder or empty
  // data. Pi errors and render-time sanity failures both use safe recovery;
  // their raw defect remains in local diagnostics.
  if (card.toolName === "cbe_picker") {
    const swapBlocker =
      card.status === "error" ? (card.errorMessage ?? t.toolPickerCallFailed) : validatePickerSpec(card.args, t);
    if (!swapBlocker) {
      const spec = card.args as PickerSpec;
      return (
        <div className={`tool-card tool-card-picker tool-${card.status}`}>
          <Picker
            spec={spec}
            onSubmit={(response) => {
              if (!sessionId) return;
              const text = formatPickerAnswer(card.toolCallId, spec, response);
              void window.cbe.sendPrompt(sessionId, text, { text }).catch((err: unknown) => {
                setChatNotice(promptFailureNotice(err instanceof Error ? err.message : String(err)));
              });
            }}
          />
        </div>
      );
    }
    // Invalid interaction content is not useful technical detail. Keep the
    // existing safe recovery outside the disclosure and never expose the raw
    // validation/exception text that produced it.
    return (
      <div className="chat-notice tool-card-picker-error" role="status">
        <div className="chat-notice-text">{t.chatInteractionUnavailable}</div>
      </div>
    );
  }

  // Generative-UI swap for the Decision Checklist — same deferred-answer model
  // and same two-layer defensive fallback as the picker above.
  if (card.toolName === "cbe_decision_checklist") {
    const swapBlocker =
      card.status === "error" ? (card.errorMessage ?? t.toolChecklistCallFailed) : validateChecklistSpec(card.args, t);
    if (!swapBlocker) {
      const spec = card.args as DecisionChecklistSpec;
      return (
        <div className={`tool-card tool-card-checklist tool-${card.status}`}>
          <DecisionChecklist
            spec={spec}
            onSubmit={(doneIds) => {
              if (!sessionId) return;
              const text = formatChecklistAnswer(card.toolCallId, spec, doneIds);
              void window.cbe.sendPrompt(sessionId, text, { text }).catch((err: unknown) => {
                setChatNotice(promptFailureNotice(err instanceof Error ? err.message : String(err)));
              });
            }}
          />
        </div>
      );
    }
    return (
      <div className="chat-notice tool-card-checklist-error" role="status">
        <div className="chat-notice-text">{t.chatInteractionUnavailable}</div>
      </div>
    );
  }

  const argsLabel = summariseArgs(card.toolName, card.args, (p) => shortenAgentPath(p, sessionPaths));
  // Raw failure text never reaches a rendered card, by construction rather than by
  // the caller opting in: the substitution does not depend on `technicalDetail`, so
  // no future call site can print `errorMessage` into the transcript. The raw detail
  // stays in the existing local diagnostic trace.
  const resultLabel = card.status === "error" ? t.toolExecutionFailed : bodyResultText(card.result);
  // The opened technical panel keeps the existing readable action summary. Rows are
  // told apart by their own action and status — a constant name would make every row
  // of a multi-tool turn indistinguishable — while raw errors stay out of the name.
  const humanLabel = toolStatusLabel(card.toolName, card.args, t);
  const statusText = toolStatusText(card.status, t);

  return (
    <div className={`tool-card tool-${card.status}`}>
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          technicalDetail ? t.chatWorkingToolActivityLabel({ action: humanLabel, status: statusText }) : humanLabel
        }
      >
        <span className="tool-card-dot" aria-hidden="true" />
        <span className="tool-card-label">{humanLabel}</span>
        <span className="tool-card-id mono">{card.toolName}</span>
        {argsLabel && <span className="tool-card-args mono">{argsLabel}</span>}
        <span className="tool-card-status mono">{statusText}</span>
      </button>
      {card.toolName === "cbe_profile" && card.status !== "error" && (
        <div className="tool-card-note">{t.toolProfileAssumptionNote}</div>
      )}
      {resultLabel && open && <div className="tool-card-body mono">{resultLabel}</div>}
    </div>
  );
}
