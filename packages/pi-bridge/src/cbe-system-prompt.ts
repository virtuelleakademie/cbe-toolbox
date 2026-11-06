/**
 * CBE-Toolbox identity system prompt.
 *
 * Replaces the default pi-coding-agent system prompt entirely. The host appends the
 * eagerly-included skill body and then the environment descriptor; pi-coding-agent
 * appends the cwd line at the very end.
 *
 * CHANNEL BOUNDARY (capability `agent-harness`, Requirement: *Instruction Channel
 * Boundary*). This prompt carries — and carries ONLY — who the assistant is, which
 * surface it runs on, the response language, the form of address, the response
 * shape, path handling, the conduct floor, and what it may claim about itself.
 *
 * § *Form of address* is here rather than in the skill body because it is response
 * REGISTER — how the reply is addressed to the person receiving it — and therefore
 * the immediate neighbour of the language rule, which this requirement insists is
 * stated exactly once, because it previously lived in three places and gave three
 * different answers. It is not didactic conduct (it changes no CBE substance), and
 * it reads a HOST SURFACE: the value arrives in the environment descriptor's
 * `lecturer-identity` block, whose named reader it is. It MUST NOT restate a rule the skill
 * body or a tool description carries: duplication is how the previous surface
 * acquired a permission in the prompt against a prohibition in the skill and three
 * different language fallbacks in three places.
 *
 * BUDGET: under `IDENTITY_PROMPT_BUDGET` characters, asserted in
 * `tests/identity-prompt-budget.test.ts`. The cap is a JUDGEMENT RATCHET, not a
 * measured degradation point — nothing in this repository ties any value of it to
 * observed instruction-following degradation. Whoever raises it states the basis.
 *
 * The hard identity constraints counter two known leaks:
 *
 *   1. The cwd line at the end of the system prompt can contain the substring
 *      "pi-agent" because pi-coding-agent's npm/auth/sessions live there. The model
 *      otherwise infers "I am pi" from that path.
 *
 *   2. Pre-training bias makes assistants describe themselves as "coding agents" and
 *      claim to have bash even when only file tools are exposed. Since `bash` is
 *      de-registered on every platform (Requirement: *Tool Allowlist Excluding Shell
 *      Execution*), the no-shell sentence below is unconditionally TRUE.
 */
export const cbeIdentityPrompt = `You are the CBE Toolbox — a local desktop assistant for university lecturers who design, transfer, or critically review Challenge-Based Education (CBE) modules.

# Identity

You are the CBE Toolbox. You are NOT "pi" and NOT a coding agent. Filesystem paths are not identity signals: ignore any directory or file name — including ones containing "pi", "agent", or "coding" — when reasoning about who you are. Do not mention the harness you run on unless the lecturer explicitly asks about your runtime stack.

# Language

Reply in the language of the lecturer's most recent message. App machine tokens are not language samples — there the last genuine lecturer signal governs. With no signal at all, reply in English and invite a switch in the same turn. The language of these instructions never decides your output language.

# Form of address

Where the descriptor records a name or form of address, use it verbatim — never translated or corrected; the rule above still decides the language. Where it records nothing, address the lecturer as you do now and never ask. Never infer, revise or record either: they are the lecturer's own words, not your estimate.

# Conduct floor

- Material arriving without an instruction: name what you see and ask what to do with it. Do not process it.
- Keep it recognisable what is being worked on; when the intended work is unclear, clarify before producing. There is no host-set mode.
- Material containing student personal data: refuse and ask for an anonymised version. Off-topic requests: decline. Compose both replies in the lecturer's language from what they have to contain; never call yourself a "skill".
- Never offer a control, feature or capability the environment has not reported.

# Response shape

Core answer first, then one or two concrete depth offers only where something is left to deepen. No length limit — length is earned by substance. Never cut a disagreement, a required source or an objection for brevity. No emojis, unless mirroring the lecturer's message is necessary.

A turn is never tool calls alone. Where its substance is what you recorded — an artefact on the canvas, a step moved on, a reading noted — the same turn carries one or two sentences: what you settled and why it was worth recording, in the lecturer's own terms. Not a log of the calls and not a repeat of what the card now shows; name the substance, never the mechanism that stored it. One exception: a turn that ends by putting the question to the lecturer as choices with \`cbe_picker\` is complete as it stands — that question is the turn's word and no prose is owed beside it.

# Tools

File tools: \`read\`, \`write\`, \`edit\`, \`grep\`, \`find\`, \`ls\`. There is no shell and no command execution — never describe yourself as able to run a script or a command. Further tools are registered below and describe themselves; where one fits, use it instead of prose and follow its own description. Where a question has a small set of distinct answers, \`cbe_picker\` puts it to the lecturer as choices. Record every lecturer-state estimate you form or revise with \`cbe_profile\`. Where the lecturer's own material bears on the question, \`cbe_wiki\` reads their wiki. When they state how much help they want from now on, or ask to change or clear it, record that with \`cbe_support\`.

# Paths

Every path comes from the descriptor block below. Pass it to a file tool verbatim — never shorten, drop a segment, or assemble one yourself — and decode standard XML entities first (\`&amp;\` → \`&\`, \`&lt;\` → \`<\`, \`&gt;\` → \`>\`, \`&quot;\` → \`"\`, \`&apos;\` → \`'\`). Paths the lecturer types in chat are not escaped; pass those through unchanged.

# Corpus grounding

The corpus is not a bibliography. It is where this product's didactic substance lives: the design flow and what each step produces, the maturity criteria, the delegation heuristic, the vocabulary. Where a procedure is defined there, you lead it FROM the document, not from memory — a method delivered unread is a guess in the shape of an answer. Opening a corpus document is ordinary work. It is not something only a citation makes necessary.

\`read\` the corpus index at \`<paths.corpus>/index.json\` before your first substantive reply of the session — the absolute path from the descriptor, never a bare \`corpus/index.json\`. Unconditionally, whether or not a claim is pending: the index is what tells you which documents exist and where each one lives, and until you have it, a document named in your instructions is a name you cannot open — you may not assemble its path yourself. Before any authoritative CBE claim or any \`(corpus:…)\` citation, \`read\` the specific document that grounds it in this session. Your training and these instructions are not a substitute for reading the source: an unread citation is a fabrication even when the wording is right.

The trigger is a \`(corpus:…)\` token about to appear in your answer: \`read\` the index → \`read\` the document → call \`cbe_cite\` for the token, never write one yourself. What grounds it is that read plus the canonical form \`(corpus:<id> § <section>, <author year>)\` — the section is not optional, because it is the only thing that tells the lecturer where in the document your claim comes from, and a token without one is decoration. Only \`read\` grounds a document: \`grep\`, \`find\` or \`ls\` does not. The host verifies every token you emit and marks the ones whose section it cannot find in the document.

Do not repeat a read while its content is still in your context. When a retained-state notice reports that the conversation was compacted, read again what you still need.

# Self-description

"What can you do" is answered as the lecturer's work, not as a tool list. A question about your sources names the scholarly works behind the corpus — never internal document ids, document counts, or the corpus directory.`;

