/**
 * `cbe_picker` — a generative-UI tool the skill calls to ask the lecturer a
 * structured multi-choice question. See `specs/desktop-app/spec.md`,
 * Requirement *Generative UI — Picker (single and multi-select)*.
 *
 * Architecture: this tool follows the spec's hybrid model — emission via
 * pi's tool mechanism (so the model calls the tool natively), but the
 * lecturer's actual answer flows back as a *new user turn* rather than as
 * the tool's result. The tool's `execute` therefore returns immediately with
 * a placeholder result whose role is solely to (a) tell the model "the
 * picker has been shown, the next user message will carry the answer", and
 * (b) signal to the renderer that a picker should be drawn — the renderer
 * picks up the `args` payload from the `tool_execution_start` event and
 * renders the Picker React component in place of the standard tool card.
 *
 * Rationale for not waiting on the user inside `execute()`: pi tools are
 * expected to return promptly. Blocking on user input would (a) couple the
 * agent loop to UI latency, (b) need a complex IPC roundtrip to resolve the
 * promise, (c) interfere with pi's tool-batching semantics. Letting the
 * answer arrive as the next user turn keeps the agent loop pi-shaped and
 * matches the spec scenario *Single-select picker renders pills and
 * round-trips a selection*.
 *
 * The call ENDS THE RUN (`terminate: true`; capability `agent-harness`,
 * Requirement *The Agent Run Ends on a Deferred-Answer Tool Call*). Without it,
 * pi's loop appends the placeholder and re-invokes the model — a full round trip
 * whose input carries no information, observed in the UX-3 run of 2026-08-05 as a
 * thinking pass that produced only *"I will finish my turn and wait."* `terminate`
 * is the documented field on pi's public `AgentToolResult`; the loop honours it in
 * `shouldTerminateToolBatch` and exits through the ordinary `turn_end` → `agent_end`
 * path, so the tool result is still delivered and the turn does not read as aborted
 * (which `session.abort()` would have made it). It is a BATCH property: a picker
 * emitted beside a non-terminating tool (`cbe_canvas`/`cbe_step`/`cbe_maturity`)
 * leaves `shouldTerminateToolBatch` false, so the run continues and the empty round
 * trip returns. That residual path is an accepted boundary, recorded in the change's
 * `design.md` § Known boundaries. The pending-answer gate below does NOT close it —
 * the gate bounds what may be RECORDED while an answer is pending (it refuses
 * ungrounded mirroring writes), it does not stop the model from being called again.
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PendingAnswerGate } from "./pending-answer-gate.js";

const PickerOptionSchema = Type.Object({
  // `minLength: 1` on both id and label is defensive layer 1 against the
  // observed failure mode "model emits picker with placeholder/empty options
  // as a stand-in for a free-text input form". Without minLength, typebox
  // accepts empty strings and the renderer would dutifully draw visually empty
  // pills. See agent-harness spec, *Generative-UI tool schemas reject empty /
  // placeholder field values*.
  id: Type.String({
    minLength: 1,
    description: "Stable identifier echoed back in the selection. Short, kebab-case.",
  }),
  label: Type.String({
    minLength: 1,
    description: "Visible pill text. Plain text, under ~80 chars.",
  }),
});

const PickerParamsSchema = Type.Object({
  question: Type.String({
    minLength: 1,
    description:
      "The question shown above the pills. Markdown is supported — headings, bold, citation tokens — but keep it under three sentences.",
  }),
  options: Type.Array(PickerOptionSchema, {
    minItems: 2,
    maxItems: 7,
    description:
      "The pill options. Aim for 2–5; more than 5 feels like a survey. Every label is a concrete, grounded answer, distinct enough that picking one decides something.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      description:
        "Single- vs multi-select, and a POSITIVE decision you make from the shape of the question — never a default you leave standing. Set true when several options can legitimately hold at once (plural or combination questions: which competences, which phases, which of the following); the pills then commit together. Set false (or omit) only for a genuine either/or where exactly one option can be true; that pill auto-submits.",
    })
  ),
  otherEnabled: Type.Optional(
    Type.Boolean({
      description:
        "If true (default), the app appends its own free-text option with a text input. Set false only when the option set is exhaustive. Never put a free-text / 'other' option into `options[]` yourself — the app provides exactly one.",
    })
  ),
  otherLabel: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Label of the app-provided free-text option, written in the LECTURER'S language (e.g. 'Andere — ich beschreibe es', 'Other — I'll describe it'). Supply it whenever the conversation is not in English.",
    })
  ),
  required: Type.Optional(
    Type.Boolean({
      description:
        "Cosmetic — renders a small red asterisk beside the question to signal an answer is expected. Default false.",
    })
  ),
});

export type PickerToolParams = Static<typeof PickerParamsSchema>;

// Exported for unit tests that verify the schema contract (minLength on every
// rendered string field, minItems on options). Pi runs the actual validation
// against this schema before calling execute(); see agent-harness spec,
// *Generative-UI tool schemas reject empty / placeholder field values*.
export { PickerParamsSchema };

/**
 * Free-text ("other") words the model actually reaches for when it builds its
 * own escape-hatch option. Deliberately a small, curated set covering the
 * languages the lecturer population uses — not an attempt at every language.
 */