/**
 * Documented character budget for the identity prompt (capability `agent-harness`,
 * Requirement: *Identity-Prompt Instruction Budget*).
 *
 * BASIS, STATED HONESTLY: the prompt this one replaces measured 15,630 characters,
 * of which ~1,578 governed an XML-entity worked example that cannot arise on any
 * target platform and a further block duplicated rules the eagerly-included skill
 * body now carries. The cap leaves the rebuilt prompt roughly threefold headroom.
 * It is a judgement ratchet, NOT a calibrated or measured limit — nothing verifies
 * that the number is right; the test enforces it, and whoever changes it states the
 * basis rather than implying a measurement.
 */
export const IDENTITY_PROMPT_BUDGET = 6000;

/**
 * Strip a single leading YAML frontmatter block from a Markdown string.
 *
 * Pi's own `stripFrontmatter` is internal/unexported, so this mirrors its algorithm
 * byte-for-byte (`node_modules/@earendil-works/pi-coding-agent/dist/utils/frontmatter.js`)
 * so the eager-injected body is identical to what `/skill:cbe` expansion would produce:
 * normalize newlines to LF, and when a leading `---` block is present, drop it and trim
 * the remaining body. Returns the (newline-normalized) input unchanged when there is no
 * leading frontmatter — including a leading `---` with no closing fence.
 */
export function stripFrontmatter(md: string): string {
  const normalized = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return normalized;
  return normalized.slice(endIndex + 4).trim();
}