const OTHER_WORDS = [
  "other",
  "others",
  "something else",
  "andere",
  "anderes",
  "anderer",
  "etwas anderes",
  "sonstiges",
  "sonstige",
  "autre",
  "autres",
  "autre chose",
  "altro",
  "otro",
  "otra",
  "otros",
  "outro",
  "anders",
  "iets anders",
  "annat",
];

/** Separators the model puts between the word and its explanatory tail
 * ("Andere — ich beschreibe es"). A following LETTER is not a separator, so a
 * genuine option like "Andere Formate" is never mistaken for the escape hatch. */
const OTHER_TAIL = /^[\s]*[—–\-:,./(…|]/u;

/**
 * Does this model-supplied option denote the free-text escape hatch? True when
 * the LABEL is one of the other-words, or starts with one followed by a
 * separator.
 *
 * The label alone decides — deliberately. An earlier version accepted a match on
 * the option id as well, which swallowed a genuine choice whose id merely
 * happened to be an other-word (`{id: "sonstiges", label: "Weitere
 * Praxisbeispiele"}`): the pill vanished from the set AND its substantive label
 * was adopted onto the app's free-text pill. Losing a choice the lecturer could
 * have picked is worse than the doubled free-text surface this collapse exists
 * to remove, so detection rests on the one signal the lecturer actually sees.
 */
export function isFreeTextOption(opt: { id: string; label: string }): boolean {
  const text = opt.label
    .toLowerCase()
    .replace(/^[\s"'«»(\[]+/u, "")
    .trimEnd();
  return OTHER_WORDS.some((word) => {
    if (!text.startsWith(word)) return false;
    const rest = text.slice(word.length).replace(/[\s"'»)\]?.!]+$/u, "");
    return rest.length === 0 || OTHER_TAIL.test(rest);
  });
}

/**
 * Collapse the model's own free-text option into the app-provided one so exactly
 * ONE free-text surface is ever rendered (capability `desktop-app`, Requirement:
 * Collected UX-3 Fixes (Wave 1), scenario *Exactly one free-text option…*).
 *
 * UX run 2 showed two adjacent escape hatches: the model shipped its own
 * "Andere — ich beschreibe es" pill AND the renderer appended its hardcoded
 * English one. Rather than dropping the model's pill outright, its label is
 * ADOPTED as `otherLabel` — the model wrote it in the lecturer's language, which
 * is exactly what the app-provided pill needs (capability `cbe-skill`,
 * Requirement: Response Language Mirrors the Lecturer).
 */
export function normalizePickerParams(params: PickerToolParams): PickerToolParams {
  const adopted = params.options.filter(isFreeTextOption);
  if (adopted.length === 0) return params;
  const options = params.options.filter((o) => !isFreeTextOption(o));
  if (options.length < 2) {
    // Degenerate payload (e.g. exactly two options, one of them the escape
    // hatch). Removing it would leave a one-entry `options[]`, which the
    // renderer's structural sanity check rejects outright (capability
    // `desktop-app`, scenario *Renderer shows safe recovery when the picker spec
    // is structurally malformed*) — a worse outcome than a pill without a text
    // input. So the model's option stays and the app's is suppressed instead:
    // still exactly ONE free-text surface.
    return { ...params, otherEnabled: false };
  }
  return {
    ...params,
    options,
    // The model asked for an escape hatch by building one — honour that intent
    // even if it also (contradictorily) passed otherEnabled: false.
    otherEnabled: true,
    otherLabel: params.otherLabel ?? adopted[0]!.label,
  };
}

/** Build the picker tool. With a `PendingAnswerGate` bound, an emission registers an
 * outstanding lecturer question for the rest of the run, so mirroring writes issued
 * before the answer arrives are refused (capability `agent-harness`, Requirement:
 * Deterministic Tool-Boundary Enforcement…). */
export function createPickerTool(gate?: PendingAnswerGate) {
  return defineTool({
    name: "cbe_picker",
    label: "Picker",
    // The description LEADS with recognition and only then constrains. Its previous
    // shape spent one clause on when a picker fits and the rest on how not to get it
    // wrong, and the observed consequence was under-use: closed-set questions asked in
    // prose. The examples are moments from the ten-step flow, and every one of them is a
    // decision ABOUT the work — never a formulated artefact for the lecturer's own
    // module, which the skill body forbids and this channel therefore does not restate.
    // Order is load-bearing and asserted in `tests/tool-description-coverage.test.ts`
    // (change `lead-the-picker-description-with-recognition`).
    description:
      "Ask the lecturer ONE discrete question as pill options. REACH FOR IT WHENEVER A DECISION ABOUT THE DESIGN IS THE LECTURER'S TO MAKE AND YOUR QUESTION HAS A SMALL, CLOSED SET OF CONCRETE ANSWERS YOU COULD ALREADY NAME AND THE CONVERSATION BRANCHES ON WHICH ONE HOLDS — that shape IS a picker, and asking it in prose wastes the surface. Recurring shapes in the design flow: which finding to take first, which side of a break at the coherence gate to adjust, which component the delegation question is settled for next, which recorded card a statement revises. IT IS NOT AN INPUT FORM: if you cannot name at least two concrete, grounded option labels the question is still open — ask it in prose, and never render placeholder or empty pills in place of a text box. THE PICKER IS THE QUESTION: never announce it, never restate it beside the pills, never tell the lecturer to choose, never say what you will do once they answer. Say any substance the question rests on BEFORE the call; the call ends your turn and no text follows it. Their selection arrives as the NEXT user turn with the selected ids and any free-text answer — do not pre-empt it. EMIT EVERY CANVAS, STEP AND MATURITY MIRROR FOR THIS TURN BEFORE THIS CALL: once a picker is outstanding the host refuses those writes — an answer not yet arrived cannot ground them. Call it only when the environment descriptor reports the `picker` affordance; if not, ask the same question in prose with the options as a short list and read the answer from the reply.",
    promptSnippet:
      "Use cbe_picker(question, options[], multiSelect?, otherEnabled?, otherLabel?, required?) to ask the lecturer a multi-choice question rendered as pills.",
    // NOTE: pi renders `promptSnippet` / `promptGuidelines` into the system prompt
    // only on the DEFAULT-prompt branch of `buildSystemPrompt`. The CBE Toolbox
    // always supplies its own (`systemPrompt: cbeIdentityPrompt` in session.ts), so
    // in this app both are collected and then dropped — 7,830 characters of them.
    // They are kept accurate for hosts that use pi's default prompt; a rule that must
    // actually bind belongs in `description` or in a parameter `description` (both
    // travel in the tool schema to the provider). The skill body carries no tool
    // mechanics at all (capability `agent-harness`, Requirement: *Instruction Channel
    // Boundary*).
    promptGuidelines: [
      "Use cbe_picker for discrete choices (2–5 options) — NOT for open-ended elicitation that needs free text.",
      "The picker IS the question: do not announce it, restate it, or say what happens after the answer. The call ends your turn.",
      "Set multiSelect: true whenever several options can hold at once — plural interrogatives ('Welche Kompetenzen…', 'Welche Phasen…', 'Welche der folgenden…') or any combination/selection framing. Use single-select only for a genuine either/or where exactly one option can be true. Choose deliberately; do not leave multiSelect at the single-select default for an inherently multi-answer question.",
      "Leave otherEnabled at its default (true) unless the option set is exhaustive — lecturers often have a fourth path you didn't anticipate. The app renders that free-text option itself: never add your own 'other / Andere / Sonstiges' entry to options[], and pass otherLabel in the lecturer's language instead.",
      "The lecturer's answer arrives as the next user message containing the selected ids and any free-text 'Other' answer; continue your work from there.",
    ],
    parameters: PickerParamsSchema,
    async execute(_toolCallId, rawParams) {
      // Host-side normalisation: the spec the renderer receives carries at most
      // one free-text option, so the renderer can append its own unconditionally.
      const params = normalizePickerParams(rawParams);
      gate?.registerEmission("cbe_picker", params.question);
      // Placeholder result. The actual lecturer answer flows back as the next
      // user turn — see the file header. The `details` payload carries the
      // spec so the renderer can render the picker; the `content` text is
      // transcript context the model reads at the START of the next run (the
      // run this call ends), where it explains why a `[picker answer · …]` turn
      // is arriving.
      return {
        content: [
          {
            type: "text",
            text:
              "Picker rendered to the lecturer. Your turn ended here; their selection arrives as the next user message carrying the selected option ids" +
              (params.otherEnabled !== false ? " (and any free-text 'Other' answer)" : "") +
              ". Do not pre-empt their answer.",
          },
        ],
        details: { kind: "cbe_picker", spec: params },
        // Ends the agent run — see the file header. Nothing useful can happen
        // between this call and the lecturer's next turn.
        terminate: true,
      };
    },
  });
}

/** Default instance without a gate (schema-contract unit tests, headless). */
export const pickerTool = createPickerTool();