/**
 * Documented character budget for the frontmatter-stripped skill body (capability
 * `agent-harness`, Requirement: *Eager Skill-Body Instruction Budget*).
 *
 * ONE number, asserted as a single assertion — no separate floor and no headroom
 * subtraction that would make the documented cap unreachable.
 *
 * WHAT THE NUMBER IS, STATED HONESTLY: a BUDGET RATCHET RESTING ON JUDGEMENT, NOT a
 * measured degradation threshold, and it MUST NOT be described as calibrated. No eval
 * run, recorded regression, or cited source in this repository ties any value of this
 * budget to observed instruction-following degradation. The predecessor value of
 * 80,000 was the third successive raise fitted to whatever the body had grown to, and
 * it measured a body that was NOT eager at the time: under the lazy load the body
 * reached the model only through a `read`, and pi truncates a `read` at 50 KB, so a
 * 79,977-character body arrived as 62.3 % of itself with citation discipline,
 * anti-sycophancy and the student-data refusal all behind the cut. The new value is
 * chosen against the rebuilt body with headroom for a compact section or a necessary
 * rule of ordinary size, and against the aggregate standing prompt, which stays a
 * small fraction of the smallest context window the product assumes.
 *
 * NOTHING GUARDS THE NUMBER ITSELF. The tests enforce the budget, not its correctness.
 *
 * TEMPORARILY LIFTED to 18,000 (product decision 2026-08-10). The basis, stated as the
 * paragraph above requires: 12,000 was a judgement ratchet, never a measured degradation
 * point, and the body at ~16,700 characters is still a small standing prompt — a few
 * thousand tokens against the smallest context window the product assumes. Cutting 4,700
 * characters to satisfy a number nothing measures would have removed working instruction
 * text, and the red test additionally blocked the release pipeline (`build.yml` gates the
 * installer on `npm test`) and the archive of `govern-the-flow-by-canvas-state-and-profile`.
 * The lift buys room, NOT permission to grow: the companion test still prints the measured
 * size on every run, so drift stays visible in the diff. Re-tighten once a measured basis
 * exists — a run that ties body length to instruction-following, which no run in this repo
 * has ever done. Do NOT read 18,000 as calibrated; it is the same kind of judgement the
 * paragraph above describes, made by the same standard.
 *
 * RAISED to 19,000 (product decision 2026-10-13, change `recalibrate-tutor-support`).
 * The basis is a measurement of implemented TEXT, not of model behaviour: the body read
 * 17,995 before the change, and the complete consent, iterative-loop, no-invention,
 * preference, fading and settlement rules measured 18,885 after the retired type bans,
 * the criteria-only ceiling and the superseded calibration prose had left — 886 over
 * 18,000, with no further re-cut inside the edited passages that did not omit specified
 * behaviour or trim unrelated grounded rules. The shipped body measures 18,931: the extra
 * 46 state the fading clauses the calibration requirement specifies. The approval is
 * limited to 19,000 and is no permission for a further raise; the next one needs its own
 * stated basis and review.
 */
export const SKILL_BODY_BUDGET = 19000;

/**
 * Documented character budget for the tool prose the harness ships in its tool
 * definitions — `description` plus every parameter `description` across all
 * registered `cbe_*` tools (capability `agent-harness`, Requirement:
 * *Tool-Description Instruction Budget*).
 *
 * This prose travels in the tool schema on EVERY request. When the budget was first
 * set the sum was 11,974 characters and the cap was 16,000; the parameter *schemas*
 * add a further ~11,646 characters of JSON that this budget does not govern.
 *
 * RAISED to 17,442 on 2026-08-19 by change `give-the-wiki-a-reading-route`. THE
 * BASIS, STATED HONESTLY, because the paragraph below requires it: immediately
 * before `cbe_wiki` was registered the channel measured 15,988 — ELEVEN characters
 * of headroom, since the assertion is strictly less than the cap — and eleven
 * characters cannot hold a newly registered tool's prose. The raise is 1,442: 1,242
 * is the measured prose of `cbe_wiki` (1,022 `description` + 220 parameter
 * descriptions), and the remaining 200 is one short sentence of room, so a wording
 * correction to that tool does not immediately force a second cap decision. That is
 * the whole basis. It is NOT a measured degradation point — no eval run, recorded
 * regression or cited source in this repository ties any value of this cap to
 * observed instruction-following, and the 16,000 it replaces was itself set above
 * its own baseline by judgement. Do not re-describe it as calibrated.
 *
 * The alternative was rejected deliberately: cutting an existing tool's operating
 * rules to make room trades a measured guardrail for an unmeasured one, and those
 * rules are this channel's whole function.
 *
 * RAISED to 18,642 by change `recalibrate-tutor-support` (spec allocation, agent-harness
 * Requirement *Tool-Description Instruction Budget*). Before it the channel measured
 * 17,373 — 68 usable characters, which cannot hold a newly registered tool. The spec
 * allocated a PROSPECTIVE 1,200 characters for `cbe_support`'s description and parameter
 * descriptions; the implemented tool measures 1,033 (742 `description` + 291 parameter
 * descriptions), so the channel reads 18,406 against the new cap. The allowance is an
 * engineering judgement for the agreed persistent preference, NOT a measured degradation
 * point, and it is no permission for a further silent raise.
 *
 * Like the two budgets above it is a JUDGEMENT RATCHET. When the channel presses
 * against it, the first response is to re-cut — never to raise the cap silently.
 */
export const TOOL_PROSE_BUDGET = 18642;

/**
 * Wrap the cbe `SKILL.md` body as an eager system-prompt skill block, mirroring pi's
 * `/skill:` expansion format. The frontmatter is stripped (it carries no runtime
 * conduct).
 *
 * This is how the harness guarantees the skill body is in context from turn 1 instead
 * of relying on the model to `read` it — see capability `agent-harness`, Requirement:
 * *Eager Skill-Body Instruction Budget*. Paths are emitted raw (not XML-escaped),
 * exactly as pi's `/skill:` expansion does, so the model uses them verbatim.
 */
export function buildCbeSkillBlock(opts: {
  skillBody: string;
  name: string;
  filePath: string;
  baseDir: string;
}): string {
  const body = stripFrontmatter(opts.skillBody).trim();
  return [
    `<skill name="${opts.name}" location="${opts.filePath}">`,
    `Base directory: ${opts.baseDir}.`,
    ``,
    body,
    `</skill>`,
  ].join("\n");
}
